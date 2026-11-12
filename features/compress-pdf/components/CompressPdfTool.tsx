'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import CreditCost from '@/components/tools/CreditCost'
import ToolNavbar from '@/components/tools/ToolNavbar'
import {
  ActionButton,
  DownloadIcon,
  DropAnywhere,
  FileChip,
  HonestProgress,
  Notice,
  NoticeList,
  OptionGroup,
  Receipt,
  describeLimits,
  formatBytes,
  useFilePicker,
  validateIntake,
  type IntakeSpec,
  type Option,
  type ReceiptFact,
} from '@/components/tools/kit'
import { useAccountViewer } from '@/lib/account/useAccountViewer'
import { useCreditBalance } from '@/lib/usage/useCreditBalance'
import { useToolAvailability } from '@/lib/usage/useToolAvailability'
import { getTool } from '@/lib/tools/registry'
import { uploadWithProgress, getApiErrorMessage } from '@/lib/upload/uploadWithProgress'
import { downloadBlob } from '@/lib/download/downloadOutputs'
import { addRecentConversion } from '@/lib/history/recentConversions'
import './CompressPdfTool.css'

/**
 * Compress PDF — "the compression engine console" (roadmap §8.11).
 *
 * Instrument concept: a console that weighs the document before and after,
 * and shows only what it actually measured. Its look — the grid, the glowing
 * teal mass, the dashed rings, the teal drop target, the inverted run button —
 * is this tool's identity and stays (owner direction, 2026-11-06). What was
 * removed on 2026-11-06 was dishonest, not decorative: a scrolling scripted
 * "engine" log, a size guessed before anything ran, and an auto-download. The
 * rings now turn only while the server is really working.
 *
 * Honesty (doctrine 5): the engine is pdf-microservice/features/compress_pdf.py
 * (PyMuPDF), reached through /api/compress-pdf. It downsamples and re-encodes
 * images above a level's DPI threshold, subsets fonts and drops unreferenced
 * objects — and keeps text, links, form fields, bookmarks, attachments and
 * metadata at every level, verifying the page count and every page's text on
 * the output before returning it. A result that would not be smaller comes
 * back unchanged with X-Compression-Outcome: already_optimal. The scale reads
 * the real source bytes; after a run it reads the real compressed bytes from
 * the route's X-Original-Bytes / X-Compressed-Bytes headers. Nothing on this
 * page moves before that.
 *
 * Signature moment (one per surface): when the real size arrives, the weight
 * settles to its new size and the figure counts down from the original to the
 * result. Reduced motion shows the final value at once.
 *
 * Phase 2 pilot: intake, options, progress and the receipt come from the
 * shared kit (components/tools/kit); limits come from the registry entry.
 * Results are never auto-downloaded (owner decision D4) — the receipt's
 * Download button is the only way out.
 */

type Phase = 'idle' | 'running' | 'done'
type ModeId = 'structural' | 'optimal' | 'aggressive'

interface ModeConfig extends Option<ModeId> {
  /** The wire value the engine and /api/compress-pdf understand. */
  level: 'light' | 'strong' | 'aggressive'
  /** What the receipt reports this mode did to the file. */
  receipt: ReceiptFact
}

/* Each mode states what it does to *images* — the only thing the engine
   trades (compress_pdf.py PROFILES). Nothing else is removed at any level. */
const MODES: readonly ModeConfig[] = [
  {
    value: 'structural',
    level: 'light',
    title: 'Lossless',
    tag: 'Pixel-perfect',
    description: 'Cleans and repacks the file structure. Every pixel stays exactly as it is — best for text documents and forms.',
    receipt: { tone: 'info', text: 'Lossless repack — every image was left exactly as it was.' },
  },
  {
    value: 'optimal',
    level: 'strong',
    title: 'Recommended',
    tag: '150 dpi',
    description: 'Images above 200 dpi resampled to 150 dpi; fonts trimmed to the characters used. Sharp on screen and in print.',
    receipt: { tone: 'info', text: 'Images above 200 dpi were resampled to 150 dpi; fonts were trimmed to the characters used.' },
  },
  {
    value: 'aggressive',
    level: 'aggressive',
    title: 'Smallest',
    tag: '110 dpi',
    description: 'Images resampled to 110 dpi at lower JPEG quality — for email and upload limits. Text stays crisp and selectable.',
    receipt: { tone: 'info', text: 'Images above 130 dpi were resampled to 110 dpi at lower JPEG quality.' },
  },
]

/* What every level keeps — enforced by the engine, which checks the page
   count and every page's text on the output before it is returned. */
const ENGINE_KEEPS: ReceiptFact = {
  tone: 'info',
  text: 'Text, links, form fields, bookmarks and metadata were kept, and every page’s text was verified.',
}

const tool = getTool('compress-pdf')
/* The registry entry is the one source of the accepted type and limits. */
const SPEC: IntakeSpec = { accepts: tool.accepts ?? [], limits: tool.limits! }

interface CompressedResult {
  name: string
  blob: Blob
  before: number
  after: number
  /** Whole-percent change; positive = smaller. */
  pct: number
  smaller: boolean
  /** The engine re-encoded at least one image (X-Images-Rewritten). */
  imagesRewritten: boolean
  mode: ModeConfig
}

/* The weight's resting scale, and the floor a real result may shrink it to.
   The floor keeps the paper wider than the longest reading ("12.3 MB") at
   both dial sizes — below it, ink text would spill onto the dark card. */
const MASS_FULL = 0.9
const MASS_FLOOR = 0.45
const COUNT_MS = 600

const UPLOAD_ICON = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
    <polyline points="17 8 12 3 7 8" />
    <line x1="12" y1="3" x2="12" y2="15" />
  </svg>
)

function savingLabel(r: CompressedResult): string {
  return r.pct >= 1 ? `${r.pct}% smaller` : 'less than 1% smaller'
}

export default function CompressPdfTool() {
  const accountState = useAccountViewer()
  const creditState = useCreditBalance(accountState.status === 'loading' ? null : accountState.viewer?.id ?? 'guest')
  const availability = useToolAvailability()
  const [file, setFile] = useState<File | null>(null)
  const [mode, setMode] = useState<ModeId>('optimal')
  const [phase, setPhase] = useState<Phase>('idle')
  const [progress, setProgress] = useState<number | null>(null)
  const [startedAt, setStartedAt] = useState(0)
  const [error, setError] = useState<{ messages: string[]; id: number } | null>(null)
  const [result, setResult] = useState<CompressedResult | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  const errorIdRef = useRef(0)

  const showError = useCallback((messages: string[]) => {
    errorIdRef.current += 1
    setError({ messages, id: errorIdRef.current })
  }, [])

  // One scale, one document: the newest acceptable file replaces the last.
  const addFiles = useCallback((list: File[]) => {
    const { accepted, rejections } = validateIntake(list, SPEC)
    if (accepted.length === 0) {
      showError(rejections.map((r) => r.message))
      return
    }
    // A wrong file dropped alongside a good one is still reported.
    if (rejections.length) showError(rejections.map((r) => r.message))
    else setError(null)
    setResult(null)
    setPhase('idle')
    setFile(accepted[0])
  }, [showError])

  const picker = useFilePicker(SPEC, addFiles)

  // A result belongs to the mode that produced it; picking another mode
  // clears it so the receipt can never describe the wrong run.
  const selectMode = useCallback((next: ModeId) => {
    setMode(next)
    setResult(null)
    setPhase((current) => (current === 'done' ? 'idle' : current))
  }, [])

  const run = useCallback(async () => {
    if (!file || phase === 'running') return
    const config = MODES.find((m) => m.value === mode) ?? MODES[1]

    setPhase('running')
    setError(null)
    setResult(null)
    setProgress(0)
    setStartedAt(Date.now())

    const abort = new AbortController()
    abortRef.current = abort
    try {
      const formData = new FormData()
      formData.append('files', file)
      formData.append('level', config.level)

      const res = await uploadWithProgress(tool.apiEndpoint, formData, {
        onProgress: setProgress,
        signal: abort.signal,
      })
      if (!res.ok) throw new Error(await getApiErrorMessage(res, 'The compression failed'))

      const disposition = res.headers.get('Content-Disposition') ?? ''
      const match = /filename="([^"]+)"/.exec(disposition)
      const outName = match ? decodeURIComponent(match[1]) : 'mycloove_compressed.pdf'
      const blob = await res.blob()

      const before = Number(res.headers.get('X-Original-Bytes') ?? String(file.size))
      const after = Number(res.headers.get('X-Compressed-Bytes') ?? String(blob.size))
      // `already_optimal` is the engine saying "nothing gained; original returned".
      const smaller = res.headers.get('X-Compression-Outcome') !== 'already_optimal' && after < before
      const pct = before > 0 ? Math.round((1 - after / before) * 100) : 0
      const imagesRewritten = res.headers.get('X-Images-Rewritten') === '1'
      setResult({ name: outName, blob, before, after, pct, smaller, imagesRewritten, mode: config })
      addRecentConversion({ toolId: 'compress-pdf', label: tool.label, filename: outName, sizeBytes: blob.size })
      setPhase('done')
    } catch (e) {
      // A deliberate cancel is not an error.
      if (!(e instanceof Error && e.name === 'ApiClientError' && /cancelled/i.test(e.message))) {
        showError([e instanceof Error ? e.message : 'The compression failed — please try again.'])
      }
      setPhase('idle')
    } finally {
      abortRef.current = null
      setProgress(null)
    }
  }, [file, phase, mode, showError])

  const cancelRun = useCallback(() => {
    abortRef.current?.abort()
  }, [])

  const clearAll = useCallback(() => {
    abortRef.current?.abort()
    setFile(null)
    setResult(null)
    setPhase('idle')
    setError(null)
  }, [])

  const finished = result !== null && phase === 'done'
  const running = phase === 'running'

  // Real bytes only: the weight sits at full size until a run reports its
  // after/before ratio, and never grows past full for a file that got larger.
  const massScale = finished
    ? Math.max(MASS_FLOOR, MASS_FULL * Math.min(1, result.after / Math.max(1, result.before)))
    : MASS_FULL

  const shownBytes = useCountDown(finished ? result.before : null, finished ? result.after : null)
  const sizeText = finished ? formatBytes(shownBytes ?? result.after) : file ? formatBytes(file.size) : '—'
  const sizeSub =
    finished ? (result.smaller ? savingLabel(result) : 'Already optimized')
    : running ? 'Compressing…'
    : file ? 'Original size'
    : 'No document yet'

  const download = () => {
    if (result) downloadBlob(result.blob, result.name)
  }

  return (
    <div className="acx-page">
      <DropAnywhere spec={SPEC} onFiles={addFiles} enabled={!running} />
      {picker.input}

      {/* `.acx-sitebar` is a verified contract hook (scripts/verify-tool-navigation.mjs). */}
      <ToolNavbar
        toolId="compress-pdf"
        className="acx-sitebar"
        skipTo="#compress-main"
        accountState={accountState}
        creditState={creditState}
        availability={availability}
      />

      <div className="acx-main" id="compress-main" tabIndex={-1}>
        <section className="acx-scale" aria-label="Document size">
          <p className="acx-scale-label" aria-hidden="true">TARGET_MASS</p>
          <div className={`acx-dial${running ? ' working' : ''}`}>
            {/* The outer ring is the original's weight, so the gap to the new
                weight is the saving. The rings turn only while the server is
                actually working — motion means work, never decoration. */}
            <div className="acx-ring acx-ring-1" aria-hidden="true" />
            <div className="acx-ring acx-ring-2" aria-hidden="true" />
            <div
              className={`acx-mass${file ? '' : ' empty'}${finished && result.smaller ? ' settled' : ''}`}
              style={{ transform: `scale(${massScale})` }}
              aria-hidden="true"
            />
            {/* A sibling, not a child: scaling the weight must not shrink its reading. */}
            <div className={`acx-size${file ? '' : ' empty'}`}>{sizeText}</div>
          </div>
          <p className="acx-size-sub" aria-live="polite">
            {finished ? `${formatBytes(result.before)} → ${formatBytes(result.after)} · ${sizeSub}` : sizeSub}
          </p>
        </section>

        <section className="acx-controls" aria-label="Compression settings">
          <h1 className="acx-title">{tool.label}</h1>
          <p className="acx-lede">
            Shrinks heavy images and trims fonts; text, links, forms and bookmarks stay. The result below is
            measured, not estimated — and a file that cannot get smaller comes back unchanged.
          </p>

          {!file ? (
            // The original Compress drop target, kept as this tool's identity
            // (owner direction, 2026-11-06); the whole page still takes a drop.
            <button type="button" className="acx-drop" onClick={picker.open} disabled={running}>
              <span className="acx-drop-icon" aria-hidden="true">{UPLOAD_ICON}</span>
              <span className="acx-drop-title">Drop your PDF here</span>
              <span className="acx-drop-sub">or <span className="acx-drop-link">browse files</span></span>
              <span className="acx-drop-meta">{describeLimits(SPEC)}</span>
            </button>
          ) : (
            <FileChip
              name={file.name}
              sizeBytes={file.size}
              onReplace={picker.open}
              onRemove={clearAll}
              disabled={running}
            />
          )}

          {error && (
            <Notice key={error.id} tone="error" shake>
              <NoticeList items={error.messages} />
            </Notice>
          )}

          <OptionGroup
            label="Mode"
            options={MODES}
            value={mode}
            onChange={selectMode}
            disabled={running}
          />

          {finished ? (
            <Receipt
              tone={result.smaller ? 'success' : 'warning'}
              title={result.smaller ? `Compressed — ${savingLabel(result)}` : 'Already optimized — nothing to gain'}
              fileName={result.name}
              facts={[
                result.smaller
                  ? { tone: 'success', text: `${formatBytes(result.before)} → ${formatBytes(result.after)}` }
                  : {
                      tone: 'warning',
                      text: result.mode.level === 'aggressive'
                        ? `${formatBytes(result.before)} — already as small as it can get without damaging it. Your original was returned unchanged.`
                        : `${formatBytes(result.before)} — already optimized at this level. Your original was returned unchanged; try Smallest for image-heavy files.`,
                    },
                ...(result.smaller ? [result.mode.receipt] : []),
                ...(result.smaller && result.mode.level !== 'light' && !result.imagesRewritten
                  ? [{ tone: 'info' as const, text: 'No image needed resampling — the saving is structural.' }]
                  : []),
                ENGINE_KEEPS,
              ]}
              actions={
                <>
                  <ActionButton variant={result.smaller ? 'primary' : 'quiet'} icon={<DownloadIcon />} onClick={download}>
                    {result.smaller ? 'Download' : 'Download anyway'}
                  </ActionButton>
                  <ActionButton variant="quiet" onClick={clearAll}>Compress another PDF</ActionButton>
                </>
              }
            />
          ) : running ? (
            <HonestProgress
              uploadPercent={progress}
              startedAt={startedAt}
              processingLabel="Compressing on the server"
              onCancel={cancelRun}
            />
          ) : (
            <div className="acx-run">
              {creditState.snapshot?.prices['compress-pdf']?.enabled !== false && (
                <div className="acx-credit-cost"><CreditCost toolId="compress-pdf" creditState={creditState} /></div>
              )}
              {/* Only once a document is on the scale: before that, "Choose a
                  PDF" is the screen's one primary action (roadmap §3.3, Calm). */}
              {file && <ActionButton className="acx-btn" block arrow onClick={run}>Compress PDF</ActionButton>}
            </div>
          )}
        </section>
      </div>
    </div>
  )
}

/**
 * The signature count: once the real after-size exists, the figure runs from
 * the original down to it (600ms, ease-out). Before that it returns null —
 * there is nothing true to animate toward. Reduced motion jumps to the end.
 */
function useCountDown(from: number | null, to: number | null): number | null {
  const [value, setValue] = useState<number | null>(null)
  useEffect(() => {
    if (from === null || to === null) return
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      const frame = requestAnimationFrame(() => setValue(to))
      return () => cancelAnimationFrame(frame)
    }
    const start = performance.now()
    let frame = requestAnimationFrame(function tick(now) {
      const t = Math.min(1, (now - start) / COUNT_MS)
      const eased = 1 - Math.pow(1 - t, 3)
      setValue(Math.round(from + (to - from) * eased))
      if (t < 1) frame = requestAnimationFrame(tick)
    })
    return () => cancelAnimationFrame(frame)
  }, [from, to])
  return from === null || to === null ? null : value ?? from
}
