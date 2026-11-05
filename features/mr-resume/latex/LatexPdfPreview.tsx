'use client'

import { useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties } from 'react'
import type { PDFDocumentLoadingTask, PDFDocumentProxy, PDFWorker, RenderTask, TextLayer } from 'pdfjs-dist'
import type { PageViewport } from 'pdfjs-dist/types/src/display/display_utils'
import type { LatexPdfLocation } from './types'
import { deriveBuildDetails, type BuildDetailsInput } from './buildDetails'
import { copyProofBytes, extractProofText, pdfProofIdentity, PROOF_LOCATE_LIMIT, PROOF_TEXT_LIMITS, proofDocumentBitmapSize, proofPoint, proofScrollPosition, proofSourceBox, proofTextPoint, type ProofTextPreview } from './pdfProof'
import styles from './LatexPdfPreview.module.css'
import LatexIcon from './LatexIcon'

export default function LatexPdfPreview({ proof, proofSource, currentAttempt, current, active, location, onPosition, navigationReason, detailsOpen, onDetailsOpenChange, onCompile, compileDisabled, compileReason }: BuildDetailsInput & {
  current: boolean
  active: boolean
  editing?: { projectId: string; revision: number } | null
  location?: LatexPdfLocation | null
  onPosition?: (position: { page: number; x: number; y: number }) => void
  navigationReason?: string
  detailsOpen?: boolean
  onDetailsOpenChange?: (open: boolean) => void
  onCompile: () => void
  compileDisabled: boolean
  compileReason: string
}) {
  const stage = useRef<HTMLDivElement>(null)
  const canvases = useRef(new Map<number, HTMLCanvasElement>())
  const sheets = useRef(new Map<number, HTMLDivElement>())
  const textContainers = useRef(new Map<number, HTMLDivElement>())
  const detailsToggle = useRef<HTMLButtonElement>(null), detailsPanel = useRef<HTMLDivElement>(null)
  const sourceAction = useRef<HTMLButtonElement>(null)
  const focusedLocateItem = useRef<HTMLElement | null>(null)
  const pointerSelection = useRef<{ key: string; selection: { page: number; range: Range } | null } | null>(null)
  const appliedTarget = useRef<string | null>(null)
  const viewAnchor = useRef<{ projectId: string; page: number; fraction: number; offset: number; left: number } | null>(null)
  const captureView = useRef<() => void>(() => {})
  const detailsId = useId(), locateHelpId = useId(), navigationMessageId = useId()
  const [localDetailsOpen, setLocalDetailsOpen] = useState(false)
  const [locateSession, setLocateSession] = useState<{ key: string; page: number; items: HTMLElement[] } | null>(null)
  const [navigationMessage, setNavigationMessage] = useState<{ key: string; message: string } | null>(null)
  const [width, setWidth] = useState(320)
  const [height, setHeight] = useState(480)
  const [ratio, setRatio] = useState(1)
  const [page, setPage] = useState(1)
  const [zoom, setZoom] = useState<number | 'fit' | 'page'>('fit')
  const [rotation, setRotation] = useState(0)
  const [loaded, setLoaded] = useState<{ key: string; document: PDFDocumentProxy } | null>(null)
  const [failure, setFailure] = useState<{ key: string; message: string } | null>(null)
  const [renderingPages, setRenderingPages] = useState(false)
  const [renderedPages, setRenderedPages] = useState<Record<number, { spec: string; viewport: PageViewport; textWarning: string | null; textItems: HTMLElement[] }>>({})
  const [pageErrors, setPageErrors] = useState<Record<number, { spec: string; message: string }>>({})
  const [layout, setLayout] = useState<{ identity: string; viewports: Record<number, PageViewport> } | null>(null)
  const [textRequest, setTextRequest] = useState<string | null>(null)
  const [extracted, setExtracted] = useState<{ document: PDFDocumentProxy; result: ProofTextPreview } | null>(null)
  const [textFailure, setTextFailure] = useState<{ key: string; document: PDFDocumentProxy; message: string } | null>(null)
  const proofKey = pdfProofIdentity(proof)
  const pages = proof?.pdf.pages ?? 1
  const target = current && proof && location && Number.isSafeInteger(location.page) && location.page >= 1 && location.page <= pages
    ? `${proofKey}:${location.page}:${location.x}:${location.y}:${location.width}:${location.height}` : null
  const selectedPage = Math.max(1, Math.min(pages, page))
  const validDocument = loaded?.key === proofKey && !loaded.document.loadingTask.destroyed ? loaded.document : null
  const fitHeight = zoom === 'page' ? Math.max(96, height - 24) : 0
  const renderIdentity = `${proofKey}:${validDocument?.loadingTask.docId ?? ''}:${zoom}:${rotation}:${width}:${fitHeight}:${ratio}`
  const pageSpec = (pageNumber: number) => `${renderIdentity}:${pageNumber}`
  const rendered = renderedPages[selectedPage]
  const spec = pageSpec(selectedPage)
  const ready = Boolean(validDocument && rendered?.spec === spec)
  const anyPageReady = Boolean(validDocument && Object.values(renderedPages).some((entry) => entry.spec.startsWith(`${renderIdentity}:`)))
  const globalError = failure?.key === proofKey ? failure.message : null
  const error = globalError ?? (pageErrors[selectedPage]?.spec === spec ? pageErrors[selectedPage].message : null)
  const textOpen = Boolean(proofKey && textRequest === proofKey)
  const textPreview = extracted?.document === validDocument && extracted?.result.key === proofKey ? extracted.result : null
  const textError = textFailure?.key === proofKey && textFailure.document === validDocument ? textFailure.message : null
  const detailsExpanded = detailsOpen ?? localDetailsOpen
  const report = detailsExpanded ? deriveBuildDetails({ proof, proofSource, currentAttempt }) : null
  // The parent owns the matching source-map artifact, including session-only browser maps.
  const canNavigate = Boolean(active && proof && current && onPosition)
  const navigationKey = `${renderIdentity}:${active}:${current}:${Boolean(onPosition)}:${proof?.runtime ?? 'native'}:${proof?.engine}:${proof?.profileVersion}`
  const locating = Boolean(locateSession?.key === navigationKey && canNavigate && validDocument && !globalError
    && renderedPages[locateSession.page]?.spec === pageSpec(locateSession.page))
  if (locateSession && !locating) setLocateSession(null)
  const navigationUnavailable = !proof ? 'Compile a PDF before locating source.' : !current ? 'This PDF is out of date. Compile the current source before locating a line.'
    : !active ? 'Open the PDF view before locating source.' : !onPosition ? navigationReason || 'Source navigation is unavailable for this proof. No position was guessed.'
      : error ? 'This page could not be rendered for source navigation. The original PDF is unchanged.' : !ready ? 'Wait for this PDF page to finish rendering before locating source.' : ''
  const notice = navigationMessage?.key === navigationKey ? navigationMessage.message : null

  function capturePageView() {
    const container = stage.current
    if (!container || !proof || !active || !validDocument || layout?.identity !== renderIdentity) return
    const bounds = container.getBoundingClientRect()
    if (bounds.height <= 0) return
    const visible = [...sheets.current].map(([number, sheet]) => ({ number, bounds: sheet.getBoundingClientRect() }))
      .map((item) => ({ ...item, visible: Math.max(0, Math.min(bounds.bottom, item.bounds.bottom) - Math.max(bounds.top, item.bounds.top)) }))
      .filter((item) => item.visible > 0 && item.bounds.height > 0).sort((left, right) => right.visible - left.visible || left.number - right.number)[0]
    if (!visible) return
    viewAnchor.current = { projectId: proof.projectId, page: visible.number, fraction: Math.max(0, (bounds.top - visible.bounds.top) / visible.bounds.height),
      offset: Math.max(0, visible.bounds.top - bounds.top), left: container.scrollLeft }
    setPage(visible.number)
  }
  captureView.current = capturePageView

  useLayoutEffect(() => {
    if (!detailsExpanded && detailsPanel.current?.contains(document.activeElement)) detailsToggle.current?.focus({ preventScroll: true })
  }, [detailsExpanded])

  useEffect(() => {
    if (!stage.current || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(([entry]) => {
      captureView.current()
      if (entry.contentRect.width > 0) setWidth(Math.max(128, Math.floor(entry.contentRect.width)))
      if (entry.contentRect.height > 0) setHeight(Math.max(128, Math.floor(entry.contentRect.height)))
    })
    const measureRatio = () => setRatio(Math.min(2, window.devicePixelRatio || 1))
    measureRatio(); window.addEventListener('resize', measureRatio)
    observer.observe(stage.current)
    return () => { observer.disconnect(); window.removeEventListener('resize', measureRatio) }
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
    if (!active || !validDocument || !stage.current) { setRenderingPages(false); return }
    let disposed = false
    let drawing: RenderTask | undefined
    const textLayers: TextLayer[] = []
    const allocated = new Set<HTMLCanvasElement>()
    setRenderedPages({})
    setPageErrors({})
    setRenderingPages(true)
    void (async () => {
      const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
      if (disposed) return
      // Reserve every real page's geometry before painting so later pages never shift into place.
      const plans = await Promise.all(Array.from({ length: pages }, async (_, index) => {
        const pageNumber = index + 1
        try {
          const pdfPage = await validDocument.getPage(pageNumber)
          const angle = (pdfPage.rotate + rotation) % 360, base = pdfPage.getViewport({ scale: 1, rotation: angle })
          const scale = typeof zoom === 'number' ? zoom : Math.max(0.05, Math.min(2, width / base.width, zoom === 'page' ? fitHeight / base.height : Infinity))
          const viewport = pdfPage.getViewport({ scale, rotation: angle })
          const size = proofDocumentBitmapSize(viewport.width, viewport.height, ratio, pages)
          return { pageNumber, pdfPage, viewport, size, error: null }
        } catch (reason) {
          return { pageNumber, pdfPage: null, viewport: null, size: null, error: reason instanceof Error && reason.message.includes('preview size') ? reason.message : `Page ${pageNumber} could not be loaded safely. The original PDF is unchanged.` }
        }
      }))
      if (disposed || validDocument.loadingTask.destroyed) return
      const viewports: Record<number, PageViewport> = {}
      for (const plan of plans) if (plan.viewport) viewports[plan.pageNumber] = plan.viewport
      setLayout({ identity: renderIdentity, viewports })
      let remainingTextItems = PROOF_TEXT_LIMITS.items
      for (const { pageNumber, pdfPage, viewport, size, error: pageError } of plans) {
        if (disposed || validDocument.loadingTask.destroyed) return
        const currentSpec = `${renderIdentity}:${pageNumber}`
        if (!pdfPage || !viewport || !size) {
          setPageErrors((previous) => ({ ...previous, [pageNumber]: { spec: currentSpec, message: pageError! } }))
          continue
        }
        const surface = canvases.current.get(pageNumber)
        const container = textContainers.current.get(pageNumber)
        if (!surface || !container) continue
        try {
          const context = surface.getContext('2d', { alpha: false })
          if (!context) throw new Error('Canvas unavailable')
          allocated.add(surface)
          surface.width = size.width
          surface.height = size.height
          surface.style.width = `${viewport.width}px`
          surface.style.height = `${viewport.height}px`
          container.style.setProperty('--scale-factor', String(viewport.scale))
          container.style.setProperty('--user-unit', String(pdfPage.userUnit))
          drawing = pdfPage.render({ canvas: surface, canvasContext: context, viewport, transform: size.density === 1 ? undefined : [size.density, 0, 0, size.density, 0, 0], background: '#ffffff' })
          await drawing.promise
          drawing = undefined
          if (disposed) return
          let textWarning: string | null = null
          let textLayer: TextLayer | undefined
          try {
            const content = await pdfPage.getTextContent({ disableNormalization: true })
            if (disposed) return
            if (content.items.length > Math.min(8000, remainingTextItems)) textWarning = 'Selectable text exceeds the bounded preview limit. The original PDF is unchanged.'
            else {
              textLayer = new pdfjs.TextLayer({ textContentSource: content, container, viewport })
              textLayers.push(textLayer)
              await textLayer.render()
              remainingTextItems -= content.items.length
            }
          } catch { if (disposed) return; textLayer?.cancel(); container.replaceChildren(); textWarning = 'The PDF page rendered, but its selectable text layer is unavailable.' }
          if (disposed) return
          setRenderedPages((previous) => ({ ...previous, [pageNumber]: { spec: currentSpec, viewport, textWarning, textItems: textWarning ? [] : textLayer?.textDivs ?? [] } }))
        } catch (reason) {
          if (!disposed) setPageErrors((previous) => ({ ...previous, [pageNumber]: { spec: currentSpec, message: reason instanceof Error && reason.message.includes('preview size') ? reason.message : `Page ${pageNumber} could not be rendered safely. Reduce the zoom or download the original PDF.` } }))
        } finally {
          pdfPage.cleanup()
        }
      }
    })().catch(() => { if (!disposed) setFailure({ key: proofKey, message: 'This PDF could not be rendered safely. The original download and your source are unchanged.' }) })
      .finally(() => { if (!disposed) setRenderingPages(false) })
    return () => {
      disposed = true; drawing?.cancel(); textLayers.forEach((textLayer) => textLayer.cancel())
      for (const surface of allocated) { surface.width = 0; surface.height = 0 }
    }
  }, [active, validDocument, pages, zoom, rotation, width, fitHeight, ratio, renderIdentity, proofKey])

  useEffect(() => {
    const container = stage.current
    if (!container || !active || layout?.identity !== renderIdentity || typeof IntersectionObserver === 'undefined') return
    const observer = new IntersectionObserver(() => captureView.current(), { root: container, threshold: Array.from({ length: 101 }, (_, index) => index / 100) })
    sheets.current.forEach((sheet) => observer.observe(sheet))
    return () => observer.disconnect()
  }, [active, layout, renderIdentity])

  useLayoutEffect(() => {
    const container = stage.current, anchor = viewAnchor.current
    if (!container || !proof || layout?.identity !== renderIdentity) return
    if (!anchor || anchor.projectId !== proof.projectId) { container.scrollTo({ top: 0, left: 0 }); setPage(1); return }
    const sheet = sheets.current.get(Math.min(pages, anchor.page))
    if (!sheet) return
    const bounds = sheet.getBoundingClientRect(), root = container.getBoundingClientRect()
    container.scrollTo({ top: Math.max(0, container.scrollTop + bounds.top - root.top + bounds.height * anchor.fraction - anchor.offset), left: anchor.left })
  }, [layout, renderIdentity, proof, pages])

  useLayoutEffect(() => {
    if (!target) { appliedTarget.current = null; return }
    const container = stage.current, sheet = location && sheets.current.get(location.page)
    const viewport = location && layout?.identity === renderIdentity ? layout.viewports[location.page] : null
    if (!container || !sheet || !viewport || !location || appliedTarget.current === target) return
    const box = proofSourceBox(location, viewport)
    if (!box) return
    const bounds = sheet.getBoundingClientRect()
    const position = proofScrollPosition(container.getBoundingClientRect(), { left: bounds.left + box.left, top: bounds.top + box.top, width: box.width, height: box.height }, container.scrollTop, container.scrollLeft)
    if (position) { container.scrollTo(position); appliedTarget.current = target; setPage(location.page) }
  }, [target, location, layout, renderIdentity])

  useEffect(() => {
    if (!active || !textOpen || !validDocument || !expectedPages || (extracted?.document === validDocument && extracted.result.key === proofKey)) return
    let disposed = false
    setTextFailure(null)
    void extractProofText(validDocument, proofKey, expectedPages, () => !disposed).then((result) => {
      if (!disposed) setExtracted({ document: validDocument, result })
    }).catch(() => {
      if (!disposed) setTextFailure({ key: proofKey, document: validDocument, message: 'Text inspection is unavailable. Close and reopen this section to retry; the original PDF and source are unchanged.' })
    })
    return () => { disposed = true }
  }, [active, textOpen, validDocument, expectedPages, proofKey, extracted])

  useEffect(() => {
    if (!locating || !locateSession) return
    const items = locateSession.items
    const scrollStage = stage.current, trigger = sourceAction.current
    const attributes = items.map((item) => ({ item, role: item.getAttribute('role'), tabIndex: item.getAttribute('tabindex'), description: item.getAttribute('aria-describedby') }))
    items.forEach((item, index) => {
      item.setAttribute('role', 'button')
      item.setAttribute('aria-describedby', locateHelpId)
      item.tabIndex = index === 0 ? 0 : -1
    })
    focusedLocateItem.current = items[0] ?? null
    items[0]?.focus({ preventScroll: true })
    if (items[0]) showTextItem(items[0])
    return () => {
      // Restore PDF.js semantics and normal selection; only explicit locate mode adds tab stops.
      if (items.includes(document.activeElement as HTMLElement) && scrollStage?.getClientRects().length) trigger?.focus({ preventScroll: true })
      for (const { item, role, tabIndex, description } of attributes) {
        for (const [name, value] of [['role', role], ['tabindex', tabIndex], ['aria-describedby', description]] as const) {
          if (value === null) item.removeAttribute(name); else item.setAttribute(name, value)
        }
      }
    }
  }, [locating, locateSession, locateHelpId])

  function changeDetails(open: boolean) {
    if (!open && detailsPanel.current?.contains(document.activeElement)) detailsToggle.current?.focus({ preventScroll: true })
    if (detailsOpen === undefined) setLocalDetailsOpen(open)
    onDetailsOpenChange?.(open)
  }

  function selectedPdfText() {
    const selection = window.getSelection()
    if (!selection || selection.isCollapsed || !selection.rangeCount) return null
    const range = selection.getRangeAt(0)
    if (![...textContainers.current.values()].some((container) => container.contains(range.endContainer))) return null
    for (const [pageNumber, container] of textContainers.current) {
      if (!container.contains(range.startContainer)) continue
      const fragment = range.cloneRange()
      // Cross-page selection remains native; navigation uses its first real page fragment.
      if (!container.contains(fragment.endContainer)) fragment.setEnd(container, container.childNodes.length)
      return fragment.toString().trim() ? { page: pageNumber, range: fragment } : null
    }
    return null
  }

  function showTextItem(item: HTMLElement) {
    const container = stage.current
    if (!container) return
    const position = proofScrollPosition(container.getBoundingClientRect(), item.getBoundingClientRect(), container.scrollTop, container.scrollLeft)
    if (position) container.scrollTo(position)
  }

  function closeLocate() {
    setLocateSession(null); setNavigationMessage(null)
    sourceAction.current?.focus({ preventScroll: true })
  }

  function locateText(item: HTMLElement) {
    const pageNumber = Number(item.closest<HTMLElement>('[data-page-text]')?.dataset.pageText)
    const surface = canvases.current.get(pageNumber), pageRendered = renderedPages[pageNumber]
    if (!canNavigate || !validDocument || globalError || !pageRendered || pageRendered.spec !== pageSpec(pageNumber) || !surface || !textContainers.current.get(pageNumber)?.contains(item)) { setNavigationMessage({ key: navigationKey, message: navigationUnavailable || 'This text item no longer belongs to the rendered proof.' }); return }
    const point = proofTextPoint(item.getClientRects(), surface.getBoundingClientRect(), pageRendered.viewport)
    if (!point) { setNavigationMessage({ key: navigationKey, message: 'This text item has no visible PDF geometry. No position was guessed.' }); return }
    setNavigationMessage(null)
    onPosition?.({ page: pageNumber, ...point })
  }

  function goToSource(captured: typeof pointerSelection.current) {
    pointerSelection.current = null
    if (locating) { closeLocate(); return }
    const selected = captured?.key === navigationKey ? captured.selection : selectedPdfText()
    const pageNumber = selected?.page ?? selectedPage, pageRendered = renderedPages[pageNumber]
    const surface = canvases.current.get(pageNumber), textContainer = textContainers.current.get(pageNumber)
    if (!canNavigate || !validDocument || globalError || !pageRendered || pageRendered.spec !== pageSpec(pageNumber) || !surface || !textContainer) { setNavigationMessage({ key: navigationKey, message: navigationUnavailable || 'Wait for this PDF page to finish rendering.' }); return }
    const range = selected?.range
    const bounds = surface.getBoundingClientRect()
    if (range && textContainer.contains(range.startContainer) && textContainer.contains(range.endContainer)) {
      const point = proofTextPoint(range.getClientRects(), bounds, pageRendered.viewport)
      if (!point) { setNavigationMessage({ key: navigationKey, message: 'The selected PDF text has no visible geometry on this page. No position was guessed.' }); return }
      setNavigationMessage(null)
      onPosition?.({ page: pageNumber, ...point })
      return
    }
    const items = pageRendered.textItems.slice(0, PROOF_LOCATE_LIMIT).filter((item) => item.isConnected && item.textContent?.trim() && proofTextPoint(item.getClientRects(), bounds, pageRendered.viewport))
    if (!items.length) {
      setNavigationMessage({ key: navigationKey, message: pageRendered.textWarning ? 'The PDF text layer is unavailable for locate mode. The original PDF and source are unchanged.'
        : 'No selectable text items are available for locate mode on this page. Images and whitespace do not supply text geometry; no source position was guessed.' })
      return
    }
    setNavigationMessage(null)
    setLocateSession({ key: navigationKey, page: pageNumber, items })
  }

  function renderPage(pageNumber: number) {
    const currentSpec = pageSpec(pageNumber)
    const pageRendered = renderedPages[pageNumber]
    const pageReady = Boolean(validDocument && pageRendered?.spec === currentSpec)
    const pageError = pageErrors[pageNumber]?.spec === currentSpec ? pageErrors[pageNumber].message : null
    const viewport = layout?.identity === renderIdentity ? layout.viewports[pageNumber] : null
    const sheetWidth = viewport?.width ?? Math.min(width, 540), sheetHeight = viewport?.height ?? sheetWidth * 297 / 210
    const pageBox = current && location?.page === pageNumber && pageReady && pageRendered ? proofSourceBox(location, pageRendered.viewport) : null
    return <figure key={`${proofKey}:${pageNumber}`} className={styles.pageFrame} aria-label={`PDF page ${pageNumber} of ${pages}`}>
      <figcaption className={styles.pageLabel}><span>Page {pageNumber} of {pages}</span>{pageReady && pageRendered?.textWarning && <span className={styles.textWarning} title={pageRendered.textWarning}>Text layer unavailable</span>}</figcaption>
      <div ref={(element) => { if (element) sheets.current.set(pageNumber, element); else sheets.current.delete(pageNumber) }} className={styles.sheet} data-page={pageNumber} data-ready={pageReady && !pageError} style={{ width: sheetWidth, height: sheetHeight }} onDoubleClick={(event) => {
      if (locating) return
      const surface = canvases.current.get(pageNumber)
      if (!canNavigate || !pageReady || pageError || !onPosition || !pageRendered || !surface) { setNavigationMessage({ key: navigationKey, message: navigationUnavailable }); return }
      const point = proofPoint(event.clientX, event.clientY, surface.getBoundingClientRect(), pageRendered.viewport)
      if (point) { setNavigationMessage(null); onPosition({ page: pageNumber, ...point }) }
      else setNavigationMessage({ key: navigationKey, message: 'There is no PDF point at this position. No source position was guessed.' })
    }}>
      <canvas key={currentSpec} width={0} height={0} ref={(element) => { if (element) canvases.current.set(pageNumber, element); else canvases.current.delete(pageNumber) }} className={styles.canvas} aria-label={`Typeset PDF page ${pageNumber} of ${pages}`} />
      <div key={`${currentSpec}:text`} ref={(element) => { if (element) textContainers.current.set(pageNumber, element); else textContainers.current.delete(pageNumber) }} className={styles.textLayer} data-page-text={pageNumber} data-locating={locating && locateSession?.page === pageNumber} role={locating && locateSession?.page === pageNumber ? 'group' : undefined} aria-label={`Selectable text on PDF page ${pageNumber}`} onFocus={(event) => {
        if (selectedPage !== pageNumber) setPage(pageNumber)
        if (!locating || !locateSession?.items.includes(event.target as HTMLElement)) return
        if (focusedLocateItem.current) focusedLocateItem.current.tabIndex = -1
        focusedLocateItem.current = event.target as HTMLElement
        focusedLocateItem.current.tabIndex = 0
      }} onBlur={(event) => {
        if (locating && event.relatedTarget && !event.currentTarget.contains(event.relatedTarget) && event.relatedTarget !== sourceAction.current) setLocateSession(null)
      }} onKeyDown={(event) => {
        if (!locating || !locateSession) return
        if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); closeLocate(); return }
        if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return
        const items = locateSession.items, index = items.indexOf(event.target as HTMLElement)
        if (index < 0) return
        if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); event.stopPropagation(); locateText(items[index]); return }
        const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : ['ArrowRight', 'ArrowDown'].includes(event.key) ? Math.min(items.length - 1, index + 1) : ['ArrowLeft', 'ArrowUp'].includes(event.key) ? Math.max(0, index - 1) : null
        if (next !== null) { event.preventDefault(); items[next].focus({ preventScroll: true }); showTextItem(items[next]) }
      }} onClick={(event) => {
        if (!locating || !locateSession || event.detail > 1) return
        event.preventDefault(); event.stopPropagation()
        const item = (event.target as HTMLElement).closest<HTMLElement>('[role="button"]')
        if (item && locateSession.items.includes(item)) { item.focus({ preventScroll: true }); locateText(item) }
        else setNavigationMessage({ key: navigationKey, message: 'Choose a text item in locate mode. Whitespace, images and items beyond its limit have no selectable target here; no position was guessed.' })
      }} />
      {pageBox && <span className={styles.registration} style={pageBox as CSSProperties} aria-label="Measured source position" />}
      {!pageReady && <div className={styles.pagePlaceholder} role={pageError ? 'note' : undefined}><b>{pageError ? `Page ${pageNumber} unavailable` : `Loading page ${pageNumber}`}</b>{pageError && <p>{pageError}</p>}</div>}
      </div>
    </figure>
  }

  return <section className={styles.preview} aria-label="Compiled PDF proof">
    <header className={styles.controls}>
      <div className={styles.identity}><b>PDF</b><span role="group" data-state={!proof ? 'empty' : current ? 'current' : 'stale'} aria-label={proof ? `Compiled revision ${proof.revision}. ${current ? 'Current source' : 'Out of date'}.` : 'Not compiled'}>{proof ? <><LatexIcon name={current ? 'check' : 'alert'} /><span className={styles.revision}>Compiled r{proof.revision}</span><span className={styles.freshness}>{current ? 'Current' : 'Out of date'}</span></> : 'Not compiled'}</span></div>
      <div className={styles.navigation} role="group" aria-label="PDF page and source controls">
        {proof && <span className={styles.pageCounter} aria-label={`Viewing page ${selectedPage} of ${pages}`}>{selectedPage} / {pages}</span>}
        <select aria-label="PDF zoom" value={zoom} disabled={!proof} onChange={(event) => { capturePageView(); setZoom(event.target.value === 'fit' || event.target.value === 'page' ? event.target.value : Number(event.target.value)) }}><option value="fit">Fit width</option><option value="page">Fit page</option>{[0.5, 0.75, 1, 1.25, 1.5, 2].map((value) => <option key={value} value={value}>{value * 100}%</option>)}</select>
        <button type="button" aria-label="Rotate PDF pages clockwise" title="Rotate PDF pages clockwise" disabled={!proof} onClick={() => { capturePageView(); setRotation((value) => (value + 90) % 360) }}><LatexIcon name="rotate" /></button>
        <button ref={sourceAction} type="button" className={styles.sourceAction} aria-label={locating ? 'Cancel locate mode' : 'Go to source'} aria-pressed={locating} aria-disabled={!canNavigate || !anyPageReady || Boolean(globalError)} aria-describedby={locating ? locateHelpId : notice ? navigationMessageId : undefined} title={locating ? 'Exit locate mode and return to normal text selection.' : navigationUnavailable || 'Use selected PDF text or choose a text item. Double-click also locates source.'}
          onPointerDown={() => { pointerSelection.current = { key: navigationKey, selection: selectedPdfText() } }} onPointerCancel={() => { pointerSelection.current = null }}
          onClick={(event) => goToSource(event.detail > 0 ? pointerSelection.current : null)}><LatexIcon name="target" /><span className={styles.sourceLabel}>{locating ? 'Cancel locate' : 'Go to source'}</span></button>
        <button ref={detailsToggle} type="button" className={styles.detailsToggle} aria-label="Compiled PDF details" title="Compiled PDF details" aria-expanded={detailsExpanded} aria-controls={detailsId} onClick={() => changeDetails(!detailsExpanded)}><span className={styles.detailsLabel}>Details</span><LatexIcon name={detailsExpanded ? 'chevronUp' : 'chevronDown'} /></button>
      </div>
    </header>
    <div ref={detailsPanel} id={detailsId} className={styles.details} hidden={!detailsExpanded} role="region" aria-label="Compiled PDF details" tabIndex={0} onKeyDown={(event) => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); changeDetails(false); detailsToggle.current?.focus({ preventScroll: true }) }
    }}>
      {report ? <>
        <p>Captured build evidence for this PDF, not current editing settings.</p>
        <dl className={styles.detailFacts}>
          <div><dt>Runtime</dt><dd>{report.runtime === 'browser' ? 'Local browser' : 'Private native'}</dd></div>
          <div><dt>Engine</dt><dd>{report.engine}</dd></div>
          <div><dt>Profile</dt><dd><code>{report.profileVersion}</code></dd></div>
          <div><dt>Main source</dt><dd>{report.project.mainFile ?? 'Not recorded'}</dd></div>
          <div><dt>PDF</dt><dd>{report.pdf.pages} {report.pdf.pages === 1 ? 'page' : 'pages'} / {report.pdf.bytes.toLocaleString('en-US')} bytes. Preview and download use the same PDF bytes.</dd></div>
          <div><dt>PDF SHA-256</dt><dd><code>{report.pdf.sha256}</code></dd></div>
          <div><dt>Source SHA-256</dt><dd><code>{report.project.snapshotHash}</code></dd></div>
          <div><dt>Source map</dt><dd>{current && onPosition ? 'Available for this current proof.' : !current ? 'Navigation is disabled while this PDF is out of date.' : navigationReason || 'Source navigation is unavailable for this proof.'}</dd></div>
        </dl>
        <p>Source navigation uses compiler-recorded lines, not character-exact matches. Text, whitespace and images can be unmapped; no position is guessed.</p>
        <p>All pages share a bounded screen-rendering budget. The downloaded PDF keeps its original full-quality bytes.</p>
        <p>{report.qualification}</p>
      </> : <p>No compiled proof is available. Current settings are not evidence of a completed build.</p>}
    </div>
    {(locating || notice) && <div className={styles.navigationFeedback} role="status">
        {locating && <p id={locateHelpId}>Choose PDF text with the arrow keys, then press Enter, or tap a text item. Escape cancels.{rendered && rendered.textItems.length > PROOF_LOCATE_LIMIT && ` Locate mode covers the first ${PROOF_LOCATE_LIMIT.toLocaleString('en-US')} text items on this page; exit and select other text to locate it.`}</p>}
        {notice && <p id={navigationMessageId}>{notice}</p>}
    </div>}
    <div ref={stage} className={styles.stage} tabIndex={0} role="region" aria-label="Scrollable PDF document" aria-busy={Boolean(proof && active && (!validDocument || renderingPages) && !globalError)}>
      {!proof ? <div className={styles.empty}><div className={styles.emptyMark} aria-hidden="true"><span>TeX</span><i /><i /><i /><b>PDF</b></div><h3>Your typeset proof appears here</h3><p>Compile a source snapshot to see its real PDF. Nothing is reconstructed from an HTML preview.</p><button type="button" className={styles.compileButton} disabled={compileDisabled} title={compileReason || 'Compile this source snapshot'} onClick={onCompile}><LatexIcon name="play" />Compile now</button>{compileReason && <p className={styles.availability}>{compileReason}</p>}</div> : <>
        {globalError && <p className={styles.error} role="alert">{globalError}</p>}
        {(!validDocument || renderingPages) && !globalError && <p className={styles.loading} role="status">{!validDocument ? 'Loading compiled PDF...' : 'Rendering PDF pages...'}</p>}
        {!globalError && <div className={styles.pageStack}>{Array.from({ length: pages }, (_, index) => renderPage(index + 1))}</div>}
        <details key={proofKey} className={styles.extracted} onToggle={(event) => setTextRequest(event.currentTarget.open ? proofKey : null)}>
          <summary>Inspect PDF text order</summary>
          <p>Read-only text from this compiled PDF in PDF.js extraction order, not an ATS score or a verified visual reading order. Columns, ligatures and spacing may differ from the page. Complex Bangla clusters may not copy or search faithfully even when glyphs render correctly. No OCR or source reconstruction is used.</p>
          {textOpen && <div className={styles.extractedPages} aria-label={`Extracted text from compiled revision ${proof.revision}`} aria-busy={active && !textPreview && !textError && !error} tabIndex={0}>
            {textError ? <p>{textError}</p> : !textPreview ? <p>{error ? 'Load the retained PDF to inspect its text. The original download remains available.' : active ? 'Reading text from the loaded PDF...' : 'Open the PDF view to inspect text.'}</p> : <>
              {textPreview.pages.map((item) => <section key={item.page} aria-label={`Extracted text, PDF page ${item.page}`}><h3>Page {item.page}</h3>{item.error ? <p>{item.error}</p> : item.text.trim() ? <pre>{item.text}</pre> : <p>No extractable text was reported for this page. This is not a statement that the page is empty.</p>}</section>)}
              {textPreview.truncated && <p className={styles.textLimit}>Text inspection reached its display limit. This is only a partial extraction; the PDF and its download bytes are unchanged.</p>}
            </>}
          </div>}
        </details>
      </>}
    </div>
  </section>
}
