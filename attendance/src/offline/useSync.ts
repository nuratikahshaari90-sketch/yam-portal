import { useEffect, useState } from 'react'
import type { OutboxOp } from './db'
import { onSyncActivity, syncInfo, watchOutbox } from './outbox'

export function useOnline(): boolean {
  const [online, setOnline] = useState(typeof navigator === 'undefined' ? true : navigator.onLine)
  useEffect(() => {
    const on = () => setOnline(true)
    const off = () => setOnline(false)
    window.addEventListener('online', on)
    window.addEventListener('offline', off)
    return () => {
      window.removeEventListener('online', on)
      window.removeEventListener('offline', off)
    }
  }, [])
  return online
}

export function useOutbox(): OutboxOp[] {
  const [ops, setOps] = useState<OutboxOp[]>([])
  useEffect(() => watchOutbox(setOps), [])
  return ops
}

export function useSyncState() {
  const online = useOnline()
  const ops = useOutbox()
  const [info, setInfo] = useState(syncInfo())
  useEffect(() => onSyncActivity(() => setInfo(syncInfo())), [])
  return {
    online,
    ops,
    pending: ops.filter((o) => o.status === 'pending'),
    conflicts: ops.filter((o) => o.status === 'conflict'),
    syncing: info.syncing,
    lastSyncAt: info.lastSyncAt,
  }
}
