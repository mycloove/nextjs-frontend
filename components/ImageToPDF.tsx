'use client'

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from 'react'
import { useDropzone } from 'react-dropzone'

/* FLIP measures and repaints in a layout effect on the client, but this client
   component is still server-rendered (ToolWorkspace mounts it through
   `dynamic()`), where `useLayoutEffect` warns. Alias to `useEffect` on the
   server so the SSR pass is warning-free; the effect is a no-op there anyway
   because there are no tiles to measure yet. */
const useIsomorphicLayoutEffect = typeof window !== 'undefined' ? useLayoutEffect : useEffect
import { uploadWithProgress, getApiErrorMessage } from '@/lib/upload/uploadWithProgress'
import { usePasteFiles } from '@/lib/upload/usePasteFiles'
import { downloadBlob } from '@/lib/download/downloadOutputs'
import { addRecentConversion } from '@/lib/history/recentConversions'

/* ─────────────────────────────────────────────────────────────
   Images → PDF — "The Light Table"

   Design concept: this tool's single job is binding loose images
   into one ordered document, exactly like a photographer laying
   prints on a light table before sending the job to print. The
   UI is that table: pages lie on it in true proportions, carry
   contact-sheet frame numbers (which ARE the future page numbers
   — entries order == FormData order == page order), and get
   pressed into a stack ("collated") while binding.

   Honesty notes this rewrite fixes (the old UI lied in places):
   - Square thumbnails with object-fit: cover implied a square
     crop. Every image is embedded uncropped, so the tiles show
     true-ratio pages and never crop. Page size is now a real
     choice: "Original" gives each image a page at its own
     dimensions; A4/Letter fit the whole image inside a print
     margin — never a crop.
   - The size story is now stated, not implied. The route enforces
     25 MB per image, 100 MB total and 100 images, and the browser
     refuses an oversized set before any upload begins.
     Photographs are re-compressed to JPEG; an already-upright
     JPEG within the size ceiling is embedded untouched.
   - The download name is derived from the first page instead of a
     meaningless `SmilePDF_<timestamp>`.
   - alert() is gone; errors surface inline and the pages stay on
     the table for retry.

   Everything is scoped to this file via the `i2p-` namespace and
   consumes only surface-1 global tokens (var(--bg-item), …) plus
   local `--i2p-*` pairs defined in both theme blocks below. The
   identity colour is a darkroom-amber "safelight" — this surface's
   own device, not the house coral gradient, and independent of the
   shared card icon, which now carries the Convert tone.

   Interaction pass: the surface now owns its own instrument header
   (the workspace heading row is retired via ToolWorkspace's
   `hideHeading`). Prints are lifted and re-slotted by direct
   manipulation: a paper ghost follows the cursor while the table
   resplices live (insert-and-shift, the merge-pdf tray semantics), so
   the order seen during the drag is the order that ships and the page
   numbers renumber as you move. A FLIP settle rides each reflow, and
   the chevron buttons stay as the keyboard path so no capability
   depends on the pointer. A press that does not clear the drag
   threshold opens an examine overlay instead. The one working mark is a
   Double Helix ported from
   the LoaderUI reference set — a bound coil, which is literally this
   tool's job, so the loader and the bind press are one device and not
   a second signature. It is indeterminate only: the real XHR byte
   percentage is untouched and remains the only progress this tool
   claims.
   ───────────────────────────────────────────────────────────── */

type Phase = 'editing' | 'binding' | 'bound'
type CropPosition = 'bottom' | 'bottom-right' | 'custom'
type PageSize = 'original' | 'a4' | 'letter'
type Quality = 'high' | 'balanced' | 'small'

interface Entry {
  id: string
  file: File
  url: string
  w: number
  h: number
}

/* ── Tiny inline SVG icons (no external deps) ── */
const Icon = {
  image: (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <circle cx="8.5" cy="8.5" r="1.5" />
      <polyline points="21 15 16 10 5 21" />
    </svg>
  ),
  scissors: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="6" cy="6" r="3" /><circle cx="6" cy="18" r="3" />
      <line x1="20" y1="4" x2="8.12" y2="15.88" />
      <line x1="14.47" y1="14.48" x2="20" y2="20" />
      <line x1="8.12" y1="8.12" x2="12" y2="12" />
    </svg>
  ),
  trash: (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="3 6 5 6 21 6" /><path d="M19 6l-1 14H6L5 6" />
      <path d="M10 11v6M14 11v6M9 6V4h6v2" />
    </svg>
  ),
  close: (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
      <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  ),
  chevronLeft: (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="15 18 9 12 15 6" />
    </svg>
  ),
  chevronRight: (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="9 18 15 12 9 6" />
    </svg>
  ),
  arrowRight: (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="4" y1="12" x2="19" y2="12" /><polyline points="13 6 19 12 13 18" />
    </svg>
  ),
  check: (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  ),
  alert: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
      <line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" />
    </svg>
  ),
  page: (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M6 3h8l5 5v13a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z" />
      <polyline points="14 3 14 8 19 8" />
      <line x1="8.5" y1="13" x2="15.5" y2="13" /><line x1="8.5" y1="17" x2="13" y2="17" />
    </svg>
  ),
  download: (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 3v12" /><polyline points="7 11 12 16 17 11" />
      <path d="M4 20h16" />
    </svg>
  ),
  info: (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="9" /><line x1="12" y1="11" x2="12" y2="16" />
      <line x1="12" y1="8" x2="12.01" y2="8" />
    </svg>
  ),
}

/* ── Small formatting helpers ── */
const fmtSize = (b: number) =>
  b >= 1048576 ? `${(b / 1048576).toFixed(1)} MB`
  : b >= 1024 ? `${Math.max(1, Math.round(b / 1024))} KB`
  : `${b} B`

const typeLabel = (f: File) => {
  const ext = f.name.split('.').pop()?.toLowerCase() ?? ''
  const map: Record<string, string> = {
    jpg: 'JPG', jpeg: 'JPEG', png: 'PNG', webp: 'WEBP', gif: 'GIF', bmp: 'BMP',
  }
  return map[ext] ?? 'IMAGE'
}

/* Mirrors the route's defaults (app/api/image-to-pdf/route.ts). Kept in sync
   so an oversized set is refused in the browser, before any upload begins. */
const MAX_IMAGES = 100
const MAX_FILE_MB = 25
const MAX_TOTAL_MB = 100

const PAGE_SIZE_LABELS: Record<PageSize, string> = {
  original: 'Original',
  a4: 'A4',
  letter: 'Letter',
}

const QUALITY_LABELS: Record<Quality, string> = {
  high: 'High',
  balanced: 'Balanced',
  small: 'Small',
}

/* ── Crop helper (unchanged logic — the proven canvas trim) ── */
const cropImage = (
  file: File,
  position: CropPosition,
  pct: number,
  rightPx = 0,
  bottomPx = 0,
): Promise<File> =>
  new Promise((resolve, reject) => {
    const img = document.createElement('img') as HTMLImageElement
    const url = URL.createObjectURL(file)
    img.onload = () => {
      try {
        const { width: ow, height: oh } = img
        let cw = ow, ch = oh
        if (position === 'bottom') {
          ch = Math.floor(oh * (100 - pct) / 100)
        } else if (position === 'bottom-right') {
          ch = oh - Math.floor(oh * pct / 100)
          cw = ow - Math.floor(ow * pct / 100)
        } else {
          cw = Math.max(ow - rightPx, 10)
          ch = Math.max(oh - bottomPx, 10)
        }
        const canvas = document.createElement('canvas')
        canvas.width = cw; canvas.height = ch
        canvas.getContext('2d')?.drawImage(img, 0, 0, cw, ch, 0, 0, cw, ch)
        canvas.toBlob(blob => {
          URL.revokeObjectURL(url)
          if (!blob) { reject(new Error('Could not trim image')); return }
          resolve(new File([blob], file.name, { type: file.type, lastModified: Date.now() }))
        }, file.type)
      } catch (e) { reject(e instanceof Error ? e : new Error('Could not trim image')) }
    }
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Could not read image')) }
    img.src = url
  })

/* ── The bound-document mark for the success state ──
   Three stacked paper pages + an amber binding spine: the
   closing beat of the light-table metaphor. */
const BoundDoc = () => (
  <svg className="i2p-bound-mark" width="52" height="52" viewBox="0 0 52 52" fill="none" aria-hidden="true">
    <rect x="12" y="6" width="28" height="38" rx="3" fill="var(--i2p-mark-back)" stroke="var(--i2p-mark-line)" />
    <rect x="16" y="10" width="28" height="38" rx="3" fill="#ffffff" stroke="var(--i2p-mark-line)" />
    <line x1="22" y1="19" x2="38" y2="19" stroke="var(--i2p-mark-text)" strokeWidth="2" strokeLinecap="round" />
    <line x1="22" y1="25" x2="36" y2="25" stroke="var(--i2p-mark-text)" strokeWidth="2" strokeLinecap="round" />
    <line x1="22" y1="31" x2="38" y2="31" stroke="var(--i2p-mark-text)" strokeWidth="2" strokeLinecap="round" />
    <line x1="22" y1="37" x2="33" y2="37" stroke="var(--i2p-mark-text)" strokeWidth="2" strokeLinecap="round" />
    <rect x="10" y="10" width="6" height="38" rx="3" fill="var(--i2p-bind-bg)" />
  </svg>
)

/* ── The working mark: a Double Helix ──
   Ported from the LoaderUI reference set (`loader-4-double-helix.html`): two
   counter-phased dot-strands weaving down each hairline. Chosen because this
   tool's own job is *binding* loose pages into one spine, and a helix is
   literally a bound coil — so the loader and the bind press are one device,
   not a second signature (Astrolabe: one signature per surface). It draws in
   `currentColor` (no second palette, no bare hex) and is `aria-hidden`: the
   parent control already speaks its state in text. Indeterminate only — it
   never carries a percentage. Its reduced-motion poster is the shared
   `.i2p` branch below, which freezes it to a static strand pair. */
const I2PHelix = ({ size = 18, className = '' }: { size?: number; className?: string }) => (
  <span
    className={`i2p-helix${className ? ` ${className}` : ''}`}
    style={{ width: size, height: size }}
    aria-hidden="true"
  >
    {[0, 1, 2, 3, 4].map(n => (
      <u key={n} style={{ '--n': n } as CSSProperties} />
    ))}
  </span>
)

export default function ImageToPDF() {
  const [entries, setEntries] = useState<Entry[]>([])
  const [phase, setPhase] = useState<Phase>('editing')
  const [error, setError] = useState<string | null>(null)
  // Ids whose entrance animation has finished — used to drop the
  // `--new` class so the stagger never replays (e.g. when the
  // binding press animation is removed after an error).
  const [settled, setSettled] = useState<Set<string>>(new Set())

  // Watermark / edge-trim state — behaviour identical to before
  const [autoCrop, setAutoCrop] = useState(false)
  const [cropPosition, setCropPosition] = useState<CropPosition>('bottom-right')
  const [cropPercentage, setCropPercentage] = useState(10)
  const [customWidth, setCustomWidth] = useState(200)
  const [customHeight, setCustomHeight] = useState(80)
  // Output shape — additive to the page-order promise. Defaults keep the
  // original "one page per image at its own size" behaviour.
  const [pageSize, setPageSize] = useState<PageSize>('original')
  const [quality, setQuality] = useState<Quality>('balanced')

  // Upload progress + cancellation — real byte progress from the XHR bridge.
  const [progress, setProgress] = useState<number | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  // Interaction state: direct-manipulation reorder + the examine overlay.
  const [dragId, setDragId] = useState<string | null>(null)
  const [ghost, setGhost] = useState<{ id: string; w: number; h: number; x: number; y: number } | null>(null)
  const [previewId, setPreviewId] = useState<string | null>(null)
  // The finished PDF is held in state, not pushed to disk: the user saves it
  // when they choose and can leave the bound view and return without binding
  // again. These three describe the last successful bind, not the live table.
  const [boundBlob, setBoundBlob] = useState<Blob | null>(null)
  const [boundFileName, setBoundFileName] = useState('')
  const [boundPages, setBoundPages] = useState(0)
  const [boundBytes, setBoundBytes] = useState(0)
  const dragRef = useRef<{ id: string; x0: number; y0: number; active: boolean } | null>(null)
  const ghostRef = useRef<HTMLDivElement | null>(null)
  const grabRef = useRef({ x: 0, y: 0 })
  const tileRefs = useRef(new Map<string, HTMLDivElement>())
  const rectRef = useRef(new Map<string, DOMRect>())

  const idRef = useRef(0)

  /* ── Add files: filter, preview-URL, then read natural dims
     asynchronously so tiles can render true-ratio pages. ── */
  const addFiles = useCallback((list: File[]) => {
    const imgs = list.filter(f => f.type.startsWith('image/'))
    if (!imgs.length) return
    const fresh: Entry[] = imgs.map(file => ({
      id: `p${++idRef.current}`,
      file,
      url: URL.createObjectURL(file),
      w: 0, h: 0,
    }))
    setEntries(prev => [...prev, ...fresh])
    for (const e of fresh) {
      const probe = new Image()
      probe.onload = () => setEntries(prev =>
        prev.map(p => (p.id === e.id ? { ...p, w: probe.naturalWidth, h: probe.naturalHeight } : p)))
      probe.src = e.url
    }
  }, [])

  /* Ctrl+V support: pasted screenshots and copied images land on the table
     exactly like dropped ones. Only active while the table is editable. */
  usePasteFiles(addFiles, phase === 'editing')

  /* Pages may only join the table while it is editable — dropping
     mid-bind or on the "Bound" panel would silently add invisible
     pages to a job that is already in flight. */
  const onDrop = useCallback((accepted: File[]) => {
    if (phase === 'editing') addFiles(accepted)
  }, [phase, addFiles])

  /* noClick/noKeyboard: the whole module is the drag surface, but
     clicks must reach the tiles' own buttons (reorder / remove /
     trim) without opening the file picker. The empty zone and the
     Browse buttons call open() explicitly. */
  const { getRootProps, getInputProps, isDragActive, open } = useDropzone({
    onDrop,
    accept: { 'image/*': ['.jpeg', '.jpg', '.png', '.gif', '.bmp', '.webp'] },
    noClick: true,
    noKeyboard: true,
  })

  const move = (i: number, dir: -1 | 1) => {
    const j = i + dir
    if (j < 0 || j >= entries.length) return
    setEntries(prev => {
      const next = [...prev]
      const tmp = next[i]; next[i] = next[j]; next[j] = tmp
      return next
    })
  }

  const removeAt = (i: number) => {
    setEntries(prev => {
      URL.revokeObjectURL(prev[i].url)
      return prev.filter((_, idx) => idx !== i)
    })
  }

  const clearTable = () => {
    entries.forEach(e => URL.revokeObjectURL(e.url))
    setEntries([])
    setError(null)
  }

  /* ── Direct manipulation: lift a print and re-slot it, live ──
     Pointer events, not HTML5 DnD: the whole module is already a file-drop
     surface, and an internal HTML5 drag would fight it. The gesture mirrors the
     merge-pdf page tray — releasing over a slot splices the print into that
     position and every tile between moves by one — but applied *continuously*
     while the pointer travels, so the order seen during the drag is the order
     that ships, with the page numbers renumbering live. A paper ghost follows
     the cursor (the lift) and the origin slot opens as a dashed placeholder
     (the gap). Mouse only: touch keeps the chevron buttons so a vertical page
     scroll is never hijacked. A press that never clears the 6px threshold stays
     a click and opens the examine overlay instead. */
  const captureRects = () => {
    const m = new Map<string, DOMRect>()
    tileRefs.current.forEach((el, id) => m.set(id, el.getBoundingClientRect()))
    rectRef.current = m
  }

  const reorder = (from: number, to: number) => {
    if (from === to) return
    captureRects()
    setEntries(prev => {
      const next = [...prev]
      const [item] = next.splice(from, 1)
      next.splice(to, 0, item)
      return next
    })
  }

  /* FLIP: paint the old slot, then let the tile's own transform transition
     slide it to the new one (transform only; no layout thrash). Runs only when
     the order actually changed, because captureRects only runs on reorder. */
  useIsomorphicLayoutEffect(() => {
    const prev = rectRef.current
    if (!prev.size) return
    rectRef.current = new Map()
    tileRefs.current.forEach((el, id) => {
      const before = prev.get(id)
      if (!before) return
      const after = el.getBoundingClientRect()
      const dx = before.left - after.left
      const dy = before.top - after.top
      if (Math.abs(dx) < 1 && Math.abs(dy) < 1) return
      el.style.transition = 'none'
      el.style.transform = `translate(${dx}px, ${dy}px)`
      void el.offsetWidth
      el.style.transition = ''
      el.style.transform = ''
    })
  }, [entries])

  /* Keep the lifted paper under the cursor. Written straight to the node — the
     ghost moves on every pointer sample, so routing it through React state
     would re-render the table each frame for nothing. */
  const positionGhost = (clientX: number, clientY: number) => {
    const node = ghostRef.current
    if (!node) return
    node.style.transform = `translate3d(${clientX - grabRef.current.x}px, ${clientY - grabRef.current.y}px, 0) rotate(-2deg)`
  }

  const startDrag = (e: ReactPointerEvent<HTMLDivElement>, index: number) => {
    if (phase !== 'editing') return
    if (e.button !== 0) return
    if ((e.target as HTMLElement).closest('button')) return
    const entry = entries[index]
    if (!entry) return
    dragRef.current = { id: entry.id, x0: e.clientX, y0: e.clientY, active: false }
    // Only the mouse is captured. Touch/pen presses are still recorded so their
    // release opens the examine overlay, but they never capture the pointer —
    // that would hijack a vertical page scroll.
    if (e.pointerType === 'mouse') e.currentTarget.setPointerCapture(e.pointerId)
  }

  const onDragMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.pointerType !== 'mouse') return
    const d = dragRef.current
    if (!d) return
    if (!d.active) {
      if (Math.abs(e.clientX - d.x0) < 6 && Math.abs(e.clientY - d.y0) < 6) return
      // Lift: size the ghost from the very paper the user grabbed, so it is the
      // same print at the same scale, and record where within it they held it.
      const tileEl = tileRefs.current.get(d.id)
      const paper = tileEl?.querySelector('.i2p-page') as HTMLElement | null
      const rect = paper?.getBoundingClientRect()
      const w = rect?.width ?? 120
      const h = rect?.height ?? 160
      grabRef.current = rect
        ? { x: e.clientX - rect.left, y: e.clientY - rect.top }
        : { x: w / 2, y: h / 2 }
      d.active = true
      setDragId(d.id)
      setGhost({ id: d.id, w, h, x: e.clientX - grabRef.current.x, y: e.clientY - grabRef.current.y })
    }
    positionGhost(e.clientX, e.clientY)
    // Live splice: whichever slot the pointer is over becomes the drag's home,
    // and every tile between reflows by one. The ghost is pointer-transparent,
    // so the element under the cursor is always a real tile.
    const el = document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null
    const tile = el?.closest('[data-i2p-index]') as HTMLElement | null
    if (!tile?.dataset.i2pIndex) return
    const overIndex = Number(tile.dataset.i2pIndex)
    const currentIndex = entries.findIndex(x => x.id === d.id)
    if (currentIndex !== -1 && overIndex !== currentIndex) reorder(currentIndex, overIndex)
  }

  const endDrag = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = dragRef.current
    dragRef.current = null
    const el = e.currentTarget
    if (el.hasPointerCapture?.(e.pointerId)) el.releasePointerCapture(e.pointerId)
    if (!d) return
    if (d.active) {
      // The order is already correct (it was applied live) — just put the paper
      // down and close the gap.
      setDragId(null)
      setGhost(null)
    } else {
      // A press with no drag is a look, not a move — open the examine overlay.
      setPreviewId(d.id)
    }
  }

  /* A cancelled pointer (touch scroll taking over) is neither a move nor a
     look: drop the pending press without opening the overlay. */
  const cancelDrag = (e: ReactPointerEvent<HTMLDivElement>) => {
    dragRef.current = null
    setDragId(null)
    setGhost(null)
    const el = e.currentTarget
    if (el.hasPointerCapture?.(e.pointerId)) el.releasePointerCapture(e.pointerId)
  }

  /* Seat the lifted paper under the cursor the instant it mounts. After this,
     positionGhost owns the transform directly, so a table re-render from a live
     reorder can never snap the ghost back to its start point. */
  useEffect(() => {
    const node = ghostRef.current
    if (!node || !ghost) return
    node.style.transform = `translate3d(${ghost.x}px, ${ghost.y}px, 0) rotate(-2deg)`
  }, [ghost])

  /* The examine overlay closes on Escape anywhere the table is on screen. */
  useEffect(() => {
    if (!previewId) return
    const onKey = (ev: KeyboardEvent) => { if (ev.key === 'Escape') setPreviewId(null) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [previewId])

  /* The download tells the truth about what it is: the job is
     named after its first page, the way a print job is, and carries
     the mycloove brand prefix on every saved file. */
  const boundName = () => {
    const base = entries[0].file.name.replace(/\.[^.]+$/, '') || 'pages'
    return entries.length === 1 ? `mycloove_${base}.pdf` : `mycloove_${base}-and-${entries.length - 1}-more.pdf`
  }

  const bind = async () => {
    if (!entries.length || phase === 'binding') return
    if (entries.length > MAX_IMAGES) {
      setError(`Up to ${MAX_IMAGES} images can be bound at once — this set has ${entries.length}.`)
      return
    }
    const oversized = entries.find(e => e.file.size > MAX_FILE_MB * 1024 * 1024)
    if (oversized) {
      setError(`${oversized.file.name} is ${fmtSize(oversized.file.size)} — each image must be under ${MAX_FILE_MB} MB.`)
      return
    }
    const total = entries.reduce((sum, e) => sum + e.file.size, 0)
    if (total > MAX_TOTAL_MB * 1024 * 1024) {
      setError(`This set is ${fmtSize(total)} — the limit is ${MAX_TOTAL_MB} MB per document.`)
      return
    }
    setPhase('binding')
    setError(null)
    setProgress(0)
    const abort = new AbortController()
    abortRef.current = abort
    try {
      const formData = new FormData()
      for (const e of entries) {
        const f = autoCrop
          ? await cropImage(e.file, cropPosition, cropPercentage, customWidth, customHeight)
          : e.file
        formData.append('images', f)
      }
      formData.append('pageSize', pageSize)
      formData.append('quality', quality)
      // Real upload progress + a working cancel, via the XHR bridge. The old
      // fetch silently froze on large sets with no way to stop it.
      const res = await uploadWithProgress('/api/images-to-pdf', formData, {
        onProgress: setProgress,
        signal: abort.signal,
      })
      if (!res.ok) {
        throw new Error(await getApiErrorMessage(res, 'Binding failed'))
      }
      const blob = await res.blob()
      const name = boundName()
      // Hold the document instead of auto-saving it: the download fires only
      // when the user asks, so the result stays available and a re-bind is
      // never needed just to get the file again.
      setBoundBlob(blob)
      setBoundFileName(name)
      setBoundPages(entries.length)
      setBoundBytes(blob.size)
      addRecentConversion({
        toolId: 'image-to-pdf',
        label: 'Images to PDF',
        filename: name,
        sizeBytes: blob.size,
      })
      setPhase('bound')
    } catch (e) {
      if (e instanceof Error && e.name === 'ApiClientError' && /cancelled/i.test(e.message)) {
        setError(null) // A deliberate cancel is not an error — pages stay put.
      } else {
        setError(e instanceof Error ? e.message : 'Binding failed — please try again.')
      }
      setPhase('editing') // pages stay on the table; retry is one click away
    } finally {
      abortRef.current = null
      setProgress(null)
    }
  }

  const cancelBind = () => {
    abortRef.current?.abort()
  }

  /* The download the user asked for — the only place the finished bytes leave
     the page. Held blobs survive repeated clicks. */
  const downloadBound = () => {
    if (boundBlob) downloadBlob(boundBlob, boundFileName || 'pages.pdf')
  }

  const reset = () => {
    entries.forEach(e => URL.revokeObjectURL(e.url))
    setEntries([])
    setSettled(new Set())
    setPhase('editing')
    setError(null)
    setPreviewId(null)
    setDragId(null)
    setGhost(null)
    setBoundBlob(null)
    setBoundFileName('')
    setBoundPages(0)
    setBoundBytes(0)
  }

  const totalBytes = entries.reduce((s, e) => s + e.file.size, 0)
  const n = entries.length

  const previewEntry = previewId ? entries.find(e => e.id === previewId) ?? null : null
  const previewIndex = previewEntry ? entries.indexOf(previewEntry) : -1
  const ghostEntry = ghost ? entries.find(e => e.id === ghost.id) ?? null : null

  const cropSentence =
    cropPosition === 'bottom-right'
      ? `bottom ${cropPercentage}% and right ${cropPercentage}% of every page`
      : cropPosition === 'bottom'
      ? `the bottom ${cropPercentage}% of every page`
      : `${customWidth}px from the right and ${customHeight}px from the bottom of every page`

  return (
    <>
      <style>{`
        /* ── Local palette (both themes) ───────────────────────
           Darkroom safelight amber is this tool's identity — this
           surface's own device, not the house coral and not the
           shared card icon (which carries the Convert tone).
           Structural chrome stays on surface-1 tokens so both
           themes hold automatically. */
        .i2p {
          --i2p-amber:        #ffb454;
          --i2p-amber-soft:   rgba(255, 180, 84, 0.12);
          --i2p-amber-line:   rgba(255, 180, 84, 0.38);
          --i2p-bind-bg:      #f2a93b;   /* solid in both themes */
          --i2p-bind-ink:     #241703;
          --i2p-paper-edge:   rgba(0, 0, 0, 0.4);
          --i2p-paper-shadow: 0 3px 14px rgba(0, 0, 0, 0.4), 0 1px 3px rgba(0, 0, 0, 0.32);
          --i2p-checker:      rgba(255, 255, 255, 0.03);
          --i2p-danger-text:  #ff8d84;
          --i2p-danger-bg:    rgba(255, 90, 80, 0.08);
          --i2p-danger-line:  rgba(255, 90, 80, 0.24);
          --i2p-mark-back:    rgba(255, 255, 255, 0.08);
          --i2p-mark-line:    rgba(255, 255, 255, 0.16);
          --i2p-mark-text:    rgba(0, 0, 0, 0.22);
          --i2p-ease:   cubic-bezier(0.16, 1, 0.3, 1);
          --i2p-spring: cubic-bezier(0.34, 1.56, 0.64, 1);
          display: flex; flex-direction: column; gap: 16px;
        }
        [data-theme='light'] .i2p {
          --i2p-amber:        #a86a0d;
          --i2p-amber-soft:   rgba(190, 120, 14, 0.09);
          --i2p-amber-line:   rgba(190, 120, 14, 0.34);
          --i2p-paper-edge:   rgba(0, 0, 0, 0.12);
          --i2p-paper-shadow: 0 2px 10px rgba(28, 20, 6, 0.14), 0 1px 3px rgba(28, 20, 6, 0.08);
          --i2p-checker:      rgba(0, 0, 0, 0.024);
          --i2p-danger-text:  #b3261e;
          --i2p-danger-bg:    rgba(179, 38, 30, 0.06);
          --i2p-danger-line:  rgba(179, 38, 30, 0.2);
          --i2p-mark-back:    rgba(0, 0, 0, 0.05);
          --i2p-mark-line:    rgba(0, 0, 0, 0.14);
          --i2p-mark-text:    rgba(0, 0, 0, 0.18);
        }

        .i2p :focus-visible {
          outline: 2px solid var(--i2p-amber);
          outline-offset: 2px;
          border-radius: 6px;
        }

        /* ── Empty state: the invitation ───────────────────────
           No template dashed-box-with-icon-ring. Ghost pages
           fanned on a table invite the user to lay theirs down. */
        .i2p-zone {
          position: relative;
          border: 1px solid var(--border-base);
          border-radius: 12px;
          padding: 48px 24px 44px;
          display: flex; flex-direction: column; align-items: center; text-align: center;
          cursor: pointer;
          transition: border-color 0.25s var(--i2p-ease), background 0.25s var(--i2p-ease), box-shadow 0.25s var(--i2p-ease);
        }
        .i2p-zone:hover { border-color: var(--i2p-amber-line); background: var(--bg-item); }
        .i2p.is-over .i2p-zone {
          border-color: var(--i2p-amber);
          background: var(--i2p-amber-soft);
          box-shadow: 0 0 0 1px var(--i2p-amber-line), 0 14px 44px rgba(255, 180, 84, 0.1);
        }

        .i2p-ghosts { position: relative; width: 168px; height: 128px; margin-bottom: 22px; }
        .i2p-ghost {
          position: absolute; bottom: 0; left: 50%;
          width: 74px; aspect-ratio: 0.74;
          border: 1px dashed var(--border-base);
          border-radius: 4px;
          background:
            linear-gradient(var(--i2p-checker), var(--i2p-checker)),
            repeating-conic-gradient(var(--i2p-checker) 0% 25%, transparent 0% 50%) 0 0 / 12px 12px;
          /* -50% self-offset re-anchors each ghost's own centre
             (not its left edge) onto the container's centre line,
             so the fan is exactly symmetric about the zone axis —
             left:50% alone sat the whole fan ~34px right. */
          translate: calc(var(--x) - 50%) 0;
          rotate: var(--r);
          transition: rotate 0.5s var(--i2p-spring), translate 0.5s var(--i2p-spring), border-color 0.25s;
        }
        .i2p-ghost:nth-child(1) { --x: -52px; --r: -13deg; width: 64px; opacity: 0.45; z-index: 1; }
        .i2p-ghost:nth-child(2) { --x: 0px;   --r: 0deg;   opacity: 0.85; z-index: 3; }
        .i2p-ghost:nth-child(3) { --x: 52px;  --r: 13deg;  width: 64px; opacity: 0.45; z-index: 2; }
        .i2p-zone:hover .i2p-ghost { border-color: var(--i2p-amber-line); }
        .i2p.is-over .i2p-ghost { border-color: var(--i2p-amber); }
        .i2p.is-over .i2p-ghost:nth-child(1) { --x: -66px; --r: -20deg; }
        .i2p.is-over .i2p-ghost:nth-child(3) { --x: 66px;  --r: 20deg; }
        .i2p.is-over .i2p-ghost:nth-child(2) { translate: -50% -7px; }

        .i2p-zone-title {
          font-family: 'Manrope', sans-serif;
          font-size: 17px; font-weight: 700; letter-spacing: -0.2px;
          color: var(--text-primary);
          margin-bottom: 7px;
        }
        .i2p-zone-sub {
          font-size: 13px; line-height: 1.6;
          color: var(--text-muted);
          max-width: 44ch;
          margin-bottom: 20px;
        }
        .i2p-chips { display: flex; flex-wrap: wrap; gap: 5px; justify-content: center; margin-top: 18px; }
        .i2p-chip {
          font-family: ui-monospace, 'Cascadia Code', monospace;
          font-size: 10px; font-weight: 600; letter-spacing: 0.6px;
          padding: 3px 9px; border-radius: 20px;
          background: var(--bg-item);
          border: 1px solid var(--border-base);
          color: var(--text-muted);
        }

        /* ── Buttons ── */
        .i2p-browse-btn {
          display: inline-flex; align-items: center; gap: 8px;
          font-family: 'Manrope', sans-serif;
          font-size: 13px; font-weight: 700;
          color: var(--i2p-bind-ink);
          background: var(--i2p-bind-bg);
          border: none; border-radius: 10px;
          padding: 11px 20px;
          cursor: pointer;
          box-shadow: 0 3px 16px rgba(242, 169, 59, 0.28);
          transition: transform 0.18s var(--i2p-ease), box-shadow 0.18s var(--i2p-ease);
        }
        .i2p-browse-btn:hover { transform: translateY(-1px); box-shadow: 0 6px 22px rgba(242, 169, 59, 0.36); }
        .i2p-browse-btn:active { transform: translateY(0); }
        .i2p-browse-btn--ghost {
          background: transparent;
          color: var(--i2p-amber);
          border: 1px solid var(--i2p-amber-line);
          box-shadow: none;
          padding: 8px 14px;
        }
        .i2p-browse-btn--ghost:hover { background: var(--i2p-amber-soft); box-shadow: none; }

        /* ── Loaded: the add-rail (the table stays open) ── */
        .i2p-rail {
          display: flex; align-items: center; gap: 12px; flex-wrap: wrap;
          padding: 12px 14px;
          border: 1px dashed var(--border-base);
          border-radius: 12px;
          transition: border-color 0.25s var(--i2p-ease), background 0.25s var(--i2p-ease);
        }
        .i2p-rail:hover { border-color: var(--i2p-amber-line); background: var(--bg-item); }
        .i2p.is-over .i2p-rail {
          border-color: var(--i2p-amber);
          border-style: solid;
          background: var(--i2p-amber-soft);
        }
        .i2p-rail-icon {
          width: 34px; height: 34px; flex-shrink: 0;
          display: flex; align-items: center; justify-content: center;
          border-radius: 9px;
          color: var(--i2p-amber);
          background: var(--i2p-amber-soft);
          border: 1px solid var(--i2p-amber-line);
        }
        .i2p-rail-text { font-size: 12.5px; color: var(--text-muted); line-height: 1.5; flex: 1; min-width: 180px; }
        .i2p-rail-text b { color: var(--text-secondary); font-weight: 600; }

        /* ── Trim (watermark) sidecar panel ── */
        .i2p-panel {
          background: var(--bg-item);
          border: 1px solid var(--border-base);
          border-radius: 12px;
          overflow: hidden;
        }
        .i2p-panel-head {
          display: flex; align-items: center; gap: 11px;
          width: 100%;
          padding: 13px 15px;
          cursor: pointer;
          user-select: none;
          /* Reset so the head can be a real <button> (keyboard-accessible trim
             toggle) without the UA button chrome; the panel supplies the frame. */
          font: inherit; text-align: left;
          background: transparent; border: 0; color: inherit;
          transition: background 0.15s;
        }
        .i2p-panel-head:hover { background: var(--bg-item-hover); }
        /* A panel with nothing to toggle keeps the same head rhythm but
           never reads as clickable. */
        .i2p-panel-head--static { cursor: default; }
        .i2p-panel-head--static:hover { background: transparent; }
        .i2p-toggle-track {
          width: 36px; height: 20px; flex-shrink: 0;
          border-radius: 20px;
          border: 1.5px solid var(--border-base);
          background: var(--bg-item);
          position: relative;
          transition: background 0.2s, border-color 0.2s;
        }
        .i2p-toggle-track.on { background: var(--i2p-bind-bg); border-color: transparent; }
        .i2p-toggle-thumb {
          position: absolute; top: 2px; left: 2px;
          width: 14px; height: 14px; border-radius: 50%;
          background: #fff;
          box-shadow: 0 1px 3px rgba(0, 0, 0, 0.3);
          transition: transform 0.2s var(--i2p-ease);
        }
        .i2p-toggle-track.on .i2p-toggle-thumb { transform: translateX(16px); }
        .i2p-panel-label {
          font-size: 13px; font-weight: 600;
          color: var(--text-primary);
          flex: 1;
          display: flex; align-items: center; gap: 8px;
        }
        .i2p-panel-label svg { color: var(--text-muted); }
        .i2p-panel-badge {
          font-family: ui-monospace, 'Cascadia Code', monospace;
          font-size: 9.5px; font-weight: 700; letter-spacing: 0.8px; text-transform: uppercase;
          padding: 3px 9px; border-radius: 20px;
          background: var(--i2p-amber-soft);
          border: 1px solid var(--i2p-amber-line);
          color: var(--i2p-amber);
        }
        .i2p-panel-body {
          padding: 4px 15px 15px;
          display: flex; flex-direction: column; gap: 15px;
          border-top: 1px solid var(--border-base);
        }

        .i2p-sub-label {
          font-size: 10px; font-weight: 700; letter-spacing: 1.1px; text-transform: uppercase;
          color: var(--text-faint);
          display: block; margin-bottom: 9px;
        }
        .i2p-radio-group { display: flex; flex-direction: column; gap: 6px; }
        .i2p-radio-row {
          display: flex; align-items: center; gap: 10px;
          padding: 9px 12px;
          border-radius: 10px;
          border: 1px solid var(--border-base);
          background: var(--bg-card);
          cursor: pointer;
          transition: border-color 0.15s, background 0.15s;
          user-select: none;
        }
        .i2p-radio-row:hover { background: var(--bg-item-hover); }
        .i2p-radio-row.selected {
          border-color: var(--i2p-amber-line);
          background: var(--i2p-amber-soft);
        }
        .i2p-radio-dot {
          width: 16px; height: 16px; border-radius: 50%;
          border: 1.5px solid var(--border-base);
          display: flex; align-items: center; justify-content: center;
          flex-shrink: 0;
          transition: border-color 0.15s;
        }
        .i2p-radio-row.selected .i2p-radio-dot { border-color: var(--i2p-amber); }
        .i2p-radio-inner {
          width: 8px; height: 8px; border-radius: 50%;
          background: var(--i2p-amber);
          transform: scale(0);
          transition: transform 0.15s var(--i2p-ease);
        }
        .i2p-radio-row.selected .i2p-radio-inner { transform: scale(1); }
        .i2p-radio-text { font-size: 12.5px; font-weight: 500; color: var(--text-secondary); }
        .i2p-radio-hint { font-size: 10.5px; color: var(--text-label); margin-left: auto; text-align: right; }

        .i2p-select {
          background: var(--bg-card);
          border: 1px solid var(--border-base);
          border-radius: 8px;
          padding: 8px 10px;
          font-size: 12px;
          color: var(--text-primary);
          cursor: pointer; outline: none;
          transition: border-color 0.15s;
          -webkit-appearance: none; appearance: none;
          background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6' viewBox='0 0 10 6'%3E%3Cpath d='M0 0l5 6 5-6z' fill='%23888'/%3E%3C/svg%3E");
          background-repeat: no-repeat; background-position: right 8px center; padding-right: 26px;
        }
        .i2p-select:focus { border-color: var(--i2p-amber-line); }
        .i2p-select option { background: var(--bg-card); color: var(--text-primary); }

        .i2p-custom-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
        .i2p-field-label { font-size: 10.5px; color: var(--text-muted); margin-bottom: 5px; }
        .i2p-number-input {
          width: 100%;
          background: var(--bg-card);
          border: 1px solid var(--border-base);
          border-radius: 8px;
          padding: 8px 10px;
          font-size: 12px;
          color: var(--text-primary);
          outline: none;
          transition: border-color 0.15s;
        }
        .i2p-number-input:focus { border-color: var(--i2p-amber-line); }

        .i2p-info {
          display: flex; align-items: flex-start; gap: 8px;
          padding: 10px 12px;
          border-radius: 9px;
          background: var(--i2p-amber-soft);
          border: 1px solid var(--i2p-amber-line);
          font-size: 11.5px; line-height: 1.55;
          color: var(--i2p-amber);
        }
        .i2p-info svg { flex-shrink: 0; margin-top: 1px; }

        /* ── The table ── */
        .i2p-table-head { display: flex; align-items: center; justify-content: space-between; }
        .i2p-table-title {
          font-family: 'Manrope', sans-serif;
          font-size: 13px; font-weight: 700;
          color: var(--text-primary);
          display: flex; align-items: center; gap: 9px;
        }
        .i2p-count-badge {
          font-family: ui-monospace, 'Cascadia Code', monospace;
          font-size: 10px; font-weight: 700; letter-spacing: 0.5px;
          padding: 2px 8px; border-radius: 20px;
          background: var(--i2p-amber-soft);
          border: 1px solid var(--i2p-amber-line);
          color: var(--i2p-amber);
        }
        .i2p-clear-btn {
          display: flex; align-items: center; gap: 6px;
          font-size: 11.5px; font-weight: 500;
          color: var(--text-muted);
          padding: 6px 11px; border-radius: 8px;
          border: 1px solid var(--border-base);
          background: transparent;
          cursor: pointer;
          transition: color 0.15s, background 0.15s, border-color 0.15s;
        }
        .i2p-clear-btn:hover {
          color: var(--i2p-danger-text);
          background: var(--i2p-danger-bg);
          border-color: var(--i2p-danger-line);
        }

        /* The light-table surface itself: a whisper of the
           transparency checkerboard says "this is a viewing
           surface", nothing more. */
        .i2p-grid {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(158px, 1fr));
          gap: 12px;
          padding: 14px;
          border: 1px solid var(--border-base);
          border-radius: 12px;
          background: repeating-conic-gradient(var(--i2p-checker) 0% 25%, transparent 0% 50%) 0 0 / 18px 18px;
        }

        .i2p-tile {
          display: grid;
          grid-template-rows: auto 1fr auto;
          row-gap: 7px;
          height: 224px;
          padding: 8px 9px 9px;
          border-radius: 10px;
          background: var(--bg-item);
          border: 1px solid transparent;
          transition: border-color 0.15s, background 0.15s, transform 0.3s var(--i2p-ease), opacity 0.3s var(--i2p-ease);
        }
        .i2p-tile:hover { border-color: var(--border-base); background: var(--bg-item-hover); }
        .i2p-tile--new {
          animation: i2p-tile-in 0.55s var(--i2p-spring) backwards;
          animation-delay: var(--d, 0ms);
        }

        .i2p-tile-top { display: flex; align-items: center; justify-content: space-between; height: 20px; }
        .i2p-frame {
          font-family: ui-monospace, 'Cascadia Code', monospace;
          font-size: 10.5px; font-weight: 600; letter-spacing: 1px;
          color: var(--text-muted);
          display: inline-flex; align-items: center; gap: 6px;
        }
        .i2p-frame::before {
          content: '';
          width: 10px; height: 1.5px;
          background: var(--i2p-amber);
          opacity: 0.55;
          border-radius: 2px;
        }
        .i2p-x {
          width: 22px; height: 22px;
          border-radius: 50%;
          border: 1px solid var(--border-base);
          background: var(--bg-card);
          color: var(--text-muted);
          display: flex; align-items: center; justify-content: center;
          cursor: pointer;
          opacity: 0;
          transition: opacity 0.15s, color 0.15s, border-color 0.15s, background 0.15s;
        }
        .i2p-tile:hover .i2p-x, .i2p-x:focus-visible { opacity: 1; }
        .i2p-x:hover { color: var(--i2p-danger-text); border-color: var(--i2p-danger-line); background: var(--i2p-danger-bg); }

        /* ── The page: true-ratio, paper, uncropped ──
           The wrap is a size container, so the page box can be
           computed against the wrap's own box via cq units: the
           min() pair fits the image's aspect ratio inside the
           available area in BOTH axes — the exact double-clamp
           that only replaced elements get for free. This is what
           keeps every tile honest: the paper frame IS the page
           the route will emit (addPage([image.width, image.height])). */
        .i2p-page-wrap {
          container-type: size;
          display: grid;
          place-items: center;
          min-height: 0;
        }
        .i2p-page {
          position: relative;
          width: 100%; height: 100%;
          max-width: 100%; max-height: 100%;
          background: #ffffff;
          border: 1px solid var(--i2p-paper-edge);
          border-radius: 3px;
          box-shadow: var(--i2p-paper-shadow);
          overflow: hidden;
        }
        @supports (width: 1cqh) {
          .i2p-page {
            width: min(100cqw, calc(100cqh * var(--ar, 1)));
            height: min(100cqh, calc(100cqw / var(--ar, 1)));
          }
        }
        .i2p-page img {
          display: block;
          width: 100%; height: 100%;
          object-fit: contain;
          border-radius: 2px;
        }

        /* ── Live trim preview: hatched exactly over the pixels
           the crop will remove, per image, per ratio. ── */
        .i2p-cut {
          position: absolute;
          pointer-events: none;
          background:
            repeating-linear-gradient(-45deg, rgba(255, 180, 84, 0.5) 0 1.5px, transparent 1.5px 7px),
            rgba(18, 11, 2, 0.42);
        }
        .i2p-cut--bottom  { left: 0; right: 0; bottom: 0; height: calc(var(--cut, 0) * 1%); border-top: 1.5px dashed rgba(255, 200, 120, 0.85); }
        .i2p-cut--corner  { right: 0; bottom: 0; width: calc(var(--cut, 0) * 1%); height: calc(var(--cut, 0) * 1%); border-top: 1.5px dashed rgba(255, 200, 120, 0.85); border-left: 1.5px dashed rgba(255, 200, 120, 0.85); }
        .i2p-cut--custom  { right: 0; bottom: 0; width: calc(var(--cut-r, 0) * 100%); height: calc(var(--cut-b, 0) * 100%); border-top: 1.5px dashed rgba(255, 200, 120, 0.85); border-left: 1.5px dashed rgba(255, 200, 120, 0.85); }

        .i2p-meta { display: flex; align-items: center; gap: 6px; }
        .i2p-move {
          width: 22px; height: 22px; flex-shrink: 0;
          border-radius: 6px;
          border: 1px solid transparent;
          background: transparent;
          color: var(--text-faint);
          display: flex; align-items: center; justify-content: center;
          cursor: pointer;
          transition: color 0.15s, background 0.15s, border-color 0.15s, opacity 0.15s;
        }
        .i2p-move:hover:not(:disabled) { color: var(--i2p-amber); background: var(--i2p-amber-soft); border-color: var(--i2p-amber-line); }
        .i2p-move:disabled { opacity: 0.22; cursor: default; }
        .i2p-meta-text {
          flex: 1; min-width: 0;
          font-family: ui-monospace, 'Cascadia Code', monospace;
          font-size: 9.5px; letter-spacing: 0.2px;
          color: var(--text-muted);
          font-variant-numeric: tabular-nums;
          white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
          text-align: center;
        }

        /* ── Bind bar ── */
        .i2p-bind {
          display: flex; align-items: center; justify-content: space-between; gap: 16px; flex-wrap: wrap;
          padding: 14px 16px;
          border: 1px solid var(--border-base);
          border-radius: 12px;
          background: var(--bg-item);
        }
        .i2p-bind-info { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
        .i2p-bind-line {
          font-size: 13px; font-weight: 600;
          color: var(--text-primary);
          font-variant-numeric: tabular-nums;
        }
        .i2p-bind-sub { font-size: 11.5px; color: var(--text-muted); font-variant-numeric: tabular-nums; }
        .i2p-bind-btn {
          display: inline-flex; align-items: center; gap: 9px;
          font-family: 'Manrope', sans-serif;
          font-size: 14px; font-weight: 700; letter-spacing: -0.2px;
          color: var(--i2p-bind-ink);
          background: var(--i2p-bind-bg);
          border: none; border-radius: 11px;
          padding: 13px 24px;
          cursor: pointer;
          box-shadow: 0 4px 22px rgba(242, 169, 59, 0.3);
          transition: transform 0.18s var(--i2p-ease), box-shadow 0.18s var(--i2p-ease), opacity 0.18s;
          white-space: nowrap;
        }
        .i2p-bind-btn:hover:not(:disabled) { transform: translateY(-1.5px); box-shadow: 0 8px 30px rgba(242, 169, 59, 0.4); }
        .i2p-bind-btn:active:not(:disabled) { transform: translateY(0); }
        .i2p-bind-btn:disabled { opacity: 0.82; cursor: progress; box-shadow: none; }
        .i2p-bind-btn svg { flex-shrink: 0; }

        .i2p-err {
          display: flex; align-items: flex-start; gap: 9px;
          padding: 12px 14px;
          border-radius: 10px;
          background: var(--i2p-danger-bg);
          border: 1px solid var(--i2p-danger-line);
          color: var(--i2p-danger-text);
          font-size: 12.5px; line-height: 1.55;
        }
        .i2p-err svg { flex-shrink: 0; margin-top: 1px; }

        /* ── Upload progress (real bytes, from the XHR bridge) ── */
        .i2p-progress {
          position: relative;
          width: 100%;
          height: 22px;
          border-radius: 8px;
          background: var(--bg-item);
          border: 1px solid var(--border-base);
          overflow: hidden;
          flex-basis: 100%;
        }
        .i2p-progress-fill {
          position: absolute; inset: 0 auto 0 0;
          background: linear-gradient(90deg, var(--i2p-amber-soft), var(--i2p-bind-bg));
          transition: width 0.25s var(--i2p-ease);
        }
        .i2p-progress-pct {
          position: absolute; inset: 0;
          display: flex; align-items: center; justify-content: center;
          font-family: ui-monospace, 'Cascadia Code', monospace;
          font-size: 10.5px; font-weight: 700; letter-spacing: 0.5px;
          color: var(--text-primary);
        }
        .i2p-cancel-btn {
          font-family: 'Manrope', sans-serif;
          font-size: 12px; font-weight: 700;
          color: var(--i2p-danger-text);
          background: var(--i2p-danger-bg);
          border: 1px solid var(--i2p-danger-line);
          border-radius: 10px;
          padding: 10px 16px;
          cursor: pointer;
          transition: background 0.15s;
        }
        .i2p-cancel-btn:hover { background: rgba(255, 90, 80, 0.14); }

        /* ── Bound state ── */
        .i2p-bound {
          display: flex; flex-direction: column; align-items: center; text-align: center;
          padding: 48px 24px 44px;
          border: 1px solid var(--border-base);
          border-radius: 12px;
        }
        .i2p-bound-mark { animation: i2p-doc-in 0.6s var(--i2p-spring) backwards; margin-bottom: 18px; }
        .i2p-bound-title {
          font-family: 'Manrope', sans-serif;
          font-size: 22px; font-weight: 800; letter-spacing: -0.4px;
          color: var(--text-primary);
          margin-bottom: 8px;
        }
        .i2p-bound-name {
          font-family: ui-monospace, 'Cascadia Code', monospace;
          font-size: 12.5px;
          color: var(--i2p-amber);
          margin-bottom: 5px;
          word-break: break-all;
        }
        .i2p-bound-sub { font-size: 13px; color: var(--text-muted); margin-bottom: 22px; }
        .i2p-bound-actions {
          display: flex; align-items: center; justify-content: center;
          gap: 10px; flex-wrap: wrap;
          margin-bottom: 12px;
        }
        .i2p-download-btn { box-shadow: 0 4px 22px rgba(242, 169, 59, 0.34); }
        .i2p-bound-back {
          display: inline-flex; align-items: center; gap: 6px;
          font-size: 12px; font-weight: 500;
          color: var(--text-muted);
          background: transparent; border: none;
          padding: 6px 10px; border-radius: 8px;
          cursor: pointer;
          transition: color 0.15s, background 0.15s;
        }
        .i2p-bound-back:hover { color: var(--i2p-amber); background: var(--i2p-amber-soft); }

        /* ── The instrument header ──
           The surface names itself now that the workspace heading row is
           retired. Mark carries the only amber; the title is plain ink. */
        .i2p-head { display: flex; align-items: center; gap: 11px; }
        .i2p-head-mark {
          width: 34px; height: 34px; flex-shrink: 0;
          display: flex; align-items: center; justify-content: center;
          border-radius: 9px;
          color: var(--i2p-amber);
          background: var(--i2p-amber-soft);
          border: 1px solid var(--i2p-amber-line);
        }
        .i2p-head-title {
          font-family: 'Manrope', sans-serif;
          font-size: 20px; font-weight: 800; letter-spacing: -0.4px;
          color: var(--text-primary);
          margin: 0;
        }

        /* ── The Double Helix working mark ──
           Two counter-phased dots per strand, weaving on --i2p-amp. Dot size
           and travel are custom properties, so one mark scales from the bind
           button down to the tile meta without redrawing it — the button mark
           is deliberately chunky (3px dots, wider travel) so it reads clearly
           against the amber while the job runs. Colour is inherited
           (currentColor): the bind button's dark ink on amber, amber in the
           tile meta. Indeterminate — it never carries a percentage. */
        .i2p-helix {
          display: flex; justify-content: space-between;
          --i2p-amp: 6px;   /* vertical travel of each dot */
          --i2p-dot: 3px;   /* dot and strand width */
        }
        .i2p-helix u { position: relative; width: var(--i2p-dot); height: 100%; display: block; text-decoration: none; }
        .i2p-helix u::before, .i2p-helix u::after {
          content: ''; position: absolute; left: 0; top: 50%;
          width: var(--i2p-dot); height: var(--i2p-dot);
          margin-top: calc(var(--i2p-dot) / -2);
          border-radius: 50%;
          background: currentColor;
          animation: i2p-wv 1.1s ease-in-out infinite;
          animation-delay: calc(var(--n) * -0.13s);
        }
        .i2p-helix u::after { opacity: 0.82; animation-delay: calc(var(--n) * -0.13s - 0.55s); }
        .i2p-meta-helix {
          --i2p-amp: 3px; --i2p-dot: 2px;
          display: inline-flex; vertical-align: -1px; color: var(--i2p-amber);
        }

        /* ── Direct manipulation ──
           The print is grabbable; once lifted, its origin tile becomes a dashed
           placeholder (the gap that travels with the reorder) and a paper ghost
           follows the cursor. The FLIP settle rides the tile's own transform
           transition (see .i2p-tile), so no extra motion token. */
        .i2p-tile { user-select: none; }
        .i2p-page-wrap { cursor: grab; }
        .i2p-tile--placeholder {
          border-color: var(--i2p-amber-line);
          background: var(--i2p-amber-soft);
          box-shadow: none;
        }
        .i2p-tile--placeholder .i2p-tile-top,
        .i2p-tile--placeholder .i2p-page-wrap,
        .i2p-tile--placeholder .i2p-meta { opacity: 0; }
        .i2p-ghost-card {
          position: fixed; left: 0; top: 0; z-index: 70;
          pointer-events: none;
          border-radius: 4px; overflow: hidden;
          background: #ffffff;
          border: 1px solid var(--i2p-paper-edge);
          box-shadow: 0 20px 40px rgba(0, 0, 0, 0.5), 0 4px 12px rgba(0, 0, 0, 0.4);
          will-change: transform;
          opacity: 0.97;
        }
        .i2p-ghost-card img { display: block; width: 100%; height: 100%; object-fit: contain; }

        /* ── Examine overlay ── */
        .i2p-lightbox {
          position: fixed; inset: 0; z-index: 60;
          display: flex; align-items: center; justify-content: center;
          padding: 24px;
          background: rgba(6, 4, 1, 0.72);
          -webkit-backdrop-filter: blur(3px); backdrop-filter: blur(3px);
          animation: i2p-fade 0.18s var(--i2p-ease) both;
        }
        .i2p-lightbox-card {
          position: relative;
          display: flex; flex-direction: column; gap: 12px;
          max-width: min(86vw, 720px); max-height: 88vh;
          padding: 14px;
          border-radius: 14px;
          background: var(--bg-card);
          border: 1px solid var(--border-base);
          box-shadow: 0 24px 70px rgba(0, 0, 0, 0.5);
          animation: i2p-card-in 0.28s var(--i2p-spring) both;
        }
        .i2p-lightbox-img {
          max-width: 100%; max-height: 68vh;
          object-fit: contain;
          border-radius: 6px;
          background: #ffffff;
          border: 1px solid var(--i2p-paper-edge);
        }
        .i2p-lightbox-meta { display: flex; flex-direction: column; gap: 3px; min-width: 0; padding-right: 30px; }
        .i2p-lightbox-frame {
          font-family: ui-monospace, 'Cascadia Code', monospace;
          font-size: 10px; font-weight: 700; letter-spacing: 1px; text-transform: uppercase;
          color: var(--i2p-amber);
        }
        .i2p-lightbox-name {
          font-size: 13px; font-weight: 600; color: var(--text-primary);
          overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
        }
        .i2p-lightbox-facts {
          font-family: ui-monospace, 'Cascadia Code', monospace;
          font-size: 11px; color: var(--text-muted); font-variant-numeric: tabular-nums;
        }
        .i2p-lightbox-close {
          position: absolute; top: 10px; right: 10px;
          width: 28px; height: 28px; border-radius: 50%;
          border: 1px solid var(--border-base);
          background: var(--bg-item);
          color: var(--text-muted);
          display: flex; align-items: center; justify-content: center;
          cursor: pointer;
          transition: color 0.15s, border-color 0.15s, background 0.15s;
        }
        .i2p-lightbox-close:hover { color: var(--i2p-danger-text); border-color: var(--i2p-danger-line); background: var(--i2p-danger-bg); }

        /* ── Motion ──
           One orchestrated moment (the collate press), everything
           else quick and quiet. */
        @keyframes i2p-tile-in {
          from { transform: translateY(14px) scale(0.94); opacity: 0; }
        }
        @keyframes i2p-doc-in {
          from { transform: scale(0.5) rotate(-6deg); opacity: 0; }
        }
        @keyframes i2p-wv {
          0%, 100% { transform: translateY(calc(var(--i2p-amp) * -1)) scale(0.6); opacity: 0.4; }
          50% { transform: translateY(var(--i2p-amp)) scale(1.2); opacity: 1; }
        }
        @keyframes i2p-fade { from { opacity: 0; } }
        @keyframes i2p-card-in { from { transform: scale(0.96); opacity: 0; } }

        /* The collate: pages are pressed onto the stack in page
           order while the job runs. Indeterminate by design — no
           fake percentages; the delay is capped so large tables
           sweep in ~1.3s, not one second per 25 pages. */
        .i2p-grid.is-binding .i2p-tile {
          animation: i2p-press 0.6s var(--i2p-ease) both;
          animation-delay: min(calc(var(--i) * 40ms), 1280ms);
        }
        @keyframes i2p-press {
          0%   { transform: none; opacity: 1; }
          40%  { transform: scale(0.9) rotate(-1.5deg); opacity: 0.8; }
          100% { transform: scale(0.93); opacity: 0.55; }
        }

        /* Touch devices have no hover: the remove control must
           not be hidden behind a hover affordance. */
        @media (hover: none) {
          .i2p-x { opacity: 1; }
        }

        @media (max-width: 640px) {
          .i2p-zone { padding: 36px 16px 34px; }
          .i2p-grid { grid-template-columns: repeat(auto-fill, minmax(138px, 1fr)); gap: 10px; padding: 10px; }
          .i2p-tile { height: 198px; }
          .i2p-bind { flex-direction: column; align-items: stretch; }
          .i2p-bind-btn { justify-content: center; width: 100%; }
          .i2p-radio-hint { display: none; }
        }

        @media (prefers-reduced-motion: reduce) {
          .i2p, .i2p *, .i2p *::before, .i2p *::after {
            animation-duration: 0.01ms !important;
            animation-delay: 0ms !important;
            animation-iteration-count: 1 !important;
            transition-duration: 0.01ms !important;
          }
        }
      `}</style>

      <div {...getRootProps({ className: `i2p${isDragActive ? ' is-over' : ''}` })}>
        <input {...getInputProps()} />

        {/* ── The instrument header ──
            The workspace heading row (eyebrow + title + description) is retired
            via ToolWorkspace `hideHeading`, so this surface names itself. The
            mark is the tool's own subject — stacked pages on a binding spine —
            and the only amber on the row; the surface keeps its accessible name
            from ToolWorkspace's `aria-label`. */}
        <header className="i2p-head">
          <span className="i2p-head-mark" aria-hidden="true">
            <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
              <rect x="8" y="3.5" width="11" height="15" rx="1.6" />
              <rect x="5" y="7" width="11" height="15" rx="1.6" />
              <line x1="5" y1="7.5" x2="5" y2="21.5" strokeWidth="2.6" />
            </svg>
          </span>
          <h1 className="i2p-head-title">Images to PDF</h1>
        </header>

        {phase === 'bound' ? (
          /* ── Bound: the closing beat ── */
          <div className="i2p-bound">
            <BoundDoc />
            <p className="i2p-bound-title">Bound.</p>
            <p className="i2p-bound-name">{boundFileName || boundName()}</p>
            <p className="i2p-bound-sub">
              {boundPages} page{boundPages === 1 ? '' : 's'}
              {boundBytes ? ` · ${fmtSize(boundBytes)}` : ''} · ready when you are
            </p>
            <div className="i2p-bound-actions">
              <button type="button" className="i2p-browse-btn i2p-download-btn" onClick={downloadBound}>
                {Icon.download}&nbsp;Download PDF
              </button>
              <button type="button" className="i2p-browse-btn i2p-browse-btn--ghost" onClick={reset}>
                {Icon.image}&nbsp;Start another set
              </button>
            </div>
            <button type="button" className="i2p-bound-back" onClick={() => setPhase('editing')}>
              {Icon.chevronLeft}&nbsp;Back to the table
            </button>
          </div>
        ) : (
          <>
            {/* ── Empty state / add rail ── */}
            {n === 0 ? (
              <div
                className="i2p-zone"
                role="button"
                tabIndex={0}
                onClick={open}
                onKeyDown={e => {
                  if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open() }
                }}
              >
                <div className="i2p-ghosts" aria-hidden="true">
                  <span className="i2p-ghost" />
                  <span className="i2p-ghost" />
                  <span className="i2p-ghost" />
                </div>
                <p className="i2p-zone-title">
                  {isDragActive ? 'Release to lay them on the table' : 'Lay your images on the table'}
                </p>
                <p className="i2p-zone-sub">
                  {isDragActive
                    ? 'Each one becomes a page, in the order you add them.'
                    : 'Every image becomes one page — at its own size, uncropped. Drop them in any order and rearrange before binding.'}
                </p>
                <button type="button" className="i2p-browse-btn">
                  {Icon.image}&nbsp;Browse images
                </button>
                <div className="i2p-chips" aria-hidden="true">
                  {['JPG', 'PNG', 'WEBP', 'GIF', 'BMP', '⌘/Ctrl+V'].map(f => (
                    <span key={f} className="i2p-chip">{f}</span>
                  ))}
                </div>
              </div>
            ) : (
              <div className="i2p-rail">
                <span className="i2p-rail-icon" aria-hidden="true">{Icon.image}</span>
                <span className="i2p-rail-text">
                  {isDragActive
                    ? <b>Release to add to the table.</b>
                    : <>Drop more images anywhere — <b>or</b></>}
                </span>
                <button type="button" className="i2p-browse-btn i2p-browse-btn--ghost" onClick={open}>
                  Browse
                </button>
              </div>
            )}

            {/* ── Trim (watermark) sidecar ── */}
            {n > 0 && (
              <div className="i2p-panel">
                <button
                  type="button"
                  className="i2p-panel-head"
                  aria-expanded={autoCrop}
                  aria-controls="i2p-trim-body"
                  onClick={() => setAutoCrop(v => !v)}
                >
                  <span className={`i2p-toggle-track ${autoCrop ? 'on' : ''}`} aria-hidden="true">
                    <span className="i2p-toggle-thumb" />
                  </span>
                  <span className="i2p-panel-label">
                    {Icon.scissors}
                    Trim edges &amp; watermarks
                  </span>
                  {autoCrop && <span className="i2p-panel-badge">Trimming</span>}
                </button>

                {autoCrop && (
                  <div className="i2p-panel-body" id="i2p-trim-body">
                    <div>
                      <span className="i2p-sub-label">Watermark position</span>
                      <div className="i2p-radio-group">
                        {[
                          { value: 'bottom-right', label: 'Bottom-right corner', hint: 'Recommended for Adobe watermarks' },
                          { value: 'bottom', label: 'Bottom edge', hint: 'Full width strip' },
                          { value: 'custom', label: 'Custom pixels', hint: 'Exact control' },
                        ].map(opt => (
                          <label
                            key={opt.value}
                            className={`i2p-radio-row ${cropPosition === opt.value ? 'selected' : ''}`}
                          >
                            <input
                              type="radio"
                              name="cropPos"
                              value={opt.value}
                              checked={cropPosition === opt.value}
                              onChange={e => setCropPosition(e.target.value as CropPosition)}
                              style={{ display: 'none' }}
                            />
                            <div className="i2p-radio-dot"><div className="i2p-radio-inner" /></div>
                            <span className="i2p-radio-text">{opt.label}</span>
                            <span className="i2p-radio-hint">{opt.hint}</span>
                          </label>
                        ))}
                      </div>
                    </div>

                    {(cropPosition === 'bottom' || cropPosition === 'bottom-right') && (
                      <div>
                        <span className="i2p-sub-label">Trim amount</span>
                        <select
                          className="i2p-select"
                          value={cropPercentage}
                          onChange={e => setCropPercentage(parseInt(e.target.value))}
                        >
                          <option value={5}>5% — Light</option>
                          <option value={8}>8% — Small watermark</option>
                          <option value={10}>10% — Medium</option>
                          <option value={12}>12% — Large watermark</option>
                          <option value={15}>15% — Extra large</option>
                          <option value={20}>20% — Aggressive</option>
                        </select>
                      </div>
                    )}

                    {cropPosition === 'custom' && (
                      <div>
                        <span className="i2p-sub-label">Pixel dimensions</span>
                        <div className="i2p-custom-grid">
                          <div>
                            <p className="i2p-field-label">Trim from right (px)</p>
                            <input
                              type="number" min="0" max="1000"
                              value={customWidth}
                              onChange={e => setCustomWidth(parseInt(e.target.value) || 0)}
                              className="i2p-number-input"
                            />
                          </div>
                          <div>
                            <p className="i2p-field-label">Trim from bottom (px)</p>
                            <input
                              type="number" min="0" max="1000"
                              value={customHeight}
                              onChange={e => setCustomHeight(parseInt(e.target.value) || 0)}
                              className="i2p-number-input"
                            />
                          </div>
                        </div>
                        <p style={{ fontSize: '11px', color: 'var(--text-faint)', marginTop: '8px', lineHeight: 1.5 }}>
                          Adobe watermarks typically sit ~80–100 px from the right and bottom edges.
                        </p>
                      </div>
                    )}

                    <div className="i2p-info">
                      {Icon.check}
                      <span>
                        Trimming {cropSentence} before binding — the hatched area on each page shows
                        exactly what will be removed.
                      </span>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* ── Output sidecar — the paper each page lands on ──
               Page size and compression change the bytes the user
               actually downloads, so they are stated plainly and kept
               next to the table rather than buried at bind time. */}
            {n > 0 && (
              <div className="i2p-panel">
                <div className="i2p-panel-head i2p-panel-head--static">
                  <span className="i2p-panel-label">
                    {Icon.page}
                    Output
                  </span>
                  <span className="i2p-panel-badge">
                    {PAGE_SIZE_LABELS[pageSize]} · {QUALITY_LABELS[quality]}
                  </span>
                </div>
                <div className="i2p-panel-body">
                  <div>
                    <span className="i2p-sub-label">Page size</span>
                    <select
                      className="i2p-select"
                      value={pageSize}
                      onChange={e => setPageSize(e.target.value as PageSize)}
                    >
                      <option value="original">Original — one page per image, at its own size</option>
                      <option value="a4">A4 — fit each image on an A4 page</option>
                      <option value="letter">Letter — fit each image on a US Letter page</option>
                    </select>
                  </div>

                  <div>
                    <span className="i2p-sub-label">Compression</span>
                    <select
                      className="i2p-select"
                      value={quality}
                      onChange={e => setQuality(e.target.value as Quality)}
                    >
                      <option value="high">High — best quality, larger file</option>
                      <option value="balanced">Balanced — recommended for photos and scans</option>
                      <option value="small">Small — smallest file, for sharing</option>
                    </select>
                  </div>

                  <div className="i2p-info">
                    {Icon.info}
                    <span>
                      {pageSize === 'original'
                        ? 'Pages keep each image’s own proportions, uncropped. Images over 4000 px on the long side are scaled down — beyond that, print detail stops improving.'
                        : `Each image is fitted whole inside a ${PAGE_SIZE_LABELS[pageSize]} page with a print margin — never cropped.`}{' '}
                      Photos are re-compressed; an upright JPEG already within the size ceiling is embedded untouched. For text or screenshots, High keeps the most detail.
                    </span>
                  </div>
                </div>
              </div>
            )}

            {/* ── The table ── */}
            {n > 0 && (
              <>
                <div className="i2p-table-head">
                  <span className="i2p-table-title">
                    The table
                    <span className="i2p-count-badge">{n} PAGE{n > 1 ? 'S' : ''}</span>
                  </span>
                  <button type="button" className="i2p-clear-btn" onClick={clearTable}>
                    {Icon.trash} Clear the table
                  </button>
                </div>

                <div className={`i2p-grid${phase === 'binding' ? ' is-binding' : ''}`}>
                  {entries.map((e, i) => {
                    const ar = e.w > 0 && e.h > 0 ? e.w / e.h : 1
                    const isNew = !settled.has(e.id)
                    const cutStyle: CSSProperties =
                      cropPosition === 'custom'
                        ? ({ '--cut-r': Math.min(1, customWidth / (e.w || 1)), '--cut-b': Math.min(1, customHeight / (e.h || 1)) } as CSSProperties)
                        : ({ '--cut': cropPercentage } as CSSProperties)
                    const cutClass =
                      cropPosition === 'custom' ? 'i2p-cut--custom'
                      : cropPosition === 'bottom' ? 'i2p-cut--bottom'
                      : 'i2p-cut--corner'
                    return (
                      <div
                        key={e.id}
                        ref={el => { if (el) tileRefs.current.set(e.id, el); else tileRefs.current.delete(e.id) }}
                        data-i2p-index={i}
                        className={`i2p-tile${isNew ? ' i2p-tile--new' : ''}${dragId === e.id ? ' i2p-tile--placeholder' : ''}`}
                        style={{ '--d': `${i * 45}ms`, '--i': i, '--ar': ar } as CSSProperties}
                        onPointerDown={ev => startDrag(ev, i)}
                        onPointerMove={onDragMove}
                        onPointerUp={endDrag}
                        onPointerCancel={cancelDrag}
                        onAnimationEnd={ev => {
                          if (ev.animationName === 'i2p-tile-in') {
                            setSettled(s => { const next = new Set(s); next.add(e.id); return next })
                          }
                        }}
                      >
                        <div className="i2p-tile-top">
                          <span className="i2p-frame" aria-hidden="true">
                            {String(i + 1).padStart(2, '0')}
                          </span>
                          <button
                            type="button"
                            className="i2p-x"
                            onClick={() => removeAt(i)}
                            aria-label={`Remove page ${i + 1}`}
                          >
                            {Icon.close}
                          </button>
                        </div>

                        <div className="i2p-page-wrap">
                          <div className="i2p-page">
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src={e.url} alt={e.file.name} draggable={false} />
                            {autoCrop && e.w > 0 && (
                              <span className={`i2p-cut ${cutClass}`} style={cutStyle} aria-hidden="true" />
                            )}
                          </div>
                        </div>

                        <div className="i2p-meta">
                          <button
                            type="button"
                            className="i2p-move"
                            disabled={i === 0}
                            onClick={() => move(i, -1)}
                            aria-label={`Move page ${i + 1} earlier`}
                          >
                            {Icon.chevronLeft}
                          </button>
                          <span className="i2p-meta-text" title={e.file.name}>
                            {e.w > 0 ? `${e.w}×${e.h}` : <I2PHelix size={11} className="i2p-meta-helix" />} · {typeLabel(e.file)} · {fmtSize(e.file.size)}
                          </span>
                          <button
                            type="button"
                            className="i2p-move"
                            disabled={i === entries.length - 1}
                            onClick={() => move(i, 1)}
                            aria-label={`Move page ${i + 1} later`}
                          >
                            {Icon.chevronRight}
                          </button>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </>
            )}

            {/* ── Bind bar ── */}
            {n > 0 && (
              <>
                <div className="i2p-bind">
                  <div className="i2p-bind-info">
                    <span className="i2p-bind-line">
                      {n} page{n > 1 ? 's' : ''} · {fmtSize(totalBytes)} on the table
                    </span>
                    <span className="i2p-bind-sub">
                      {autoCrop ? 'Edges trimmed · pages bound in table order' : 'Pages bound in table order'}
                    </span>
                  </div>
                  {phase === 'binding' && progress !== null && (
                    <div className="i2p-progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress}>
                      <div className="i2p-progress-fill" style={{ width: `${progress}%` }} />
                      <span className="i2p-progress-pct">{progress}%</span>
                    </div>
                  )}
                  <button type="button" className="i2p-bind-btn" onClick={bind} disabled={phase === 'binding'}>
                    {phase === 'binding' ? (
                      <>
                        <I2PHelix size={18} />
                        Collating {n} page{n > 1 ? 's' : ''}…
                      </>
                    ) : (
                      <>
                        Bind {n} page{n > 1 ? 's' : ''} to PDF
                        {Icon.arrowRight}
                      </>
                    )}
                  </button>
                  {phase === 'binding' && (
                    <button type="button" className="i2p-cancel-btn" onClick={cancelBind}>
                      Cancel
                    </button>
                  )}
                </div>

                {error && (
                  <div className="i2p-err" role="alert">
                    {Icon.alert}
                    <span>
                      Binding failed — {error}. Your pages are still on the table.
                    </span>
                  </div>
                )}
              </>
            )}
          </>
        )}

        {/* ── The lift ──
            The paper the cursor is carrying: a pointer-transparent clone of the
            grabbed print, so the slot detection below always lands on a real
            tile. Position is written to the node directly (see positionGhost);
            React only mounts and unmounts it. */}
        {ghost && ghostEntry && (
          <div
            className="i2p-ghost-card"
            ref={ghostRef}
            aria-hidden="true"
            style={{ width: ghost.w, height: ghost.h }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={ghostEntry.url} alt="" draggable={false} />
          </div>
        )}

        {/* ── Examine overlay ──
            Lifting a print to the light to look at it: true-ratio, uncropped,
            with only facts the client actually holds (dimensions, type, size).
            Click-scrim or Escape closes; the shell carries the dialog role so
            the table underneath stays the page's own content. */}
        {previewEntry && (
          <div
            className="i2p-lightbox"
            role="dialog"
            aria-modal="true"
            aria-label={`Page ${previewIndex + 1} of ${n}: ${previewEntry.file.name}`}
            onClick={() => setPreviewId(null)}
          >
            <div className="i2p-lightbox-card" onClick={ev => ev.stopPropagation()}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img className="i2p-lightbox-img" src={previewEntry.url} alt={previewEntry.file.name} />
              <div className="i2p-lightbox-meta">
                <span className="i2p-lightbox-frame">Page {previewIndex + 1} / {n}</span>
                <span className="i2p-lightbox-name" title={previewEntry.file.name}>{previewEntry.file.name}</span>
                <span className="i2p-lightbox-facts">
                  {previewEntry.w > 0 ? `${previewEntry.w}×${previewEntry.h} · ` : ''}
                  {typeLabel(previewEntry.file)} · {fmtSize(previewEntry.file.size)}
                </span>
              </div>
              <button
                type="button"
                className="i2p-lightbox-close"
                onClick={() => setPreviewId(null)}
                aria-label="Close preview"
              >
                {Icon.close}
              </button>
            </div>
          </div>
        )}
      </div>
    </>
  )
}
