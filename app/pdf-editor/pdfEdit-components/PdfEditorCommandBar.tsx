'use client';

import { useRef } from 'react';
import type { PdfEditorFitMode, PdfEditorViewMode } from '../pdfEdit-utils/editorShell';
import { normalizePdfEditorPageJump } from '../pdfEdit-utils/editorShell';

interface Props {
  currentPage: number;
  totalPages: number;
  zoom: number;
  fitMode: PdfEditorFitMode;
  viewMode: PdfEditorViewMode;
  query: string;
  resultCount: number;
  activeResult: number;
  searching: boolean;
  navigationOpen: boolean;
  inspectorOpen: boolean;
  onPageChange: (page: number) => void;
  onPrevPage: () => void;
  onNextPage: () => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onZoomReset: () => void;
  onFitModeChange: (mode: PdfEditorFitMode) => void;
  onViewModeChange: (mode: PdfEditorViewMode) => void;
  onQueryChange: (query: string) => void;
  onResultStep: (direction: -1 | 1) => void;
  onNavigationToggle: () => void;
  onInspectorToggle: () => void;
  onCommands: () => void;
  onHelp: () => void;
}

export default function PdfEditorCommandBar(props: Props) {
  const pageInputRef = useRef<HTMLInputElement>(null);

  const commitPage = () => {
    const page = normalizePdfEditorPageJump(pageInputRef.current?.value ?? '', props.totalPages) ?? props.currentPage;
    if (pageInputRef.current) pageInputRef.current.value = String(page);
    if (page !== props.currentPage) props.onPageChange(page);
  };

  return (
    <div className="pe-commandbar" data-testid="pdf-command-bar">
      <style>{`
        .pe-commandbar {
          height: 44px; flex: 0 0 44px;
          padding: 6px 10px;
          display: flex; align-items: center; gap: 6px;
          background: var(--pe-panel-2);
          border-bottom: 1px solid var(--pe-line);
          color: var(--pe-text);
          overflow: hidden;
          transition: background-color .35s var(--pe-ease-in-out), border-color .35s var(--pe-ease-in-out);
        }
        .pe-command-icon,
        .pe-command-button,
        .pe-command-step,
        .pe-search-step {
          min-height: 30px;
          border: 1px solid var(--pe-line);
          border-radius: var(--pe-r-sm);
          background: transparent;
          color: var(--pe-text-2);
          cursor: pointer;
          transition:
            background-color var(--pe-dur-fast) var(--pe-ease-out),
            border-color var(--pe-dur-fast) var(--pe-ease-out),
            color var(--pe-dur-fast) var(--pe-ease-out);
        }
        .pe-command-icon {
          width: 32px; flex: 0 0 32px;
          display: inline-flex; align-items: center; justify-content: center;
        }
        .pe-command-step {
          width: 28px; flex: 0 0 28px;
          display: inline-flex; align-items: center; justify-content: center;
        }
        .pe-command-icon:hover:not(:disabled),
        .pe-command-button:hover:not(:disabled),
        .pe-command-step:hover:not(:disabled),
        .pe-search-step:hover:not(:disabled) {
          background: var(--pe-panel-3);
          color: var(--pe-text);
          border-color: var(--pe-line-strong);
        }
        .pe-command-step:disabled,
        .pe-search-step:disabled { opacity: .35; cursor: default; }
        .pe-command-icon.active,
        .pe-command-button.active {
          border-color: var(--pe-signal-line);
          background: var(--pe-signal-soft);
          color: var(--pe-signal-ink);
        }
        .pe-command-divider {
          width: 1px; height: 20px; margin: 0 2px;
          background: var(--pe-line);
          flex: 0 0 1px;
        }
        .pe-command-inspector-divider { margin-left: auto; }
        .pe-command-segment {
          display: flex; gap: 2px; padding: 2px;
          border: 1px solid var(--pe-line);
          border-radius: 8px;
          background: var(--pe-panel);
          flex: 0 0 auto;
        }
        .pe-command-button {
          min-height: 26px;
          padding: 0 9px;
          border: 0;
          background: transparent;
          font-size: 11px;
          font-weight: 700;
          white-space: nowrap;
        }
        .pe-page-jump {
          display: flex; align-items: center; gap: 5px;
          color: var(--pe-text-3);
          font-size: 11px;
          white-space: nowrap;
          font-variant-numeric: tabular-nums;
        }
        .pe-page-jump input {
          width: 42px; height: 30px;
          border: 1px solid var(--pe-line);
          border-radius: var(--pe-r-sm);
          background: var(--pe-panel);
          color: var(--pe-text);
          text-align: center;
          font-family: inherit;
          font-size: 11.5px;
          outline: none;
          font-variant-numeric: tabular-nums;
        }
        .pe-page-jump input:focus-visible {
          border-color: var(--pe-signal);
          outline: 2px solid var(--pe-focus);
          outline-offset: 1px;
        }
        .pe-zoom-group {
          display: flex; align-items: center; gap: 2px;
          padding: 2px;
          border: 1px solid var(--pe-line);
          border-radius: 8px;
          background: var(--pe-panel);
          flex: 0 0 auto;
        }
        .pe-zoom-btn {
          width: 26px; height: 26px;
          border: 0; border-radius: 5px;
          background: transparent;
          color: var(--pe-text-2);
          font-size: 14px; font-weight: 700;
          cursor: pointer;
        }
        .pe-zoom-btn:hover { background: var(--pe-panel-3); color: var(--pe-text); }
        .pe-zoom-val {
          min-width: 40px; padding: 0 2px;
          border: 0; border-radius: 5px;
          background: transparent;
          color: var(--pe-text);
          font-family: inherit;
          font-size: 11px; font-weight: 700;
          font-variant-numeric: tabular-nums;
          cursor: pointer;
        }
        .pe-zoom-val:hover { background: var(--pe-panel-3); }
        .pe-search {
          min-width: 0; max-width: 360px; flex: 1 1 180px;
          height: 32px;
          display: flex; align-items: center;
          border: 1px solid var(--pe-line);
          border-radius: var(--pe-r-sm);
          background: var(--pe-panel);
          overflow: hidden;
        }
        .pe-search input {
          min-width: 0; flex: 1; height: 100%;
          padding: 0 9px;
          border: 0; outline: 0;
          background: transparent;
          color: var(--pe-text);
          font-family: inherit;
          font-size: 11.5px;
        }
        .pe-search input::placeholder { color: var(--pe-text-3); }
        .pe-search-meta {
          padding: 0 6px;
          color: var(--pe-text-3);
          font-size: 11px;
          white-space: nowrap;
          font-variant-numeric: tabular-nums;
        }
        .pe-search-step {
          width: 26px; height: 100%;
          border: 0; border-left: 1px solid var(--pe-line);
          border-radius: 0;
          background: transparent;
          color: var(--pe-text-2);
        }

        @media (max-width: 1080px) {
          .pe-view-modes { display: none; }
        }
        @media (max-width: 900px) {
          .pe-fit-modes { display: none; }
          .pe-commandbar { gap: 5px; }
        }
        @media (max-width: 700px) {
          .pe-commandbar { padding: 5px 7px; gap: 4px; height: 88px; flex-basis: 88px; flex-wrap: wrap; align-content: center; }
          .pe-page-jump span,
          .pe-search-meta { display: none; }
          .pe-search { order: 1; flex: 1 0 100%; max-width: none; height: 34px; }
          .pe-command-icon { width: 30px; flex-basis: 30px; }
          .pe-command-step { width: 26px; flex-basis: 26px; }
          .pe-zoom-btn { width: 24px; height: 24px; }
          .pe-zoom-val { min-width: 36px; }
          .pe-command-divider { display: none; }
          .pe-command-icon, .pe-command-step { min-height: 40px; }
        }
        @media (prefers-reduced-motion: reduce) {
          .pe-commandbar,
          .pe-command-icon,
          .pe-command-button,
          .pe-command-step,
          .pe-search-step { transition: none; }
        }
      `}</style>

      <button
        type="button"
        className={`pe-command-icon ${props.navigationOpen ? 'active' : ''}`}
        onClick={props.onNavigationToggle}
        aria-label={props.navigationOpen ? 'Hide document navigation' : 'Show document navigation'}
        aria-pressed={props.navigationOpen}
        title={props.navigationOpen ? 'Hide document navigation' : 'Show document navigation'}
        data-testid="pdf-navigation-toggle"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <rect x="3" y="4" width="6" height="16" rx="1" />
          <path d="M13 8h8M13 12h8M13 16h5" />
        </svg>
      </button>

      <button
        type="button"
        className="pe-command-step"
        onClick={props.onPrevPage}
        disabled={props.currentPage <= 1}
        aria-label="Previous page"
        title="Previous page"
        data-testid="pdf-page-prev"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <polyline points="15 18 9 12 15 6" />
        </svg>
      </button>

      <div className="pe-page-jump">
        <input
          key={props.currentPage}
          ref={pageInputRef}
          aria-label="Page number"
          data-testid="pdf-page-jump"
          inputMode="numeric"
          defaultValue={props.currentPage}
          onBlur={commitPage}
          onKeyDown={event => {
            if (event.key === 'Enter') {
              event.preventDefault();
              event.currentTarget.blur();
            }
          }}
        />
        <span>of {props.totalPages}</span>
      </div>

      <button
        type="button"
        className="pe-command-step"
        onClick={props.onNextPage}
        disabled={props.currentPage >= props.totalPages}
        aria-label="Next page"
        title="Next page"
        data-testid="pdf-page-next"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <polyline points="9 18 15 12 9 6" />
        </svg>
      </button>

      <div className="pe-zoom-group" aria-label="Zoom">
        <button type="button" className="pe-zoom-btn" onClick={props.onZoomOut} aria-label="Zoom out" title="Zoom out" data-testid="pdf-zoom-out">−</button>
        <button
          type="button"
          className="pe-zoom-val"
          onClick={props.onZoomReset}
          aria-label={`Reset zoom, currently ${Math.round(props.zoom * 100)} percent`}
          title="Reset zoom to 100%"
          data-testid="pdf-zoom-reset"
        >
          {Math.round(props.zoom * 100)}%
        </button>
        <button type="button" className="pe-zoom-btn" onClick={props.onZoomIn} aria-label="Zoom in" title="Zoom in" data-testid="pdf-zoom-in">+</button>
      </div>

      <div className="pe-command-divider" aria-hidden="true" />

      <div className="pe-command-segment pe-fit-modes" aria-label="Zoom mode">
        {([
          ['fit-page', 'Fit page'],
          ['fit-width', 'Fit width'],
          ['actual-size', 'Actual'],
        ] as const).map(([mode, label]) => (
          <button
            key={mode}
            type="button"
            className={`pe-command-button ${props.fitMode === mode ? 'active' : ''}`}
            onClick={() => props.onFitModeChange(mode)}
            aria-pressed={props.fitMode === mode}
            data-testid={`pdf-${mode}`}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="pe-command-segment pe-view-modes" aria-label="Page layout">
        {(['single', 'continuous'] as const).map(mode => (
          <button
            key={mode}
            type="button"
            className={`pe-command-button ${props.viewMode === mode ? 'active' : ''}`}
            onClick={() => props.onViewModeChange(mode)}
            aria-pressed={props.viewMode === mode}
          >
            {mode === 'single' ? 'Single' : 'Continuous'}
          </button>
        ))}
      </div>

      <div className="pe-search" role="search">
        <input
          aria-label="Search document"
          data-testid="pdf-document-search"
          placeholder="Search document"
          value={props.query}
          onChange={event => props.onQueryChange(event.target.value)}
        />
        <span className="pe-search-meta">
          {props.searching
            ? 'Searching'
            : props.query.trim().length >= 2
              ? `${props.resultCount ? props.activeResult + 1 : 0}/${props.resultCount}`
              : ''}
        </span>
        <button type="button" className="pe-search-step" aria-label="Previous search result" disabled={!props.resultCount} onClick={() => props.onResultStep(-1)}>↑</button>
        <button type="button" className="pe-search-step" aria-label="Next search result" disabled={!props.resultCount} onClick={() => props.onResultStep(1)}>↓</button>
      </div>

      <span className="pe-command-divider pe-command-inspector-divider" aria-hidden="true" />

      <button
        type="button"
        className={`pe-command-icon ${props.inspectorOpen ? 'active' : ''}`}
        onClick={props.onInspectorToggle}
        aria-label={props.inspectorOpen ? 'Hide inspector' : 'Show inspector'}
        aria-pressed={props.inspectorOpen}
        title={props.inspectorOpen ? 'Hide inspector' : 'Show inspector'}
        data-testid="pdf-inspector-toggle"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <rect x="3" y="4" width="18" height="16" rx="1.5" />
          <path d="M15 4v16M7 8h4M7 12h4M7 16h3" />
          <path d={props.inspectorOpen ? 'm18 9 3 3-3 3' : 'm6 9-3 3 3 3'} />
        </svg>
      </button>
      <button type="button" className="pe-command-icon" onClick={event => { event.currentTarget.focus(); props.onCommands(); }} aria-label="Open commands" title="Commands (Ctrl/Cmd+K)" data-testid="pdf-commands-open">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true"><path d="m5 6 5 6-5 6M13 18h6" /></svg>
      </button>
      <button type="button" className="pe-command-icon" onClick={event => { event.currentTarget.focus(); props.onHelp(); }} aria-label="Keyboard shortcuts" title="Keyboard shortcuts (?)" data-testid="pdf-help-open">?</button>
    </div>
  );
}
