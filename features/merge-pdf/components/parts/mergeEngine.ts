import { PDFArray, PDFDict, PDFDocument, PDFName, PDFNumber, type PDFPage } from 'pdf-lib'
import { finalizeCopiedPages, prepareSourceForCopy } from '../../../../lib/pdf/pageCopy.ts'

/**
 * Browser merge engine for the Merge PDF studio. Pure and dependency-free
 * apart from pdf-lib, so `mergeEngine.test.ts` proves it with real bytes.
 *
 * Why this exists — the previous binder embedded every sheet as a Form
 * XObject with its own `embedPages` call. Each call built a fresh object
 * copier, so fonts and images shared by many pages were copied again for
 * every page: a 1 MB + 2 MB pair came out near 20 MB. It also flattened
 * links and annotations, and ignored /Rotate.
 *
 * This engine instead:
 *   - copies every page a document contributes in ONE `copyPages` call, so
 *     shared resources are written once;
 *   - keeps each sheet a real page (text, links, annotations and rotation
 *     survive) and adds them strictly in the caller's order;
 *   - only touches a page's geometry when its visible size differs from the
 *     requested sheet size, by fitting the content (centred, never cropped)
 *     with one transform — the same fit the live preview draws.
 */

export type Box = { x: number; y: number; width: number; height: number }
export type Rotation = 0 | 90 | 180 | 270
export type Matrix = [number, number, number, number, number, number]

/** Visible-size tolerance in points; sub-point differences are rounding. */
export const SIZE_TOLERANCE = 0.5

export class MergeEngineError extends Error {
  readonly code: 'no_pages' | 'missing_source' | 'encrypted_pdf' | 'unreadable_pdf' | 'page_out_of_range'
  readonly sourceName: string | null
  constructor(message: string, code: MergeEngineError['code'], sourceName: string | null = null) {
    super(message)
    this.name = 'MergeEngineError'
    this.code = code
    this.sourceName = sourceName
  }
}

export function normalizeRotation(degrees: number): Rotation {
  const quarter = Math.round((Number.isFinite(degrees) ? degrees : 0) / 90)
  return ((((quarter % 4) + 4) % 4) * 90) as Rotation
}

/** The area a viewer shows: CropBox clipped to MediaBox (what pdf.js uses). */
export function visibleBox(media: Box, crop: Box): Box {
  const left = Math.max(media.x, crop.x)
  const bottom = Math.max(media.y, crop.y)
  const right = Math.min(media.x + media.width, crop.x + crop.width)
  const top = Math.min(media.y + media.height, crop.y + crop.height)
  return right > left && top > bottom ? { x: left, y: bottom, width: right - left, height: top - bottom } : media
}

export function displayedSize(box: Box, rotation: Rotation): [number, number] {
  return rotation % 180 === 0 ? [box.width, box.height] : [box.height, box.width]
}

export interface FitPlan {
  /** New unrotated page size (MediaBox = CropBox = [0 0 width height]). */
  width: number
  height: number
  /** Content transform: scale to fit, then centre inside the new box. */
  matrix: Matrix
}

/**
 * Plan how a page with visible `box` and `rotation` becomes a sheet whose
 * *displayed* size is `target`. Returns null when nothing has to change.
 */
export function planFit(box: Box, rotation: Rotation, target: [number, number] | null): FitPlan | null {
  if (!target) return null
  const [targetWidth, targetHeight] = target
  if (!(targetWidth > 0 && targetHeight > 0) || !(box.width > 0 && box.height > 0)) return null
  const [shownWidth, shownHeight] = displayedSize(box, rotation)
  if (Math.abs(shownWidth - targetWidth) <= SIZE_TOLERANCE && Math.abs(shownHeight - targetHeight) <= SIZE_TOLERANCE) {
    return null
  }
  // /Rotate is kept, so work in the page's unrotated space.
  const [width, height] = rotation % 180 === 0 ? [targetWidth, targetHeight] : [targetHeight, targetWidth]
  const scale = Math.min(width / box.width, height / box.height)
  const offsetX = (width - box.width * scale) / 2
  const offsetY = (height - box.height * scale) / 2
  return {
    width,
    height,
    matrix: [scale, 0, 0, scale, offsetX - box.x * scale, offsetY - box.y * scale],
  }
}

function transformNumberArray(array: PDFArray, matrix: Matrix) {
  const [a, , , d, e, f] = matrix
  for (let i = 0; i + 1 < array.size(); i += 2) {
    const x = array.lookup(i)
    const y = array.lookup(i + 1)
    if (x instanceof PDFNumber && y instanceof PDFNumber) {
      array.set(i, PDFNumber.of(x.asNumber() * a + e))
      array.set(i + 1, PDFNumber.of(y.asNumber() * d + f))
    }
  }
}

function transformAnnotation(annot: PDFDict, matrix: Matrix) {
  for (const key of ['Rect', 'QuadPoints', 'L', 'Vertices', 'CL']) {
    const value = annot.lookup(PDFName.of(key))
    if (value instanceof PDFArray) transformNumberArray(value, matrix)
  }
  const ink = annot.lookup(PDFName.of('InkList'))
  if (ink instanceof PDFArray) {
    for (let i = 0; i < ink.size(); i++) {
      const path = ink.lookup(i)
      if (path instanceof PDFArray) transformNumberArray(path, matrix)
    }
  }
}

/** Apply a fit plan to a page that already belongs to the output document. */
export function applyFit(page: PDFPage, plan: FitPlan) {
  const [scale, , , , translateX, translateY] = plan.matrix
  // Inner wrap scales, outer wrap translates: point → scale·point + offset.
  page.scaleContent(scale, scale)
  page.translateContent(translateX, translateY)
  page.setMediaBox(0, 0, plan.width, plan.height)
  page.setCropBox(0, 0, plan.width, plan.height)
  for (const key of ['BleedBox', 'TrimBox', 'ArtBox']) page.node.delete(PDFName.of(key))
  const annots = page.node.Annots()
  if (!annots) return
  for (let i = 0; i < annots.size(); i++) {
    const annot = annots.lookup(i)
    if (annot instanceof PDFDict) transformAnnotation(annot, plan.matrix)
  }
}

export function pageGeometry(page: PDFPage): { box: Box; rotation: Rotation } {
  return {
    box: visibleBox(page.getMediaBox(), page.getCropBox()),
    rotation: normalizeRotation(page.getRotation().angle),
  }
}

export interface MergeSource {
  key: number | string
  name: string
  bytes: ArrayBuffer | Uint8Array
}

export interface MergeSheet {
  sourceKey: number | string
  /** 1-based page number in the source. */
  pageNumber: number
  /** Displayed sheet size in points, or null to keep the page as it is. */
  target: [number, number] | null
}

export interface MergeOptions {
  title?: string
  /** Called after each sheet; awaited so a UI can paint progress. */
  onProgress?: (done: number, total: number) => void | Promise<void>
}

async function loadSource(source: MergeSource): Promise<PDFDocument> {
  let doc: PDFDocument
  try {
    doc = await PDFDocument.load(source.bytes, { updateMetadata: false })
  } catch (error) {
    if (error instanceof Error && error.name === 'EncryptedPDFError') {
      throw new MergeEngineError(
        `"${source.name}" is password-protected. Remove its protection, then add it again.`,
        'encrypted_pdf',
        source.name,
      )
    }
    throw new MergeEngineError(
      `"${source.name}" could not be read — it may be damaged.`,
      'unreadable_pdf',
      source.name,
    )
  }
  /* Tag pages, inline named destinations and cut the annotation /P and bead
     /B back-references that would drag unselected pages — and, through their
     /Parent, the whole page tree — into the output as invisible dead weight.
     See lib/pdf/pageCopy.ts. */
  prepareSourceForCopy(doc, String(source.key))
  return doc
}

/**
 * Bind `sheets` into one PDF, strictly in array order. One unreadable or
 * protected document fails the whole job with its name — a silently missing
 * chapter is worse than a named, retryable error.
 */
export async function mergeSheets(
  sources: readonly MergeSource[],
  sheets: readonly MergeSheet[],
  options: MergeOptions = {},
): Promise<Uint8Array> {
  if (sheets.length === 0) throw new MergeEngineError('There are no pages to merge.', 'no_pages')

  const byKey = new Map(sources.map((source) => [source.key, source]))
  const wanted = new Map<MergeSource['key'], number[]>()
  for (const sheet of sheets) {
    if (!byKey.has(sheet.sourceKey)) {
      throw new MergeEngineError('A page refers to a document that is no longer loaded.', 'missing_source')
    }
    const list = wanted.get(sheet.sourceKey) ?? []
    list.push(sheet.pageNumber - 1)
    wanted.set(sheet.sourceKey, list)
  }

  const output = await PDFDocument.create()
  const copied = new Map<string, PDFPage[]>()
  for (const [key, indices] of wanted) {
    const source = byKey.get(key)!
    const doc = await loadSource(source)
    const count = doc.getPageCount()
    const bad = indices.find((index) => !Number.isInteger(index) || index < 0 || index >= count)
    if (bad !== undefined) {
      throw new MergeEngineError(
        `"${source.name}" has no page ${bad + 1}.`,
        'page_out_of_range',
        source.name,
      )
    }
    // One call per document: its shared fonts and images are copied once.
    const pages = await output.copyPages(doc, indices)
    indices.forEach((index, i) => {
      const slot = `${String(key)}#${index}`
      const queue = copied.get(slot) ?? []
      queue.push(pages[i])
      copied.set(slot, queue)
    })
  }

  for (let i = 0; i < sheets.length; i++) {
    const sheet = sheets[i]
    const page = copied.get(`${String(sheet.sourceKey)}#${sheet.pageNumber - 1}`)!.shift()!
    const { box, rotation } = pageGeometry(page)
    const plan = planFit(box, rotation, sheet.target)
    if (plan) applyFit(page, plan)
    output.addPage(page)
    await options.onProgress?.(i + 1, sheets.length)
  }

  if (options.title) output.setTitle(options.title)
  // Links between kept pages now land on the real pages; links into pages
  // the user left out are removed; unreachable copies are deleted.
  finalizeCopiedPages(output)
  return output.save({ useObjectStreams: true })
}
