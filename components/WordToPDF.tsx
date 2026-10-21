'use client'

import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react'
import { useDropzone, type FileRejection } from 'react-dropzone'
import { toolRequest, getApiErrorMessage, ApiClientError } from '@/lib/api/client'

/* ═══════════════════════════════════════════════════════════════════
   The Press Room — The Proofing Bench

   Word → PDF is the family's purest state change: nothing is added,
   nothing is extracted — the same document goes from changeable to
   unchangeable. That is what a press does: a draft is set, pressed,
   and the print is final. The metaphor is native to the domain — PDF
   is literally a print technology.

   Post-dropzone stages (the proofing bench):
   · Spine v2 — the loaded document plus an HONEST size-budget meter:
     the real byte count against the 50 MB bed. Real data, no claims.
   · The press stage — the Draft plate (proofreader's red margin rule,
     loose type lines) against the Final plate (crop marks, gathered
     lines). While pressing, THE ONE SIGNATURE MOMENT runs: the platen
     sweeps down over the draft and the type lines "set", looping —
     an indeterminate cycle, because the backend reports no percentage
     and the UI never fabricates one. The draft dims; the final plate
     brightens under the same curve.
   · The manifest — "what survives the press", laid out near-bento by
     real importance (typography and images read first), not as four
     equal slots.
   · The proof table — after success the REAL output is shown: the
     converted blob is mounted in an embedded viewer next to the
     receipt. The file on screen is the file that downloads; nothing
     here is a mock. If a browser cannot render the preview, the
     "Open in new tab" and "Download" actions stand in for it — the
     failure falls back to the receipt, never to a fake preview.

   State names follow the metaphor — bed (idle) → set → pressing →
   proof — and the zone collapses to a spine strip and never unmounts,
   so the layout never jumps between steps. Same chassis as the
   Contact Sheet (PDF→Images); different bench.

   Surface rules this file obeys (CLAUDE.md §0.4 + design system):
   · ToolWorkspace (surface 3) has no palette of its own — every
     colour is a global token from app/theme.css. Accents are the
     brand coral→orange pair and mean action/identity only (press
     button, final-plate tint, proof seal, focus rings, ≤10% of
     pixels); --brand-yellow is reserved for registration marks, the
     size-budget meter and the job-ticket tag (print's own edge-code
     colour, mirroring the Contact Sheet's yellow frame numbers);
     --brand-red carries danger and the proofreader's margin rule.
     No bare hex in any rule.
   · Fonts: Syne (display) for headings and values; body text
     inherits the tool-surface voice — Inter, as rendered by every
     sibling tool inside ToolWorkspace. Monospace uses
     ui-monospace — nothing that is not loaded in the repo.
   · Motion uses the house curves: cubic-bezier(0.16,1,0.3,1) for
     arrivals, cubic-bezier(0.34,1.56,0.64,1) for settles, the theme
     curve elsewhere, 120/200/360ms; staggered reveal at 55ms offsets.
   · Only opacity/transform/colour/grid-rows animate — no reflow.
   · prefers-reduced-motion collapses every animation to its static
     state in the same change (see the floor at the end).
   · The button's press loader is the Blueprint Scan from
     LoaderUI/loader23 ("Document Processor"), adapted to the bench:
     transform-only sweep, house curve, white-on-press. The old
     spinner+wash — deleted in this same change, not layered.
   ═══════════════════════════════════════════════════════════════════ */

/* ── Icons ───────────────────────────────────────────────── */
const Ic = {
  docx: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
      <polyline points="14 2 14 8 20 8"/>
      <path d="M9 13h2l1 4 1-4h2"/>
    </svg>
  ),
  pdf: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
      <polyline points="14 2 14 8 20 8"/>
      <line x1="8" y1="13" x2="16" y2="13"/>
      <line x1="8" y1="17" x2="12" y2="17"/>
    </svg>
  ),
  pdfSm: (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
      <polyline points="14 2 14 8 20 8"/>
      <line x1="8" y1="13" x2="16" y2="13"/>
      <line x1="8" y1="17" x2="12" y2="17"/>
    </svg>
  ),
  arrow: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="5" y1="12" x2="19" y2="12"/>
      <polyline points="12 5 19 12 12 19"/>
    </svg>
  ),
  checkSm: (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="20 6 9 17 4 12"/>
    </svg>
  ),
  close: (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
      <line x1="18" y1="6" x2="6" y2="18"/>
      <line x1="6" y1="6" x2="18" y2="18"/>
    </svg>
  ),
  cancel: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <circle cx="12" cy="12" r="10"/>
      <line x1="15" y1="9" x2="9" y2="15"/>
      <line x1="9" y1="9" x2="15" y2="15"/>
    </svg>
  ),
  alert: (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
      <line x1="12" y1="9" x2="12" y2="13"/>
      <line x1="12" y1="17" x2="12.01" y2="17"/>
    </svg>
  ),
  font: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <polyline points="4 7 4 4 20 4 20 7"/>
      <line x1="9" y1="20" x2="15" y2="20"/>
      <line x1="12" y1="4" x2="12" y2="20"/>
    </svg>
  ),
  layout: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <rect x="3" y="3" width="18" height="18" rx="2"/>
      <line x1="3" y1="9" x2="21" y2="9"/>
      <line x1="9" y1="21" x2="9" y2="9"/>
    </svg>
  ),
  table: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <rect x="3" y="3" width="18" height="18" rx="2"/>
      <line x1="3" y1="9" x2="21" y2="9"/>
      <line x1="3" y1="15" x2="21" y2="15"/>
      <line x1="9" y1="3" x2="9" y2="21"/>
    </svg>
  ),
  image: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <rect x="3" y="3" width="18" height="18" rx="2"/>
      <circle cx="8.5" cy="8.5" r="1.5"/>
      <polyline points="21 15 16 10 5 21"/>
    </svg>
  ),
  eye: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
      <circle cx="12" cy="12" r="3"/>
    </svg>
  ),
  info: (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <circle cx="12" cy="12" r="10"/>
      <line x1="12" y1="8" x2="12" y2="12"/>
      <line x1="12" y1="16" x2="12.01" y2="16"/>
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
  download: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
      <polyline points="7 10 12 15 17 10"/>
      <line x1="12" y1="15" x2="12" y2="3"/>
    </svg>
  ),
  external: (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>
      <polyline points="15 3 21 3 21 9"/>
      <line x1="10" y1="14" x2="21" y2="3"/>
    </svg>
  ),
}

/* ── What survives the press — the merged manifest ──────────
   Near-bento: the two things users actually convert Word for read
   as major tiles; the other two stay compact rows. */
const SURVIVORS = [
  { key: 'typ', icon: Ic.font,  label: 'Typography & headings', major: true,
    note: 'Heading levels and weights are carried into the PDF from the document styles.' },
  { key: 'img', icon: Ic.image, label: 'Embedded images', major: true,
    note: 'Images travel through at their places in the document flow.' },
  { key: 'mar', icon: Ic.layout, label: 'Margins & page size', major: false },
  { key: 'tab', icon: Ic.table, label: 'Tables & lists', major: false },
]

/* ─────────────────────────────────────────────────────────────
    Component
   ───────────────────────────────────────────────────────────── */
type Phase = 'bed' | 'set' | 'pressing' | 'proof'

/* the honest budget denominator — the bed takes up to 50 MB */
const BED_BYTES = 50 * 1024 * 1024

export default function WordToPDF() {
  const [file, setFile]     = useState<File | null>(null)
  const [phase, setPhase]   = useState<Phase>('bed')
  const [error, setError]   = useState('')
  const [result, setResult] = useState<{ url: string; size: string } | null>(null)

  const abortControllerRef = useRef<AbortController | null>(null)
  const isMounted = useRef(true)

  const locked = phase === 'pressing'

  useEffect(() => {
    isMounted.current = true
    return () => {
      isMounted.current = false
      abortControllerRef.current?.abort()
    }
  }, [])

  // Revoke the last blob URL when it is replaced or the component unmounts.
  useEffect(() => () => { if (result) URL.revokeObjectURL(result.url) }, [result])

  /* noClick/noKeyboard: the whole zone is the drag surface, but clicks
     must reach the spine's own buttons (Replace / Remove) without
     opening the file picker. The idle bed and the Replace button call
     open() explicitly — same pattern as the sibling tools. */
  const onDrop = useCallback((accepted: File[]) => {
    const docx = accepted[0]
    if (!docx) return
    if (result) URL.revokeObjectURL(result.url)
    setResult(null)
    setError('')
    setFile(docx)
    setPhase('set')
  }, [result])

  const onDropRejected = useCallback((rejections: FileRejection[]) => {
    const code = rejections[0]?.errors?.[0]?.code
    if (code === 'file-too-large') setError('That file is over 50 MB — the bed takes up to 50 MB per document.')
    else if (code === 'file-invalid-type') setError('The press only takes .docx files.')
    else setError('That file could not be accepted.')
  }, [])

  const { getRootProps, getInputProps, isDragActive, open } = useDropzone({
    onDrop,
    onDropRejected,
    accept: { 'application/vnd.openxmlformats-officedocument.wordprocessingml.document': ['.docx'] },
    maxFiles: 1,
    maxSize: 50 * 1024 * 1024,
    noClick: true,
    noKeyboard: true,
    disabled: locked,
  })

  const triggerDownload = (url: string, name: string) => {
    const a = Object.assign(document.createElement('a'), { href: url, download: name })
    document.body.appendChild(a); a.click(); document.body.removeChild(a)
  }

  const resetToBed = () => {
    abortControllerRef.current?.abort()
    if (result) URL.revokeObjectURL(result.url)
    setResult(null)
    setFile(null)
    setError('')
    setPhase('bed')
  }

  /* ── Cancel in-flight ── */
  const cancelPress = () => {
    abortControllerRef.current?.abort()
    setPhase('set')
  }

  /* ── Press ──
     Contract unchanged from the previous implementation: FormData field
     'word' → POST /api/word-to-pdf → PDF blob (or JSON error). */
  const convertToPDF = async () => {
    if (!file || locked) return
    abortControllerRef.current?.abort()
    const controller = new AbortController()
    abortControllerRef.current = controller
    setPhase('pressing')
    setError('')
    if (result) { URL.revokeObjectURL(result.url); setResult(null) }

    const formData = new FormData()
    formData.append('word', file)

    try {
      const res = await toolRequest('/api/word-to-pdf', {
        method: 'POST', body: formData, signal: controller.signal,
      })
      if (!isMounted.current) return
      if (!res.ok) throw new Error(await getApiErrorMessage(res, 'Conversion failed'))
      const blob = await res.blob()
      if (!isMounted.current) return
      const url = URL.createObjectURL(blob)
      triggerDownload(url, outName)
      setResult({ url, size: (blob.size / 1024 / 1024).toFixed(2) })
      setPhase('proof')
    } catch (e) {
      if (!isMounted.current) return
      // toolRequest wraps any rejection (including an abort) in ApiClientError,
      // preserving the original AbortError on `cause` — a deliberate cancel must
      // not surface as a failure. (The old `name === 'AbortError'` check never
      // matched, so pressing Cancel showed a bogus "service unreachable" error.)
      if (e instanceof ApiClientError && (e.cause as { name?: string } | undefined)?.name === 'AbortError') return
      setError(e instanceof Error ? e.message : 'The press jammed. Please try again.')
      setPhase('set')
    } finally {
      if (isMounted.current) abortControllerRef.current = null
    }
  }

  const fileSizeMB = file ? (file.size / 1024 / 1024).toFixed(2) : '0'
  const outName = file ? `mycloove_${file.name.replace(/\.docx$/i, '')}.pdf` : ''
  const zoneClass = `w2p-zone${isDragActive ? ' is-over' : ''}${file && phase !== 'bed' ? ' is-collapsed' : ''}`
  const ri = (n: number) => ({ '--ri': n }) as CSSProperties

  /* Size-budget meter — the REAL fraction of the 50 MB bed. */
  const budgetPct = file ? Math.min(100, Math.round((file.size / BED_BYTES) * 100)) : 0
  const budgetTight = budgetPct >= 90

  return (
    <>
      <style>{`
        /* ── scoped to .w2p — house curves from the repo motion system ── */
        .w2p {
          --w2p-ease-out: cubic-bezier(0.16, 1, 0.3, 1);
          --w2p-ease-spring: cubic-bezier(0.34, 1.56, 0.64, 1);
          --w2p-ease-theme: cubic-bezier(0.4, 0, 0.2, 1);
          --w2p-shadow-rest: 0 8px 20px -10px rgba(0, 0, 0, 0.38);
          --w2p-shadow-lift: 0 18px 36px -14px rgba(0, 0, 0, 0.5);
          display: flex; flex-direction: column; gap: 18px;
          font-variant-numeric: tabular-nums;
        }

        @keyframes w2p-rise    { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: none; } }
        @keyframes w2p-settle  { from { transform: translateY(-3px); } to { transform: none; } }
        @keyframes w2p-draw    { to { stroke-dashoffset: 0; } }
        @keyframes w2p-flash   { from { opacity: 0.5; } to { opacity: 0; } }
        @keyframes w2p-nudge   { 0%, 100% { transform: translateX(0); opacity: 0.7; } 50% { transform: translateX(3px); opacity: 1; } }
        @keyframes w2p-grown   { from { transform: scaleX(0); } to { transform: none; } }

        /* Staggered reveal — sections enter at 55ms offsets. */
        .w2p-reveal { animation: w2p-rise 0.36s var(--w2p-ease-out) both; animation-delay: calc(var(--ri, 0) * 55ms); }

        /* ══ The zone — idle is the press bed, loaded is the spine ══ */
        .w2p-zone {
          border: 1px solid var(--border-card);
          border-radius: 16px;
          background: linear-gradient(180deg, color-mix(in srgb, var(--accent-start) 3%, var(--bg-card)), var(--bg-card) 62%);
          position: relative; overflow: hidden;
          transition: border-color 0.16s var(--w2p-ease-theme), background 0.3s var(--w2p-ease-theme);
        }
        .w2p-zone.is-over {
          border-color: color-mix(in srgb, var(--accent-start) 45%, var(--border-card));
          background: linear-gradient(180deg, color-mix(in srgb, var(--accent-start) 8%, var(--bg-card)), var(--bg-card) 68%);
        }

        /* ── Registration marks — print's own geometry. Four corner
           crop-marks in yellow that tighten inward and brighten when a
           drag is live: the file is being "registered" onto the bed.
           This replaces the dashed border AND the icon-in-circle. ── */
        .w2p-reg {
          position: absolute; width: 13px; height: 13px;
          color: color-mix(in srgb, var(--brand-yellow) 40%, var(--text-faint));
          opacity: 0.55; pointer-events: none;
          transition: transform 0.26s var(--w2p-ease-out), color 0.2s, opacity 0.2s;
        }
        .w2p-reg-tl { top: 13px;    left: 13px;  border-top: 1.5px solid currentColor;    border-left: 1.5px solid currentColor;  }
        .w2p-reg-tr { top: 13px;    right: 13px; border-top: 1.5px solid currentColor;    border-right: 1.5px solid currentColor; }
        .w2p-reg-bl { bottom: 13px; left: 13px;  border-bottom: 1.5px solid currentColor; border-left: 1.5px solid currentColor;  }
        .w2p-reg-br { bottom: 13px; right: 13px; border-bottom: 1.5px solid currentColor; border-right: 1.5px solid currentColor; }
        .w2p-zone.is-over .w2p-reg { color: var(--brand-yellow); opacity: 1; }
        .w2p-zone.is-over .w2p-reg-tl { transform: translate(5px, 5px); }
        .w2p-zone.is-over .w2p-reg-tr { transform: translate(-5px, 5px); }
        .w2p-zone.is-over .w2p-reg-bl { transform: translate(5px, -5px); }
        .w2p-zone.is-over .w2p-reg-br { transform: translate(-5px, -5px); }
        /* collapsed zone is the spine — the marks have done their job */
        .w2p-zone.is-collapsed .w2p-reg { opacity: 0; }

        /* The zone never unmounts — it collapses via grid-template-rows. */
        .w2p-shrink { display: grid; grid-template-rows: 1fr; transition: grid-template-rows 0.34s var(--w2p-ease-out); }
        .w2p-zone.is-collapsed .w2p-shrink { grid-template-rows: 0fr; }
        .w2p-shrink > .w2p-zone-body { overflow: hidden; min-height: 0; }

        .w2p-dropclick { padding: 46px 24px 38px; text-align: center; cursor: pointer; border-radius: 14px; }
        .w2p-dropclick:focus-visible { outline: 2px solid color-mix(in srgb, var(--accent-start) 55%, transparent); outline-offset: -2px; }

        /* ── The galley plate — a manuscript, not a PDF page. The margin
           rule (a proofreader's red line), a heading bar and body lines;
           deliberately a different silhouette from the Contact Sheet's
           folded PDF plate so the two benches are never interchangeable. ── */
        .w2p-plate {
          position: relative; width: 122px; height: 156px; margin: 0 auto 20px;
          background: var(--bg-card);
          border: 1px solid var(--border-card);
          border-radius: 6px;
          box-shadow: var(--w2p-shadow-rest);
          transition: transform 0.2s var(--w2p-ease-out), box-shadow 0.2s var(--w2p-ease-out), border-color 0.2s;
        }
        /* the proofreader's margin rule */
        .w2p-plate::before {
          content: ''; position: absolute; top: 10px; bottom: 10px; left: 20px; width: 1px;
          background: color-mix(in srgb, var(--brand-red) 30%, transparent);
        }
        .w2p-plate-mark {
          position: absolute; top: 9px; right: 10px;
          font: 700 7.5px/1 ui-monospace, monospace; letter-spacing: 1.5px;
          color: var(--text-faint);
        }
        .w2p-plate-head {
          position: absolute; top: 18px; left: 30px; right: 14px; height: 7px;
          border-radius: 3px;
          background: color-mix(in srgb, var(--text-faint) 65%, transparent);
        }
        .w2p-plate-lines {
          position: absolute; left: 30px; right: 14px; bottom: 14px; height: 64px;
          background: repeating-linear-gradient(180deg, transparent 0 8px, color-mix(in srgb, var(--text-faint) 45%, transparent) 8px 9px);
          opacity: 0.55;
        }
        .w2p-zone.is-over .w2p-plate {
          transform: translateY(-3px);
          border-color: color-mix(in srgb, var(--accent-start) 35%, var(--border-card));
          box-shadow: var(--w2p-shadow-lift);
        }

        .w2p-zone-title {
          font-family: 'Syne', sans-serif; font-size: 16px; font-weight: 700; letter-spacing: -0.2px;
          color: var(--text-primary); margin-bottom: 6px; transition: color 0.16s;
        }
        .w2p-zone.is-over .w2p-zone-title { color: color-mix(in srgb, var(--accent-start) 78%, var(--text-primary)); }
        .w2p-zone-sub { font-size: 12.5px; color: var(--text-muted); transition: opacity 0.16s; }
        .w2p-zone.is-over .w2p-zone-sub { opacity: 0; }

        /* industrial spec line — functional labeling, not a chip row */
        .w2p-spec { margin-top: 14px; font: 600 10px/1 ui-monospace, monospace; letter-spacing: 1.4px; color: var(--text-faint); }

        /* ── The spine — collapsed zone strip ── */
        .w2p-spine { display: flex; align-items: center; gap: 13px; padding: 12px 16px; position: relative; flex-wrap: wrap; }
        .w2p-spine-plate {
          position: relative; width: 34px; height: 42px; flex: 0 0 auto;
          background: var(--bg-item); border: 1px solid var(--border-base); border-radius: 4px;
        }
        .w2p-spine-plate::before {
          content: ''; position: absolute; top: 4px; bottom: 4px; left: 7px; width: 1px;
          background: color-mix(in srgb, var(--brand-red) 35%, transparent);
        }
        /* setting flash — replays per file because the plate is keyed by name */
        .w2p-spine-plate::after {
          content: ''; position: absolute; inset: 0; border-radius: inherit;
          background: color-mix(in srgb, var(--accent-start) 28%, transparent);
          opacity: 0; pointer-events: none;
        }
        .w2p-zone.is-collapsed .w2p-spine-plate::after { animation: w2p-flash 0.28s var(--w2p-ease-out); }
        .w2p-spine-lines {
          position: absolute; top: 5px; bottom: 5px; left: 12px; right: 4px;
          background: repeating-linear-gradient(180deg, transparent 0 5px, color-mix(in srgb, var(--text-faint) 40%, transparent) 5px 6px);
          opacity: 0.5;
        }
        .w2p-spine-name {
          font-size: 13.5px; font-weight: 600; color: var(--text-primary);
          white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
        }
        .w2p-spine-meta { font-size: 11px; color: var(--text-muted); margin-top: 2px; }

        /* ── Size-budget meter — the REAL bytes against the 50 MB bed.
           Edge-code yellow while comfortable, the proofreader's red as
           the bed fills. A transform grows it: no width animation. ── */
        .w2p-budget { display: flex; flex-direction: column; gap: 4px; margin-top: 7px; max-width: 260px; min-width: 160px; }
        .w2p-budget-track {
          height: 4px; border-radius: 2px; overflow: hidden;
          background: var(--bg-item);
          border: 1px solid var(--border-base);
        }
        .w2p-budget-fill {
          height: 100%; border-radius: inherit;
          background: color-mix(in srgb, var(--brand-yellow) 62%, var(--text-faint));
          transform-origin: left center;
          animation: w2p-grown 0.32s var(--w2p-ease-out) both;
        }
        .w2p-budget.is-tight .w2p-budget-fill { background: var(--brand-red); }
        .w2p-budget-label {
          font: 600 9.5px/1 ui-monospace, monospace; letter-spacing: 0.8px;
          color: var(--text-faint);
        }
        .w2p-budget.is-tight .w2p-budget-label { color: var(--brand-red); }

        .w2p-spine-drop {
          position: absolute; inset: 0; display: flex; align-items: center; justify-content: center;
          background: color-mix(in srgb, var(--bg-card) 72%, transparent);
          backdrop-filter: blur(3px);
          font-family: 'Syne', sans-serif; font-size: 13px; font-weight: 700;
          color: color-mix(in srgb, var(--accent-start) 78%, var(--text-primary));
          opacity: 0; pointer-events: none; transition: opacity 0.16s;
        }
        .w2p-zone.is-collapsed.is-over .w2p-spine-drop { opacity: 1; }

        /* ── Ghost buttons (spine strip, receipt) ── */
        .w2p-ghost-btn {
          display: inline-flex; align-items: center; gap: 6px; flex: 0 0 auto;
          font-family: inherit; font-size: 11.5px; font-weight: 500;
          color: var(--text-muted); padding: 6px 11px; border-radius: 8px;
          border: 1px solid var(--border-base); background: transparent; cursor: pointer;
          text-decoration: none;
          transition: color 0.14s, background 0.14s, border-color 0.14s, opacity 0.14s, transform 0.14s;
        }
        .w2p-ghost-btn:hover:not(:disabled) { color: var(--text-primary); background: var(--bg-item-hover); border-color: var(--border-card); transform: translateY(-1px); }
        .w2p-ghost-btn:disabled { opacity: 0.4; cursor: not-allowed; }
        .w2p-ghost-btn:focus-visible { outline: 2px solid color-mix(in srgb, var(--accent-start) 55%, transparent); outline-offset: 2px; }
        .w2p-ghost-btn.danger:hover:not(:disabled) {
          color: var(--brand-red); background: color-mix(in srgb, var(--brand-red) 9%, transparent);
          border-color: color-mix(in srgb, var(--brand-red) 28%, transparent);
        }

        /* ── Error banner — replaces alert(); one stable slot under the zone ── */
        .w2p-error {
          display: flex; align-items: flex-start; gap: 10px;
          padding: 12px 14px; border-radius: 10px;
          border: 1px solid color-mix(in srgb, var(--brand-red) 30%, var(--border-card));
          border-left: 3px solid var(--brand-red);
          background: color-mix(in srgb, var(--brand-red) 7%, var(--bg-card));
          color: var(--text-secondary); font-size: 12.5px; line-height: 1.5;
        }
        .w2p-error > svg { color: var(--brand-red); flex: 0 0 auto; margin-top: 1px; }
        .w2p-error-x {
          margin-left: auto; flex: 0 0 auto; display: flex; align-items: center; justify-content: center;
          width: 22px; height: 22px; border-radius: 6px; border: none; cursor: pointer;
          background: transparent; color: var(--text-muted); transition: color 0.14s, background 0.14s;
        }
        .w2p-error-x:hover { color: var(--text-primary); background: var(--bg-item); }
        .w2p-error-x:focus-visible { outline: 2px solid color-mix(in srgb, var(--brand-red) 55%, transparent); outline-offset: 1px; }

        /* ══ The press stage — the bench's centrepiece. The Draft plate
           (red margin rule, loose type lines) against the Final plate
           (yellow crop marks, gathered lines). While pressing the
           PLATEN sweeps down over the draft and the type lines "set" —
           the one signature moment, looping, indeterminate: the backend
           reports no percentage, so none is invented. ══ */
        .w2p-stage {
          position: relative;
          display: flex; align-items: center; justify-content: center; gap: 22px;
          padding: 18px 18px 16px;
          border-radius: 14px;
          background: var(--bg-card); border: 1px solid var(--border-card);
          transition: border-color 0.25s var(--w2p-ease-theme), background 0.25s var(--w2p-ease-theme);
        }
        .w2p-stage.is-pressing {
          border-color: color-mix(in srgb, var(--accent-start) 22%, var(--border-card));
          background: linear-gradient(180deg, color-mix(in srgb, var(--accent-start) 4%, var(--bg-card)), var(--bg-card) 68%);
        }
        .w2p-stage-side {
          display: flex; flex-direction: column; align-items: center; gap: 11px;
          min-width: 0; flex: 0 1 auto;
          transition: opacity 0.3s var(--w2p-ease-theme);
        }
        .w2p-bench-plate {
          position: relative; width: 132px; height: 168px; flex: 0 0 auto;
          background: var(--bg-card);
          border: 1px solid var(--border-card);
          border-radius: 6px;
          box-shadow: var(--w2p-shadow-rest);
          overflow: hidden;
          transition: transform 0.24s var(--w2p-ease-out), box-shadow 0.24s, border-color 0.24s;
        }
        .w2p-bench-plate-mark {
          position: absolute; top: 9px; right: 10px;
          font: 700 7.5px/1 ui-monospace, monospace; letter-spacing: 1.5px;
          color: var(--text-faint);
        }
        /* draft: the proofreader's margin rule + loose, varied lines */
        .w2p-bench-draft::before {
          content: ''; position: absolute; top: 12px; bottom: 12px; left: 22px; width: 1px;
          background: color-mix(in srgb, var(--brand-red) 32%, transparent);
        }
        .w2p-bench-lines {
          position: absolute; top: 30px; left: 32px; right: 14px;
          display: flex; flex-direction: column; gap: 10px;
          transform-origin: top center;
        }
        .w2p-bench-lines i { display: block; height: 4px; border-radius: 2px; background: color-mix(in srgb, var(--text-faint) 55%, transparent); }
        /* final: gathered lines + print's yellow crop marks */
        .w2p-bench-final .w2p-bench-lines { gap: 7px; }
        .w2p-bench-final .w2p-bench-lines i { height: 3.5px; background: color-mix(in srgb, var(--text-faint) 70%, transparent); }
        .w2p-crop {
          position: absolute; width: 10px; height: 10px;
          color: color-mix(in srgb, var(--brand-yellow) 55%, var(--text-faint));
          opacity: 0.8; pointer-events: none;
        }
        .w2p-crop-tl { top: 7px;    left: 7px;  border-top: 1.5px solid currentColor;    border-left: 1.5px solid currentColor;  }
        .w2p-crop-tr { top: 7px;    right: 7px; border-top: 1.5px solid currentColor;    border-right: 1.5px solid currentColor; }
        .w2p-crop-bl { bottom: 7px; left: 7px;  border-bottom: 1.5px solid currentColor; border-left: 1.5px solid currentColor;  }
        .w2p-crop-br { bottom: 7px; right: 7px; border-bottom: 1.5px solid currentColor; border-right: 1.5px solid currentColor; }

        /* the platen — print machinery sweeping the draft */
        .w2p-platen {
          position: absolute; left: -1px; right: -1px; top: 0; height: 26%;
          opacity: 0; pointer-events: none;
          background: repeating-linear-gradient(45deg, color-mix(in srgb, var(--text-faint) 34%, transparent) 0 1px, transparent 1px 5px);
          border-bottom: 2px solid color-mix(in srgb, var(--brand-yellow) 58%, var(--text-faint));
        }

        .w2p-stage-text { display: flex; flex-direction: column; align-items: center; gap: 4px; min-width: 0; max-width: 210px; }
        .w2p-stage-tag {
          font: 800 9px/1 ui-monospace, monospace; letter-spacing: 1.2px; text-transform: uppercase;
          color: var(--text-faint);
        }
        .w2p-stage-text.is-final .w2p-stage-tag { color: color-mix(in srgb, var(--accent-start) 55%, var(--text-faint)); }
        .w2p-stage-name {
          font-family: 'Syne', sans-serif; font-size: 12.5px; font-weight: 700; color: var(--text-primary);
          white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 100%;
        }

        .w2p-stage-arrow { align-self: center; color: var(--text-faint); flex: 0 0 auto; transition: color 0.2s; }

        /* pressing: the platen runs, the draft is pressed into the final */
        .w2p-stage.is-pressing .w2p-stage-side:first-child { opacity: 0.45; }
        .w2p-stage.is-pressing .w2p-platen {
          opacity: 1;
          animation: w2p-pressdown 1.15s var(--w2p-ease-theme) infinite;
        }
        .w2p-stage.is-pressing .w2p-bench-draft .w2p-bench-lines {
          animation: w2p-setset 1.15s var(--w2p-ease-theme) infinite;
        }
        .w2p-stage.is-pressing .w2p-bench-final {
          border-color: color-mix(in srgb, var(--accent-start) 45%, var(--border-card));
          box-shadow: var(--w2p-shadow-lift);
          transform: translateY(-2px);
        }
        .w2p-stage.is-pressing .w2p-stage-arrow {
          color: color-mix(in srgb, var(--accent-start) 70%, var(--text-faint));
          animation: w2p-nudge 1.1s var(--w2p-ease-theme) infinite;
        }

        @keyframes w2p-pressdown { from { transform: translateY(-120%); } to { transform: translateY(400%); } }
        @keyframes w2p-setset { 0%, 100% { transform: scaleY(1); } 45% { transform: scaleY(0.62); } }

        /* ══ What survives the press — near-bento manifest,
           ordered by real importance ══ */
        .w2p-panel {
          background: var(--bg-card); border: 1px solid var(--border-card);
          border-radius: 14px; overflow: hidden; transition: opacity 0.2s;
        }
        .w2p-panel.is-locked { opacity: 0.55; pointer-events: none; }
        .w2p-panel-head {
          display: flex; align-items: center; gap: 8px; padding: 13px 16px;
          border-bottom: 1px solid var(--border-base);
          font-family: 'Syne', sans-serif; font-size: 12.5px; font-weight: 700; color: var(--text-primary);
        }
        .w2p-panel-head svg { color: var(--text-muted); }
        .w2p-panel-body {
          padding: 13px 14px; display: grid; gap: 9px 12px;
          grid-template-columns: 1.35fr 1fr;
          grid-template-areas:
            "typ img"
            "mar tab";
        }
        .w2p-survivor { display: flex; align-items: center; gap: 9px; font-size: 11.5px; color: var(--text-muted); min-width: 0; }
        .w2p-survivor-major {
          flex-direction: column; align-items: flex-start; gap: 9px;
          padding: 12px 13px; border-radius: 10px;
          background: var(--bg-item); border: 1px solid var(--border-base);
        }
        .w2p-survivor-typ { grid-area: typ; }
        .w2p-survivor-img { grid-area: img; }
        .w2p-survivor-mar { grid-area: mar; }
        .w2p-survivor-tab { grid-area: tab; }
        .w2p-survivor-dot {
          width: 20px; height: 20px; border-radius: 6px; flex-shrink: 0;
          background: color-mix(in srgb, var(--accent-start) 12%, transparent);
          border: 1px solid color-mix(in srgb, var(--accent-start) 25%, transparent);
          display: flex; align-items: center; justify-content: center;
          color: color-mix(in srgb, var(--accent-start) 80%, var(--text-primary));
        }
        .w2p-survivor-major .w2p-survivor-dot { width: 24px; height: 24px; }
        .w2p-survivor-major .w2p-survivor-title { font-weight: 600; font-size: 12px; color: var(--text-primary); }
        .w2p-survivor-note { font-size: 10.5px; line-height: 1.5; color: var(--text-muted); }
        .w2p-survivor-text { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
        .w2p-footnote {
          grid-column: 1 / -1; display: flex; gap: 7px; align-items: flex-start;
          margin-top: 2px; padding-top: 10px;
          border-top: 1px dashed var(--border-base);
          font-size: 10.5px; color: var(--text-faint); line-height: 1.55;
        }
        .w2p-footnote svg { flex-shrink: 0; margin-top: 1px; }

        /* ══ The job ticket — sits right above the action ══ */
        .w2p-ticket {
          display: flex; flex-wrap: wrap; align-items: center; gap: 7px 18px;
          padding: 11px 16px; border-radius: 10px;
          border: 1px solid var(--border-card);
          border-left: 3px solid var(--brand-yellow);
          background: var(--bg-card);
          font-size: 11.5px; color: var(--text-muted);
          transition: opacity 0.2s;
        }
        .w2p-ticket.is-locked { opacity: 0.55; pointer-events: none; }
        .w2p-ticket-tag {
          display: inline-flex; align-items: center; gap: 5px;
          font: 800 9px/1 ui-monospace, monospace; letter-spacing: 1.2px;
          padding: 4px 8px; border-radius: 5px;
          color: color-mix(in srgb, var(--brand-yellow) 55%, var(--text-primary));
          background: color-mix(in srgb, var(--brand-yellow) 10%, transparent);
          border: 1px solid color-mix(in srgb, var(--brand-yellow) 30%, transparent);
        }
        .w2p-ticket-item { display: inline-flex; align-items: center; gap: 5px; min-width: 0; }
        .w2p-ticket-item svg { color: var(--text-faint); flex-shrink: 0; }
        .w2p-ticket-item span { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 220px; }
        .w2p-ticket-val { color: var(--text-primary); font-weight: 600; }

        /* ══ The press button ══ */
        .w2p-press {
          position: relative; overflow: hidden;
          display: flex; align-items: center; justify-content: center; gap: 9px;
          width: 100%; padding: 14px 20px; border: none; border-radius: 12px;
          background: linear-gradient(135deg, var(--accent-start) 0%, var(--accent-end) 100%);
          color: #fff; font-family: 'Syne', sans-serif; font-size: 14.5px; font-weight: 700;
          letter-spacing: -0.2px; cursor: pointer;
          box-shadow: 0 4px 24px color-mix(in srgb, var(--accent-start) 30%, transparent);
          transition: transform 0.18s var(--w2p-ease-out), box-shadow 0.18s, opacity 0.18s;
        }
        .w2p-press::before {
          content: ''; position: absolute; inset: 0; pointer-events: none;
          background: linear-gradient(135deg, rgba(255, 255, 255, 0.16), transparent 55%);
        }
        .w2p-press:hover:not(:disabled) { transform: translateY(-2px); box-shadow: 0 8px 32px color-mix(in srgb, var(--accent-start) 40%, transparent); }
        .w2p-press:active:not(:disabled) { transform: translateY(0); }
        .w2p-press:disabled { opacity: 0.75; cursor: progress; box-shadow: none; }
        .w2p-press:focus-visible { outline: 2px solid color-mix(in srgb, var(--accent-end) 70%, transparent); outline-offset: 3px; }

        /* ══ The press loader — Blueprint Scan, from LoaderUI/loader23
           ("Document Processor"), adapted to the bench: a miniature
           document plate whose scan bar sweeps down and fades — the same
           vertical rhythm as the platen signature on the stage, scaled
           down to the button. Pure CSS, transform-only sweep, honest
           indeterminate loop (no fabricated percentage). White-on-press
           reads as ink/paper on the coral body, matching the button's
           own white label rule. ══ */
        .w2p-scan {
          position: relative; width: 20px; height: 25px; flex: 0 0 auto;
          border: 1.5px solid rgba(255, 255, 255, 0.65);
          border-radius: 3px;
          background: rgba(255, 255, 255, 0.10);
          overflow: hidden;
        }
        .w2p-scan i {
          position: absolute; left: 0; right: 0; top: 0; height: 2.5px;
          border-radius: 2px;
          background: #fff;
          box-shadow: 0 1px 6px rgba(255, 255, 255, 0.85);
          transform: translateY(-4px);
          animation: w2p-sweep 1.3s var(--w2p-ease-theme) infinite;
        }
        @keyframes w2p-sweep {
          0%   { transform: translateY(-4px); opacity: 0; }
          12%  { opacity: 1; }
          88%  { opacity: 1; }
          100% { transform: translateY(27px); opacity: 0; }
        }
        .w2p-cancel {
          display: flex; align-items: center; justify-content: center; gap: 6px;
          margin: 10px auto 0; font-family: inherit; font-size: 11px; font-weight: 500;
          color: var(--text-muted); padding: 5px 11px; border-radius: 7px;
          border: 1px solid var(--border-base); background: transparent; cursor: pointer;
          transition: color 0.14s, background 0.14s, border-color 0.14s;
        }
        .w2p-cancel:hover { color: var(--brand-red); background: color-mix(in srgb, var(--brand-red) 7%, transparent); border-color: color-mix(in srgb, var(--brand-red) 18%, transparent); }
        .w2p-cancel:focus-visible { outline: 2px solid color-mix(in srgb, var(--brand-red) 55%, transparent); outline-offset: 2px; }

        /* ══ The proof table — receipt + the REAL output, live.
           The blob the press returned is mounted in a viewer next to
           the receipt: the file on screen IS the file that downloads.
           No mock, no placeholder — if a browser can't render it, the
           receipt's Open-in-new-tab / Download actions stand in. ══ */
        .w2p-proof {
          display: grid; gap: 12px; align-items: stretch;
          grid-template-columns: minmax(0, 1.55fr) minmax(280px, 1fr);
        }
        .w2p-preview {
          display: flex; flex-direction: column;
          border: 1px solid var(--border-card);
          border-left: 3px solid var(--brand-yellow);
          border-radius: 14px; overflow: hidden;
          background: var(--bg-card);
          order: 0;
        }
        .w2p-preview-head {
          display: flex; align-items: center; gap: 8px; flex: 0 0 auto;
          padding: 10px 14px; border-bottom: 1px solid var(--border-base);
          font-family: 'Syne', sans-serif; font-size: 12px; font-weight: 700; color: var(--text-primary);
        }
        .w2p-preview-head svg { color: var(--text-muted); }
        .w2p-preview-tag {
          margin-left: auto;
          font: 800 8.5px/1 ui-monospace, monospace; letter-spacing: 1.2px;
          padding: 4px 8px; border-radius: 5px;
          color: color-mix(in srgb, var(--brand-yellow) 55%, var(--text-primary));
          background: color-mix(in srgb, var(--brand-yellow) 10%, transparent);
          border: 1px solid color-mix(in srgb, var(--brand-yellow) 30%, transparent);
        }
        .w2p-preview-frame {
          display: block; width: 100%; height: 420px; flex: 0 0 auto;
          border: 0; background: var(--bg-card);
        }
        .w2p-preview-note {
          display: flex; align-items: flex-start; gap: 7px; flex: 0 0 auto;
          padding: 8px 14px; border-top: 1px dashed var(--border-base);
          font-size: 10.5px; color: var(--text-faint); line-height: 1.5;
        }
        .w2p-preview-note svg { flex-shrink: 0; margin-top: 1px; }

        /* ── The proof — the receipt ── */
        .w2p-receipt {
          display: flex; flex-direction: column; gap: 13px;
          padding: 16px; border-radius: 14px;
          border: 1px solid var(--border-card);
          border-left: 3px solid var(--brand-yellow);
          background: var(--bg-card);
          order: 1;
        }
        .w2p-receipt-top { display: flex; align-items: center; gap: 13px; min-width: 0; }
        .w2p-receipt-seal {
          width: 40px; height: 40px; flex: 0 0 auto; border-radius: 12px;
          display: flex; align-items: center; justify-content: center;
          background: linear-gradient(135deg, var(--accent-start), var(--accent-end));
          color: #fff;
          animation: w2p-settle 0.3s var(--w2p-ease-spring);
        }
        .w2p-receipt-seal svg path {
          stroke-dasharray: 28; stroke-dashoffset: 28;
          animation: w2p-draw 0.32s 0.08s var(--w2p-ease-out) forwards;
        }
        .w2p-receipt-title {
          font-family: 'Syne', sans-serif; font-size: 14px; font-weight: 700;
          color: var(--text-primary); margin-bottom: 3px;
        }
        .w2p-receipt-meta {
          font: 500 11px/1.5 ui-monospace, monospace;
          color: var(--text-muted); word-break: break-all;
        }
        .w2p-receipt-lines {
          padding-top: 10px; border-top: 1px dashed var(--border-base);
          display: flex; flex-direction: column; gap: 7px;
          font-size: 11px; color: var(--text-muted);
        }
        .w2p-receipt-line { display: flex; align-items: center; gap: 7px; min-width: 0; }
        .w2p-receipt-line svg { color: var(--text-faint); flex-shrink: 0; }
        .w2p-receipt-line span { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .w2p-receipt-line b { color: var(--text-primary); font-weight: 600; }
        .w2p-receipt-actions {
          margin-top: auto; display: flex; flex-direction: column; gap: 8px;
        }
        .w2p-receipt-actions .w2p-solid-btn,
        .w2p-receipt-actions .w2p-ghost-btn { justify-content: center; width: 100%; }
        .w2p-receipt-fallback { font-size: 10.5px; color: var(--text-faint); line-height: 1.5; text-align: center; }

        .w2p-solid-btn {
          display: inline-flex; align-items: center; gap: 7px;
          padding: 9px 14px; border-radius: 9px; border: none; cursor: pointer;
          background: linear-gradient(135deg, var(--accent-start), var(--accent-end));
          color: #fff; font-family: 'Syne', sans-serif; font-size: 12px; font-weight: 700;
          text-decoration: none; text-align: center;
          box-shadow: 0 3px 14px color-mix(in srgb, var(--accent-start) 28%, transparent);
          transition: transform 0.16s var(--w2p-ease-out), box-shadow 0.16s;
        }
        .w2p-solid-btn:hover { transform: translateY(-1px); box-shadow: 0 6px 20px color-mix(in srgb, var(--accent-start) 36%, transparent); }
        .w2p-solid-btn:focus-visible { outline: 2px solid color-mix(in srgb, var(--accent-end) 70%, transparent); outline-offset: 2px; }

        /* ── Responsive: the stage stacks, the arrow turns ── */
        @media (max-width: 680px) {
          .w2p-stage { flex-direction: column; gap: 15px; }
          .w2p-stage-arrow { order: 2; }
          .w2p-stage-arrow svg { transform: rotate(90deg); }
          .w2p-stage-side:last-child { order: 3; }
          .w2p-bench-plate { width: 108px; height: 138px; }
          .w2p-bench-lines { top: 26px; left: 28px; right: 12px; gap: 8px; }
        }
        @media (max-width: 860px) {
          .w2p-proof { grid-template-columns: 1fr; }
          .w2p-proof .w2p-preview { order: 2; }
          .w2p-proof .w2p-receipt { order: 0; }
          .w2p-preview-frame { height: 320px; }
        }
        @media (max-width: 480px) {
          .w2p-panel-body {
            grid-template-columns: 1fr;
            grid-template-areas: "typ" "img" "mar" "tab";
          }
        }

        /* ── Motion floor: reduced motion collapses everything to states ── */
        @media (prefers-reduced-motion: reduce) {
          .w2p, .w2p *, .w2p *::before, .w2p *::after {
            animation-duration: 0.01ms !important;
            animation-delay: 0ms !important;
            animation-iteration-count: 1 !important;
            transition-duration: 0.01ms !important;
          }
        }
      `}</style>

      <div className="w2p">

        {/* ── The zone: press bed → spine ── */}
        <div {...getRootProps({ className: zoneClass })}>
          <input {...getInputProps()} />

          <i className="w2p-reg w2p-reg-tl" aria-hidden="true" />
          <i className="w2p-reg w2p-reg-tr" aria-hidden="true" />
          <i className="w2p-reg w2p-reg-bl" aria-hidden="true" />
          <i className="w2p-reg w2p-reg-br" aria-hidden="true" />

          <div className="w2p-shrink">
            <div className="w2p-zone-body">
              <div
                className="w2p-dropclick"
                role="button"
                tabIndex={0}
                aria-label="Choose a Word document"
                onClick={open}
                onKeyDown={e => {
                  if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open() }
                }}
              >
                <div className="w2p-plate" aria-hidden="true">
                  <span className="w2p-plate-mark">DOCX</span>
                  <div className="w2p-plate-head" />
                  <div className="w2p-plate-lines" />
                </div>

                <p className="w2p-zone-title">
                  {isDragActive ? 'Release to set.' : 'Drop your draft. Take back the final.'}
                </p>
                <p className="w2p-zone-sub">
                  or click to browse — .docx only, one document per pressing
                </p>
                <p className="w2p-spec">DOCX · MAX 50 MB · PDF OUT</p>
              </div>
            </div>
          </div>

          {file && phase !== 'bed' && (
            <div className="w2p-spine w2p-reveal" style={ri(0)}>
              <div className="w2p-spine-plate" key={`${file.name}-${file.size}`} aria-hidden="true">
                <i className="w2p-spine-lines" />
              </div>
              <div style={{ minWidth: 0, flex: '1 1 150px' }}>
                <p className="w2p-spine-name">{file.name}</p>
                <p className="w2p-spine-meta">{fileSizeMB} MB · Word Document</p>
                {/* the REAL bytes against the 50 MB bed — no invented numbers */}
                <div className={`w2p-budget${budgetTight ? ' is-tight' : ''}`} aria-hidden="true">
                  <div className="w2p-budget-track">
                    <div className="w2p-budget-fill" style={{ width: `${budgetPct}%` }} />
                  </div>
                  <span className="w2p-budget-label">{budgetPct}% OF THE 50 MB BED</span>
                </div>
              </div>
              <button type="button" className="w2p-ghost-btn" onClick={open} disabled={locked}>
                {Ic.swap} Replace
              </button>
              <button type="button" className="w2p-ghost-btn danger" onClick={resetToBed} disabled={locked}>
                {Ic.close} Remove
              </button>
              <div className="w2p-spine-drop" aria-hidden="true">Release to replace</div>
            </div>
          )}
        </div>

        {/* ── Error banner — the single error slot, never alert() ── */}
        {error && (
          <div className="w2p-error" role="alert">
            {Ic.alert}
            <span>{error}</span>
            <button type="button" className="w2p-error-x" onClick={() => setError('')} aria-label="Dismiss error">
              {Ic.close}
            </button>
          </div>
        )}

        {/* ── The press stage + manifest + ticket + action ── */}
        {file && phase !== 'proof' && (
          <>
            <div className={`w2p-stage w2p-reveal${locked ? ' is-pressing' : ''}`} style={ri(1)}>
              <div className="w2p-stage-side">
                <div className="w2p-bench-plate w2p-bench-draft" aria-hidden="true">
                  <span className="w2p-bench-plate-mark">DOCX</span>
                  <div className="w2p-bench-lines">
                    <i style={{ width: '86%' }} />
                    <i style={{ width: '100%' }} />
                    <i style={{ width: '72%' }} />
                    <i style={{ width: '91%' }} />
                  </div>
                  <span className="w2p-platen" />
                </div>
                <div className="w2p-stage-text">
                  <span className="w2p-stage-tag">{locked ? 'Being pressed · Draft' : 'Draft · Live'}</span>
                  <span className="w2p-stage-name">{file.name}</span>
                </div>
              </div>

              <span className="w2p-stage-arrow" aria-hidden="true">{Ic.arrow}</span>

              <div className="w2p-stage-side">
                <div className="w2p-bench-plate w2p-bench-final" aria-hidden="true">
                  <span className="w2p-crop w2p-crop-tl" />
                  <span className="w2p-crop w2p-crop-tr" />
                  <span className="w2p-crop w2p-crop-bl" />
                  <span className="w2p-crop w2p-crop-br" />
                  <span className="w2p-bench-plate-mark">PDF</span>
                  <div className="w2p-bench-lines">
                    <i /><i /><i /><i /><i />
                  </div>
                </div>
                <div className="w2p-stage-text is-final">
                  <span className="w2p-stage-tag">Final · Fixed</span>
                  <span className="w2p-stage-name">{outName}</span>
                </div>
              </div>
            </div>

            <div className={`w2p-panel w2p-reveal${locked ? ' is-locked' : ''}`} style={ri(2)}>
              <div className="w2p-panel-head">
                {Ic.checkSm} What survives the press
              </div>
              <div className="w2p-panel-body">
                {SURVIVORS.map(s => (
                  <div key={s.key} className={`w2p-survivor w2p-survivor-${s.key}${s.major ? ' w2p-survivor-major' : ''}`}>
                    <div className="w2p-survivor-dot">{Ic.checkSm}</div>
                    <div className="w2p-survivor-text">
                      <span className="w2p-survivor-title">{s.label}</span>
                      {'note' in s && s.note && <span className="w2p-survivor-note">{s.note}</span>}
                    </div>
                  </div>
                ))}
                <p className="w2p-footnote">
                  {Ic.info}
                  <span>
                    The press reproduces standard Word styles most faithfully — custom
                    fonts and dense layouts may shift slightly in the final.
                  </span>
                </p>
              </div>
            </div>

            <div className={`w2p-ticket w2p-reveal${locked ? ' is-locked' : ''}`} style={ri(3)}>
              <span className="w2p-ticket-tag">{locked ? 'PRESSING' : 'READY'}</span>
              <span className="w2p-ticket-item">
                {Ic.docx}
                <span>Source: <span className="w2p-ticket-val">{file.name}</span></span>
              </span>
              <span className="w2p-ticket-item">
                {Ic.pdf}
                <span>Output: <span className="w2p-ticket-val">{outName}</span></span>
              </span>
              <span className="w2p-ticket-item">
                {Ic.download}
                <span>Delivery: <span className="w2p-ticket-val">Auto-download</span></span>
              </span>
            </div>

            <div className="w2p-reveal" style={ri(4)}>
              <button
                className={`w2p-press${locked ? ' is-pressing' : ''}`}
                onClick={convertToPDF}
                disabled={locked}
              >
                {locked ? (
                  <>
                    <span className="w2p-scan" aria-hidden="true"><i /></span>
                    Pressing…
                  </>
                ) : <>{Ic.pdfSm} Convert to PDF</>}
              </button>
              {locked && (
                <button type="button" className="w2p-cancel" onClick={cancelPress}>
                  {Ic.cancel} Cancel
                </button>
              )}
            </div>
          </>
        )}

        {/* ── The proof table — the REAL output, live, beside the receipt ── */}
        {phase === 'proof' && result && (
          <div className="w2p-proof">
            <div className="w2p-preview w2p-reveal" style={ri(0)} role="region" aria-label="Live preview of the converted PDF">
              <div className="w2p-preview-head">
                {Ic.eye}
                <span>Live preview</span>
                <span className="w2p-preview-tag">REAL OUTPUT</span>
              </div>
              <iframe
                key={result.url}
                className="w2p-preview-frame"
                src={result.url}
                title={`Preview of ${outName}`}
              />
              <p className="w2p-preview-note">
                {Ic.info}
                <span>
                  What you see is the file the press returned — nothing staged.
                  If this browser can&apos;t render the preview, use Open in new tab or Download.
                </span>
              </p>
            </div>

            <div className="w2p-receipt w2p-reveal" style={ri(1)} role="status">
              <div className="w2p-receipt-top">
                <div className="w2p-receipt-seal" aria-hidden="true">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M20 6 9 17l-5-5"/>
                  </svg>
                </div>
                <div style={{ minWidth: 0 }}>
                  <p className="w2p-receipt-title">The proof is ready</p>
                  <p className="w2p-receipt-meta">{outName} · {result.size} MB</p>
                </div>
              </div>
              <div className="w2p-receipt-lines">
                <span className="w2p-receipt-line">
                  {Ic.docx}
                  <span>From <b>{file?.name}</b></span>
                </span>
                <span className="w2p-receipt-line">
                  {Ic.download}
                  <span>Delivered: <b>auto-download</b> on press</span>
                </span>
              </div>
              <div className="w2p-receipt-actions">
                <a className="w2p-solid-btn" href={result.url} target="_blank" rel="noreferrer">
                  {Ic.external} Open in new tab
                </a>
                <button type="button" className="w2p-solid-btn" onClick={() => triggerDownload(result.url, outName)}>
                  {Ic.download} Download again
                </button>
                <button type="button" className="w2p-ghost-btn" onClick={resetToBed}>
                  {Ic.swap} Convert another
                </button>
                <p className="w2p-receipt-fallback">
                  Can&apos;t see the preview? The file itself is untouched — open it in a new tab.
                </p>
              </div>
            </div>
          </div>
        )}

      </div>
    </>
  )
}
