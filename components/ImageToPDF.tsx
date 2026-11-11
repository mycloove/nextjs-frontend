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
import { useDropzone, type FileRejection } from 'react-dropzone'

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
import {
  DEFAULT_LAYOUT,
  DEFAULT_QUALITY,
  JPEG_QUALITY,
  MARGIN_POINTS,
  placeImage,
  pointsToMillimetres,
  type LayoutOptions,
  type MarginOption,
  type OrientationOption,
  type PageSizeOption,
  type QualityOption,
} from '@/features/image-to-pdf/layout/pageLayout'

/* ─────────────────────────────────────────────────────────────
   Images → PDF — "The Light Table"

   Design concept: this tool's single job is binding loose images
   into one ordered document, exactly like a photographer laying
   prints on a light table before sending the job to print. The
   UI is that table: pages lie on it as the paper they will be
   printed on, carry contact-sheet frame numbers (which ARE the
   future page numbers — entries order == FormData order == page
   order), and get pressed into a stack ("collated") while binding.

   Truth on the table (2026-11-11 pass):
   - Every tile is the real output page. Its paper, orientation,
     margin and the image's place on it come from the same
     `placeImage()` the server engine uses
     (features/image-to-pdf/layout/pageLayout.ts), so what lies on
     the table is what binds. A4/Letter turn landscape for a
     landscape image ("Auto"); "Original" pages take the image's
     shape at a printable size.
   - Intake names every refusal the moment a file arrives — wrong
     type, too large, too many, unreadable — instead of silently
     dropping it. BMP is converted to PNG in the browser (the
     server's decoder cannot read BMP; the old UI accepted it and
     the engine skipped every one). HEIC is converted to JPEG where
     the browser can open it (Safari) and refused by name where it
     cannot.
   - The receipt says what happened to each page: kept
     pixel-exact, compressed, or embedded untouched — and names any
     image the server could not read.
   - An unchanged table is not bound twice: "View the bound PDF"
     returns to the held result without another upload or credit.

   Everything is scoped to this file via the `i2p-` namespace and
   consumes surface-1 global tokens (var(--bg-item), …) plus local
   `--i2p-*` roles defined in both theme blocks below. The identity
   colour is a darkroom-amber "safelight" — this surface's own
   device (D8), refined into fill / line / soft / text roles.

   Interaction: prints are lifted and re-slotted by direct
   manipulation: a paper ghost follows the cursor while the table
   resplices live (insert-and-shift, the merge-pdf tray semantics),
   so the order seen during the drag is the order that ships. A FLIP
   settle rides each reflow, and the chevron buttons are the
   keyboard path, with every move announced. Each page is a button
   that opens the examine dialog (← → between pages). The one
   working mark is a Double Helix — a bound coil, literally this
   tool's job — indeterminate only: the real XHR byte percentage is
   the only progress this tool claims.
   ───────────────────────────────────────────────────────────── */

type Phase = 'editing' | 'binding' | 'bound'
type CropPosition = 'bottom' | 'bottom-right' | 'custom'

interface Entry {
  id: string
  file: File
  url: string
  w: number
  h: number
}

interface EncodingCounts {
  original: number
  jpeg: number
  lossless: number
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
  undo: (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="9 14 4 9 9 4" /><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11" />
    </svg>
  ),
}

/* ── Small formatting helpers ── */
const MB = 1024 * 1024
const fmtSize = (b: number) =>
  b >= MB ? `${(b / MB).toFixed(1)} MB`
  : b >= 1024 ? `${Math.max(1, Math.round(b / 1024))} KB`
  : `${b} B`

const extensionOf = (f: File) => f.name.split('.').pop()?.toLowerCase() ?? ''

const typeLabel = (f: File) => {
  const map: Record<string, string> = {
    jpg: 'JPG', jpeg: 'JPEG', png: 'PNG', webp: 'WEBP', gif: 'GIF', avif: 'AVIF',
  }
  return map[extensionOf(f)] ?? 'IMAGE'
}

const plural = (count: number, one: string, many = `${one}s`) => `${count} ${count === 1 ? one : many}`

/* Mirrors the route's defaults (app/api/image-to-pdf/route.ts). Kept in sync
   so an oversized set is refused in the browser, before any upload begins. */
const MAX_IMAGES = 100
const MAX_FILE_MB = 25
const MAX_TOTAL_MB = 100

/* How a file is taken onto the table. `direct` goes up as it is; `bmp` and
   `heic` are re-encoded in the browser first (see the header). */
type IntakeKind = 'direct' | 'bmp' | 'heic' | 'tiff' | 'svg' | 'other'
const DIRECT_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif'])
const DIRECT_EXTENSIONS = new Set(['jpg', 'jpeg', 'png', 'webp', 'gif', 'avif'])

function classify(file: File): IntakeKind {
  const type = file.type.toLowerCase()
  const ext = extensionOf(file)
  if (DIRECT_TYPES.has(type) || (!type && DIRECT_EXTENSIONS.has(ext))) return 'direct'
  if (type === 'image/bmp' || type === 'image/x-ms-bmp' || ext === 'bmp') return 'bmp'
  if (type === 'image/heic' || type === 'image/heif' || ext === 'heic' || ext === 'heif') return 'heic'
  if (type === 'image/tiff' || ext === 'tif' || ext === 'tiff') return 'tiff'
  if (type === 'image/svg+xml' || ext === 'svg') return 'svg'
  return 'other'
}

const SUPPORTED_SENTENCE = 'JPG, PNG, WebP, AVIF, GIF or BMP'

/** Re-encode a file the browser can open (BMP, HEIC on Safari) into one the server reads. */
const reencodeInBrowser = (file: File, type: 'image/png' | 'image/jpeg'): Promise<File> =>
  new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => {
      try {
        const canvas = document.createElement('canvas')
        canvas.width = img.naturalWidth
        canvas.height = img.naturalHeight
        canvas.getContext('2d')?.drawImage(img, 0, 0)
        canvas.toBlob(blob => {
          URL.revokeObjectURL(url)
          if (!blob) { reject(new Error('encode')); return }
          const base = file.name.replace(/\.[^.]+$/, '') || 'image'
          resolve(new File([blob], `${base}.${type === 'image/png' ? 'png' : 'jpg'}`, { type, lastModified: file.lastModified }))
        }, type, 0.92)
      } catch (e) {
        URL.revokeObjectURL(url)
        reject(e instanceof Error ? e : new Error('encode'))
      }
    }
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('decode')) }
    img.src = url
  })

const PAGE_SIZE_LABELS: Record<PageSizeOption, string> = {
  original: 'Original',
  a4: 'A4',
  letter: 'Letter',
}
const ORIENTATION_LABELS: Record<OrientationOption, string> = {
  auto: 'Auto',
  portrait: 'Portrait',
  landscape: 'Landscape',
}
const MARGIN_LABELS: Record<MarginOption, string> = {
  none: 'None',
  small: 'Small',
  large: 'Large',
}
const QUALITY_LABELS: Record<QualityOption, string> = {
  high: 'High',
  balanced: 'Balanced',
  small: 'Small',
}

/* Each hint states what the choice really does to the bytes and the paper —
   the numbers are the engine's own (pageLayout.ts). */
const QUALITY_HINTS: Record<QualityOption, string> = {
  high: `Sharpest. Photos at ${JPEG_QUALITY.high}% JPEG; screenshots and scans of text stay pixel-exact.`,
  balanced: `Recommended. Photos at ${JPEG_QUALITY.balanced}%; screenshots stay pixel-exact unless that would make the file much larger.`,
  small: `Smallest file. Photos at ${JPEG_QUALITY.small}% and about 200 dpi; fine text may soften.`,
}
const marginHint = (margin: MarginOption) =>
  margin === 'none' ? 'Images run to the edge of the paper.' : `About ${Math.round((MARGIN_POINTS[margin] / 72) * 25.4)} mm of white around each image.`

/* ── Trim geometry — one function for the canvas cut and the preview, so the
   hatched area on a tile is exactly the pixels the cut removes. ── */
interface TrimSettings {
  on: boolean
  position: CropPosition
  pct: number
  right: number
  bottom: number
}

const trimmedSize = (w: number, h: number, t: TrimSettings) => {
  if (!t.on) return { w, h }
  if (t.position === 'bottom') return { w, h: Math.max(1, Math.floor(h * (100 - t.pct) / 100)) }
  if (t.position === 'bottom-right') {
    return { w: Math.max(1, w - Math.floor(w * t.pct / 100)), h: Math.max(1, h - Math.floor(h * t.pct / 100)) }
  }
  return { w: Math.max(w - t.right, 10), h: Math.max(h - t.bottom, 10) }
}

const cropImage = (file: File, trim: TrimSettings): Promise<File> =>
  new Promise((resolve, reject) => {
    const img = document.createElement('img') as HTMLImageElement
    const url = URL.createObjectURL(file)
    img.onload = () => {
      try {
        const { w: cw, h: ch } = trimmedSize(img.width, img.height, trim)
        const canvas = document.createElement('canvas')
        canvas.width = cw; canvas.height = ch
        canvas.getContext('2d')?.drawImage(img, 0, 0, cw, ch, 0, 0, cw, ch)
        canvas.toBlob(blob => {
          URL.revokeObjectURL(url)
          if (!blob) { reject(new Error('Could not trim image')); return }
          // The browser may not encode the source type (GIF) and hands back
          // PNG instead; the file says what it really is.
          resolve(new File([blob], file.name, { type: blob.type || file.type, lastModified: Date.now() }))
        }, file.type, 0.95)
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

  // Watermark / edge-trim state
  const [autoCrop, setAutoCrop] = useState(false)
  const [cropPosition, setCropPosition] = useState<CropPosition>('bottom-right')
  const [cropPercentage, setCropPercentage] = useState(10)
  const [customWidth, setCustomWidth] = useState(200)
  const [customHeight, setCustomHeight] = useState(80)
  // Output — defaults keep the tool's long-standing "one page per image, at
  // its own shape" behaviour (pageLayout.ts DEFAULT_LAYOUT).
  const [pageSize, setPageSize] = useState<PageSizeOption>(DEFAULT_LAYOUT.pageSize)
  const [orientation, setOrientation] = useState<OrientationOption>(DEFAULT_LAYOUT.orientation)
  const [margin, setMargin] = useState<MarginOption>(DEFAULT_LAYOUT.margin)
  const [quality, setQuality] = useState<QualityOption>(DEFAULT_QUALITY)

  // Upload progress + cancellation — real byte progress from the XHR bridge.
  const [progress, setProgress] = useState<number | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  // Intake refusals, named the moment files arrive; and the screen-reader line.
  const [intakeNotes, setIntakeNotes] = useState<string[]>([])
  const [announcement, setAnnouncement] = useState('')
  // "Clear the table" is undoable for a few seconds; the URLs live until then.
  const [clearedCount, setClearedCount] = useState(0)
  const clearedRef = useRef<{ entries: Entry[]; timer: number } | null>(null)

  // Interaction state: direct-manipulation reorder + the examine dialog.
  const [dragId, setDragId] = useState<string | null>(null)
  const [ghost, setGhost] = useState<{ id: string; w: number; h: number; x: number; y: number } | null>(null)
  const [previewId, setPreviewId] = useState<string | null>(null)
  // The finished PDF is held in state, not pushed to disk: the user saves it
  // when they choose and can leave the bound view and return without binding
  // again. These describe the last successful bind, not the live table.
  const [bound, setBound] = useState<{
    blob: Blob
    fileName: string
    pages: number
    bytes: number
    skipped: string[]
    skippedCount: number
    encodings: EncodingCounts | null
    paper: string
    quality: QualityOption
    signature: string
  } | null>(null)
  const dragRef = useRef<{ id: string; x0: number; y0: number; active: boolean } | null>(null)
  const suppressClickRef = useRef(false)
  const ghostRef = useRef<HTMLDivElement | null>(null)
  const grabRef = useRef({ x: 0, y: 0 })
  const tileRefs = useRef(new Map<string, HTMLDivElement>())
  const rectRef = useRef(new Map<string, DOMRect>())
  const dialogRef = useRef<HTMLDialogElement | null>(null)
  const returnFocusRef = useRef<HTMLElement | null>(null)
  const entriesRef = useRef<Entry[]>([])
  entriesRef.current = entries

  const idRef = useRef(0)

  const layout: LayoutOptions = { pageSize, orientation, margin }
  const trim: TrimSettings = { on: autoCrop, position: cropPosition, pct: cropPercentage, right: customWidth, bottom: customHeight }

  /* What the next bind would produce. When it equals the last bind, the held
     PDF is the answer — no second upload, no second credit. */
  const signature = JSON.stringify([
    entries.map(e => e.id),
    layout,
    quality,
    autoCrop ? [cropPosition, cropPercentage, customWidth, customHeight] : null,
  ])
  const unchangedSinceBind = !!bound && bound.signature === signature

  /* Pending undo is settled (URLs released) when it expires, when new images
     arrive, and when the tool unmounts. */
  const settleClear = useCallback(() => {
    const stash = clearedRef.current
    if (!stash) return
    window.clearTimeout(stash.timer)
    stash.entries.forEach(e => URL.revokeObjectURL(e.url))
    clearedRef.current = null
    setClearedCount(0)
  }, [])

  useEffect(() => () => {
    entriesRef.current.forEach(e => URL.revokeObjectURL(e.url))
    const stash = clearedRef.current
    if (stash) {
      window.clearTimeout(stash.timer)
      stash.entries.forEach(e => URL.revokeObjectURL(e.url))
    }
  }, [])

  /* ── Intake: classify, refuse by name, convert what the browser can, then
     read natural dimensions so tiles can draw the real page. ── */
  const addFiles = useCallback(async (list: File[]) => {
    if (!list.length) return
    settleClear()
    const notes: string[] = []
    const ready: File[] = []
    let count = entriesRef.current.length
    let total = entriesRef.current.reduce((sum, e) => sum + e.file.size, 0)

    for (const original of list) {
      const kind = classify(original)
      if (kind === 'tiff') { notes.push(`${original.name}: TIFF can’t be previewed here — save it as PNG or JPG first.`); continue }
      if (kind === 'svg') { notes.push(`${original.name}: SVG is a drawing, not a photo of one — export it as PNG first.`); continue }
      if (kind === 'other') { notes.push(`${original.name} isn’t an image this tool can bind (${SUPPORTED_SENTENCE}).`); continue }
      if (original.size === 0) { notes.push(`${original.name} is empty.`); continue }

      let file = original
      if (kind === 'bmp' || kind === 'heic') {
        try {
          file = await reencodeInBrowser(original, kind === 'bmp' ? 'image/png' : 'image/jpeg')
          if (kind === 'heic') notes.push(`${original.name} was converted to JPEG in your browser.`)
        } catch {
          notes.push(kind === 'heic'
            ? `${original.name}: this browser can’t open HEIC photos. Share it from your phone as JPEG (iPhone: Settings → Camera → Formats → Most Compatible).`
            : `${original.name} couldn’t be opened — it may be damaged.`)
          continue
        }
      }

      if (file.size > MAX_FILE_MB * MB) { notes.push(`${original.name} is ${fmtSize(file.size)} — each image must be under ${MAX_FILE_MB} MB.`); continue }
      if (count >= MAX_IMAGES) { notes.push(`${original.name} wasn’t added — one PDF holds up to ${MAX_IMAGES} images.`); continue }
      if (total + file.size > MAX_TOTAL_MB * MB) { notes.push(`${original.name} wasn’t added — a document can hold up to ${MAX_TOTAL_MB} MB of images.`); continue }
      count += 1
      total += file.size
      ready.push(file)
    }

    setIntakeNotes(notes)
    if (!ready.length) {
      if (notes.length) setAnnouncement(notes.length === 1 ? notes[0] : `${notes.length} files were not added.`)
      return
    }

    const fresh: Entry[] = ready.map(file => ({
      id: `p${++idRef.current}`,
      file,
      url: URL.createObjectURL(file),
      w: 0, h: 0,
    }))
    setEntries(prev => [...prev, ...fresh])
    setAnnouncement(`${plural(fresh.length, 'image')} added. ${plural(count, 'page')} on the table.`)

    for (const e of fresh) {
      const probe = new Image()
      probe.onload = () => setEntries(prev =>
        prev.map(p => (p.id === e.id ? { ...p, w: probe.naturalWidth, h: probe.naturalHeight } : p)))
      // A file that will not decode here will not decode on the server
      // either; say so now instead of spinning its tile forever.
      probe.onerror = () => {
        URL.revokeObjectURL(e.url)
        setEntries(prev => prev.filter(p => p.id !== e.id))
        const note = `${e.file.name} couldn’t be opened — it may be damaged, or in a format this browser can’t show — so it was taken off the table.`
        setIntakeNotes(prev => [...prev, note])
        setAnnouncement(note)
      }
      probe.src = e.url
    }
  }, [settleClear])

  /* Ctrl+V support: pasted screenshots and copied images land on the table
     exactly like dropped ones. Only active while the table is editable. */
  const onPaste = useCallback((files: File[]) => { void addFiles(files) }, [addFiles])
  usePasteFiles(onPaste, phase === 'editing')

  /* Pages may only join the table while it is editable — dropping
     mid-bind or on the "Bound" panel would silently add invisible
     pages to a job that is already in flight. Rejections from the
     picker's filter still reach intake so they are named, not lost. */
  const onDrop = useCallback((accepted: File[], rejected: FileRejection[]) => {
    if (phase !== 'editing') return
    void addFiles([...accepted, ...rejected.map(r => r.file)])
  }, [phase, addFiles])

  /* noClick/noKeyboard: the whole module is the drag surface, but
     clicks must reach the tiles' own buttons (reorder / remove /
     view) without opening the file picker. The empty zone and the
     Browse buttons call open() explicitly. */
  const { getRootProps, getInputProps, isDragActive, open } = useDropzone({
    onDrop,
    accept: { 'image/*': ['.jpeg', '.jpg', '.png', '.gif', '.bmp', '.webp', '.avif', '.heic', '.heif'] },
    noClick: true,
    noKeyboard: true,
  })

  /* Keyboard moves keep focus on the control that made them; if that control
     just became disabled (the page reached an end), focus takes the other
     arrow on the same page instead of falling to <body>. */
  const focusMoveControl = (id: string, preferred: 'earlier' | 'later') => {
    requestAnimationFrame(() => {
      const tile = tileRefs.current.get(id)
      const want = tile?.querySelector<HTMLButtonElement>(`[data-move="${preferred}"]`)
      const other = tile?.querySelector<HTMLButtonElement>(`[data-move="${preferred === 'earlier' ? 'later' : 'earlier'}"]`)
      ;(want && !want.disabled ? want : other)?.focus()
    })
  }

  const move = (i: number, dir: -1 | 1) => {
    const j = i + dir
    if (j < 0 || j >= entries.length) return
    const id = entries[i].id
    reorder(i, j)
    setAnnouncement(`Page ${i + 1} moved to position ${j + 1} of ${entries.length}.`)
    focusMoveControl(id, dir === -1 ? 'earlier' : 'later')
  }

  const removeAt = (i: number) => {
    const target = entries[i]
    if (!target) return
    URL.revokeObjectURL(target.url)
    const next = entries.filter((_, idx) => idx !== i)
    setEntries(next)
    setAnnouncement(`Page ${i + 1} removed. ${plural(next.length, 'page')} on the table.`)
    // Focus lands on the page that took this slot, else the one before it.
    const neighbour = next[i] ?? next[i - 1]
    requestAnimationFrame(() => {
      if (neighbour) tileRefs.current.get(neighbour.id)?.querySelector<HTMLButtonElement>('.i2p-view')?.focus()
    })
  }

  const clearTable = () => {
    settleClear()
    const stash = entries
    setEntries([])
    setError(null)
    setIntakeNotes([])
    setClearedCount(stash.length)
    setAnnouncement(`Table cleared — ${plural(stash.length, 'page')} removed. Undo is available for 10 seconds.`)
    clearedRef.current = { entries: stash, timer: window.setTimeout(settleClear, 10_000) }
  }

  const undoClear = () => {
    const stash = clearedRef.current
    if (!stash) return
    window.clearTimeout(stash.timer)
    clearedRef.current = null
    setEntries(stash.entries)
    setClearedCount(0)
    setAnnouncement(`${plural(stash.entries.length, 'page')} put back on the table.`)
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
     a click, and the page button opens the examine dialog. */
  const captureRects = () => {
    const m = new Map<string, DOMRect>()
    tileRefs.current.forEach((el, id) => m.set(id, el.getBoundingClientRect()))
    rectRef.current = m
  }

  function reorder(from: number, to: number) {
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

  /* The press is followed at window level, not through pointer capture: a live
     reorder moves the grabbed tile's DOM node, and moving a node silently
     drops its capture — the drag used to go dead mid-gesture. */
  const dragListenersRef = useRef<(() => void) | null>(null)

  const followPointer = (clientX: number, clientY: number) => {
    const d = dragRef.current
    if (!d) return
    if (!d.active) {
      if (Math.abs(clientX - d.x0) < 6 && Math.abs(clientY - d.y0) < 6) return
      // Lift: size the ghost from the very paper the user grabbed, so it is the
      // same print at the same scale, and record where within it they held it.
      const tileEl = tileRefs.current.get(d.id)
      const paper = tileEl?.querySelector('.i2p-page') as HTMLElement | null
      const rect = paper?.getBoundingClientRect()
      const w = rect?.width ?? 120
      const h = rect?.height ?? 160
      grabRef.current = rect
        ? { x: clientX - rect.left, y: clientY - rect.top }
        : { x: w / 2, y: h / 2 }
      d.active = true
      setDragId(d.id)
      setGhost({ id: d.id, w, h, x: clientX - grabRef.current.x, y: clientY - grabRef.current.y })
    }
    positionGhost(clientX, clientY)
    // Live splice: whichever slot the pointer is over becomes the drag's home,
    // and every tile between reflows by one. The ghost is pointer-transparent,
    // so the element under the cursor is always a real tile.
    const el = document.elementFromPoint(clientX, clientY) as HTMLElement | null
    const tile = el?.closest('[data-i2p-index]') as HTMLElement | null
    if (!tile?.dataset.i2pIndex) return
    const overIndex = Number(tile.dataset.i2pIndex)
    const currentIndex = entriesRef.current.findIndex(x => x.id === d.id)
    if (currentIndex !== -1 && overIndex !== currentIndex) reorder(currentIndex, overIndex)
  }

  const finishDrag = (cancelled: boolean) => {
    dragListenersRef.current?.()
    dragListenersRef.current = null
    const d = dragRef.current
    dragRef.current = null
    if (!d?.active) return
    // The order is already correct (it was applied live) — put the paper down,
    // close the gap, and keep the click that follows from opening the dialog.
    suppressClickRef.current = !cancelled
    // Only the click that ends this very gesture is swallowed.
    window.setTimeout(() => { suppressClickRef.current = false }, 0)
    setDragId(null)
    setGhost(null)
    const list = entriesRef.current
    const index = list.findIndex(x => x.id === d.id)
    if (!cancelled && index !== -1) setAnnouncement(`Page moved to position ${index + 1} of ${list.length}.`)
  }

  const startDrag = (e: ReactPointerEvent<HTMLDivElement>, index: number) => {
    suppressClickRef.current = false
    if (phase !== 'editing') return
    // Mouse only: on touch a vertical swipe must stay a page scroll.
    if (e.pointerType !== 'mouse' || e.button !== 0) return
    // The page itself is a button (it opens the examine dialog) and is the
    // grip; the small controls around it are not.
    if ((e.target as HTMLElement).closest('button:not(.i2p-view)')) return
    const entry = entries[index]
    if (!entry) return
    dragListenersRef.current?.()
    dragRef.current = { id: entry.id, x0: e.clientX, y0: e.clientY, active: false }
    const onMove = (ev: PointerEvent) => followPointer(ev.clientX, ev.clientY)
    const onUp = () => finishDrag(false)
    const onCancel = () => finishDrag(true)
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onCancel)
    dragListenersRef.current = () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onCancel)
    }
  }

  useEffect(() => () => dragListenersRef.current?.(), [])

  /* Seat the lifted paper under the cursor the instant it mounts. After this,
     positionGhost owns the transform directly, so a table re-render from a live
     reorder can never snap the ghost back to its start point. */
  useEffect(() => {
    const node = ghostRef.current
    if (!node || !ghost) return
    node.style.transform = `translate3d(${ghost.x}px, ${ghost.y}px, 0) rotate(-2deg)`
  }, [ghost])

  /* ── The examine dialog ──
     A native modal <dialog>: focus is held inside, Esc closes it, and focus
     returns to the page that opened it. ← → walk the table. */
  const openPreview = (id: string, trigger: HTMLElement | null) => {
    if (suppressClickRef.current) { suppressClickRef.current = false; return }
    returnFocusRef.current = trigger
    setPreviewId(id)
  }

  const closePreview = useCallback(() => setPreviewId(null), [])

  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return
    if (previewId && !dialog.open) {
      dialog.showModal()
      // Start on the close control, not on whichever arrow happens to be
      // first and enabled; ← → work from anywhere inside.
      dialog.querySelector<HTMLButtonElement>('.i2p-lightbox-close')?.focus()
    }
    if (!previewId && dialog.open) dialog.close()
  }, [previewId])

  useEffect(() => {
    if (previewId) return
    const target = returnFocusRef.current
    returnFocusRef.current = null
    if (target?.isConnected) target.focus()
  }, [previewId])

  // A page removed or cleared while open closes the dialog with it.
  useEffect(() => {
    if (previewId && !entries.some(e => e.id === previewId)) setPreviewId(null)
  }, [entries, previewId])

  /* The download tells the truth about what it is: the job is
     named after its first page, the way a print job is, and carries
     the mycloove brand prefix on every saved file. */
  const boundName = () => {
    const base = entries[0].file.name.replace(/\.[^.]+$/, '') || 'pages'
    return entries.length === 1 ? `mycloove_${base}.pdf` : `mycloove_${base}-and-${entries.length - 1}-more.pdf`
  }

  const paperSentence = () => {
    if (pageSize === 'original') return 'pages follow each image’s shape'
    const turn = orientation === 'auto' ? 'turned to suit each image' : orientation
    return `${PAGE_SIZE_LABELS[pageSize]}, ${turn}, ${margin === 'none' ? 'no margin' : `${MARGIN_LABELS[margin].toLowerCase()} margin`}`
  }

  const bind = async () => {
    if (!entries.length || phase === 'binding') return
    if (unchangedSinceBind) { setPhase('bound'); return }
    if (entries.length > MAX_IMAGES) {
      setError(`Up to ${MAX_IMAGES} images can be bound at once — this set has ${entries.length}.`)
      return
    }
    const oversized = entries.find(e => e.file.size > MAX_FILE_MB * MB)
    if (oversized) {
      setError(`${oversized.file.name} is ${fmtSize(oversized.file.size)} — each image must be under ${MAX_FILE_MB} MB.`)
      return
    }
    const total = entries.reduce((sum, e) => sum + e.file.size, 0)
    if (total > MAX_TOTAL_MB * MB) {
      setError(`This set is ${fmtSize(total)} — the limit is ${MAX_TOTAL_MB} MB per document.`)
      return
    }
    setPhase('binding')
    setError(null)
    setIntakeNotes([])
    setProgress(0)
    setAnnouncement(`Binding ${plural(entries.length, 'page')}.`)
    const abort = new AbortController()
    abortRef.current = abort
    try {
      const formData = new FormData()
      for (const e of entries) {
        formData.append('images', autoCrop ? await cropImage(e.file, trim) : e.file)
      }
      formData.append('pageSize', pageSize)
      formData.append('orientation', orientation)
      formData.append('margin', margin)
      formData.append('quality', quality)
      // Real upload progress + a working cancel, via the XHR bridge.
      const res = await uploadWithProgress('/api/images-to-pdf', formData, {
        onProgress: setProgress,
        signal: abort.signal,
      })
      if (!res.ok) {
        throw new Error(await getApiErrorMessage(res, 'Binding failed'))
      }
      const blob = await res.blob()
      const name = boundName()
      const header = (key: string) => res.headers.get(key)
      const count = (key: string) => {
        const value = Number.parseInt(header(key) ?? '', 10)
        return Number.isFinite(value) ? value : null
      }
      // The engine skips images it cannot decode and says so in headers; the
      // page count shown must be the document's, not the number of tiles sent.
      const skippedCount = count('X-Skipped-Count') ?? 0
      let skipped: string[] = []
      try {
        const raw = header('X-Skipped-Names')
        if (raw) skipped = (JSON.parse(decodeURIComponent(raw)) as unknown[]).filter((n): n is string => typeof n === 'string')
      } catch { /* names are a courtesy; the count above is the fact */ }
      const pages = count('X-Page-Count') ?? Math.max(0, entries.length - skippedCount)
      const original = count('X-Encoded-Original')
      const jpeg = count('X-Encoded-Jpeg')
      const lossless = count('X-Encoded-Lossless')
      // Hold the document instead of auto-saving it: the download fires only
      // when the user asks, so the result stays available.
      setBound({
        blob,
        fileName: name,
        pages,
        bytes: blob.size,
        skipped,
        skippedCount,
        encodings: original !== null && jpeg !== null && lossless !== null ? { original, jpeg, lossless } : null,
        paper: paperSentence(),
        quality,
        signature,
      })
      addRecentConversion({
        toolId: 'image-to-pdf',
        label: 'Images to PDF',
        filename: name,
        sizeBytes: blob.size,
      })
      setAnnouncement(`Bound: ${plural(pages, 'page')}, ${fmtSize(blob.size)}.${skippedCount ? ` ${plural(skippedCount, 'image')} could not be read and ${skippedCount === 1 ? 'was' : 'were'} left out.` : ''}`)
      setPhase('bound')
    } catch (e) {
      if (e instanceof Error && e.name === 'ApiClientError' && /cancelled/i.test(e.message)) {
        setError(null) // A deliberate cancel is not an error — pages stay put.
        setAnnouncement('Binding cancelled. Your pages are still on the table.')
      } else {
        const reason = (e instanceof Error ? e.message : '').replace(/[.\s]+$/, '')
        setError(reason ? `Binding failed: ${reason}.` : 'Binding failed — please try again.')
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
    if (bound) downloadBlob(bound.blob, bound.fileName || 'pages.pdf')
  }

  const reset = () => {
    settleClear()
    entries.forEach(e => URL.revokeObjectURL(e.url))
    setEntries([])
    setSettled(new Set())
    setPhase('editing')
    setError(null)
    setIntakeNotes([])
    setPreviewId(null)
    setDragId(null)
    setGhost(null)
    setBound(null)
  }

  const totalBytes = entries.reduce((s, e) => s + e.file.size, 0)
  const n = entries.length

  const previewEntry = previewId ? entries.find(e => e.id === previewId) ?? null : null
  const previewIndex = previewEntry ? entries.indexOf(previewEntry) : -1
  const ghostEntry = ghost ? entries.find(e => e.id === ghost.id) ?? null : null

  const stepPreview = (dir: -1 | 1) => {
    if (previewIndex === -1) return
    const next = entries[previewIndex + dir]
    if (next) setPreviewId(next.id)
  }

  const cropSentence =
    cropPosition === 'bottom-right'
      ? `bottom ${cropPercentage}% and right ${cropPercentage}% of every image`
      : cropPosition === 'bottom'
      ? `the bottom ${cropPercentage}% of every image`
      : `${customWidth}px from the right and ${customHeight}px from the bottom of every image`

  /* ── The page as it will print ──
     The same placeImage() the engine runs decides the paper and where the
     image sits on it. With a trim on, the whole image is drawn with the strip
     to be removed hatched — seeing the cut matters more than the few percent
     the kept part grows by on a fixed page. Orientation is still decided by
     the trimmed size, exactly as the engine will decide it. */
  const pageGeometry = (e: Entry) => {
    if (!e.w || !e.h) return { ar: 0.75, left: 0, top: 0, width: 100, height: 100, page: null }
    const kept = trimmedSize(e.w, e.h, trim)
    const resolved: LayoutOptions = pageSize !== 'original' && orientation === 'auto'
      ? { ...layout, orientation: kept.w > kept.h ? 'landscape' : 'portrait' }
      : layout
    const page = placeImage(resolved, { width: e.w, height: e.h })
    return {
      ar: page.width / page.height,
      left: (page.image.x / page.width) * 100,
      top: ((page.height - page.image.y - page.image.height) / page.height) * 100,
      width: (page.image.width / page.width) * 100,
      height: (page.image.height / page.height) * 100,
      page,
    }
  }

  const cutFor = (e: Entry) => {
    const style: CSSProperties =
      cropPosition === 'custom'
        ? ({ '--cut-r': Math.min(1, customWidth / (e.w || 1)), '--cut-b': Math.min(1, customHeight / (e.h || 1)) } as CSSProperties)
        : ({ '--cut': cropPercentage } as CSSProperties)
    const className =
      cropPosition === 'custom' ? 'i2p-cut--custom'
      : cropPosition === 'bottom' ? 'i2p-cut--bottom'
      : 'i2p-cut--corner'
    return { style, className }
  }

  const renderPaper = (e: Entry) => {
    const geo = pageGeometry(e)
    const cut = cutFor(e)
    return (
      <div className="i2p-page" style={{ '--ar': geo.ar } as CSSProperties}>
        <div
          className="i2p-print"
          style={{ left: `${geo.left}%`, top: `${geo.top}%`, width: `${geo.width}%`, height: `${geo.height}%` }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={e.url} alt="" draggable={false} />
          {autoCrop && e.w > 0 && (
            <span className={`i2p-cut ${cut.className}`} style={cut.style} aria-hidden="true" />
          )}
        </div>
      </div>
    )
  }

  const paperFacts = (e: Entry) => {
    const page = pageGeometry(e).page
    if (!page) return 'Reading the image…'
    if (pageSize === 'original') return 'The page takes this image’s shape'
    const turned = page.width > page.height ? 'landscape' : 'portrait'
    return `${PAGE_SIZE_LABELS[pageSize]} ${turned} · ${pointsToMillimetres(page.width)} × ${pointsToMillimetres(page.height)} mm`
  }

  const encodingSentence = (enc: EncodingCounts, q: QualityOption) => {
    const parts: string[] = []
    if (enc.lossless) parts.push(`${enc.lossless} kept pixel-exact`)
    if (enc.jpeg) parts.push(`${enc.jpeg} compressed as JPEG at ${JPEG_QUALITY[q]}%`)
    if (enc.original) parts.push(`${enc.original} embedded untouched`)
    return parts.join(' · ')
  }

  const outputBadge = pageSize === 'original'
    ? `${PAGE_SIZE_LABELS[pageSize]} · ${QUALITY_LABELS[quality]}`
    : `${PAGE_SIZE_LABELS[pageSize]} · ${ORIENTATION_LABELS[orientation]} · ${QUALITY_LABELS[quality]}`

  /* One segmented radio group. Real radios (visually hidden, still focusable)
     give the native keyboard model: Tab into the group, arrows to choose. */
  const segment = <T extends string>(
    name: string,
    legend: string,
    value: T,
    options: readonly T[],
    labels: Record<T, string>,
    onChange: (next: T) => void,
    hint: string,
  ) => (
    <fieldset className="i2p-field">
      <legend className="i2p-sub-label">{legend}</legend>
      <div className="i2p-seg">
        {options.map(option => (
          <label key={option} className="i2p-seg-opt">
            <input
              type="radio"
              name={name}
              value={option}
              checked={value === option}
              onChange={() => onChange(option)}
            />
            <span>{labels[option]}</span>
          </label>
        ))}
      </div>
      <p className="i2p-field-hint">{hint}</p>
    </fieldset>
  )

  const progressLabel = progress === null ? '' : progress < 100 ? `Uploading ${progress}%` : 'Binding on the server…'

  return (
    <>
      <style>{`
        /* ── Local palette (both themes) ───────────────────────
           Darkroom safelight amber is this tool's identity (D8),
           refined into roles: fill (--i2p-bind-bg), line, soft wash,
           and a text role that holds 4.5:1 on paper. Structural
           chrome stays on surface-1 tokens so both themes hold. */
        .i2p {
          --i2p-amber:        #ffb454;   /* icons, focus ring, marks */
          --i2p-amber-text:   #ffb454;   /* amber used as text */
          --i2p-amber-soft:   rgba(255, 180, 84, 0.12);
          --i2p-amber-line:   rgba(255, 180, 84, 0.38);
          --i2p-bind-bg:      #f2a93b;   /* solid in both themes */
          --i2p-bind-ink:     #241703;
          --i2p-paper-edge:   rgba(0, 0, 0, 0.4);
          --i2p-paper-shadow: 0 3px 14px rgba(0, 0, 0, 0.4), 0 1px 3px rgba(0, 0, 0, 0.32);
          --i2p-checker:      rgba(255, 255, 255, 0.03);
          --i2p-danger-text:  #ff8d84;
          --i2p-danger-bg:    rgba(255, 90, 80, 0.08);
          --i2p-danger-bg-hover: rgba(255, 90, 80, 0.14);
          --i2p-danger-line:  rgba(255, 90, 80, 0.24);
          --i2p-mark-back:    rgba(255, 255, 255, 0.08);
          --i2p-mark-line:    rgba(255, 255, 255, 0.16);
          --i2p-mark-text:    rgba(0, 0, 0, 0.22);
          --i2p-ease:   cubic-bezier(0.16, 1, 0.3, 1);
          --i2p-spring: cubic-bezier(0.34, 1.56, 0.64, 1);
          --i2p-state:  cubic-bezier(0.4, 0, 0.2, 1);
          display: flex; flex-direction: column; gap: 16px;
        }
        [data-theme='light'] .i2p {
          --i2p-amber:        #a86a0d;
          /* #a86a0d text measured 4.44:1 on white; this step holds AA. */
          --i2p-amber-text:   #96600c;
          --i2p-amber-soft:   rgba(190, 120, 14, 0.09);
          --i2p-amber-line:   rgba(190, 120, 14, 0.34);
          --i2p-paper-edge:   rgba(0, 0, 0, 0.12);
          --i2p-paper-shadow: 0 2px 10px rgba(28, 20, 6, 0.14), 0 1px 3px rgba(28, 20, 6, 0.08);
          --i2p-checker:      rgba(0, 0, 0, 0.024);
          --i2p-danger-text:  #b3261e;
          --i2p-danger-bg:    rgba(179, 38, 30, 0.06);
          --i2p-danger-bg-hover: rgba(179, 38, 30, 0.11);
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
        .i2p-sr {
          position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px;
          overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; border: 0;
        }

        /* ── Empty state: the invitation ───────────────────────
           No template dashed-box-with-icon-ring. Ghost pages
           fanned on a table invite the user to lay theirs down. */
        .i2p-zone {
          position: relative;
          border: 1px solid var(--border-base);
          border-radius: 14px;
          padding: 48px 24px 40px;
          display: flex; flex-direction: column; align-items: center; text-align: center;
          cursor: pointer;
          transition: border-color 0.2s var(--i2p-ease), background 0.2s var(--i2p-ease), box-shadow 0.2s var(--i2p-ease);
        }
        .i2p-zone:hover { border-color: var(--i2p-amber-line); background: var(--bg-item); }
        .i2p.is-over .i2p-zone {
          border-color: var(--i2p-amber);
          background: var(--i2p-amber-soft);
          box-shadow: 0 0 0 1px var(--i2p-amber-line), 0 14px 44px rgba(255, 180, 84, 0.1);
        }

        .i2p-ghosts { position: relative; width: 168px; height: 128px; margin-bottom: 24px; }
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
          transition: rotate 0.36s var(--i2p-spring), translate 0.36s var(--i2p-spring), border-color 0.2s;
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
          margin: 0 0 8px;
        }
        .i2p-zone-sub {
          font-size: 13px; line-height: 1.6;
          color: var(--text-muted);
          max-width: 46ch;
          margin: 0 0 20px;
        }
        .i2p-chips { display: flex; flex-wrap: wrap; gap: 6px; justify-content: center; margin-top: 20px; }
        .i2p-chip {
          font-family: ui-monospace, 'Cascadia Code', monospace;
          font-size: 12px; font-weight: 600; letter-spacing: 0.4px;
          padding: 2px 10px; border-radius: 999px;
          background: var(--bg-item);
          border: 1px solid var(--border-base);
          color: var(--text-muted);
        }
        .i2p-zone-limits {
          margin: 12px 0 0;
          font-size: 12px; color: var(--text-muted);
          font-variant-numeric: tabular-nums;
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
          transition: transform 0.12s var(--i2p-ease), box-shadow 0.12s var(--i2p-ease);
        }
        .i2p-browse-btn:hover { transform: translateY(-1px); box-shadow: 0 6px 22px rgba(242, 169, 59, 0.36); }
        .i2p-browse-btn:active { transform: scale(0.97); transition-duration: 0.08s; }
        .i2p-browse-btn--ghost {
          background: transparent;
          color: var(--i2p-amber-text);
          border: 1px solid var(--i2p-amber-line);
          box-shadow: none;
          padding: 8px 14px;
        }
        .i2p-browse-btn--ghost:hover { background: var(--i2p-amber-soft); box-shadow: none; }

        /* ── Loaded: the add-rail (the table stays open) ── */
        .i2p-rail {
          display: flex; align-items: center; gap: 12px; flex-wrap: wrap;
          padding: 12px 16px;
          border: 1px dashed var(--border-base);
          border-radius: 14px;
          transition: border-color 0.2s var(--i2p-ease), background 0.2s var(--i2p-ease);
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
          border-radius: 10px;
          color: var(--i2p-amber);
          background: var(--i2p-amber-soft);
          border: 1px solid var(--i2p-amber-line);
        }
        .i2p-rail-text { font-size: 13px; color: var(--text-muted); line-height: 1.5; flex: 1; min-width: 180px; }
        .i2p-rail-text b { color: var(--text-secondary); font-weight: 600; }

        /* ── Intake notes and the clear-undo ──
           Refusals are named in the refusal colour and stay until
           dismissed or replaced by the next drop — never a toast. */
        .i2p-note, .i2p-err {
          display: flex; align-items: flex-start; gap: 10px;
          padding: 12px 14px;
          border-radius: 10px;
          background: var(--i2p-danger-bg);
          border: 1px solid var(--i2p-danger-line);
          color: var(--i2p-danger-text);
          font-size: 13px; line-height: 1.55;
        }
        .i2p-note svg, .i2p-err svg { flex-shrink: 0; margin-top: 2px; }
        .i2p-note ul { margin: 0; padding: 0; list-style: none; flex: 1; display: grid; gap: 4px; overflow-wrap: anywhere; }
        .i2p-note-x {
          width: 24px; height: 24px; flex-shrink: 0;
          display: flex; align-items: center; justify-content: center;
          border-radius: 6px; border: 0;
          background: transparent; color: inherit;
          cursor: pointer;
        }
        .i2p-note-x:hover { background: var(--i2p-danger-bg-hover); }
        .i2p-err--receipt { text-align: left; margin-top: 16px; max-width: 60ch; }
        .i2p-undo {
          display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap;
          padding: 8px 8px 8px 16px;
          border-radius: 10px;
          border: 1px solid var(--border-base);
          background: var(--bg-item);
          font-size: 13px; color: var(--text-secondary);
        }

        /* ── Sidecar panels: trim, output ── */
        .i2p-panel {
          background: var(--bg-item);
          border: 1px solid var(--border-base);
          border-radius: 14px;
          overflow: hidden;
        }
        .i2p-panel-head {
          display: flex; align-items: center; gap: 12px;
          width: 100%;
          padding: 12px 16px;
          cursor: pointer;
          user-select: none;
          /* Reset so the head can be a real <button> (keyboard-accessible trim
             toggle) without the UA button chrome; the panel supplies the frame. */
          font: inherit; text-align: left;
          background: transparent; border: 0; color: inherit;
          transition: background 0.12s var(--i2p-state);
        }
        .i2p-panel-head:hover { background: var(--bg-item-hover); }
        /* A panel with nothing to toggle keeps the same head rhythm but
           never reads as clickable. */
        .i2p-panel-head--static { cursor: default; }
        .i2p-panel-head--static:hover { background: transparent; }
        .i2p-toggle-track {
          width: 36px; height: 20px; flex-shrink: 0;
          border-radius: 999px;
          border: 1.5px solid var(--text-muted);
          background: var(--bg-item);
          position: relative;
          transition: background 0.2s var(--i2p-state), border-color 0.2s var(--i2p-state);
        }
        .i2p-toggle-track.on { background: var(--i2p-bind-bg); border-color: transparent; }
        .i2p-toggle-thumb {
          position: absolute; top: 2px; left: 2px;
          width: 13px; height: 13px; border-radius: 50%;
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
          font-size: 12px; font-weight: 700; letter-spacing: 0.4px;
          padding: 2px 10px; border-radius: 999px;
          background: var(--i2p-amber-soft);
          border: 1px solid var(--i2p-amber-line);
          color: var(--i2p-amber-text);
          white-space: nowrap;
        }
        .i2p-panel-body {
          padding: 16px;
          display: flex; flex-direction: column; gap: 16px;
          border-top: 1px solid var(--border-base);
        }
        .i2p-output {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
          gap: 20px 24px;
        }

        .i2p-field { border: 0; margin: 0; padding: 0; min-width: 0; }
        .i2p-sub-label {
          font-size: 12px; font-weight: 700; letter-spacing: 0.8px; text-transform: uppercase;
          color: var(--text-muted);
          display: block; margin-bottom: 8px; padding: 0;
        }
        .i2p-field-hint {
          margin: 8px 0 0;
          font-size: 12px; line-height: 1.5;
          color: var(--text-muted);
        }

        /* Segmented choice: real radios, visually hidden but focusable, so the
           group keeps the native keyboard model (Tab in, arrows to choose). */
        .i2p-seg {
          display: inline-flex; flex-wrap: wrap; gap: 2px;
          padding: 3px;
          border-radius: 10px;
          background: var(--bg-card);
          border: 1px solid var(--border-base);
        }
        .i2p-seg-opt { position: relative; display: block; }
        .i2p-seg-opt input {
          position: absolute; inset: 0;
          width: 100%; height: 100%; margin: 0;
          opacity: 0; cursor: pointer;
        }
        .i2p-seg-opt span {
          display: block;
          padding: 6px 12px;
          border-radius: 7px;
          font-size: 13px; font-weight: 600;
          color: var(--text-muted);
          transition: background 0.12s var(--i2p-state), color 0.12s var(--i2p-state);
        }
        .i2p-seg-opt:hover span { color: var(--text-primary); background: var(--bg-item-hover); }
        .i2p-seg-opt input:checked + span {
          color: var(--i2p-amber-text);
          background: var(--i2p-amber-soft);
          box-shadow: inset 0 0 0 1px var(--i2p-amber-line);
        }
        .i2p-seg-opt input:focus-visible + span { outline: 2px solid var(--i2p-amber); outline-offset: 2px; }

        .i2p-radio-group { display: flex; flex-direction: column; gap: 6px; }
        .i2p-radio-row {
          position: relative;
          display: flex; align-items: center; gap: 10px;
          padding: 8px 12px;
          border-radius: 10px;
          border: 1px solid var(--border-base);
          background: var(--bg-card);
          cursor: pointer;
          transition: border-color 0.12s var(--i2p-state), background 0.12s var(--i2p-state);
          user-select: none;
        }
        /* The radio stays in the accessibility tree and the tab order; the
           drawn dot is its face. */
        .i2p-radio-row input {
          position: absolute; inset: 0;
          width: 100%; height: 100%; margin: 0;
          opacity: 0; cursor: pointer;
        }
        .i2p-radio-row:has(input:focus-visible) { outline: 2px solid var(--i2p-amber); outline-offset: 2px; }
        .i2p-radio-row:hover { background: var(--bg-item-hover); }
        .i2p-radio-row.selected {
          border-color: var(--i2p-amber-line);
          background: var(--i2p-amber-soft);
        }
        .i2p-radio-dot {
          width: 16px; height: 16px; border-radius: 50%;
          border: 1.5px solid var(--text-muted);
          display: flex; align-items: center; justify-content: center;
          flex-shrink: 0;
          transition: border-color 0.12s var(--i2p-state);
        }
        .i2p-radio-row.selected .i2p-radio-dot { border-color: var(--i2p-amber); }
        .i2p-radio-inner {
          width: 8px; height: 8px; border-radius: 50%;
          background: var(--i2p-amber);
          transform: scale(0);
          transition: transform 0.12s var(--i2p-ease);
        }
        .i2p-radio-row.selected .i2p-radio-inner { transform: scale(1); }
        .i2p-radio-text { font-size: 13px; font-weight: 500; color: var(--text-secondary); }
        .i2p-radio-hint { font-size: 12px; color: var(--text-muted); margin-left: auto; text-align: right; }

        .i2p-select {
          background: var(--bg-card);
          border: 1px solid var(--border-base);
          border-radius: 8px;
          padding: 8px 28px 8px 10px;
          font-size: 13px;
          color: var(--text-primary);
          cursor: pointer;
          transition: border-color 0.12s var(--i2p-state);
          -webkit-appearance: none; appearance: none;
          background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6' viewBox='0 0 10 6'%3E%3Cpath d='M0 0l5 6 5-6z' fill='%23888'/%3E%3C/svg%3E");
          background-repeat: no-repeat; background-position: right 10px center;
        }
        .i2p-select:hover { border-color: var(--i2p-amber-line); }
        .i2p-select option { background: var(--bg-card); color: var(--text-primary); }

        .i2p-custom-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
        .i2p-field-label { display: block; font-size: 12px; color: var(--text-muted); margin-bottom: 4px; }
        .i2p-number-input {
          width: 100%;
          background: var(--bg-card);
          border: 1px solid var(--border-base);
          border-radius: 8px;
          padding: 8px 10px;
          font-size: 13px;
          color: var(--text-primary);
          font-variant-numeric: tabular-nums;
          transition: border-color 0.12s var(--i2p-state);
        }
        .i2p-number-input:hover { border-color: var(--i2p-amber-line); }

        .i2p-info {
          display: flex; align-items: flex-start; gap: 8px;
          padding: 10px 12px;
          border-radius: 10px;
          background: var(--i2p-amber-soft);
          border: 1px solid var(--i2p-amber-line);
          font-size: 12px; line-height: 1.55;
          color: var(--i2p-amber-text);
        }
        .i2p-info svg { flex-shrink: 0; margin-top: 2px; }

        /* ── The table ── */
        .i2p-table-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
        .i2p-table-title {
          font-family: 'Manrope', sans-serif;
          font-size: 14px; font-weight: 700;
          color: var(--text-primary);
          display: flex; align-items: center; gap: 8px;
          margin: 0;
        }
        .i2p-count-badge {
          font-family: ui-monospace, 'Cascadia Code', monospace;
          font-size: 12px; font-weight: 700;
          padding: 2px 8px; border-radius: 999px;
          background: var(--i2p-amber-soft);
          border: 1px solid var(--i2p-amber-line);
          color: var(--i2p-amber-text);
          font-variant-numeric: tabular-nums;
        }
        .i2p-clear-btn {
          display: flex; align-items: center; gap: 6px;
          font-size: 12px; font-weight: 500;
          color: var(--text-muted);
          padding: 6px 12px; border-radius: 8px;
          border: 1px solid var(--border-base);
          background: transparent;
          cursor: pointer;
          transition: color 0.12s var(--i2p-state), background 0.12s var(--i2p-state), border-color 0.12s var(--i2p-state);
        }
        .i2p-clear-btn:hover:not(:disabled) {
          color: var(--i2p-danger-text);
          background: var(--i2p-danger-bg);
          border-color: var(--i2p-danger-line);
        }
        .i2p-clear-btn:disabled { opacity: 0.5; cursor: progress; }

        /* The light-table surface itself: a whisper of the
           transparency checkerboard says "this is a viewing
           surface", nothing more. */
        .i2p-grid {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
          gap: 12px;
          margin: 0;
          padding: 16px;
          list-style: none;
          border: 1px solid var(--border-base);
          border-radius: 14px;
          background: repeating-conic-gradient(var(--i2p-checker) 0% 25%, transparent 0% 50%) 0 0 / 18px 18px;
        }
        .i2p-slot { min-width: 0; margin: 0; padding: 0; }

        .i2p-tile {
          display: grid;
          grid-template-rows: auto 1fr auto;
          row-gap: 8px;
          height: 232px;
          padding: 8px;
          border-radius: 10px;
          background: var(--bg-item);
          border: 1px solid transparent;
          user-select: none;
          transition: border-color 0.12s var(--i2p-state), background 0.12s var(--i2p-state), transform 0.36s var(--i2p-ease), opacity 0.36s var(--i2p-ease);
        }
        .i2p-tile:hover { border-color: var(--border-base); background: var(--bg-item-hover); }
        .i2p-tile--new {
          animation: i2p-tile-in 0.36s var(--i2p-spring) backwards;
          animation-delay: var(--d, 0ms);
        }

        .i2p-tile-top { display: flex; align-items: center; justify-content: space-between; height: 24px; }
        .i2p-frame {
          font-family: ui-monospace, 'Cascadia Code', monospace;
          font-size: 12px; font-weight: 600; letter-spacing: 1px;
          color: var(--text-muted);
          font-variant-numeric: tabular-nums;
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
          width: 24px; height: 24px;
          border-radius: 50%;
          border: 1px solid var(--border-base);
          background: var(--bg-card);
          color: var(--text-muted);
          display: flex; align-items: center; justify-content: center;
          cursor: pointer;
          opacity: 0;
          transition: opacity 0.12s var(--i2p-state), color 0.12s var(--i2p-state), border-color 0.12s var(--i2p-state), background 0.12s var(--i2p-state);
        }
        .i2p-tile:hover .i2p-x, .i2p-x:focus-visible { opacity: 1; }
        .i2p-x:hover:not(:disabled) { color: var(--i2p-danger-text); border-color: var(--i2p-danger-line); background: var(--i2p-danger-bg); }
        .i2p-x:disabled { cursor: progress; }

        /* ── The page: the real output sheet ──
           The page button is a size container, so the sheet is fitted to
           the available area in BOTH axes via cq units — the exact
           double-clamp only replaced elements get for free. --ar is the
           output page's aspect from placeImage(); the print inside is
           positioned in percent of that sheet, so margin and orientation
           are drawn at true proportion. */
        .i2p-view {
          container-type: size;
          display: grid;
          place-items: center;
          min-height: 0;
          width: 100%;
          padding: 0; margin: 0;
          border: 0; background: transparent; color: inherit; font: inherit;
          cursor: grab;
        }
        .i2p-tile--placeholder .i2p-view { cursor: grabbing; }
        .i2p-page {
          position: relative;
          width: 100%; height: 100%;
          max-width: 100%; max-height: 100%;
          background: #ffffff;
          border: 1px solid var(--i2p-paper-edge);
          border-radius: 2px;
          box-shadow: var(--i2p-paper-shadow);
          overflow: hidden;
        }
        @supports (width: 1cqh) {
          .i2p-page {
            width: min(100cqw, calc(100cqh * var(--ar, 1)));
            height: min(100cqh, calc(100cqw / var(--ar, 1)));
          }
        }
        .i2p-print { position: absolute; }
        .i2p-print img {
          display: block;
          width: 100%; height: 100%;
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

        .i2p-meta { display: flex; align-items: center; gap: 4px; }
        .i2p-move {
          width: 24px; height: 24px; flex-shrink: 0;
          border-radius: 6px;
          border: 1px solid transparent;
          background: transparent;
          color: var(--text-muted);
          display: flex; align-items: center; justify-content: center;
          cursor: pointer;
          transition: color 0.12s var(--i2p-state), background 0.12s var(--i2p-state), border-color 0.12s var(--i2p-state), opacity 0.12s var(--i2p-state);
        }
        .i2p-move:hover:not(:disabled) { color: var(--i2p-amber-text); background: var(--i2p-amber-soft); border-color: var(--i2p-amber-line); }
        .i2p-move:disabled { opacity: 0.3; cursor: default; }
        .i2p-meta-text {
          flex: 1; min-width: 0;
          font-family: ui-monospace, 'Cascadia Code', monospace;
          font-size: 12px;
          color: var(--text-muted);
          font-variant-numeric: tabular-nums;
          white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
          text-align: center;
        }

        /* ── Bind bar ── */
        .i2p-bind {
          display: flex; align-items: center; justify-content: space-between; gap: 16px; flex-wrap: wrap;
          padding: 16px;
          border: 1px solid var(--border-base);
          border-radius: 14px;
          background: var(--bg-item);
        }
        .i2p-bind-info { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
        .i2p-bind-line {
          font-size: 13px; font-weight: 600;
          color: var(--text-primary);
          font-variant-numeric: tabular-nums;
        }
        .i2p-bind-sub { font-size: 12px; color: var(--text-muted); font-variant-numeric: tabular-nums; }
        .i2p-bind-btn {
          display: inline-flex; align-items: center; gap: 8px;
          font-family: 'Manrope', sans-serif;
          font-size: 14px; font-weight: 700; letter-spacing: -0.2px;
          color: var(--i2p-bind-ink);
          background: var(--i2p-bind-bg);
          border: none; border-radius: 10px;
          padding: 12px 24px;
          cursor: pointer;
          box-shadow: 0 4px 22px rgba(242, 169, 59, 0.3);
          transition: transform 0.12s var(--i2p-ease), box-shadow 0.12s var(--i2p-ease), opacity 0.12s;
          white-space: nowrap;
        }
        .i2p-bind-btn:hover:not(:disabled) { transform: translateY(-1px); box-shadow: 0 8px 30px rgba(242, 169, 59, 0.4); }
        .i2p-bind-btn:active:not(:disabled) { transform: scale(0.97); transition-duration: 0.08s; }
        .i2p-bind-btn:disabled { opacity: 0.82; cursor: progress; box-shadow: none; }
        .i2p-bind-btn svg { flex-shrink: 0; }

        /* ── Upload progress (real bytes, from the XHR bridge) ── */
        .i2p-progress {
          position: relative;
          width: 100%;
          height: 24px;
          border-radius: 8px;
          background: var(--bg-item);
          border: 1px solid var(--border-base);
          overflow: hidden;
          flex-basis: 100%;
        }
        .i2p-progress-fill {
          position: absolute; inset: 0;
          transform-origin: left center;
          background: linear-gradient(90deg, var(--i2p-amber-soft), var(--i2p-bind-bg));
          transition: transform 0.2s var(--i2p-ease);
        }
        .i2p-progress-pct {
          position: absolute; inset: 0;
          display: flex; align-items: center; justify-content: center;
          font-family: ui-monospace, 'Cascadia Code', monospace;
          font-size: 12px; font-weight: 700;
          color: var(--text-primary);
          font-variant-numeric: tabular-nums;
        }
        .i2p-cancel-btn {
          font-family: 'Manrope', sans-serif;
          font-size: 13px; font-weight: 700;
          color: var(--i2p-danger-text);
          background: var(--i2p-danger-bg);
          border: 1px solid var(--i2p-danger-line);
          border-radius: 10px;
          padding: 10px 16px;
          cursor: pointer;
          transition: background 0.12s var(--i2p-state);
        }
        .i2p-cancel-btn:hover { background: var(--i2p-danger-bg-hover); }

        /* ── Bound state: the receipt ── */
        .i2p-bound {
          display: flex; flex-direction: column; align-items: center; text-align: center;
          padding: 48px 24px 40px;
          border: 1px solid var(--border-base);
          border-radius: 14px;
        }
        .i2p-bound-mark { animation: i2p-doc-in 0.36s var(--i2p-spring) backwards; margin-bottom: 16px; }
        .i2p-bound-title {
          font-family: 'Manrope', sans-serif;
          font-size: 22px; font-weight: 700; letter-spacing: -0.4px;
          color: var(--text-primary);
          margin: 0 0 8px;
        }
        .i2p-bound-name {
          font-family: ui-monospace, 'Cascadia Code', monospace;
          font-size: 13px;
          color: var(--i2p-amber-text);
          margin: 0 0 4px;
          word-break: break-all;
        }
        .i2p-bound-sub { font-size: 13px; color: var(--text-muted); margin: 0 0 4px; font-variant-numeric: tabular-nums; }
        .i2p-bound-enc { font-size: 13px; color: var(--text-secondary); margin: 0; font-variant-numeric: tabular-nums; }
        .i2p-bound-actions {
          display: flex; align-items: center; justify-content: center;
          gap: 12px; flex-wrap: wrap;
          margin: 20px 0 12px;
        }
        .i2p-download-btn { box-shadow: 0 4px 22px rgba(242, 169, 59, 0.34); }
        .i2p-bound-back {
          display: inline-flex; align-items: center; gap: 6px;
          font-size: 13px; font-weight: 500;
          color: var(--text-muted);
          background: transparent; border: none;
          padding: 6px 10px; border-radius: 8px;
          cursor: pointer;
          transition: color 0.12s var(--i2p-state), background 0.12s var(--i2p-state);
        }
        .i2p-bound-back:hover { color: var(--i2p-amber-text); background: var(--i2p-amber-soft); }

        /* ── The instrument header ── */
        .i2p-head { display: flex; align-items: center; gap: 12px; }
        .i2p-head-mark {
          width: 34px; height: 34px; flex-shrink: 0;
          display: flex; align-items: center; justify-content: center;
          border-radius: 10px;
          color: var(--i2p-amber);
          background: var(--i2p-amber-soft);
          border: 1px solid var(--i2p-amber-line);
        }
        .i2p-head-title {
          font-family: 'Manrope', sans-serif;
          font-size: 20px; font-weight: 700; letter-spacing: -0.4px;
          color: var(--text-primary);
          margin: 0;
        }

        /* ── The Double Helix working mark ──
           Two counter-phased dots per strand, weaving on --i2p-amp. Dot size
           and travel are custom properties, so one mark scales from the bind
           button down to the tile meta without redrawing it. Colour is
           inherited (currentColor). Indeterminate — it never carries a
           percentage. */
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
          animation: i2p-wv 1.1s var(--i2p-state) infinite;
          animation-delay: calc(var(--n) * -0.13s);
        }
        .i2p-helix u::after { opacity: 0.82; animation-delay: calc(var(--n) * -0.13s - 0.55s); }
        .i2p-meta-helix {
          --i2p-amp: 3px; --i2p-dot: 2px;
          display: inline-flex; vertical-align: -1px; color: var(--i2p-amber);
        }

        /* ── Direct manipulation ──
           Once lifted, the origin tile becomes a dashed placeholder (the gap
           that travels with the reorder) and a paper ghost follows the cursor.
           The FLIP settle rides the tile's own transform transition. */
        .i2p-tile--placeholder {
          border-color: var(--i2p-amber-line);
          background: var(--i2p-amber-soft);
          box-shadow: none;
        }
        .i2p-tile--placeholder .i2p-tile-top,
        .i2p-tile--placeholder .i2p-view,
        .i2p-tile--placeholder .i2p-meta { opacity: 0; }
        .i2p-ghost-card {
          position: fixed; left: 0; top: 0; z-index: 70;
          container-type: size;
          display: grid; place-items: center;
          pointer-events: none;
          will-change: transform;
          opacity: 0.97;
        }
        .i2p-ghost-card .i2p-page { box-shadow: 0 20px 40px rgba(0, 0, 0, 0.5), 0 4px 12px rgba(0, 0, 0, 0.4); }

        /* ── Examine dialog (native modal) ── */
        .i2p-lightbox {
          padding: 0; border: 0; margin: auto;
          background: transparent;
          max-width: none; max-height: none;
          overflow: visible;
          color: var(--text-primary);
        }
        .i2p-lightbox[open] { animation: i2p-fade 0.2s var(--i2p-ease) both; }
        .i2p-lightbox::backdrop {
          background: rgba(6, 4, 1, 0.72);
          -webkit-backdrop-filter: blur(3px); backdrop-filter: blur(3px);
        }
        .i2p-lightbox-card {
          position: relative;
          display: grid;
          grid-template-columns: 1fr auto;
          gap: 12px 16px;
          width: min(92vw, 760px);
          padding: 16px;
          border-radius: 14px;
          background: var(--bg-card);
          border: 1px solid var(--border-base);
          box-shadow: 0 24px 70px rgba(0, 0, 0, 0.5);
          animation: i2p-card-in 0.2s var(--i2p-ease) both;
        }
        .i2p-lightbox-stage {
          grid-column: 1 / -1;
          container-type: size;
          height: min(64vh, 620px);
          display: grid; place-items: center;
        }
        .i2p-lightbox-meta { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
        .i2p-lightbox-frame {
          font-family: ui-monospace, 'Cascadia Code', monospace;
          font-size: 12px; font-weight: 700; letter-spacing: 1px; text-transform: uppercase;
          color: var(--i2p-amber-text);
          font-variant-numeric: tabular-nums;
        }
        .i2p-lightbox-name {
          font-size: 14px; font-weight: 600; color: var(--text-primary);
          overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
        }
        .i2p-lightbox-facts {
          font-family: ui-monospace, 'Cascadia Code', monospace;
          font-size: 12px; color: var(--text-muted); font-variant-numeric: tabular-nums;
        }
        .i2p-lightbox-nav { display: flex; align-items: flex-end; gap: 8px; }
        .i2p-lightbox-nav .i2p-move { width: 36px; height: 36px; border-color: var(--border-base); }
        .i2p-lightbox-close {
          position: absolute; top: 12px; right: 12px; z-index: 1;
          width: 32px; height: 32px; border-radius: 50%;
          border: 1px solid var(--border-base);
          background: var(--bg-card);
          color: var(--text-muted);
          display: flex; align-items: center; justify-content: center;
          cursor: pointer;
          transition: color 0.12s var(--i2p-state), border-color 0.12s var(--i2p-state), background 0.12s var(--i2p-state);
        }
        .i2p-lightbox-close:hover { color: var(--i2p-danger-text); border-color: var(--i2p-danger-line); background: var(--i2p-danger-bg); }

        /* ── Motion ──
           One orchestrated moment (the collate press), everything
           else quick and quiet. */
        @keyframes i2p-tile-in {
          from { transform: translateY(8px) scale(0.96); opacity: 0; }
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
          .i2p-zone { padding: 36px 16px 32px; }
          .i2p-grid { grid-template-columns: repeat(auto-fill, minmax(140px, 1fr)); gap: 8px; padding: 8px; }
          .i2p-tile { height: 208px; }
          .i2p-bind { flex-direction: column; align-items: stretch; }
          .i2p-bind-btn { justify-content: center; width: 100%; }
          .i2p-radio-hint { display: none; }
          .i2p-output { grid-template-columns: 1fr; }
          .i2p-lightbox-card { padding: 12px; }
          .i2p-lightbox-stage { height: min(56vh, 520px); }
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
        <p className="i2p-sr" role="status" aria-live="polite">{announcement}</p>

        {/* ── The instrument header ──
            The workspace heading row (eyebrow + title + description) is retired
            via ToolWorkspace `hideHeading`, so this surface names itself. The
            mark is the tool's own subject — stacked pages on a binding spine —
            and the only amber on the row. */}
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

        {phase === 'bound' && bound ? (
          /* ── Bound: the receipt ── */
          <div className="i2p-bound">
            <BoundDoc />
            <p className="i2p-bound-title">Bound.</p>
            <p className="i2p-bound-name">{bound.fileName}</p>
            <p className="i2p-bound-sub">
              {plural(bound.pages, 'page')} · {fmtSize(bound.bytes)} · {bound.paper}
            </p>
            {bound.encodings && encodingSentence(bound.encodings, bound.quality) && (
              <p className="i2p-bound-enc">{encodingSentence(bound.encodings, bound.quality)}</p>
            )}
            {bound.skippedCount > 0 && (
              <div className="i2p-err i2p-err--receipt" role="status">
                {Icon.alert}
                <span>
                  {bound.skippedCount === 1
                    ? '1 image could not be read and was left out of the PDF'
                    : `${bound.skippedCount} images could not be read and were left out of the PDF`}
                  {bound.skipped.length ? `: ${bound.skipped.join(', ')}${bound.skipped.length < bound.skippedCount ? ', …' : ''}.` : '.'}
                </span>
              </div>
            )}
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
              <>
                {clearedCount > 0 && (
                  <div className="i2p-undo">
                    <span>Table cleared — {plural(clearedCount, 'page')} removed.</span>
                    <button type="button" className="i2p-browse-btn i2p-browse-btn--ghost" onClick={undoClear}>
                      {Icon.undo}&nbsp;Undo
                    </button>
                  </div>
                )}
                <div
                  className="i2p-zone"
                  role="button"
                  tabIndex={0}
                  aria-label="Choose images to bind into a PDF"
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
                      : 'Every image becomes one page, never cropped. Drop them in any order and rearrange before binding.'}
                  </p>
                  <span className="i2p-browse-btn" aria-hidden="true">
                    {Icon.image}&nbsp;Browse images
                  </span>
                  <div className="i2p-chips" aria-hidden="true">
                    {['JPG', 'PNG', 'WEBP', 'AVIF', 'GIF', 'BMP', 'Ctrl+V'].map(f => (
                      <span key={f} className="i2p-chip">{f}</span>
                    ))}
                  </div>
                  <p className="i2p-zone-limits">Up to {MAX_IMAGES} images · {MAX_FILE_MB} MB each · {MAX_TOTAL_MB} MB in total</p>
                </div>
              </>
            ) : (
              <div className="i2p-rail">
                <span className="i2p-rail-icon" aria-hidden="true">{Icon.image}</span>
                <span className="i2p-rail-text">
                  {isDragActive
                    ? <b>Release to add to the table.</b>
                    : <>Drop or paste more images anywhere — <b>or</b></>}
                </span>
                <button type="button" className="i2p-browse-btn i2p-browse-btn--ghost" onClick={open}>
                  Browse
                </button>
              </div>
            )}

            {intakeNotes.length > 0 && (
              <div className="i2p-note" role="status">
                {Icon.alert}
                <ul>
                  {intakeNotes.map((note, i) => <li key={i}>{note}</li>)}
                </ul>
                <button type="button" className="i2p-note-x" onClick={() => setIntakeNotes([])} aria-label="Dismiss these notes">
                  {Icon.close}
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
                    <fieldset className="i2p-field">
                      <legend className="i2p-sub-label">Watermark position</legend>
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
                              name="i2p-crop-position"
                              value={opt.value}
                              checked={cropPosition === opt.value}
                              onChange={e => setCropPosition(e.target.value as CropPosition)}
                            />
                            <span className="i2p-radio-dot" aria-hidden="true"><span className="i2p-radio-inner" /></span>
                            <span className="i2p-radio-text">{opt.label}</span>
                            <span className="i2p-radio-hint">{opt.hint}</span>
                          </label>
                        ))}
                      </div>
                    </fieldset>

                    {(cropPosition === 'bottom' || cropPosition === 'bottom-right') && (
                      <div className="i2p-field">
                        <label className="i2p-sub-label" htmlFor="i2p-trim-amount">Trim amount</label>
                        <select
                          id="i2p-trim-amount"
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
                      <fieldset className="i2p-field">
                        <legend className="i2p-sub-label">Pixels to trim</legend>
                        <div className="i2p-custom-grid">
                          <div>
                            <label className="i2p-field-label" htmlFor="i2p-trim-right">From the right (px)</label>
                            <input
                              id="i2p-trim-right"
                              type="number" min="0" max="1000" inputMode="numeric"
                              value={customWidth}
                              onChange={e => setCustomWidth(Math.min(1000, Math.max(0, parseInt(e.target.value) || 0)))}
                              className="i2p-number-input"
                            />
                          </div>
                          <div>
                            <label className="i2p-field-label" htmlFor="i2p-trim-bottom">From the bottom (px)</label>
                            <input
                              id="i2p-trim-bottom"
                              type="number" min="0" max="1000" inputMode="numeric"
                              value={customHeight}
                              onChange={e => setCustomHeight(Math.min(1000, Math.max(0, parseInt(e.target.value) || 0)))}
                              className="i2p-number-input"
                            />
                          </div>
                        </div>
                        <p className="i2p-field-hint">Adobe watermarks typically sit ~80–100 px from the right and bottom edges.</p>
                      </fieldset>
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
               Every choice here redraws the table, because the tiles are
               laid out by the engine's own geometry. */}
            {n > 0 && (
              <div className="i2p-panel">
                <div className="i2p-panel-head i2p-panel-head--static">
                  <span className="i2p-panel-label">
                    {Icon.page}
                    Output
                  </span>
                  <span className="i2p-panel-badge">{outputBadge}</span>
                </div>
                <div className="i2p-panel-body i2p-output">
                  {segment(
                    'i2p-page-size', 'Page size', pageSize, ['original', 'a4', 'letter'] as const, PAGE_SIZE_LABELS, setPageSize,
                    pageSize === 'original'
                      ? 'Each page takes its image’s shape. Scans keep their real size; photos and screenshots get a page no larger than A4.'
                      : `Each image is fitted whole on ${pageSize === 'a4' ? 'an A4' : 'a US Letter'} page — never cropped.`,
                  )}
                  {pageSize !== 'original' && segment(
                    'i2p-orientation', 'Orientation', orientation, ['auto', 'portrait', 'landscape'] as const, ORIENTATION_LABELS, setOrientation,
                    orientation === 'auto' ? 'Landscape images get landscape pages, the rest portrait.' : `Every page is ${orientation}.`,
                  )}
                  {pageSize !== 'original' && segment(
                    'i2p-margin', 'Margin', margin, ['none', 'small', 'large'] as const, MARGIN_LABELS, setMargin,
                    marginHint(margin),
                  )}
                  {segment(
                    'i2p-quality', 'Quality', quality, ['high', 'balanced', 'small'] as const, QUALITY_LABELS, setQuality,
                    QUALITY_HINTS[quality],
                  )}
                </div>
              </div>
            )}

            {/* ── The table ── */}
            {n > 0 && (
              <>
                <div className="i2p-table-head">
                  <h2 className="i2p-table-title">
                    The table
                    <span className="i2p-count-badge">{plural(n, 'page')}</span>
                  </h2>
                  <button type="button" className="i2p-clear-btn" onClick={clearTable} disabled={phase === 'binding'}>
                    {Icon.trash} Clear the table
                  </button>
                </div>

                <ol className={`i2p-grid${phase === 'binding' ? ' is-binding' : ''}`} aria-label="Pages in binding order">
                  {entries.map((e, i) => {
                    const isNew = !settled.has(e.id)
                    return (
                      <li
                        key={e.id}
                        className="i2p-slot"
                      >
                        <div
                          ref={el => { if (el) tileRefs.current.set(e.id, el); else tileRefs.current.delete(e.id) }}
                          data-i2p-index={i}
                          className={`i2p-tile${isNew ? ' i2p-tile--new' : ''}${dragId === e.id ? ' i2p-tile--placeholder' : ''}`}
                          style={{ '--d': `${Math.min(i, 10) * 45}ms`, '--i': i } as CSSProperties}
                          onPointerDown={ev => startDrag(ev, i)}
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
                              disabled={phase === 'binding'}
                              aria-label={`Remove page ${i + 1}, ${e.file.name}`}
                            >
                              {Icon.close}
                            </button>
                          </div>

                          <button
                            type="button"
                            className="i2p-view"
                            onClick={ev => openPreview(e.id, ev.currentTarget)}
                            aria-label={`Page ${i + 1}: ${e.file.name}. Open a larger view`}
                          >
                            {renderPaper(e)}
                          </button>

                          <div className="i2p-meta">
                            <button
                              type="button"
                              className="i2p-move"
                              data-move="earlier"
                              disabled={i === 0 || phase === 'binding'}
                              onClick={() => move(i, -1)}
                              aria-label={`Move page ${i + 1} earlier`}
                            >
                              {Icon.chevronLeft}
                            </button>
                            <span className="i2p-meta-text" title={`${e.file.name} · ${typeLabel(e.file)} · ${fmtSize(e.file.size)}`}>
                              {e.w > 0 ? `${e.w}×${e.h}` : <I2PHelix size={12} className="i2p-meta-helix" />}
                            </span>
                            <button
                              type="button"
                              className="i2p-move"
                              data-move="later"
                              disabled={i === entries.length - 1 || phase === 'binding'}
                              onClick={() => move(i, 1)}
                              aria-label={`Move page ${i + 1} later`}
                            >
                              {Icon.chevronRight}
                            </button>
                          </div>
                        </div>
                      </li>
                    )
                  })}
                </ol>
              </>
            )}

            {/* ── Bind bar ── */}
            {n > 0 && (
              <>
                <div className="i2p-bind">
                  <div className="i2p-bind-info">
                    <span className="i2p-bind-line">
                      {plural(n, 'page')} · {fmtSize(totalBytes)} on the table
                    </span>
                    <span className="i2p-bind-sub">
                      {unchangedSinceBind
                        ? 'Nothing changed since the last bind — that PDF is ready'
                        : autoCrop ? 'Edges trimmed · pages bound in table order' : 'Pages bound in table order'}
                    </span>
                  </div>
                  {phase === 'binding' && progress !== null && (
                    <div
                      className="i2p-progress"
                      role="progressbar"
                      aria-label="Upload"
                      aria-valuemin={0}
                      aria-valuemax={100}
                      aria-valuenow={progress}
                      aria-valuetext={progressLabel}
                    >
                      <div className="i2p-progress-fill" style={{ transform: `scaleX(${progress / 100})` }} />
                      <span className="i2p-progress-pct">{progressLabel}</span>
                    </div>
                  )}
                  <button type="button" className="i2p-bind-btn" onClick={bind} disabled={phase === 'binding'}>
                    {phase === 'binding' ? (
                      <>
                        <I2PHelix size={18} />
                        Collating {plural(n, 'page')}…
                      </>
                    ) : unchangedSinceBind ? (
                      <>
                        View the bound PDF
                        {Icon.arrowRight}
                      </>
                    ) : (
                      <>
                        Bind {plural(n, 'page')} to PDF
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
                    <span>{error} Your pages are still on the table.</span>
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
            {renderPaper(ghostEntry)}
          </div>
        )}

        {/* ── Examine dialog ──
            Lifting a print to the light: the real output page, larger, with only
            facts the client actually holds. */}
        <dialog
          ref={dialogRef}
          className="i2p-lightbox"
          aria-label={previewEntry ? `Page ${previewIndex + 1} of ${n}: ${previewEntry.file.name}` : 'Page preview'}
          onCancel={ev => { ev.preventDefault(); closePreview() }}
          onClick={ev => { if (ev.target === ev.currentTarget) closePreview() }}
          onKeyDown={ev => {
            if (ev.key === 'ArrowLeft') { ev.preventDefault(); stepPreview(-1) }
            if (ev.key === 'ArrowRight') { ev.preventDefault(); stepPreview(1) }
          }}
        >
          {previewEntry && (
            <div className="i2p-lightbox-card">
              <div className="i2p-lightbox-stage">{renderPaper(previewEntry)}</div>
              <div className="i2p-lightbox-meta">
                <span className="i2p-lightbox-frame">Page {previewIndex + 1} / {n}</span>
                <span className="i2p-lightbox-name" title={previewEntry.file.name}>{previewEntry.file.name}</span>
                <span className="i2p-lightbox-facts">
                  {previewEntry.w > 0 ? `${previewEntry.w}×${previewEntry.h} px · ` : ''}
                  {typeLabel(previewEntry.file)} · {fmtSize(previewEntry.file.size)}
                </span>
                <span className="i2p-lightbox-facts">{paperFacts(previewEntry)}</span>
              </div>
              <div className="i2p-lightbox-nav">
                <button type="button" className="i2p-move" onClick={() => stepPreview(-1)} disabled={previewIndex <= 0} aria-label="Previous page">
                  {Icon.chevronLeft}
                </button>
                <button type="button" className="i2p-move" onClick={() => stepPreview(1)} disabled={previewIndex >= n - 1} aria-label="Next page">
                  {Icon.chevronRight}
                </button>
              </div>
              <button
                type="button"
                className="i2p-lightbox-close"
                onClick={closePreview}
                aria-label="Close preview"
              >
                {Icon.close}
              </button>
            </div>
          )}
        </dialog>
      </div>
    </>
  )
}
