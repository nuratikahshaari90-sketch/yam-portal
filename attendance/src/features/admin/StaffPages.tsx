import { useState, type FormEvent } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { Layout } from '../../components/Layout'
import { Empty, Field, Loading, Notice, useLoad, useToast } from '../../components/ui'
import { friendlyError } from '../../lib/errors'
import type { Role, Staff } from '../../lib/types'
import { createStaff, getStaff, listSchedules, listStaff, ROLE_LABEL, updateStaff, type StaffInput } from './api'
import { ScheduleEditor, describeDays } from './ScheduleEditor'
import { todayKL } from '../../lib/dates'
import { workingDaysOn } from '../../lib/workdays'

export function StaffListPage() {
  const { data, loading, error } = useLoad(listStaff, [])
  const [search, setSearch] = useState('')
  const [showInactive, setShowInactive] = useState(false)
  const byId = new Map((data ?? []).map((s) => [s.id, s]))
  const rows = (data ?? []).filter(
    (s) =>
      (showInactive || s.active) &&
      (!search || `${s.full_name} ${s.email} ${s.staff_no ?? ''}`.toLowerCase().includes(search.toLowerCase())),
  )
  return (
    <Layout title="Staff" back="/more">
      <Link className="btn" to="/admin/staff/new" style={{ marginBottom: 14 }}>
        + Add staff member
      </Link>
      <div className="field">
        <input type="search" placeholder="Search name, email or staff no." value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search staff" />
      </div>
      <label className="checkbox">
        <input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} /> Show inactive staff
      </label>
      {loading && <Loading />}
      <Notice kind="error">{error ? friendlyError(error) : ''}</Notice>
      {!loading && rows.length === 0 && <Empty>No staff found.</Empty>}
      {rows.map((s) => (
        <Link key={s.id} to={`/admin/staff/${s.id}`} className="list-item">
          <div className="row between top">
            <div className="grow">
              <div className="title">{s.full_name}</div>
              <div className="muted">
                {s.staff_no ? `${s.staff_no} · ` : ''}
                {s.email}
              </div>
              <div className="muted">
                Supervisor: {s.supervisor_id ? byId.get(s.supervisor_id)?.full_name ?? '—' : 'None (approvals go to HR)'}
              </div>
            </div>
            <div className="stack right">
              <span className={`chip ${s.role === 'admin' ? 'info' : s.role === 'supervisor' ? 'ok' : ''}`}>{ROLE_LABEL[s.role]}</span>
              {!s.active && <span className="chip cancelled">Inactive</span>}
              {s.active && !s.user_id && <span className="chip pending">Not activated</span>}
            </div>
          </div>
        </Link>
      ))}
    </Layout>
  )
}

const EMPTY: StaffInput = { email: '', full_name: '', staff_no: '', job_title: '', role: 'staff', supervisor_id: null, active: true }

export function StaffEditPage() {
  const { id } = useParams()
  const isNew = id === 'new'
  const navigate = useNavigate()
  const toast = useToast()
  const all = useLoad(listStaff, [])
  const person = useLoad(() => (isNew ? Promise.resolve(null) : getStaff(id!)), [id])
  const schedules = useLoad(() => (isNew ? Promise.resolve([]) : listSchedules(id!)), [id])
  const [form, setForm] = useState<StaffInput | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const current: StaffInput | null = form ?? (isNew ? EMPTY : person.data ? { ...person.data } : null)
  if (!current) return <Layout title="Staff" back="/admin/staff">{person.loading ? <Loading /> : <Notice kind="error">Not found</Notice>}</Layout>

  const set = <K extends keyof StaffInput>(k: K, v: StaffInput[K]) => setForm({ ...current, [k]: v })
  const supervisors = (all.data ?? []).filter((s) => s.active && s.role !== 'staff' && s.id !== id)
  const originalSupervisor = person.data?.supervisor_id ?? null
  const supervisorChanged = !isNew && current.supervisor_id !== originalSupervisor

  async function save(e: FormEvent) {
    e.preventDefault()
    setError('')
    setBusy(true)
    const payload: StaffInput = {
      ...current!,
      email: current!.email.trim().toLowerCase(),
      full_name: current!.full_name.trim(),
      staff_no: current!.staff_no?.trim() || null,
      job_title: current!.job_title?.trim() || null,
    }
    try {
      if (isNew) {
        const created = await createStaff(payload)
        toast('Staff member added')
        navigate(`/admin/staff/${created.id}`, { replace: true })
      } else {
        await updateStaff(id!, payload)
        toast('Saved')
        setForm(null)
        person.reload()
        all.reload()
      }
    } catch (err) {
      setError(friendlyError(err))
    } finally {
      setBusy(false)
    }
  }

  const p = person.data as Staff | null
  const currentDays = workingDaysOn(schedules.data ?? [], todayKL())

  return (
    <Layout title={isNew ? 'Add staff member' : current.full_name || 'Staff'} back="/admin/staff">
      {p && (
        <div className="card tight">
          <div className="row between">
            <span>Login</span>
            {p.user_id ? <span className="chip ok">Activated</span> : <span className="chip pending">Not activated yet</span>}
          </div>
          {!p.user_id && (
            <p className="muted" style={{ marginTop: 8, marginBottom: 0 }}>
              Ask {p.full_name.split(' ')[0]} to open the app, tap <b>Activate your account</b> and use <b>{p.email}</b>.
            </p>
          )}
          <div className="muted" style={{ marginTop: 8 }}>
            {describeDays(currentDays)}
          </div>
        </div>
      )}
      <form className="card" onSubmit={save}>
        <Field label="Full name" required htmlFor="name">
          <input id="name" type="text" required value={current.full_name} onChange={(e) => set('full_name', e.target.value)} />
        </Field>
        <Field label="Work email" required htmlFor="email" hint="They will use this email to activate their account and sign in.">
          <input id="email" type="email" required value={current.email} onChange={(e) => set('email', e.target.value)} />
        </Field>
        <div className="btn-row">
          <Field label="Staff no." htmlFor="sno">
            <input id="sno" type="text" value={current.staff_no ?? ''} onChange={(e) => set('staff_no', e.target.value)} />
          </Field>
          <Field label="Job title" htmlFor="jt">
            <input id="jt" type="text" value={current.job_title ?? ''} onChange={(e) => set('job_title', e.target.value)} />
          </Field>
        </div>
        <Field label="Role" required htmlFor="role">
          <select id="role" value={current.role} onChange={(e) => set('role', e.target.value as Role)}>
            <option value="staff">Staff</option>
            <option value="supervisor">Supervisor</option>
            <option value="admin">HR/Admin</option>
          </select>
        </Field>
        <Field
          label="Supervisor"
          htmlFor="sup"
          hint="Leave as 'None' and their leave and trip requests go to HR/Admin."
        >
          <select id="sup" value={current.supervisor_id ?? ''} onChange={(e) => set('supervisor_id', e.target.value || null)}>
            <option value="">None (HR/Admin approves)</option>
            {supervisors.map((s) => (
              <option key={s.id} value={s.id}>
                {s.full_name} ({ROLE_LABEL[s.role]})
              </option>
            ))}
          </select>
        </Field>
        {supervisorChanged && (
          <Notice kind="warn">
            Only <b>new</b> requests will go to the new supervisor. Requests already waiting stay with their current approver. You can
            reassign them from the Approvals screen.
          </Notice>
        )}
        {!isNew && (
          <label className="checkbox">
            <input type="checkbox" checked={current.active} onChange={(e) => set('active', e.target.checked)} /> Active (can sign in)
          </label>
        )}
        <Notice kind="error">{error}</Notice>
        <button className="btn" disabled={busy}>
          {isNew ? 'Add staff member' : 'Save changes'}
        </button>
      </form>
      {!isNew && schedules.data && <ScheduleEditor staffId={id!} schedules={schedules.data} onChange={schedules.reload} />}
    </Layout>
  )
}
