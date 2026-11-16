import { supabase } from '../../lib/supabase'
import { cached, enqueue, pendingOps, q, syncNow } from '../../offline/outbox'
import type { AttendanceEntry, Holiday, WorkMode, WorkSchedule } from '../../lib/types'
import { WORK_MODE_LABEL } from '../../lib/types'

export interface MyCalendar {
  schedules: WorkSchedule[]
  holidays: Holiday[]
}

/** My schedule history and the holiday list (cached for offline use). */
export async function myCalendar(staffId: string): Promise<MyCalendar> {
  const { data } = await cached('calendar', async () => {
    const [schedules, holidays] = await Promise.all([
      q<WorkSchedule[]>(supabase.from('work_schedules').select('*').eq('staff_id', staffId)),
      q<Holiday[]>(supabase.from('public_holidays').select('*').order('holiday_date')),
    ])
    return { schedules, holidays }
  })
  return data
}

export async function myEntries(staffId: string, from: string, to: string) {
  return cached(`entries:${from}:${to}`, () =>
    q<AttendanceEntry[]>(
      supabase
        .from('attendance_view')
        .select('*')
        .eq('staff_id', staffId)
        .gte('work_date', from)
        .lte('work_date', to)
        .order('clock_in_at'),
    ),
  )
}

export async function myOpenEntry(staffId: string) {
  return cached('open-entry', async () => {
    const rows = await q<AttendanceEntry[]>(
      supabase
        .from('attendance_view')
        .select('*')
        .eq('staff_id', staffId)
        .is('clock_out_at', null)
        .order('clock_in_at', { ascending: false })
        .limit(1),
    )
    return rows[0] ?? null
  })
}

/** An entry as the phone currently knows it (may not have reached the server yet). */
export interface LocalOpenEntry {
  id: string
  work_mode: WorkMode
  location: string
  purpose: string
  clock_in_at: string
  unsynced: boolean
}

export async function currentOpenEntry(staffId: string): Promise<{ open: LocalOpenEntry | null; fromCache: boolean }> {
  let server: AttendanceEntry | null = null
  let fromCache = false
  try {
    const r = await myOpenEntry(staffId)
    server = r.data
    fromCache = r.fromCache
  } catch {
    fromCache = true
  }
  const ins = await pendingOps('clock_in')
  const outs = await pendingOps('clock_out')
  const closedIds = new Set(outs.map((o) => o.payload.entry_id as string))
  const lastLocal = [...ins].reverse().find((o) => !closedIds.has(o.payload.id as string))
  if (lastLocal) {
    return {
      open: {
        id: lastLocal.payload.id as string,
        work_mode: lastLocal.payload.work_mode as WorkMode,
        location: lastLocal.payload.location as string,
        purpose: lastLocal.payload.purpose as string,
        clock_in_at: lastLocal.deviceAt,
        unsynced: true,
      },
      fromCache,
    }
  }
  if (server && !closedIds.has(server.id)) {
    return {
      open: {
        id: server.id,
        work_mode: server.work_mode,
        location: server.location,
        purpose: server.purpose,
        clock_in_at: server.clock_in_at,
        unsynced: false,
      },
      fromCache,
    }
  }
  return { open: null, fromCache }
}

export async function clockIn(input: { work_mode: WorkMode; location: string; purpose: string; trip_id?: string | null }) {
  const id = crypto.randomUUID()
  const op = await enqueue('clock_in', `Clock in – ${WORK_MODE_LABEL[input.work_mode]}`, { id, ...input })
  const res = await syncNow()
  return { id, op, synced: res.sent > 0 && !(await pendingOps('clock_in')).some((o) => o.id === op.id), conflict: res.conflicts > 0 }
}

export async function clockOut(entryId: string, note: string, location: string) {
  const op = await enqueue('clock_out', 'Clock out', { entry_id: entryId, note: note || null, location: location || null })
  const res = await syncNow()
  return { op, synced: !(await pendingOps('clock_out')).some((o) => o.id === op.id), conflict: res.conflicts > 0 }
}
