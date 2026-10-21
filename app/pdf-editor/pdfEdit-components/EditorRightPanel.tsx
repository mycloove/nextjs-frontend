'use client';
// ─────────────────────────────────────────────────────────────
//  EditorRightPanel.tsx
//  Right-side properties panel:
//  • Heading / font / size / style
//  • Color pickers (text + fill)
//  • Line spacing
//  • Alignment
//  • Emoji picker
//  • Image insert
// ─────────────────────────────────────────────────────────────

import { useEffect, useRef, useState } from 'react';
import { PAGE_SIZE_PRESETS, TextStyle, HeadingLevel, PageSizeKey } from '../pdfEdit-hooks/usePdfEditor';

const FONTS = [
  'Helvetica', 'Times New Roman', 'Courier New',
  'Georgia', 'Verdana', 'Arial', 'Trebuchet MS',
];

const FONT_SIZES = [8, 9, 10, 11, 12, 14, 16, 18, 20, 24, 28, 32, 36, 42, 48, 60, 72];

const HEADINGS: { value: HeadingLevel; label: string }[] = [
  { value: 'h1',   label: 'H1 — Heading 1' },
  { value: 'h2',   label: 'H2 — Heading 2' },
  { value: 'h3',   label: 'H3 — Heading 3' },
  { value: 'h4',   label: 'H4 — Heading 4' },
  { value: 'h5',   label: 'H5 — Heading 5' },
  { value: 'h6',   label: 'H6 — Heading 6' },
  { value: 'body', label: 'Body text' },
];

const PRESET_COLORS = [
  '#000000','#ffffff','#ef4444','#f97316','#eab308',
  '#22c55e','#3b82f6','#8b5cf6','#ec4899','#6b7280',
];

const EMOJIS = [
  '😊','😂','👍','❤️','🎉','⭐','✅','❌',
  '📌','📎','🔑','💡','⚠️','🔥','✨','🎯',
  '📄','📝','📊','🗂️','🖊️','🖋️','📏','🔖',
];

import type { PdfDocumentPreflight } from '../pdfEdit-utils/editorPreflight';
import { describePdfEditorRedactionImpact } from '../pdfEdit-utils/editorRedaction';
import type { PdfEditorRedactionMark } from '../pdfEdit-utils/editorRedaction';
import type { PdfEditorInspectorContext } from '../pdfEdit-utils/editorInspectorContext';
import type {
  PdfEditorAlignMode,
  PdfEditorDistributeAxis,
  PdfEditorLayer,
  PdfEditorObjectGeometry,
  PdfEditorObjectStyle,
} from '../pdfEdit-utils/editorObjectOps';
import {
  describePdfEditorAnnotationImpact,
  pdfEditorAnnotationReplies,
  PDF_EDITOR_STAMP_PRESETS,
  type PdfEditorAnnotation,
  type PdfEditorAnnotationKind,
  type PdfEditorAnnotationStyle,
} from '../pdfEdit-utils/editorAnnotations';

const ANNOTATION_KINDS: { kind: PdfEditorAnnotationKind; label: string }[] = [
  { kind: 'highlight', label: 'Highlight' },
  { kind: 'underline', label: 'Underline' },
  { kind: 'strikeout', label: 'Strikeout' },
  { kind: 'note', label: 'Note' },
  { kind: 'stamp', label: 'Stamp' },
  { kind: 'link', label: 'Link' },
];

interface Props {
  textStyle:           TextStyle;
  pageSize:            PageSizeKey;
  onStyleChange:       (partial: Partial<TextStyle>) => void;
  onEmojiSelect:       (emoji: string) => void;
  onImageInsert:       (file: File) => void;
  onSignatureStart:    () => void;
  onSignatureStop:     () => void;
  onSignatureUpload:   (file: File) => void;
  isSignatureMode:     boolean;
  onPageSizeChange:    (pageSize: PageSizeKey) => void;
  contextLabel?:       string;
  context?:            PdfEditorInspectorContext;
  selectedObjectKind?: 'none' | 'text' | 'image' | 'shape';
  preflightReport?:    PdfDocumentPreflight | null;
  onOpenAnnotations?:  () => void;
  /** W3 review surface. Only read when the redact tool is active. */
  redactionMarks?:     readonly PdfEditorRedactionMark[];
  onUnmarkRedaction?:  (id: string) => void;
  onClearRedactions?:  () => void;
  /** W4 object geometry and layers. */
  objectGeometry?: PdfEditorObjectGeometry | null;
  objectStyle?: PdfEditorObjectStyle | null;
  objectLocked?: boolean;
  objectHidden?: boolean;
  selectedObjectCount?: number;
  hasObjectClipboard?: boolean;
  layers?: readonly PdfEditorLayer[];
  onObjectGeometryChange?: (partial: Partial<PdfEditorObjectGeometry>) => void;
  onObjectStyleChange?: (partial: Partial<PdfEditorObjectStyle>) => void;
  onToggleObjectLock?: () => void;
  onToggleObjectHidden?: () => void;
  onDuplicateObject?: () => void;
  onCopyObject?: () => void;
  onPasteObject?: () => void;
  onDeleteObject?: () => void;
  onAlignObjects?: (mode: PdfEditorAlignMode) => void;
  onDistributeObjects?: (axis: PdfEditorDistributeAxis) => void;
  onGroupObjects?: () => void;
  onUngroupObjects?: () => void;
  onSelectLayer?: (id: string) => void;
  onToggleLayerLock?: (id: string) => void;
  onToggleLayerHidden?: (id: string) => void;
  onMoveLayer?: (id: string, direction: 'front' | 'back' | 'forward' | 'backward') => void;
  /** W4 annotations. */
  annotations?: readonly PdfEditorAnnotation[];
  /** Source page currently on screen; the per-page list is scoped to it. */
  annotationPage?: number;
  annotationKind?: PdfEditorAnnotationKind;
  annotationStyle?: PdfEditorAnnotationStyle;
  selectedAnnotationId?: string | null;
  onAnnotationKindChange?: (kind: PdfEditorAnnotationKind) => void;
  onAnnotationStyleChange?: (partial: Partial<PdfEditorAnnotationStyle>) => void;
  onSelectAnnotation?: (id: string | null) => void;
  onUpdateAnnotation?: (
    id: string,
    partial: Partial<Pick<PdfEditorAnnotation, 'author' | 'contents' | 'color' | 'uri' | 'stamp'>>,
  ) => void;
  onRemoveAnnotation?: (id: string) => void;
  onReplyToAnnotation?: (parentId: string, contents: string) => void;
}

/**
 * A numeric inspector field that commits on Enter/blur instead of on every
 * keystroke. Committing per keystroke turns "120" into 1 → 12 → 120 and creates
 * three undo steps (and three geometry writes) for one intended value.
 */
function GeometryField({
  label,
  value,
  onCommit,
}: {
  label: string;
  value: number;
  onCommit: (value: number) => void;
}) {
  const [draft, setDraft] = useState(String(Math.round(value * 10) / 10));
  useEffect(() => {
    setDraft(String(Math.round(value * 10) / 10));
  }, [value]);

  const commit = () => {
    const next = Number(draft);
    if (Number.isFinite(next)) onCommit(next);
    else setDraft(String(Math.round(value * 10) / 10));
  };

  return (
    <label className="pe-geometry-field">
      <span>{label}</span>
      <input
        type="number"
        inputMode="decimal"
        step="0.5"
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            commit();
            event.currentTarget.blur();
          }
          if (event.key === 'Escape') {
            setDraft(String(Math.round(value * 10) / 10));
            event.currentTarget.blur();
          }
        }}
      />
    </label>
  );
}

export default function EditorRightPanel({
  textStyle, pageSize,
  onStyleChange, onEmojiSelect, onImageInsert,
  onSignatureStart, onSignatureStop, onSignatureUpload, isSignatureMode, onPageSizeChange,
  contextLabel = 'Document',
  context = 'document',
  selectedObjectKind = 'none',
  preflightReport = null,
  onOpenAnnotations,
  redactionMarks = [],
  onUnmarkRedaction,
  onClearRedactions,
  objectGeometry = null,
  objectStyle = null,
  objectLocked = false,
  objectHidden = false,
  selectedObjectCount = 0,
  hasObjectClipboard = false,
  layers = [],
  onObjectGeometryChange,
  onObjectStyleChange,
  onToggleObjectLock,
  onToggleObjectHidden,
  onDuplicateObject,
  onCopyObject,
  onPasteObject,
  onDeleteObject,
  onAlignObjects,
  onDistributeObjects,
  onGroupObjects,
  onUngroupObjects,
  onSelectLayer,
  onToggleLayerLock,
  onToggleLayerHidden,
  onMoveLayer,
  annotations = [],
  annotationPage = 1,
  annotationKind = 'highlight',
  annotationStyle = { color: '#ffe14d', author: 'Reviewer', stamp: 'Approved', uri: '' },
  selectedAnnotationId = null,
  onAnnotationKindChange,
  onAnnotationStyleChange,
  onSelectAnnotation,
  onUpdateAnnotation,
  onRemoveAnnotation,
  onReplyToAnnotation,
}: Props) {
  const imgInputRef = useRef<HTMLInputElement>(null);
  const signatureInputRef = useRef<HTMLInputElement>(null);
  const [replyDraft, setReplyDraft] = useState('');
  const showText = context === 'text';
  const showDocument = context === 'document' || context === 'page';
  const showImage = context === 'image';
  const showSignature = context === 'signature';
  const showEmoji = context === 'emoji';
  const showRedaction = context === 'redaction';
  const showAnnotation = context === 'annotation';
  const redactionImpact = describePdfEditorRedactionImpact(redactionMarks);
  const annotationImpact = describePdfEditorAnnotationImpact(annotations);
  const selectedAnnotation = annotations.find(annotation => annotation.id === selectedAnnotationId) ?? null;
  const annotationReplies = selectedAnnotation
    ? pdfEditorAnnotationReplies(annotations, selectedAnnotation.id)
    : [];
  const annotationRoots = annotations.filter(annotation => !annotation.replyTo);
  const pageAnnotationRoots = annotationRoots.filter(annotation => annotation.page === annotationPage);
  const offPageAnnotationCount = annotationRoots.length - pageAnnotationRoots.length;

  const submitReply = () => {
    if (!selectedAnnotation || !replyDraft.trim()) return;
    onReplyToAnnotation?.(selectedAnnotation.id, replyDraft.trim());
    setReplyDraft('');
  };

  return (
    <>
      <style>{`
        .pe-rp {
          width: 100%; min-width: 0; flex-shrink: 0;
          background: var(--pe-panel);
          border-left: 1px solid var(--pe-line);
          display: flex; flex-direction: column;
          overflow-y: auto; overflow-x: hidden;
          scrollbar-width: thin;
          scrollbar-color: var(--pe-scrollbar) transparent;
          color: var(--pe-text);
          transition: background-color .35s var(--pe-ease-in-out), border-color .35s var(--pe-ease-in-out);
        }
        .pe-rp-context {
          position: sticky; top: 0; z-index: 2;
          height: 44px; padding: 0 12px;
          display: flex; align-items: center; gap: 8px;
          background: var(--pe-panel);
          border-bottom: 1px solid var(--pe-line);
        }
        .pe-rp-context-copy { min-width: 0; flex: 1; }
        .pe-rp-context-label {
          display: block; color: var(--pe-text);
          font-size: 11.5px; font-weight: 700;
          overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
        }
        .pe-rp-context-meta {
          display: block; margin-top: 1px;
          color: var(--pe-text-3); font-size: 11px;
        }
        .pe-rp::-webkit-scrollbar { width: 3px; }
        .pe-rp::-webkit-scrollbar-thumb { background: var(--pe-scrollbar); border-radius: 3px; }

        .pe-rp-section {
          padding: 12px 14px;
          border-bottom: 1px solid var(--pe-line);
        }
        .pe-rp-title {
          font-size: 11px; font-weight: 700; letter-spacing: .9px;
          text-transform: uppercase; color: var(--pe-text-3);
          margin-bottom: 9px; display: block;
        }
        .pe-rp-row { display: flex; gap: 6px; margin-bottom: 7px; align-items: center; }
        .pe-rp-row:last-child { margin-bottom: 0; }
        .pe-rp-help {
          font-size: 11px;
          line-height: 1.45;
          color: var(--pe-text-3);
          margin-top: 7px;
        }

        /* Select */
        .pe-select {
          flex: 1; appearance: none; -webkit-appearance: none;
          background: var(--pe-panel-2);
          border: 1px solid var(--pe-line);
          border-radius: var(--pe-r-sm); padding: 7px 8px;
          font-family: inherit;
          font-size: 11.5px; color: var(--pe-text);
          cursor: pointer; outline: none;
          transition: border-color var(--pe-dur-fast) var(--pe-ease-out);
        }
        .pe-select:hover { border-color: var(--pe-line-strong); }
        .pe-select:focus-visible { border-color: var(--pe-signal); outline: 2px solid var(--pe-focus); outline-offset: 1px; }
        .pe-select option { background: var(--pe-panel); color: var(--pe-text); }

        /* Number input */
        .pe-num-input {
          width: 54px; text-align: center;
          background: var(--pe-panel-2);
          border: 1px solid var(--pe-line);
          border-radius: var(--pe-r-sm); padding: 7px 4px;
          font-family: inherit;
          font-size: 12px; color: var(--pe-text); outline: none;
          font-variant-numeric: tabular-nums;
          transition: border-color var(--pe-dur-fast) var(--pe-ease-out);
        }
        .pe-num-input:focus-visible { border-color: var(--pe-signal); outline: 2px solid var(--pe-focus); outline-offset: 1px; }

        /* Toggle buttons (bold / italic / underline / align) */
        .pe-toggle-group { display: flex; gap: 3px; }
        .pe-toggle-btn {
          width: 30px; height: 30px; border-radius: var(--pe-r-sm);
          background: transparent;
          border: 1px solid var(--pe-line);
          display: flex; align-items: center; justify-content: center;
          cursor: pointer; color: var(--pe-text-2);
          font-family: inherit; font-size: 12px; font-weight: 700;
          transition: background-color var(--pe-dur-fast) var(--pe-ease-out), border-color var(--pe-dur-fast) var(--pe-ease-out), color var(--pe-dur-fast) var(--pe-ease-out);
        }
        .pe-toggle-btn:hover { background: var(--pe-panel-3); color: var(--pe-text); }
        .pe-toggle-btn.on {
          background: var(--pe-signal-soft);
          border-color: var(--pe-signal-line);
          color: var(--pe-signal-ink);
        }

        /* Color swatch row */
        .pe-color-row { display: flex; flex-wrap: wrap; gap: 4px; }
        .pe-color-swatch {
          width: 22px; height: 22px; border-radius: 5px; cursor: pointer;
          border: 2px solid transparent;
          transition: transform var(--pe-dur-fast) var(--pe-ease-out), border-color var(--pe-dur-fast) var(--pe-ease-out);
          flex-shrink: 0;
        }
        .pe-color-swatch:hover { transform: scale(1.1); border-color: var(--pe-line-strong); }
        .pe-color-swatch.active { border-color: var(--pe-text); transform: scale(1.08); }
        .pe-color-custom {
          width: 22px; height: 22px; border-radius: 5px; cursor: pointer;
          border: 1px dashed var(--pe-line-strong); background: transparent;
          padding: 0; overflow: hidden;
        }
        .pe-color-custom input[type=color] {
          width: 30px; height: 30px; border: none; cursor: pointer;
          transform: translate(-4px,-4px);
          background: transparent;
        }

        /* Color label */
        .pe-color-label {
          font-size: 11px; color: var(--pe-text-3);
          margin-bottom: 5px; display: block;
        }

        /* Slider */
        .pe-slider {
          flex: 1; height: 3px; appearance: none; -webkit-appearance: none;
          background: var(--pe-line-strong);
          border-radius: 3px; cursor: pointer; outline: none;
        }
        .pe-slider::-webkit-slider-thumb {
          -webkit-appearance: none;
          width: 14px; height: 14px; border-radius: 50%;
          background: var(--pe-signal); border: 2px solid var(--pe-panel);
          box-shadow: 0 1px 3px rgba(0,0,0,.3); cursor: pointer;
        }
        .pe-slider-val {
          font-size: 11px; color: var(--pe-text-3);
          min-width: 30px; text-align: right;
          font-variant-numeric: tabular-nums;
        }

        /* Emoji grid. A fixed eight-column row forced eight intrinsic emoji
           widths into a 192px content column, so the row spilled past the
           inspector's right edge. auto-fill drops to six columns in the rail and
           grows to eight only when the panel is wider. */
        .pe-emoji-grid {
          display: grid; grid-template-columns: repeat(auto-fill, minmax(28px, 1fr));
          gap: 3px;
        }
        .pe-emoji-btn {
          min-width: 0; width: 100%; aspect-ratio: 1;
          display: grid; place-items: center; padding: 0;
          border: 1px solid transparent; border-radius: 5px;
          background: transparent; cursor: pointer;
          font-family: "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif;
          font-size: 16px; line-height: 1;
          transition: background-color var(--pe-dur-fast) var(--pe-ease-out),
                      border-color var(--pe-dur-fast) var(--pe-ease-out);
        }
        .pe-emoji-btn:hover { background: var(--pe-panel-3); }
        .pe-emoji-btn:focus-visible {
          outline: 2px solid var(--pe-focus); outline-offset: 1px;
        }

        /* Image insert button */
        .pe-insert-btn {
          width: 100%; padding: 8px 12px; border-radius: var(--pe-r-sm);
          display: flex; align-items: center; justify-content: center; gap: 7px;
          border: 1px dashed var(--pe-line-strong);
          background: transparent; cursor: pointer;
          font-family: inherit;
          font-size: 12px; font-weight: 600;
          color: var(--pe-text-2);
          transition: background-color var(--pe-dur-fast) var(--pe-ease-out), border-color var(--pe-dur-fast) var(--pe-ease-out), color var(--pe-dur-fast) var(--pe-ease-out);
        }
        .pe-insert-btn:hover {
          background: var(--pe-panel-3);
          border-color: var(--pe-text-3); color: var(--pe-text);
        }

        /* Signature button */
        .pe-sign-btn {
          width: 100%; padding: 9px; border-radius: var(--pe-r-sm);
          display: flex; align-items: center; justify-content: center; gap: 7px;
          border: 1px solid var(--pe-signal-line);
          background: var(--pe-signal-soft); cursor: pointer;
          font-family: inherit;
          font-size: 12px; font-weight: 650; color: var(--pe-signal-ink);
          transition: background-color var(--pe-dur-fast) var(--pe-ease-out), border-color var(--pe-dur-fast) var(--pe-ease-out);
        }
        .pe-sign-btn.active { background: var(--pe-signal-soft); border-color: var(--pe-signal); }
        .pe-sign-btn:hover { border-color: var(--pe-signal); }
        .pe-sign-btn.secondary {
          margin-top: 7px;
          border-color: var(--pe-line);
          background: transparent;
          color: var(--pe-text);
        }
        .pe-sign-btn.secondary:hover {
          background: var(--pe-panel-3);
          border-color: var(--pe-line-strong);
        }

        /* Document health — read-only, from the actual preflight report. */
        .pe-health-list { margin: 0; display: flex; flex-direction: column; gap: 5px; }
        .pe-health-row {
          display: flex; align-items: baseline; justify-content: space-between; gap: 8px;
          font-size: 11px;
        }
        .pe-health-key { color: var(--pe-text-3); }
        .pe-health-value { color: var(--pe-text); font-variant-numeric: tabular-nums; text-align: right; }
        .pe-health-value.present { color: var(--pe-warning); }
        .pe-health-value.safe { color: var(--pe-success); }
        .pe-health-note {
          margin: 8px 0 0;
          color: var(--pe-text-3); font-size: 11px; line-height: 1.5;
        }
        .pe-inspector-empty {
          margin: 0;
          color: var(--pe-text-3); font-size: 11.5px; line-height: 1.55;
        }
        /* W3 — redaction review. A destructive intent gets a plain list, not a
           decorative card: page, exact text, remove. */
        .pe-redaction-summary {
          margin: 0 0 9px; color: var(--pe-text-2);
          font-size: 11.5px; line-height: 1.5;
        }
        .pe-redaction-list {
          display: grid; gap: 6px; margin: 0 0 9px; padding: 0; list-style: none;
        }
        .pe-redaction-item {
          display: grid; grid-template-columns: 1fr auto; gap: 8px;
          padding: 8px; border: 1px solid var(--pe-line);
          border-radius: var(--pe-r-sm); background: var(--pe-panel-2);
        }
        .pe-redaction-item-page {
          display: block; color: var(--pe-danger);
          font-size: 9.5px; font-weight: 800; letter-spacing: .6px;
          text-transform: uppercase;
        }
        .pe-redaction-item-text {
          display: block; margin-top: 3px; color: var(--pe-text-2);
          font-size: 11px; line-height: 1.45; overflow-wrap: anywhere;
        }
        .pe-redaction-remove,
        .pe-redaction-clear {
          border: 1px solid var(--pe-line); border-radius: var(--pe-r-sm);
          background: transparent; color: var(--pe-text-2);
          font-family: inherit; font-size: 11px; font-weight: 700;
          cursor: pointer;
        }
        .pe-redaction-remove {
          min-width: 58px; height: 26px; padding: 0 8px; align-self: start;
          display: grid; place-items: center; font-size: 10px;
          letter-spacing: .02em;
        }
        .pe-redaction-clear {
          width: 100%; min-height: 32px; margin-bottom: 9px;
          color: var(--pe-danger);
        }
        .pe-redaction-remove:hover,
        .pe-redaction-clear:hover {
          border-color: var(--pe-danger); background: var(--pe-danger-soft);
          color: var(--pe-danger);
        }
        .pe-redaction-remove:focus-visible,
        .pe-redaction-clear:focus-visible {
          outline: 2px solid var(--pe-focus); outline-offset: 2px;
        }
        .pe-redaction-rule {
          margin: 0; color: var(--pe-text-3); font-size: 10.5px; line-height: 1.5;
        }
        .pe-redaction-rule strong { color: var(--pe-text-2); }

        .pe-geometry-grid {
          display: grid; grid-template-columns: 1fr 1fr; gap: 6px;
        }
        .pe-geometry-field {
          display: flex; align-items: center; gap: 5px;
          color: var(--pe-text-3); font-size: 10px; font-weight: 700;
        }
        .pe-geometry-field span { flex: 0 0 12px; text-transform: uppercase; }
        .pe-geometry-field input {
          width: 100%; min-width: 0; height: 28px;
          padding: 0 6px;
          border: 1px solid var(--pe-line);
          border-radius: var(--pe-r-sm);
          background: var(--pe-panel);
          color: var(--pe-text);
          font-family: inherit; font-size: 11px;
          font-variant-numeric: tabular-nums;
          outline: none;
        }
        .pe-geometry-field input:focus-visible {
          border-color: var(--pe-signal); outline: 2px solid var(--pe-focus); outline-offset: 1px;
        }
        .pe-arrange-grid {
          display: grid; grid-template-columns: repeat(3, 1fr); gap: 4px; margin-top: 7px;
        }
        .pe-arrange-btn {
          min-height: 27px;
          border: 1px solid var(--pe-line);
          border-radius: var(--pe-r-sm);
          background: transparent;
          color: var(--pe-text-2);
          font-family: inherit; font-size: 10px; font-weight: 700;
          cursor: pointer;
        }
        .pe-arrange-btn:hover:not(:disabled) { background: var(--pe-panel-3); color: var(--pe-text); }
        .pe-arrange-btn:disabled { opacity: .35; cursor: not-allowed; }
        .pe-arrange-btn:focus-visible { outline: 2px solid var(--pe-focus); outline-offset: 2px; }
        .pe-arrange-btn.danger:hover:not(:disabled) {
          border-color: var(--pe-danger); background: var(--pe-danger-soft); color: var(--pe-danger);
        }
        .pe-object-style {
          display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
          gap: 6px; margin-top: 8px;
        }
        .pe-object-style label {
          display: flex; align-items: center; gap: 5px; min-width: 0;
          color: var(--pe-text-3); font-size: 9.5px; font-weight: 700;
        }
        .pe-object-style input { min-width: 0; box-sizing: border-box; }
        .pe-object-style input[type="color"] {
          width: 24px; height: 24px; padding: 0; border: 1px solid var(--pe-line);
          border-radius: 4px; background: transparent; cursor: pointer;
        }
        .pe-object-style input[type="text"] {
          width: 100%; height: 26px; padding: 0 6px;
          border: 1px solid var(--pe-line); border-radius: var(--pe-r-sm);
          background: var(--pe-panel); color: var(--pe-text);
          font-family: inherit; font-size: 10.5px; outline: none;
        }
        .pe-object-style input[type="number"],
        .pe-object-style select {
          width: 100%; min-width: 0; height: 26px; padding: 0 5px;
          border: 1px solid var(--pe-line); border-radius: var(--pe-r-sm);
          background: var(--pe-panel); color: var(--pe-text);
          font-family: inherit; font-size: 10.5px; outline: none;
        }
        .pe-object-style input:focus-visible,
        .pe-object-style select:focus-visible {
          border-color: var(--pe-signal); outline: 2px solid var(--pe-focus); outline-offset: 1px;
        }
        .pe-layers-list { display: flex; flex-direction: column; gap: 3px; }
        .pe-layer-row {
          display: flex; align-items: center; gap: 4px;
          min-height: 28px; padding: 2px 4px;
          border: 1px solid transparent; border-radius: var(--pe-r-sm);
        }
        .pe-layer-row.selected { border-color: var(--pe-signal-line); background: var(--pe-signal-soft); }
        .pe-layer-name {
          flex: 1; min-width: 0; padding: 3px 2px;
          border: 0; background: transparent; color: var(--pe-text-2);
          font-family: inherit; font-size: 10.5px; text-align: left;
          white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
          cursor: pointer;
        }
        .pe-layer-name:hover { color: var(--pe-text); }
        .pe-layer-name:focus-visible { outline: 2px solid var(--pe-focus); outline-offset: 1px; }
        .pe-layer-icon {
          width: 22px; height: 22px; flex: 0 0 22px;
          display: inline-flex; align-items: center; justify-content: center;
          border: 1px solid transparent; border-radius: 4px;
          background: transparent; color: var(--pe-text-3); cursor: pointer;
          font-size: 11px;
        }
        .pe-layer-icon:hover { border-color: var(--pe-line); color: var(--pe-text); }
        .pe-layer-icon.active { color: var(--pe-signal-ink); }
        .pe-layer-icon:focus-visible { outline: 2px solid var(--pe-focus); outline-offset: 1px; }
        .pe-layer-empty { margin: 0; color: var(--pe-text-3); font-size: 10.5px; line-height: 1.5; }
        .pe-arrange-btn.is-on {
          background: var(--pe-signal-soft);
          border-color: var(--pe-signal-line);
          color: var(--pe-signal-ink);
        }
        .pe-annotation-kinds {
          display: grid; grid-template-columns: 1fr 1fr; gap: 4px; margin-bottom: 9px;
        }
        .pe-annotation-input {
          width: 100%; box-sizing: border-box;
          padding: 6px 7px;
          border: 1px solid var(--pe-line); border-radius: var(--pe-r-sm);
          background: var(--pe-panel-2); color: var(--pe-text);
          font-family: inherit; font-size: 11px; line-height: 1.45;
          resize: vertical; outline: none;
        }
        .pe-annotation-input:focus-visible {
          border-color: var(--pe-signal); outline: 2px solid var(--pe-focus); outline-offset: 1px;
        }
        .pe-annotation-list {
          display: flex; flex-direction: column; gap: 5px; margin: 9px 0 0;
        }
        .pe-annotation-row {
          display: flex; flex-direction: column; gap: 2px;
          padding: 7px 8px;
          border: 1px solid var(--pe-line); border-radius: var(--pe-r-sm);
          background: var(--pe-panel-2);
          text-align: left; cursor: pointer;
        }
        .pe-annotation-row.selected { border-color: var(--pe-signal-line); }
        .pe-annotation-row:hover { border-color: var(--pe-line-strong); }
        .pe-annotation-row:focus-visible { outline: 2px solid var(--pe-focus); outline-offset: 1px; }
        .pe-annotation-meta {
          color: var(--pe-text-3); font-size: 9.5px; font-weight: 700;
          letter-spacing: .4px; text-transform: uppercase;
        }
        .pe-annotation-body {
          color: var(--pe-text-2); font-size: 11px; line-height: 1.45;
          overflow-wrap: anywhere;
        }
        .pe-annotation-replies {
          display: flex; flex-direction: column; gap: 4px;
          margin: 6px 0 0 12px; padding-left: 8px;
          border-left: 1px solid var(--pe-line);
        }
        .pe-annotation-actions { display: flex; gap: 5px; margin-top: 8px; }

        @media (prefers-reduced-motion: reduce) {
          .pe-rp, .pe-select, .pe-num-input, .pe-toggle-btn,
          .pe-color-swatch, .pe-emoji-btn, .pe-insert-btn, .pe-sign-btn {
            transition: none;
          }
          .pe-color-swatch:hover { transform: none; }
        }
      `}</style>

      <div className="pe-rp">

        <div className="pe-rp-context">
          <span className="pe-rp-context-copy">
            <span className="pe-rp-context-label">{contextLabel}</span>
            <span className="pe-rp-context-meta">Inspector</span>
          </span>
        </div>

        {/* ── Page Size (document context only) ── */}
        {showDocument && (
          <>
            <div className="pe-rp-section">
              <span className="pe-rp-title">Page Size</span>
              <select
                className="pe-select"
                aria-label="Page size"
                data-testid="pdf-page-size"
                value={pageSize}
                onChange={e => onPageSizeChange(e.target.value as PageSizeKey)}
              >
                {Object.entries(PAGE_SIZE_PRESETS).map(([key, preset]) => (
                  <option key={key} value={key}>
                    {key === 'original' ? preset.label : `${preset.label} (${Math.round(preset.width)} x ${Math.round(preset.height)})`}
                  </option>
                ))}
              </select>
              <div className="pe-rp-help">
                Exported pages are resized to the selected format and all content is scaled to fit cleanly.
              </div>
            </div>

            <div className="pe-rp-section" data-testid="pdf-document-health">
              <span className="pe-rp-title">Document Health</span>
              {preflightReport ? (
                <>
                  <div className="pe-health-list">
                    <div className="pe-health-row">
                      <span className="pe-health-key">Pages</span>
                      <span className="pe-health-value">{preflightReport.pageCount}</span>
                    </div>
                    <div className="pe-health-row">
                      <span className="pe-health-key">Encryption</span>
                      <span className={`pe-health-value ${preflightReport.features.encryption.present ? 'present' : 'safe'}`}>
                        {preflightReport.features.encryption.present
                          ? preflightReport.features.encryption.restricted ? 'Restricted' : 'Present'
                          : 'None'}
                      </span>
                    </div>
                    <div className="pe-health-row">
                      <span className="pe-health-key">Form fields</span>
                      <span className={`pe-health-value ${preflightReport.features.forms.present ? 'present' : 'safe'}`}>
                        {preflightReport.features.forms.fieldCount}
                      </span>
                    </div>
                    <div className="pe-health-row">
                      <span className="pe-health-key">Signatures</span>
                      <span className={`pe-health-value ${preflightReport.features.digitalSignatures.present ? 'present' : 'safe'}`}>
                        {preflightReport.features.digitalSignatures.count}
                      </span>
                    </div>
                    <div className="pe-health-row">
                      <span className="pe-health-key">Annotations</span>
                      <span className="pe-health-value">{preflightReport.features.annotations.count}</span>
                    </div>
                    <div className="pe-health-row">
                      <span className="pe-health-key">Rotated pages</span>
                      <span className="pe-health-value">{preflightReport.features.rotatedPages.count}</span>
                    </div>
                  </div>
                  <p className="pe-health-note">
                    {preflightReport.status === 'complete'
                      ? 'Read-only inspection. Export asks before a change would remove a listed structure.'
                      : 'Inspection was partial; export still verifies the output before download.'}
                  </p>
                  {preflightReport.features.annotations.count > 0 && onOpenAnnotations && (
                    <button
                      type="button"
                      className="pe-insert-btn"
                      style={{ marginTop: 9 }}
                      onClick={onOpenAnnotations}
                    >
                      Review annotations
                    </button>
                  )}
                </>
              ) : <p className="pe-inspector-empty">Document health is still being inspected.</p>}
            </div>

            <div className="pe-rp-section">
              <span className="pe-rp-title">Selection</span>
              <p className="pe-inspector-empty">
                Select a text block to style it. Shapes, images, signatures and emoji appear here when their tool is active.
              </p>
            </div>
          </>
        )}

        {/* ── Redaction review (redact tool only) ── */}
        {showRedaction && (
          <div className="pe-rp-section" data-testid="pdf-redaction-review">
            <span className="pe-rp-title">Redaction Review</span>
            <p className="pe-redaction-summary">{redactionImpact.summary}</p>
            {redactionMarks.length === 0 ? (
              <p className="pe-inspector-empty">
                Click text on the page to mark it. Marked runs are listed here with the exact
                source text before anything is removed.
              </p>
            ) : (
              <>
                <ul className="pe-redaction-list">
                  {redactionMarks.map((mark, index) => (
                    <li className="pe-redaction-item" key={mark.id}>
                      <div>
                        <span className="pe-redaction-item-page">
                          Page {mark.page} · Mark {index + 1}
                        </span>
                        <span className="pe-redaction-item-text">{mark.originalText}</span>
                      </div>
                      <button
                        type="button"
                        className="pe-redaction-remove"
                        aria-label={`Remove mark ${index + 1} on page ${mark.page}`}
                        title="Remove this mark"
                        onClick={() => onUnmarkRedaction?.(mark.id)}
                      >
                        Remove
                      </button>
                    </li>
                  ))}
                </ul>
                <button
                  type="button"
                  className="pe-redaction-clear"
                  onClick={() => onClearRedactions?.()}
                >
                  Clear all marks
                </button>
              </>
            )}
            <p className="pe-redaction-rule">
              Removal runs in the <strong>structural engine</strong> and is verified against the
              exported content streams. If removal cannot be proven, export is refused; marked
              text is never merely covered with a rectangle.
            </p>
          </div>
        )}

        {/* ── Annotations (annotate tool only) ── */}
        {showAnnotation && (
          <div className="pe-rp-section" data-testid="pdf-annotation-review">
            <span className="pe-rp-title">Annotations</span>
            <p className="pe-redaction-summary">{annotationImpact.summary}</p>

            <div className="pe-annotation-kinds" role="group" aria-label="Annotation type">
              {ANNOTATION_KINDS.map(({ kind, label }) => (
                <button
                  key={kind}
                  type="button"
                  className={`pe-arrange-btn ${annotationKind === kind ? 'is-on' : ''}`}
                  aria-pressed={annotationKind === kind}
                  data-testid={`pdf-annotation-kind-${kind}`}
                  onClick={() => onAnnotationKindChange?.(kind)}
                >
                  {label}
                </button>
              ))}
            </div>

            <div className="pe-object-style" style={{ marginTop: 0 }}>
              <label>
                Colour
                <input
                  type="color"
                  aria-label="Annotation colour"
                  value={annotationStyle.color}
                  onChange={event => onAnnotationStyleChange?.({ color: event.target.value })}
                />
              </label>
              <label style={{ gridColumn: '1 / -1' }}>
                Author
                <input
                  type="text"
                  aria-label="Annotation author"
                  value={annotationStyle.author}
                  onChange={event => onAnnotationStyleChange?.({ author: event.target.value })}
                />
              </label>
            </div>

            {annotationKind === 'stamp' && (
              <label className="pe-rp-row" style={{ marginTop: 7 }}>
                <span className="pe-color-label" style={{ marginBottom: 0 }}>Stamp</span>
                <select
                  className="pe-select"
                  aria-label="Stamp preset"
                  value={annotationStyle.stamp}
                  onChange={event => onAnnotationStyleChange?.({
                    stamp: event.target.value as PdfEditorAnnotationStyle['stamp'],
                  })}
                >
                  {PDF_EDITOR_STAMP_PRESETS.map(preset => (
                    <option key={preset} value={preset}>{preset}</option>
                  ))}
                </select>
              </label>
            )}

            {annotationKind === 'link' && (
              <label className="pe-rp-row" style={{ marginTop: 7, flexDirection: 'column', alignItems: 'stretch', gap: 4 }}>
                <span className="pe-color-label" style={{ marginBottom: 0 }}>Link address</span>
                <input
                  type="url"
                  className="pe-annotation-input"
                  aria-label="Link address"
                  placeholder="https://example.com"
                  value={annotationStyle.uri}
                  onChange={event => onAnnotationStyleChange?.({ uri: event.target.value })}
                />
              </label>
            )}

            <p className="pe-inspector-empty" style={{ marginTop: 8 }}>
              {annotationKind === 'note' || annotationKind === 'stamp' || annotationKind === 'link'
                ? 'Click the page to place this annotation.'
                : 'Click a line of text to mark it; click again to remove the mark.'}
            </p>

            {selectedAnnotation && (
              <div style={{ marginTop: 10 }} data-testid="pdf-annotation-selected">
                <span className="pe-rp-title" style={{ marginBottom: 5 }}>
                  {selectedAnnotation.kind} · page {selectedAnnotation.page}
                </span>
                <label className="pe-rp-row" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 4 }}>
                  <span className="pe-color-label" style={{ marginBottom: 0 }}>Contents</span>
                  <textarea
                    className="pe-annotation-input"
                    rows={3}
                    aria-label="Annotation contents"
                    value={selectedAnnotation.contents}
                    onChange={event => onUpdateAnnotation?.(selectedAnnotation.id, { contents: event.target.value })}
                  />
                </label>
                <label className="pe-rp-row" style={{ marginTop: 5 }}>
                  <span className="pe-color-label" style={{ marginBottom: 0 }}>Author</span>
                  <input
                    type="text"
                    className="pe-annotation-input"
                    aria-label="Selected annotation author"
                    value={selectedAnnotation.author}
                    onChange={event => onUpdateAnnotation?.(selectedAnnotation.id, { author: event.target.value })}
                  />
                </label>
                <label className="pe-rp-row" style={{ marginTop: 5 }}>
                  <span className="pe-color-label" style={{ marginBottom: 0 }}>Colour</span>
                  <input
                    type="color"
                    aria-label="Selected annotation colour"
                    value={selectedAnnotation.color}
                    onChange={event => onUpdateAnnotation?.(selectedAnnotation.id, { color: event.target.value })}
                  />
                </label>
                {selectedAnnotation.kind === 'link' && (
                  <input
                    type="url"
                    className="pe-annotation-input"
                    aria-label="Selected link address"
                    value={selectedAnnotation.uri ?? ''}
                    onChange={event => onUpdateAnnotation?.(selectedAnnotation.id, { uri: event.target.value })}
                  />
                )}
                {selectedAnnotation.kind === 'stamp' && (
                  <select
                    className="pe-select"
                    aria-label="Selected stamp preset"
                    value={selectedAnnotation.stamp ?? 'Approved'}
                    onChange={event => onUpdateAnnotation?.(selectedAnnotation.id, {
                      stamp: event.target.value as PdfEditorAnnotationStyle['stamp'],
                    })}
                  >
                    {PDF_EDITOR_STAMP_PRESETS.map(preset => (
                      <option key={preset} value={preset}>{preset}</option>
                    ))}
                  </select>
                )}

                {annotationReplies.length > 0 && (
                  <div className="pe-annotation-replies">
                    {annotationReplies.map(reply => (
                      <div key={reply.id} className="pe-annotation-row">
                        <span className="pe-annotation-meta">{reply.author} · {reply.kind}</span>
                        <span className="pe-annotation-body">{reply.contents}</span>
                      </div>
                    ))}
                  </div>
                )}

                <label className="pe-rp-row" style={{ marginTop: 7, flexDirection: 'column', alignItems: 'stretch', gap: 4 }}>
                  <span className="pe-color-label" style={{ marginBottom: 0 }}>Reply</span>
                  <textarea
                    className="pe-annotation-input"
                    rows={2}
                    aria-label="Reply to annotation"
                    placeholder="Reply to this annotation"
                    value={replyDraft}
                    onChange={event => setReplyDraft(event.target.value)}
                  />
                </label>
                <div className="pe-annotation-actions">
                  <button
                    type="button"
                    className="pe-arrange-btn"
                    style={{ flex: 1, minHeight: 30 }}
                    disabled={!replyDraft.trim()}
                    onClick={submitReply}
                  >
                    Reply
                  </button>
                  <button
                    type="button"
                    className="pe-arrange-btn danger"
                    style={{ flex: 1, minHeight: 30 }}
                    onClick={() => {
                      onRemoveAnnotation?.(selectedAnnotation.id);
                      setReplyDraft('');
                    }}
                  >
                    Delete
                  </button>
                </div>
              </div>
            )}

            {annotations.length > 0 && (
              <div className="pe-annotation-list" role="list" aria-label={`Annotations on page ${annotationPage}`}>
                <span className="pe-annotation-meta">Page {annotationPage}</span>
                {pageAnnotationRoots.length === 0 && (
                  <p className="pe-layer-empty">No annotations on this page.</p>
                )}
                {pageAnnotationRoots.map(root => {
                  const replies = pdfEditorAnnotationReplies(annotations, root.id);
                  return (
                    <div key={root.id}>
                      <button
                        type="button"
                        role="listitem"
                        className={`pe-annotation-row ${root.id === selectedAnnotationId ? 'selected' : ''}`}
                        onClick={() => onSelectAnnotation?.(root.id)}
                      >
                        <span className="pe-annotation-meta">
                          {root.kind} · page {root.page} · {root.author}
                        </span>
                        <span className="pe-annotation-body">
                          {root.contents.trim() || `${root.kind} annotation`}
                        </span>
                      </button>
                      {replies.length > 0 && (
                        <div className="pe-annotation-replies">
                          {replies.map(reply => (
                            <button
                              key={reply.id}
                              type="button"
                              className={`pe-annotation-row ${reply.id === selectedAnnotationId ? 'selected' : ''}`}
                              onClick={() => onSelectAnnotation?.(reply.id)}
                            >
                              <span className="pe-annotation-meta">{reply.author} · reply</span>
                              <span className="pe-annotation-body">{reply.contents}</span>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
                {offPageAnnotationCount > 0 && (
                  <p className="pe-layer-empty">
                    {offPageAnnotationCount} more on other pages. Open that page to review{' '}
                    {offPageAnnotationCount === 1 ? 'it' : 'them'}.
                  </p>
                )}
              </div>
            )}

            <p className="pe-redaction-rule" style={{ marginTop: 9 }}>
              Annotations are written as real PDF annotations and verified by id after reopening the
              export. Replies use the standard <strong>/IRT</strong> thread relationship.
            </p>
          </div>
        )}

        {/* ── Object geometry and arrange (W4) ── */}
        {objectGeometry && (
          <div className="pe-rp-section" data-testid="pdf-object-geometry">
            <span className="pe-rp-title">
              Position &amp; size {selectedObjectCount > 1 ? `· ${selectedObjectCount} selected` : ''}
            </span>
            {selectedObjectCount > 1 ? (
              <p className="pe-inspector-empty">
                Align, distribute and group apply to the whole selection. Numeric position
                edits apply to one object at a time.
              </p>
            ) : (
              <div className="pe-geometry-grid">
                <GeometryField label="X" value={objectGeometry.x} onCommit={x => onObjectGeometryChange?.({ x })} />
                <GeometryField label="Y" value={objectGeometry.y} onCommit={y => onObjectGeometryChange?.({ y })} />
                <GeometryField label="W" value={objectGeometry.width} onCommit={width => onObjectGeometryChange?.({ width })} />
                <GeometryField label="H" value={objectGeometry.height} onCommit={height => onObjectGeometryChange?.({ height })} />
              </div>
            )}
            {selectedObjectCount === 1 && selectedObjectKind === 'shape' && objectStyle && (
              <div className="pe-object-style">
                <label>
                  Fill
                  <input
                    type="color"
                    aria-label="Shape fill color"
                    value={objectStyle.fill && objectStyle.fill !== 'transparent' ? objectStyle.fill : '#ffffff'}
                    onChange={event => onObjectStyleChange?.({ fill: event.target.value })}
                  />
                  <button
                    type="button"
                    className="pe-arrange-btn"
                    style={{ minHeight: 24, padding: '0 6px' }}
                    onClick={() => onObjectStyleChange?.({ fill: 'transparent' })}
                  >
                    None
                  </button>
                </label>
                <label>
                  Stroke
                  <input
                    type="color"
                    aria-label="Shape stroke color"
                    value={objectStyle.stroke || '#111111'}
                    onChange={event => onObjectStyleChange?.({ stroke: event.target.value })}
                  />
                </label>
                <label>
                  Width
                  <input
                    type="number"
                    min={0}
                    step={0.5}
                    aria-label="Shape stroke width"
                    value={objectStyle.strokeWidth}
                    onChange={event => onObjectStyleChange?.({ strokeWidth: Number(event.target.value) })}
                  />
                </label>
                <label>
                  Dash
                  <select
                    aria-label="Shape stroke style"
                    value={objectStyle.strokeDashArray ? objectStyle.strokeDashArray.join(',') : 'solid'}
                    onChange={event => {
                      const value = event.target.value;
                      onObjectStyleChange?.({
                        strokeDashArray: value === 'solid' ? null : value.split(',').map(Number),
                      });
                    }}
                  >
                    <option value="solid">Solid</option>
                    <option value="6,4">Dashed</option>
                    <option value="2,3">Dotted</option>
                  </select>
                </label>
              </div>
            )}
            <div className="pe-arrange-grid">
              <button type="button" className="pe-arrange-btn" onClick={() => onAlignObjects?.('left')} disabled={selectedObjectCount < 2}>Align L</button>
              <button type="button" className="pe-arrange-btn" onClick={() => onAlignObjects?.('center')} disabled={selectedObjectCount < 2}>Center</button>
              <button type="button" className="pe-arrange-btn" onClick={() => onAlignObjects?.('right')} disabled={selectedObjectCount < 2}>Align R</button>
              <button type="button" className="pe-arrange-btn" onClick={() => onAlignObjects?.('top')} disabled={selectedObjectCount < 2}>Top</button>
              <button type="button" className="pe-arrange-btn" onClick={() => onAlignObjects?.('middle')} disabled={selectedObjectCount < 2}>Middle</button>
              <button type="button" className="pe-arrange-btn" onClick={() => onAlignObjects?.('bottom')} disabled={selectedObjectCount < 2}>Bottom</button>
              <button type="button" className="pe-arrange-btn" onClick={() => onDistributeObjects?.('horizontal')} disabled={selectedObjectCount < 3}>Space H</button>
              <button type="button" className="pe-arrange-btn" onClick={() => onDistributeObjects?.('vertical')} disabled={selectedObjectCount < 3}>Space V</button>
              <button type="button" className="pe-arrange-btn" onClick={() => onGroupObjects?.()} disabled={selectedObjectCount < 2}>Group</button>
              <button type="button" className="pe-arrange-btn" onClick={() => onUngroupObjects?.()} disabled={selectedObjectCount !== 1}>Ungroup</button>
              <button type="button" className="pe-arrange-btn" onClick={() => onDuplicateObject?.()} disabled={selectedObjectCount !== 1}>Duplicate</button>
              <button type="button" className="pe-arrange-btn" onClick={() => onCopyObject?.()} disabled={selectedObjectCount !== 1}>Copy</button>
              <button type="button" className="pe-arrange-btn" onClick={() => onPasteObject?.()} disabled={!hasObjectClipboard}>Paste</button>
              <button type="button" className="pe-arrange-btn danger" onClick={() => onDeleteObject?.()} disabled={selectedObjectCount !== 1}>Delete</button>
              <button type="button" className={`pe-arrange-btn ${objectLocked ? 'active' : ''}`} onClick={() => onToggleObjectLock?.()} disabled={selectedObjectCount !== 1}>
                {objectLocked ? 'Unlock' : 'Lock'}
              </button>
              <button type="button" className="pe-arrange-btn" onClick={() => onToggleObjectHidden?.()} disabled={selectedObjectCount !== 1}>
                {objectHidden ? 'Show' : 'Hide'}
              </button>
            </div>
            <p className="pe-inspector-empty" style={{ marginTop: 7 }}>
              Arrow keys nudge by 1pt; Shift+Arrow by 10pt. Values are PDF points.
            </p>
          </div>
        )}

        {/* ── Text styling (text context only) ── */}
        {showText && (
          <>
        {/* ── Heading ── */}
        <div className="pe-rp-section">
          <span className="pe-rp-title">Heading / Style</span>
          <select
            className="pe-select"
            value={textStyle.heading}
            onChange={e => onStyleChange({ heading: e.target.value as HeadingLevel })}
          >
            {HEADINGS.map(h => (
              <option key={h.value} value={h.value}>{h.label}</option>
            ))}
          </select>
        </div>

        {/* ── Font ── */}
        <div className="pe-rp-section">
          <span className="pe-rp-title">Font</span>
          <select
            className="pe-select"
            value={textStyle.fontFamily}
            onChange={e => onStyleChange({ fontFamily: e.target.value })}
            style={{ marginBottom: 7 }}
          >
            {FONTS.map(f => (
              <option key={f} value={f} style={{ fontFamily: f }}>{f}</option>
            ))}
          </select>

          <div className="pe-rp-row">
            <select
              className="pe-select"
              value={textStyle.fontSize}
              onChange={e => onStyleChange({ fontSize: Number(e.target.value) })}
            >
              {FONT_SIZES.map(s => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
            <input
              type="number" min="6" max="200"
              className="pe-num-input"
              value={textStyle.fontSize}
              onChange={e => onStyleChange({ fontSize: Math.max(6, Number(e.target.value)) })}
            />
          </div>

          {/* B / I / U */}
          <div className="pe-rp-row">
            <div className="pe-toggle-group">
              <button
                className={`pe-toggle-btn ${textStyle.bold ? 'on' : ''}`}
                onClick={() => onStyleChange({ bold: !textStyle.bold })}
                title="Bold"
              >B</button>
              <button
                className={`pe-toggle-btn ${textStyle.italic ? 'on' : ''}`}
                onClick={() => onStyleChange({ italic: !textStyle.italic })}
                title="Italic"
                style={{ fontStyle: 'italic' }}
              >I</button>
              <button
                className={`pe-toggle-btn ${textStyle.underline ? 'on' : ''}`}
                onClick={() => onStyleChange({ underline: !textStyle.underline })}
                title="Underline"
                style={{ textDecoration: 'underline' }}
              >U</button>
            </div>

            {/* Align */}
            <div className="pe-toggle-group" style={{ marginLeft: 'auto' }}>
              {(['left','center','right'] as const).map(a => (
                <button
                  key={a}
                  className={`pe-toggle-btn ${textStyle.align === a ? 'on' : ''}`}
                  onClick={() => onStyleChange({ align: a })}
                  title={`Align ${a}`}
                >
                  {a === 'left' && (
                    <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
                      <rect x="1" y="2" width="14" height="2" rx="1"/>
                      <rect x="1" y="6" width="9" height="2" rx="1"/>
                      <rect x="1" y="10" width="12" height="2" rx="1"/>
                    </svg>
                  )}
                  {a === 'center' && (
                    <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
                      <rect x="1" y="2" width="14" height="2" rx="1"/>
                      <rect x="4" y="6" width="8" height="2" rx="1"/>
                      <rect x="2" y="10" width="12" height="2" rx="1"/>
                    </svg>
                  )}
                  {a === 'right' && (
                    <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
                      <rect x="1" y="2" width="14" height="2" rx="1"/>
                      <rect x="6" y="6" width="9" height="2" rx="1"/>
                      <rect x="3" y="10" width="12" height="2" rx="1"/>
                    </svg>
                  )}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* ── Text Color ── */}
        <div className="pe-rp-section">
          <span className="pe-rp-title">Text Color</span>
          <div className="pe-color-row">
            {PRESET_COLORS.map(c => (
              <div
                key={c}
                className={`pe-color-swatch ${textStyle.color === c ? 'active' : ''}`}
                style={{ background: c, boxShadow: c === '#ffffff' ? 'inset 0 0 0 1px rgba(0,0,0,.2)' : 'none' }}
                onClick={() => onStyleChange({ color: c })}
                title={c}
              />
            ))}
            <div className="pe-color-custom" title="Custom color">
              <input
                type="color"
                value={textStyle.color}
                onChange={e => onStyleChange({ color: e.target.value })}
              />
            </div>
          </div>
        </div>

        {/* ── Fill / Highlight Color ── */}
        <div className="pe-rp-section">
          <span className="pe-rp-title">Fill / Highlight</span>
          <div className="pe-color-row">
            <div
              className={`pe-color-swatch ${textStyle.bgColor === 'transparent' ? 'active' : ''}`}
              style={{
                background: 'transparent',
                boxShadow: 'inset 0 0 0 1.5px var(--pe-line-strong)',
                position: 'relative',
              }}
              onClick={() => onStyleChange({ bgColor: 'transparent' })}
              title="No fill"
            >
              <svg width="10" height="10" viewBox="0 0 10 10" style={{ position:'absolute',top:3,left:3 }}>
                <line x1="1" y1="9" x2="9" y2="1" stroke="rgba(255,80,80,.7)" strokeWidth="1.5"/>
              </svg>
            </div>
            {['#fef08a','#bbf7d0','#bfdbfe','#fecaca','#e9d5ff','#fed7aa'].map(c => (
              <div
                key={c}
                className={`pe-color-swatch ${textStyle.bgColor === c ? 'active' : ''}`}
                style={{ background: c }}
                onClick={() => onStyleChange({ bgColor: c })}
                title={c}
              />
            ))}
            <div className="pe-color-custom" title="Custom fill">
              <input
                type="color"
                value={textStyle.bgColor === 'transparent' ? '#ffffff' : textStyle.bgColor}
                onChange={e => onStyleChange({ bgColor: e.target.value })}
              />
            </div>
          </div>
        </div>

        {/* ── Line Spacing ── */}
        <div className="pe-rp-section">
          <span className="pe-rp-title">Line Spacing</span>
          <div className="pe-rp-row">
            <input
              type="range" min="1" max="3" step="0.1"
              className="pe-slider"
              value={textStyle.lineHeight}
              onChange={e => onStyleChange({ lineHeight: Number(e.target.value) })}
            />
            <span className="pe-slider-val">{textStyle.lineHeight.toFixed(1)}×</span>
          </div>
        </div>
          </>
        )}

        {context === 'shape' && (
          <div className="pe-rp-section">
            <span className="pe-rp-title">Shape</span>
            <p className="pe-inspector-empty">
              Use the object handles on the canvas to resize or move the shape. Shape styling is not exposed yet.
            </p>
          </div>
        )}

        {/* ── Emoji Picker (emoji context only) ── */}
        {showEmoji && (
        <div className="pe-rp-section">
          <span className="pe-rp-title">Insert Emoji</span>
          <div className="pe-emoji-grid">
            {EMOJIS.map(emoji => (
              <button
                key={emoji}
                type="button"
                className="pe-emoji-btn"
                onClick={() => onEmojiSelect(emoji)}
                title={emoji}
                aria-label={`Insert ${emoji}`}
              >
                {emoji}
              </button>
            ))}
          </div>
        </div>
        )}

        {/* ── Image Insert (image context only) ── */}
        {showImage && (
        <div className="pe-rp-section">
          <span className="pe-rp-title">Insert Image</span>
          {selectedObjectKind === 'image' && (
            <p className="pe-inspector-empty" style={{ marginBottom: 9 }}>
              An image is selected. Move or resize it with the canvas handles, or insert another below.
            </p>
          )}
          <button
            className="pe-insert-btn"
            onClick={() => imgInputRef.current?.click()}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="3" width="18" height="18" rx="2"/>
              <circle cx="8.5" cy="8.5" r="1.5"/>
              <polyline points="21 15 16 10 5 21"/>
            </svg>
            Upload Image
          </button>
          <input
            ref={imgInputRef} type="file"
            accept=".png,.jpg,.jpeg,.svg,.webp,.gif,image/*" style={{ display: 'none' }}
            onChange={e => {
              const f = e.target.files?.[0];
              if (f) onImageInsert(f);
              e.currentTarget.value = '';
            }}
          />
        </div>
        )}

        {/* ── Signature (signature context only) ── */}
        {showSignature && (
        <div className="pe-rp-section">
          <span className="pe-rp-title">Signature</span>
          <button
            className={`pe-sign-btn ${isSignatureMode ? 'active' : ''}`}
            onClick={isSignatureMode ? onSignatureStop : onSignatureStart}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M4 20c2-5 4-10 5-10s1 3 2 3 2-6 3-6 1.5 4 2 4 2-3 3-3"/>
              <line x1="3" y1="20" x2="21" y2="20" strokeOpacity=".3"/>
            </svg>
            {isSignatureMode ? 'Stop Drawing' : 'Draw Signature'}
          </button>
          <button
            className="pe-sign-btn secondary"
            onClick={() => signatureInputRef.current?.click()}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
              <polyline points="17 8 12 3 7 8"/>
              <line x1="12" y1="3" x2="12" y2="15"/>
            </svg>
            Upload Signature
          </button>
          <input
            ref={signatureInputRef}
            type="file"
            accept=".png,.jpg,.jpeg,.svg,.webp,.gif,image/*"
            style={{ display: 'none' }}
            onChange={e => {
              const f = e.target.files?.[0];
              if (f) onSignatureUpload(f);
              e.currentTarget.value = '';
            }}
          />
          {isSignatureMode && (
            <p style={{ fontSize: 11, color: 'var(--pe-signal-ink)', marginTop: 6, lineHeight: 1.5 }}>
              Draw on the PDF canvas. Choose “Stop Drawing” when done.
            </p>
          )}
        </div>
        )}

        {context !== 'redaction' && hasObjectClipboard && (
          <div className="pe-rp-section">
            <span className="pe-rp-title">Clipboard</span>
            <button type="button" className="pe-insert-btn" onClick={() => onPasteObject?.()}>
              Paste object on this page
            </button>
          </div>
        )}

        {context !== 'redaction' && (
          <div className="pe-rp-section" data-testid="pdf-page-layers">
            <span className="pe-rp-title">Layers · current page</span>
            {layers.length === 0 ? (
              <p className="pe-layer-empty">
                No added objects on this page. Text, shapes, images and signatures appear here.
              </p>
            ) : (
              <div className="pe-layers-list" role="list">
                {layers.map(layer => (
                  <div
                    key={layer.id}
                    role="listitem"
                    className={`pe-layer-row ${layer.selected ? 'selected' : ''}`}
                  >
                    <button
                      type="button"
                      className="pe-layer-name"
                      title={`Select ${layer.name}`}
                      onClick={() => onSelectLayer?.(layer.id)}
                    >
                      {layer.name}
                    </button>
                    <button
                      type="button"
                      className={`pe-layer-icon ${layer.hidden ? 'active' : ''}`}
                      aria-label={layer.hidden ? `Show ${layer.name}` : `Hide ${layer.name}`}
                      title={layer.hidden ? 'Show layer' : 'Hide layer'}
                      onClick={() => onToggleLayerHidden?.(layer.id)}
                    >
                      {layer.hidden ? '◌' : '●'}
                    </button>
                    <button
                      type="button"
                      className={`pe-layer-icon ${layer.locked ? 'active' : ''}`}
                      aria-label={layer.locked ? `Unlock ${layer.name}` : `Lock ${layer.name}`}
                      title={layer.locked ? 'Unlock layer' : 'Lock layer'}
                      onClick={() => onToggleLayerLock?.(layer.id)}
                    >
                      {layer.locked ? '▣' : '□'}
                    </button>
                    <button
                      type="button"
                      className="pe-layer-icon"
                      aria-label={`Move ${layer.name} forward`}
                      title="Bring forward"
                      onClick={() => onMoveLayer?.(layer.id, 'forward')}
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      className="pe-layer-icon"
                      aria-label={`Move ${layer.name} backward`}
                      title="Send backward"
                      onClick={() => onMoveLayer?.(layer.id, 'backward')}
                    >
                      ↓
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

      </div>
    </>
  );
}
