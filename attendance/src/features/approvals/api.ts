import { supabase } from '../../lib/supabase'

export async function pendingApprovalCount(): Promise<number> {
  const { count, error } = await supabase.from('pending_approvals').select('id', { count: 'exact', head: true })
  if (error) throw error
  return count ?? 0
}
