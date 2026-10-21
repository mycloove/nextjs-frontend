import type { PDFDocumentProxy } from 'pdfjs-dist'

/* The four document hues of the reference palette, resolved per theme by the
   --am-doc-* tokens in MergePdfTool.module.css. They are referenced as custom
   properties so a source's identity colour follows the app's theme switch. */
export const SOURCE_COLORS = [
  'var(--am-doc-green)',
  'var(--am-doc-amber)',
  'var(--am-doc-violet)',
  'var(--am-doc-blue)',
]

export const STANDARD_PAGE_SIZES: Record<string, [number, number]> = {
  A4: [595.28, 841.89],
  A3: [841.89, 1190.55],
  A5: [419.53, 595.28],
  Letter: [612, 792],
  Legal: [612, 1008],
  Tabloid: [792, 1224],
}

export type PageSizeOption = 'orig' | 'first' | 'A4' | 'A3' | 'A5' | 'Letter' | 'Legal' | 'Tabloid'
export type OrientationOption = 'auto' | 'portrait' | 'landscape'

export interface SourcePdfFile {
  id: number
  file: File
  name: string
  size: number
  doc: PDFDocumentProxy
  pageCount: number
  sizes: Array<[number, number]>
  selectedPages: Set<number>
  rangeInput: string
  color: string
  letterBadge: string
}

export interface TrayItem {
  id: string
  sourceId: number
  pageNumber: number
}

export function fmtBytes(b: number): string {
  if (b >= 1048576) return `${(b / 1048576).toFixed(1)} MB`
  if (b >= 1024) return `${Math.max(1, Math.round(b / 1024))} KB`
  return `${b} B`
}

export function formatDimensions([w, h]: [number, number]): string {
  const short = Math.min(w, h)
  const long = Math.max(w, h)
  for (const [name, [sw, sh]] of Object.entries(STANDARD_PAGE_SIZES)) {
    const sMin = Math.min(sw, sh)
    const sMax = Math.max(sw, sh)
    if (Math.abs(short - sMin) < 4 && Math.abs(long - sMax) < 4) {
      return name
    }
  }
  return `${Math.round(short * 0.3528)}×${Math.round(long * 0.3528)} mm`
}

export function compressRange(pages: number[]): string {
  const sorted = [...pages].sort((a, b) => a - b)
  const parts: string[] = []
  let i = 0
  while (i < sorted.length) {
    let j = i
    while (j + 1 < sorted.length && sorted[j + 1] === sorted[j] + 1) {
      j++
    }
    parts.push(j > i ? `${sorted[i]}-${sorted[j]}` : `${sorted[i]}`)
    i = j + 1
  }
  return parts.join(', ')
}
