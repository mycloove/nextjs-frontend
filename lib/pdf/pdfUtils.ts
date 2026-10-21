/**
 * Shared structural-PDF helpers (CLAUDE.md §0.2/§4 — deliberately promoted to
 * `lib/`): the page-range grammar and PDF sniffing are needed verbatim by the
 * split-pdf and rotate-pdf engines, and `isPdfFile` by every route in the
 * family. One feature module's internal logic must never be another module's
 * dependency, so the genuinely shared pieces live here.
 *
 * Behaviour is a faithful port of the parser that shipped inside the old
 * 4-in-1 pdf-tools engine — pinned by the colocated `pdfUtils.test.ts`.
 */

/** Caller-fixable problem with a stable code + HTTP status for the route. */
export class PdfPageRangeError extends Error {
  readonly code: string
  readonly status: number
  constructor(message: string, code: string, status = 400) {
    super(message)
    this.name = 'PdfPageRangeError'
    this.code = code
    this.status = status
  }
}

const PDF_MIME_PREFIX = 'application/pdf'

/** MIME or extension sniffing — browser files often carry only the `.pdf` name. */
export function isPdfFile(file: File) {
  if (file.type.toLowerCase() === PDF_MIME_PREFIX) return true
  return file.name.toLowerCase().endsWith('.pdf')
}

/** Parse "1-3, 5, 8-" into 1-based inclusive ranges, clamped to `pageCount`. */
export function parsePageRanges(spec: string, pageCount: number): Array<[number, number]> {
  const cleaned = spec.replace(/\s/g, '')
  if (!cleaned) throw new PdfPageRangeError('Page range is empty', 'empty_range')
  if (!/^[0-9,\-]+$/.test(cleaned)) {
    throw new PdfPageRangeError('Page range may only contain numbers, commas and dashes', 'invalid_range')
  }

  const ranges: Array<[number, number]> = []
  for (const part of cleaned.split(',')) {
    if (!part) continue
    const [rawFrom, rawTo] = part.split('-')
    const from = rawFrom === '' ? 1 : Number.parseInt(rawFrom, 10)
    // "8" means page 8; "8-" means page 8 to the end; "-3" means 1 to 3.
    let to: number
    if (rawTo === undefined || rawTo === '') to = rawTo === undefined ? from : pageCount
    else to = Number.parseInt(rawTo, 10)
    if (!Number.isFinite(from) || !Number.isFinite(to) || from < 1 || to < from) {
      throw new PdfPageRangeError(`Invalid page range: "${part}"`, 'invalid_range')
    }
    ranges.push([Math.min(from, pageCount), Math.min(to, pageCount)])
  }
  if (!ranges.length) throw new PdfPageRangeError('Page range is empty', 'empty_range')
  return ranges
}

/** File name without its extension ("Report 2024.pdf" → "Report 2024"). */
export function stripPdfExtension(name: string) {
  const dot = name.lastIndexOf('.')
  return dot > 0 ? name.slice(0, dot) : name
}