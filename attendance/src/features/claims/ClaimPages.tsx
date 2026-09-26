import { useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { Layout } from '../../components/Layout'
import { Empty, Field, Loading, Notice, StatusChip, money, useLoad, useToast } from '../../components/ui'
import { FilePicker } from '../../components/FilePicker'
import { useAuth } from '../../auth/AuthProvider'
import { formatDate, formatDateRange, formatDateTime } from '../../lib/dates'
import { friendlyError } from '../../lib/errors'
import type { PickedFile } from '../../lib/files'
import { CATEGORY_LABEL, CLAIM_CATEGORIES, type Claim, type ClaimCategory, type ClaimItem } from '../../lib/types'
import { useOnline, useOutbox } from '../../offline/useSync'
import { getSettings } from '../admin/api'
import { myTrips } from '../trips/api'
import {
  deleteClaimDraft, getClaim, getClaimItems, myClaims, saveClaimDraft, submitClaim, unsyncedClaimDrafts,
  type ClaimDraft, type ItemDraft,
} from './api'

export function ClaimListPage() {
  const { staff } = useAuth()
  const ops = useOutbox()
  const list = useLoad(() => myClaims(staff!.id), [staff!.id, ops.length])
  const local = useLoad(unsyncedClaimDrafts, [ops.length])
  const localIds = new Set((local.data ?? []).map((d) => d.id))
  const rows = (list.data?.data ?? []).filter((c) => !localIds.has(c.id))
  return (
    <Layout title="My claims" back="/requests">
      <Link to="/claims/new" className="btn" style={{ marginBottom: 14 }}>
        + New claim
      </Link>
      {list.data?.fromCache && <Notice kind="warn">Offline: showing the last saved copy.</Notice>}
      {list.loading && !list.data && <Loading />}
      {(local.data ?? []).map((d) => (
        <Link key={d.id} to={`/claims/${d.id}/edit`} className="list-item">
          <div className="row between">
            <div className="title">{d.notes || 'Claim draft'}</div>
            <span className="chip pending">Draft · waiting to sync</span>
          </div>
          <div className="muted">{d.items.length} item(s)</div>
        </Link>
      ))}
      {rows.map((c) => <ClaimRow key={c.id} c={c} />)}
      {!list.loading && rows.length === 0 && !local.data?.length && <Empty>No claims yet.</Empty>}
    </Layout>
  )
}

export function ClaimRow({ c, showName }: { c: Claim; showName?: boolean }) {
  return (
    <Link to={c.status === 'draft' ? `/claims/${c.id}/edit` : `/claims/${c.id}`} className="list-item">
      <div className="row between top">
        <div className="grow">
          <div className="title">{showName ? c.full_name : c.destination}</div>
          <div className="muted">
            {showName ? `${c.destination} · ` : ''}
            {c.item_count} item{c.item_count === 1 ? '' : 's'}
            {c.notes ? ` · ${c.notes}` : ''}
          </div>
        </div>
        <div className="stack right">
          <div className="title nowrap">{money(c.total_amount)}</div>
          <StatusChip status={c.status} />
        </div>
      </div>
    </Link>
  )
}

const newItem = (date = ''): ItemDraft => ({
  id: crypto.randomUUID(), item_date: date, category: '', description: '', distance_km: '', amount: '', receipt_path: null,
})

export function ClaimFormPage() {
  const { id } = useParams()
  const isNew = !id
  const [params] = useSearchParams()
  const { staff } = useAuth()
  const navigate = useNavigate()
  const toast = useToast()
  const online = useOnline()
  const trips = useLoad(() => myTrips(staff!.id), [staff!.id])
  const settings = useLoad(getSettings, [])
  const [newId] = useState(() => crypto.randomUUID())
  const existing = useLoad(async (): Promise<ClaimDraft | null> => {
    if (isNew) return null
    const local = (await unsyncedClaimDrafts()).find((d) => d.id === id)
    if (local) return local
    const [c, items] = await Promise.all([getClaim(id!), getClaimItems(id!)])
    if (!c) return null
    return {
      id: c.id, trip_id: c.trip_id, notes: c.notes ?? '',
      items: items.map((i) => ({
        id: i.id, item_date: i.item_date, category: i.category, description: i.description,
        distance_km: i.distance_km?.toString() ?? '', amount: i.amount.toString(), receipt_path: i.receipt_path,
      })),
    }
  }, [id])
  const [form, setForm] = useState<ClaimDraft | null>(null)
  const [receipts, setReceipts] = useState(new Map<string, PickedFile>())
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const approved = (trips.data?.data ?? []).filter((t) => t.status === 'approved')
  const d: ClaimDraft | null =
    form ?? existing.data ?? (isNew ? { id: newId, trip_id: params.get('trip') ?? '', notes: '', items: [newItem()] } : null)
  if (!d) return <Layout title="Claim" back="/claims">{existing.loading ? <Loading /> : <Notice kind="error">Not found</Notice>}</Layout>

  const rate = Number(settings.data?.mileage_rate_per_km ?? 0)
  const trip = approved.find((t) => t.id === d.trip_id)
  const amountOf = (it: ItemDraft) =>
    it.category === 'mileage' ? Math.round(Number(it.distance_km || 0) * rate * 100) / 100 : Number(it.amount || 0)
  const total = d.items.reduce((s, it) => s + amountOf(it), 0)
  const setItem = (i: number, patch: Partial<ItemDraft>) =>
    setForm({ ...d, items: d.items.map((it, k) => (k === i ? { ...it, ...patch } : it)) })

  function validate(): string {
    if (!d!.trip_id) return 'Please choose the outstation trip this claim is for.'
    if (d!.items.length === 0) return 'Please add at least one item.'
    for (const [i, it] of d!.items.entries()) {
      const n = `Item ${i + 1}`
      if (!it.item_date) return `${n}: please enter the date.`
      if (!it.category) return `${n}: please choose a category.`
      if (!it.description.trim()) return `${n}: please enter a description.`
      if (it.category === 'mileage' && !(Number(it.distance_km) > 0)) return `${n}: please enter the kilometres travelled.`
      if (it.category !== 'mileage' && !(Number(it.amount) > 0)) return `${n}: please enter the amount in RM.`
    }
    return ''
  }

  async function save(submit: boolean) {
    const v = validate()
    if (v) return setError(v)
    setError('')
    setBusy(true)
    try {
      const { synced } = await saveClaimDraft(staff!.id, d!, receipts)
      if (!submit) {
        toast(synced ? 'Draft saved' : 'Draft saved on this phone. It will sync when you are online.')
        navigate('/claims', { replace: true })
        return
      }
      if (!synced) throw new Error('Could not reach the server. Your draft is saved; submit it when you are back online.')
      await submitClaim(d!.id)
      toast('Claim submitted')
      navigate(`/claims/${d!.id}`, { replace: true })
    } catch (e) {
      setError(friendlyError(e))
    } finally {
      setBusy(false)
    }
  }

  async function discard() {
    if (!confirm('Delete this draft claim?')) return
    try {
      if (!isNew) await deleteClaimDraft(d!.id)
      navigate('/claims', { replace: true })
    } catch (e) {
      setError(friendlyError(e))
    }
  }

  return (
    <Layout title={isNew ? 'New claim' : 'Edit claim draft'} back="/claims">
      <div className="card">
        <Field label="Outstation trip" required htmlFor="trip" hint="Claims can only be made for approved trips.">
          <select id="trip" value={d.trip_id} onChange={(e) => setForm({ ...d, trip_id: e.target.value })}>
            <option value="">Choose a trip…</option>
            {approved.map((t) => (
              <option key={t.id} value={t.id}>
                {t.destination} ({formatDateRange(t.start_date, t.end_date)})
              </option>
            ))}
          </select>
        </Field>
        {approved.length === 0 && !trips.loading && (
          <Notice kind="warn">You have no approved trips yet. Request a trip first, then claim after it is approved.</Notice>
        )}
        <Field label="Notes" htmlFor="notes" hint="Optional">
          <input id="notes" type="text" value={d.notes} onChange={(e) => setForm({ ...d, notes: e.target.value })} />
        </Field>
      </div>

      {d.items.map((it, i) => (
        <div className="card" key={it.id} data-testid="claim-item">
          <div className="row between">
            <h3 style={{ margin: 0 }}>Item {i + 1}</h3>
            {d.items.length > 1 && (
              <button className="btn small ghost" onClick={() => setForm({ ...d, items: d.items.filter((_, k) => k !== i) })}>
                Remove
              </button>
            )}
          </div>
          <div className="btn-row" style={{ marginTop: 10 }}>
            <Field label="Date" required htmlFor={`date-${i}`}>
              <input id={`date-${i}`} type="date" value={it.item_date} min={trip?.start_date} max={trip?.end_date}
                onChange={(e) => setItem(i, { item_date: e.target.value })} />
            </Field>
            <Field label="Category" required htmlFor={`cat-${i}`}>
              <select id={`cat-${i}`} value={it.category} onChange={(e) => setItem(i, { category: e.target.value as ClaimCategory })}>
                <option value="">Choose…</option>
                {CLAIM_CATEGORIES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
              </select>
            </Field>
          </div>
          {trip && it.item_date && (it.item_date < trip.start_date || it.item_date > trip.end_date) && (
            <Notice kind="warn">This date is outside the trip dates.</Notice>
          )}
          <Field label="Description" required htmlFor={`desc-${i}`}>
            <input id={`desc-${i}`} type="text" value={it.description} onChange={(e) => setItem(i, { description: e.target.value })}
              placeholder={it.category === 'mileage' ? 'e.g. Bangi to Kuantan and return' : ''} />
          </Field>
          {it.category === 'mileage' ? (
            <Field label="Kilometres" required htmlFor={`km-${i}`} hint={`Rate: ${money(rate)} per km (set by HR)`}>
              <input id={`km-${i}`} type="number" inputMode="decimal" min="0" step="0.1" value={it.distance_km}
                onChange={(e) => setItem(i, { distance_km: e.target.value })} />
            </Field>
          ) : (
            <Field label="Amount (RM)" required htmlFor={`amt-${i}`}>
              <input id={`amt-${i}`} type="number" inputMode="decimal" min="0" step="0.01" value={it.amount}
                onChange={(e) => setItem(i, { amount: e.target.value })} />
            </Field>
          )}
          {it.category === 'mileage' && (
            <p className="title" data-testid="mileage-amount">Amount: {money(amountOf(it))}</p>
          )}
          <FilePicker
            label={it.category === 'mileage' ? 'Receipt photo (optional for mileage)' : 'Receipt photo'}
            picked={receipts.get(it.id) ?? null}
            existingPath={it.receipt_path}
            onRemoveExisting={() => setItem(i, { receipt_path: null })}
            onPick={(f) => {
              const m = new Map(receipts)
              if (f) m.set(it.id, f)
              else m.delete(it.id)
              setReceipts(m)
            }}
          />
        </div>
      ))}
      <button className="btn secondary" style={{ marginBottom: 14 }}
        onClick={() => setForm({ ...d, items: [...d.items, newItem(d.items[d.items.length - 1]?.item_date ?? '')] })}>
        + Add another item
      </button>

      <div className="card row between">
        <span className="title">Claim total</span>
        <span className="big-number" data-testid="claim-total">{money(total)}</span>
      </div>
      <Notice kind="error">{error}</Notice>
      {!online && <Notice kind="warn">You are offline. Save a draft now and submit it when you are back online.</Notice>}
      <div className="stack">
        <button className="btn" disabled={busy || !online} onClick={() => void save(true)}>Submit claim</button>
        <button className="btn secondary" disabled={busy} onClick={() => void save(false)}>Save draft</button>
        {!isNew && <button className="btn ghost" disabled={busy} onClick={() => void discard()}>Delete draft</button>}
      </div>
    </Layout>
  )
}

export function ClaimItemsList({ items }: { items: ClaimItem[] }) {
  return (
    <>
      {items.map((i) => (
        <div key={i.id} className="card tight">
          <div className="row between top">
            <div className="grow">
              <div className="title">{CATEGORY_LABEL[i.category]}</div>
              <div>{i.description}</div>
              <div className="muted">
                {formatDate(i.item_date)}
                {i.category === 'mileage' && ` · ${i.distance_km} km × ${money(i.rate_per_km)}`}
              </div>
            </div>
            <div className="title nowrap">{money(i.amount)}</div>
          </div>
          {i.receipt_path ? (
            <FilePicker label="" existingPath={i.receipt_path} picked={null} onPick={() => {}} />
          ) : (
            i.category !== 'mileage' && <span className="chip pending">No receipt</span>
          )}
        </div>
      ))}
    </>
  )
}

export function ClaimSummary({ c }: { c: Claim }) {
  return (
    <dl className="kv">
      <dt>Trip</dt><dd><Link to={`/trips/${c.trip_id}`}>{c.destination}</Link> ({formatDateRange(c.trip_start!, c.trip_end!)})</dd>
      {c.notes && (<><dt>Notes</dt><dd>{c.notes}</dd></>)}
      <dt>Status</dt><dd><StatusChip status={c.status} /></dd>
      {c.submitted_at && (<><dt>Submitted</dt><dd>{formatDateTime(c.submitted_at)}</dd></>)}
      <dt>Approver</dt><dd>{c.approver_name ?? 'HR/Admin'}</dd>
      {c.decided_at && (<><dt>Decided</dt><dd>{formatDateTime(c.decided_at)}{c.decided_by_name ? ` by ${c.decided_by_name}` : ''}</dd></>)}
      {c.decision_comment && (<><dt>Comment</dt><dd>{c.decision_comment}</dd></>)}
      {c.paid_at && (<><dt>Paid</dt><dd>{formatDateTime(c.paid_at)}{c.payment_ref ? ` · Ref ${c.payment_ref}` : ''}</dd></>)}
    </dl>
  )
}

export function ClaimDetailPage() {
  const { id } = useParams()
  const { staff } = useAuth()
  const claim = useLoad(() => getClaim(id!), [id])
  const items = useLoad(() => getClaimItems(id!), [id])
  const c = claim.data
  if (claim.loading && !c) return <Layout title="Claim" back="/claims"><Loading /></Layout>
  if (!c) return <Layout title="Claim" back="/claims"><Notice kind="error">Claim not found.</Notice></Layout>
  const mine = c.staff_id === staff!.id
  return (
    <Layout title={mine ? 'My claim' : c.full_name ?? 'Claim'} back={mine ? '/claims' : true}>
      <div className="card"><ClaimSummary c={c} /></div>
      <ClaimItemsList items={items.data ?? []} />
      <div className="card row between">
        <span className="title">Total</span>
        <span className="big-number">{money(c.total_amount)}</span>
      </div>
    </Layout>
  )
}
