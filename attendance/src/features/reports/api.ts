import { supabase } from '../../lib/supabase'
import { q } from '../../offline/outbox'

export interface MonthlyRow {
  staff_id: string
  full_name: string
  staff_no: string | null
  days_worked: number
  office_days: number
  wfh_days: number
  client_site_days: number
  outstation_days: number
  training_days: number
  total_hours: number
  overtime_hours_approved: number
  overtime_hours_pending: number
  off_day_days: number
  off_day_hours: number
  public_holiday_days: number
  public_holiday_hours: number
  leave_days_total: number
  leave_by_type: Record<string, number>
  missed_clockouts: number
  no_record_days: number
  pending_reviews: number
}

export interface DailyRow {
  staff_id: string
  full_name: string
  work_date: string
  day_type: 'working_day' | 'off_day' | 'public_holiday'
  holiday_name: string | null
  leave_type: string | null
  leave_portion: string | null
  entries: number
  modes: string[]
  first_in: string | null
  last_out: string | null
  hours: number
  overtime_hours: number
  overtime_status: string | null
  flags: string[]
  no_record: boolean
}

export interface ClaimsRow {
  claim_id: string
  full_name: string
  staff_no: string | null
  destination: string
  trip_start: string
  trip_end: string
  status: string
  submitted_at: string
  decided_at: string | null
  paid_at: string | null
  payment_ref: string | null
  mileage_km: number
  mileage: number
  meals: number
  toll: number
  parking: number
  accommodation: number
  other: number
  total: number
}

const num = <T extends object>(rows: T[]) =>
  rows.map((r) =>
    Object.fromEntries(Object.entries(r).map(([k, v]) => [k, typeof v === 'string' && /^-?\d+(\.\d+)?$/.test(v) && k !== 'staff_no' ? Number(v) : v])),
  ) as T[]

export const monthlyReport = (month: string, staffId?: string) =>
  q<MonthlyRow[]>(supabase.rpc('attendance_monthly_report', { p_month: month, p_staff: staffId ?? null })).then(num)

export const dailyReport = (month: string, staffId: string) =>
  q<DailyRow[]>(supabase.rpc('attendance_daily_report', { p_month: month, p_staff: staffId })).then(num)

export const claimsReport = (month: string) => q<ClaimsRow[]>(supabase.rpc('claims_monthly_report', { p_month: month })).then(num)
