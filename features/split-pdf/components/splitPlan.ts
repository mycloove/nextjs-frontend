import { parsePageRanges, PdfPageRangeError, stripPdfExtension } from '../../../lib/pdf/pdfUtils.ts'

/**
 * Split plans — pure, so every mode's answer to "which parts will this make?"
 * is tested once and shared by the mat, the tray and the request.
 *
 * A bundle is a 1-based inclusive [from, to] page range; one bundle becomes
 * one output part (or, with `combine`, all bundles become one part).
 * Relative `.ts` imports keep the colocated node:test suite bundler-free.
 */

export type Bundle = [number, number]

/** Blade positions (a cut after page N) → bundles covering the whole document. */
export function bundlesFromCuts(cuts: Iterable<number>, pageCount: number): Bundle[] {
  if (pageCount < 1) return []
  const points = [0, ...[...new Set(cuts)].filter((cut) => cut > 0 && cut < pageCount).sort((a, b) => a - b), pageCount]
  const out: Bundle[] = []
  for (let index = 0; index < points.length - 1; index += 1) out.push([points[index] + 1, points[index + 1]])
  return out
}

/** Picked pages → one bundle per contiguous run, in page order. */
export function bundlesFromPicked(picked: Iterable<number>): Bundle[] {
  const sorted = [...new Set(picked)].sort((a, b) => a - b)
  if (sorted.length === 0) return []
  const out: Bundle[] = []
  let from = sorted[0]
  let previous = sorted[0]
  for (const page of sorted.slice(1)) {
    if (page === previous + 1) {
      previous = page
      continue
    }
    out.push([from, previous])
    from = page
    previous = page
  }
  out.push([from, previous])
  return out
}

/** "Cut every N pages" → blade positions N, 2N, … before the last page. */
export function cutsEveryN(n: number, pageCount: number): number[] {
  const step = Math.floor(n)
  if (!Number.isFinite(step) || step < 1) return []
  const cuts: number[] = []
  for (let cut = step; cut < pageCount; cut += step) cuts.push(cut)
  return cuts
}

/**
 * Size mode. The browser cannot know each page's real byte cost before the
 * split, so this spreads the file size evenly across pages — an estimate the
 * UI labels as such; the tray shows real sizes once parts come back.
 */
export function cutsBySize(fileBytes: number, pageCount: number, targetMb: number): number[] {
  if (pageCount < 2 || !(targetMb > 0) || !(fileBytes > 0)) return []
  const perPage = fileBytes / pageCount
  const target = targetMb * 1048576
  const cuts: number[] = []
  let accumulated = 0
  for (let page = 1; page < pageCount; page += 1) {
    accumulated += perPage
    if (accumulated >= target) {
      cuts.push(page)
      accumulated = 0
    }
  }
  return cuts
}

/**
 * Bookmarks mark where a section STARTS, so the blade falls before the
 * bookmarked page: a bookmark on page 4 cuts after page 3.
 */
export function cutsFromBookmarks(bookmarkPages: Iterable<number>, pageCount: number): number[] {
  return [...new Set(bookmarkPages)].map((page) => page - 1).filter((cut) => cut > 0 && cut < pageCount).sort((a, b) => a - b)
}

export type CustomRanges =
  | { ok: true; bundles: Bundle[] }
  | { ok: false; message: string }

/**
 * Typed ranges ("1-3, 5, 8-") → bundles in the typed order, through the same
 * parser the server uses. A range that starts past the end is reported
 * rather than silently clamped away.
 */
export function parseCustomRanges(text: string, pageCount: number): CustomRanges {
  if (text.trim() === '') return { ok: true, bundles: [] }
  try {
    const bundles = parsePageRanges(text, pageCount)
    const beyond = text.replace(/\s/g, '').split(',').filter(Boolean)
      .map((part) => Number.parseInt(part.split('-')[0] || '1', 10))
      .find((from) => from > pageCount)
    if (beyond !== undefined) {
      return { ok: false, message: `Page ${beyond} does not exist — this PDF has ${pageCount} ${pageCount === 1 ? 'page' : 'pages'}.` }
    }
    return { ok: true, bundles }
  } catch (error) {
    return { ok: false, message: error instanceof PdfPageRangeError ? error.message : 'Invalid page range' }
  }
}

/** The ranges string sent to /api/split-pdf. */
export function bundlesToSpec(bundles: readonly Bundle[]): string {
  return bundles.map(([from, to]) => (from === to ? `${from}` : `${from}-${to}`)).join(', ')
}

/**
 * The exact file name a part downloads under — the tray shows this same
 * string, so what the user reads is what lands in their downloads folder.
 */
export function partFileName(sourceName: string, bundles: readonly Bundle[], index: number, combine: boolean): string {
  const base = stripPdfExtension(sourceName)
  if (combine) return `mycloove_${base}_selected_pages.pdf`
  const [from, to] = bundles[index]
  if (bundles.length === 1) return `mycloove_${base}_pages_${from}-${to}.pdf`
  return `mycloove_${base}_part${index + 1}_pages_${from}-${to}.pdf`
}

/** Byte counts for the tray; estimates are fractional, so always whole bytes. */
export function formatSize(bytes: number): string {
  if (bytes >= 1048576) return `${(bytes / 1048576).toFixed(1)} MB`
  if (bytes >= 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`
  return `${Math.round(bytes)} B`
}
