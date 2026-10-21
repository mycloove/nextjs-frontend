import { useCallback, useEffect, useRef, useState } from 'react'
import type { KeyboardEvent as ReactKeyboardEvent } from 'react'
import type { PDFDocumentProxy, RenderTask } from 'pdfjs-dist'
import styles from '../MergePdfTool.module.css'
import { getPdfjs } from './pdfjs'
import { ScanLoader } from './ScanLoader'
import { clampZoom, computeViewerMetrics, MAX_ZOOM, MIN_ZOOM } from './viewerGeometry'

/**
 * A calibrated page lens: the page rendered to a canvas at device resolution
 * with a selectable text layer on top, plus zoom controls.
 *
 * - Fidelity: page.render draws to an offscreen canvas at
 *   displayScale × DPR (clamped by a pixel budget), then the visible canvas is
 *   committed in one step — no blank flash between zoom steps.
 * - Selection: pdf.js `TextLayer` spans sit over the canvas at the same
 *   viewport, so dragging the cursor selects real text and Cmd/Ctrl+C copies it.
 * - Honesty: when the page carries no extractable text (a scan), the copy
 *   action disables and says so rather than implying a capability it lacks.
 *
 * Zoom is debounced so rapid clicks coalesce into one crisp re-render.
 */

const STAGE_PADDING = 32
const ZOOM_STEP = 1.25

export function PageViewer({
  doc,
  pageNumber,
  boxDimensions,
  variant = 'inline',
}: {
  doc: PDFDocumentProxy
  pageNumber: number
  boxDimensions?: [number, number]
  variant?: 'inline' | 'full'
}) {
  const stageRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const textLayerRef = useRef<HTMLDivElement>(null)

  const [stageSize, setStageSize] = useState({ width: 0, height: 0 })
  const [pageSize, setPageSize] = useState<{ width: number; height: number } | null>(null)
  const [zoom, setZoom] = useState(1)
  const [renderZoom, setRenderZoom] = useState(1)
  const [rendering, setRendering] = useState(true)
  const [hasText, setHasText] = useState(false)
  const [copied, setCopied] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [dpr] = useState(() =>
    typeof window !== 'undefined' ? Math.min(window.devicePixelRatio || 1, 2) : 1
  )

  /* The full (modal) reader frames the page by its own size, so the paper
     border always hugs the sheet. The inline variant keeps the output box
     proportion so a letterboxed fit stays visible. */
  const boxWidth = variant === 'full' ? pageSize?.width : boxDimensions?.[0]
  const boxHeight = variant === 'full' ? pageSize?.height : boxDimensions?.[1]

  /* Measure the stage so the page can be fitted to the available area. */
  useEffect(() => {
    const el = stageRef.current
    if (!el) return
    const update = () => setStageSize({ width: el.clientWidth, height: el.clientHeight })
    update()
    const observer = new ResizeObserver(update)
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  /* The page's own size, independent of zoom. */
  useEffect(() => {
    let cancelled = false
    setPageSize(null)
    doc
      .getPage(pageNumber)
      .then((page) => {
        if (cancelled) return
        const viewport = page.getViewport({ scale: 1 })
        setPageSize({ width: viewport.width, height: viewport.height })
      })
      .catch(() => {
        if (!cancelled) setError('This page could not be loaded.')
      })
    return () => {
      cancelled = true
    }
  }, [doc, pageNumber])

  /* A fresh page starts fitted. */
  useEffect(() => {
    setZoom(1)
    setRenderZoom(1)
    setHasText(false)
    setError(null)
  }, [doc, pageNumber])

  /* Zoom is applied to the readout instantly but rendered after a short
     debounce, so a burst of clicks produces one render, not five. */
  useEffect(() => {
    if (zoom === renderZoom) return
    const handle = window.setTimeout(() => setRenderZoom(zoom), 120)
    return () => window.clearTimeout(handle)
  }, [zoom, renderZoom])

  const innerWidth = Math.max(0, stageSize.width - STAGE_PADDING)
  const innerHeight = Math.max(0, stageSize.height - STAGE_PADDING)

  const metrics =
    pageSize && innerWidth > 0 && innerHeight > 0
      ? computeViewerMetrics({
          pageWidth: pageSize.width,
          pageHeight: pageSize.height,
          viewportWidth: innerWidth,
          viewportHeight: innerHeight,
          zoom: renderZoom,
          dpr,
          boxWidth,
          boxHeight,
        })
      : null

  /* Render the page to an offscreen canvas, then commit the bitmap and its
     text layer together so the surface never shows a half-drawn frame. */
  useEffect(() => {
    if (!pageSize || innerWidth <= 0 || innerHeight <= 0) return
    let cancelled = false
    let task: RenderTask | null = null

    const run = async () => {
      setRendering(true)
      setError(null)
      try {
        const pdfjs = await getPdfjs()
        const page = await doc.getPage(pageNumber)
        if (cancelled) return

        const frame = computeViewerMetrics({
          pageWidth: pageSize.width,
          pageHeight: pageSize.height,
          viewportWidth: innerWidth,
          viewportHeight: innerHeight,
          zoom: renderZoom,
          dpr,
          boxWidth,
          boxHeight,
        })

        const offscreen = document.createElement('canvas')
        offscreen.width = frame.pixelWidth
        offscreen.height = frame.pixelHeight
        const viewport = page.getViewport({ scale: frame.displayScale })
        const outputScale = frame.renderScale / frame.displayScale
        task = page.render({
          canvas: offscreen,
          viewport,
          transform: [outputScale, 0, 0, outputScale, 0, 0],
        })
        await task.promise
        if (cancelled) return

        const canvas = canvasRef.current
        if (!canvas) return
        canvas.width = frame.pixelWidth
        canvas.height = frame.pixelHeight
        const context = canvas.getContext('2d')
        if (!context) return
        context.drawImage(offscreen, 0, 0)

        const textContainer = textLayerRef.current
        if (textContainer) {
          textContainer.replaceChildren()
          textContainer.style.setProperty('--total-scale-factor', String(frame.displayScale))
          const textLayer = new pdfjs.TextLayer({
            textContentSource: page.streamTextContent(),
            container: textContainer,
            viewport,
          })
          await textLayer.render()
          if (cancelled) return
          const endOfContent = document.createElement('div')
          endOfContent.className = 'endOfContent'
          textContainer.append(endOfContent)
          setHasText(textLayer.textContentItemsStr.some((item) => item.trim().length > 0))
        }
      } catch (err) {
        const name = (err as { name?: string } | null)?.name
        if (!cancelled && name !== 'RenderingCancelledException') {
          setError('This page could not be rendered.')
        }
      } finally {
        if (!cancelled) setRendering(false)
      }
    }

    run()
    return () => {
      cancelled = true
      task?.cancel()
    }
  }, [doc, pageNumber, pageSize, innerWidth, innerHeight, renderZoom, dpr, boxWidth, boxHeight])

  /* Ctrl/⌘ + wheel zooms; the listener is non-passive so it can preventDefault. */
  useEffect(() => {
    const el = stageRef.current
    if (!el) return
    const onWheel = (event: WheelEvent) => {
      if (!(event.ctrlKey || event.metaKey)) return
      event.preventDefault()
      setZoom((current) => clampZoom(current * (event.deltaY < 0 ? 1.15 : 1 / 1.15)))
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [])

  const stepZoom = useCallback((factor: number) => {
    setZoom((current) => clampZoom(current * factor))
  }, [])

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key === '+' || event.key === '=') {
      event.preventDefault()
      stepZoom(ZOOM_STEP)
    } else if (event.key === '-' || event.key === '_') {
      event.preventDefault()
      stepZoom(1 / ZOOM_STEP)
    } else if (event.key === '0') {
      event.preventDefault()
      setZoom(1)
    }
  }

  const handleCopy = useCallback(async () => {
    if (!navigator.clipboard) return
    try {
      const page = await doc.getPage(pageNumber)
      const content = await page.getTextContent()
      const text = content.items
        .map((item) => ('str' in item ? item.str : ''))
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim()
      if (!text) return
      await navigator.clipboard.writeText(text)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1600)
    } catch {
      setError('Could not copy this page’s text.')
    }
  }, [doc, pageNumber])

  return (
    <div
      className={`${styles.viewer} ${variant === 'full' ? styles.viewerFull : ''}`}
      data-page-viewer=""
    >
      <div
        className={styles.viewerStage}
        ref={stageRef}
        tabIndex={0}
        role="document"
        aria-label={`Page ${pageNumber} preview, text selection enabled`}
        onKeyDown={handleKeyDown}
      >
        {metrics ? (
          <div
            className={styles.viewerBox}
            style={{ width: metrics.boxWidth, height: metrics.boxHeight }}
          >
            <div
              className={styles.viewerSurface}
              style={{ width: metrics.surfaceWidth, height: metrics.surfaceHeight }}
            >
              <canvas ref={canvasRef} className={styles.viewerCanvas} aria-hidden="true" />
              <div ref={textLayerRef} className={styles.textLayer} />
            </div>
          </div>
        ) : null}

        {rendering && !error ? (
          <div className={styles.viewerStatus}>
            <ScanLoader className={styles.viewerScan} />
            Rendering…
          </div>
        ) : null}
        {error ? (
          <div className={styles.viewerError} role="alert">
            {error}
          </div>
        ) : null}
      </div>

      <div className={styles.viewerBar}>
        <div className={styles.viewerZoom}>
          <button
            type="button"
            className={styles.viewerBtn}
            onClick={() => stepZoom(1 / ZOOM_STEP)}
            aria-label="Zoom out"
            disabled={zoom <= MIN_ZOOM}
          >
            −
          </button>
          <span className={styles.viewerPct} aria-live="polite">
            {Math.round(zoom * 100)}%
          </span>
          <button
            type="button"
            className={styles.viewerBtn}
            onClick={() => stepZoom(ZOOM_STEP)}
            aria-label="Zoom in"
            disabled={zoom >= MAX_ZOOM}
          >
            +
          </button>
          <button
            type="button"
            className={styles.viewerBtn}
            onClick={() => setZoom(1)}
            aria-label="Fit page"
            disabled={zoom === 1}
          >
            Fit
          </button>
        </div>

        <button
          type="button"
          className={styles.viewerBtn}
          onClick={handleCopy}
          disabled={!hasText || copied}
          title={hasText ? 'Copy the text on this page' : 'This page has no selectable text'}
        >
          {copied ? 'Copied' : 'Copy text'}
        </button>
      </div>
    </div>
  )
}
