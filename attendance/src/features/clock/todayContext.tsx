// Extra context for the clock and history screens: approved leave and
// approved outstation trips.
import { useEffect, useState } from 'react'
import { eachDay } from '../../lib/dates'
import { dayType } from '../../lib/workdays'
import type { Trip } from '../../lib/types'
import { myLeave } from '../leave/api'
import { myCalendar } from './api'

/** Map of date -> "Annual Leave" (or "Annual Leave, half day") for approved leave on working days. */
export function useLeaveDays(staffId: string, from: string, to: string): Map<string, string> {
  const [map, setMap] = useState(new Map<string, string>())
  useEffect(() => {
    let alive = true
    Promise.all([myLeave(staffId), myCalendar(staffId)])
      .then(([leave, cal]) => {
        const holidays = new Set(cal.holidays.map((h) => h.holiday_date))
        const m = new Map<string, string>()
        for (const r of leave.data) {
          if (r.status !== 'approved' || r.end_date < from || r.start_date > to) continue
          for (const d of eachDay(r.start_date < from ? from : r.start_date, r.end_date > to ? to : r.end_date)) {
            if (dayType(cal.schedules, holidays, d) === 'working_day')
              m.set(d, r.day_portion === 'full' ? r.leave_type_name ?? 'Leave' : `${r.leave_type_name}, half day`)
          }
        }
        if (alive) setMap(m)
      })
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [staffId, from, to])
  return map
}

export function useTodayContext(staffId: string, date: string, _key: string) {
  const leave = useLeaveDays(staffId, date, date)
  return { leaveToday: leave.get(date) ?? null, tripsToday: [] as Trip[] }
}

export function OutstationPicker(_props: { trips: Trip[]; value: string | null; onChange: (id: string | null) => void }) {
  return null
}
