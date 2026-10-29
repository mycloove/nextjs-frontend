'use client'

/*
  Image → Text — "the reading instrument"

  Design contract (Astrolabe Standard, bench register):
  - One persistent frame with three fixed regions (header strip / stage /
    action bar). States happen INSIDE the frame; nothing is ever appended
    below it, so future features get a declared seat instead of a new stack
    of cards.
  - Register brackets (the four corner L-marks) are the frame's identity —
    print register marks are where plates align for exact reading, which is
    what OCR does. They draw inward and take the accent while a drop hovers.
  - Script calibration: the segmented control in the side column is the
    instrument's lens setting — which script(s) to read. It stays in the
    frame across images (a sticky instrument setting, unlike the plate),
    and is disabled while a reading is in flight.
  - One signature motion moment: extracted text RESOLVES into focus
    (blur → sharp, staggered) as it arrives. The reading loader is the SAME
    motif, not a second one: reading-in-progress is the pre-image of that
    resolve (a scan walks the plate; character cells settle). Everything else
    stays quiet.
  - No simulated progress: while reading, the scan head and the elapsed
    seconds are the whole truth. The loader is deliberately indeterminate —
    no percentage, no per-stage tracker. After reading, the instrument reports
    its own confidence honestly — a low reading gets a visible advisory, never
    a hidden failure or an invented success.
  - object-fit: contain — the preview never crops what will be read.
  - Two readings, both honest (the no-loss contract): the instrument keeps
    the Clean reading (reconstructed prose; a word it could not read is
    masked as '?' rather than guessed) and the Complete reading (every word
    it read, unmasked and unreworded). The Clean/Complete control is the
    instrument's reading mode, so it wears the same segmented-control form
    as the Script lens setting above it — one control language, two
    settings. Switching replays the resolve animation, which is the same
    signature moment used on arrival, not a second one.
  - Clean is rendered as a document, not a transcript: the backend's
    paragraph blocks arrive labelled (heading / list / body) and the view
    gives each its real typographic weight. Hard-wrapped OCR lines are
    reflowed server-side into prose, so a paragraph reads as a paragraph
    at any width. Complete stays line-preserving, because the untouched
    layout is exactly what that reading is for.
  - The reading is a document reader, not a transcript box: a measure that
    reads (~68ch), a contents outline built from the real heading blocks, a
    find-in-reading control, a density setting, and — when the plate really
    had more than one column — a source-layout reading rendered as columns.
    Structured extras (fields ledger, tables) arrive because the reader asks
    for them (structure=1); they render only when actually present.
  - Palette is surface-1 tokens only; the coral accent is reserved for state
    and action. --i2t-ink is the one local constant (text on the accent fill);
    it is theme-invariant because both accent stops are theme-invariant.
*/

import { useState, useCallback, useEffect, useRef, useMemo, Fragment } from 'react'
import type { CSSProperties, ReactNode } from 'react'
import { useDropzone, type FileRejection } from 'react-dropzone'
import { ApiClientError, getApiErrorMessage, toolRequest } from '@/lib/api/client'

/* ── Icons ─────────────────────────────────────────────────── */
const Ic = {
  scan: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 7V5a2 2 0 0 1 2-2h2M17 3h2a2 2 0 0 1 2 2v2M21 17v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2" />
      <line x1="3" y1="12" x2="21" y2="12" />
    </svg>
  ),
  image: (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <circle cx="8.5" cy="8.5" r="1.4" />
      <path d="M21 15l-4.5-4.5L6 21" />
    </svg>
  ),
  copy: (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="9" y="9" width="13" height="13" rx="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </svg>
  ),
  download: (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="7 10 12 15 17 10" />
      <line x1="12" y1="15" x2="12" y2="3" />
    </svg>
  ),
  check: (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  ),
  close: (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
      <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  ),
  retry: (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="1 4 1 10 7 10" />
      <path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10" />
    </svg>
  ),
  find: (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="11" cy="11" r="7" />
      <line x1="21" y1="21" x2="16.5" y2="16.5" />
    </svg>
  ),
  contents: (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <line x1="3" y1="6" x2="14" y2="6" /><line x1="3" y1="12" x2="14" y2="12" /><line x1="3" y1="18" x2="14" y2="18" />
      <line x1="18" y1="6" x2="21" y2="6" /><line x1="18" y1="12" x2="21" y2="12" /><line x1="18" y1="18" x2="21" y2="18" />
    </svg>
  ),
  markdown: (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2.5" y="5" width="19" height="14" rx="2" />
      <path d="M6 15V9l2.6 3L11.2 9v6" />
      <path d="M17.5 9v4.2M17.5 13.2l-1.8-1.8M17.5 13.2l1.8-1.8" />
    </svg>
  ),
  up: (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="6 15 12 9 18 15" />
    </svg>
  ),
  down: (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="6 9 12 15 18 9" />
    </svg>
  ),
}

type Phase = 'empty' | 'placed' | 'reading' | 'read' | 'emptyResult'

/* The instrument keeps two readings of one plate. `clean` is the
   reconstructed prose (unreadable words masked as '?'); `complete` is every
   word as read, nothing masked or dropped. Both come from the same OCR pass,
   so switching between them is instant and never re-reads the image.
   `source` is the plate's own column layout, offered only when the backend
   actually detected more than one column. */
type ReadingView = 'clean' | 'complete' | 'source'

/* One paragraph of the clean reading, labelled by the backend from real
   signals (relative glyph height for headings, a leading bullet or ordinal
   for lists). Rendering these as a flat run of lines would throw away the
   only structure the reading has. */
type ReadingBlock = {
  kind: 'heading' | 'body' | 'list'
  text: string
  level?: number
  marker?: string
}

function isReadingBlock(value: unknown): value is ReadingBlock {
  if (!value || typeof value !== 'object') return false
  const block = value as Record<string, unknown>
  return (
    typeof block.text === 'string' &&
    (block.kind === 'heading' || block.kind === 'body' || block.kind === 'list')
  )
}

/* Structured extras the instrument may return (the reader asks for them).
   A table is rows of cells; a field is a label/value pair (receipt-style).
   Both are only rendered when actually present — the instrument never shows
   an empty scaffold for work it did not do. */
type ReadingTable = { rows: string[][] }
type ExtractedField = { label: string; value: string }

/* A source-layout region: one detected column, with its x-span and its lines
   as plain text. Rendered text-only — never drawn over the preview, because
   the coordinates are in the preprocessed image's space, not the original. */
type LayoutRegion = { kind: 'column'; index: number; x0: number; x1: number; lines: string[] }

function isTable(value: unknown): value is ReadingTable {
  if (!value || typeof value !== 'object') return false
  const rows = (value as { rows?: unknown }).rows
  return Array.isArray(rows) && rows.every(row => Array.isArray(row))
}

function isField(value: unknown): value is ExtractedField {
  if (!value || typeof value !== 'object') return false
  const field = value as Record<string, unknown>
  return typeof field.label === 'string' && typeof field.value === 'string'
}

function isLayoutRegion(value: unknown): value is LayoutRegion {
  if (!value || typeof value !== 'object') return false
  const region = value as Record<string, unknown>
  return Array.isArray(region.lines) && region.lines.every(line => typeof line === 'string')
}

/* Script calibration — the values are the backend's accepted language
   choices (features/image_to_text.py _LANGUAGE_CHOICES). 'auto' is the
   honest default: the instrument reads English unless told otherwise. */
const LANG_OPTIONS = [
  { value: 'auto', label: 'Auto' },
  { value: 'eng', label: 'English' },
  { value: 'ben', label: 'বাংলা' },
  { value: 'eng+ben', label: 'EN+বাংলা' },
] as const

type LangValue = (typeof LANG_OPTIONS)[number]['value']
type Density = 'comfortable' | 'compact'

/* Must match the proxy route's default (app/api/image-to-text/route.ts);
   kept in sync so oversized files are refused in the browser, before any
   upload begins. */
const MAX_IMAGE_MB = 20

/* Below this mean confidence the reading is flagged — the advisory tells
   the user what usually fixes it instead of hiding the doubt. */
const LOW_CONFIDENCE = 60

/* The reading loader is indeterminate by contract — these are character
   cells, not a progress bar. Row lengths only vary so it reads like text. */
const DECODE_ROWS = [16, 12, 15, 9, 14, 7]

/* One part of a block's text after find-in-reading splitting. A part with a
   `gi` is a match, and `gi` is its global index across the whole reading so
   next/prev can address it. */
type MatchPart = { text: string; gi?: number }

function buildMatches(units: string[], rawQuery: string): { perUnit: MatchPart[][]; total: number } {
  const query = rawQuery.trim().toLowerCase()
  const perUnit: MatchPart[][] = []
  let gi = 0
  for (const text of units) {
    const parts: MatchPart[] = []
    if (!query) {
      parts.push({ text })
      perUnit.push(parts)
      continue
    }
    const lower = text.toLowerCase()
    let i = 0
    for (;;) {
      const idx = lower.indexOf(query, i)
      if (idx < 0) {
        if (i < text.length) parts.push({ text: text.slice(i) })
        break
      }
      if (idx > i) parts.push({ text: text.slice(i, idx) })
      parts.push({ text: text.slice(idx, idx + query.length), gi })
      gi += 1
      i = idx + query.length
    }
    perUnit.push(parts)
  }
  return { perUnit, total: gi }
}

/* Render one block's parts, wrapping matches in <mark>. A plain function (not
   a component) so the ref callback stays stable across renders. */
function renderMatchParts(
  parts: MatchPart[],
  active: number,
  register: (gi: number, el: HTMLElement | null) => void,
): ReactNode {
  return parts.map((part, i) =>
    part.gi === undefined ? (
      <Fragment key={i}>{part.text}</Fragment>
    ) : (
      <mark
        key={i}
        className={`i2t-mark${part.gi === active ? ' cur' : ''}`}
        ref={el => register(part.gi as number, el)}
      >
        {part.text}
      </mark>
    ),
  )
}

/* ─────────────────────────────────────────────────────────────
   Component
   ───────────────────────────────────────────────────────────── */
export default function ImageToText() {
  const [file, setFile]             = useState<File | null>(null)
  const [preview, setPreview]       = useState<string | null>(null)
  const [loading, setLoading]       = useState(false)
  const [cleanText, setCleanText]   = useState('')
  const [completeText, setCompleteText] = useState('')
  const [blocks, setBlocks]         = useState<ReadingBlock[]>([])
  const [readAttempted, setReadAttempted] = useState(false)
  const [view, setView]             = useState<ReadingView>('clean')
  const [uncertainWords, setUncertainWords] = useState(0)
  const [confidenceFloor, setConfidenceFloor] = useState(40)
  const [ocrPasses, setOcrPasses]   = useState(0)
  const [error, setError]           = useState<string | null>(null)
  const [copied, setCopied]         = useState(false)
  const [mdCopied, setMdCopied]     = useState(false)
  const [dims, setDims]             = useState<{ w: number; h: number } | null>(null)
  const [elapsed, setElapsed]       = useState(0)
  const [lang, setLang]             = useState<LangValue>('auto')
  const [meanConf, setMeanConf]     = useState<number | null>(null)
  const [prepSteps, setPrepSteps]   = useState<string[]>([])
  /* Which engine(s) read the plate — always reported by the backend, so the
     record line can state it truthfully. */
  const [engineChain, setEngineChain] = useState<string[]>([])
  /* Structured extras (server flags); empty when the page had none, in which
     case they are not rendered at all. */
  const [tables, setTables]         = useState<ReadingTable[]>([])
  const [fields, setFields]         = useState<ExtractedField[]>([])
  const [layout, setLayout]         = useState<LayoutRegion[]>([])
  /* Reader controls — all client-side over the reading already in memory. */
  const [query, setQuery]           = useState('')
  const [activeMatch, setActiveMatch] = useState(0)
  const [outlineOpen, setOutlineOpen] = useState(false)
  const [activeSection, setActiveSection] = useState<number>(-1)
  const [density, setDensity]       = useState<Density>('comfortable')

  const previewRef = useRef<string | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  /* A cancel through toolRequest arrives as an ApiClientError whose cause is the
     AbortError, so a deliberate stop is told apart from a real failure. */
  const isCancellation = (e: unknown) =>
    e instanceof ApiClientError && (e.cause as { name?: string } | undefined)?.name === 'AbortError'
  const matchRefs = useRef<(HTMLElement | null)[]>([])
  const textRef = useRef<HTMLDivElement | null>(null)

  const resetReader = useCallback(() => {
    setQuery('')
    setActiveMatch(0)
    setOutlineOpen(false)
    setActiveSection(-1)
    matchRefs.current = []
  }, [])

  /* ── Accept an image (shared by drop, click-browse and paste) ── */
  const acceptFile = useCallback((img: File) => {
    abortRef.current?.abort()
    if (img.size > MAX_IMAGE_MB * 1024 * 1024) {
      setError(`That image is ${(img.size / 1024 / 1024).toFixed(0)} MB — the reading limit is ${MAX_IMAGE_MB} MB.`)
      return
    }
    if (previewRef.current) URL.revokeObjectURL(previewRef.current)
    const url = URL.createObjectURL(img)
    previewRef.current = url
    setFile(img)
    setPreview(url)
    setCleanText('')
    setCompleteText('')
    setBlocks([])
    setReadAttempted(false)
    setView('clean')
    setUncertainWords(0)
    setOcrPasses(0)
    setError(null)
    setCopied(false)
    setMdCopied(false)
    setDims(null)
    setMeanConf(null)
    setPrepSteps([])
    setEngineChain([])
    setTables([])
    setFields([])
    setLayout([])
    resetReader()
  }, [resetReader])

  /* Revoke on unmount — blob URLs otherwise leak for every image ever placed. */
  useEffect(() => () => {
    abortRef.current?.abort()
    if (previewRef.current) URL.revokeObjectURL(previewRef.current)
  }, [])

  const onDrop = useCallback((accepted: File[], rejections: FileRejection[]) => {
    const img = accepted[0]
    if (img) { acceptFile(img); return }
    if (rejections.length) setError('That\u2019s not an image — JPG, PNG, WEBP, GIF or BMP.')
  }, [acceptFile])

  const { getRootProps, getInputProps, isDragActive, isDragReject } = useDropzone({
    onDrop,
    accept: { 'image/*': ['.jpeg', '.jpg', '.png', '.gif', '.bmp', '.webp'] },
    maxFiles: 1,
    /* With an image on the stage, a click on it shouldn't pop the file dialog —
       drops and paste still replace. While reading, the stage accepts nothing. */
    noClick: !!file,
    disabled: loading,
  })

  /* ── Paste an image straight from the clipboard ──
     A screenshot is the single most common OCR input; it costs one listener. */
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      if (loading) return
      const target = e.target as HTMLElement | null
      // Don't hijack a paste into the find field.
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return
      const files = e.clipboardData?.files
      if (!files?.length) return
      const img = Array.from(files).find(f => f.type.startsWith('image/'))
      if (img) { e.preventDefault(); acceptFile(img) }
    }
    window.addEventListener('paste', onPaste)
    return () => window.removeEventListener('paste', onPaste)
  }, [loading, acceptFile])

  /* ── Honest elapsed seconds — the only progress indicator alongside the scan ── */
  useEffect(() => {
    if (!loading) return
    const started = Date.now()
    setElapsed(0)
    const id = setInterval(() => setElapsed(Math.floor((Date.now() - started) / 1000)), 1000)
    return () => clearInterval(id)
  }, [loading])

  /* ── Extract ── */
  const extractText = async () => {
    if (!file || loading) return
    setLoading(true)
    setError(null)
    setCleanText('')
    setCompleteText('')
    setBlocks([])
    setReadAttempted(false)
    setView('clean')
    setUncertainWords(0)
    setOcrPasses(0)
    setMeanConf(null)
    setPrepSteps([])
    setEngineChain([])
    setTables([])
    setFields([])
    setLayout([])
    resetReader()
    const controller = new AbortController()
    abortRef.current = controller
    try {
      const formData = new FormData()
      formData.append('image', file)
      formData.append('language', lang)

      const res = await toolRequest('/api/image-to-text', {
        method: 'POST', body: formData, signal: controller.signal,
      })
      if (!res.ok) {
        throw new Error(await getApiErrorMessage(res, 'We could not read this image. Please try again.'))
      }
      const data = await res.json()
      const clean = typeof data?.text === 'string' ? data.text : ''
      const complete = typeof data?.fullText === 'string' ? data.fullText : clean
      const regions = Array.isArray(data?.layout) ? data.layout.filter(isLayoutRegion) : []
      setCleanText(clean)
      setCompleteText(complete)
      setBlocks(Array.isArray(data?.paragraphs) ? data.paragraphs.filter(isReadingBlock) : [])
      setLayout(regions)
      // If the clean reading is empty but the complete one is not, the words
      // were all below the floor — default to the reading that has them, so
      // the instrument never shows "no text" while holding text.
      setView(complete.trim() && !clean.trim() ? 'complete' : 'clean')
      setUncertainWords(typeof data?.uncertainWordCount === 'number' ? data.uncertainWordCount : 0)
      setConfidenceFloor(typeof data?.confidenceFloor === 'number' ? data.confidenceFloor : 40)
      setOcrPasses(typeof data?.ocrPasses === 'number' ? data.ocrPasses : 0)
      setMeanConf(typeof data?.meanConfidence === 'number' ? data.meanConfidence : null)
      if (Array.isArray(data?.preprocessing)) setPrepSteps(data.preprocessing)
      if (Array.isArray(data?.engineChain)) {
        setEngineChain(data.engineChain.filter((name: unknown): name is string => typeof name === 'string'))
      } else if (typeof data?.engine === 'string') {
        setEngineChain([data.engine])
      }
      setTables(Array.isArray(data?.tables) ? data.tables.filter(isTable) : [])
      setFields(Array.isArray(data?.fields) ? data.fields.filter(isField) : [])
      setReadAttempted(true)
    } catch (e) {
      if (isCancellation(e)) {
        // deliberate cancel — nothing to report
      } else {
        setError(e instanceof Error ? e.message : 'Failed to extract text. Please try again.')
      }
    } finally {
      abortRef.current = null
      setLoading(false)
    }
  }

  /* ── Clipboard ── */
  const copyToClipboard = async () => {
    try {
      await navigator.clipboard.writeText(displayText)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      /* clipboard unavailable (e.g. insecure context) — the button simply doesn't flip */
    }
  }

  const copyMarkdown = async () => {
    try {
      await navigator.clipboard.writeText(buildMarkdown())
      setMdCopied(true)
      setTimeout(() => setMdCopied(false), 2000)
    } catch {
      /* clipboard unavailable — the button simply doesn't flip */
    }
  }

  /* ── Cancel an in-flight read ── */
  const cancelRead = () => {
    abortRef.current?.abort()
  }

  /* ── Download ── */
  /* The saved file is named after the source image — a reading *of* that image,
     not a meaningless timestamp. */
  const downloadBlob = (content: string, mime: string, extension: string) => {
    const base = file ? file.name.replace(/\.[^.]+$/, '').replace(/[^\w.-]+/g, '_') : 'image'
    const blob = new Blob([content], { type: mime })
    const url = URL.createObjectURL(blob)
    const a = Object.assign(document.createElement('a'), {
      href: url,
      download: `mycloove_${base}_OCR.${extension}`,
    })
    document.body.appendChild(a); a.click(); document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  const downloadText = () => downloadBlob(displayText, 'text/plain', 'txt')
  const downloadMarkdown = () => downloadBlob(buildMarkdown(), 'text/markdown', 'md')

  /* ── Clear ── */
  const clearAll = () => {
    abortRef.current?.abort()
    if (previewRef.current) URL.revokeObjectURL(previewRef.current)
    previewRef.current = null
    setFile(null)
    setPreview(null)
    setCleanText('')
    setCompleteText('')
    setBlocks([])
    setReadAttempted(false)
    setView('clean')
    setUncertainWords(0)
    setOcrPasses(0)
    setError(null)
    setCopied(false)
    setMdCopied(false)
    setDims(null)
    setElapsed(0)
    setMeanConf(null)
    setPrepSteps([])
    setEngineChain([])
    setTables([])
    setFields([])
    setLayout([])
    resetReader()
  }

  /* ── Derived ── */
  /* The clean reading renders from structure; if the backend sent none
     (older response, or an all-empty read), fall back to blank-line split so
     paragraphs still separate instead of collapsing into one block. */
  const cleanBlocks: ReadingBlock[] = useMemo(
    () => (blocks.length
      ? blocks
      : cleanText.split(/\n{2,}/).map(text => text.trim()).filter(Boolean)
          .map(text => ({ kind: 'body' as const, text }))),
    [blocks, cleanText],
  )
  const completeLines = useMemo(
    () => (completeText ? completeText.split('\n') : []),
    [completeText],
  )
  /* The plate's own column layout, flattened for text and copy. */
  const sourceText = useMemo(
    () => layout.map(region => region.lines.join('\n')).join('\n\n'),
    [layout],
  )

  /* The display text is whichever reading is selected. All three arrive in one
     response, so the toggle is a pure view switch — no re-read. */
  const displayText =
    view === 'complete' ? completeText
      : view === 'source' ? sourceText
        : cleanText
  const hasAnyText = cleanText.trim().length > 0 || completeText.trim().length > 0
  const canToggle = completeText !== cleanText
  const hasSource = layout.length > 1
  const showReadingControl = canToggle || hasSource

  const phase: Phase = !file
    ? 'empty'
    : loading
      ? 'reading'
      : hasAnyText
        ? 'read'
        : readAttempted
          ? 'emptyResult'
          : 'placed'

  const wordCount = displayText.trim() ? displayText.trim().split(/\s+/).length : 0
  const charCount = displayText.length
  const lineCount = displayText.trim() ? displayText.trim().split('\n').length : 0
  const fileSizeMB = file ? (file.size / 1024 / 1024).toFixed(2) : '0'
  const isReadLayout = phase === 'read' || phase === 'emptyResult'
  const isLowConfidence = meanConf !== null && meanConf < LOW_CONFIDENCE
  /* The class:* entries are the instrument's internal bookkeeping — the
     user-facing record is what was done to the image, not what it's called. */
  const visibleSteps = prepSteps.filter(s => !s.startsWith('class:'))
  /* The record line: what was done to obtain this reading — the engine that
     read it plus the conditioning applied to the plate — in one faint trace. */
  const record = [
    engineChain.length ? `engine:${engineChain.join('+')}` : '',
    ...visibleSteps,
    ocrPasses > 1 ? `${ocrPasses} passes` : '',
  ].filter(Boolean)
  const hasStructure = fields.length > 0 || tables.length > 0

  /* The contents outline — built from the clean reading's real heading blocks,
     in document order. Only useful (and only shown) when there are ≥2. */
  const outline = useMemo(
    () => cleanBlocks
      .map((block, index) => ({ block, index }))
      .filter(entry => entry.block.kind === 'heading')
      .map(entry => ({ index: entry.index, text: entry.block.text, level: entry.block.level ?? 1 })),
    [cleanBlocks],
  )

  /* Find-in-reading units mirror exactly what is on screen for the current
     view, so a match index always maps to a rendered element. */
  const readerUnits = useMemo(() => {
    if (view === 'source') return layout.flatMap(region => region.lines)
    if (view === 'complete') return completeLines
    return cleanBlocks.map(block => block.text)
  }, [view, layout, completeLines, cleanBlocks])

  const matchData = useMemo(() => buildMatches(readerUnits, query), [readerUnits, query])
  const totalMatch = matchData.total
  const curMatch = totalMatch ? Math.min(activeMatch, totalMatch - 1) : 0

  const registerMatch = useCallback((gi: number, el: HTMLElement | null) => {
    matchRefs.current[gi] = el
  }, [])

  const goToMatch = (delta: number) => {
    if (!totalMatch) return
    setActiveMatch((totalMatch + (curMatch + delta) % totalMatch) % totalMatch)
  }

  const jumpToSection = (index: number) => {
    const el = document.getElementById(`i2t-b${index}`)
    if (el) el.scrollIntoView({ block: 'start' })
  }

  /* Scroll the current match into view when it changes. */
  useEffect(() => {
    if (!query || !totalMatch) return
    matchRefs.current[curMatch]?.scrollIntoView({ block: 'center' })
  }, [curMatch, query, totalMatch])

  /* Track the section under the reading's top edge — an observer, not a scroll
     handler. Re-runs only when the reading or the outline actually changes. */
  useEffect(() => {
    if (view !== 'clean' || outline.length < 2) return
    const root = textRef.current
    if (!root || typeof IntersectionObserver === 'undefined') return
    const headingIds = new Set(outline.map(item => item.index))
    const elements: HTMLElement[] = []
    root.querySelectorAll<HTMLElement>('[data-bi]').forEach(el => {
      if (headingIds.has(Number(el.dataset.bi))) elements.push(el)
    })
    if (!elements.length) return
    const observer = new IntersectionObserver(entries => {
      const visible = entries
        .filter(entry => entry.isIntersecting)
        .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0]
      if (visible) {
        const bi = Number((visible.target as HTMLElement).dataset.bi)
        if (!Number.isNaN(bi)) setActiveSection(bi)
      }
    }, { root, rootMargin: '0px 0px -68% 0px', threshold: 0 })
    elements.forEach(el => observer.observe(el))
    return () => observer.disconnect()
  }, [view, outline])

  /* One advisory at a time, most specific first. The complete reading states
     what it is before anything else; the clean reading warns about masked
     words before it warns about overall confidence. Source layout has none. */
  const advisory: 'complete' | 'uncertain' | 'low' | null =
    phase !== 'read' || view === 'source' ? null
      : view === 'complete' ? 'complete'
        : uncertainWords > 0 ? 'uncertain'
          : isLowConfidence ? 'low'
            : null

  const stateSuffix =
    phase === 'reading' ? ' \u00B7 reading' :
    phase === 'read' ? ' \u00B7 read' :
    phase === 'emptyResult' ? ' \u00B7 no text found' :
    error ? ' \u00B7 error' : ''

  const stageLabel = file
    ? 'Replace the image — drop or paste a new one'
    : 'Place an image to read — drop, paste, or press Enter to browse'

  const langLabel = LANG_OPTIONS.find(option => option.value === lang)?.label ?? 'Auto'

  /* ── Markdown export ──
     Structure-preserving: headings become ATX headings at the level the
     backend assigned, lists become bullet items, body stays a paragraph. */
  const buildMarkdown = () => {
    const source = cleanBlocks.length
      ? cleanBlocks
      : cleanText.split(/\n{2,}/).map(text => ({ kind: 'body' as const, text: text.trim() }))
          .filter(block => block.text)
    return source
      .map(block => {
        if (block.kind === 'heading') return `${block.level === 2 ? '##' : '#'} ${block.text}`
        if (block.kind === 'list') {
          const marker = block.marker && /^\d/.test(block.marker) ? block.marker : '-'
          return `${marker} ${block.text}`
        }
        return block.text
      })
      .join('\n\n')
  }

  return (
    <>
      <style>{`
        /* ── Local tokens ──
           --i2t-ink is text on the accent fill. The accent stops are identical
           in both themes, so the ink that sits on them is theme-invariant too. */
        .i2t {
          --i2t-ink: #1d1b16;
          --i2t-ease: cubic-bezier(0.16, 1, 0.3, 1);
          --i2t-theme: cubic-bezier(0.4, 0, 0.2, 1);
          max-width: 1080px;
          margin: 0 auto;
          width: 100%;
        }

        /* ── Keyframes ── */
        @keyframes i2t-enter {
          from { opacity: 0; transform: translateY(4px); }
          to   { opacity: 1; transform: none; }
        }
        @keyframes i2t-resolve {
          from { opacity: 0; filter: blur(8px); transform: translateY(2px); }
          to   { opacity: 1; filter: blur(0);   transform: none; }
        }
        @keyframes i2t-scan {
          0%   { top: 0; opacity: 0; }
          10%  { opacity: 1; }
          90%  { top: calc(100% - 2px); opacity: 1; }
          100% { top: calc(100% - 2px); opacity: 0; }
        }
        @keyframes i2t-cell {
          0%, 100% { opacity: 0.25; transform: scaleY(1); }
          50%      { opacity: 0.9;  transform: scaleY(1.08); }
        }
        @keyframes i2t-pulse {
          0%, 100% { opacity: 1; }
          50%      { opacity: 0.35; }
        }

        /* ── The frame ── */
        /* The frame is the tool's content, not a second card. The workspace
           panel (ToolWorkspace .toolSurface) is the single surface, so the
           instrument draws no background/border/shadow of its own inside it —
           that nested card cost space and read as a panel-in-a-panel. The drag
           affordance now lives on the tint + an inset ring. */
        .i2t-frame {
          position: relative;
          display: flex;
          flex-direction: column;
          border-radius: 12px;
          transition: box-shadow 0.2s var(--i2t-theme), background-color 0.35s var(--i2t-theme);
        }
        .i2t-frame::before {
          content: '';
          position: absolute;
          inset: 0;
          border-radius: inherit;
          background: var(--accent-start);
          opacity: 0;
          transition: opacity 0.2s var(--i2t-theme);
          pointer-events: none;
        }
        .i2t-frame.drag   { box-shadow: inset 0 0 0 1.5px var(--accent-start); }
        .i2t-frame.drag::before   { opacity: 0.05; }
        .i2t-frame.reject { box-shadow: inset 0 0 0 1.5px var(--brand-red); }
        .i2t-frame.reject::before { background: var(--brand-red); opacity: 0.05; }

        /* ── Register brackets — the frame's identity, always present ── */
        .i2t-br {
          position: absolute;
          width: 12px;
          height: 12px;
          color: var(--text-faint);
          pointer-events: none;
          z-index: 1;
          transition: color 0.2s var(--i2t-ease), transform 0.2s var(--i2t-ease);
        }
        .i2t-br-tl { top: 9px;    left: 9px;  border-top: 1.5px solid currentColor; border-left: 1.5px solid currentColor; }
        .i2t-br-tr { top: 9px;    right: 9px; border-top: 1.5px solid currentColor; border-right: 1.5px solid currentColor; }
        .i2t-br-bl { bottom: 9px; left: 9px;  border-bottom: 1.5px solid currentColor; border-left: 1.5px solid currentColor; }
        .i2t-br-brr { bottom: 9px; right: 9px; border-bottom: 1.5px solid currentColor; border-right: 1.5px solid currentColor; }
        .i2t-frame.drag .i2t-br   { color: var(--accent-start); }
        .i2t-frame.reject .i2t-br { color: var(--brand-red); }
        .i2t-frame.drag .i2t-br-tl  { transform: translate(4px, 4px); }
        .i2t-frame.drag .i2t-br-tr  { transform: translate(-4px, 4px); }
        .i2t-frame.drag .i2t-br-bl  { transform: translate(4px, -4px); }
        .i2t-frame.drag .i2t-br-brr { transform: translate(-4px, -4px); }
        /* The register marks frame the empty instrument. Once a plate is on the
           stage they have done their job, so they drop out of the post-drop UI
           (the dropzone keeps its framing). */
        .i2t-frame:not([data-phase="empty"]) .i2t-br { display: none; }

        /* ── Region A — header strip ── */
        .i2t-head {
          display: flex;
          align-items: center;
          gap: 10px;
          min-height: 46px;
          padding: 14px 0;
          flex-wrap: wrap;
          transition: box-shadow 0.2s var(--i2t-theme);
        }
        .i2t-head.error { box-shadow: inset 2px 0 0 var(--brand-red); }
        .i2t-dot {
          width: 6px;
          height: 6px;
          border-radius: 50%;
          background: var(--text-faint);
          flex-shrink: 0;
          transition: background 0.2s var(--i2t-theme);
        }
        .i2t-frame[data-phase="placed"] .i2t-dot { background: var(--text-secondary); }
        .i2t-frame[data-phase="reading"] .i2t-dot { background: var(--accent-start); animation: i2t-pulse 1.6s ease-in-out infinite; }
        .i2t-frame[data-phase="read"] .i2t-dot { background: var(--accent-start); }
        .i2t-frame[data-phase="emptyResult"] .i2t-dot { background: var(--text-muted); }
        .i2t-file {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          min-width: 0;
          max-width: 58%;
          padding: 4px 10px;
          border-radius: 7px;
          background: var(--bg-badge);
          border: 1px solid var(--border-badge);
        }
        .i2t-file-ic { display: inline-flex; color: var(--accent-start); flex: none; }
        .i2t-file-name {
          font-family: 'DM Sans', sans-serif;
          font-size: 11.5px;
          font-weight: 600;
          letter-spacing: 0.2px;
          color: var(--text-primary);
          min-width: 0;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .i2t-state { font-family: 'DM Sans', sans-serif; font-weight: 500; font-size: 11px; color: var(--text-muted); }
        .i2t-meta {
          margin-left: auto;
          font-size: 11px;
          color: var(--text-muted);
          font-variant-numeric: tabular-nums;
          white-space: nowrap;
        }
        .i2t-err {
          margin-left: auto;
          display: inline-flex;
          align-items: center;
          gap: 7px;
          font-size: 11.5px;
          font-weight: 600;
          line-height: 1.4;
          color: var(--brand-red);
          text-align: right;
          min-width: 0;
        }
        .i2t-err::before {
          content: '';
          flex: none;
          width: 6px;
          height: 6px;
          border-radius: 50%;
          background: var(--brand-red);
        }

        /* ── Region B — stage (the dropzone root) ── */
        .i2t-stage { position: relative; flex: 1; outline: none; }
        .i2t-frame[data-phase="empty"] .i2t-stage { cursor: pointer; }
        .i2t-stage:focus-visible { outline: 2px solid var(--accent-start); outline-offset: -2px; }

        .i2t-enter { animation: i2t-enter 220ms var(--i2t-ease) both; }

        /* ── Empty state — the dropzone is the whole surface ──
           With no plate and no reading, the header strip and the action bar
           hold nothing, so they would be two empty bars ruled off by dividers
           — the panel read as boxed-in rather than as one clean instrument.
           Both regions return, with their own dividers, the moment a plate is
           placed, so nothing is appended and the frame's structure is intact.
           The header stays when an error is showing (an oversized drop is set
           while still empty), so the message is never hidden. */
        .i2t-frame[data-phase="empty"] .i2t-bar { display: none; }
        .i2t-frame[data-phase="empty"]:not([data-error]) .i2t-head { display: none; }

        /* ── Empty composition — the plate bed ──
           The raster→characters transformation stated once, statically, in
           the instrument's own materials. It is a depiction, not a second
           signature: no motion lives here. */
        .i2t-empty {
          min-height: 300px;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          gap: 6px;
          text-align: center;
          padding: 32px 24px;
        }
        .i2t-bed {
          display: flex;
          align-items: center;
          gap: 16px;
          margin-bottom: 20px;
          color: var(--text-faint);
        }
        .i2t-bed-pixels {
          display: grid;
          grid-template-columns: repeat(4, 6px);
          grid-auto-rows: 6px;
          gap: 3px;
        }
        .i2t-px { width: 6px; height: 6px; border-radius: 1px; background: var(--border-base); }
        .i2t-px:nth-child(3n) { background: var(--border-item, var(--border-base)); }
        .i2t-bed-arrow { display: inline-flex; align-items: center; color: var(--accent-start); opacity: 0.65; }
        .i2t-bed-glyphs { display: flex; flex-direction: column; gap: 4px; }
        .i2t-bed-row { display: flex; gap: 3px; }
        .i2t-gl { width: 8px; height: 9px; border-radius: 1.5px; background: var(--text-ghost, var(--border-base)); }
        .i2t-empty-title {
          font-family: 'Manrope', sans-serif;
          font-size: 17px;
          font-weight: 700;
          color: var(--text-primary);
        }
        .i2t-empty-sub { font-size: 12.5px; color: var(--text-muted); }
        .i2t-empty-formats {
          margin-top: 12px;
          font-size: 9.5px;
          font-weight: 600;
          letter-spacing: 1.4px;
          color: var(--text-faint);
        }
        .i2t-hints {
          list-style: none;
          margin: 8px 0 0;
          padding: 0;
          display: flex;
          flex-wrap: wrap;
          justify-content: center;
          gap: 18px;
        }
        .i2t-hint {
          position: relative;
          font-size: 10.5px;
          font-weight: 500;
          letter-spacing: 0.2px;
          color: var(--text-muted);
        }
        .i2t-hint:not(:last-child)::after {
          content: '';
          position: absolute;
          right: -9px;
          top: 50%;
          width: 2px;
          height: 2px;
          border-radius: 50%;
          background: var(--text-faint);
          transform: translateY(-50%);
        }
        .i2t-hint b { color: var(--accent-start); font-weight: 700; }

        /* split layouts */
        .i2t-split { display: grid; gap: 18px; padding: 0; align-items: start; }
        .i2t-split-placed { grid-template-columns: minmax(0, 1.6fr) minmax(220px, 1fr); }
        .i2t-split-read  { grid-template-columns: 200px minmax(0, 1fr); gap: 20px; }

        /* the plate — the source image, never cropped */
        .i2t-plate {
          position: relative;
          margin: 0;
          border-radius: 12px;
          overflow: hidden;
          background: var(--bg-item);
          border: 1px solid var(--border-base);
          box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.03), 0 14px 34px -26px rgba(0, 0, 0, 0.6);
          min-height: 180px;
          display: flex;
          align-items: center;
          justify-content: center;
          transition: background-color 0.35s var(--i2t-theme), border-color 0.35s var(--i2t-theme);
        }
        .i2t-plate::after {
          content: '';
          position: absolute;
          inset: 0;
          pointer-events: none;
          background: linear-gradient(to top, rgba(0, 0, 0, 0.10), transparent 46%);
        }
        .i2t-plate img {
          max-width: 100%;
          max-height: 400px;
          width: auto;
          height: auto;
          display: block;
        }
        .i2t-split-read .i2t-plate img { max-height: 340px; }

        /* ── The read head — a scan that walks the plate ──
           Indeterminate by contract: a hairline plus a faint band, no fill and
           no percentage. It is the pre-image of the resolve animation. */
        .i2t-readhead {
          position: absolute;
          left: 0;
          right: 0;
          top: 0;
          height: 2px;
          opacity: 0;
          pointer-events: none;
          z-index: 1;
        }
        .i2t-readhead-line {
          position: absolute;
          inset: 0;
          height: 2px;
          background: var(--accent-start);
        }
        .i2t-readhead-band {
          position: absolute;
          left: 0;
          right: 0;
          bottom: 0;
          height: 22px;
          background: linear-gradient(to top, var(--accent-start), transparent);
          opacity: 0.14;
        }
        .i2t-readhead.on { animation: i2t-scan 1.8s cubic-bezier(0.45, 0, 0.55, 1) infinite; }

        /* side column: script calibration → hint → reading → the text itself */
        .i2t-side { display: flex; flex-direction: column; gap: 12px; min-width: 0; padding-top: 2px; }

        /* ── The instrument's settings — one segmented-control language ──
           Script (which writing system to read) and Reading (which of the
           readings to show) are both instrument settings, so they share
           one form: a pill of segments where the selected one takes the
           accent. Script choice and reading choice are states, and the
           accent means state. Unselected segments stay muted. */
        .i2t-seg { display: flex; flex-direction: column; gap: 6px; }
        .i2t-seg-label {
          font-size: 9.5px;
          font-weight: 600;
          letter-spacing: 1.4px;
          text-transform: uppercase;
          color: var(--text-faint);
        }
        .i2t-seg-track {
          display: inline-flex;
          flex-wrap: wrap;
          gap: 2px;
          padding: 2px;
          border: 1px solid var(--border-base);
          border-radius: 8px;
          background: var(--bg-item);
          width: fit-content;
          transition: border-color 0.35s var(--i2t-theme), background-color 0.35s var(--i2t-theme);
        }
        .i2t-seg-btn {
          font-family: 'DM Sans', sans-serif;
          font-size: 11.5px;
          font-weight: 600;
          color: var(--text-muted);
          padding: 5px 11px;
          border: none;
          border-radius: 6px;
          background: transparent;
          cursor: pointer;
          white-space: nowrap;
          transition: color 0.15s var(--i2t-theme), background-color 0.15s var(--i2t-theme);
        }
        .i2t-seg-btn:focus-visible { outline: 2px solid var(--accent-start); outline-offset: 1px; }
        .i2t-seg-btn:active:not(:disabled) { transform: translateY(1px); }
        .i2t-seg-btn:disabled { opacity: 0.55; cursor: default; }
        .i2t-seg-btn.on {
          color: var(--accent-start);
          background: var(--bg-card);
        }

        .i2t-hint-text {
          display: flex;
          gap: 10px;
          font-size: 11.5px;
          line-height: 1.65;
          color: var(--text-secondary);
          background: var(--bg-item);
          border: 1px solid var(--border-base);
          border-radius: 10px;
          padding: 11px 13px;
          transition: background-color 0.35s var(--i2t-theme), border-color 0.35s var(--i2t-theme);
        }
        .i2t-hint-text::before {
          content: '';
          flex: none;
          width: 2px;
          align-self: stretch;
          border-radius: 2px;
          background: var(--accent-start);
          opacity: 0.75;
        }
        .i2t-phase {
          font-size: 11px;
          font-weight: 600;
          letter-spacing: 0.3px;
          color: var(--text-secondary);
          font-variant-numeric: tabular-nums;
        }
        .i2t-phase-sub { font-weight: 500; color: var(--text-muted); margin-top: 2px; }

        /* ── The reading loader — character cells settling, not a progress bar ── */
        .i2t-decode { display: flex; flex-direction: column; gap: 6px; margin-top: 14px; }
        .i2t-decode-line { display: flex; gap: 3px; }
        .i2t-cell {
          width: 7px;
          height: 11px;
          border-radius: 2px;
          background: var(--accent-start);
          opacity: 0.25;
          transform-origin: center;
          animation: i2t-cell 1.6s var(--i2t-theme) infinite;
          animation-delay: var(--d, 0ms);
        }
        /* The instrument's method, stated once and then held — deliberately not
           a per-stage tracker (that would be simulated progress). */
        .i2t-method {
          margin-top: 14px;
          font-size: 10px;
          letter-spacing: 0.4px;
          color: var(--text-faint);
        }

        /* the text stage */
        .i2t-text-wrap { position: relative; min-width: 0; }
        /* in the read layout the side column has no gap of its own, so the
           reading-mode control carries its own breathing room below it */
        .i2t-text-wrap > .i2t-seg { margin-bottom: 12px; }
        /* advisory — an honest doubt, stated once, quietly. It covers both
           the masked-words case and the low-overall-confidence case; the
           colour is the same because the meaning is the same: read this
           with care. */
        .i2t-advisory {
          font-size: 11.5px;
          line-height: 1.55;
          color: var(--text-secondary);
          padding-left: 10px;
          border-left: 2px solid var(--brand-yellow);
          margin-bottom: 12px;
        }
        /* the in-sentence action inside an advisory — accent because it acts */
        .i2t-advisory-link {
          font: inherit;
          color: var(--accent-start);
          background: none;
          border: none;
          padding: 0;
          cursor: pointer;
          text-decoration: underline;
          text-underline-offset: 2px;
        }
        .i2t-advisory-link:focus-visible { outline: 2px solid var(--accent-start); outline-offset: 2px; }

        /* ── Reader toolbar — outline, density, find ── */
        .i2t-tools {
          display: flex;
          align-items: center;
          flex-wrap: wrap;
          gap: 8px;
          margin-bottom: 12px;
        }
        .i2t-tool {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          font-family: 'DM Sans', sans-serif;
          font-size: 11px;
          font-weight: 600;
          color: var(--text-muted);
          padding: 5px 10px;
          border: 1px solid var(--border-base);
          border-radius: 7px;
          background: transparent;
          cursor: pointer;
          white-space: nowrap;
          transition: color 0.15s var(--i2t-theme), background-color 0.15s var(--i2t-theme), border-color 0.15s var(--i2t-theme);
        }
        .i2t-tool:hover { color: var(--text-primary); background: var(--bg-item-hover); }
        .i2t-tool:focus-visible { outline: 2px solid var(--accent-start); outline-offset: 1px; }
        .i2t-tool.on { color: var(--accent-start); border-color: var(--accent-start); background: var(--bg-card); }
        .i2t-density { display: inline-flex; }
        /* Segments overlap by 1px so borders don't double, and the selected
           segment is lifted above its neighbour — otherwise its left border is
           covered (or was zeroed) and the accent ring read as incomplete. */
        .i2t-density .i2t-tool { border-radius: 0; margin-left: -1px; position: relative; }
        .i2t-density .i2t-tool:first-child { border-radius: 7px 0 0 7px; margin-left: 0; }
        .i2t-density .i2t-tool:last-child { border-radius: 0 7px 7px 0; }
        .i2t-density .i2t-tool.on { z-index: 1; }
        .i2t-find {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          padding: 0 8px;
          height: 29px;
          border: 1px solid var(--border-base);
          border-radius: 7px;
          background: var(--bg-item);
          color: var(--text-faint);
          min-width: 0;
        }
        .i2t-find:focus-within { border-color: var(--accent-start); color: var(--accent-start); }
        .i2t-find input {
          border: none;
          outline: none;
          background: transparent;
          color: var(--text-primary);
          font-family: 'DM Sans', sans-serif;
          font-size: 11.5px;
          width: 132px;
          min-width: 0;
        }
        .i2t-find input::placeholder { color: var(--text-faint); }
        .i2t-find-count {
          font-size: 10.5px;
          color: var(--text-muted);
          font-variant-numeric: tabular-nums;
          white-space: nowrap;
        }
        .i2t-find-btn {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          width: 20px;
          height: 20px;
          border: none;
          border-radius: 4px;
          background: transparent;
          color: var(--text-muted);
          cursor: pointer;
        }
        .i2t-find-btn:hover { color: var(--text-primary); background: var(--bg-item-hover); }
        .i2t-find-btn:focus-visible { outline: 2px solid var(--accent-start); outline-offset: 1px; }

        /* contents outline */
        .i2t-outline {
          display: flex;
          flex-direction: column;
          gap: 1px;
          margin-bottom: 12px;
          padding: 6px;
          border: 1px solid var(--border-base);
          border-radius: 8px;
          background: var(--bg-item);
          max-height: 200px;
          overflow-y: auto;
          scrollbar-width: thin;
          scrollbar-color: var(--border-base) transparent;
        }
        .i2t-outline-item {
          text-align: left;
          font-family: 'DM Sans', sans-serif;
          font-size: 12px;
          line-height: 1.4;
          color: var(--text-secondary);
          background: none;
          border: none;
          border-radius: 5px;
          padding: 5px 8px;
          cursor: pointer;
          transition: color 0.15s var(--i2t-theme), background-color 0.15s var(--i2t-theme);
        }
        .i2t-outline-item.lvl2 { padding-left: 20px; font-size: 11.5px; color: var(--text-muted); }
        .i2t-outline-item:hover { color: var(--text-primary); background: var(--bg-item-hover); }
        .i2t-outline-item:focus-visible { outline: 2px solid var(--accent-start); outline-offset: 1px; }
        .i2t-outline-item.on { color: var(--accent-start); }

        .i2t-text {
          max-height: 440px;
          overflow-y: auto;
          padding: 2px 10px 8px 0;
          font-family: 'DM Sans', sans-serif;
          font-size: 14px;
          line-height: 1.7;
          color: var(--text-primary);
          scrollbar-width: thin;
          scrollbar-color: var(--border-base) transparent;
        }
        /* Density is a reader setting, not decoration: it trades leading for
           how much of the page is in view at once. */
        .i2t-text.compact { font-size: 13px; line-height: 1.5; }
        /* The reading measure — a document reads best around 68 characters. */
        .i2t-prose { max-width: 68ch; }
        .i2t-text.compact .i2t-prose { max-width: 74ch; }

        /* ── The reading itself ──
           Reflowed prose gets paragraph rhythm; headings take the display
           face at the weight their size earned; list markers hang so the
           text of every item starts on one line. */
        .i2t-p { margin: 0 0 0.85em; }
        .i2t-text > :last-child { margin-bottom: 0; }
        .i2t-h1 {
          font-family: 'Manrope', sans-serif;
          font-size: 15.5px;
          font-weight: 700;
          line-height: 1.35;
          margin: 1.15em 0 0.5em;
        }
        .i2t-h2 {
          font-family: 'Manrope', sans-serif;
          font-size: 13.5px;
          font-weight: 700;
          line-height: 1.4;
          margin: 1em 0 0.45em;
        }
        .i2t-text > .i2t-h1:first-child,
        .i2t-text > .i2t-h2:first-child { margin-top: 0; }
        .i2t-li {
          display: flex;
          gap: 8px;
          margin: 0 0 0.45em;
        }
        .i2t-li-mark {
          flex: none;
          min-width: 1em;
          color: var(--accent-start);
          font-variant-numeric: tabular-nums;
        }
        .i2t-li-text { min-width: 0; }
        .i2t-text::-webkit-scrollbar { width: 4px; }
        .i2t-text::-webkit-scrollbar-thumb { background: var(--border-base); border-radius: 4px; }
        /* the scroll fade belongs to the text alone — the advisory above and
           the steps record below must not be washed out by it */
        .i2t-text-fade { position: relative; }
        .i2t-text-fade::after {
          content: '';
          position: absolute;
          left: 0; right: 0; bottom: 0;
          height: 28px;
          background: linear-gradient(transparent, var(--bg-card));
          pointer-events: none;
        }
        .i2t-line {
          white-space: pre-wrap;
          word-break: break-word;
          animation: i2t-resolve 320ms var(--i2t-ease) both;
          animation-delay: var(--d, 0ms);
        }

        /* ── Source-layout reading — the plate's own columns ── */
        .i2t-cols {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
          gap: 20px;
          align-items: start;
        }
        .i2t-col-line { margin: 0 0 0.5em; }
        .i2t-col-line:last-child { margin-bottom: 0; }

        /* find highlights */
        .i2t-mark {
          background: var(--brand-yellow);
          color: #1d1b16;
          border-radius: 2px;
          padding: 0 1px;
        }
        .i2t-mark.cur {
          background: var(--accent-start);
          color: var(--i2t-ink);
        }

        /* the instrument's own record — what was done to obtain this
           reading (deskew, contrast, upscale). Faint by design: present
           for the user who looks, invisible to the one who doesn't. */
        .i2t-steps {
          margin-top: 10px;
          font-size: 10.5px;
          line-height: 1.5;
          color: var(--text-faint);
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
          font-variant-numeric: tabular-nums;
        }

        /* ── Extracted structure — the reading's supporting matter ──
           Presented as a ledger (fields) and hairline-ruled tables, in the
           instrument's own materials: display face for the section label,
           body face for content, tabular numerals, one accent reserved for
           state. No new motion — the reading already resolves into focus. */
        .i2t-structure {
          margin-top: 14px;
          display: flex;
          flex-direction: column;
          gap: 14px;
        }
        .i2t-extra { display: flex; flex-direction: column; gap: 7px; min-width: 0; }
        .i2t-extra-label {
          font-family: 'Manrope', sans-serif;
          font-size: 10px;
          font-weight: 700;
          letter-spacing: 1.4px;
          text-transform: uppercase;
          color: var(--text-faint);
        }
        .i2t-ledger { margin: 0; display: flex; flex-direction: column; }
        /* Each row is a two-column grid: the label column and the value column
           stay aligned down the list, so which value belongs to which label is
           never ambiguous. */
        .i2t-ledger-row {
          display: grid;
          grid-template-columns: minmax(0, 0.8fr) minmax(0, 1.2fr);
          column-gap: 18px;
          align-items: center;
          padding: 9px 2px;
          border-bottom: 1px solid var(--divider);
        }
        .i2t-ledger-row:last-child { border-bottom: none; }
        .i2t-ledger-key {
          min-width: 0;
          font-size: 10.5px;
          font-weight: 600;
          letter-spacing: 0.6px;
          text-transform: uppercase;
          color: var(--text-faint);
          overflow-wrap: anywhere;
        }
        .i2t-ledger-val {
          margin: 0;
          min-width: 0;
          font-size: 13px;
          font-weight: 500;
          color: var(--text-primary);
          font-variant-numeric: tabular-nums;
          overflow-wrap: anywhere;
        }
        .i2t-table-wrap {
          overflow-x: auto;
          border: 1px solid var(--border-base);
          border-radius: 10px;
          scrollbar-width: thin;
          scrollbar-color: var(--border-base) transparent;
        }
        .i2t-table {
          border-collapse: collapse;
          width: 100%;
          font-size: 12.5px;
          font-variant-numeric: tabular-nums;
        }
        .i2t-table td {
          padding: 8px 12px;
          border-bottom: 1px solid var(--divider);
          border-right: 1px solid var(--divider);
          color: var(--text-primary);
          vertical-align: top;
          word-break: break-word;
        }
        .i2t-table td:last-child { border-right: none; }
        .i2t-table tr:last-child td { border-bottom: none; }
        /* The first column is the row's key. Set apart in weight and fill so a
           value can never be read as belonging to the wrong label; hovering the
           row links every cell across it. */
        .i2t-table td:first-child:not(.i2t-table-span) {
          font-weight: 600;
          color: var(--text-secondary);
          background: var(--bg-item);
          white-space: nowrap;
        }
        /* a full-width value — one cell across the whole row, no key emphasis */
        .i2t-table td.i2t-table-span {
          font-weight: 500;
          color: var(--text-primary);
          background: transparent;
          white-space: normal;
        }
        .i2t-table tbody tr:hover td:not(.i2t-table-span) { background: var(--bg-item-hover); }
        .i2t-table tbody tr:hover td:first-child:not(.i2t-table-span) { background: var(--bg-item); }
        .i2t-table-wrap::-webkit-scrollbar { height: 4px; }
        .i2t-table-wrap::-webkit-scrollbar-thumb {
          background: var(--border-base);
          border-radius: 4px;
        }

        /* empty result — an honest reading, not an error */
        .i2t-none { display: flex; flex-direction: column; gap: 6px; padding-top: 2px; }
        .i2t-none-title { font-family: 'Manrope', sans-serif; font-size: 13.5px; font-weight: 700; color: var(--text-primary); }
        .i2t-none-sub { font-size: 12px; line-height: 1.6; color: var(--text-muted); }

        /* ── Region C — action bar ── */
        .i2t-bar {
          display: flex;
          align-items: center;
          gap: 8px;
          flex-wrap: wrap;
          padding: 16px 0 2px;
        }
        .i2t-bar-spacer { margin-left: auto; }

        .i2t-btn {
          display: inline-flex;
          align-items: center;
          gap: 7px;
          font-family: 'DM Sans', sans-serif;
          font-size: 12.5px;
          font-weight: 600;
          padding: 9px 16px;
          border-radius: 8px;
          border: 1px solid transparent;
          cursor: pointer;
          transition: background-color 0.15s var(--i2t-theme), color 0.15s var(--i2t-theme),
                      border-color 0.15s var(--i2t-theme), transform 0.12s var(--i2t-ease);
        }
        .i2t-btn:focus-visible { outline: 2px solid var(--accent-start); outline-offset: 2px; }
        .i2t-btn:active:not(:disabled) { transform: translateY(1px); }
        .i2t-btn:disabled { opacity: 0.55; cursor: default; }

        .i2t-btn-primary {
          background: var(--accent-start);
          color: var(--i2t-ink);
          font-family: 'Manrope', sans-serif;
          font-weight: 700;
          box-shadow: 0 10px 22px -12px rgba(0, 0, 0, 0.55);
        }
        .i2t-btn-primary:hover:not(:disabled) { background: var(--accent-end); }
        /* optimistic flip: filled action → outlined confirmation */
        .i2t-btn-primary.copied {
          background: transparent;
          color: var(--accent-start);
          border-color: var(--accent-start);
        }

        .i2t-btn-quiet {
          background: transparent;
          border-color: var(--border-base);
          color: var(--text-secondary);
        }
        .i2t-btn-quiet:hover:not(:disabled) {
          background: var(--bg-item-hover);
          border-color: var(--border-item, var(--border-base));
          color: var(--text-primary);
        }
        .i2t-btn-quiet.i2t-btn-danger:hover:not(:disabled) {
          color: var(--brand-red);
          border-color: var(--brand-red);
        }

        /* ── Responsive ── */
        @media (max-width: 640px) {
          .i2t-split-placed, .i2t-split-read { grid-template-columns: 1fr; }
          .i2t-plate img { max-height: 260px; }
          .i2t-empty { min-height: 220px; }
          .i2t-meta { display: none; }
          .i2t-find { flex: 1 1 160px; }
          .i2t-find input { width: 100%; }
        }

        /* ── Reduced motion: reveal → plain fade, scan → static rule, cells off ── */
        @media (prefers-reduced-motion: reduce) {
          .i2t-enter { animation: none; }
          .i2t-line {
            --d: 0ms !important;
            animation: i2t-enter 120ms ease both;
          }
          .i2t-readhead.on { animation: none; top: 20%; opacity: 0.3; }
          .i2t-readhead-band { display: none; }
          .i2t-cell { animation: none; opacity: 0.4; transform: none; }
          .i2t-dot { animation: none !important; }
          .i2t-btn:active:not(:disabled) { transform: none; }
          .i2t-seg-btn:active:not(:disabled) { transform: none; }
        }
      `}</style>

      <div className="i2t">
        <div
          className={`i2t-frame ${isDragActive ? 'drag' : ''} ${isDragReject ? 'reject' : ''}`}
          data-phase={phase}
          data-error={error ? 'true' : undefined}
        >
          <span className="i2t-br i2t-br-tl" aria-hidden="true" />
          <span className="i2t-br i2t-br-tr" aria-hidden="true" />
          <span className="i2t-br i2t-br-bl" aria-hidden="true" />
          <span className="i2t-br i2t-br-brr" aria-hidden="true" />

          {/* ── Region A — header strip ── */}
          <header className={`i2t-head ${error ? 'error' : ''}`}>
            <span className="i2t-dot" aria-hidden="true" />
            <span className="i2t-file">
              <span className="i2t-file-ic" aria-hidden="true">{file ? Ic.image : Ic.scan}</span>
              <span className="i2t-file-name">{file ? file.name : 'Ready'}</span>
            </span>
            {file && stateSuffix && <span className="i2t-state">{stateSuffix}</span>}
            {error ? (
              <span className="i2t-err" role="alert">{error}</span>
            ) : (
              <span className="i2t-meta" role="status">
                {phase === 'read' && (
                  <>
                    {`${wordCount} words \u00B7 ${charCount} characters \u00B7 ${lineCount} lines`}
                    {meanConf !== null && ` \u00B7 ${Math.round(meanConf)}% confidence`}
                  </>
                )}
                {(phase === 'placed' || phase === 'reading') && `${dims ? `${dims.w}\u00D7${dims.h} \u00B7 ` : ''}${fileSizeMB} MB`}
              </span>
            )}
          </header>

          {/* ── Region B — stage ── */}
          <div
            {...getRootProps({
              className: 'i2t-stage',
              role: 'button',
              tabIndex: 0,
              'aria-label': stageLabel,
            })}
          >
            <input {...getInputProps()} />

            {phase === 'empty' && (
              <div className="i2t-empty i2t-enter">
                <div className="i2t-bed" aria-hidden="true">
                  <span className="i2t-bed-pixels">
                    {Array.from({ length: 16 }).map((_, i) => <i className="i2t-px" key={i} />)}
                  </span>
                  <span className="i2t-bed-arrow">
                    <svg width="26" height="10" viewBox="0 0 26 10" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
                      <line x1="0" y1="5" x2="20" y2="5" />
                      <polyline points="15 1 21 5 15 9" />
                    </svg>
                  </span>
                  <span className="i2t-bed-glyphs">
                    {[7, 5, 6, 4].map((count, row) => (
                      <span className="i2t-bed-row" key={row}>
                        {Array.from({ length: count }).map((_, cell) => <i className="i2t-gl" key={cell} />)}
                      </span>
                    ))}
                  </span>
                </div>
                <p className="i2t-empty-title">
                  {isDragReject
                    ? 'That file won\u2019t read here'
                    : isDragActive
                      ? 'Release to read'
                      : 'Place an image to read'}
                </p>
                <p className="i2t-empty-sub">
                  {isDragActive && !isDragReject
                    ? 'the original lands on the stage'
                    : 'a screenshot, a scan or a photo of a page'}
                </p>
                <p className="i2t-empty-formats">JPG · PNG · WEBP · GIF · BMP</p>
                <ul className="i2t-hints">
                  <li className="i2t-hint"><b>Drop</b> or browse</li>
                  <li className="i2t-hint"><b>Enter</b> to browse</li>
                  <li className="i2t-hint"><b>Paste</b> a screenshot</li>
                </ul>
              </div>
            )}

            {phase !== 'empty' && (
              <div className={`i2t-split ${isReadLayout ? 'i2t-split-read' : 'i2t-split-placed'}`}>
                <figure className="i2t-plate">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={preview ?? undefined}
                    alt={file?.name ?? 'Image preview'}
                    onLoad={e => setDims({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })}
                  />
                  <span className={`i2t-readhead${phase === 'reading' ? ' on' : ''}`} aria-hidden="true">
                    <span className="i2t-readhead-band" />
                    <span className="i2t-readhead-line" />
                  </span>
                </figure>

                <aside className="i2t-side i2t-enter" key={phase}>
                  {(phase === 'placed' || phase === 'reading') && (
                    <div className="i2t-seg" role="radiogroup" aria-label="Script to read">
                      <span className="i2t-seg-label">Script</span>
                      <div className="i2t-seg-track">
                        {LANG_OPTIONS.map(opt => (
                          <button
                            key={opt.value}
                            type="button"
                            role="radio"
                            aria-checked={lang === opt.value}
                            className={`i2t-seg-btn ${lang === opt.value ? 'on' : ''}`}
                            onClick={() => setLang(opt.value)}
                            disabled={loading}
                          >
                            {opt.label}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  {phase === 'placed' && (
                    <div className="i2t-hint-text">
                      Works best on clear, high-contrast images with printed or typed text.
                      Handwriting and stylised fonts may read less accurately.
                    </div>
                  )}

                  {phase === 'reading' && (
                    <div role="status">
                      <p className="i2t-phase">Reading image… {elapsed}s</p>
                      <p className="i2t-phase i2t-phase-sub">
                        {langLabel}
                        {dims ? ` \u00B7 ${dims.w}\u00D7${dims.h}` : ''}
                        {` \u00B7 ${fileSizeMB} MB`}
                      </p>
                      <div className="i2t-decode" aria-hidden="true">
                        {DECODE_ROWS.map((count, row) => (
                          <span className="i2t-decode-line" key={row}>
                            {Array.from({ length: count }).map((_, cell) => (
                              <i
                                className="i2t-cell"
                                key={cell}
                                style={{ '--d': `${row * 90 + cell * 55}ms` } as CSSProperties}
                              />
                            ))}
                          </span>
                        ))}
                      </div>
                      <p className="i2t-method">Validate · Classify · Preprocess · Read · Structure</p>
                    </div>
                  )}

                  {phase === 'read' && (
                    <div className="i2t-text-wrap">
                      {/* The reading mode control appears when there is a
                          genuine choice — two different readings, or a real
                          column layout to show. A toggle that changes nothing
                          would be a lie about the work. */}
                      {showReadingControl && (
                        <div className="i2t-seg" role="radiogroup" aria-label="Reading to show">
                          <span className="i2t-seg-label">Reading</span>
                          <div className="i2t-seg-track">
                            <button
                              type="button"
                              role="radio"
                              aria-checked={view === 'clean'}
                              className={`i2t-seg-btn ${view === 'clean' ? 'on' : ''}`}
                              onClick={() => setView('clean')}
                            >
                              Clean
                            </button>
                            {canToggle && (
                              <button
                                type="button"
                                role="radio"
                                aria-checked={view === 'complete'}
                                className={`i2t-seg-btn ${view === 'complete' ? 'on' : ''}`}
                                onClick={() => setView('complete')}
                              >
                                Complete
                              </button>
                            )}
                            {hasSource && (
                              <button
                                type="button"
                                role="radio"
                                aria-checked={view === 'source'}
                                className={`i2t-seg-btn ${view === 'source' ? 'on' : ''}`}
                                onClick={() => setView('source')}
                              >
                                Columns
                              </button>
                            )}
                          </div>
                        </div>
                      )}

                      {advisory === 'uncertain' && (
                        <p className="i2t-advisory" role="status">
                          {uncertainWords === 1
                            ? `1 word read below the ${confidenceFloor}% floor is marked ?.`
                            : `${uncertainWords} words read below the ${confidenceFloor}% floor are marked ?.`}
                          {canToggle && (
                            <>
                              {' '}
                              <button
                                type="button"
                                className="i2t-advisory-link"
                                onClick={() => setView('complete')}
                              >
                                Show the complete reading
                              </button>{' '}
                              to see them as read.
                            </>
                          )}
                        </p>
                      )}

                      {advisory === 'complete' && (
                        <p className="i2t-advisory" role="status">
                          Complete reading — every word the instrument read, exactly as read.
                          Nothing is masked or dropped.
                        </p>
                      )}

                      {advisory === 'low' && isLowConfidence && (
                        <p className="i2t-advisory" role="status">
                          Read at {Math.round(meanConf)}% confidence — a straighter, higher-contrast
                          or higher-resolution image usually reads better.
                        </p>
                      )}

                      {/* ── Reader controls ── */}
                      <div className="i2t-tools">
                        {view === 'clean' && outline.length >= 2 && (
                          <button
                            type="button"
                            className={`i2t-tool ${outlineOpen ? 'on' : ''}`}
                            aria-expanded={outlineOpen}
                            onClick={() => setOutlineOpen(open => !open)}
                          >
                            {Ic.contents}Contents
                          </button>
                        )}
                        <div className="i2t-density" role="radiogroup" aria-label="Reading density">
                          <button
                            type="button"
                            role="radio"
                            aria-checked={density === 'comfortable'}
                            className={`i2t-tool ${density === 'comfortable' ? 'on' : ''}`}
                            onClick={() => setDensity('comfortable')}
                          >
                            Comfortable
                          </button>
                          <button
                            type="button"
                            role="radio"
                            aria-checked={density === 'compact'}
                            className={`i2t-tool ${density === 'compact' ? 'on' : ''}`}
                            onClick={() => setDensity('compact')}
                          >
                            Compact
                          </button>
                        </div>
                        <div className="i2t-find">
                          {Ic.find}
                          <input
                            type="text"
                            value={query}
                            placeholder="Find in reading"
                            aria-label="Find in reading"
                            onChange={e => { setQuery(e.target.value); setActiveMatch(0) }}
                            onKeyDown={e => {
                              if (e.key === 'Enter') { e.preventDefault(); goToMatch(e.shiftKey ? -1 : 1) }
                              if (e.key === 'Escape') { setQuery('') }
                            }}
                          />
                          {query && (
                            <span className="i2t-find-count">
                              {totalMatch ? `${curMatch + 1}/${totalMatch}` : '0/0'}
                            </span>
                          )}
                          {query && totalMatch > 0 && (
                            <>
                              <button type="button" className="i2t-find-btn" aria-label="Previous match" onClick={() => goToMatch(-1)}>
                                {Ic.up}
                              </button>
                              <button type="button" className="i2t-find-btn" aria-label="Next match" onClick={() => goToMatch(1)}>
                                {Ic.down}
                              </button>
                            </>
                          )}
                        </div>
                      </div>

                      {view === 'clean' && outlineOpen && outline.length >= 2 && (
                        <nav className="i2t-outline" aria-label="Contents">
                          {outline.map(item => (
                            <button
                              type="button"
                              key={item.index}
                              className={`i2t-outline-item ${item.level === 2 ? 'lvl2' : ''} ${activeSection === item.index ? 'on' : ''}`}
                              onClick={() => jumpToSection(item.index)}
                            >
                              {item.text}
                            </button>
                          ))}
                        </nav>
                      )}

                      <div className="i2t-text-fade">
                        {/* key={view}: switching readings replays the resolve
                            animation, the same signature moment as arrival. */}
                        <div
                          className={`i2t-text ${density === 'compact' ? 'compact' : ''}`}
                          key={view}
                          ref={textRef}
                          aria-label={
                            view === 'complete' ? 'Complete reading'
                              : view === 'source' ? 'Source column layout'
                                : 'Clean reading'
                          }
                        >
                          <div className="i2t-prose">
                            {view === 'source' && (
                              <div className="i2t-cols">
                                {(() => {
                                  let unit = 0
                                  return layout.map((region, ri) => (
                                    <div className="i2t-col" key={ri}>
                                      {region.lines.map((line, li) => {
                                        const parts = matchData.perUnit[unit] ?? [{ text: line }]
                                        unit += 1
                                        return (
                                          <p className="i2t-line i2t-col-line" key={li}>
                                            {line ? renderMatchParts(parts, curMatch, registerMatch) : '\u00A0'}
                                          </p>
                                        )
                                      })}
                                    </div>
                                  ))
                                })()}
                              </div>
                            )}

                            {view === 'complete' && completeLines.map((line, i) => (
                              <p
                                key={i}
                                className="i2t-line"
                                style={{ '--d': `${Math.min(i, 14) * 40}ms` } as CSSProperties}
                              >
                                {line
                                  ? renderMatchParts(matchData.perUnit[i] ?? [{ text: line }], curMatch, registerMatch)
                                  : '\u00A0'}
                              </p>
                            ))}

                            {view === 'clean' && cleanBlocks.map((block, i) => {
                              const parts = matchData.perUnit[i] ?? [{ text: block.text }]
                              const delay = { '--d': `${Math.min(i, 14) * 40}ms` } as CSSProperties
                              if (block.kind === 'heading') {
                                return (
                                  <p
                                    id={`i2t-b${i}`}
                                    data-bi={i}
                                    key={i}
                                    className={`i2t-line ${block.level === 2 ? 'i2t-h2' : 'i2t-h1'}`}
                                    style={delay}
                                  >
                                    {renderMatchParts(parts, curMatch, registerMatch)}
                                  </p>
                                )
                              }
                              if (block.kind === 'list') {
                                return (
                                  <div id={`i2t-b${i}`} data-bi={i} key={i} className="i2t-line i2t-li" style={delay}>
                                    <span className="i2t-li-mark" aria-hidden="true">
                                      {block.marker ?? '\u2022'}
                                    </span>
                                    <span className="i2t-li-text">{renderMatchParts(parts, curMatch, registerMatch)}</span>
                                  </div>
                                )
                              }
                              return (
                                <p id={`i2t-b${i}`} data-bi={i} key={i} className="i2t-line i2t-p" style={delay}>
                                  {renderMatchParts(parts, curMatch, registerMatch)}
                                </p>
                              )
                            })}
                          </div>
                        </div>
                      </div>

                      {/* Extracted structure — only present when the server
                          returned it, and only for the reconstructed reading
                          (the complete reading is the untouched line layout).
                          Quiet by design: it supports the prose, it does not
                          compete with it. */}
                      {view === 'clean' && hasStructure && (
                        <div className="i2t-structure">
                          {fields.length > 0 && (
                            <section className="i2t-extra" aria-label="Extracted fields">
                              <span className="i2t-extra-label">Fields</span>
                              <dl className="i2t-ledger">
                                {fields.map((field, i) => (
                                  <div className="i2t-ledger-row" key={i}>
                                    <dt className="i2t-ledger-key">{field.label}</dt>
                                    <dd className="i2t-ledger-val">{field.value}</dd>
                                  </div>
                                ))}
                              </dl>
                            </section>
                          )}
                          {tables.map((table, ti) => {
                            const columns = Math.max(1, ...table.rows.map(row => row.length))
                            return (
                              <section className="i2t-extra" key={ti} aria-label={`Table ${ti + 1}`}>
                                <span className="i2t-extra-label">
                                  {tables.length > 1 ? `Table ${ti + 1}` : 'Table'}
                                </span>
                                <div className="i2t-table-wrap">
                                  <table className="i2t-table">
                                    <tbody>
                                      {table.rows.map((row, ri) => (
                                        <tr key={ri}>
                                          {row.length === 1 && columns > 1 ? (
                                            <td className="i2t-table-span" colSpan={columns}>{row[0]}</td>
                                          ) : (
                                            row.map((cell, ci) => <td key={ci}>{cell}</td>)
                                          )}
                                        </tr>
                                      ))}
                                    </tbody>
                                  </table>
                                </div>
                              </section>
                            )
                          })}
                        </div>
                      )}
                      {record.length > 0 && (
                        <p className="i2t-steps" title={record.join(' · ')}>
                          {record.join(' \u00B7 ')}
                        </p>
                      )}
                    </div>
                  )}

                  {phase === 'emptyResult' && (
                    <div className="i2t-none">
                      <p className="i2t-none-title">No readable text found in this image.</p>
                      <p className="i2t-none-sub">
                        A higher-contrast crop, or a straighter angle on the page, often helps.
                        {lang === 'auto' && ' If the text is Bangla, set Script to \u09AC\u09BE\u0982\u09B2\u09BE and read again.'}
                      </p>
                    </div>
                  )}
                </aside>
              </div>
            )}
          </div>

          {/* ── Region C — action bar ── */}
          <footer className="i2t-bar">
            {(phase === 'placed' || phase === 'reading') && (
              <>
                <span className="i2t-bar-spacer" />
                <button
                  type="button"
                  className="i2t-btn i2t-btn-quiet i2t-btn-danger"
                  onClick={clearAll}
                  disabled={loading}
                >
                  {Ic.close} Remove
                </button>
                {loading ? (
                  <button
                    type="button"
                    className="i2t-btn i2t-btn-quiet"
                    onClick={cancelRead}
                  >
                    {Ic.close} Cancel
                  </button>
                ) : (
                  <button
                    type="button"
                    className="i2t-btn i2t-btn-primary"
                    onClick={extractText}
                  >
                    {error ? Ic.retry : Ic.scan}
                    {error ? 'Try again' : 'Read text'}
                  </button>
                )}
              </>
            )}

            {isReadLayout && (
              <>
                {phase === 'read' && (
                  <>
                    <button
                      type="button"
                      className={`i2t-btn i2t-btn-primary ${copied ? 'copied' : ''}`}
                      onClick={copyToClipboard}
                    >
                      {copied ? Ic.check : Ic.copy}
                      {copied ? 'Copied' : 'Copy'}
                    </button>
                    <button type="button" className="i2t-btn i2t-btn-quiet" onClick={copyMarkdown}>
                      {mdCopied ? Ic.check : Ic.markdown}
                      {mdCopied ? 'Markdown copied' : 'Copy as Markdown'}
                    </button>
                    <button type="button" className="i2t-btn i2t-btn-quiet" onClick={downloadText}>
                      {Ic.download} .txt
                    </button>
                    <button type="button" className="i2t-btn i2t-btn-quiet" onClick={downloadMarkdown}>
                      {Ic.download} .md
                    </button>
                  </>
                )}
                <span className="i2t-bar-spacer" />
                <button type="button" className="i2t-btn i2t-btn-quiet" onClick={clearAll}>
                  {Ic.retry} New image
                </button>
              </>
            )}
          </footer>
        </div>
      </div>
    </>
  )
}
