'use client'

/**
 * Recent-conversion history, browser-local.
 *
 * No accounts, no server round-trip: a localStorage list of what the user
 * just made, shown as "Pick up where you left off" and re-downloadable for
 * outputs the tool keeps in memory during the session. Capped and versioned
 * so a future schema change can rotate the key instead of migrating junk.
 */
const STORAGE_KEY = 'mycloove-recent-conversions-v1'
const MAX_ENTRIES = 20

export interface RecentConversion {
  /** Tool id from `lib/tools/registry`. */
  toolId: string
  label: string
  filename: string
  sizeBytes: number
  /** Epoch ms. Newest first. */
  at: number
}

function isBrowser() {
  return typeof window !== 'undefined'
}

export function getRecentConversions(): RecentConversion[] {
  if (!isBrowser()) return []
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed.filter((entry): entry is RecentConversion =>
      typeof entry === 'object' && entry !== null &&
      typeof (entry as RecentConversion).toolId === 'string' &&
      typeof (entry as RecentConversion).filename === 'string' &&
      typeof (entry as RecentConversion).at === 'number',
    )
  } catch {
    // Corrupt or blocked storage is not worth surfacing — history is a bonus.
    return []
  }
}

export function addRecentConversion(entry: Omit<RecentConversion, 'at'>) {
  if (!isBrowser()) return
  const next: RecentConversion[] = [
    { ...entry, at: Date.now() },
    ...getRecentConversions().filter(
      (existing) => !(existing.toolId === entry.toolId && existing.filename === entry.filename),
    ),
  ].slice(0, MAX_ENTRIES)
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  } catch {
    // Quota-exceeded or private mode: history is best-effort by design.
  }
}

export function clearRecentConversions() {
  if (!isBrowser()) return
  try {
    window.localStorage.removeItem(STORAGE_KEY)
  } catch {
    // Ignore — same reasoning as above.
  }
}
