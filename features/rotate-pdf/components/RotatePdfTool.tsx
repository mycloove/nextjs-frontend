'use client'

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react'
import { useDropzone } from 'react-dropzone'
import { uploadWithProgress, getApiErrorMessage } from '@/lib/upload/uploadWithProgress'
import { usePasteFiles } from '@/lib/upload/usePasteFiles'
import { downloadOutputs, type OutputFile } from '@/lib/download/downloadOutputs'
import { addRecentConversion } from '@/lib/history/recentConversions'

/** A page bench: previews stay local; the server receives the explicit final plan. */
type Phase = 'upload' | 'editing' | 'running'
interface PageSheet { id: string; originalIndex: number; rotation: number; preview: string | null; aspect: number }
interface WorkspaceFile { file: File; pages: PageSheet[] }
const MAX_FILE_MB = 50
const THUMBNAIL_SCALE = 0.28
/* The lightbox re-renders the page from the source PDF at this scale so zoomed
   text stays legible — the 0.28 thumbnail is only a bench preview. */
const PREVIEW_SCALE = 2
const ZOOM_MIN = 0.5
const ZOOM_MAX = 4
const ZOOM_STEP = 0.25
const clampZoom = (value: number) => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, value))
const fmtSize = (bytes: number) => bytes >= 1048576 ? `${(bytes / 1048576).toFixed(1)} MB` : bytes >= 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${bytes} B`
const nextRotation = (current: number, degrees: -90 | 90) => (current + degrees + 360) % 360

const Icons = {
  upload: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><path d="M14 2v6h6" /><path d="M12 17v-6" /><path d="m9.5 13.5 2.5-2.5 2.5 2.5" /></svg>,
  rotateLeft: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" /><path d="M3 3v5h5" /></svg>,
  rotateRight: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8" /><path d="M21 3v5h-5" /></svg>,
  preview: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M15 3h6v6" /><path d="M9 21H3v-6" /><path d="M21 3l-7 7" /><path d="M3 21l7-7" /></svg>,
  zoomIn: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" /><path d="M11 8v6" /><path d="M8 11h6" /></svg>,
  zoomOut: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" /><path d="M8 11h6" /></svg>,
  close: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M18 6 6 18" /><path d="m6 6 12 12" /></svg>,
  download: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 3v12" /><path d="m7 10 5 5 5-5" /><path d="M4 20h16" /></svg>,
  spinner: <svg className="rt-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><circle cx="12" cy="12" r="9" strokeOpacity=".28" /><path d="M12 3a9 9 0 0 1 9 9" /></svg>,
}

export default function RotatePdfTool() {
  const [workspace, setWorkspace] = useState<WorkspaceFile | null>(null)
  const [phase, setPhase] = useState<Phase>('upload')
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [progress, setProgress] = useState<number | null>(null)
  const [draggedId, setDraggedId] = useState<string | null>(null)
  const [previewId, setPreviewId] = useState<string | null>(null)
  const [previewSrc, setPreviewSrc] = useState<string | null>(null)
  const [zoom, setZoom] = useState(1)
  const [textReady, setTextReady] = useState(0)
  const zoomRef = useRef(1)
  const abortRef = useRef<AbortController | null>(null)
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lightboxRef = useRef<HTMLDivElement | null>(null)
  const pageBoxRef = useRef<HTMLSpanElement | null>(null)
  const textLayerRef = useRef<HTMLDivElement | null>(null)
  const textToken = useRef(0)
  /* The page height in PDF units (scale 1), used to turn the displayed page box
     height into the `--total-scale-factor` the PDF.js text layer needs. */
  const rawPageHeightRef = useRef(0)
  const workspaceRef = useRef<WorkspaceFile | null>(null)
  const panRef = useRef<{ x: number; y: number; left: number; top: number } | null>(null)
  /* The content point (normalised to the page) and the viewport pixel it sits
     under at the moment a zoom starts, so the same point can be put back under
     the same pixel once the zoom layout settles. */
  const anchorRef = useRef<{ nx: number; ny: number; ax: number; ay: number } | null>(null)
  const previewToken = useRef(0)
  const showNotice = useCallback((message: string) => { setNotice(message); if (noticeTimer.current) clearTimeout(noticeTimer.current); noticeTimer.current = setTimeout(() => setNotice(null), 2800) }, [])
  useEffect(() => () => { if (noticeTimer.current) clearTimeout(noticeTimer.current) }, [])
  const closePreview = useCallback(() => { previewToken.current += 1; textToken.current += 1; setPreviewId(null); setPreviewSrc(null); anchorRef.current = null; zoomRef.current = 1; setZoom(1) }, [])
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
  useEffect(() => { zoomRef.current = zoom }, [zoom])
  useEffect(() => {
    if (!previewId) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closePreview()
      else if (event.key === '+' || event.key === '=') zoomBy(ZOOM_STEP)
      else if (event.key === '-' || event.key === '_') zoomBy(-ZOOM_STEP)
      else if (event.key === '0') zoomReset()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [closePreview, previewId, zoomBy, zoomReset])
  // Native listener so Ctrl/Cmd + wheel can zoom without the browser page-zooming.
  useEffect(() => {
    if (!previewId) return
    const node = lightboxRef.current
    if (!node) return
    const onWheel = (event: WheelEvent) => { if (!event.ctrlKey && !event.metaKey) return; event.preventDefault(); applyZoom(zoomRef.current - event.deltaY * 0.0016, event.clientX, event.clientY) }
    node.addEventListener('wheel', onWheel, { passive: false })
    return () => node.removeEventListener('wheel', onWheel)
  }, [applyZoom, previewId])
  /* Selectable text layer. The raster preview cannot be selected, so a PDF.js
     text layer is overlaid and scaled to the displayed page box through
     `--total-scale-factor`. It is built once per opened page and only rotates
     with the page, so changing rotation never rebuilds it. */
  useEffect(() => {
    if (!previewId) return
    const container = textLayerRef.current
    const source = workspaceRef.current
    if (!container || !source) return
    const pageNumber = source.pages.findIndex((page) => page.id === previewId) + 1
    if (pageNumber < 1) return
    const token = ++textToken.current
    container.replaceChildren()
    container.style.removeProperty('--total-scale-factor')
    let cancelled = false
    void (async () => {
      const pdfjs = await import('pdfjs-dist')
      if (!pdfjs.GlobalWorkerOptions.workerSrc) pdfjs.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).toString()
      const document = await pdfjs.getDocument({ data: new Uint8Array(await source.file.arrayBuffer()) }).promise
      try {
        const page = await document.getPage(pageNumber)
        const viewport = page.getViewport({ scale: PREVIEW_SCALE })
        const textContent = await page.getTextContent()
        if (cancelled || token !== textToken.current || !container.isConnected) return
        const layer = new pdfjs.TextLayer({ textContentSource: textContent, container, viewport })
        await layer.render()
        if (cancelled || token !== textToken.current) return
        rawPageHeightRef.current = viewport.height / viewport.scale
        setTextReady((value) => value + 1)
      } finally { await document.destroy() }
    })().catch(() => { /* text is an enhancement; the raster preview is unaffected */ })
    return () => { cancelled = true }
  }, [previewId])
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

  const renderPages = useCallback(async (file: File): Promise<PageSheet[]> => {
    const pdfjs = await import('pdfjs-dist')
    if (!pdfjs.GlobalWorkerOptions.workerSrc) pdfjs.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).toString()
    const document = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise
    try {
      const sheets: PageSheet[] = []
      for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
        const page = await document.getPage(pageNumber)
        const viewport = page.getViewport({ scale: THUMBNAIL_SCALE })
        const canvas = window.document.createElement('canvas')
        canvas.width = Math.max(1, Math.round(viewport.width)); canvas.height = Math.max(1, Math.round(viewport.height))
        if (!canvas.getContext('2d')) throw new Error('Your browser could not prepare page previews.')
        await page.render({ canvas, viewport }).promise
        sheets.push({ id: `sheet-${pageNumber}`, originalIndex: pageNumber - 1, rotation: 0, preview: canvas.toDataURL('image/jpeg', .84), aspect: viewport.width / viewport.height })
      }
      return sheets
    } finally { await document.destroy() }
  }, [])

  // Single-page high-resolution render, used by the lightbox so zoomed text stays sharp.
  const renderPageImage = useCallback(async (file: File, pageNumber: number, scale: number): Promise<string> => {
    const pdfjs = await import('pdfjs-dist')
    if (!pdfjs.GlobalWorkerOptions.workerSrc) pdfjs.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).toString()
    const document = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise
    try {
      const page = await document.getPage(pageNumber)
      const viewport = page.getViewport({ scale })
      const canvas = window.document.createElement('canvas')
      canvas.width = Math.max(1, Math.round(viewport.width)); canvas.height = Math.max(1, Math.round(viewport.height))
      if (!canvas.getContext('2d')) throw new Error('Your browser could not prepare the preview.')
      await page.render({ canvas, viewport }).promise
      return canvas.toDataURL('image/jpeg', .9)
    } finally { await document.destroy() }
  }, [])

  const addFiles = useCallback(async (incoming: File[]) => {
    const file = incoming.find((candidate) => candidate.type === 'application/pdf' || candidate.name.toLowerCase().endsWith('.pdf'))
    if (!file) { setError('Choose a PDF file to arrange and rotate.'); return }
    if (file.size > MAX_FILE_MB * 1024 * 1024) { setError(`${file.name} is ${fmtSize(file.size)} — the limit is ${MAX_FILE_MB} MB.`); return }
    setError(null); setNotice(null); setPhase('running')
    try { const pages = await renderPages(file); if (!pages.length) throw new Error('This PDF has no pages to rotate.'); setWorkspace({ file, pages }); setPhase('editing') }
    catch (cause) { setWorkspace(null); setPhase('upload'); setError(cause instanceof Error ? `Could not open ${file.name}: ${cause.message}` : `Could not open ${file.name}.`) }
  }, [renderPages])
  usePasteFiles(addFiles, phase === 'upload')
  const { getRootProps, getInputProps, isDragActive, open } = useDropzone({ onDrop: addFiles, noClick: true, accept: { 'application/pdf': ['.pdf'] }, multiple: false })

  const rotateOne = useCallback((id: string, degrees: -90 | 90) => setWorkspace((current) => current ? { ...current, pages: current.pages.map((page) => page.id === id ? { ...page, rotation: nextRotation(page.rotation, degrees) } : page) } : current), [])
  const rotateAll = useCallback((degrees: -90 | 90) => { setWorkspace((current) => current ? { ...current, pages: current.pages.map((page) => ({ ...page, rotation: nextRotation(page.rotation, degrees) })) } : current); showNotice(`All pages rotated ${degrees > 0 ? 'right' : 'left'}.`) }, [showNotice])
  const moveSheet = useCallback((fromId: string, toId: string) => {
    if (fromId === toId) return
    setWorkspace((current) => { if (!current) return current; const from = current.pages.findIndex((page) => page.id === fromId); const to = current.pages.findIndex((page) => page.id === toId); if (from < 0 || to < 0) return current; const pages = [...current.pages]; const [moved] = pages.splice(from, 1); pages.splice(to, 0, moved); return { ...current, pages } })
    showNotice('Document order updated.')
  }, [showNotice])

  const openPreview = useCallback((page: PageSheet) => {
    if (!workspace) return
    const token = ++previewToken.current
    anchorRef.current = null; zoomRef.current = 1; setPreviewId(page.id); setZoom(1); setPreviewSrc(page.preview)
    renderPageImage(workspace.file, page.originalIndex + 1, PREVIEW_SCALE)
      .then((src) => { if (previewToken.current === token) setPreviewSrc(src) })
      .catch(() => { /* keep the bench thumbnail if the high-resolution pass fails */ })
  }, [renderPageImage, workspace])

  const exportPdf = useCallback(async () => {
    if (!workspace || phase === 'running') return
    setPhase('running'); setError(null); setProgress(0)
    const abort = new AbortController(); abortRef.current = abort
    try {
      const formData = new FormData(); formData.append('files', workspace.file); formData.append('pagePlan', JSON.stringify(workspace.pages.map(({ originalIndex, rotation }) => ({ originalIndex, rotation }))))
      const response = await uploadWithProgress('/api/rotate-pdf', formData, { onProgress: setProgress, signal: abort.signal })
      if (!response.ok) throw new Error(await getApiErrorMessage(response, 'Could not apply the page changes'))
      const matched = /filename="([^"]+)"/.exec(response.headers.get('Content-Disposition') ?? ''); const outputName = matched ? decodeURIComponent(matched[1]) : 'mycloove_rotated.pdf'; const blob = await response.blob()
      await downloadOutputs([{ name: outputName, blob }] as OutputFile[], outputName.replace(/\.pdf$/i, ''))
      addRecentConversion({ toolId: 'rotate-pdf', label: 'Rotate PDF', filename: outputName, sizeBytes: blob.size }); showNotice('Changes applied. Your PDF has downloaded.'); setPhase('editing')
    } catch (cause) { if (!(cause instanceof Error && cause.name === 'ApiClientError' && /cancelled/i.test(cause.message))) setError(cause instanceof Error ? cause.message : 'Could not apply the page changes. Please try again.'); setPhase('editing') }
    finally { abortRef.current = null; setProgress(null) }
  }, [phase, showNotice, workspace])
  const reset = useCallback(() => { abortRef.current?.abort(); textToken.current += 1; setWorkspace(null); setPhase('upload'); setError(null); setNotice(null); setPreviewId(null); setPreviewSrc(null); anchorRef.current = null; zoomRef.current = 1; setZoom(1) }, [])
  useEffect(() => { workspaceRef.current = workspace }, [workspace])
  const previewIndex = workspace && previewId ? workspace.pages.findIndex((page) => page.id === previewId) : -1
  const previewPage = previewIndex >= 0 && workspace ? workspace.pages[previewIndex] : null

  return <><style>{`
    .rt { --rt-base:#0b0d11;--rt-surface:#14171e;--rt-hover:#1c202a;--rt-line:#232833;--rt-main:#e2e8f0;--rt-muted:#8b95a5;--rt-accent:#36b39c;--rt-accent-hover:#2c9e89;--rt-accent-bg:rgba(54,179,156,.1);--rt-glass:rgba(18,21,27,.72);--rt-glass-line:rgba(255,255,255,.09);--rt-glass-shadow:0 10px 26px rgba(0,0,0,.42);--rt-dock:rgba(28,32,42,.55);--rt-dock-line:rgba(255,255,255,.14);--rt-dock-btn:rgba(255,255,255,.06);--rt-dock-shadow:inset 0 1px 0 rgba(255,255,255,.22),inset 0 0 0 .5px rgba(255,255,255,.05),0 24px 48px -22px rgba(0,0,0,.7);--rt-ease:cubic-bezier(.16,1,.3,1);--rt-settle:cubic-bezier(.34,1.56,.64,1);color:var(--rt-main);background:var(--rt-base);min-height:clamp(520px,calc(100vh - 148px),840px);margin:-24px;font-family:Inter,'DM Sans',sans-serif }
    [data-theme='light'] .rt { --rt-base:#f6f8fa;--rt-surface:#fff;--rt-hover:#f0f3f5;--rt-line:#d9e0e5;--rt-main:#17212b;--rt-muted:#62707d;--rt-accent-bg:rgba(54,179,156,.12);--rt-glass:rgba(255,255,255,.86);--rt-glass-line:rgba(15,23,32,.1);--rt-glass-shadow:0 10px 26px rgba(15,23,32,.16);--rt-dock:rgba(255,255,255,.6);--rt-dock-line:rgba(15,23,32,.1);--rt-dock-btn:rgba(15,23,32,.04);--rt-dock-shadow:inset 0 1px 0 rgba(255,255,255,.9),0 24px 48px -24px rgba(15,23,32,.35) }.rt *{box-sizing:border-box}.rt button{font:inherit}
    .rt-upload{min-height:clamp(520px,calc(100vh - 148px),840px);display:grid;place-items:center;padding:40px;background:var(--rt-surface)}.rt-dropzone{width:min(800px,100%);min-height:400px;border:1.5px dashed var(--rt-line);border-radius:16px;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:40px 24px;text-align:center;background:transparent;cursor:pointer;transition:border-color .3s var(--rt-ease),background .3s var(--rt-ease)}.rt-dropzone:hover,.rt-dropzone.over{border-color:var(--rt-accent);background:var(--rt-accent-bg)}.rt-dropicon{display:grid;place-items:center;color:var(--rt-accent);margin-bottom:20px}.rt-dropicon svg{width:40px;height:40px}.rt-dropzone h2{margin:0 0 8px;color:var(--rt-main);font-size:18px;font-weight:500;letter-spacing:-.01em}.rt-dropzone p{margin:0 0 24px;color:var(--rt-muted);font-size:14px}
    .rt-button{border:1px solid var(--rt-line);border-radius:6px;background:var(--rt-surface);color:var(--rt-main);padding:8px 16px;display:inline-flex;align-items:center;justify-content:center;gap:8px;cursor:pointer;font-size:13px;font-weight:500;transition:background .2s,transform .2s var(--rt-ease),opacity .2s}.rt-button:hover:not(:disabled){background:var(--rt-hover)}.rt-button:focus-visible,.rt-control:focus-visible{outline:2px solid var(--rt-accent);outline-offset:3px}.rt-button.primary{border-color:transparent;color:#031d18;background:var(--rt-accent)}.rt-button.primary:hover:not(:disabled){background:var(--rt-accent-hover);transform:translateY(-1px)}.rt-button:disabled{opacity:.48;cursor:not-allowed}.rt-button svg{width:16px;height:16px}
    .rt-workspace{min-height:clamp(520px,calc(100vh - 148px),840px);display:flex;flex-direction:column;background:var(--rt-base)}.rt-toolbar{min-height:68px;display:flex;justify-content:space-between;align-items:center;gap:20px;padding:14px 40px;background:var(--rt-surface);border-bottom:1px solid var(--rt-line)}.rt-fileinfo{display:flex;align-items:center;gap:12px;min-width:0}.rt-filename{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:14px;font-weight:500}.rt-filemeta{flex:none;padding:4px 8px;border-radius:4px;background:var(--rt-base);color:var(--rt-muted);font:12px ui-monospace,SFMono-Regular,Menlo,monospace;font-variant-numeric:tabular-nums}
    .rt-batch{position:fixed;left:50%;bottom:20px;z-index:40;transform:translateX(-50%);display:flex;align-items:center;justify-content:center;flex-wrap:nowrap;gap:6px;max-width:min(calc(100vw - 24px),1000px);padding:7px;border:1px solid var(--rt-dock-line);border-radius:18px;background:var(--rt-dock);-webkit-backdrop-filter:blur(20px) saturate(1.8);backdrop-filter:blur(20px) saturate(1.8);box-shadow:var(--rt-dock-shadow)}
    .rt-batch .rt-button{padding:6px 12px;gap:6px;font-size:12px;border-radius:10px;border:1px solid var(--rt-dock-line);background:var(--rt-dock-btn);box-shadow:inset 0 1px 0 rgba(255,255,255,.1);transition:background .18s var(--rt-ease),transform .16s var(--rt-settle),opacity .2s}.rt-batch .rt-button:hover:not(:disabled){background:var(--rt-hover);transform:translateY(-1px)}.rt-batch .rt-button:active:not(:disabled){transform:translateY(0) scale(.97)}.rt-batch .rt-button svg{width:14px;height:14px}.rt-batch .rt-button.primary{border-color:transparent;color:#04120f;background:linear-gradient(180deg,var(--rt-accent),var(--rt-accent-hover));box-shadow:inset 0 1px 0 rgba(255,255,255,.4),0 8px 18px -8px rgba(54,179,156,.7)}.rt-batch .rt-button.primary:hover:not(:disabled){background:linear-gradient(180deg,var(--rt-accent-hover),var(--rt-accent-hover))}.rt-batch .rt-progress{width:88px;height:5px}
    .rt-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));align-items:start;gap:32px;padding:50px 40px 132px}.rt-sheet{aspect-ratio:1/1;position:relative;display:grid;place-items:center;cursor:grab;user-select:none;perspective:1000px}.rt-sheet:active{cursor:grabbing}.rt-sheet.dragging{opacity:.38}.rt-sheet.drag-over{border-radius:12px;box-shadow:inset 0 0 0 2px var(--rt-accent)}.rt-page-number{position:absolute;left:50%;top:-24px;transform:translateX(-50%);padding:2px 8px;border:1px solid var(--rt-line);border-radius:4px;background:var(--rt-surface);color:var(--rt-muted);font:11px ui-monospace,SFMono-Regular,Menlo,monospace;font-variant-numeric:tabular-nums;z-index:2}.rt-paper-stage{width:172px;height:214px;display:grid;place-items:center}.rt-paper{max-width:168px;max-height:204px;display:block;background:#fff;border-radius:4px;box-shadow:0 8px 24px rgba(0,0,0,.48),inset 0 0 0 1px rgba(0,0,0,.1);transition:transform .4s cubic-bezier(.34,1.56,.64,1);transform-origin:center}.rt-page-controls{position:absolute;bottom:12px;left:50%;z-index:10;display:flex;gap:4px;padding:4px;border:1px solid var(--rt-glass-line);border-radius:999px;background:var(--rt-glass);-webkit-backdrop-filter:blur(10px) saturate(1.4);backdrop-filter:blur(10px) saturate(1.4);box-shadow:var(--rt-glass-shadow);opacity:0;pointer-events:none;transform:translateX(-50%) translateY(10px) scale(.94);transform-origin:bottom center;transition:opacity .2s var(--rt-ease),transform .24s var(--rt-settle)}.rt-sheet:hover .rt-page-controls,.rt-sheet:focus-within .rt-page-controls{opacity:1;pointer-events:auto;transform:translateX(-50%) translateY(0) scale(1)}.rt-control{width:30px;height:30px;display:flex;align-items:center;justify-content:center;padding:0;border:0;border-radius:50%;background:transparent;color:var(--rt-main);cursor:pointer;transition:background .18s var(--rt-ease),color .18s,transform .18s var(--rt-settle)}.rt-control:hover{color:#04120f;background:var(--rt-accent);transform:scale(1.08)}.rt-control:active{transform:scale(.92)}.rt-control svg{width:15px;height:15px;fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}
    .rt-message{margin:0 40px 28px;padding:11px 14px;border:1px solid rgba(255,90,80,.35);border-radius:8px;background:rgba(255,90,80,.08);color:#ff9b93;font-size:13px}.rt-progress{width:128px;height:6px;overflow:hidden;border-radius:999px;background:var(--rt-line)}.rt-progress>span{display:block;height:100%;background:var(--rt-accent);transition:width .2s var(--rt-ease)}.rt-toast{position:fixed;left:50%;bottom:108px;z-index:20;transform:translateX(-50%);padding:12px 24px;border-radius:999px;background:var(--rt-accent);color:#031d18;box-shadow:0 8px 16px rgba(54,179,156,.2);font-size:14px;font-weight:600}.rt-spin{animation:rt-spin .75s linear infinite}@keyframes rt-spin{to{transform:rotate(360deg)}}
    .rt-control-sep{align-self:center;width:1px;height:16px;margin:0 2px;background:var(--rt-glass-line)}
    .rt-lightbox{position:fixed;inset:0;z-index:60;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:16px;padding:32px 24px;background:rgba(5,7,10,.76);-webkit-backdrop-filter:blur(14px);backdrop-filter:blur(14px);animation:rt-fade .2s var(--rt-ease)}.rt-lightbox-body{flex:1;min-height:0;width:100%;display:flex;overflow:auto;padding:10px;overscroll-behavior:contain;scrollbar-width:thin;overflow-anchor:none;user-select:none;--rt-h:calc(min(76vh,760px) * var(--rt-zoom,1));--rt-w:calc(var(--rt-h) * var(--rt-aspect,.7071))}.rt-lightbox-body.is-zoomed{cursor:grab}.rt-lightbox-body.is-zoomed:active{cursor:grabbing}.rt-lightbox-stage{position:relative;flex:none;margin:auto}.rt-lightbox-stage[data-rot='even']{width:var(--rt-w);height:var(--rt-h)}.rt-lightbox-stage[data-rot='odd']{width:var(--rt-h);height:var(--rt-w)}.rt-lightbox-page{position:absolute;left:50%;top:50%;width:var(--rt-w);height:var(--rt-h);transform:translate(-50%,-50%) rotate(var(--rt-rot,0deg))}.rt-lightbox-paper{position:absolute;inset:0;width:100%;height:100%;display:block;background:#fff;border-radius:6px;box-shadow:0 30px 70px -20px rgba(0,0,0,.7),inset 0 0 0 1px rgba(0,0,0,.08)}.rt-lightbox-text{position:absolute;inset:0;z-index:2;overflow:clip;text-align:initial;line-height:1;-webkit-text-size-adjust:none;text-size-adjust:none;forced-color-adjust:none;transform-origin:0 0;pointer-events:none;--min-font-size:1;--min-font-size-inv:calc(1 / var(--min-font-size));--text-scale-factor:calc(var(--total-scale-factor,1) * var(--min-font-size));--scale-round-x:1px;--scale-round-y:1px}.rt-lightbox-text :is(span,br){color:transparent;position:absolute;white-space:pre;cursor:text;transform-origin:0% 0%;pointer-events:auto;user-select:text}.rt-lightbox-text span.markedContent{top:0;height:0;display:contents}.rt-lightbox-text > :not(.markedContent),.rt-lightbox-text .markedContent span:not(.markedContent){z-index:1;--font-height:0;--scale-x:1;--rotate:0deg;font-size:calc(var(--text-scale-factor) * var(--font-height));transform:rotate(var(--rotate)) scaleX(var(--scale-x)) scale(var(--min-font-size-inv))}.rt-lightbox-text ::selection{background:rgba(54,179,156,.42)}.rt-lightbox-bar{display:flex;align-items:center;gap:14px;flex-wrap:wrap;justify-content:center;padding:8px 10px 8px 18px;border:1px solid var(--rt-glass-line);border-radius:999px;background:var(--rt-glass);-webkit-backdrop-filter:blur(12px) saturate(1.4);backdrop-filter:blur(12px) saturate(1.4);box-shadow:var(--rt-glass-shadow)}.rt-lightbox-count{min-width:38px;text-align:center;color:var(--rt-muted);font:12px ui-monospace,SFMono-Regular,Menlo,monospace;font-variant-numeric:tabular-nums}.rt-lightbox-actions{display:flex;align-items:center;gap:4px}.rt-lightbox-btn{width:34px;height:34px;display:flex;align-items:center;justify-content:center;padding:0;border:0;border-radius:50%;background:transparent;color:var(--rt-main);cursor:pointer;transition:background .18s var(--rt-ease),color .18s,transform .18s var(--rt-settle)}.rt-lightbox-btn:hover:not(:disabled){color:#04120f;background:var(--rt-accent);transform:scale(1.06)}.rt-lightbox-btn:active:not(:disabled){transform:scale(.94)}.rt-lightbox-btn:disabled{opacity:.32;cursor:not-allowed}.rt-lightbox-btn:focus-visible,.rt-lightbox-zoom:focus-visible{outline:2px solid var(--rt-accent);outline-offset:3px}.rt-lightbox-btn svg{width:17px;height:17px;fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}.rt-lightbox-zoom{min-width:52px;height:34px;padding:0 8px;border:0;border-radius:999px;background:transparent;color:var(--rt-main);font:12px ui-monospace,SFMono-Regular,Menlo,monospace;font-variant-numeric:tabular-nums;cursor:pointer;transition:background .18s var(--rt-ease)}.rt-lightbox-zoom:hover{background:var(--rt-hover)}@keyframes rt-fade{from{opacity:0}to{opacity:1}}
    @media(max-width:700px){.rt,.rt-upload,.rt-workspace{min-height:calc(100vh - 120px);margin:-16px}.rt-upload{padding:20px}.rt-dropzone{min-height:340px}.rt-toolbar{padding:14px 18px}.rt-batch{bottom:12px;flex-wrap:wrap;gap:6px;padding:6px;max-width:calc(100vw - 16px)}.rt-batch .rt-button{padding:6px 10px;font-size:11.5px}.rt-grid{grid-template-columns:repeat(2,minmax(0,1fr));gap:22px 10px;padding:34px 12px 230px}.rt-paper-stage{transform:scale(.88)}.rt-message{margin:0 20px 20px}.rt-lightbox{padding:20px 12px;gap:12px}.rt-lightbox-body{--rt-h:calc(min(60vh,560px) * var(--rt-zoom,1))}.rt-lightbox-bar{gap:8px;padding:6px 8px 6px 12px}.rt-lightbox-count{min-width:32px}}@media(hover:none){.rt-page-controls{bottom:8px;opacity:1;pointer-events:auto;transform:translateX(-50%) translateY(0) scale(1)}}@media(prefers-reduced-motion:reduce){.rt *,.rt *::before,.rt *::after{animation-duration:.01ms!important;transition-duration:.01ms!important}}
  `}</style><section className="rt" aria-label="Rotate PDF workspace">
    {phase === 'upload' && <div className="rt-upload" {...getRootProps({ role: 'group', 'aria-label': 'Upload a PDF to organize and rotate' })}><input {...getInputProps()} /><div className={`rt-dropzone${isDragActive ? ' over' : ''}`} onClick={open}><span className="rt-dropicon">{Icons.upload}</span><h2>Drop a PDF to organize &amp; rotate</h2><p>Drag and drop or click to browse files</p><button type="button" className="rt-button primary" onClick={(event) => { event.stopPropagation(); open() }}>Browse Files</button></div></div>}
    {phase === 'running' && !workspace && <div className="rt-upload"><div className="rt-dropzone" aria-live="polite"><span className="rt-dropicon">{Icons.spinner}</span><h2>Reading your PDF</h2><p>Preparing page previews for the workspace.</p></div></div>}
    {workspace && <div className="rt-workspace"><div className="rt-toolbar"><div className="rt-fileinfo"><span className="rt-filename" title={workspace.file.name}>{workspace.file.name}</span><span className="rt-filemeta">{workspace.pages.length} Pages</span></div><div className="rt-batch">{phase === 'running' && progress !== null && <span className="rt-progress" aria-label={`Upload progress ${progress}%`}><span style={{ width: `${progress}%` }} /></span>}<button type="button" className="rt-button" onClick={() => rotateAll(-90)} disabled={phase === 'running'}>{Icons.rotateLeft} Rotate All Left</button><button type="button" className="rt-button" onClick={() => rotateAll(90)} disabled={phase === 'running'}>{Icons.rotateRight} Rotate All Right</button>{phase === 'running' ? <button type="button" className="rt-button" onClick={() => abortRef.current?.abort()}>Cancel</button> : <><button type="button" className="rt-button" onClick={reset}>Cancel</button><button type="button" className="rt-button primary" onClick={exportPdf}>Apply &amp; Download {Icons.download}</button></>}</div></div><div className="rt-grid" aria-label="PDF pages. Drag a page to change its order.">{workspace.pages.map((page, index) => <div key={page.id} className={`rt-sheet${draggedId === page.id ? ' dragging' : ''}`} draggable={phase !== 'running'} onDragStart={() => setDraggedId(page.id)} onDragOver={(event) => event.preventDefault()} onDrop={() => { if (draggedId) moveSheet(draggedId, page.id); setDraggedId(null) }} onDragEnd={() => setDraggedId(null)}><span className="rt-page-number">{index + 1}</span><span className="rt-paper-stage">
      {/* Canvas data URLs are generated locally from the user's selected PDF. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img className="rt-paper" src={page.preview ?? undefined} alt={`Page ${index + 1} preview`} style={{ transform: `rotate(${page.rotation}deg)` }} />
    </span><span className="rt-page-controls"><button type="button" className="rt-control" title="Rotate left" aria-label={`Rotate page ${index + 1} left`} onClick={() => rotateOne(page.id, -90)}>{Icons.rotateLeft}</button><button type="button" className="rt-control" title="Rotate right" aria-label={`Rotate page ${index + 1} right`} onClick={() => rotateOne(page.id, 90)}>{Icons.rotateRight}</button><span className="rt-control-sep" aria-hidden="true" /><button type="button" className="rt-control" title="Preview page" aria-label={`Preview page ${index + 1}`} onClick={() => openPreview(page)}>{Icons.preview}</button></span></div>)}</div></div>}
    {error && <div className="rt-message" role="alert">{error}</div>}{notice && <div className="rt-toast" role="status">{notice}</div>}
    {previewPage && workspace && <div className="rt-lightbox" role="dialog" aria-modal="true" aria-label={`Page ${previewIndex + 1} preview`} onClick={closePreview}>
      <div ref={lightboxRef} className={`rt-lightbox-body${zoom > 1 ? ' is-zoomed' : ''}`} style={{ '--rt-zoom': zoom, '--rt-aspect': previewPage.aspect } as CSSProperties} onClick={(event) => event.stopPropagation()} onPointerDown={(event) => { const node = lightboxRef.current; if (!node) return; if ((event.target as HTMLElement).closest('.rt-lightbox-text')) return; if (node.scrollWidth <= node.clientWidth + 1 && node.scrollHeight <= node.clientHeight + 1) return; panRef.current = { x: event.clientX, y: event.clientY, left: node.scrollLeft, top: node.scrollTop }; node.setPointerCapture(event.pointerId) }} onPointerMove={(event) => { const start = panRef.current; const node = lightboxRef.current; if (!start || !node) return; node.scrollLeft = start.left - (event.clientX - start.x); node.scrollTop = start.top - (event.clientY - start.y) }} onPointerUp={(event) => { const node = lightboxRef.current; if (node?.hasPointerCapture(event.pointerId)) node.releasePointerCapture(event.pointerId); panRef.current = null }}>
        {/* Stage owns the layout box for the rotated page: a CSS transform alone
            does not change layout, so without this the scroll area would still
            match the unrotated portrait box and wheel scrolling would fight the
            visual content. The page box carries the rotation for both the raster
            and the selectable text layer. */}
        <span className="rt-lightbox-stage" data-rot={previewPage.rotation % 180 === 0 ? 'even' : 'odd'}>
          <span ref={pageBoxRef} className="rt-lightbox-page" style={{ '--rt-rot': `${previewPage.rotation}deg` } as CSSProperties}>
            {/* Canvas data URLs are generated locally from the user's selected PDF. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img className="rt-lightbox-paper" src={previewSrc ?? previewPage.preview ?? undefined} alt={`Page ${previewIndex + 1} preview`} />
            {/* Transparent PDF.js text layer over the raster, so text can be
                selected and copied with the cursor like a normal document. */}
            <div ref={textLayerRef} className="rt-lightbox-text" role="document" aria-label={`Page ${previewIndex + 1} text`} />
          </span>
        </span>
      </div>
      <div className="rt-lightbox-bar" onClick={(event) => event.stopPropagation()}>
        <span className="rt-lightbox-count">Page {previewIndex + 1} of {workspace.pages.length}</span>
        <div className="rt-lightbox-actions">
          <button type="button" className="rt-lightbox-btn" title="Rotate left" aria-label={`Rotate page ${previewIndex + 1} left`} onClick={() => rotateOne(previewPage.id, -90)}>{Icons.rotateLeft}</button>
          <span className="rt-lightbox-count" aria-hidden="true">{previewPage.rotation}°</span>
          <button type="button" className="rt-lightbox-btn" title="Rotate right" aria-label={`Rotate page ${previewIndex + 1} right`} onClick={() => rotateOne(previewPage.id, 90)}>{Icons.rotateRight}</button>
          <span className="rt-control-sep" aria-hidden="true" />
          <button type="button" className="rt-lightbox-btn" title="Zoom out" aria-label="Zoom out" onClick={() => zoomBy(-ZOOM_STEP)} disabled={zoom <= ZOOM_MIN}>{Icons.zoomOut}</button>
          <button type="button" className="rt-lightbox-zoom" title="Reset zoom" aria-label={`Reset zoom, currently ${Math.round(zoom * 100)} percent`} onClick={zoomReset}>{Math.round(zoom * 100)}%</button>
          <button type="button" className="rt-lightbox-btn" title="Zoom in" aria-label="Zoom in" onClick={() => zoomBy(ZOOM_STEP)} disabled={zoom >= ZOOM_MAX}>{Icons.zoomIn}</button>
          <span className="rt-control-sep" aria-hidden="true" />
          <button type="button" className="rt-lightbox-btn" title="Close preview" aria-label="Close preview" onClick={closePreview}>{Icons.close}</button>
        </div>
      </div>
    </div>}
  </section></>
}
