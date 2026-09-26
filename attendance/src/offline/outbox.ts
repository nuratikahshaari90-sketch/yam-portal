import { liveQuery } from 'dexie'
import { supabase, FILES_BUCKET } from '../lib/supabase'
import { friendlyError, isNetworkError } from '../lib/errors'
import { db, cacheGet, cacheSet, type OpKind, type OutboxOp, type PendingFile } from './db'

// An operation that was not sent within this time of being recorded is
// treated as "recorded offline" (device time is used and flagged).
export const OFFLINE_THRESHOLD_MS = 60_000

let currentStaffId: string | null = null
export function setSyncUser(staffId: string | null) {
  currentStaffId = staffId
}

// ---------------------------------------------------------------------
// Handlers: how each kind of operation is sent to the server
// ---------------------------------------------------------------------
async function rpc(fn: string, args: Record<string, unknown>) {
  const { data, error, status } = await supabase.rpc(fn, args)
  if (error) throw Object.assign(new Error(error.message), { status, code: error.code })
  return data
}

function wasOffline(op: OutboxOp): boolean {
  return op.queuedOffline || Date.now() - op.createdAt > OFFLINE_THRESHOLD_MS
}

const handlers: Record<OpKind, (op: OutboxOp) => Promise<unknown>> = {
  clock_in: (op) =>
    rpc('clock_in', {
      p_id: op.payload.id,
      p_work_mode: op.payload.work_mode,
      p_location: op.payload.location,
      p_purpose: op.payload.purpose,
      p_trip_id: op.payload.trip_id ?? null,
      p_device_at: op.deviceAt,
      p_offline: wasOffline(op),
    }),
  clock_out: (op) =>
    rpc('clock_out', {
      p_entry_id: op.payload.entry_id,
      p_note: op.payload.note ?? null,
      p_location: op.payload.location ?? null,
      p_device_at: op.deviceAt,
      p_offline: wasOffline(op),
    }),
  save_leave: (op) => rpc('save_leave', { p: op.payload }),
  save_claim: (op) => rpc('save_claim', { p: op.payload }),
}

async function uploadFiles(op: OutboxOp) {
  for (const fileId of op.fileIds) {
    const f = await db.files.get(fileId)
    if (!f) continue // already uploaded
    const { error } = await supabase.storage.from(FILES_BUCKET).upload(f.path, f.blob, {
      contentType: f.contentType,
      upsert: false,
    })
    // "already exists" means an earlier attempt succeeded: that's fine.
    if (error && !/exists|Duplicate/i.test(error.message)) {
      throw Object.assign(new Error(error.message), {
        status: (error as { statusCode?: string }).statusCode ? Number((error as { statusCode?: string }).statusCode) : 0,
      })
    }
  }
}

// ---------------------------------------------------------------------
// Queue API
// ---------------------------------------------------------------------
export async function enqueue(
  kind: OpKind,
  label: string,
  payload: Record<string, unknown>,
  files: Omit<PendingFile, 'staffId'>[] = [],
): Promise<OutboxOp> {
  if (!currentStaffId) throw new Error('Not signed in.')
  const staffId = currentStaffId
  const now = new Date()
  const op: OutboxOp = {
    id: crypto.randomUUID(),
    staffId,
    kind,
    label,
    payload,
    fileIds: files.map((f) => f.id),
    createdAt: now.getTime(),
    deviceAt: now.toISOString(),
    queuedOffline: typeof navigator !== 'undefined' && !navigator.onLine,
    status: 'pending',
    attempts: 0,
  }
  await db.transaction('rw', db.outbox, db.files, async () => {
    for (const f of files) await db.files.put({ ...f, staffId })
    await db.outbox.add(op)
  })
  return op
}

export interface SyncResult {
  sent: number
  conflicts: number
  stoppedOffline: boolean
}

let running: Promise<SyncResult> | null = null
// Quick retries when the connection has just come back but is not ready yet.
const RETRY_DELAYS_MS = [2_000, 5_000, 10_000, 20_000]
let retryIndex = 0
let retryTimer: ReturnType<typeof setTimeout> | null = null
function scheduleRetry(failed: boolean) {
  if (retryTimer) clearTimeout(retryTimer)
  retryTimer = null
  if (!failed) {
    retryIndex = 0
    return
  }
  if (typeof navigator !== 'undefined' && !navigator.onLine) return // the 'online' event will trigger a sync
  const delay = RETRY_DELAYS_MS[Math.min(retryIndex++, RETRY_DELAYS_MS.length - 1)]
  retryTimer = setTimeout(() => void syncNow(), delay)
}
const listeners = new Set<() => void>()
let lastSyncAt: number | null = null
let syncing = false

function notify() {
  listeners.forEach((l) => l())
}

export function onSyncActivity(l: () => void) {
  listeners.add(l)
  return () => {
    listeners.delete(l)
  }
}
export function syncInfo() {
  return { syncing, lastSyncAt }
}

/** Send everything waiting in the outbox, oldest first. Safe to call any time. */
export function syncNow(): Promise<SyncResult> {
  if (running) return running
  running = (async () => {
    const result: SyncResult = { sent: 0, conflicts: 0, stoppedOffline: false }
    if (!currentStaffId) return result
    syncing = true
    notify()
    try {
      const { data } = await supabase.auth.getSession()
      if (!data.session) return result
      const ops = (await db.outbox.where('staffId').equals(currentStaffId).sortBy('seq')).filter(
        (o) => o.status === 'pending',
      )
      for (const op of ops) {
        try {
          await uploadFiles(op)
          await handlers[op.kind](op)
          await db.transaction('rw', db.outbox, db.files, async () => {
            await db.outbox.delete(op.seq!)
            await db.files.bulkDelete(op.fileIds)
          })
          result.sent++
        } catch (e) {
          if (isNetworkError(e)) {
            await db.outbox.update(op.seq!, { attempts: op.attempts + 1, lastError: friendlyError(e) })
            result.stoppedOffline = true
            break
          }
          // The server refused it (e.g. a clash with another device). Keep a
          // copy on the server for HR and keep it on the phone too: never lose it.
          try {
            await rpc('record_sync_conflict', {
              p_op_id: op.id,
              p_kind: op.kind,
              p_payload: op.payload,
              p_error: friendlyError(e),
              p_device_at: op.deviceAt,
            })
          } catch (e2) {
            if (isNetworkError(e2)) {
              result.stoppedOffline = true
              break
            }
          }
          await db.outbox.update(op.seq!, { status: 'conflict', lastError: friendlyError(e), attempts: op.attempts + 1 })
          result.conflicts++
        }
      }
      if (!result.stoppedOffline) lastSyncAt = Date.now()
      return result
    } catch (e) {
      if (!isNetworkError(e)) throw e
      result.stoppedOffline = true
      return result
    } finally {
      syncing = false
      running = null
      scheduleRetry(result.stoppedOffline)
      notify()
    }
  })()
  return running
}

/** Remove a conflict from the phone once the person has seen it (a copy stays with HR). */
export async function dismissConflict(seq: number) {
  await db.outbox.delete(seq)
}

export function watchOutbox(cb: (ops: OutboxOp[]) => void) {
  const sub = liveQuery(() =>
    currentStaffId ? db.outbox.where('staffId').equals(currentStaffId).sortBy('seq') : Promise.resolve([] as OutboxOp[]),
  ).subscribe({ next: cb, error: () => cb([]) })
  return () => sub.unsubscribe()
}

export async function pendingOps(kind?: OpKind): Promise<OutboxOp[]> {
  if (!currentStaffId) return []
  const all = await db.outbox.where('staffId').equals(currentStaffId).sortBy('seq')
  return all.filter((o) => o.status === 'pending' && (!kind || o.kind === kind))
}

// ---------------------------------------------------------------------
// Read-through cache: use fresh server data when online, the last saved
// copy when offline.
// ---------------------------------------------------------------------
export async function cached<T>(key: string, fetcher: () => Promise<T>): Promise<{ data: T; fromCache: boolean }> {
  const fullKey = `${currentStaffId ?? 'anon'}:${key}`
  try {
    const data = await fetcher()
    await cacheSet(fullKey, data)
    return { data, fromCache: false }
  } catch (e) {
    if (!isNetworkError(e)) throw e
    const data = await cacheGet<T>(fullKey)
    if (data === undefined) throw e
    return { data, fromCache: true }
  }
}

/** Wrap a Supabase query so errors (including network) are thrown. */
export async function q<T>(p: PromiseLike<{ data: T | null; error: { message: string } | null; status?: number }>): Promise<T> {
  const { data, error, status } = await p
  if (error) throw Object.assign(new Error(error.message), { status })
  return data as T
}

// Keep syncing automatically.
let started = false
export function startAutoSync() {
  if (started || typeof window === 'undefined') return
  started = true
  window.addEventListener('online', () => {
    retryIndex = 0
    void syncNow()
  })
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void syncNow()
  })
  setInterval(() => {
    if (navigator.onLine) void syncNow()
  }, 30_000)
}
