import { Link } from 'react-router-dom'
import { money, useLoad } from '../../components/ui'
import type { Trip } from '../../lib/types'
import { claimsForTrip } from '../claims/api'
import { ClaimRow } from '../claims/ClaimPages'

/** Claims made for a trip, with the trip total. */
export function TripClaims({ trip, mine }: { trip: Trip; mine: boolean }) {
  const { data } = useLoad(() => claimsForTrip(trip.id), [trip.id])
  const claims = data ?? []
  const counted = claims.filter((c) => c.status !== 'draft' && c.status !== 'rejected')
  const total = counted.reduce((s, c) => s + Number(c.total_amount), 0)
  return (
    <div>
      <h2 style={{ marginTop: 18 }}>Claims</h2>
      {claims.map((c) => <ClaimRow key={c.id} c={c} />)}
      <div className="card row between">
        <div>
          <div className="title">Trip total</div>
          <div className="muted">Submitted, approved and paid claims</div>
        </div>
        <span className="big-number" data-testid="trip-total">{money(total)}</span>
      </div>
      {mine && (
        <Link to={`/claims/new?trip=${trip.id}`} className="btn secondary">
          + Make a claim for this trip
        </Link>
      )}
    </div>
  )
}
