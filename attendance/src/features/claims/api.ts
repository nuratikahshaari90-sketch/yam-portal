import { supabase } from '../../lib/supabase'
import { cached, enqueue, pendingOps, q, syncNow } from '../../offline/outbox'
import { storagePath, type PickedFile } from '../../lib/files'
import type { Claim, ClaimCategory, ClaimItem } from '../../lib/types'

export const myClaims = (staffId: string) =>
  cached('my-claims', () =>
    q<Claim[]>(supabase.from('claims_view').select('*').eq('staff_id', staffId).order('created_at', { ascending: false })),
  )

export const claimsForTrip = (tripId: string) =>
  q<Claim[]>(supabase.from('claims_view').select('*').eq('trip_id', tripId).order('created_at'))

export const getClaim = (id: string) => q<Claim | null>(supabase.from('claims_view').select('*').eq('id', id).maybeSingle())

export const getClaimItems = (id: string) =>
  q<ClaimItem[]>(supabase.from('claim_items').select('*').eq('claim_id', id).order('sort_order'))

export interface ItemDraft {
  id: string
  item_date: string
  category: ClaimCategory | ''
  description: string
  distance_km: string
  amount: string
  receipt_path: string | null
}

export interface ClaimDraft {
  id: string
  trip_id: string
  notes: string
  items: ItemDraft[]
}

export async function unsyncedClaimDrafts(): Promise<ClaimDraft[]> {
  const byId = new Map<string, ClaimDraft>()
  for (const o of await pendingOps('save_claim')) byId.set(o.payload.id as string, o.payload as unknown as ClaimDraft)
  return [...byId.values()]
}

/** Save a draft with its items and any new receipt photos. Works offline. */
export async function saveClaimDraft(staffId: string, d: ClaimDraft, receipts: Map<string, PickedFile>) {
  const files: { id: string; path: string; blob: Blob; contentType: string; name: string }[] = []
  const items = d.items.map((it) => {
    const f = receipts.get(it.id)
    if (!f) return it
    const path = storagePath(staffId, 'receipts', f)
    files.push({ id: f.id, path, blob: f.blob, contentType: f.contentType, name: f.name })
    return { ...it, receipt_path: path }
  })
  const payload = { ...d, items }
  await enqueue('save_claim', `Claim draft (${items.length} item${items.length === 1 ? '' : 's'})`, payload as unknown as Record<string, unknown>, files)
  await syncNow()
  const stillQueued = (await pendingOps('save_claim')).some((o) => o.payload.id === d.id)
  return { synced: !stillQueued, payload }
}

export const submitClaim = (id: string) => q<Claim>(supabase.rpc('submit_claim', { p_id: id }))
export const deleteClaimDraft = (id: string) => q(supabase.rpc('delete_claim_draft', { p_id: id }))
