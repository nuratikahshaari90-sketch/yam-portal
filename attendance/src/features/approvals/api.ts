import { supabase } from '../../lib/supabase'
import { q } from '../../offline/outbox'
import type { Claim, Flag, Staff } from '../../lib/types'

export type Kind = 'leave' | 'trip' | 'claim' | 'clock'

export interface PendingItem {
  kind: Kind
  id: string
  staff_id: string
  full_name: string
  approver_id: string | null
  approver_name: string | null
  title: string
  detail: string
  note: string | null
  submitted_at: string | null
  flags: Flag[] | null
  amount: number | null
  item_date: string | null
}

export async function pendingApprovalCount(): Promise<number> {
  const { count, error } = await supabase.from('pending_approvals').select('id', { count: 'exact', head: true })
  if (error) throw error
  return count ?? 0
}

export const listPending = () =>
  q<PendingItem[]>(supabase.from('pending_approvals').select('*').order('item_date').order('submitted_at'))

export const decide = (kind: Kind, id: string, action: 'approve' | 'reject' | 'request_changes' | 'paid', comment?: string) =>
  q(supabase.rpc('decide', { p_kind: kind, p_id: id, p_action: action, p_comment: comment ?? null }))

export const reassign = (kind: Kind, id: string, approverId: string | null) =>
  q(supabase.rpc('reassign', { p_kind: kind, p_id: id, p_new_approver: approverId }))

export const listApprovers = () =>
  q<Staff[]>(supabase.from('staff').select('*').eq('active', true).in('role', ['supervisor', 'admin']).order('full_name'))

export const awaitingPayment = () =>
  q<Claim[]>(supabase.from('claims_view').select('*').eq('status', 'approved').order('decided_at'))

export const adjustEntry = (id: string, clockOutAt: string, note: string) =>
  q(supabase.rpc('admin_adjust_entry', { p_id: id, p_clock_in_at: null, p_clock_out_at: clockOutAt, p_note: note }))
