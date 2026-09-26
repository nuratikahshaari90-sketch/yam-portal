import { formatDateTime, formatHours, formatTime, klDate } from '../../lib/dates'
import { FLAG_LABEL, WORK_MODE_LABEL, type AttendanceEntry } from '../../lib/types'

export function FlagChips({ flags }: { flags: string[] }) {
  return (
    <>
      {flags.map((f) => (
        <span key={f} className={`chip ${f === 'off_day' || f === 'public_holiday' || f === 'offline' ? 'info' : 'pending'}`}>
          {FLAG_LABEL[f as keyof typeof FLAG_LABEL] ?? f}
        </span>
      ))}
    </>
  )
}

export function ReviewChip({ state }: { state: AttendanceEntry['review_state'] }) {
  if (state === 'ok') return null
  const label = state === 'pending' ? 'Awaiting HR review' : state === 'approved' ? 'Reviewed: approved' : 'Reviewed: rejected'
  return <span className={`chip ${state}`}>{label}</span>
}

export function EntryCard({ e, showName }: { e: AttendanceEntry; showName?: boolean }) {
  const outDate = e.clock_out_at ? klDate(e.clock_out_at) : null
  return (
    <div className="card tight" data-testid="entry">
      {showName && <div className="title">{e.full_name}</div>}
      <div className="row between top">
        <div className="grow">
          <div className="title">
            {formatTime(e.clock_in_at)} – {e.clock_out_at ? (outDate !== e.work_date ? formatDateTime(e.clock_out_at) : formatTime(e.clock_out_at)) : 'still clocked in'}
          </div>
          <div>
            <b>{WORK_MODE_LABEL[e.work_mode]}</b> · {e.location}
          </div>
          <div className="muted">{e.purpose}</div>
          {e.clock_out_note && <div className="muted">Done: {e.clock_out_note}</div>}
          {e.clock_out_location && <div className="muted">Clock-out location: {e.clock_out_location}</div>}
          {(e.clock_in_offline || e.clock_out_offline) && (
            <div className="muted">Synced to server at {formatDateTime(e.clock_out_server_at ?? e.clock_in_server_at)}</div>
          )}
          {e.conflict_note && <div className="muted">Note: {e.conflict_note}</div>}
          {e.adjust_note && <div className="muted">Corrected by HR: {e.adjust_note}</div>}
          {e.review_comment && <div className="muted">HR comment: {e.review_comment}</div>}
        </div>
        <div className="nowrap title">{e.hours != null ? formatHours(e.hours) : ''}</div>
      </div>
      <div className="row wrap" style={{ marginTop: 6, gap: 6 }}>
        <FlagChips flags={e.flags} />
        <ReviewChip state={e.review_state} />
      </div>
    </div>
  )
}
