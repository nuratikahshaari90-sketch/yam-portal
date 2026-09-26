import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Layout } from '../../components/Layout'
import { Empty, Field, Loading, Notice, Segmented, money, useLoad, useToast } from '../../components/ui'
import { useRole } from '../../auth/AuthProvider'
import { formatDateTime, formatHours } from '../../lib/dates'
import { friendlyError } from '../../lib/errors'
import { FlagChips } from '../clock/EntryCard'
import { adjustEntry, awaitingPayment, decide, listApprovers, listPending, reassign, type Kind, type PendingItem } from './api'

type Tab = 'all' | Kind | 'pay'
const KIND_LABEL: Record<Kind, string> = { leave: 'Leave', trip: 'Trip', claim: 'Claim', clock: 'Attendance' }
const DETAIL_LINK: Partial<Record<Kind, string>> = { leave: '/leave/', trip: '/trips/', claim: '/claims/' }

export function ApprovalsPage() {
  const { isAdmin } = useRole()
  const [tab, setTab] = useState<Tab>('all')
  const pending = useLoad(listPending, [])
  const toPay = useLoad(() => (isAdmin ? awaitingPayment() : Promise.resolve([])), [isAdmin])
  const approvers = useLoad(() => (isAdmin ? listApprovers() : Promise.resolve([])), [isAdmin])
  const toast = useToast()
  const [bulkBusy, setBulkBusy] = useState(false)

  const items = pending.data ?? []
  const count = (k: Kind) => items.filter((i) => i.kind === k).length
  const shown = tab === 'all' ? items : items.filter((i) => i.kind === tab)
  const tabs: { value: Tab; label: string }[] = [
    { value: 'all', label: `All ${items.length}` },
    { value: 'leave', label: `Leave ${count('leave')}` },
    { value: 'trip', label: `Trips ${count('trip')}` },
    { value: 'claim', label: `Claims ${count('claim')}` },
    { value: 'clock', label: `Attend. ${count('clock')}` },
  ]
  const reload = () => {
    pending.reload()
    toPay.reload()
  }

  async function approveAllShown() {
    const list = shown.filter((i) => i.kind === 'clock')
    if (!confirm(`Approve all ${list.length} attendance exceptions shown? Only do this after checking them.`)) return
    setBulkBusy(true)
    let ok = 0
    for (const i of list) {
      try {
        await decide('clock', i.id, 'approve')
        ok++
      } catch {
        /* skip items that changed meanwhile */
      }
    }
    setBulkBusy(false)
    toast(`Approved ${ok} item(s)`)
    reload()
  }

  return (
    <Layout title="Approvals">
      <Segmented<Tab> value={tab} onChange={setTab} options={isAdmin ? [...tabs, { value: 'pay', label: `To pay ${toPay.data?.length ?? 0}` }] : tabs} />
      {pending.loading && !pending.data && <Loading />}
      <Notice kind="error">{pending.error ? friendlyError(pending.error) : ''}</Notice>

      {tab === 'pay' ? (
        <PaymentList claims={toPay.data ?? []} onDone={reload} />
      ) : (
        <>
          {tab === 'clock' && shown.length > 1 && isAdmin && (
            <button className="btn secondary" style={{ marginBottom: 14 }} disabled={bulkBusy} onClick={() => void approveAllShown()}>
              Approve all {shown.length} shown
            </button>
          )}
          {!pending.loading && shown.length === 0 && <Empty>Nothing waiting for you. 🎉</Empty>}
          {shown.map((i) => (
            <ApprovalCard key={`${i.kind}:${i.id}`} item={i} isAdmin={isAdmin} approvers={approvers.data ?? []} onDone={reload} />
          ))}
        </>
      )}
    </Layout>
  )
}

function ApprovalCard(props: {
  item: PendingItem
  isAdmin: boolean
  approvers: { id: string; full_name: string; role: string }[]
  onDone: () => void
}) {
  const { item: i, isAdmin } = props
  const toast = useToast()
  const [comment, setComment] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [fixTime, setFixTime] = useState('')
  const [moveTo, setMoveTo] = useState('')

  async function act(action: 'approve' | 'reject' | 'request_changes') {
    setError('')
    if (action !== 'approve' && !comment.trim()) return setError('Please add a comment explaining why.')
    setBusy(true)
    try {
      await decide(i.kind, i.id, action, comment)
      toast(action === 'approve' ? 'Approved' : action === 'reject' ? 'Rejected' : 'Sent back for changes')
      props.onDone()
    } catch (e) {
      setError(friendlyError(e))
    } finally {
      setBusy(false)
    }
  }

  async function fixAndApprove() {
    setError('')
    if (!fixTime) return setError('Enter the correct clock-out date and time.')
    setBusy(true)
    try {
      await adjustEntry(i.id, new Date(fixTime + ':00+08:00').toISOString(), comment.trim() || 'Clock-out corrected by HR')
      // The correction usually clears the only exception; approve anything left.
      try {
        await decide('clock', i.id, 'approve', comment)
      } catch (e) {
        if (!/already been decided/.test(friendlyError(e))) throw e
      }
      toast('Clock-out corrected and approved')
      props.onDone()
    } catch (e) {
      setError(friendlyError(e))
    } finally {
      setBusy(false)
    }
  }

  async function move() {
    setBusy(true)
    try {
      await reassign(i.kind, i.id, moveTo === 'hr' ? null : moveTo)
      toast('Reassigned')
      props.onDone()
    } catch (e) {
      setError(friendlyError(e))
    } finally {
      setBusy(false)
    }
  }

  const link = DETAIL_LINK[i.kind]
  return (
    <div className="card" data-testid="approval">
      <div className="row between top">
        <div className="grow">
          <div className="title">{i.full_name}</div>
          <div>{i.title}</div>
        </div>
        <span className={`chip ${i.kind === 'clock' ? 'pending' : 'info'}`}>{KIND_LABEL[i.kind]}</span>
      </div>
      <div className="muted" style={{ marginTop: 4 }}>{i.detail}</div>
      {i.note && <div style={{ marginTop: 4 }}>“{i.note}”</div>}
      {i.kind === 'claim' && i.amount != null && <div className="title" style={{ marginTop: 4 }}>{money(i.amount)}</div>}
      {i.kind === 'clock' && (
        <div className="row wrap" style={{ gap: 6, marginTop: 6 }}>
          <FlagChips flags={i.flags ?? []} />
          {i.amount != null && <span className="chip">{formatHours(Number(i.amount))} worked</span>}
        </div>
      )}
      {i.submitted_at && <div className="muted" style={{ marginTop: 4 }}>{i.kind === 'clock' ? 'Recorded' : 'Submitted'} {formatDateTime(i.submitted_at)}</div>}
      {isAdmin && i.approver_id && <div className="muted">Routed to {i.approver_name}</div>}
      {link && (
        <Link to={`${link}${i.id}`} style={{ display: 'inline-block', marginTop: 6 }}>
          View details{i.kind === 'claim' ? ' and receipts' : ''} ›
        </Link>
      )}
      <hr />
      <Field label="Comment" htmlFor={`c-${i.id}`} hint="Required when rejecting or asking for changes.">
        <textarea id={`c-${i.id}`} value={comment} onChange={(e) => setComment(e.target.value)} style={{ minHeight: 60 }} />
      </Field>
      {i.kind === 'clock' && isAdmin && i.flags?.includes('missed_clockout') && (
        <Field label="Correct clock-out time" htmlFor={`fix-${i.id}`} hint="Optional: if you know when they actually finished.">
          <input id={`fix-${i.id}`} type="datetime-local" value={fixTime} onChange={(e) => setFixTime(e.target.value)} />
        </Field>
      )}
      <Notice kind="error">{error}</Notice>
      <div className="btn-row">
        <button className="btn danger" disabled={busy} onClick={() => void act('reject')}>Reject</button>
        {fixTime ? (
          <button className="btn" disabled={busy} onClick={() => void fixAndApprove()}>Fix &amp; approve</button>
        ) : (
          <button className="btn" disabled={busy} onClick={() => void act('approve')}>Approve</button>
        )}
      </div>
      {i.kind === 'trip' && (
        <button className="btn secondary" style={{ marginTop: 10 }} disabled={busy} onClick={() => void act('request_changes')}>
          Ask for changes
        </button>
      )}
      {isAdmin && i.kind !== 'clock' && (
        <details style={{ marginTop: 12 }}>
          <summary className="muted">Reassign to another approver</summary>
          <div className="row" style={{ marginTop: 8 }}>
            <select aria-label="New approver" value={moveTo} onChange={(e) => setMoveTo(e.target.value)}>
              <option value="">Choose…</option>
              <option value="hr">HR/Admin (anyone)</option>
              {props.approvers.filter((a) => a.id !== i.staff_id).map((a) => (
                <option key={a.id} value={a.id}>{a.full_name}</option>
              ))}
            </select>
            <button className="btn small secondary" disabled={!moveTo || busy} onClick={() => void move()}>Move</button>
          </div>
        </details>
      )}
    </div>
  )
}

function PaymentList({ claims, onDone }: { claims: { id: string; full_name?: string; destination?: string; total_amount: number; decided_at: string | null }[]; onDone: () => void }) {
  const toast = useToast()
  const [refs, setRefs] = useState<Record<string, string>>({})
  const [error, setError] = useState('')
  async function pay(id: string) {
    setError('')
    try {
      await decide('claim', id, 'paid', refs[id])
      toast('Marked as paid')
      onDone()
    } catch (e) {
      setError(friendlyError(e))
    }
  }
  if (claims.length === 0) return <Empty>No approved claims waiting for payment.</Empty>
  return (
    <>
      <Notice kind="error">{error}</Notice>
      {claims.map((c) => (
        <div key={c.id} className="card" data-testid="to-pay">
          <div className="row between">
            <div>
              <div className="title">{c.full_name}</div>
              <div className="muted">{c.destination} · approved {formatDateTime(c.decided_at)}</div>
            </div>
            <div className="title">{money(c.total_amount)}</div>
          </div>
          <Link to={`/claims/${c.id}`}>View claim ›</Link>
          <div className="row" style={{ marginTop: 10 }}>
            <input type="text" placeholder="Payment reference (optional)" aria-label="Payment reference" value={refs[c.id] ?? ''}
              onChange={(e) => setRefs({ ...refs, [c.id]: e.target.value })} />
            <button className="btn small" onClick={() => void pay(c.id)}>Mark paid</button>
          </div>
        </div>
      ))}
    </>
  )
}
