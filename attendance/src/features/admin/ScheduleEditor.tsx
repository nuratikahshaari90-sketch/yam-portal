import { useState } from 'react'
import { DAY_SHORT, DAY_NAMES, formatDate, todayKL } from '../../lib/dates'
import type { WorkSchedule } from '../../lib/types'
import { Field, Notice, useToast } from '../../components/ui'
import { friendlyError } from '../../lib/errors'
import { addSchedule, deleteSchedule } from './api'

export function describeDays(days: number[]): string {
  if (days.length === 0) return 'No working days'
  const sorted = [...days].sort((a, b) => a - b)
  const off = [1, 2, 3, 4, 5, 6, 7].filter((d) => !sorted.includes(d))
  return `Works ${sorted.map((d) => DAY_SHORT[d - 1]).join(', ')}` + (off.length ? ` · Off ${off.map((d) => DAY_SHORT[d - 1]).join(', ')}` : '')
}

export function ScheduleEditor(props: { staffId: string; schedules: WorkSchedule[]; onChange: () => void }) {
  const [adding, setAdding] = useState(false)
  const [days, setDays] = useState<number[]>([1, 2, 3, 4, 5])
  const [from, setFrom] = useState(todayKL())
  const [note, setNote] = useState('')
  const [error, setError] = useState('')
  const toast = useToast()
  const today = todayKL()
  const currentId = props.schedules.find((s) => s.effective_from <= today)?.id

  const toggle = (d: number) => setDays((cur) => (cur.includes(d) ? cur.filter((x) => x !== d) : [...cur, d]))

  async function save() {
    setError('')
    try {
      await addSchedule(props.staffId, from, days, note)
      toast('Schedule saved')
      setAdding(false)
      setNote('')
      props.onChange()
    } catch (e) {
      setError(friendlyError(e))
    }
  }

  async function remove(s: WorkSchedule) {
    if (!confirm(`Delete the schedule starting ${formatDate(s.effective_from)}? Past records will be recalculated using the previous schedule.`)) return
    try {
      await deleteSchedule(s.id)
      props.onChange()
    } catch (e) {
      toast(friendlyError(e))
    }
  }

  return (
    <div className="card">
      <h2>Work schedule</h2>
      <p className="muted">Each change applies from its start date. Earlier records keep using the schedule that applied at the time.</p>
      <ul className="list">
        {props.schedules.map((s) => (
          <li key={s.id} className="card tight" style={{ marginBottom: 8 }}>
            <div className="row between top">
              <div className="grow">
                <div className="title">
                  From {s.effective_from <= '2000-01-01' ? 'the start' : formatDate(s.effective_from)}{' '}
                  {s.id === currentId && <span className="chip ok">Current</span>}
                  {s.effective_from > today && <span className="chip info">Upcoming</span>}
                </div>
                <div>{describeDays(s.working_days)}</div>
                {s.note && <div className="muted">{s.note}</div>}
              </div>
              {props.schedules.length > 1 && (
                <button className="btn small ghost" onClick={() => void remove(s)} aria-label="Delete schedule">
                  Delete
                </button>
              )}
            </div>
          </li>
        ))}
      </ul>
      {!adding ? (
        <button className="btn secondary" onClick={() => setAdding(true)}>
          Change schedule
        </button>
      ) : (
        <div>
          <div className="field">
            <span className="label">Working days</span>
            <div className="chips">
              {DAY_NAMES.map((name, i) => (
                <button
                  key={name}
                  type="button"
                  className={`chip-toggle ${days.includes(i + 1) ? 'on' : ''}`}
                  aria-pressed={days.includes(i + 1)}
                  onClick={() => toggle(i + 1)}
                >
                  {DAY_SHORT[i]}
                </button>
              ))}
            </div>
            <div className="hint">{describeDays(days)}</div>
          </div>
          <Field label="Starts from" required htmlFor="eff">
            <input id="eff" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </Field>
          <Field label="Note" htmlFor="snote" hint="Optional, e.g. 'Weekend field roster'">
            <input id="snote" type="text" value={note} onChange={(e) => setNote(e.target.value)} />
          </Field>
          <Notice kind="error">{error}</Notice>
          <div className="btn-row">
            <button className="btn secondary" onClick={() => setAdding(false)}>
              Cancel
            </button>
            <button className="btn" onClick={() => void save()} disabled={!from}>
              Save schedule
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
