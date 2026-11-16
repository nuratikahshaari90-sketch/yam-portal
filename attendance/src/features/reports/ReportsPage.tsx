import { useState } from 'react'
import { Layout } from '../../components/Layout'
import { Empty, Loading, Notice, Segmented, useLoad, useToast } from '../../components/ui'
import { formatDate, formatMonth, formatTime, klDate, todayKL } from '../../lib/dates'
import { friendlyError } from '../../lib/errors'
import { FLAG_LABEL, STATUS_LABEL, WORK_MODE_LABEL, type Flag, type WorkMode } from '../../lib/types'
import { leaveTypes } from '../leave/api'
import { claimsReport, dailyReport, monthlyReport, type ClaimsRow, type DailyRow, type MonthlyRow } from './api'
import { exportExcel, exportPdf, type Column, type Sheet } from './export'

type Tab = 'attendance' | 'person' | 'claims'
const r2 = (n: number) => Math.round(Number(n) * 100) / 100

function monthlyColumns(leaveNames: string[]): Column<MonthlyRow>[] {
  return [
    { header: 'Staff', value: (r) => r.full_name },
    { header: 'Staff no.', value: (r) => r.staff_no },
    { header: 'Days worked', value: (r) => r.days_worked, total: true },
    { header: 'Office', value: (r) => r.office_days, total: true },
    { header: 'WFH', value: (r) => r.wfh_days, total: true },
    { header: 'Client site', value: (r) => r.client_site_days, total: true },
    { header: 'Outstation', value: (r) => r.outstation_days, total: true },
    { header: 'Training', value: (r) => r.training_days, total: true },
    { header: 'Total hours', value: (r) => r2(r.total_hours), numeric: true, total: true },
    { header: 'OT hours (approved)', value: (r) => r2(r.overtime_hours_approved), numeric: true, total: true },
    { header: 'OT hours (pending)', value: (r) => r2(r.overtime_hours_pending), numeric: true, total: true },
    { header: 'Work on Off Day (days)', value: (r) => r.off_day_days, total: true },
    { header: 'Work on Off Day (hours)', value: (r) => r2(r.off_day_hours), numeric: true, total: true },
    { header: 'Work on Public Holiday (days)', value: (r) => r.public_holiday_days, total: true },
    { header: 'Work on Public Holiday (hours)', value: (r) => r2(r.public_holiday_hours), numeric: true, total: true },
    ...leaveNames.map((n) => ({ header: n, value: (r: MonthlyRow) => Number(r.leave_by_type?.[n] ?? 0), total: true })),
    { header: 'Leave days (total)', value: (r) => Number(r.leave_days_total), total: true },
    { header: 'Missed clock-outs', value: (r) => r.missed_clockouts, total: true },
    { header: 'Working days with no record', value: (r) => r.no_record_days, total: true },
    { header: 'Items awaiting HR review', value: (r) => r.pending_reviews, total: true },
  ]
}

const dailyColumns: Column<DailyRow>[] = [
  { header: 'Date', value: (r) => formatDate(r.work_date) },
  {
    header: 'Day',
    value: (r) => (r.day_type === 'public_holiday' ? `Public holiday: ${r.holiday_name}` : r.day_type === 'off_day' ? 'Off day' : 'Working day'),
  },
  { header: 'Leave', value: (r) => (r.leave_type ? `On Leave (${r.leave_type}${r.leave_portion !== 'full' ? ', half day' : ''})` : '') },
  { header: 'Work mode', value: (r) => r.modes.map((m) => WORK_MODE_LABEL[m as WorkMode]).join(', ') },
  { header: 'First in', value: (r) => (r.first_in ? formatTime(r.first_in) : '') },
  { header: 'Last out', value: (r) => (r.last_out ? (klDate(r.last_out) !== r.work_date ? `${formatTime(r.last_out)} (+1)` : formatTime(r.last_out)) : '') },
  { header: 'Hours', value: (r) => (r.entries ? r2(r.hours) : null), numeric: true, total: true },
  { header: 'OT hours', value: (r) => (r.overtime_hours ? r2(r.overtime_hours) : null), numeric: true, total: true },
  { header: 'OT status', value: (r) => (r.overtime_status ? STATUS_LABEL[r.overtime_status] : '') },
  {
    header: 'Notes',
    value: (r) => [...r.flags.filter((f) => f !== 'overtime').map((f) => FLAG_LABEL[f as Flag] ?? f), r.no_record ? 'No record' : ''].filter(Boolean).join('; '),
  },
]

const claimsColumns: Column<ClaimsRow>[] = [
  { header: 'Staff', value: (r) => r.full_name },
  { header: 'Staff no.', value: (r) => r.staff_no },
  { header: 'Trip', value: (r) => r.destination },
  { header: 'Trip dates', value: (r) => `${formatDate(r.trip_start, { weekday: false })} – ${formatDate(r.trip_end, { weekday: false })}` },
  { header: 'Status', value: (r) => STATUS_LABEL[r.status] },
  { header: 'Submitted', value: (r) => formatDate(klDate(r.submitted_at), { weekday: false }) },
  { header: 'Paid', value: (r) => (r.paid_at ? formatDate(klDate(r.paid_at), { weekday: false }) : '') },
  { header: 'Payment ref', value: (r) => r.payment_ref },
  { header: 'Mileage (km)', value: (r) => r2(r.mileage_km), numeric: true, total: true },
  { header: 'Mileage (RM)', value: (r) => r2(r.mileage), numeric: true, total: true },
  { header: 'Meals (RM)', value: (r) => r2(r.meals), numeric: true, total: true },
  { header: 'Toll (RM)', value: (r) => r2(r.toll), numeric: true, total: true },
  { header: 'Parking (RM)', value: (r) => r2(r.parking), numeric: true, total: true },
  { header: 'Accommodation (RM)', value: (r) => r2(r.accommodation), numeric: true, total: true },
  { header: 'Other (RM)', value: (r) => r2(r.other), numeric: true, total: true },
  { header: 'Total (RM)', value: (r) => r2(r.total), numeric: true, total: true },
]

function Table<T>({ columns, rows, rowKey }: { columns: Column<T>[]; rows: T[]; rowKey: (r: T) => string }) {
  const totals = columns.some((c) => c.total)
    ? columns.map((c, i) => (i === 0 ? 'Total' : c.total ? r2(rows.reduce((s, r) => s + Number(c.value(r) ?? 0), 0)) : ''))
    : null
  const fmt = (v: unknown, c: Column<T>) =>
    v == null || v === '' ? '' : c.numeric && typeof v === 'number' ? v.toFixed(2) : String(v)
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>{columns.map((c) => <th key={c.header} className={c.numeric || c.total ? 'num' : ''}>{c.header}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={rowKey(r)}>
              {columns.map((c) => <td key={c.header} className={c.numeric || c.total ? 'num' : ''}>{fmt(c.value(r), c)}</td>)}
            </tr>
          ))}
          {totals && (
            <tr style={{ fontWeight: 700, background: '#f4f7f5' }}>
              {columns.map((c, i) => <td key={c.header} className={c.numeric || c.total ? 'num' : ''}>{fmt(totals[i], c)}</td>)}
            </tr>
          )}
        </tbody>
      </table>
    </div>
  )
}

function ExportButtons({ name, sheets }: { name: string; sheets: () => Sheet<any>[] }) {
  const toast = useToast()
  const [busy, setBusy] = useState(false)
  const run = async (kind: 'xlsx' | 'pdf') => {
    setBusy(true)
    try {
      if (kind === 'xlsx') await exportExcel(`${name}.xlsx`, sheets())
      else await exportPdf(`${name}.pdf`, sheets())
    } catch (e) {
      toast(friendlyError(e))
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="btn-row" style={{ marginBottom: 14 }}>
      <button className="btn secondary" disabled={busy} onClick={() => void run('xlsx')}>⬇ Excel</button>
      <button className="btn secondary" disabled={busy} onClick={() => void run('pdf')}>⬇ PDF</button>
    </div>
  )
}

export function ReportsPage() {
  const [tab, setTab] = useState<Tab>('attendance')
  const [monthInput, setMonthInput] = useState(todayKL().slice(0, 7))
  const month = `${monthInput}-01`
  const monthLabel = formatMonth(month)
  const types = useLoad(leaveTypes, [])
  const leaveNames = (types.data ?? []).map((t) => t.name)
  const monthly = useLoad(() => monthlyReport(month), [month])
  const [person, setPerson] = useState('')
  const personId = person || monthly.data?.[0]?.staff_id || ''
  const daily = useLoad(() => (tab === 'person' && personId ? dailyReport(month, personId) : Promise.resolve([])), [tab, month, personId])
  const claims = useLoad(() => (tab === 'claims' ? claimsReport(month) : Promise.resolve([])), [tab, month])
  const mCols = monthlyColumns(leaveNames)
  const personName = monthly.data?.find((r) => r.staff_id === personId)?.full_name ?? ''
  const personSummary = monthly.data?.filter((r) => r.staff_id === personId) ?? []

  return (
    <Layout title="Reports">
      <div className="field">
        <label htmlFor="month">Month</label>
        <input id="month" type="month" value={monthInput} onChange={(e) => e.target.value && setMonthInput(e.target.value)} />
      </div>
      <Segmented<Tab>
        value={tab}
        onChange={setTab}
        options={[
          { value: 'attendance', label: 'All staff' },
          { value: 'person', label: 'Per person' },
          { value: 'claims', label: 'Claims' },
        ]}
      />
      <Notice kind="error">{monthly.error ? friendlyError(monthly.error) : ''}</Notice>

      {tab === 'attendance' && (
        <>
          <h2>Attendance · {monthLabel}</h2>
          <ExportButtons
            name={`YAM-attendance-${monthInput}`}
            sheets={() => [{ name: 'Attendance', title: `Monthly attendance report · ${monthLabel}`, columns: mCols, rows: monthly.data ?? [] }]}
          />
          {monthly.loading ? <Loading /> : monthly.data?.length ? (
            <Table columns={mCols} rows={monthly.data} rowKey={(r) => r.staff_id} />
          ) : <Empty>No data for this month.</Empty>}
          <p className="muted">
            Hours are after the unpaid break. Overtime counts only on working days; work on off days and public holidays is shown
            separately. Rejected entries are not counted.
          </p>
        </>
      )}

      {tab === 'person' && (
        <>
          <div className="field">
            <label htmlFor="person">Staff member</label>
            <select id="person" value={personId} onChange={(e) => setPerson(e.target.value)}>
              {(monthly.data ?? []).map((r) => <option key={r.staff_id} value={r.staff_id}>{r.full_name}</option>)}
            </select>
          </div>
          <h2>{personName} · {monthLabel}</h2>
          <ExportButtons
            name={`YAM-attendance-${monthInput}-${personName.replace(/\W+/g, '-')}`}
            sheets={() => [
              { name: 'Summary', title: `${personName} · ${monthLabel} · Summary`, columns: mCols, rows: personSummary },
              { name: 'Daily', title: `${personName} · ${monthLabel} · Daily attendance`, columns: dailyColumns, rows: daily.data ?? [] },
            ]}
          />
          {personSummary[0] && (
            <div className="stat-grid">
              <div className="stat"><div className="v">{personSummary[0].days_worked}</div><div className="l">Days worked</div></div>
              <div className="stat"><div className="v">{r2(personSummary[0].total_hours)}</div><div className="l">Total hours</div></div>
              <div className="stat"><div className="v">{r2(personSummary[0].overtime_hours_approved)}</div><div className="l">OT hours approved</div></div>
              <div className="stat"><div className="v">{Number(personSummary[0].leave_days_total)}</div><div className="l">Leave days</div></div>
            </div>
          )}
          {daily.loading ? <Loading /> : <Table columns={dailyColumns} rows={daily.data ?? []} rowKey={(r) => r.work_date} />}
        </>
      )}

      {tab === 'claims' && (
        <>
          <h2>Claims submitted · {monthLabel}</h2>
          <ExportButtons
            name={`YAM-claims-${monthInput}`}
            sheets={() => [{ name: 'Claims', title: `Monthly claims report · ${monthLabel}`, columns: claimsColumns, rows: claims.data ?? [] }]}
          />
          {claims.loading ? <Loading /> : claims.data?.length ? (
            <Table columns={claimsColumns} rows={claims.data} rowKey={(r) => r.claim_id} />
          ) : <Empty>No claims submitted this month.</Empty>}
        </>
      )}
    </Layout>
  )
}
