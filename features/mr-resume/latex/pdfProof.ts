import { LATEX_LIMITS, type LatexPdfLocation, type LatexProof } from './types.ts'

type Viewport = {
  width: number
  height: number
  convertToViewportRectangle: (rectangle: number[]) => number[]
  convertToPdfPoint: (x: number, y: number) => number[]
}

type ProofClientRect = { left: number; top: number; width: number; height: number }
export const PROOF_LOCATE_LIMIT = 2048

/** PDF.js owns its transferred copy. The original remains the download artifact. */
export function copyProofBytes(data: ArrayBuffer, expectedBytes: number): Uint8Array<ArrayBuffer> {
  if (!(data instanceof ArrayBuffer) || data.byteLength !== expectedBytes || expectedBytes < 5 || expectedBytes > LATEX_LIMITS.pdfBytes) throw new Error('The saved PDF bytes do not match this proof.')
  const bytes = new Uint8Array(data)
  if (String.fromCharCode(...bytes.subarray(0, 5)) !== '%PDF-') throw new Error('The saved artifact is not a PDF.')
  return new Uint8Array(data.slice(0))
}

export function proofBitmapSize(width: number, height: number, ratio: number) {
  if (![width, height, ratio].every(Number.isFinite) || width <= 0 || height <= 0 || ratio <= 0) throw new Error('The PDF page has invalid dimensions.')
  const density = Math.min(2, ratio)
  const bitmapWidth = Math.ceil(width * density)
  const bitmapHeight = Math.ceil(height * density)
  if (bitmapWidth > 8192 || bitmapHeight > 8192 || bitmapWidth * bitmapHeight > 16 * 1024 * 1024) throw new Error('This page or zoom exceeds the safe preview size. Reduce the zoom or use a resume-sized page.')
  return { width: bitmapWidth, height: bitmapHeight, density }
}

export const PROOF_DOCUMENT_PIXELS = 32 * 1024 * 1024

/** Every page remains in the scroll document, without allocating 64 MiB per canvas. */
export function proofDocumentBitmapSize(width: number, height: number, ratio: number, pages: number) {
  if (!Number.isSafeInteger(pages) || pages < 1 || pages > LATEX_LIMITS.pages) throw new Error('Invalid PDF page count.')
  const size = proofBitmapSize(width, height, ratio), budget = Math.floor(PROOF_DOCUMENT_PIXELS / pages)
  if (size.width * size.height <= budget) return size
  const factor = Math.sqrt(budget / (size.width * size.height))
  const bitmapWidth = Math.max(1, Math.floor(size.width * factor)), bitmapHeight = Math.max(1, Math.floor(size.height * factor))
  return { width: bitmapWidth, height: bitmapHeight, density: Math.min(size.density, bitmapWidth / width, bitmapHeight / height) }
}

/** Scroll only the PDF viewport, and leave an already-visible measured target alone. */
export function proofScrollPosition(view: ProofClientRect, target: ProofClientRect, scrollTop: number, scrollLeft: number, inset = 16) {
  if (![view.left, view.top, view.width, view.height, target.left, target.top, target.width, target.height, scrollTop, scrollLeft, inset].every(Number.isFinite)
    || view.width <= 0 || view.height <= 0 || target.width <= 0 || target.height <= 0 || inset < 0) return null
  const top = target.top >= view.top + inset && target.top + target.height <= view.top + view.height - inset ? scrollTop : Math.max(0, scrollTop + target.top - view.top - inset)
  const left = target.left >= view.left + inset && target.left + target.width <= view.left + view.width - inset ? scrollLeft : Math.max(0, scrollLeft + target.left - view.left - inset)
  return { top, left }
}

export function proofSourceBox(location: LatexPdfLocation, viewport: Viewport) {
  if (![location.x, location.y, location.width, location.height].every(Number.isFinite) || location.width <= 0 || location.height <= 0) return null
  const rectangle = viewport.convertToViewportRectangle([location.x, location.y, location.x + location.width, location.y + location.height])
  if (rectangle.length !== 4 || !rectangle.every(Number.isFinite)) return null
  const left = Math.max(0, Math.min(rectangle[0], rectangle[2]))
  const top = Math.max(0, Math.min(rectangle[1], rectangle[3]))
  const right = Math.min(viewport.width, Math.max(rectangle[0], rectangle[2]))
  const bottom = Math.min(viewport.height, Math.max(rectangle[1], rectangle[3]))
  return right > left && bottom > top ? { left, top, width: right - left, height: bottom - top } : null
}

export function proofPoint(clientX: number, clientY: number, bounds: ProofClientRect, viewport: Viewport) {
  if (![clientX, clientY, bounds.left, bounds.top, bounds.width, bounds.height, viewport.width, viewport.height].every(Number.isFinite)
    || bounds.width <= 0 || bounds.height <= 0 || viewport.width <= 0 || viewport.height <= 0) return null
  const x = (clientX - bounds.left) * viewport.width / bounds.width
  const y = (clientY - bounds.top) * viewport.height / bounds.height
  if (x < 0 || y < 0 || x > viewport.width || y > viewport.height) return null
  const point = viewport.convertToPdfPoint(x, y)
  return point.length === 2 && point.every(Number.isFinite) ? { x: point[0], y: point[1] } : null
}

/** Use one measured text fragment, never the whitespace between a multi-line selection's rectangles. */
export function proofTextPoint(rectangles: Iterable<ProofClientRect>, bounds: ProofClientRect, viewport: Viewport) {
  let visited = 0
  for (const rectangle of rectangles) {
    if (++visited > PROOF_LOCATE_LIMIT) break
    if (![rectangle.left, rectangle.top, rectangle.width, rectangle.height].every(Number.isFinite) || rectangle.width <= 0 || rectangle.height <= 0) continue
    const left = Math.max(bounds.left, rectangle.left), top = Math.max(bounds.top, rectangle.top)
    const right = Math.min(bounds.left + bounds.width, rectangle.left + rectangle.width), bottom = Math.min(bounds.top + bounds.height, rectangle.top + rectangle.height)
    if (right > left && bottom > top) return proofPoint(left + (right - left) / 2, top + (bottom - top) / 2, bounds, viewport)
  }
  return null
}

export function pdfProofIdentity(proof: Pick<LatexProof, 'projectId' | 'revision' | 'operationKey' | 'snapshotHash' | 'pdf'> | null) {
  return proof ? `${proof.projectId}:${proof.revision}:${proof.operationKey}:${proof.snapshotHash}:${proof.pdf.sha256}` : ''
}

export const PROOF_TEXT_LIMITS = { characters: 128 * 1024, items: 50000 } as const
export type ProofTextPage = { page: number; text: string; error: string | null }
export type ProofTextPreview = { key: string; pages: ProofTextPage[]; truncated: boolean }
type ProofTextDocument = {
  numPages: number
  getPage: (page: number) => Promise<{ getTextContent: (options: { disableNormalization: true }) => Promise<{ items: readonly ({ str: string; hasEOL?: boolean } | { type: string })[] }> }>
}

/** Reads the already-loaded canonical PDF in PDF.js item order. It does not infer visual order or an ATS score. */
export async function extractProofText(document: ProofTextDocument, key: string, expectedPages: number, isCurrent = () => true): Promise<ProofTextPreview> {
  if (!key || !Number.isSafeInteger(expectedPages) || expectedPages < 1 || expectedPages > LATEX_LIMITS.pages || document.numPages !== expectedPages) throw new Error('Text inspection does not match the loaded PDF proof.')
  const result: ProofTextPreview = { key, pages: [], truncated: false }
  let characters = 0, items = 0
  const check = () => { if (!isCurrent()) throw new DOMException('PDF text inspection was superseded.', 'AbortError') }
  for (let page = 1; page <= expectedPages; page++) {
    check()
    try {
      const pdfPage = await document.getPage(page)
      check()
      const content = await pdfPage.getTextContent({ disableNormalization: true })
      check()
      let text = ''
      for (const item of content.items) {
        if (++items > PROOF_TEXT_LIMITS.items) { result.truncated = true; break }
        if (!('str' in item)) continue
        const part = item.str + (item.hasEOL ? '\n' : ' '), remaining = PROOF_TEXT_LIMITS.characters - characters
        if (part.length > remaining) {
          // Never cut a UTF-16 surrogate pair in the optional text display.
          const length = remaining > 0 && /[\ud800-\udbff]/u.test(part[remaining - 1]) ? remaining - 1 : remaining
          text += part.slice(0, length); characters += length; result.truncated = true; break
        }
        text += part; characters += part.length
      }
      result.pages.push({ page, text, error: null })
    } catch (error) {
      check()
      if (error instanceof DOMException && error.name === 'AbortError') throw error
      // Failure of this optional extraction is not failure of the PDF artifact or another page.
      result.pages.push({ page, text: '', error: 'PDF.js could not extract text from this page. The original PDF is unchanged.' })
    }
    if (result.truncated) break
  }
  return result
}
