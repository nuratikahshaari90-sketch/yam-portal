import { Link } from 'react-router-dom'
import { Layout } from '../components/Layout'
import { useAuth, useRole } from '../auth/AuthProvider'
import { ROLE_LABEL } from './admin/api'
import { useSyncState } from '../offline/useSync'

export function MorePage() {
  const { staff, signOut } = useAuth()
  const { isAdmin, canApprove } = useRole()
  const { pending } = useSyncState()
  const doSignOut = () => {
    if (
      pending.length > 0 &&
      !confirm(
        `${pending.length} entr${pending.length === 1 ? 'y has' : 'ies have'} not synced yet. They stay safely on this phone and will sync the next time you sign in here. Sign out anyway?`,
      )
    )
      return
    void signOut()
  }
  return (
    <Layout title="More">
      <div className="card tight">
        <div className="title">{staff?.full_name}</div>
        <div className="muted">
          {staff?.email} · {staff ? ROLE_LABEL[staff.role] : ''}
        </div>
      </div>
      <div className="section-title">My work</div>
      <nav className="menu">
        <Link to="/leave"><span className="ico">🌴</span>My leave</Link>
        <Link to="/trips"><span className="ico">🚗</span>My outstation trips</Link>
        <Link to="/claims"><span className="ico">🧾</span>My claims</Link>
        <Link to="/sync"><span className="ico">🔄</span>Sync status</Link>
      </nav>
      {canApprove && (
        <>
          <div className="section-title">Team</div>
          <nav className="menu">
            <Link to="/approvals"><span className="ico">✅</span>Approvals</Link>
            <Link to="/reports"><span className="ico">📊</span>Reports</Link>
          </nav>
        </>
      )}
      {isAdmin && (
        <>
          <div className="section-title">HR/Admin</div>
          <nav className="menu">
            <Link to="/admin/staff"><span className="ico">👥</span>Staff, roles & schedules</Link>
            <Link to="/admin/holidays"><span className="ico">🗓</span>Public holidays</Link>
            <Link to="/admin/settings"><span className="ico">⚙️</span>Settings</Link>
            <Link to="/admin/sync-issues"><span className="ico">⚠️</span>Sync issues</Link>
          </nav>
        </>
      )}
      <nav className="menu">
        <button onClick={doSignOut}><span className="ico">🚪</span>Sign out</button>
      </nav>
      <p className="muted" style={{ textAlign: 'center' }}>
        To install: open this site in Chrome (Android) or Safari (iPhone) and choose "Add to Home Screen".
      </p>
    </Layout>
  )
}
