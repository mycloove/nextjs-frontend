'use client'

import { useState, useCallback } from 'react'
import { useDropzone } from 'react-dropzone'
import { getApiErrorMessage, toolRequest } from '@/lib/api/client'
import { downloadBlob } from '@/lib/download/downloadOutputs'
import ErrorBanner from '@/components/feedback/ErrorBanner'
import { assertCompleteDiagramExport } from './PDFToMarkdown/diagrams/export-contract'
import { diagramExportStyles, renderMarkdownForExport } from './PDFToMarkdown/diagrams/export'

/* ── Icons ─────────────────────────────────────────────────── */
const Ic = {
  upload: (
    <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
      <polyline points="14 2 14 8 20 8"/>
      <path d="M12 18v-6M9 15l3-3 3 3"/>
    </svg>
  ),
  md: (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M19 13v4a1 1 0 0 1-1 1h-2"/>
      <path d="M19 17v-4a1 1 0 0 0-1-1h-2"/>
      <line x1="19" y1="15" x2="14" y2="15"/>
      <polyline points="11 12 7 12 7 15"/>
      <line x1="13" y1="15" x2="7" y2="9"/>
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
      <polyline points="14 2 14 8 20 8"/>
    </svg>
  ),
  pdf: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
      <polyline points="14 2 14 8 20 8"/>
      <path d="M9 13h2l1 4 1-4h2"/>
    </svg>
  ),
  check: (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="20 6 9 17 4 12"/>
    </svg>
  ),
  close: (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
      <line x1="18" y1="6" x2="6" y2="18"/>
      <line x1="6" y1="6" x2="18" y2="18"/>
    </svg>
  ),
  spinner: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" className="m2p-spin">
      <circle cx="12" cy="12" r="10" strokeOpacity="0.2"/>
      <path d="M12 2a10 10 0 0 1 10 10"/>
    </svg>
  ),
  heading: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="4 7 4 4 20 4 20 7"/>
      <line x1="9" y1="20" x2="15" y2="20"/>
      <line x1="12" y1="4" x2="12" y2="20"/>
    </svg>
  ),
  table: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="18" height="18" rx="2"/>
      <line x1="3" y1="9" x2="21" y2="9"/>
      <line x1="3" y1="15" x2="21" y2="15"/>
      <line x1="9" y1="3" x2="9" y2="21"/>
    </svg>
  ),
  code: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="16 18 22 12 16 6"/>
      <polyline points="8 6 2 12 8 18"/>
    </svg>
  ),
  image: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="18" height="18" rx="2"/>
      <circle cx="8.5" cy="8.5" r="1.5"/>
      <polyline points="21 15 16 10 5 21"/>
    </svg>
  ),
  arrow: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="5" y1="12" x2="19" y2="12"/>
      <polyline points="12 5 19 12 12 19"/>
    </svg>
  ),
  info: (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10"/>
      <line x1="12" y1="8" x2="12" y2="12"/>
      <line x1="12" y1="16" x2="12.01" y2="16"/>
    </svg>
  ),
  globe: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10"/>
      <line x1="2" y1="12" x2="22" y2="12"/>
      <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>
    </svg>
  ),
  font: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="4 7 4 4 20 4 20 7"/>
      <line x1="9" y1="20" x2="15" y2="20"/>
      <line x1="12" y1="4" x2="12" y2="20"/>
    </svg>
  ),
  layout: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="18" height="18" rx="2"/>
      <line x1="3" y1="9" x2="21" y2="9"/>
      <line x1="9" y1="21" x2="9" y2="9"/>
    </svg>
  ),
}

/* ── Page size options ── */
const PAGE_SIZES = [
  { value: 'A4',     label: 'A4',     desc: '210 × 297 mm' },
  { value: 'LETTER', label: 'Letter', desc: '216 × 279 mm' },
  { value: 'LEGAL',  label: 'Legal',  desc: '216 × 356 mm' },
] as const

const LANGUAGES = [
  { value: 'auto',  label: 'Auto Detect' },
  { value: 'eng',   label: 'English' },
  { value: 'ben',   label: 'বাংলা (Bangla)' },
  { value: 'mixed', label: 'English + বাংলা' },
] as const

/* ── Feature pills ── */
const FEATURES = [
  { icon: Ic.heading, label: 'Headings' },
  { icon: Ic.code,    label: 'Syntax Highlighting' },
  { icon: Ic.table,   label: 'Tables' },
  { icon: Ic.image,   label: 'Images' },
]

/* ─────────────────────────────────────────────────────────────
   Component
───────────────────────────────────────────────────────────── */
export default function MarkdownToPDF() {
  const [file, setFile]               = useState<File | null>(null)
  const [loading, setLoading]         = useState(false)
  const [pageSize, setPageSize]       = useState('A4')
  const [fontSize, setFontSize]       = useState(12)
  const [includeToc, setIncludeToc]   = useState(false)
  const [syntaxHighlight, setSyntaxHighlight] = useState(true)
  const [lang, setLang]               = useState('auto')
  const [done, setDone]               = useState(false)
  const [error, setError]             = useState<string | null>(null)
  const [output, setOutput]           = useState<{ blob: Blob; name: string } | null>(null)

  // ── Dropzone ──
  const onDrop = useCallback((accepted: File[]) => {
    const md = accepted.find(f =>
      f.name.endsWith('.md') ||
      f.type === 'text/markdown' ||
      f.type === 'text/plain'
    )
    if (md) { setFile(md); setDone(false); setError(null); setOutput(null) }
  }, [])

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      'text/markdown': ['.md', '.markdown'],
      'text/plain': ['.md', '.markdown', '.txt'],
    },
    maxFiles: 1,
  })

  // ── Convert ──
  const convertToPDF = async () => {
    if (!file || loading) return
    setLoading(true)
    setError(null)
    setDone(false)
    try {
      const markdown = await file.text()
      const exported = await renderMarkdownForExport(markdown, 'light')
      assertCompleteDiagramExport(exported)
      const formData = new FormData()
      formData.append('md_file', new File([markdown], file.name, { type: 'text/markdown' }))
      formData.append('page_size', pageSize)
      formData.append('font_size', String(fontSize))
      formData.append('include_toc', includeToc ? 'true' : 'false')
      formData.append('syntax_highlight', syntaxHighlight ? 'true' : 'false')
      formData.append('lang', lang)
      formData.append('rendered_html', exported.html)
      formData.append('rendered_css', diagramExportStyles())
      formData.append('expected_diagram_count', String(exported.expectedDiagramCount))
      formData.append('rendered_diagram_count', String(exported.renderedDiagramCount))
      formData.append('export_contract_version', '2')

      const res = await toolRequest('/api/markdown-to-pdf', { method: 'POST', body: formData })
      if (!res.ok) {
        setError(await getApiErrorMessage(res, 'We could not convert this Markdown file. Please try again.'))
        return
      }
      const blob = await res.blob()
      const name = 'mycloove_' + file.name.replace(/\.md$/i, '.pdf')
      setOutput({ blob, name })
      downloadBlob(blob, name)
      setDone(true)
    } catch (e) {
      // toolRequest throws an ApiClientError with a user-facing transport
      // message, and the diagram export contract throws its own honest
      // explanation. Anything else is unexpected, so show a neutral line rather
      // than a raw error string.
      setError(
        e instanceof Error && e.message
          ? e.message
          : 'Something went wrong while converting. Please try again.',
      )
    } finally {
      setLoading(false)
    }
  }

  const fileSizeKB = file ? (file.size / 1024).toFixed(1) : '0'

  return (
    <>
      <style>{`
        @keyframes m2p-spin { to { transform: rotate(360deg); } }
        .m2p-spin { animation: m2p-spin 0.75s linear infinite; transform-origin: center; }

        @keyframes m2p-pop {
          0%   { opacity:0; transform: scale(0.92) translateY(6px); }
          100% { opacity:1; transform: scale(1)    translateY(0);    }
        }
        .m2p-animate { animation: m2p-pop 0.22s ease both; }

        .m2p { display: flex; flex-direction: column; gap: 18px; }

        /* ── Drop zone ── */
        .m2p-zone {
          border: 1.5px dashed var(--border-base, rgba(255,255,255,0.12));
          border-radius: 14px;
          padding: 34px 24px;
          text-align: center;
          cursor: pointer;
          background: var(--bg-item, rgba(255,255,255,0.025));
          position: relative; overflow: hidden;
          transition: border-color 0.18s, background 0.18s, transform 0.18s;
        }
        .m2p-zone::before {
          content: '';
          position: absolute; inset: 0;
          background: radial-gradient(ellipse at 50% 0%, rgba(0,180,150,0.08) 0%, transparent 65%);
          opacity: 0; transition: opacity 0.2s; pointer-events: none;
        }
        .m2p-zone:hover { border-color: rgba(0,180,150,0.45); transform: translateY(-1px); }
        .m2p-zone:hover::before { opacity: 1; }
        .m2p-zone.active {
          border-color: #00b496;
          background: rgba(0,180,150,0.06);
          transform: translateY(-2px);
        }
        .m2p-zone.active::before { opacity: 1; }

        .m2p-icon-ring {
          width: 64px; height: 64px; border-radius: 18px;
          background: linear-gradient(135deg, rgba(0,180,150,0.15), rgba(0,220,180,0.08));
          border: 1px solid rgba(0,180,150,0.25);
          display: flex; align-items: center; justify-content: center;
          margin: 0 auto 16px; color: #00d4b0;
          transition: transform 0.2s, box-shadow 0.2s;
        }
        .m2p-zone:hover .m2p-icon-ring {
          transform: scale(1.06);
          box-shadow: 0 0 0 6px rgba(0,180,150,0.08);
        }

        .m2p-zone-title {
          font-family: 'Syne', sans-serif;
          font-size: 15px; font-weight: 700;
          color: var(--text-primary, #e4e2ee); margin-bottom: 5px;
        }
        .m2p-zone-sub {
          font-size: 12.5px; color: var(--text-muted, rgba(255,255,255,0.38));
          margin-bottom: 16px;
        }

        .m2p-features {
          display: flex; flex-wrap: wrap; gap: 6px; justify-content: center;
        }
        .m2p-feat-pill {
          display: inline-flex; align-items: center; gap: 5px;
          font-size: 10.5px; font-weight: 500;
          padding: 4px 10px; border-radius: 20px;
          background: var(--bg-item, rgba(255,255,255,0.05));
          border: 1px solid var(--border-base, rgba(255,255,255,0.08));
          color: var(--text-muted, rgba(255,255,255,0.42));
        }
        .m2p-feat-pill svg { opacity: 0.6; }

        /* ── File card ── */
        .m2p-file-card {
          display: flex; align-items: center; gap: 14px;
          padding: 14px 16px;
          background: var(--bg-card, #17161e);
          border: 1px solid var(--border-card, rgba(255,255,255,0.07));
          border-radius: 12px;
          transition: background 0.35s;
        }
        .m2p-file-icon {
          width: 42px; height: 42px; border-radius: 10px; flex-shrink: 0;
          background: linear-gradient(135deg, rgba(0,180,150,0.18), rgba(0,180,150,0.07));
          border: 1px solid rgba(0,180,150,0.22);
          display: flex; align-items: center; justify-content: center;
          color: #00d4b0;
        }
        .m2p-file-name {
          font-size: 13.5px; font-weight: 600;
          color: var(--text-primary, #e4e2ee);
          margin-bottom: 2px;
          white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
          max-width: 260px;
        }
        .m2p-file-meta { font-size: 11px; color: var(--text-muted, rgba(255,255,255,0.38)); }
        .m2p-file-meta span { margin-right: 10px; }
        .m2p-remove-btn {
          margin-left: auto; flex-shrink: 0;
          display: flex; align-items: center; gap: 5px;
          font-size: 11.5px; font-weight: 500;
          color: rgba(255,255,255,0.38);
          padding: 5px 10px; border-radius: 8px;
          border: 1px solid rgba(255,255,255,0.08);
          background: transparent; cursor: pointer;
          transition: color 0.14s, background 0.14s, border-color 0.14s;
        }
        .m2p-remove-btn:hover {
          color: #ff8080; background: rgba(255,80,80,0.08); border-color: rgba(255,80,80,0.2);
        }

        /* ── Conversion flow visual ── */
        .m2p-flow {
          display: flex; align-items: center; justify-content: center; gap: 12px;
          padding: 14px 16px;
          background: var(--bg-card, #17161e);
          border: 1px solid var(--border-card, rgba(255,255,255,0.07));
          border-radius: 12px;
        }
        .m2p-flow-box {
          display: flex; align-items: center; gap: 8px;
          padding: 8px 14px; border-radius: 9px;
          font-size: 12px; font-weight: 600;
          flex: 1; justify-content: center;
        }
        .m2p-flow-box.md {
          background: rgba(120,80,200,0.1);
          border: 1px solid rgba(120,80,200,0.25);
          color: #a078e8;
        }
        .m2p-flow-box.pdf {
          background: rgba(255,107,107,0.09);
          border: 1px solid rgba(255,107,107,0.2);
          color: #ff9080;
        }
        .m2p-flow-arrow {
          color: rgba(255,255,255,0.22); flex-shrink: 0;
        }

        /* ── Options panel ── */
        .m2p-panel {
          background: var(--bg-card, #17161e);
          border: 1px solid var(--border-card, rgba(255,255,255,0.07));
          border-radius: 14px; overflow: hidden;
        }
        .m2p-panel-head {
          display: flex; align-items: center; gap: 8px;
          padding: 13px 16px;
          border-bottom: 1px solid rgba(255,255,255,0.06);
          font-family: 'Syne', sans-serif;
          font-size: 12.5px; font-weight: 700;
          color: var(--text-primary, #e4e2ee);
        }
        .m2p-panel-head svg { color: rgba(255,255,255,0.3); }

        /* Page size grid */
        .m2p-size-grid {
          display: grid; grid-template-columns: repeat(3,1fr); gap: 8px;
          padding: 14px 14px 8px;
        }
        @media (max-width: 480px) { .m2p-size-grid { grid-template-columns: 1fr; } }

        .m2p-size-card {
          padding: 12px; border-radius: 11px; cursor: pointer; text-align: center;
          font: inherit; width: 100%;
          border: 1.5px solid var(--border-base, rgba(255,255,255,0.08));
          background: var(--bg-item, rgba(255,255,255,0.025));
          transition: border-color 0.14s, background 0.14s, transform 0.14s;
          user-select: none;
        }
        .m2p-size-card:hover {
          background: var(--bg-item-hover, rgba(255,255,255,0.05));
          transform: translateY(-1px);
        }
        .m2p-size-card.active {
          border-color: rgba(0,180,150,0.5);
          background: rgba(0,180,150,0.09);
        }
        .m2p-size-name {
          font-family: 'Syne', sans-serif;
          font-size: 13px; font-weight: 700;
          color: var(--text-primary, #e4e2ee); margin-bottom: 2px;
        }
        .m2p-size-card.active .m2p-size-name { color: #00d4b0; }
        .m2p-size-desc { font-size: 9.5px; color: var(--text-muted, rgba(255,255,255,0.35)); }

        /* Controls section */
        .m2p-controls {
          padding: 0 14px 14px;
          display: flex; flex-direction: column; gap: 10px;
        }

        .m2p-control-row {
          display: flex; align-items: center; justify-content: space-between;
          padding: 8px 12px;
          border-radius: 9px;
          background: var(--bg-item, rgba(255,255,255,0.025));
          border: 1px solid var(--border-base, rgba(255,255,255,0.06));
        }
        .m2p-control-label {
          display: flex; align-items: center; gap: 8px;
          font-size: 12px; font-weight: 500;
          color: var(--text-secondary, rgba(255,255,255,0.7));
        }
        .m2p-control-label svg { opacity: 0.5; }

        /* Toggle switch */
        .m2p-switch {
          position: relative;
          width: 34px; height: 20px;
          border-radius: 20px;
          padding: 0;
          border: 1.5px solid rgba(255,255,255,0.12);
          background: var(--bg-item, rgba(255,255,255,0.06));
          cursor: pointer;
          transition: background 0.2s, border-color 0.2s;
          flex-shrink: 0;
        }
        .m2p-switch.on {
          background: linear-gradient(135deg, #00b496, #00d4b0);
          border-color: transparent;
        }
        .m2p-switch-thumb {
          position: absolute; top: 2px; left: 2px;
          width: 14px; height: 14px;
          border-radius: 50%;
          background: #fff;
          box-shadow: 0 1px 3px rgba(0,0,0,0.3);
          transition: transform 0.2s cubic-bezier(0.4,0,0.2,1);
        }
        .m2p-switch.on .m2p-switch-thumb { transform: translateX(14px); }

        /* Font size slider */
        .m2p-slider-row {
          display: flex; align-items: center; gap: 12px;
          padding: 8px 12px;
          border-radius: 9px;
          background: var(--bg-item, rgba(255,255,255,0.025));
          border: 1px solid var(--border-base, rgba(255,255,255,0.06));
        }
        .m2p-slider-label {
          display: flex; align-items: center; gap: 8px;
          font-size: 12px; font-weight: 500;
          color: var(--text-secondary, rgba(255,255,255,0.7));
          white-space: nowrap;
        }
        .m2p-slider-label svg { opacity: 0.5; }
        .m2p-slider {
          flex: 1;
          -webkit-appearance: none; appearance: none;
          height: 4px;
          border-radius: 4px;
          background: var(--border-base, rgba(255,255,255,0.12));
          outline: none;
          cursor: pointer;
        }
        .m2p-slider::-webkit-slider-thumb {
          -webkit-appearance: none;
          width: 16px; height: 16px;
          border-radius: 50%;
          background: #00b496;
          border: 2px solid #fff;
          box-shadow: 0 1px 4px rgba(0,0,0,0.3);
          cursor: pointer;
        }
        .m2p-slider::-moz-range-thumb {
          width: 16px; height: 16px;
          border-radius: 50%;
          background: #00b496;
          border: 2px solid #fff;
          cursor: pointer;
        }
        .m2p-slider-value {
          font-size: 12px;
          font-weight: 700;
          color: var(--text-primary, #e4e2ee);
          min-width: 30px;
          text-align: center;
        }

        /* Language selector */
        .m2p-lang-row {
          display: flex; align-items: center; gap: 10px;
          padding: 8px 12px;
          border-radius: 9px;
          background: var(--bg-item, rgba(255,255,255,0.025));
          border: 1px solid var(--border-base, rgba(255,255,255,0.06));
        }
        .m2p-lang-label {
          display: flex; align-items: center; gap: 8px;
          font-size: 12px; font-weight: 500;
          color: var(--text-secondary, rgba(255,255,255,0.7));
          flex: 1;
        }
        .m2p-lang-label svg { opacity: 0.5; }
        .m2p-lang-select {
          background: var(--bg-item, rgba(255,255,255,0.05));
          border: 1px solid var(--border-base, rgba(255,255,255,0.1));
          border-radius: 8px;
          padding: 6px 10px;
          font-size: 11.5px;
          color: var(--text-primary, #e4e2ee);
          cursor: pointer;
          outline: none;
          transition: border-color 0.14s;
          -webkit-appearance: none; appearance: none;
          background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6' viewBox='0 0 10 6'%3E%3Cpath d='M0 0l5 6 5-6z' fill='%23888'/%3E%3C/svg%3E");
          background-repeat: no-repeat; background-position: right 8px center; padding-right: 26px;
        }
        .m2p-lang-select:focus { border-color: rgba(0,180,150,0.5); }
        .m2p-lang-select option { background: #1c1b25; color: #e4e2ee; }

        /* ── Info note ── */
        .m2p-note {
          display: flex; align-items: flex-start; gap: 8px;
          padding: 10px 12px; border-radius: 9px;
          background: rgba(0,180,150,0.06);
          border: 1px solid rgba(0,180,150,0.15);
          font-size: 11.5px; color: rgba(0,220,180,0.75);
          line-height: 1.55;
        }
        .m2p-note svg { flex-shrink: 0; margin-top: 1px; }

        /* ── Done banner ── */
        .m2p-done {
          display: flex; align-items: center; gap: 10px;
          padding: 12px 16px; border-radius: 11px;
          background: rgba(45,189,122,0.08);
          border: 1px solid rgba(45,189,122,0.22);
          font-size: 13px; font-weight: 500;
          color: #2dbd7a;
        }
        .m2p-done-icon {
          width: 28px; height: 28px; border-radius: 50%;
          background: rgba(45,189,122,0.15);
          border: 1.5px solid rgba(45,189,122,0.3);
          display: flex; align-items: center; justify-content: center;
          flex-shrink: 0;
        }

        /* ── Convert button ── */
        .m2p-convert-btn {
          display: flex; align-items: center; justify-content: center; gap: 9px;
          width: 100%; padding: 14px 20px; border-radius: 12px; border: none;
          background: linear-gradient(135deg, #00b496 0%, #00d4b0 100%);
          color: #fff;
          font-family: 'Syne', sans-serif;
          font-size: 14.5px; font-weight: 700; letter-spacing: -0.2px;
          cursor: pointer;
          box-shadow: 0 4px 24px rgba(0,180,150,0.3);
          transition: transform 0.18s, box-shadow 0.18s, opacity 0.18s;
          position: relative; overflow: hidden;
        }
        .m2p-convert-btn::before {
          content: ''; position: absolute; inset: 0;
          background: linear-gradient(135deg, rgba(255,255,255,0.13), transparent);
          pointer-events: none;
        }
        .m2p-convert-btn:hover:not(:disabled) {
          transform: translateY(-2px);
          box-shadow: 0 8px 32px rgba(0,180,150,0.42);
        }
        .m2p-convert-btn:active:not(:disabled) { transform: translateY(0); }
        .m2p-convert-btn:disabled { opacity: 0.45; cursor: not-allowed; box-shadow: none; }

        /* Keyboard focus for the controls that became real buttons */
        .m2p-size-card:focus-visible,
        .m2p-switch:focus-visible {
          outline: 2px solid #00d4b0;
          outline-offset: 2px;
        }

        /* Re-download affordance on the success banner */
        .m2p-redownload {
          margin-left: auto; flex-shrink: 0;
          display: inline-flex; align-items: center; gap: 6px;
          padding: 6px 12px; border-radius: 8px;
          border: 1px solid rgba(45,189,122,0.3);
          background: rgba(45,189,122,0.1);
          color: #2dbd7a; font: inherit; font-size: 11.5px; font-weight: 600;
          cursor: pointer;
          transition: background 0.15s, border-color 0.15s;
        }
        .m2p-redownload:hover {
          background: rgba(45,189,122,0.18);
          border-color: rgba(45,189,122,0.45);
        }
        .m2p-redownload:focus-visible {
          outline: 2px solid #2dbd7a;
          outline-offset: 2px;
        }
      `}</style>

      <div className="m2p">

        {/* ── Drop zone ── */}
        <div
          {...getRootProps()}
          role="button"
          aria-label="Upload a Markdown file (.md)"
          className={`m2p-zone ${isDragActive ? 'active' : ''}`}
        >
          <input {...getInputProps()} />
          <div className="m2p-icon-ring">
            {isDragActive ? Ic.check : Ic.upload}
          </div>
          <p className="m2p-zone-title">
            {isDragActive ? 'Release to load Markdown' : 'Drop your Markdown file here'}
          </p>
          <p className="m2p-zone-sub">
            {isDragActive ? 'File will be loaded instantly' : 'or click to browse — .md files'}
          </p>
          <div className="m2p-features">
            {FEATURES.map(f => (
              <span key={f.label} className="m2p-feat-pill">
                {f.icon} {f.label}
              </span>
            ))}
          </div>
        </div>

        {/* ── File card ── */}
        {file && (
          <div className="m2p-file-card m2p-animate">
            <div className="m2p-file-icon">{Ic.md}</div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <p className="m2p-file-name">{file.name}</p>
              <p className="m2p-file-meta">
                <span>{fileSizeKB} KB</span>
                <span>Markdown Document</span>
              </p>
            </div>
            <button
              className="m2p-remove-btn"
              onClick={() => { setFile(null); setDone(false) }}
            >
              {Ic.close} Remove
            </button>
          </div>
        )}

        {/* ── Conversion flow visual ── */}
        {file && (
          <div className="m2p-flow m2p-animate">
            <div className="m2p-flow-box md">
              {Ic.md}
              <span>{file.name.length > 18 ? file.name.slice(0,16)+'…' : file.name}</span>
            </div>
            <div className="m2p-flow-arrow">{Ic.arrow}</div>
            <div className="m2p-flow-box pdf">
              {Ic.pdf}
              <span>{'mycloove_' + file.name.replace(/\.md$/i, '.pdf')}</span>
            </div>
          </div>
        )}

        {/* ── Options panel ── */}
        {file && (
          <div className="m2p-panel m2p-animate">
            <div className="m2p-panel-head">
              {Ic.layout} Document Settings
            </div>

            {/* Page size selector */}
            <div className="m2p-size-grid" role="radiogroup" aria-label="Page size">
              {PAGE_SIZES.map(s => (
                <button
                  key={s.value}
                  type="button"
                  role="radio"
                  aria-checked={pageSize === s.value}
                  className={`m2p-size-card ${pageSize === s.value ? 'active' : ''}`}
                  onClick={() => setPageSize(s.value)}
                >
                  <div className="m2p-size-name">{s.label}</div>
                  <div className="m2p-size-desc">{s.desc}</div>
                </button>
              ))}
            </div>

            {/* Controls */}
            <div className="m2p-controls">

              {/* Font size slider */}
              <div className="m2p-slider-row">
                <span className="m2p-slider-label">
                  {Ic.font} Font
                </span>
                <input
                  type="range"
                  className="m2p-slider"
                  min="8"
                  max="20"
                  value={fontSize}
                  onChange={e => setFontSize(Number(e.target.value))}
                />
                <span className="m2p-slider-value">{fontSize}pt</span>
              </div>

              {/* Include TOC toggle */}
              <div className="m2p-control-row">
                <span className="m2p-control-label">
                  {Ic.heading} Table of Contents
                </span>
                <button
                  type="button"
                  role="switch"
                  aria-checked={includeToc}
                  aria-label="Include table of contents"
                  className={`m2p-switch ${includeToc ? 'on' : ''}`}
                  onClick={() => setIncludeToc(v => !v)}
                >
                  <div className="m2p-switch-thumb" />
                </button>
              </div>

              {/* Syntax highlighting toggle */}
              <div className="m2p-control-row">
                <span className="m2p-control-label">
                  {Ic.code} Syntax Highlighting
                </span>
                <button
                  type="button"
                  role="switch"
                  aria-checked={syntaxHighlight}
                  aria-label="Syntax highlighting"
                  className={`m2p-switch ${syntaxHighlight ? 'on' : ''}`}
                  onClick={() => setSyntaxHighlight(v => !v)}
                >
                  <div className="m2p-switch-thumb" />
                </button>
              </div>

              {/* Language selector */}
              <div className="m2p-lang-row">
                <span className="m2p-lang-label">
                  {Ic.globe} Language
                </span>
                <select
                  className="m2p-lang-select"
                  value={lang}
                  onChange={e => setLang(e.target.value)}
                >
                  {LANGUAGES.map(l => (
                    <option key={l.value} value={l.value}>{l.label}</option>
                  ))}
                </select>
              </div>
            </div>
          </div>
        )}

        {/* ── Info note ── */}
        {file && (
          <div className="m2p-note m2p-animate">
            {Ic.info}
            <span>
              Supports full Markdown syntax with বাংলা font embedding. Headings, code blocks, tables, and images are all rendered beautifully.
            </span>
          </div>
        )}

        {/* ── Error ── */}
        {error && (
          <ErrorBanner
            message={error}
            onRetry={file ? convertToPDF : undefined}
            onDismiss={() => setError(null)}
          />
        )}

        {/* ── Success banner ── */}
        {done && (
          <div className="m2p-done m2p-animate">
            <div className="m2p-done-icon">{Ic.check}</div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 700, marginBottom: 1 }}>Conversion complete!</div>
              <div style={{ fontSize: '11.5px', opacity: 0.75 }}>
                Your PDF has been generated and downloaded.
              </div>
            </div>
            {output ? (
              <button
                type="button"
                className="m2p-redownload"
                onClick={() => downloadBlob(output.blob, output.name)}
              >
                {Ic.pdf} Download again
              </button>
            ) : null}
          </div>
        )}

        {/* ── Convert button ── */}
        {file && (
          <button
            className="m2p-convert-btn"
            onClick={convertToPDF}
            disabled={loading}
          >
            {loading
              ? <>{Ic.spinner} Converting to PDF…</>
              : <>{Ic.pdf} Convert Markdown to PDF</>
            }
          </button>
        )}

      </div>
    </>
  )
}
