'use client'

import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react'
import { useDropzone, type FileRejection } from 'react-dropzone'
import { ApiClientError, getApiErrorMessage, toolRequest } from '@/lib/api/client'
import KineticSphere from '@/components/KineticSphere'

/* ═══════════════════════════════════════════════════════════════════
   The Contact Sheet

   PDF → Images is the family's only 1→many converter, so the zone is a
   light table: one page placed on it, many frames promised below it.
   State names follow the metaphor — table (idle) → loaded → developing
   → done — and every state is a transformation of the same elements:
   the zone collapses to a "table edge" strip, it never unmounts, so
   the layout never breaks between steps.

   Surface rules this file obeys (CLAUDE.md §0.4 + design system):
   · ToolWorkspace (surface 3) has no palette of its own — every colour
     is a global token from app/theme.css. Accents are the brand
     coral→orange pair; --brand-yellow is reserved for edge-codes
     (frame numbers, job-ticket tag), the way film carries yellow edge
     markings. The blue of the previous implementation is gone.
   · Fonts: Syne (display) is set explicitly for headings and values;
     body text inherits the tool-surface voice — Inter, as rendered by
     every sibling tool inside ToolWorkspace (next/font's body class
     outspecifies the DM Sans body rule in theme.css). Monospace uses
     ui-monospace — 'DM Mono' was referenced here before but is not
     loaded anywhere in the repo and fell back per-OS.
   · Motion uses the house curves and honours prefers-reduced-motion.
   · Only opacity/transform/colour/grid-rows animate — no reflow.
   · Progress is indeterminate by design: the backend reports no
     percentage, and the UI never claims one.
   · The done state is a print session, not a dead download: the
     archive's OWN bytes are read back in the browser — a minimal ZIP
     reader over native DecompressionStream (no dependency, no backend
     or contract change) — and every page becomes a real frame that
     can be inspected in a lightbox and downloaded one by one. The
     full ZIP is a deliberate action; the surprise auto-download is
     gone by design. Frames show only what the server actually
     returned — if the archive cannot be read, the session degrades
     to the plain ZIP receipt, never to a fake preview.
   ═══════════════════════════════════════════════════════════════════ */

/* ── Icons ───────────────────────────────────────────────── */
const Ic = {
  film: (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="2" width="20" height="20" rx="2.5"/>
      <path d="M7 2v20M17 2v20M2 12h20M2 7h5M2 17h5M17 7h5M17 17h5"/>
    </svg>
  ),
  image: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/>
      <polyline points="21 15 16 10 5 21"/>
    </svg>
  ),
  zip: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/>
      <line x1="12" y1="15" x2="12" y2="3"/>
    </svg>
  ),
  download: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/>
      <line x1="12" y1="15" x2="12" y2="3"/>
    </svg>
  ),
  settings: (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="3"/>
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
    </svg>
  ),
  page: (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
      <polyline points="14 2 14 8 20 8"/>
    </svg>
  ),
  swap: (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="17 1 21 5 17 9"/>
      <path d="M3 11V9a4 4 0 0 1 4-4h14"/>
      <polyline points="7 23 3 19 7 15"/>
      <path d="M21 13v2a4 4 0 0 1-4 4H3"/>
    </svg>
  ),
  close: (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
      <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
    </svg>
  ),
  alert: (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
      <line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>
    </svg>
  ),
  chevron: (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="9 5.5 15.5 12 9 18.5"/>
    </svg>
  ),
}

/* ── Format option data ────────────────────────────────────── */
const DPI_OPTIONS = [
  { value: 72,  label: '72 DPI',  sub: 'Web — smallest file'   },
  { value: 150, label: '150 DPI', sub: 'Balanced quality'      },
  { value: 200, label: '200 DPI', sub: 'Good — recommended'    },
  { value: 300, label: '300 DPI', sub: 'Print — largest file'  },
]

const FORMAT_OPTIONS: { value: 'png' | 'jpg'; label: string; sub: string }[] = [
  { value: 'png', label: 'PNG',  sub: 'Lossless · archival'  },
  { value: 'jpg', label: 'JPEG', sub: 'Smaller file · lossy' },
]

/* ── The archive reader — the print session opening its own can ──
   A minimal ZIP route reader over the browser's native
   DecompressionStream. The backend ships pages as a deflate'd or
   stored zip built by Python's zipfile; the central directory tells
   us exactly where each member lives. No dependency, no second
   request, no contract change — the same bytes the tray returns.
   Returns null when the browser cannot read it; the caller degrades
   to the plain ZIP receipt and never invents a preview. */
type Frame = { url: string; name: string; code: string }

const IMAGE_NAME = /\.png$|\.jpe?g$/i
const PAGE_NO  = /page[_-]?(\d+)/i

const streamToBytes = async (stream: ReadableStream<Uint8Array>): Promise<Uint8Array> => {
  const reader = stream.getReader()
  const chunks: BlobPart[] = []
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    chunks.push(value as unknown as BlobPart)
  }
  return new Uint8Array(await new Blob(chunks).arrayBuffer())
}

const parseZipImages = async (blob: Blob): Promise<Frame[] | null> => {
  try {
    if (typeof DecompressionStream === 'undefined') return null
    const bytes = new Uint8Array(await blob.arrayBuffer())
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)

    // End-of-central-directory record: scan backwards from the tail.
    let eocd = -1
    for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 22 - 65557); i--) {
      if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break }
    }
    if (eocd < 0) return null

    const count = dv.getUint16(eocd + 10, true)
    let ptr = dv.getUint32(eocd + 16, true)   // central directory offset
    const dec = new TextDecoder()
    const found: { name: string; no: number; mimeType: string; bytes: Uint8Array }[] = []

    for (let e = 0; e < count; e++) {
      if (dv.getUint32(ptr, true) !== 0x02014b50) return null
      const method   = dv.getUint16(ptr + 10, true)   // 0 store · 8 deflate
      const csize    = dv.getUint32(ptr + 20, true)
      const nameLen  = dv.getUint16(ptr + 28, true)
      const extraLen = dv.getUint16(ptr + 30, true)
      const commLen  = dv.getUint16(ptr + 32, true)
      const localOff = dv.getUint32(ptr + 42, true)
      const name = dec.decode(bytes.subarray(ptr + 46, ptr + 46 + nameLen))
      ptr += 46 + nameLen + extraLen + commLen

      if (!IMAGE_NAME.test(name) || (method !== 0 && method !== 8)) continue

      // The local header's own lengths may differ from the central one —
      // the data offset is only certain from the local record.
      if (dv.getUint32(localOff, true) !== 0x04034b50) continue
      const dataStart = localOff + 30 + dv.getUint16(localOff + 26, true) + dv.getUint16(localOff + 28, true)
      const comp = bytes.subarray(dataStart, dataStart + csize)

      let data: Uint8Array
      if (method === 0) {
        data = comp
      } else {
        data = await streamToBytes(
          new Blob([comp]).stream().pipeThrough(new DecompressionStream('deflate-raw')),
        )
      }

      const no = Number(PAGE_NO.exec(name)?.[1]) || 0
      found.push({
        name,
        no,
        mimeType: /\.png$/i.test(name) ? 'image/png' : 'image/jpeg',
        bytes: data,
      })
    }

    if (found.length === 0) return null
    found.sort((a, b) => a.no - b.no || a.name.localeCompare(b.name))
    return found.map(f => ({
      url:  URL.createObjectURL(new Blob([f.bytes as unknown as BlobPart], { type: f.mimeType })),
      name: f.name,
      code: String(f.no || 1).padStart(2, '0'),
    }))
  } catch {
    return null
  }
}

/* ── Page range parser ─────────────────────────────────────── */
const parsePageRange = (input: string, total: number): number[] | null => {
  if (!input.trim() || input.trim().toLowerCase() === 'all') return null
  const pages: Set<number> = new Set()
  const parts = input.split(',').map(s => s.trim())
  for (const part of parts) {
    if (part.includes('-')) {
      const [a, b] = part.split('-').map(Number)
      if (isNaN(a) || isNaN(b)) return null
      for (let i = Math.max(1, a); i <= Math.min(total, b); i++) pages.add(i)
    } else {
      const n = Number(part)
      if (isNaN(n)) return null
      if (n >= 1 && n <= total) pages.add(n)
    }
  }
  return [...pages].sort((a, b) => a - b)
}

/* ─────────────────────────────────────────────────────────────
   Component
   ───────────────────────────────────────────────────────────── */
type Phase = 'table' | 'loaded' | 'developing' | 'done'

export default function PDFToImages() {
  const [file, setFile]     = useState<File | null>(null)
  const [phase, setPhase]   = useState<Phase>('table')
  const [error, setError]   = useState('')
  const [result, setResult] = useState<{ url: string; name: string; size: string } | null>(null)
  /* The print session: real frames read back out of the archive's own
     bytes — a frame per page, an optional lightbox, and one deliberate
     ZIP download. Never a mock preview. */
  const [frames, setFrames]         = useState<Frame[]>([])
  const [framesNote, setFramesNote] = useState<string | null>(null)
  const [view, setView]             = useState<number | null>(null)   // lightbox index

  // Options
  const [dpi, setDpi]         = useState(200)
  const [format, setFormat]   = useState<'png' | 'jpg'>('png')
  const [quality, setQuality] = useState(95)

  // Page range
  const [pageRange, setPageRange]           = useState('')
  const [pageRangeError, setPageRangeError] = useState('')
  const [totalPages, setTotalPages]         = useState<number>(0)   // 0 = unknown

  const locked = phase === 'developing'
  const abortRef = useRef<AbortController | null>(null)
  const runIdRef  = useRef(0)                                  // invalidates late frame deliveries
  const framesRef = useRef<Frame[]>([])                        // the mirror the unmount cleanup reads
  const lbRef     = useRef<HTMLDivElement | null>(null)
  const lightboxFrame = view !== null ? frames[view] : null

  /* A cancel through toolRequest arrives as an ApiClientError whose cause is the
     AbortError, so a deliberate stop is told apart from a real failure and needs
     no error message. */
  const isCancellation = (e: unknown) =>
    e instanceof ApiClientError && (e.cause as { name?: string } | undefined)?.name === 'AbortError'

  /* noClick/noKeyboard: the whole zone is the drag surface, but clicks
     must reach the edge strip's own buttons (Replace / Remove) without
     opening the file picker. The idle stage and the Replace button call
     open() explicitly — same pattern as the Image→PDF module. */
  const onDrop = useCallback((accepted: File[]) => {
    const pdf = accepted.find(f => f.type === 'application/pdf')
    if (!pdf) return
    if (result) URL.revokeObjectURL(result.url)
    // one pass: nothing from the last print session survives a new sheet
    runIdRef.current++
    framesRef.current.forEach(f => URL.revokeObjectURL(f.url))
    framesRef.current = []
    setResult(null)
    setFrames([]); setFramesNote(null); setView(null)
    setError('')
    setFile(pdf)
    setPageRange('')
    setPageRangeError('')
    setPhase('loaded')
  }, [result])

  const onDropRejected = useCallback((rejections: FileRejection[]) => {
    const code = rejections[0]?.errors?.[0]?.code
    if (code === 'file-too-large') setError('That file is over 50 MB — the table takes up to 50 MB per document.')
    else if (code === 'file-invalid-type') setError('The table only takes PDF files.')
    else setError('That file could not be accepted.')
  }, [])

  const { getRootProps, getInputProps, isDragActive, open } = useDropzone({
    onDrop,
    onDropRejected,
    accept: { 'application/pdf': ['.pdf'] },
    maxFiles: 1,
    maxSize: 50 * 1024 * 1024,
    noClick: true,
    noKeyboard: true,
    disabled: locked,
  })

  // Revoke the last blob URL and every frame URL, and stop any in-flight
  // run, on unmount — the refs are the only closures that survive here.
  useEffect(() => () => {
    if (result) URL.revokeObjectURL(result.url)
    framesRef.current.forEach(f => URL.revokeObjectURL(f.url))
    abortRef.current?.abort()
  }, [result])

  // The lightbox: scroll lock while open, Esc closes, arrows step pages.
  useEffect(() => {
    if (view === null) return
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    lbRef.current?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setView(null)
      else if (e.key === 'ArrowRight') setView(v => (v === null || frames.length === 0 ? v : (v + 1) % frames.length))
      else if (e.key === 'ArrowLeft')  setView(v => (v === null || frames.length === 0 ? v : (v - 1 + frames.length) % frames.length))
    }
    window.addEventListener('keydown', onKey)
    return () => {
      document.body.style.overflow = prevOverflow
      window.removeEventListener('keydown', onKey)
    }
  }, [view, frames.length])

  // ── Page range validation ──
  const validatePageRange = (val: string) => {
    setPageRange(val)
    if (!val.trim() || val.trim().toLowerCase() === 'all') {
      setPageRangeError(''); return
    }
    const parsed = parsePageRange(val, totalPages || 9999)
    if (!parsed || parsed.length === 0) {
      setPageRangeError('Invalid range — use "1-5, 8, 10-12" or leave blank for all')
    } else {
      setPageRangeError('')
    }
  }

  const triggerDownload = (url: string, name: string) => {
    const a = Object.assign(document.createElement('a'), { href: url, download: name })
    document.body.appendChild(a); a.click(); document.body.removeChild(a)
  }

  /* The frame ledger — every session change revokes the previous run's
     frame URLs, so a reprint never leaks memory or shows stale pages. */
  const expireFrames = () => {
    runIdRef.current++
    framesRef.current.forEach(f => URL.revokeObjectURL(f.url))
    framesRef.current = []
    setFrames([]); setFramesNote(null); setView(null)
  }

  /* Lightbox stepping — a carousel that wraps around the sheet. */
  const stepView = (dir: number) =>
    setView(v => (v === null || frames.length === 0 ? v : (v + dir + frames.length) % frames.length))

  const resetToTable = () => {
    abortRef.current?.abort()
    if (result) URL.revokeObjectURL(result.url)
    expireFrames()
    setResult(null)
    setFile(null)
    setPageRange('')
    setPageRangeError('')
    setError('')
    setPhase('table')
    setTotalPages(0)
  }

  const cancelDevelop = () => {
    abortRef.current?.abort()
  }

  // ── Convert ──
  const convertToImages = async () => {
    if (!file || locked || pageRangeError) return
    setPhase('developing')
    setError('')
    if (result) { URL.revokeObjectURL(result.url); setResult(null) }
    expireFrames()
    const controller = new AbortController()
    abortRef.current = controller
    try {
      const formData = new FormData()
      formData.append('pdf', file)
      formData.append('dpi', dpi.toString())
      formData.append('format', format)
      formData.append('quality', quality.toString())
      if (pageRange.trim() && pageRange.trim().toLowerCase() !== 'all') {
        formData.append('pageRange', pageRange.trim())
      }

      const res = await toolRequest('/api/pdf-to-images', {
        method: 'POST', body: formData, signal: controller.signal,
      })
      if (!res.ok) {
        setError(await getApiErrorMessage(res, 'We could not develop these pages. Please try again.'))
        setPhase('loaded')
        return
      }
      const blob = await res.blob()
      const name = `mycloove_images_${Date.now()}.zip`
      const url = URL.createObjectURL(blob)
      setResult({ url, name, size: (blob.size / 1024 / 1024).toFixed(2) })
      setPhase('done')

      /* No surprise auto-download any more: the printed sheet IS the
         deliverable, the ZIP is one deliberate button. The frames are
         read back from the archive's OWN bytes in this browser — no
         second request, no contract change, no mock. A late delivery
         from a session the user has already moved past is discarded. */
      const myRun = ++runIdRef.current
      const parsed = await parseZipImages(blob)
      if (runIdRef.current !== myRun) {
        parsed?.forEach(f => URL.revokeObjectURL(f.url))   // a newer session took over
        return
      }
      if (parsed && parsed.length > 0) {
        framesRef.current = parsed
        setFrames(parsed)
      } else {
        setFramesNote('This browser could not open the archive frame-by-frame — the ZIP download stands in for the preview.')
      }
    } catch (e) {
      if (isCancellation(e)) {
        setPhase('loaded') // a deliberate stop is not an error
        return
      }
      setError(e instanceof Error ? e.message : 'Failed to develop the archive. Please try again.')
      setPhase('loaded')
    } finally {
      abortRef.current = null
    }
  }

  const fileSizeMB = file ? (file.size / 1024 / 1024).toFixed(2) : '0'
  const zoneClass = `p2i-zone${isDragActive ? ' is-over' : ''}${file && phase !== 'table' ? ' is-collapsed' : ''}`
  const ri = (n: number) => ({ '--ri': n }) as CSSProperties

  return (
    <>
      <style>{`
        /* ── scoped to .p2i — house curves from the repo motion system ── */
        .p2i {
          --p2i-ease-out: cubic-bezier(0.16, 1, 0.3, 1);
          --p2i-ease-spring: cubic-bezier(0.34, 1.56, 0.64, 1);
          --p2i-ease-theme: cubic-bezier(0.4, 0, 0.2, 1);
          --p2i-shadow-rest: 0 8px 20px -10px rgba(0, 0, 0, 0.38);
          --p2i-shadow-lift: 0 18px 36px -14px rgba(0, 0, 0, 0.5);
          display: flex; flex-direction: column; gap: 18px;
          font-variant-numeric: tabular-nums;
        }

        @keyframes p2i-rise   { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: none; } }
        @keyframes p2i-settle { from { transform: translateY(-3px); } to { transform: none; } }
        @keyframes p2i-draw   { to { stroke-dashoffset: 0; } }
        @keyframes p2i-scan   { 0% { transform: translateY(0); opacity: 0; } 8% { opacity: 1; } 92% { opacity: 1; } 100% { transform: translateY(160px); opacity: 0; } }
        @keyframes p2i-flash  { from { opacity: 0.5; } to { opacity: 0; } }
        @keyframes p2i-wash   { from { transform: translateX(-140%); } to { transform: translateX(433%); } }

        /* Staggered reveal — sections enter at 55ms offsets. */
        .p2i-reveal { animation: p2i-rise 0.36s var(--p2i-ease-out) both; animation-delay: calc(var(--ri, 0) * 55ms); }

        /* ══ The zone — idle is the light table, loaded is the table edge ══ */
        .p2i-zone {
          border: 1px solid var(--border-card);
          border-radius: 16px;
          background: linear-gradient(180deg, color-mix(in srgb, var(--accent-start) 3%, var(--bg-card)), var(--bg-card) 62%);
          position: relative; overflow: hidden;
          transition: border-color 0.16s var(--p2i-ease-theme), background 0.3s var(--p2i-ease-theme);
        }
        .p2i-zone.is-over {
          border-color: color-mix(in srgb, var(--accent-start) 45%, var(--border-card));
          background: linear-gradient(180deg, color-mix(in srgb, var(--accent-start) 8%, var(--bg-card)), var(--bg-card) 68%);
        }

        /* The zone never unmounts — it collapses via grid-template-rows. */
        .p2i-shrink { display: grid; grid-template-rows: 1fr; transition: grid-template-rows 0.34s var(--p2i-ease-out); }
        .p2i-zone.is-collapsed .p2i-shrink { grid-template-rows: 0fr; }
        .p2i-shrink > .p2i-zone-body { overflow: hidden; min-height: 0; }

        .p2i-dropclick { padding: 46px 24px 38px; text-align: center; cursor: pointer; border-radius: 14px; }
        .p2i-dropclick:focus-visible { outline: 2px solid color-mix(in srgb, var(--accent-start) 55%, transparent); outline-offset: -2px; }

        /* ── The page plate ── */
        .p2i-plate {
          position: relative; width: 128px; height: 164px; margin: 0 auto 20px;
          background: var(--bg-card);
          border: 1px solid var(--border-card);
          border-radius: 8px;
          box-shadow: var(--p2i-shadow-rest);
          transition: transform 0.2s var(--p2i-ease-out), box-shadow 0.2s var(--p2i-ease-out), border-color 0.2s;
        }
        /* corner fold — the flap catching light */
        .p2i-plate::before {
          content: ''; position: absolute; top: -1px; right: -1px; width: 0; height: 0;
          border-top: 20px solid color-mix(in srgb, var(--bg-card) 72%, var(--text-faint));
          border-left: 20px solid transparent;
        }
        /* the develop head — a one-shot scan while a drag is live */
        .p2i-plate::after {
          content: ''; position: absolute; left: -1px; right: -1px; top: 0; height: 2px;
          background: linear-gradient(90deg, transparent, var(--accent-start) 30%, var(--accent-end) 70%, transparent);
          opacity: 0; pointer-events: none;
        }
        .p2i-zone.is-over .p2i-plate::after { animation: p2i-scan 0.9s var(--p2i-ease-theme) 1; }

        /* the pixels waiting to happen — an accent raster that brightens on drag */
        .p2i-plate-raster {
          position: absolute; inset: 0; border-radius: inherit;
          background-image:
            linear-gradient(color-mix(in srgb, var(--accent-end) 22%, transparent) 1px, transparent 1px),
            linear-gradient(90deg, color-mix(in srgb, var(--accent-end) 22%, transparent) 1px, transparent 1px);
          background-size: 12px 12px;
          opacity: 0.16; transition: opacity 0.2s;
        }
        .p2i-plate-mark {
          position: absolute; top: 26px; left: 0; right: 0; text-align: center;
          font-family: 'Syne', sans-serif; font-weight: 800; font-size: 10px; letter-spacing: 2.5px;
          color: var(--text-faint);
        }
        .p2i-plate-lines {
          position: absolute; left: 20px; right: 20px; bottom: 16px; height: 34px;
          background: repeating-linear-gradient(180deg, transparent 0 9px, color-mix(in srgb, var(--text-faint) 55%, transparent) 9px 10px);
          opacity: 0.5;
        }
        .p2i-zone.is-over .p2i-plate {
          transform: translateY(-3px);
          border-color: color-mix(in srgb, var(--accent-start) 35%, var(--border-card));
          box-shadow: var(--p2i-shadow-lift);
        }
        .p2i-zone.is-over .p2i-plate-raster { opacity: 0.45; }

        /* ── Frame rail — the 1→many promise; slots open like shutters ── */
        .p2i-slots { display: flex; justify-content: center; gap: 10px; margin-bottom: 22px; }
        .p2i-slot {
          position: relative; width: 46px; height: 58px;
          border: 1px solid color-mix(in srgb, var(--text-faint) 50%, transparent);
          border-radius: 5px;
          opacity: 0.35; transform: scaleY(0.72); transform-origin: 50% 0;
          transition: transform 0.24s var(--p2i-ease-spring), opacity 0.2s;
        }
        .p2i-slot:nth-child(2) { transition-delay: 40ms; }
        .p2i-slot:nth-child(3) { transition-delay: 80ms; }
        .p2i-zone.is-over .p2i-slot { opacity: 1; transform: none; }
        .p2i-slot i {
          position: absolute; left: 4px; bottom: 3px; font-style: normal;
          font: 700 7px/1 ui-monospace, monospace; letter-spacing: 0.5px;
          color: color-mix(in srgb, var(--brand-yellow) 80%, var(--text-muted));
        }

        .p2i-zone-title {
          font-family: 'Syne', sans-serif; font-size: 16px; font-weight: 700; letter-spacing: -0.2px;
          color: var(--text-primary); margin-bottom: 6px; transition: color 0.16s;
        }
        .p2i-zone.is-over .p2i-zone-title { color: color-mix(in srgb, var(--accent-start) 78%, var(--text-primary)); }
        .p2i-zone-sub { font-size: 12.5px; color: var(--text-muted); transition: opacity 0.16s; }
        .p2i-zone.is-over .p2i-zone-sub { opacity: 0; }

        /* industrial spec line — functional labeling, not a chip row */
        .p2i-spec { margin-top: 14px; font: 600 10px/1 ui-monospace, monospace; letter-spacing: 1.4px; color: var(--text-faint); }

        /* ── The table edge — collapsed zone strip ── */
        .p2i-edge { display: flex; align-items: center; gap: 13px; padding: 12px 16px; position: relative; flex-wrap: wrap; }
        .p2i-edge-plate {
          position: relative; width: 34px; height: 44px; flex: 0 0 auto;
          background: var(--bg-item); border: 1px solid var(--border-base); border-radius: 4px;
        }
        .p2i-edge-plate::before {
          content: ''; position: absolute; top: -1px; right: -1px; width: 0; height: 0;
          border-top: 10px solid color-mix(in srgb, var(--bg-item) 60%, var(--text-faint));
          border-left: 10px solid transparent;
        }
        /* exposure flash — replays per file because the plate is keyed by name */
        .p2i-edge-plate::after {
          content: ''; position: absolute; inset: 0; border-radius: inherit;
          background: color-mix(in srgb, var(--accent-start) 28%, transparent);
          opacity: 0; pointer-events: none;
        }
        .p2i-zone.is-collapsed .p2i-edge-plate::after { animation: p2i-flash 0.28s var(--p2i-ease-out); }
        .p2i-edge-raster {
          position: absolute; inset: 0; border-radius: inherit;
          background-image:
            linear-gradient(color-mix(in srgb, var(--accent-end) 26%, transparent) 1px, transparent 1px),
            linear-gradient(90deg, color-mix(in srgb, var(--accent-end) 26%, transparent) 1px, transparent 1px);
          background-size: 7px 7px; opacity: 0.3;
        }
        .p2i-edge-no {
          position: absolute; left: 3px; bottom: 2px;
          font: 700 6.5px/1 ui-monospace, monospace;
          color: color-mix(in srgb, var(--brand-yellow) 80%, var(--text-muted));
        }
        .p2i-edge-name {
          font-size: 13.5px; font-weight: 600; color: var(--text-primary);
          white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
        }
        .p2i-edge-meta { font-size: 11px; color: var(--text-muted); margin-top: 2px; }

        .p2i-edge-drop {
          position: absolute; inset: 0; display: flex; align-items: center; justify-content: center;
          background: color-mix(in srgb, var(--bg-card) 72%, transparent);
          backdrop-filter: blur(3px);
          font-family: 'Syne', sans-serif; font-size: 13px; font-weight: 700;
          color: color-mix(in srgb, var(--accent-start) 78%, var(--text-primary));
          opacity: 0; pointer-events: none; transition: opacity 0.16s;
        }
        .p2i-zone.is-collapsed.is-over .p2i-edge-drop { opacity: 1; }

        /* ── Ghost buttons (edge strip, receipt) ── */
        .p2i-ghost-btn {
          display: inline-flex; align-items: center; gap: 6px; flex: 0 0 auto;
          font-family: inherit; font-size: 11.5px; font-weight: 500;
          color: var(--text-muted); padding: 6px 11px; border-radius: 8px;
          border: 1px solid var(--border-base); background: transparent; cursor: pointer;
          transition: color 0.14s, background 0.14s, border-color 0.14s, opacity 0.14s;
        }
        .p2i-ghost-btn:hover:not(:disabled) { color: var(--text-primary); background: var(--bg-item-hover); border-color: var(--border-card); }
        .p2i-ghost-btn:disabled { opacity: 0.4; cursor: not-allowed; }
        .p2i-ghost-btn:focus-visible { outline: 2px solid color-mix(in srgb, var(--accent-start) 55%, transparent); outline-offset: 2px; }
        .p2i-ghost-btn.danger:hover:not(:disabled) {
          color: var(--brand-red); background: color-mix(in srgb, var(--brand-red) 9%, transparent);
          border-color: color-mix(in srgb, var(--brand-red) 28%, transparent);
        }

        /* ── Error banner — replaces alert(); one stable slot under the zone ── */
        .p2i-error {
          display: flex; align-items: flex-start; gap: 10px;
          padding: 12px 14px; border-radius: 10px;
          border: 1px solid color-mix(in srgb, var(--brand-red) 30%, var(--border-card));
          border-left: 3px solid var(--brand-red);
          background: color-mix(in srgb, var(--brand-red) 7%, var(--bg-card));
          color: var(--text-secondary); font-size: 12.5px; line-height: 1.5;
        }
        .p2i-error > svg { color: var(--brand-red); flex: 0 0 auto; margin-top: 1px; }
        .p2i-error-x {
          margin-left: auto; flex: 0 0 auto; display: flex; align-items: center; justify-content: center;
          width: 22px; height: 22px; border-radius: 6px; border: none; cursor: pointer;
          background: transparent; color: var(--text-muted); transition: color 0.14s, background 0.14s;
        }
        .p2i-error-x:hover { color: var(--text-primary); background: var(--bg-item); }
        .p2i-error-x:focus-visible { outline: 2px solid color-mix(in srgb, var(--brand-red) 55%, transparent); outline-offset: 1px; }

        /* ══ The bench — output settings ══ */
        .p2i-panel {
          background: var(--bg-card); border: 1px solid var(--border-card);
          border-radius: 14px; overflow: hidden; transition: opacity 0.2s;
        }
        .p2i-panel.is-locked { opacity: 0.55; }
        .p2i-panel-head {
          display: flex; align-items: center; gap: 8px; padding: 13px 16px;
          border-bottom: 1px solid var(--border-base);
          font-family: 'Syne', sans-serif; font-size: 12.5px; font-weight: 700; color: var(--text-primary);
        }
        .p2i-panel-head svg { color: var(--text-muted); }
        .p2i-panel-body { padding: 16px; display: flex; flex-direction: column; gap: 18px; }

        .p2i-bench { display: flex; flex-direction: column; gap: 18px; }
        @media (min-width: 900px) { .p2i-bench { display: grid; grid-template-columns: 3fr 2fr; gap: 18px; align-items: start; } }

        .p2i-label {
          display: block; font-size: 10px; font-weight: 700; letter-spacing: 1.1px;
          text-transform: uppercase; color: var(--text-faint); margin-bottom: 8px;
        }

        /* DPI cards */
        .p2i-dpi-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 7px; }
        @media (max-width: 500px) { .p2i-dpi-grid { grid-template-columns: repeat(2, 1fr); } }
        .p2i-dpi-btn {
          padding: 10px 8px; border-radius: 10px; text-align: center; cursor: pointer;
          border: 1.5px solid var(--border-base); background: var(--bg-item);
          font-family: inherit; user-select: none;
          transition: border-color 0.14s, background 0.14s, transform 0.14s;
        }
        .p2i-dpi-btn:hover:not(:disabled):not(.active) { background: var(--bg-item-hover); transform: translateY(-1px); }
        .p2i-dpi-btn.active {
          border-color: color-mix(in srgb, var(--accent-start) 50%, var(--border-base));
          background: color-mix(in srgb, var(--accent-start) 9%, var(--bg-item));
        }
        .p2i-dpi-val {
          font-family: 'Syne', sans-serif; font-size: 13px; font-weight: 800;
          color: var(--text-primary); margin-bottom: 3px;
        }
        /* the chosen number lands — a 3px spring settle */
        .p2i-dpi-btn.active .p2i-dpi-val {
          color: color-mix(in srgb, var(--accent-start) 72%, var(--text-primary));
          animation: p2i-settle 0.3s var(--p2i-ease-spring);
        }
        .p2i-dpi-sub { font-size: 9.5px; color: var(--text-muted); line-height: 1.3; }
        .p2i-dpi-btn:disabled { cursor: not-allowed; }
        .p2i-dpi-btn:focus-visible, .p2i-fmt-btn:focus-visible {
          outline: 2px solid color-mix(in srgb, var(--accent-start) 55%, transparent); outline-offset: 2px;
        }

        /* Format — segmented control with a sliding pill */
        .p2i-fmt { position: relative; display: flex; padding: 3px; border: 1px solid var(--border-base); border-radius: 10px; background: var(--bg-item); }
        .p2i-fmt-pill {
          position: absolute; top: 3px; bottom: 3px; left: 3px; width: calc(50% - 3px);
          border-radius: 8px;
          background: color-mix(in srgb, var(--accent-start) 10%, var(--bg-card));
          border: 1px solid color-mix(in srgb, var(--accent-start) 45%, var(--border-base));
          transition: transform 0.2s var(--p2i-ease-out);
        }
        .p2i-fmt.is-jpg .p2i-fmt-pill { transform: translateX(100%); }
        .p2i-fmt-btn {
          position: relative; z-index: 1; flex: 1; padding: 9px 12px; border-radius: 8px;
          border: none; background: transparent; text-align: left; cursor: pointer;
          font-family: inherit; user-select: none;
        }
        .p2i-fmt-btn:disabled { cursor: not-allowed; }
        .p2i-fmt-name {
          display: flex; align-items: center; gap: 7px; margin-bottom: 2px;
          font-family: 'Syne', sans-serif; font-size: 13px; font-weight: 800;
          color: var(--text-muted); transition: color 0.16s;
        }
        .p2i-fmt-btn.active .p2i-fmt-name { color: var(--text-primary); }
        .p2i-fmt-sub { font-size: 10.5px; color: var(--text-muted); }

        /* Quality slider — the fill is set inline so the track is honest */
        .p2i-q-row { display: flex; align-items: center; gap: 12px; }
        .p2i-q-slider {
          -webkit-appearance: none; appearance: none; flex: 1; height: 3px;
          border-radius: 3px; cursor: pointer; outline: none;
        }
        .p2i-q-slider::-webkit-slider-thumb {
          -webkit-appearance: none; width: 15px; height: 15px; border-radius: 50%;
          background: var(--accent-start); border: 2px solid var(--bg-card);
          box-shadow: var(--p2i-shadow-rest); cursor: pointer; transition: transform 0.1s;
        }
        .p2i-q-slider::-webkit-slider-thumb:hover { transform: scale(1.15); }
        .p2i-q-slider::-moz-range-thumb {
          width: 15px; height: 15px; border-radius: 50%;
          background: var(--accent-start); border: 2px solid var(--bg-card);
          box-shadow: var(--p2i-shadow-rest); cursor: pointer; transition: transform 0.1s;
        }
        .p2i-q-slider:focus-visible { outline: 2px solid color-mix(in srgb, var(--accent-start) 55%, transparent); outline-offset: 4px; }
        .p2i-q-val {
          font-family: 'Syne', sans-serif; font-size: 13px; font-weight: 700;
          color: color-mix(in srgb, var(--accent-start) 72%, var(--text-primary));
          min-width: 38px; text-align: right;
        }

        /* Page range */
        .p2i-range {
          width: 100%; background: var(--bg-item);
          border: 1.5px solid var(--border-base); border-radius: 9px;
          padding: 9px 12px; font-size: 12.5px; color: var(--text-primary);
          font-family: ui-monospace, monospace; outline: none;
          transition: border-color 0.14s;
        }
        .p2i-range::placeholder { color: var(--text-faint); }
        .p2i-range:focus { border-color: color-mix(in srgb, var(--accent-start) 50%, var(--border-base)); }
        .p2i-range.error { border-color: color-mix(in srgb, var(--brand-red) 55%, var(--border-base)); }
        .p2i-range-hint { font-size: 11px; color: var(--text-faint); margin-top: 5px; line-height: 1.5; }
        .p2i-range-hint code {
          background: var(--bg-item); border: 1px solid var(--border-base);
          padding: 1px 5px; border-radius: 4px; font-family: inherit;
        }
        .p2i-range-error { font-size: 11px; color: var(--brand-red); margin-top: 5px; }

        /* ══ The job ticket — sits right above the action ══ */
        .p2i-ticket {
          display: flex; flex-wrap: wrap; align-items: center; gap: 7px 18px;
          padding: 11px 16px; border-radius: 10px;
          border: 1px solid var(--border-card);
          border-left: 3px solid var(--brand-yellow);
          background: var(--bg-card);
          font-size: 11.5px; color: var(--text-muted);
          transition: opacity 0.2s;
        }
        .p2i-ticket.is-locked { opacity: 0.55; }
        .p2i-ticket-tag {
          display: inline-flex; align-items: center; gap: 5px;
          font: 800 9px/1 ui-monospace, monospace; letter-spacing: 1.2px;
          padding: 4px 8px; border-radius: 5px;
          color: color-mix(in srgb, var(--brand-yellow) 55%, var(--text-primary));
          background: color-mix(in srgb, var(--brand-yellow) 10%, transparent);
          border: 1px solid color-mix(in srgb, var(--brand-yellow) 30%, transparent);
        }
        .p2i-ticket-tag.is-bad {
          color: var(--brand-red);
          background: color-mix(in srgb, var(--brand-red) 9%, transparent);
          border-color: color-mix(in srgb, var(--brand-red) 32%, transparent);
        }
        .p2i-ticket-item { display: inline-flex; align-items: center; gap: 5px; }
        .p2i-ticket-item svg { color: var(--text-faint); flex-shrink: 0; }
        .p2i-ticket-val { color: var(--text-primary); font-weight: 600; }

        /* ══ The action row — job ticket + compact CTA sharing one line ══ */
        .p2i-action-row { display: flex; align-items: center; gap: 12px; }
        /* the ticket hugs its fields with a tight rhythm; the CTA is pinned to the right edge */
        .p2i-action-row .p2i-ticket { flex: 0 1 auto; min-width: 0; gap: 6px 10px; }
        .p2i-convert-slot { display: block; flex: 0 0 auto; margin-left: auto; }
        @media (max-width: 640px) {
          .p2i-action-row { flex-wrap: wrap; }
          .p2i-action-row .p2i-ticket { flex: 1 1 100%; }
          .p2i-convert-slot { flex: 1 1 100%; margin-left: 0; }
          .p2i-convert { width: 100%; }
        }

        /* ══ The compact CTA ══ */
        .p2i-convert {
          position: relative; overflow: hidden; isolation: isolate;
          display: flex; align-items: center; justify-content: center; gap: 9px;
          width: auto; flex: 0 0 auto; padding: 8px 18px; border: none; border-radius: 999px;
          background:
            linear-gradient(180deg, color-mix(in srgb, var(--accent-start) 90%, #fff) 0%, var(--accent-start) 42%, var(--accent-end) 100%);
          color: #fff; font-family: 'Syne', sans-serif; font-size: 13.5px; font-weight: 700;
          letter-spacing: 0.02em; cursor: pointer;
          box-shadow:
            inset 0 1px 0 rgba(255, 255, 255, 0.5),
            inset 0 -2px 6px rgba(0, 0, 0, 0.18),
            0 12px 32px -12px color-mix(in srgb, var(--accent-start) 70%, transparent);
          transition: transform 0.18s var(--p2i-ease-out), box-shadow 0.2s var(--p2i-ease-out), opacity 0.18s;
        }
        /* glass top-light, plus a sheen that sweeps across on hover */
        .p2i-convert::before {
          content: ''; position: absolute; inset: 0; pointer-events: none; z-index: 0;
          background:
            linear-gradient(180deg, rgba(255, 255, 255, 0.28), rgba(255, 255, 255, 0) 48%),
            linear-gradient(115deg, transparent 34%, rgba(255, 255, 255, 0.4) 50%, transparent 66%);
          background-size: 100% 100%, 240% 100%;
          background-position: 0 0, 165% 0;
          background-repeat: no-repeat;
          transition: background-position 0.75s var(--p2i-ease-out);
        }
        .p2i-convert:hover:not(:disabled)::before { background-position: 0 0, -65% 0; }
        .p2i-convert:hover:not(:disabled) {
          transform: translateY(-2px);
          box-shadow:
            inset 0 1px 0 rgba(255, 255, 255, 0.55),
            inset 0 -2px 6px rgba(0, 0, 0, 0.18),
            0 20px 46px -14px color-mix(in srgb, var(--accent-start) 75%, transparent);
        }
        .p2i-convert:active:not(:disabled) {
          transform: translateY(0) scale(0.994);
          box-shadow:
            inset 0 2px 8px rgba(0, 0, 0, 0.22),
            0 8px 20px -12px color-mix(in srgb, var(--accent-start) 60%, transparent);
        }
        .p2i-convert:disabled { opacity: 0.5; cursor: not-allowed; box-shadow: none; }
        /* developing stays vivid — a busy surface, not a disabled one */
        .p2i-convert.is-developing {
          opacity: 1; cursor: progress;
          box-shadow:
            inset 0 1px 0 rgba(255, 255, 255, 0.5),
            inset 0 -2px 6px rgba(0, 0, 0, 0.18),
            0 12px 32px -12px color-mix(in srgb, var(--accent-start) 70%, transparent);
        }
        .p2i-convert:focus-visible { outline: 2px solid color-mix(in srgb, var(--accent-end) 70%, transparent); outline-offset: 3px; }
        .p2i-cancel {
          display: flex; align-items: center; justify-content: center; gap: 6px;
          margin: 8px auto 0; font-family: inherit; font-size: 11px; font-weight: 500;
          color: var(--text-muted); padding: 5px 11px; border-radius: 7px;
          border: 1px solid var(--border-base); background: transparent; cursor: pointer;
          transition: color 0.14s, background 0.14s, border-color 0.14s;
        }
        .p2i-cancel:hover { color: var(--brand-red); background: color-mix(in srgb, var(--brand-red) 7%, transparent); border-color: color-mix(in srgb, var(--brand-red) 18%, transparent); }
        .p2i-cancel:focus-visible { outline: 2px solid color-mix(in srgb, var(--brand-red) 55%, transparent); outline-offset: 2px; }
        /* indeterminate wash — the tray developing, never a fake percentage */
        .p2i-convert.is-developing::after {
          content: ''; position: absolute; top: 0; bottom: 0; left: 0; width: 30%; z-index: 0;
          background: linear-gradient(90deg, transparent, rgba(255, 255, 255, 0.34), transparent);
          animation: p2i-wash 1.4s linear infinite;
        }
        /* content sits above the sheen and the wash */
        .p2i-convert-inner {
          position: relative; z-index: 1;
          display: inline-flex; align-items: center; gap: 9px;
          text-shadow: 0 1px 2px rgba(0, 0, 0, 0.2);
        }
        /* the icon / loader badge — a glass disc that anchors the CTA */
        .p2i-convert-badge {
          display: grid; place-items: center; flex: 0 0 auto;
          width: 32px; height: 32px; border-radius: 50%;
          background: rgba(255, 255, 255, 0.18);
          box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.32), inset 0 1px 2px rgba(255, 255, 255, 0.4);
          color: #fff;
        }
        .p2i-convert-badge svg { width: 18px; height: 18px; display: block; }
        /* trailing chevron — points the eye through the action, slides on hover */
        .p2i-convert-chevron {
          display: inline-flex; align-items: center; flex: 0 0 auto;
          opacity: 0.8;
          transition: transform 0.24s var(--p2i-ease-out), opacity 0.2s;
        }
        .p2i-convert:hover:not(:disabled) .p2i-convert-chevron { transform: translateX(3px); opacity: 1; }
        /* the kinetic sphere loader — inherits the button's white ink, lit by a soft glow */
        .p2i-orb {
          position: relative; z-index: 1; flex: 0 0 auto;
          filter: drop-shadow(0 1px 1px rgba(0, 0, 0, 0.25)) drop-shadow(0 0 6px rgba(255, 255, 255, 0.45));
          animation: p2i-orb-in 0.38s var(--p2i-ease-spring) both;
        }
        @keyframes p2i-orb-in { from { opacity: 0; transform: scale(0.4); } to { opacity: 1; transform: none; } }

        /* ══ The receipt ══ */
        .p2i-receipt {
          display: flex; align-items: center; gap: 15px; flex-wrap: wrap;
          padding: 18px; border-radius: 14px;
          border: 1px solid var(--border-card);
          border-left: 3px solid var(--brand-yellow);
          background: var(--bg-card);
        }
        .p2i-receipt-check {
          width: 40px; height: 40px; flex: 0 0 auto; border-radius: 12px;
          display: flex; align-items: center; justify-content: center;
          background: linear-gradient(135deg, var(--accent-start), var(--accent-end));
          color: #fff;
        }
        .p2i-receipt-check svg path {
          stroke-dasharray: 28; stroke-dashoffset: 28;
          animation: p2i-draw 0.32s 0.08s var(--p2i-ease-out) forwards;
        }
        .p2i-receipt-title {
          font-family: 'Syne', sans-serif; font-size: 14px; font-weight: 700;
          color: var(--text-primary); margin-bottom: 3px;
        }
        .p2i-receipt-meta {
          font: 500 11px/1.5 ui-monospace, monospace;
          color: var(--text-muted); word-break: break-all;
        }
        .p2i-receipt-actions { margin-left: auto; display: flex; gap: 8px; flex-wrap: wrap; }
        .p2i-solid-btn {
          display: inline-flex; align-items: center; gap: 7px;
          padding: 9px 14px; border-radius: 9px; border: none; cursor: pointer;
          background: linear-gradient(135deg, var(--accent-start), var(--accent-end));
          color: #fff; font-family: 'Syne', sans-serif; font-size: 12px; font-weight: 700;
          box-shadow: 0 3px 14px color-mix(in srgb, var(--accent-start) 28%, transparent);
          transition: transform 0.16s var(--p2i-ease-out), box-shadow 0.16s;
        }
        .p2i-solid-btn:hover { transform: translateY(-1px); box-shadow: 0 6px 20px color-mix(in srgb, var(--accent-start) 36%, transparent); }
        .p2i-solid-btn:focus-visible { outline: 2px solid color-mix(in srgb, var(--accent-end) 70%, transparent); outline-offset: 2px; }

        /* honest footnote when a browser cannot open the archive */
        .p2i-note { font-size: 11.5px; color: var(--text-muted); line-height: 1.5; padding: 0 2px; }

        /* ══ The frames — the contact sheet delivered ══ */
        .p2i-frames-head { display: flex; align-items: baseline; gap: 10px; padding: 0 2px; flex-wrap: wrap; }
        .p2i-frames-title {
          font-family: 'Syne', sans-serif; font-size: 11px; font-weight: 800;
          letter-spacing: 1.6px; text-transform: uppercase; color: var(--text-faint);
        }
        .p2i-frames-hint { font-size: 11px; color: var(--text-muted); margin-left: auto; }

        .p2i-frame-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(148px, 1fr)); gap: 12px; }
        .p2i-frame {
          position: relative; overflow: hidden; padding: 0; cursor: zoom-in;
          border: 1px solid var(--border-card); border-radius: 10px; background: var(--bg-item);
          transition: transform 0.18s var(--p2i-ease-out), box-shadow 0.18s, border-color 0.18s;
        }
        .p2i-frame:hover {
          transform: translateY(-3px); box-shadow: var(--p2i-shadow-lift);
          border-color: color-mix(in srgb, var(--accent-start) 35%, var(--border-card));
        }
        .p2i-frame:focus-visible { outline: 2px solid color-mix(in srgb, var(--accent-start) 55%, transparent); outline-offset: 2px; }
        .p2i-frame img {
          display: block; width: 100%; aspect-ratio: 3 / 4; object-fit: contain; user-select: none;
          background: color-mix(in srgb, var(--bg-page) 55%, var(--bg-card));
        }
        /* the edge-code — the sheet's own yellow frame number, like the slots above */
        .p2i-frame-code {
          position: absolute; top: 8px; left: 9px;
          font: 700 8.5px/1 ui-monospace, monospace; letter-spacing: 1px;
          color: color-mix(in srgb, var(--brand-yellow) 62%, var(--text-primary));
          background: color-mix(in srgb, var(--bg-page) 55%, transparent);
          padding: 3px 6px; border-radius: 4px; backdrop-filter: blur(2px);
        }
        /* the frame's tray — one download per page, surfaced on hover/focus */
        .p2i-frame-bar {
          position: absolute; left: 0; right: 0; bottom: 0;
          display: flex; align-items: center; padding: 6px 8px;
          background: color-mix(in srgb, var(--bg-page) 78%, transparent);
          backdrop-filter: blur(6px);
          opacity: 0; transform: translateY(6px);
          transition: opacity 0.16s var(--p2i-ease-theme), transform 0.16s var(--p2i-ease-out);
        }
        .p2i-frame:hover .p2i-frame-bar,
        .p2i-frame:focus-within .p2i-frame-bar { opacity: 1; transform: none; }
        .p2i-frame-bar button {
          flex: 1; display: flex; align-items: center; justify-content: center; gap: 5px;
          padding: 6px 8px; border: none; border-radius: 6px; background: transparent;
          color: var(--text-primary); font-family: inherit; font-size: 10.5px; font-weight: 600;
          cursor: pointer; transition: background 0.14s;
        }
        .p2i-frame-bar button:hover { background: color-mix(in srgb, var(--text-primary) 14%, transparent); }
        .p2i-frame-bar button:focus-visible { outline: 2px solid color-mix(in srgb, var(--accent-start) 70%, transparent); outline-offset: -2px; }

        /* ══ The lightbox — inspecting a single frame at full size ══ */
        @keyframes p2i-lb-in { from { opacity: 0; transform: scale(0.985); } to { opacity: 1; transform: none; } }
        .p2i-lightbox {
          position: fixed; inset: 0; z-index: 80; outline: none;
          display: flex; flex-direction: column; align-items: center; justify-content: center;
          padding: 24px;
          background: color-mix(in srgb, var(--bg-page) 86%, transparent);
          backdrop-filter: blur(8px);
          animation: p2i-rise 0.22s var(--p2i-ease-out) both;
        }
        .p2i-lb-img {
          max-width: min(92vw, 1100px); max-height: 72vh;
          border-radius: 6px; box-shadow: var(--p2i-shadow-lift);
          background: var(--bg-card); user-select: none;
          animation: p2i-lb-in 0.2s var(--p2i-ease-out) both;
        }
        .p2i-lb-bar { display: flex; align-items: center; gap: 12px; margin-top: 16px; flex-wrap: wrap; justify-content: center; }
        .p2i-lb-name { font: 600 11px/1 ui-monospace, monospace; color: var(--text-secondary); word-break: break-all; }
        .p2i-lb-pos { font: 700 10px/1 ui-monospace, monospace; letter-spacing: 1.5px; color: var(--text-faint); }
        .p2i-lb-round {
          position: absolute; display: flex; align-items: center; justify-content: center;
          width: 38px; height: 38px; border-radius: 50%; cursor: pointer;
          border: 1px solid color-mix(in srgb, var(--text-faint) 40%, transparent);
          background: color-mix(in srgb, var(--bg-card) 82%, transparent);
          backdrop-filter: blur(4px); color: var(--text-secondary);
          transition: color 0.14s, border-color 0.14s, transform 0.14s var(--p2i-ease-out);
        }
        .p2i-lb-round:hover { color: var(--text-primary); border-color: color-mix(in srgb, var(--accent-start) 45%, transparent); transform: scale(1.06); }
        .p2i-lb-round:focus-visible { outline: 2px solid color-mix(in srgb, var(--accent-start) 60%, transparent); outline-offset: 2px; }
        .p2i-lb-close { top: 20px; right: 22px; }
        .p2i-lb-prev { left: 22px; top: 50%; translate: 0 -50%; }
        .p2i-lb-next { right: 22px; top: 50%; translate: 0 -50%; }
        .p2i-lb-prev svg { transform: scaleX(-1); }
        @media (max-width: 640px) {
          .p2i-lightbox { padding: 14px; }
          .p2i-lb-prev { left: 10px; } .p2i-lb-next { right: 10px; }
          .p2i-lb-close { top: 12px; right: 12px; }
          .p2i-lb-img { max-height: 62vh; }
        }

        /* ── Motion floor: reduced motion collapses everything to states ── */
        @media (prefers-reduced-motion: reduce) {
          .p2i, .p2i *, .p2i *::before, .p2i *::after {
            animation-duration: 0.01ms !important;
            animation-delay: 0ms !important;
            animation-iteration-count: 1 !important;
            transition-duration: 0.01ms !important;
          }
        }
      `}</style>

      <div className="p2i">

        {/* ── The zone: light table → table edge ── */}
        <div {...getRootProps({ className: zoneClass })}>
          <input {...getInputProps()} />

          <div className="p2i-shrink">
            <div className="p2i-zone-body">
              <div
                className="p2i-dropclick"
                role="button"
                tabIndex={0}
                aria-label="Choose a PDF file"
                onClick={open}
                onKeyDown={e => {
                  if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open() }
                }}
              >
                <div className="p2i-plate" aria-hidden="true">
                  <div className="p2i-plate-raster" />
                  <span className="p2i-plate-mark">PDF</span>
                  <div className="p2i-plate-lines" />
                </div>

                <div className="p2i-slots" aria-hidden="true">
                  <span className="p2i-slot"><i>01</i></span>
                  <span className="p2i-slot"><i>02</i></span>
                  <span className="p2i-slot"><i>03</i></span>
                </div>

                <p className="p2i-zone-title">
                  {isDragActive ? 'Release to develop.' : 'Place your PDF on the table'}
                </p>
                <p className="p2i-zone-sub">
                  or click to browse — every page comes out a frame
                </p>
                <p className="p2i-spec">PDF · MAX 50 MB · FRAMES + ZIP</p>
              </div>
            </div>
          </div>

          {file && phase !== 'table' && (
            <div className={`p2i-edge p2i-reveal`} style={ri(0)}>
              <div
                className="p2i-edge-plate"
                key={`${file.name}-${file.size}`}
                aria-hidden="true"
              >
                <div className="p2i-edge-raster" />
                <span className="p2i-edge-no">01</span>
              </div>
              <div style={{ minWidth: 0, flex: '1 1 150px' }}>
                <p className="p2i-edge-name">{file.name}</p>
                <p className="p2i-edge-meta">{fileSizeMB} MB · PDF Document</p>
              </div>
              <button
                type="button"
                className="p2i-ghost-btn"
                onClick={open}
                disabled={locked}
              >
                {Ic.swap} Replace
              </button>
              <button
                type="button"
                className="p2i-ghost-btn danger"
                onClick={resetToTable}
                disabled={locked}
              >
                {Ic.close} Remove
              </button>
              <div className="p2i-edge-drop" aria-hidden="true">Release to replace</div>
            </div>
          )}
        </div>

        {/* ── Error banner — the single error slot, never alert() ── */}
        {error && (
          <div className="p2i-error" role="alert">
            {Ic.alert}
            <span>{error}</span>
            <button type="button" className="p2i-error-x" onClick={() => setError('')} aria-label="Dismiss error">
              {Ic.close}
            </button>
          </div>
        )}

        {/* ── The bench + job ticket + action ── */}
        {file && phase !== 'done' && (
          <>
            <div className={`p2i-panel p2i-reveal${locked ? ' is-locked' : ''}`} style={ri(1)}>
              <div className="p2i-panel-head">
                {Ic.settings} Output
              </div>

              <div className="p2i-panel-body">

                <div className="p2i-bench">
                  {/* DPI */}
                  <div>
                    <span className="p2i-label">Resolution</span>
                    <div className="p2i-dpi-grid">
                      {DPI_OPTIONS.map(opt => (
                        <button
                          type="button"
                          key={opt.value}
                          className={`p2i-dpi-btn ${dpi === opt.value ? 'active' : ''}`}
                          onClick={() => setDpi(opt.value)}
                          disabled={locked}
                          aria-pressed={dpi === opt.value}
                        >
                          <div className="p2i-dpi-val">{opt.label}</div>
                          <div className="p2i-dpi-sub">{opt.sub}</div>
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Format — sliding pill */}
                  <div>
                    <span className="p2i-label">Format</span>
                    <div className={`p2i-fmt ${format === 'jpg' ? 'is-jpg' : ''}`}>
                      <span className="p2i-fmt-pill" aria-hidden="true" />
                      {FORMAT_OPTIONS.map(opt => (
                        <button
                          type="button"
                          key={opt.value}
                          className={`p2i-fmt-btn ${format === opt.value ? 'active' : ''}`}
                          onClick={() => setFormat(opt.value)}
                          disabled={locked}
                          aria-pressed={format === opt.value}
                        >
                          <div className="p2i-fmt-name">{opt.label}</div>
                          <div className="p2i-fmt-sub">{opt.sub}</div>
                        </button>
                      ))}
                    </div>
                  </div>
                </div>

                {/* Quality slider — JPEG only */}
                {format === 'jpg' && (
                  <div>
                    <span className="p2i-label">JPEG Quality</span>
                    <div className="p2i-q-row">
                      <input
                        type="range" min="60" max="100" step="5"
                        value={quality}
                        onChange={e => setQuality(Number(e.target.value))}
                        className="p2i-q-slider"
                        disabled={locked}
                        aria-label="JPEG quality"
                        style={{
                          background: `linear-gradient(90deg, var(--accent-start) ${((quality - 60) / 40) * 100}%, color-mix(in srgb, var(--text-faint) 45%, transparent) ${((quality - 60) / 40) * 100}%)`,
                        }}
                      />
                      <span className="p2i-q-val">{quality}%</span>
                    </div>
                  </div>
                )}

                {/* Page range */}
                <div>
                  <span className="p2i-label">
                    Page Range <span style={{ fontWeight: 400, opacity: 0.6, textTransform: 'none', letterSpacing: 0 }}>(optional)</span>
                  </span>
                  <input
                    type="text"
                    className={`p2i-range ${pageRangeError ? 'error' : ''}`}
                    placeholder='e.g. 1-5, 8, 10-12 — or leave blank for all pages'
                    value={pageRange}
                    onChange={e => validatePageRange(e.target.value)}
                    readOnly={locked}
                  />
                  {pageRangeError
                    ? <p className="p2i-range-error">{pageRangeError}</p>
                    : <p className="p2i-range-hint">Use commas and dashes · example: <code>1-3, 5, 8-10</code></p>
                  }
                </div>

              </div>
            </div>

            {/* Job ticket + action — one line: ticket left, compact CTA right */}
            <div className="p2i-action-row">
              <div className={`p2i-ticket p2i-reveal${locked ? ' is-locked' : ''}`} style={ri(2)}>
                <span className={`p2i-ticket-tag${pageRangeError ? ' is-bad' : ''}`}>
                  {pageRangeError ? 'RANGE ERROR' : 'READY'}
                </span>
                <span className="p2i-ticket-item">
                  {Ic.image}
                  <span>Format: <span className="p2i-ticket-val">{FORMAT_OPTIONS.find(o => o.value === format)?.label}</span></span>
                </span>
                <span className="p2i-ticket-item">
                  {Ic.settings}
                  <span>DPI: <span className="p2i-ticket-val">{dpi}</span></span>
                </span>
                {format === 'jpg' && (
                  <span className="p2i-ticket-item">
                    {Ic.page}
                    <span>Quality: <span className="p2i-ticket-val">{quality}%</span></span>
                  </span>
                )}
                <span className="p2i-ticket-item">
                  {Ic.page}
                  <span>Pages: <span className="p2i-ticket-val">
                    {pageRange.trim() && pageRange.trim().toLowerCase() !== 'all' ? pageRange.trim() : 'All'}
                  </span></span>
                </span>
                <span className="p2i-ticket-item">
                  {Ic.zip}
                  <span>Output: <span className="p2i-ticket-val">Frames + ZIP</span></span>
                </span>
              </div>

              <div className="p2i-convert-slot p2i-reveal" style={ri(3)}>
                <button
                  className={`p2i-convert${locked ? ' is-developing' : ''}`}
                  onClick={convertToImages}
                  disabled={locked || !!pageRangeError}
                  title={pageRangeError ? 'Fix the page range first' : undefined}
                >
                  <span className="p2i-convert-inner">
                    <span className="p2i-convert-badge" aria-hidden="true">
                      {locked
                        ? <KineticSphere className="p2i-orb" size={24} points={64} dot={0.9} />
                        : Ic.film}
                    </span>
                    <span className="p2i-convert-label">
                      {locked ? 'Developing pages…' : 'Develop images'}
                    </span>
                    {!locked && <span className="p2i-convert-chevron" aria-hidden="true">{Ic.chevron}</span>}
                  </span>
                </button>
                {locked && (
                  <button type="button" className="p2i-cancel" onClick={cancelDevelop}>
                    {Ic.close} Cancel
                  </button>
                )}
              </div>
            </div>
          </>
        )}

        {/* ── The receipt — the print session, not a dead download ── */}
        {phase === 'done' && result && (
          <>
            <div className="p2i-receipt p2i-reveal" role="status">
              <div className="p2i-receipt-check" aria-hidden="true">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M20 6 9 17l-5-5"/>
                </svg>
              </div>
              <div style={{ minWidth: 0 }}>
                <p className="p2i-receipt-title">Contact sheet developed</p>
                <p className="p2i-receipt-meta">
                  {frames.length > 0
                    ? `${frames.length} ${frames.length === 1 ? 'frame' : 'frames'} · ${result.size} MB archive`
                    : `${result.name} · ${result.size} MB archive`}
                </p>
              </div>
              <div className="p2i-receipt-actions">
                <button type="button" className="p2i-solid-btn" onClick={() => triggerDownload(result.url, result.name)}>
                  {Ic.zip} Download all · ZIP
                </button>
                <button type="button" className="p2i-ghost-btn" onClick={resetToTable}>
                  {Ic.swap} Convert another
                </button>
              </div>
            </div>

            {framesNote && <p className="p2i-note p2i-reveal" style={ri(1)}>{framesNote}</p>}

            {frames.length > 0 && (
              <>
                <div className="p2i-frames-head p2i-reveal" style={ri(1)}>
                  <span className="p2i-frames-title">The frames</span>
                  <span className="p2i-frames-hint">click a frame to inspect · download one page from its tray</span>
                </div>
                <div className="p2i-frame-grid" role="region" aria-label="Developed pages">
                  {frames.map((f, i) => (
                    <div
                      key={f.name}
                      className="p2i-frame p2i-reveal"
                      style={ri(Math.min(i, 10))}
                      role="button"
                      tabIndex={0}
                      aria-label={`Inspect page ${f.code} — ${f.name}`}
                      onClick={() => setView(i)}
                      onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setView(i) } }}
                    >
                      {/* blob: previews are runtime-generated — next/image cannot optimize an ObjectURL */}
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={f.url} alt={`Page ${f.code}`} loading="lazy" draggable={false}/>
                      <span className="p2i-frame-code" aria-hidden="true">{f.code}</span>
                      <div className="p2i-frame-bar">
                        <button
                          type="button"
                          onClick={e => { e.stopPropagation(); triggerDownload(f.url, f.name) }}
                          aria-label={`Download ${f.name}`}
                        >
                          {Ic.download} Download
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}
          </>
        )}

        {/* ── The lightbox — one frame at full size, arrows step, Esc leaves ── */}
        {lightboxFrame && (
          <div
            className="p2i-lightbox"
            role="dialog"
            aria-modal="true"
            aria-label={`Preview of ${lightboxFrame.name}`}
            tabIndex={-1}
            ref={lbRef}
          >
            <button type="button" className="p2i-lb-round p2i-lb-close" onClick={() => setView(null)} aria-label="Close preview">
              {Ic.close}
            </button>
            {frames.length > 1 && (
              <>
                <button type="button" className="p2i-lb-round p2i-lb-prev" onClick={() => stepView(-1)} aria-label="Previous page">
                  {Ic.chevron}
                </button>
                <button type="button" className="p2i-lb-round p2i-lb-next" onClick={() => stepView(1)} aria-label="Next page">
                  {Ic.chevron}
                </button>
              </>
            )}
            {/* eslint-disable-next-line @next/next/no-img-element -- blob: preview, not optimizable */}
            <img
              key={lightboxFrame.name}
              className="p2i-lb-img"
              src={lightboxFrame.url}
              alt={lightboxFrame.name}
              draggable={false}
            />
            <div className="p2i-lb-bar">
              <span className="p2i-lb-name">{lightboxFrame.name}</span>
              <span className="p2i-lb-pos">{view !== null ? String(view + 1).padStart(2, '0') : '00'} / {String(frames.length).padStart(2, '0')}</span>
              <button
                type="button" className="p2i-solid-btn"
                onClick={() => triggerDownload(lightboxFrame.url, lightboxFrame.name)}
              >
                {Ic.download} Download page
              </button>
            </div>
          </div>
        )}

      </div>
    </>
  )
}
