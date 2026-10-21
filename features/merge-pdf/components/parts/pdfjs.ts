/**
 * One lazy pdf.js instance for the whole Merge PDF module.
 *
 * `handleAddFiles` (parsing), the page picker thumbnails, the preview viewer
 * and the fullscreen preview all need pdf.js. Loading it once and setting the
 * worker source once keeps a single worker alive instead of one per caller.
 * Module-local on purpose — no other tool imports this (CLAUDE.md §0.2).
 */

type PdfjsModule = typeof import('pdfjs-dist')

let pdfjsPromise: Promise<PdfjsModule> | null = null

export function getPdfjs(): Promise<PdfjsModule> {
  if (!pdfjsPromise) {
    pdfjsPromise = import('pdfjs-dist').then((pdfjs) => {
      if (!pdfjs.GlobalWorkerOptions.workerSrc) {
        pdfjs.GlobalWorkerOptions.workerSrc = new URL(
          'pdfjs-dist/build/pdf.worker.min.mjs',
          import.meta.url
        ).toString()
      }
      return pdfjs
    })
  }
  return pdfjsPromise
}
