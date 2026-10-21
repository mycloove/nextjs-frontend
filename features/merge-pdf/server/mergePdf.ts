import { PDFDocument } from 'pdf-lib'

/**
 * Merge engine (server-only) — one half of the old 4-in-1 pdf-tools module,
 * now its own focused tool with its own endpoint (/api/merge-pdf). Pages are
 * copied between documents, never rasterised, so text stays selectable and
 * images keep their bytes. Only `app/api/merge-pdf/route.ts` imports this.
 */

/** Caller-fixable problems; the route maps them to stable status/code. */
export class MergePdfValidationError extends Error {
  readonly code: string
  readonly status: number
  constructor(message: string, code: string, status = 400) {
    super(message)
    this.name = 'MergePdfValidationError'
    this.code = code
    this.status = status
  }
}

export interface MergeResult {
  bytes: Uint8Array
  sourceCount: number
}

/**
 * Merge documents in the caller's order. One unreadable PDF fails the whole
 * job — unlike images, a missing chapter silently dropped is worse than a
 * named, retryable error.
 */
export async function mergePdfs(files: File[]): Promise<MergeResult> {
  if (files.length < 2) {
    throw new MergePdfValidationError('Merging needs at least two PDFs', 'merge_needs_two')
  }

  const merged = await PDFDocument.create()
  for (const file of files) {
    try {
      const src = await PDFDocument.load(await file.arrayBuffer())
      const pages = await merged.copyPages(src, src.getPageIndices())
      pages.forEach((page) => merged.addPage(page))
    } catch {
      throw new MergePdfValidationError(
        `"${file.name}" could not be read — it may be encrypted or corrupted`,
        'unreadable_pdf',
      )
    }
  }
  return { bytes: await merged.save({ useObjectStreams: true }), sourceCount: files.length }
}