'use client'

import { Fragment, useCallback, useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent } from 'react'
import Link from 'next/link'
import { useDropzone } from 'react-dropzone'
import AnimatedBrandLogo from '@/components/animated-brand-logo/AnimatedBrandLogo'
import AuthNavButton from '@/components/AuthNavButton'
import CreditCost from '@/components/tools/CreditCost'
import { ActionButton, Dialog, HonestProgress, describeLimits, validateIntake, type IntakeSpec } from '@/components/tools/kit'
import { useAccountViewer } from '@/lib/account/useAccountViewer'
import { useCreditBalance } from '@/lib/usage/useCreditBalance'
import { useToolAvailability } from '@/lib/usage/useToolAvailability'
import { getTool } from '@/lib/tools/registry'
import ToolSwitcher from '@/components/tools/ToolSwitcher'
import { uploadWithProgress, getApiErrorMessage } from '@/lib/upload/uploadWithProgress'
import { usePasteFiles } from '@/lib/upload/usePasteFiles'
import { downloadBlob } from '@/lib/download/downloadOutputs'
import { addRecentConversion } from '@/lib/history/recentConversions'
import { loadPdfDocument, PdfPageCanvas, PdfPreviewModal } from './PdfPreview'
import {
  bundlesFromCuts,
  bundlesFromPicked,
  bundlesToSpec,
  cutsBySize,
  cutsEveryN,
  cutsFromBookmarks,
  formatSize,
  parseCustomRanges,
  partFileName,
  type Bundle,
} from './splitPlan'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import './SplitPdfTool.css'

/**
 * Split PDF — "The Cutting Mat".
 *
 * The tool's own full-screen workbench (the page bypasses ToolWorkspace, the
 * documented §2 exception shape used by /mr-markdown): a row of paper sheets,
 * brass blades that mark where the document comes apart, and an output tray
 * of tickets — one per part — that fills in before anything is uploaded.
 *
 * Four ways to decide the cut, all compiling to the same server grammar the
 * /api/split-pdf engine already speaks ("1-3, 5, 8-"):
 *   Visual blade  — click a gap to raise/lower a cut
 *   Extract pages — tap sheets; each contiguous run becomes a part
 *   Split by size — target MB per part, measured from the real page bytes
 *   At bookmarks  — cuts at the document's outline entries
 *
 * Design language: the mockup's dark "atelier" palette verbatim, plus a
 * first-class light theme over the same warm-paper material. Fraunces /
 * JetBrains Mono arrive as CSS variables from the page (next/font).
 *
 * Wave A (2026-11-06) improved the UX inside this design, without re-skinning
 * it (owner direction: every tool keeps its own identity). A fifth way to cut
 * — Custom ranges — joins the four above; Blade gains "cut every N pages";
 * Extract selects on click (double-click views) and can put the picks in one
 * PDF; Size and Bookmark cuts are now drawn on the mat instead of leaving
 * focusable blades that did nothing; bookmark cuts no longer land one page
 * late; mode tabs follow the WAI-ARIA tab pattern; tray names are the exact
 * download names; intake refusals and the limits are shown up front; and the
 * run shows honest progress. The plans live in ./splitPlan.ts (tested).
 */

type Phase = 'edit' | 'running' | 'done'
type Mode = 'blade' | 'ranges' | 'extract' | 'size' | 'bookmarks'

interface StackFile {
  id: string
  file: File
}

/** A produced output part. */
interface Ticket {
  name: string
  blob: Blob
  from: number
  to: number
}

const tool = getTool('split-pdf')
/* The registry entry is the one source of the accepted type and the limits. */
const SPEC: IntakeSpec = { accepts: tool.accepts ?? [], limits: tool.limits! }
/* The mat draws real sheets; past this the strip keeps scrolling, never shrinks. */
const MAX_SHEETS = 400
/* Blank-page sniffing renders tiny thumbnails; beyond this it is skipped. */
const MAX_BLANK_SCAN = 200

const MODES: Array<[Mode, string]> = [
  ['blade', 'Visual blade'],
  ['ranges', 'Custom ranges'],
  ['extract', 'Extract pages'],
  ['size', 'Split by size'],
  ['bookmarks', 'At bookmarks'],
]

const pad2 = (n: number) => String(n).padStart(2, '0')

/* Small inline icons — the module's own, matching the atelier language. */
const Icon = {
  preview: (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6-10-6-10-6Z" />
      <circle cx="12" cy="12" r="2.5" />
    </svg>
  ),
  doc: (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
    </svg>
  ),
  blade: (
    <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="6" cy="6" r="2.6" /><circle cx="6" cy="18" r="2.6" />
      <path d="M8.2 7.4 20 17.2M8.2 16.6 20 6.8" />
    </svg>
  ),
  arrow: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <line x1="4" y1="12" x2="19" y2="12" /><polyline points="13 6 19 12 13 18" />
    </svg>
  ),
  trash: (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polyline points="3 6 5 6 21 6" /><path d="M19 6l-1 14H6L5 6" /><path d="M10 11v6M14 11v6M9 6V4h6v2" />
    </svg>
  ),
  alert: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
      <line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" />
    </svg>
  ),
  check: (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  ),
  spinner: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" className="spl-spin" aria-hidden="true">
      <circle cx="12" cy="12" r="10" strokeOpacity="0.25" /><path d="M12 2a10 10 0 0 1 10 10" />
    </svg>
  ),
}

export default function SplitPdfTool() {
  const accountState = useAccountViewer()
  const creditState = useCreditBalance(accountState.status === 'loading' ? null : accountState.viewer?.id ?? 'guest')
  const availability = useToolAvailability()
  const [file, setFile] = useState<StackFile | null>(null)
  const [pageCount, setPageCount] = useState(0)
  const [phase, setPhase] = useState<Phase>('edit')
  const [error, setError] = useState<string | null>(null)
  const [progress, setProgress] = useState<number | null>(null)
  const [analysing, setAnalysing] = useState(false)
  const [mode, setMode] = useState<Mode>('blade')
  const [splits, setSplits] = useState<ReadonlySet<number>>(new Set())
  const [picked, setPicked] = useState<ReadonlySet<number>>(new Set())
  const [sizeTarget, setSizeTarget] = useState(5)
  const [bookmarks, setBookmarks] = useState<ReadonlySet<number>>(new Set())
  const [blankPages, setBlankPages] = useState<ReadonlySet<number>>(new Set())
  const [pdfDocument, setPdfDocument] = useState<PDFDocumentProxy | null>(null)
  const [tickets, setTickets] = useState<Ticket[] | null>(null)
  /* The ranges spec the current tickets were produced from. Tickets are only
     shown or downloadable while it still equals the live spec — editing a cut
     or switching mode after a run must never leave the old parts offered under
     the new tray's labels (they were matched by position, so a download could
     carry a different page range than its ticket said). */
  const [producedSpec, setProducedSpec] = useState<string | null>(null)
  const [trayNote, setTrayNote] = useState<string | null>(null)
  const [rangesText, setRangesText] = useState('')
  const [everyN, setEveryN] = useState('2')
  const [combine, setCombine] = useState(false)
  const [startedAt, setStartedAt] = useState(0)
  const [confirmClear, setConfirmClear] = useState(false)
  const [preview, setPreview] = useState<{
    blob?: Blob
    document?: PDFDocumentProxy
    title: string
    page: number
    singlePage?: boolean
  } | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  const pdfDocumentRef = useRef<PDFDocumentProxy | null>(null)
  const idRef = useRef(0)
  const pickAnchor = useRef<number | null>(null)
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([])
  const panelId = useId()

  const custom = useMemo(() => parseCustomRanges(rangesText, pageCount), [rangesText, pageCount])

  /* Blade positions each mode draws on the mat (a cut after page N). Extract
     and custom ranges do not partition the document, so they draw none. */
  const activeCuts = useMemo(() => {
    if (mode === 'blade') return [...splits].filter((page) => page > 0 && page < pageCount).sort((a, b) => a - b)
    if (mode === 'size') return cutsBySize(file?.file.size ?? 0, pageCount, sizeTarget)
    if (mode === 'bookmarks') return cutsFromBookmarks(bookmarks, pageCount)
    return []
  }, [mode, splits, bookmarks, sizeTarget, pageCount, file])
  const cutSet = useMemo(() => new Set(activeCuts), [activeCuts])

  /* Extract: picked runs. Custom ranges: the typed parts. Otherwise: the
     blades partition the whole document. */
  const bundles = useMemo<Bundle[]>(() => {
    if (!pageCount) return []
    if (mode === 'extract') return bundlesFromPicked(picked)
    if (mode === 'ranges') return custom.ok ? custom.bundles : []
    if (mode === 'bookmarks' && bookmarks.size === 0) return []
    return bundlesFromCuts(activeCuts, pageCount)
  }, [pageCount, mode, picked, custom, activeCuts, bookmarks])

  const combineActive = mode === 'extract' && combine && bundles.length > 0
  const rangesSpec = useMemo(() => bundlesToSpec(bundles), [bundles])
  /* The plan a result belongs to includes the combine choice: one file and
     several files from the same pages are different results. */
  const planKey = `${rangesSpec}|${combineActive ? 'one' : 'many'}`
  const resultsCurrent = phase === 'done' && tickets !== null && producedSpec === planKey
  const resultsStale = phase === 'done' && tickets !== null && producedSpec !== planKey
  /* Pages no part includes (Extract / Custom ranges) recede on the mat. */
  const includedPages = useMemo(() => {
    if (mode !== 'extract' && mode !== 'ranges') return null
    const set = new Set<number>()
    for (const [from, to] of bundles) for (let page = from; page <= to; page += 1) set.add(page)
    return set
  }, [mode, bundles])
  const trayBundles: Bundle[] = combineActive ? [[bundles[0][0], bundles[bundles.length - 1][1]]] : bundles
  const combinedPageCount = combineActive ? bundles.reduce((sum, [from, to]) => sum + to - from + 1, 0) : 0
  const dirty = splits.size > 0 || picked.size > 0 || rangesText.trim() !== ''

    // One mat, one document: the newest drop replaces whatever lay here.
  const addFiles = useCallback((list: File[]) => {
    // Shared intake rules: a wrong type or an oversized file is named precisely.
    const { accepted, rejections } = validateIntake(list, SPEC)
    const pdf = accepted[0]
    if (!pdf) {
      setError(rejections.map((rejection) => rejection.message).join(' '))
      return
    }
    setError(rejections.length ? rejections.map((rejection) => rejection.message).join(' ') : null)
    setTickets(null)
    setPreview(null)
    setPdfDocument(null)
    setSplits(new Set())
    setPicked(new Set())
    setRangesText('')
    setCombine(false)
    setBookmarks(new Set())
    setBlankPages(new Set())
    setPageCount(0)
    setPhase('edit')
    setFile({ id: `f${++idRef.current}`, file: pdf })
  }, [])

  // Ctrl+V pasted files land on the mat, same as the sibling tools.
  usePasteFiles(addFiles, phase === 'edit')

  const { getRootProps, getInputProps, isDragActive, open } = useDropzone({
    onDrop: addFiles,
    noClick: true,
    accept: { 'application/pdf': ['.pdf'] },
  })

  /* Read the document in the browser (pdfjs, already a repo dependency):
     exact page count for the mat, outline entries for the bookmarks mode,
     and blank-page detection for the mat-foot note. A failed read only
     disables the refinements — the count still arrives from the server. */
  useEffect(() => {
    if (!file) return
    let cancelled = false
    let loadedDocument: PDFDocumentProxy | null = null
    if (pdfDocumentRef.current) void pdfDocumentRef.current.destroy()
    pdfDocumentRef.current = null
    setPdfDocument(null)
    setAnalysing(true)
    ;(async () => {
      try {
        const doc = await loadPdfDocument(await file.file.arrayBuffer())
        loadedDocument = doc
        if (cancelled) {
          void doc.destroy()
          return
        }
        pdfDocumentRef.current = doc
        setPdfDocument(doc)
        setPageCount(doc.numPages)

        if (doc.numPages <= MAX_SHEETS) {
          const outline = await doc.getOutline().catch(() => null)
          if (cancelled) return
          if (outline?.length) {
            const pages = new Set<number>()
            for (const entry of outline.slice(0, 50)) {
              // An outline dest is either a named destination (string) or an
              // explicit array whose first item is the page reference. Many
              // real PDFs use the array form; skipping it made the mat claim
              // "no outline entries" for documents that have bookmarks.
              const explicit = typeof entry.dest === 'string'
                ? await doc.getDestination(entry.dest).catch(() => null)
                : entry.dest
              const ref = Array.isArray(explicit) ? explicit[0] : null
              const index = ref && typeof ref === 'object'
                ? await doc.getPageIndex(ref).catch(() => null)
                : typeof ref === 'number' ? ref : null
              if (index === null || index === undefined) continue
              pages.add(index + 1)
            }
            if (!cancelled && pages.size) setBookmarks(pages)
          }
        }

        if (doc.numPages <= MAX_BLANK_SCAN) {
          const blanks = new Set<number>()
          const probe = document.createElement('canvas')
          probe.width = 24
          probe.height = 32
          const ctx = probe.getContext('2d', { willReadFrequently: true })
          for (let n = 1; n <= doc.numPages; n += 1) {
            if (cancelled) return
            const page = await doc.getPage(n).catch(() => null)
            if (!page || !ctx) continue
            /* A 24-px probe cannot see small type, so a light text page (a
               contents page) used to be called blank. Real text means not blank. */
            const text = await page.getTextContent().catch(() => null)
            if (text?.items.some((item) => 'str' in item && item.str.trim() !== '')) continue
            try {
              /* pdfjs 5.x: `canvas` alone — the legacy canvasContext pair is deprecated. */
              await page.render({
                canvas: probe,
                viewport: page.getViewport({ scale: 24 / page.getViewport({ scale: 1 }).width }),
              }).promise
            } catch {
              continue // unreadable page is not claimed blank
            }
            const { data } = ctx.getImageData(0, 0, probe.width, probe.height)
            let dark = 0
            for (let px = 0; px < data.length; px += 4) {
              if (data[px] < 200 || data[px + 1] < 200 || data[px + 2] < 200) dark += 1
            }
            if (dark / (probe.width * probe.height) < 0.005) blanks.add(n)
          }
          if (!cancelled && blanks.size) setBlankPages(blanks)
        }
      } catch {
        // The mat still works: the server reports the true count on split.
      } finally {
        if (!cancelled) setAnalysing(false)
      }
    })()
    return () => {
      cancelled = true
      if (loadedDocument) {
        if (pdfDocumentRef.current === loadedDocument) pdfDocumentRef.current = null
        void loadedDocument.destroy()
      }
    }
  }, [file])

    const run = useCallback(async () => {
    if (!file || phase === 'running' || !bundles.length) return
    setPhase('running')
    setError(null)
    setProgress(0)
    setStartedAt(Date.now())
    const abort = new AbortController()
    abortRef.current = abort
    const runKey = planKey
    const runBundles = bundles
    const runCombine = combineActive
    try {
      const formData = new FormData()
      formData.append('files', file.file)
      formData.append('ranges', rangesSpec)
      if (runCombine) formData.append('combine', '1')

      const res = await uploadWithProgress(tool.apiEndpoint, formData, {
        onProgress: setProgress,
        signal: abort.signal,
      })
      if (!res.ok) throw new Error(await getApiErrorMessage(res, 'The split failed'))

      const blob = await res.blob()

      if (!runCombine && runBundles.length > 1) {
        const { default: JSZip } = await import('jszip')
        const zip = await JSZip.loadAsync(blob)
        const entries = Object.values(zip.files).filter((f) => !f.dir)
        const produced: Ticket[] = []
        for (let i = 0; i < runBundles.length; i += 1) {
          const [from, to] = runBundles[i]
          // Exact match against the engine's `<base>_pages_<from>-<to>_part<N>.pdf`,
          // part number included — custom ranges may repeat a range. No
          // fallback to "any file": a missing part stays missing rather than
          // being labelled with another part's pages.
          const exact = new RegExp(`_pages_${from}-${to}(_part${i + 1})?\\.pdf$`)
          const entry = entries.find((f) => exact.test(f.name))
          if (!entry) continue
          produced.push({
            name: partFileName(file.file.name, runBundles, i, false),
            blob: await entry.async('blob'),
            from,
            to,
          })
        }
        setTickets(produced)
        setProducedSpec(runKey)
        setTrayNote(
          produced.length === runBundles.length
            ? `${produced.length} parts produced — download individually or all as one ZIP.`
            : `${produced.length} of ${runBundles.length} parts came back from the server — the missing ones are not downloadable. Split again to retry.`,
        )
        addRecentConversion({ toolId: 'split-pdf', label: tool.label, filename: `mycloove_${file.file.name.replace(/\.pdf$/i, '')}_split.zip`, sizeBytes: blob.size })
      } else {
        const name = partFileName(file.file.name, runBundles, 0, runCombine)
        const single: Ticket = { name, blob, from: runBundles[0][0], to: runBundles[runBundles.length - 1][1] }
        setTickets([single])
        setProducedSpec(runKey)
        setTrayNote(runCombine ? 'Your picked pages are bound into one PDF.' : `One part produced — pages ${single.from}–${single.to}.`)
        addRecentConversion({ toolId: 'split-pdf', label: tool.label, filename: name, sizeBytes: blob.size })
      }
      setPhase('done')
    } catch (e) {
      if (e instanceof Error && e.name === 'ApiClientError' && /cancelled/i.test(e.message)) {
        setError(null) // a deliberate cancel is not an error
      } else {
        setError(e instanceof Error ? e.message : 'The split failed — please try again.')
      }
      setPhase('edit')
    } finally {
      abortRef.current = null
      setProgress(null)
    }
  }, [file, phase, bundles, rangesSpec, planKey, combineActive])

    const cancelRun = useCallback(() => {
    abortRef.current?.abort()
  }, [])

  const clearAll = useCallback(() => {
    abortRef.current?.abort()
    setFile(null)
    setPdfDocument(null)
    setPreview(null)
    setPageCount(0)
    setTickets(null)
    setTrayNote(null)
    setSplits(new Set())
    setPicked(new Set())
    setRangesText('')
    setCombine(false)
    setBookmarks(new Set())
    setBlankPages(new Set())
    setPhase('edit')
    setError(null)
  }, [])

  /* Mat interactions. Extract: click picks (Shift-click a run), double-click views. */
  const pickPage = (page: number, event: MouseEvent) => {
    const anchor = pickAnchor.current
    if (event.shiftKey && anchor !== null) {
      const [lo, hi] = anchor <= page ? [anchor, page] : [page, anchor]
      setPicked((previous) => {
        const next = new Set(previous)
        for (let p = lo; p <= hi; p += 1) next.add(p)
        return next
      })
      return
    }
    pickAnchor.current = page
    setPicked((previous) => {
      const next = new Set(previous)
      if (next.has(page)) next.delete(page)
      else next.add(page)
      return next
    })
  }

  const openPage = (page: number) => {
    if (file && pdfDocument) setPreview({ document: pdfDocument, title: file.file.name, page, singlePage: true })
  }

  /* WAI-ARIA tabs: one tab stop; arrows / Home / End move and activate. */
  const onTabKey = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const last = MODES.length - 1
    const next =
      event.key === 'ArrowRight' ? (index === last ? 0 : index + 1)
      : event.key === 'ArrowLeft' ? (index === 0 ? last : index - 1)
      : event.key === 'Home' ? 0
      : event.key === 'End' ? last
      : null
    if (next === null) return
    event.preventDefault()
    setMode(MODES[next][0])
    tabRefs.current[next]?.focus()
  }

  const downloadOne = useCallback((ticket: Ticket) => {
    downloadBlob(ticket.blob, ticket.name)
  }, [])

  const downloadAll = useCallback(async () => {
    if (!tickets?.length) return
    if (tickets.length === 1) {
      downloadBlob(tickets[0].blob, tickets[0].name)
      return
    }
    const { default: JSZip } = await import('jszip')
    const zip = new JSZip()
    for (const ticket of tickets) zip.file(ticket.name, ticket.blob)
    const blob = await zip.generateAsync({ type: 'blob', compression: 'STORE' })
    downloadBlob(blob, `mycloove_${file?.file.name.replace(/\.pdf$/i, '') ?? 'split'}_parts.zip`)
  }, [tickets, file])

  return (
    <div className="spl-page">
      <header className="spl-sitebar" data-tool-navbar="split-pdf">
        <div className="spl-sitebar-inner">
          <div className="spl-breadcrumb">
            <Link href="/" className="spl-logo-link" aria-label="mycloove home">
              <AnimatedBrandLogo />
            </Link>
            <span className="spl-site-separator" aria-hidden="true">/</span>
            <span className="spl-site-brand">mycloove</span>
            <span className="spl-site-separator" aria-hidden="true">/</span>
            <b>Split PDF</b>
          </div>
          <div className="spl-site-actions">
            <ToolSwitcher toolId="split-pdf" availability={availability} shortcut />
            <AuthNavButton chrome="tool" accountState={accountState} creditState={creditState} creditDisplayToolId="split-pdf" />
          </div>
        </div>
      </header>

      <div className="spl">
        {file && (
          <div className="spl-header">
            <div className="spl-header-actions">
              <div className="spl-filechip" title={`${file.file.name} — ${formatSize(file.file.size)}`}>
                {Icon.doc}
                <b>{file.file.name}</b>
                <span>
                  {analysing && !pageCount ? 'reading…' : `${pageCount || '?'} page${pageCount === 1 ? '' : 's'} · ${formatSize(file.file.size)}`}
                </span>
              </div>
              <button
                type="button"
                className="spl-preview-launch"
                disabled={!pdfDocument}
                onClick={() => pdfDocument && setPreview({ document: pdfDocument, title: file.file.name, page: 1 })}
              >
                {Icon.preview} Preview full PDF
              </button>
            </div>
          </div>
        )}

        {!file ? (
          <div {...getRootProps({ className: `spl-intake${isDragActive ? ' over' : ''}` })}>
            <input {...getInputProps()} />
            {Icon.blade}
            <h1>Lay the document on the mat.</h1>
            <p className="spl-lede">
              Drop a PDF here, <span className="spl-paste-hint">paste with Ctrl+V, </span>or
              <button type="button" className="spl-linkbtn" onClick={open}>browse files</button> —
              the mat will show every sheet, and you lower the blade where it should come apart.
            </p>
            <button type="button" className="spl-brass" onClick={open}>Browse files</button>
            {/* The limits, stated before anything is dropped (roadmap §6.1). */}
            <p className="spl-limits">{describeLimits(SPEC)}</p>
            {/* Refusals were set but never shown here before a document was on the mat. */}
            {error && <div className="spl-err" role="alert">{Icon.alert}<span>{error}</span></div>}
          </div>
        ) : (
          <>
            <h1>Set the blade where the document should come apart.</h1>
            <p className="spl-lede">
              Each brass mark is a cut point. Click one to lower the blade — the tray below fills in as you go,
              so every ticket shows exactly what you&apos;re about to produce.
            </p>
            <div className="spl-wrap">
            <div className="spl-mat">
              <div className="spl-mathead">
                <h2>Cutting mat — {pageCount || '…'} sheets</h2>
                <span className="spl-hint">{pad2(1)} – {pad2(Math.max(pageCount, 1))}</span>
              </div>
              <div className="spl-ruler">
                {Array.from({ length: Math.min(pageCount, MAX_SHEETS) }, (_, i) => (
                  <Fragment key={i}>
                    <span className="spl-rulermark">{pad2(i + 1)}</span>
                    {i < Math.min(pageCount, MAX_SHEETS) - 1 && <span className="spl-rulergap" />}
                  </Fragment>
                ))}
              </div>
              <div className="spl-matbody">
                {Array.from({ length: Math.min(pageCount, MAX_SHEETS) }, (_, i) => {
                  const page = i + 1
                  const isPicked = mode === 'extract' && picked.has(page)
                  const outside = includedPages !== null && !includedPages.has(page)
                  return (
                    <Fragment key={page}>
                      <div className={`spl-sheet-cell${outside ? ' outside' : ''}`}>
                        <button
                          type="button"
                          className={`spl-sheet${blankPages.has(page) ? ' flag' : ''}${mode === 'extract' ? ' selectable' : ''}${isPicked ? ' picked' : ''}`}
                          onClick={(event) => (mode === 'extract' ? pickPage(page, event) : openPage(page))}
                          onDoubleClick={() => { if (mode === 'extract') openPage(page) }}
                          aria-pressed={mode === 'extract' ? isPicked : undefined}
                          aria-label={mode === 'extract'
                            ? `Page ${page}${blankPages.has(page) ? ' (reads blank)' : ''}`
                            : `Preview page ${page}${blankPages.has(page) ? ' (reads blank)' : ''}`}
                          title={mode === 'extract' ? `Pick page ${page} — double-click to preview` : `Preview page ${page}`}
                          disabled={phase === 'running'}
                        >
                          {pdfDocument && <PdfPageCanvas document={pdfDocument} pageNumber={page} className="spl-sheet-preview" lazy />}
                          <span className="spl-sheet-number">{page}</span>
                        </button>
                        {/* The corner mark stays as the mat's visual cue; the sheet itself is
                            now the one control, so this is a mark, not a second button. */}
                        {mode === 'extract' && (
                          <span className={`spl-sheet-select${isPicked ? ' selected' : ''}`} aria-hidden="true">
                            {isPicked ? Icon.check : '+'}
                          </span>
                        )}
                      </div>
                      {page < Math.min(pageCount, MAX_SHEETS) && (
                        mode === 'blade' ? (
                          <button
                            type="button"
                            className={`spl-blade${splits.has(page) ? ' active' : ''}`}
                            aria-pressed={splits.has(page)}
                            aria-label={`Cut between page ${page} and ${page + 1}`}
                            disabled={phase === 'running'}
                            onClick={() => {
                              setSplits((prev) => {
                                const next = new Set(prev)
                                if (next.has(page)) next.delete(page)
                                else next.add(page)
                                return next
                              })
                            }}
                          >
                            <span className="spl-blade-line" />
                            <span className="spl-blade-handle" />
                          </button>
                        ) : (
                          /* Size and bookmark cuts are drawn here but decided by their mode, so
                             they are marks, not buttons (they used to be focusable and inert). */
                          <span className={`spl-blade static${cutSet.has(page) ? ' active' : ''}`} aria-hidden="true">
                            <span className="spl-blade-line" />
                            <span className="spl-blade-handle" />
                          </span>
                        )
                      )}
                    </Fragment>
                  )
                })}
              </div>
              {blankPages.size > 0 && (
                <div className="spl-matfoot">
                  <span className="spl-swatch" />
                  {blankPages.size === 1
                    ? `sheet ${[...blankPages][0]} reads blank — it ships as-is unless removed first.`
                    : `sheets ${[...blankPages].sort((a, b) => a - b).map(pad2).join(', ')} read blank — they ship as-is unless removed first.`}
                </div>
              )}
            </div>
            <div className="spl-modes" role="tablist" aria-label="Split mode">
              {MODES.map(([key, label], index) => (
                <button
                  key={key}
                  ref={(node) => { tabRefs.current[index] = node }}
                  type="button"
                  role="tab"
                  id={`${panelId}-tab-${key}`}
                  aria-selected={mode === key}
                  aria-controls={panelId}
                  tabIndex={mode === key ? 0 : -1}
                  className={`spl-modebtn${mode === key ? ' on' : ''}`}
                  onClick={() => setMode(key)}
                  onKeyDown={(event) => onTabKey(event, index)}
                >
                  {key === 'bookmarks' && bookmarks.size ? `${label} (${bookmarks.size})` : label}
                </button>
              ))}
            </div>

            <div id={panelId} role="tabpanel" aria-labelledby={`${panelId}-tab-${mode}`} className="spl-modepanel">
            {mode === 'blade' && (
              <form
                className="spl-sizebar"
                onSubmit={(event) => {
                  event.preventDefault()
                  setSplits(new Set(cutsEveryN(Number(everyN), pageCount)))
                }}
              >
                <label htmlFor="spl-every-input">Cut every</label>
                <input id="spl-every-input" type="number" min={1} step={1} value={everyN} onChange={(e) => setEveryN(e.target.value)} />
                <span>pages</span>
                <button type="submit" className="spl-ghost small" disabled={!(Number(everyN) >= 1) || pageCount < 2}>Apply</button>
                {splits.size > 0 && <button type="button" className="spl-ghost small" onClick={() => setSplits(new Set())}>Raise all blades</button>}
              </form>
            )}
            {mode === 'ranges' && (
              <div className="spl-sizebar spl-rangesbar">
                <label htmlFor="spl-ranges-input">Parts, one range each</label>
                <input
                  id="spl-ranges-input"
                  className="spl-rangesinput"
                  value={rangesText}
                  onChange={(e) => setRangesText(e.target.value)}
                  placeholder={`e.g. 1-3, 5, 8-${Math.max(pageCount, 8)}`}
                  autoComplete="off"
                  spellCheck={false}
                  aria-invalid={!custom.ok}
                  aria-describedby="spl-ranges-help"
                />
                <p id="spl-ranges-help" className={custom.ok ? 'spl-cardnote' : 'spl-fielderr'} role={custom.ok ? undefined : 'alert'}>
                  {custom.ok ? 'Each range becomes its own PDF, in the order you type them. “8-” means page 8 to the end.' : custom.message}
                </p>
              </div>
            )}
            {mode === 'extract' && (
              <div className="spl-sizebar">
                <label className="spl-checkline">
                  <input type="checkbox" checked={combine} onChange={(e) => setCombine(e.target.checked)} />
                  Put the picked pages in one PDF
                </label>
                <span className="spl-cardnote spl-inline-note">Click sheets to pick them, Shift-click for a run, double-click to preview.</span>
              </div>
            )}
            {mode === 'size' && (
              <div className="spl-sizebar">
                <label htmlFor="spl-size-input">Target size per part</label>
                <input
                  id="spl-size-input"
                  type="number"
                  min={0.1}
                  step={0.5}
                  value={sizeTarget}
                  onChange={(e) => setSizeTarget(Math.max(0.1, Number(e.target.value) || 0.1))}
                />
                <span>MB</span>
                <span className="spl-cardnote spl-inline-note">An estimate from the average page size — real part sizes show in the tray after the split.</span>
              </div>
            )}
            {mode === 'bookmarks' && !bookmarks.size && !analysing && (
              <p className="spl-cardnote">This document has no outline entries — pick the visual blade or custom ranges instead.</p>
            )}
            {mode === 'bookmarks' && bookmarks.size > 0 && (
              <p className="spl-cardnote">Each bookmarked page starts a new part; the cuts are marked on the mat.</p>
            )}
            </div>
            <div className="spl-trayhead">
              <h2>Output tray</h2>
              <span className="spl-count">
                {resultsCurrent && tickets
                  ? `${tickets.length} ${tickets.length === 1 ? 'bundle' : 'bundles'} in the tray`
                  : `${trayBundles.length} ${trayBundles.length === 1 ? 'bundle' : 'bundles'} ready`}
              </span>
            </div>

            <div className="spl-tray">
              {trayBundles.map(([from, to], i) => {
                const count = combineActive ? combinedPageCount : to - from + 1
                const name = partFileName(file.file.name, bundles, combineActive ? 0 : i, combineActive)
                const doneTicket = resultsCurrent ? tickets?.find((t) => t.name === name) : undefined
                const estBytes = count * (file.file.size / Math.max(pageCount, 1))
                return (
                  <article className="spl-ticket" key={name}>
                    <div className="spl-ticket-bundle">
                      {Array.from({ length: Math.min(count, 4) }, (_, l) => (
                        <span className="spl-leaf" key={l} />
                      ))}
                    </div>
                    {/* The exact name it downloads under — no second naming scheme. */}
                    <div className="spl-ticket-name">
                      {name}
                      {doneTicket && <span className="spl-ticket-ok">{Icon.check}</span>}
                    </div>
                    <div className="spl-ticket-sub">
                      {combineActive ? `pages ${rangesSpec}` : `pages ${from}–${to}`} · {count} sheet{count > 1 ? 's' : ''}
                    </div>
                    <div className="spl-ticket-row">
                      <span className="spl-ticket-size">{doneTicket ? formatSize(doneTicket.blob.size) : `≈ ${formatSize(estBytes)} est.`}</span>
                      <span className="spl-ticket-actions">
                        <button
                          type="button"
                          className="spl-ticket-preview spl-ticket-action-preview"
                          aria-label={`Preview ${name}`}
                          disabled={!doneTicket}
                          onClick={() => doneTicket && setPreview({ blob: doneTicket.blob, title: doneTicket.name, page: 1 })}
                        >
                          {Icon.preview}<span>Preview</span>
                        </button>
                        <button
                          type="button"
                          className="spl-ticket-dl"
                          aria-label={`Download ${name}`}
                          disabled={!doneTicket}
                          onClick={() => doneTicket && downloadOne(doneTicket)}
                        >
                          ↓
                        </button>
                      </span>
                    </div>
                  </article>
                )
              })}
              {!trayBundles.length && (
                <p className="spl-cardnote">
                  {mode === 'ranges' ? 'Type at least one range to fill the tray.' : 'Lower at least one blade (or pick a page) to fill the tray.'}
                </p>
              )}
            </div>

            <div className="spl-actiondock">
              {phase === 'running' && (
                <HonestProgress uploadPercent={progress} startedAt={startedAt} processingLabel="Cutting on the server" onCancel={cancelRun} />
              )}

              {trayNote && resultsCurrent && (
                <div className="spl-note" role="status">{Icon.check}<span>{trayNote}</span></div>
              )}
              {resultsStale && (
                // Information, not a failure — the brass note material, not the danger one.
                <div className="spl-note" role="status">
                  {Icon.alert}<span>The cuts changed since the last split. Split again to refresh these parts.</span>
                </div>
              )}
              {error && (
                <div className="spl-err" role="alert">{Icon.alert}<span>{error}</span></div>
              )}
              {phase !== 'running' && creditState.snapshot?.prices['split-pdf']?.enabled !== false && <div className="spl-credit-cost"><CreditCost toolId="split-pdf" creditState={creditState} /></div>}
              <div className="spl-actions">
                <button type="button" className="spl-ghost" onClick={downloadAll} disabled={!resultsCurrent || !tickets?.length}>
                  {tickets && tickets.length === 1 && resultsCurrent ? 'Download' : 'Download all (.zip)'}
                </button>
                <button
                  type="button"
                  className="spl-brass spl-run-cta"
                  onClick={run}
                  disabled={!trayBundles.length || phase === 'running'}
                >
                  {phase === 'running' ? <>{Icon.spinner}Splitting…</> : <>{trayBundles.length > 1 ? `Split into ${trayBundles.length} PDFs` : 'Split PDF'}{Icon.arrow}</>}
                </button>
                {/* Clearing throws away the cut plan, so it asks first when there is one. */}
                <button type="button" className="spl-ghost spl-clear-btn" onClick={() => (dirty ? setConfirmClear(true) : clearAll())}>Clear the mat</button>
              </div>
            </div>
            <footer className="spl-footer">NOTHING IS PROCESSED UNTIL YOU LOWER THE BLADE — SPLIT PDF</footer>
            </div>
          </>
        )}
        <Dialog open={confirmClear} onClose={() => setConfirmClear(false)} title="Clear the mat?">
          <div className="spl-confirm">
            <p>Your blades, ranges and picked pages for {file?.file.name ?? 'this PDF'} will be cleared. Your original file is not changed.</p>
            <div className="spl-confirm-actions">
              <ActionButton onClick={() => { setConfirmClear(false); clearAll() }}>Clear the mat</ActionButton>
              <ActionButton variant="quiet" onClick={() => setConfirmClear(false)}>Keep working</ActionButton>
            </div>
          </div>
        </Dialog>
        {preview && (
          <PdfPreviewModal
            key={`${preview.title}:${preview.page}`}
            blob={preview.blob}
            sourceDocument={preview.document}
            title={preview.title}
            initialPage={preview.page}
            singlePage={preview.singlePage}
            onClose={() => setPreview(null)}
          />
        )}
      </div>
    </div>
  )
}
