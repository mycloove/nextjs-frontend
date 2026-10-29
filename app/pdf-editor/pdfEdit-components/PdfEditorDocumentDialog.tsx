'use client';

import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';

export type PdfEditorDocumentDialogKind = 'processing' | 'recovery' | 'ocr' | 'close';

const COPY = {
  processing: {
    title: 'Allow server processing for this PDF?',
    confirm: 'Allow server processing',
    paragraphs: [
      'Original-text export, its final preview, and OCR require sending the entire PDF to the SmilePDF processing server, not just the selected page or text. Editing drafts, adding objects and supported annotations, and arranging pages can stay in this browser.',
      'Processing can use temporary upload, font and OCR files. Quota and usage systems may retain metadata such as the filename and request fingerprint. This is not a promise of secure deletion, zero retention or a particular storage region.',
      'Permission lasts only while this document is open in this tab. Closing, replacing or reloading it requires permission again. This does not approve signature or fidelity loss, nearby-content removal, or permanent redaction.',
    ],
  },
  recovery: {
    title: 'Remove recovery for this PDF?',
    confirm: 'Remove this PDF\'s recovery',
    paragraphs: [
      'Remove this document\'s stored source PDF and draft from this browser. Other PDFs, their recovery entries and the object clipboard are not cleared.',
      'Your current work stays open and editable. Recovery is disabled for the rest of this open session, including delayed saves. Export your work before closing or reloading; it will not be recoverable from this tab\'s removed entry.',
      'This removes browser recovery records, not previously downloaded files or server processing data. It is not a secure-erasure guarantee.',
    ],
  },
  ocr: {
    title: 'Create an English searchable raster copy?',
    confirm: 'Create OCR copy',
    paragraphs: [
      'OCR rasterizes every page and adds recognized English text to a new PDF. It downloads a separate copy; the open document is not replaced.',
      'The copy does not preserve native text, vector objects, form fields, annotations, tags or digital signatures as editable structures. Review the copy before relying on its text or appearance.',
      'Searchable text is not faithful visible scan editing. OCR can recognize words incorrectly; changing its hidden text does not change the visible scan. Export and open a copy first if this document has edited work.',
    ],
  },
  close: {
    title: 'Close without local recovery?',
    confirm: 'Close without recovery',
    paragraphs: [
      'Recovery is disabled for this open PDF. Closing now discards the working state in this tab. Export your PDF first if you need to keep these changes.',
      'Previously downloaded files and other PDFs\' recovery entries will not be changed.',
    ],
  },
} as const;

export default function PdfEditorDocumentDialog({ kind, fileName, onCancel, onConfirm }: {
  kind: PdfEditorDocumentDialogKind;
  fileName: string;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const cancelRef = useRef<HTMLButtonElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLElement>(null);
  const cancelActionRef = useRef(onCancel);
  useEffect(() => { cancelActionRef.current = onCancel; }, [onCancel]);
  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    cancelRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopImmediatePropagation();
        cancelActionRef.current();
      } else if (event.key === 'Tab') {
        const outside = !dialogRef.current?.contains(document.activeElement);
        if (event.shiftKey && (outside || document.activeElement === cancelRef.current)) {
          event.preventDefault();
          confirmRef.current?.focus();
        } else if (!event.shiftKey && (outside || document.activeElement === confirmRef.current)) {
          event.preventDefault();
          cancelRef.current?.focus();
        }
      }
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => { window.removeEventListener('keydown', onKeyDown, true); if (previous?.isConnected) previous.focus(); };
  }, []);
  if (typeof document === 'undefined') return null;
  const copy = COPY[kind];
  return createPortal(
    <div className="pe-document-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) onCancel(); }}>
      <style>{`
        .pe-document-backdrop { position: fixed; inset: 0; z-index: 510; display: grid; place-items: center; padding: 24px; background: var(--pe-scrim); overflow: auto; }
        .pe-document-dialog { width: min(560px, 100%); max-height: calc(100dvh - 48px); overflow: auto; border: 1px solid var(--pe-line); border-radius: var(--pe-r-md); background: var(--pe-panel); color: var(--pe-text); box-shadow: var(--pe-shadow-dialog); }
        .pe-document-dialog header { padding: 22px 22px 16px; border-bottom: 1px solid var(--pe-line); }
        .pe-document-dialog h2 { margin: 0 0 8px; font-family: 'Manrope', sans-serif; font-size: 19px; }
        .pe-document-file { color: var(--pe-text-2); font-size: 12px; overflow-wrap: anywhere; }
        .pe-document-explanation { padding: 4px 22px; color: var(--pe-text-2); font-size: 13px; line-height: 1.6; }
        .pe-document-explanation p { margin: 14px 0; }
        .pe-document-actions { display: flex; justify-content: flex-end; flex-wrap: wrap; gap: 8px; padding: 16px 22px 22px; }
        .pe-document-actions button { min-height: 40px; padding: 8px 14px; border: 1px solid var(--pe-line-strong); border-radius: var(--pe-r-sm); background: var(--pe-panel); color: var(--pe-text); font: inherit; font-size: 12px; font-weight: 700; cursor: pointer; }
        .pe-document-actions button:last-child { background: var(--pe-signal); border-color: var(--pe-signal); color: var(--pe-on-signal); }
        .pe-document-actions button:hover { border-color: var(--pe-signal-ink); }
        .pe-document-actions button:focus-visible { outline: 2px solid var(--pe-focus); outline-offset: 3px; }
        @media (max-width: 520px) { .pe-document-backdrop { padding: 12px; } .pe-document-dialog { max-height: calc(100dvh - 24px); } .pe-document-actions { flex-direction: column-reverse; } }
      `}</style>
      <section ref={dialogRef} className="pe-document-dialog" role="dialog" aria-modal="true" aria-labelledby={`pe-${kind}-title`} aria-describedby={`pe-${kind}-description`} data-testid={`pdf-${kind}-dialog`}>
        <header><h2 id={`pe-${kind}-title`}>{copy.title}</h2><div className="pe-document-file">{fileName}</div></header>
        <div className="pe-document-explanation" id={`pe-${kind}-description`}>{copy.paragraphs.map(paragraph => <p key={paragraph}>{paragraph}</p>)}</div>
        <footer className="pe-document-actions">
          <button ref={cancelRef} type="button" data-testid={`pdf-${kind}-cancel`} onClick={onCancel}>{kind === 'processing' ? 'Keep local' : 'Cancel'}</button>
          <button ref={confirmRef} type="button" data-testid={`pdf-${kind}-confirm`} onClick={onConfirm}>{copy.confirm}</button>
        </footer>
      </section>
    </div>, document.body,
  );
}
