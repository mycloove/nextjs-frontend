'use client'

import { useEffect, useRef, useState } from 'react'
import type { PDFDocumentProxy, PDFDocumentLoadingTask, RenderTask } from 'pdfjs-dist'

type Props = {
  file: File
  page: number
  password: string
  onInfo: (file: File, pages: number) => void
  onReady: (file: File, page: number, ready: boolean) => void
}

/** One real source page, rendered from session-local bytes, never reconstructed text. */
export function SourcePdfPage({ file, page, password, onInfo, onReady }: Props) {
  const hostRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [width, setWidth] = useState(0)
  const [loaded, setLoaded] = useState<{ file: File; password: string; pdf: PDFDocumentProxy } | null>(null)
  const [failure, setFailure] = useState<{ file: File; password: string; message: string } | null>(null)
  const [rendered, setRendered] = useState<{ pdf: PDFDocumentProxy; page: number; width: number } | null>(null)
  const [renderError, setRenderError] = useState<{ pdf: PDFDocumentProxy; page: number; message: string } | null>(null)
  const pdf = loaded?.file === file && loaded.password === password ? loaded.pdf : null
  const error = failure?.file === file && failure.password === password
    ? failure.message
    : renderError?.pdf === pdf && renderError.page === page ? renderError.message : null
  /* Ready means "this exact page is on screen". A new width only sharpens the
     same page, so it neither hides the canvas nor withdraws readiness. Tying
     readiness to width made a feedback loop: the rendered page grew a
     scrollbar, the width shrank, the canvas hid, the scrollbar went, the width
     grew — and the reviewer's checkboxes flickered disabled forever. */
  const ready = !!pdf && rendered?.pdf === pdf && rendered.page === page
  const shownRef = useRef<{ pdf: PDFDocumentProxy; page: number } | null>(null)

  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    const observer = new ResizeObserver(([entry]) => {
      const measured = Math.floor(entry.contentRect.width)
      if (measured > 0) setWidth(measured)
    })
    observer.observe(host)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    let cancelled = false
    let task: PDFDocumentLoadingTask | undefined
    const load = async () => {
      try {
        const engine = await import('pdfjs-dist')
        if (cancelled) return
        engine.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).toString()
        const bytes = new Uint8Array(await file.arrayBuffer())
        if (cancelled) return
        task = engine.getDocument({ data: bytes, password: password || undefined, isEvalSupported: false })
        const document = await task.promise
        if (cancelled) return
        setLoaded({ file, password, pdf: document })
        onInfo(file, document.numPages)
      } catch (cause) {
        if (cancelled) return
        const message = cause instanceof Error && cause.name === 'PasswordException'
          ? 'This PDF needs its password. Enter it above to open the original.'
          : 'The original PDF could not be rendered here. You can still open it in your PDF reader.'
        setFailure({ file, password, message })
      }
    }
    void load()
    return () => {
      cancelled = true
      if (task) void task.destroy().catch(() => undefined)
    }
  }, [file, password, onInfo])

  useEffect(() => {
    const sameContent = !!pdf && shownRef.current?.pdf === pdf && shownRef.current.page === page
    if (!sameContent) onReady(file, page, false)
    if (!pdf || !width) return
    let cancelled = false
    let task: RenderTask | undefined
    const render = async () => {
      try {
        const sourcePage = await pdf.getPage(page)
        if (cancelled || !canvasRef.current) return
        const base = sourcePage.getViewport({ scale: 1 })
        const density = Math.min(window.devicePixelRatio || 1, 2)
        const scale = Math.min(width / base.width * density, Math.sqrt(16_000_000 / (base.width * base.height)))
        const viewport = sourcePage.getViewport({ scale })
        // Render off screen, then copy: resizing the visible canvas clears it,
        // which flashed the page blank on every width change.
        const offscreen = document.createElement('canvas')
        offscreen.width = Math.ceil(viewport.width)
        offscreen.height = Math.ceil(viewport.height)
        task = sourcePage.render({ canvas: offscreen, viewport })
        await task.promise
        if (cancelled || !canvasRef.current) return
        const canvas = canvasRef.current
        canvas.width = offscreen.width
        canvas.height = offscreen.height
        canvas.getContext('2d')?.drawImage(offscreen, 0, 0)
        shownRef.current = { pdf, page }
        setRenderError(null)
        setRendered({ pdf, page, width })
        onReady(file, page, true)
      } catch {
        if (!cancelled) setRenderError({ pdf, page, message: 'This source page could not be rendered. Open the original in your PDF reader to inspect it.' })
      }
    }
    void render()
    return () => {
      cancelled = true
      task?.cancel()
    }
  }, [pdf, file, page, width, onReady])

  return (
    <div className="mr-review-source-page" ref={hostRef} aria-busy={!ready && !error}>
      {!ready && <p className="mr-review-message" role={error ? 'alert' : 'status'}>{error || 'Rendering the original PDF page...'}</p>}
      <canvas ref={canvasRef} hidden={!ready} role="img" aria-label={`Original PDF, page ${page}`} />
    </div>
  )
}
