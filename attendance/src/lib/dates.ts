// All dates in this app are Malaysian dates (Asia/Kuala_Lumpur, UTC+8, no DST).
// Plain dates are handled as 'YYYY-MM-DD' strings to avoid time-zone surprises.

export const TZ = 'Asia/Kuala_Lumpur'

const dateFmt = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' })

/** Malaysian calendar date of an instant, as 'YYYY-MM-DD'. */
export function klDate(instant: Date | string = new Date()): string {
  return dateFmt.format(typeof instant === 'string' ? new Date(instant) : instant)
}

export function todayKL(): string {
  return klDate(new Date())
}

function parts(d: string): [number, number, number] {
  const [y, m, day] = d.split('-').map(Number)
  return [y, m, day]
}

function toUTC(d: string): Date {
  const [y, m, day] = parts(d)
  return new Date(Date.UTC(y, m - 1, day))
}

function fromUTC(dt: Date): string {
  return dt.toISOString().slice(0, 10)
}

export function addDays(d: string, n: number): string {
  const dt = toUTC(d)
  dt.setUTCDate(dt.getUTCDate() + n)
  return fromUTC(dt)
}

/** ISO weekday: 1 = Monday ... 7 = Sunday */
export function isoDow(d: string): number {
  const w = toUTC(d).getUTCDay()
  return w === 0 ? 7 : w
}

export function eachDay(from: string, to: string): string[] {
  const out: string[] = []
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d)
  return out
}

export function daysBetween(from: string, to: string): number {
  return Math.round((toUTC(to).getTime() - toUTC(from).getTime()) / 86400000)
}

export function startOfWeek(d: string): string {
  return addDays(d, 1 - isoDow(d))
}

export function startOfMonth(d: string): string {
  return d.slice(0, 8) + '01'
}

export function endOfMonth(d: string): string {
  const [y, m] = parts(d)
  return fromUTC(new Date(Date.UTC(y, m, 0)))
}

export function addMonths(d: string, n: number): string {
  const [y, m] = parts(d)
  return fromUTC(new Date(Date.UTC(y, m - 1 + n, 1)))
}

export const DAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']
export const DAY_SHORT = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

export function formatDate(d: string | null | undefined, opts: { weekday?: boolean; year?: boolean } = {}): string {
  if (!d) return ''
  const dt = toUTC(d.slice(0, 10))
  return dt.toLocaleDateString('en-GB', {
    timeZone: 'UTC',
    weekday: opts.weekday === false ? undefined : 'short',
    day: 'numeric',
    month: 'short',
    year: opts.year === false ? undefined : 'numeric',
  })
}

export function formatMonth(d: string): string {
  return toUTC(startOfMonth(d)).toLocaleDateString('en-GB', { timeZone: 'UTC', month: 'long', year: 'numeric' })
}

export function formatTime(instant: string | Date | null | undefined): string {
  if (!instant) return ''
  return new Date(instant).toLocaleTimeString('en-GB', { timeZone: TZ, hour: 'numeric', minute: '2-digit', hour12: true })
}

export function formatDateTime(instant: string | Date | null | undefined): string {
  if (!instant) return ''
  const iso = typeof instant === 'string' ? instant : instant.toISOString()
  return `${formatDate(klDate(iso), { weekday: false })}, ${formatTime(iso)}`
}

export function formatDateRange(from: string, to: string): string {
  if (from === to) return formatDate(from)
  return `${formatDate(from, { year: from.slice(0, 4) !== to.slice(0, 4) })} – ${formatDate(to)}`
}

/** Hours between two instants, 2 decimals. */
export function hoursBetween(a: string, b: string): number {
  return Math.round(((new Date(b).getTime() - new Date(a).getTime()) / 3600000) * 100) / 100
}

export function formatHours(h: number | null | undefined): string {
  if (h == null || Number.isNaN(h)) return '–'
  const total = Math.round(h * 60)
  const hh = Math.floor(total / 60)
  const mm = total % 60
  return `${hh}h ${String(mm).padStart(2, '0')}m`
}
