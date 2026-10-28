'use client';

import { useEffect, useState } from 'react';
import type { PdfPostExportVerification } from '../pdfEdit-utils/editorExportVerification';
import type { PdfEditorFitMode } from '../pdfEdit-utils/editorShell';

interface Props {
  page: number;
  totalPages: number;
  width: number | null;
  height: number | null;
  zoom: number;
  fitMode: PdfEditorFitMode;
  /** Null means nothing is selected; the bar must not announce noise. */
  selectionLabel: string | null;
  saveStatus: 'idle' | 'saving' | 'saved' | 'error';
  recoveryDisabled?: boolean;
  lastExportVerification: PdfPostExportVerification | null;
  /**
   * Fidelity downgrades the last export performed — a font shrink, a typeface
   * substitution, a raster flatten. A verified export that quietly changed the
   * document is still a change the user has to be able to see, so this shows
   * even when `lastExportVerification.ok` is true.
   */
  lastExportDisclosures?: string[];
}

export default function PdfEditorStatusBar(props: Props) {
  const saveLabel = props.recoveryDisabled ? 'Recovery disabled' : props.saveStatus === 'saved'
    ? 'Saved locally'
    : props.saveStatus === 'saving'
      ? 'Saving'
      : props.saveStatus === 'error'
        ? 'Save error'
        : 'Not saved yet';
  const disclosures = props.lastExportDisclosures ?? [];
  const failures = props.lastExportVerification?.failures ?? [];
  const hasNotes = disclosures.length > 0 || failures.length > 0;
  const [notesOpen, setNotesOpen] = useState(false);

  useEffect(() => {
    if (!notesOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setNotesOpen(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [notesOpen]);

  return (
    <footer className="pe-statusbar" data-testid="pdf-status-bar" role="status" aria-live="polite">
      <style>{`
        .pe-statusbar {
          position: relative;
          height: 28px; flex: 0 0 28px;
          padding: 0 12px;
          display: flex; align-items: center; gap: 14px;
          background: var(--pe-panel);
          border-top: 1px solid var(--pe-line);
          color: var(--pe-text-3);
          font-size: 11px;
          font-variant-numeric: tabular-nums;
          white-space: nowrap;
          transition: background-color .35s var(--pe-ease-in-out), border-color .35s var(--pe-ease-in-out);
        }
        .pe-statusbar strong { color: var(--pe-text); font-weight: 650; }
        .pe-status-sep { width: 1px; height: 14px; background: var(--pe-line); flex: 0 0 1px; }
        .pe-status-spacer { flex: 1; }
        .pe-status-ok { color: var(--pe-success); }
        .pe-status-error { color: var(--pe-danger); }
        .pe-status-warn { color: var(--pe-warning); }
        .pe-status-notes {
          min-height: 22px;
          padding: 0 7px;
          border: 1px solid var(--pe-line);
          border-radius: 4px;
          background: transparent;
          color: var(--pe-text-2);
          font-family: inherit;
          font-size: 11px;
          font-weight: 650;
          cursor: pointer;
        }
        .pe-status-notes:hover { border-color: var(--pe-line-strong); color: var(--pe-text); }
        .pe-status-notes.warn { color: var(--pe-warning); border-color: var(--pe-warning); }
        .pe-status-notes.error { color: var(--pe-danger); border-color: var(--pe-danger); }
        .pe-status-panel {
          position: absolute;
          right: 12px;
          bottom: calc(100% + 8px);
          z-index: 60;
          width: min(380px, calc(100vw - 24px));
          max-height: min(320px, 50vh);
          overflow: auto;
          padding: 12px 14px;
          border: 1px solid var(--pe-line);
          border-radius: var(--pe-r-md);
          background: var(--pe-panel);
          box-shadow: var(--pe-shadow-dialog);
          color: var(--pe-text);
          font-size: 11.5px;
          line-height: 1.5;
          white-space: normal;
          text-align: left;
        }
        .pe-status-panel-title {
          display: block;
          margin-bottom: 6px;
          font-size: 11px;
          font-weight: 800;
          letter-spacing: .08em;
          text-transform: uppercase;
          color: var(--pe-text-2);
        }
        .pe-status-panel ul { margin: 0; padding-left: 18px; }
        .pe-status-panel li + li { margin-top: 5px; }
        .pe-status-panel-failure { color: var(--pe-danger); }
        @media (max-width: 700px) {
          .pe-statusbar {
            height: calc(26px + env(safe-area-inset-bottom));
            flex-basis: calc(26px + env(safe-area-inset-bottom));
            padding: 0 8px env(safe-area-inset-bottom);
            gap: 8px;
          }
          .pe-status-hide-mobile { display: none; }
        }
        @media (prefers-reduced-motion: reduce) {
          .pe-statusbar { transition: none; }
        }
      `}</style>

      <span><strong>{props.page}</strong> / {props.totalPages}</span>
      <span className="pe-status-hide-mobile">
        {props.width && props.height ? `${Math.round(props.width)} × ${Math.round(props.height)} pt` : 'Page size pending'}
      </span>
      <span className="pe-status-hide-mobile">{Math.round(props.zoom * 100)}% · {props.fitMode === 'custom' ? 'Custom' : props.fitMode.replace('-', ' ')}</span>
      {props.selectionLabel && <span className="pe-status-hide-mobile">{props.selectionLabel}</span>}
      <span className="pe-status-spacer" />

      {hasNotes && (
        <button
          type="button"
          className={`pe-status-notes ${failures.length ? 'error' : 'warn'}`}
          onClick={() => setNotesOpen(open => !open)}
          aria-expanded={notesOpen}
          aria-controls="pe-status-notes-panel"
          data-testid="pdf-export-disclosures"
        >
          {failures.length
            ? 'Export verification failed'
            : `Export note${disclosures.length === 1 ? '' : 's'} (${disclosures.length})`}
        </button>
      )}
      {props.lastExportVerification && failures.length === 0 && (
        <span className={props.lastExportVerification.ok ? 'pe-status-ok' : 'pe-status-error'}>
          {props.lastExportVerification.ok ? 'Last export verified' : 'Last export failed verification'}
        </span>
      )}
      <span className="pe-status-sep" aria-hidden="true" />
      <span>{saveLabel}</span>

      {notesOpen && hasNotes && (
        <div className="pe-status-panel" id="pe-status-notes-panel" role="region" aria-label="Export notes">
          <span className="pe-status-panel-title">Export notes</span>
          <ul>
            {failures.map(failure => (
              <li className="pe-status-panel-failure" key={failure}>{failure}</li>
            ))}
            {disclosures.map(note => (
              <li key={note}>{note}</li>
            ))}
          </ul>
        </div>
      )}
    </footer>
  );
}
