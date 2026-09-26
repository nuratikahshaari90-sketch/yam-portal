import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { Layout } from '../../components/Layout'
import { Empty, Field, Loading, Notice, StatusChip, useLoad, useToast } from '../../components/ui'
import { FilePicker } from '../../components/FilePicker'
import { useAuth } from '../../auth/AuthProvider'
import { formatDate, formatDateRange, formatDateTime, todayKL } from '../../lib/dates'
import { leaveDaysTaken, type DayPortion } from '../../lib/workdays'
import { friendlyError } from '../../lib/errors'
import type { PickedFile } from '../../lib/files'
import type { LeaveRequest } from '../../lib/types'
import { useOnline, useOutbox } from '../../offline/useSync'
import { myCalendar } from '../clock/api'
import { cancelLeave, getLeave, leaveTypes, myLeave, saveLeaveDraft, submitLeave, unsyncedLeaveDrafts, type LeaveDraft } from './api'

const PORTION_LABEL: Record<DayPortion, string> = { full: 'Full day', half_am: 'Half day (morning)', half_pm: 'Half day (afternoon)' }
const days = (n: number) => `${n} working day${n === 1 ? '' : 's'}`

export function LeaveListPage() {
  const { staff } = useAuth()
  const ops = useOutbox()
  const list = useLoad(() => myLeave(staff!.id), [staff!.id, ops.length])
  const local = useLoad(unsyncedLeaveDrafts, [ops.length])
  const types = useLoad(leaveTypes, [])
  const typeName = (c: string) => types.data?.find((t) => t.code === c)?.name ?? c
  const localIds = new Set((local.data ?? []).map((d) => d.id))
  const rows = (list.data?.data ?? []).filter((r) => !localIds.has(r.id))

  return (
    <Layout title="My leave" back="/requests">
      <Link to="/leave/new" className="btn" style={{ marginBottom: 14 }}>
        + Apply for leave
      </Link>
      {list.data?.fromCache && <Notice kind="warn">Offline: showing the last saved copy.</Notice>}
      {list.loading && !list.data && <Loading />}
      {(local.data ?? []).map((d) => (
        <Link key={d.id} to={`/leave/${d.id}/edit`} className="list-item">
          <div className="row between">
            <div className="title">{typeName(d.leave_type)}</div>
            <span className="chip pending">Draft · waiting to sync</span>
          </div>
          <div className="muted">{formatDateRange(d.start_date, d.end_date)}</div>
        </Link>
      ))}
      {rows.map((r) => (
        <Link key={r.id} to={r.status === 'draft' ? `/leave/${r.id}/edit` : `/leave/${r.id}`} className="list-item">
          <div className="row between">
            <div className="title">{r.leave_type_name}</div>
            <StatusChip status={r.status} />
          </div>
          <div className="muted">
            {formatDateRange(r.start_date, r.end_date)}
            {r.day_portion !== 'full' && ` · ${PORTION_LABEL[r.day_portion]}`} · {days(Number(r.working_days))}
          </div>
        </Link>
      ))}
      {!list.loading && rows.length === 0 && !local.data?.length && <Empty>No leave requests yet.</Empty>}
    </Layout>
  )
}

export function LeaveFormPage() {
  const { id } = useParams()
  const isNew = !id
  const { staff } = useAuth()
  const navigate = useNavigate()
  const toast = useToast()
  const online = useOnline()
  const types = useLoad(leaveTypes, [])
  const cal = useLoad(() => myCalendar(staff!.id), [staff!.id])
  const existing = useLoad(async (): Promise<LeaveDraft | null> => {
    if (isNew) return null
    const local = (await unsyncedLeaveDrafts()).find((d) => d.id === id)
    if (local) return local
    const r = await getLeave(id!)
    return r ? { id: r.id, leave_type: r.leave_type, start_date: r.start_date, end_date: r.end_date, day_portion: r.day_portion, reason: r.reason ?? '', document_path: r.document_path } : null
  }, [id])

  const [form, setForm] = useState<LeaveDraft | null>(null)
  const [file, setFile] = useState<PickedFile | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [newId] = useState(() => crypto.randomUUID())

  const blank: LeaveDraft = { id: newId, leave_type: '', start_date: todayKL(), end_date: todayKL(), day_portion: 'full', reason: '', document_path: null }
  const d = form ?? existing.data ?? (isNew ? blank : null)
  if (!d) return <Layout title="Leave" back="/leave">{existing.loading ? <Loading /> : <Notice kind="error">Not found</Notice>}</Layout>
  const set = <K extends keyof LeaveDraft>(k: K, v: LeaveDraft[K]) => {
    const next = { ...d, [k]: v }
    if (k === 'start_date' && next.end_date < (v as string)) next.end_date = v as string
    if (next.start_date !== next.end_date) next.day_portion = 'full'
    setForm(next)
  }

  const holidays = new Set((cal.data?.holidays ?? []).map((h) => h.holiday_date))
  const preview = cal.data && d.start_date && d.end_date && d.end_date >= d.start_date
    ? leaveDaysTaken(cal.data.schedules, holidays, d.start_date, d.end_date, d.day_portion)
    : null
  const type = types.data?.find((t) => t.code === d.leave_type)

  function validate(): string {
    if (!d!.leave_type) return 'Please choose a leave type.'
    if (!d!.start_date || !d!.end_date) return 'Please choose the start and end dates.'
    if (d!.end_date < d!.start_date) return 'The end date cannot be before the start date.'
    return ''
  }

  async function save(submit: boolean) {
    const v = validate()
    if (v) return setError(v)
    setError('')
    setBusy(true)
    try {
      const { synced } = await saveLeaveDraft(staff!.id, { ...d!, reason: d!.reason.trim() }, file)
      if (!submit) {
        toast(synced ? 'Draft saved' : 'Draft saved on this phone. It will sync when you are online.')
        navigate('/leave', { replace: true })
        return
      }
      if (!synced) throw new Error('Could not reach the server. Your draft is saved; submit it when you are back online.')
      await submitLeave(d!.id)
      toast('Leave submitted for approval')
      navigate(`/leave/${d!.id}`, { replace: true })
    } catch (e) {
      setError(friendlyError(e))
    } finally {
      setBusy(false)
    }
  }

  async function discard() {
    if (!confirm('Delete this draft?')) return
    try {
      if (!isNew) await cancelLeave(d!.id)
      navigate('/leave', { replace: true })
    } catch (e) {
      setError(friendlyError(e))
    }
  }

  return (
    <Layout title={isNew ? 'Apply for leave' : 'Edit leave draft'} back="/leave">
      <div className="card">
        <Field label="Leave type" required htmlFor="lt">
          <select id="lt" value={d.leave_type} onChange={(e) => set('leave_type', e.target.value)}>
            <option value="">Choose…</option>
            {types.data?.map((t) => (
              <option key={t.code} value={t.code}>
                {t.name}
              </option>
            ))}
          </select>
        </Field>
        <div className="btn-row">
          <Field label="Start date" required htmlFor="sd">
            <input id="sd" type="date" value={d.start_date} onChange={(e) => set('start_date', e.target.value)} />
          </Field>
          <Field label="End date" required htmlFor="ed">
            <input id="ed" type="date" value={d.end_date} min={d.start_date} onChange={(e) => set('end_date', e.target.value)} />
          </Field>
        </div>
        {d.start_date === d.end_date && (
          <Field label="Full or half day" htmlFor="portion">
            <select id="portion" value={d.day_portion} onChange={(e) => set('day_portion', e.target.value as DayPortion)}>
              {Object.entries(PORTION_LABEL).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
          </Field>
        )}
        {preview !== null && (
          <Notice kind={preview === 0 ? 'warn' : 'info'}>
            {preview === 0
              ? 'These dates are all off days or public holidays on your schedule, so no leave is needed.'
              : <>This will use <b>{days(preview)}</b> (your off days and public holidays are not counted).</>}
          </Notice>
        )}
        <Field label="Reason" htmlFor="reason">
          <textarea id="reason" value={d.reason} onChange={(e) => set('reason', e.target.value)} />
        </Field>
        <FilePicker
          label="Supporting document (optional)"
          hint={type?.document_hint ?? 'For example a medical certificate.'}
          picked={file}
          onPick={setFile}
          existingPath={d.document_path}
          onRemoveExisting={() => set('document_path', null)}
        />
        <Notice kind="error">{error}</Notice>
        {!online && <Notice kind="warn">You are offline. You can save a draft now and submit it when you are back online.</Notice>}
        <div className="stack">
          <button className="btn" disabled={busy || !online} onClick={() => void save(true)}>
            Submit for approval
          </button>
          <button className="btn secondary" disabled={busy} onClick={() => void save(false)}>
            Save draft
          </button>
          {!isNew && (
            <button className="btn ghost" disabled={busy} onClick={() => void discard()}>
              Delete draft
            </button>
          )}
        </div>
      </div>
    </Layout>
  )
}

export function LeaveDecisionInfo({ r }: { r: Pick<LeaveRequest, 'status' | 'approver_name' | 'decided_at' | 'decision_comment' | 'submitted_at'> & { decided_by_name?: string | null } }) {
  return (
    <dl className="kv">
      <dt>Status</dt>
      <dd><StatusChip status={r.status} /></dd>
      {r.submitted_at && (<><dt>Submitted</dt><dd>{formatDateTime(r.submitted_at)}</dd></>)}
      <dt>Approver</dt>
      <dd>{r.approver_name ?? 'HR/Admin'}</dd>
      {r.decided_at && (<><dt>Decided</dt><dd>{formatDateTime(r.decided_at)}{r.decided_by_name ? ` by ${r.decided_by_name}` : ''}</dd></>)}
      {r.decision_comment && (<><dt>Comment</dt><dd>{r.decision_comment}</dd></>)}
    </dl>
  )
}

export function LeaveDetailPage() {
  const { id } = useParams()
  const { staff } = useAuth()
  const toast = useToast()
  const { data: r, loading, reload } = useLoad(() => getLeave(id!), [id])
  const [error, setError] = useState('')
  if (loading && !r) return <Layout title="Leave" back="/leave"><Loading /></Layout>
  if (!r) return <Layout title="Leave" back="/leave"><Notice kind="error">Leave request not found.</Notice></Layout>
  const mine = r.staff_id === staff!.id

  async function withdraw() {
    if (!confirm('Withdraw this leave request?')) return
    try {
      await cancelLeave(r!.id)
      toast('Leave request withdrawn')
      reload()
    } catch (e) {
      setError(friendlyError(e))
    }
  }

  return (
    <Layout title={r.leave_type_name ?? 'Leave'} back={mine ? '/leave' : true}>
      <div className="card">
        {!mine && <h2>{r.full_name}</h2>}
        <dl className="kv">
          <dt>Type</dt><dd>{r.leave_type_name}</dd>
          <dt>Dates</dt><dd>{r.start_date === r.end_date ? formatDate(r.start_date) : `${formatDate(r.start_date)} to ${formatDate(r.end_date)}`}</dd>
          <dt>Portion</dt><dd>{PORTION_LABEL[r.day_portion]}</dd>
          <dt>Days taken</dt><dd>{days(Number(r.working_days))}</dd>
          {r.reason && (<><dt>Reason</dt><dd>{r.reason}</dd></>)}
        </dl>
        {r.document_path && <FilePicker label="" existingPath={r.document_path} picked={null} onPick={() => {}} />}
        <hr />
        <LeaveDecisionInfo r={r} />
      </div>
      <Notice kind="error">{error}</Notice>
      {mine && r.status === 'pending' && (
        <button className="btn secondary" onClick={() => void withdraw()}>
          Withdraw request
        </button>
      )}
    </Layout>
  )
}
