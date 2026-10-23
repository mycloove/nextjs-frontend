'use client'

import { useCallback, useState } from 'react'
import { toolRequest, getApiErrorMessage } from '@/lib/api/client'
import { downloadBlob } from '@/lib/download/downloadOutputs'
import { addRecentConversion } from '@/lib/history/recentConversions'
import KineticSphereLoader from './KineticSphereLoader'

/**
 * Bijoy → Unicode converter — "The Rosetta desk".
 *
 * Instrument concept: a decipherment desk. Legacy Bijoy text is the *same
 * Bangla* written in a dead, non-Unicode glyph encoding — on every modern
 * device it reads as garbage ("Avwg evsjv"). This tool lays the ciphered
 * stream (monospace, vowel-starved Latin) beside the living script and lets
 * the words cross over. The one signature moment is that crossing itself: on a
 * completed decode the output resolves in behind a single gold sweep, and the
 * seam between the two desks springs. Everything else stays quiet.
 *
 * Category default rejected: "two textareas + a gradient button + copy row".
 * The two-pane comparison is kept because it is the tool's real workflow, but
 * the identity is carried by type and the cipher→script seam, not decoration.
 *
 * A pure text tool: no upload, no file I/O. The engine is the server's pinned
 * `bijoy2unicode` (see pdf-microservice/features/bijoy_text.py); the browser's
 * whole job is paste, decode, compare, copy back.
 *
 * Bilingual by design (EN + বাংলা) — the tool's primary audience reads Bangla,
 * so the interface itself speaks it. Everything is scoped via `b2u-` and
 * consumes only surface-1 global tokens plus local `--b2u-*` pairs
 * (CLAUDE.md §0.2): no shared CSS, no sibling pattern assumed.
 */

type Phase = 'edit' | 'converting' | 'done'
type Lang = 'en' | 'bn'

const COPY = {
  en: {
    titleA: 'Bijoy',
    titleB: 'Unicode',
    purpose: 'Decipher legacy Bijoy text into clean, searchable Unicode Bangla.',
    srcTag: 'Legacy · Bijoy',
    srcLabel: 'Bijoy text',
    srcHint: 'Paste Bijoy (ASCII) Bangla — old DTP files, re-typed pages, or copied text.',
    outTag: 'Unicode · বাংলা',
    outLabel: 'Unicode Bangla',
    outHint: 'Clean, searchable, web-ready Bangla appears here.',
    decode: 'Decode',
    decoding: 'Decoding…',
    clear: 'Clear',
    copy: 'Copy result',
    copied: 'Copied',
    download: 'Download .txt',
    swap: 'Reuse as input',
    sample: 'Sample',
    decoded: 'Decoded',
    unchanged: 'No Bijoy patterns found — text returned unchanged.',
    error: 'Conversion failed',
    chars: 'chars',
    privacy: 'Text is sent to the server for conversion. Recent activity metadata is saved in this browser.',
    copyFail: 'Clipboard unavailable — select the output text and copy it manually.',
    limitWarn: 'Too many characters to decode — the limit is',
  },
  bn: {
    titleA: 'বিজয়',
    titleB: 'ইউনিকোড',
    purpose: 'পুরনো বিজয় লেখা → পরিচ্ছন্ন, খোঁজার-যোগ্য ইউনিকোড বাংলা।',
    srcTag: 'পুরনো · বিজয়',
    srcLabel: 'বিজয় টেক্সট',
    srcHint: 'পুরনো বিজয় (ASCII) বাংলা পেস্ট করুন — ডিটিপি ফাইল, পুরনো লেখা বা কপি করা টেক্সট।',
    outTag: 'ইউনিকোড · বাংলা',
    outLabel: 'ইউনিকোড বাংলা',
    outHint: 'পরিষ্কার, সার্চযোগ্য, ওয়েব-প্রস্তুত বাংলা এখানে আসবে।',
    decode: 'রূপান্তর করুন',
    decoding: 'রূপান্তর চলছে…',
    clear: 'মুছুন',
    copy: 'ফলাফল কপি',
    copied: 'কপি হয়েছে',
    download: '.txt ডাউনলোড',
    swap: 'আবার ইনপুট হিসেবে',
    sample: 'নমুনা',
    decoded: 'রূপান্তরিত',
    unchanged: 'বিজয় প্যাটার্ন পাওয়া যায়নি — টেক্সট অপরিবর্তিত।',
    error: 'রূপান্তর ব্যর্থ',
    chars: 'অক্ষর',
    privacy: 'রূপান্তরের জন্য লেখা সার্ভারে পাঠানো হয়। সাম্প্রতিক কাজের তথ্য এই ব্রাউজারে সংরক্ষিত থাকে।',
    copyFail: 'ক্লিপবোর্ড ব্যবহার করা যায়নি — আউটপুট টেক্সট সিলেক্ট করে ম্যানুয়ালি কপি করুন।',
    limitWarn: 'রূপান্তরের জন্য অক্ষর সংখ্যা বেশি — সীমা',
  },
} as const

/* Inline SVG icons — no external deps, same approach as sibling modules. */
const Icon = {
  arrow: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <line x1="4" y1="12" x2="18" y2="12" /><polyline points="12 6 18 12 12 18" />
    </svg>
  ),
  swap: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polyline points="17 1 21 5 17 9" /><path d="M3 11V9a4 4 0 0 1 4-4h14" />
      <polyline points="7 23 3 19 7 15" /><path d="M21 13v2a4 4 0 0 1-4 4H3" />
    </svg>
  ),
  copy: (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="9" y="9" width="13" height="13" rx="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </svg>
  ),
  check: (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  ),
  download: (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" />
    </svg>
  ),
  alert: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
      <line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" />
    </svg>
  ),
  info: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="10" /><line x1="12" y1="16" x2="12" y2="12" /><line x1="12" y1="8" x2="12.01" y2="8" />
    </svg>
  ),
  lock: (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3" y="11" width="18" height="11" rx="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" />
    </svg>
  ),
}

/* Real Bijoy-encoded Bangla (ASCII + the encoding's e-kar glyph) that decodes
   cleanly, so the sample shows the tool at its best:
   "আমি বাংলায় কথা বলি / বাংলাদেশ আমার দেশ" */
const SAMPLE_BIJOY = 'Avwg evsjvq K_v ewj\nevsjv‡`k Avgvi †`k'

/* Mirrors the server cap (app/api/bijoy-convert/route.ts + features/bijoy_text.py,
   400k chars). Guarded here so an over-limit paste is refused instantly instead of
   making a doomed round-trip. */
const MAX_TEXT_CHARS = 400_000

export default function BijoyConverterTool() {
  const [lang, setLang] = useState<Lang>('en')
  const t = COPY[lang]

  const [source, setSource] = useState('')
  const [output, setOutput] = useState('')
  const [detected, setDetected] = useState<boolean | null>(null)
  const [phase, setPhase] = useState<Phase>('edit')
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [copyFailed, setCopyFailed] = useState(false)

  const hasSource = source.trim().length > 0
  const hasOutput = output.length > 0
  const charCount = source.length
  const outCount = output.length
  const overLimit = charCount > MAX_TEXT_CHARS

  /* True for the beat after a completed decode — drives the one signature
     moment (the output resolves in behind a single sweep, the seam springs).
     It falls back to false during the next conversion, so the animations
     restart cleanly on every decode without a manual reset. */
  const isFresh = phase === 'done' && !error

  const convert = useCallback(async () => {
    if (!hasSource || phase === 'converting' || overLimit) return
    setPhase('converting')
    setError(null)
    setCopyFailed(false)
    try {
      const res = await toolRequest('/api/bijoy-convert', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: source }),
      })
      if (!res.ok) throw new Error(await getApiErrorMessage(res, t.error))
      const body = (await res.json()) as { text: string; detected_bijoy: boolean }
      setOutput(body.text)
      setDetected(body.detected_bijoy)
      setPhase('done')
      addRecentConversion({
        toolId: 'bijoy-converter',
        label: lang === 'bn' ? 'বিজয় → ইউনিকোড' : 'Bijoy to Unicode',
        filename: 'bijoy-to-unicode.txt',
        sizeBytes: new Blob([body.text]).size,
      })
    } catch (e) {
      setError(e instanceof Error ? e.message : t.error)
      setPhase('edit')
    }
  }, [hasSource, phase, source, t.error, lang, overLimit])

  const copyResult = useCallback(async () => {
    if (!hasOutput) return
    try {
      await navigator.clipboard.writeText(output)
      setCopied(true)
      setCopyFailed(false)
      setTimeout(() => setCopied(false), 1600)
    } catch {
      // Clipboard unavailable (permissions / insecure context): say so instead
      // of leaving the button looking broken; the textarea stays selectable.
      setCopyFailed(true)
    }
  }, [hasOutput, output])

  const swapIntoInput = useCallback(() => {
    if (!hasOutput) return
    setSource(output)
    setOutput('')
    setDetected(null)
    setPhase('edit')
    setCopyFailed(false)
  }, [hasOutput, output])

  const downloadTxt = useCallback(() => {
    if (!hasOutput) return
    downloadBlob(new Blob([output], { type: 'text/plain;charset=utf-8' }), 'mycloove_bijoy-to-unicode.txt')
  }, [hasOutput, output])

  const loadSample = useCallback(() => {
    setSource(SAMPLE_BIJOY)
    setOutput('')
    setDetected(null)
    setPhase('edit')
    setError(null)
    setCopyFailed(false)
  }, [])

  const clearAll = useCallback(() => {
    setSource('')
    setOutput('')
    setDetected(null)
    setPhase('edit')
    setError(null)
    setCopied(false)
    setCopyFailed(false)
  }, [])

  return (
    <>
      <style>{`
        /* ── Local palette (both themes) — a single "old-ink gold" accent ──
           Gold is the tool's one signal (action + identity): it is the colour of
           restored, precious text and it is not owned by any other surface.
           Everything else is the neutral ramp; the legacy desk is deliberately
           colourless so the accent reads as "decoded". */
        .b2u {
          --b2u-accent:        #e6b64c;
          --b2u-accent-bright: #f2c96b;
          --b2u-on-accent:     #241a04;
          --b2u-accent-soft:   rgba(230, 182, 76, 0.12);
          --b2u-accent-line:   rgba(230, 182, 76, 0.40);
          --b2u-accent-glow:   rgba(230, 182, 76, 0.30);
          --b2u-danger-text:   #ff8d84;
          --b2u-danger-bg:     rgba(255, 90, 80, 0.08);
          --b2u-danger-line:   rgba(255, 90, 80, 0.24);
          --b2u-r-sm: 8px; --b2u-r: 12px; --b2u-r-lg: 16px;
          --b2u-ease:   cubic-bezier(0.16, 1, 0.3, 1);
          --b2u-spring: cubic-bezier(0.34, 1.56, 0.64, 1);
          display: flex; flex-direction: column; gap: 16px;
        }
        [data-theme='light'] .b2u {
          /* A cleaner, saturated amber than the previous olive-gold: the light
             fill has to be dark enough for white label text (5.0:1) while still
             reading as crafted brass, not mud. One warm identity, held. */
          --b2u-accent:        #b45309;
          --b2u-accent-bright: #9a3d06;
          --b2u-on-accent:     #fff8ef;
          --b2u-accent-soft:   rgba(180, 83, 9, 0.10);
          --b2u-accent-line:   rgba(180, 83, 9, 0.34);
          --b2u-accent-glow:   rgba(180, 83, 9, 0.26);
          --b2u-danger-text:   #b3261e;
          --b2u-danger-bg:     rgba(179, 38, 30, 0.06);
          --b2u-danger-line:   rgba(179, 38, 30, 0.20);
        }
        .b2u :focus-visible {
          outline: 2px solid var(--b2u-accent);
          outline-offset: 2px;
          border-radius: 6px;
        }

        /* ── Header: the retired ToolWorkspace chrome, rebuilt as this tool's
           own instrument lockup — a "অ" tile, the cipher→script title, purpose,
           and the bilingual switch. ── */
        .b2u-head {
          display: flex; align-items: center; gap: 14px; flex-wrap: wrap;
          padding-bottom: 16px; border-bottom: 1px solid var(--border-base);
        }
        .b2u-mark {
          flex: 0 0 auto; width: 46px; height: 46px; border-radius: var(--b2u-r);
          display: grid; place-items: center;
          background: var(--b2u-accent-soft);
          border: 1px solid var(--b2u-accent-line);
          color: var(--b2u-accent);
          font-family: 'Syne', sans-serif; font-weight: 700; font-size: 24px; line-height: 1;
        }
        .b2u-headmain { display: flex; flex-direction: column; gap: 3px; min-width: 220px; flex: 1; }
        .b2u-title {
          display: flex; align-items: center; gap: 9px; margin: 0;
          font-family: 'Syne', sans-serif; font-size: 21px; font-weight: 700;
          letter-spacing: -0.2px; color: var(--text-primary);
        }
        .b2u-title .b2u-arc { display: inline-flex; color: var(--b2u-accent); }
        .b2u-purpose { margin: 0; font-size: 12.5px; line-height: 1.5; color: var(--text-muted); }
        .b2u-lang {
          flex: 0 0 auto; display: inline-flex;
          border: 1px solid var(--border-base); border-radius: 9px; overflow: hidden;
        }
        .b2u-lang button {
          font-family: inherit; font-size: 12px; font-weight: 600;
          padding: 7px 14px; border: none; cursor: pointer;
          background: transparent; color: var(--text-muted);
          transition: background 0.18s var(--b2u-ease), color 0.18s var(--b2u-ease);
        }
        .b2u-lang button.on { background: var(--b2u-accent-soft); color: var(--b2u-accent); }

        /* ── Stage: the two desks and the seam between them ── */
        .b2u-stage { position: relative; display: grid; grid-template-columns: 1fr 44px 1fr; align-items: stretch; }
        @media (max-width: 840px) { .b2u-stage { grid-template-columns: 1fr; } }

        /* Decode overlay — the loader-6 kinetic sphere over a dimmed stage while
           the request is in flight. Indeterminate on purpose: no invented %. */
        .b2u-busy {
          position: absolute; inset: 0; z-index: 5;
          display: grid; grid-template-columns: 1fr; place-content: center; place-items: center; gap: 12px;
          border-radius: var(--b2u-r);
          background: color-mix(in srgb, var(--bg-page) 74%, transparent);
          backdrop-filter: blur(3px);
          animation: b2u-fade 220ms var(--b2u-ease) both;
        }
        @keyframes b2u-fade { from { opacity: 0; } to { opacity: 1; } }
        .b2u-busy-label {
          font-family: 'Syne', sans-serif; font-size: 12px; font-weight: 700;
          letter-spacing: 0.14em; text-transform: uppercase; color: var(--text-secondary);
        }

        .b2u-desk {
          display: flex; flex-direction: column; min-height: 340px;
          background: var(--bg-card);
          border: 1px solid var(--border-base);
          border-radius: var(--b2u-r);
          overflow: hidden;
        }
        .b2u-desk-head {
          display: flex; align-items: center; gap: 9px;
          padding: 12px 15px; border-bottom: 1px solid var(--border-base);
        }
        .b2u-tag {
          font-family: 'Syne', sans-serif; font-size: 11px; font-weight: 700;
          letter-spacing: 1.1px; text-transform: uppercase;
        }
        .b2u-desk.is-src .b2u-tag { color: var(--text-secondary); }
        .b2u-desk.is-out .b2u-tag { color: var(--b2u-accent); }
        .b2u-desk-count {
          margin-left: auto;
          font-family: ui-monospace, 'Cascadia Code', monospace;
          font-variant-numeric: tabular-nums;
          font-size: 10.5px; letter-spacing: 0.3px; color: var(--text-faint);
        }
        .b2u-desk textarea {
          flex: 1 1 auto; width: 100%; min-height: 260px; resize: vertical;
          border: none; outline: none; background: transparent;
          padding: 15px; color: var(--text-primary);
        }
        /* Legacy desk: the ciphered stream — monospace, and a faint lattice that
           says "encoded" without spending a second colour. */
        .b2u-desk.is-src textarea {
          font-family: ui-monospace, 'Cascadia Code', 'Consolas', monospace;
          font-size: 13.5px; line-height: 1.8; letter-spacing: 0.2px;
          background-image: radial-gradient(rgba(128, 128, 128, 0.10) 1px, transparent 1px);
          background-size: 18px 18px; background-position: 16px 16px;
        }
        .b2u-desk.is-src textarea::placeholder { color: var(--text-faint); }
        /* Script desk: the living reading register. Bengali renders in the OS
           face (the app loads no Bengali webfont — design-system §3). */
        .b2u-desk.is-out textarea {
          font-size: 15.5px; line-height: 1.95;
          font-family: 'Noto Sans Bengali', 'Nirmala UI', 'Vrinda', system-ui, sans-serif;
        }
        .b2u-desk.is-out textarea::placeholder { color: var(--text-faint); }

        /* Seam — the translation axis. Vertical on wide, horizontal stacked. */
        .b2u-seam { display: grid; place-items: center; position: relative; }
        .b2u-seam::before {
          content: ''; position: absolute; top: 12px; bottom: 12px; left: 50%;
          width: 1px; background: var(--border-base);
        }
        .b2u-seam-node {
          position: relative; z-index: 1; width: 30px; height: 30px; border-radius: 50%;
          display: grid; place-items: center;
          background: var(--bg-page);
          border: 1px solid var(--b2u-accent-line);
          color: var(--b2u-accent);
        }
        @media (max-width: 840px) {
          .b2u-seam { height: 36px; }
          .b2u-seam::before { top: 50%; bottom: auto; left: 12px; right: 12px; width: auto; height: 1px; }
          .b2u-seam-node svg { transform: rotate(90deg); }
        }

        /* Signature moment: the decipher reveal. */
        .b2u-desk.is-out { position: relative; }
        .b2u-scan { position: absolute; inset: 0; overflow: hidden; pointer-events: none; border-radius: inherit; }
        .b2u-scan::after {
          content: ''; position: absolute; top: 0; bottom: 0; width: 44%;
          background: linear-gradient(90deg, transparent, var(--b2u-accent-glow), transparent);
          transform: translateX(-130%);
          animation: b2u-sweep 720ms var(--b2u-ease) 1 both;
        }
        @keyframes b2u-sweep { from { transform: translateX(-130%); } to { transform: translateX(240%); } }
        .b2u-desk.is-out.is-fresh textarea { animation: b2u-resolve 560ms var(--b2u-ease) both; }
        @keyframes b2u-resolve { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: none; } }
        .b2u-seam-node.is-fresh { animation: b2u-node 520ms var(--b2u-spring) both; }
        @keyframes b2u-node { from { transform: scale(0.82); opacity: 0.4; } to { transform: scale(1); opacity: 1; } }

        /* ── Actions ── */
        .b2u-actions { display: flex; gap: 10px; flex-wrap: wrap; align-items: center; }
        .b2u-decode {
          display: inline-flex; align-items: center; gap: 9px;
          font-family: 'Syne', sans-serif; font-size: 13.5px; font-weight: 700;
          color: var(--b2u-on-accent); background: var(--b2u-accent);
          border: none; border-radius: 10px; padding: 12px 22px; cursor: pointer;
          transition: transform 0.18s var(--b2u-ease), box-shadow 0.18s var(--b2u-ease),
                      background 0.18s var(--b2u-ease), opacity 0.15s;
        }
        .b2u-decode:hover:not(:disabled) {
          transform: translateY(-1px); background: var(--b2u-accent-bright);
          box-shadow: 0 8px 22px -8px var(--b2u-accent-glow), 0 2px 6px rgba(0, 0, 0, 0.12);
        }
        .b2u-decode:active { transform: translateY(0); }
        .b2u-decode:disabled { opacity: 0.45; cursor: not-allowed; }
        /* While it is the live busy state the button must NOT read as "disabled":
           keep it fully opaque so the loader stays clearly visible. */
        .b2u-decode.is-busy:disabled { opacity: 1; cursor: progress; }
        /* Light mode: a faint top highlight + soft resting shadow turns the flat
           amber fill into a crafted brass button with real presence. */
        [data-theme='light'] .b2u-decode {
          box-shadow: 0 1px 2px rgba(96, 48, 4, 0.22), inset 0 1px 0 rgba(255, 255, 255, 0.18);
        }
        .b2u-ghost {
          display: inline-flex; align-items: center; gap: 7px;
          font-family: inherit; font-size: 12px; font-weight: 600;
          color: var(--text-secondary); background: transparent;
          border: 1px solid var(--border-base); border-radius: 9px;
          padding: 10px 14px; cursor: pointer;
          transition: background 0.15s var(--b2u-ease), border-color 0.15s, color 0.15s;
        }
        .b2u-ghost:hover:not(:disabled) {
          background: var(--bg-item); border-color: var(--b2u-accent-line); color: var(--text-primary);
        }
        .b2u-ghost:disabled { opacity: 0.45; cursor: not-allowed; }
        .b2u-ghost.is-copied { color: var(--b2u-accent); border-color: var(--b2u-accent-line); background: var(--b2u-accent-soft); }

        /* ── Fidelity + status ── */
        .b2u-status {
          display: flex; align-items: flex-start; gap: 9px;
          font-size: 12.5px; line-height: 1.5; padding: 11px 14px; border-radius: 10px;
        }
        .b2u-status.ok { background: var(--b2u-accent-soft); border: 1px solid var(--b2u-accent-line); color: var(--text-secondary); }
        .b2u-status.info { background: var(--bg-item); border: 1px solid var(--border-base); color: var(--text-muted); }
        .b2u-status.err { background: var(--b2u-danger-bg); border: 1px solid var(--b2u-danger-line); color: var(--b2u-danger-text); }
        .b2u-status svg { flex: 0 0 auto; margin-top: 1px; }
        .b2u-status b { font-family: 'Syne', sans-serif; font-weight: 700; color: var(--text-primary); }
        .b2u-foot { display: flex; align-items: center; gap: 7px; font-size: 11px; color: var(--text-faint); }

        @media (prefers-reduced-motion: reduce) {
          .b2u, .b2u *, .b2u *::before, .b2u *::after {
            animation-duration: 0.01ms !important;
            animation-iteration-count: 1 !important;
            transition-duration: 0.01ms !important;
          }
        }
      `}</style>

      <div className="b2u">
        <header className="b2u-head">
          <span className="b2u-mark" aria-hidden="true">অ</span>
          <div className="b2u-headmain">
            <h1 className="b2u-title">
              {t.titleA}
              <span className="b2u-arc" aria-hidden="true">{Icon.arrow}</span>
              {t.titleB}
            </h1>
            <p className="b2u-purpose">{t.purpose}</p>
          </div>
          <div className="b2u-lang" role="group" aria-label="Language / ভাষা">
            <button type="button" className={lang === 'en' ? 'on' : ''} onClick={() => setLang('en')}>EN</button>
            <button type="button" className={lang === 'bn' ? 'on' : ''} onClick={() => setLang('bn')}>বাংলা</button>
          </div>
        </header>

        <div className="b2u-stage">
          <section className="b2u-desk is-src" aria-label={t.srcLabel}>
            <div className="b2u-desk-head">
              <span className="b2u-tag">{t.srcTag}</span>
              <span className="b2u-desk-count">{charCount} {t.chars}</span>
            </div>
            <textarea
              value={source}
              onChange={(e) => setSource(e.target.value)}
              placeholder={t.srcHint}
              spellCheck={false}
              aria-label={t.srcLabel}
            />
          </section>

          <div className="b2u-seam" aria-hidden="true">
            <span className={`b2u-seam-node${isFresh ? ' is-fresh' : ''}`}>{Icon.arrow}</span>
          </div>

          <section className={`b2u-desk is-out${isFresh ? ' is-fresh' : ''}`} aria-label={t.outLabel}>
            {isFresh && <span className="b2u-scan" aria-hidden="true" />}
            <div className="b2u-desk-head">
              <span className="b2u-tag">{t.outTag}</span>
              <span className="b2u-desk-count">{outCount} {t.chars}</span>
            </div>
            <textarea
              value={output}
              readOnly
              placeholder={t.outHint}
              aria-label={t.outLabel}
            />
          </section>

          {phase === 'converting' && (
            <div className="b2u-busy" role="status" aria-live="polite">
              <KineticSphereLoader />
              <span className="b2u-busy-label">{t.decoding}</span>
            </div>
          )}
        </div>

        <div className="b2u-actions">
          <button type="button" className={`b2u-decode${phase === 'converting' ? ' is-busy' : ''}`} onClick={convert} disabled={!hasSource || phase === 'converting' || overLimit}>
            {phase === 'converting'
              ? (<><KineticSphereLoader size={20} color="var(--b2u-on-accent)" />{t.decoding}</>)
              : t.decode}
          </button>
          <button type="button" className={`b2u-ghost${copied ? ' is-copied' : ''}`} onClick={copyResult} disabled={!hasOutput}>
            {copied ? Icon.check : Icon.copy}{copied ? t.copied : t.copy}
          </button>
          <button type="button" className="b2u-ghost" onClick={downloadTxt} disabled={!hasOutput}>
            {Icon.download}{t.download}
          </button>
          <button type="button" className="b2u-ghost" onClick={swapIntoInput} disabled={!hasOutput} title={t.swap}>
            {Icon.swap}{t.swap}
          </button>
          <button type="button" className="b2u-ghost" onClick={loadSample}>
            {t.sample}
          </button>
          <button type="button" className="b2u-ghost" onClick={clearAll} disabled={!hasSource && !hasOutput}>
            {t.clear}
          </button>
        </div>

        {overLimit ? (
          <div className="b2u-status err" role="alert">
            {Icon.alert}
            <span>{t.limitWarn} {charCount.toLocaleString()} / {MAX_TEXT_CHARS.toLocaleString()}</span>
          </div>
        ) : error ? (
          <div className="b2u-status err" role="alert">
            {Icon.alert}
            <span>{t.error} — {error}</span>
          </div>
        ) : isFresh && detected !== null ? (
          <div className={`b2u-status ${detected ? 'ok' : 'info'}`} role="status" aria-live="polite">
            {detected ? Icon.check : Icon.info}
            <span>
              {detected
                ? (<><b>{t.decoded}</b>&nbsp;·&nbsp;{outCount} {t.chars}</>)
                : t.unchanged}
            </span>
          </div>
        ) : null}

        {copyFailed && !overLimit && (
          <div className="b2u-status info" role="status">
            {Icon.info}
            <span>{t.copyFail}</span>
          </div>
        )}

        <p className="b2u-foot">
          {Icon.lock}
          <span>{t.privacy}</span>
        </p>
      </div>
    </>
  )
}
