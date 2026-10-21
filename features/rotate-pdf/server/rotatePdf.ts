import { PDFDocument, degrees } from 'pdf-lib'
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

/**
 * Apply the page-bench plan. The plan lists every original page exactly once,
 * in its desired final order, and carries its extra clockwise rotation. The
 * source pages are copied in their chosen order, retaining their visual
 * content and page annotations while making the requested ordering explicit.
 */
export async function rotatePdfPagePlan(
  file: File,
  plan: RotatePdfPagePlanItem[],
): Promise<{ bytes: Uint8Array; rotated: number }> {
  const doc = await PDFDocument.load(await file.arrayBuffer()).catch(() => {
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

  const output = await PDFDocument.create()
  const copiedPages = await output.copyPages(doc, plan.map((item) => item.originalIndex))
  copiedPages.forEach((page) => output.addPage(page))

  let rotated = 0
  plan.forEach((item, index) => {
    if (item.rotation === 0) return
    const page = output.getPage(index)
    page.setRotation(degrees((page.getRotation().angle + item.rotation) % 360))
    rotated += 1
  })
  return { bytes: await output.save({ useObjectStreams: true }), rotated }
}
