import { PDFDocument } from 'pdf-lib'
import { parsePageRanges, PdfPageRangeError, stripPdfExtension } from '../../../lib/pdf/pdfUtils.ts'

/**
 * Split engine (server-only) — one half of the old 4-in-1 pdf-tools module,
 * now its own focused tool with its own endpoint (/api/split-pdf). Only
 * `app/api/split-pdf/route.ts` imports this file.
 *
 * The page-range grammar lives in `lib/pdf/pdfUtils.ts` — deliberately shared
 * with rotate-pdf (CLAUDE.md §0.2). The shared parser's stable codes are
 * re-surfaced under this module's error class so the route catches one type.
 *
 * The relative `lib/` import keeps the colocated `node:test` suite runnable
 * without a bundler (same pattern as the pdf-editor utils).
 */

export class SplitPdfValidationError extends Error {
  readonly code: string
  readonly status: number
  constructor(message: string, code: string, status = 400) {
    super(message)
    this.name = 'SplitPdfValidationError'
    this.code = code
    this.status = status
  }
}

export interface SplitResult {
  /** One PDF per requested range, in the caller's order. */
  parts: Array<{ name: string; bytes: Uint8Array }>
  pageCount: number
}

/** Cut a document into one PDF per requested range. */
export async function splitPdf(file: File, rangeSpec: string): Promise<SplitResult> {
  const src = await PDFDocument.load(await file.arrayBuffer()).catch(() => {
    throw new SplitPdfValidationError(
      `"${file.name}" could not be read — it may be encrypted or corrupted`,
      'unreadable_pdf',
    )
  })
  const pageCount = src.getPageCount()

  let ranges: Array<[number, number]>
  try {
    ranges = parsePageRanges(rangeSpec, pageCount)
  } catch (error) {
    if (error instanceof PdfPageRangeError) {
      throw new SplitPdfValidationError(error.message, error.code, error.status)
    }
    throw error
  }

  const base = stripPdfExtension(file.name)
  const parts: SplitResult['parts'] = []
  for (let i = 0; i < ranges.length; i += 1) {
    const [from, to] = ranges[i]
    const out = await PDFDocument.create()
    const indices = Array.from({ length: to - from + 1 }, (_, offset) => from - 1 + offset)
    const pages = await out.copyPages(src, indices)
    pages.forEach((page) => out.addPage(page))
    const suffix = ranges.length > 1 ? `_part${i + 1}` : ''
    parts.push({
      name: `${base}_pages_${from}-${to}${suffix}.pdf`,
      bytes: await out.save({ useObjectStreams: true }),
    })
  }
  return { parts, pageCount }
}