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
 * Honesty (mycloove doctrine 5, and compressPdf.ts's own contract): the engine
 * repacks the PDF skeleton and, at higher levels, drops metadata and optional
 * catalog trees. It never re-encodes images, so the copy says exactly that
 * instead of promising pixel downsampling the engine cannot do. The mass
 * shows the real source bytes, and after a run the real compressed bytes.
 * Predicted sizes on the mode cards are labelled "~" and derived from the
 * source size; they are estimates, not progress.
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
  /** Visual mass scale in the gauge — the mockup's 0.9 / 0.6 / 0.35. */
  scale: number
  danger: boolean
  /** Rough estimate multiplier for the card's "~ size" hint. */
  estimate: number
  logs: string[]
}

const MODES: ModeConfig[] = [
  {
    id: 'structural',
    level: 'light',
    title: 'Structural (Lossless)',
    desc: 'Packs the document skeleton with object streams. Keeps every metadata field. No image re-encoding.',
    scale: 0.9,
    danger: false,
    estimate: 0.92,
    logs: [
      '> Target: structural repack',
      '> Object streams enabled',
      '> Metadata preserved',
      '> Image streams left untouched',
    ],
  },
  {
    id: 'optimal',
    level: 'strong',
    title: 'Optimal (Recommended)',
    desc: 'Repacks the skeleton and drops title/author/subject metadata. Text stays selectable; images are never re-encoded.',
    scale: 0.6,
    danger: false,
    estimate: 0.68,
    logs: [
      '> Target: optimal balance',
      '> Object streams enabled',
      '> Dropping title / author / subject',
      '> Image streams left untouched',
    ],
  },
  {
    id: 'aggressive',
    level: 'aggressive',
    title: 'Aggressive (Lossy)',
    desc: 'Also removes bookmarks, named destinations, embedded files, scripts and page annotations. Smallest file; those extras are lost.',
    scale: 0.35,
    danger: true,
    estimate: 0.45,
    logs: [
      '> Target: maximum shrink',
      '> WARNING: optional data is discarded',
      '> Dropping bookmarks and named destinations',
      '> Dropping annotations and embedded files',
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
      window.setTimeout(() => addLog(line, config.danger && line.includes('WARNING') ? 'warn' : 'dim'), (index + 1) * 280),
    )
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

    setPhase('running')
    setError(null)
    setResult(null)
    setProgress(0)
    setLogs([])
    logIdRef.current += 1
    setLogs([{ id: logIdRef.current, text: '> EXECUTING COMPRESSION ALGORITHM...', kind: 'loud' }])

    const abort = new AbortController()
    abortRef.current = abort
    try {
      const formData = new FormData()
      formData.append('files', file)
      formData.append('level', config.level)

      const res = await uploadWithProgress('/api/compress-pdf', formData, {
        onProgress: setProgress,
        signal: abort.signal,
      })
      if (!res.ok) throw new Error(await getApiErrorMessage(res, 'The compression failed'))

      const disposition = res.headers.get('Content-Disposition') ?? ''
      const match = /filename="([^"]+)"/.exec(disposition)
      const outName = match ? decodeURIComponent(match[1]) : 'mycloove_compressed.pdf'
      const blob = await res.blob()
      downloadBlob(blob, outName)

      const before = Number(res.headers.get('X-Original-Bytes') ?? String(file.size))
      const after = Number(res.headers.get('X-Compressed-Bytes') ?? String(blob.size))
      const pct = before > 0 ? Math.max(0, Math.round((1 - after / before) * 100)) : 0
      setResult({ name: outName, blob, before, after, pct })
      addRecentConversion({ toolId: 'compress-pdf', label: 'Compress PDF', filename: outName, sizeBytes: blob.size })
      addLog(
        pct > 0
          ? `> DONE. ${fmtSize(before)} → ${fmtSize(after)} (${pct}% smaller).`
          : `> DONE. No further structural savings — file written (${fmtSize(after)}).`,
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

  const config = MODES.find((m) => m.id === mode) ?? MODES[1]
  const tone = config.danger ? 'var(--acx-danger)' : 'var(--acx-accent)'

  const sizeText =
    result && phase === 'done' ? fmtSize(result.after)
    : file ? fmtSize(file.size)
    : '—'

  const sizeSub =
    result && phase === 'done' ? `Saved ${result.pct}%`
    : phase === 'running' ? 'Compressing…'
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
            <div
              className="acx-mass"
              style={{
                transform: `scale(${config.scale})`,
                borderColor: tone,
                background: config.danger ? 'var(--acx-danger-glow)' : 'var(--acx-accent-glow)',
                boxShadow: config.danger
                  ? '0 0 40px var(--acx-danger-glow), inset 0 0 20px var(--acx-danger-glow)'
                  : '0 0 40px var(--acx-accent-glow), inset 0 0 20px var(--acx-accent-glow)',
              }}
            >
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
                className={`acx-mode${mode === m.id ? ' active' : ''}${m.danger ? ' danger' : ''}`}
                onClick={() => setMode(m.id)}
                disabled={phase === 'running'}
              >
                <div className="acx-mode-head">
                  <div className="acx-mode-title">{m.title}</div>
                  <div className="acx-mode-reduction">
                    {file ? `~ ${fmtSize(Math.round(file.size * m.estimate))}` : '—'}
                  </div>
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
              <div className="acx-progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress}>
                <div className="acx-progress-fill" style={{ width: `${progress}%` }} />
              </div>
              <span className="acx-pct">{progress}%</span>
              <button type="button" className="acx-cancel" onClick={cancelRun}>Cancel</button>
            </div>
          )}

          {result && phase === 'done' && (
            <div className="acx-note" role="status">
              {Icon.check}
              <span>{fmtSize(result.before)} → {fmtSize(result.after)} ({result.pct}% smaller). Saved to your downloads.</span>
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
            className={`acx-btn${result && phase === 'done' ? ' success' : ''}`}
            onClick={result && phase === 'done' ? downloadResult : run}
            disabled={!file || phase === 'running'}
          >
            {phase === 'running' ? (
              <>{Icon.spinner}Processing…</>
            ) : result && phase === 'done' ? (
              <>{Icon.download}Download Result</>
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
