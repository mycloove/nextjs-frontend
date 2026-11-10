'use client'

import { useEffect, useRef, useState } from 'react'
import type { PDFDocumentProxy, RenderTask } from 'pdfjs-dist'
import styles from './kit.module.css'

/**
 * One page drawn as paper (roadmap §5.2 "Thumbnail load"): the frame takes
 * the page's real aspect ratio before anything renders, so nothing shifts;
 * the canvas renders only near the viewport and is released when it scrolls
 * far away, which keeps memory flat on long documents. No shimmer — an empty
 * sheet is the honest loading state for paper.
 */
export function PageThumb({
  document,
  pageNumber,
  aspect,
  eager = false,
}: {
  document: PDFDocumentProxy
  pageNumber: number
  /** width / height at scale 1. */
  aspect: number
  /** Render immediately (e.g. the lightbox) instead of when scrolled near. */
  eager?: boolean
}) {
  const frameRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [near, setNear] = useState(eager)
  const [state, setState] = useState<'idle' | 'ready' | 'failed'>('idle')

  useEffect(() => {
    if (eager) return
    const element = frameRef.current
    if (!element) return
    const observer = new IntersectionObserver(([entry]) => setNear(entry.isIntersecting), { rootMargin: '400px 0px' })
    observer.observe(element)
    return () => observer.disconnect()
  }, [eager])

  useEffect(() => {
    const frame = frameRef.current
    const canvas = canvasRef.current
    if (!near || !frame || !canvas) return
    let cancelled = false
    let task: RenderTask | null = null

    void document.getPage(pageNumber).then((page) => {
      if (cancelled) return
      /* Layout width, not getBoundingClientRect(): a host may rotate the page
         (Rotate PDF's turntable), and the bounding box of a quarter-turned
         frame reports its height as its width. */
      const width = frame.offsetWidth || frame.getBoundingClientRect().width
      const base = page.getViewport({ scale: 1 })
      const ratio = Math.min(window.devicePixelRatio || 1, 2)
      const viewport = page.getViewport({ scale: (width / base.width) * ratio })
      canvas.width = Math.ceil(viewport.width)
      canvas.height = Math.ceil(viewport.height)
      /* pdfjs 5.x: `canvas` only; the legacy canvasContext pair is deprecated. */
      task = page.render({ canvas, viewport })
      return task.promise.then(() => {
        if (!cancelled) setState('ready')
      })
    }).catch((error: unknown) => {
      if (!cancelled && !(error instanceof Error && error.name === 'RenderingCancelledException')) setState('failed')
    })

    return () => {
      cancelled = true
      task?.cancel()
      // Release the bitmap; it re-renders if the page scrolls back near.
      canvas.width = 0
      canvas.height = 0
      setState('idle')
    }
  }, [document, pageNumber, near])

  return (
    <div ref={frameRef} className={styles.thumb} style={{ aspectRatio: String(aspect) }} data-state={state}>
      <canvas ref={canvasRef} className={styles.thumbCanvas} aria-hidden="true" />
      {state === 'failed' && <span className={styles.thumbFailed}>Preview unavailable</span>}
    </div>
  )
}
