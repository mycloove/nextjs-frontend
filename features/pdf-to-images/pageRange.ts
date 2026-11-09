/**
 * Page-range grammar for PDF → Images — a line-for-line mirror of
 * `parse_page_range` in pdf-microservice/features/pdf_to_images.py, so the
 * browser can tell the user exactly what the engine will do before a single
 * byte is uploaded. The engine stays the authority; this copy is UX.
 *
 * Deliberately not `lib/pdf/pdfUtils.ts#parsePageRanges`: that grammar clamps
 * out-of-range pages (right for split/rotate), while this one refuses them —
 * someone who types "10-20" for a 12-page file should learn it has 12 pages,
 * not quietly receive 3 images.
 *
 * Grammar: blank or "all" = every page; otherwise comma-separated parts, each
 * `N`, `A-B`, or `A-` (to the end). Result: sorted, de-duplicated, 1-based.
 */

export type PageRangeResult =
  | { ok: true; pages: number[]; all: boolean }
  | { ok: false; error: string; code: 'invalid_range' | 'page_out_of_range' }

const PART = /^(\d+)\s*(?:-\s*(\d*))?$/

const plural = (n: number) => `${n} page${n === 1 ? '' : 's'}`

export function parsePageRange(spec: string, pageCount: number): PageRangeResult {
  const text = spec.trim()
  if (!text || text.toLowerCase() === 'all') {
    return { ok: true, pages: Array.from({ length: pageCount }, (_, i) => i + 1), all: true }
  }

  const pages = new Set<number>()
  for (const raw of text.split(',')) {
    const part = raw.trim()
    if (!part) continue
    const match = PART.exec(part)
    if (!match) {
      return { ok: false, code: 'invalid_range', error: `"${part}" is not a page or range — use a format like 1-3, 5, 8-.` }
    }
    const start = Number(match[1])
    const openEnd = match[2] === ''
    const end = openEnd ? pageCount : Number(match[2] ?? start)
    if (start < 1) return { ok: false, code: 'invalid_range', error: 'Page numbers start at 1.' }
    if (end < start) {
      return { ok: false, code: 'invalid_range', error: `"${part}" runs backwards — write it as ${end}-${start}.` }
    }
    if (start > pageCount || end > pageCount) {
      return {
        ok: false,
        code: 'page_out_of_range',
        error: `"${part}" goes past the last page — this document has ${plural(pageCount)}.`,
      }
    }
    for (let page = start; page <= end; page += 1) pages.add(page)
  }
  if (pages.size === 0) return { ok: false, code: 'invalid_range', error: 'Enter at least one page number.' }
  const sorted = [...pages].sort((a, b) => a - b)
  return { ok: true, pages: sorted, all: sorted.length === pageCount }
}

/** "1–3, 5, 8–12" — compact human summary of a page list. */
export function describePages(pages: number[]): string {
  const runs: string[] = []
  let i = 0
  while (i < pages.length) {
    let j = i
    while (j + 1 < pages.length && pages[j + 1] === pages[j] + 1) j += 1
    runs.push(i === j ? `${pages[i]}` : `${pages[i]}–${pages[j]}`)
    i = j + 1
  }
  return runs.join(', ')
}
