import { useEffect, useState, type ReactNode } from 'react'
import { NavLink, useNavigate } from 'react-router-dom'
import { useRole } from '../auth/AuthProvider'
import { SyncBar } from './SyncBar'
import { pendingApprovalCount } from '../features/approvals/api'

export function Layout(props: { title: string; back?: boolean | string; actions?: ReactNode; children: ReactNode }) {
  const navigate = useNavigate()
  return (
    <div className="app">
      <header className="topbar">
        <div className="topbar-inner">
          {props.back && (
            <button
              className="back"
              aria-label="Back"
              onClick={() => (typeof props.back === 'string' ? navigate(props.back) : navigate(-1))}
            >
              ‹
            </button>
          )}
          <h1>{props.title}</h1>
          {props.actions}
        </div>
      </header>
      <SyncBar />
      <main className="main">{props.children}</main>
      <BottomNav />
    </div>
  )
}

function BottomNav() {
  const { canApprove } = useRole()
  const [count, setCount] = useState(0)
  useEffect(() => {
    if (!canApprove) return
    let alive = true
    const load = () =>
      pendingApprovalCount()
        .then((n) => alive && setCount(n))
        .catch(() => {})
    load()
    const t = setInterval(load, 60_000)
    return () => {
      alive = false
      clearInterval(t)
    }
  }, [canApprove])

  return (
    <nav className="bottomnav" aria-label="Main">
      <div className="bottomnav-inner">
        <NavLink to="/" end>
          <span className="ico">⏱</span>Clock
        </NavLink>
        <NavLink to="/history">
          <span className="ico">📅</span>History
        </NavLink>
        <NavLink to="/requests">
          <span className="ico">📝</span>Requests
        </NavLink>
        {canApprove && (
          <NavLink to="/approvals">
            <span className="ico">✅</span>Approvals
            {count > 0 && <span className="badge">{count > 99 ? '99+' : count}</span>}
          </NavLink>
        )}
        <NavLink to="/more">
          <span className="ico">☰</span>More
        </NavLink>
      </div>
    </nav>
  )
}
