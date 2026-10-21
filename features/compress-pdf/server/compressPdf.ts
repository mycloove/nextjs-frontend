import { PDFDocument, PDFName } from 'pdf-lib'

/**
 * Compress engine (server-only) — one half of the old 4-in-1 pdf-tools
 * module, now its own focused tool with its own endpoint (/api/compress-pdf).
 * Only `app/api/compress-pdf/route.ts` imports this file.
 */

export class CompressPdfValidationError extends Error {
  readonly code: string
  readonly status: number
  constructor(message: string, code: string, status = 400) {
    super(message)
    this.name = 'CompressPdfValidationError'
    this.code = code
    this.status = status
  }
}

export type CompressLevel = 'light' | 'strong' | 'aggressive'

/**
 * Structural compression — the honest kind. pdf-lib cannot re-encode images,
 * so this shrinks the document skeleton: object streams pack small objects,
 * `strong` additionally drops metadata, and `aggressive` also removes the
 * optional catalog trees (named destinations / embedded files / JavaScript,
 * bookmarks) plus page annotations. Scanned PDFs barely shrink; text-heavy
 * PDFs shrink noticeably. The UI states this instead of promising image
 * downsampling it does not do.
 */
export async function compressPdf(
  file: File,
  level: CompressLevel,
): Promise<{ bytes: Uint8Array; originalBytes: number }> {
  if (level !== 'light' && level !== 'strong' && level !== 'aggressive') {
    throw new CompressPdfValidationError(
      'Compression level must be "light", "strong" or "aggressive"',
      'invalid_level',
    )
  }
  const originalBytes = file.size
  const doc = await PDFDocument.load(await file.arrayBuffer()).catch(() => {
    throw new CompressPdfValidationError(
      `"${file.name}" could not be read — it may be encrypted or corrupted`,
      'unreadable_pdf',
    )
  })
  if (level === 'strong' || level === 'aggressive') {
    // Called individually, not chained — some pdf-lib builds return
    // undefined from the info setters, which breaks a method chain.
    doc.setTitle('')
    doc.setAuthor('')
    doc.setSubject('')
    doc.setKeywords([])
  }
  if (level === 'aggressive') {
    // Drop the optional catalog trees and per-page annotations. Each delete is
    // guarded because a document may not carry that entry at all, and a
    // removed reference simply stops being serialized (pdf-lib writes the
    // reachable object graph, so the dropped objects fall away with it).
    const catalog = doc.catalog
    for (const key of ['Names', 'Outlines', 'AcroForm', 'Metadata'] as const) {
      try {
        catalog.delete(PDFName.of(key))
      } catch {
        // entry absent — nothing to drop
      }
    }
    for (const page of doc.getPages()) {
      try {
        page.node.delete(PDFName.of('Annots'))
      } catch {
        // page has no annotations
      }
    }
  }

  const bytes = await doc.save({ useObjectStreams: true })
  return { bytes, originalBytes }
}