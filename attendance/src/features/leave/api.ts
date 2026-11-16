import { supabase } from '../../lib/supabase'
import { cached, enqueue, pendingOps, q, syncNow } from '../../offline/outbox'
import { storagePath, type PickedFile } from '../../lib/files'
import type { LeaveRequest, LeaveType } from '../../lib/types'
import type { DayPortion } from '../../lib/workdays'
import { formatDateRange } from '../../lib/dates'

export const leaveTypes = () =>
  cached('leave-types', () => q<LeaveType[]>(supabase.from('leave_types').select('*').eq('active', true).order('sort_order'))).then((r) => r.data)

export async function myLeave(staffId: string) {
  return cached('my-leave', () =>
    q<LeaveRequest[]>(supabase.from('leave_view').select('*').eq('staff_id', staffId).order('start_date', { ascending: false })),
  )
}

export async function getLeave(id: string) {
  return q<LeaveRequest | null>(supabase.from('leave_view').select('*').eq('id', id).maybeSingle())
}

export interface LeaveDraft {
  id: string
  leave_type: string
  start_date: string
  end_date: string
  day_portion: DayPortion
  reason: string
  document_path: string | null
}

/** Drafts saved on this phone that have not reached the server yet. */
export async function unsyncedLeaveDrafts(): Promise<LeaveDraft[]> {
  const ops = await pendingOps('save_leave')
  const byId = new Map<string, LeaveDraft>()
  for (const o of ops) byId.set(o.payload.id as string, o.payload as unknown as LeaveDraft)
  return [...byId.values()]
}

/** Save a draft. Works offline: it is queued and synced later. */
export async function saveLeaveDraft(staffId: string, d: LeaveDraft, file: PickedFile | null) {
  const files: { id: string; path: string; blob: Blob; contentType: string; name: string }[] = []
  let payload = { ...d }
  if (file) {
    const path = storagePath(staffId, 'leave', file)
    payload = { ...payload, document_path: path }
    files.push({ id: file.id, path, blob: file.blob, contentType: file.contentType, name: file.name })
  }
  await enqueue('save_leave', `Leave draft – ${formatDateRange(d.start_date, d.end_date)}`, payload as unknown as Record<string, unknown>, files)
  await syncNow()
  const stillQueued = (await pendingOps('save_leave')).some((o) => o.payload.id === d.id)
  return { synced: !stillQueued, payload }
}

export async function submitLeave(id: string) {
  return q<LeaveRequest>(supabase.rpc('submit_leave', { p_id: id }))
}

export async function cancelLeave(id: string, reason?: string) {
  return q(supabase.rpc('cancel_leave', { p_id: id, p_reason: reason ?? null }))
}
