'use client';
// ─────────────────────────────────────────────────────────────
//  PdfEditorTopbar.tsx
//  Identity and delivery only: brand, file, local save state,
//  Preview, Download, Close. Navigation and zoom live in the
//  command bar — one control, one place.
// ─────────────────────────────────────────────────────────────

import Link from 'next/link';
import AnimatedBrandLogo from '@/components/animated-brand-logo/AnimatedBrandLogo';

interface Props {
  fileName:    string;
  isExporting: boolean;
  saveStatus: 'idle' | 'saving' | 'saved' | 'error';
  saveMessage: string | null;
  recoveryDisabled?: boolean;
  onPreviewToggle: () => void;
  onExport:    () => void;
  onClose:     () => void;
  isPreviewOpen: boolean;
}

export default function PdfEditorTopbar({
  fileName,
  isExporting, saveStatus, saveMessage, recoveryDisabled, onPreviewToggle, onExport, onClose, isPreviewOpen,
}: Props) {
  const saveLabel = recoveryDisabled ? 'Recovery disabled' : saveStatus === 'error'
    ? 'Draft not saved'
    : saveStatus === 'saving'
      ? 'Saving…'
      : saveStatus === 'saved'
        ? 'Saved locally'
        : 'Not saved yet';

  return (
    <>
      <style>{`
        .pe-topbar {
          height: 50px; flex-shrink: 0;
          background: var(--pe-panel);
          border-bottom: 1px solid var(--pe-line);
          display: flex; align-items: center;
          padding: 0 14px; gap: 8px; z-index: 40;
          transition: background-color .35s var(--pe-ease-in-out), border-color .35s var(--pe-ease-in-out);
        }

        /* Brand */
        .pe-tb-brand {
          display: inline-flex; align-items: center; gap: 8px;
          text-decoration: none; flex-shrink: 0;
          min-height: 36px;
          color: var(--pe-text);
          border-radius: var(--pe-r-sm);
          outline: none;
          transition: opacity var(--pe-dur-fast) var(--pe-ease-out);
        }
        /*
          The blinking-eye octopus is hard-fixed at 42px inside its CSS module,
          so it is scaled from this wrapper (28/42 ≈ 0.667). The component's
          pointer listeners live on its own container and its eye-tracking math
          reads getBoundingClientRect(), so the scale does not break tracking.
        */
        .pe-tb-brand-mark {
          position: relative;
          display: block;
          width: 28px; height: 28px; flex: 0 0 28px;
        }
        .pe-tb-brand-mark > span {
          position: absolute; top: 50%; left: 50%;
          transform: translate(-50%, -50%) scale(0.6667);
        }
        .pe-tb-wordmark {
          display: inline-flex; align-items: center;
          color: var(--pe-text);
          font-family: 'Manrope', sans-serif; font-size: 16px; font-weight: 800;
          letter-spacing: 0; line-height: 1;
          white-space: nowrap;
        }
        .pe-tb-brand:hover { opacity: .86; }
        .pe-tb-brand:focus-visible {
          outline: 2px solid var(--pe-focus);
          outline-offset: 3px;
        }

        .pe-tb-sep {
          width: 1px; height: 20px;
          background: var(--pe-line);
          flex-shrink: 0;
        }

        /* File */
        .pe-tb-file {
          font-size: 12.5px; font-weight: 600;
          color: var(--pe-text);
          max-width: 220px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
        }
        .pe-save-state {
          display: inline-flex; align-items: center; gap: 6px;
          color: var(--pe-text-3); font-size: 11px; font-weight: 600;
          white-space: nowrap;
          font-variant-numeric: tabular-nums;
        }
        .pe-save-state::before {
          content: ''; width: 6px; height: 6px; border-radius: 50%;
          background: var(--pe-text-3);
        }
        .pe-save-state.saved::before { background: var(--pe-success); }
        .pe-save-state.saving::before {
          background: var(--pe-warning);
          animation: pe-save-pulse .8s ease-in-out infinite alternate;
        }
        .pe-save-state.error { color: var(--pe-danger); }
        .pe-save-state.error::before { background: var(--pe-danger); }
        @keyframes pe-save-pulse { to { opacity: .35; } }

        .pe-tb-flex { flex: 1; }

        /* Actions */
        .pe-preview-btn,
        .pe-export-btn,
        .pe-close-btn {
          display: inline-flex; align-items: center; justify-content: center;
          gap: 7px;
          min-height: 32px; box-sizing: border-box;
          border-radius: var(--pe-r-sm);
          font-family: 'DM Sans', sans-serif;
          font-size: 12px; font-weight: 700;
          cursor: pointer; flex-shrink: 0;
          transition:
            background-color var(--pe-dur-fast) var(--pe-ease-out),
            border-color var(--pe-dur-fast) var(--pe-ease-out),
            color var(--pe-dur-fast) var(--pe-ease-out),
            transform var(--pe-dur-fast) var(--pe-ease-out);
        }
        .pe-preview-btn {
          padding: 0 11px;
          border: 1px solid var(--pe-line);
          background: var(--pe-panel-2);
          color: var(--pe-text);
        }
        .pe-preview-btn:hover:not(:disabled) {
          border-color: var(--pe-line-strong);
          background: var(--pe-panel-3);
        }
        .pe-preview-btn.active {
          border-color: var(--pe-signal-line);
          background: var(--pe-signal-soft);
          color: var(--pe-signal-ink);
        }
        .pe-export-btn {
          padding: 0 14px;
          border: 1px solid var(--pe-signal);
          background: var(--pe-signal);
          color: var(--pe-on-signal);
        }
        .pe-export-btn:hover:not(:disabled) { transform: translateY(-1px); }
        .pe-export-btn:active:not(:disabled) { transform: translateY(0); }
        .pe-preview-btn:disabled,
        .pe-export-btn:disabled { opacity: .5; cursor: not-allowed; }
        .pe-close-btn {
          width: 32px; padding: 0;
          border: 1px solid var(--pe-line);
          background: transparent;
          color: var(--pe-text-2);
        }
        .pe-close-btn:hover { border-color: var(--pe-danger); color: var(--pe-danger); background: var(--pe-danger-soft); }

        @keyframes pe-spin { to { transform: rotate(360deg); } }
        .pe-btn-spin { animation: pe-spin .7s linear infinite; transform-origin: center; }

        @media (max-width: 900px) {
          .pe-save-label {
            position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px;
            overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; border: 0;
          }
          .pe-tb-file { max-width: 180px; }
        }
        @media (max-width: 700px) {
          .pe-topbar { padding: 0 8px; gap: 6px; overflow: hidden; }
          .pe-tb-wordmark, .pe-tb-sep { display: none; }
          .pe-tb-file { max-width: 44vw; }
          .pe-tb-flex { flex: 1; }
          .pe-preview-btn, .pe-export-btn {
            width: 36px; height: 34px; padding: 0; gap: 0; font-size: 0;
          }
          .pe-close-btn { width: 34px; height: 34px; }
        }
        @media (prefers-reduced-motion: reduce) {
          .pe-topbar, .pe-tb-brand, .pe-preview-btn, .pe-export-btn, .pe-close-btn { transition: none; }
          .pe-save-state.saving::before, .pe-btn-spin { animation: none; }
          .pe-export-btn:hover:not(:disabled) { transform: none; }
        }
      `}</style>

      <header className="pe-topbar">
        <Link href="/" className="pe-tb-brand" aria-label="mycloove home">
          <span className="pe-tb-brand-mark" aria-hidden="true">
            <AnimatedBrandLogo />
          </span>
          <span className="pe-tb-wordmark">mycloove</span>
        </Link>

        <div className="pe-tb-sep" aria-hidden="true" />

        {fileName && (
          <>
            <span className="pe-tb-file" title={fileName}>{fileName}</span>
            <span
              data-testid="pdf-save-status"
              className={`pe-save-state ${saveStatus}`}
              title={recoveryDisabled ? 'Recovery is disabled for this open PDF' : saveMessage ?? 'Local recovery status for this PDF'}
              role="status"
              aria-live="polite"
            >
              <span className="pe-save-label">{saveLabel}</span>
            </span>
          </>
        )}

        <div className="pe-tb-flex" />

        <button
          type="button"
          className={`pe-preview-btn ${isPreviewOpen ? 'active' : ''}`}
          onClick={onPreviewToggle}
          disabled={!fileName}
          aria-pressed={isPreviewOpen}
          aria-label={isPreviewOpen ? 'Close export preview' : 'Preview final PDF'}
          title={isPreviewOpen ? 'Close export preview' : 'Preview final PDF'}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6-10-6-10-6z"/>
            <circle cx="12" cy="12" r="3"/>
          </svg>
          Preview
        </button>

        <button
          data-testid="pdf-export-button"
          className="pe-export-btn"
          onClick={onExport}
          disabled={isExporting || !fileName}
          aria-label="Download PDF"
        >
          {isExporting ? (
            <>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" className="pe-btn-spin" aria-hidden="true">
                <circle cx="12" cy="12" r="10" strokeOpacity="0.2"/>
                <path d="M12 2a10 10 0 0 1 10 10"/>
              </svg>
              Downloading…
            </>
          ) : (
            <>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                <polyline points="7 10 12 15 17 10"/>
                <line x1="12" y1="15" x2="12" y2="3"/>
              </svg>
              Download PDF
            </>
          )}
        </button>

        <button
          type="button"
          className="pe-close-btn"
          onClick={onClose}
          aria-label="Close editor"
          title="Close editor"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden="true">
            <line x1="18" y1="6" x2="6" y2="18"/>
            <line x1="6" y1="6" x2="18" y2="18"/>
          </svg>
        </button>
      </header>
    </>
  );
}
