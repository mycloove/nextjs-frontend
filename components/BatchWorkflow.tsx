'use client'

/*
  Batch Process — "the dispatch office"

  Design contract (Astrolabe Standard, bench register):
  - One persistent frame. The old header/desk/action-bar ribbon layout —
    stacked horizontal border-bottoms with bordered sub-cards inside the
    frame — was replaced, not layered: the desk is a TWO-PANE composition
    with exactly one vertical hairline between the panes. Headers and
    panels separate by typography, spacing and background groupings only.
  - The STORY PANE (left, and the whole desk while no manifest exists)
    narrates the job in one place: the intake dock → the runner (honest
    run readout) → the delivery receipt. The user never hunts for where
    the story is; a phase change swaps content inside the same pane.
  - The LEDGER PANE (right, once a file exists) holds what the user
    decides: the grouped manifest, its tally, and the pinned actions.
    Rows group by background alone — no box-in-box.
  - The dock holds the intake invite — a fanned stack of three specimen
    plates (image / PDF / DOC), the module's actual mixed material. On
    drag-over the fan spreads, each plate leaning toward its own route;
    once a manifest exists the same elements compact and the copy turns
    to "Add more files". The floor never unmounts while the batch is
    editable; the swap to run/receipt is a phase change, not an append.
  - One signature motion moment: the OVERPRINT STAMP. Routing is decided
    once per file type — each group head carries a "route all" selector
    (Image → PDF, PDF → Images, …) that retitles every file of that type
    in one motion; no per-file dropdown duplicates the decision. At
    dispatch a single overprint stamp — DISPATCHED — strikes the tally.
    The stamp depicts the only decisions the user actually makes here.
  - Loading borrows the house Kinetic Sphere (components/KineticSphere.tsx,
    the shared whole-surface loader) — one device at two scales, no new
    loader invented: a 40px accent sphere anchors the runner pane, a 13px
    ink sphere sits inside the dispatch button's morph. The sphere inherits
    CSS colour, so it works on both the card surface and the coral button.
  - The primary action is a two-face MORPH: idle and busy labels stack in
    one grid cell and cross-fade on state change, so the bar never reflows
    when the label changes. Hover lifts with a soft accent shadow (the
    Press Room's press treatment); busy keeps full colour under the running
    sphere instead of dimming to a grey husk.
  - No simulated progress, ever. The backend runs one opaque POST and
    returns one zip; per-file status does not exist in the contract. While
    dispatching, the whole truth is: the sphere (indeterminate by design),
    the "5 parallel lanes" copy, the elapsed clock, and the honest note
    that per-file results arrive inside the archive.
  - Truth-telling fixes carried over the old implementation: fabricated
    8%-92% progress bar removed; alert() replaced by the header notice
    slot; unroutable files are refused at the door instead of silently
    queued to die inside the zip; the delivery receipt reports the real
    blob size and the *_error.txt contract; the blob URL is revoked on the
    next action instead of leaking (it is kept between delivery and
    re-download — "Download again" is honest, and the lifetime is bounded).
  - Surface rules: tool workspace (surface 3) has no palette of its own —
    every colour is a global token from app/theme.css. --brand-yellow is
    this tool's edge-code, mirroring the Press Room's job-ticket yellow; it
    is local to this surface and independent of the shared LayeredIcon
    family, where batch now carries the Advanced tone ("ALL").
    --brand-red carries danger only. The accent means state and action.
    --bw-ink is the one local constant (text on the accent fill), theme-
    invariant because both accent stops are theme-invariant.
  - Body text inherits the tool-surface voice (Inter, via the root font
    class); Syne is the display face. Nothing that is not loaded in the
    repo. Every changing numeral is tabular.
  - Motion uses the house curves and honours prefers-reduced-motion;
    only opacity/transform/colour animate.
*/

import { useState, useCallback, useEffect, useRef } from 'react'
import { useDropzone, type FileRejection } from 'react-dropzone'
import { toolRequest, getApiErrorMessage, ApiClientError } from '@/lib/api/client'
import KineticSphere from '@/components/KineticSphere'

/* ── Operation vocabulary ─────────────────────────────────────
   These six values are the backend's dispatch vocabulary
   (utils/task_executor.py process_single_task). Changing a value
   here breaks the batch contract — labels may change, values may not. */
const ALL_OPERATIONS = [
  { value: 'image_to_pdf',  label: 'Image → PDF',        fileType: 'image' },
  { value: 'pdf_to_images', label: 'PDF → Images',       fileType: 'pdf' },
  { value: 'image_to_text', label: 'Image → Text (OCR)', fileType: 'image' },
  { value: 'pdf_to_word',   label: 'PDF → Word',         fileType: 'pdf' },
  { value: 'analyze_pdf',   label: 'AI Analyze',         fileType: 'pdf' },
  { value: 'word_to_pdf',   label: 'Word → PDF',         fileType: 'word' },
]

/* The Flask app's MAX_CONTENT_LENGTH. The UI states the ceiling before
   dispatch instead of letting a 100 MB upload fail opaquely. */
const MAX_TOTAL_BYTES = 100 * 1024 * 1024

const ACCEPT: Record<string, string[]> = {
  'application/pdf': ['.pdf'],
  'image/*': ['.jpeg', '.jpg', '.png', '.gif', '.bmp', '.webp'],
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': ['.docx'],
}

type FileType = 'image' | 'pdf' | 'word' | 'other'

const GROUP_ORDER: Array<Exclude<FileType, 'other'>> = ['image', 'pdf', 'word']
const GROUP_LABEL: Record<string, string> = { image: 'Images', pdf: 'PDFs', word: 'Documents' }

/* ── Glyphs (one shape per real thing: file types and destinations) ── */
const G = {
  img: (s: number) => (
    <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3" y="3" width="18" height="18" rx="2" /><circle cx="8.5" cy="8.5" r="1.5" />
      <polyline points="21 15 16 10 5 21" />
    </svg>
  ),
  pdf: (s: number) => (
    <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
    </svg>
  ),
  doc: (s: number) => (
    <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
      <line x1="8" y1="13" x2="16" y2="13" /><line x1="8" y1="17" x2="12" y2="17" />
    </svg>
  ),
  docW: (s: number) => (
    <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
      <path d="M8 12l1.5 4 1.5-4 1.5 4 1.5-4" />
    </svg>
  ),
}

const Ic = {
  archive: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" />
    </svg>
  ),
  download: (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" />
    </svg>
  ),
  close: (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
      <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  ),
  chevron: (
    <svg width="9" height="6" viewBox="0 0 10 6" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M1 1l4 4 4-4" />
    </svg>
  ),
}

/* ── Helpers ───────────────────────────────────────────────────
   getFileType matches the old implementation exactly — the default
   operation inference and the group routing both key off it. */
const getFileType = (file: File): FileType => {
  if (file.type === 'application/pdf') return 'pdf'
  if (file.type.startsWith('image/')) return 'image'
  if (file.name.endsWith('.docx')) return 'word'
  return 'other'
}

const operationsForType = (type: FileType) =>
  ALL_OPERATIONS.filter(op => op.fileType === type)

const defaultOpFor = (file: File): string => {
  const t = getFileType(file)
  if (t === 'pdf') return 'pdf_to_images'
  if (t === 'word') return 'word_to_pdf'
  return 'image_to_pdf'
}

const formatSize = (bytes: number) => {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`
}

const typeLabel = (file: File) => {
  const t = getFileType(file)
  if (t === 'pdf') return 'PDF'
  if (t === 'image') return file.type.split('/')[1]?.toUpperCase() || 'IMG'
  if (t === 'word') return 'DOCX'
  return '?'
}

/* ── Interface ─────────────────────────────────────────────── */
interface FileTask {
  id: string
  file: File
  operation: string
  /* index within the drop that added it — drives the landing stagger.
     Rows from a later drop restart the count so they never inherit a
     stale multi-second delay. */
  stagger: number
}

/* Snapshot of one completed run. Describes THAT run truthfully even if
   the manifest is edited afterwards — it never silently re-describes
   the current queue. */
interface Delivery {
  count: number
  sizeBytes: number
  seconds: number
  name: string
}

/* ─────────────────────────────────────────────────────────────
   Component
   ───────────────────────────────────────────────────────────── */
export default function BatchWorkflow() {
  const [tasks, setTasks]       = useState<FileTask[]>([])
  const [loading, setLoading]   = useState(false)
  const [delivery, setDelivery] = useState<Delivery | null>(null)
  const [notice, setNotice]     = useState<{ text: string; tone: 'info' | 'error' } | null>(null)
  const [elapsed, setElapsed]   = useState(0)

  const startedRef  = useRef(0)
  const zipUrlRef   = useRef<string | null>(null)
  const abortRef    = useRef<AbortController | null>(null)

  /* A cancel through toolRequest arrives as an ApiClientError whose cause is the
     AbortError, so a deliberate stop is told apart from a real failure. */
  const isCancellation = (e: unknown) =>
    e instanceof ApiClientError && (e.cause as { name?: string } | undefined)?.name === 'AbortError'

  /* The blob URL is kept from delivery until the next dispatch, a clear,
     or unmount — long enough for "Download again", never leaked past the
     next action. */
  const revokeZip = useCallback(() => {
    if (zipUrlRef.current) { URL.revokeObjectURL(zipUrlRef.current); zipUrlRef.current = null }
  }, [])
  useEffect(() => () => { revokeZip(); abortRef.current?.abort() }, [revokeZip])

  /* ── Intake (shared by drop and paste) ── */
  const addFiles = useCallback((files: File[]) => {
    const routable  = files.filter(f => operationsForType(getFileType(f)).length > 0)
    const refused   = files.length - routable.length
    if (routable.length) {
      setTasks(prev => [
        ...prev,
        ...routable.map((file, i) => ({
          id: Math.random().toString(36).slice(2, 9),
          file,
          operation: defaultOpFor(file),
          stagger: i,
        })),
      ])
      setDelivery(null)
      setNotice(null)
    }
    if (refused) {
      setNotice({ text: `${refused} file${refused > 1 ? 's' : ''} can\u2019t be routed — images, PDFs and DOCX only.`, tone: 'info' })
    }
  }, [])

  const onDrop = useCallback((accepted: File[], rejections: FileRejection[]) => {
    if (accepted.length) addFiles(accepted)
    if (rejections.length) {
      setNotice({ text: `${rejections.length} file${rejections.length > 1 ? 's' : ''} can\u2019t be routed — images, PDFs and DOCX only.`, tone: 'info' })
    }
  }, [addFiles])

  const { getRootProps, getInputProps, isDragActive, isDragReject } = useDropzone({
    onDrop,
    accept: ACCEPT,
    disabled: loading,
  })

  /* ── Paste a stack straight from the clipboard ──
     A folder of copied files is a natural batch input; one listener. */
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      if (loading) return
      const files = e.clipboardData?.files
      if (!files?.length) return
      const arr = Array.from(files)
      if (arr.some(f => operationsForType(getFileType(f)).length > 0)) {
        e.preventDefault()
        addFiles(arr)
      }
    }
    window.addEventListener('paste', onPaste)
    return () => window.removeEventListener('paste', onPaste)
  }, [loading, addFiles])

  /* ── Honest elapsed seconds — with the lane dots, the whole truth
     about an opaque run. No percentage is fabricated. ── */
  useEffect(() => {
    if (!loading) return
    startedRef.current = Date.now()
    setElapsed(0)
    const id = setInterval(() => setElapsed(Math.floor((Date.now() - startedRef.current) / 1000)), 1000)
    return () => clearInterval(id)
  }, [loading])

  /* ── Manifest edits ── */
  const routeAll = (type: string, op: string) =>
    setTasks(t => t.map(task => getFileType(task.file) === type ? { ...task, operation: op } : task))

  const removeTask = (id: string) =>
    setTasks(t => t.filter(task => task.id !== id))

  const clearAll = () => {
    abortRef.current?.abort()
    revokeZip()
    setTasks([])
    setDelivery(null)
    setNotice(null)
    setElapsed(0)
  }

  /* ── Dispatch ── */
  const startBatch = async () => {
    if (!tasks.length || loading || overLimit) return
    setLoading(true)
    setNotice(null)
    setDelivery(null)
    revokeZip()
    const controller = new AbortController()
    abortRef.current = controller

    const formData = new FormData()
    formData.append('tasks', JSON.stringify(tasks.map((t, i) => ({
      fileId: `file_${i}`, original_name: t.file.name, operation: t.operation, options: {},
    }))))
    tasks.forEach((t, i) => formData.append(`file_${i}`, t.file))

    try {
      const res = await toolRequest('/api/batch-process', {
        method: 'POST', body: formData, signal: controller.signal,
      })
      if (!res.ok) throw new Error(await getApiErrorMessage(res, 'Batch processing failed'))

      const blob = await res.blob()
      const name = `mycloove_Batch_${Date.now()}.zip`
      const url  = URL.createObjectURL(blob)
      zipUrlRef.current = url

      const a = Object.assign(document.createElement('a'), { href: url, download: name })
      document.body.appendChild(a); a.click(); document.body.removeChild(a)

      setDelivery({
        count: tasks.length,
        sizeBytes: blob.size,
        seconds: Math.max(1, Math.round((Date.now() - startedRef.current) / 1000)),
        name,
      })
    } catch (err: unknown) {
      if (isCancellation(err)) {
        // deliberate cancel — nothing to report
      } else {
        setNotice({
          text: err instanceof Error ? err.message : 'Batch processing failed. Please try again.',
          tone: 'error',
        })
      }
    } finally {
      abortRef.current = null
      setLoading(false)
    }
  }

  const cancelDispatch = () => {
    abortRef.current?.abort()
  }

  const downloadAgain = () => {
    if (!zipUrlRef.current || !delivery) return
    const a = Object.assign(document.createElement('a'), { href: zipUrlRef.current, download: delivery.name })
    document.body.appendChild(a); a.click(); document.body.removeChild(a)
  }

  /* ── Derived ── */
  const hasStack   = tasks.length > 0
  const phase      = !hasStack ? 'intake' : loading ? 'dispatched' : delivery ? 'delivered' : 'manifest'
  const totalBytes = tasks.reduce((s, t) => s + t.file.size, 0)
  const overLimit  = totalBytes > MAX_TOTAL_BYTES

  const groups = GROUP_ORDER
    .map(type => ({ type, label: GROUP_LABEL[type], tasks: tasks.filter(t => getFileType(t.file) === type) }))
    .filter(g => g.tasks.length > 0)

  /* ledger numerals — a row's position in dispatch order, across all groups */
  const orderById = new Map(tasks.map((t, i) => [t.id, i + 1]))

  const stateSuffix =
    phase === 'dispatched' ? ' \u00B7 dispatching' :
    phase === 'delivered'  ? ' \u00B7 delivered' :
    hasStack               ? ` \u00B7 ${tasks.length} file${tasks.length > 1 ? 's' : ''}` : ''

  const metaParts = groups.map(g => `${g.tasks.length} ${g.type === 'pdf' ? 'pdf' : g.type === 'image' ? 'img' : 'doc'}`)
  const headerMeta = hasStack
    ? `${metaParts.join(' \u00B7 ')} \u00B7 ${formatSize(totalBytes)}`
    : 'one archive out'

  const stageLabel = hasStack
    ? 'Add more files to the batch — drop, click or paste'
    : 'Add files to the batch — drop, click or paste'

  return (
    <>
      <style>{`
        /* ── Local tokens ──
           --bw-ink is text on the accent fill; the accent stops are identical
           in both themes, so the ink that sits on them is theme-invariant. */
        .bw {
          --bw-ink:    #1d1b16;
          --bw-ease:   cubic-bezier(0.16, 1, 0.3, 1);
          --bw-spring: cubic-bezier(0.34, 1.56, 0.64, 1);
          --bw-theme:  cubic-bezier(0.4, 0, 0.2, 1);
          max-width: 880px;
          margin: 0 auto;
          width: 100%;
        }

        /* ── Keyframes ── */
        @keyframes bw-enter {
          from { opacity: 0; transform: translateY(4px); }
          to   { opacity: 1; transform: none; }
        }
        @keyframes bw-row-in {
          from { opacity: 0; transform: translateY(4px); }
          to   { opacity: 1; transform: none; }
        }
        /* the overprint stamp strikes the tally once at dispatch */
        @keyframes bw-overprint {
          0%   { opacity: 0; transform: scale(1.35) rotate(-7deg); }
          60%  { opacity: 1; transform: scale(0.97) rotate(-1deg); }
          100% { opacity: 1; transform: scale(1)    rotate(-2deg); }
        }
        @keyframes bw-pulse {
          0%, 100% { opacity: 1; }
          50%      { opacity: 0.35; }
        }
        @keyframes bw-draw { to { stroke-dashoffset: 0; } }

        /* ── The frame ── */
        .bw-frame {
          position: relative;
          display: flex;
          flex-direction: column;
          background: var(--bg-card);
          border: 1px solid var(--border-card);
          border-radius: 14px;
          transition: border-color 0.2s var(--bw-theme), background-color 0.35s var(--bw-theme);
        }
        /* drag feedback lives on the story pane — the only actual drop
           target — so the surface that answers a drag is the surface
           that accepts one. Tint only; the frame keeps its border. */
        .bw-pane-story::after {
          content: '';
          position: absolute;
          inset: 0;
          background: var(--accent-start);
          opacity: 0;
          transition: opacity 0.2s var(--bw-theme);
          pointer-events: none;
        }
        .bw-frame.drag .bw-pane-story::after   { opacity: 0.045; }
        .bw-frame.reject .bw-pane-story::after { background: var(--brand-red); opacity: 0.05; }

        /* ── Region A — header strip: typography separates, no rule ── */
        .bw-head {
          display: flex;
          align-items: center;
          gap: 10px;
          min-height: 44px;
          padding: 14px 20px 10px;
          flex-wrap: wrap;
          transition: box-shadow 0.2s var(--bw-theme), border-color 0.35s var(--bw-theme);
        }
        .bw-head.notice { box-shadow: inset 2px 0 0 var(--brand-red); }
        /* Informational notices (files refused at intake) read calm, not as a failure. */
        .bw-head.notice-info { box-shadow: inset 2px 0 0 var(--accent-start); }
        .bw-notice.is-info { color: var(--text-secondary); }
        .bw-dot {
          width: 6px; height: 6px; border-radius: 50%;
          background: var(--text-faint);
          flex-shrink: 0;
          transition: background 0.2s var(--bw-theme);
        }
        .bw-frame[data-phase="manifest"]    .bw-dot { background: var(--text-secondary); }
        .bw-frame[data-phase="dispatched"]  .bw-dot { background: var(--accent-start); animation: bw-pulse 1.6s ease-in-out infinite; }
        .bw-frame[data-phase="delivered"]   .bw-dot { background: var(--accent-start); }
        .bw-title {
          font-family: 'Syne', sans-serif;
          font-size: 13px;
          font-weight: 700;
          color: var(--text-primary);
          min-width: 0;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .bw-state { font-size: 11px; font-weight: 500; color: var(--text-muted); white-space: nowrap; }
        .bw-meta {
          margin-left: auto;
          font-size: 11px;
          color: var(--text-muted);
          font-variant-numeric: tabular-nums;
          white-space: nowrap;
        }
        .bw-notice {
          margin-left: auto;
          font-size: 11.5px;
          line-height: 1.4;
          color: var(--brand-red);
          text-align: right;
          min-width: 0;
        }

        /* ── Region B — the desk: one frame, one hairline ──
           Two panes share the frame and nothing else does: the story pane
           (left) narrates the job — dock → runner → receipt — and the
           ledger pane (right) holds what the user decides. Exactly ONE
           vertical hairline separates them (the structure rule); no
           stacked horizontal border-bottoms anywhere in the desk. */
        .bw-stage {
          display: grid;
          grid-template-columns: 1fr;
          min-height: 450px;
        }
        .bw-stage.bw-split { grid-template-columns: minmax(0, 1fr) minmax(0, 400px); }
        .bw-pane { position: relative; min-width: 0; min-height: 0; }
        .bw-pane-story {
          display: flex;
          flex-direction: column;
          cursor: pointer;
          outline: none;
        }
        .bw-pane-story[data-busy='true'] { cursor: default; }
        .bw-stage.bw-split .bw-pane-story { border-right: 1px solid var(--divider); }
        .bw-pane-story:focus-visible { outline: 2px solid var(--accent-start); outline-offset: -2px; }
        .bw-pane-ledger { display: flex; flex-direction: column; }

        /* story pane — the intake invite: hero before a stack, compact
           after (sizes tighten, the same elements persist). */
        .bw-floor {
          flex: 1 1 auto;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          gap: 7px;
          text-align: center;
          padding: 34px 26px;
          animation: bw-enter 240ms var(--bw-ease) both;
        }
        .bw-stage[data-stack='true'] .bw-floor { padding: 26px 22px; }
        .bw-stage[data-stack='true'] .bw-floor-title { font-size: 15px; }
        .bw-stage[data-stack='true'] .bw-floor-sub { font-size: 11.5px; }

        /* ── The receiving dock — three specimen plates ──
           The module's actual material (a mixed pile: image, PDF, DOC),
           fanned like checked-in documents — not a card, not a dashed
           dropzone. On drag-over the fan spreads: the pile separating
           toward each plate's own route. On reject the plates read red. */
        .bw-dock {
          position: relative;
          width: 200px;
          height: 106px;
          margin: 4px auto 16px;
          flex-shrink: 0;
        }
        .bw-plate {
          position: absolute;
          top: 50%;
          left: 50%;
          width: 58px;
          height: 72px;
          display: flex;
          align-items: center;
          justify-content: center;
          background: var(--bg-item);
          border: 1px solid var(--border-base);
          border-radius: 8px;
          box-shadow: var(--shadow-card);
          color: var(--text-faint);
          transition:
            transform 0.36s var(--bw-spring),
            color 0.2s var(--bw-ease),
            border-color 0.35s var(--bw-theme),
            background-color 0.35s var(--bw-theme);
        }
        /* document header lines: each plate reads as a document, not a card */
        .bw-plate::before,
        .bw-plate::after {
          content: '';
          position: absolute;
          top: 9px;
          left: 10px;
          right: 10px;
          height: 2px;
          border-radius: 1px;
          background: currentColor;
          opacity: 0.4;
        }
        .bw-plate::after { top: 14px; right: 20px; opacity: 0.25; }
        .bw-plate-1 { transform: translate(-50%, -50%) rotate(-9deg) translateX(-44px); z-index: 1; }
        .bw-plate-2 { transform: translate(-50%, -52%) rotate(0deg) translateX(0); z-index: 3; transition-delay: 40ms; }
        .bw-plate-3 { transform: translate(-50%, -48%) rotate(9deg) translateX(44px); z-index: 2; transition-delay: 80ms; }
        .bw-frame.drag .bw-plate {
          color: var(--accent-start);
          border-color: color-mix(in srgb, var(--accent-start) 45%, var(--border-base));
        }
        .bw-frame.drag .bw-plate-1 { transform: translate(-50%, -50%) rotate(-14deg) translateX(-56px) translateY(-3px); }
        .bw-frame.drag .bw-plate-2 { transform: translate(-50%, -54%) rotate(0deg) translateY(-9px); }
        .bw-frame.drag .bw-plate-3 { transform: translate(-50%, -48%) rotate(14deg) translateX(56px) translateY(-3px); }
        .bw-frame.reject .bw-plate {
          color: var(--brand-red);
          border-color: color-mix(in srgb, var(--brand-red) 45%, var(--border-base));
        }
        .bw-floor-title {
          font-family: 'Syne', sans-serif;
          font-size: 17px;
          font-weight: 700;
          color: var(--text-primary);
        }
        .bw-floor-sub {
          font-size: 12.5px;
          line-height: 1.55;
          color: var(--text-muted);
          max-width: 48ch;
        }
        .bw-floor-formats {
          margin-top: 12px;
          font-size: 9.5px;
          font-weight: 600;
          letter-spacing: 1.4px;
          color: var(--text-faint);
        }

        /* compact dock: the plate fan eases down once the manifest is live,
           the invite yields the pane's centre to the message */
        .bw-stage[data-stack='true'] .bw-dock {
          transform: scale(0.78);
          height: 84px;
          margin: 0 auto 12px;
        }

        /* ── The runner — the run narrated in the story pane ──
           While dispatching, the left pane swaps the invite for the honest
           readout: the house sphere (indeterminate by design), the "5
           parallel lanes" copy and the elapsed clock. No percentage. */
        .bw-run {
          flex: 1 1 auto;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          gap: 6px;
          text-align: center;
          padding: 30px 24px;
          animation: bw-enter 240ms var(--bw-ease) both;
        }
        .bw-yard-globe {
          display: flex;
          flex-shrink: 0;
          color: var(--accent-start);
          margin-bottom: 6px;
        }
        .bw-run-title {
          font-size: 12.5px;
          font-weight: 600;
          color: var(--text-primary);
          font-variant-numeric: tabular-nums;
        }
        .bw-run-sub { font-size: 11px; color: var(--text-muted); line-height: 1.5; max-width: 36ch; }

        /* ── The delivery receipt — real facts from the blob, receipt-coded.
           It lives in the story pane: the job's third act, centered where
           the dock and the runner stood. ── */
        .bw-slip-wrap {
          flex: 1 1 auto;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 26px 24px;
          animation: bw-enter 240ms var(--bw-ease) both;
        }
        .bw-slip-card {
          display: flex;
          flex-direction: column;
          gap: 11px;
          width: 100%;
          max-width: 300px;
          background: var(--bg-item);
          border-left: 2px solid var(--brand-yellow);
          border-radius: 12px;
          padding: 16px;
          text-align: left;
        }
        .bw-slip-title-row { display: flex; align-items: center; gap: 10px; }
        .bw-slip-icon {
          width: 32px; height: 32px; border-radius: 50%; flex-shrink: 0;
          border: 1.5px solid var(--accent-start);
          color: var(--accent-start);
          display: flex; align-items: center; justify-content: center;
        }
        /* completion reads as arrival: the check draws itself, once */
        .bw-slip-check path {
          stroke-dasharray: 24;
          stroke-dashoffset: 24;
          animation: bw-draw 320ms var(--bw-ease) 120ms forwards;
        }
        .bw-slip-title {
          font-family: 'Syne', sans-serif;
          font-size: 13px;
          font-weight: 700;
          color: var(--text-primary);
          margin: 0;
        }
        .bw-slip-sub { font-size: 11.5px; line-height: 1.55; color: var(--text-secondary); margin: 0; }
        .bw-slip-dl { justify-content: center; padding: 8px 12px; font-size: 11.5px; }
        .bw-mono { font-family: ui-monospace, monospace; font-size: 10.5px; }

        /* ── The tally — a quiet meta strip, the tool's yellow edge-code ── */
        .bw-tally {
          display: flex;
          align-items: center;
          flex-wrap: wrap;
          gap: 6px 14px;
          padding: 11px 18px;
          font-size: 11.5px;
          color: var(--text-muted);
          font-variant-numeric: tabular-nums;
          box-shadow: inset 2px 0 0 var(--brand-yellow);
          flex-shrink: 0;
        }
        .bw-tally b { color: var(--text-primary); font-weight: 600; }
        .bw-tally-caution {
          flex-basis: 100%;
          font-size: 11px;
          color: var(--brand-red);
        }
        .bw-stamp {
          margin-left: auto;
          font-family: 'Syne', sans-serif;
          font-size: 9.5px;
          font-weight: 700;
          letter-spacing: 1.2px;
          text-transform: uppercase;
          color: var(--accent-start);
          border: 1.5px solid var(--accent-start);
          border-radius: 4px;
          padding: 2px 7px;
          transform: rotate(-2deg);
          animation: bw-overprint 300ms var(--bw-spring) both;
        }

        /* ── The ledger — grouped, scrollable, borderless rows ──
           Rows group by BACKGROUND, never by borders inside the frame
           (the box-in-box read the old sub-cards gave). */
        .bw-ledger {
          flex: 1 1 auto;
          min-height: 0;
          max-height: 400px;
          overflow-y: auto;
          padding: 8px 16px 12px;
          scrollbar-width: thin;
          scrollbar-color: var(--border-base) transparent;
          transition: opacity 0.2s var(--bw-theme);
        }
        .bw-ledger::-webkit-scrollbar { width: 4px; }
        .bw-ledger::-webkit-scrollbar-thumb { background: var(--border-base); border-radius: 4px; }
        .bw-frame[data-phase="dispatched"] .bw-ledger { opacity: 0.6; }

        .bw-group { display: flex; flex-direction: column; gap: 6px; padding-top: 12px; }
        .bw-group-head { display: flex; align-items: center; gap: 8px; min-height: 24px; }
        .bw-group-label {
          font-family: 'Syne', sans-serif;
          font-size: 10px;
          font-weight: 700;
          letter-spacing: 1.1px;
          text-transform: uppercase;
          color: var(--text-faint);
        }
        .bw-group-count { font-size: 10px; color: var(--text-muted); font-variant-numeric: tabular-nums; }
        .bw-group-route { margin-left: auto; display: flex; align-items: center; gap: 5px; position: relative; }
        .bw-group-pre { font-size: 10px; color: var(--text-faint); }
        .bw-group-select {
          appearance: none; -webkit-appearance: none;
          background: transparent;
          border: none;
          font-family: inherit;
          font-size: 11px;
          font-weight: 600;
          color: var(--text-muted);
          cursor: pointer;
          padding: 4px 15px 4px 0;
          outline: none;
          border-radius: 4px;
          transition: color 0.14s;
        }
        .bw-group-select:hover:not(:disabled) { color: var(--text-primary); }
        .bw-group-select:focus-visible { outline: 2px solid var(--accent-start); outline-offset: 2px; }
        .bw-group-select:disabled { opacity: 0.55; cursor: default; }
        .bw-group-caret {
          position: absolute; right: 0; top: 50%;
          transform: translateY(-50%);
          display: flex; color: var(--text-faint); pointer-events: none;
        }

        /* manifest row — numbered like real ledger entries (dispatch order).
           One quiet line per file; the route lives in the group head.
           The row groups by background alone; no border inside the frame. */
        .bw-row {
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 9px 10px 9px 11px;
          background: var(--bg-item);
          border-radius: 8px;
          animation: bw-row-in 200ms var(--bw-ease) both;
          transition: background-color 0.35s var(--bw-theme);
        }
        .bw-row:hover { background: var(--bg-item-hover); }
        .bw-row-num {
          flex-shrink: 0;
          min-width: 17px;
          font-size: 10px;
          font-weight: 600;
          letter-spacing: 0.4px;
          color: var(--text-ghost);
          font-variant-numeric: tabular-nums;
          text-align: right;
        }
        .bw-row-type { display: flex; align-items: center; gap: 6px; color: var(--text-faint); flex-shrink: 0; }
        .bw-row-type-label {
          font-size: 9px;
          font-weight: 700;
          letter-spacing: 0.6px;
          text-transform: uppercase;
          color: var(--text-faint);
        }
        .bw-row-name {
          font-size: 12.5px;
          font-weight: 500;
          color: var(--text-primary);
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
          flex: 1;
          min-width: 0;
        }
        .bw-row-size { font-size: 10.5px; color: var(--text-muted); flex-shrink: 0; font-variant-numeric: tabular-nums; }

        .bw-group-select option  { background: var(--bg-card); color: var(--text-primary); }

        /* remove */
        .bw-row-remove {
          width: 26px; height: 26px; border-radius: 7px; flex-shrink: 0;
          background: transparent;
          border: 1px solid transparent;
          display: flex; align-items: center; justify-content: center;
          color: var(--text-muted);
          cursor: pointer;
          transition: color 0.14s, border-color 0.14s;
        }
        .bw-row-remove:hover:not(:disabled) { color: var(--brand-red); border-color: var(--brand-red); }
        .bw-row-remove:disabled { opacity: 0.5; cursor: default; }
        .bw-row-remove:focus-visible { outline: 2px solid var(--accent-start); outline-offset: 2px; }

        /* ── Region C — actions, pinned to the ledger pane's floor ──
           One dashed structural rule above; the primary action grows, so
           the dispatch reads as the pane's main event. */
        .bw-actions {
          display: flex;
          align-items: center;
          gap: 8px;
          flex-wrap: wrap;
          padding: 12px 16px 16px;
          border-top: 1px dashed var(--divider);
          flex-shrink: 0;
        }
        .bw-grow { flex: 1 1 210px; }
        .bw-grow > .bw-face { justify-content: center; }

        .bw-btn {
          display: inline-flex;
          align-items: center;
          gap: 7px;
          font-family: inherit;
          font-size: 12.5px;
          font-weight: 600;
          padding: 9px 16px;
          border-radius: 8px;
          border: 1px solid transparent;
          cursor: pointer;
          transition: background-color 0.15s var(--bw-theme), color 0.15s var(--bw-theme),
                      border-color 0.15s var(--bw-theme), transform 0.12s var(--bw-ease),
                      box-shadow 0.2s var(--bw-ease);
        }
        .bw-btn:focus-visible { outline: 2px solid var(--accent-start); outline-offset: 2px; }
        .bw-btn:active:not(:disabled) { transform: translateY(1px); }
        .bw-btn:disabled { opacity: 0.55; cursor: default; }

        .bw-btn-primary {
          background: var(--accent-start);
          color: var(--bw-ink);
          font-family: 'Syne', sans-serif;
          font-weight: 700;
          box-shadow: 0 2px 10px color-mix(in srgb, var(--accent-start) 28%, transparent);
        }
        .bw-btn-primary:hover:not(:disabled) {
          background: var(--accent-end);
          transform: translateY(-1px);
          box-shadow: 0 8px 22px color-mix(in srgb, var(--accent-start) 36%, transparent);
        }

        /* the two-face morph: idle and busy stack in one grid cell, so the
           label change never reflows the action bar; busy keeps full colour
           under the running sphere instead of dimming to a grey husk */
        .bw-btn-morph { display: inline-grid; place-items: center; }
        .bw-btn-morph[data-busy='true'] {
          opacity: 1;
          cursor: progress;
          box-shadow: 0 2px 10px color-mix(in srgb, var(--accent-start) 28%, transparent);
        }
        .bw-face {
          grid-area: 1 / 1;
          display: inline-flex;
          align-items: center;
          gap: 7px;
          white-space: nowrap;
          transition: opacity 0.2s var(--bw-ease), transform 0.3s var(--bw-spring), filter 0.2s var(--bw-ease);
        }
        .bw-face-busy { opacity: 0; transform: scale(0.8); filter: blur(2px); pointer-events: none; }
        .bw-btn-morph[data-busy='true'] .bw-face-idle { opacity: 0; transform: scale(0.8); filter: blur(2px); }
        .bw-btn-morph[data-busy='true'] .bw-face-busy { opacity: 1; transform: none; filter: none; }

        .bw-btn-quiet {
          background: transparent;
          border-color: var(--border-base);
          color: var(--text-secondary);
        }
        .bw-btn-quiet:hover:not(:disabled) {
          background: var(--bg-item-hover);
          border-color: var(--border-item, var(--border-base));
          color: var(--text-primary);
        }
        .bw-btn-quiet.bw-btn-danger:hover:not(:disabled) {
          color: var(--brand-red);
          border-color: var(--brand-red);
        }

        /* ── Responsive ── */
        @media (max-width: 860px) {
          .bw-stage.bw-split { grid-template-columns: 1fr; min-height: 0; }
          .bw-stage.bw-split .bw-pane-story {
            border-right: none;
            border-bottom: 1px solid var(--divider);
          }
          .bw-stage.bw-split .bw-ledger { max-height: 320px; }
        }
        @media (max-width: 640px) {
          .bw-meta { display: none; }
          .bw-stage { min-height: 360px; }
          .bw-floor { padding: 26px 18px 22px; }
          .bw-dock { transform: scale(0.82); height: 90px; margin: 0 auto 10px; }
          .bw-head { padding: 12px 16px 8px; }
          .bw-tally { padding: 10px 16px; }
          .bw-actions { padding: 10px 14px 14px; }
        }

        /* ── Reduced motion: stamps and stagger collapse to plain fades,
              the dock plates snap between poses, the sphere renders its own
              static frame, the check renders complete, the collapse becomes
              instant. ── */
        @media (prefers-reduced-motion: reduce) {
          .bw-row, .bw-floor, .bw-run, .bw-slip-wrap { animation: none; }
          .bw-stamp { animation: none; }
          .bw-plate { transition: none; }
          .bw-face { transition: none; }
          .bw-btn:active:not(:disabled) { transform: none; }
          .bw-slip-check path { animation: none; stroke-dashoffset: 0; }
          .bw-dot { animation: none !important; }
        }
      `}</style>

      <div className="bw">
        <div
          className={`bw-frame ${isDragActive && !isDragReject ? 'drag' : ''} ${isDragReject ? 'reject' : ''}`}
          data-phase={phase}
        >

          {/* ── Region A — header strip ── */}
          <header className={`bw-head ${notice ? (notice.tone === 'error' ? 'notice' : 'notice-info') : ''}`}>
            <span className="bw-dot" aria-hidden="true" />
            <span className="bw-title">
              {hasStack ? 'Manifest' : 'Ready'}
              {stateSuffix && <span className="bw-state">{stateSuffix}</span>}
            </span>
            {notice ? (
              <span
                className={`bw-notice${notice.tone === 'info' ? ' is-info' : ''}`}
                role={notice.tone === 'error' ? 'alert' : 'status'}
              >
                {notice.text}
              </span>
            ) : (
              <span className="bw-meta" role="status">{headerMeta}</span>
            )}
          </header>

          {/* ── Region B — the desk: story pane ⇄ ledger pane ──
              one frame, one hairline; the story pane is the dropzone */}
          <div className={`bw-stage ${hasStack ? 'bw-split' : ''}`} data-stack={hasStack ? 'true' : 'false'}>

            {/* story pane — the dropzone root: dock → runner → receipt */}
            <div
              {...getRootProps({
                className: 'bw-pane bw-pane-story',
                role: 'button',
                tabIndex: 0,
                'aria-label': stageLabel,
                'data-busy': loading ? 'true' : 'false',
              })}
            >
              <input {...getInputProps()} />

              {/* intake invite — hero before a stack, compact after; the
                  same elements persist, only their scale and copy change */}
              {!loading && !delivery && (
                <div className="bw-floor">
                  <div className="bw-dock" aria-hidden="true">
                    <span className="bw-plate bw-plate-1">{G.img(15)}</span>
                    <span className="bw-plate bw-plate-2">{G.pdf(17)}</span>
                    <span className="bw-plate bw-plate-3">{G.doc(15)}</span>
                  </div>
                  <p className="bw-floor-title">
                    {isDragReject
                      ? 'Those types have no route here'
                      : isDragActive
                        ? 'Release to add the stack'
                        : hasStack
                          ? 'Add more files'
                          : 'Bring the whole stack'}
                  </p>
                  <p className="bw-floor-sub">
                    {isDragReject
                      ? 'Images, PDFs and DOCX files only.'
                      : isDragActive
                        ? 'Each file keeps its own route.'
                        : hasStack
                          ? 'Drop, click or paste — the manifest updates on the right.'
                          : 'Images, PDFs and Word documents — mixed is fine. Each file is routed to its own process; everything returns in one archive.'}
                  </p>
                  <p className="bw-floor-formats">JPG · PNG · WEBP · GIF · BMP · PDF · DOCX</p>
                </div>
              )}

              {/* the runner — honest run state, no fabricated progress */}
              {loading && (
                <div className="bw-run" role="status">
                  <span className="bw-yard-globe" aria-hidden="true">
                    <KineticSphere size={40} points={64} />
                  </span>
                  <span className="bw-run-title">Dispatched — 5 parallel lanes · {elapsed}s</span>
                  <span className="bw-run-sub">
                    Results arrive inside one archive; a failed file rides home as <span className="bw-mono">*_error.txt</span>.
                  </span>
                </div>
              )}

              {/* the delivery receipt — the job's third act, same pane */}
              {!loading && delivery && (
                <div className="bw-slip-wrap">
                  <div className="bw-slip-card" role="status">
                    <div className="bw-slip-title-row">
                      <span className="bw-slip-icon" aria-hidden="true">
                        <svg className="bw-slip-check" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                          <polyline points="20 6 9 17 4 12" />
                        </svg>
                      </span>
                      <p className="bw-slip-title">Batch delivered</p>
                    </div>
                    <p className="bw-slip-sub">
                      {delivery.count} file{delivery.count > 1 ? 's' : ''} processed in {delivery.seconds}s —
                      archive {formatSize(delivery.sizeBytes)} (<span className="bw-mono">{delivery.name}</span>).
                      Any file that failed is inside as <span className="bw-mono">*_error.txt</span>.
                    </p>
                    <button type="button" className="bw-btn bw-btn-quiet bw-slip-dl" onClick={downloadAgain}>
                      {Ic.download} Download again
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* ledger pane — what the user decides */}
            {hasStack && (
              <div className="bw-pane bw-pane-ledger">
                {/* the ledger — grouped, borderless rows, the routing stamp */}
                <div className="bw-ledger" aria-label="File manifest">
                  {groups.map(g => {
                    const ops = operationsForType(g.type)
                    const uniform = g.tasks.every(t => t.operation === g.tasks[0].operation)
                    return (
                      <section className="bw-group" key={g.type}>
                        <div className="bw-group-head">
                          <span className="bw-group-label">{g.label}</span>
                          <span className="bw-group-count">{g.tasks.length}</span>
                          <span className="bw-group-route">
                            <span className="bw-group-pre">route all</span>
                            <select
                              className="bw-group-select"
                              aria-label={`Route all ${g.label.toLowerCase()}`}
                              value={uniform ? g.tasks[0].operation : '__mixed'}
                              onChange={e => routeAll(g.type, e.target.value)}
                              disabled={loading}
                            >
                              {!uniform && <option value="__mixed" disabled>mixed</option>}
                              {ops.map(op => (
                                <option key={op.value} value={op.value}>{op.label}</option>
                              ))}
                            </select>
                            <span className="bw-group-caret" aria-hidden="true">{Ic.chevron}</span>
                          </span>
                        </div>

                        {g.tasks.map(task => {
                          const type = getFileType(task.file)
                          return (
                            <div
                              key={task.id}
                              className="bw-row"
                              style={{ animationDelay: `${Math.min(task.stagger, 12) * 40}ms` }}
                            >
                              <span className="bw-row-num" aria-hidden="true">
                                {String(orderById.get(task.id) ?? 0).padStart(2, '0')}
                              </span>
                              <span className="bw-row-type">
                                {type === 'pdf' ? G.pdf(13) : type === 'image' ? G.img(13) : G.doc(13)}
                                <span className="bw-row-type-label">{typeLabel(task.file)}</span>
                              </span>
                              <span className="bw-row-name" title={task.file.name}>{task.file.name}</span>
                              <span className="bw-row-size">{formatSize(task.file.size)}</span>
                              <button
                                type="button"
                                className="bw-row-remove"
                                onClick={() => removeTask(task.id)}
                                aria-label={`Remove ${task.file.name}`}
                                disabled={loading}
                              >
                                {Ic.close}
                              </button>
                            </div>
                          )
                        })}
                      </section>
                    )
                  })}
                </div>

                {/* the tally — pre-flight truth against the ceiling */}
                <div className="bw-tally" aria-label="Manifest summary">
                  <span><b>{tasks.length}</b> file{tasks.length > 1 ? 's' : ''}</span>
                  {groups.map(g => (
                    <span key={g.type}><b>{g.tasks.length}</b> {g.label.toLowerCase()}</span>
                  ))}
                  <span><b>{formatSize(totalBytes)}</b> total</span>
                  <span>→ <b>one .zip</b></span>
                  {loading && <span className="bw-stamp">Dispatched</span>}
                  {overLimit && (
                    <span className="bw-tally-caution">
                      {formatSize(totalBytes - MAX_TOTAL_BYTES)} over the 100 MB upload ceiling — remove files before dispatching.
                    </span>
                  )}
                </div>

                {/* region C — actions, pinned to the pane's floor */}
                <footer className="bw-actions">
                  <button
                    type="button"
                    className="bw-btn bw-btn-primary bw-btn-morph bw-grow"
                    data-busy={loading}
                    aria-busy={loading || undefined}
                    onClick={startBatch}
                    disabled={loading || overLimit}
                  >
                    <span className="bw-face bw-face-idle">
                      {Ic.archive} Dispatch {tasks.length} file{tasks.length > 1 ? 's' : ''} → one archive
                    </span>
                    <span className="bw-face bw-face-busy" aria-hidden="true">
                      <KineticSphere size={13} points={30} /> Dispatching…
                    </span>
                  </button>
                  {loading && (
                    <button
                      type="button"
                      className="bw-btn bw-btn-quiet"
                      onClick={cancelDispatch}
                    >
                      {Ic.close} Cancel
                    </button>
                  )}
                  <button
                    type="button"
                    className="bw-btn bw-btn-quiet bw-btn-danger"
                    onClick={clearAll}
                    disabled={loading}
                  >
                    {Ic.close} Clear all
                  </button>
                </footer>
              </div>
            )}
          </div>

        </div>
      </div>
    </>
  )
}
