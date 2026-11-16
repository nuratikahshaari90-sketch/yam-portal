import { supabase } from '../../lib/supabase'
import { cached, q } from '../../offline/outbox'
import type { AttendanceEntry, Trip } from '../../lib/types'

export const myTrips = (staffId: string) =>
  cached('my-trips', () =>
    q<Trip[]>(supabase.from('trip_view').select('*').eq('staff_id', staffId).order('start_date', { ascending: false })),
  )

export const getTrip = (id: string) => q<Trip | null>(supabase.from('trip_view').select('*').eq('id', id).maybeSingle())

export interface TripInput {
  id?: string
  destination: string
  start_date: string
  end_date: string
  purpose: string
  estimated_cost: string
  estimated_cost_notes: string
}

export const saveTrip = (t: TripInput) => q<Trip>(supabase.rpc('save_trip', { p: t }))
export const submitTrip = (id: string) => q<Trip>(supabase.rpc('submit_trip', { p_id: id }))
export const cancelTrip = (id: string, reason?: string) => q(supabase.rpc('cancel_trip', { p_id: id, p_reason: reason ?? null }))

/** Every clock-in/out made by the traveller during the trip dates. */
export const tripEntries = (t: Trip) =>
  q<AttendanceEntry[]>(
    supabase
      .from('attendance_view')
      .select('*')
      .eq('staff_id', t.staff_id)
      .gte('work_date', t.start_date)
      .lte('work_date', t.end_date)
      .order('clock_in_at'),
  )
