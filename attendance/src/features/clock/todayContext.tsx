// Extra context for the clock and history screens: approved leave and
// approved outstation trips.
import { useEffect, useState } from 'react'
import { eachDay } from '../../lib/dates'
import { dayType } from '../../lib/workdays'
import type { Trip } from '../../lib/types'
import { myLeave } from '../leave/api'
import { myCalendar } from './api'
import { myTrips } from '../trips/api'
import { Notice } from '../../components/ui'
import { formatDateRange } from '../../lib/dates'

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

export function useTodayContext(staffId: string, date: string, key: string) {
  const leave = useLeaveDays(staffId, date, date)
  const [trips, setTrips] = useState<Trip[]>([])
  useEffect(() => {
    let alive = true
    myTrips(staffId)
      .then((r) => alive && setTrips(r.data.filter((t) => t.status === 'approved' && t.start_date <= date && t.end_date >= date)))
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [staffId, date, key])
  return { leaveToday: leave.get(date) ?? null, tripsToday: trips }
}

/** Shown when "Outstation" is chosen: link to today's approved trip, or warn. */
export function OutstationPicker(props: { trips: Trip[]; value: string | null; onChange: (id: string | null) => void }) {
  const { trips, value, onChange } = props
  useEffect(() => {
    if (!value && trips.length > 0) onChange(trips[0].id)
  }, [trips, value, onChange])
  if (trips.length === 0)
    return (
      <Notice kind="warn">
        You have no approved outstation trip for today. You can still clock in, but HR will be alerted. Request a trip from
        Requests if you haven't.
      </Notice>
    )
  return (
    <div className="field">
      <label htmlFor="trip">Outstation trip</label>
      <select id="trip" value={value ?? ''} onChange={(e) => onChange(e.target.value || null)}>
        {trips.map((t) => (
          <option key={t.id} value={t.id}>
            {t.destination} ({formatDateRange(t.start_date, t.end_date)})
          </option>
        ))}
      </select>
    </div>
  )
}
