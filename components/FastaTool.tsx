
'use client';

import { useState, useCallback, useEffect } from 'react';
import type { CSSProperties } from 'react';
import { useDropzone, type FileRejection } from 'react-dropzone';
import { toolRequest } from '@/lib/api/client';
import { downloadBlob } from '@/lib/download/downloadOutputs';
import { HelixLoader, HelixOverlay, HelixButton } from '@/components/tools/HelixLoader';

/* ── Icons ───────────────────────────────────────────────────
   Module-derived set. No DNA-helix icon: the reading-frame
   brackets, the `>` caret and the letters themselves carry the
   identity (see the FASTA redesign plan, phase 2). */
const Ic = {
  analyze: (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
      <path d="M11 7v4l2 2" strokeWidth="1.8"/>
    </svg>
  ),
  convert: (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="1 4 1 10 7 10"/>
      <polyline points="23 20 23 14 17 14"/>
      <path d="M20.49 9A9 9 0 0 0 5.64 5.64L1 10m22 4-4.64 4.36A9 9 0 0 1 3.51 15"/>
    </svg>
  ),
  download: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
      <polyline points="7 10 12 15 17 10"/>
      <line x1="12" y1="15" x2="12" y2="3"/>
    </svg>
  ),
  zip: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
      <polyline points="7 10 12 15 17 10"/>
      <line x1="12" y1="15" x2="12" y2="3"/>
    </svg>
  ),
  report: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
      <polyline points="14 2 14 8 20 8"/>
      <line x1="8" y1="13" x2="16" y2="13"/><line x1="8" y1="17" x2="12" y2="17"/>
    </svg>
  ),
  txt: (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
      <polyline points="14 2 14 8 20 8"/>
      <line x1="8" y1="13" x2="16" y2="13"/><line x1="8" y1="17" x2="11" y2="17"/>
    </svg>
  ),
  docx: (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
      <polyline points="14 2 14 8 20 8"/>
      <path d="M9 13h2l1 3 1-3h2" strokeWidth="1.6"/>
    </svg>
  ),
  pdf: (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
      <polyline points="14 2 14 8 20 8"/>
      <path d="M8 12h2a1.5 1.5 0 0 1 0 3H8v-3z" strokeWidth="1.5"/>
    </svg>
  ),
  mega: (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 6l4 6 4-6 4 6 4-6"/>
      <line x1="4" y1="18" x2="20" y2="18" strokeOpacity=".5"/>
    </svg>
  ),
  phylip: (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>
    </svg>
  ),
  nexus: (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10"/>
      <line x1="2" y1="12" x2="22" y2="12" strokeOpacity=".5"/>
      <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>
    </svg>
  ),
  seq: (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="4" y1="6" x2="20" y2="6"/><line x1="4" y1="10" x2="14" y2="10"/>
      <line x1="4" y1="14" x2="18" y2="14"/><line x1="4" y1="18" x2="12" y2="18"/>
    </svg>
  ),
  chunk: (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="8" height="8" rx="1"/><rect x="13" y="3" width="8" height="8" rx="1"/>
      <rect x="3" y="13" width="8" height="8" rx="1"/><rect x="13" y="13" width="8" height="8" rx="1"/>
    </svg>
  ),
  plus: (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
      <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
    </svg>
  ),
  eye: (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
      <circle cx="12" cy="12" r="3"/>
    </svg>
  ),
  warn: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10"/>
      <line x1="12" y1="8" x2="12" y2="12"/>
      <line x1="12" y1="16" x2="12.01" y2="16"/>
    </svg>
  ),
  alert: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
      <line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>
    </svg>
  ),
  close: (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
      <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
    </svg>
  ),
  gc: (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="2" width="20" height="20" rx="3"/>
      <path d="M8 12a4 4 0 1 0 4-4v4H8z"/>
    </svg>
  ),
};

/* Live status copy for the specimen bar while any operation runs. */
const BUSY_LABEL: Record<string, string> = {
  analyze: 'Reading sequence…',
  convert: 'Converting format…',
  report: 'Building report…',
  zip: 'Packing ZIP…',
  chunk: 'Preparing chunk…',
};

/* ── Format icons map ────────────────────────────────────────── */
const FORMAT_ICONS: Record<string, React.ReactNode> = {
  mega: Ic.mega, phylip: Ic.phylip, nexus: Ic.nexus,
  genbank: Ic.seq, fastq: Ic.seq, stockholm: Ic.seq, clustal: Ic.seq, embl: Ic.seq, newick: Ic.seq,
  txt: Ic.txt, docx: Ic.docx, pdf: Ic.pdf, xlsx: Ic.seq, csv: Ic.txt, html: Ic.report, json: Ic.seq,
};

const OUTPUT_EXTENSIONS: Record<string, string> = {
  mega: 'meg',
  phylip: 'phy',
  nexus: 'nex',
  genbank: 'gbk',
  fastq: 'fastq',
  stockholm: 'sto',
  clustal: 'aln',
  embl: 'embl',
  newick: 'nwk',
};

/* Neighbor-joining tree inference is O(n^3); the backend refuses Newick above
   this many sequences rather than tie up a worker. Mirrored here so the label
   and warning tell the truth before the request is even sent. */
const NEWICK_MAX_SEQUENCES = 200;

/* Mirrors Flask's MAX_CONTENT_LENGTH (app.py), stated before the upload so an
   oversized genome is refused with a clear message instead of a silent 413. */
const MAX_UPLOAD_MB = 100;

type FastaRecord = {
  id: string;
  length?: number;
  seq_preview?: string;
};

type FastaGcRecord = {
  id: string;
  gc_percent: number | string;
};

type FastaResult = {
  metadata?: {
    record_count?: number;
    total_bases?: number;
    records?: FastaRecord[];
  };
  gc_content?: {
    overall_gc_percent?: number | string;
    sequences?: FastaGcRecord[];
  };
};

const getErrorMessage = (err: unknown) => err instanceof Error ? err.message : 'Request failed';

/* The `/api/seq-tools` proxy forwards Flask's `{"error": ...}` body verbatim as
   the Next error string, so a failed download can reach us as raw nested JSON.
   Peel it back to the human sentence (once for the Next wrapper, once for the
   Flask body) so a Newick cap message reads as advice, not a JSON blob. */
const readApiError = async (res: Response): Promise<string> => {
  const raw = await res.text();
  const unwrap = (value: unknown): string | null => {
    if (typeof value !== 'string' || !value.trim()) return null;
    try {
      const parsed = JSON.parse(value);
      if (parsed && typeof parsed === 'object') {
        const inner = (parsed as { error?: unknown; message?: unknown }).error
          ?? (parsed as { error?: unknown; message?: unknown }).message;
        if (typeof inner === 'string') return unwrap(inner) ?? inner;
      }
    } catch {
      /* plain text, not JSON */
    }
    return value;
  };
  return unwrap(raw) ?? 'Request failed';
};

/* ── Sanger chromatogram intake ───────────────────────────────
   The empty state is a sequencing trace — the instrument's own
   read: a FASTA header, then four base-coloured peak traces over
   their base-call line. The call string is FIXED, never random:
   server and client must render identical bytes or hydration
   breaks. On drag-over the peaks resolve and the calls light in
   base colour left-to-right — the intake's one signature moment. */
const TRACE_HEAD = 'seq_0001 genomic scaffold, contig 12';
const TRACE_CALLS = 'GATTACAGCCTAGGCTAACGTTCGATACGT';

const BASE_FILL: Record<string, string> = {
  A: 'var(--ft-base-a)', C: 'var(--ft-base-c)',
  G: 'var(--ft-base-g)', T: 'var(--ft-base-t)',
};

/* Peak geometry is derived only from base + index, so the server
   and client always agree (no Math.random on the trace). */
const TRACE_VB_W = 600;
const TRACE_VB_H = 96;
const TRACE_BASE_Y = 72;
const TRACE_LETTER_Y = 90;

type TracePeak = { base: string; x: number; w: number; h: number };
const buildTrace = (calls: string): TracePeak[] => {
  const pad = 14;
  const span = (TRACE_VB_W - pad * 2) / calls.length;
  return Array.from(calls).map((base, i) => ({
    base,
    x: pad + span * (i + 0.5),
    w: span * 0.92,
    h: 22 + ((i * 7) % 20) + ('CG'.includes(base) ? 8 : 0),
  }));
};
const TRACE_PEAKS = buildTrace(TRACE_CALLS);

const Chromatogram = () => (
  <svg
    className="ft-chrom"
    viewBox={`0 0 ${TRACE_VB_W} ${TRACE_VB_H}`}
    aria-hidden="true"
  >
    {/* ruled baseline — the instrument's paper */}
    <line className="ft-chrom-rule" x1="14" y1={TRACE_BASE_Y} x2={TRACE_VB_W - 14} y2={TRACE_BASE_Y} />
    {TRACE_PEAKS.map((p, i) => {
      const fill = BASE_FILL[p.base];
      const half = p.w / 2;
      const d = `M ${p.x - half} ${TRACE_BASE_Y}`
        + ` C ${p.x - half * 0.5} ${TRACE_BASE_Y - p.h} ${p.x + half * 0.5} ${TRACE_BASE_Y - p.h} ${p.x + half} ${TRACE_BASE_Y}`;
      return (
        <path
          key={`peak-${i}`}
          className={`ft-chrom-peak ft-b-${p.base}`}
          d={d}
          style={{ fill, stroke: fill, '--i': i } as CSSProperties}
        />
      );
    })}
    {TRACE_PEAKS.map((p, i) => (
      <line key={`tick-${i}`} className="ft-chrom-tick" x1={p.x} y1={TRACE_BASE_Y} x2={p.x} y2={TRACE_BASE_Y + 4} />
    ))}
    {TRACE_PEAKS.map((p, i) => (
      <text
        key={`call-${i}`}
        className={`ft-chrom-call ft-b-${p.base}`}
        x={p.x}
        y={TRACE_LETTER_Y}
        textAnchor="middle"
        style={{ '--i': i } as CSSProperties}
      >
        {p.base}
      </text>
    ))}
  </svg>
);

/* ── Count-up (tabular numerals arrive, not just appear) ────── */
function useCountUp(target: number, duration = 650): number {
  const [val, setVal] = useState(0);
  useEffect(() => {
    const reduce = typeof window !== 'undefined'
      && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    let raf = 0;
    const t0 = performance.now();
    const tick = (t: number) => {
      const p = Math.min(1, (t - t0) / duration);
      setVal(Math.round(target * (1 - Math.pow(1 - p, 3))));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    // every setState runs inside a rAF callback, never synchronously
    // in the effect body (react-hooks/set-state-in-effect)
    if (target > 0 && !reduce) raf = requestAnimationFrame(tick);
    else raf = requestAnimationFrame(() => setVal(Math.max(0, target)));
    return () => cancelAnimationFrame(raf);
  }, [target, duration]);
  return val;
}

/* ── Calibrated GC scale — marks at 40 / 60, not hue-flipping ── */
const GCScale = ({ pct }: { pct: number }) => (
  <div className="ft-scale">
    <div className="ft-scale-fill" style={{ width: `${pct}%` }} />
    <span className="ft-scale-mark" style={{ left: '40%' }} aria-hidden="true" />
    <span className="ft-scale-mark" style={{ left: '60%' }} aria-hidden="true" />
    <span className="ft-scale-num" style={{ left: '40%' }} aria-hidden="true">40</span>
    <span className="ft-scale-num" style={{ left: '60%' }} aria-hidden="true">60</span>
  </div>
);

const RecGc = ({ pct }: { pct: number }) => (
  <span className="ft-rec-gc">
    <span className="ft-rec-gcnum">GC {pct.toFixed(1)}%</span>
    <span className="ft-rec-track" aria-hidden="true"><span className="ft-rec-fill" style={{ width: `${pct}%` }} /></span>
  </span>
);

/* ── Per-base sequence preview — the data is the only colour ── */
const BASE_CLASS: Record<string, string> = { A: 'ft-b-A', C: 'ft-b-C', G: 'ft-b-G', T: 'ft-b-T', U: 'ft-b-T' };
const renderSeqPreview = (s: string) => (
  <span className="ft-rec-seq">
    {Array.from(s).map((ch, i) => (
      <span key={i} className={BASE_CLASS[ch.toUpperCase()] ?? ''}>{ch}</span>
    ))}
  </span>
);

/* ── Segmented control (replaces bare radio rows) ───────────── */
type SegOption = { value: string; label: string };
const Seg = ({ options, value, onChange, label }: {
  options: SegOption[]; value: string; onChange: (v: string) => void; label: string;
}) => (
  <div className="ft-seg" role="group" aria-label={label}>
    {options.map(o => (
      <button
        key={o.value}
        type="button"
        className={`ft-seg-btn ${value === o.value ? 'on' : ''}`}
        aria-pressed={value === o.value}
        onClick={() => onChange(o.value)}
      >
        {o.label}
      </button>
    ))}
  </div>
);

/* ─────────────────────────────────────────────────────────────
   Component
   ───────────────────────────────────────────────────────────── */
export default function FastaTool() {
  const [file, setFile]               = useState<File | null>(null);
  const [loading, setLoading]         = useState(false);
  const [result, setResult]           = useState<FastaResult | null>(null);
  const [error, setError]             = useState<string | null>(null);
  const [targetFormat, setTargetFormat] = useState('mega');
  const [visibleRecords, setVisibleRecords] = useState(20);
  const [chunkSize, setChunkSize]     = useState(2000);
  const [customRanges, setCustomRanges] = useState<{ start: number; end: number }[]>([{ start: 1, end: 2000 }]);
  const [reportFormat, setReportFormat] = useState('txt');
  const [reportMaxSeq, setReportMaxSeq] = useState<number | 'all'>(1000);
  const [useCustomSeq, setUseCustomSeq] = useState(false);
  const [customReportSeq, setCustomReportSeq] = useState(1000);
  const [reportMode, setReportMode] = useState<'first' | 'range' | 'all'>('first');
  const [pdfReportType, setPdfReportType] = useState<'regular' | 'professional'>('regular');
  const [reportRangeStart, setReportRangeStart] = useState(1);
  const [reportRangeEnd, setReportRangeEnd] = useState(2000);
  const [activeSection, setActiveSection] = useState<'convert' | 'report' | 'chunk'>('convert');
  const [busyAction, setBusyAction] = useState<null | 'analyze' | 'convert' | 'report' | 'zip' | 'chunk'>(null);
  const [chunkBusy, setChunkBusy] = useState<{ start: number; end: number } | null>(null);
  const [analyzeState, setAnalyzeState] = useState<'idle' | 'busy' | 'done'>('idle');

  /* ── Dropzone ── */
  const onDrop = useCallback((accepted: File[]) => {
    const f = accepted[0];
    if (f && (f.name.endsWith('.fasta') || f.name.endsWith('.fa'))) {
      setFile(f); setError(null); setResult(null);
      setVisibleRecords(20);
      setCustomRanges([{ start: 1, end: 2000 }]); setReportMaxSeq(1000);
    } else {
      setError('Please upload a valid FASTA file (.fasta or .fa)');
    }
  }, []);
  const onDropRejected = useCallback((rejections: FileRejection[]) => {
    const tooLarge = rejections.some(r => r.errors.some(e => e.code === 'file-too-large'));
    setError(tooLarge
      ? `That file is over the ${MAX_UPLOAD_MB} MB limit.`
      : 'Please upload a valid FASTA file (.fasta or .fa)');
  }, []);
  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop, onDropRejected,
    multiple: false,
    maxSize: MAX_UPLOAD_MB * 1024 * 1024,
    /* Both keys are listed because a `.fasta` file often arrives with an empty
       or generic MIME type; dropzone falls back to the extension either way. */
    accept: { 'text/plain': ['.fasta', '.fa'], 'application/octet-stream': ['.fasta', '.fa'] },
  });

  /* ── Analyze ── */
  const handleAnalyze = async () => {
    if (!file) return;
    setLoading(true); setError(null); setBusyAction('analyze'); setAnalyzeState('busy');
    const formData = new FormData();
    formData.append('seq_file', file);
    try {
      const res = await toolRequest('/api/seq-tools?action=analyze', { method: 'POST', body: formData });
      if (!res.ok) throw new Error(await readApiError(res));
      const data = await res.json();
      setAnalyzeState('done');
      // let the drawn check land before the readout takes the button's place
      await new Promise(r => setTimeout(r, 650));
      setResult(data); setVisibleRecords(20);
    } catch (err: unknown) { setError(getErrorMessage(err)); }
    finally { setLoading(false); setBusyAction(null); setAnalyzeState('idle'); }
  };

  /* ── Convert full ── */
  const handleConvertFull = async () => {
    if (!file) return;
    setLoading(true); setError(null); setBusyAction('convert');
    const formData = new FormData();
    formData.append('seq_file', file);
    formData.append('target_format', targetFormat);
    try {
      const res = await toolRequest('/api/seq-tools?action=convert', { method: 'POST', body: formData });
      if (!res.ok) throw new Error(await readApiError(res));
      const blob = await res.blob();
      const ext = OUTPUT_EXTENSIONS[targetFormat] || targetFormat;
      downloadBlob(blob, `mycloove_converted.${ext}`);
    } catch (err: unknown) { setError(getErrorMessage(err)); }
    finally { setLoading(false); setBusyAction(null); }
  };

  /* ── Chunk download ── */
  const downloadChunk = async (start: number, end: number) => {
    if (!file) return;
    setLoading(true); setBusyAction('chunk'); setChunkBusy({ start, end });
    const formData = new FormData();
    formData.append('seq_file', file);
    formData.append('target_format', targetFormat);
    formData.append('start', start.toString());
    formData.append('end', end.toString());
    try {
      const res = await toolRequest('/api/seq-tools?action=chunk', { method: 'POST', body: formData });
      if (!res.ok) throw new Error(await readApiError(res));
      const blob = await res.blob();
      const ext = OUTPUT_EXTENSIONS[targetFormat] || targetFormat;
      downloadBlob(blob, `mycloove_chunk_${start}-${end}.${ext}`);
    } catch (err: unknown) { setError(getErrorMessage(err)); }
    finally { setLoading(false); setBusyAction(null); setChunkBusy(null); }
  };

  /* ── All chunks as ZIP ── */
  const downloadAllChunksAsZip = async () => {
    if (!file) return;
    setLoading(true); setBusyAction('zip');
    const formData = new FormData();
    formData.append('seq_file', file);
    formData.append('target_format', targetFormat);
    const chunkSizeForFormat = targetFormat === 'newick' ? Math.min(chunkSize, NEWICK_MAX_SEQUENCES) : chunkSize;
    formData.append('chunk_size', chunkSizeForFormat.toString());
    try {
      const res = await toolRequest('/api/seq-tools?action=chunks-zip', { method: 'POST', body: formData });
      if (!res.ok) throw new Error(await readApiError(res));
      const blob = await res.blob();
      const filename = `mycloove_chunks_${String(file.name).replace(/\.[^/.]+$/, '')}.zip`;
      downloadBlob(blob, filename);
    } catch (err: unknown) { setError(getErrorMessage(err)); }
    finally { setLoading(false); setBusyAction(null); }
  };

  /* ── Export report ── */
  const exportReport = async () => {
    if (!file) return;
    setLoading(true); setBusyAction('report');
    const formData = new FormData();
    formData.append('seq_file', file);
    formData.append('format', reportFormat);
    if (reportFormat === 'pdf') {
      formData.append('pdf_mode', pdfReportType);
    }

    if (reportMode === 'first') {
      if (useCustomSeq) {
        formData.append('max_seq', customReportSeq.toString());
      } else {
        formData.append('max_seq', reportMaxSeq === 'all' ? 'all' : reportMaxSeq.toString());
      }
    } else if (reportMode === 'range') {
      formData.append('start', reportRangeStart.toString());
      formData.append('end', reportRangeEnd.toString());
    } else { // all
      formData.append('all', 'true');
    }

    try {
      const res = await toolRequest('/api/seq-tools?action=export', { method: 'POST', body: formData });
      if (!res.ok) throw new Error(await readApiError(res));
      const blob = await res.blob();
      const reportFilename = `mycloove_report_${String(file.name).replace(/\.[^/.]+$/, '')}.${reportFormat}`;
      downloadBlob(blob, reportFilename);
    } catch (err: unknown) {
      setError(getErrorMessage(err));
    } finally {
      setLoading(false); setBusyAction(null);
    }
  };

  /* ── Custom ranges ── */
  const addCustomRange = () => setCustomRanges([...customRanges, { start: 1, end: 2000 }]);
  const updateCustomRange = (idx: number, field: 'start' | 'end', value: number) => {
    const r = [...customRanges]; r[idx][field] = value; setCustomRanges(r);
  };
  const removeCustomRange = (idx: number) => setCustomRanges(customRanges.filter((_, i) => i !== idx));

  /* ── Report limits ── */
  const getReportLimits = () => {
    if (reportFormat === 'txt')  return { safe: 50000, max: 100000, step: 5000 };
    if (reportFormat === 'docx') return { safe: 20000, max: 50000,  step: 2000 };
    if (reportFormat === 'pdf')  return { safe: 10000, max: 20000, step: 1000 };
    return { safe: 50000, max: 100000, step: 5000 };
  };
  const limit = getReportLimits();
  const options: number[] = [];
  for (let v = 500; v <= limit.safe; v += limit.step) options.push(v);
  if (!options.includes(limit.max)) options.push(limit.max);
  const uniqueOptions = [...new Set(options.filter(v => v <= limit.max))];

  const totalSeq = result?.metadata?.record_count || 0;
  const gcPct    = parseFloat(String(result?.gc_content?.overall_gc_percent ?? '0'));
  const fileSizeKB = file ? (file.size / 1024).toFixed(1) : '0';

  const shownSeq   = useCountUp(totalSeq);
  const shownBases = useCountUp(result?.metadata?.total_bases || 0);

  const newickOverCap = targetFormat === 'newick' && totalSeq > NEWICK_MAX_SEQUENCES;
  const showChunkSection = totalSeq > 2000 || newickOverCap;
  const convertWarns = newickOverCap;
  const effectiveChunkSize = targetFormat === 'newick'
    ? Math.min(chunkSize, NEWICK_MAX_SEQUENCES)
    : chunkSize;

  return (
    <>
      <style>{`
        /* ── The Reading Frame — token layer ─────────────────────
           Chrome consumes surface-1 global tokens (the bench law);
           only the data-encoding and status colours are local, and
           every local token is declared for BOTH themes. The four
           base colours are data encoding (they appear only where
           sequence letters render), not a chrome accent. */
        .ft-root {
          --ft-ease-out: cubic-bezier(0.16, 1, 0.3, 1);
          --ft-ease-in-out: cubic-bezier(0.4, 0, 0.2, 1);
          --ft-dur-fast: 120ms; --ft-dur-base: 200ms; --ft-dur-slow: 360ms;
          --ft-r-xs: 2px; --ft-r-sm: 6px; --ft-r-md: 10px;
          --ft-mono: ui-monospace, 'Cascadia Code', Consolas, Menlo, monospace;

          --ft-base-a: #82b37a; --ft-base-c: #76a5d8;
          --ft-base-g: #d3a94e; --ft-base-t: #d97f7f;

          --ft-chrom-letter: rgba(228,226,238,.34);
          --ft-chrom-caret: rgba(255,107,107,.38);
          --ft-chrom-rule: rgba(228,226,238,.12);
          --ft-chrom-scan: rgba(255,107,107,.72);
          --ft-bracket: rgba(228,226,238,.16);
          --ft-bracket-hover: rgba(228,226,238,.36);

          --ft-scale-at: rgba(228,226,238,.10);
          --ft-scale-marks: rgba(228,226,238,.30);

          --ft-amber: #e0a63f;
          --ft-amber-text: #e6c37c;
          --ft-amber-bg: rgba(224,166,63,.08);
          --ft-amber-line: rgba(224,166,63,.24);
          --ft-danger: #ff8f8f;
          --ft-danger-bg: rgba(255,90,90,.07);
          --ft-danger-line: rgba(255,90,90,.22);
          --ft-accent-glow: rgba(255,107,107,.24);

          display: flex; flex-direction: column; gap: 16px;
          font-family: 'DM Sans', sans-serif;
          max-width: 760px; margin: 0 auto;
        }
        [data-theme="light"] .ft-root {
          --ft-base-a: #477c3b; --ft-base-c: #2f5f9e;
          --ft-base-g: #8a6a00; --ft-base-t: #b03a3a;
          --ft-chrom-letter: rgba(24,27,38,.42);
          --ft-chrom-caret: rgba(219,88,74,.55);
          --ft-chrom-rule: rgba(24,27,38,.14);
          --ft-chrom-scan: rgba(219,88,74,.75);
          --ft-bracket: rgba(24,27,38,.20);
          --ft-bracket-hover: rgba(24,27,38,.42);
          --ft-scale-at: rgba(24,27,38,.10);
          --ft-scale-marks: rgba(24,27,38,.32);
          --ft-amber: #a8781a;
          --ft-amber-text: #6d5200;
          --ft-amber-bg: rgba(168,120,26,.09);
          --ft-amber-line: rgba(168,120,26,.28);
          --ft-danger: #c23a3a;
          --ft-danger-bg: rgba(194,58,58,.06);
          --ft-danger-line: rgba(194,58,58,.24);
        }

        /* ── Keyframes ── */
        @keyframes ft-rise    { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: none; } }
        @keyframes ft-spec-in { from { opacity: 0; transform: translateY(-10px) scale(.985); } to { opacity: 1; transform: none; } }
        @keyframes ft-scan    { from { transform: translateY(-60%); } to { transform: translateY(60%); } }
        @keyframes ft-scan-x  { from { transform: translateX(-2px); } to { transform: translateX(100%); } }
        @keyframes ft-fill    { from { width: 0; } }

        .ft-root :is(button, select, input):focus-visible {
          outline: 2px solid var(--accent-start); outline-offset: 2px;
        }

        /* ══ THE READING FRAME (drop zone) ══════════════════════ */
        .ft-zone {
          position: relative; cursor: pointer;
          padding: 30px 26px 26px;
          background: var(--bg-item);
          border-radius: var(--ft-r-md);
          transition: background var(--ft-dur-base) var(--ft-ease-in-out);
          animation: ft-rise var(--ft-dur-slow) var(--ft-ease-out) both;
        }
        .ft-zone:hover, .ft-zone.active { background: var(--bg-item-hover); }

        /* corner brackets — the frame that reads; no dashed border */
        .ft-brk {
          position: absolute; width: 16px; height: 16px; pointer-events: none;
          border: 0 solid var(--ft-bracket);
          transition: transform var(--ft-dur-base) var(--ft-ease-out),
                      border-color var(--ft-dur-base) var(--ft-ease-in-out);
        }
        .ft-brk-tl { top: 0;    left: 0;  border-top-width: 1.5px;    border-left-width: 1.5px; }
        .ft-brk-tr { top: 0;    right: 0; border-top-width: 1.5px;    border-right-width: 1.5px; }
        .ft-brk-bl { bottom: 0; left: 0;  border-bottom-width: 1.5px; border-left-width: 1.5px; }
        .ft-brk-br { bottom: 0; right: 0; border-bottom-width: 1.5px; border-right-width: 1.5px; }
        .ft-zone:hover .ft-brk { border-color: var(--ft-bracket-hover); }
        .ft-zone.active .ft-brk { border-color: var(--accent-start); }
        .ft-zone.active .ft-brk-tl { transform: translate(4px, 4px); }
        .ft-zone.active .ft-brk-tr { transform: translate(-4px, 4px); }
        .ft-zone.active .ft-brk-bl { transform: translate(4px, -4px); }
        .ft-zone.active .ft-brk-br { transform: translate(-4px, -4px); }
        .ft-zone.reject .ft-brk { border-color: var(--ft-danger); }
        .ft-zone:focus-visible { outline: 2px solid var(--accent-start); outline-offset: 3px; }

        /* sequencing trace — the grammar the parser reads, drawn as
           the instrument reads it */
        .ft-chrom-wrap { position: relative; margin-top: 8px; }
        .ft-chrom { display: block; width: 100%; height: auto; }

        .ft-chrom-head {
          font-family: var(--ft-mono);
          font-size: 11.5px; letter-spacing: .5px;
          color: var(--ft-chrom-letter);
          white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
        }
        .ft-chrom-head .ft-caret { color: var(--ft-chrom-caret); transition: color var(--ft-dur-base); }
        .ft-zone.active .ft-chrom-head .ft-caret { color: var(--accent-start); }

        .ft-chrom-rule, .ft-chrom-tick { stroke: var(--ft-chrom-rule); stroke-width: 1; }
        .ft-chrom-peak {
          opacity: .26; stroke-width: 1.25; stroke-linejoin: round;
          transition: opacity var(--ft-dur-base) var(--ft-ease-out);
          transition-delay: calc(var(--i) * 22ms);
        }
        .ft-chrom-call {
          font-family: var(--ft-mono); font-size: 9px; font-weight: 600;
          fill: var(--ft-chrom-letter);
          transition: fill var(--ft-dur-base) var(--ft-ease-out);
          transition-delay: calc(var(--i) * 22ms);
        }
        .ft-zone.active .ft-chrom-peak { opacity: 1; }
        .ft-zone.active .ft-chrom-call.ft-b-A { fill: var(--ft-base-a); }
        .ft-zone.active .ft-chrom-call.ft-b-C { fill: var(--ft-base-c); }
        .ft-zone.active .ft-chrom-call.ft-b-G { fill: var(--ft-base-g); }
        .ft-zone.active .ft-chrom-call.ft-b-T { fill: var(--ft-base-t); }

        /* the read head sweeps the frame once as the trace resolves
           (transform-only; settles off-frame under reduced motion) */
        .ft-chrom-scan {
          position: absolute; inset: 0; pointer-events: none; opacity: 0;
        }
        .ft-chrom-scan::before {
          content: ''; position: absolute; top: 0; bottom: 0; left: 0; width: 2px;
          background: linear-gradient(180deg, transparent, var(--ft-chrom-scan), transparent);
        }
        .ft-zone.active .ft-chrom-scan { opacity: 1; animation: ft-scan-x 1.05s var(--ft-ease-in-out) 1 both; }

        .ft-zone.active .ft-zone-title { display: flex; align-items: center; gap: 8px; }

        .ft-zone-title {
          font-family: 'Manrope', sans-serif; font-size: 15px; font-weight: 700;
          color: var(--text-primary); margin: 20px 0 0;
        }
        .ft-zone-sub { font-size: 12px; color: var(--text-muted); margin: 5px 0 0; }
        .ft-zone-hint {
          font-family: var(--ft-mono); font-size: 10px; letter-spacing: .4px;
          color: var(--text-faint); margin: 12px 0 0;
        }
        .ft-zone-reject {
          font-size: 12px; font-weight: 500;
          color: var(--ft-danger); margin: 10px 0 0;
        }

        /* ══ SPECIMEN BAR ═══════════════════════════════════════
           The zone's replacement once a file is loaded. Deliberately
           not sticky: the shared ToolWorkspace surface uses
           overflow:hidden, which would swallow sticky positioning —
           reliability over flourish. Its left edge scans while any
           operation runs (the instrument is sampling). */
        .ft-spec {
          position: relative; overflow: hidden;
          display: flex; align-items: center; gap: 14px;
          padding: 13px 16px;
          background: var(--bg-card);
          border: 1px solid var(--border-card);
          border-radius: var(--ft-r-md);
          box-shadow: var(--shadow-card);
          animation: ft-spec-in var(--ft-dur-slow) var(--ft-ease-out) both;
        }
        .ft-spec::before {
          content: ''; position: absolute; left: 0; top: -50%; bottom: -50%; width: 2.5px;
          background: linear-gradient(180deg, transparent, var(--accent-start), transparent);
          opacity: 0;
        }
        .ft-root[data-loading="true"] .ft-spec::before {
          opacity: 1; animation: ft-scan 1.6s linear infinite;
        }
        /* base fingerprint — the sample's own four-colour mark */
        .ft-spec-mark {
          flex-shrink: 0;
          display: inline-flex; align-items: flex-end; gap: 3px;
          width: 34px; height: 34px; padding: 7px;
          background: var(--bg-item);
          border: 1px solid var(--border-base);
          border-radius: var(--ft-r-sm);
        }
        .ft-spec-band { display: block; width: 3px; border-radius: 1px; }
        .ft-spec-band.ft-b-A { height: 62%; background: var(--ft-base-a); }
        .ft-spec-band.ft-b-C { height: 100%; background: var(--ft-base-c); }
        .ft-spec-band.ft-b-G { height: 46%; background: var(--ft-base-g); }
        .ft-spec-band.ft-b-T { height: 82%; background: var(--ft-base-t); }

        .ft-spec-id { min-width: 0; flex: 1 1 auto; display: flex; flex-direction: column; gap: 4px; }
        .ft-spec-name {
          font-family: var(--ft-mono); font-size: 13px; font-weight: 600;
          color: var(--text-primary);
          white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
          margin: 0;
        }
        .ft-spec-meta {
          display: flex; align-items: center; gap: 9px; flex-wrap: wrap;
          font-family: var(--ft-mono); font-size: 10.5px; letter-spacing: .2px;
          font-variant-numeric: tabular-nums; color: var(--text-muted);
        }
        .ft-spec-size { color: var(--text-secondary); }
        .ft-spec-dot { width: 3px; height: 3px; border-radius: 50%; background: var(--text-faint); flex-shrink: 0; }
        .ft-spec-tag {
          font-size: 9px; font-weight: 700; letter-spacing: .8px; text-transform: uppercase;
          color: var(--text-muted); border: 1px solid var(--border-base);
          border-radius: var(--ft-r-xs); padding: 1px 6px;
        }
        .ft-spec-state { color: var(--text-faint); }
        .ft-spec-status {
          display: inline-flex; align-items: center; gap: 7px;
          color: var(--accent-start);
          animation: ft-rise var(--ft-dur-base) var(--ft-ease-out) both;
        }
        .ft-spec-x {
          margin-left: auto; flex-shrink: 0;
          display: inline-flex; align-items: center; gap: 5px;
          font-size: 11px; font-weight: 600;
          color: var(--text-muted);
          padding: 6px 10px; border-radius: var(--ft-r-sm);
          border: 1px solid var(--border-base); background: transparent; cursor: pointer;
          transition: color var(--ft-dur-fast), background var(--ft-dur-fast), border-color var(--ft-dur-fast);
        }
        .ft-spec-x:hover {
          color: var(--ft-danger); background: var(--ft-danger-bg); border-color: var(--ft-danger-line);
        }

        /* ── Analyze row — the instrument's ready strip ── */
        .ft-analyze-row {
          display: flex; align-items: center; gap: 12px; flex-wrap: wrap;
          animation: ft-rise var(--ft-dur-slow) var(--ft-ease-out) both;
        }
        .ft-analyze-hint {
          font-family: var(--ft-mono); font-size: 10px; letter-spacing: .6px;
          text-transform: uppercase; color: var(--text-faint);
        }
        .ft-analyze-caps { display: inline-flex; flex-wrap: wrap; gap: 6px; }
        .ft-analyze-cap {
          font-family: var(--ft-mono); font-size: 10px; letter-spacing: .2px;
          color: var(--text-muted); border: 1px solid var(--border-base);
          border-radius: var(--ft-r-xs); padding: 3px 8px;
        }

        /* ── Error strip ── */
        .ft-err {
          display: flex; align-items: flex-start; gap: 10px;
          padding: 11px 14px;
          background: var(--ft-danger-bg);
          border: 1px solid var(--ft-danger-line);
          border-radius: var(--ft-r-sm);
          font-size: 12.5px; color: var(--ft-danger); line-height: 1.55;
          animation: ft-rise var(--ft-dur-base) var(--ft-ease-out) both;
        }
        .ft-err-icon {
          width: 22px; height: 22px; border-radius: var(--ft-r-xs); flex-shrink: 0;
          border: 1px solid var(--ft-danger-line);
          display: flex; align-items: center; justify-content: center; margin-top: 1px;
        }

        /* ══ READOUT STRIP — 2 counts + 1 calibrated scale ══════ */
        .ft-readout {
          display: grid; grid-template-columns: 1fr 1fr 1.35fr; gap: 10px;
          animation: ft-rise var(--ft-dur-slow) var(--ft-ease-out) both;
        }
        .ft-ro {
          padding: 14px 16px;
          background: var(--bg-item);
          border: 1px solid var(--border-base);
          border-radius: var(--ft-r-md);
          min-width: 0;
        }
        .ft-ro-label {
          display: flex; align-items: center; gap: 6px;
          font-size: 9px; font-weight: 700; letter-spacing: 1px; text-transform: uppercase;
          color: var(--text-faint);
        }
        .ft-ro-label svg { color: var(--accent-start); opacity: .9; flex-shrink: 0; }
        .ft-ro-val {
          font-family: var(--ft-mono); font-variant-numeric: tabular-nums;
          font-size: clamp(20px, 3vw, 25px); font-weight: 600; letter-spacing: -.5px;
          color: var(--text-primary); margin-top: 9px;
        }
        .ft-ro-unit { font-size: .6em; color: var(--text-muted); margin-left: 2px; }
        .ft-ro-sub { font-size: 10px; color: var(--text-muted); margin-top: 3px; }

        .ft-scale { position: relative; height: 6px; margin-top: 14px; margin-bottom: 13px; }
        .ft-scale-fill {
          position: absolute; inset: 0 auto 0 0;
          background: var(--text-primary); opacity: .82;
          border-radius: var(--ft-r-xs);
          animation: ft-fill .6s var(--ft-ease-out) both;
          transition: width .6s var(--ft-ease-out);
        }
        .ft-scale-mark {
          position: absolute; top: -3px; bottom: -3px; width: 1.5px;
          background: var(--ft-scale-marks);
        }
        .ft-scale-num {
          position: absolute; top: 9px; transform: translateX(-50%);
          font-family: var(--ft-mono); font-size: 8px; color: var(--text-faint);
        }

        /* ══ OPERATION RAIL ═════════════════════════════════════ */
        .ft-tabs { display: flex; gap: 4px; animation: ft-rise var(--ft-dur-slow) var(--ft-ease-out) both; }
        .ft-tab {
          flex: 1; display: flex; align-items: center; justify-content: center; gap: 7px;
          padding: 9px 12px;
          background: var(--bg-item);
          border: 1px solid var(--border-base);
          border-radius: var(--ft-r-sm);
          font-family: 'Manrope', sans-serif; font-size: 12px; font-weight: 700;
          color: var(--text-muted); cursor: pointer;
          transition: color var(--ft-dur-fast), background var(--ft-dur-fast), border-color var(--ft-dur-fast);
        }
        .ft-tab-caret {
          font-family: var(--ft-mono); font-weight: 700; font-size: 12px;
          color: var(--text-faint); transition: color var(--ft-dur-fast);
        }
        .ft-tab:hover { color: var(--text-primary); }
        .ft-tab.on {
          background: var(--bg-card); color: var(--text-primary);
          border-color: var(--border-item-active);
          box-shadow: inset 0 -2px 0 var(--accent-start);
        }
        .ft-tab.on .ft-tab-caret { color: var(--accent-start); }
        .ft-tab-dot {
          width: 6px; height: 6px; border-radius: 50%;
          background: var(--ft-amber); flex-shrink: 0;
        }

        .ft-panel {
          position: relative;
          background: var(--bg-card);
          border: 1px solid var(--border-card);
          border-radius: var(--ft-r-md); overflow: hidden;
          animation: ft-rise var(--ft-dur-slow) var(--ft-ease-out) both;
        }
        .ft-panel-head {
          display: flex; align-items: center; gap: 8px;
          padding: 12px 16px;
          border-bottom: 1px solid var(--border-base);
          font-family: 'Manrope', sans-serif; font-size: 12.5px; font-weight: 700;
          color: var(--text-primary);
        }
        .ft-panel-head svg { color: var(--text-muted); flex-shrink: 0; }
        .ft-panel-head .ft-panel-count {
          margin-left: auto; font-family: var(--ft-mono); font-size: 10.5px; font-weight: 400;
          color: var(--text-muted); font-variant-numeric: tabular-nums;
        }
        .ft-panel-body { padding: 16px; display: flex; flex-direction: column; gap: 14px; }

        /* ── Controls ── */
        .ft-lbl {
          font-family: 'Manrope', sans-serif; font-size: 9.5px; font-weight: 700;
          letter-spacing: 1.2px; text-transform: uppercase;
          color: var(--text-faint); display: block; margin-bottom: 7px;
        }
        .ft-select-wrap { position: relative; }
        .ft-select-icon {
          position: absolute; left: 10px; top: 50%; transform: translateY(-50%);
          pointer-events: none; color: var(--text-muted);
          display: flex; align-items: center;
        }
        .ft-select {
          width: 100%; appearance: none; -webkit-appearance: none;
          background: var(--bg-item);
          border: 1px solid var(--border-base);
          border-radius: var(--ft-r-sm); padding: 9px 28px 9px 32px;
          font-size: 12.5px; color: var(--text-primary);
          cursor: pointer;
          background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6' viewBox='0 0 10 6'%3E%3Cpath d='M0 0l5 6 5-6z' fill='%23888'/%3E%3C/svg%3E");
          background-repeat: no-repeat; background-position: right 10px center;
          transition: border-color var(--ft-dur-fast);
        }
        .ft-select option { background: #1c1b25; color: #e4e2ee; }

        .ft-seg {
          display: inline-flex; flex-wrap: wrap; gap: 2px; padding: 3px;
          background: var(--bg-item);
          border: 1px solid var(--border-base);
          border-radius: var(--ft-r-sm);
        }
        .ft-seg-btn {
          padding: 6px 12px; border: none; background: transparent;
          border-radius: 4px;
          font-size: 12px; font-weight: 600;
          color: var(--text-muted); cursor: pointer;
          transition: background var(--ft-dur-fast), color var(--ft-dur-fast);
        }
        .ft-seg-btn:hover { color: var(--text-primary); }
        .ft-seg-btn.on {
          background: var(--bg-card); color: var(--text-primary);
          box-shadow: inset 0 0 0 1px var(--border-base);
        }

        /* ── Buttons: one primary (coral), everything else ghost ── */
        .ft-btn-primary {
          display: inline-flex; align-items: center; justify-content: center; gap: 8px;
          padding: 10px 18px; border: none;
          border-radius: var(--ft-r-sm);
          background: linear-gradient(135deg, var(--accent-start), var(--accent-end));
          color: #fff;
          font-family: 'Manrope', sans-serif; font-size: 13px; font-weight: 700;
          cursor: pointer;
          box-shadow: 0 4px 16px var(--ft-accent-glow);
          transition: transform var(--ft-dur-fast) var(--ft-ease-out),
                      box-shadow var(--ft-dur-fast), opacity var(--ft-dur-fast);
        }
        .ft-btn-primary:hover:not(:disabled) {
          transform: translateY(-1px);
          box-shadow: 0 6px 22px var(--ft-accent-glow);
        }
        .ft-btn-primary:active:not(:disabled) { transform: translateY(0); }
        .ft-btn-primary:disabled { opacity: .45; cursor: not-allowed; }

        .ft-btn-ghost {
          display: inline-flex; align-items: center; gap: 7px;
          padding: 8px 14px;
          background: transparent;
          border: 1px solid var(--border-base);
          border-radius: var(--ft-r-sm);
          color: var(--text-secondary);
          font-size: 12px; font-weight: 600;
          cursor: pointer;
          transition: background var(--ft-dur-fast), color var(--ft-dur-fast), border-color var(--ft-dur-fast), opacity var(--ft-dur-fast);
        }
        .ft-btn-ghost:hover:not(:disabled) {
          background: var(--bg-item-hover); color: var(--text-primary);
          border-color: var(--border-item-active);
        }
        .ft-btn-ghost:disabled { opacity: .42; cursor: not-allowed; }
        .ft-btn-ghost.danger:hover:not(:disabled) {
          color: var(--ft-danger); background: var(--ft-danger-bg); border-color: var(--ft-danger-line);
        }

        /* ── Warning strip ── */
        .ft-warn {
          display: flex; align-items: flex-start; gap: 9px;
          padding: 10px 13px;
          background: var(--ft-amber-bg);
          border: 1px solid var(--ft-amber-line);
          border-radius: var(--ft-r-sm);
          font-size: 12px; color: var(--ft-amber-text); line-height: 1.55;
        }
        .ft-warn svg { flex-shrink: 0; color: var(--ft-amber); margin-top: 1px; }

        /* ── Numbers / hints ── */
        .ft-num {
          width: 76px;
          background: var(--bg-item);
          border: 1px solid var(--border-base);
          border-radius: var(--ft-r-xs); padding: 6px 9px;
          font-family: var(--ft-mono); font-variant-numeric: tabular-nums;
          font-size: 12px; color: var(--text-primary);
          transition: border-color var(--ft-dur-fast);
        }
        .ft-hint { font-size: 10.5px; color: var(--text-faint); line-height: 1.5; }
        .ft-hint-mono {
          font-family: var(--ft-mono); font-size: 10px; letter-spacing: .3px;
          color: var(--text-faint); font-variant-numeric: tabular-nums;
        }
        .ft-row { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }

        /* ── Chunk list ── */
        .ft-chunk-list {
          max-height: 200px; overflow-y: auto;
          display: flex; flex-direction: column; gap: 5px;
          scrollbar-width: thin; scrollbar-color: var(--border-base) transparent;
        }
        .ft-chunk-row {
          display: flex; align-items: center; justify-content: space-between; gap: 10px;
          padding: 7px 11px;
          background: var(--bg-item);
          border: 1px solid var(--border-base);
          border-radius: var(--ft-r-sm);
          font-family: var(--ft-mono); font-variant-numeric: tabular-nums;
          font-size: 11px; color: var(--text-muted);
        }
        .ft-chunk-dl {
          display: inline-flex; align-items: center; gap: 5px;
          color: var(--text-secondary); cursor: pointer;
          font-family: 'DM Sans', sans-serif; font-size: 11px; font-weight: 600;
          background: none; border: none; padding: 3px 6px; border-radius: var(--ft-r-xs);
          transition: color var(--ft-dur-fast), background var(--ft-dur-fast);
        }
        .ft-chunk-dl:hover:not(:disabled) { color: var(--accent-start); background: var(--bg-item-hover); }
        .ft-chunk-dl:disabled { opacity: .42; cursor: not-allowed; }

        .ft-range-row { display: flex; align-items: center; gap: 7px; flex-wrap: wrap; }

        /* ══ SEQUENCE LEDGER ════════════════════════════════════ */
        .ft-ledger {
          display: flex; flex-direction: column; gap: 6px;
          max-height: 380px; overflow-y: auto;
          scrollbar-width: thin; scrollbar-color: var(--border-base) transparent;
        }
        .ft-rec {
          padding: 10px 13px;
          background: var(--bg-item);
          border: 1px solid var(--border-base);
          border-radius: var(--ft-r-sm);
          animation: ft-rise .28s var(--ft-ease-out) both;
        }
        .ft-rec-id {
          display: flex; align-items: baseline; gap: 6px;
          font-family: var(--ft-mono); font-size: 11.5px; font-weight: 600;
          color: var(--text-primary);
          white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
        }
        .ft-rec-id .ft-caret { color: var(--accent-start); flex-shrink: 0; }
        .ft-rec-meta {
          display: flex; align-items: center; flex-wrap: wrap; gap: 12px;
          font-size: 10.5px; color: var(--text-muted); margin-top: 4px;
          font-variant-numeric: tabular-nums;
        }
        .ft-rec-meta strong { color: var(--text-primary); font-weight: 600; }
        .ft-rec-gc { display: inline-flex; align-items: center; gap: 6px; }
        .ft-rec-gcnum { font-family: var(--ft-mono); font-size: 10px; }
        .ft-rec-track {
          position: relative; width: 44px; height: 4px;
          background: var(--ft-scale-at); border-radius: var(--ft-r-xs); overflow: hidden;
        }
        .ft-rec-fill {
          position: absolute; inset: 0 auto 0 0;
          background: var(--text-primary); opacity: .7;
          border-radius: var(--ft-r-xs);
        }
        .ft-rec-seq {
          font-family: var(--ft-mono); font-size: 10px; letter-spacing: 1px;
          margin-top: 5px; line-height: 1.6; word-break: break-all;
        }
        .ft-rec-seq .ft-b-A { color: var(--ft-base-a); }
        .ft-rec-seq .ft-b-C { color: var(--ft-base-c); }
        .ft-rec-seq .ft-b-G { color: var(--ft-base-g); }
        .ft-rec-seq .ft-b-T { color: var(--ft-base-t); }
        .ft-load-more {
          display: flex; align-items: center; justify-content: center; gap: 6px;
          padding: 9px; margin-top: 10px;
          border: 1px dashed var(--border-base);
          border-radius: var(--ft-r-sm);
          font-family: var(--ft-mono); font-variant-numeric: tabular-nums;
          font-size: 11px; font-weight: 600; color: var(--text-secondary);
          cursor: pointer; background: none; width: 100%;
          transition: color var(--ft-dur-fast), border-color var(--ft-dur-fast), background var(--ft-dur-fast);
        }
        .ft-load-more:hover { color: var(--text-primary); border-color: var(--border-item-active); background: var(--bg-item-hover); }

        /* ── Responsive ── */
        @media (max-width: 640px) {
          .ft-readout { grid-template-columns: 1fr 1fr; }
          .ft-ro-gc { grid-column: 1 / -1; }
          .ft-scale-num { display: none; }
          .ft-tabs { flex-wrap: wrap; }
          .ft-tab { flex: 1 1 45%; }
          .ft-spec-tag, .ft-spec-dot { display: none; }
          .ft-spec-x span { display: none; }
          .ft-chrom-head { font-size: 10px; }
          .ft-zone { padding: 24px 18px 20px; }
        }

        /* ── Reduced motion: the cascade becomes an instant state,
              the scan becomes a steady edge, arrivals render final ── */
        @media (prefers-reduced-motion: reduce) {
          .ft-root *, .ft-root *::before, .ft-root *::after {
            animation-duration: .01ms !important;
            animation-iteration-count: 1 !important;
            transition-duration: .01ms !important;
            transition-delay: 0s !important;
          }
          .ft-root[data-loading="true"] .ft-spec::before {
            animation: none; background: var(--accent-start);
          }
        }
      `}</style>

      <div className="ft-root" data-loading={loading ? 'true' : 'false'} aria-busy={loading}>

        {/* ══ THE READING FRAME ═════════════════════════════════ */}
        {!file ? (
          <div
            {...getRootProps({ role: 'button', 'aria-label': 'Drop your FASTA file here, or press Enter to browse' })}
            className={`ft-zone ${isDragActive ? 'active' : ''} ${error ? 'reject' : ''}`}
          >
            <input {...getInputProps()} />
            <span className="ft-brk ft-brk-tl" aria-hidden="true" />
            <span className="ft-brk ft-brk-tr" aria-hidden="true" />
            <span className="ft-brk ft-brk-bl" aria-hidden="true" />
            <span className="ft-brk ft-brk-br" aria-hidden="true" />

            <div className="ft-chrom-head" aria-hidden="true">
              <span className="ft-caret">&gt;</span>{TRACE_HEAD}
            </div>
            <div className="ft-chrom-wrap" aria-hidden="true">
              <Chromatogram />
              <span className="ft-chrom-scan" />
            </div>

            <p className="ft-zone-title">
              {isDragActive ? (
                <>
                  <HelixLoader size={16} columns={5} tone="bases" decorative />
                  Release to sequence
                </>
              ) : 'Drop your FASTA file'}
            </p>
            <p className="ft-zone-sub">
              {isDragActive ? 'The trace resolves the moment it lands' : 'DNA · RNA · protein — read, converted, exported'}
            </p>
            <p className="ft-zone-hint">
              {isDragActive ? 'reading frame: ATGC' : 'accepts .fasta / .fa — click anywhere in the frame to browse'}
            </p>

            {error && (
              <p className="ft-zone-reject" role="alert">{error}</p>
            )}
          </div>
        ) : (
          <>
            {/* ══ SPECIMEN BAR ══════════════════════════════════ */}
            <div className="ft-spec">
              <span className="ft-spec-mark" aria-hidden="true">
                <i className="ft-spec-band ft-b-A" />
                <i className="ft-spec-band ft-b-C" />
                <i className="ft-spec-band ft-b-G" />
                <i className="ft-spec-band ft-b-T" />
              </span>
              <div className="ft-spec-id">
                <p className="ft-spec-name">{file.name}</p>
                <div className="ft-spec-meta">
                  <span className="ft-spec-size">{fileSizeKB} KB</span>
                  <span className="ft-spec-dot" aria-hidden="true" />
                  <span className="ft-spec-tag">FASTA</span>
                  <span className="ft-spec-dot" aria-hidden="true" />
                  {loading ? (
                    <span className="ft-spec-status">
                      <HelixLoader size={13} columns={5} tone="bases" decorative />
                      <span>{analyzeState === 'done' ? 'Read complete' : BUSY_LABEL[busyAction ?? 'analyze']}</span>
                    </span>
                  ) : (
                    <span className="ft-spec-state">{result?.metadata ? 'Read' : 'Awaiting read'}</span>
                  )}
                </div>
              </div>
              <button
                type="button"
                className="ft-spec-x"
                onClick={() => { setFile(null); setResult(null); setError(null); }}
                aria-label="Remove file"
              >
                {Ic.close} <span>Remove</span>
              </button>
            </div>

            {/* ── First read ── */}
            {!result?.metadata && (
              <div className="ft-analyze-row">
                <HelixButton
                  state={analyzeState}
                  idle={<>{Ic.analyze} Analyze Sequences</>}
                  busyLabel="Reading…"
                  doneLabel="Read"
                  onClick={handleAnalyze}
                  disabled={loading}
                />
                <span className="ft-analyze-hint">reads</span>
                <span className="ft-analyze-caps">
                  <span className="ft-analyze-cap">records</span>
                  <span className="ft-analyze-cap">total bases</span>
                  <span className="ft-analyze-cap">GC content</span>
                </span>
              </div>
            )}

            {/* ── Error (request failures once a file is loaded) ── */}
            {error && (
              <div className="ft-err" role="alert">
                <div className="ft-err-icon">{Ic.alert}</div>
                <div>
                  <div style={{ fontWeight: 600, marginBottom: 2 }}>Request failed</div>
                  <div>{error}</div>
                </div>
              </div>
            )}
          </>
        )}

        {/* ══ READOUT + OPERATIONS + LEDGER ═════════════════════ */}
        {result?.metadata && (
          <>
            {/* Readout strip: 2 counts + 1 calibrated scale */}
            <div className="ft-readout" role="status">
              <div className="ft-ro">
                <div className="ft-ro-label">{Ic.seq}<span>Records</span></div>
                <div className="ft-ro-val">{shownSeq.toLocaleString()}</div>
                <div className="ft-ro-sub">sequences read</div>
              </div>
              <div className="ft-ro">
                <div className="ft-ro-label">{Ic.seq}<span>Total bases</span></div>
                <div className="ft-ro-val">{shownBases.toLocaleString()}</div>
                <div className="ft-ro-sub">base pairs</div>
              </div>
              <div className="ft-ro ft-ro-gc">
                <div className="ft-ro-label">{Ic.gc}<span>GC content</span></div>
                <div className="ft-ro-val">{gcPct.toFixed(1)}<span className="ft-ro-unit">%</span></div>
                <GCScale pct={gcPct} />
              </div>
            </div>

            {/* Operation rail */}
            <div className="ft-tabs" role="tablist" aria-label="Sequence operations">
              <button
                type="button"
                role="tab"
                aria-selected={activeSection === 'convert'}
                className={`ft-tab ${activeSection === 'convert' ? 'on' : ''}`}
                onClick={() => setActiveSection('convert')}
              >
                <span className="ft-tab-caret" aria-hidden="true">&gt;</span> Convert
                {convertWarns && <span className="ft-tab-dot" title="Sequence count exceeds this format's practical limit" />}
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={activeSection === 'report'}
                className={`ft-tab ${activeSection === 'report' ? 'on' : ''}`}
                onClick={() => setActiveSection('report')}
              >
                <span className="ft-tab-caret" aria-hidden="true">&gt;</span> Report
              </button>
              {showChunkSection && (
                <button
                  type="button"
                  role="tab"
                  aria-selected={activeSection === 'chunk'}
                  className={`ft-tab ${activeSection === 'chunk' ? 'on' : ''}`}
                  onClick={() => setActiveSection('chunk')}
                >
                  <span className="ft-tab-caret" aria-hidden="true">&gt;</span> Chunk
                </button>
              )}
            </div>

            {/* ── Convert panel ── */}
            {activeSection === 'convert' && (
              <div className="ft-panel" role="tabpanel" aria-label="Convert">
                <div className="ft-panel-head">{Ic.convert} Target Format</div>
                <div className="ft-panel-body">
                  <div>
                    <span className="ft-lbl">Output format</span>
                    <div className="ft-select-wrap">
                      <span className="ft-select-icon">{FORMAT_ICONS[targetFormat]}</span>
                      <select className="ft-select" value={targetFormat} onChange={e => setTargetFormat(e.target.value)}>
                        <option value="mega">MEGA (.meg) — no sequence limit</option>
                        <option value="phylip">PHYLIP (.phy) — 10-char names</option>
                        <option value="nexus">NEXUS (.nex)</option>
                        <option value="genbank">GenBank (.gbk)</option>
                        <option value="fastq">FASTQ (.fastq)</option>
                        <option value="stockholm">Stockholm (.sto)</option>
                        <option value="clustal">Clustal (.aln)</option>
                        <option value="embl">EMBL (.embl)</option>
                        <option value="newick">Newick (.nwk) — tree, ≤{NEWICK_MAX_SEQUENCES} sequences</option>
                      </select>
                    </div>
                  </div>
                  {convertWarns && (
                    <div className="ft-warn">
                      {Ic.warn}
                      <span>
                        {totalSeq.toLocaleString()} sequences detected. Tree generation supports up to{' '}
                        {NEWICK_MAX_SEQUENCES} sequences — use the <strong>Chunk</strong> tab to split.
                      </span>
                    </div>
                  )}
                  <button type="button" className="ft-btn-primary" style={{ alignSelf: 'flex-start' }} onClick={handleConvertFull} disabled={loading}>
                    {Ic.download} Download Conversion
                  </button>
                </div>
                {busyAction === 'convert' && <HelixOverlay label="Converting sequences…" />}
              </div>
            )}

            {/* ── Report panel ── */}
            {activeSection === 'report' && (
              <div className="ft-panel" role="tabpanel" aria-label="Export report">
                <div className="ft-panel-head">{Ic.report} Export Analysis Report</div>
                <div className="ft-panel-body">

                  <div>
                    <span className="ft-lbl">Report format</span>
                    <div className="ft-select-wrap">
                      <span className="ft-select-icon">{FORMAT_ICONS[reportFormat]}</span>
                      <select
                        className="ft-select"
                        value={reportFormat}
                        onChange={e => {
                          setReportFormat(e.target.value);
                          // reset to default safe limit when format changes
                          const newLimit = getReportLimits().safe;
                          setReportMaxSeq(newLimit);
                          setUseCustomSeq(false);
                          setReportMode('first');
                          if (e.target.value !== 'pdf') setPdfReportType('regular');
                        }}
                      >
                        <option value="pdf">PDF Document (.pdf) — max 20,000</option>
                        <option value="docx">Word Document (.docx) — max 50,000</option>
                        <option value="xlsx">Excel (.xlsx) - max 100,000</option>
                        <option value="txt">Plain Text (.txt) — max 100,000 sequences</option>
                        <option value="csv">CSV (.csv) - max 100,000</option>
                        <option value="html">HTML (.html) - max 100,000</option>
                        <option value="json">JSON (.json) - max 100,000</option>
                      </select>
                    </div>
                  </div>

                  {reportFormat === 'pdf' && (
                    <div>
                      <span className="ft-lbl">PDF report type</span>
                      <Seg
                        label="PDF report type"
                        value={pdfReportType}
                        onChange={v => setPdfReportType(v as 'regular' | 'professional')}
                        options={[
                          { value: 'regular', label: 'Regular' },
                          { value: 'professional', label: 'Professional Lab' },
                        ]}
                      />
                    </div>
                  )}

                  <div>
                    <span className="ft-lbl">What to include</span>
                    <Seg
                      label="What to include"
                      value={reportMode}
                      onChange={v => setReportMode(v as 'first' | 'range' | 'all')}
                      options={[
                        { value: 'first', label: 'First N' },
                        { value: 'range', label: 'Range' },
                        { value: 'all', label: 'All sequences' },
                      ]}
                    />

                    {reportMode === 'first' && (
                      <div className="ft-select-wrap" style={{ marginTop: 8 }}>
                        <span className="ft-select-icon">{Ic.seq}</span>
                        <select
                          className="ft-select"
                          value={useCustomSeq ? 'custom' : (reportMaxSeq === 'all' ? 'all' : reportMaxSeq)}
                          onChange={e => {
                            const val = e.target.value;
                            if (val === 'custom') {
                              setUseCustomSeq(true);
                              setReportMaxSeq(Math.min(customReportSeq, getReportLimits().max));
                            } else if (val === 'all') {
                              setUseCustomSeq(false);
                              setReportMaxSeq('all');
                            } else {
                              setUseCustomSeq(false);
                              setReportMaxSeq(Number(val));
                            }
                          }}
                        >
                          {uniqueOptions.map(opt => (
                            <option key={opt} value={opt}>First {opt.toLocaleString()} sequences</option>
                          ))}
                          {limit.max > limit.safe && (
                            <option value={limit.max}>First {limit.max.toLocaleString()} (max allowed)</option>
                          )}
                          <option value="all">All sequences (capped at format limit)</option>
                          <option value="custom">Custom …</option>
                        </select>
                      </div>
                    )}

                    {reportMode === 'first' && useCustomSeq && (
                      <div className="ft-row" style={{ marginTop: 8, gap: 8 }}>
                        <input
                          type="number"
                          min={1}
                          max={limit.max}
                          value={customReportSeq}
                          onChange={e => {
                            let v = parseInt(e.target.value);
                            if (isNaN(v)) v = 1;
                            v = Math.min(limit.max, Math.max(1, v));
                            setCustomReportSeq(v);
                            setReportMaxSeq(v);
                          }}
                          className="ft-num"
                          style={{ width: '100px' }}
                        />
                        <span className="ft-hint-mono">(max {limit.max.toLocaleString()})</span>
                      </div>
                    )}

                    {reportMode === 'range' && (
                      <div className="ft-range-row" style={{ gap: 8, marginTop: 8 }}>
                        <input
                          type="number"
                          className="ft-num"
                          style={{ width: '80px' }}
                          value={reportRangeStart}
                          min={1}
                          max={totalSeq}
                          onChange={e => {
                            let v = parseInt(e.target.value);
                            if (isNaN(v)) v = 1;
                            v = Math.min(totalSeq, Math.max(1, v));
                            setReportRangeStart(v);
                            if (v > reportRangeEnd) setReportRangeEnd(v);
                          }}
                          placeholder="Start"
                        />
                        <span style={{ color: 'var(--text-muted)', fontSize: 13 }}>–</span>
                        <input
                          type="number"
                          className="ft-num"
                          style={{ width: '80px' }}
                          value={reportRangeEnd}
                          min={reportRangeStart}
                          max={totalSeq}
                          onChange={e => {
                            let v = parseInt(e.target.value);
                            if (isNaN(v)) v = reportRangeStart;
                            v = Math.min(totalSeq, Math.max(reportRangeStart, v));
                            setReportRangeEnd(v);
                          }}
                          placeholder="End"
                        />
                        <span className="ft-hint-mono">
                          (max allowed: {limit.max.toLocaleString()})
                        </span>
                      </div>
                    )}

                    {reportMode === 'all' && (
                      <p className="ft-hint" style={{ marginTop: 8 }}>
                        Entire file will be used, automatically capped at {limit.max.toLocaleString()} sequences.
                      </p>
                    )}

                    <p className="ft-hint-mono" style={{ marginTop: 8 }}>
                      {reportFormat === 'txt'  && 'max 100,000 · recommended ≤50,000'}
                      {reportFormat === 'docx' && 'max 50,000 · recommended ≤20,000'}
                      {reportFormat === 'pdf'  && 'max 20,000 · recommended ≤10,000'}
                      {['xlsx', 'csv', 'html', 'json'].includes(reportFormat) && 'max 100,000 · recommended ≤50,000'}
                    </p>
                  </div>

                  <button type="button" className="ft-btn-primary" style={{ alignSelf: 'flex-start' }} onClick={exportReport} disabled={loading}>
                    {Ic.report} Generate Report
                  </button>
                </div>
                {busyAction === 'report' && <HelixOverlay label="Building report…" />}
              </div>
            )}

            {/* ── Chunk panel ── */}
            {activeSection === 'chunk' && showChunkSection && (
              <div className="ft-panel" role="tabpanel" aria-label="Sequence chunking">
                <div className="ft-panel-head">{Ic.chunk} Sequence Chunking</div>
                <div className="ft-panel-body">

                  <div>
                    <span className="ft-lbl">
                      Chunk size{targetFormat === 'newick' ? ` (max ${NEWICK_MAX_SEQUENCES})` : ''}
                    </span>
                    <div className="ft-row" style={{ gap: 10 }}>
                      <input
                        type="number" min="1"
                        max={targetFormat === 'newick' ? NEWICK_MAX_SEQUENCES : Math.max(1, totalSeq)}
                        value={effectiveChunkSize}
                        onChange={e => {
                          const cap = targetFormat === 'newick' ? NEWICK_MAX_SEQUENCES : Math.max(1, totalSeq);
                          setChunkSize(Math.min(cap, Math.max(1, parseInt(e.target.value) || cap)));
                        }}
                        className="ft-num"
                      />
                      <button type="button" className="ft-btn-primary" onClick={downloadAllChunksAsZip} disabled={loading}>
                        {Ic.zip} Download all as ZIP
                      </button>
                    </div>
                    <p className="ft-hint-mono" style={{ marginTop: 6 }}>
                      {Math.ceil(totalSeq / effectiveChunkSize)} chunks × {effectiveChunkSize.toLocaleString()} sequences each
                    </p>
                  </div>

                  <div>
                    <span className="ft-lbl">Individual chunks</span>
                    <div className="ft-chunk-list">
                      {Array.from({ length: Math.ceil(totalSeq / chunkSize) }).map((_, i) => {
                        const start = i * chunkSize + 1;
                        const end   = Math.min((i + 1) * chunkSize, totalSeq);
                        return (
                          <div key={i} className="ft-chunk-row">
                            <span>#{String(i + 1).padStart(2, '0')} · seq {start.toLocaleString()}–{end.toLocaleString()}</span>
                            <button type="button" className="ft-chunk-dl" onClick={() => downloadChunk(start, end)} disabled={loading}>
                              {chunkBusy && chunkBusy.start === start && chunkBusy.end === end
                                ? <HelixLoader size={14} columns={5} tone="bases" decorative />
                                : Ic.download}
                              {targetFormat === 'newick' ? 'Generate Tree & Download' : 'Download'}
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  <div>
                    <span className="ft-lbl">Custom ranges</span>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
                      {customRanges.map((range, idx) => (
                        <div key={idx} className="ft-range-row">
                          <input type="number" placeholder="Start" value={range.start} className="ft-num"
                            onChange={e => updateCustomRange(idx, 'start', parseInt(e.target.value) || 1)} />
                          <span style={{ color: 'var(--text-muted)', fontSize: 13 }}>–</span>
                          <input type="number" placeholder="End" value={range.end} className="ft-num"
                            onChange={e => updateCustomRange(idx, 'end', parseInt(e.target.value) || 2000)} />
                          <button type="button" className="ft-btn-ghost" onClick={() => downloadChunk(range.start, range.end)} disabled={loading}>
                            {chunkBusy && chunkBusy.start === range.start && chunkBusy.end === range.end
                              ? <HelixLoader size={14} columns={5} tone="bases" decorative />
                              : Ic.download}
                          </button>
                          {customRanges.length > 1 && (
                            <button type="button" className="ft-btn-ghost danger" onClick={() => removeCustomRange(idx)}>
                              {Ic.close}
                            </button>
                          )}
                        </div>
                      ))}
                    </div>
                    <button type="button" className="ft-btn-ghost" style={{ marginTop: 8 }} onClick={addCustomRange}>
                      {Ic.plus} Add range
                    </button>
                  </div>
                </div>
                {busyAction === 'zip' && <HelixOverlay label="Packing ZIP…" />}
              </div>
            )}

            {/* ── Sequence ledger ── */}
            {(result.metadata?.records?.length ?? 0) > 0 && (
              <div className="ft-panel">
                <div className="ft-panel-head">
                  {Ic.eye}
                  Sequence Details
                  <span className="ft-panel-count">
                    showing {Math.min(visibleRecords, result.metadata?.records?.length ?? 0)} of {result.metadata?.records?.length?.toLocaleString()}
                  </span>
                </div>
                <div style={{ padding: '12px 14px' }}>
                  <div className="ft-ledger">
                    {result.metadata?.records?.slice(0, visibleRecords).map((rec: FastaRecord, idx: number) => {
                      const gcEntry = result.gc_content?.sequences?.find((s: FastaGcRecord) => s.id === rec.id);
                      const recGC   = parseFloat(String(gcEntry?.gc_percent ?? '0'));
                      return (
                        <div
                          key={idx}
                          className="ft-rec"
                          style={{ animationDelay: `${Math.min(idx, 19) * 40}ms` }}
                        >
                          <div className="ft-rec-id"><span className="ft-caret" aria-hidden="true">&gt;</span>{rec.id}</div>
                          <div className="ft-rec-meta">
                            <span><strong>{rec.length?.toLocaleString()}</strong> bp</span>
                            {gcEntry && <RecGc pct={recGC} />}
                          </div>
                          {rec.seq_preview && renderSeqPreview(rec.seq_preview)}
                        </div>
                      );
                    })}
                  </div>
                  {(result.metadata?.records?.length ?? 0) > visibleRecords && (
                    <button
                      type="button"
                      className="ft-load-more"
                      onClick={() => setVisibleRecords(v => Math.min(v + 50, result.metadata?.records?.length ?? 0))}
                    >
                      Load 50 more ({((result.metadata?.records?.length ?? 0) - visibleRecords).toLocaleString()} remaining)
                    </button>
                  )}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </>
  );
}
