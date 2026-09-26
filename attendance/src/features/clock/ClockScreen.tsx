import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Layout } from '../../components/Layout'
import { Field, Loading, Notice, useLoad, useToast } from '../../components/ui'
import { useAuth } from '../../auth/AuthProvider'
import { formatDate, formatHours, formatTime, hoursBetween, todayKL, TZ } from '../../lib/dates'
import { dayType } from '../../lib/workdays'
import { WORK_MODES, WORK_MODE_LABEL, type WorkMode } from '../../lib/types'
import { friendlyError } from '../../lib/errors'
import { useOutbox } from '../../offline/useSync'
import { clockIn, clockOut, currentOpenEntry, myCalendar, myEntries } from './api'
import { EntryCard } from './EntryCard'
import { OutstationPicker, useTodayContext } from './todayContext'

const LAST_KEY = 'yam:last-clock-in'

function useNow(ms = 1000) {
  const [now, setNow] = useState(new Date())
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), ms)
    return () => clearInterval(t)
  }, [ms])
  return now
}

export function ClockScreen() {
  const { staff } = useAuth()
  const toast = useToast()
  const now = useNow()
  const today = todayKL()
  const ops = useOutbox()
  const opsKey = ops.map((o) => `${o.seq}:${o.status}`).join(',')

  const cal = useLoad(() => myCalendar(staff!.id), [staff!.id])
  const open = useLoad(() => currentOpenEntry(staff!.id), [staff!.id, opsKey])
  const todays = useLoad(() => myEntries(staff!.id, today, today), [staff!.id, today, opsKey])
  const ctx = useTodayContext(staff!.id, today, opsKey)

  const last = (() => {
    try {
      return JSON.parse(localStorage.getItem(LAST_KEY) ?? '{}') as { work_mode?: WorkMode; location?: string }
    } catch {
      return {}
    }
  })()
  const [mode, setMode] = useState<WorkMode | ''>(last.work_mode ?? '')
  const [location, setLocation] = useState(last.location ?? '')
  const [purpose, setPurpose] = useState('')
  const [tripId, setTripId] = useState<string | null>(null)
  const [note, setNote] = useState('')
  const [outLocation, setOutLocation] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const holidays = new Set((cal.data?.holidays ?? []).map((h) => h.holiday_date))
  const todayType = cal.data ? dayType(cal.data.schedules, holidays, today) : null
  const holidayName = cal.data?.holidays.find((h) => h.holiday_date === today)?.name
  const openEntry = open.data?.open ?? null

  async function doClockIn() {
    setError('')
    if (!mode) return setError('Please choose your work mode.')
    if (!location.trim()) return setError('Please type where you are working.')
    if (!purpose.trim()) return setError('Please enter the purpose or task.')
    setBusy(true)
    try {
      const r = await clockIn({ work_mode: mode, location: location.trim(), purpose: purpose.trim(), trip_id: mode === 'outstation' ? tripId : null })
      localStorage.setItem(LAST_KEY, JSON.stringify({ work_mode: mode, location: location.trim() }))
      setPurpose('')
      if (r.conflict) toast('Could not clock in. See Sync status.')
      else toast(r.synced ? 'Clocked in' : 'Saved on this phone. It will sync when you are back online.')
      open.reload()
      todays.reload()
    } catch (e) {
      setError(friendlyError(e))
    } finally {
      setBusy(false)
    }
  }

  async function doClockOut() {
    if (!openEntry) return
    setError('')
    setBusy(true)
    try {
      const r = await clockOut(openEntry.id, note.trim(), outLocation.trim())
      setNote('')
      setOutLocation('')
      if (r.conflict) toast('Could not clock out. See Sync status.')
      else toast(r.synced ? 'Clocked out' : 'Saved on this phone. It will sync when you are back online.')
      open.reload()
      todays.reload()
    } catch (e) {
      setError(friendlyError(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Layout title={`Hi, ${staff!.full_name.split(' ')[0]}`}>
      <div className="clock-now">
        <div className="time" aria-label="Current time">
          {now.toLocaleTimeString('en-GB', { timeZone: TZ, hour: 'numeric', minute: '2-digit', hour12: true })}
        </div>
        <div className="muted">{formatDate(today)}</div>
      </div>

      {todayType === 'off_day' && <Notice kind="info">Today is your off day. If you clock in, it will be recorded as <b>Work on Off Day</b>.</Notice>}
      {todayType === 'public_holiday' && (
        <Notice kind="info">
          Today is a public holiday ({holidayName}). If you clock in, it will be recorded as <b>Work on Public Holiday</b>.
        </Notice>
      )}
      {ctx.leaveToday && (
        <Notice kind="ok">
          You are on <b>{ctx.leaveToday}</b> today. You do not need to clock in.
        </Notice>
      )}

      {open.loading && !open.data ? (
        <Loading />
      ) : openEntry ? (
        <div className="card status-card">
          <div className="row between">
            <h2 style={{ margin: 0 }}>Clocked in</h2>
            {openEntry.unsynced && <span className="chip pending">Waiting to sync</span>}
          </div>
          <p style={{ margin: '6px 0' }}>
            Since <b>{formatTime(openEntry.clock_in_at)}</b>
            {openEntry.clock_in_at.slice(0, 10) !== today && ` (${formatDate(openEntry.clock_in_at.slice(0, 10), { year: false })})`} ·{' '}
            {formatHours(hoursBetween(openEntry.clock_in_at, now.toISOString()))}
          </p>
          <p className="muted" style={{ margin: 0 }}>
            {WORK_MODE_LABEL[openEntry.work_mode]} · {openEntry.location}
            <br />
            {openEntry.purpose}
          </p>
          <hr />
          <Field label="What did you get done?" htmlFor="note" hint="Optional">
            <textarea id="note" value={note} onChange={(e) => setNote(e.target.value)} />
          </Field>
          <Field label="Location at clock-out" htmlFor="outloc" hint="Optional. Only if you moved somewhere else.">
            <input id="outloc" type="text" value={outLocation} onChange={(e) => setOutLocation(e.target.value)} />
          </Field>
          <Notice kind="error">{error}</Notice>
          <button className="btn huge clockout" disabled={busy} onClick={() => void doClockOut()}>
            Clock Out
          </button>
        </div>
      ) : (
        <div className="card">
          <div className="field">
            <span className="label">
              Work mode <span className="req">*</span>
            </span>
            <div className="chips" role="radiogroup" aria-label="Work mode">
              {WORK_MODES.map((m) => (
                <button
                  key={m.value}
                  type="button"
                  role="radio"
                  aria-checked={mode === m.value}
                  className={`chip-toggle ${mode === m.value ? 'on' : ''}`}
                  onClick={() => setMode(m.value)}
                >
                  {m.label}
                </button>
              ))}
            </div>
          </div>
          {mode === 'outstation' && <OutstationPicker trips={ctx.tripsToday} value={tripId} onChange={setTripId} />}
          <Field label="Where are you working?" required htmlFor="loc" hint='For example "Client office, Putrajaya"'>
            <input id="loc" type="text" value={location} onChange={(e) => setLocation(e.target.value)} />
          </Field>
          <Field label="Purpose or task" required htmlFor="purpose">
            <textarea id="purpose" value={purpose} onChange={(e) => setPurpose(e.target.value)} />
          </Field>
          <Notice kind="error">{error}</Notice>
          <button className="btn huge" disabled={busy} onClick={() => void doClockIn()}>
            Clock In
          </button>
        </div>
      )}

      <div className="row between">
        <h2 style={{ margin: '8px 0' }}>Today</h2>
        <Link to="/history">See history ›</Link>
      </div>
      {todays.data?.data.length ? (
        todays.data.data.map((e) => <EntryCard key={e.id} e={e} />)
      ) : (
        <p className="muted">No completed entries on the server yet today.</p>
      )}
    </Layout>
  )
}
