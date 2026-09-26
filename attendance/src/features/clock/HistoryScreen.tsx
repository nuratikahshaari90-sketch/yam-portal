import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Layout } from '../../components/Layout'
import { Loading, Notice, Segmented, useLoad } from '../../components/ui'
import { useAuth } from '../../auth/AuthProvider'
import {
  addDays, addMonths, eachDay, endOfMonth, formatDate, formatHours, formatMonth, startOfMonth, startOfWeek, todayKL,
} from '../../lib/dates'
import { dayType, DAY_TYPE_LABEL } from '../../lib/workdays'
import { WORK_MODE_LABEL, type AttendanceEntry } from '../../lib/types'
import { myCalendar, myEntries } from './api'
import { EntryCard } from './EntryCard'
import { useLeaveDays } from './todayContext'

type View = 'day' | 'week' | 'month'

export function summarise(entries: AttendanceEntry[]) {
  const byDay = new Map<string, AttendanceEntry[]>()
  for (const e of entries) {
    if (e.review_state === 'rejected') continue
    byDay.set(e.work_date, [...(byDay.get(e.work_date) ?? []), e])
  }
  let hours = 0
  let overtime = 0
  let offDays = 0
  let phDays = 0
  for (const list of byDay.values()) {
    hours += Number(list[0].day_hours)
    overtime += Number(list[0].day_overtime_hours ?? 0)
    if (list[0].day_type === 'off_day') offDays++
    if (list[0].day_type === 'public_holiday') phDays++
  }
  return { daysWorked: byDay.size, hours, overtime, offDays, phDays, byDay }
}

export function HistoryScreen() {
  const { staff } = useAuth()
  const [params, setParams] = useSearchParams()
  const view = (params.get('view') as View) || 'week'
  const anchor = params.get('date') || todayKL()
  const [, force] = useState(0)

  const from = view === 'day' ? anchor : view === 'week' ? startOfWeek(anchor) : startOfMonth(anchor)
  const to = view === 'day' ? anchor : view === 'week' ? addDays(from, 6) : endOfMonth(anchor)

  const cal = useLoad(() => myCalendar(staff!.id), [staff!.id])
  const entries = useLoad(() => myEntries(staff!.id, from, to), [staff!.id, from, to])
  const leave = useLeaveDays(staff!.id, from, to)

  const go = (v: View, d: string) => {
    setParams({ view: v, date: d }, { replace: true })
    force((x) => x + 1)
  }
  const shift = (n: number) =>
    go(view, view === 'day' ? addDays(anchor, n) : view === 'week' ? addDays(anchor, 7 * n) : addMonths(anchor, n))

  const holidays = new Set((cal.data?.holidays ?? []).map((h) => h.holiday_date))
  const holidayName = (d: string) => cal.data?.holidays.find((h) => h.holiday_date === d)?.name
  const list = entries.data?.data ?? []
  const sum = summarise(list)
  const title =
    view === 'day' ? formatDate(anchor) : view === 'week' ? `Week of ${formatDate(from, { year: false })}` : formatMonth(anchor)

  return (
    <Layout title="My history">
      <Segmented<View>
        value={view}
        onChange={(v) => go(v, anchor)}
        options={[
          { value: 'day', label: 'Day' },
          { value: 'week', label: 'Week' },
          { value: 'month', label: 'Month' },
        ]}
      />
      <div className="row between" style={{ marginBottom: 12 }}>
        <button className="btn small secondary" onClick={() => shift(-1)} aria-label="Previous">
          ‹ Prev
        </button>
        <div className="title" style={{ textAlign: 'center' }}>
          {title}
        </div>
        <button className="btn small secondary" onClick={() => shift(1)} aria-label="Next">
          Next ›
        </button>
      </div>
      {entries.data?.fromCache && <Notice kind="warn">Showing the last saved copy (offline).</Notice>}
      {entries.loading && !entries.data && <Loading />}

      {view !== 'day' && (
        <div className="stat-grid">
          <div className="stat"><div className="v">{sum.daysWorked}</div><div className="l">Days worked</div></div>
          <div className="stat"><div className="v">{formatHours(sum.hours)}</div><div className="l">Total hours</div></div>
          <div className="stat"><div className="v">{formatHours(sum.overtime)}</div><div className="l">Overtime</div></div>
          <div className="stat"><div className="v">{sum.offDays + sum.phDays}</div><div className="l">Off day / holiday work</div></div>
        </div>
      )}

      {eachDay(from, to).map((d) => {
        const dayEntries = list.filter((e) => e.work_date === d)
        const type = cal.data ? dayType(cal.data.schedules, holidays, d) : 'working_day'
        const onLeave = leave.get(d)
        const future = d > todayKL()
        const label = onLeave
          ? `On Leave (${onLeave})`
          : type === 'public_holiday'
            ? `Public holiday: ${holidayName(d)}`
            : DAY_TYPE_LABEL[type]
        if (view === 'month') {
          const s = dayEntries.length ? summarise(dayEntries) : null
          return (
            <button key={d} className="list-item" onClick={() => go('day', d)} style={{ padding: '10px 14px' }}>
              <div className="row between">
                <div className="grow">
                  <b>{formatDate(d, { year: false })}</b>{' '}
                  <span className="muted">
                    {dayEntries.length
                      ? [...new Set(dayEntries.map((e) => WORK_MODE_LABEL[e.work_mode]))].join(', ')
                      : future ? '' : onLeave || type !== 'working_day' ? label : 'No record'}
                  </span>
                </div>
                <div className="nowrap">{s ? formatHours(s.hours) : ''}</div>
              </div>
              {dayEntries.length > 0 && type !== 'working_day' && <span className="chip info">{label}</span>}
              {dayEntries.some((e) => e.review_state === 'pending') && <span className="chip pending">Awaiting HR review</span>}
            </button>
          )
        }
        return (
          <section key={d} style={{ marginBottom: 8 }}>
            <div className="section-title">
              {formatDate(d, { year: view === 'day' })} · {label}
            </div>
            {dayEntries.length ? (
              dayEntries.map((e) => <EntryCard key={e.id} e={e} />)
            ) : (
              <p className="muted" style={{ marginLeft: 2 }}>
                {future ? '—' : onLeave || type !== 'working_day' ? 'No work recorded' : 'No record'}
              </p>
            )}
          </section>
        )
      })}
    </Layout>
  )
}
