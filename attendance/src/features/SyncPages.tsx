import { useState } from 'react'
import { Layout } from '../components/Layout'
import { Empty, Loading, Notice, useLoad, useToast } from '../components/ui'
import { formatDateTime } from '../lib/dates'
import { friendlyError } from '../lib/errors'
import { supabase } from '../lib/supabase'
import { q, syncNow, dismissConflict } from '../offline/outbox'
import { useSyncState } from '../offline/useSync'

export function SyncStatusPage() {
  const { online, pending, conflicts, syncing, lastSyncAt } = useSyncState()
  return (
    <Layout title="Sync status" back="/more">
      <div className="card">
        <dl className="kv">
          <dt>Connection</dt>
          <dd>{online ? <span className="chip ok">Online</span> : <span className="chip">Offline</span>}</dd>
          <dt>Waiting</dt>
          <dd>{pending.length} entr{pending.length === 1 ? 'y' : 'ies'}</dd>
          <dt>Last sync</dt>
          <dd>{lastSyncAt ? formatDateTime(new Date(lastSyncAt)) : '—'}</dd>
        </dl>
        <button className="btn" style={{ marginTop: 14 }} disabled={!online || syncing} onClick={() => void syncNow()}>
          {syncing ? 'Syncing…' : 'Sync now'}
        </button>
      </div>
      <p className="muted">
        Everything you record is saved on this phone first and sent to the server as soon as there is internet. Nothing is deleted from
        the phone until the server confirms it.
      </p>
      {pending.length > 0 && <div className="section-title">Waiting to sync</div>}
      {pending.map((o) => (
        <div key={o.seq} className="card tight">
          <div className="title">{o.label}</div>
          <div className="muted">Recorded {formatDateTime(o.deviceAt)} (phone time)</div>
          {o.lastError && <div className="muted">Last attempt: {o.lastError}</div>}
        </div>
      ))}
      {conflicts.length > 0 && <div className="section-title">Could not be applied</div>}
      {conflicts.map((o) => (
        <div key={o.seq} className="card tight">
          <div className="title">{o.label}</div>
          <div className="muted">Recorded {formatDateTime(o.deviceAt)} (phone time)</div>
          <Notice kind="warn">{o.lastError}</Notice>
          <p className="muted">A copy has been sent to HR so nothing is lost. HR will follow up if needed.</p>
          <button className="btn small secondary" onClick={() => void dismissConflict(o.seq!)}>
            OK, remove from this phone
          </button>
        </div>
      ))}
      {pending.length === 0 && conflicts.length === 0 && <Empty>All your entries are synced.</Empty>}
    </Layout>
  )
}

interface SyncIssue {
  id: string
  staff_id: string
  kind: string
  payload: Record<string, unknown>
  error: string
  device_recorded_at: string | null
  created_at: string
  resolved_at: string | null
  resolution_note: string | null
  staff: { full_name: string } | null
}

const KIND_LABEL: Record<string, string> = {
  clock_in: 'Clock in',
  clock_out: 'Clock out',
  save_leave: 'Leave draft',
  save_claim: 'Claim draft',
}

export function SyncIssuesPage() {
  const [showResolved, setShowResolved] = useState(false)
  const toast = useToast()
  const { data, loading, reload } = useLoad(
    () =>
      q<SyncIssue[]>(
        supabase
          .from('sync_conflicts')
          .select('*, staff:staff_id(full_name)')
          .order('created_at', { ascending: false })
          .limit(200),
      ),
    [],
  )
  const rows = (data ?? []).filter((r) => showResolved || !r.resolved_at)

  async function resolve(id: string) {
    const note = prompt('What did you do about it? (e.g. "Corrected clock-out to 5:30 pm")')
    if (note === null) return
    try {
      await q(supabase.rpc('resolve_sync_conflict', { p_id: id, p_note: note }))
      toast('Marked as resolved')
      reload()
    } catch (e) {
      toast(friendlyError(e))
    }
  }

  return (
    <Layout title="Sync issues" back="/more">
      <p className="muted">
        Entries recorded offline that the server could not apply automatically (for example, a clock-out sent twice from two phones).
        They are kept here so nothing is lost. Correct the record if needed, then mark it resolved.
      </p>
      <label className="checkbox">
        <input type="checkbox" checked={showResolved} onChange={(e) => setShowResolved(e.target.checked)} /> Show resolved
      </label>
      {loading && <Loading />}
      {!loading && rows.length === 0 && <Empty>No open sync issues.</Empty>}
      {rows.map((r) => (
        <div key={r.id} className="card" data-testid="sync-issue">
          <div className="row between">
            <div className="title">{r.staff?.full_name}</div>
            {r.resolved_at ? <span className="chip ok">Resolved</span> : <span className="chip pending">Open</span>}
          </div>
          <div>
            <b>{KIND_LABEL[r.kind] ?? r.kind}</b> recorded {r.device_recorded_at ? formatDateTime(r.device_recorded_at) : '—'} (phone time)
          </div>
          <Notice kind="warn">{r.error}</Notice>
          <details>
            <summary className="muted">Details</summary>
            <dl className="kv" style={{ marginTop: 8 }}>
              {Object.entries(r.payload)
                .filter(([, v]) => v !== null && v !== '' && typeof v !== 'object')
                .map(([k, v]) => (
                  <div key={k} style={{ display: 'contents' }}>
                    <dt>{k.replace(/_/g, ' ')}</dt>
                    <dd>{String(v)}</dd>
                  </div>
                ))}
            </dl>
          </details>
          {r.resolution_note && <p className="muted">Resolution: {r.resolution_note}</p>}
          {!r.resolved_at && (
            <button className="btn small secondary" style={{ marginTop: 10 }} onClick={() => void resolve(r.id)}>
              Mark resolved
            </button>
          )}
        </div>
      ))}
    </Layout>
  )
}
