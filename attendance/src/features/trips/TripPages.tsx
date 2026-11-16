import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { Layout } from '../../components/Layout'
import { Empty, Field, Loading, Notice, StatusChip, money, useLoad, useToast } from '../../components/ui'
import { useAuth } from '../../auth/AuthProvider'
import { daysBetween, eachDay, formatDate, formatDateRange, formatDateTime, formatHours, todayKL } from '../../lib/dates'
import { friendlyError } from '../../lib/errors'
import type { Trip } from '../../lib/types'
import { EntryCard } from '../clock/EntryCard'
import { summarise } from '../clock/HistoryScreen'
import { cancelTrip, getTrip, myTrips, saveTrip, submitTrip, tripEntries, type TripInput } from './api'
import { TripClaims } from './tripClaims'

const nights = (t: Pick<Trip, 'start_date' | 'end_date'>) => {
  const n = daysBetween(t.start_date, t.end_date) + 1
  return `${n} day${n === 1 ? '' : 's'}`
}

export function TripListPage() {
  const { staff } = useAuth()
  const { data, loading } = useLoad(() => myTrips(staff!.id), [staff!.id])
  return (
    <Layout title="My outstation trips" back="/requests">
      <Link to="/trips/new" className="btn" style={{ marginBottom: 14 }}>
        + Request a trip
      </Link>
      {data?.fromCache && <Notice kind="warn">Offline: showing the last saved copy.</Notice>}
      {loading && !data && <Loading />}
      {data?.data.map((t) => (
        <Link key={t.id} to={t.status === 'draft' || t.status === 'changes_requested' ? `/trips/${t.id}/edit` : `/trips/${t.id}`} className="list-item">
          <div className="row between top">
            <div className="title grow">{t.destination}</div>
            <StatusChip status={t.status} />
          </div>
          <div className="muted">
            {formatDateRange(t.start_date, t.end_date)} · {nights(t)}
          </div>
        </Link>
      ))}
      {!loading && data?.data.length === 0 && <Empty>No trips yet. Request one before you travel.</Empty>}
    </Layout>
  )
}

export function TripFormPage() {
  const { id } = useParams()
  const isNew = !id
  const navigate = useNavigate()
  const toast = useToast()
  const existing = useLoad(() => (isNew ? Promise.resolve(null) : getTrip(id!)), [id])
  const [form, setForm] = useState<TripInput | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const e = existing.data
  const blank: TripInput = { destination: '', start_date: todayKL(), end_date: todayKL(), purpose: '', estimated_cost: '', estimated_cost_notes: '' }
  const t: TripInput | null =
    form ?? (isNew ? blank : e ? { id: e.id, destination: e.destination, start_date: e.start_date, end_date: e.end_date, purpose: e.purpose, estimated_cost: e.estimated_cost?.toString() ?? '', estimated_cost_notes: e.estimated_cost_notes ?? '' } : null)
  if (!t) return <Layout title="Trip" back="/trips">{existing.loading ? <Loading /> : <Notice kind="error">Not found</Notice>}</Layout>
  const set = <K extends keyof TripInput>(k: K, v: TripInput[K]) => {
    const next = { ...t, [k]: v }
    if (k === 'start_date' && next.end_date < (v as string)) next.end_date = v as string
    setForm(next)
  }

  async function save(submit: boolean) {
    setError('')
    if (!t!.destination.trim()) return setError('Please enter the destination.')
    if (!t!.purpose.trim()) return setError('Please enter the purpose of the trip.')
    setBusy(true)
    try {
      const saved = await saveTrip(t!)
      if (submit) {
        await submitTrip(saved.id)
        toast('Trip request submitted')
        navigate(`/trips/${saved.id}`, { replace: true })
      } else {
        toast('Draft saved')
        navigate('/trips', { replace: true })
      }
    } catch (err) {
      setError(friendlyError(err))
    } finally {
      setBusy(false)
    }
  }

  async function discard() {
    if (!confirm(e?.status === 'draft' ? 'Delete this draft?' : 'Withdraw this trip request?')) return
    try {
      await cancelTrip(id!)
      navigate('/trips', { replace: true })
    } catch (err) {
      setError(friendlyError(err))
    }
  }

  return (
    <Layout title={isNew ? 'Request a trip' : 'Edit trip request'} back="/trips">
      {e?.status === 'changes_requested' && (
        <Notice kind="warn">
          <b>Changes requested{e.decided_by_name ? ` by ${e.decided_by_name}` : ''}:</b> {e.decision_comment}
        </Notice>
      )}
      <div className="card">
        <Field label="Destination" required htmlFor="dest" hint='For example "Kuantan, Pahang"'>
          <input id="dest" type="text" value={t.destination} onChange={(ev) => set('destination', ev.target.value)} />
        </Field>
        <div className="btn-row">
          <Field label="Start date" required htmlFor="sd">
            <input id="sd" type="date" value={t.start_date} onChange={(ev) => set('start_date', ev.target.value)} />
          </Field>
          <Field label="End date" required htmlFor="ed">
            <input id="ed" type="date" value={t.end_date} min={t.start_date} onChange={(ev) => set('end_date', ev.target.value)} />
          </Field>
        </div>
        <Field label="Purpose" required htmlFor="purpose">
          <textarea id="purpose" value={t.purpose} onChange={(ev) => set('purpose', ev.target.value)} />
        </Field>
        <Field label="Estimated cost (RM)" htmlFor="cost" hint="Optional">
          <input id="cost" type="number" inputMode="decimal" min="0" step="0.01" value={t.estimated_cost} onChange={(ev) => set('estimated_cost', ev.target.value)} />
        </Field>
        <Field label="Cost breakdown" htmlFor="costnotes" hint="Optional, e.g. mileage, hotel, meals">
          <textarea id="costnotes" value={t.estimated_cost_notes} onChange={(ev) => set('estimated_cost_notes', ev.target.value)} />
        </Field>
        <Notice kind="error">{error}</Notice>
        <div className="stack">
          <button className="btn" disabled={busy} onClick={() => void save(true)}>
            {e?.status === 'changes_requested' ? 'Resubmit for approval' : 'Submit for approval'}
          </button>
          <button className="btn secondary" disabled={busy} onClick={() => void save(false)}>
            Save draft
          </button>
          {!isNew && (
            <button className="btn ghost" disabled={busy} onClick={() => void discard()}>
              {e?.status === 'draft' ? 'Delete draft' : 'Withdraw request'}
            </button>
          )}
        </div>
      </div>
    </Layout>
  )
}

export function TripDetailPage() {
  const { id } = useParams()
  const { staff } = useAuth()
  const toast = useToast()
  const trip = useLoad(() => getTrip(id!), [id])
  const entries = useLoad(() => (trip.data ? tripEntries(trip.data) : Promise.resolve([])), [trip.data?.id])
  const [error, setError] = useState('')
  const t = trip.data
  if (trip.loading && !t) return <Layout title="Trip" back="/trips"><Loading /></Layout>
  if (!t) return <Layout title="Trip" back="/trips"><Notice kind="error">Trip not found.</Notice></Layout>
  const mine = t.staff_id === staff!.id
  const list = entries.data ?? []
  const sum = summarise(list)

  async function withdraw() {
    if (!confirm('Withdraw this trip request?')) return
    try {
      await cancelTrip(t!.id)
      toast('Trip withdrawn')
      trip.reload()
    } catch (e) {
      setError(friendlyError(e))
    }
  }

  return (
    <Layout title={t.destination} back={mine ? '/trips' : true}>
      <div className="card">
        {!mine && <h2>{t.full_name}</h2>}
        <dl className="kv">
          <dt>Dates</dt><dd>{formatDateRange(t.start_date, t.end_date)} ({nights(t)})</dd>
          <dt>Purpose</dt><dd>{t.purpose}</dd>
          <dt>Estimated</dt><dd>{t.estimated_cost != null ? money(t.estimated_cost) : '—'}{t.estimated_cost_notes ? ` · ${t.estimated_cost_notes}` : ''}</dd>
          <dt>Status</dt><dd><StatusChip status={t.status} /></dd>
          <dt>Approver</dt><dd>{t.approver_name ?? 'HR/Admin'}</dd>
          {t.decided_at && (<><dt>Decided</dt><dd>{formatDateTime(t.decided_at)}{t.decided_by_name ? ` by ${t.decided_by_name}` : ''}</dd></>)}
          {t.decision_comment && (<><dt>Comment</dt><dd>{t.decision_comment}</dd></>)}
        </dl>
      </div>
      <Notice kind="error">{error}</Notice>
      {mine && t.status === 'pending' && (
        <button className="btn secondary" style={{ marginBottom: 14 }} onClick={() => void withdraw()}>
          Withdraw request
        </button>
      )}
      {t.status === 'approved' && <TripClaims trip={t} mine={mine} />}

      <h2 style={{ marginTop: 18 }}>Attendance during this trip</h2>
      <div className="stat-grid">
        <div className="stat"><div className="v">{sum.daysWorked}</div><div className="l">Days worked</div></div>
        <div className="stat"><div className="v">{formatHours(sum.hours)}</div><div className="l">Total hours</div></div>
      </div>
      {entries.loading && <Loading />}
      {eachDay(t.start_date, t.end_date).map((d) => {
        const day = list.filter((e) => e.work_date === d)
        return (
          <section key={d}>
            <div className="section-title">{formatDate(d)}</div>
            {day.length ? day.map((e) => <EntryCard key={e.id} e={e} />) : <p className="muted">No clock-in</p>}
          </section>
        )
      })}
    </Layout>
  )
}
