// Local database on the phone (IndexedDB). Everything a staff member records
// goes into the outbox first and is only removed after the server confirms it.
import Dexie, { type Table } from 'dexie'

export type OpKind = 'clock_in' | 'clock_out' | 'save_leave' | 'save_claim'

export interface OutboxOp {
  seq?: number
  id: string // unique id of this operation (used for de-duplication on the server)
  staffId: string
  kind: OpKind
  label: string // human description, e.g. "Clock in – Client Site"
  payload: Record<string, unknown>
  fileIds: string[] // photos/documents to upload before this operation
  createdAt: number // device clock, ms
  deviceAt: string // device clock, ISO
  queuedOffline: boolean
  status: 'pending' | 'conflict'
  attempts: number
  lastError?: string
}

export interface PendingFile {
  id: string
  staffId: string
  path: string // storage path it will be uploaded to
  blob: Blob
  contentType: string
  name: string
}

export interface CacheRow {
  key: string
  value: unknown
  savedAt: number
}

class YamDB extends Dexie {
  outbox!: Table<OutboxOp, number>
  files!: Table<PendingFile, string>
  cache!: Table<CacheRow, string>

  constructor() {
    super('yam-attendance')
    this.version(1).stores({
      outbox: '++seq, id, staffId, kind, status',
      files: 'id, staffId',
      cache: 'key',
    })
  }
}

export const db = new YamDB()

export async function cacheGet<T>(key: string): Promise<T | undefined> {
  const row = await db.cache.get(key)
  return row?.value as T | undefined
}

export async function cacheSet(key: string, value: unknown): Promise<void> {
  await db.cache.put({ key, value, savedAt: Date.now() })
}
