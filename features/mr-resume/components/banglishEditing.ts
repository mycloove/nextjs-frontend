/** Exact, session-local source ranges. A stale range is discarded, never guessed. */
export type BanglishSource = {
  start: number
  end: number
  source: string
  reading: string
}

const WORD_CHARACTER = /[\p{L}\p{M}\p{N}\u200c\u200d]/u

export function validBanglishSources(value: string, sources: readonly BanglishSource[]): BanglishSource[] {
  return sources.filter((item) => Number.isInteger(item.start) && Number.isInteger(item.end)
    && item.start >= 0 && item.end > item.start && item.end <= value.length
    && value.slice(item.start, item.end) === item.reading
    && (item.start === 0 || !WORD_CHARACTER.test(value[item.start - 1]))
    && (item.end === value.length || !WORD_CHARACTER.test(value[item.end])))
    .sort((a, b) => a.start - b.start)
}

/** Rebase untouched words after an edit; replacements invalidate overlapping sources. */
export function rebaseBanglishSources(previous: string, next: string, sources: readonly BanglishSource[]): BanglishSource[] {
  if (previous === next) return validBanglishSources(next, sources)
  let start = 0
  while (start < previous.length && start < next.length && previous[start] === next[start]) start++
  let oldEnd = previous.length
  let newEnd = next.length
  while (oldEnd > start && newEnd > start && previous[oldEnd - 1] === next[newEnd - 1]) {
    oldEnd--
    newEnd--
  }
  const delta = newEnd - oldEnd
  const rebased = validBanglishSources(previous, sources).flatMap((item) => {
    if (item.end <= start) return [item]
    if (item.start >= oldEnd) return [{ ...item, start: item.start + delta, end: item.end + delta }]
    return []
  })
  return validBanglishSources(next, rebased)
}

export function rememberBanglishSource(value: string, sources: readonly BanglishSource[], source: BanglishSource): BanglishSource[] {
  const remaining = sources.filter((item) => item.end <= source.start || item.start >= source.end)
  return validBanglishSources(value, [...remaining, source]).slice(-500)
}

export function replaceBanglishSource(value: string, source: BanglishSource, reading: string, caret = source.end, separator: '' | ' ' = ''): {
  next: string
  caret: number
  source: BanglishSource
} | null {
  if (!reading || !Number.isInteger(caret) || caret < 0 || caret > value.length || !validBanglishSources(value, [source]).length) return null
  const delta = reading.length - (source.end - source.start)
  let next = value.slice(0, source.start) + reading + value.slice(source.end)
  let nextCaret = caret > source.end ? caret + delta : source.start + reading.length
  if (separator) {
    // Selecting a converted candidate with Space consumes its existing separator
    // instead of inserting a second space or moving back in front of it.
    if (next[nextCaret] === separator) nextCaret++
    else if (!(nextCaret > source.start + reading.length && next[nextCaret - 1] === separator)) {
      next = next.slice(0, nextCaret) + separator + next.slice(nextCaret)
      nextCaret++
    }
  }
  return {
    next,
    // A suggestion chosen after Space keeps the caret after that space, so the
    // next word cannot be accidentally appended to the converted word.
    caret: nextCaret,
    source: { ...source, reading, end: source.start + reading.length },
  }
}

/** Restore the whole converted word, not a Bengali combining mark or adjacent text. */
export function restoreBanglishAtCaret(value: string, caret: number, sources: readonly BanglishSource[]) {
  if (!Number.isInteger(caret) || caret < 0 || caret > value.length) return null
  const source = validBanglishSources(value, sources).find((item) => caret > item.start
    && (caret <= item.end || (caret === item.end + 1 && /[ \t]/u.test(value[item.end] ?? ''))))
  return source ? replaceBanglishSource(value, source, source.source) : null
}

/** A typed separator is a single insertion, not a paste, deletion, or selected-text replacement. */
export function isSingleTypingInsertion(previous: string, next: string, caret: number): boolean {
  return Number.isInteger(caret) && caret > 0 && caret <= next.length
    && next.length === previous.length + 1
    && next.slice(0, caret - 1) === previous.slice(0, caret - 1)
    && next.slice(caret) === previous.slice(caret - 1)
}
