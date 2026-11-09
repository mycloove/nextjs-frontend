'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useDropzone } from 'react-dropzone'
import AnimatedBrandLogo from '@/components/animated-brand-logo/AnimatedBrandLogo'
import AuthNavButton from '@/components/AuthNavButton'
import CreditCost from '@/components/tools/CreditCost'
import { useAccountViewer } from '@/lib/account/useAccountViewer'
import { useCreditBalance } from '@/lib/usage/useCreditBalance'
import { useToolAvailability } from '@/lib/usage/useToolAvailability'
import ToolSwitcher from '@/components/tools/ToolSwitcher'
import { uploadWithProgress, getApiErrorMessage } from '@/lib/upload/uploadWithProgress'
import { usePasteFiles } from '@/lib/upload/usePasteFiles'
import { downloadBlob } from '@/lib/download/downloadOutputs'
import { addRecentConversion } from '@/lib/history/recentConversions'
import './CompressPdfTool.css'

/**
 * Compress PDF — "the compression engine console".
 *
 * The whole page is the tool (the §2 full-screen exception shape used by
 * /mr-markdown and /split-pdf): a target-mass visualizer on the left, three
 * engine modes and a live terminal on the right. The instrument concept is a
 * containment gauge — you watch the document's mass shrink as you pick a mode.
 *
 * Honesty (mycloove doctrine 5): the engine (pdf-microservice
 * features/compress_pdf.py) trades image fidelity only — text, links, forms,
 * bookmarks and attachments survive every level, and a file that cannot get
 * smaller comes back unchanged with outcome `already_optimal`. So the mode
 * cards state what each level does to images instead of predicting a size
 * (savings depend entirely on how image-heavy the document is), and after a
 * run the mass is scaled to the real before/after ratio.
 */

type Phase = 'idle' | 'running' | 'done'
type ModeId = 'structural' | 'optimal' | 'aggressive'

interface LogLine {
  id: number
  text: string
  kind: 'dim' | 'warn' | 'loud'
}

interface ModeConfig {
  id: ModeId
  /** The wire value the engine and /api/compress-pdf understand. */
  level: 'light' | 'strong' | 'aggressive'
  title: string
  desc: string
  /** What happens to images — shown where a fake size estimate used to be. */
  tag: string
  /** Visual mass scale in the gauge before a run. */
  scale: number
  logs: string[]
}

const MODES: ModeConfig[] = [
  {
    id: 'structural',
    level: 'light',
    title: 'Lossless',
    desc: 'Cleans and repacks the file structure. Every pixel stays exactly as it is — best for text documents and forms.',
    tag: 'Pixel-perfect',
    scale: 0.9,
    logs: [
      '> Target: lossless repack',
      '> Unused objects removed, duplicates merged',
      '> Streams re-deflated',
      '> Images left untouched',
    ],
  },
  {
    id: 'optimal',
    level: 'strong',
    title: 'Recommended',
    desc: 'Images above 200 dpi resampled to 150 dpi; fonts trimmed to the characters used. Sharp on screen and in print.',
    tag: '150 dpi',
    scale: 0.6,
    logs: [
      '> Target: best balance',
      '> Images > 200 dpi → 150 dpi, JPEG q75',
      '> Fonts subset to used glyphs',
      '> Text, links, forms, bookmarks kept',
    ],
  },
  {
    id: 'aggressive',
    level: 'aggressive',
    title: 'Smallest',
    desc: 'Images resampled to 110 dpi at lower JPEG quality — for email and upload limits. Text stays crisp and selectable.',
    tag: '110 dpi',
    scale: 0.35,
    logs: [
      '> Target: smallest file',
      '> Images > 130 dpi → 110 dpi, JPEG q60',
      '> Fonts subset to used glyphs',
      '> Text, links, forms, bookmarks kept',
    ],
  },
]

/* Mirrors the route's env-backed per-file limit (PDF_TOOLS_MAX_FILE_BYTES). */
const MAX_FILE_MB = 50

const fmtSize = (b: number) =>
  b >= 1048576 ? `${(b / 1048576).toFixed(1)} MB`
  : b >= 1024 ? `${Math.max(1, Math.round(b / 1024))} KB`
  : `${b} B`

const Icon = {
  doc: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
    </svg>
  ),
  upload: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="17 8 12 3 7 8" />
      <line x1="12" y1="3" x2="12" y2="15" />
    </svg>
  ),
  bolt: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" />
    </svg>
  ),
  download: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" />
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
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" className="acx-spin" aria-hidden="true">
      <circle cx="12" cy="12" r="10" strokeOpacity="0.25" /><path d="M12 2a10 10 0 0 1 10 10" />
    </svg>
  ),
}

interface CompressedResult {
  name: string
  blob: Blob
  before: number
  after: number
  pct: number
  /** Engine verdict; `already_optimal` means the original bytes came back. */
  outcome: 'compressed' | 'already_optimal'
  /** Mode the result was produced with — a mode change invalidates it. */
  mode: ModeId
}

/** Gauge scale from a real byte ratio; area tracks bytes, hence the sqrt. */
function massScale(before: number, after: number): number {
  if (before <= 0) return 0.9
  return Math.min(0.9, Math.max(0.22, 0.9 * Math.sqrt(after / before)))
}

export default function CompressPdfTool() {
  const accountState = useAccountViewer()
  const creditState = useCreditBalance(accountState.status === 'loading' ? null : accountState.viewer?.id ?? 'guest')
  const availability = useToolAvailability()
  const [file, setFile] = useState<File | null>(null)
  const [mode, setMode] = useState<ModeId>('optimal')
  const [phase, setPhase] = useState<Phase>('idle')
  const [progress, setProgress] = useState<number | null>(null)
  const [logs, setLogs] = useState<LogLine[]>([])
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<CompressedResult | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  const logIdRef = useRef(0)
  const terminalRef = useRef<HTMLDivElement>(null)
  const replayTimersRef = useRef<number[]>([])

  const addLog = useCallback((text: string, kind: LogLine['kind'] = 'dim') => {
    setLogs((prev) => [...prev, { id: ++logIdRef.current, text, kind }])
  }, [])

  // One bench, one document: the newest drop replaces whatever sat here.
  const addFiles = useCallback((list: File[]) => {
    const pdf = list.find((f) => f.type === 'application/pdf' || f.name.toLowerCase().endsWith('.pdf'))
    if (!pdf) {
      setError('Only PDF files can sit on this bench.')
      return
    }
    setError(null)
    setResult(null)
    setPhase('idle')
    setFile(pdf)
  }, [])

  // Ctrl+V pasted files land on the bench, same as the sibling tools.
  usePasteFiles(addFiles, phase === 'idle')

  const { getRootProps, getInputProps, isDragActive, open } = useDropzone({
    onDrop: addFiles,
    noClick: true,
    accept: { 'application/pdf': ['.pdf'] },
  })

  // Replay the active mode's readout when the mode or the bench document
  // changes. Deliberately not keyed on `phase`: a finished or failed run must
  // leave its own terminal output in place, not be overwritten by the replay.
  useEffect(() => {
    logIdRef.current += 1
    setLogs([{ id: logIdRef.current, text: '> Mode plan — applied only when you press Initialize.', kind: 'dim' }])
    const config = MODES.find((m) => m.id === mode) ?? MODES[1]
    const timers = config.logs.map((line, index) =>
      window.setTimeout(() => addLog(line, 'dim'), (index + 1) * 280),
    )
    replayTimersRef.current = timers
    return () => timers.forEach((timer) => window.clearTimeout(timer))
  }, [mode, file, addLog])

  // Keep the terminal pinned to its newest line.
  useEffect(() => {
    const terminal = terminalRef.current
    if (terminal) terminal.scrollTop = terminal.scrollHeight
  }, [logs])

  const run = useCallback(async () => {
    if (!file || phase === 'running') return
    if (file.size > MAX_FILE_MB * 1024 * 1024) {
      setError(`${file.name} is ${fmtSize(file.size)} — the limit is ${MAX_FILE_MB} MB per file.`)
      return
    }
    const config = MODES.find((m) => m.id === mode) ?? MODES[1]
    // A run owns the terminal: a mode-plan replay still ticking from a fresh
    // drop must not interleave its lines with the run's real output.
    replayTimersRef.current.forEach((timer) => window.clearTimeout(timer))
    replayTimersRef.current = []

    setPhase('running')
    setError(null)
    setResult(null)
    setProgress(0)
    setLogs([])
    logIdRef.current += 1
    setLogs([{ id: logIdRef.current, text: '> EXECUTING COMPRESSION ALGORITHM...', kind: 'loud' }])

    const abort = new AbortController()
    abortRef.current = abort
    // Upload progress ends at 100% long before a heavy file is done — the
    // engine still has every image to resample. Say so once, in the log.
    let uploadAnnounced = false
    try {
      const formData = new FormData()
      formData.append('files', file)
      formData.append('level', config.level)

      const res = await uploadWithProgress('/api/compress-pdf', formData, {
        onProgress: (percent) => {
          setProgress(percent)
          if (percent >= 100 && !uploadAnnounced) {
            uploadAnnounced = true
            addLog(`> Upload complete (${fmtSize(file.size)}). Engine working…`, 'dim')
          }
        },
        signal: abort.signal,
      })
      if (!res.ok) throw new Error(await getApiErrorMessage(res, 'The compression failed'))

      const disposition = res.headers.get('Content-Disposition') ?? ''
      const match = /filename="([^"]+)"/.exec(disposition)
      const outName = match ? decodeURIComponent(match[1]) : 'mycloove_compressed.pdf'
      const blob = await res.blob()

      const before = Number(res.headers.get('X-Original-Bytes') ?? String(file.size))
      const after = Number(res.headers.get('X-Compressed-Bytes') ?? String(blob.size))
      const outcome = res.headers.get('X-Compression-Outcome') === 'already_optimal' || after >= before
        ? 'already_optimal' as const
        : 'compressed' as const
      const pct = outcome === 'compressed' && before > 0 ? Math.max(1, Math.round((1 - after / before) * 100)) : 0
      // An unchanged copy is not worth an unasked-for download; the user can
      // still take it from the button, or try a stronger level.
      if (outcome === 'compressed') {
        downloadBlob(blob, outName)
        addRecentConversion({ toolId: 'compress-pdf', label: 'Compress PDF', filename: outName, sizeBytes: blob.size })
      }
      setResult({ name: outName, blob, before, after, pct, outcome, mode: config.id })
      /* Facts the engine verified on the output bytes — reported as such, not
         replayed from the mode plan. */
      const pages = Number(res.headers.get('X-Page-Count') ?? '')
      if (Number.isFinite(pages) && pages > 0) {
        addLog(`> Verified: ${pages} page${pages === 1 ? '' : 's'}, text identical to the original.`, 'dim')
      }
      if (outcome === 'compressed' && config.level !== 'light') {
        addLog(
          res.headers.get('X-Images-Rewritten') === '1'
            ? '> Images resampled and re-encoded.'
            : '> No image needed resampling — savings are structural.',
          'dim',
        )
      }
      addLog(
        outcome === 'compressed'
          ? `> DONE. ${fmtSize(before)} → ${fmtSize(after)} (${pct}% smaller).`
          : `> DONE. Already optimized at this level — original kept (${fmtSize(before)}).`,
        'dim',
      )
      setPhase('done')
    } catch (e) {
      if (e instanceof Error && e.name === 'ApiClientError' && /cancelled/i.test(e.message)) {
        setError(null) // a deliberate cancel is not an error
        addLog('> Run cancelled.', 'warn')
      } else {
        const message = e instanceof Error ? e.message : 'The compression failed — please try again.'
        setError(message)
        addLog(`> ERROR: ${message}`, 'warn')
      }
      setPhase('idle')
    } finally {
      abortRef.current = null
      setProgress(null)
    }
  }, [file, phase, mode, addLog])

  const cancelRun = useCallback(() => {
    abortRef.current?.abort()
  }, [])

  const downloadResult = useCallback(() => {
    if (result) downloadBlob(result.blob, result.name)
  }, [result])

  const clearAll = useCallback(() => {
    abortRef.current?.abort()
    setFile(null)
    setResult(null)
    setPhase('idle')
    setError(null)
    setLogs([])
  }, [])

  // A result belongs to the level that produced it. Picking another level
  // returns the bench to "ready" so the button can never hand back a file
  // compressed at a level the user has since moved away from.
  const selectMode = useCallback((next: ModeId) => {
    setMode(next)
    setResult((current) => (current && current.mode !== next ? null : current))
    setPhase((current) => (current === 'done' ? 'idle' : current))
  }, [])

  const config = MODES.find((m) => m.id === mode) ?? MODES[1]
  const tone = 'var(--acx-accent)'
  const done = result !== null && phase === 'done'
  const mass = done ? massScale(result.before, result.after) : config.scale

  const sizeText =
    done ? fmtSize(result.after)
    : file ? fmtSize(file.size)
    : '—'

  // Upload finished, response not yet back: the server is doing the work.
  const engineWorking = phase === 'running' && progress === 100

  const sizeSub =
    done ? (result.outcome === 'compressed' ? `Saved ${result.pct}%` : 'Already optimized')
    : engineWorking ? 'Compressing…'
    : phase === 'running' ? 'Uploading…'
    : file ? 'Original Size'
    : 'Awaiting document'

  return (
    <div className={`acx-page${isDragActive ? ' acx-drag' : ''}`}>
      <header className="acx-sitebar" data-tool-navbar="compress-pdf">
        <div className="acx-sitebar-inner">
          <div className="acx-breadcrumb">
            <Link href="/" className="acx-logo-link" aria-label="mycloove home">
              <AnimatedBrandLogo />
            </Link>
            <span className="acx-site-separator" aria-hidden="true">/</span>
            <span className="acx-site-brand">mycloove</span>
            <span className="acx-site-separator" aria-hidden="true">/</span>
            <b>Compress PDF</b>
          </div>
          <div className="acx-site-actions">
            <ToolSwitcher toolId="compress-pdf" availability={availability} />
            <AuthNavButton chrome="tool" accountState={accountState} creditState={creditState} creditDisplayToolId="compress-pdf" />
          </div>
        </div>
      </header>

      <div {...getRootProps({ className: 'acx-main' })}>
        <input {...getInputProps()} />

        <section className="acx-visualizer" aria-label="Target mass preview">
          <div className="acx-core-label">TARGET_MASS_PREVIEW</div>
          <div className="acx-core">
            <div className="acx-ring acx-ring-1" aria-hidden="true" />
            <div className="acx-ring acx-ring-2" aria-hidden="true" />
            {/* After a run, the original's mass stays as an outline so the
                shrink reads as before → after, not as a lone dot. */}
            {done && <div className="acx-mass-ghost" aria-hidden="true" />}
            <div
              className="acx-mass"
              style={{ transform: `scale(${mass})`, borderColor: tone }}
              aria-hidden="true"
            />
            {/* The readout sits above the disc, never inside its transform —
                a 99% reduction used to shrink the result itself to a speck. */}
            <div className="acx-readout">
              <div className="acx-size" key={sizeText}>{sizeText}</div>
              <div className="acx-size-sub" style={{ color: tone }}>{sizeSub}</div>
            </div>
          </div>
        </section>

        <section className="acx-controls">
          {!file ? (
            <button
              type="button"
              className={`acx-drop${isDragActive ? ' over' : ''}`}
              onClick={open}
              aria-label="Drop a PDF here or browse files"
            >
              <span className="acx-drop-icon" aria-hidden="true">{Icon.upload}</span>
              <span className="acx-drop-title">Drop your PDF here</span>
              <span className="acx-drop-sub">
                or <span className="acx-drop-link">browse files</span> — Ctrl+V works too
              </span>
              <span className="acx-drop-meta">One document · up to {MAX_FILE_MB} MB</span>
            </button>
          ) : (
            <div className="acx-file-pill">
              {Icon.doc}
              <button type="button" className="acx-file-open" onClick={open} title={file.name}>
                <span className="acx-file-name">{file.name}</span>
                <span className="acx-file-size">{fmtSize(file.size)}</span>
              </button>
              <button
                type="button"
                className="acx-file-x"
                aria-label="Remove document"
                onClick={() => { setFile(null); setResult(null); setPhase('idle') }}
              >
                {Icon.trash}
              </button>
            </div>
          )}

          <div className="acx-modes" role="radiogroup" aria-label="Compression mode">
            {MODES.map((m) => (
              <button
                key={m.id}
                type="button"
                role="radio"
                aria-checked={mode === m.id}
                className={`acx-mode${mode === m.id ? ' active' : ''}`}
                onClick={() => selectMode(m.id)}
                disabled={phase === 'running'}
              >
                <div className="acx-mode-head">
                  <div className="acx-mode-title">{m.title}</div>
                  <div className="acx-mode-reduction">{m.tag}</div>
                </div>
                <div className="acx-mode-desc">{m.desc}</div>
              </button>
            ))}
          </div>

          <div className="acx-terminal" ref={terminalRef} role="log" aria-live="polite">
            {logs.length === 0 ? (
              <div className="acx-log dim">&gt; mycloove Core initialized.</div>
            ) : (
              logs.map((line) => (
                <div key={line.id} className={`acx-log${line.kind === 'dim' ? ' dim' : line.kind === 'warn' ? ' warn' : ''}`}>
                  {line.text}
                </div>
              ))
            )}
          </div>

          {phase === 'running' && progress !== null && (
            <div className="acx-runbar">
              {engineWorking ? (
                /* Indeterminate on purpose: the engine reports no progress, so
                   the bar must not pretend to a percentage it does not have. */
                <div className="acx-progress working" role="progressbar" aria-label="Compressing on the server" aria-valuetext="Compressing">
                  <div className="acx-progress-fill" />
                </div>
              ) : (
                <div className="acx-progress" role="progressbar" aria-label="Uploading" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress}>
                  <div className="acx-progress-fill" style={{ width: `${progress}%` }} />
                </div>
              )}
              <span className="acx-pct">{engineWorking ? 'Compressing' : `Uploading ${progress}%`}</span>
              <button type="button" className="acx-cancel" onClick={cancelRun}>Cancel</button>
            </div>
          )}

          {done && (
            <div className="acx-note" role="status">
              {Icon.check}
              <span>
                {result.outcome === 'compressed'
                  ? `${fmtSize(result.before)} → ${fmtSize(result.after)} (${result.pct}% smaller). Saved to your downloads.`
                  : result.mode === 'aggressive'
                    ? 'This PDF is already as small as it can get without damaging it — nothing was changed.'
                    : 'Already optimized at this level — nothing was changed. Try Smallest for image-heavy files.'}
              </span>
            </div>
          )}
          {error && (
            <div className="acx-err" role="alert">
              {Icon.alert}
              <span>{error}</span>
            </div>
          )}

          {phase === 'idle' && creditState.snapshot?.prices['compress-pdf']?.enabled !== false && <div className="acx-credit-cost"><CreditCost toolId="compress-pdf" creditState={creditState} /></div>}
          <button
            type="button"
            className={`acx-btn${done && result.outcome === 'compressed' ? ' success' : ''}`}
            onClick={done ? downloadResult : run}
            disabled={!file || phase === 'running'}
          >
            {phase === 'running' ? (
              <>{Icon.spinner}Processing…</>
            ) : done ? (
              <>{Icon.download}{result.outcome === 'compressed' ? 'Download Result' : 'Download Copy'}</>
            ) : (
              <>{Icon.bolt}Initialize Compression</>
            )}
          </button>

          {(file || result) && phase !== 'running' && (
            <button type="button" className="acx-clear" onClick={clearAll}>Clear bench</button>
          )}
        </section>
      </div>
    </div>
  )
}
