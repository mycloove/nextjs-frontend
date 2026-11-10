'use client'

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type MouseEvent } from 'react'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import {
  ActionButton,
  Dialog,
  DownloadIcon,
  DropAnywhere,
  FileChip,
  HonestProgress,
  Notice,
  NoticeList,
  PageRangeField,
  PageThumb,
  Receipt,
  describeLimits,
  useFilePicker,
  validateIntake,
  type IntakeSpec,
} from '@/components/tools/kit'
import { getPdfjs, openPdf, readPageSizes } from '@/lib/pdf/pdfjsClient'
import { getTool } from '@/lib/tools/registry'
import { uploadWithProgress, getApiErrorMessage } from '@/lib/upload/uploadWithProgress'
import { downloadBlob } from '@/lib/download/downloadOutputs'
import { addRecentConversion } from '@/lib/history/recentConversions'

/**
 * Rotate PDF — "the turntable" (roadmap §8.10).
 *
 * Instrument concept: every page turns on its own axis, a quarter at a time,
 * and can be lifted to a new place in the order. The quarter-turn spring
 * settle is this surface's one signature moment; everything around it stays
 * quiet.
 *
 * What the engine really does (server/rotatePdf.ts, rotatePdfPagePlan): it
 * copies the source pages, in the bench's order, into a new document and adds
 * each page's rotation. A probe on 2026-11-06 confirmed links and other page
 * annotations survive, while form fields, bookmarks and the document's
 * title/author do not — so the receipt says exactly that.
 *
 * Wave A (2026-11-06) moved this tool onto the shared kit: registry-driven
 * intake, a real "pages read" count instead of rendering every thumbnail up
 * front (pages now render lazily near the viewport), page selection plus a
 * typed range so "rotate a range" is real, a keyboard path for reordering,
 * a confirmed "Start over" instead of a "Cancel" that silently wiped the
 * work, a focus-trapped preview, and a persistent receipt instead of a
 * 2.8-second toast. Results are never auto-downloaded (owner decision D4).
 */

type Phase = 'upload' | 'reading' | 'editing' | 'running'
interface PageSheet { id: string; originalIndex: number; rotation: number; aspect: number }
interface Workspace { file: File; doc: PDFDocumentProxy; pages: PageSheet[] }
interface RotateResult { name: string; blob: Blob; pageCount: number; rotated: number; moved: number }

const tool = getTool('rotate-pdf')
const SPEC: IntakeSpec = { accepts: tool.accepts ?? [], limits: tool.limits! }

/* The lightbox re-renders the page at this scale so zoomed text stays legible. */
const PREVIEW_SCALE = 2
const ZOOM_MIN = 0.5
const ZOOM_MAX = 4
const ZOOM_STEP = 0.25
/* Every bench page fits a square this wide, so a quarter turn never overflows its cell. */
const PAPER_BOX = 164
const clampZoom = (value: number) => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, value))
const nextRotation = (current: number, degrees: -90 | 90) => (current + degrees + 360) % 360
const paperSize = (aspect: number) => aspect < 1
  ? { width: Math.round(PAPER_BOX * aspect), height: PAPER_BOX }
  : { width: PAPER_BOX, height: Math.round(PAPER_BOX / aspect) }

const stroke = { viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, 'aria-hidden': true }
const Icons = {
  upload: <svg {...stroke} strokeWidth={1.8}><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><path d="M14 2v6h6" /><path d="M12 17v-6" /><path d="m9.5 13.5 2.5-2.5 2.5 2.5" /></svg>,
  rotateLeft: <svg {...stroke}><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" /><path d="M3 3v5h5" /></svg>,
  rotateRight: <svg {...stroke}><path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8" /><path d="M21 3v5h-5" /></svg>,
  earlier: <svg {...stroke}><path d="m15 18-6-6 6-6" /></svg>,
  later: <svg {...stroke}><path d="m9 18 6-6-6-6" /></svg>,
  preview: <svg {...stroke}><path d="M15 3h6v6" /><path d="M9 21H3v-6" /><path d="M21 3l-7 7" /><path d="M3 21l7-7" /></svg>,
  zoomIn: <svg {...stroke}><circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" /><path d="M11 8v6" /><path d="M8 11h6" /></svg>,
  zoomOut: <svg {...stroke}><circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" /><path d="M8 11h6" /></svg>,
  close: <svg {...stroke}><path d="M18 6 6 18" /><path d="m6 6 12 12" /></svg>,
  check: <svg {...stroke} strokeWidth={3}><path d="M20 6 9 17l-5-5" /></svg>,
}

export default function RotatePdfTool() {
  const [workspace, setWorkspace] = useState<Workspace | null>(null)
  const [phase, setPhase] = useState<Phase>('upload')
  const [reading, setReading] = useState<{ name: string; done: number; total: number } | null>(null)
  const [error, setError] = useState<{ messages: string[]; id: number } | null>(null)
  const [result, setResult] = useState<RotateResult | null>(null)
  const [progress, setProgress] = useState<number | null>(null)
  const [startedAt, setStartedAt] = useState(0)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [announce, setAnnounce] = useState('')
  const [confirm, setConfirm] = useState<null | 'reset' | 'replace'>(null)
  const [draggedId, setDraggedId] = useState<string | null>(null)
  const [overId, setOverId] = useState<string | null>(null)
  const [previewId, setPreviewId] = useState<string | null>(null)
  const [previewSrc, setPreviewSrc] = useState<string | null>(null)
  const [zoom, setZoom] = useState(1)
  const [textReady, setTextReady] = useState(0)
  const errorId = useRef(0)
  const readToken = useRef(0)
  const anchorPage = useRef<string | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  const zoomRef = useRef(1)
  const dialogRef = useRef<HTMLDialogElement | null>(null)
  const previewReturn = useRef<HTMLElement | null>(null)
  const lightboxRef = useRef<HTMLDivElement | null>(null)
  const pageBoxRef = useRef<HTMLSpanElement | null>(null)
  const textLayerRef = useRef<HTMLDivElement | null>(null)
  const textToken = useRef(0)
  const previewToken = useRef(0)
  /* The page height in PDF units (scale 1), used to turn the displayed page box
     height into the `--total-scale-factor` the PDF.js text layer needs. */
  const rawPageHeightRef = useRef(0)
  const panRef = useRef<{ x: number; y: number; left: number; top: number } | null>(null)
  /* The content point (normalised to the page) and the viewport pixel it sits
     under at the moment a zoom starts, so the same point can be put back under
     the same pixel once the zoom layout settles. */
  const anchorRef = useRef<{ nx: number; ny: number; ax: number; ay: number } | null>(null)

  const pages = useMemo(() => workspace?.pages ?? [], [workspace])
  const doc = workspace?.doc ?? null
  const dirty = pages.some((page, index) => page.rotation !== 0 || page.originalIndex !== index)

  // A pdf.js document holds a worker-side copy of the file; release it when replaced.
  useEffect(() => {
    if (!doc) return
    return () => { void doc.destroy() }
  }, [doc])

  const showError = useCallback((messages: string[]) => {
    errorId.current += 1
    setError({ messages, id: errorId.current })
  }, [])

  /* Every edit to the bench makes a finished result stale, so it is cleared:
     the receipt and its Download must always describe the current plan. */
  const edit = useCallback((update: (pages: PageSheet[]) => PageSheet[]) => {
    setWorkspace((current) => current ? { ...current, pages: update(current.pages) } : current)
    setResult(null)
  }, [])

  /* ── Lightbox (zoom, pan, selectable text) ─────────────────────────────── */
  const closePreview = useCallback(() => {
    previewToken.current += 1
    textToken.current += 1
    setPreviewId(null)
    setPreviewSrc(null)
    anchorRef.current = null
    zoomRef.current = 1
    setZoom(1)
  }, [])

  /* Zoom is anchored: the page point under the cursor (wheel) or under the
     viewport centre (buttons/keys) is captured before the scale changes and
     restored after layout, so the view follows the input instead of jumping.
     `zoomRef` is written synchronously so rapid wheel ticks accumulate even
     before React commits the new scale. */
  const applyZoom = useCallback((next: number, clientX?: number, clientY?: number) => {
    const clamped = clampZoom(Number(next.toFixed(3)))
    if (clamped === zoomRef.current) return
    const node = lightboxRef.current
    const stage = node?.querySelector<HTMLElement>('.rt-lightbox-stage')
    if (node && stage) {
      const bounds = node.getBoundingClientRect()
      const stageBounds = stage.getBoundingClientRect()
      const ax = clientX === undefined ? node.clientWidth / 2 : clientX - bounds.left
      const ay = clientY === undefined ? node.clientHeight / 2 : clientY - bounds.top
      anchorRef.current = {
        ax,
        ay,
        nx: stageBounds.width ? (ax - (stageBounds.left - bounds.left)) / stageBounds.width : 0.5,
        ny: stageBounds.height ? (ay - (stageBounds.top - bounds.top)) / stageBounds.height : 0.5,
      }
    }
    zoomRef.current = clamped
    setZoom(clamped)
  }, [])
  const zoomBy = useCallback((delta: number) => applyZoom(zoomRef.current + delta), [applyZoom])
  const zoomReset = useCallback(() => applyZoom(1), [applyZoom])
  useLayoutEffect(() => {
    const anchor = anchorRef.current
    const node = lightboxRef.current
    if (!anchor || !node) return
    anchorRef.current = null
    const stage = node.querySelector<HTMLElement>('.rt-lightbox-stage')
    if (!stage) return
    const bounds = node.getBoundingClientRect()
    const stageBounds = stage.getBoundingClientRect()
    const stageLeft = stageBounds.left - bounds.left + node.scrollLeft
    const stageTop = stageBounds.top - bounds.top + node.scrollTop
    node.scrollLeft = stageLeft + anchor.nx * stageBounds.width - anchor.ax
    node.scrollTop = stageTop + anchor.ny * stageBounds.height - anchor.ay
  }, [zoom])

  const previewIndex = previewId ? pages.findIndex((page) => page.id === previewId) : -1
  const previewPage = previewIndex >= 0 ? pages[previewIndex] : null

  /* The preview is a native modal <dialog>: focus is trapped and the page
     behind it is inert. Escape arrives as the dialog's `cancel` event. */
  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return
    if (previewPage && !dialog.open) dialog.showModal()
    if (!previewPage && dialog.open) {
      dialog.close()
      previewReturn.current?.focus({ preventScroll: true })
    }
  }, [previewPage])

  useEffect(() => {
    if (!previewId) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === '+' || event.key === '=') zoomBy(ZOOM_STEP)
      else if (event.key === '-' || event.key === '_') zoomBy(-ZOOM_STEP)
      else if (event.key === '0') zoomReset()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [previewId, zoomBy, zoomReset])
  // Native listener so Ctrl/Cmd + wheel can zoom without the browser page-zooming.
  useEffect(() => {
    if (!previewId) return
    const node = lightboxRef.current
    if (!node) return
    const onWheel = (event: WheelEvent) => { if (!event.ctrlKey && !event.metaKey) return; event.preventDefault(); applyZoom(zoomRef.current - event.deltaY * 0.0016, event.clientX, event.clientY) }
    node.addEventListener('wheel', onWheel, { passive: false })
    return () => node.removeEventListener('wheel', onWheel)
  }, [applyZoom, previewId])

  /* Selectable text layer over the raster, scaled to the displayed page box
     through `--total-scale-factor`. Built once per opened page from the
     page's ORIGINAL number — the bench position changes when pages move. */
  const previewOriginal = previewPage?.originalIndex ?? -1
  useEffect(() => {
    if (!previewId || !doc || previewOriginal < 0) return
    const container = textLayerRef.current
    if (!container) return
    const token = ++textToken.current
    container.replaceChildren()
    container.style.removeProperty('--total-scale-factor')
    let cancelled = false
    void (async () => {
      const pdfjs = await getPdfjs()
      const page = await doc.getPage(previewOriginal + 1)
      const viewport = page.getViewport({ scale: PREVIEW_SCALE })
      const textContent = await page.getTextContent()
      if (cancelled || token !== textToken.current || !container.isConnected) return
      const layer = new pdfjs.TextLayer({ textContentSource: textContent, container, viewport })
      await layer.render()
      if (cancelled || token !== textToken.current) return
      rawPageHeightRef.current = viewport.height / viewport.scale
      setTextReady((value) => value + 1)
    })().catch(() => { /* text is an enhancement; the raster preview is unaffected */ })
    return () => { cancelled = true }
  }, [previewId, previewOriginal, doc])
  /* Match the text layer's scale factor to the page box, so glyphs line up with
     the raster at any zoom and the browser's own selection rectangles are right. */
  useLayoutEffect(() => {
    const pageBox = pageBoxRef.current
    const container = textLayerRef.current
    if (!pageBox || !container) return
    const apply = () => {
      const rawHeight = rawPageHeightRef.current
      if (!rawHeight) return
      container.style.setProperty('--total-scale-factor', String(pageBox.offsetHeight / rawHeight))
    }
    apply()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(apply)
    observer.observe(pageBox)
    return () => observer.disconnect()
  }, [previewId, textReady, zoom])

  const openPreview = useCallback((page: PageSheet) => {
    if (!doc) return
    previewReturn.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const token = ++previewToken.current
    anchorRef.current = null
    zoomRef.current = 1
    setPreviewId(page.id)
    setZoom(1)
    setPreviewSrc(null)
    void (async () => {
      const proxy = await doc.getPage(page.originalIndex + 1)
      const viewport = proxy.getViewport({ scale: PREVIEW_SCALE })
      const canvas = window.document.createElement('canvas')
      canvas.width = Math.max(1, Math.round(viewport.width))
      canvas.height = Math.max(1, Math.round(viewport.height))
      await proxy.render({ canvas, viewport }).promise
      if (previewToken.current === token) setPreviewSrc(canvas.toDataURL('image/jpeg', 0.9))
    })().catch(() => { /* the empty paper stays; the bench thumbnail is unaffected */ })
  }, [doc])

  /* ── Intake ───────────────────────────────────────────────────────────── */
  const addFiles = useCallback(async (list: File[]) => {
    const { accepted, rejections } = validateIntake(list, SPEC)
    if (accepted.length === 0) {
      showError(rejections.map((rejection) => rejection.message))
      return
    }
    if (rejections.length) showError(rejections.map((rejection) => rejection.message))
    else setError(null)
    const file = accepted[0]
    const token = ++readToken.current
    setPhase('reading')
    setReading({ name: file.name, done: 0, total: 0 })
    setResult(null)
    try {
      const opened = await openPdf(file)
      if (token !== readToken.current) { void opened.destroy(); return }
      // Sizes only: thumbnails render lazily on the bench, so a 300-page PDF opens in seconds.
      const sizes = await readPageSizes(opened, (done, total) => {
        if (token === readToken.current) setReading({ name: file.name, done, total })
      })
      if (token !== readToken.current) { void opened.destroy(); return }
      if (sizes.length === 0) throw new Error('it has no pages')
      setWorkspace({
        file,
        doc: opened,
        pages: sizes.map(([width, height], index) => ({ id: `page-${index}`, originalIndex: index, rotation: 0, aspect: width / height })),
      })
      setSelected(new Set())
      anchorPage.current = null
      setAnnounce(`${file.name} opened, ${sizes.length} ${sizes.length === 1 ? 'page' : 'pages'}.`)
      setPhase('editing')
    } catch (cause) {
      if (token !== readToken.current) return
      const reason = cause instanceof Error && cause.message ? cause.message : 'it may be encrypted or damaged'
      showError([`Could not open ${file.name}: ${reason}.`])
      setPhase((current) => current === 'reading' ? 'upload' : current)
    } finally {
      if (token === readToken.current) setReading(null)
    }
  }, [showError])

  const picker = useFilePicker(SPEC, (files) => { void addFiles(files) })

  const reset = useCallback(() => {
    abortRef.current?.abort()
    readToken.current += 1
    closePreview()
    setWorkspace(null)
    setSelected(new Set())
    setResult(null)
    setError(null)
    setReading(null)
    setPhase('upload')
  }, [closePreview])

  /* ── Bench edits ──────────────────────────────────────────────────────── */
  const rotateOne = useCallback((id: string, degrees: -90 | 90) => {
    edit((current) => current.map((page) => page.id === id ? { ...page, rotation: nextRotation(page.rotation, degrees) } : page))
  }, [edit])

  // Batch turns apply to the selection when there is one, otherwise to every page.
  const rotateTargets = useCallback((degrees: -90 | 90) => {
    const targetAll = selected.size === 0
    edit((current) => current.map((page) => targetAll || selected.has(page.id) ? { ...page, rotation: nextRotation(page.rotation, degrees) } : page))
    const count = targetAll ? pages.length : selected.size
    setAnnounce(`${targetAll ? 'All' : count} ${count === 1 ? 'page' : 'pages'} turned ${degrees > 0 ? 'right' : 'left'}.`)
  }, [edit, pages.length, selected])

  const moveSheet = useCallback((fromId: string, toIndex: number) => {
    const from = pages.findIndex((page) => page.id === fromId)
    if (from < 0 || toIndex < 0 || toIndex >= pages.length || from === toIndex) return
    edit((current) => {
      const next = [...current]
      const [moved] = next.splice(from, 1)
      next.splice(toIndex, 0, moved)
      return next
    })
    setAnnounce(`Page moved to position ${toIndex + 1} of ${pages.length}.`)
  }, [edit, pages])

  // The keyboard path for reordering: the moved page's own button keeps focus.
  const nudge = useCallback((id: string, delta: -1 | 1, button: HTMLElement) => {
    const index = pages.findIndex((page) => page.id === id)
    moveSheet(id, index + delta)
    requestAnimationFrame(() => {
      const label = button.getAttribute('data-move')
      const target = document.querySelector<HTMLElement>(`[data-sheet="${id}"] [data-move="${label}"]`)
      ;(target && !target.hasAttribute('disabled') ? target : document.querySelector<HTMLElement>(`[data-sheet="${id}"] [data-move]:not([disabled])`))?.focus()
    })
  }, [moveSheet, pages])

  const toggleSelect = useCallback((id: string, event: MouseEvent) => {
    const anchor = anchorPage.current
    if (event.shiftKey && anchor) {
      const a = pages.findIndex((page) => page.id === anchor)
      const b = pages.findIndex((page) => page.id === id)
      const [lo, hi] = a <= b ? [a, b] : [b, a]
      setSelected((current) => new Set([...current, ...pages.slice(lo, hi + 1).map((page) => page.id)]))
      return
    }
    anchorPage.current = id
    setSelected((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [pages])

  /* The typed range works in bench positions — the numbers printed on each sheet. */
  const selectedPositions = useMemo(
    () => new Set(pages.flatMap((page, index) => (selected.has(page.id) ? [index + 1] : []))),
    [pages, selected],
  )
  const selectPositions = useCallback((positions: Set<number>) => {
    setSelected(new Set([...positions].flatMap((position) => (pages[position - 1] ? [pages[position - 1].id] : []))))
  }, [pages])

  /* ── Export ───────────────────────────────────────────────────────────── */
  const exportPdf = useCallback(async () => {
    if (!workspace || phase === 'running' || !dirty) return
    setPhase('running')
    setError(null)
    setResult(null)
    setProgress(0)
    setStartedAt(Date.now())
    const abort = new AbortController()
    abortRef.current = abort
    try {
      const formData = new FormData()
      formData.append('files', workspace.file)
      formData.append('pagePlan', JSON.stringify(workspace.pages.map(({ originalIndex, rotation }) => ({ originalIndex, rotation }))))
      const response = await uploadWithProgress(tool.apiEndpoint, formData, { onProgress: setProgress, signal: abort.signal })
      if (!response.ok) throw new Error(await getApiErrorMessage(response, 'Could not apply the page changes'))
      const matched = /filename="([^"]+)"/.exec(response.headers.get('Content-Disposition') ?? '')
      const name = matched ? decodeURIComponent(matched[1]) : 'mycloove_rotated.pdf'
      const blob = await response.blob()
      setResult({
        name,
        blob,
        pageCount: workspace.pages.length,
        rotated: workspace.pages.filter((page) => page.rotation !== 0).length,
        moved: workspace.pages.filter((page, index) => page.originalIndex !== index).length,
      })
      addRecentConversion({ toolId: 'rotate-pdf', label: tool.label, filename: name, sizeBytes: blob.size })
    } catch (cause) {
      if (!(cause instanceof Error && cause.name === 'ApiClientError' && /cancelled/i.test(cause.message))) {
        showError([cause instanceof Error ? cause.message : 'Could not apply the page changes. Please try again.'])
      }
    } finally {
      abortRef.current = null
      setProgress(null)
      setPhase('editing')
    }
  }, [dirty, phase, showError, workspace])

  const confirmAction = () => {
    const action = confirm
    setConfirm(null)
    reset()
    // Still inside the click, so the browser allows the file picker to open.
    if (action === 'replace') picker.open()
  }

  const running = phase === 'running'
  const targetLabel = selected.size ? `${selected.size} selected` : `All ${pages.length} ${pages.length === 1 ? 'page' : 'pages'}`

  return <>
    <style>{ROTATE_CSS}</style>
    <section className="rt" aria-label="Rotate PDF workspace">
      <DropAnywhere spec={SPEC} onFiles={(files) => { void addFiles(files) }} enabled={phase === 'upload'} />
      {picker.input}
      <p className="rt-sr" aria-live="polite">{announce}</p>

      {phase === 'upload' && (
        <div className="rt-upload">
          {/* The original Rotate dropzone, kept as this tool's identity (owner
              direction, 2026-11-06). The whole page is still the drop target
              via DropAnywhere; the button is the keyboard path, and the limits
              are stated before anything is dropped. */}
          <div className="rt-dropzone" onClick={picker.open}>
            <span className="rt-dropicon">{Icons.upload}</span>
            <h2>Drop a PDF to organize &amp; rotate</h2>
            <p>Turn pages a quarter at a time, select a range to turn together, and drag pages into a new order. Nothing changes until you create the new PDF.</p>
            <button type="button" className="rt-button primary" onClick={(event) => { event.stopPropagation(); picker.open() }}>Browse Files</button>
            <p className="rt-limits">{describeLimits(SPEC)}</p>
          </div>
          {error && <div className="rt-upload-error"><Notice key={error.id} tone="error" shake><NoticeList items={error.messages} /></Notice></div>}
        </div>
      )}

      {phase === 'reading' && reading && (
        <div className="rt-upload">
          <div className="rt-reading" role="status">
            <p className="rt-reading-title">Reading {reading.name}</p>
            <div className="rt-reading-track" aria-hidden="true">
              <span style={{ transform: `scaleX(${reading.total ? reading.done / reading.total : 0})` }} />
            </div>
            <p className="rt-reading-count">{reading.total ? `${reading.done} / ${reading.total} pages read` : 'Opening the document…'}</p>
          </div>
        </div>
      )}

      {workspace && phase !== 'reading' && (
        <div className="rt-workspace">
          <div className="rt-toolbar">
            <div className="rt-file">
              <FileChip
                name={workspace.file.name}
                sizeBytes={workspace.file.size}
                meta={`${pages.length} ${pages.length === 1 ? 'page' : 'pages'}`}
                onReplace={() => (dirty ? setConfirm('replace') : picker.open())}
                disabled={running}
              />
            </div>
            <div className="rt-range">
              <PageRangeField pageCount={pages.length} selected={selectedPositions} onSelectionChange={selectPositions} label="Select pages to turn" />
            </div>
            <ActionButton className="rt-compact" variant="quiet" onClick={() => (dirty ? setConfirm('reset') : reset())} disabled={running}>Start over</ActionButton>
          </div>

          {error && <div className="rt-notice"><Notice key={error.id} tone="error" shake><NoticeList items={error.messages} /></Notice></div>}

          {result && (
            <div className="rt-receipt">
              <Receipt
                tone="success"
                title="Your new PDF is ready"
                fileName={result.name}
                facts={[
                  { tone: 'success', text: `${result.pageCount} ${result.pageCount === 1 ? 'page' : 'pages'} · ${result.rotated} turned · ${result.moved} moved` },
                  { tone: 'info', text: 'Links and other page annotations were kept.' },
                  { tone: 'warning', text: 'Form fields, bookmarks and the document title/author are not carried over by this tool.' },
                ]}
                actions={<ActionButton icon={<DownloadIcon />} onClick={() => downloadBlob(result.blob, result.name)}>Download</ActionButton>}
              />
            </div>
          )}

          <ol className="rt-grid" aria-label="Pages in their new order. Drag a page, or use its move buttons, to change the order.">
            {pages.map((page, index) => {
              const isSelected = selected.has(page.id)
              const box = paperSize(page.aspect)
              return (
                <li
                  key={page.id}
                  data-sheet={page.id}
                  className={`rt-sheet${draggedId === page.id ? ' dragging' : ''}${overId === page.id && draggedId !== page.id ? ' drag-over' : ''}${isSelected ? ' selected' : ''}`}
                  draggable={!running}
                  onDragStart={(event) => { setDraggedId(page.id); event.dataTransfer.effectAllowed = 'move' }}
                  onDragOver={(event) => { if (!draggedId) return; event.preventDefault(); if (overId !== page.id) setOverId(page.id) }}
                  onDrop={(event) => { event.preventDefault(); if (draggedId) moveSheet(draggedId, index); setDraggedId(null); setOverId(null) }}
                  onDragEnd={() => { setDraggedId(null); setOverId(null) }}
                >
                  <button
                    type="button"
                    className="rt-select"
                    role="checkbox"
                    aria-checked={isSelected}
                    aria-label={`Select page ${index + 1}`}
                    onClick={(event) => toggleSelect(page.id, event)}
                    disabled={running}
                  >
                    {Icons.check}
                  </button>
                  <span className="rt-page-number" aria-hidden="true">{index + 1}</span>
                  <span className="rt-paper-stage">
                    <span className="rt-paper" style={{ width: box.width, height: box.height, transform: `rotate(${page.rotation}deg)` }}>
                      <PageThumb document={workspace.doc} pageNumber={page.originalIndex + 1} aspect={page.aspect} />
                    </span>
                  </span>
                  {page.rotation !== 0 && <span className="rt-turned">{page.rotation}°</span>}
                  <span className="rt-page-controls">
                    <button type="button" className="rt-control" title="Turn left" aria-label={`Turn page ${index + 1} left`} onClick={() => rotateOne(page.id, -90)} disabled={running}>{Icons.rotateLeft}</button>
                    <button type="button" className="rt-control" title="Turn right" aria-label={`Turn page ${index + 1} right`} onClick={() => rotateOne(page.id, 90)} disabled={running}>{Icons.rotateRight}</button>
                    <span className="rt-control-sep" aria-hidden="true" />
                    <button type="button" className="rt-control" data-move="earlier" title="Move earlier" aria-label={`Move page ${index + 1} earlier`} onClick={(event) => nudge(page.id, -1, event.currentTarget)} disabled={running || index === 0}>{Icons.earlier}</button>
                    <button type="button" className="rt-control" data-move="later" title="Move later" aria-label={`Move page ${index + 1} later`} onClick={(event) => nudge(page.id, 1, event.currentTarget)} disabled={running || index === pages.length - 1}>{Icons.later}</button>
                    <span className="rt-control-sep" aria-hidden="true" />
                    <button type="button" className="rt-control" title="View larger" aria-label={`View page ${index + 1} larger`} onClick={() => openPreview(page)}>{Icons.preview}</button>
                  </span>
                </li>
              )
            })}
          </ol>

          <div className="rt-batch" role="group" aria-label="Turn and create">
            {running ? (
              <div className="rt-batch-progress">
                <HonestProgress uploadPercent={progress} startedAt={startedAt} processingLabel="Building your PDF on the server" onCancel={() => abortRef.current?.abort()} />
              </div>
            ) : (
              <>
                <span className="rt-target">{targetLabel}</span>
                <button type="button" className="rt-button" onClick={() => rotateTargets(-90)} aria-label={`Turn ${targetLabel.toLowerCase()} left`}>{Icons.rotateLeft} Turn left</button>
                <button type="button" className="rt-button" onClick={() => rotateTargets(90)} aria-label={`Turn ${targetLabel.toLowerCase()} right`}>{Icons.rotateRight} Turn right</button>
                {selected.size > 0 && <button type="button" className="rt-button" onClick={() => setSelected(new Set())}>Clear selection</button>}
                {/* While a fresh result exists, Download in the receipt is the one
                    primary action; any edit clears the result and brings this back. */}
                {!result && <>
                  <span className="rt-batch-sep" aria-hidden="true" />
                  <ActionButton className="rt-dock-primary" onClick={exportPdf} disabled={!dirty} title={dirty ? undefined : 'Turn or move a page first'} arrow>Create PDF</ActionButton>
                </>}
              </>
            )}
          </div>
        </div>
      )}

      <Dialog
        open={confirm !== null}
        onClose={() => setConfirm(null)}
        title={confirm === 'replace' ? 'Use another PDF?' : 'Start over?'}
      >
        <div className="rt-confirm">
          <p>Your page turns and order changes on {workspace?.file.name ?? 'this PDF'} will be cleared. Your original file is not changed.</p>
          <div className="rt-confirm-actions">
            <ActionButton onClick={confirmAction}>{confirm === 'replace' ? 'Clear and choose a PDF' : 'Clear and start over'}</ActionButton>
            <ActionButton variant="quiet" onClick={() => setConfirm(null)}>Keep working</ActionButton>
          </div>
        </div>
      </Dialog>

      <dialog
        ref={dialogRef}
        className="rt-lightbox"
        aria-label={previewPage ? `Page ${previewIndex + 1} preview` : 'Page preview'}
        onCancel={(event) => { event.preventDefault(); closePreview() }}
        onClick={(event) => { if (event.target === event.currentTarget) closePreview() }}
      >
        {previewPage && doc && <>
          <div
            ref={lightboxRef}
            className={`rt-lightbox-body${zoom > 1 ? ' is-zoomed' : ''}`}
            style={{ '--rt-zoom': zoom, '--rt-aspect': previewPage.aspect } as CSSProperties}
            onClick={(event) => { if (event.target === event.currentTarget) closePreview() }}
            onPointerDown={(event) => { const node = lightboxRef.current; if (!node) return; if ((event.target as HTMLElement).closest('.rt-lightbox-text')) return; if (node.scrollWidth <= node.clientWidth + 1 && node.scrollHeight <= node.clientHeight + 1) return; panRef.current = { x: event.clientX, y: event.clientY, left: node.scrollLeft, top: node.scrollTop }; node.setPointerCapture(event.pointerId) }}
            onPointerMove={(event) => { const start = panRef.current; const node = lightboxRef.current; if (!start || !node) return; node.scrollLeft = start.left - (event.clientX - start.x); node.scrollTop = start.top - (event.clientY - start.y) }}
            onPointerUp={(event) => { const node = lightboxRef.current; panRef.current = null; if (node?.hasPointerCapture(event.pointerId)) node.releasePointerCapture(event.pointerId) }}
          >
            {/* Stage owns the layout box for the rotated page: a CSS transform alone
                does not change layout, so without this the scroll area would still
                match the unrotated portrait box and wheel scrolling would fight the
                visual content. The page box carries the rotation for both the raster
                and the selectable text layer. */}
            <span className="rt-lightbox-stage" data-rot={previewPage.rotation % 180 === 0 ? 'even' : 'odd'}>
              <span ref={pageBoxRef} className="rt-lightbox-page" style={{ '--rt-rot': `${previewPage.rotation}deg` } as CSSProperties}>
                {previewSrc
                  /* Canvas data URLs are generated locally from the user's selected PDF. */
                  /* eslint-disable-next-line @next/next/no-img-element */
                  ? <img className="rt-lightbox-paper" src={previewSrc} alt={`Page ${previewIndex + 1}`} />
                  : <span className="rt-lightbox-paper rt-lightbox-blank" aria-hidden="true" />}
                {/* Transparent PDF.js text layer over the raster, so text can be
                    selected and copied with the cursor like a normal document. */}
                <div ref={textLayerRef} className="rt-lightbox-text" role="document" aria-label={`Page ${previewIndex + 1} text`} />
              </span>
            </span>
          </div>
          <div className="rt-lightbox-bar">
            <span className="rt-lightbox-count">Page {previewIndex + 1} of {pages.length}</span>
            <div className="rt-lightbox-actions">
              <button type="button" className="rt-lightbox-btn" title="Turn left" aria-label={`Turn page ${previewIndex + 1} left`} onClick={() => rotateOne(previewPage.id, -90)} disabled={running}>{Icons.rotateLeft}</button>
              <span className="rt-lightbox-count" aria-live="polite">{previewPage.rotation}°</span>
              <button type="button" className="rt-lightbox-btn" title="Turn right" aria-label={`Turn page ${previewIndex + 1} right`} onClick={() => rotateOne(previewPage.id, 90)} disabled={running}>{Icons.rotateRight}</button>
              <span className="rt-control-sep" aria-hidden="true" />
              <button type="button" className="rt-lightbox-btn" title="Zoom out" aria-label="Zoom out" onClick={() => zoomBy(-ZOOM_STEP)} disabled={zoom <= ZOOM_MIN}>{Icons.zoomOut}</button>
              <button type="button" className="rt-lightbox-zoom" title="Reset zoom" aria-label={`Reset zoom, currently ${Math.round(zoom * 100)} percent`} onClick={zoomReset}>{Math.round(zoom * 100)}%</button>
              <button type="button" className="rt-lightbox-btn" title="Zoom in" aria-label="Zoom in" onClick={() => zoomBy(ZOOM_STEP)} disabled={zoom >= ZOOM_MAX}>{Icons.zoomIn}</button>
              <span className="rt-control-sep" aria-hidden="true" />
              <button type="button" className="rt-lightbox-btn" title="Close preview" aria-label="Close preview" onClick={closePreview}>{Icons.close}</button>
            </div>
          </div>
        </>}
      </dialog>
    </section>
  </>
}

/* Inline <style> is this module's styling mechanism (CLAUDE.md §5). The palette
   is Rotate's own slate + teal (restored 2026-11-06 at the owner's direction:
   tools keep their identity; Wave A improves the UX inside it). The shared kit
   reads it through the --kit-* hooks, so kit buttons, notices and dialogs
   wear this tool's teal rather than the global accent. */
const ROTATE_CSS = `
.rt {
  --rt-base: #0b0d11; --rt-surface: #14171e; --rt-hover: #1c202a; --rt-line: #232833;
  --rt-main: #e2e8f0; --rt-muted: #8b95a5; --rt-faint: #5c6573;
  --rt-accent: #36b39c; --rt-accent-hover: #2c9e89; --rt-on-accent: #04120f; --rt-accent-bg: rgba(54, 179, 156, 0.1);
  --rt-glass: rgba(18, 21, 27, 0.72); --rt-glass-line: rgba(255, 255, 255, 0.09); --rt-glass-shadow: 0 10px 26px rgba(0, 0, 0, 0.42);
  --rt-dock: rgba(28, 32, 42, 0.55); --rt-dock-line: rgba(255, 255, 255, 0.14); --rt-dock-btn: rgba(255, 255, 255, 0.06);
  --rt-dock-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.22), inset 0 0 0 0.5px rgba(255, 255, 255, 0.05), 0 24px 48px -22px rgba(0, 0, 0, 0.7);
  --rt-ease: cubic-bezier(0.16, 1, 0.3, 1); --rt-settle: cubic-bezier(0.34, 1.56, 0.64, 1);
  --kit-accent: var(--rt-accent); --kit-accent-hover: var(--rt-accent-hover); --kit-on-accent: var(--rt-on-accent);
  --kit-accent-subtle: var(--rt-accent-bg); --kit-focus-ring: var(--rt-accent);
  --kit-surface: var(--rt-surface); --kit-line: var(--rt-line); --kit-line-strong: var(--rt-faint);
  --kit-text: var(--rt-main); --kit-muted: var(--rt-muted); --kit-hover: var(--rt-hover);
  position: relative; color: var(--rt-main); background: var(--rt-base);
  min-height: clamp(520px, calc(100vh - 148px), 840px); margin: -24px;
  font-family: var(--mc-font-ui), Inter, 'DM Sans', sans-serif;
}
[data-theme='light'] .rt {
  --rt-base: #f6f8fa; --rt-surface: #fff; --rt-hover: #f0f3f5; --rt-line: #d9e0e5;
  --rt-main: #17212b; --rt-muted: #62707d; --rt-faint: #9aa5b1; --rt-accent-bg: rgba(54, 179, 156, 0.12);
  --rt-glass: rgba(255, 255, 255, 0.86); --rt-glass-line: rgba(15, 23, 32, 0.1); --rt-glass-shadow: 0 10px 26px rgba(15, 23, 32, 0.16);
  --rt-dock: rgba(255, 255, 255, 0.6); --rt-dock-line: rgba(15, 23, 32, 0.1); --rt-dock-btn: rgba(15, 23, 32, 0.04);
  --rt-dock-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.9), 0 24px 48px -24px rgba(15, 23, 32, 0.35);
}
.rt * { box-sizing: border-box; }
/* :where() keeps this reset at zero element weight, so .rt-button's own size wins. */
.rt :where(button) { font: inherit; }
.rt-sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }

.rt-upload { min-height: clamp(520px, calc(100vh - 148px), 840px); display: grid; place-items: center; align-content: center; gap: 16px; padding: 40px; background: var(--rt-surface); }
.rt-dropzone { width: min(800px, 100%); min-height: 400px; display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 40px 24px; border: 1.5px dashed var(--rt-line); border-radius: 16px; background: transparent; text-align: center; cursor: pointer; transition: border-color 0.3s var(--rt-ease), background-color 0.3s var(--rt-ease); }
.rt-dropzone:hover { border-color: var(--rt-accent); background: var(--rt-accent-bg); }
.rt-dropicon { display: grid; place-items: center; margin-bottom: 20px; color: var(--rt-accent); }
.rt-dropicon svg { width: 40px; height: 40px; }
.rt-dropzone h2 { margin: 0 0 8px; color: var(--rt-main); font-size: 18px; font-weight: 500; letter-spacing: -0.01em; }
.rt-dropzone > p:not(.rt-limits) { max-width: 52ch; margin: 0 0 24px; color: var(--rt-muted); font-size: 14px; line-height: 1.6; }
.rt-limits { margin: 16px 0 0; color: var(--rt-muted); font-size: 12px; font-variant-numeric: tabular-nums; }
.rt-upload-error { width: min(800px, 100%); }

.rt-reading { display: grid; gap: 12px; width: min(420px, 100%); }
.rt-reading-title { overflow: hidden; font-size: 18px; font-weight: 600; text-overflow: ellipsis; white-space: nowrap; }
.rt-reading-track { position: relative; height: 4px; overflow: hidden; border-radius: 999px; background: var(--rt-line); }
.rt-reading-track > span { position: absolute; inset: 0; transform-origin: left center; background: var(--rt-accent); transition: transform 200ms var(--rt-ease); }
.rt-reading-count { color: var(--rt-muted); font-size: 12px; font-variant-numeric: tabular-nums; }

.rt-workspace { min-height: clamp(520px, calc(100vh - 148px), 840px); display: flex; flex-direction: column; }
.rt-toolbar { display: flex; flex-wrap: wrap; align-items: flex-end; gap: 16px; padding: 16px 40px; background: var(--rt-surface); border-bottom: 1px solid var(--rt-line); }
.rt-file { flex: 1 1 280px; min-width: 0; }
.rt-range { flex: 0 1 260px; }
.rt-notice, .rt-receipt { width: min(720px, calc(100% - 80px)); margin: 24px auto 0; }

.rt-grid { list-style: none; display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); align-items: start; gap: 32px; margin: 0; padding: 50px 40px 140px; }
.rt-sheet { aspect-ratio: 1 / 1; position: relative; display: grid; place-items: center; border-radius: 12px; cursor: grab; user-select: none; transition: background-color 120ms var(--rt-ease); }
.rt-sheet:active { cursor: grabbing; }
.rt-sheet.dragging { opacity: 0.38; }
/* Drop target dashed, selection solid: the two states never look alike. */
.rt-sheet.drag-over { outline: 2px dashed var(--rt-accent); outline-offset: -2px; }
.rt-sheet.selected { background: color-mix(in srgb, var(--rt-accent) 7%, transparent); box-shadow: inset 0 0 0 1.5px color-mix(in srgb, var(--rt-accent) 55%, transparent); }
.rt-page-number { position: absolute; left: 50%; top: -24px; transform: translateX(-50%); padding: 2px 8px; border: 1px solid var(--rt-line); border-radius: 6px; background: var(--rt-surface); color: var(--rt-muted); font-size: 12px; font-variant-numeric: tabular-nums; z-index: 2; }
.rt-sheet.selected .rt-page-number { border-color: var(--rt-accent); color: var(--rt-main); font-weight: 600; }
.rt-paper-stage { width: 172px; height: 172px; display: grid; place-items: center; }
/* The signature: each quarter turn settles on the house spring. The paper
   edge and elevation come from the kit's PageThumb. */
.rt-paper { display: block; transition: transform 400ms var(--rt-settle); transform-origin: center; }
.rt-turned { position: absolute; right: 12px; top: 10px; padding: 1px 6px; border-radius: 6px; color: var(--rt-muted); background: var(--rt-surface); font-size: 12px; font-variant-numeric: tabular-nums; }

/* Selection: a real checkbox in the corner (a non-colour cue), touch-sized. */
.rt-select { position: absolute; left: 6px; top: 6px; z-index: 3; display: grid; place-items: center; width: 32px; height: 32px; padding: 0; border: 0; border-radius: 8px; background: transparent; color: transparent; cursor: pointer; }
.rt-select::before { content: ''; position: absolute; inset: 7px; border: 1.5px solid var(--rt-muted); border-radius: 5px; background: var(--rt-surface); }
.rt-select svg { position: relative; width: 12px; height: 12px; }
.rt-select[aria-checked='true'] { color: var(--rt-on-accent); }
.rt-select[aria-checked='true']::before { border-color: var(--rt-accent); background: var(--rt-accent); }
.rt-select:focus-visible, .rt-control:focus-visible, .rt-button:focus-visible, .rt-lightbox-btn:focus-visible, .rt-lightbox-zoom:focus-visible { outline: 2px solid var(--rt-accent); outline-offset: 3px; }

.rt-page-controls { position: absolute; bottom: 8px; left: 50%; z-index: 10; display: flex; gap: 2px; padding: 4px; border: 1px solid var(--rt-glass-line); border-radius: 999px; background: var(--rt-glass); -webkit-backdrop-filter: blur(10px) saturate(1.4); backdrop-filter: blur(10px) saturate(1.4); box-shadow: var(--rt-glass-shadow); opacity: 0; pointer-events: none; transform: translateX(-50%) translateY(8px); transition: opacity 200ms var(--rt-ease), transform 200ms var(--rt-ease); }
.rt-sheet:hover .rt-page-controls, .rt-sheet:focus-within .rt-page-controls { opacity: 1; pointer-events: auto; transform: translateX(-50%) translateY(0); }
.rt-control { width: 32px; height: 32px; display: grid; place-items: center; padding: 0; border: 0; border-radius: 50%; background: transparent; color: var(--rt-main); cursor: pointer; transition: background-color 120ms var(--rt-ease), color 120ms; }
.rt-control:hover:not(:disabled) { color: var(--rt-on-accent); background: var(--rt-accent); }
.rt-control:disabled { opacity: 0.32; cursor: not-allowed; }
.rt-control svg { width: 16px; height: 16px; }
.rt-control-sep { align-self: center; width: 1px; height: 16px; margin: 0 2px; background: var(--rt-line); }

/* Floating dock: the one glass element, over the bench (roadmap §3.2).
   width: max-content — a fixed box placed at left: 50% would otherwise be
   sized to the remaining half of the viewport and wrap its buttons. */
.rt-batch { position: fixed; left: 50%; bottom: 20px; z-index: 40; transform: translateX(-50%); width: max-content; display: flex; align-items: center; gap: 8px; max-width: min(calc(100vw - 24px), 1000px); padding: 8px; border: 1px solid var(--rt-dock-line); border-radius: 18px; background: var(--rt-dock); -webkit-backdrop-filter: blur(20px) saturate(1.6); backdrop-filter: blur(20px) saturate(1.6); box-shadow: var(--rt-dock-shadow); }
.rt-target { padding: 0 8px; color: var(--rt-muted); font-size: 12px; font-variant-numeric: tabular-nums; white-space: nowrap; }
.rt-button { min-height: 40px; display: inline-flex; align-items: center; gap: 6px; padding: 0 12px; border: 1px solid var(--rt-line); border-radius: 10px; background: var(--rt-surface); color: var(--rt-main); font-size: 12px; font-weight: 600; white-space: nowrap; cursor: pointer; }
.rt-button:hover { background: var(--rt-hover); }
.rt-button.primary { border-color: transparent; color: var(--rt-on-accent); background: var(--rt-accent); transition: background-color 0.2s, transform 0.2s var(--rt-ease); }
.rt-button.primary:hover { background: var(--rt-accent-hover); transform: translateY(-1px); }
.rt-button svg { width: 16px; height: 16px; }
.rt-batch-sep { width: 1px; height: 24px; background: var(--rt-dock-line); }
/* The original dock buttons: compact, glass-tinted, the primary on a teal gradient. */
.rt-batch .rt-button { min-height: 36px; padding: 0 12px; gap: 6px; font-size: 12px; border-radius: 10px; border-color: var(--rt-dock-line); background: var(--rt-dock-btn); box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.1); transition: background-color 0.18s var(--rt-ease), transform 0.16s var(--rt-settle); }
.rt-batch .rt-button:hover { background: var(--rt-hover); transform: translateY(-1px); }
.rt-batch .rt-button:active { transform: scale(0.97); }
.rt-batch .rt-button svg { width: 14px; height: 14px; }
.rt-batch .rt-dock-primary { min-height: 36px; padding: 0 14px; font-size: 12px; border-radius: 10px; background: linear-gradient(180deg, var(--rt-accent), var(--rt-accent-hover)); box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.4), 0 8px 18px -8px rgba(54, 179, 156, 0.7); }
.rt-batch .rt-dock-primary:disabled { box-shadow: none; }
.rt-toolbar .rt-compact { min-height: 40px; font-size: 13px; }
.rt-batch-progress { width: min(360px, calc(100vw - 48px)); padding: 4px 8px; }

.rt-confirm { display: grid; gap: 20px; padding: 20px; }
.rt-confirm p { color: var(--rt-muted); font-size: 14px; line-height: 1.6; }
.rt-confirm-actions { display: flex; flex-wrap: wrap; gap: 8px; }

/* Preview: a native modal dialog spanning the viewport. */
.rt-lightbox { position: fixed; inset: 0; width: 100vw; height: 100dvh; max-width: none; max-height: none; margin: 0; padding: 32px 24px; border: 0; color: var(--rt-main); background: rgba(5, 7, 10, 0.78); -webkit-backdrop-filter: blur(14px); backdrop-filter: blur(14px); }
.rt-lightbox[open] { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 16px; animation: rt-fade 200ms var(--rt-ease); }
.rt-lightbox::backdrop { background: transparent; }
.rt-lightbox-body { flex: 1; min-height: 0; width: 100%; display: flex; overflow: auto; padding: 10px; overscroll-behavior: contain; scrollbar-width: thin; overflow-anchor: none; user-select: none; --rt-h: calc(min(76vh, 760px) * var(--rt-zoom, 1)); --rt-w: calc(var(--rt-h) * var(--rt-aspect, 0.7071)); }
.rt-lightbox-body.is-zoomed { cursor: grab; }
.rt-lightbox-body.is-zoomed:active { cursor: grabbing; }
.rt-lightbox-stage { position: relative; flex: none; margin: auto; }
.rt-lightbox-stage[data-rot='even'] { width: var(--rt-w); height: var(--rt-h); }
.rt-lightbox-stage[data-rot='odd'] { width: var(--rt-h); height: var(--rt-w); }
.rt-lightbox-page { position: absolute; left: 50%; top: 50%; width: var(--rt-w); height: var(--rt-h); transform: translate(-50%, -50%) rotate(var(--rt-rot, 0deg)); transition: transform 400ms var(--rt-settle); }
.rt-lightbox-paper { position: absolute; inset: 0; width: 100%; height: 100%; display: block; background: #fff; border-radius: 6px; box-shadow: 0 30px 70px -20px rgba(0, 0, 0, 0.7), inset 0 0 0 1px rgba(0, 0, 0, 0.08); }
.rt-lightbox-blank { background: #fff; }
.rt-lightbox-text { position: absolute; inset: 0; z-index: 2; overflow: clip; text-align: initial; line-height: 1; -webkit-text-size-adjust: none; text-size-adjust: none; forced-color-adjust: none; transform-origin: 0 0; pointer-events: none; --min-font-size: 1; --min-font-size-inv: calc(1 / var(--min-font-size)); --text-scale-factor: calc(var(--total-scale-factor, 1) * var(--min-font-size)); --scale-round-x: 1px; --scale-round-y: 1px; }
.rt-lightbox-text :is(span, br) { color: transparent; position: absolute; white-space: pre; cursor: text; transform-origin: 0% 0%; pointer-events: auto; user-select: text; }
.rt-lightbox-text span.markedContent { top: 0; height: 0; display: contents; }
.rt-lightbox-text > :not(.markedContent), .rt-lightbox-text .markedContent span:not(.markedContent) { z-index: 1; --font-height: 0; --scale-x: 1; --rotate: 0deg; font-size: calc(var(--text-scale-factor) * var(--font-height)); transform: rotate(var(--rotate)) scaleX(var(--scale-x)) scale(var(--min-font-size-inv)); }
.rt-lightbox-text ::selection { background: rgba(54, 179, 156, 0.42); }
.rt-lightbox-bar { display: flex; align-items: center; gap: 14px; flex-wrap: wrap; justify-content: center; padding: 8px 10px 8px 18px; border: 1px solid var(--rt-glass-line); border-radius: 999px; background: var(--rt-glass); -webkit-backdrop-filter: blur(12px) saturate(1.4); backdrop-filter: blur(12px) saturate(1.4); box-shadow: var(--rt-glass-shadow); }
.rt-lightbox-count { min-width: 38px; text-align: center; color: var(--rt-muted); font-size: 12px; font-variant-numeric: tabular-nums; }
.rt-lightbox-actions { display: flex; align-items: center; gap: 4px; }
.rt-lightbox-btn { width: 36px; height: 36px; display: grid; place-items: center; padding: 0; border: 0; border-radius: 50%; background: transparent; color: var(--rt-main); cursor: pointer; transition: background-color 120ms var(--rt-ease), color 120ms; }
.rt-lightbox-btn:hover:not(:disabled) { color: var(--rt-on-accent); background: var(--rt-accent); }
.rt-lightbox-btn:disabled { opacity: 0.32; cursor: not-allowed; }
.rt-lightbox-btn svg { width: 17px; height: 17px; }
.rt-lightbox-zoom { min-width: 52px; height: 36px; padding: 0 8px; border: 0; border-radius: 999px; background: transparent; color: var(--rt-main); font-size: 12px; font-variant-numeric: tabular-nums; cursor: pointer; }
.rt-lightbox-zoom:hover { background: var(--rt-hover); }
@keyframes rt-fade { from { opacity: 0; } to { opacity: 1; } }

@media (max-width: 700px) {
  .rt, .rt-upload, .rt-workspace { min-height: calc(100vh - 120px); margin: -16px; }
  .rt-upload { padding: 20px; }
  .rt-dropzone { min-height: 340px; }
  .rt-toolbar { padding: 14px 16px; }
  .rt-notice, .rt-receipt { width: calc(100% - 32px); }
  /* Pinned to both edges on phones: the dock spans the screen in two tidy rows. */
  .rt-batch { left: 8px; right: 8px; bottom: 12px; transform: none; width: auto; max-width: none; flex-wrap: wrap; justify-content: center; }
  .rt-batch-sep { display: none; }
  .rt-target { flex: 1 0 100%; text-align: center; }
  .rt-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 28px 10px; padding: 34px 12px 230px; }
  .rt-paper-stage { transform: scale(0.88); }
  .rt-lightbox { padding: 20px 12px; }
  .rt-lightbox-body { --rt-h: calc(min(60vh, 560px) * var(--rt-zoom, 1)); }
  .rt-lightbox-bar { gap: 8px; padding: 6px 8px 6px 12px; }
}
/* Touch has no hover: the page controls stay visible. */
@media (hover: none) {
  .rt-page-controls { opacity: 1; pointer-events: auto; transform: translateX(-50%) translateY(0); }
}
@media (prefers-reduced-motion: reduce) {
  .rt-paper, .rt-lightbox-page, .rt-page-controls, .rt-control, .rt-lightbox-btn, .rt-sheet, .rt-reading-track > span, .rt-dropzone, .rt-button.primary, .rt-batch .rt-button { transition: none; }
  .rt-lightbox[open] { animation: none; }
}
`
