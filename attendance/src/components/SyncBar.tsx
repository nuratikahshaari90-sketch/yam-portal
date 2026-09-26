import { Link } from 'react-router-dom'
import { useSyncState } from '../offline/useSync'
import { syncNow } from '../offline/outbox'

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`

export function SyncBar() {
  const { online, pending, conflicts, syncing } = useSyncState()
  if (!online)
    return (
      <div className="syncbar offline" role="status" data-testid="syncbar">
        Offline{pending.length > 0 ? `, ${plural(pending.length, 'entry')} waiting to sync` : ' — your entries will be saved on this phone'}
      </div>
    )
  if (pending.length > 0)
    return (
      <div className="syncbar pending" role="status" data-testid="syncbar">
        {syncing ? 'Syncing…' : `${plural(pending.length, 'entry')} waiting to sync`}
        {!syncing && (
          <button className="btn small secondary" onClick={() => void syncNow()}>
            Sync now
          </button>
        )}
      </div>
    )
  if (conflicts.length > 0)
    return (
      <div className="syncbar conflict" role="status" data-testid="syncbar">
        <Link to="/sync">{plural(conflicts.length, 'entry')} could not be applied. Tap to view.</Link>
      </div>
    )
  return null
}
