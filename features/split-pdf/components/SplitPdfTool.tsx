'use client'

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { useDropzone } from 'react-dropzone'
import AnimatedBrandLogo from '@/components/animated-brand-logo/AnimatedBrandLogo'
import { uploadWithProgress, getApiErrorMessage } from '@/lib/upload/uploadWithProgress'
import { usePasteFiles } from '@/lib/upload/usePasteFiles'
import { downloadBlob } from '@/lib/download/downloadOutputs'
import { addRecentConversion } from '@/lib/history/recentConversions'
import { loadPdfDocument, PdfPageCanvas, PdfPreviewModal } from './PdfPreview'
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
 */

type Phase = 'edit' | 'running' | 'done'
type Mode = 'blade' | 'extract' | 'size' | 'bookmarks'

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

/* Mirrors the route's env-backed per-file limit (PDF_TOOLS_MAX_FILE_BYTES). */
const MAX_FILE_MB = 50
/* The mat draws real sheets; past this the strip keeps scrolling, never shrinks. */
const MAX_SHEETS = 400
/* Blank-page sniffing renders tiny thumbnails; beyond this it is skipped. */
const MAX_BLANK_SCAN = 200

const fmtSize = (b: number) =>
  b >= 1048576 ? `${(b / 1048576).toFixed(1)} MB`
  : b >= 1024 ? `${Math.max(1, Math.round(b / 1024))} KB`
  : `${b} B`

const pad2 = (n: number) => String(n).padStart(2, '0')

/** "1-3, 5, 8-" — exactly the grammar the engine and its tests pin. */
function bundlesToRanges(bundles: Array<[number, number]>) {
  return bundles.map(([from, to]) => (from === to ? `${from}` : `${from}-${to}`)).join(', ')
}

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
  const [trayNote, setTrayNote] = useState<string | null>(null)
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

  /* Any mode's current cut decision, as sorted blade positions. */
  const activeCuts = useMemo(() => {
    if (mode === 'blade') return [...splits].filter((page) => page > 0 && page < pageCount).sort((a, b) => a - b)
    if (mode === 'size') {
      if (!pageCount || sizeTarget <= 0) return []
      const avg = (file?.file.size ?? 0) / pageCount
      const targetBytes = sizeTarget * 1048576
      const cuts: number[] = []
      let acc = 0
      for (let p = 1; p < pageCount; p += 1) {
        acc += avg
        if (acc >= targetBytes) {
          cuts.push(p)
          acc = 0
        }
      }
      return cuts
    }
    if (mode === 'bookmarks') return [...bookmarks].filter((page) => page > 0 && page < pageCount).sort((a, b) => a - b)
    return [...picked].sort((a, b) => a - b)
  }, [mode, splits, picked, bookmarks, sizeTarget, pageCount, file])

  /* Extract mode: picked pages; contiguous runs become bundles. Other modes:
     blades partition the whole document. */
  const bundles = useMemo<Array<[number, number]>>(() => {
    if (!pageCount) return []
    if (mode === 'extract') {
      if (!picked.size) return []
      const sorted = [...picked].sort((a, b) => a - b)
      const out: Array<[number, number]> = []
      let from = sorted[0]
      let prev = sorted[0]
      for (const p of sorted.slice(1)) {
        if (p === prev + 1) {
          prev = p
          continue
        }
        out.push([from, prev])
        from = p
        prev = p
      }
      out.push([from, prev])
      return out
    }
    const pts = [0, ...activeCuts, pageCount]
    const out: Array<[number, number]> = []
    for (let i = 0; i < pts.length - 1; i += 1) out.push([pts[i] + 1, pts[i + 1]])
    return out
  }, [pageCount, mode, picked, activeCuts])

  const rangesSpec = useMemo(() => bundlesToRanges(bundles), [bundles])

    // One mat, one document: the newest drop replaces whatever lay here.
  const addFiles = useCallback((list: File[]) => {
    const pdf = list.find((f) => f.type === 'application/pdf' || f.name.toLowerCase().endsWith('.pdf'))
    if (!pdf) {
      setError('Only PDF files can reach this mat.')
      return
    }
    if (pdf.size > MAX_FILE_MB * 1024 * 1024) {
      setError(`${pdf.name} is ${fmtSize(pdf.size)} — the limit is ${MAX_FILE_MB} MB per file.`)
      return
    }
    setError(null)
    setTickets(null)
    setPreview(null)
    setPdfDocument(null)
    setSplits(new Set())
    setPicked(new Set())
    setBookmarks(new Set())
    setBlankPages(new Set())
    setPageCount(0)
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
              if (typeof entry.dest !== 'string') continue
              const index = typeof entry.dest === 'string'
                ? await doc.getDestination(entry.dest).then(
                    (name) => (name ? doc.getPageIndex(name[0]) : null),
                  ).catch(() => null)
                : null
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
    const abort = new AbortController()
    abortRef.current = abort
    try {
      const formData = new FormData()
      formData.append('files', file.file)
      formData.append('ranges', rangesSpec)

      const res = await uploadWithProgress('/api/split-pdf', formData, {
        onProgress: setProgress,
        signal: abort.signal,
      })
      if (!res.ok) throw new Error(await getApiErrorMessage(res, 'The split failed'))

      const disposition = res.headers.get('Content-Disposition') ?? ''
      const match = /filename="([^"]+)"/.exec(disposition)
      const outName = match ? decodeURIComponent(match[1]) : 'mycloove_split.pdf'
      const blob = await res.blob()
      const base = file.file.name.replace(/\.pdf$/i, '')

      if (outName.endsWith('.zip') || bundles.length > 1) {
        const { default: JSZip } = await import('jszip')
        const zip = await JSZip.loadAsync(blob)
        const produced: Ticket[] = []
        for (let i = 0; i < bundles.length; i += 1) {
          const [from, to] = bundles[i]
          const entry = Object.values(zip.files).find((f) => !f.dir && f.name.includes(`pages_${from}-${to}`))
            ?? Object.values(zip.files).find((f) => !f.dir)
          if (!entry) continue
          produced.push({
            name: `mycloove_${base}_part${produced.length + 1}_pages_${from}-${to}.pdf`,
            blob: await entry.async('blob'),
            from,
            to,
          })
        }
        setTickets(produced)
        setTrayNote(`${produced.length} parts produced — download individually or all as one ZIP.`)
        addRecentConversion({ toolId: 'split-pdf', label: 'Split PDF', filename: `mycloove_${base}_split.zip`, sizeBytes: blob.size })
      } else {
        const [from, to] = bundles[0]
        const single: Ticket = { name: outName, blob, from, to }
        setTickets([single])
        setTrayNote(`One part produced — pages ${from}–${to}.`)
        addRecentConversion({ toolId: 'split-pdf', label: 'Split PDF', filename: outName, sizeBytes: blob.size })
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
  }, [file, phase, bundles, rangesSpec])

    const cancelRun = useCallback(() => {
    abortRef.current?.abort()
  }, [])

  const clearAll = useCallback(() => {
    setFile(null)
    setPdfDocument(null)
    setPreview(null)
    setPageCount(0)
    setTickets(null)
    setTrayNote(null)
    setSplits(new Set())
    setPicked(new Set())
    setBookmarks(new Set())
    setBlankPages(new Set())
    setTrayNote(null)
    setPhase('edit')
    setError(null)
  }, [])

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
      <header className="spl-sitebar">
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
          <Link className="spl-all-tools" href="/">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <rect x="3" y="3" width="7" height="7" rx="1" />
              <rect x="14" y="3" width="7" height="7" rx="1" />
              <rect x="3" y="14" width="7" height="7" rx="1" />
              <rect x="14" y="14" width="7" height="7" rx="1" />
            </svg>
            <span>All tools</span>
          </Link>
        </div>
      </header>

      <div className="spl">
        {file && (
          <div className="spl-header">
            <div className="spl-header-actions">
              <div className="spl-filechip" title={`${file.file.name} — ${fmtSize(file.file.size)}`}>
                {Icon.doc}
                <b>{file.file.name}</b>
                <span>
                  {analysing && !pageCount ? 'reading…' : `${pageCount || '?'} page${pageCount === 1 ? '' : 's'} · ${fmtSize(file.file.size)}`}
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
              Drop a PDF here, paste with Ctrl+V, or
              <button type="button" className="spl-linkbtn" onClick={open}>browse files</button> —
              the mat will show every sheet, and you lower the blade where it should come apart.
            </p>
            <button type="button" className="spl-brass" onClick={open}>Browse files</button>
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
                  return (
                    <Fragment key={page}>
                      <div className="spl-sheet-cell">
                        <button
                          type="button"
                          className={`spl-sheet${blankPages.has(page) ? ' flag' : ''}${mode === 'extract' ? ' selectable' : ''}${picked.has(page) ? ' picked' : ''}`}
                          onClick={() => {
                            if (file && pdfDocument) {
                              setPreview({ document: pdfDocument, title: file.file.name, page, singlePage: true })
                            }
                          }}
                          aria-label={`Preview page ${page}${blankPages.has(page) ? ' (reads blank)' : ''}`}
                          title={`Preview page ${page}`}
                        >
                          {pdfDocument && <PdfPageCanvas document={pdfDocument} pageNumber={page} className="spl-sheet-preview" lazy />}
                          <span className="spl-sheet-number">{page}</span>
                        </button>
                        {mode === 'extract' && (
                          <button
                            type="button"
                            className={`spl-sheet-select${picked.has(page) ? ' selected' : ''}`}
                            aria-pressed={picked.has(page)}
                            aria-label={`${picked.has(page) ? 'Deselect' : 'Select'} page ${page}`}
                            title={`${picked.has(page) ? 'Deselect' : 'Select'} page ${page}`}
                            onClick={() => setPicked((prev) => {
                              const next = new Set(prev)
                              if (next.has(page)) next.delete(page)
                              else next.add(page)
                              return next
                            })}
                          >
                            {picked.has(page) ? Icon.check : '+'}
                          </button>
                        )}
                      </div>
                      {page < Math.min(pageCount, MAX_SHEETS) && (
                        <button
                          type="button"
                          className={`spl-blade${splits.has(page) ? ' active' : ''}`}
                          aria-pressed={splits.has(page)}
                          aria-label={`Cut between page ${page} and ${page + 1}`}
                          onClick={() => {
                            if (mode !== 'blade') return
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
              {(
                [
                  ['blade', 'Visual blade'],
                  ['extract', 'Extract pages'],
                  ['size', 'Split by size'],
                  ['bookmarks', bookmarks.size ? `At bookmarks (${bookmarks.size})` : 'At bookmarks'],
                ] as Array<[Mode, string]>
              ).map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  role="tab"
                  aria-selected={mode === key}
                  className={`spl-modebtn${mode === key ? ' on' : ''}`}
                  onClick={() => setMode(key)}
                >
                  {label}
                </button>
              ))}
            </div>

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
              </div>
            )}
            {mode === 'bookmarks' && !bookmarks.size && !analysing && (
              <p className="spl-cardnote">This document has no outline entries — pick the visual blade instead.</p>
            )}
            <div className="spl-trayhead">
              <h2>Output tray</h2>
              <span className="spl-count">
                {phase === 'done' && tickets ? `${tickets.length} bundles in the tray` : `${bundles.length} bundles ready`}
              </span>
            </div>

            <div className="spl-tray">
              {bundles.map(([from, to], i) => {
                const count = to - from + 1
                const doneTicket = phase === 'done' ? tickets?.[i] : undefined
                const estBytes = count * (file.file.size / Math.max(pageCount, 1))
                return (
                  <article className="spl-ticket" key={`${from}-${to}`}>
                    <div className="spl-ticket-bundle">
                      {Array.from({ length: Math.min(count, 4) }, (_, l) => (
                        <span className="spl-leaf" key={l} />
                      ))}
                    </div>
                    <div className="spl-ticket-name">
                      {file.file.name.replace(/\.pdf$/i, '')}_part{i + 1}.pdf
                      {doneTicket && <span className="spl-ticket-ok">{Icon.check}</span>}
                    </div>
                    <div className="spl-ticket-sub">pages {from}–{to} · {count} sheet{count > 1 ? 's' : ''}</div>
                    <div className="spl-ticket-row">
                      <span className="spl-ticket-size">{doneTicket ? fmtSize(doneTicket.blob.size) : `~${(estBytes / 1048576).toFixed(1)} MB`}</span>
                      <span className="spl-ticket-actions">
                        <button
                          type="button"
                          className="spl-ticket-preview spl-ticket-action-preview"
                          aria-label={`Preview ${doneTicket?.name ?? `${file.file.name.replace(/\.pdf$/i, '')}_part${i + 1}.pdf`}`}
                          disabled={!doneTicket}
                          onClick={() => doneTicket && setPreview({ blob: doneTicket.blob, title: doneTicket.name, page: 1 })}
                        >
                          {Icon.preview}<span>Preview</span>
                        </button>
                        <button
                          type="button"
                          className="spl-ticket-dl"
                          aria-label={`Download ${file.file.name.replace(/\.pdf$/i, '')}_part${i + 1}.pdf`}
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
              {!bundles.length && (
                <p className="spl-cardnote">Lower at least one blade (or pick a page) to fill the tray.</p>
              )}
            </div>

            <div className="spl-actiondock">
              {phase === 'running' && progress !== null && (
                <div className="spl-progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress}>
                  <div className="spl-progress-fill" style={{ width: `${progress}%` }} />
                  <span className="spl-progress-pct">{progress}%</span>
                </div>
              )}
              {phase === 'running' && (
                <button type="button" className="spl-ghost small" onClick={cancelRun}>Cancel</button>
              )}

              {trayNote && phase === 'done' && (
                <div className="spl-note" role="status">{Icon.check}<span>{trayNote}</span></div>
              )}
              {error && (
                <div className="spl-err" role="alert">{Icon.alert}<span>{error}</span></div>
              )}
              <div className="spl-actions">
                <button type="button" className="spl-ghost" onClick={downloadAll} disabled={phase !== 'done' || !tickets?.length}>
                  Download all (.zip)
                </button>
                <button
                  type="button"
                  className="spl-brass spl-run-cta"
                  onClick={run}
                  disabled={!bundles.length || phase === 'running'}
                >
                  {phase === 'running' ? <>{Icon.spinner}Splitting…</> : <>Split PDF{Icon.arrow}</>}
                </button>
                <button type="button" className="spl-ghost spl-clear-btn" onClick={clearAll}>Clear the mat</button>
              </div>
            </div>
            <footer className="spl-footer">NOTHING IS PROCESSED UNTIL YOU LOWER THE BLADE — SPLIT PDF</footer>
            </div>
          </>
        )}
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
