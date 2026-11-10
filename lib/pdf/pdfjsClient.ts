'use client'

import type { PDFDocumentProxy } from 'pdfjs-dist'

/**
 * One pdfjs loader for shared UI (CLAUDE.md §4, Tier-2 lib). The worker URL
 * is set once and the module is imported once per page, instead of each tool
 * repeating the same three lines. Merge (parts/pdfjs.ts) and Split
 * (PdfPreview.tsx) still carry their own copies; each moves onto this file
 * when it migrates (roadmap Phase 3, Wave A). Rotate moved on 2026-11-06.
 *
 * Consumers: components/tools/kit/PageGrid.tsx, features/rotate-pdf.
 */

type PdfjsModule = typeof import('pdfjs-dist')

let pdfjsPromise: Promise<PdfjsModule> | null = null

export function getPdfjs(): Promise<PdfjsModule> {
  if (!pdfjsPromise) {
    pdfjsPromise = import('pdfjs-dist').then((pdfjs) => {
      if (!pdfjs.GlobalWorkerOptions.workerSrc) {
        pdfjs.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).toString()
      }
      return pdfjs
    })
  }
  return pdfjsPromise
}

/** Open a PDF from a browser File. The caller owns `destroy()`. */
export async function openPdf(file: Blob): Promise<PDFDocumentProxy> {
  const pdfjs = await getPdfjs()
  return pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise
}

/**
 * [width, height] of every page at scale 1, in page order — read once so the grid never shifts.
 * `onProgress(done, total)` lets a tool show a real "42 / 120 pages read" count.
 */
export async function readPageSizes(
  document: PDFDocumentProxy,
  onProgress?: (done: number, total: number) => void,
): Promise<Array<[number, number]>> {
  const sizes: Array<[number, number]> = []
  for (let page = 1; page <= document.numPages; page += 1) {
    const proxy = await document.getPage(page)
    const viewport = proxy.getViewport({ scale: 1 })
    sizes.push([viewport.width, viewport.height])
    onProgress?.(page, document.numPages)
  }
  return sizes
}
