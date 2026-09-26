import { Link } from 'react-router-dom'
import { Layout } from '../components/Layout'

export function RequestsPage() {
  return (
    <Layout title="Requests">
      <div className="section-title">Apply</div>
      <nav className="menu">
        <Link to="/leave/new"><span className="ico">🌴</span>Apply for leave</Link>
        <Link to="/trips/new"><span className="ico">🚗</span>Request an outstation trip</Link>
        <Link to="/claims/new"><span className="ico">🧾</span>Make a claim</Link>
      </nav>
      <div className="section-title">My requests</div>
      <nav className="menu">
        <Link to="/leave"><span className="ico">📋</span>My leave</Link>
        <Link to="/trips"><span className="ico">🗺</span>My outstation trips</Link>
        <Link to="/claims"><span className="ico">💰</span>My claims</Link>
      </nav>
    </Layout>
  )
}
