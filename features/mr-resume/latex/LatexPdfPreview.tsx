'use client'

import { useEffect, useRef, useState, type CSSProperties } from 'react'
import type { PDFDocumentLoadingTask, PDFDocumentProxy, PDFWorker, RenderTask, TextLayer } from 'pdfjs-dist'
import type { PageViewport } from 'pdfjs-dist/types/src/display/display_utils'
import type { LatexPdfLocation, LatexProof } from './types'
import { copyProofBytes, proofBitmapSize, proofPoint, proofSourceBox } from './pdfProof'
import styles from './LatexPdfPreview.module.css'

export default function LatexPdfPreview({ proof, current, active, location, onPosition }: {
  proof: LatexProof | null
  current: boolean
  active: boolean
  location?: LatexPdfLocation | null
  onPosition?: (position: { page: number; x: number; y: number }) => void
}) {
  const stage = useRef<HTMLDivElement>(null)
  const canvas = useRef<HTMLCanvasElement>(null)
  const textContainer = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(320)
  const [page, setPage] = useState(1)
  const [zoom, setZoom] = useState<number | null>(null)
  const [rotation, setRotation] = useState(0)
  const [loaded, setLoaded] = useState<{ key: string; document: PDFDocumentProxy } | null>(null)
  const [failure, setFailure] = useState<{ key: string; message: string } | null>(null)
  const [rendered, setRendered] = useState<{ spec: string; viewport: PageViewport; text: string; textWarning: boolean } | null>(null)
  const [lastTarget, setLastTarget] = useState<string | null>(null)
  const proofKey = proof ? `${proof.operationKey}:${proof.snapshotHash}:${proof.pdf.sha256}` : ''
  const target = current && proof && location ? `${proofKey}:${location.page}:${location.x}:${location.y}:${location.width}:${location.height}` : null
  // Prop-driven source navigation is consumed once; normal page controls then work.
  if (lastTarget !== target) { setLastTarget(target); if (target && location) setPage(location.page) }
  const pages = proof?.pdf.pages ?? 1
  const selectedPage = Math.max(1, Math.min(pages, page))
  const validDocument = loaded?.key === proofKey && !loaded.document.loadingTask.destroyed ? loaded.document : null
  const spec = `${proofKey}:${validDocument?.loadingTask.docId ?? ''}:${selectedPage}:${zoom ?? 'fit'}:${rotation}:${width}`
  const ready = Boolean(validDocument && rendered?.spec === spec)
  const error = failure?.key === proofKey || failure?.key === spec ? failure.message : null
  const box = current && location?.page === selectedPage && ready && rendered ? proofSourceBox(location, rendered.viewport) : null

  useEffect(() => {
    if (!stage.current || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(([entry]) => { if (entry.contentRect.width > 0) setWidth(Math.max(128, Math.floor(entry.contentRect.width - 32))) })
    observer.observe(stage.current)
    return () => observer.disconnect()
  }, [])

  const data = proof?.data
  const expectedBytes = proof?.pdf.bytes
  const expectedPages = proof?.pdf.pages
  useEffect(() => {
    if (!active || !data || !expectedBytes || !expectedPages) return
    let disposed = false
    let loading: PDFDocumentLoadingTask | undefined
    let pdfWorker: PDFWorker | undefined
    let nativeWorker: Worker | undefined
    let timer: ReturnType<typeof setTimeout> | undefined
    void (async () => {
      const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
      if (disposed) return
      nativeWorker = new Worker(new URL('pdfjs-dist/legacy/build/pdf.worker.min.mjs', import.meta.url), { type: 'module', name: 'mr-resume-pdf' })
      pdfWorker = pdfjs.PDFWorker.create({ port: nativeWorker, verbosity: 0 })
      loading = pdfjs.getDocument({ data: copyProofBytes(data, expectedBytes), worker: pdfWorker, isEvalSupported: false, enableXfa: false, useSystemFonts: false, useWorkerFetch: false, disableAutoFetch: true, disableRange: true, disableStream: true, maxImageSize: 16 * 1024 * 1024, canvasMaxAreaInBytes: 64 * 1024 * 1024, stopAtErrors: true, verbosity: 0 })
      nativeWorker.onerror = (event) => { event.preventDefault(); if (!disposed) setFailure({ key: proofKey, message: 'The isolated PDF viewer could not start. Your PDF download and source are unchanged.' }); void loading?.destroy().catch(() => {}); nativeWorker?.terminate() }
      loading.onPassword = () => { if (!disposed) setFailure({ key: proofKey, message: 'An encrypted PDF is not a valid compiler proof.' }); void loading?.destroy().catch(() => {}) }
      timer = setTimeout(() => { if (!disposed) setFailure({ key: proofKey, message: 'The PDF viewer did not finish loading. Your source and original PDF remain available.' }); void loading?.destroy().catch(() => {}); nativeWorker?.terminate() }, 15000)
      const document = await loading.promise
      clearTimeout(timer)
      if (disposed) { void document.destroy().catch(() => {}); return }
      if (document.numPages !== expectedPages) throw new Error('The PDF page count does not match the compiler proof.')
      setFailure((previous) => previous?.key === proofKey ? null : previous)
      setLoaded({ key: proofKey, document })
    })().catch(() => {
      if (!disposed) setFailure({ key: proofKey, message: 'This PDF could not be rendered safely. The original download and your source are unchanged.' })
      if (timer) clearTimeout(timer)
      if (loading) void loading.destroy().catch(() => {}).finally(() => { pdfWorker?.destroy(); nativeWorker?.terminate() })
      else { pdfWorker?.destroy(); nativeWorker?.terminate() }
    })
    return () => {
      disposed = true
      if (timer) clearTimeout(timer)
      if (loading) void loading.destroy().catch(() => {}).finally(() => { pdfWorker?.destroy(); nativeWorker?.terminate() })
      else { pdfWorker?.destroy(); nativeWorker?.terminate() }
    }
  }, [active, data, expectedBytes, expectedPages, proofKey])

  useEffect(() => {
    if (!active || !validDocument || !canvas.current || !textContainer.current) return
    let disposed = false
    let drawing: RenderTask | undefined
    let textLayer: TextLayer | undefined
    const surface = canvas.current
    const container = textContainer.current
    void (async () => {
      const pdfPage = await validDocument.getPage(selectedPage)
      if (disposed) return
      const base = pdfPage.getViewport({ scale: 1, rotation: (pdfPage.rotate + rotation) % 360 })
      const scale = zoom ?? Math.max(0.05, Math.min(2, width / base.width))
      const viewport = pdfPage.getViewport({ scale, rotation: (pdfPage.rotate + rotation) % 360 })
      const size = proofBitmapSize(viewport.width, viewport.height, window.devicePixelRatio || 1)
      const context = surface.getContext('2d', { alpha: false })
      if (!context) throw new Error('Canvas unavailable')
      surface.width = size.width
      surface.height = size.height
      surface.style.width = `${viewport.width}px`
      surface.style.height = `${viewport.height}px`
      container.style.setProperty('--scale-factor', String(scale))
      container.style.setProperty('--user-unit', String(pdfPage.userUnit))
      drawing = pdfPage.render({ canvas: surface, canvasContext: context, viewport, transform: size.density === 1 ? undefined : [size.density, 0, 0, size.density, 0, 0], background: '#ffffff' })
      await drawing.promise
      if (disposed) return
      let text = ''
      let textWarning = false
      try {
        const content = await pdfPage.getTextContent({ disableNormalization: true })
        if (disposed) return
        text = content.items.map((item) => 'str' in item ? `${item.str}${item.hasEOL ? '\n' : ' '}` : '').join('')
        const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
        if (disposed) return
        textLayer = new pdfjs.TextLayer({ textContentSource: content, container, viewport })
        await textLayer.render()
      } catch { if (disposed) return; textLayer?.cancel(); container.replaceChildren(); textWarning = true }
      if (!disposed) setRendered({ spec, viewport, text, textWarning })
    })().catch((reason: unknown) => { if (!disposed) setFailure({ key: spec, message: reason instanceof Error && reason.message.includes('preview size') ? reason.message : 'This page could not be rendered safely. Reduce the zoom or download the original PDF.' }) })
    return () => { disposed = true; drawing?.cancel(); textLayer?.cancel() }
  }, [active, validDocument, selectedPage, zoom, rotation, width, spec])

  return <section className={styles.preview} aria-label="Compiled PDF proof">
    <header className={styles.controls}>
      <div className={styles.identity}><b>PDF proof</b><span data-current={current}>{proof ? `Revision ${proof.revision}${current ? ' / current' : ' / older source'}` : 'Not compiled'}</span></div>
      <div className={styles.navigation}>
        <button type="button" aria-label="Previous PDF page" disabled={!proof || selectedPage <= 1} onClick={() => setPage(selectedPage - 1)}>&lt;</button>
        <select aria-label="PDF page" value={selectedPage} disabled={!proof} onChange={(event) => setPage(Number(event.target.value))}>{Array.from({ length: pages }, (_, index) => <option key={index + 1} value={index + 1}>{index + 1} / {pages}</option>)}</select>
        <button type="button" aria-label="Next PDF page" disabled={!proof || selectedPage >= pages} onClick={() => setPage(selectedPage + 1)}>&gt;</button>
        <select aria-label="PDF zoom" value={zoom ?? 'fit'} disabled={!proof} onChange={(event) => setZoom(event.target.value === 'fit' ? null : Number(event.target.value))}><option value="fit">Fit width</option>{[0.5, 0.75, 1, 1.25, 1.5, 2].map((value) => <option key={value} value={value}>{value * 100}%</option>)}</select>
        <button type="button" aria-label="Rotate PDF page clockwise" disabled={!proof} onClick={() => setRotation((value) => (value + 90) % 360)}>Rotate</button>
      </div>
    </header>
    <div ref={stage} className={styles.stage} aria-busy={Boolean(proof && active && !ready && !error)}>
      {!proof ? <div className={styles.empty}><span className={styles.emptyMark} aria-hidden="true">PDF</span><h3>Your typeset proof appears here</h3><p>Compile a source snapshot to see its real PDF. Nothing is reconstructed from an HTML preview.</p></div> : <>
        {error && <p className={styles.error} role="alert">{error}</p>}
        {!ready && !error && active && <p className={styles.loading} role="status">Rendering the compiled PDF page...</p>}
        <div className={styles.sheet} data-ready={ready && !error} onDoubleClick={(event) => {
          if (!active || !current || !proof.syncAvailable || !ready || !onPosition || !rendered || !canvas.current) return
          const point = proofPoint(event.clientX, event.clientY, canvas.current.getBoundingClientRect(), rendered.viewport)
          if (point) onPosition({ page: selectedPage, ...point })
        }}>
          <canvas key={spec} ref={canvas} className={styles.canvas} aria-label={`Typeset PDF page ${selectedPage} of ${pages}`} />
          <div key={`${spec}:text`} ref={textContainer} className={styles.textLayer} aria-label={`Selectable text on PDF page ${selectedPage}`} />
          {box && <span className={styles.registration} style={box as CSSProperties} aria-label="Measured source position" />}
        </div>
        {ready && rendered?.textWarning && <p className={styles.error}>The PDF page rendered, but its selectable text layer is unavailable.</p>}
        {ready && rendered?.text && <details className={styles.extracted}><summary>Inspect this PDF page&apos;s extracted text</summary><pre>{rendered.text}</pre></details>}
      </>}
    </div>
    <footer className={styles.footer}><span>{proof ? `${proof.engine} / ${proof.profileVersion} / ${(proof.pdf.bytes / 1024).toFixed(0)} KB / exact PDF bytes` : 'Source editing does not upload or compile automatically.'}</span><span>{proof?.syncAvailable && current ? 'Double-click the proof to locate source.' : proof ? 'Source navigation is unavailable for this proof.' : 'Compile to generate a proof.'}</span></footer>
  </section>
}
