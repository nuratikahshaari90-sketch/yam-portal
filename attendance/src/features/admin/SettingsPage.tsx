import { useState, type FormEvent } from 'react'
import { Layout } from '../../components/Layout'
import { Field, Loading, Notice, useLoad, useToast } from '../../components/ui'
import { friendlyError } from '../../lib/errors'
import type { Route, Settings } from '../../lib/types'
import { getSettings, saveSettings } from './api'

const ROUTES: { key: keyof Settings; label: string }[] = [
  { key: 'route_leave', label: 'Leave requests' },
  { key: 'route_trip', label: 'Outstation trips' },
  { key: 'route_claim', label: 'Claims' },
  { key: 'route_clock', label: 'Clock exceptions & overtime' },
]

export function SettingsPage() {
  const { data, loading } = useLoad(getSettings, [])
  const [form, setForm] = useState<Settings | null>(null)
  const [error, setError] = useState('')
  const toast = useToast()
  const s = form ?? data
  if (loading || !s)
    return (
      <Layout title="Settings" back="/more">
        <Loading />
      </Layout>
    )
  const set = <K extends keyof Settings>(k: K, v: Settings[K]) => setForm({ ...s, [k]: v })

  async function save(e: FormEvent) {
    e.preventDefault()
    setError('')
    try {
      await saveSettings({
        missed_clockout_time: s!.missed_clockout_time,
        max_daily_hours: Number(s!.max_daily_hours),
        overtime_threshold_hours: Number(s!.overtime_threshold_hours),
        mileage_rate_per_km: Number(s!.mileage_rate_per_km),
        route_leave: s!.route_leave,
        route_trip: s!.route_trip,
        route_claim: s!.route_claim,
        route_clock: s!.route_clock,
      })
      toast('Settings saved')
      setForm(null)
    } catch (err) {
      setError(friendlyError(err))
    }
  }

  return (
    <Layout title="Settings" back="/more">
      <form onSubmit={save}>
        <div className="card">
          <h2>Attendance rules</h2>
          <Field label="Missed clock-out time" htmlFor="mco" hint="If someone has not clocked out by this time, it is flagged. Default 11:59 pm.">
            <input id="mco" type="time" value={s.missed_clockout_time.slice(0, 5)} onChange={(e) => set('missed_clockout_time', e.target.value)} />
          </Field>
          <Field label="Daily hour limit" htmlFor="mdh" hint="Days above this are flagged for HR. Default 10 hours.">
            <input id="mdh" type="number" step="0.5" min="1" max="24" value={s.max_daily_hours} onChange={(e) => set('max_daily_hours', e.target.value as unknown as number)} />
          </Field>
          <Field label="Overtime starts after (hours per day)" htmlFor="ot" hint="Hours above this on a working day count as overtime. Default 8 hours.">
            <input id="ot" type="number" step="0.5" min="1" max="24" value={s.overtime_threshold_hours} onChange={(e) => set('overtime_threshold_hours', e.target.value as unknown as number)} />
          </Field>
        </div>
        <div className="card">
          <h2>Claims</h2>
          <Field label="Mileage rate (RM per km)" htmlFor="rate" hint="Used for new mileage claims. Submitted claims keep the rate they were submitted with.">
            <input id="rate" type="number" step="0.01" min="0" value={s.mileage_rate_per_km} onChange={(e) => set('mileage_rate_per_km', e.target.value as unknown as number)} />
          </Field>
        </div>
        <div className="card">
          <h2>Who approves</h2>
          <p className="muted">"Supervisor" means the staff member's supervisor, or HR/Admin when they have none.</p>
          {ROUTES.map((r) => (
            <Field key={r.key} label={r.label} htmlFor={r.key}>
              <select id={r.key} value={s[r.key] as Route} onChange={(e) => set(r.key, e.target.value as never)}>
                <option value="supervisor">Supervisor (or HR if none)</option>
                <option value="hr">HR/Admin only</option>
              </select>
            </Field>
          ))}
          <p className="muted">Changes apply to new requests only.</p>
        </div>
        <Notice kind="error">{error}</Notice>
        <button className="btn">Save settings</button>
      </form>
    </Layout>
  )
}
