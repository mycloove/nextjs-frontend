'use client';

import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import type { PdfExportImpact } from '../pdfEdit-utils/editorPreflight';

interface Props {
  impact: PdfExportImpact;
  fileName: string;
  onCancel: () => void;
  onConfirm: () => void;
}

export default function PdfExportImpactDialog({ impact, fileName, onCancel, onConfirm }: Props) {
  const cancelRef = useRef<HTMLButtonElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLElement>(null);
  const onCancelRef = useRef(onCancel);

  useEffect(() => {
    onCancelRef.current = onCancel;
  }, [onCancel]);

  useEffect(() => {
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    cancelRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onCancelRef.current();
        return;
      }
      if (event.key !== 'Tab') return;
      const cancel = cancelRef.current;
      const confirm = confirmRef.current;
      if (!cancel || !confirm) return;
      const activeElement = document.activeElement;
      const focusIsOutside = !dialogRef.current?.contains(activeElement);
      if (event.shiftKey && (activeElement === cancel || focusIsOutside)) {
        event.preventDefault();
        confirm.focus();
      } else if (!event.shiftKey && (activeElement === confirm || focusIsOutside)) {
        event.preventDefault();
        cancel.focus();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      previouslyFocused?.focus();
    };
  }, []);

  if (typeof document === 'undefined') return null;

  return createPortal(
    <div data-testid="pdf-export-impact-backdrop" className="pe-impact-backdrop" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onCancel();
    }}>
      <style>{`
        /* This dialog is portalled to <body>, so it redeclares the surface
           tokens on its own backdrop (same values as the editor root) and
           consumes them locally. No blur: a solid scrim is calmer and keeps
           the document readable behind a refusal. */
        .pe-impact-backdrop {
          position: fixed; inset: 0; z-index: 500;
          display: grid; place-items: center; padding: 24px;
          background: var(--pe-scrim);
          overflow: auto;
        }
        .pe-impact-dialog {
          width: min(560px, 100%); max-height: min(760px, calc(100dvh - 48px)); overflow: auto;
          border: 1px solid var(--pe-line); border-radius: var(--pe-r-md);
          background: var(--pe-panel); color: var(--pe-text);
          box-shadow: var(--pe-shadow-dialog);
          scrollbar-width: thin;
          scrollbar-color: var(--pe-scrollbar) transparent;
        }
        .pe-impact-head { padding: 22px 22px 16px; border-bottom: 1px solid var(--pe-line); }
        .pe-impact-kicker {
          color: var(--pe-warning);
          font-size: 11px; font-weight: 800; text-transform: uppercase; letter-spacing: .8px;
        }
        .pe-impact-title {
          margin: 7px 0 6px;
          font-family: 'Manrope', sans-serif; font-size: 19px; letter-spacing: 0;
        }
        .pe-impact-summary { margin: 0; color: var(--pe-text-2); font-size: 12.5px; line-height: 1.55; }
        .pe-impact-file {
          margin-top: 10px; color: var(--pe-text-3);
          font-size: 11px; overflow-wrap: anywhere;
        }
        .pe-impact-body { padding: 16px 22px; }
        .pe-impact-list { display: grid; gap: 8px; margin: 0; padding: 0; list-style: none; }
        .pe-impact-item {
          display: grid; grid-template-columns: 8px 1fr; gap: 10px;
          padding: 10px 11px;
          border: 1px solid var(--pe-line); border-radius: var(--pe-r-sm);
          background: var(--pe-panel-2);
        }
        .pe-impact-dot { width: 8px; height: 8px; margin-top: 4px; border-radius: 50%; background: var(--pe-warning); }
        .pe-impact-item.critical .pe-impact-dot { background: var(--pe-danger); }
        .pe-impact-item-title { font-size: 12px; font-weight: 750; }
        .pe-impact-item-detail { margin-top: 3px; color: var(--pe-text-2); font-size: 11.5px; line-height: 1.45; }
        .pe-impact-preserve {
          margin-top: 14px; padding: 11px 12px;
          border-left: 2px solid var(--pe-success);
          background: var(--pe-success-soft);
          color: var(--pe-text-2); font-size: 11.5px; line-height: 1.45;
        }
        .pe-impact-actions {
          display: flex; justify-content: flex-end; gap: 8px;
          padding: 14px 22px 20px;
        }
        .pe-impact-action {
          min-height: 36px; padding: 0 14px;
          border-radius: var(--pe-r-sm);
          font-family: inherit; font-size: 12px; font-weight: 750;
          cursor: pointer;
        }
        .pe-impact-cancel {
          border: 1px solid var(--pe-line); background: transparent; color: var(--pe-text-2);
        }
        .pe-impact-cancel:hover { background: var(--pe-panel-2); color: var(--pe-text); }
        .pe-impact-confirm { border: 1px solid var(--pe-signal); background: var(--pe-signal); color: var(--pe-on-signal); }
        .pe-impact-confirm:hover { border-color: var(--pe-signal-ink); }
        .pe-impact-action:focus-visible { outline: 2px solid var(--pe-focus); outline-offset: 2px; }
        @media (max-width: 520px) {
          .pe-impact-backdrop { padding: 12px; align-items: end; }
          .pe-impact-dialog { max-height: calc(100dvh - 24px); }
          .pe-impact-actions { flex-direction: column-reverse; }
          .pe-impact-action { width: 100%; }
        }
        @media (prefers-reduced-motion: reduce) {
          .pe-impact-action { transition: none; }
        }
      `}</style>
      <section
        ref={dialogRef}
        className="pe-impact-dialog"
        data-testid="pdf-export-impact-dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="pe-impact-title"
        aria-describedby="pe-impact-summary"
      >
        <header className="pe-impact-head">
          <div className="pe-impact-kicker">Export impact</div>
          <h2 className="pe-impact-title" id="pe-impact-title">{impact.title}</h2>
          <p className="pe-impact-summary" id="pe-impact-summary">{impact.summary}</p>
          <div className="pe-impact-file">{fileName}</div>
        </header>
        <div className="pe-impact-body">
          <ul className="pe-impact-list">
            {impact.consequences.map(item => (
              <li className={`pe-impact-item ${item.severity}`} key={item.id}>
                <span className="pe-impact-dot" aria-hidden="true" />
                <div>
                  <div className="pe-impact-item-title">{item.title}</div>
                  <div className="pe-impact-item-detail">{item.detail}</div>
                </div>
              </li>
            ))}
          </ul>
          {impact.preservationNotes.map(note => (
            <div className="pe-impact-preserve" key={note}>Preserved: {note}</div>
          ))}
        </div>
        <footer className="pe-impact-actions">
          <button ref={cancelRef} data-testid="pdf-export-cancel" className="pe-impact-action pe-impact-cancel" type="button" onClick={onCancel}>Cancel</button>
          <button ref={confirmRef} data-testid="pdf-export-confirm" className="pe-impact-action pe-impact-confirm" type="button" onClick={onConfirm}>{impact.confirmLabel}</button>
        </footer>
      </section>
    </div>,
    document.body,
  );
}
