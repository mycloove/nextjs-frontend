/**
 * Display formatting for the bench.
 *
 * Every function here runs on the server and its output crosses to the client as
 * a finished string. That is not tidiness, it is correctness: the desks are
 * client components, so they are also rendered on the server, and anything that
 * reads the clock would be evaluated twice — once per runtime — and produce two
 * different answers in two different timezones. Formatting once removes the
 * whole class of hydration mismatch instead of guarding against it.
 */

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

export function shortDate(iso: string) {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return '—'
  return date.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
}

export function relativeTime(iso: string, now = Date.now()) {
  const then = new Date(iso).getTime()
  if (Number.isNaN(then)) return 'unknown'
  const delta = now - then
  if (delta < MINUTE) return 'just now'
  if (delta < HOUR) {
    const minutes = Math.floor(delta / MINUTE)
    return `${minutes} minute${minutes === 1 ? '' : 's'} ago`
  }
  if (delta < DAY) {
    const hours = Math.floor(delta / HOUR)
    return `${hours} hour${hours === 1 ? '' : 's'} ago`
  }
  const days = Math.floor(delta / DAY)
  if (days < 30) return `${days} day${days === 1 ? '' : 's'} ago`
  const months = Math.floor(days / 30)
  return `${months} month${months === 1 ? '' : 's'} ago`
}

/**
 * When a rolling window starts to free up. `oldest` is the oldest counted call,
 * so the first call becomes spendable again when the window slides past it.
 */
export function windowClears(oldest: string | null, now = Date.now()) {
  if (!oldest) return null
  const then = new Date(oldest).getTime()
  if (Number.isNaN(then)) return null
  const clearsAt = then + DAY
  const remaining = clearsAt - now
  if (remaining <= 0) return 'any moment'
  if (remaining < HOUR) return `in ${Math.ceil(remaining / MINUTE)} min`
  return `in ${Math.ceil(remaining / HOUR)} h`
}

export function count(value: number) {
  return value.toLocaleString('en-US')
}

export function plural(value: number, one: string, many = `${one}s`) {
  return `${count(value)} ${value === 1 ? one : many}`
}

export function shortId(id: string) {
  return id.length > 10 ? `${id.slice(0, 8)}…` : id
}

/** Milliseconds to "1 h 12 m" — used only where the number itself is the point. */
export function duration(ms: number) {
  const total = Math.max(0, Math.round(ms / 1000))
  const minutes = Math.floor(total / 60)
  const seconds = total % 60
  if (!minutes) return `${seconds}s`
  return `${minutes}m ${seconds}s`
}