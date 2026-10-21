'use client';

import { useEffect, useRef, useState } from 'react';
import type {
  PdfEditorCommentEntry,
  PdfEditorOutlineEntry,
} from '../pdfEdit-hooks/usePdfEditor';
import {
  getPdfEditorVirtualRange,
  type PdfEditorNavigationTab,
} from '../pdfEdit-utils/editorShell';
import type {
  PdfEditorPageEntry,
  PdfEditorPageOperation,
  PdfEditorPagePlan,
} from '../pdfEdit-utils/editorPageModel';

interface Props {
  open: boolean;
  activeTab: PdfEditorNavigationTab;
  currentPage: number;
  totalPages: number;
  pagePlan: PdfEditorPagePlan | null;
  outline: PdfEditorOutlineEntry[];
  comments: PdfEditorCommentEntry[];
  onTabChange: (tab: PdfEditorNavigationTab) => void;
  onPageChange: (page: number) => void;
  onPageOperation: (operation: PdfEditorPageOperation) => void;
  /** Source page → first output position, for outline and comment links. */
  positionForSourcePage: (page: number) => number;
  onClose: () => void;
  renderThumbnail: (page: number, canvas: HTMLCanvasElement, maxWidth?: number) => Promise<unknown>;
}

/**
 * Below this width the navigation panel renders as an overlay drawer on top of
 * the canvas, so selecting a page should dismiss it. Above it the panel sits
 * side-by-side with the canvas and must stay open when a page is selected.
 * Matches the `@media (max-width: 700px)` breakpoint in this component.
 */
function shouldAutoDismissOnSelect(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  return window.matchMedia('(max-width: 700px)').matches;
}

function Thumbnail({
  sourcePage,
  position,
  selected,
  onSelect,
  renderThumbnail,
}: {
  sourcePage: number;
  position: number;
  selected: boolean;
  onSelect: () => void;
  renderThumbnail: Props['renderThumbnail'];
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    void renderThumbnail(sourcePage, canvas, 142).catch(() => {});
  }, [sourcePage, renderThumbnail]);

  return (
    <button
      type="button"
      className={`pe-nav-thumbnail ${selected ? 'selected' : ''}`}
      aria-current={selected ? 'page' : undefined}
      aria-label={`Open output page ${position}`}
      onClick={onSelect}
      data-testid={`pdf-thumbnail-${position}`}
    >
      <span className="pe-nav-thumbnail-sheet"><canvas ref={canvasRef} /></span>
      <span className="pe-nav-thumbnail-label">{position}</span>
    </button>
  );
}

/**
 * One output page in the organizer. It is keyed by the plan entry id, not the
 * source page: a duplicated page is two different output pages with the same
 * source content, and the UI has to be able to move, rotate or delete either
 * one without touching the other.
 */
function OrganizerThumb({
  entry,
  position,
  count,
  selected,
  onSelect,
  onOperation,
  renderThumbnail,
}: {
  entry: PdfEditorPageEntry;
  position: number;
  count: number;
  selected: boolean;
  onSelect: () => void;
  onOperation: (operation: PdfEditorPageOperation) => void;
  renderThumbnail: Props['renderThumbnail'];
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    void renderThumbnail(entry.sourcePage, canvas, 92).catch(() => {});
  }, [entry.sourcePage, renderThumbnail]);

  return (
    <li
      className={`pe-organizer-item ${selected ? 'selected' : ''}`}
      data-organizer-position={position}
      draggable
      onDragStart={event => {
        event.dataTransfer.effectAllowed = 'move';
        event.dataTransfer.setData('text/plain', String(position));
      }}
      onDragOver={event => {
        event.preventDefault();
        event.dataTransfer.dropEffect = 'move';
      }}
      onDrop={event => {
        event.preventDefault();
        const from = Number.parseInt(event.dataTransfer.getData('text/plain'), 10);
        if (Number.isInteger(from) && from !== position) onOperation({ type: 'move', from, to: position });
      }}
      onKeyDown={event => {
        if (!event.altKey) return;
        if (event.key === 'ArrowUp' && position > 1) {
          event.preventDefault();
          onOperation({ type: 'move', from: position, to: position - 1 });
        }
        if (event.key === 'ArrowDown' && position < count) {
          event.preventDefault();
          onOperation({ type: 'move', from: position, to: position + 1 });
        }
      }}
    >
      <button
        type="button"
        className="pe-organizer-sheet"
        aria-label={`Output page ${position}, source page ${entry.sourcePage}${entry.rotation ? `, rotated ${entry.rotation} degrees` : ''}`}
        aria-current={selected ? 'page' : undefined}
        onClick={onSelect}
        data-testid={`pdf-organizer-page-${position}`}
      >
        <span className="pe-organizer-canvas">
          <span
            className="pe-organizer-canvas-inner"
            style={{ transform: `rotate(${entry.rotation}deg) scale(${entry.rotation % 180 === 0 ? 1 : 0.72})` }}
          >
            <canvas ref={canvasRef} />
          </span>
        </span>
        <span className="pe-organizer-label">
          <span>Output {position}</span>
          <span className="pe-organizer-meta">
            Source {entry.sourcePage}{entry.rotation ? ` · ${entry.rotation}°` : ''}
          </span>
        </span>
      </button>

      <div className="pe-organizer-actions">
        <button
          type="button"
          className="pe-organizer-action"
          aria-label={`Move output page ${position} earlier`}
          title="Move earlier (Alt+↑)"
          disabled={position <= 1}
          onClick={() => onOperation({ type: 'move', from: position, to: position - 1 })}
        >↑</button>
        <button
          type="button"
          className="pe-organizer-action"
          aria-label={`Move output page ${position} later`}
          title="Move later (Alt+↓)"
          disabled={position >= count}
          onClick={() => onOperation({ type: 'move', from: position, to: position + 1 })}
        >↓</button>
        <button
          type="button"
          className="pe-organizer-action"
          aria-label={`Rotate output page ${position} left`}
          title="Rotate left"
          onClick={() => onOperation({ type: 'rotate', pages: [position], delta: -90 })}
        >↺</button>
        <button
          type="button"
          className="pe-organizer-action"
          aria-label={`Rotate output page ${position} right`}
          title="Rotate right"
          onClick={() => onOperation({ type: 'rotate', pages: [position], delta: 90 })}
        >↻</button>
        <button
          type="button"
          className="pe-organizer-action"
          aria-label={`Duplicate output page ${position}`}
          title="Duplicate page"
          onClick={() => onOperation({ type: 'duplicate', pages: [position] })}
          data-testid={`pdf-organizer-duplicate-${position}`}
        >＋</button>
        <button
          type="button"
          className="pe-organizer-action danger"
          aria-label={`Delete output page ${position}`}
          title="Delete page (undo restores it)"
          disabled={count <= 1}
          onClick={() => onOperation({ type: 'delete', pages: [position] })}
          data-testid={`pdf-organizer-delete-${position}`}
        >×</button>
      </div>
    </li>
  );
}

export default function PdfEditorNavigationPanel(props: Props) {
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(600);
  const scrollRef = useRef<HTMLDivElement>(null);
  const organizerRef = useRef<HTMLDivElement>(null);
  const itemHeight = 174;
  const range = getPdfEditorVirtualRange({
    scrollTop,
    viewportHeight,
    itemHeight,
    itemCount: props.totalPages,
    overscan: 2,
  });

  useEffect(() => {
    const element = scrollRef.current;
    if (!element || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => setViewportHeight(element.clientHeight));
    observer.observe(element);
    setViewportHeight(element.clientHeight);
    return () => observer.disconnect();
  }, [props.open, props.activeTab]);

  // Keep the selected thumbnail visible when the current page changes
  // (e.g. via the page field or outline). Computed directly because the list
  // is virtualized — the target row may not be mounted to scroll into view.
  useEffect(() => {
    const element = scrollRef.current;
    if (!props.open || props.activeTab !== 'pages' || !element) return;
    const targetTop = (Math.max(1, props.currentPage) - 1) * itemHeight;
    if (targetTop < element.scrollTop || targetTop + itemHeight > element.scrollTop + element.clientHeight) {
      element.scrollTo({ top: Math.max(0, targetTop - itemHeight), behavior: 'smooth' });
    }
  }, [props.open, props.activeTab, props.currentPage]);

  useEffect(() => {
    if (!props.open || props.activeTab !== 'organize') return;
    organizerRef.current
      ?.querySelector<HTMLElement>(`[data-organizer-position="${props.currentPage}"]`)
      ?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [props.open, props.activeTab, props.currentPage]);

  const pages = Array.from({ length: Math.max(0, range.end - range.start) }, (_, index) => range.start + index + 1);

  return (
    <aside className={`pe-navigation ${props.open ? 'open' : ''}`} data-testid="pdf-navigation-panel" aria-label="Document navigation">
      <style>{`
        .pe-navigation {
          width: 220px; flex: 0 0 220px;
          display: flex; flex-direction: column; min-width: 0;
          background: var(--pe-panel);
          border-right: 1px solid var(--pe-line);
          color: var(--pe-text);
          overflow: hidden;
          transition: width var(--pe-dur-base) var(--pe-ease-out), flex-basis var(--pe-dur-base) var(--pe-ease-out), border-color var(--pe-dur-base) var(--pe-ease-out);
        }
        .pe-nav-tabs {
          height: 40px; display: grid; grid-template-columns: repeat(4,1fr);
          padding: 5px; gap: 3px;
          border-bottom: 1px solid var(--pe-line);
        }
        .pe-nav-tab {
          border: 0; border-radius: 5px;
          background: transparent;
          color: var(--pe-text-2);
          font-family: inherit;
          font-size: 11px; font-weight: 700;
          cursor: pointer;
        }
        .pe-nav-tab:hover { background: var(--pe-panel-3); color: var(--pe-text); }
        .pe-nav-tab.active { background: var(--pe-signal-soft); color: var(--pe-signal-ink); }
        .pe-nav-close { display: none; }
        .pe-nav-content {
          flex: 1; min-height: 0; overflow: auto;
          scrollbar-width: thin;
          scrollbar-color: var(--pe-scrollbar) transparent;
        }
        .pe-nav-virtual { position: relative; width: 100%; }
        .pe-nav-thumbnail {
          position: absolute; left: 11px;
          width: 198px; height: 164px;
          padding: 8px 10px 5px;
          display: flex; flex-direction: column; align-items: center; gap: 6px;
          border: 1px solid transparent; border-radius: var(--pe-r-sm);
          background: transparent;
          color: var(--pe-text-2);
          cursor: pointer;
        }
        .pe-nav-thumbnail:hover { background: var(--pe-panel-3); }
        .pe-nav-thumbnail.selected {
          border-color: var(--pe-signal-line);
          background: var(--pe-signal-soft);
          color: var(--pe-text);
        }
        .pe-nav-thumbnail-sheet {
          width: 134px; height: 120px;
          display: flex; align-items: center; justify-content: center;
          background: transparent; overflow: hidden;
        }
        .pe-nav-thumbnail canvas {
          display: block; max-width: 134px; max-height: 120px;
          width: auto; height: auto;
          box-shadow: var(--pe-shadow-page);
        }
        .pe-nav-thumbnail-label { font-size: 11px; font-variant-numeric: tabular-nums; }
        .pe-nav-list { padding: 8px; display: flex; flex-direction: column; gap: 2px; }
        .pe-nav-entry {
          width: 100%; min-height: 40px;
          border: 0; border-radius: 5px;
          padding: 7px 8px;
          display: flex; align-items: center; gap: 8px;
          background: transparent;
          color: var(--pe-text-2);
          text-align: left; cursor: pointer;
        }
        .pe-nav-entry:hover, .pe-nav-entry.current { background: var(--pe-panel-3); color: var(--pe-text); }
        .pe-nav-entry:disabled { cursor: default; opacity: .6; }
        .pe-nav-entry-copy { min-width: 0; flex: 1; }
        .pe-nav-entry-title {
          display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
          font-size: 11.5px; font-weight: 650;
        }
        .pe-nav-entry-meta {
          display: block; margin-top: 2px;
          color: var(--pe-text-3); font-size: 11px;
          font-variant-numeric: tabular-nums;
        }
        .pe-nav-empty {
          padding: 34px 18px;
          color: var(--pe-text-3); font-size: 11.5px; line-height: 1.5;
          text-align: center;
        }

        /* Page organizer — output order is the list order. */
        .pe-organizer {
          flex: 1; min-height: 0; overflow: auto;
          padding: 10px;
          scrollbar-width: thin;
          scrollbar-color: var(--pe-scrollbar) transparent;
        }
        .pe-organizer-intro {
          margin: 0 0 10px;
          color: var(--pe-text-3);
          font-size: 11px; line-height: 1.5;
        }
        .pe-organizer-list {
          list-style: none; margin: 0; padding: 0;
          display: grid; grid-template-columns: 1fr 1fr; gap: 8px;
        }
        .pe-organizer-item {
          position: relative;
          min-width: 0;
          border: 1px solid var(--pe-line);
          border-radius: var(--pe-r-sm);
          background: var(--pe-panel-2);
          padding: 6px;
        }
        .pe-organizer-item.selected {
          border-color: var(--pe-signal-line);
          background: var(--pe-signal-soft);
        }
        .pe-organizer-item[draggable="true"] { cursor: grab; }
        .pe-organizer-sheet {
          width: 100%;
          display: flex; flex-direction: column; align-items: stretch; gap: 5px;
          padding: 0; border: 0; background: transparent;
          color: inherit; font-family: inherit; text-align: left; cursor: pointer;
          border-radius: 4px;
        }
        .pe-organizer-canvas {
          display: flex; align-items: center; justify-content: center;
          min-height: 74px;
          background: var(--pe-panel);
          border: 1px solid var(--pe-line);
          overflow: hidden;
        }
        .pe-organizer-canvas canvas {
          display: block; max-width: 100%; max-height: 86px;
          width: auto; height: auto;
          box-shadow: var(--pe-shadow-page);
        }
        .pe-organizer-canvas-inner {
          display: flex; align-items: center; justify-content: center;
          max-width: 100%; max-height: 100%;
          transition: transform var(--pe-dur-base) var(--pe-ease-out);
        }
        .pe-organizer-label { display: flex; flex-direction: column; gap: 1px; min-width: 0; }
        .pe-organizer-label > span:first-child {
          color: var(--pe-text); font-size: 11px; font-weight: 700;
          font-variant-numeric: tabular-nums;
        }
        .pe-organizer-meta {
          color: var(--pe-text-3); font-size: 11px;
          white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
          font-variant-numeric: tabular-nums;
        }
        .pe-organizer-actions {
          display: grid; grid-template-columns: repeat(3, 1fr); gap: 3px;
          margin-top: 6px;
        }
        .pe-organizer-action {
          min-height: 26px;
          border: 1px solid var(--pe-line);
          border-radius: 4px;
          background: transparent;
          color: var(--pe-text-2);
          font-family: inherit; font-size: 12px; font-weight: 700;
          cursor: pointer;
        }
        .pe-organizer-action:hover:not(:disabled) {
          border-color: var(--pe-line-strong); color: var(--pe-text);
          background: var(--pe-panel-3);
        }
        .pe-organizer-action:disabled { opacity: .3; cursor: not-allowed; }
        .pe-organizer-action.danger:hover:not(:disabled) {
          border-color: var(--pe-danger); color: var(--pe-danger);
          background: var(--pe-danger-soft);
        }
        @media (max-width: 700px) {
          .pe-organizer-action { min-height: 40px; }
        }
        @media (prefers-reduced-motion: reduce) {
          .pe-navigation { transition: none; }
        }
        @media (max-width: 1180px) {
          .pe-navigation {
            position: fixed; z-index: 85; left: 64px; top: 94px; bottom: 28px;
            transform: translateX(calc(-100% - 64px));
            transition: transform var(--pe-dur-base) var(--pe-ease-out);
            box-shadow: 12px 0 35px rgba(0,0,0,.42);
        }
          .pe-navigation.open { transform: translateX(0); }
          [data-theme="light"] .pe-navigation { box-shadow: 12px 0 35px rgba(30,24,48,.16); }
        }
        @media (min-width: 1181px) {
          .pe-navigation:not(.open) { width: 0; flex-basis: 0; border-right-color: transparent; }
        }
        @media (max-width: 700px) {
          .pe-navigation { left: 0; top: 94px; bottom: calc(82px + env(safe-area-inset-bottom)); width: min(86vw, 300px); flex-basis: min(86vw, 300px); }
        }
        @media (prefers-reduced-motion: reduce) {
          .pe-navigation { transition: none; }
          .pe-organizer-canvas-inner { transition: none; }
        }
      `}</style>
      <div className="pe-nav-tabs" role="tablist" aria-label="Document navigation views">
        {(['pages', 'organize', 'outline', 'comments'] as const).map(tab => (
          <button
            key={tab}
            type="button"
            role="tab"
            aria-selected={props.activeTab === tab}
            className={`pe-nav-tab ${props.activeTab === tab ? 'active' : ''}`}
            onClick={() => props.onTabChange(tab)}
            data-testid={`pdf-nav-${tab}`}
          >
            {tab === 'organize' ? 'Arrange' : tab[0].toUpperCase() + tab.slice(1)}
          </button>
        ))}
      </div>

      {props.activeTab === 'pages' && (
        <div
          className="pe-nav-content"
          ref={scrollRef}
          onScroll={event => setScrollTop(event.currentTarget.scrollTop)}
          data-testid="pdf-thumbnail-list"
        >
          <div className="pe-nav-virtual" style={{ height: props.totalPages * itemHeight }}>
            {pages.map(page => (
              <div key={page} style={{ position: 'absolute', top: (page - 1) * itemHeight, height: itemHeight }}>
                <Thumbnail
                  sourcePage={props.pagePlan?.entries[page - 1]?.sourcePage ?? page}
                  position={page}
                  selected={props.currentPage === page}
                  onSelect={() => {
                    // Always navigate, but only auto-dismiss the panel on
                    // phone viewports where it overlays the canvas.
                    props.onPageChange(page);
                    if (shouldAutoDismissOnSelect()) props.onClose();
                  }}
                  renderThumbnail={props.renderThumbnail}
                />
              </div>
            ))}
          </div>
        </div>
      )}

      {props.activeTab === 'organize' && (
        <div className="pe-organizer" data-testid="pdf-page-organizer" ref={organizerRef}>
          <p className="pe-organizer-intro">
            Drag a page, use Alt+↑/↓, or use the buttons. Page order here is the export order; undo restores a deleted page.
          </p>
          {props.pagePlan ? (
            <ul className="pe-organizer-list">
              {props.pagePlan.entries.map((entry, index) => {
                const position = index + 1;
                return (
                  <OrganizerThumb
                    key={entry.id}
                    entry={entry}
                    position={position}
                    count={props.pagePlan?.entries.length ?? 0}
                    selected={props.currentPage === position}
                    onSelect={() => {
                      props.onPageChange(position);
                      if (shouldAutoDismissOnSelect()) props.onClose();
                    }}
                    onOperation={props.onPageOperation}
                    renderThumbnail={props.renderThumbnail}
                  />
                );
              })}
            </ul>
          ) : <div className="pe-nav-empty">Open a document to arrange its pages.</div>}
        </div>
      )}

      {props.activeTab === 'outline' && (
        <div className="pe-nav-content pe-nav-list" data-testid="pdf-outline-list">
          {props.outline.length ? props.outline.map(entry => {
            const position = entry.page ? props.positionForSourcePage(entry.page) : null;
            return (
              <button
                key={entry.id}
                type="button"
                className={`pe-nav-entry ${position === props.currentPage ? 'current' : ''}`}
                style={{ paddingLeft: 9 + entry.depth * 14 }}
                disabled={!position}
                onClick={() => position && props.onPageChange(position)}
              >
                <span className="pe-nav-entry-copy">
                  <span className="pe-nav-entry-title">{entry.title}</span>
                  <span className="pe-nav-entry-meta">{position ? `Output page ${position}` : 'Destination unavailable'}</span>
                </span>
              </button>
            );
          }) : <div className="pe-nav-empty">This document has no outline.</div>}
        </div>
      )}

      {props.activeTab === 'comments' && (
        <div className="pe-nav-content pe-nav-list" data-testid="pdf-comments-list">
          {props.comments.length ? props.comments.map(comment => {
            const position = props.positionForSourcePage(comment.page);
            return (
              <button
                key={comment.id}
                type="button"
                className={`pe-nav-entry ${position === props.currentPage ? 'current' : ''}`}
                disabled={!position}
                onClick={() => { if (position) props.onPageChange(position); }}
              >
                <span className="pe-nav-entry-copy">
                  <span className="pe-nav-entry-title">{comment.contents}</span>
                  <span className="pe-nav-entry-meta">
                    {comment.subtype} · {position ? `Output page ${position}` : 'Page removed'} · {comment.author}
                  </span>
                </span>
              </button>
            );
          }) : <div className="pe-nav-empty">This document has no comments.</div>}
        </div>
      )}
    </aside>
  );
}