import { parsePageRanges } from '../../../lib/pdf/pdfUtils.ts'

/**
 * Page selection rules for PageGrid (roadmap §6.2) — pure, so the range box,
 * the grid and the keyboard model can never disagree about what is selected.
 *
 * Pages are 1-based everywhere, matching what people type ("1-3, 5") and what
 * `parsePageRanges` (lib/pdf/pdfUtils.ts, shared with the split/rotate
 * engines) accepts. Relative `.ts` import so node:test runs without a bundler.
 */

export type PageSet = ReadonlySet<number>

/** {1,2,3,5,8,9,10} → "1-3, 5, 8-10". Empty selection → "". */
export function selectionToRange(selected: PageSet): string {
  const pages = [...selected].sort((a, b) => a - b)
  const parts: string[] = []
  let start = pages[0]
  let previous = pages[0]
  for (let index = 1; index <= pages.length; index += 1) {
    const page = pages[index]
    if (page === previous + 1) {
      previous = page
      continue
    }
    if (start !== undefined) parts.push(start === previous ? `${start}` : `${start}-${previous}`)
    start = page
    previous = page
  }
  return parts.join(', ')
}

export type RangeParse =
  | { ok: true; pages: Set<number> }
  | { ok: false; message: string }

/**
 * "1-3, 5, 8-" → {1,2,3,5,8…pageCount}. Pages past the end are clamped by the
 * shared parser; a range that starts past the end is reported, not dropped.
 */
export function rangeToSelection(text: string, pageCount: number): RangeParse {
  if (text.trim() === '') return { ok: true, pages: new Set() }
  let ranges: Array<[number, number]>
  try {
    ranges = parsePageRanges(text, pageCount)
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : 'Invalid page range' }
  }
  const beyond = text
    .replace(/\s/g, '')
    .split(',')
    .map((part) => Number.parseInt(part.split('-')[0] || '1', 10))
    .find((from) => from > pageCount)
  if (beyond !== undefined) {
    return { ok: false, message: `Page ${beyond} does not exist — this PDF has ${pageCount} ${pageCount === 1 ? 'page' : 'pages'}.` }
  }
  const pages = new Set<number>()
  for (const [from, to] of ranges) {
    for (let page = from; page <= to; page += 1) pages.add(page)
  }
  return { ok: true, pages }
}

export function togglePage(selected: PageSet, page: number): Set<number> {
  const next = new Set(selected)
  if (next.has(page)) next.delete(page)
  else next.add(page)
  return next
}

/** Shift-click / Shift+arrow: everything between the anchor and the target, inclusive. */
export function selectSpan(selected: PageSet, anchor: number, target: number, additive: boolean): Set<number> {
  const next = additive ? new Set(selected) : new Set<number>()
  const [from, to] = anchor <= target ? [anchor, target] : [target, anchor]
  for (let page = from; page <= to; page += 1) next.add(page)
  return next
}

export function selectAllPages(pageCount: number): Set<number> {
  return new Set(Array.from({ length: pageCount }, (_, index) => index + 1))
}

export function invertSelection(selected: PageSet, pageCount: number): Set<number> {
  const next = new Set<number>()
  for (let page = 1; page <= pageCount; page += 1) if (!selected.has(page)) next.add(page)
  return next
}

/**
 * Where focus goes for a key in a wrapping grid of `columns` per row.
 * Returns null for keys the grid does not handle.
 */
export function moveFocus(current: number, key: string, columns: number, pageCount: number): number | null {
  const cols = Math.max(1, columns)
  let next: number
  switch (key) {
    case 'ArrowRight': next = current + 1; break
    case 'ArrowLeft': next = current - 1; break
    case 'ArrowDown': next = current + cols; break
    case 'ArrowUp': next = current - cols; break
    case 'Home': next = 1; break
    case 'End': next = pageCount; break
    default: return null
  }
  return Math.min(pageCount, Math.max(1, next))
}

/** "3 of 12 pages selected" — the grid's live summary. */
export function describeSelection(selected: PageSet, pageCount: number): string {
  const count = selected.size
  if (count === 0) return `No pages selected of ${pageCount}`
  if (count === pageCount) return `All ${pageCount} ${pageCount === 1 ? 'page' : 'pages'} selected`
  return `${count} of ${pageCount} ${pageCount === 1 ? 'page' : 'pages'} selected`
}
