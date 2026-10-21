'use client'

import { useEffect, useRef, useState } from 'react'
import type { PDFDocumentProxy, RenderTask } from 'pdfjs-dist'

export async function loadPdfDocument(data: ArrayBuffer): Promise<PDFDocumentProxy> {
  const pdfjs = await import('pdfjs-dist')
  pdfjs.GlobalWorkerOptions.workerSrc = new URL(
    'pdfjs-dist/build/pdf.worker.min.mjs',
    import.meta.url,
  ).toString()
  return pdfjs.getDocument({ data }).promise
}

interface PdfPageCanvasProps {
  document: PDFDocumentProxy
  pageNumber: number
  className: string
  lazy?: boolean
}

export function PdfPageCanvas({ document, pageNumber, className, lazy = false }: PdfPageCanvasProps) {
  const frameRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [frame, setFrame] = useState({ width: 0, height: 0 })
  const [visible, setVisible] = useState(!lazy)
  const [failedPage, setFailedPage] = useState<number | null>(null)

  useEffect(() => {
    const element = frameRef.current
    if (!element) return

    const updateSize = () => {
      const rect = element.getBoundingClientRect()
      setFrame({ width: rect.width, height: rect.height })
    }
    updateSize()
    const resizeObserver = new ResizeObserver(updateSize)
    resizeObserver.observe(element)
    return () => resizeObserver.disconnect()
  }, [])

  useEffect(() => {
    if (!lazy) return
    const element = frameRef.current
    if (!element) return
    const observer = new IntersectionObserver(
      ([entry]) => {
        setVisible(entry.isIntersecting)
      },
      { rootMargin: '320px 0px' },
    )
    observer.observe(element)
    return () => observer.disconnect()
  }, [lazy])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!visible || !canvas || !frame.width || !frame.height) return
    let cancelled = false
    let renderTask: RenderTask | null = null

    void document.getPage(pageNumber).then((page) => {
      if (cancelled) return
      const baseViewport = page.getViewport({ scale: 1 })
      const fitScale = Math.min(frame.width / baseViewport.width, frame.height / baseViewport.height)
      if (!Number.isFinite(fitScale) || fitScale <= 0) return

      const pixelRatio = Math.min(window.devicePixelRatio || 1, 2)
      const viewport = page.getViewport({ scale: fitScale * pixelRatio })
      const context = canvas.getContext('2d', { alpha: false })
      if (!context) {
        setFailedPage(pageNumber)
        return
      }

      canvas.width = Math.ceil(viewport.width)
      canvas.height = Math.ceil(viewport.height)
      canvas.style.width = `${Math.ceil(baseViewport.width * fitScale)}px`
      canvas.style.height = `${Math.ceil(baseViewport.height * fitScale)}px`
      context.fillStyle = '#fff'
      context.fillRect(0, 0, canvas.width, canvas.height)
      /* pdfjs 5.x: pass `canvas` only. The legacy `canvasContext` param is
         deprecated and the pair together takes a backwards-compat code path
         that spams a deprecation warning on every render. */
      renderTask = page.render({ canvas, viewport })
      return renderTask.promise
    }).catch(() => {
      if (!cancelled) setFailedPage(pageNumber)
    })

    return () => {
      cancelled = true
      renderTask?.cancel()
      canvas.width = 0
      canvas.height = 0
    }
  }, [document, pageNumber, visible, frame.width, frame.height])

  return (
    <div ref={frameRef} className={className}>
      <canvas ref={canvasRef} aria-hidden="true" />
      {failedPage === pageNumber && <span className="spl-preview-fallback">Page preview unavailable</span>}
    </div>
  )
}

interface PdfReaderPageProps {
  document: PDFDocumentProxy
  pageNumber: number
  width: number
  fitHeight?: number
  zoomScale?: number
}

function PdfReaderPage({ document, pageNumber, width, fitHeight, zoomScale = 1 }: PdfReaderPageProps) {
  const pageRef = useRef<HTMLElement>(null)
  const [aspectRatio, setAspectRatio] = useState(1 / Math.SQRT2)

  useEffect(() => {
    const element = pageRef.current
    if (!element) return
    let cancelled = false
    const observer = new IntersectionObserver(([entry]) => {
      if (!entry.isIntersecting) return
      observer.disconnect()
      void document.getPage(pageNumber).then((page) => {
        if (cancelled) return
        const viewport = page.getViewport({ scale: 1 })
        setAspectRatio(viewport.width / viewport.height)
      }).catch(() => undefined)
    }, { rootMargin: '600px 0px' })
    observer.observe(element)
    return () => {
      cancelled = true
      observer.disconnect()
    }
  }, [document, pageNumber])

  const pageWidth = fitHeight
    ? Math.min(width, fitHeight * aspectRatio) * zoomScale
    : width
  const pageHeight = fitHeight ? pageWidth / aspectRatio : undefined

  return (
    <section
      ref={pageRef}
      className="spl-preview-page"
      data-preview-page={pageNumber}
      style={{
        aspectRatio: String(aspectRatio),
        width: `${pageWidth}px`,
        height: pageHeight ? `${pageHeight}px` : undefined,
      }}
      aria-label={`PDF page ${pageNumber}`}
    >
      <PdfPageCanvas
        document={document}
        pageNumber={pageNumber}
        className="spl-preview-page-frame"
        lazy
      />
      <span className="spl-preview-page-number">{pageNumber}</span>
    </section>
  )
}

interface PdfPreviewModalProps {
  blob?: Blob
  sourceDocument?: PDFDocumentProxy
  title: string
  initialPage: number
  singlePage?: boolean
  onClose: () => void
}

export function PdfPreviewModal({ blob, sourceDocument, title, initialPage, singlePage = false, onClose }: PdfPreviewModalProps) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const readerRef = useRef<HTMLDivElement>(null)
  const [document, setDocument] = useState<PDFDocumentProxy | null>(null)
  const [pageNumber, setPageNumber] = useState(initialPage)
  const [pageInput, setPageInput] = useState(String(initialPage))
  const [zoom, setZoom] = useState(1)
  const [readerSize, setReaderSize] = useState({ width: 0, height: 0 })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return
    /* showModal on an already-open dialog throws InvalidStateError — under
       StrictMode's simulated remount (dev) the effect runs twice. The guard
       keeps the second run a no-op instead of crashing. */
    if (!dialog.open) dialog.showModal()
    /* Deliberately NO close() in cleanup. A cleanup close() fires the native
       `close` event, which reaches React's onClose and the parent drops the
       `preview` state — so the modal unmounts itself the instant it opens
       (StrictMode runs mount → cleanup → mount; the queued parent update lands
       after the remount and kills the dialog). Real unmounts don't need it:
       removing the element closes and de-top-layers it implicitly. */
  }, [])

  useEffect(() => {
    let cancelled = false
    let loadedDocument: PDFDocumentProxy | null = null
    const documentPromise = sourceDocument
      ? Promise.resolve(sourceDocument)
      : blob
        ? blob.arrayBuffer().then(loadPdfDocument)
        : Promise.reject(new Error('No PDF was provided for preview'))

    void documentPromise.then((pdfDocument) => {
      if (cancelled) {
        if (pdfDocument !== sourceDocument) void pdfDocument.destroy()
        return
      }
      if (pdfDocument !== sourceDocument) loadedDocument = pdfDocument
      setDocument(pdfDocument)
      const safeInitialPage = Math.min(Math.max(initialPage, 1), pdfDocument.numPages)
      setPageNumber(safeInitialPage)
      setPageInput(String(safeInitialPage))
      setLoading(false)
    }).catch(() => {
      if (!cancelled) {
        setError('This PDF could not be previewed. You can still download the file.')
        setLoading(false)
      }
    })

    return () => {
      cancelled = true
      if (loadedDocument) void loadedDocument.destroy()
    }
  }, [blob, sourceDocument, initialPage])

  useEffect(() => {
    const root = readerRef.current
    if (!root || !document || singlePage) return
    const pages = root.querySelectorAll<HTMLElement>('[data-preview-page]')
    const observer = new IntersectionObserver((entries) => {
      const rootCenter = root.getBoundingClientRect().top + root.clientHeight / 2
      const current = entries
        .filter((entry) => entry.isIntersecting)
        .sort((a, b) => Math.abs(a.boundingClientRect.top + a.boundingClientRect.height / 2 - rootCenter)
          - Math.abs(b.boundingClientRect.top + b.boundingClientRect.height / 2 - rootCenter))[0]?.target as HTMLElement | undefined
      const next = Number(current?.dataset.previewPage)
      if (!Number.isFinite(next) || next < 1) return
      setPageNumber(next)
      setPageInput(String(next))
    }, { root, rootMargin: '-20% 0px -20% 0px', threshold: [0, 0.1, 0.5] })
    pages.forEach((page) => observer.observe(page))
    root.querySelector<HTMLElement>(`[data-preview-page="${initialPage}"]`)
      ?.scrollIntoView({ block: 'start' })
    return () => observer.disconnect()
  }, [document, initialPage, singlePage])

  useEffect(() => {
    const reader = readerRef.current
    if (!reader) return
    const updateSize = () => setReaderSize({
      width: Math.max(240, reader.clientWidth - 32),
      height: Math.max(240, reader.clientHeight - 32),
    })
    updateSize()
    const observer = new ResizeObserver(updateSize)
    observer.observe(reader)
    return () => observer.disconnect()
  }, [])

  const commitPageInput = () => {
    if (!document) return
    const requested = Number.parseInt(pageInput, 10)
    const next = Number.isFinite(requested)
      ? Math.min(Math.max(requested, 1), document.numPages)
      : pageNumber
    setPageNumber(next)
    setPageInput(String(next))
    readerRef.current?.querySelector<HTMLElement>(`[data-preview-page="${next}"]`)
      ?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  const movePage = (step: number) => {
    if (!document) return
    const next = Math.min(Math.max(pageNumber + step, 1), document.numPages)
    setPageNumber(next)
    setPageInput(String(next))
    readerRef.current?.querySelector<HTMLElement>(`[data-preview-page="${next}"]`)
      ?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  const fitPage = () => {
    setZoom(1)
    requestAnimationFrame(() => {
      const reader = readerRef.current
      if (!reader) return
      if (singlePage) {
        reader.scrollTo({ top: 0, left: 0, behavior: 'smooth' })
        return
      }
      reader.querySelector<HTMLElement>(`[data-preview-page="${pageNumber}"]`)
        ?.scrollIntoView({ behavior: 'smooth', block: 'start', inline: 'center' })
    })
  }

  return (
    <dialog
      ref={dialogRef}
      className={`spl-preview-dialog${singlePage ? ' single-page' : ''}`}
      aria-labelledby="spl-preview-title"
      onClose={onClose}
      onClick={(event) => {
        if (event.target === dialogRef.current) dialogRef.current.close()
      }}
    >
      <div className="spl-preview-head">
        <div>
          <h2 id="spl-preview-title">{title}</h2>
          {document && <span>Page {pageNumber} of {document.numPages}</span>}
        </div>
        <button type="button" className="spl-preview-close" onClick={() => dialogRef.current?.close()} aria-label="Close preview">
          ×
        </button>
      </div>
      <div className="spl-preview-content" ref={readerRef}>
        {loading && <p className="spl-preview-message">Preparing your preview…</p>}
        {error && <p className="spl-preview-message" role="alert">{error}</p>}
        {document && (
          <div className="spl-preview-pages">
            {singlePage ? (
              <PdfReaderPage
                key={initialPage}
                document={document}
                pageNumber={initialPage}
                width={Math.min(900, readerSize.width || 852)}
                fitHeight={readerSize.height || 680}
                zoomScale={zoom}
              />
            ) : Array.from({ length: document.numPages }, (_, index) => index + 1).map((page) => (
              <PdfReaderPage
                key={page}
                document={document}
                pageNumber={page}
                width={Math.round(Math.min(900, readerSize.width || 852) * zoom)}
              />
            ))}
          </div>
        )}
      </div>
      <div className="spl-preview-controls">
        {!singlePage && <div className="spl-preview-pager">
          <button type="button" className="spl-ghost small" disabled={!document || pageNumber <= 1} onClick={() => movePage(-1)} aria-label="Previous page">↑</button>
          <label>
            <span className="spl-visually-hidden">Go to page</span>
            <input
              type="number"
              min={1}
              max={document?.numPages ?? 1}
              value={pageInput}
              disabled={!document}
              onChange={(event) => setPageInput(event.target.value)}
              onBlur={commitPageInput}
              onKeyDown={(event) => {
                if (event.key === 'Enter') commitPageInput()
              }}
            />
          </label>
          <button type="button" className="spl-ghost small" disabled={!document || pageNumber >= document.numPages} onClick={() => movePage(1)} aria-label="Next page">↓</button>
        </div>}
        <div className="spl-preview-zoom" aria-label="Preview zoom controls">
          <button type="button" className="spl-ghost small" disabled={zoom <= 0.7} onClick={() => setZoom((value) => Math.max(0.7, Math.round((value - 0.1) * 10) / 10))} aria-label="Zoom out">−</button>
          <span>{Math.round(zoom * 100)}%</span>
          <button type="button" className="spl-ghost small" disabled={zoom >= 1.5} onClick={() => setZoom((value) => Math.min(1.5, Math.round((value + 0.1) * 10) / 10))} aria-label="Zoom in">+</button>
          <button type="button" className="spl-ghost small" onClick={fitPage}>Fit page</button>
        </div>
      </div>
    </dialog>
  )
}
