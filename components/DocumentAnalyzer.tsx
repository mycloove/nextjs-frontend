'use client';

/*
 * AI Analyzer — "The Reader" of the suite.
 *
 * Instrument concept — "The Reader's Margin": the document is a page, the
 * summary is the highlighter left in its margin. Highlighter amber is the one
 * accent (a summary is literally what a highlighter leaves behind), kept
 * deliberately away from the AI-purple cliché. Every --da-* value is a
 * component-scoped token with a [data-theme="light"] override, because the
 * earlier purple values were hardcoded for dark mode only.
 *
 * The generic ToolWorkspace heading (eyebrow / title / description / badge) is
 * retired on this page — see app/(tools)/ai-analyzer/page.tsx. The registry
 * strings still ship as SEO metadata and the topbar breadcrumb keeps the tool
 * name visible; this component carries its own masthead instead.
 *
 * Loaders are ported from LoaderUI/loader23.html, recoloured to this tool's
 * accent: "Blueprint Scan" (document frame + sweeping laser) depicts the real
 * first act — reading the pages — and "The AI Core" (3×3 data matrix) signals
 * the compute. The double-helix loader is FASTA's DNA palette, not ours, and
 * the tesseract / hex / sphere / barber-pole loaders depict nothing this tool
 * actually does.
 *
 * Drag & drop uses react-dropzone — the same dependency and pattern as the
 * sibling tool components. The API contract is unchanged: form fields `pdf` +
 * `analysis_mode`, and the same response fields are consumed.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { useDropzone, type FileRejection } from 'react-dropzone';
import { ApiClientError, getApiErrorMessage, toolRequest } from '@/lib/api/client';

const MAX_SIZE = 50 * 1024 * 1024;

/* ── Icons ─────────────────────────────────────────────────── */
const Ic = {
  upload: (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
      <polyline points="14 2 14 8 20 8"/>
      <path d="M12 18v-6M9 15l3-3 3 3"/>
    </svg>
  ),
  read: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 7V5a1 1 0 0 1 1-1h2M20 7V5a1 1 0 0 0-1-1h-2M4 17v2a1 1 0 0 0 1 1h2M20 17v2a1 1 0 0 1-1 1h-2"/>
      <line x1="8" y1="10" x2="16" y2="10"/><line x1="8" y1="14" x2="14" y2="14"/>
    </svg>
  ),
  pdf: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
      <polyline points="14 2 14 8 20 8"/>
      <line x1="8" y1="13" x2="16" y2="13"/><line x1="8" y1="17" x2="12" y2="17"/>
    </svg>
  ),
  check: (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="20 6 9 17 4 12"/>
    </svg>
  ),
  close: (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
      <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
    </svg>
  ),
  copy: (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="9" y="9" width="13" height="13" rx="2"/>
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
    </svg>
  ),
  download: (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
      <polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>
    </svg>
  ),
  refresh: (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 12a9 9 0 0 1 15-6.7L21 8"/><path d="M21 3v5h-5"/>
      <path d="M21 12a9 9 0 0 1-15 6.7L3 16"/><path d="M3 21v-5h5"/>
    </svg>
  ),
  alert: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
      <line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>
    </svg>
  ),
  info: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/>
      <line x1="12" y1="16" x2="12.01" y2="16"/>
    </svg>
  ),
  eye: (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>
    </svg>
  ),
  /* Depth glyphs for the two analysis modes — the line counts are the point. */
  depthMin: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round">
      <line x1="8" y1="9" x2="16" y2="9"/><line x1="8" y1="13" x2="13" y2="13"/><line x1="8" y1="17" x2="11" y2="17"/>
    </svg>
  ),
  depthMax: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round">
      <line x1="8" y1="6" x2="16" y2="6"/><line x1="8" y1="9.5" x2="14" y2="9.5"/>
      <line x1="8" y1="13" x2="16" y2="13"/><line x1="8" y1="16.5" x2="15" y2="16.5"/>
      <line x1="8" y1="20" x2="12" y2="20"/>
    </svg>
  ),
};

/* The intake sheet's "text" — widths only; some lines carry the highlight. */
const SHEET_LINES = ['64%', '100%', '92%', '55%', '100%', '78%', '88%', '100%'];
const SHEET_MARKS = new Set([1, 4, 7]);

/* The reading page's lines — each marks as the sweep passes it. */
const SCAN_LINES = [96, 88, 100, 72, 92, 84, 64];

/* ─────────────────────────────────────────────────────────────
   Component
   ───────────────────────────────────────────────────────────── */
export default function DocumentAnalyzer() {
  const [file, setFile]         = useState<File | null>(null);
  const [loading, setLoading]   = useState(false);
  const [summary, setSummary]   = useState<string | null>(null);
  const [analysisMode, setAnalysisMode] = useState<'minimal' | 'elaborate'>('minimal');
  const [copied, setCopied]     = useState(false);
  const [stats, setStats]       = useState<{
    totalPages: number; analyzedPages: number;
    origWords: number;  sumWords: number;
    processingTime: number; note?: string;
  } | null>(null);
  const [error, setError]       = useState<string | null>(null);
  const [pagePreviews, setPagePreviews] = useState<{page:number;preview:string}[]|null>(null);
  const abortRef = useRef<AbortController | null>(null);

  /* A cancel through toolRequest arrives as an ApiClientError whose cause is the
     AbortError, so a deliberate stop is told apart from a real failure. */
  const isCancellation = (e: unknown) =>
    e instanceof ApiClientError && (e.cause as { name?: string } | undefined)?.name === 'AbortError';

  useEffect(() => () => { abortRef.current?.abort(); }, []);

  const stageFile = (f: File) => {
    abortRef.current?.abort();
    setFile(f); setError(null); setSummary(null);
    setStats(null); setPagePreviews(null); setCopied(false);
  };

  /* ── Dropzone (same dependency + pattern as the sibling tools) ── */
  const onDrop = useCallback((accepted: File[], rejections: FileRejection[]) => {
    if (rejections.length > 0) {
      const code = rejections[0].errors[0]?.code;
      setError(code === 'file-too-large'
        ? 'File too large. Maximum 50 MB allowed.'
        : 'Please select a valid PDF file.');
      return;
    }
    const f = accepted[0];
    if (f) stageFile(f);
  }, []);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    multiple: false,
    maxSize: MAX_SIZE,
    accept: { 'application/pdf': ['.pdf'] },
  });

  const removeFile = () => {
    abortRef.current?.abort();
    setFile(null); setSummary(null); setStats(null);
    setPagePreviews(null); setError(null); setCopied(false);
  };

  /* ── Analyze ──
     No fake progress phases: the server call is opaque, so the reading state
     says one honest thing and the copy states the real expected duration. */
  const handleAnalyze = async () => {
    if (!file) { setError('Please select a PDF first'); return; }
    setLoading(true); setError(null);
    const controller = new AbortController();
    abortRef.current = controller;
    const formData = new FormData();
    formData.append('pdf', file);
    formData.append('analysis_mode', analysisMode);

    try {
      const res = await toolRequest('/api/analyze-pdf', {
        method: 'POST', body: formData, signal: controller.signal,
      });
      if (!res.ok) {
        throw new Error(await getApiErrorMessage(res, 'The analysis could not be completed. Please try another PDF.'));
      }
      const data = await res.json();
      setSummary(data.summary);
      setStats({
        totalPages:     data.total_pages,
        analyzedPages:  data.analyzed_pages,
        origWords:      data.original_length,
        sumWords:       data.summary_length,
        processingTime: data.processing_time_seconds,
        note:           data.note,
      });
      if (data.page_previews) setPagePreviews(data.page_previews);
    } catch (e) {
      if (isCancellation(e)) {
        // deliberate cancel — nothing to report
      } else {
        // Surface the server's real message (e.g. an AI-provider or rate-limit
        // reason) instead of a blanket "try another PDF".
        setError(e instanceof Error && e.message
          ? e.message
          : 'Could not generate analysis report. Please try another PDF.');
      }
    } finally {
      abortRef.current = null;
      setLoading(false);
    }
  };

  const cancelAnalyze = () => {
    abortRef.current?.abort();
  };

  /* ── Copy summary ── */
  const copySummary = async () => {
    if (!summary) return;
    try {
      await navigator.clipboard.writeText(summary);
      setCopied(true); setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard unavailable (e.g. insecure context) — the button simply doesn't flip */
    }
  };

  /* ── Download summary ── */
  const downloadSummary = () => {
    if (!summary) return;
    const blob = new Blob([summary], { type: 'text/plain' });
    const a = Object.assign(document.createElement('a'), {
      href: URL.createObjectURL(blob),
      download: `mycloove_${(file?.name ?? 'document').replace(/\.[^.]+$/, '').replace(/[^\w.-]+/g, '_')}_summary.txt`,
    });
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
  };

  const fileSizeMB = file ? (file.size / 1024 / 1024).toFixed(2) : '0';

  /* Distillation meter — real numbers from the response, never invented. */
  const rawPct   = stats && stats.origWords > 0 ? (stats.sumWords / stats.origWords) * 100 : 0;
  const pctLabel = rawPct > 0 && rawPct < 1 ? '<1' : String(Math.round(rawPct));
  const pctWidth = Math.min(100, Math.max(1, Math.round(rawPct)));
  const modeLabel = analysisMode === 'minimal' ? 'Minimal' : 'Elaborate';

  return (
    <>
      <style>{`
        /* ══ Tokens — highlighter amber, scoped to this component ══
           Dark is the default (matches app/theme.css); light overrides below. */
        .da {
          --da-accent:      #ffd93d;   /* the mark itself (brand yellow family) */
          --da-accent-deep: #f0b429;
          --da-ink:         #1c1500;   /* ink that sits ON amber */
          --da-accent-text: #ffd93d;   /* amber as text/icon on dark surfaces */
          --da-mark:        rgba(255, 217, 61, 0.38);
          --da-wash:        rgba(255, 217, 61, 0.07);
          --da-glow:        rgba(255, 217, 61, 0.20);
          --da-accent-border: rgba(255, 217, 61, 0.5);
          --da-hair:        rgba(255, 255, 255, 0.10);
          --da-sheet-shadow: 0 6px 22px rgba(0, 0, 0, 0.24);
          --da-danger:      #ff8f8f;
          --da-danger-bg:   rgba(255, 80, 80, 0.07);
          --da-danger-border: rgba(255, 80, 80, 0.22);
          --da-ok:          #2dbd7a;
          --da-ease-out:    cubic-bezier(0.16, 1, 0.3, 1);
          --da-ease-spring: cubic-bezier(0.34, 1.56, 0.64, 1);

          display: flex; flex-direction: column; gap: 16px;
        }
        [data-theme="light"] .da {
          --da-accent-text: #8f6400;            /* dark amber for text on light */
          --da-mark:        rgba(234, 179, 8, 0.30);
          --da-wash:        rgba(234, 179, 8, 0.06);
          --da-glow:        rgba(234, 179, 8, 0.18);
          --da-hair:        rgba(0, 0, 0, 0.08);
          --da-sheet-shadow: 0 6px 18px rgba(0, 0, 0, 0.10);
          --da-danger:      #b91c1c;
          --da-danger-bg:   rgba(220, 38, 38, 0.05);
          --da-danger-border: rgba(220, 38, 38, 0.25);
          --da-ok:          #15803d;
        }

        /* ── Keyframes ── */
        @keyframes da-pop {
          from { opacity: 0; transform: translateY(6px) scale(.985); }
          to   { opacity: 1; transform: none; }
        }
        @keyframes da-fade-in {
          from { opacity: 0; transform: translateY(4px); }
          to   { opacity: 1; transform: none; }
        }
        @keyframes da-sweep {
          0%   { top: 6%;  opacity: 0; }
          10%  { opacity: 1; }
          90%  { opacity: 1; }
          100% { top: 92%; opacity: 0; }
        }
        @keyframes da-mark {
          0%,100% { opacity: 0; }
          12%     { opacity: .55; }
          38%     { opacity: .55; }
          58%     { opacity: 0; }
        }
        @keyframes da-core-pulse {
          0%   { opacity: .12; transform: scale(.8); }
          100% { opacity: 1;   transform: scale(1.1); }
        }
        @keyframes da-distill {
          from { width: 0; }
          to   { width: var(--pct, 100%); }
        }
        .da-pop { animation: da-pop .24s var(--da-ease-out) both; }

        .da-sr {
          position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px;
          overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; border: 0;
        }

        /* ══ Masthead — this page's own identity, not the generic heading ══ */
        .da-mast {
          display: flex; align-items: center; gap: 14px;
          padding-bottom: 14px;
          border-bottom: 1px solid var(--border-card);
        }
        .da-mast-mark {
          position: relative; flex-shrink: 0;
          width: 42px; height: 42px; border-radius: 11px;
          display: flex; align-items: center; justify-content: center;
          color: var(--da-accent-text);
          background: var(--da-wash);
          border: 1px solid var(--da-accent-border);
        }
        .da-mast-mark::after {           /* the margin highlight under the mark */
          content: ''; position: absolute; left: 11px; right: 11px; bottom: 9px;
          height: 3px; border-radius: 2px; background: var(--da-accent); opacity: .8;
        }
        .da-mast-title {
          font-family: 'Syne', sans-serif; font-size: 20px; font-weight: 800;
          color: var(--text-primary); letter-spacing: -.3px; line-height: 1.1;
        }
        .da-mast-sub {
          font-size: 12.5px; color: var(--text-muted); margin-top: 3px; line-height: 1.5;
        }
        .da-mast-tag {
          margin-left: auto; flex-shrink: 0;
          font-size: 10px; font-weight: 800; letter-spacing: 1.2px; text-transform: uppercase;
          color: var(--da-accent-text);
          padding: 5px 10px; border-radius: 999px;
          background: var(--da-wash); border: 1px solid var(--da-accent-border);
        }
        @media (max-width: 560px) { .da-mast-tag { display: none; } }

        /* ══ A · Intake — the page under the highlighter ══ */
        .da-zone {
          position: relative; overflow: hidden;
          border: 1px solid var(--border-card);
          border-radius: 16px;
          padding: 46px 24px 38px;
          text-align: center; cursor: pointer;
          background: var(--bg-item);
          transition: border-color .2s, background .2s;
        }
        .da-zone:hover { border-color: var(--da-accent-border); }
        .da-zone.active {
          border-color: var(--da-accent-border);
          background: var(--da-wash);
        }

        /* reticle brackets — tighten as the file arrives (mycloove calibration) */
        .da-corner {
          position: absolute; width: 18px; height: 18px;
          border: 0 solid var(--da-accent-text); opacity: .55;
          pointer-events: none;
          transition: width .25s var(--da-ease-out),
                      height .25s var(--da-ease-out), opacity .2s;
        }
        .da-c-tl { top: 14px; left: 14px;  border-top-width: 2px;    border-left-width: 2px;    }
        .da-c-tr { top: 14px; right: 14px; border-top-width: 2px;    border-right-width: 2px;  }
        .da-c-bl { bottom: 14px; left: 14px;  border-bottom-width: 2px; border-left-width: 2px;  }
        .da-c-br { bottom: 14px; right: 14px; border-bottom-width: 2px; border-right-width: 2px; }
        .da-zone:hover .da-corner  { opacity: .9; }
        .da-zone.active .da-corner { width: 30px; height: 30px; opacity: 1; }

        /* the document sheet — notebook margin + ghost text */
        .da-sheet {
          position: relative;
          width: 132px; height: 152px;
          margin: 0 auto 22px;
          background: var(--bg-card);
          border: 1px solid var(--border-card);
          border-radius: 8px;
          padding: 15px 14px 15px 26px;
          display: flex; flex-direction: column; gap: 8px;
          box-shadow: var(--da-sheet-shadow);
          transition: transform .28s var(--da-ease-out), box-shadow .28s;
        }
        .da-sheet::before {              /* the reader's margin rule */
          content: ''; position: absolute; left: 17px; top: 12px; bottom: 12px;
          width: 1px; background: var(--da-accent-border); opacity: .7;
        }
        .da-zone:hover  .da-sheet { transform: translateY(-3px); box-shadow: 0 12px 30px rgba(0,0,0,.28); }
        .da-zone.active .da-sheet { transform: translateY(-4px) scale(1.02); }
        .da-sheet-title {
          height: 8px; width: 42%; border-radius: 4px;
          background: var(--da-hair); margin-bottom: 4px;
        }
        .da-sheet-line {
          height: 6px; border-radius: 3px;
          background: var(--da-hair);
          transition: opacity .2s;
        }
        .da-sheet-line.mark { background: var(--da-accent); opacity: .34; }
        .da-zone:hover  .da-sheet-line.mark { opacity: .55; }
        .da-zone.active .da-sheet-line.mark { opacity: .72; }

        .da-zone-title {
          font-family: 'Syne', sans-serif; font-size: 16px; font-weight: 800;
          color: var(--text-primary); margin-bottom: 6px; letter-spacing: -.2px;
        }
        .da-zone-sub { font-size: 12.5px; color: var(--text-muted); margin-bottom: 18px; }

        .da-browse {
          display: inline-flex; align-items: center; gap: 7px;
          font-size: 12.5px; font-weight: 600;
          padding: 9px 20px; border-radius: 10px;
          background: var(--da-wash);
          border: 1px solid var(--da-accent-border);
          color: var(--da-accent-text);
          transition: background .15s, transform .12s;
        }
        .da-zone:hover .da-browse { background: var(--da-glow); transform: translateY(-1px); }
        .da-zone-ledger {
          margin-top: 16px;
          font-size: 10.5px; letter-spacing: .2px;
          color: var(--text-muted);
        }

        /* ══ B · Staged — specimen + reading depth ══ */
        .da-specimen {
          display: flex; align-items: center; gap: 14px;
          padding: 13px 16px;
          background: var(--bg-card);
          border: 1px solid var(--border-card);
          border-radius: 12px;
        }
        .da-spec-glyph {
          width: 40px; height: 40px; border-radius: 10px; flex-shrink: 0;
          background: var(--da-wash);
          border: 1px solid var(--da-accent-border);
          display: flex; align-items: center; justify-content: center;
          color: var(--da-accent-text);
        }
        .da-spec-name {
          font-size: 13px; font-weight: 600; color: var(--text-primary);
          white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 240px;
          margin-bottom: 2px;
        }
        .da-spec-meta { font-size: 11px; color: var(--text-muted); }
        .da-spec-remove {
          margin-left: auto; flex-shrink: 0;
          display: flex; align-items: center; gap: 5px;
          font-size: 11px; font-weight: 500;
          color: var(--text-muted);
          padding: 4px 9px; border-radius: 7px;
          border: 1px solid var(--border-base); background: transparent; cursor: pointer;
          transition: color .14s, background .14s, border-color .14s;
        }
        .da-spec-remove:hover:not(:disabled) {
          color: var(--da-danger); background: var(--da-danger-bg);
          border-color: var(--da-danger-border);
        }
        .da-spec-remove:disabled { opacity: .4; cursor: not-allowed; }

        .da-modes {
          display: grid; grid-template-columns: 1fr 1fr; gap: 10px;
          animation: da-pop .22s var(--da-ease-out) both;
        }
        @media (max-width: 560px) { .da-modes { grid-template-columns: 1fr; } }
        .da-mode {
          position: relative;
          display: flex; flex-direction: column; gap: 4px;
          padding: 12px 14px; border-radius: 11px; cursor: pointer;
          border: 1px solid var(--border-card);
          background: var(--bg-card);
          transition: border-color .15s, background .15s;
        }
        .da-mode input { position: absolute; opacity: 0; width: 1px; height: 1px; }
        .da-mode-name-row { display: flex; align-items: center; gap: 8px; }
        .da-mode-icon { color: var(--text-muted); display: inline-flex; transition: color .15s; }
        .da-mode.on .da-mode-icon { color: var(--da-accent-text); }
        .da-mode-name { font-size: 13px; font-weight: 700; color: var(--text-primary); }
        .da-mode-desc { font-size: 11.5px; line-height: 1.5; color: var(--text-muted); }
        .da-mode.on { border-color: var(--da-accent-border); background: var(--da-wash); }
        .da-mode:hover { border-color: var(--da-accent-border); }
        .da-mode:has(input:focus-visible) {
          outline: 2px solid var(--da-accent-text); outline-offset: 2px;
        }

        .da-go {
          position: relative;
          display: inline-grid; place-items: center;
          width: 100%; min-height: 50px; padding: 14px 20px;
          border-radius: 12px; border: 1px solid transparent;
          background: var(--da-accent); color: var(--da-ink);
          font-family: 'Syne', sans-serif; font-size: 14.5px; font-weight: 800;
          letter-spacing: -.2px; cursor: pointer;
          box-shadow: 0 4px 18px var(--da-glow);
          transition: transform .16s, box-shadow .16s, background .2s, border-color .2s, color .2s, opacity .2s;
        }
        .da-go > span {
          grid-area: 1 / 1;
          display: inline-flex; align-items: center; justify-content: center; gap: 9px;
        }
        .da-go-idle { transition: opacity .3s, transform .35s var(--da-ease-out), filter .3s; }
        .da-go-busy {
          opacity: 0; transform: scale(.7); filter: blur(3px); pointer-events: none;
          transition: opacity .3s .1s, transform .45s var(--da-ease-spring) .1s, filter .3s;
        }
        .da-go:hover:not(:disabled)  { transform: translateY(-1px); box-shadow: 0 8px 26px var(--da-glow); }
        .da-go:active:not(:disabled) { transform: translateY(0); }
        .da-go:disabled { opacity: .45; cursor: not-allowed; box-shadow: none; }
        /* Busy morph — the button itself shows the compute (LoaderUI "AI Core"). */
        .da-go[data-busy="true"] {
          opacity: 1; cursor: progress;
          background: var(--da-wash);
          border-color: var(--da-accent-border);
          color: var(--da-accent-text);
          box-shadow: none;
        }
        .da-go[data-busy="true"] .da-go-idle { opacity: 0; transform: scale(.7); filter: blur(3px); }
        .da-go[data-busy="true"] .da-go-busy { opacity: 1; transform: none; filter: none; }

        /* ══ C · Reading — the sweep that condenses (LoaderUI "Blueprint Scan") ══ */
        .da-reading {
          background: var(--bg-card);
          border: 1px solid var(--border-card);
          border-radius: 14px; padding: 22px 20px 20px;
          display: flex; flex-direction: column; align-items: center; gap: 14px;
          animation: da-pop .22s var(--da-ease-out) both;
          position: relative; overflow: hidden;
        }
        .da-reading::before {
          content: ''; position: absolute; top: 0; left: 0; right: 0; height: 2px;
          background: linear-gradient(90deg, var(--da-accent), transparent 70%);
          pointer-events: none;
        }
        .da-scan-frame {
          position: relative; width: min(400px, 100%); height: 138px;
          background: var(--bg-item);
          border: 1px solid var(--border-card);
          border-radius: 10px;
          padding: 16px 18px 16px 26px;
          display: flex; flex-direction: column; gap: 10px;
          overflow: hidden;
        }
        .da-scan-frame::before {
          content: ''; position: absolute; left: 17px; top: 12px; bottom: 12px;
          width: 1px; background: var(--da-accent-border); opacity: .55;
        }
        .da-scan-line {
          position: relative; overflow: hidden;
          height: 8px; border-radius: 4px;
          background: var(--bg-item-hover);
        }
        .da-scan-line::after {
          content: ''; position: absolute; inset: 0;
          background: var(--da-accent); opacity: 0;
          animation: da-mark 2.4s linear infinite;
          animation-delay: calc(var(--i) * 0.3s);
        }
        .da-scan-laser {
          position: absolute; left: 6%; right: 6%; top: 6%; height: 2px;
          background: var(--da-accent); border-radius: 2px;
          box-shadow: 0 0 12px 2px var(--da-glow);
          animation: da-sweep 2.4s cubic-bezier(.4, 0, .2, 1) infinite;
          pointer-events: none;
        }
        .da-reading-title {
          display: flex; align-items: center; gap: 10px;
          font-family: 'Syne', sans-serif; font-size: 14px; font-weight: 700;
          color: var(--text-primary); text-align: center;
        }
        .da-reading-sub {
          font-size: 11.5px; color: var(--text-muted);
          text-align: center; max-width: 380px; line-height: 1.55;
        }

        /* The AI Core data matrix (LoaderUI sample 1) */
        .da-core {
          display: grid; grid-template-columns: repeat(3, 1fr); gap: 2.5px;
          width: 16px; height: 16px; flex-shrink: 0;
          color: var(--da-accent-text);
        }
        .da-core span {
          background: currentColor; border-radius: 1px; opacity: .12;
          animation: da-core-pulse 1.2s infinite alternate;
        }
        .da-core span:nth-child(1) { animation-delay: .2s; }
        .da-core span:nth-child(2) { animation-delay: .7s; }
        .da-core span:nth-child(3) { animation-delay: .1s; }
        .da-core span:nth-child(4) { animation-delay: .9s; }
        .da-core span:nth-child(5) { animation-delay: .4s; }
        .da-core span:nth-child(6) { animation-delay: .8s; }
        .da-core span:nth-child(7) { animation-delay: .3s; }
        .da-core span:nth-child(8) { animation-delay: .6s; }
        .da-core span:nth-child(9) { animation-delay: .5s; }

        /* ── Error ── */
        .da-error {
          display: flex; align-items: flex-start; gap: 10px;
          padding: 12px 14px; border-radius: 11px;
          background: var(--da-danger-bg);
          border: 1px solid var(--da-danger-border);
          font-size: 12.5px; color: var(--da-danger); line-height: 1.55;
          animation: da-pop .2s var(--da-ease-out) both;
        }
        .da-error-icon {
          width: 22px; height: 22px; border-radius: 6px; flex-shrink: 0;
          background: var(--da-danger-bg);
          border: 1px solid var(--da-danger-border);
          display: flex; align-items: center; justify-content: center; margin-top: 1px;
        }

        /* Cancel for the in-flight read — a quiet, secondary action. */
        .da-cancel {
          display: flex; align-items: center; justify-content: center; gap: 6px;
          margin: 10px auto 0; font-family: inherit; font-size: 11.5px; font-weight: 500;
          color: var(--text-muted); padding: 6px 12px; border-radius: 8px;
          border: 1px solid var(--border-base); background: transparent; cursor: pointer;
          transition: color .14s, background .14s, border-color .14s;
        }
        .da-cancel:hover {
          color: var(--da-danger); background: var(--da-danger-bg);
          border-color: var(--da-danger-border);
        }
        .da-cancel:focus-visible { outline: 2px solid var(--da-danger); outline-offset: 2px; }

        /* ══ D · Report ══ */
        .da-report {
          background: var(--bg-card);
          border: 1px solid var(--border-card);
          border-radius: 14px; overflow: hidden;
          animation: da-pop .26s var(--da-ease-out) both;
          position: relative;
        }
        .da-report::before {
          content: ''; position: absolute; top: 0; left: 0; right: 0; height: 2px;
          background: linear-gradient(90deg, var(--da-accent), transparent 70%);
          pointer-events: none; z-index: 1;
        }
        .da-report-head {
          display: flex; align-items: center; justify-content: space-between;
          gap: 12px; flex-wrap: wrap;
          padding: 14px 18px;
          border-bottom: 1px solid var(--border-card);
        }
        .da-report-kicker {
          font-size: 10px; font-weight: 800; letter-spacing: 1px;
          text-transform: uppercase;
          color: var(--da-accent-text); margin-bottom: 3px;
        }
        .da-report-file {
          font-family: 'Syne', sans-serif; font-size: 14px; font-weight: 700;
          color: var(--text-primary);
          white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
          max-width: 320px;
        }
        .da-report-actions { display: flex; align-items: center; gap: 7px; flex-wrap: wrap; }
        .da-mode-chip {
          font-size: 10px; font-weight: 700; letter-spacing: .5px;
          padding: 4px 10px; border-radius: 999px; text-transform: uppercase;
          background: var(--da-wash); border: 1px solid var(--da-accent-border);
          color: var(--da-accent-text);
        }
        .da-act-btn {
          display: inline-flex; align-items: center; gap: 5px;
          font-size: 11.5px; font-weight: 600;
          padding: 6px 12px; border-radius: 8px;
          border: 1px solid var(--border-base);
          background: var(--bg-item);
          color: var(--text-primary); cursor: pointer;
          transition: background .14s, border-color .14s, color .14s;
        }
        .da-act-btn:hover { background: var(--bg-item-hover); border-color: var(--border-card); }
        .da-act-btn.copied {
          background: var(--da-ok); border-color: var(--da-ok); color: #fff;
        }

        /* distillation meter — the signature */
        .da-distill { padding: 16px 18px 4px; }
        .da-distill-head {
          font-size: 12.5px; color: var(--text-secondary); margin-bottom: 9px;
        }
        .da-distill-head b {
          font-family: 'Syne', sans-serif; font-size: 14px; font-weight: 800;
          color: var(--da-accent-text);
        }
        .da-distill-track {
          position: relative; height: 10px; border-radius: 5px;
          background: var(--bg-item-hover); overflow: hidden;
        }
        .da-distill-fill {
          position: absolute; top: 0; bottom: 0; left: 0; border-radius: 5px;
          width: var(--pct, 100%);
          background: linear-gradient(90deg, var(--da-accent-deep), var(--da-accent));
          animation: da-distill 1s var(--da-ease-out) .15s both;
        }
        .da-distill-labels {
          display: flex; justify-content: space-between; gap: 8px;
          margin-top: 7px;
          font-size: 11px; color: var(--text-muted);
          font-variant-numeric: tabular-nums;
        }

        /* meta ledger — label:value, hairline-separated */
        .da-meta {
          display: flex; flex-wrap: wrap; align-items: center;
          padding: 12px 18px 14px;
          border-bottom: 1px solid var(--border-card);
        }
        .da-meta-item {
          display: flex; align-items: baseline; gap: 6px;
          font-size: 11.5px; color: var(--text-muted);
          padding-right: 14px; margin-right: 14px;
          border-right: 1px solid var(--border-base);
          font-variant-numeric: tabular-nums;
        }
        .da-meta-item:last-child { border-right: none; margin-right: 0; padding-right: 0; }
        .da-meta-item b { color: var(--text-secondary); font-weight: 600; }
        /* The engine reads as the product's own mark, not a vendor model id. */
        .da-meta-item .da-engine {
          font-family: 'Syne', sans-serif; font-weight: 800;
          letter-spacing: -.02em; color: var(--text-primary);
        }

        .da-note {
          display: flex; align-items: flex-start; gap: 8px;
          padding: 10px 12px; border-radius: 9px;
          margin: 14px 18px 0;
          background: var(--da-wash);
          border: 1px solid var(--da-accent-border);
          font-size: 11px; color: var(--text-secondary); line-height: 1.5;
        }
        .da-note svg { flex-shrink: 0; color: var(--da-accent-text); margin-top: 1px; }

        .da-summary-body { padding: 18px 18px 24px; }
        .da-summary-text {
          font-size: 14px; line-height: 1.85;
          color: var(--text-secondary);
          white-space: pre-wrap; word-break: break-word;
          max-width: 66ch; margin: 0 auto;
          border-left: 2px solid var(--da-accent-border);
          padding-left: 16px;
          animation: da-fade-in .45s ease both;
        }

        /* ══ Source excerpts — margin notes ══ */
        .da-excerpts {
          background: var(--bg-card);
          border: 1px solid var(--border-card);
          border-radius: 13px; overflow: hidden;
          animation: da-pop .28s var(--da-ease-out) both;
        }
        .da-excerpts-head {
          display: flex; align-items: center; gap: 8px;
          padding: 11px 16px;
          border-bottom: 1px solid var(--border-card);
          font-family: 'Syne', sans-serif; font-size: 12px; font-weight: 700;
          color: var(--text-primary);
        }
        .da-excerpts-head svg { color: var(--da-accent-text); }
        .da-excerpt-list {
          padding: 10px 14px;
          display: flex; flex-direction: column; gap: 7px;
          max-height: 180px; overflow-y: auto;
        }
        .da-excerpt {
          display: flex; gap: 9px;
          padding: 8px 10px; border-radius: 8px;
          background: var(--bg-item);
          border: 1px solid var(--border-base);
          border-left: 2px solid var(--da-accent-border);
          font-size: 11.5px; color: var(--text-muted);
          line-height: 1.55;
        }
        .da-excerpt-pg {
          font-family: 'Syne', sans-serif; font-size: 10px; font-weight: 700;
          color: var(--da-accent-text);
          background: var(--da-wash);
          border: 1px solid var(--da-accent-border);
          border-radius: 5px; padding: 1px 6px;
          flex-shrink: 0; align-self: flex-start; margin-top: 1px;
        }

        /* ── Reduced motion ── */
        @media (prefers-reduced-motion: reduce) {
          .da, .da * { transition: none !important; animation: none !important; }
          .da-distill-fill { width: var(--pct, 100%); }
          .da-scan-laser { display: none; }
          .da-scan-line::after { opacity: .4; }
          .da-core span { opacity: .8; }
        }
      `}</style>

      <div className="da">
        {/* Visually hidden page heading — the visible masthead is bespoke. */}
        <h1 className="da-sr">AI Analyzer</h1>

        {/* ── Masthead — "The Reader" ── */}
        <div className="da-mast">
          <span className="da-mast-mark" aria-hidden="true">{Ic.read}</span>
          <div style={{ minWidth: 0 }}>
            <p className="da-mast-title">The Reader</p>
            <p className="da-mast-sub">Give it a document; get back the essentials — marked, counted, and sourced.</p>
          </div>
          <span className="da-mast-tag">mycloove · Reader</span>
        </div>

        {/* ── A · Intake zone ── */}
        {!file && (
          <div
            {...getRootProps({
              className: `da-zone${isDragActive ? ' active' : ''}`,
            })}
          >
            <input {...getInputProps()} />
            <div className="da-corner da-c-tl"/><div className="da-corner da-c-tr"/>
            <div className="da-corner da-c-bl"/><div className="da-corner da-c-br"/>

            <div className="da-sheet" aria-hidden="true">
              <span className="da-sheet-title"/>
              {SHEET_LINES.map((w, i) => (
                <span
                  key={i}
                  className={`da-sheet-line${SHEET_MARKS.has(i) ? ' mark' : ''}`}
                  style={{ width: w }}
                />
              ))}
            </div>

            <p className="da-zone-title">
              {isDragActive ? 'Release to read' : 'Drop a document onto the reader'}
            </p>
            <p className="da-zone-sub">
              {isDragActive
                ? 'The reader takes it from here'
                : 'Get a distilled summary of your document — with the numbers to trust it'}
            </p>

            <span className="da-browse" aria-hidden="true">
              {Ic.upload} Browse files
            </span>

            <p className="da-zone-ledger">
              PDF only · Max 50 MB · First 10 pages read · ~30–60 seconds
            </p>
          </div>
        )}

        {/* ── Error ── */}
        {error && !loading && (
          <div className="da-error">
            <div className="da-error-icon">{Ic.alert}</div>
            <div>
              <div style={{ fontWeight: 600, marginBottom: 2 }}>Analysis failed</div>
              <div>{error}</div>
            </div>
          </div>
        )}

        {/* ── C · Reading ── */}
        {loading && (
          <div className="da-reading" role="status" aria-live="polite">
            <div className="da-scan-frame" aria-hidden="true">
              {SCAN_LINES.map((w, i) => (
                <div key={i} className="da-scan-line" style={{ '--i': i, width: `${w}%` } as CSSProperties}/>
              ))}
              <div className="da-scan-laser"/>
            </div>
            <p className="da-reading-title">
              <span className="da-core" aria-hidden="true">
                <span/><span/><span/><span/><span/><span/><span/><span/><span/>
              </span>
              Reading your document…
            </p>
            <p className="da-reading-sub">
              Extracting text and distilling the summary — this usually takes 30–60 seconds.
            </p>
          </div>
        )}

        {/* ── D · Report ── */}
        {stats && !loading && (
          <div className="da-report">
            <div className="da-report-head">
              <div>
                <p className="da-report-kicker">Reading Report</p>
                <p className="da-report-file">{file?.name}</p>
              </div>
              <div className="da-report-actions">
                <span className="da-mode-chip">{modeLabel}</span>
                <button className={`da-act-btn ${copied ? 'copied' : ''}`} onClick={copySummary}>
                  {copied ? Ic.check : Ic.copy} {copied ? 'Copied!' : 'Copy'}
                </button>
                <button className="da-act-btn" onClick={downloadSummary}>
                  {Ic.download} .txt
                </button>
                <button className="da-act-btn" onClick={removeFile}>
                  {Ic.refresh} New document
                </button>
              </div>
            </div>

            {stats.origWords > 0 && (
              <div className="da-distill">
                <p className="da-distill-head">
                  Distilled to <b>{pctLabel}%</b> of the original
                </p>
                <div className="da-distill-track">
                  <div
                    className="da-distill-fill"
                    style={{ '--pct': `${pctWidth}%` } as CSSProperties}
                  />
                </div>
                <div className="da-distill-labels">
                  <span>Source · {stats.origWords.toLocaleString()} words</span>
                  <span>Digest · {stats.sumWords.toLocaleString()} words</span>
                </div>
              </div>
            )}

            <div className="da-meta">
              <div className="da-meta-item">
                <span>Pages read</span><b>{stats.analyzedPages} / {stats.totalPages}</b>
              </div>
              <div className="da-meta-item">
                <span>Reading time</span><b>{stats.processingTime}s</b>
              </div>
              <div className="da-meta-item">
                <span>Mode</span><b>{modeLabel}</b>
              </div>
              <div className="da-meta-item">
                <span>Engine</span><b className="da-engine">mycloove</b>
              </div>
            </div>

            {stats.note && (
              <div className="da-note">
                {Ic.info} {stats.note}
              </div>
            )}

            {summary && (
              <div className="da-summary-body">
                <p className="da-summary-text">{summary}</p>
              </div>
            )}
          </div>
        )}

        {/* ── Source excerpts — margin notes ── */}
        {pagePreviews && pagePreviews.length > 0 && !loading && (
          <div className="da-excerpts">
            <div className="da-excerpts-head">
              {Ic.eye} Source excerpts
            </div>
            <div className="da-excerpt-list">
              {pagePreviews.map(p => (
                <div key={p.page} className="da-excerpt">
                  <span className="da-excerpt-pg">P{p.page}</span>
                  <span>{p.preview}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ── B · Staged file + depth + action (the action also carries the
            busy state while the report is being generated) ── */}
        {file && (
          <>
            <div className="da-specimen da-pop">
              <div className="da-spec-glyph">{Ic.pdf}</div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <p className="da-spec-name">{file.name}</p>
                <p className="da-spec-meta">{fileSizeMB} MB · PDF Document</p>
              </div>
              <button className="da-spec-remove" onClick={removeFile} disabled={loading}>
                {Ic.close} Remove
              </button>
            </div>

            {!loading && (
              <div className="da-modes" role="radiogroup" aria-label="Reading depth">
                <label className={`da-mode${analysisMode === 'minimal' ? ' on' : ''}`}>
                  <input
                    type="radio"
                    name="analysisMode"
                    checked={analysisMode === 'minimal'}
                    onChange={() => setAnalysisMode('minimal')}
                  />
                  <span className="da-mode-name-row">
                    <span className="da-mode-icon" aria-hidden="true">{Ic.depthMin}</span>
                    <span className="da-mode-name">Minimal</span>
                  </span>
                  <span className="da-mode-desc">Tight abstract — the core points in a few sentences.</span>
                </label>
                <label className={`da-mode${analysisMode === 'elaborate' ? ' on' : ''}`}>
                  <input
                    type="radio"
                    name="analysisMode"
                    checked={analysisMode === 'elaborate'}
                    onChange={() => setAnalysisMode('elaborate')}
                  />
                  <span className="da-mode-name-row">
                    <span className="da-mode-icon" aria-hidden="true">{Ic.depthMax}</span>
                    <span className="da-mode-name">Elaborate</span>
                  </span>
                  <span className="da-mode-desc">Detailed digest — longer and more granular.</span>
                </label>
              </div>
            )}

            <button
              className="da-go da-pop"
              data-busy={loading}
              onClick={handleAnalyze}
              disabled={!file || loading}
              aria-busy={loading}
            >
              <span className="da-go-idle">{Ic.read} Read document</span>
              <span className="da-go-busy">
                <span className="da-core" aria-hidden="true">
                  <span/><span/><span/><span/><span/><span/><span/><span/><span/>
                </span>
                Reading…
              </span>
            </button>
            {loading && (
              <button type="button" className="da-cancel" onClick={cancelAnalyze}>
                {Ic.close} Cancel
              </button>
            )}
          </>
        )}

      </div>
    </>
  );
}
