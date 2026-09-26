import { useState } from 'react'
import { Layout } from '../../components/Layout'
import { Empty, Field, Loading, Notice, useLoad, useToast } from '../../components/ui'
import { formatDate, todayKL } from '../../lib/dates'
import { friendlyError } from '../../lib/errors'
import { addHoliday, deleteHoliday, listHolidays } from './api'

export function HolidaysPage() {
  const [year, setYear] = useState(Number(todayKL().slice(0, 4)))
  const { data, loading, reload } = useLoad(() => listHolidays(year), [year])
  const [date, setDate] = useState('')
  const [name, setName] = useState('')
  const [error, setError] = useState('')
  const toast = useToast()

  async function add() {
    setError('')
    try {
      await addHoliday(date, name.trim())
      setDate('')
      setName('')
      toast('Holiday added')
      reload()
    } catch (e) {
      setError(friendlyError(e))
    }
  }

  async function remove(id: string, label: string) {
    if (!confirm(`Remove "${label}"?`)) return
    try {
      await deleteHoliday(id)
      reload()
    } catch (e) {
      toast(friendlyError(e))
    }
  }

  return (
    <Layout title="Public holidays" back="/more">
      <div className="row between" style={{ marginBottom: 12 }}>
        <button className="btn small secondary" onClick={() => setYear(year - 1)}>
          ‹ {year - 1}
        </button>
        <h2 style={{ margin: 0 }}>{year}</h2>
        <button className="btn small secondary" onClick={() => setYear(year + 1)}>
          {year + 1} ›
        </button>
      </div>
      {loading && <Loading />}
      {!loading && data?.length === 0 && <Empty>No holidays for {year} yet.</Empty>}
      {data?.map((h) => (
        <div key={h.id} className="card tight row between">
          <div className="grow">
            <div className="title">{h.name}</div>
            <div className="muted">{formatDate(h.holiday_date)}</div>
          </div>
          <button className="btn small ghost" onClick={() => void remove(h.id, h.name)}>
            Remove
          </button>
        </div>
      ))}
      <div className="card">
        <h2>Add a holiday</h2>
        <Field label="Date" required htmlFor="hd">
          <input id="hd" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>
        <Field label="Name" required htmlFor="hn">
          <input id="hn" type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Hari Raya Aidilfitri" />
        </Field>
        <Notice kind="error">{error}</Notice>
        <button className="btn" disabled={!date || !name.trim()} onClick={() => void add()}>
          Add holiday
        </button>
      </div>
    </Layout>
  )
}
