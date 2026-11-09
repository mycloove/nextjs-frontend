import { PDFDocument, PDFName, degrees } from 'pdf-lib'
import { parsePageRanges, PdfPageRangeError } from '../../../lib/pdf/pdfUtils.ts'

/**
 * Rotate engine (server-only) — one half of the old 4-in-1 pdf-tools module,
 * now its own focused tool with its own endpoint (/api/rotate-pdf). Only
 * `app/api/rotate-pdf/route.ts` imports this file.
 *
 * The page-range grammar lives in `lib/pdf/pdfUtils.ts` — deliberately shared
 * with split-pdf (CLAUDE.md §0.2). The relative `lib/` import keeps the
 * colocated `node:test` suite runnable without a bundler (same pattern as the
 * pdf-editor utils).
 */

export class RotatePdfValidationError extends Error {
  readonly code: string
  readonly status: number
  constructor(message: string, code: string, status = 400) {
    super(message)
    this.name = 'RotatePdfValidationError'
    this.code = code
    this.status = status
  }
}

export const ROTATE_ANGLES = new Set([90, 180, 270])

export interface RotatePdfPagePlanItem {
  originalIndex: number
  rotation: number
}

export function parseRotatePdfPagePlan(raw: string): RotatePdfPagePlanItem[] {
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) throw new Error('not an array')
    return parsed as RotatePdfPagePlanItem[]
  } catch {
    throw new RotatePdfValidationError('The page plan is not valid', 'invalid_page_plan')
  }
}

/** Rotate pages by a quarter-turn multiple. `rangeSpec` '' means all pages. */
export async function rotatePdf(
  file: File,
  angle: number,
  rangeSpec: string,
): Promise<{ bytes: Uint8Array; rotated: number }> {
  if (!ROTATE_ANGLES.has(angle)) {
    throw new RotatePdfValidationError('Angle must be 90, 180 or 270', 'invalid_angle')
  }
  const doc = await PDFDocument.load(await file.arrayBuffer()).catch(() => {
    throw new RotatePdfValidationError(
      `"${file.name}" could not be read — it may be encrypted or corrupted`,
      'unreadable_pdf',
    )
  })
  const pageCount = doc.getPageCount()

  const indices = (() => {
    if (!rangeSpec.trim()) return doc.getPageIndices()
    try {
      return parsePageRanges(rangeSpec, pageCount).flatMap(([from, to]) =>
        Array.from({ length: to - from + 1 }, (_, offset) => from - 1 + offset))
    } catch (error) {
      if (error instanceof PdfPageRangeError) {
        throw new RotatePdfValidationError(error.message, error.code, error.status)
      }
      throw error
    }
  })()

  let rotated = 0
  for (const index of indices) {
    const page = doc.getPage(index)
    page.setRotation(degrees((page.getRotation().angle + angle) % 360))
    rotated += 1
  }
  return { bytes: await doc.save({ useObjectStreams: true }), rotated }
}

/* Page attributes a leaf may inherit from its parent node (PDF 32000 §7.7.3.4).
   Re-parenting a page loses them unless they are written onto the leaf first. */
const INHERITABLE = ['Resources', 'MediaBox', 'CropBox', 'Rotate'].map((name) => PDFName.of(name))

/**
 * Apply the page-bench plan. The plan lists every original page exactly once,
 * in its desired final order, and carries its extra clockwise rotation.
 *
 * Pages are reordered and turned *in place* inside the uploaded document —
 * never copied into a fresh one. Copying used to drop everything that lives
 * outside the pages (bookmarks, form fields, named destinations, document
 * metadata) and left in-document links pointing at invisible duplicates; a
 * rotate is not allowed to cost the user any of that.
 */
export async function rotatePdfPagePlan(
  file: File,
  plan: RotatePdfPagePlanItem[],
): Promise<{ bytes: Uint8Array; rotated: number }> {
  const doc = await PDFDocument.load(await file.arrayBuffer(), { updateMetadata: false }).catch(() => {
    throw new RotatePdfValidationError(
      `"${file.name}" could not be read — it may be encrypted or corrupted`,
      'unreadable_pdf',
    )
  })
  const pageCount = doc.getPageCount()
  if (!Array.isArray(plan) || plan.length !== pageCount) {
    throw new RotatePdfValidationError('The page plan must include every page exactly once', 'invalid_page_plan')
  }
  const originals = new Set<number>()
  for (const item of plan) {
    if (!item || !Number.isInteger(item.originalIndex) || item.originalIndex < 0 || item.originalIndex >= pageCount || originals.has(item.originalIndex)) {
      throw new RotatePdfValidationError('The page plan contains an invalid page order', 'invalid_page_plan')
    }
    if (!Number.isInteger(item.rotation) || ![0, 90, 180, 270].includes(item.rotation)) {
      throw new RotatePdfValidationError('Page rotations must be 0, 90, 180 or 270', 'invalid_page_plan')
    }
    originals.add(item.originalIndex)
  }

  const pages = doc.getPages()
  let rotated = 0
  for (const item of plan) {
    if (item.rotation === 0) continue
    const page = pages[item.originalIndex]
    page.setRotation(degrees((page.getRotation().angle + item.rotation) % 360))
    rotated += 1
  }

  const reordered = plan.some((item, index) => item.originalIndex !== index)
  if (reordered) {
    for (const page of pages) {
      for (const key of INHERITABLE) {
        if (page.node.get(key) !== undefined) continue
        const inherited = page.node.getInheritableAttribute(key)
        if (inherited !== undefined) page.node.set(key, inherited)
      }
    }
    for (let index = pageCount - 1; index >= 0; index -= 1) doc.removePage(index)
    for (const item of plan) doc.addPage(pages[item.originalIndex])
  }
  return { bytes: await doc.save({ useObjectStreams: true }), rotated }
}
