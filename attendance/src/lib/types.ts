import type { DayType, DayPortion } from './workdays'

export type Role = 'staff' | 'supervisor' | 'admin'

export interface Staff {
  id: string
  user_id: string | null
  email: string
  full_name: string
  staff_no: string | null
  job_title: string | null
  role: Role
  supervisor_id: string | null
  active: boolean
  created_at: string
}

export interface WorkSchedule {
  id: string
  staff_id: string
  effective_from: string
  working_days: number[]
  note: string | null
  created_at: string
}

export interface Holiday {
  id: string
  holiday_date: string
  name: string
}

export type Route = 'supervisor' | 'hr'

export interface Settings {
  missed_clockout_time: string
  max_daily_hours: number
  overtime_threshold_hours: number
  break_minutes: number
  overtime_min_minutes: number
  mileage_rate_per_km: number
  route_leave: Route
  route_trip: Route
  route_claim: Route
  route_clock: Route
}

export type WorkMode = 'office' | 'wfh' | 'client_site' | 'outstation' | 'training'

export const WORK_MODES: { value: WorkMode; label: string }[] = [
  { value: 'office', label: 'Office' },
  { value: 'wfh', label: 'Work From Home' },
  { value: 'client_site', label: 'Client Site' },
  { value: 'outstation', label: 'Outstation' },
  { value: 'training', label: 'Training' },
]
export const WORK_MODE_LABEL: Record<WorkMode, string> = Object.fromEntries(
  WORK_MODES.map((m) => [m.value, m.label]),
) as Record<WorkMode, string>

export type Flag =
  | 'off_day'
  | 'public_holiday'
  | 'outstation_no_trip'
  | 'offline'
  | 'missed_clockout'
  | 'over_limit'
  | 'overtime'
  | 'sync_conflict'

export const FLAG_LABEL: Record<Flag, string> = {
  off_day: 'Work on Off Day',
  public_holiday: 'Work on Public Holiday',
  outstation_no_trip: 'Outstation, no approved trip',
  offline: 'Recorded offline',
  missed_clockout: 'Missed clock-out',
  over_limit: 'Over daily hour limit',
  overtime: 'Overtime',
  sync_conflict: 'Sync conflict',
}

export interface AttendanceEntry {
  id: string
  staff_id: string
  full_name?: string
  work_date: string
  work_mode: WorkMode
  location: string
  purpose: string
  trip_id: string | null
  day_type: DayType
  holiday_name: string | null
  clock_in_at: string
  clock_in_server_at: string
  clock_in_device_at: string | null
  clock_in_offline: boolean
  clock_out_at: string | null
  clock_out_server_at: string | null
  clock_out_device_at: string | null
  clock_out_offline: boolean
  clock_out_note: string | null
  clock_out_location: string | null
  conflict_note: string | null
  adjusted_by: string | null
  adjust_note: string | null
  approver_id: string | null
  review_status: 'approved' | 'rejected' | null
  review_comment: string | null
  reviewed_at: string | null
  hours: number | null
  day_hours: number
  day_overtime_hours: number
  flags: Flag[]
  review_state: 'ok' | 'pending' | 'approved' | 'rejected'
}

export type RequestStatus = 'draft' | 'pending' | 'changes_requested' | 'approved' | 'rejected' | 'cancelled'

export const STATUS_LABEL: Record<string, string> = {
  draft: 'Draft',
  pending: 'Pending approval',
  changes_requested: 'Changes requested',
  approved: 'Approved',
  rejected: 'Rejected',
  cancelled: 'Cancelled',
  submitted: 'Submitted',
  paid: 'Paid',
  ok: 'OK',
}

export interface LeaveType {
  code: string
  name: string
  document_hint: string | null
  active: boolean
  sort_order: number
}

export interface LeaveRequest {
  id: string
  staff_id: string
  full_name?: string
  leave_type: string
  leave_type_name?: string
  start_date: string
  end_date: string
  day_portion: DayPortion
  reason: string | null
  document_path: string | null
  working_days: number
  status: RequestStatus
  approver_id: string | null
  approver_name?: string | null
  decided_by_name?: string | null
  submitted_at: string | null
  decided_at: string | null
  decided_by: string | null
  decision_comment: string | null
  created_at: string
}

export interface Trip {
  id: string
  staff_id: string
  full_name?: string
  destination: string
  start_date: string
  end_date: string
  purpose: string
  estimated_cost: number | null
  estimated_cost_notes: string | null
  status: RequestStatus
  approver_id: string | null
  approver_name?: string | null
  decided_by_name?: string | null
  submitted_at: string | null
  decided_at: string | null
  decision_comment: string | null
  created_at: string
  claims_total?: number
}

export type ClaimStatus = 'draft' | 'submitted' | 'approved' | 'rejected' | 'paid'
export type ClaimCategory = 'mileage' | 'meals' | 'toll' | 'parking' | 'accommodation' | 'other'

export const CLAIM_CATEGORIES: { value: ClaimCategory; label: string }[] = [
  { value: 'mileage', label: 'Mileage' },
  { value: 'meals', label: 'Meals' },
  { value: 'toll', label: 'Toll' },
  { value: 'parking', label: 'Parking' },
  { value: 'accommodation', label: 'Accommodation' },
  { value: 'other', label: 'Other' },
]
export const CATEGORY_LABEL = Object.fromEntries(CLAIM_CATEGORIES.map((c) => [c.value, c.label])) as Record<
  ClaimCategory,
  string
>

export interface ClaimItem {
  id: string
  claim_id?: string
  item_date: string
  category: ClaimCategory
  description: string
  distance_km: number | null
  rate_per_km: number | null
  amount: number
  receipt_path: string | null
}

export interface Claim {
  id: string
  staff_id: string
  full_name?: string
  trip_id: string
  destination?: string
  trip_start?: string
  trip_end?: string
  notes: string | null
  status: ClaimStatus
  approver_id: string | null
  submitted_at: string | null
  decided_at: string | null
  decision_comment: string | null
  paid_at: string | null
  payment_ref: string | null
  total_amount: number
  item_count: number
  items_without_receipt: number
  approver_name?: string | null
  decided_by_name?: string | null
  created_at: string
}
