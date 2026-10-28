export const BANGLISH_LEARN_KEY = 'mr-resume:banglish-learn:v1'
export type LearnedWords = Record<string, string>
export type SpellingChoice = { source: string; reading: string; count: number }

const MAX_ENTRIES = 500
const MAX_PAYLOAD = 160000
const RESERVED_KEYS = new Set(['constructor', 'prototype', '__proto__'])

function deviceStorage(): Storage | undefined {
  try { return typeof window === 'undefined' ? undefined : window.localStorage }
  catch { return undefined }
}

export function isBengaliSpelling(reading: unknown): reading is string {
  return typeof reading === 'string' && reading.length > 0 && reading.normalize('NFC').length <= 80
    && /^[\u0980-\u09ff\u200c\u200d]+$/u.test(reading)
    && /^\p{L}[\p{L}\p{M}\u200c\u200d]*$/u.test(reading)
}

export function isValidSpellingChoice(source: unknown, reading: unknown): source is string {
  return typeof source === 'string' && source.length > 0 && source.length <= 40
    && /^[a-zA-Z^]+(?:,,[a-zA-Z^]*)*$/u.test(source) && /[a-z]/iu.test(source)
    && !RESERVED_KEYS.has(source.toLowerCase()) && isBengaliSpelling(reading)
}

function readChoices(storage: Pick<Storage, 'getItem'> | undefined): SpellingChoice[] {
  if (!storage) return []
  try {
    const raw = storage.getItem(BANGLISH_LEARN_KEY)
    if (!raw || raw.length > MAX_PAYLOAD) return []
    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object') return []
    const payload = parsed as { version?: unknown; words?: unknown }
    if (payload.version !== 1 || !Array.isArray(payload.words)) return []
    const unique = new Map<string, SpellingChoice>()
    for (const item of payload.words.slice(-MAX_ENTRIES)) {
      if (!item || typeof item !== 'object') continue
      const entry = item as Partial<SpellingChoice>
      if (!isValidSpellingChoice(entry.source, entry.reading)) continue
      const source = entry.source.toLowerCase()
      unique.set(source, { source, reading: entry.reading!, count: typeof entry.count === 'number' && Number.isFinite(entry.count) ? Math.max(1, Math.min(1000000, Math.floor(entry.count))) : 1 })
    }
    return [...unique.values()]
  } catch { return [] }
}

/** Optional device storage never prevents typing, including SSR/private-browser paths. */
export function loadLearnedWords(storage: Pick<Storage, 'getItem'> | undefined = deviceStorage()): LearnedWords {
  return Object.fromEntries(readChoices(storage).map(({ source, reading }) => [source, reading]))
}

function currentChoices(storage: Pick<Storage, 'getItem'> | undefined, session?: readonly SpellingChoice[]): SpellingChoice[] {
  const entries = new Map<string, SpellingChoice>()
  // A live session can be newer than disk after a refused write or removal.
  // Do not resurrect its forgotten words from that stale stored snapshot.
  for (const entry of session ?? readChoices(storage)) {
    if (!isValidSpellingChoice(entry.source, entry.reading)) continue
    const source = entry.source.toLowerCase()
    entries.delete(source)
    entries.set(source, { source, reading: entry.reading, count: Number.isFinite(entry.count) ? Math.max(1, Math.min(1000000, Math.floor(entry.count))) : 1 })
  }
  return [...entries.values()].slice(-MAX_ENTRIES)
}

function persistChoices(choices: SpellingChoice[], storage: Pick<Storage, 'setItem'> | undefined) {
  const words = Object.fromEntries(choices.map((entry) => [entry.source, entry.reading]))
  try {
    if (!storage) return { words, choices, saved: false }
    storage.setItem(BANGLISH_LEARN_KEY, JSON.stringify({ version: 1, words: choices }))
    return { words, choices, saved: true }
  } catch { return { words, choices, saved: false } }
}

export function saveLearnedWord(source: string, reading: string, storage: Pick<Storage, 'getItem' | 'setItem'> | undefined = deviceStorage(), session?: readonly SpellingChoice[]) {
  const entries = currentChoices(storage, session)
  const key = source.trim().toLowerCase()
  const spelling = reading.trim().normalize('NFC')
  if (!isValidSpellingChoice(key, spelling)) return { words: Object.fromEntries(entries.map((entry) => [entry.source, entry.reading])), choices: entries, saved: false, accepted: false }
  const prior = entries.find((entry) => entry.source === key)
  const choices = [...entries.filter((entry) => entry.source !== key), { source: key, reading: spelling, count: Math.min(1000000, (prior?.count ?? 0) + 1) }].slice(-MAX_ENTRIES)
  return { ...persistChoices(choices, storage), accepted: true }
}

/** Removing one mistaken preference must not force a guest to lose their whole bank. */
export function forgetLearnedWord(source: string, storage: Pick<Storage, 'getItem' | 'setItem'> | undefined = deviceStorage(), session?: readonly SpellingChoice[]) {
  const choices = currentChoices(storage, session).filter((entry) => entry.source !== source.trim().toLowerCase())
  return persistChoices(choices, storage)
}

/** Keep recency for eviction across reloads. The guide sorts a copy by choice
 * count; its display order must never decide which remembered word is evicted. */
export function loadSpellingChoices(storage: Pick<Storage, 'getItem'> | undefined = deviceStorage()): SpellingChoice[] {
  return readChoices(storage)
}

export function clearLearnedWords(storage: Pick<Storage, 'removeItem'> | undefined = deviceStorage()): boolean {
  try {
    if (!storage) return false
    storage.removeItem(BANGLISH_LEARN_KEY)
    return true
  } catch { return false }
}
