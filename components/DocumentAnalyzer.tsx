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
 * sibling tools. The request is unchanged (`pdf` + `analysis_mode`, sent with
 * uploadWithProgress for a real upload percentage); the response is the
 * engine's structured report (features/ai_analyzer_service.py): overview,
 * key points and sections, each citing pages the server verified were read,
 * plus the document's language and an honest coverage note. The page count
 * is read in the browser first (lib/pdf/pdfjsClient), so the reading state
 * names the real number of pages and a password-locked PDF never uploads.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { useDropzone, type FileRejection } from 'react-dropzone';
import { getApiErrorMessage } from '@/lib/api/client';
import { uploadWithProgress } from '@/lib/upload/uploadWithProgress';
import { openPdf } from '@/lib/pdf/pdfjsClient';

const MAX_SIZE = 50 * 1024 * 1024;

/* The report as the engine returns it (features/ai_analyzer_service.py).
   Every cited page was checked server-side against the pages actually read. */
type KeyPoint = { text: string; pages: number[] };
type Section = { heading: string; summary: string; pages: number[] };
type Report = {
  summary: string;               // plain-text rendering — what Copy and .txt carry
  title: string;
  overview: string;
  keyPoints: KeyPoint[];
  sections: Section[];
  language: 'bn' | 'en' | 'other';
  /* 'extractive' = no AI provider could serve; the points are quoted
     verbatim from the document, and the report must say so. */
  engine: 'ai' | 'extractive';
  totalPages: number;
  analyzedPages: number;
  ocrPages: number[];
  origWords: number;
  sumWords: number;
  processingTime: number;
  note?: string;
  /* The depth this report was produced with — the toggle stays live after a
     result, so labelling the report from the toggle would relabel it. */
  mode: 'minimal' | 'elaborate';
};

const asPages = (v: unknown): number[] =>
  Array.isArray(v) ? v.filter((n): n is number => Number.isInteger(n) && n > 0) : [];

function readReport(data: Record<string, unknown>, mode: Report['mode']): Report {
  const coverage = (data.coverage ?? {}) as Record<string, unknown>;
  const keyPoints = Array.isArray(data.key_points) ? data.key_points : [];
  const sections = Array.isArray(data.sections) ? data.sections : [];
  const str = (v: unknown) => (typeof v === 'string' ? v : '');
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
  return {
    summary: str(data.summary),
    title: str(data.title),
    overview: str(data.overview) || str(data.summary),
    keyPoints: keyPoints
      .map(p => ({ text: str((p as KeyPoint)?.text), pages: asPages((p as KeyPoint)?.pages) }))
      .filter(p => p.text),
    sections: sections
      .map(s => ({ heading: str((s as Section)?.heading), summary: str((s as Section)?.summary), pages: asPages((s as Section)?.pages) }))
      .filter(s => s.heading || s.summary),
    language: data.language === 'bn' || data.language === 'en' ? data.language : 'other',
    engine: data.engine === 'extractive' ? 'extractive' : 'ai',
    totalPages: num(data.total_pages),
    analyzedPages: num(data.analyzed_pages),
    ocrPages: asPages(coverage.ocr_pages),
    origWords: num(data.original_length),
    sumWords: num(data.summary_length),
    processingTime: num(data.processing_time_seconds),
    note: str(data.note) || undefined,
    mode,
  };
}

/* [3, 4, 5, 9] → "pp. 3–5, 9" — the citation a reader can turn to. */
function citeLabel(pages: number[]): string {
  const runs: string[] = [];
  let start = pages[0], prev = pages[0];
  for (const p of [...pages.slice(1), NaN]) {
    if (p === prev + 1) { prev = p; continue; }
    runs.push(start === prev ? String(start) : `${start}–${prev}`);
    start = prev = p;
  }
  return `${pages.length > 1 || runs[0]?.includes('–') ? 'pp.' : 'p.'} ${runs.join(', ')}`;
}

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
  const [analysisMode, setAnalysisMode] = useState<'minimal' | 'elaborate'>('minimal');
  const [copied, setCopied]     = useState(false);
  const [report, setReport]     = useState<Report | null>(null);
  const [error, setError]       = useState<string | null>(null);
  /* Read in the browser before upload: the real page count sets an honest
     expectation, and a password-locked PDF is refused before it travels. */
  const [pageCount, setPageCount] = useState<number | null>(null);
  const [locked, setLocked]       = useState(false);
  /* Real XHR upload percentage; null once the server holds the file. */
  const [uploadPct, setUploadPct] = useState<number | null>(null);
  const [elapsed, setElapsed]     = useState(0);
  const abortRef = useRef<AbortController | null>(null);
  const stageRef = useRef(0);

  useEffect(() => () => { abortRef.current?.abort(); }, []);

  /* Honest elapsed seconds while the engine works — it reports nothing per
     page until it finishes, so no percentage is invented for that part. */
  useEffect(() => {
    if (!loading) return;
    const started = Date.now();
    setElapsed(0);
    const id = setInterval(() => setElapsed(Math.floor((Date.now() - started) / 1000)), 1000);
    return () => clearInterval(id);
  }, [loading]);

  const stageFile = (f: File) => {
    abortRef.current?.abort();
    setFile(f); setError(null); setReport(null); setCopied(false);
    setPageCount(null); setLocked(false);
    const stage = ++stageRef.current;
    openPdf(f)
      .then(async (doc) => {
        if (stage === stageRef.current) setPageCount(doc.numPages);
        await doc.destroy();
      })
      .catch((e: unknown) => {
        if (stage !== stageRef.current) return;
        if ((e as { name?: string } | null)?.name === 'PasswordException') {
          setLocked(true);
          setError('This PDF is password-protected. Remove the password, then try again.');
        }
        // Any other read failure is left to the server, which names it precisely.
      });
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
    stageRef.current++;
    setFile(null); setReport(null); setError(null); setCopied(false);
    setPageCount(null); setLocked(false);
  };

  /* ── Analyze ──
     Two honest phases: the real upload percentage, then the elapsed clock
     while the engine reads every page. */
  const handleAnalyze = async () => {
    if (!file) { setError('Please select a PDF first'); return; }
    if (locked) return;
    setLoading(true); setError(null); setUploadPct(0);
    const controller = new AbortController();
    abortRef.current = controller;
    const mode = analysisMode;
    const formData = new FormData();
    formData.append('pdf', file);
    formData.append('analysis_mode', mode);

    try {
      const res = await uploadWithProgress('/api/analyze-pdf', formData, {
        signal: controller.signal,
        onProgress: pct => setUploadPct(pct >= 100 ? null : pct),
      });
      setUploadPct(null);
      if (!res.ok) {
        throw new Error(await getApiErrorMessage(res, 'The analysis could not be completed. Please try another PDF.'));
      }
      setReport(readReport(await res.json() as Record<string, unknown>, mode));
    } catch (e) {
      // uploadWithProgress rejects a cancel like any failure; the signal tells them apart.
      if (!controller.signal.aborted) {
        // Surface the server's real reason (a password, a scan with no text,
        // an unavailable AI service) instead of a blanket "try another PDF".
        setError(e instanceof Error && e.message
          ? e.message
          : 'Could not generate the reading report. Please try again.');
      }
    } finally {
      abortRef.current = null;
      setUploadPct(null);
      setLoading(false);
    }
  };

  const cancelAnalyze = () => {
    abortRef.current?.abort();
  };

  /* ── Copy report ── */
  const copySummary = async () => {
    if (!report?.summary) return;
    try {
      await navigator.clipboard.writeText(report.summary);
      setCopied(true); setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard unavailable (e.g. insecure context) — the button simply doesn't flip */
    }
  };

  /* ── Download report ── */
  const downloadSummary = () => {
    if (!report?.summary) return;
    const blob = new Blob([report.summary], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = Object.assign(document.createElement('a'), {
      href: url,
      download: `mycloove_${(file?.name ?? 'document').replace(/\.[^.]+$/, '').replace(/[^\w.-]+/g, '_')}_summary.txt`,
    });
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 0);
  };

  const fileSizeMB = file ? (file.size / 1024 / 1024).toFixed(2) : '0';

  /* Distillation meter — real numbers from the response, never invented. */
  const rawPct   = report && report.origWords > 0 ? (report.sumWords / report.origWords) * 100 : 0;
  const pctLabel = rawPct > 0 && rawPct < 1 ? '<1' : String(Math.round(rawPct));
  const pctWidth = Math.min(100, Math.max(1, Math.round(rawPct)));
  const modeLabel = report?.mode === 'elaborate' ? 'Elaborate' : 'Minimal';
  const langLabel = report?.language === 'bn' ? 'বাংলা' : report?.language === 'en' ? 'English' : null;
  const pagesLabel = pageCount ? `${pageCount} page${pageCount === 1 ? '' : 's'}` : null;

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
          font-family: 'Manrope', sans-serif; font-size: 20px; font-weight: 800;
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
          font-family: 'Manrope', sans-serif; font-size: 16px; font-weight: 800;
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
          font-family: 'Manrope', sans-serif; font-size: 14.5px; font-weight: 800;
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
          font-family: 'Manrope', sans-serif; font-size: 14px; font-weight: 700;
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
          font-family: 'Manrope', sans-serif; font-size: 14px; font-weight: 700;
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
          font-family: 'Manrope', sans-serif; font-size: 14px; font-weight: 800;
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
          font-family: 'Manrope', sans-serif; font-weight: 800;
          letter-spacing: -.02em; color: var(--text-primary);
        }

        .da-note {
          display: flex; align-items: flex-start; gap: 8px;
          padding: 10px 12px; border-radius: 9px;
          margin: 14px 18px 0;
          background: var(--da-wash);
          border: 1px solid var(--da-accent-border);
          font-size: 12px; color: var(--text-secondary); line-height: 1.55;
        }
        .da-note svg { flex-shrink: 0; color: var(--da-accent-text); margin-top: 2px; }

        /* ══ Report body — the document's essentials ══
           Overview in the margin rule, then numbered key points whose page
           citations sit in the margin like a reader's pencil note. */
        .da-body {
          padding: 20px 18px 26px;
          display: flex; flex-direction: column; gap: 22px;
          max-width: calc(66ch + 36px); margin: 0 auto; width: 100%;
          box-sizing: border-box;
        }
        .da-doc-title {
          margin: 0;
          font-family: 'Manrope', sans-serif; font-size: 17px; font-weight: 800;
          letter-spacing: -.2px; line-height: 1.35;
          color: var(--text-primary);
          animation: da-fade-in .35s ease both;
        }
        .da-summary-text {
          margin: 0;
          font-size: 14px; line-height: 1.85;
          color: var(--text-secondary);
          white-space: pre-wrap; word-break: break-word;
          border-left: 2px solid var(--da-accent-border);
          padding-left: 16px;
          animation: da-fade-in .45s ease both;
        }
        .da-block { display: flex; flex-direction: column; gap: 10px; }
        .da-block-h {
          margin: 0;
          font-family: 'Manrope', sans-serif; font-size: 12px; font-weight: 800;
          letter-spacing: .6px; text-transform: uppercase;
          color: var(--text-muted);
        }
        .da-points {
          margin: 0; padding: 0; list-style: none;
          display: flex; flex-direction: column; gap: 4px;
        }
        .da-point {
          display: grid; grid-template-columns: 24px minmax(0, 1fr); gap: 12px;
          padding: 10px 12px 10px 8px; border-radius: 10px;
          animation: da-fade-in .4s var(--da-ease-out) both;
          transition: background .15s;
        }
        .da-point:hover { background: var(--bg-item); }
        .da-point-n {
          width: 24px; height: 24px; border-radius: 7px;
          display: flex; align-items: center; justify-content: center;
          font-family: 'Manrope', sans-serif; font-size: 12px; font-weight: 800;
          font-variant-numeric: tabular-nums;
          color: var(--da-ink); background: var(--da-accent);
        }
        .da-point-text {
          font-size: 14px; line-height: 1.7; color: var(--text-primary);
          word-break: break-word;
        }
        /* page citation — the margin note; never wraps apart */
        .da-cite {
          display: inline-block; white-space: nowrap;
          margin-left: 8px; vertical-align: 1px;
          font-family: 'Manrope', sans-serif; font-size: 12px; font-weight: 700;
          line-height: 1.5; letter-spacing: 0; text-transform: none;
          font-variant-numeric: tabular-nums;
          color: var(--da-accent-text);
          background: var(--da-wash);
          border: 1px solid var(--da-accent-border);
          border-radius: 6px; padding: 0 7px;
        }
        .da-sections { display: flex; flex-direction: column; }
        .da-section {
          padding: 12px 0 12px 16px;
          border-left: 2px solid var(--da-hair);
          animation: da-fade-in .45s var(--da-ease-out) both;
        }
        .da-section + .da-section { border-top: 1px solid var(--da-hair); }
        .da-section-h {
          margin: 0 0 4px;
          display: flex; align-items: baseline; justify-content: space-between; gap: 10px;
          font-family: 'Manrope', sans-serif; font-size: 13.5px; font-weight: 700;
          color: var(--text-primary);
        }
        .da-section-h .da-cite { margin-left: 0; flex-shrink: 0; }
        .da-section-text { margin: 0; font-size: 13.5px; line-height: 1.75; color: var(--text-secondary); }

        /* Bangla: conjuncts and matras need a taller line box; no tracking. */
        .da-body:lang(bn) .da-summary-text,
        .da-body:lang(bn) .da-point-text,
        .da-body:lang(bn) .da-section-text { line-height: 1.9; }
        .da-body:lang(bn) .da-doc-title,
        .da-body:lang(bn) .da-section-h { letter-spacing: 0; line-height: 1.6; }

        /* real upload percentage — leaves once the server holds the file */
        .da-meter {
          width: min(240px, 80%); height: 3px; border-radius: 999px; overflow: hidden;
          background: var(--bg-item-hover);
        }
        .da-meter-fill {
          display: block; height: 100%;
          background: var(--da-accent);
          transform-origin: left center;
          transition: transform .2s var(--da-ease-out);
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
            <p className="da-mast-sub">Give it a document; get back the essentials — every page read, each key point cited to the page it came from, in the document&apos;s own language.</p>
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
                : 'Key points cited to their pages — English or বাংলা, typed or scanned'}
            </p>

            <span className="da-browse" aria-hidden="true">
              {Ic.upload} Browse files
            </span>

            <p className="da-zone-ledger">
              PDF only · Max 50 MB · Every page read · Scanned pages via OCR
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

        {/* ── C · Reading ── two honest phases: the real upload percentage,
            then the elapsed clock while every page is read */}
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
              {uploadPct !== null
                ? `Uploading — ${uploadPct}%`
                : `Reading ${pagesLabel ?? 'your document'} · ${elapsed}s`}
            </p>
            {uploadPct !== null && (
              <span className="da-meter" aria-hidden="true">
                <span className="da-meter-fill" style={{ transform: `scaleX(${uploadPct / 100})` }}/>
              </span>
            )}
            <p className="da-reading-sub">
              Every page is read. For a long document the AI works from its most informative passages, taken across all its pages; scanned pages are read with OCR, which takes longer.
            </p>
          </div>
        )}

        {/* ── D · Report ── */}
        {report && !loading && (
          <div className="da-report">
            <div className="da-report-head">
              <div style={{ minWidth: 0 }}>
                <p className="da-report-kicker">Reading Report</p>
                <p className="da-report-file">{file?.name}</p>
              </div>
              <div className="da-report-actions">
                {langLabel && <span className="da-mode-chip" lang={report.language === 'bn' ? 'bn' : undefined}>{langLabel}</span>}
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

            {report.origWords > 0 && (
              <div className="da-distill">
                <p className="da-distill-head">
                  Distilled to <b>{pctLabel}%</b> of the pages read
                </p>
                <div className="da-distill-track">
                  <div
                    className="da-distill-fill"
                    style={{ '--pct': `${pctWidth}%` } as CSSProperties}
                  />
                </div>
                <div className="da-distill-labels">
                  <span>Pages read · {report.origWords.toLocaleString()} words</span>
                  <span>Digest · {report.sumWords.toLocaleString()} words</span>
                </div>
              </div>
            )}

            <div className="da-meta">
              <div className="da-meta-item">
                <span>Pages read</span><b>{report.analyzedPages} / {report.totalPages}</b>
              </div>
              {report.ocrPages.length > 0 && (
                <div className="da-meta-item">
                  <span>Read by OCR</span><b>{report.ocrPages.length}</b>
                </div>
              )}
              <div className="da-meta-item">
                <span>Reading time</span><b>{report.processingTime}s</b>
              </div>
              <div className="da-meta-item">
                <span>Mode</span><b>{modeLabel}</b>
              </div>
              <div className="da-meta-item">
                <span>Engine</span><b className="da-engine">{report.engine === 'extractive' ? 'mycloove · quotes' : 'mycloove'}</b>
              </div>
            </div>

            {report.note && (
              <div className="da-note">
                {Ic.info} {report.note}
              </div>
            )}

            {/* The document's own words: lang="bn" lets Bangla take its
                font and taller line box; UI chrome around it stays English. */}
            <div className="da-body" lang={report.language === 'bn' ? 'bn' : undefined}>
              {report.title && <h2 className="da-doc-title">{report.title}</h2>}
              {report.overview && <p className="da-summary-text">{report.overview}</p>}

              {report.keyPoints.length > 0 && (
                <section className="da-block" aria-labelledby="da-points-h">
                  <h3 className="da-block-h" id="da-points-h" lang="en">
                    {report.engine === 'extractive' ? 'Key sentences, quoted' : 'Key points'}
                  </h3>
                  <ol className="da-points">
                    {report.keyPoints.map((point, i) => (
                      <li key={i} className="da-point">
                        <span className="da-point-n" aria-hidden="true">{i + 1}</span>
                        <span className="da-point-text">
                          {point.text}
                          {point.pages.length > 0 && (
                            <span className="da-cite" lang="en">{citeLabel(point.pages)}</span>
                          )}
                        </span>
                      </li>
                    ))}
                  </ol>
                </section>
              )}

              {report.sections.length > 0 && (
                <section className="da-block" aria-labelledby="da-sections-h">
                  <h3 className="da-block-h" id="da-sections-h" lang="en">Section by section</h3>
                  <div className="da-sections">
                    {report.sections.map((section, i) => (
                      <article key={i} className="da-section">
                        {(section.heading || section.pages.length > 0) && (
                          <p className="da-section-h">
                            <span>{section.heading}</span>
                            {section.pages.length > 0 && (
                              <span className="da-cite" lang="en">{citeLabel(section.pages)}</span>
                            )}
                          </p>
                        )}
                        {section.summary && <p className="da-section-text">{section.summary}</p>}
                      </article>
                    ))}
                  </div>
                </section>
              )}
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
                <p className="da-spec-meta">{fileSizeMB} MB{pagesLabel ? ` · ${pagesLabel}` : ''} · PDF Document</p>
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
                  <span className="da-mode-desc">An overview and 3–5 key points, each cited to its page.</span>
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
                  <span className="da-mode-desc">A fuller overview, 6–10 key points and a summary of every major section.</span>
                </label>
              </div>
            )}

            <button
              className="da-go da-pop"
              data-busy={loading}
              onClick={handleAnalyze}
              disabled={!file || loading || locked}
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
