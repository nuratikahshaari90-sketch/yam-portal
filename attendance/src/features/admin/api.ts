import { supabase } from '../../lib/supabase'
import { q, cached } from '../../offline/outbox'
import type { Holiday, Settings, Staff, WorkSchedule } from '../../lib/types'

export const listStaff = () =>
  q<Staff[]>(supabase.from('staff').select('*').order('full_name'))

export const getStaff = (id: string) => q<Staff>(supabase.from('staff').select('*').eq('id', id).single())

export type StaffInput = Pick<Staff, 'email' | 'full_name' | 'staff_no' | 'job_title' | 'role' | 'supervisor_id' | 'active'>

export const createStaff = (s: StaffInput) => q<Staff>(supabase.from('staff').insert(s).select().single())

export const updateStaff = (id: string, s: Partial<StaffInput>) =>
  q<Staff>(supabase.from('staff').update(s).eq('id', id).select().single())

export const listSchedules = (staffId: string) =>
  q<WorkSchedule[]>(
    supabase.from('work_schedules').select('*').eq('staff_id', staffId).order('effective_from', { ascending: false }),
  )

export const addSchedule = (staffId: string, effective_from: string, working_days: number[], note: string) =>
  q(supabase.from('work_schedules').insert({ staff_id: staffId, effective_from, working_days, note: note || null }))

export const deleteSchedule = (id: string) => q(supabase.from('work_schedules').delete().eq('id', id))

export const listHolidays = (year?: number) => {
  let query = supabase.from('public_holidays').select('*').order('holiday_date')
  if (year) query = query.gte('holiday_date', `${year}-01-01`).lte('holiday_date', `${year}-12-31`)
  return q<Holiday[]>(query)
}

export const addHoliday = (holiday_date: string, name: string) =>
  q(supabase.from('public_holidays').insert({ holiday_date, name }))

export const deleteHoliday = (id: string) => q(supabase.from('public_holidays').delete().eq('id', id))

export const getSettings = () =>
  cached('settings', () => q<Settings>(supabase.from('app_settings').select('*').eq('id', 1).single())).then((r) => r.data)

export const saveSettings = (s: Partial<Settings>) => q(supabase.from('app_settings').update(s).eq('id', 1))

export const ROLE_LABEL = { staff: 'Staff', supervisor: 'Supervisor', admin: 'HR/Admin' } as const
