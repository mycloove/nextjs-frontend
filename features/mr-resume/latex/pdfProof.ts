import { LATEX_LIMITS, type LatexPdfLocation } from './types.ts'

type Viewport = {
  width: number
  height: number
  convertToViewportRectangle: (rectangle: number[]) => number[]
  convertToPdfPoint: (x: number, y: number) => number[]
}

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

export function proofPoint(clientX: number, clientY: number, bounds: { left: number; top: number; width: number; height: number }, viewport: Viewport) {
  if (![clientX, clientY, bounds.left, bounds.top, bounds.width, bounds.height].every(Number.isFinite) || bounds.width <= 0 || bounds.height <= 0) return null
  const x = (clientX - bounds.left) * viewport.width / bounds.width
  const y = (clientY - bounds.top) * viewport.height / bounds.height
  if (x < 0 || y < 0 || x > viewport.width || y > viewport.height) return null
  const point = viewport.convertToPdfPoint(x, y)
  return point.length === 2 && point.every(Number.isFinite) ? { x: point[0], y: point[1] } : null
}
