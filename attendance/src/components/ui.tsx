import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
import { STATUS_LABEL } from '../lib/types'

export function Field(props: { label: string; required?: boolean; hint?: ReactNode; htmlFor?: string; children: ReactNode }) {
  return (
    <div className="field">
      <label htmlFor={props.htmlFor}>
        {props.label} {props.required && <span className="req">*</span>}
      </label>
      {props.children}
      {props.hint && <div className="hint">{props.hint}</div>}
    </div>
  )
}

export function StatusChip({ status }: { status: string }) {
  return <span className={`chip ${status}`}>{STATUS_LABEL[status] ?? status}</span>
}

export function Notice({ kind = 'info', children }: { kind?: 'info' | 'warn' | 'error' | 'ok'; children: ReactNode }) {
  if (!children) return null
  return (
    <div className={`notice ${kind}`} role={kind === 'error' ? 'alert' : 'status'}>
      {children}
    </div>
  )
}

export function Loading({ text = 'Loading…' }: { text?: string }) {
  return <div className="spinner">{text}</div>
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="empty">{children}</div>
}

export function Segmented<T extends string>(props: {
  value: T
  onChange: (v: T) => void
  options: { value: T; label: string }[]
}) {
  return (
    <div className="segmented" role="tablist">
      {props.options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="tab"
          aria-selected={props.value === o.value}
          className={props.value === o.value ? 'on' : ''}
          onClick={() => props.onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

// ---------- Toast ----------
const ToastCtx = createContext<(msg: string) => void>(() => {})
export function ToastProvider({ children }: { children: ReactNode }) {
  const [msg, setMsg] = useState<string | null>(null)
  useEffect(() => {
    if (!msg) return
    const t = setTimeout(() => setMsg(null), 3200)
    return () => clearTimeout(t)
  }, [msg])
  return (
    <ToastCtx.Provider value={setMsg}>
      {children}
      {msg && (
        <div className="toast" role="status">
          {msg}
        </div>
      )}
    </ToastCtx.Provider>
  )
}
export const useToast = () => useContext(ToastCtx)

// ---------- Data loading hook ----------
export function useLoad<T>(fn: () => Promise<T>, deps: unknown[]) {
  const [data, setData] = useState<T | undefined>(undefined)
  const [error, setError] = useState<unknown>(null)
  const [loading, setLoading] = useState(true)
  const [tick, setTick] = useState(0)
  const reload = useCallback(() => setTick((t) => t + 1), [])
  useEffect(() => {
    let alive = true
    setLoading(true)
    fn()
      .then((d) => alive && (setData(d), setError(null)))
      .catch((e) => alive && setError(e))
      .finally(() => alive && setLoading(false))
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick])
  return { data, error, loading, reload, setData }
}

export function money(n: number | null | undefined): string {
  return 'RM ' + Number(n ?? 0).toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}
