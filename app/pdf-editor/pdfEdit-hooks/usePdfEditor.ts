'use client';
// -------------------------------------------------------------
//  usePdfEditor.ts
//  Central state + logic for the PDF editor.
//  Uses: PDF.js (render), Fabric.js (canvas overlay), pdf-lib (export)
// -------------------------------------------------------------

import { useState, useRef, useCallback, useEffect } from 'react';
import {
  createPdfDocumentId,
  createPdfEditorRecoveryQueue,
  deletePdfEditorRecovery,
  loadPdfEditorDraftAsync,
  loadRecoverablePdfEditorSession,
  migrateLegacyPdfEditorDraft,
  savePdfEditorDraft,
  savePdfEditorDraftAsync,
} from '../pdfEdit-utils/editorPersistence';
import type { PdfEditorDraft } from '../pdfEdit-utils/editorPersistence';
import { createPdfEditorProcessingConsent, type PdfEditorProcessingPurpose, type PdfEditorProcessingRequest } from '../pdfEdit-utils/editorProcessingConsent';
import { pdfEditorAnnotationBlocker, supportedOriginalTextStyle } from '../pdfEdit-utils/editorCapabilities';
import {
  appendBoundedDocumentHistory,
  createDocumentHistory,
} from '../pdfEdit-utils/editorHistory';
import type { DocumentHistoryEntry } from '../pdfEdit-utils/editorHistory';
import {
  applyPdfEditorPageSessionOperation,
  approvePdfEditorPageSession,
  createPdfEditorPageSession,
  describePdfEditorPageSessionExport,
  exportPdfEditorPageSession,
  isPdfEditorPageSessionApproved,
  pdfEditorPageSessionHasChanges,
  restorePdfEditorPageSession,
  serializePdfEditorPagePlan,
} from '../pdfEdit-utils/editorPageSession';
import type { PdfEditorPageSession } from '../pdfEdit-utils/editorPageSession';
import { decidePdfEditorPageExportStrategy, exportPdfEditorPagePlan } from '../pdfEdit-utils/editorPageExport';
import { verifyGeneratedPdfEditorPagePlan } from '../pdfEdit-utils/editorPageExportVerification';
import type { PdfEditorPageExportImpact } from '../pdfEdit-utils/editorPageImpact';
import type {
  PdfEditorPageOperation,
  PdfEditorPagePlan,
  PdfEditorPagePlanError,
} from '../pdfEdit-utils/editorPageModel';
import {
  planPdfEditorVectorPage,
  vectorFontFamilyLabel,
} from '../pdfEdit-utils/editorVectorOverlay';
import type {
  PdfEditorVectorFontAssets,
  PdfEditorVectorFontRole,
  PdfEditorVectorOperation,
} from '../pdfEdit-utils/editorVectorOverlay';
import { loadPdfEditorVectorFonts } from '../pdfEdit-utils/editorVectorFont';
import {
  classifyPdfLoadFailure,
  hasPdfSignature,
  validatePdfFileMetadata,
  validatePdfPageCount,
} from '../pdfEdit-utils/editorIntake';
import type { PdfIntakeFailure } from '../pdfEdit-utils/editorIntake';
import {
  clonePdfBytes,
  countFabricCanvasObjects,
  decidePdfEditorExportMode,
  exportStructurePreservingPdf,
  isEffectiveTextEdit,
  UnsupportedScriptExportError,
} from '../pdfEdit-utils/editorExport';
import {
  computeOverlayPlacement,
  computePageSizeFitFill,
  normalizePdfRotation,
} from '../pdfEdit-utils/editorPageFitGeometry';
import {
  PDF_EDITOR_THUMBNAIL_PIXEL_BUDGET,
  resolvePdfEditorPreviewOutputScale,
  resolvePdfEditorRenderScale,
} from '../pdfEdit-utils/editorRenderSharpness';

import type {
  PdfEditorExportMode,
  PdfEditorOverlayMutation,
  PdfEditorPageSizeKey,
  PdfEditorTextMutation,
} from '../pdfEdit-utils/editorExport';
import {
  buildPdfExportImpact,
  scanPdfDocumentPreflight,
  scanPdfSourceSignals,
} from '../pdfEdit-utils/editorPreflight';
import type {
  PdfDocumentPreflight,
  PdfExportImpact,
  PdfPreflightDocument,
} from '../pdfEdit-utils/editorPreflight';
import { verifyGeneratedPdf } from '../pdfEdit-utils/editorExportVerification';
import type { PdfPostExportVerification } from '../pdfEdit-utils/editorExportVerification';
import { isPdfEditorFeatureEnabled } from '../pdfEdit-utils/editorFeatureFlags';
import {
  computePdfEditorExportFingerprint,
  createPdfEditorExportBuildCache,
  getOrBuildPdfEditorExport,
} from '../pdfEdit-utils/editorExportBuildCache';
import { deriveTextBlockGeometry, documentFontSize } from '../pdfEdit-utils/editorTextBlockGeometry';
import {
  clonePdfEditorFabricObject,
  movePdfEditorFabricObject,
  renewPdfEditorFabricObjectIds,
  restorePdfEditorFabricCanvas,
  snapshotPdfEditorFabricCanvas,
} from '../pdfEdit-utils/editorFabricAdapters';
import {
  applyServerTextEdits,
  buildServerTextEditConsentImpact,
  classifyServerTextEditConsent,
  describeServerTextEditDisclosures,
  describeServerTextEditFailure,
  isServerTextEditTrustworthy,
  mergeServerTextEditConsent,
  serverTextEditConsentFor,
  toServerTextEditRequest,
  UNKNOWN_SOURCE_TEXT_COLOR,
} from '../pdfEdit-utils/editorServerTextEdit';
import type { ServerTextEditConsentRequest } from '../pdfEdit-utils/editorServerTextEdit';
import {
  createPdfEditorRedactionMark,
  pdfEditorRedactionExpectations,
  removePdfEditorRedactionMark,
  togglePdfEditorRedactionMark,
} from '../pdfEdit-utils/editorRedaction';
import type { PdfEditorRedactionMark } from '../pdfEdit-utils/editorRedaction';
import {
  alignPdfEditorObjects,
  clampPdfEditorObjectGeometry,
  createPdfEditorObjectId,
  distributePdfEditorObjects,
  geometryChanged,
  nudgePdfEditorObjectGeometry,
  pdfEditorLayerName,
  type PdfEditorAlignMode,
  type PdfEditorAlignedObject,
  type PdfEditorDistributeAxis,
  type PdfEditorLayer,
  type PdfEditorLayerKind,
  type PdfEditorObjectGeometry,
  type PdfEditorObjectStyle,
} from '../pdfEdit-utils/editorObjectOps';
import {
  snapPdfEditorObjectGeometry,
  type PdfEditorSnapGuide,
} from '../pdfEdit-utils/editorSnapping';
import type {
  PdfEditorDragGeometry,
  PdfEditorDragShape,
} from '../pdfEdit-utils/editorShapeDrag';
import {
  createPdfEditorAnnotation,
  createPdfEditorTextAnnotation,
  isPdfEditorTextMarkupKind,
  mapPdfEditorAnnotationsToOutput,
  pdfEditorAnnotationDefaultColor,
  PDF_EDITOR_DEFAULT_ANNOTATION_AUTHOR,
  PDF_EDITOR_DEFAULT_STAMP,
  removePdfEditorAnnotation,
  togglePdfEditorTextAnnotation,
  updatePdfEditorAnnotation,
  type PdfEditorAnnotation,
  type PdfEditorAnnotationKind,
  type PdfEditorAnnotationStyle,
} from '../pdfEdit-utils/editorAnnotations';
import {
  exportPdfEditorAnnotations,
  pdfEditorAnnotationExpectations,
  verifyPdfEditorAnnotationExport,
} from '../pdfEdit-utils/editorAnnotationExport';

type FabricCanvasState = Record<string, unknown>;

type EditorDocumentSnapshot = {
  pageSize: PageSizeKey;
  textEdits: Record<string, OriginalTextEdit>;
  canvasStates: Record<string, FabricCanvasState>;
  /**
   * The page order/rotation plan at snapshot time. Page operations are document
   * edits, so they belong in the same undo history as text and canvas work —
   * two histories would let a user undo "the last thing" into an incoherent
   * combination of the two.
   */
  pagePlan: PdfEditorPagePlan | null;
  /** W3 marks are document edits and must undo/redo with the rest. */
  redactionMarks: readonly PdfEditorRedactionMark[];
  /** W4 annotations are document edits too; they reach the exported bytes. */
  annotations: readonly PdfEditorAnnotation[];
};

type FabricObjectLike = {
  type?: string;
  isEditing?: boolean;
  exitEditing?: () => void;
  enterEditing?: () => void;
  selectAll?: () => void;
  set: (key: string | Record<string, unknown>, value?: unknown) => void;
  scaleToWidth?: (width: number) => void;
  getScaledWidth?: () => number;
  getScaledHeight?: () => number;
  fontFamily?: string;
  fontSize?: number;
  fontWeight?: string | number;
  fontStyle?: string;
  underline?: boolean;
  fill?: string;
  backgroundColor?: string;
  lineHeight?: number;
  textAlign?: TextStyle['align'];
  left?: number;
  top?: number;
  width?: number;
  height?: number;
  scaleX?: number;
  scaleY?: number;
  angle?: number;
  visible?: boolean;
  selectable?: boolean;
  evented?: boolean;
  hasControls?: boolean;
  hasBorders?: boolean;
  lockMovementX?: boolean;
  lockMovementY?: boolean;
  lockScalingX?: boolean;
  lockScalingY?: boolean;
  lockRotation?: boolean;
  stroke?: string | null;
  strokeWidth?: number;
  strokeDashArray?: number[] | null;
  opacity?: number;
  bringToFront?: () => void;
  sendToBack?: () => void;
  setCoords?: () => void;
  clone?: (callback: (object: FabricObjectLike | null, error?: boolean) => void, propertiesToInclude?: string[]) => unknown;
  getObjects?: () => FabricObjectLike[];
  dispose?: () => void;
  getBoundingRect?: () => { left: number; top: number; width: number; height: number };
  peId?: string;
  peLocked?: boolean;
  peHidden?: boolean;
  peName?: string;
};

type FabricImageLike = FabricObjectLike & {
  scaleToWidth: (width: number) => void;
  getScaledWidth: () => number;
  getScaledHeight: () => number;
};

type FabricBrushLike = { color: string; width: number };

type FabricCanvasLike = {
  lowerCanvasEl?: HTMLCanvasElement | null;
  upperCanvasEl?: HTMLCanvasElement | null;
  disposed?: boolean;
  destroyed?: boolean;
  width?: number;
  height?: number;
  renderOnAddRemove?: boolean;
  freeDrawingBrush?: FabricBrushLike;
  isDrawingMode?: boolean;
  selection?: boolean;
  defaultCursor?: string;
  hoverCursor?: string;
  getZoom?: () => number;
  getActiveObject: () => FabricObjectLike | null | undefined;
  getActiveObjects?: () => FabricObjectLike[];
  getObjects?: () => FabricObjectLike[];
  bringToFront?: (obj: FabricObjectLike) => void;
  sendToBack?: (obj: FabricObjectLike) => void;
  bringForward?: (obj: FabricObjectLike) => void;
  sendBackwards?: (obj: FabricObjectLike) => void;
  backgroundColor?: unknown;
  overlayColor?: unknown;
  backgroundImage?: FabricObjectLike | null;
  overlayImage?: FabricObjectLike | null;
  clipPath?: FabricObjectLike | null;
  setActiveObject: (obj: FabricObjectLike) => void;
  discardActiveObject?: () => void;
  add: (obj: FabricObjectLike) => void;
  remove: (obj: FabricObjectLike) => void;
  clear?: () => void;
  requestRenderAll?: () => void;
  renderAll: () => void;
  toJSON: (propertiesToInclude?: string[]) => FabricCanvasState;
  loadFromJSON: (json: FabricCanvasState, callback?: () => void) => unknown;
  on: (event: string, handler: (e: unknown) => void) => void;
};

type FabricStaticCanvasLike = Pick<FabricCanvasLike, 'backgroundColor' | 'overlayColor' | 'backgroundImage' | 'overlayImage' | 'clipPath'> & {
  renderAll: () => void;
  loadFromJSON: (json: FabricCanvasState, callback?: () => void) => unknown;
  toJSON: (propertiesToInclude?: string[]) => FabricCanvasState;
  getObjects: () => FabricObjectLike[];
  remove: (object: FabricObjectLike) => void;
  toDataURL: (options: { format: 'png'; multiplier: number }) => string;
  dispose: () => void;
};

type FabricOverlayScale = {
  scaleX: number;
  scaleY: number;
  width: number;
  height: number;
};

type FabricImageFactoryLike = {
  fromURL: (
    url: string,
    callback: (img: FabricImageLike | null) => void,
    options?: Record<string, unknown>,
  ) => void | Promise<FabricImageLike | null>;
};

type FabricNamespace = {
  Canvas: new (
    element: HTMLCanvasElement,
    options: {
      width: number;
      height: number;
      selection: boolean;
      backgroundColor: string;
      preserveObjectStacking: boolean;
    },
  ) => FabricCanvasLike;
  StaticCanvas: new (
    element: HTMLCanvasElement,
    options: { width: number; height: number; backgroundColor: string; renderOnAddRemove?: boolean },
  ) => FabricStaticCanvasLike;
  Textbox: new (text: string, options: Record<string, unknown>) => FabricObjectLike;
  Text: new (text: string, options: Record<string, unknown>) => FabricObjectLike;
  PencilBrush: new (canvas: FabricCanvasLike) => FabricBrushLike;
  Rect: new (options: Record<string, unknown>) => FabricObjectLike;
  Ellipse: new (options: Record<string, unknown>) => FabricObjectLike;
  Line: new (points: number[], options: Record<string, unknown>) => FabricObjectLike;
  Triangle: new (options: Record<string, unknown>) => FabricObjectLike;
  Group: new (objects: FabricObjectLike[], options: Record<string, unknown>) => FabricObjectLike;
  Image?: FabricImageFactoryLike;
  FabricImage?: FabricImageFactoryLike;
};

type PdfJsViewportLike = { width: number; height: number; transform: number[] };
type PdfJsRenderTaskLike = { promise: Promise<void>; cancel: () => void };
type PdfJsTextItemLike = {
  str?: string;
  width?: number;
  height?: number;
  fontName?: string;
  transform: number[];
};
type PdfJsTextContentLike = {
  items: PdfJsTextItemLike[];
  styles?: Record<string, { ascent?: number; descent?: number }>;
};
type PdfJsAnnotationLike = {
  id?: string;
  subtype?: string;
  annotationType?: number;
  contentsObj?: { str?: string };
  titleObj?: { str?: string };
  rect?: number[];
};
type PdfJsOutlineItemLike = {
  title?: string;
  dest?: string | unknown[] | null;
  items?: PdfJsOutlineItemLike[];
};

function isPdfJsOutlineItemLike(value: unknown): value is PdfJsOutlineItemLike {
  if (!value || typeof value !== 'object') return false;
  const item = value as Record<string, unknown>;
  return (item.title === undefined || typeof item.title === 'string')
    && (item.dest === undefined || item.dest === null || typeof item.dest === 'string' || Array.isArray(item.dest))
    && (item.items === undefined || Array.isArray(item.items));
}
type PdfJsPageLike = {
  rotate?: number;
  getViewport: (args: { scale: number }) => PdfJsViewportLike;
  render: (args: {
    canvasContext: CanvasRenderingContext2D;
    viewport: unknown;
    canvas: HTMLCanvasElement;
  } & Record<string, unknown>) => PdfJsRenderTaskLike;
  getTextContent: () => Promise<PdfJsTextContentLike>;
  getAnnotations?: () => Promise<PdfJsAnnotationLike[]>;
};
type PdfJsDocumentLike = Omit<PdfPreflightDocument, 'getPage'> & {
  numPages: number;
  destroy: () => Promise<void>;
  getPage: (page: number) => Promise<PdfJsPageLike>;
  getOutline?: () => Promise<PdfJsOutlineItemLike[] | null>;
  getDestination?: (name: string) => Promise<unknown[] | null>;
  getPageIndex?: (reference: unknown) => Promise<number>;
};

declare global {
  interface Window {
    __fabric__?: FabricNamespace;
  }
}

export type ToolType =
  | 'select' | 'text' | 'editText' | 'redact' | 'annotate' | 'image' | 'signature'
  | 'rect' | 'circle' | 'line' | 'arrow' | 'emoji' | 'highlight';

export interface TextBlock {
  page: number;
  index: number;
  text: string;
  /**
   * The span's rectangle in the *rendered* page's pixel space, so these four
   * already carry whatever zoom `getTextBlocks` was called with.
   */
  x: number;
  y: number;
  width: number;
  height: number;
  /** Font descent in document points, when PDF.js exposes the source metrics. */
  fontDescent?: number;
  /** Font ascent in document points, when PDF.js exposes the source metrics. */
  fontAscent?: number;
  /**
   * Full font box in the current rendered page's pixel space. Used by the
   * redaction hover target and preview bar so they cover every visible glyph
   * without widening the engine rectangle stored in `x`/`y`/`width`/`height`.
   */
  fontBox?: { x: number; y: number; width: number; height: number };
  /**
   * The size the document sets this run at, in points — **not** in the pixel
   * space of `x`/`y`/`width`/`height`, and deliberately independent of the zoom
   * the blocks were read at.
   *
   * It has to be, because this value is what seeds `OriginalTextEdit.fontSize`
   * and what the export sends as `sourceFontSize`; a display-space number there
   * meant that merely clicking a line at Fit page asked the engine to re-render
   * it at a size the document never used. Anything drawing to the screen
   * multiplies by the live zoom itself, exactly once.
   */
  fontSize: number;
  fontFamily: string;
  color: string;
}

export interface PdfEditorSearchResult extends TextBlock {
  id: string;
  snippet: string;
  /** Output position of the page, so navigation follows the page plan. */
  position: number;
}

export interface PdfEditorOutlineEntry {
  id: string;
  title: string;
  page: number | null;
  depth: number;
}

export interface PdfEditorCommentEntry {
  id: string;
  page: number;
  subtype: string;
  author: string;
  contents: string;
}

export interface OriginalTextEdit {
  text: string;
  fontSize: number;
  fontFamily: string;
  color: string;
  bold: boolean;
  italic: boolean;
  underline: boolean;
  align: 'left' | 'center' | 'right';
  lineHeight: number;
  backgroundColor?: string;
}

export type HeadingLevel = 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6' | 'body';

/**
 * Re-exported from the export layer, which is the module that has to reason
 * about these values. Keeping one definition means the export decision cannot
 * accept a page size the editor never offers, nor miss one it does. (C9)
 */
export type PageSizeKey = PdfEditorPageSizeKey;

export const PAGE_SIZE_PRESETS: Record<PageSizeKey, { label: string; width: number; height: number }> = {
  original: { label: 'Original', width: 0,      height: 0 },
  a4:     { label: 'A4',     width: 595.28, height: 841.89 },
  a3:     { label: 'A3',     width: 841.89, height: 1190.55 },
  a2:     { label: 'A2',     width: 1190.55, height: 1683.78 },
  letter: { label: 'Letter', width: 612,    height: 792 },
  legal:  { label: 'Legal',  width: 612,    height: 1008 },
};

export interface TextStyle {
  fontFamily:    string;
  fontSize:      number;
  bold:          boolean;
  italic:        boolean;
  underline:     boolean;
  color:         string;
  bgColor:       string;
  heading:       HeadingLevel;
  lineHeight:    number;
  align:         'left' | 'center' | 'right';
}

export interface PdfEditorOcrCopyRequest { session: number; revision: string }

export interface EditorState {
  pdfFile:        File | null;
  documentSession: number;
  processingAllowed: boolean;
  processingRequest: PdfEditorProcessingRequest | null;
  isServerProcessing: boolean;
  isOcrProcessing: boolean;
  ocrMessage: string | null;
  ocrFailed: boolean;
  recoveryStatus: 'enabled' | 'clearing' | 'disabled' | 'error';
  recoveryMessage: string | null;
  recoverySourceStored: boolean;
  sourcePageRotations: Readonly<Record<number, number>>;
  /** Output page count after the page plan (delete/duplicate change it). */
  totalPages:     number;
  /** Pages in the source document. Never changes for an open file. */
  sourcePageCount: number;
  currentPage:    number;
  zoom:           number;
  activeTool:     ToolType;
  pageSize:       PageSizeKey;
  textStyle:      TextStyle;
  /** What the canvas selection currently is, for the contextual inspector. */
  selectedObjectKind: 'none' | 'text' | 'image' | 'shape';
  /** Active object's geometry in PDF points, never screen pixels. */
  selectedObjectGeometry: PdfEditorObjectGeometry | null;
  selectedObjectLocked: boolean;
  selectedObjectHidden: boolean;
  selectedObjectCount: number;
  hasObjectClipboard: boolean;
  selectedObjectStyle: PdfEditorObjectStyle | null;
  /** Objects on the current source page, topmost first, for the layers panel. */
  pageLayers: readonly PdfEditorLayer[];
  /**
   * The page plan is the single source of truth for output order and rotation.
   * `totalPages` is always `pagePlan.entries.length` while a document is open.
   */
  pagePlan:       PdfEditorPagePlan | null;
  historyIndex:   number;
  canUndo:        boolean;
  canRedo:        boolean;
  isLoading:      boolean;
  isRestoringCanvas: boolean;
  isExporting:    boolean;
  loadError:      string | null;
  loadFailure:    PdfIntakeFailure | null;
  preflightStatus: 'idle' | 'scanning' | 'ready' | 'partial';
  preflightReport: PdfDocumentPreflight | null;
  lastExportVerification: PdfPostExportVerification | null;
  /**
   * Fidelity downgrades the engine performed on the last export, in plain words.
   *
   * A shrink-to-fit, a typeface substitution or a destructive redaction mode are
   * all legitimate outcomes, but each changes the document in a way the user did
   * not ask for. Reporting `verified` without naming them is the contract
   * violation this field closes.
   */
  lastExportDisclosures: string[];
  /**
   * Loss the user has explicitly accepted, so the text engine will stop refusing
   * it. Lives in state rather than in the page component because both consumers
   * of a build — the preview and Save — must see the same grant, or the preview
   * would show a document the download cannot produce.
   *
   * Cleared on load: a grant is about one document and one set of boxes.
   */
  grantedTextEditConsent: ServerTextEditConsentRequest | null;
  saveStatus:     'idle' | 'saving' | 'saved' | 'error';
  saveMessage:    string | null;
  lastSavedAt:    number | null;
  editVersion:    number;
  selectedOriginalTextKey: string | null;
  /**
   * W3 redaction marks. They are authoring intent, not applied content: export
   * sends them to the server engine, which removes the glyphs and verifies the
   * output. Nothing about them is drawn into the PDF until that happens.
   */
  redactionMarks: readonly PdfEditorRedactionMark[];
  /**
   * W4 annotations. Authored here and written as real PDF annotation
   * dictionaries at export; the preview shows the exported bytes, so what is on
   * screen and what a reviewer opens cannot drift apart.
   */
  annotations: readonly PdfEditorAnnotation[];
  annotationKind: PdfEditorAnnotationKind;
  annotationStyle: PdfEditorAnnotationStyle;
  selectedAnnotationId: string | null;
  /** Alignment guides from the last snapped drag, in PDF points. */
  snapGuides: readonly PdfEditorSnapGuide[];
}

const HEADING_SIZES: Record<HeadingLevel, number> = {
  h1: 32, h2: 26, h3: 22, h4: 18, h5: 15, h6: 13, body: 12,
};

/**
 * Object properties that must survive serialize/restore. Fabric's default
 * `toJSON` drops custom keys, which would make layers forget their identity,
 * lock state and names on every reload.
 */
const FABRIC_SERIALIZED_PROPS = [
  'selectable',
  'editable',
  'evented',
  'hasControls',
  'hasBorders',
  'lockMovementX',
  'lockMovementY',
  'lockScalingX',
  'lockScalingY',
  'lockRotation',
  'peId',
  'peLocked',
  'peHidden',
  'peName',
];

const DEFAULT_TEXT_STYLE: TextStyle = {
  fontFamily: 'Helvetica',
  fontSize:   12,
  bold:       false,
  italic:     false,
  underline:  false,
  color:      '#000000',
  bgColor:    'transparent',
  heading:    'body',
  lineHeight: 1.4,
  align:      'left',
};

/**
 * Thrown when a page the user edited could not be rasterised into the export
 * overlay. The export must refuse rather than save a document that is missing
 * the user's own work without any error — that silent loss is exactly what the
 * editor's export contract forbids.
 */
class OverlayRenderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OverlayRenderError';
  }
}

function selectedObjectKind(
  object: FabricObjectLike | null | undefined,
): EditorState['selectedObjectKind'] {
  if (!object) return 'none';
  if (object.type === 'i-text' || object.type === 'textbox' || object.type === 'text') return 'text';
  if (object.type === 'image') return 'image';
  return 'shape';
}

function objectLayerKind(object: FabricObjectLike): PdfEditorLayerKind {
  const kind = selectedObjectKind(object);
  return kind === 'none' ? 'shape' : kind;
}

/**
 * Read a Fabric object in PDF points.
 *
 * `left/top` and scaled extents are screen coordinates at the current zoom; the
 * inspector and export speak points. This is the single conversion point, so a
 * future zoom level cannot silently make the two disagree.
 */
function readObjectGeometry(
  object: FabricObjectLike,
): PdfEditorObjectGeometry {
  /**
   * Fabric's viewport zoom is already applied when it draws, and `getPointer`
   * (and therefore everything Fabric stores on an object) is in the unscaled
   * canvas space. With `fc.setZoom(zoom)` that space is the page's own points:
   * at Fit page the page is 612pt wide, the canvas element is 318px, and an
   * object at `left: 100` is drawn at 52px. Dividing by zoom here made every
   * object appear `zoom` times too far right/down to the snapping and export
   * code, and then multiplying it back on write clamped drags at the *middle*
   * of the page whenever the zoom was below 1.
   */
  const width = object.getScaledWidth?.()
    ?? (object.width ?? 0) * (object.scaleX ?? 1);
  const height = object.getScaledHeight?.()
    ?? (object.height ?? 0) * (object.scaleY ?? 1);
  return {
    x: object.left ?? 0,
    y: object.top ?? 0,
    width,
    height,
  };
}

function readObjectStyle(object: FabricObjectLike): PdfEditorObjectStyle {
  return {
    fill: typeof object.fill === 'string' ? object.fill : null,
    stroke: typeof object.stroke === 'string' ? object.stroke : null,
    strokeWidth: typeof object.strokeWidth === 'number' ? object.strokeWidth : 0,
    strokeDashArray: Array.isArray(object.strokeDashArray) ? [...object.strokeDashArray] : null,
    opacity: typeof object.opacity === 'number' ? object.opacity : 1,
  };
}

function wrapCanvasText(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
): string[] {
  const lines: string[] = [];
  text.split(/\r?\n/).forEach((hardLine) => {
    const words = hardLine.split(/\s+/).filter(Boolean);
    if (!words.length) {
      lines.push('');
      return;
    }
    let line = words[0];
    words.slice(1).forEach((word) => {
      const next = `${line} ${word}`;
      if (ctx.measureText(next).width <= maxWidth) {
        line = next;
      } else {
        lines.push(line);
        line = word;
      }
    });
    lines.push(line);
  });
  return lines;
}


function drawImageUrl(
  ctx: CanvasRenderingContext2D,
  url: string,
  width: number,
  height: number,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const image = new window.Image();
    image.onload = () => {
      ctx.drawImage(image, 0, 0, width, height);
      resolve();
    };
    image.onerror = () => reject(new Error('An editor overlay image could not be loaded for visual export.'));
    image.src = url;
  });
}

function scaleFabricCanvasStateForOverlay(
  savedState: FabricCanvasState,
  scale: FabricOverlayScale | null,
): FabricCanvasState {
  if (!scale || (scale.scaleX === 1 && scale.scaleY === 1)) return savedState;
  const cloned = structuredClone(savedState) as FabricCanvasState;
  const visit = (value: unknown) => {
    if (!value || typeof value !== 'object') return;
    const object = value as Record<string, unknown>;
    if (typeof object.left === 'number') object.left *= scale.scaleX;
    if (typeof object.top === 'number') object.top *= scale.scaleY;
    if (typeof object.scaleX === 'number') object.scaleX *= scale.scaleX;
    else object.scaleX = scale.scaleX;
    if (typeof object.scaleY === 'number') object.scaleY *= scale.scaleY;
    else object.scaleY = scale.scaleY;
    if (Array.isArray(object.objects)) object.objects.forEach(visit);
  };
  if (Array.isArray(cloned.objects)) cloned.objects.forEach(visit);
  return cloned;
}

/**
 * Physical pixels per CSS pixel, or 1 where there is no viewport to ask.
 *
 * The rasters are sized through the pure sharpness helper; this is the only
 * place the module reads the environment, so every pure input stays testable.
 * A missing ratio (server render, exotic embedder) resolves to 1, which is
 * exactly the CSS-pixel sizing the editor used before this existed.
 */
function currentDevicePixelRatio() {
  return typeof window === 'undefined' ? 1 : window.devicePixelRatio;
}

function measureEditedTextMutationBox(
  block: TextBlock,
  edit: OriginalTextEdit,
  pageDims: { width: number; height: number } | null,
) {
  const maxWidth = Math.max(1, (pageDims?.width ?? block.x + block.width) - block.x);
  const maxHeight = Math.max(1, (pageDims?.height ?? block.y + block.height) - block.y);
  const fontSize = Math.max(4, edit.fontSize);
  const lineHeight = Math.max(fontSize, fontSize * edit.lineHeight);
  let measuredWidth = block.width;

  if (typeof document !== 'undefined') {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.font = `${edit.italic ? 'italic ' : ''}${edit.bold ? '700 ' : '400 '} ${fontSize}px ${edit.fontFamily}, Helvetica, Arial, sans-serif`;
      measuredWidth = Math.max(
        block.width,
        ...edit.text.split(/\r?\n/).map(line => ctx.measureText(line || ' ').width + 2),
      );
      const width = Math.min(maxWidth, Math.max(block.width, measuredWidth));
      const lines = wrapCanvasText(ctx, edit.text, width);
      return {
        width,
        height: Math.min(maxHeight, Math.max(block.height, lines.length * lineHeight)),
      };
    }
  }

  const estimatedWidth = Math.max(
    block.width,
    ...edit.text.split(/\r?\n/).map(line => line.length * fontSize * 0.58 + 2),
  );
  const width = Math.min(maxWidth, estimatedWidth);
  const estimatedLines = edit.text.split(/\r?\n/).reduce((count, line) => (
    count + Math.max(1, Math.ceil((line.length * fontSize * 0.58) / Math.max(1, width)))
  ), 0);
  return {
    width,
    height: Math.min(maxHeight, Math.max(block.height, estimatedLines * lineHeight)),
  };
}

export function usePdfEditor() {
  const [state, setState] = useState<EditorState>({
    pdfFile:      null,
    documentSession: 0,
    processingAllowed: false,
    processingRequest: null,
    isServerProcessing: false,
    isOcrProcessing: false,
    ocrMessage: null,
    ocrFailed: false,
    recoveryStatus: 'enabled',
    recoveryMessage: null,
    recoverySourceStored: false,
    sourcePageRotations: {},
    totalPages:   0,
    sourcePageCount: 0,
    currentPage:  1,
    zoom:         1.0,
    activeTool:   'select',
    pageSize:     'original',
    textStyle:    DEFAULT_TEXT_STYLE,
    selectedObjectKind: 'none',
    selectedObjectGeometry: null,
    selectedObjectLocked: false,
    selectedObjectHidden: false,
    selectedObjectCount: 0,
    hasObjectClipboard: false,
    selectedObjectStyle: null,
    pageLayers: [],
    pagePlan:     null,
    historyIndex: -1,
    canUndo:      false,
    canRedo:      false,
    isLoading:    false,
    isRestoringCanvas: false,
    isExporting:  false,
    loadError:    null,
    loadFailure:  null,
    preflightStatus: 'idle',
    preflightReport: null,
    lastExportVerification: null,
    lastExportDisclosures: [],
    grantedTextEditConsent: null,
    saveStatus:   'idle',
    saveMessage:  null,
    lastSavedAt:  null,
    editVersion:  0,
    selectedOriginalTextKey: null,
    redactionMarks: [],
    annotations: [],
    annotationKind: 'highlight',
    annotationStyle: {
      color: pdfEditorAnnotationDefaultColor('highlight'),
      author: PDF_EDITOR_DEFAULT_ANNOTATION_AUTHOR,
      stamp: PDF_EDITOR_DEFAULT_STAMP,
      uri: '',
    },
    selectedAnnotationId: null,
    snapGuides: [],
  });

  // Per-page Fabric canvas instances
  const fabricRefs    = useRef<Map<number, FabricCanvasLike>>(new Map());
  // Complete per-page Fabric JSON state, restored whenever a page is revisited.
  const pageCanvasStatesRef = useRef<Map<number, FabricCanvasState>>(new Map());
  // PDF.js document reference
  const pdfDocRef     = useRef<unknown>(null);
  // Unified, bounded history across text, Fabric objects, and page properties.
  const documentHistoryRef = useRef<DocumentHistoryEntry[]>([]);
  const documentHistoryIndexRef = useRef(-1);
  const restoringDocumentHistoryRef = useRef(false);
  /** Owns all page order/rotation state. Never edited directly. */
  const pageSessionRef = useRef<PdfEditorPageSession | null>(null);
  /** Current zoom mirror; selection handlers must not read stale render state. */
  const zoomRef = useRef(1);
  const objectSeqRef = useRef(0);
  /** A cloned object that can be pasted onto any page, including another one. */
  const objectClipboardRef = useRef<FabricObjectLike | null>(null);
  const clipboardRequestRef = useRef(0);
  // Active Fabric object reference
  const activeObjRef  = useRef<FabricObjectLike | null>(null);
  // Active PDF.js render task per page to avoid concurrent canvas renders.
  const renderTaskRef = useRef<Map<number, PdfJsRenderTaskLike>>(new Map());
  // Per-page render queue to ensure renders are strictly serialized.
  const renderQueueRef = useRef<Map<number, Promise<void>>>(new Map());
  // Original PDF text edits keyed by page:index, including styling metadata.
  const originalTextEditsRef = useRef<Map<string, OriginalTextEdit>>(new Map());
  const selectedOriginalTextKeyRef = useRef<string | null>(null);
  // W3 redaction authoring. The ref mirrors state so buildDraft/export can read
  // it synchronously without depending on a render.
  const redactionMarksRef = useRef<PdfEditorRedactionMark[]>([]);
  // W4 annotations mirror state, so export and history can read them in the
  // same tick a change was committed.
  const annotationsRef = useRef<PdfEditorAnnotation[]>([]);
  // Rendered page dimensions, used to rebuild off-screen overlays for export/preview.
  const pageDimsRef    = useRef<Map<number, { width: number; height: number }>>(new Map());
  // Original PDF page dimensions at scale 1; Fabric objects are stored in this coordinate space.
  const pageBaseDimsRef = useRef<Map<number, { width: number; height: number }>>(new Map());
  // Prevent loadFromJSON's internal add/remove events from overwriting saved state.
  const restoringPagesRef = useRef<Map<number, symbol>>(new Map());
  const failedRestorePagesRef = useRef<Map<number, string>>(new Map());
  const isResettingSessionRef = useRef(false);
  const documentIdRef = useRef<string | null>(null);
  const currentFileRef = useRef<File | null>(null);
  const pageSizeRef = useRef<PageSizeKey>('original');
  const autosaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saveRevisionRef = useRef(0);
  const persistedRevisionRef = useRef(0);
  const sourceStoredRef = useRef(false);
  const saveQueueRef = useRef(createPdfEditorRecoveryQueue());
  const documentSessionRef = useRef(0);
  const processingConsentRef = useRef(createPdfEditorProcessingConsent());
  const ocrControllerRef = useRef<AbortController | null>(null);
  const ocrCopyRequestRef = useRef<PdfEditorOcrCopyRequest | null>(null);
  const sourcePageRotationsRef = useRef<Record<number, number>>({});
  const exportBuildCacheRef = useRef(createPdfEditorExportBuildCache<Promise<PdfEditorExportBuild>>());
  const textConsentRef = useRef<{ revision: string; consent: ServerTextEditConsentRequest } | null>(null);
  const pageApprovalRevisionRef = useRef<string | null>(null);
  const serverBuildsRef = useRef(new Set<AbortController>());

  // -- helpers ------------------------------------------------

  const set = useCallback((partial: Partial<EditorState>) => {
    if (partial.pdfFile === null) {
      documentSessionRef.current += 1;
      processingConsentRef.current.reset(documentSessionRef.current);
      saveQueueRef.current.reset();
      ocrControllerRef.current?.abort();
      ocrControllerRef.current = null;
      ocrCopyRequestRef.current = null;
      const previousDoc = pdfDocRef.current as PdfJsDocumentLike | null;
      void previousDoc?.destroy().catch(() => {});
      serverBuildsRef.current.forEach(controller => controller.abort());
      serverBuildsRef.current.clear();
      renderTaskRef.current.forEach(task => { try { task.cancel(); } catch {} });
      renderTaskRef.current.clear();
      renderQueueRef.current.clear();
      if (autosaveTimerRef.current) clearTimeout(autosaveTimerRef.current);
      autosaveTimerRef.current = null;
      currentFileRef.current = null;
      documentIdRef.current = null;
      pdfDocRef.current = null;
      exportBuildCacheRef.current.clear();
      textConsentRef.current = null;
      pageApprovalRevisionRef.current = null;
      clipboardRequestRef.current += 1;
      restoringPagesRef.current.clear();
      failedRestorePagesRef.current.clear();
      restoringDocumentHistoryRef.current = false;
      partial = {
        ...partial, isExporting: false, isRestoringCanvas: false, hasObjectClipboard: objectClipboardRef.current !== null,
        documentSession: documentSessionRef.current, processingAllowed: false, processingRequest: null,
        isServerProcessing: false, isOcrProcessing: false, ocrMessage: null, ocrFailed: false,
        recoveryStatus: 'enabled', recoveryMessage: null, recoverySourceStored: false, sourcePageRotations: {},
      };
    }
    if (typeof partial.zoom === 'number' && Number.isFinite(partial.zoom) && partial.zoom > 0) {
      zoomRef.current = partial.zoom;
    }
    setState(prev => ({ ...prev, ...partial }));
  }, []);

  // `hexToRgb01` used to live here for the canvas preview that drew its own
  // approximation of an edit. The preview now renders the exported bytes, so the
  // only place a colour has to be converted is `editorExport.ts`, which has its
  // own. Do not reintroduce one here: a colour being converted in the hook means
  // something is painting a result instead of showing the export.

  const isFabricCanvasUsable = (fc: FabricCanvasLike | null | undefined) => {
    const canvas = fc?.lowerCanvasEl as HTMLCanvasElement | null | undefined;
    if (!fc || fc.disposed || fc.destroyed || !canvas || !canvas.isConnected) return false;

    try {
      return !!canvas.getContext('2d');
    } catch {
      return false;
    }
  };

  const getLiveFabric = useCallback((page: number) => {
    if (restoringPagesRef.current.has(page) || failedRestorePagesRef.current.has(page)) return null;
    const fc = fabricRefs.current.get(page);
    if (isFabricCanvasUsable(fc)) return fc;
    if (fc) fabricRefs.current.delete(page);
    return null;
  }, []);

  const textBlockKey = (page: number, index: number) => `${page}:${index}`;

  /**
   * Output position ? source page. The canvas and every edit record are keyed by
   * the source page, so a reorder changes which position shows a page without
   * moving that page's work. Falls back to the position before a plan exists.
   */
  const resolveSourcePage = useCallback((position: number) => {
    const plan = pageSessionRef.current?.plan;
    return plan?.entries[position - 1]?.sourcePage ?? position;
  }, []);

  const getPdfDocOrNull = () => {
    const doc = pdfDocRef.current;
    if (doc && typeof (doc as PdfJsDocumentLike).getPage === 'function') {
      return doc as PdfJsDocumentLike;
    }
    return null;
  };

  const makeDefaultOriginalTextEdit = (block: TextBlock): OriginalTextEdit => ({
    text: block.text,
    fontSize: block.fontSize,
    fontFamily: block.fontFamily || 'Helvetica',
    color: block.color || UNKNOWN_SOURCE_TEXT_COLOR,
    bold: false,
    italic: false,
    underline: false,
    align: 'left',
    lineHeight: 1.15,
    backgroundColor: 'transparent',
  });

  const ensureOriginalTextEdit = useCallback((block: TextBlock) => {
    const key = textBlockKey(block.page, block.index);
    const existing = originalTextEditsRef.current.get(key);
    if (existing) return existing;
    const created = makeDefaultOriginalTextEdit(block);
    originalTextEditsRef.current.set(key, created);
    return created;
  }, []);

  const serializeDocumentSnapshot = useCallback(() => {
    const textEdits: Record<string, OriginalTextEdit> = {};
    originalTextEditsRef.current.forEach((value, key) => { textEdits[key] = value; });
    const canvasStates: Record<string, FabricCanvasState> = {};
    pageCanvasStatesRef.current.forEach((value, page) => { canvasStates[String(page)] = value; });
    return JSON.stringify({
      pageSize: pageSizeRef.current,
      textEdits,
      canvasStates,
      pagePlan: pageSessionRef.current?.plan ?? null,
      redactionMarks: redactionMarksRef.current,
      annotations: annotationsRef.current,
    } satisfies EditorDocumentSnapshot);
  }, []);

  const requestProcessingConsent = useCallback((purpose: PdfEditorProcessingPurpose) => {
    const file = currentFileRef.current;
    if (!file || isResettingSessionRef.current) return;
    const request = processingConsentRef.current.request(documentSessionRef.current, file.name, purpose);
    if (request) setState(prev => ({ ...prev, processingRequest: request }));
  }, []);

  const confirmProcessingConsent = useCallback((request: PdfEditorProcessingRequest) => {
    if (!currentFileRef.current || !processingConsentRef.current.approve(request, documentSessionRef.current)) return false;
    // Privacy permission does not modify any revision-bound fidelity/redaction grants.
    setState(prev => ({ ...prev, processingAllowed: true, processingRequest: null, editVersion: prev.editVersion + 1 }));
    return true;
  }, []);

  const cancelProcessingConsent = useCallback((request: PdfEditorProcessingRequest) => {
    if (processingConsentRef.current.cancel(request)) setState(prev => ({ ...prev, processingRequest: null }));
  }, []);

  const getExportRevision = useCallback(() => {
    const snapshot = JSON.parse(serializeDocumentSnapshot()) as EditorDocumentSnapshot;
    // Mounting or visiting an empty canvas is navigation, not a document edit.
    snapshot.canvasStates = Object.fromEntries(Object.entries(snapshot.canvasStates)
      .filter(([, canvas]) => countFabricCanvasObjects([canvas]) > 0));
    return `${documentSessionRef.current}:${JSON.stringify(snapshot)}`;
  }, [serializeDocumentSnapshot]);

  const resetDocumentHistory = useCallback(() => {
    const history = createDocumentHistory(serializeDocumentSnapshot());
    documentHistoryRef.current = history.entries;
    documentHistoryIndexRef.current = history.index;
  }, [serializeDocumentSnapshot]);

  const recordDocumentHistory = useCallback((coalesceKey?: string) => {
    if (restoringDocumentHistoryRef.current || isResettingSessionRef.current) return false;
    const result = appendBoundedDocumentHistory(
      documentHistoryRef.current,
      documentHistoryIndexRef.current,
      serializeDocumentSnapshot(),
      { coalesceKey },
    );
    if (!result.changed) return false;
    documentHistoryRef.current = result.entries;
    documentHistoryIndexRef.current = result.index;
    setState(prev => ({
      ...prev,
      historyIndex: result.index,
      canUndo: result.index > 0,
      canRedo: false,
    }));
    return true;
  }, [serializeDocumentSnapshot]);

  const snapshotFabricPage = useCallback((page: number) => {
    const fc = fabricRefs.current.get(page);
    if (!fc || restoringPagesRef.current.has(page) || failedRestorePagesRef.current.has(page) || isResettingSessionRef.current) return;
    try {
      if (!isFabricCanvasUsable(fc)) {
        fabricRefs.current.delete(page);
        return;
      }
      const activeObject = fc.getActiveObject?.();
      if (activeObject?.isEditing && typeof activeObject.exitEditing === 'function') {
        activeObject.exitEditing();
      }
      fc.renderAll?.();

      const stateJson = fc.toJSON(FABRIC_SERIALIZED_PROPS);
      pageCanvasStatesRef.current.set(page, stateJson);
    } catch (error) {
      console.warn('Failed to snapshot fabric page', error);
    }
  }, []);

  const snapshotAllFabricPages = useCallback(() => {
    Array.from(fabricRefs.current.keys()).forEach(snapshotFabricPage);
  }, [snapshotFabricPage]);

  const unregisterFabricCanvas = useCallback((page: number) => {
    snapshotFabricPage(page);
    fabricRefs.current.delete(page);
    restoringPagesRef.current.delete(page);
    setState(prev => ({ ...prev, isRestoringCanvas: restoringPagesRef.current.size > 0 }));
  }, [snapshotFabricPage]);

  const loadFabricState = useCallback(async (page: number, fc: FabricCanvasLike, savedState: FabricCanvasState) => {
    if (!isFabricCanvasUsable(fc)) return false;
    const session = documentSessionRef.current;
    const token = Symbol('fabric-restore');
    const isCurrent = () => session === documentSessionRef.current
      && fabricRefs.current.get(page) === fc && restoringPagesRef.current.get(page) === token
      && isFabricCanvasUsable(fc);
    restoringPagesRef.current.set(page, token);
    failedRestorePagesRef.current.delete(page);
    setState(prev => ({ ...prev, isRestoringCanvas: true }));
    const pointerEvents = fc.upperCanvasEl?.style.pointerEvents ?? '';
    if (fc.upperCanvasEl) fc.upperCanvasEl.style.pointerEvents = 'none';
    fc.discardActiveObject?.();
    try {
      const fabric = window.__fabric__;
      if (!fabric || !fc.clear) throw new Error('The canvas engine is unavailable for restoring this page.');
      return await restorePdfEditorFabricCanvas(savedState, FABRIC_SERIALIZED_PROPS, {
        createCanvas: () => new fabric.StaticCanvas(document.createElement('canvas'), {
          width: 1, height: 1, backgroundColor: 'transparent', renderOnAddRemove: false,
        }),
        isCurrent,
        commit: (staged) => {
          const objects = staged.getObjects().slice();
          objects.forEach(object => staged.remove(object));
          const decoration = {
            backgroundColor: staged.backgroundColor,
            overlayColor: staged.overlayColor,
            backgroundImage: staged.backgroundImage,
            overlayImage: staged.overlayImage,
            clipPath: staged.clipPath,
          };
          // V5 dispose destroys images still owned by staging. Transfer ownership,
          // not serialized URLs, so no second asynchronous load can race this one.
          staged.backgroundImage = staged.overlayImage = staged.clipPath = null;
          fc.clear!();
          Object.assign(fc, decoration);
          decoration.backgroundImage?.set('canvas', fc);
          decoration.overlayImage?.set('canvas', fc);
          const restoreFlags = (object: FabricObjectLike) => {
            // Older v2/v3 drafts stored the semantic flag but not Fabric's locks.
            if (object.peLocked) object.set({ lockMovementX: true, lockMovementY: true, lockScalingX: true, lockScalingY: true, lockRotation: true, hasControls: false });
            if (object.peHidden || object.visible === false) object.set({ visible: false, selectable: false, evented: false });
            object.getObjects?.().forEach(restoreFlags);
          };
          objects.forEach(object => { restoreFlags(object); fc.add(object); });
          fc.renderAll();
          pageCanvasStatesRef.current.set(page, fc.toJSON(FABRIC_SERIALIZED_PROPS));
        },
      });
    } catch (error) {
      if (!isCurrent()) return false;
      const message = `Page ${page} could not be restored. ${error instanceof Error ? error.message : 'Reopen the page to retry.'}`;
      failedRestorePagesRef.current.set(page, message);
      setState(prev => ({ ...prev, saveStatus: 'error', saveMessage: message }));
      throw error;
    } finally {
      if (restoringPagesRef.current.get(page) === token) {
        if (isCurrent() && !failedRestorePagesRef.current.has(page) && fc.upperCanvasEl) {
          fc.upperCanvasEl.style.pointerEvents = pointerEvents;
        }
        restoringPagesRef.current.delete(page);
        setState(prev => ({ ...prev, isRestoringCanvas: restoringPagesRef.current.size > 0 }));
      }
    }
  }, []);

  const getPageBaseDims = useCallback(async (page: number) => {
    const cached = pageBaseDimsRef.current.get(page);
    if (cached?.width && cached?.height) return cached;

    const pdfDoc = getPdfDocOrNull();
    if (!pdfDoc) return null;

    const pdfPage = await pdfDoc.getPage(page);
    if (pdfDocRef.current !== pdfDoc) return null;
    const viewport = pdfPage.getViewport({ scale: 1 });
    const dims = { width: viewport.width, height: viewport.height };
    if (pdfDocRef.current === pdfDoc) pageBaseDimsRef.current.set(page, dims);
    return dims;
  }, []);

  const getTargetPageSize = useCallback(async (page: number, pageSize: PageSizeKey) => {
    const baseDims = await getPageBaseDims(page);
    if (!baseDims) return null;
    if (pageSize === 'original') return baseDims;
    return PAGE_SIZE_PRESETS[pageSize];
  }, [getPageBaseDims]);
  
  const buildDraft = useCallback((savedAt = Date.now()): PdfEditorDraft | null => {
    const documentId = documentIdRef.current;
    const file = currentFileRef.current;
    if (!documentId || !file) return null;

    const textEdits: Record<string, OriginalTextEdit> = {};
    originalTextEditsRef.current.forEach((value, key) => { textEdits[key] = value; });
    const canvasStates: Record<string, FabricCanvasState> = {};
    pageCanvasStatesRef.current.forEach((value, page) => { canvasStates[String(page)] = value; });
    const session = pageSessionRef.current;
    return {
      version: 3,
      documentId,
      fileName: file.name,
      fileSize: file.size,
      fileLastModified: file.lastModified,
      savedAt,
      pageSize: pageSizeRef.current,
      textEdits,
      canvasStates,
      redactionMarks: [...redactionMarksRef.current],
      annotations: [...annotationsRef.current],
      ...(session ? { pagePlan: serializePdfEditorPagePlan(session.plan) } : {}),
    };
  }, []);

  const persistDraft = useCallback(async (revision: number) => {
    if (restoringPagesRef.current.size > 0 || failedRestorePagesRef.current.size > 0) return false;
    const currentDraft = buildDraft();
    const draft = currentDraft ? structuredClone(currentDraft) : null;
    const file = currentFileRef.current;
    const session = documentSessionRef.current;
    if (!draft || !file || typeof window === 'undefined') return false;

    const queuedSave = saveQueueRef.current.save(async (ownsRecovery) => {
      if (session !== documentSessionRef.current || restoringPagesRef.current.size > 0 || failedRestorePagesRef.current.size > 0) return false;
      try {
        setState(prev => ({ ...prev, saveStatus: 'saving', saveMessage: null }));
        let result = await savePdfEditorDraftAsync(draft, sourceStoredRef.current ? undefined : file, ownsRecovery);
        if (!ownsRecovery() || session !== documentSessionRef.current || restoringPagesRef.current.size > 0 || failedRestorePagesRef.current.size > 0) return false;
        if (result.ok) {
          sourceStoredRef.current = true;
          try { window.localStorage.removeItem(`smilepdf:editor:draft:v2:${draft.documentId}`); } catch {}
        } else {
          result = savePdfEditorDraft(window.localStorage, draft);
        }
        if (!result.ok) {
          setState(prev => ({
            ...prev,
            saveStatus: 'error',
            saveMessage: result.message,
          }));
          return false;
        }
        persistedRevisionRef.current = Math.max(persistedRevisionRef.current, revision);
        const hasNewerChanges = saveRevisionRef.current > persistedRevisionRef.current;
        setState(prev => ({
          ...prev,
          saveStatus: hasNewerChanges ? 'idle' : 'saved',
          saveMessage: sourceStoredRef.current ? null : 'Draft saved without the source PDF. Reselect the original PDF to recover it after closing.',
          recoverySourceStored: sourceStoredRef.current,
          lastSavedAt: result.savedAt,
        }));
        return true;
      } catch (e) {
        if (!ownsRecovery() || session !== documentSessionRef.current) return false;
        console.warn('saveEditsToStorage failed', e);
        setState(prev => ({
          ...prev,
          saveStatus: 'error',
          saveMessage: 'This browser could not save the local draft.',
        }));
        return false;
      }
    });
    return queuedSave;
  }, [buildDraft]);

  const scheduleAutosave = useCallback(() => {
    if (!documentIdRef.current || restoringPagesRef.current.size > 0 || failedRestorePagesRef.current.size > 0) return;
    const revision = ++saveRevisionRef.current;
    if (autosaveTimerRef.current) clearTimeout(autosaveTimerRef.current);
    if (!saveQueueRef.current.isEnabled()) {
      autosaveTimerRef.current = null;
      setState(prev => ({ ...prev, saveStatus: 'idle' }));
      return;
    }
    setState(prev => ({ ...prev, saveStatus: 'idle', saveMessage: null }));
    autosaveTimerRef.current = setTimeout(() => {
      autosaveTimerRef.current = null;
      void persistDraft(revision);
    }, 600);
  }, [persistDraft]);

  const flushAutosave = useCallback(async () => {
    if (!saveQueueRef.current.isEnabled()) return false;
    if (!documentIdRef.current || saveRevisionRef.current <= persistedRevisionRef.current) return true;
    if (autosaveTimerRef.current) {
      clearTimeout(autosaveTimerRef.current);
      autosaveTimerRef.current = null;
    }
    return persistDraft(saveRevisionRef.current);
  }, [persistDraft]);

  const clearCurrentRecovery = useCallback(async (expectedSession: number) => {
    const documentId = documentIdRef.current;
    if (!documentId || expectedSession !== documentSessionRef.current) return false;
    if (autosaveTimerRef.current) clearTimeout(autosaveTimerRef.current);
    autosaveTimerRef.current = null;
    persistedRevisionRef.current = 0;
    setState(prev => ({ ...prev, recoveryStatus: 'clearing', recoveryMessage: 'Removing this PDF\'s stored recovery data. Current work stays open.', saveStatus: 'idle' }));
    const result = await saveQueueRef.current.clear(() => deletePdfEditorRecovery(documentId, () => window.localStorage));
    if (expectedSession !== documentSessionRef.current) return result.ok;
    sourceStoredRef.current = false;
    setState(prev => ({
      ...prev, recoveryStatus: result.ok ? 'disabled' : 'error', recoverySourceStored: false, lastSavedAt: null,
      recoveryMessage: result.ok
        ? 'Recovery removed and disabled for this open PDF. Current work stays in this tab; export it before closing. Other PDFs and the object clipboard are unchanged.'
        : result.message,
    }));
    return result.ok;
  }, []);

  useEffect(() => {
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      if (saveRevisionRef.current <= persistedRevisionRef.current) return;
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
      if (autosaveTimerRef.current) clearTimeout(autosaveTimerRef.current);
    };
  }, []);

  const applyDraft = useCallback((draft: PdfEditorDraft) => {
    originalTextEditsRef.current = new Map(Object.entries(draft.textEdits));
    pageCanvasStatesRef.current = new Map(
      Object.entries(draft.canvasStates)
        .map(([page, canvasState]) => [Number(page), canvasState] as const)
        .filter(([page]) => Number.isInteger(page) && page > 0),
    );
    pageSizeRef.current = draft.pageSize;
    redactionMarksRef.current = [...(draft.redactionMarks ?? [])];
    annotationsRef.current = [...(draft.annotations ?? [])];
  }, []);

  const restoreDraftFromStorage = useCallback(async (file: File, documentId: string) => {
    try {
      if (typeof window === 'undefined') return null;
      const draft = await loadPdfEditorDraftAsync(documentId, window.localStorage)
        ?? migrateLegacyPdfEditorDraft(window.localStorage, file, documentId);
      if (!draft) return null;
      return draft;
    } catch (e) {
      console.warn('restoreDraftFromStorage failed', e);
      return null;
    }
  }, []);

  const setPageSize = useCallback((pageSize: PageSizeKey) => {
    if (pageSizeRef.current === pageSize) return;
    if (pageSize !== 'original' && annotationsRef.current.length > 0) {
      return;
    }
    pageSizeRef.current = pageSize;
    setState(prev => ({ ...prev, pageSize, editVersion: prev.editVersion + 1 }));
    recordDocumentHistory('page-size');
    scheduleAutosave();
  }, [recordDocumentHistory, scheduleAutosave]);

  /**
   * Page operations are document edits: they update the single page session,
   * join the unified undo history, bump `editVersion` (so the export preview
   * rebuilds) and schedule autosave. Rejected or no-op operations touch nothing.
   */
  const applyPageOperation = useCallback((operation: PdfEditorPageOperation) => {
    const session = pageSessionRef.current;
    if (!session) {
      return { ok: false as const, reason: 'page-out-of-range' as PdfEditorPagePlanError };
    }
    const result = applyPdfEditorPageSessionOperation(session, operation);
    if (!result.ok) return { ok: false as const, reason: result.reason };
    if (!result.changed) return { ok: true as const, changed: false };

    if (operation.type === 'rotate') {
      for (const annotation of annotationsRef.current) {
        const entries = result.session.plan.entries;
        if (!entries.some(entry => entry.sourcePage === annotation.page)) continue;
        const message = pdfEditorAnnotationBlocker({ page: annotation.page, pageSize: pageSizeRef.current, sourceRotation: sourcePageRotationsRef.current[annotation.page], entries });
        if (message) return { ok: false as const, reason: 'annotations-incompatible', message };
      }
    }

    pageSessionRef.current = result.session;
    const pageCount = result.session.plan.entries.length;
    setState(prev => ({
      ...prev,
      pagePlan: result.session.plan,
      totalPages: pageCount,
      currentPage: Math.min(prev.currentPage, pageCount),
      editVersion: prev.editVersion + 1,
    }));
    recordDocumentHistory('page-plan');
    scheduleAutosave();
    return { ok: true as const, changed: true };
  }, [recordDocumentHistory, scheduleAutosave]);

  /** First output position showing a source page, or 0 when the page was deleted. */
  const positionForSourcePage = useCallback((sourcePage: number) => {
    const index = pageSessionRef.current?.plan.entries.findIndex(entry => entry.sourcePage === sourcePage) ?? -1;
    return index >= 0 ? index + 1 : 0;
  }, []);
  

  // -- Load PDF -----------------------------------------------

  const loadPdf = useCallback(async (file: File) => {
    const session = ++documentSessionRef.current;
    processingConsentRef.current.reset(session);
    saveQueueRef.current.reset();
    ocrControllerRef.current?.abort();
    ocrControllerRef.current = null;
    ocrCopyRequestRef.current = null;
    sourcePageRotationsRef.current = {};
    const previousDoc = pdfDocRef.current as PdfJsDocumentLike | null;
    pdfDocRef.current = null;
    void previousDoc?.destroy().catch(() => {});
    serverBuildsRef.current.forEach(controller => controller.abort());
    serverBuildsRef.current.clear();
    exportBuildCacheRef.current.clear();
    textConsentRef.current = null;
    pageApprovalRevisionRef.current = null;
    const metadataFailure = validatePdfFileMetadata(file);
    if (metadataFailure) {
      currentFileRef.current = null;
      pdfDocRef.current = null;
      set({ pdfFile: null, isLoading: false, loadError: metadataFailure.message, loadFailure: metadataFailure });
      return false;
    }
    if (autosaveTimerRef.current) {
      clearTimeout(autosaveTimerRef.current);
      autosaveTimerRef.current = null;
    }
    saveRevisionRef.current = 0;
    persistedRevisionRef.current = 0;
    sourceStoredRef.current = false;
    // Keep the queue ordered across documents; stale queued work checks its session.
    isResettingSessionRef.current = true;
    fabricRefs.current.forEach((canvas) => {
      try {
        if (!isFabricCanvasUsable(canvas)) return;
        canvas?.discardActiveObject?.();
        canvas?.clear?.();
        canvas?.requestRenderAll?.();
        canvas?.renderAll?.();
      } catch (error) {
        console.warn('Failed to clear fabric canvas during reset', error);
      }
    });
    pageCanvasStatesRef.current.clear();
    pageDimsRef.current.clear();
    pageBaseDimsRef.current.clear();
    restoringPagesRef.current.clear();
    failedRestorePagesRef.current.clear();
    restoringDocumentHistoryRef.current = false;
    clipboardRequestRef.current += 1;
    documentHistoryRef.current = [];
    documentHistoryIndexRef.current = -1;
    pageSessionRef.current = null;
    fabricRefs.current.forEach((canvas, page) => {
      try {
        if (!isFabricCanvasUsable(canvas)) {
          fabricRefs.current.delete(page);
          return;
        }
        const emptyState = canvas.toJSON?.(['selectable', 'editable']);
        if (!emptyState) return;
        pageCanvasStatesRef.current.set(page, emptyState);
      } catch (error) {
        console.warn('Failed to reset fabric history', error);
      }
    });
    renderTaskRef.current.forEach((task) => {
      try { task?.cancel?.(); } catch {}
    });
    renderTaskRef.current.clear();
    renderQueueRef.current.clear();
    originalTextEditsRef.current.clear();
    redactionMarksRef.current = [];
    annotationsRef.current = [];
    documentIdRef.current = null;
    currentFileRef.current = file;
    pageSizeRef.current = 'original';
    zoomRef.current = 1;
    selectedOriginalTextKeyRef.current = null;
    activeObjRef.current = null;
    pdfDocRef.current = null;
    setState(prev => ({
      ...prev,
      pdfFile: file,
      documentSession: session,
      processingAllowed: false,
      processingRequest: null,
      isServerProcessing: false,
      isOcrProcessing: false,
      ocrMessage: null,
      ocrFailed: false,
      recoveryStatus: 'enabled',
      recoveryMessage: null,
      recoverySourceStored: false,
      sourcePageRotations: {},
      totalPages: 0,
      sourcePageCount: 0,
      currentPage: 1,
      zoom: 1.0,
      activeTool: 'select',
      pageSize: 'original',
      textStyle: DEFAULT_TEXT_STYLE,
      selectedObjectKind: 'none',
      selectedObjectGeometry: null,
      selectedObjectLocked: false,
      selectedObjectHidden: false,
      selectedObjectCount: 0,
      hasObjectClipboard: objectClipboardRef.current !== null,
      selectedObjectStyle: null,
      pageLayers: [],
      pagePlan: null,
      historyIndex: -1,
      canUndo: false,
      canRedo: false,
      isLoading: true,
      isRestoringCanvas: false,
      isExporting: false,
      loadError: null,
      loadFailure: null,
      preflightStatus: 'scanning',
      preflightReport: null,
      lastExportVerification: null,
      lastExportDisclosures: [],
      grantedTextEditConsent: null,
      saveStatus: 'idle',
      saveMessage: null,
      lastSavedAt: null,
      editVersion: 0,
      selectedOriginalTextKey: null,
      redactionMarks: [],
      annotations: [],
      annotationKind: 'highlight',
      annotationStyle: {
        color: pdfEditorAnnotationDefaultColor('highlight'),
        author: PDF_EDITOR_DEFAULT_ANNOTATION_AUTHOR,
        stamp: PDF_EDITOR_DEFAULT_STAMP,
        uri: '',
      },
      selectedAnnotationId: null,
      snapGuides: [],
    }));

    try {
      const pdfjsLib = await import('pdfjs-dist');
      // Use the worker bundled with pdfjs-dist to keep API/worker versions aligned.
      pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
        'pdfjs-dist/build/pdf.worker.min.mjs',
        import.meta.url,
      ).toString();

      const buffer = await file.arrayBuffer();
      if (session !== documentSessionRef.current) return false;
      const data = new Uint8Array(buffer);
      if (!hasPdfSignature(data)) {
        throw Object.assign(new Error('The file does not contain a PDF signature.'), { name: 'InvalidPDFException' });
      }
      const documentId = await createPdfDocumentId(file, buffer);
      if (session !== documentSessionRef.current) return false;
      documentIdRef.current = documentId;

      let pdfDoc: unknown;
      try {
        // PDF.js transfers the supplied buffer to its worker. Keep the canonical
        // source bytes owned by the editor for preflight, recovery, and export.
        pdfDoc = await pdfjsLib.getDocument({ data: data.slice() }).promise;
      } catch (workerError) {
        if (session !== documentSessionRef.current) return false;
        if (classifyPdfLoadFailure(workerError).code !== 'load-failed') throw workerError;
        // Fallback for environments where worker loading is blocked.
        const fallbackOptions = {
          data: new Uint8Array(buffer.slice(0)),
          disableWorker: true,
        } as { data: Uint8Array; disableWorker: true };
        pdfDoc = await pdfjsLib.getDocument(fallbackOptions).promise;
      }

      const loadedDoc = pdfDoc as PdfJsDocumentLike;
      if (session !== documentSessionRef.current) {
        await loadedDoc.destroy().catch(() => {});
        return false;
      }
      const pageCountFailure = validatePdfPageCount(loadedDoc.numPages);
      if (pageCountFailure) {
        await loadedDoc.destroy().catch(() => {});
        if (session !== documentSessionRef.current) return false;
        set({ pdfFile: null, totalPages: 0, sourcePageCount: 0, pagePlan: null, isLoading: false, loadError: pageCountFailure.message, loadFailure: pageCountFailure });
        currentFileRef.current = null;
        documentIdRef.current = null;
        pdfDocRef.current = null;
        pageSessionRef.current = null;
        isResettingSessionRef.current = false;
        return false;
      }
      pdfDocRef.current = loadedDoc;
      let preflightReport: PdfDocumentPreflight | null = null;
      try {
        preflightReport = await scanPdfDocumentPreflight(loadedDoc, scanPdfSourceSignals(buffer));
      } catch (preflightError) {
        console.warn('PDF preflight inspection could not be completed.', preflightError);
      }
      const sourcePageRotations: Record<number, number> = {};
      for (let page = 1; page <= loadedDoc.numPages; page += 1) {
        if (session !== documentSessionRef.current) return false;
        try { sourcePageRotations[page] = (await loadedDoc.getPage(page)).rotate ?? 0; } catch { /* Unknown pages refuse annotation placement. */ }
      }
      const draft = await restoreDraftFromStorage(file, documentId);
      if (session !== documentSessionRef.current) return false;
      sourcePageRotationsRef.current = sourcePageRotations;
      if (draft) applyDraft(draft);
      // Draft v3 carries the page plan. A v2 draft has none, so it restores as
      // an identity plan; a plan that no longer matches the source page count
      // is rejected by the strict deserializer and also falls back to identity.
      pageSessionRef.current = draft?.pagePlan
        ? restorePdfEditorPageSession(draft.pagePlan, loadedDoc.numPages)
        : createPdfEditorPageSession(loadedDoc.numPages);
      const restoredPageCount = pageSessionRef.current?.plan.entries.length ?? loadedDoc.numPages;
      resetDocumentHistory();
      isResettingSessionRef.current = false;
      set({
        sourcePageCount: loadedDoc.numPages,
        totalPages: restoredPageCount,
        currentPage: 1,
        pagePlan: pageSessionRef.current?.plan ?? null,
        isLoading: false,
        pageSize: draft?.pageSize ?? 'original',
        saveStatus: draft ? 'saved' : 'idle',
        lastSavedAt: draft?.savedAt ?? null,
        editVersion: draft ? 1 : 0,
        historyIndex: 0,
        canUndo: false,
        canRedo: false,
        preflightStatus: preflightReport?.status === 'complete' ? 'ready' : 'partial',
        preflightReport,
        sourcePageRotations,
        redactionMarks: [...redactionMarksRef.current],
        annotations: [...annotationsRef.current],
      });
      if (draft) scheduleAutosave();
      return true;
    } catch (e: unknown) {
      if (session !== documentSessionRef.current) return false;
      const loadFailure = classifyPdfLoadFailure(e);
      isResettingSessionRef.current = false;
      currentFileRef.current = null;
      documentIdRef.current = null;
      pageSessionRef.current = null;
      set({
        pdfFile: null,
        totalPages: 0,
        sourcePageCount: 0,
        pagePlan: null,
        isLoading: false,
        loadError: loadFailure.message,
        loadFailure,
        preflightStatus: 'idle',
        preflightReport: null,
      });
      return false;
    }
  }, [applyDraft, resetDocumentHistory, restoreDraftFromStorage, scheduleAutosave, set]);

  const getRecoverableSession = useCallback(async () => {
    return loadRecoverablePdfEditorSession();
  }, []);

  const restoreRecoverableSession = useCallback(async () => {
    const generation = documentSessionRef.current;
    const session = await loadRecoverablePdfEditorSession();
    if (!session || generation !== documentSessionRef.current) return false;
    const file = new File([session.source], session.fileName, {
      type: session.fileType || 'application/pdf',
      lastModified: session.fileLastModified,
    });
    return loadPdf(file);
  }, [loadPdf]);

  // -- Register a Fabric canvas for a page -------------------

  const syncStyleFromObject = useCallback((obj: FabricObjectLike | null | undefined) => {
    if (!obj) return;
    if (obj.type === 'i-text' || obj.type === 'textbox') {
      set({
        textStyle: {
          fontFamily: obj.fontFamily || 'Helvetica',
          fontSize:   obj.fontSize   || 12,
          bold:       obj.fontWeight === 'bold',
          italic:     obj.fontStyle  === 'italic',
          underline:  obj.underline  || false,
          color:      obj.fill       || '#000000',
          bgColor:    obj.backgroundColor || 'transparent',
          heading:    'body',
          lineHeight: obj.lineHeight  || 1.4,
          align:      (obj.textAlign  || 'left') as TextStyle['align'],
        },
      });
    }
  }, []);

  /**
   * Mirror the current page's objects into panel state.
   *
   * Ids are assigned here, once, and persisted with the object so a layer row
   * keeps pointing at the same shape after undo, zoom or reload. The list is
   * topmost-first because that is the order a layers panel must show.
   */
  const syncPageLayers = useCallback((fc: FabricCanvasLike | null | undefined) => {
    if (!fc?.getObjects) return;
    const objects = fc.getObjects();
    const selected = new Set(fc.getActiveObjects?.() ?? (fc.getActiveObject() ? [fc.getActiveObject() as FabricObjectLike] : []));
    const layers: PdfEditorLayer[] = objects.map((object, index) => {
      if (!object.peId) {
        object.set('peId', createPdfEditorObjectId(Date.now() + objectSeqRef.current));
        objectSeqRef.current += 1;
      }
      const kind = objectLayerKind(object);
      return {
        id: object.peId as string,
        name: object.peName || pdfEditorLayerName(kind, index),
        kind,
        locked: object.peLocked === true,
        hidden: object.visible === false || object.peHidden === true,
        selected: selected.has(object),
      };
    }).reverse();
    setState(prev => (
      JSON.stringify(prev.pageLayers) === JSON.stringify(layers)
        ? prev
        : { ...prev, pageLayers: layers }
    ));
  }, []);

  const syncSelectionState = useCallback((selected: FabricObjectLike[]) => {
    const active = selected[0] ?? null;
    activeObjRef.current = active;
    syncStyleFromObject(active);
    const kind = selectedObjectKind(active);
    const geometry = active ? readObjectGeometry(active) : null;
    setState(prev => ({
      ...prev,
      selectedObjectKind: kind,
      selectedObjectGeometry: geometry,
      selectedObjectLocked: active ? active.peLocked === true : false,
      selectedObjectHidden: active ? (active.visible === false || active.peHidden === true) : false,
      selectedObjectCount: selected.length,
      selectedObjectStyle: active ? readObjectStyle(active) : null,
    }));
  }, [syncStyleFromObject]);

  const registerFabricCanvas = useCallback(async (page: number, fc: FabricCanvasLike) => {
    fabricRefs.current.set(page, fc);
    const session = documentSessionRef.current;
    const ownsCanvas = () => session === documentSessionRef.current && fabricRefs.current.get(page) === fc;
    const canEdit = () => ownsCanvas() && !restoringPagesRef.current.has(page)
      && !failedRestorePagesRef.current.has(page) && !isResettingSessionRef.current;
    syncSelectionState([]);

    const snapshot = (coalesceKey?: string) => {
      if (!canEdit()) return;

      const stateJson = snapshotPdfEditorFabricCanvas(fc, FABRIC_SERIALIZED_PROPS);
      pageCanvasStatesRef.current.set(page, stateJson);
      if (!recordDocumentHistory(coalesceKey)) return;
      setState(prev => ({
        ...prev,
        editVersion: prev.editVersion + 1,
      }));
      scheduleAutosave();
    };

    fc.on('object:added', (event) => {
      if (!ownsCanvas()) return;
      const added = (event as { target?: FabricObjectLike })?.target;
      if (added) {
        if (!added.peId) {
          added.set('peId', createPdfEditorObjectId(Date.now() + objectSeqRef.current));
          objectSeqRef.current += 1;
        }
        const kind = objectLayerKind(added);
        if (!added.peName) {
          const topIndex = Math.max(0, (fc.getObjects?.().length ?? 1) - 1);
          added.set('peName', pdfEditorLayerName(kind, topIndex));
        }
      }
      snapshot();
      if (canEdit()) syncPageLayers(fc);
    });
    fc.on('object:moving', (event) => {
      if (!canEdit()) return;
      const payload = event as { target?: FabricObjectLike; e?: { altKey?: boolean } };
      const target = payload.target;
      if (!target) return;
      const clearGuides = () => setState(prev => (
        prev.snapGuides.length === 0 ? prev : { ...prev, snapGuides: [] }
      ));
      // Alt is the documented snap bypass. Holding it must also hide the lines,
      // or the overlay would claim an alignment the object is not on.
      if (payload.e?.altKey) {
        clearGuides();
        return;
      }

      const zoom = zoomRef.current > 0 ? zoomRef.current : 1;
      const base = pageBaseDimsRef.current.get(page) ?? (
        typeof fc.width === 'number' && typeof fc.height === 'number' && fc.width > 0 && fc.height > 0
          ? { width: fc.width / zoom, height: fc.height / zoom }
          : null
      );
      if (!base) return;

      const current = readObjectGeometry(target);
      const objects = (fc.getObjects?.() ?? [])
        .filter(candidate => candidate !== target && candidate.visible !== false)
        .map((candidate, index) => ({
          id: candidate.peId ?? `snap-${page}-${index}`,
          geometry: readObjectGeometry(candidate),
        }));
      const snapped = snapPdfEditorObjectGeometry({
        geometry: current,
        bounds: base,
        objects,
        movingId: target.peId,
      });

      if (geometryChanged(current, snapped.geometry)) {
        target.set({
          left: snapped.geometry.x,
          top: snapped.geometry.y,
        });
        target.setCoords?.();
      }
      setState(prev => (
        JSON.stringify(prev.snapGuides) === JSON.stringify(snapped.guides)
          ? prev
          : { ...prev, snapGuides: snapped.guides }
      ));
    });
    fc.on('object:modified', () => {
      if (!canEdit()) return;
      snapshot();
      syncSelectionState(fc.getActiveObjects?.() ?? []);
      syncPageLayers(fc);
      setState(prev => (
        prev.snapGuides.length === 0 ? prev : { ...prev, snapGuides: [] }
      ));
    });
    fc.on('mouse:up', () => {
      if (!canEdit()) return;
      setState(prev => (
        prev.snapGuides.length === 0 ? prev : { ...prev, snapGuides: [] }
      ));
    });
    fc.on('object:removed',  () => {
      if (!canEdit()) return;
      snapshot();
      syncPageLayers(fc);
    });
    fc.on('text:changed', event => {
      const object = (event as { target?: FabricObjectLike })?.target;
      snapshot(`fabric:${page}:text:${object?.peId ?? 'active'}`);
    });
    fc.on('path:created', () => snapshot());

    // Track active object to sync properties panel
    fc.on('selection:created', (e: unknown) => {
      if (!canEdit()) return;
      const selected = (e as { selected?: FabricObjectLike[] | null })?.selected ?? [];
      syncSelectionState(fc.getActiveObjects?.() ?? selected);
      syncPageLayers(fc);
    });
    fc.on('selection:updated', (e: unknown) => {
      if (!canEdit()) return;
      const selected = (e as { selected?: FabricObjectLike[] | null })?.selected ?? [];
      // V5 reports only the selection delta here, not the full multi-selection.
      syncSelectionState(fc.getActiveObjects?.() ?? selected);
      syncPageLayers(fc);
    });
    fc.on('selection:cleared', () => {
      if (!canEdit()) return;
      syncSelectionState([]);
      syncPageLayers(fc);
    });

    const latestSnapshot = pageCanvasStatesRef.current.get(page);
    if (latestSnapshot) {
      try {
        if (!await loadFabricState(page, fc, latestSnapshot) || !ownsCanvas()) return false;
      } catch (error) {
        console.warn('Failed to restore fabric state', error);
        return false;
      }
    } else {
      const emptyState = fc.toJSON(FABRIC_SERIALIZED_PROPS);
      pageCanvasStatesRef.current.set(page, emptyState);
    }
    if (!ownsCanvas()) return false;
    syncPageLayers(fc);
    return true;
  }, [loadFabricState, recordDocumentHistory, scheduleAutosave, syncPageLayers, syncSelectionState]);

  // -- Device pixel ratio: re-sharpen when the environment moves ----------
  //
  // `currentDevicePixelRatio()` is read fresh on every render call, so a frame
  // drawn after a move is already sharp. But nothing *listens*: move the window
  // to a screen with a different density (or change the browser zoom) and the
  // page on screen keeps the soft raster it was drawn at until some other
  // interaction happens to re-render it. The resolution media query is the
  // browser's own announcement that the ratio changed; each announcement is
  // one lick of the counter below, and the counter is `renderPage`'s identity,
  // which is what re-runs every mounted page's render effect.

  /** A ratio change can arrive as a short burst of media-query round trips. */
  const PDF_EDITOR_DPR_CHANGE_DEBOUNCE_MS = 150;

  const [dprEpoch, setDprEpoch] = useState(0);

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return undefined;
    }
    let mq = window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
    let timer: number | undefined;
    const rebind = () => {
      // Drop the old query — it later fires `change` with the value it was
      // created for — and watch the ratio the device now reports.
      mq.removeEventListener('change', rebind);
      mq = window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
      mq.addEventListener('change', rebind);
      window.clearTimeout(timer);
      timer = window.setTimeout(() => setDprEpoch(epoch => epoch + 1), PDF_EDITOR_DPR_CHANGE_DEBOUNCE_MS);
    };
    mq.addEventListener('change', rebind);
    return () => {
      mq.removeEventListener('change', rebind);
      window.clearTimeout(timer);
    };
  }, []);

  // -- Render one PDF page onto a <canvas> element ----------

  const renderPage = useCallback(async (
    page: number,
    canvas: HTMLCanvasElement,
    zoom: number,
    /**
     * Overriding the budget is what the settle pass buys sharpness with: a
     * page whose interaction-budget raster fell below the device's own ratio
     * re-renders once at the raised budget after the interaction calms down.
     * Ordinary callers never pass this — the default budget is the whole
     * pipeline's.
     */
    pixelBudget: number | undefined = undefined,
  ) => {
    const session = documentSessionRef.current;
    const pdfDoc = getPdfDocOrNull();
    const isCurrent = () => session === documentSessionRef.current && pdfDocRef.current === pdfDoc;
    const previous = renderQueueRef.current.get(page) ?? Promise.resolve();

    let resultWidth = 0;
    let resultHeight = 0;
    let resultBudgetLimited = false;

    const next = previous
      .catch(() => {})
      .then(async () => {
        if (!pdfDoc || !isCurrent()) return;

        const prevTask = renderTaskRef.current.get(page);
        if (prevTask) {
          try {
            prevTask.cancel();
            await prevTask.promise;
          } catch {
            // Previous task cancellation is expected during rapid updates.
          }
        }
        if (!isCurrent()) return;

        // No `canvas.isConnected` guard here on purpose: the canvas handed in
        // is a detached buffer that the caller blits from only when the raster
        // is complete. The caller owns cancellation (its effect's own flag);
        // checking connectivity here would simply refuse to draw anything.
        // The previous page's render task for this page number is still
        // cancelled above, so rapid switching cannot commit a stale raster.

        const pdfPage  = await pdfDoc.getPage(page);
        if (!isCurrent()) return;
        const viewport = pdfPage.getViewport({ scale: zoom });
        const ctx      = canvas.getContext('2d');
        if (!ctx) return;
        // The page is drawn at the device's own pixel density: the CSS
        // dimensions stay the zoom's own, and only the backing store takes the
        // multiplier. That split is what makes the raster sharp without moving
        // anything: every value that leaves this function — the dims maps, the
        // returned size — stays in CSS pixels, so Fabric's space, snapping,
        // text geometry, redaction and the export are all untouched by it.
        const sharpness = resolvePdfEditorRenderScale({
          cssWidth: viewport.width,
          cssHeight: viewport.height,
          devicePixelRatio: currentDevicePixelRatio(),
          ...(pixelBudget !== undefined ? { pixelBudget } : {}),
        });
        resultBudgetLimited = sharpness.budgetLimited;
        canvas.width  = sharpness.pixelWidth;
        canvas.height = sharpness.pixelHeight;
        canvas.style.width  = `${viewport.width}px`;
        canvas.style.height = `${viewport.height}px`;
        pageBaseDimsRef.current.set(page, {
          width: viewport.width / zoom,
          height: viewport.height / zoom,
        });
        pageDimsRef.current.set(page, { width: viewport.width, height: viewport.height });

        // PDF.js draws through the viewport it is handed, so the renderer's
        // viewport carries the device multiplier. At 1× it is the same object,
        // byte for byte, as the one the editor has always rendered with.
        const renderViewport = sharpness.outputScale === 1
          ? viewport
          : pdfPage.getViewport({ scale: zoom * sharpness.outputScale });
        const task = pdfPage.render({ canvasContext: ctx, viewport: renderViewport, canvas });
        renderTaskRef.current.set(page, task);

        try {
          await task.promise;
          if (!isCurrent()) return;
          resultWidth = viewport.width;
          resultHeight = viewport.height;
        } catch (e: unknown) {
          const errorName = e && typeof e === 'object' && 'name' in e
            ? (e as { name?: string }).name
            : undefined;
          if (errorName !== 'RenderingCancelledException') {
            throw e;
          }
        } finally {
          if (renderTaskRef.current.get(page) === task) {
            renderTaskRef.current.delete(page);
          }
        }
      });

    renderQueueRef.current.set(page, next);
    await next;
    // `budgetLimited` tells the canvas whether the budget — not the device —
    // picked this raster's scale. Plain page geometry leaves the function in
    // CSS pixels, exactly as before; this flag is the one addition.
    return { width: resultWidth, height: resultHeight, budgetLimited: resultBudgetLimited };
  },
  // `dprEpoch` is not read in the body — the device ratio is read fresh every
  // call. It is the dependency because a ratio change must produce a *new
  // function identity*: that identity is what re-runs every mounted page's
  // render effect and re-draws the screen at the density it now sits on.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  [dprEpoch]);

  const resolveFabricNamespace = (module: FabricNamespace | { fabric?: FabricNamespace }) => {
    if ('fabric' in module && module.fabric) return module.fabric;
    if ('StaticCanvas' in module) return module as FabricNamespace;
    return null;
  };

  const getOverlayDataUrl = useCallback(async (
    savedState: FabricCanvasState | undefined,
    dims: { width: number; height: number } | null,
    multiplier = 2,
    scale: FabricOverlayScale | null = null,
  ) => {
    // Export receives immutable state, never a live canvas that can change mid-build.
    if (!savedState || !dims?.width || !dims?.height) return null;

    // Fabric v5's published constructor signatures are broader than this hook's
    // deliberately small runtime adapter, so validate through the adapter boundary.
    const fabricModule = (await import('fabric')) as unknown as FabricNamespace | { fabric?: FabricNamespace };
    const fabric = resolveFabricNamespace(fabricModule);
    if (!fabric) return null;
    const canvasWidth = Math.max(1, scale?.width ?? dims.width);
    const canvasHeight = Math.max(1, scale?.height ?? dims.height);
    const canvasEl = document.createElement('canvas');
    canvasEl.width = canvasWidth;
    canvasEl.height = canvasHeight;
    const exportState = scaleFabricCanvasStateForOverlay(savedState, scale);
    let dataUrl: string | null = null;
    await restorePdfEditorFabricCanvas(exportState, FABRIC_SERIALIZED_PROPS, {
      createCanvas: () => new fabric.StaticCanvas(canvasEl, {
        width: canvasWidth, height: canvasHeight, backgroundColor: 'transparent', renderOnAddRemove: false,
      }),
      isCurrent: () => true,
      commit: canvas => {
        canvas.renderAll();
        dataUrl = canvas.toDataURL({ format: 'png', multiplier });
      },
    });
    return dataUrl;
  }, []);

  const dataUrlToArrayBuffer = async (dataUrl: string) => {
    return fetch(dataUrl).then(response => response.arrayBuffer());
  };

  const getPageDisplaySize = useCallback((page: number) => {
    return pageDimsRef.current.get(page) ?? null;
  }, []);

  const getPageBaseDimensions = useCallback(async (page: number) => {
    return getPageBaseDims(page);
  }, [getPageBaseDims]);

  const getTextBlocks = useCallback(async (page: number, zoom: number, sourceDoc?: PdfJsDocumentLike): Promise<TextBlock[]> => {
    const pdfDoc = sourceDoc ?? getPdfDocOrNull();
    if (!pdfDoc) return [];

    const pdfPage = await pdfDoc.getPage(page);
    const viewport = pdfPage.getViewport({ scale: zoom });
    const textContent = await pdfPage.getTextContent() as PdfJsTextContentLike;
    const pdfjsLib = await import('pdfjs-dist');

    return (textContent.items as PdfJsTextItemLike[])
      .map((item, index) => {
        if (!item?.str?.trim()) return null;
        // Pinned to a local after the guard: PDF.js types `str` as optional, and
        // the geometry needs the real string to fall back on its length.
        const text: string = item.str;

        const textStyle = item.fontName ? textContent.styles?.[item.fontName] : undefined;
        const sourceDescent = textStyle?.descent;
        const sourceAscent = textStyle?.ascent;
        const ascentFraction = Number.isFinite(sourceAscent)
          ? Math.max(0, sourceAscent as number)
          : undefined;
        const descentFraction = Number.isFinite(sourceDescent)
          ? Math.max(0, -(sourceDescent as number))
          : undefined;

        const geometry = deriveTextBlockGeometry(
          { str: text, width: item.width, height: item.height },
          pdfjsLib.Util.transform(viewport.transform, item.transform),
          // The two halves of the rectangle come from different places, and the
          // zoom has to be applied to exactly one of them here.
          //
          // The *origin* arrives already zoomed: it is read straight out of the
          // composed transform above, which contains `viewport.transform`. The
          // *extents* do not — `getTextContent()` takes no viewport, so
          // `item.width`/`item.height` are text-space points whatever scale this
          // was called at. This argument scales those extents, and only those;
          // `deriveTextBlockGeometry` never re-scales the origin, so passing the
          // zoom here cannot bring back the doubled rectangles that a much
          // earlier version of that function produced at fit-width/fit-page.
          //
          // Passing 1 instead is what made the control stop matching its own
          // glyphs away from 100%: the box kept its point width while the text
          // inside it grew with the zoom, so at Fit width a one-line span wrapped
          // to two lines inside a box a third too narrow to cover the run it is
          // meant to hide, and `y` (baseline - height) sat low by the same
          // difference. The export path calls this with 1 deliberately — there
          // the transform carries no zoom either, and both halves are points.
          zoom,
          { ascent: ascentFraction, descent: descentFraction },
        );
        const fontDescent = descentFraction !== undefined
          ? descentFraction * geometry.sourceFontSize / zoom
          : undefined;
        const fontAscent = ascentFraction !== undefined
          ? ascentFraction * geometry.sourceFontSize / zoom
          : undefined;

        return {
          page,
          index,
          text,
          ...geometry,
          // The hover target and preview bar paint this full font box. The
          // engine rectangle in `x`/`y`/`width`/`height` stays tighter, so a
          // solid-set line above/below is not put at risk.
          fontBox: geometry.fontBox,
          // `geometry.fontSize` is display-space and carries a legibility floor;
          // neither belongs in a record the export reads. `sourceFontSize` is
          // the document's own size in the transform's space, and
          // `documentFontSize` converts it to points — the same number at Fit
          // page, Fit width and Actual size, which is the point. Dividing here
          // by hand is what it replaces: the quotient's last bits depend on the
          // zoom, and an edit record seeded at Fit width then disagreed with the
          // very block it came from, so every untouched line on the page was
          // sent to the engine as an edit. See `documentFontSize`.
          fontSize: documentFontSize({ sourceFontSize: geometry.sourceFontSize, zoom }),
          ...(fontDescent !== undefined && { fontDescent }),
          ...(fontAscent !== undefined && { fontAscent }),
          fontFamily: (item.fontName || 'Helvetica') as string,
          // Not the document's colour — PDF.js `getTextContent()` does not
          // report fill colour at all. This is a display placeholder, and it is
          // tagged as such so the export path can omit it and let the engine
          // inherit the real colour from the glyphs it replaces.
          color: UNKNOWN_SOURCE_TEXT_COLOR,
        } satisfies TextBlock;
      })
      .filter(Boolean) as TextBlock[];
  }, []);

  const renderThumbnail = useCallback(async (
    page: number,
    canvas: HTMLCanvasElement,
    maxWidth = 148,
  ) => {
    const pdfDoc = getPdfDocOrNull();
    if (!pdfDoc || !canvas.isConnected) return null;
    const pdfPage = await pdfDoc.getPage(page);
    if (pdfDocRef.current !== pdfDoc || !canvas.isConnected) return null;
    const baseViewport = pdfPage.getViewport({ scale: 1 });
    const scale = Math.min(1, maxWidth / Math.max(1, baseViewport.width));
    const viewport = pdfPage.getViewport({ scale });
    const context = canvas.getContext('2d');
    if (!context || !canvas.isConnected) return null;

    // Backing store at device density; the CSS `max-width`/`max-height` on the
    // thumbnail canvases still decide the displayed size, and the browser
    // preserves the aspect ratio when it clamps a replaced element — so
    // doubling the raster only sharpens the sheet, it cannot reflow the list.
    // Deliberately no inline width/height here: an attribute-sized canvas under
    // those caps is exactly how the rows are measured.
    const sharpness = resolvePdfEditorRenderScale({
      cssWidth: viewport.width,
      cssHeight: viewport.height,
      devicePixelRatio: currentDevicePixelRatio(),
      pixelBudget: PDF_EDITOR_THUMBNAIL_PIXEL_BUDGET,
    });
    canvas.width = sharpness.pixelWidth;
    canvas.height = sharpness.pixelHeight;
    const renderViewport = sharpness.outputScale === 1
      ? viewport
      : pdfPage.getViewport({ scale: scale * sharpness.outputScale });

    await pdfPage.render({ canvasContext: context, viewport: renderViewport, canvas }).promise;
    if (pdfDocRef.current !== pdfDoc) return null;
    // The thumbnail's *display* size, in CSS pixels — the backing store is a
    // device-density detail the callers have no business reading.
    return { width: viewport.width, height: viewport.height };
  }, []);

  const searchDocument = useCallback(async (query: string): Promise<PdfEditorSearchResult[]> => {
    const normalized = query.trim().replace(/\s+/g, ' ').toLocaleLowerCase();
    if (normalized.length < 2) return [];
    const results: PdfEditorSearchResult[] = [];
    for (let page = 1; page <= state.sourcePageCount; page += 1) {
      const blocks = await getTextBlocks(page, 1);
      blocks.forEach((block) => {
        const effectiveText = originalTextEditsRef.current.get(textBlockKey(page, block.index))?.text ?? block.text;
        if (!effectiveText.toLocaleLowerCase().includes(normalized)) return;
        const position = positionForSourcePage(page);
        if (!position) return;
        results.push({
          ...block,
          text: effectiveText,
          id: `${page}:${block.index}`,
          snippet: effectiveText.length > 100 ? `${effectiveText.slice(0, 97)}...` : effectiveText,
          position,
        });
      });
    }
    return results;
  }, [getTextBlocks, positionForSourcePage, state.sourcePageCount]);

  const getDocumentOutline = useCallback(async (): Promise<PdfEditorOutlineEntry[]> => {
    const pdfDoc = getPdfDocOrNull();
    if (!pdfDoc?.getOutline) return [];
    const source = await pdfDoc.getOutline();
    if (!source) return [];
    const entries: PdfEditorOutlineEntry[] = [];

    const resolvePage = async (dest: PdfJsOutlineItemLike['dest']) => {
      if (!dest || !pdfDoc.getPageIndex) return null;
      const resolved = typeof dest === 'string' && pdfDoc.getDestination
        ? await pdfDoc.getDestination(dest)
        : dest;
      if (!Array.isArray(resolved) || !resolved[0]) return null;
      try {
        return (await pdfDoc.getPageIndex(resolved[0])) + 1;
      } catch {
        return null;
      }
    };

    const visit = async (items: PdfJsOutlineItemLike[], depth: number) => {
      for (let index = 0; index < items.length; index += 1) {
        const item = items[index];
        entries.push({
          id: `${depth}:${index}:${entries.length}`,
          title: item.title?.trim() || 'Untitled section',
          page: await resolvePage(item.dest),
          depth,
        });
        if (item.items?.length) await visit(item.items, depth + 1);
      }
    };
    await visit(source.filter(isPdfJsOutlineItemLike), 0);
    return entries;
  }, []);

  const getDocumentComments = useCallback(async (): Promise<PdfEditorCommentEntry[]> => {
    const pdfDoc = getPdfDocOrNull();
    if (!pdfDoc) return [];
    const comments: PdfEditorCommentEntry[] = [];
    const supported = new Set(['Text', 'FreeText', 'Highlight', 'Underline', 'StrikeOut', 'Squiggly']);
    for (let page = 1; page <= pdfDoc.numPages; page += 1) {
      const pdfPage = await pdfDoc.getPage(page);
      const annotations = await pdfPage.getAnnotations?.() ?? [];
      annotations.forEach((annotation, index) => {
        if (!annotation.subtype || !supported.has(annotation.subtype)) return;
        comments.push({
          id: annotation.id ?? `${page}:${index}`,
          page,
          subtype: annotation.subtype,
          author: annotation.titleObj?.str?.trim() || 'Document author',
          contents: annotation.contentsObj?.str?.trim() || `${annotation.subtype} annotation`,
        });
      });
    }
    return comments;
  }, []);

  const getOriginalTextEdit = useCallback((block: TextBlock) => {
    return originalTextEditsRef.current.get(textBlockKey(block.page, block.index))
      ?? makeDefaultOriginalTextEdit(block);
  }, []);

  const getEditedText = useCallback((page: number, index: number, originalText: string) => {
    return originalTextEditsRef.current.get(textBlockKey(page, index))?.text ?? originalText;
  }, []);

  const selectOriginalTextBlock = useCallback((block: TextBlock) => {
    const key = textBlockKey(block.page, block.index);
    const edit = ensureOriginalTextEdit(block);
    selectedOriginalTextKeyRef.current = key;
    setState(prev => ({
      ...prev,
      selectedOriginalTextKey: key,
      textStyle: {
        ...prev.textStyle,
        fontFamily: edit.fontFamily,
        fontSize: edit.fontSize,
        bold: edit.bold,
        italic: edit.italic,
        underline: edit.underline,
        color: edit.color,
        bgColor: edit.backgroundColor || 'transparent',
        heading: 'body',
        lineHeight: edit.lineHeight,
        align: edit.align,
      },
    }));
  }, [ensureOriginalTextEdit]);

  /**
   * Drop the text-block selection.
   *
   * The selection is only real while its own tool is holding its own page: the
   * status bar, the canvas focus and `applyStyleToSelection` all read this one
   * field, and a field that describes a block the user cannot see is a lie the
   * whole interface repeats. `selectOriginalTextBlock` sets it; this is the
   * other half, used when the block leaves the screen (tool changed, page
   * changed). Identity when already clear, so a sync effect can call it
   * freely without scheduling a render for nothing.
   */
  const clearOriginalTextSelection = useCallback(() => {
    selectedOriginalTextKeyRef.current = null;
    setState(prev => (
      prev.selectedOriginalTextKey === null
        ? prev
        : { ...prev, selectedOriginalTextKey: null }
    ));
  }, []);

  const setTextEdit = useCallback((page: number, index: number, value: string, block?: TextBlock) => {
    const key = textBlockKey(page, index);
    const existing = originalTextEditsRef.current.get(key);
    originalTextEditsRef.current.set(key, {
      ...(existing ?? (block ? makeDefaultOriginalTextEdit(block) : {
        text: value,
        fontSize: 12,
        fontFamily: 'Helvetica',
        color: UNKNOWN_SOURCE_TEXT_COLOR,
        bold: false,
        italic: false,
        underline: false,
        align: 'left' as const,
        lineHeight: 1.15,
        backgroundColor: 'transparent',
      })),
      text: value,
    });
    recordDocumentHistory(`text:${key}`);
    setState(prev => ({ ...prev, editVersion: prev.editVersion + 1 }));
    scheduleAutosave();
  }, [recordDocumentHistory, scheduleAutosave]);

  /**
   * Add/remove a redaction mark for a detected source run.
   *
   * Marking a run also discards any pending text replacement for it: the user
   * just said the content must disappear, so keeping a replacement hidden behind
   * the mark would make the export's intent ambiguous. Unmarking leaves the run
   * editable again, but does not resurrect the discarded edit.
   */
  const toggleRedactionMark = useCallback((block: TextBlock, zoom: number) => {
    // Store the full font box, not the inset ink box. This rectangle is what
    // the engine receives, and for a scanned/OCR page `images=…PIXELS` blanks
    // only the pixels *inside* it: an ink box that stops at the baseline left
    // every descender tail visible in the preview even though the text layer
    // was gone. The font box is still this run's own advance, so the neighbour
    // guard remains meaningful; solid-set lines touch but do not overlap.
    const box = block.fontBox ?? block;
    const result = createPdfEditorRedactionMark({
      page: block.page,
      index: block.index,
      text: block.text,
      x: box.x,
      y: box.y,
      width: box.width,
      height: box.height,
    }, zoom);
    if (!result.ok) {
      setState(prev => ({ ...prev, saveStatus: 'error', saveMessage: result.message }));
      return false;
    }

    const toggled = togglePdfEditorRedactionMark(redactionMarksRef.current, result.mark);
    redactionMarksRef.current = [...toggled.marks];
    const key = textBlockKey(block.page, block.index);
    if (toggled.action === 'added') {
      originalTextEditsRef.current.delete(key);
      if (selectedOriginalTextKeyRef.current === key) selectedOriginalTextKeyRef.current = null;
    }

    recordDocumentHistory(`redaction:${block.page}:${block.index}`);
    setState(prev => ({
      ...prev,
      redactionMarks: [...toggled.marks],
      selectedOriginalTextKey: selectedOriginalTextKeyRef.current,
      editVersion: prev.editVersion + 1,
      saveStatus: 'idle',
      saveMessage: null,
    }));
    scheduleAutosave();
    return true;
  }, [recordDocumentHistory, scheduleAutosave]);

  const unmarkRedaction = useCallback((id: string) => {
    const marks = removePdfEditorRedactionMark(redactionMarksRef.current, id);
    if (marks.length === redactionMarksRef.current.length) return;
    redactionMarksRef.current = [...marks];
    recordDocumentHistory(`redaction-remove:${id}`);
    setState(prev => ({
      ...prev,
      redactionMarks: [...marks],
      editVersion: prev.editVersion + 1,
      saveStatus: 'idle',
      saveMessage: null,
    }));
    scheduleAutosave();
  }, [recordDocumentHistory, scheduleAutosave]);

  const clearRedactions = useCallback(() => {
    if (redactionMarksRef.current.length === 0) return;
    redactionMarksRef.current = [];
    recordDocumentHistory('redaction-clear');
    setState(prev => ({
      ...prev,
      redactionMarks: [],
      editVersion: prev.editVersion + 1,
      saveStatus: 'idle',
      saveMessage: null,
    }));
    scheduleAutosave();
  }, [recordDocumentHistory, scheduleAutosave]);

  // -- W4 annotation authoring --------------------------------

  const getAnnotationBlocker = useCallback((page: number) => pdfEditorAnnotationBlocker({
    page, pageSize: pageSizeRef.current, sourceRotation: sourcePageRotationsRef.current[page],
    entries: pageSessionRef.current?.plan.entries ?? [],
  }), []);

  /**
   * One commit path for every annotation change: mirror the ref (history,
   * autosave and export read it synchronously), record undo, bump `editVersion`
   * so the export preview rebuilds, and persist.
   */
  const commitAnnotations = useCallback((
    next: readonly PdfEditorAnnotation[],
    coalesceKey: string,
    selectedId: string | null,
  ) => {
    annotationsRef.current = [...next];
    recordDocumentHistory(coalesceKey);
    setState(prev => ({
      ...prev,
      annotations: [...next],
      selectedAnnotationId: selectedId,
      editVersion: prev.editVersion + 1,
      saveStatus: 'idle',
      saveMessage: null,
    }));
    scheduleAutosave();
  }, [recordDocumentHistory, scheduleAutosave]);

  /**
   * Click a text run with a markup kind active. Clicking the same run again
   * removes that annotation — the redaction-tool interaction, because "mark this
   * line" and "unmark this line" should feel identical.
   */
  const toggleAnnotationForBlock = useCallback((block: TextBlock, zoom: number) => {
    const blocker = getAnnotationBlocker(block.page);
    if (blocker) return false;
    const kind = state.annotationKind;
    if (!isPdfEditorTextMarkupKind(kind)) return false;
    const result = createPdfEditorTextAnnotation({
      kind: kind as 'highlight' | 'underline' | 'strikeout',
      source: block,
      zoom,
      color: state.annotationStyle.color,
      author: state.annotationStyle.author,
    });
    if (!result.ok) {
      setState(prev => ({ ...prev, saveStatus: 'error', saveMessage: result.message }));
      return false;
    }
    const toggled = togglePdfEditorTextAnnotation(annotationsRef.current, result.annotation);
    const selectedId = toggled.action === 'added' ? result.annotation.id : null;
    commitAnnotations(
      toggled.annotations,
      `annotation:${block.page}:${block.index}:${kind}`,
      selectedId,
    );
    return true;
  }, [commitAnnotations, getAnnotationBlocker, state.annotationKind, state.annotationStyle.author, state.annotationStyle.color]);

  /**
   * Place a note/stamp/link annotation at a page point. Sizes are chosen so the
   * annotation is visible and clickable without a second drag: a text note is
   * an icon-sized target, a stamp is readable, a link covers a line of text.
   */
  const addAnnotationAtPoint = useCallback((page: number, point: { x: number; y: number }) => {
    const blocker = getAnnotationBlocker(page);
    if (blocker) return false;
    const kind = state.annotationKind;
    if (isPdfEditorTextMarkupKind(kind)) return false;
    const dims = pageBaseDimsRef.current.get(page);
    if (!dims?.width || !dims?.height) return false;

    const size = kind === 'note'
      ? { width: 24, height: 24 }
      : kind === 'stamp'
        ? { width: 120, height: 36 }
        : { width: 160, height: 16 };
    const x = Math.min(Math.max(0, dims.width - size.width), Math.max(0, point.x));
    const y = Math.min(Math.max(0, dims.height - size.height), Math.max(0, point.y));

    const result = createPdfEditorAnnotation({
      kind,
      page,
      geometry: { x, y, ...size },
      color: state.annotationStyle.color,
      author: state.annotationStyle.author,
      stamp: state.annotationStyle.stamp,
      uri: state.annotationStyle.uri,
      contents: kind === 'note' ? 'New note' : '',
    });
    if (!result.ok) {
      setState(prev => ({ ...prev, saveStatus: 'error', saveMessage: result.message }));
      return false;
    }
    commitAnnotations(
      [...annotationsRef.current, result.annotation],
      `annotation-add:${result.annotation.id}`,
      result.annotation.id,
    );
    return true;
  }, [
    commitAnnotations,
    getAnnotationBlocker,
    state.annotationKind,
    state.annotationStyle.author,
    state.annotationStyle.color,
    state.annotationStyle.stamp,
    state.annotationStyle.uri,
  ]);

  const replyToAnnotation = useCallback((parentId: string, contents: string) => {
    const parent = annotationsRef.current.find(annotation => annotation.id === parentId);
    if (!parent) return false;
    const result = createPdfEditorAnnotation({
      kind: 'reply',
      page: parent.page,
      geometry: { x: parent.x, y: parent.y, width: parent.width, height: parent.height },
      color: parent.color,
      author: state.annotationStyle.author,
      contents,
      replyTo: parent.id,
    });
    if (!result.ok) {
      setState(prev => ({ ...prev, saveStatus: 'error', saveMessage: result.message }));
      return false;
    }
    commitAnnotations(
      [...annotationsRef.current, result.annotation],
      `annotation-reply:${parent.id}`,
      result.annotation.id,
    );
    return true;
  }, [commitAnnotations, state.annotationStyle.author]);

  const updateAnnotation = useCallback((
    id: string,
    partial: Partial<Pick<PdfEditorAnnotation, 'author' | 'contents' | 'color' | 'uri' | 'stamp'>>,
  ) => {
    const next = updatePdfEditorAnnotation(annotationsRef.current, id, partial);
    if (JSON.stringify(next) === JSON.stringify(annotationsRef.current)) return;
    commitAnnotations(next, `annotation-update:${id}`, id);
  }, [commitAnnotations]);

  const removeAnnotation = useCallback((id: string) => {
    const next = removePdfEditorAnnotation(annotationsRef.current, id);
    if (next.length === annotationsRef.current.length) return;
    commitAnnotations(next, `annotation-remove:${id}`, null);
  }, [commitAnnotations]);

  const selectAnnotation = useCallback((id: string | null) => {
    setState(prev => ({ ...prev, selectedAnnotationId: id }));
  }, []);

  const setAnnotationKind = useCallback((kind: PdfEditorAnnotationKind) => {
    setState(prev => ({
      ...prev,
      annotationKind: kind,
      selectedAnnotationId: null,
      annotationStyle: {
        ...prev.annotationStyle,
        // The default colour belongs to the kind (a highlight is yellow, a
        // strikeout is red). A colour the user chose for the previous kind
        // would make a highlight look like a link.
        color: pdfEditorAnnotationDefaultColor(kind),
      },
    }));
  }, []);

  const setAnnotationStyle = useCallback((partial: Partial<PdfEditorAnnotationStyle>) => {
    setState(prev => ({
      ...prev,
      annotationStyle: { ...prev.annotationStyle, ...partial },
    }));
  }, []);

  // Commit any open textarea edits in the DOM into the internal edits map.
  const commitAllEdits = useCallback(() => {
    try {
      const nodes = Array.from(document.querySelectorAll('textarea[data-pdf-text]')) as HTMLTextAreaElement[];
      for (const ta of nodes) {
        const p = parseInt(ta.getAttribute('data-page') || '', 10);
        const idx = parseInt(ta.getAttribute('data-index') || '', 10);
        if (Number.isFinite(p) && Number.isFinite(idx)) {
          const key = textBlockKey(p, idx);
          const existing = originalTextEditsRef.current.get(key);
          originalTextEditsRef.current.set(key, {
            ...(existing ?? {
              text: ta.value,
              fontSize: Number(ta.getAttribute('data-font-size')) || 12,
              fontFamily: ta.getAttribute('data-font-family') || 'Helvetica',
              color: ta.getAttribute('data-color') || UNKNOWN_SOURCE_TEXT_COLOR,
              bold: ta.getAttribute('data-bold') === 'true',
              italic: ta.getAttribute('data-italic') === 'true',
              underline: ta.getAttribute('data-underline') === 'true',
              align: (ta.getAttribute('data-align') || 'left') as TextStyle['align'],
              lineHeight: Number(ta.getAttribute('data-line-height')) || 1.15,
              backgroundColor: ta.getAttribute('data-bg-color') || 'transparent',
            }),
            text: ta.value,
          });
        }
      }
    } catch (e) {
      // Best-effort — DOM may not be available in some envs.
      console.warn('commitAllEdits failed', e);
    }
    snapshotAllFabricPages();
    scheduleAutosave();
  }, [scheduleAutosave, snapshotAllFabricPages]);
  

  // -- Tool application ---------------------------------------

  const addTextbox = useCallback((page: number, x = 80, y = 80) => {
    const fc = getLiveFabric(page);
    if (!fc) return;

    const { textStyle } = state;
    const fabric = window.__fabric__;
    if (!fabric) return;

    const tb = new fabric.Textbox('Click to type…', {
      left:            x,
      top:             y,
      width:           250,
      fontFamily:      textStyle.fontFamily,
      fontSize:        textStyle.fontSize,
      fontWeight:      textStyle.bold   ? 'bold'   : 'normal',
      fontStyle:       textStyle.italic ? 'italic' : 'normal',
      underline:       textStyle.underline,
      fill:            textStyle.color,
      backgroundColor: textStyle.bgColor === 'transparent' ? '' : textStyle.bgColor,
      textAlign:       textStyle.align,
      lineHeight:      textStyle.lineHeight,
      editable:        true,
    });

    fc.add(tb);
    fc.setActiveObject(tb);
    tb.enterEditing?.();
    // The hint is a placeholder, not content. Select it so the first keystroke
    // replaces it instead of exporting "Click to type…" before the real text.
    tb.selectAll?.();
    fc.renderAll();
  }, [state, getLiveFabric]);

  const addEmoji = useCallback((page: number, emoji: string, x = 100, y = 100) => {
    const fc = getLiveFabric(page);
    if (!fc) return;
    const fabric = window.__fabric__;
    if (!fabric) return;
    const t = new fabric.Text(emoji, { left: x, top: y, fontSize: 36, selectable: true });
    fc.add(t);
    fc.setActiveObject(t);
    fc.renderAll();
  }, [getLiveFabric]);

  const readFileAsDataUrl = (file: File) => new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error('Failed to read image file'));
    reader.readAsDataURL(file);
  });

  const loadFabricImage = async (fabric: FabricNamespace, src: string) => {
    const ImageClass = (fabric.Image ?? fabric.FabricImage) as FabricImageFactoryLike | undefined;
    if (!ImageClass?.fromURL) {
      throw new Error('Fabric image loader is not available');
    }

    return new Promise<FabricImageLike>((resolve, reject) => {
      let settled = false;
      const finish = (img: FabricImageLike | null) => {
        if (settled) return;
        settled = true;
        if (img) resolve(img);
        else reject(new Error('Fabric image loader returned an empty image'));
      };

      try {
        const loaded = ImageClass.fromURL(
          src,
          finish,
          { crossOrigin: 'anonymous' },
        );

        if (loaded?.then) {
          loaded.then(finish).catch((error: unknown) => {
            if (!settled) reject(error);
          });
        }
      } catch (error) {
        reject(error);
      }
    });
  };

  const ensureDrawingBrush = useCallback((fc: FabricCanvasLike) => {
    const fabric = window.__fabric__;
    if (!fabric || !fc) return false;
    if (!fc.freeDrawingBrush) {
      fc.freeDrawingBrush = new fabric.PencilBrush(fc);
    }
    fc.freeDrawingBrush.color = '#000000';
    fc.freeDrawingBrush.width = 2;
    return true;
  }, []);

  const addImage = useCallback(async (
    page: number,
    file: File,
    options: { defaultWidth?: number; objectName?: string } = {},
  ) => {
    const session = documentSessionRef.current;
    const fc = getLiveFabric(page);
    if (!fc) return;
    const fabric = window.__fabric__;
    if (!fabric) return;

    try {
      const dataUrl = await readFileAsDataUrl(file);
      const img = await loadFabricImage(fabric, dataUrl);
      if (session !== documentSessionRef.current || getLiveFabric(page) !== fc) {
        img.dispose?.();
        return;
      }
      const zoom = fc.getZoom?.() || state.zoom || 1;
      const baseWidth = Math.max(1, (fc.width || 1) / zoom);
      const baseHeight = Math.max(1, (fc.height || 1) / zoom);
      const targetWidth = Math.min(options.defaultWidth ?? 200, baseWidth * 0.45);
      img.scaleToWidth(targetWidth);
      const scaledWidth = img.getScaledWidth?.() ?? targetWidth;
      const scaledHeight = img.getScaledHeight?.() ?? targetWidth;
      img.set({
        left: Math.max(0, (baseWidth - scaledWidth) / 2),
        top: Math.max(0, (baseHeight - scaledHeight) / 2),
        name: options.objectName,
        selectable: true,
        hasControls: true,
        hasBorders: true,
        crossOrigin: 'anonymous',
        objectCaching: true,
      });
      const previousRenderOnAddRemove = fc.renderOnAddRemove;
      try {
        fc.renderOnAddRemove = false;
        fc.add(img);
      } finally {
        fc.renderOnAddRemove = previousRenderOnAddRemove;
      }
      if (!isFabricCanvasUsable(fc)) return;
      fc.setActiveObject(img);
      fc.requestRenderAll?.();
      fc.renderAll?.();
      snapshotFabricPage(page);
      setState(prev => ({ ...prev, editVersion: prev.editVersion + 1 }));
      scheduleAutosave();
    } catch (error) {
      if (session !== documentSessionRef.current) return;
      console.error('Image insert failed:', error);
      alert('Image insert failed. Please try a PNG, JPG, JPEG, SVG, WebP, or GIF image.');
    }
  }, [getLiveFabric, scheduleAutosave, snapshotFabricPage, state.zoom]);

  const addShape = useCallback((page: number, shape: 'rect' | 'circle' | 'line' | 'arrow' | 'highlight') => {
    const fc = getLiveFabric(page);
    if (!fc) return;
    const fabric = window.__fabric__;
    if (!fabric) return;

    let obj: FabricObjectLike | null = null;
    const common = { left: 100, top: 100, fill: 'transparent', stroke: '#000', strokeWidth: 2 };

    if (shape === 'rect')   obj = new fabric.Rect({ ...common, width: 160, height: 100 });
    if (shape === 'circle') obj = new fabric.Ellipse({ ...common, rx: 60, ry: 40 });
    if (shape === 'line')   obj = new fabric.Line([0, 0, 200, 0], { ...common, top: 150 });
    if (shape === 'arrow') {
      const line = new fabric.Line([0, 0, 180, 0], { stroke: '#000', strokeWidth: 2 });
      const triangle = new fabric.Triangle({ left: 175, top: -8, width: 16, height: 16, fill: '#000', angle: 90 });
      obj = new fabric.Group([line, triangle], { left: 100, top: 150 });
    }
    if (shape === 'highlight') {
      obj = new fabric.Rect({
        left: 100,
        top: 100,
        width: 200,
        height: 24,
        fill: 'rgba(255,235,59,0.45)',
        stroke: 'none',
        opacity: 0.7,
      });
    }

    if (obj) {
      fc.add(obj);
      fc.setActiveObject(obj);
      fc.renderAll();
    }
  }, [getLiveFabric]);

  /**
   * Create a shape from the rectangle the user actually dragged.
   *
   * Geometry arrives in points (normalised by `createPdfEditorDragGeometry`)
   * and Fabric's object space is already points because the canvas viewport
   * carries the zoom. Multiplying by zoom here put every new shape at a
   * fraction of the drag at Fit page and pushed it toward the page's middle.
   * `addShape` remains the click-to-place contract for callers that want a
   * preset size.
   */
  const addShapeFromDrag = useCallback((
    page: number,
    shape: PdfEditorDragShape,
    geometry: PdfEditorDragGeometry,
  ) => {
    const fc = getLiveFabric(page);
    if (!fc) return false;
    const fabric = window.__fabric__;
    if (!fabric) return false;
    const left = geometry.x;
    const top = geometry.y;
    const width = Math.max(1, geometry.width);
    const height = Math.max(1, geometry.height);
    const common = { fill: 'transparent', stroke: '#000', strokeWidth: 2 };

    let obj: FabricObjectLike | null = null;
    if (shape === 'rect') {
      obj = new fabric.Rect({ ...common, left, top, width, height });
    } else if (shape === 'circle') {
      obj = new fabric.Ellipse({ ...common, left, top, rx: width / 2, ry: height / 2 });
    } else if (shape === 'line') {
      obj = new fabric.Line(
        [geometry.from.x, geometry.from.y, geometry.to.x, geometry.to.y],
        { stroke: '#000', strokeWidth: 2 },
      );
    } else {
      const line = new fabric.Line(
        [geometry.from.x, geometry.from.y, geometry.to.x, geometry.to.y],
        { stroke: '#000', strokeWidth: 2 },
      );
      const head = new fabric.Triangle({
        left: geometry.to.x,
        top: geometry.to.y,
        width: 14,
        height: 14,
        fill: '#000',
        angle: geometry.angle + 90,
        originX: 'center',
        originY: 'center',
      });
      obj = new fabric.Group([line, head], {});
    }

    if (!obj) return false;
    fc.add(obj);
    fc.setActiveObject(obj);
    fc.requestRenderAll?.();
    fc.renderAll?.();
    return true;
  }, [getLiveFabric]);

  const startSignature = useCallback((page: number) => {
    const fc = getLiveFabric(page);
    if (!fc) return;
    if (!ensureDrawingBrush(fc)) return;
    fc.discardActiveObject?.();
    fc.isDrawingMode    = true;
    fc.selection = false;
    fc.defaultCursor = 'crosshair';
    fc.hoverCursor = 'crosshair';
    set({ activeTool: 'signature' });
  }, [ensureDrawingBrush, getLiveFabric]);

  const stopSignature = useCallback((page: number) => {
    const fc = getLiveFabric(page);
    if (!fc) return;
    fc.isDrawingMode = false;
    fc.selection = true;
    fc.defaultCursor = 'default';
    fc.hoverCursor = 'move';
    snapshotFabricPage(page);
    set({ activeTool: 'select' });
  }, [getLiveFabric, snapshotFabricPage]);

  // -- Update style on selected object -----------------------

  const applyStyleToSelection = useCallback((partial: Partial<TextStyle>) => {
    const page = resolveSourcePage(state.currentPage);
    const fc   = getLiveFabric(page);
    const obj  = activeObjRef.current;

    const selectedTextKey = selectedOriginalTextKeyRef.current;
    const originalSelected = !!selectedTextKey && state.activeTool === 'editText';
    if (originalSelected) {
      partial = supportedOriginalTextStyle(partial);
      if (!Object.keys(partial).length) return;
    }
    const nextTextStyle = { ...state.textStyle, ...partial };

    if (partial.heading !== undefined) {
      const sz = HEADING_SIZES[partial.heading];
      const isBold = partial.heading !== 'body';
      nextTextStyle.fontSize = sz;
      nextTextStyle.bold = isBold;
    }

    if (selectedTextKey && state.activeTool === 'editText') {
      const existing = originalTextEditsRef.current.get(selectedTextKey);
      if (existing) {
        originalTextEditsRef.current.set(selectedTextKey, {
          ...existing,
          ...partial,
        });
        setState(prev => ({
          ...prev,
          textStyle: nextTextStyle,
          editVersion: prev.editVersion + 1,
        }));
        recordDocumentHistory(`text-style:${selectedTextKey}`);
        scheduleAutosave();
        return;
      }
    }

    set({ textStyle: nextTextStyle });

    if (!fc || !obj) return;
    if (obj.type !== 'i-text' && obj.type !== 'textbox') return;

    if (partial.fontFamily !== undefined) obj.set('fontFamily',      partial.fontFamily);
    if (partial.fontSize   !== undefined) obj.set('fontSize',        partial.fontSize);
    if (partial.bold       !== undefined) obj.set('fontWeight',      partial.bold   ? 'bold'   : 'normal');
    if (partial.italic     !== undefined) obj.set('fontStyle',       partial.italic ? 'italic' : 'normal');
    if (partial.underline  !== undefined) obj.set('underline',       partial.underline);
    if (partial.color      !== undefined) obj.set('fill',            partial.color);
    if (partial.bgColor    !== undefined) obj.set('backgroundColor', partial.bgColor === 'transparent' ? '' : partial.bgColor);
    if (partial.lineHeight !== undefined) obj.set('lineHeight',      partial.lineHeight);
    if (partial.align      !== undefined) obj.set('textAlign',       partial.align);

    // Heading ? change fontSize + bold
    if (partial.heading !== undefined) {
      obj.set({ fontSize: nextTextStyle.fontSize, fontWeight: nextTextStyle.bold ? 'bold' : 'normal' });
      set({ textStyle: nextTextStyle });
    }

    fc.renderAll();
    snapshotFabricPage(page);
    recordDocumentHistory(`fabric:${page}:style`);
    scheduleAutosave();
    setState(prev => ({ ...prev, editVersion: prev.editVersion + 1 }));
  }, [state, getLiveFabric, resolveSourcePage, recordDocumentHistory, scheduleAutosave, snapshotFabricPage]);

  // ?? Object geometry, alignment and layers (W4) ??????????????

  const commitObjectChange = useCallback((
    page: number,
    coalesceKey: string,
    fc: FabricCanvasLike,
  ) => {
    snapshotFabricPage(page);
    recordDocumentHistory(coalesceKey);
    setState(prev => ({ ...prev, editVersion: prev.editVersion + 1 }));
    scheduleAutosave();
    syncPageLayers(fc);
  }, [recordDocumentHistory, scheduleAutosave, snapshotFabricPage, syncPageLayers]);

  /**
   * Write point-space geometry back to Fabric.
   *
   * Text is handled differently on purpose: scaling a textbox stretches its
   * glyphs, while changing `width` re-wraps them. A user typing 240pt into the
   * width field expects the text to reflow, not to become wider letters.
   */
  const applyGeometryToObject = useCallback((
    object: FabricObjectLike,
    geometry: PdfEditorObjectGeometry,
  ) => {
    /* Geometry is in page points and Fabric's object coordinates are already
       in that same space because the canvas viewport carries the zoom. Do not
       multiply by `zoom` here: at Fit page that writes an object at 0.52x the
       position it was given and makes it impossible to drag past the middle. */
    const current = readObjectGeometry(object);
    object.set({
      left: geometry.x,
      top: geometry.y,
    });
    // Fabric's measured bounds include stroke. Reapplying them during a move
    // stretches text even when the user changed only X/Y, forcing raster export.
    if (Math.abs(current.width - geometry.width) <= 0.01 && Math.abs(current.height - geometry.height) <= 0.01) {
      object.setCoords?.();
      return;
    }
    if (objectLayerKind(object) === 'text') {
      object.set({
        width: Math.max(1, geometry.width),
        scaleX: 1,
        scaleY: Math.max(
          0.01,
          geometry.height / Math.max(1, object.height ?? geometry.height),
        ),
      });
    } else {
      object.set({
        scaleX: Math.max(
          0.001,
          geometry.width / Math.max(1, object.width ?? geometry.width),
        ),
        scaleY: Math.max(
          0.001,
          geometry.height / Math.max(1, object.height ?? geometry.height),
        ),
      });
    }
    object.setCoords?.();
  }, []);

  const updateSelectedObjectGeometry = useCallback(async (
    partial: Partial<PdfEditorObjectGeometry>,
  ): Promise<boolean> => {
    const session = documentSessionRef.current;
    const page = resolveSourcePage(state.currentPage);
    const fc = getLiveFabric(page);
    const object = activeObjRef.current;
    if (!fc || !object) return false;
    const dims = await getPageBaseDims(page);
    if (!dims || session !== documentSessionRef.current || getLiveFabric(page) !== fc || !fc.getObjects?.().includes(object)) return false;
    if (object.peLocked) throw new Error('Unlock the object before changing its position or size.');

    const current = readObjectGeometry(object);
    const next = clampPdfEditorObjectGeometry({ ...current, ...partial }, dims);
    if (!geometryChanged(current, next)) return false;

    applyGeometryToObject(object, next);
    fc.setActiveObject(object);
    fc.requestRenderAll?.();
    commitObjectChange(page, `object:geometry:${object.peId ?? 'active'}`, fc);
    syncSelectionState([object]);
    return true;
  }, [
    applyGeometryToObject,
    commitObjectChange,
    getLiveFabric,
    getPageBaseDims,
    resolveSourcePage,
    state.currentPage,
    syncSelectionState,
  ]);

  const nudgeSelectedObject = useCallback((dx: number, dy: number) => {
    const geometry = state.selectedObjectGeometry;
    if (!geometry) return;
    return updateSelectedObjectGeometry(
      nudgePdfEditorObjectGeometry(geometry, dx, dy, { width: 1e6, height: 1e6 }),
    );
  }, [state.selectedObjectGeometry, updateSelectedObjectGeometry]);

  const updateSelectedObjectStyle = useCallback((partial: Partial<PdfEditorObjectStyle>) => {
    const page = resolveSourcePage(state.currentPage);
    const fc = getLiveFabric(page);
    if (!fc) return;
    const objects = fc.getActiveObjects?.() ?? (activeObjRef.current ? [activeObjRef.current] : []);
    if (objects.length === 0) return;
    objects.forEach((object) => {
      if (object.peLocked) return;
      object.set(partial);
      object.setCoords?.();
    });
    fc.requestRenderAll?.();
    commitObjectChange(page, `object:style:${objects[0].peId ?? 'active'}`, fc);
    syncSelectionState(objects);
  }, [commitObjectChange, getLiveFabric, resolveSourcePage, state.currentPage, syncSelectionState]);

  const setObjectLocked = useCallback((object: FabricObjectLike, locked: boolean) => {
    object.set({
      peLocked: locked,
      lockMovementX: locked,
      lockMovementY: locked,
      lockScalingX: locked,
      lockScalingY: locked,
      lockRotation: locked,
      hasControls: !locked,
    });
  }, []);

  const toggleSelectedObjectLock = useCallback(() => {
    const page = resolveSourcePage(state.currentPage);
    const fc = getLiveFabric(page);
    const object = activeObjRef.current;
    if (!fc || !object) return;
    const locked = object.peLocked !== true;
    setObjectLocked(object, locked);
    fc.requestRenderAll?.();
    commitObjectChange(page, `object:lock:${object.peId ?? 'active'}`, fc);
    syncSelectionState([object]);
  }, [commitObjectChange, getLiveFabric, resolveSourcePage, setObjectLocked, state.currentPage, syncSelectionState]);

  const toggleSelectedObjectHidden = useCallback(() => {
    const page = resolveSourcePage(state.currentPage);
    const fc = getLiveFabric(page);
    const object = activeObjRef.current;
    if (!fc || !object) return;
    const hidden = object.visible !== false;
    object.set({
      peHidden: hidden,
      visible: !hidden,
      selectable: !hidden,
      evented: !hidden,
    });
    if (hidden) fc.discardActiveObject?.();
    fc.requestRenderAll?.();
    commitObjectChange(page, `object:hide:${object.peId ?? 'active'}`, fc);
    syncSelectionState(hidden ? [] : [object]);
  }, [commitObjectChange, getLiveFabric, resolveSourcePage, state.currentPage, syncSelectionState]);

  const duplicateSelectedObject = useCallback(async () => {
    const session = documentSessionRef.current;
    const page = resolveSourcePage(state.currentPage);
    const fc = getLiveFabric(page);
    const object = activeObjRef.current;
    if (!fc || !object) return false;
    if ((fc.getActiveObjects?.().length ?? 0) > 1) {
      throw new Error('Group the selected objects before duplicating them together.');
    }
    if (object.isEditing) object.exitEditing?.();
    const clone = await clonePdfEditorFabricObject<FabricObjectLike>(object, FABRIC_SERIALIZED_PROPS);
    if (session !== documentSessionRef.current || getLiveFabric(page) !== fc || !fc.getObjects?.().includes(object)) {
      clone.dispose?.();
      return false;
    }
    renewPdfEditorFabricObjectIds(clone, () => createPdfEditorObjectId(Date.now() + objectSeqRef.current++));
    const offset = 12;
    clone.set({
      peName: undefined,
      left: (clone.left ?? 0) + offset,
      top: (clone.top ?? 0) + offset,
    });
    fc.add(clone);
    if (clone.visible !== false) fc.setActiveObject(clone);
    fc.requestRenderAll?.();
    return true;
  }, [getLiveFabric, resolveSourcePage, state.currentPage]);

  const copySelectedObject = useCallback(async () => {
    const session = documentSessionRef.current;
    const request = ++clipboardRequestRef.current;
    const object = activeObjRef.current;
    const fc = getLiveFabric(resolveSourcePage(state.currentPage));
    if (!object || !fc?.getObjects?.().includes(object)) return false;
    if ((fc.getActiveObjects?.().length ?? 0) > 1) {
      throw new Error('Group the selected objects before copying them together.');
    }
    if (object.isEditing) object.exitEditing?.();
    const clone = await clonePdfEditorFabricObject<FabricObjectLike>(object, FABRIC_SERIALIZED_PROPS);
    if (session !== documentSessionRef.current || request !== clipboardRequestRef.current) {
      clone.dispose?.();
      return false;
    }
    objectClipboardRef.current?.dispose?.();
    objectClipboardRef.current = clone;
    setState(prev => ({ ...prev, hasObjectClipboard: true }));
    return true;
  }, [getLiveFabric, resolveSourcePage, state.currentPage]);

  /**
   * Paste onto the page the user is looking at, not the page they copied from.
   * The clipboard holds a detached clone, so the source page is never mutated
   * and the pasted object gets its own id/name from the target canvas.
   */
  const pasteObjectToCurrentPage = useCallback(async () => {
    const session = documentSessionRef.current;
    const clipboard = objectClipboardRef.current;
    if (!clipboard) return false;
    const page = resolveSourcePage(state.currentPage);
    const fc = getLiveFabric(page);
    if (!fc) return false;
    const clone = await clonePdfEditorFabricObject<FabricObjectLike>(clipboard, FABRIC_SERIALIZED_PROPS);
    if (session !== documentSessionRef.current || getLiveFabric(page) !== fc) {
      clone.dispose?.();
      return false;
    }
    renewPdfEditorFabricObjectIds(clone, () => createPdfEditorObjectId(Date.now() + objectSeqRef.current++));
    clone.set({
      peName: undefined,
      left: (clone.left ?? 0) + 12,
      top: (clone.top ?? 0) + 12,
    });
    fc.add(clone);
    if (clone.visible !== false) fc.setActiveObject(clone);
    fc.requestRenderAll?.();
    return true;
  }, [getLiveFabric, resolveSourcePage, state.currentPage]);

  const alignSelectedObjects = useCallback((mode: PdfEditorAlignMode) => {
    const page = resolveSourcePage(state.currentPage);
    const fc = getLiveFabric(page);
    const objects = fc?.getActiveObjects?.() ?? [];
    if (!fc || objects.length < 2) return;
    const items: PdfEditorAlignedObject[] = objects.map((object, index) => {
      if (!object.peId) {
        object.set('peId', createPdfEditorObjectId(Date.now() + index));
      }
      return {
        id: object.peId as string,
        geometry: readObjectGeometry(object),
      };
    });
    const aligned = alignPdfEditorObjects(items, mode);
    const byId = new Map(objects.map(object => [object.peId, object]));
    aligned.forEach((item) => {
      const object = byId.get(item.id);
      if (object && !object.peLocked) applyGeometryToObject(object, item.geometry);
    });
    fc.requestRenderAll?.();
    commitObjectChange(page, `object:align:${mode}`, fc);
    syncSelectionState(objects);
  }, [applyGeometryToObject, commitObjectChange, getLiveFabric, resolveSourcePage, state.currentPage, syncSelectionState]);

  const distributeSelectedObjects = useCallback((axis: PdfEditorDistributeAxis) => {
    const page = resolveSourcePage(state.currentPage);
    const fc = getLiveFabric(page);
    const objects = fc?.getActiveObjects?.() ?? [];
    if (!fc || objects.length < 3) return;
    const items: PdfEditorAlignedObject[] = objects.map((object, index) => {
      if (!object.peId) {
        object.set('peId', createPdfEditorObjectId(Date.now() + index));
      }
      return {
        id: object.peId as string,
        geometry: readObjectGeometry(object),
      };
    });
    const distributed = distributePdfEditorObjects(items, axis);
    const byId = new Map(objects.map(object => [object.peId, object]));
    distributed.forEach((item) => {
      const object = byId.get(item.id);
      if (object && !object.peLocked) applyGeometryToObject(object, item.geometry);
    });
    fc.requestRenderAll?.();
    commitObjectChange(page, `object:distribute:${axis}`, fc);
    syncSelectionState(objects);
  }, [applyGeometryToObject, commitObjectChange, getLiveFabric, resolveSourcePage, state.currentPage, syncSelectionState]);

  const selectPageLayer = useCallback((id: string) => {
    const page = resolveSourcePage(state.currentPage);
    const fc = getLiveFabric(page);
    const object = fc?.getObjects?.().find(candidate => candidate.peId === id);
    if (!fc || !object) return;
    fc.setActiveObject(object);
    fc.requestRenderAll?.();
    syncSelectionState([object]);
    syncPageLayers(fc);
  }, [getLiveFabric, resolveSourcePage, state.currentPage, syncPageLayers, syncSelectionState]);

  const togglePageLayerLock = useCallback((id: string) => {
    const page = resolveSourcePage(state.currentPage);
    const fc = getLiveFabric(page);
    const object = fc?.getObjects?.().find(candidate => candidate.peId === id);
    if (!fc || !object) return;
    setObjectLocked(object, object.peLocked !== true);
    fc.requestRenderAll?.();
    commitObjectChange(page, `object:layer-lock:${id}`, fc);
    if (activeObjRef.current === object) syncSelectionState([object]);
  }, [commitObjectChange, getLiveFabric, resolveSourcePage, setObjectLocked, state.currentPage, syncSelectionState]);

  const togglePageLayerHidden = useCallback((id: string) => {
    const page = resolveSourcePage(state.currentPage);
    const fc = getLiveFabric(page);
    const object = fc?.getObjects?.().find(candidate => candidate.peId === id);
    if (!fc || !object) return;
    const hidden = object.visible !== false;
    object.set({
      peHidden: hidden,
      visible: !hidden,
      selectable: !hidden,
      evented: !hidden,
    });
    if (hidden && activeObjRef.current === object) fc.discardActiveObject?.();
    fc.requestRenderAll?.();
    commitObjectChange(page, `object:layer-hide:${id}`, fc);
    syncSelectionState(activeObjRef.current && activeObjRef.current.visible !== false ? [activeObjRef.current] : []);
  }, [commitObjectChange, getLiveFabric, resolveSourcePage, state.currentPage, syncSelectionState]);

  const movePageLayer = useCallback((id: string, direction: 'front' | 'back' | 'forward' | 'backward') => {
    const page = resolveSourcePage(state.currentPage);
    const fc = getLiveFabric(page);
    const object = fc?.getObjects?.().find(candidate => candidate.peId === id);
    if (!fc || !object) return;
    if (!movePdfEditorFabricObject(fc, object, direction)) return;
    fc.requestRenderAll?.();
    commitObjectChange(page, `object:layer-order:${id}`, fc);
  }, [commitObjectChange, getLiveFabric, resolveSourcePage, state.currentPage]);

  const groupSelectedObjects = useCallback(() => {
    const page = resolveSourcePage(state.currentPage);
    const fc = getLiveFabric(page);
    const selection = fc?.getActiveObject?.() as FabricObjectLike & {
      toGroup?: () => void;
    } | null | undefined;
    if (!fc || !selection || (fc.getActiveObjects?.().length ?? 0) < 2) return;
    if (!selection.toGroup) throw new Error('The canvas engine cannot group this selection.');
    restoringDocumentHistoryRef.current = true;
    try { selection.toGroup(); } finally { restoringDocumentHistoryRef.current = false; }
    fc.requestRenderAll?.();
    commitObjectChange(page, 'object:group', fc);
    syncSelectionState(fc.getActiveObjects?.() ?? []);
  }, [commitObjectChange, getLiveFabric, resolveSourcePage, state.currentPage, syncSelectionState]);

  const ungroupSelectedObject = useCallback(() => {
    const page = resolveSourcePage(state.currentPage);
    const fc = getLiveFabric(page);
    const selection = fc?.getActiveObject?.() as FabricObjectLike & {
      toActiveSelection?: () => void;
    } | null | undefined;
    if (!fc || !selection) return;
    if (selection.type !== 'group' || !selection.toActiveSelection) throw new Error('Select a group before using Ungroup.');
    restoringDocumentHistoryRef.current = true;
    try { selection.toActiveSelection(); } finally { restoringDocumentHistoryRef.current = false; }
    fc.requestRenderAll?.();
    commitObjectChange(page, 'object:ungroup', fc);
    syncSelectionState(fc.getActiveObjects?.() ?? []);
  }, [commitObjectChange, getLiveFabric, resolveSourcePage, state.currentPage, syncSelectionState]);

  // -- Undo / Redo -------------------------------------------

  const restoreDocumentHistoryEntry = useCallback(async (nextIndex: number) => {
    const session = documentSessionRef.current;
    const entry = documentHistoryRef.current[nextIndex];
    if (!entry || restoringDocumentHistoryRef.current) return;

    restoringDocumentHistoryRef.current = true;
    syncSelectionState([]);
    try {
      const snapshot = JSON.parse(entry.snapshot) as EditorDocumentSnapshot;
      originalTextEditsRef.current = new Map(Object.entries(snapshot.textEdits));
      pageCanvasStatesRef.current = new Map(
        Object.entries(snapshot.canvasStates)
          .map(([page, canvasState]) => [Number(page), canvasState] as const)
          .filter(([page]) => Number.isInteger(page) && page > 0),
      );
      pageSizeRef.current = snapshot.pageSize;
      if (snapshot.pagePlan) {
        pageSessionRef.current = {
          plan: snapshot.pagePlan,
          past: [],
          future: [],
          revision: pageSessionRef.current?.revision ?? 0,
        };
      }
      redactionMarksRef.current = [...(snapshot.redactionMarks ?? [])];
      annotationsRef.current = [...(snapshot.annotations ?? [])];
      selectedOriginalTextKeyRef.current = null;
      activeObjRef.current = null;

      await Promise.all(Array.from(fabricRefs.current.entries()).map(async ([page, canvas]) => {
        if (!isFabricCanvasUsable(canvas)) return;
        const savedState = pageCanvasStatesRef.current.get(page);
        await loadFabricState(page, canvas, savedState ?? { objects: [], background: 'transparent' });
      }));
      if (session !== documentSessionRef.current) return;

      syncPageLayers(getLiveFabric(resolveSourcePage(state.currentPage)));

      documentHistoryIndexRef.current = nextIndex;
      setState(prev => {
        const nextPageCount = snapshot.pagePlan?.entries.length ?? prev.totalPages;
        return {
          ...prev,
          pageSize: snapshot.pageSize,
          pagePlan: snapshot.pagePlan ?? prev.pagePlan,
          totalPages: nextPageCount,
          currentPage: Math.min(prev.currentPage, Math.max(1, nextPageCount)),
          historyIndex: nextIndex,
          canUndo: nextIndex > 0,
          canRedo: nextIndex < documentHistoryRef.current.length - 1,
          selectedOriginalTextKey: null,
          selectedObjectKind: 'none',
          selectedObjectGeometry: null,
          selectedObjectLocked: false,
          selectedObjectHidden: false,
          selectedObjectCount: 0,
          hasObjectClipboard: objectClipboardRef.current !== null,
          selectedObjectStyle: null,
          redactionMarks: [...(snapshot.redactionMarks ?? [])],
          annotations: [...(snapshot.annotations ?? [])],
          selectedAnnotationId: null,
          snapGuides: [],
          editVersion: prev.editVersion + 1,
        };
      });
      scheduleAutosave();
    } catch (error) {
      if (session !== documentSessionRef.current) return;
      console.warn('Document history restore failed', error);
    } finally {
      if (session === documentSessionRef.current) restoringDocumentHistoryRef.current = false;
    }
  }, [getLiveFabric, loadFabricState, resolveSourcePage, scheduleAutosave, state.currentPage, syncPageLayers, syncSelectionState]);

  const undo = useCallback(() => {
    const nextIndex = documentHistoryIndexRef.current - 1;
    if (nextIndex < 0) return;
    void restoreDocumentHistoryEntry(nextIndex);
  }, [restoreDocumentHistoryEntry]);

  const redo = useCallback(() => {
    const nextIndex = documentHistoryIndexRef.current + 1;
    if (nextIndex >= documentHistoryRef.current.length) return;
    void restoreDocumentHistoryEntry(nextIndex);
  }, [restoreDocumentHistoryEntry]);

  const isFabricTextEditing = useCallback(() => {
    const activeObject = getLiveFabric(resolveSourcePage(state.currentPage))?.getActiveObject();
    return Boolean(activeObject?.isEditing);
  }, [getLiveFabric, resolveSourcePage, state.currentPage]);

  const deleteSelected = useCallback(() => {
    const fc  = getLiveFabric(resolveSourcePage(state.currentPage));
    const obj = fc?.getActiveObject();
    if (!fc || !obj || obj.isEditing) return;
    fc.remove(obj);
    fc.discardActiveObject?.();
    fc.renderAll();
  }, [state.currentPage, getLiveFabric, resolveSourcePage]);

  // -- Export PDF --------------------------------------------

  /**
   * One export build, before it is delivered anywhere.
   *
   * The preview and Save are two consumers of *this*, not two renderers of the
   * same intent. That is what makes the module's **P = E** invariant structural:
   * there is no second code path that could drift, because there is no second
   * code path. `pdfBytes` is the array both the canvas and the file receive.
   */
  type PdfEditorExportBuild =
    | {
        ok: true;
        /** The bytes. Never regenerated for delivery - see `exportPdf`. */
        pdfBytes: Uint8Array;
        fileName: string;
        effectiveMode: PdfEditorExportMode;
        verification: PdfPostExportVerification;
        /** Fidelity downgrades the engine performed. Empty means none. */
        disclosures: string[];
        /**
         * Impact of the page plan applied to this build, when the plan differs
         * from the source. Export refuses until this impact is approved.
         */
        pageImpact: PdfEditorPageExportImpact | null;
        /**
         * Bytes before the page plan was applied. The delivery gate re-exports
         * from these on confirmation and compares against `pdfBytes`, which is
         * what keeps P = E true through the approval round trip.
         */
        prePlanBytes: Uint8Array | null;
        /**
         * The impact governing this build, always populated. The preview may use
         * it as context, but export downloads the verified build directly.
         */
        requiredConfirmation: PdfExportImpact;
      }
    | {
        ok: false;
        message: string;
        impact?: PdfExportImpact;
        verification?: PdfPostExportVerification;
        /**
         * Present when the engine refused something the user is allowed to
         * accept. Grant it and the same build succeeds; without it there are no
         * bytes at all, and the overlay path is never an alternative (§3.2).
         */
        consent?: ServerTextEditConsentRequest;
        processingRequired?: boolean;
      };

  type PdfEditorExportBuildOptions = {
    /**
     * Loss the user has accepted. Defaults to what is already granted in state,
     * so the preview and Save agree without the page having to thread it.
     */
    consent?: ServerTextEditConsentRequest | null;
  };

  /**
   * Fingerprint ? in-flight or finished build.
   *
   * Holding the *promise* means a preview and a Save that overlap collapse into
   * one engine round trip and therefore one set of bytes; holding it across
   * renders means the bytes the user judged are the bytes that reach the disk.
   */
  const buildExportedPdf = useCallback(async (
    options: PdfEditorExportBuildOptions = {},
  ): Promise<PdfEditorExportBuild> => {
    const pdfFile = currentFileRef.current;
    const sourceDoc = getPdfDocOrNull();
    if (!pdfFile || !sourceDoc || pdfFile !== state.pdfFile || isResettingSessionRef.current) {
      return { ok: false, message: 'Wait for the current PDF to finish opening before exporting.' };
    }

    try {
      commitAllEdits();
      snapshotAllFabricPages();
      if (failedRestorePagesRef.current.size > 0) {
        return { ok: false, message: [...failedRestorePagesRef.current.values()].join(' ') };
      }
      if (restoringPagesRef.current.size > 0) {
        return { ok: false, message: 'A page is still restoring. Wait for it to finish before exporting.' };
      }
      const sessionId = documentSessionRef.current;
      const revision = getExportRevision();
      const snapshot = JSON.parse(serializeDocumentSnapshot()) as EditorDocumentSnapshot;
      const pageSession = pageSessionRef.current ? structuredClone(pageSessionRef.current) : null;
      const preflightReport = state.preflightReport;
      const consent = structuredClone(options.consent
        ?? (textConsentRef.current?.revision === revision ? textConsentRef.current.consent : null));
      const pageSize = snapshot.pageSize;
      const sourcePageCount = sourceDoc.numPages;
      const snapshotDimensions = new Map<number, { width: number; height: number }>();
      const getBuildPageDims = async (page: number) => {
        const cached = snapshotDimensions.get(page);
        if (cached) return cached;
        const pdfPage = await sourceDoc.getPage(page);
        const viewport = pdfPage.getViewport({ scale: 1 });
        const dims = { width: viewport.width, height: viewport.height };
        snapshotDimensions.set(page, dims);
        return dims;
      };
      const buildOverlay = async (page: number, multiplier = 3, scale: FabricOverlayScale | null = null) => (
        getOverlayDataUrl(snapshot.canvasStates[String(page)], await getBuildPageDims(page), multiplier, scale)
      );
      const isCurrent = () => sessionId === documentSessionRef.current && revision === getExportRevision();

      // Refuse incompatible restored annotations before any full-document transfer.
      // The records remain intact so the user can undo the layout or remove them explicitly.
      for (const annotation of snapshot.annotations ?? []) {
        const blocker = pdfEditorAnnotationBlocker({
          page: annotation.page, pageSize, sourceRotation: sourcePageRotationsRef.current[annotation.page],
          entries: snapshot.pagePlan?.entries ?? [],
        });
        if (blocker) return { ok: false, message: blocker };
      }

      // Collect the mutations before anything else: they are most of the build's
      // identity, so the fingerprint cannot be computed without them. Reading
      // text content is local work, and cheap next to the engine round trip a
      // cache hit avoids.
      const textMutations: PdfEditorTextMutation[] = [];
      const originalTextByMutation: string[] = [];
      const pagesWithMutations = new Set<number>();
      const redactionMarks = snapshot.redactionMarks ?? [];
      const redactedBlocks = new Set(redactionMarks.map(mark => mark.blockKey));
      const blocksByPage = new Map<number, TextBlock[]>();
      for (let page = 1; page <= sourcePageCount; page += 1) {
        const blocks = await getTextBlocks(page, 1, sourceDoc);
        blocksByPage.set(page, blocks);
        const pageDims = await getBuildPageDims(page);
        for (const block of blocks) {
          // A mark wins over a replacement for the same run. Keeping both would
          // ask the engine to delete the glyphs and reinsert text into the box
          // the user just marked as content to remove.
          if (redactedBlocks.has(textBlockKey(page, block.index))) continue;
          const edit = snapshot.textEdits[textBlockKey(page, block.index)];
          if (!edit || !isEffectiveTextEdit(edit, block)) continue;
          const mutationBox = measureEditedTextMutationBox(block, edit, pageDims);
          pagesWithMutations.add(page);
          textMutations.push({
            ...edit,
            page,
            x: block.x,
            y: block.y,
            width: mutationBox.width,
            height: mutationBox.height,
            sourceFontSize: block.fontSize,
            // The value `edit.color` was seeded from. Lets the server client
            // tell an untouched placeholder apart from a colour the user
            // actually picked, and omit the former so the engine inherits the
            // span's true fill colour instead of repainting it.
            sourceColor: block.color || UNKNOWN_SOURCE_TEXT_COLOR,
          });
          originalTextByMutation.push(block.text);
        }
      }

      // Redactions travel through the same atomic server transaction as text
      // edits, but with an empty replacement. The source run is the contract:
      // the engine searches for it inside the box, deletes only those glyphs,
      // and proves the result on the output bytes.
      const redactionEditIds = new Set<string>();
      for (const mark of redactionMarks) {
        pagesWithMutations.add(mark.page);
        // The engine rectangle must be the run's full font box. For a scanned
        // page the visible words are pixels: a box that stops at the baseline
        // blanks only that part of the image, leaving every descender tail in
        // the preview. `getTextBlocks(page, 1)` is in points, the same space
        // as the mark, so its font box is used directly. Existing drafts that
        // stored the old ink box are upgraded here too.
        const sourceBlock = blocksByPage
          .get(mark.page)
          ?.find(block => textBlockKey(block.page, block.index) === mark.blockKey);
        const sourceBox = sourceBlock?.fontBox ?? mark;
        textMutations.push({
          text: '',
          fontSize: 12,
          fontFamily: 'Helvetica',
          color: UNKNOWN_SOURCE_TEXT_COLOR,
          bold: false,
          italic: false,
          underline: false,
          align: 'left',
          lineHeight: 1.2,
          page: mark.page,
          x: sourceBox.x,
          y: sourceBox.y,
          width: sourceBox.width,
          height: sourceBox.height,
          sourceFontSize: 12,
          sourceColor: UNKNOWN_SOURCE_TEXT_COLOR,
          redact: true,
        });
        originalTextByMutation.push(mark.originalText);
        redactionEditIds.add(`text-${textMutations.length}`);
      }

      const pagesWithCanvasObjects = new Set<number>();
      const canvasPages: { page: number; state: unknown }[] = [];
      Object.entries(snapshot.canvasStates).forEach(([pageKey, canvasState]) => {
        const page = Number(pageKey);
        if (countFabricCanvasObjects([canvasState]) > 0) {
          pagesWithCanvasObjects.add(page);
          pagesWithMutations.add(page);
          canvasPages.push({ page, state: canvasState });
        }
      });
      // A Map iterates in insertion order, which depends on which page the user
      // drew on first. Page order is what the export actually depends on.
      canvasPages.sort((left, right) => left.page - right.page);

      if (!isCurrent()) return { ok: false, message: 'The document changed while preparing the export. Review the current revision and retry.' };
      if (textMutations.length > 0 && !processingConsentRef.current.isAllowed(sessionId)) {
        return {
          ok: false, processingRequired: true,
          message: 'These original-text changes need server processing. Review and allow transfer of this entire PDF first, or keep editing locally without uploading it.',
        };
      }
      const fingerprint = computePdfEditorExportFingerprint({
        file: { name: pdfFile.name, size: pdfFile.size, lastModified: pdfFile.lastModified, sessionId },
        pageSize,
        // Deliberately not part of the identity: a confirmation changes who is
        // allowed to receive the bytes, never the bytes. Including it would miss
        // the cache on the retry after a dialog, which is exactly the moment
        // P = E has to hold.
        confirmedMode: null,
        textEdits: textMutations,
        redactions: redactionMarks,
        annotations: snapshot.annotations ?? [],
        canvasPages,
        consent,
        pagePlan: snapshot.pagePlan ?? null,
      });
      const result = await getOrBuildPdfEditorExport(exportBuildCacheRef.current, fingerprint, () => runBuild(pdfFile, sourceDoc));
      if (!isCurrent()) return { ok: false, message: 'The document changed while building the export. Review the current revision and retry.' };
      return result;

      /**
       * Never rejects: a cached rejection would be replayed to both consumers.
       *
       * Takes the file as a parameter rather than closing over it — a hoisted
       * declaration does not inherit the null check at the top of the build.
       */
      async function runBuild(sourceFile: File, sourceDoc: PdfJsDocumentLike): Promise<PdfEditorExportBuild> {
        try {
          const originalPdfBytes = await sourceFile.arrayBuffer();
          if (!isCurrent()) return { ok: false, message: 'The document changed before the export could start. Review the current revision and retry.' };
          // Rotation only constrains the browser overlay/vector path. The
          // server text engine maps visual rectangles itself and handles
          // rotated pages, so text edits and redactions must not be pushed to
          // the compatibility renderer merely because a page is rotated.
          let hasMutationsOnRotatedPages = false;
          for (const page of pagesWithCanvasObjects) {
            const pdfPage = await sourceDoc.getPage(page);
            const rotation = pdfPage?.rotate ?? 0;
            if (rotation % 360 !== 0) {
              hasMutationsOnRotatedPages = true;
              break;
            }
          }
          const exportDecision = decidePdfEditorExportMode({
            pageSize,
            hasTextEdits: textMutations.length > 0,
            // Annotations are written into the output even when no canvas object
            // exists. Without this they would be gated by a byte-preserving
            // decision that promises the source bytes are untouched.
            hasCanvasObjects: pagesWithCanvasObjects.size > 0 || (snapshot.annotations?.length ?? 0) > 0,
            hasMutationsOnRotatedPages,
          });
          let requiredConfirmation = buildPdfExportImpact(preflightReport, exportDecision, {
            redactionCount: redactionMarks.length,
          });

          let pdfBytes: Uint8Array;
          let effectiveMode: PdfEditorExportMode = exportDecision.mode;
          let exportSourceBytes: ArrayBuffer | Uint8Array = originalPdfBytes;
          const disclosures: string[] = [];
          let vectorizedPageCount = 0;
          let rasterFallbackPageCount = 0;
          let vectorTextForVerification: { page: number; text: string }[] = [];

          const hasRedactions = redactionMarks.length > 0;
          /**
           * A redaction that cannot be proven removed is a refusal, never a
           * local cover-up: painting a black rectangle over live glyphs leaves
           * the original text extractable, which is the exact lie a redaction
           * tool must not tell.
           */
          const refuseRedaction = (reason: string): PdfEditorExportBuild => ({
            ok: false,
            message: `Redaction was not applied: ${reason} No file was produced, because a visual cover-up cannot prove the marked text is gone from the file.`,
          });

          if (textMutations.length > 0) {
            if (!isPdfEditorFeatureEnabled('serverTextEdit')) {
              if (hasRedactions) {
                return refuseRedaction('structural text editing is disabled for this deployment.');
              }
              // W3 fail-closed policy: no local visual fallback. Rasterising
              // the edit makes the download look edited while the actual text
              // replacement was never applied, so the file no longer matches
              // what the editor promised. Refuse and leave the source intact.
              return {
                ok: false,
                message:
                  'Structural text editing is disabled for this deployment, so the '
                  + 'text changes cannot be applied safely. No file was produced.',
              };
            }
            if (!isCurrent()) return { ok: false, message: 'The document changed before server processing. Review the current revision and retry.' };
            const controller = new AbortController();
            serverBuildsRef.current.add(controller);
            setState(prev => ({ ...prev, isServerProcessing: true }));
            let structuralResult: Awaited<ReturnType<typeof applyServerTextEdits>>;
            try {
              structuralResult = await applyServerTextEdits({
                source: originalPdfBytes,
                filename: sourceFile.name,
                // Cancels the client wait only; the backend may still finish its work.
                transport: (endpoint, body) => {
                  if (!isCurrent() || !processingConsentRef.current.isAllowed(sessionId)) throw new Error('Processing permission no longer belongs to this document.');
                  return fetch(endpoint, { method: 'POST', body, signal: controller.signal });
                },
                edits: textMutations.map((mutation, index) => toServerTextEditRequest(
                  mutation,
                  originalTextByMutation[index],
                  `text-${index + 1}`,
                  // Only the loss the user has already accepted, and only for the
                  // edit they accepted it for. Never defaulted on: these flags are
                  // the difference between "the engine protected you" and "you
                  // chose to lose that".
                  serverTextEditConsentFor(consent, `text-${index + 1}`),
                )),
              });
            } finally {
              serverBuildsRef.current.delete(controller);
              if (sessionId === documentSessionRef.current) setState(prev => ({ ...prev, isServerProcessing: serverBuildsRef.current.size > 0 }));
            }
            if (!structuralResult.ok) {
              if (hasRedactions) return refuseRedaction(structuralResult.error);
              // The service is unavailable or the answer is not an engine
              // report. There is nothing truthful to download; a refusal is
              // the only outcome that does not fabricate an edit.
              return refusal(structuralResult.error, {
                error: structuralResult.error,
                report: structuralResult.report,
              });
            }
            if (!isServerTextEditTrustworthy(structuralResult.report, { redactionEditIds }) || !structuralResult.pdfBytes) {
              // Attribute the refusal to the edits and pages that caused it. Raw
              // outcome reasons cannot be concatenated here: an atomic rollback
              // repeats one sentence per surviving edit, which buries the cause.
              const message = describeServerTextEditFailure(structuralResult.report, { redactionEditIds }).message;
              if (hasRedactions) return refuseRedaction(message);
              return refusal(message, { report: structuralResult.report });
            }
            exportSourceBytes = structuralResult.pdfBytes;
            // The engine kept its promises, but it may have shrunk, restyled or
            // recoloured something to do so. Carry those facts out to the UI: a
            // downgrade nobody is told about is indistinguishable from a lie.
            disclosures.push(...describeServerTextEditDisclosures(structuralResult.report, { redactionEditIds }));
            if (hasRedactions) {
              disclosures.push(
                `${redactionMarks.length} redaction${redactionMarks.length === 1 ? '' : 's'} removed the marked glyphs from the exported content streams; the output is verified for their absence before download.`,
              );
            }
          }

          if (exportDecision.mode === 'byte-preserving') {
            // Defensive invariant: if the mode resolver ever returns byte-preserving
            // after a structural edit, never discard the committed server bytes.
            pdfBytes = clonePdfBytes(exportSourceBytes);
          } else if (exportDecision.mode === 'structure-preserving') {
            try {
              if (process.env.NODE_ENV !== 'production'
                && (globalThis as typeof globalThis & { __SMILEPDF_E2E_FORCE_STRUCTURE_EXPORT_FAILURE__?: boolean })
                  .__SMILEPDF_E2E_FORCE_STRUCTURE_EXPORT_FAILURE__) {
                throw new Error('Deterministic E2E structure-export failure.');
              }
              const overlayMutations: PdfEditorOverlayMutation[] = [];
              const vectorMutations: PdfEditorVectorOperation[] = [];
              const vectorPages = new Set<number>();
              const vectorTextAdditions: { page: number; text: string }[] = [];
              const rasterFallbackReasons = new Map<number, string[]>();
              const pageDims = new Map<number, { width: number; height: number }>();
              let vectorFonts: PdfEditorVectorFontAssets | null = null;

              for (const page of pagesWithCanvasObjects) {
                const dims = await getBuildPageDims(page);
                if (!dims) {
                  return {
                    ok: false,
                    message: `The edits on page ${page} could not be rendered into the export. Export was stopped rather than save the page without them. Please try again; if this keeps happening, reload the document (your edits are saved locally) and export once more.`,
                  };
                }
                pageDims.set(page, dims);
              }

              if (isPdfEditorFeatureEnabled('vectorCanvasExport')) {
                const planPage = (page: number, coverage?: Parameters<typeof planPdfEditorVectorPage>[1]) => {
                  const dims = pageDims.get(page);
                  if (!dims) return null;
                  return planPdfEditorVectorPage({
                    page,
                    width: dims.width,
                    height: dims.height,
                    state: snapshot.canvasStates[String(page)],
                  }, coverage);
                };

                // First pass: classify without fonts, so only the faces the
                // document actually needs are downloaded and located.
                const plans = new Map<number, NonNullable<ReturnType<typeof planPage>>>();
                for (const page of pagesWithCanvasObjects) {
                  const plan = planPage(page);
                  if (plan) plans.set(page, plan);
                }

                const roles = new Set<PdfEditorVectorFontRole>();
                for (const plan of plans.values()) {
                  if (!plan.ok || !plan.hasText) continue;
                  for (const operation of plan.operations) {
                    if (operation.kind === 'text') roles.add(operation.font);
                  }
                }
                const fontSet = roles.size > 0
                  ? await loadPdfEditorVectorFonts([...roles])
                  : null;
                if (fontSet) vectorFonts = fontSet.fonts;

                for (const [page, firstPlan] of plans) {
                  // Coverage is checked against the exact bytes that will be
                  // embedded; a miss sends this page to the disclosed raster
                  // fallback instead of writing a silent tofu glyph.
                  const plan = firstPlan.ok && firstPlan.hasText && fontSet
                    ? planPage(page, fontSet.covers)
                    : firstPlan;
                  if (!plan) continue;
                  if (!plan.ok) {
                    rasterFallbackReasons.set(page, plan.reasons);
                    continue;
                  }
                  vectorPages.add(page);
                  vectorMutations.push(...plan.operations);
                  for (const operation of plan.operations) {
                    if (operation.kind === 'text') {
                      vectorTextAdditions.push({ page, text: operation.text });
                    }
                  }
                }
              }

              for (const page of pagesWithCanvasObjects) {
                if (vectorPages.has(page)) continue;
                const overlayUrl = await buildOverlay(page);
                const dims = pageDims.get(page);
                // A page the user edited must never be silently dropped from
                // its own export: skipping it here would save a document that
                // is missing exactly the work the user put in, with no error
                // and no way to notice. Fail loudly instead.
                if (!overlayUrl || !dims) {
                  return {
                    ok: false,
                    message: `The edits on page ${page} could not be rendered into the export. Export was stopped rather than save the page without them. Please try again; if this keeps happening, reload the document (your edits are saved locally) and export once more.`,
                  };
                }
                overlayMutations.push({
                  page,
                  pngBytes: await dataUrlToArrayBuffer(overlayUrl),
                  width: dims.width,
                  height: dims.height,
                });
              }
              pdfBytes = await exportStructurePreservingPdf({
                source: exportSourceBytes,
                // Structural edits already contain real replacement text. Drawing
                // these mutations again would create a duplicate visual overlay.
                textMutations: [],
                overlayMutations,
                vectorMutations,
                ...(vectorFonts ? { vectorFonts } : {}),
              });
              if (vectorTextAdditions.length > 0) {
                const families = [...new Set(vectorMutations.flatMap(operation =>
                  operation.kind === 'text' ? [vectorFontFamilyLabel(operation.font)] : []))];
                const shapedNote = families.some(family => family.includes('Bengali'))
                  ? ' Bengali vowel signs may be copied in visual order by viewers that ignore /ActualText.'
                  : '';
                disclosures.push(
                  `Added text on page(s) ${[...new Set(vectorTextAdditions.map(item => item.page))].join(', ')} is selectable and searchable, set in embedded ${families.join(' and ')}; the on-canvas typeface may differ slightly.${shapedNote}`,
                );
              }
              for (const [page, reasons] of rasterFallbackReasons) {
                disclosures.push(
                  `Page ${page} was kept as a high-resolution image because it contains ${reasons.join(', ')}; text added on that page is not selectable.`,
                );
              }
              // Carry the additions out of the block for verification below.
              vectorTextForVerification = vectorTextAdditions;
              vectorizedPageCount = vectorPages.size;
              rasterFallbackPageCount = rasterFallbackReasons.size;
            } catch (structurePreservingError) {
              // A script refusal is terminal. The compatibility renderer draws with
              // the same standard fonts, so falling back would silently turn the
              // refused text into "?" — exactly the corruption the guard exists to
              // prevent. Surface it instead of downgrading the guarantee.
              if (structurePreservingError instanceof UnsupportedScriptExportError) {
                return { ok: false, message: structurePreservingError.message };
              }
              const fallbackReason = structurePreservingError instanceof Error
                ? structurePreservingError.message
                : 'The source document could not be updated safely.';
              const fallbackDecision = decidePdfEditorExportMode({
                pageSize: 'compatibility-fallback',
                hasTextEdits: textMutations.length > 0,
                hasCanvasObjects: pagesWithCanvasObjects.size > 0,
              });
              // The downgrade now governs the build, so it is the impact the user
              // has to accept — and the one the preview shows them, rasterised,
              // while they decide.
              requiredConfirmation = buildPdfExportImpact(
                preflightReport,
                fallbackDecision,
                { fallbackReason },
              );
              console.warn('Structure-preserving export failed; falling back to the compatibility renderer.', structurePreservingError);
              effectiveMode = 'compatibility-render';
              const fallback = await renderCompatibilityPdf(exportSourceBytes);
              pdfBytes = fallback.bytes;
              disclosures.push(...fallback.notes);
              // The whole document is rasterised on this path; do not ask the
              // verifier to find vector text that was never written.
              vectorTextForVerification = [];
              vectorizedPageCount = 0;
              rasterFallbackPageCount = 0;
            }
          } else {
            let compat;
            try {
              compat = await renderCompatibilityPdf(exportSourceBytes);
            } catch (compatError) {
              if (compatError instanceof OverlayRenderError) {
                return { ok: false, message: compatError.message };
              }
              throw compatError;
            }
            pdfBytes = compat.bytes;
            disclosures.push(...compat.notes);
          }

          if (effectiveMode === 'compatibility-render') {
            // D6: this path rasterises every added object. Say so rather than let the
            // user discover it when they try to select the text they just typed.
            disclosures.push(
              'Added elements are rendered as high-resolution images (3×) in the exported file and will not be selectable or searchable as text.',
            );
          }
          if (pagesWithCanvasObjects.size > 0
            && effectiveMode === 'structure-preserving'
            && vectorizedPageCount === 0
            && rasterFallbackPageCount === 0) {
            disclosures.push(
              `Added elements on ${pagesWithCanvasObjects.size} page(s) were rasterized in the exported file; the original page content underneath is unchanged.`,
            );
          }

          const verification = await verifyGeneratedPdf({
            mode: effectiveMode,
            sourceBytes: originalPdfBytes,
            outputBytes: pdfBytes,
            textReplacements: textMutations.map((mutation, index) => ({
              page: mutation.page,
              originalText: originalTextByMutation[index],
              replacementText: mutation.text,
            })),
            addedText: vectorTextForVerification,
            ...(hasRedactions ? {
              redactedPages: [...new Set(redactionMarks.map(mark => mark.page))],
              redactions: pdfEditorRedactionExpectations(redactionMarks),
            } : {}),
          });
          if (!verification.ok) {
            return {
              ok: false,
              message: `Export verification failed: ${verification.failures.join(' ')}`,
              verification,
            };
          }

          const planned = await applyPagePlanToBuild(pdfBytes);
          pdfBytes = planned.bytes;
          if (planned.declaredLosses.length) {
            disclosures.push(
              `Page changes rebuilt the document; these source structures were not carried forward: ${planned.declaredLosses.join(', ')}.`,
            );
          }
          const finalVerification = planned.pageCheck
            ? {
                ...verification,
                checks: [...verification.checks, planned.pageCheck],
                allowedLosses: [...verification.allowedLosses, ...planned.declaredLosses],
              }
            : verification;

          /**
           * Annotation dictionaries are written last, after the page plan, because
           * they are anchored to the output page they land on. The write is then
           * re-opened and every annotation is proven present by id, subtype and
           * page — a file whose annotations were dropped cannot be delivered
           * just because the rest of the export verified.
           */
          let annotationVerification: Awaited<ReturnType<typeof verifyPdfEditorAnnotationExport>> | null = null;
          const editorAnnotations = snapshot.annotations ?? [];
          if (editorAnnotations.length > 0) {
            if (pageSize !== 'original') {
              return {
                ok: false,
                message:
                  'Annotations can only be exported at the original page size. '
                  + 'Change the page size back to Original, or remove the annotations, before exporting.',
              };
            }
            const outputAnnotations = mapPdfEditorAnnotationsToOutput(
              editorAnnotations,
              snapshot.pagePlan?.entries ?? null,
            );
            try {
              const annotated = await exportPdfEditorAnnotations({
                source: pdfBytes,
                annotations: outputAnnotations,
              });
              pdfBytes = annotated.bytes;
            } catch (annotationError) {
              return {
                ok: false,
                message: annotationError instanceof Error
                  ? annotationError.message
                  : 'The annotations could not be written into the exported file.',
              };
            }
            annotationVerification = await verifyPdfEditorAnnotationExport({
              outputBytes: pdfBytes,
              expectations: pdfEditorAnnotationExpectations(outputAnnotations),
            });
            if (!annotationVerification.ok) {
              return {
                ok: false,
                message: `Export verification failed: ${annotationVerification.failures.join(' ')}`,
                verification: {
                  ...finalVerification,
                  ok: false,
                  checks: [...finalVerification.checks, ...annotationVerification.checks],
                  failures: [...finalVerification.failures, ...annotationVerification.failures],
                },
              };
            }
            disclosures.push(
              `${outputAnnotations.length} annotation${outputAnnotations.length === 1 ? '' : 's'} written into the exported file and verified by id after reopening.`,
            );
          }

          return {
            ok: true,
            pdfBytes,
            fileName: `mycloove_edited_${sourceFile.name}`,
            effectiveMode,
            verification: annotationVerification
              ? {
                  ...finalVerification,
                  checks: [...finalVerification.checks, ...annotationVerification.checks],
                }
              : finalVerification,
            disclosures,
            pageImpact: planned.pageImpact,
            prePlanBytes: planned.prePlanBytes,
            requiredConfirmation,
          };
        } catch (buildError: unknown) {
          const message = buildError instanceof Error ? buildError.message : 'Export failed';
          console.error('Export build failed:', buildError);
          return { ok: false, message };
        }

        /**
         * Apply the page plan as the final structural step.
         *
         * Text edits and canvas overlays have already been written onto their
         * source pages, so a rebuild carries them with the page. The page plan
         * verifier proves order, count and rotation on the real output; the
         * approval gate runs later, at delivery, because a preview of a
         * confirmable page plan is still a truthful preview.
         */
        async function applyPagePlanToBuild(bytes: Uint8Array): Promise<{
          bytes: Uint8Array;
          pageImpact: PdfEditorPageExportImpact | null;
          prePlanBytes: Uint8Array | null;
          pageCheck: { id: string; status: 'passed'; detail: string } | null;
          declaredLosses: string[];
        }> {
          const session = pageSession;
          if (!isPdfEditorFeatureEnabled('pageOperations') || !session || !pdfEditorPageSessionHasChanges(session)) {
            return { bytes, pageImpact: null, prePlanBytes: null, pageCheck: null, declaredLosses: [] };
          }

          const decision = decidePdfEditorPageExportStrategy(session.plan);
          const planImpact = describePdfEditorPageSessionExport(session, preflightReport);
          const planned = await exportPdfEditorPagePlan({ source: bytes, plan: session.plan });
          const pageVerification = await verifyGeneratedPdfEditorPagePlan({
            plan: session.plan,
            decision,
            sourceBytes: bytes,
            outputBytes: planned.bytes,
          });
          if (!pageVerification.ok) {
            throw new Error(
              `Page export verification failed: ${pageVerification.failures.join(' ')}`,
            );
          }
          return {
            bytes: planned.bytes,
            pageImpact: planImpact,
            prePlanBytes: bytes,
            pageCheck: {
              id: 'page-plan',
              status: 'passed',
              detail: `Page plan verified as ${decision.strategy}; output order, count and rotation match the plan.`,
            },
            declaredLosses: [...decision.declaredLosses],
          };
        }

        /**
         * Turn an engine refusal into a result, offering the user the acceptance
         * the engine asked for when — and only when — it named one.
         */
        function refusal(
          message: string,
          source: { error?: string | null; report?: Parameters<typeof classifyServerTextEditConsent>[0]['report'] },
        ): PdfEditorExportBuild {
          const requested = classifyServerTextEditConsent(source);
          if (!requested) return { ok: false, message };
          return {
            ok: false,
            message,
            consent: requested,
            impact: buildServerTextEditConsentImpact(
              requested,
              decidePdfEditorExportMode({
                pageSize,
                hasTextEdits: textMutations.length > 0,
                hasCanvasObjects: pagesWithCanvasObjects.size > 0,
              }),
            ),
          };
        }

        async function renderCompatibilityPdf(sourceBytes: ArrayBuffer | Uint8Array): Promise<{ bytes: Awaited<ReturnType<typeof pdfDoc.save>>; notes: string[] }> {
          const compatNotes: string[] = [];
          const { PDFDocument, degrees } = await import('pdf-lib');
          const pdfDoc = await PDFDocument.load(sourceBytes, { updateMetadata: false });
          const pages = pdfDoc.getPages();
          for (let p = 1; p <= sourcePageCount; p++) {
            const selectedSize = pageSize === 'original' ? await getBuildPageDims(p) : PAGE_SIZE_PRESETS[pageSize];
            const pdfPage = pages[p - 1];
            if (!selectedSize || !pdfPage) continue;

            // Fill mapping ("zoom metaphor"): content and every edit map onto
            // the chosen size exactly, preserving each element's relative
            // position; extreme aspect mismatch auto-rotates instead. For
            // "original" the fill computation yields the identity — no resize,
            // no move — so one code path serves both. The geometry helpers
            // work in the page's own user space; PDF.js viewport dims are
            // viewer-space and swap for rotated pages, so derive everything
            // from the raw box instead.
            const { width: rawWidth, height: rawHeight } = pdfPage.getSize();
            const rotation = normalizePdfRotation(pdfPage.getRotation().angle);
            const fill = computePageSizeFitFill({
              rawWidth,
              rawHeight,
              rotation,
              ...(pageSize === 'original' ? {} : {
                targetWidth: selectedSize.width,
                targetHeight: selectedSize.height,
              }),
            });
            if (fill.rotateForFit) {
              pdfPage.setRotation(degrees(fill.effectiveRotation));
            }
            if (fill.newSize) {
              pdfPage.setSize(fill.newSize.width, fill.newSize.height);
            }
            if (fill.scaleX !== 1 || fill.scaleY !== 1) {
              pdfPage.scaleContent(fill.scaleX, fill.scaleY);
              pdfPage.scaleAnnotations(fill.scaleX, fill.scaleY);
            }
            const overlayMeta = {
              rotation: fill.effectiveRotation,
              pageWidth: fill.newSize?.width ?? rawWidth,
              pageHeight: fill.newSize?.height ?? rawHeight,
            };
            const overlayQuarter = overlayMeta.rotation === 90 || overlayMeta.rotation === 270;
            const sourceQuarter = rotation === 90 || rotation === 270;
            const sourceDisplayWidth = sourceQuarter ? rawHeight : rawWidth;
            const sourceDisplayHeight = sourceQuarter ? rawWidth : rawHeight;
            const targetDisplayWidth = overlayQuarter ? overlayMeta.pageHeight : overlayMeta.pageWidth;
            const targetDisplayHeight = overlayQuarter ? overlayMeta.pageWidth : overlayMeta.pageHeight;
            const overlayScale = pageSize === 'original' ? null : {
              scaleX: targetDisplayWidth / Math.max(1, sourceDisplayWidth),
              scaleY: targetDisplayHeight / Math.max(1, sourceDisplayHeight),
              width: targetDisplayWidth,
              height: targetDisplayHeight,
            };

            if (pageSize !== 'original') {
              if (fill.rotateForFit) {
                compatNotes.push('The page was rotated to match the chosen size while keeping every edit in its relative position.');
              } else if (fill.distorted) {
                compatNotes.push('Page content was adjusted to fit the selected page size, which may introduce a slight change in proportions.');
              }
            }

            const overlayUrl = pageSize !== 'original' && pagesWithCanvasObjects.has(p)
              ? await getCompositedResizedPageDataUrl(
                sourceBytes,
                p,
                targetDisplayWidth,
                targetDisplayHeight,
                3,
              )
              : await buildOverlay(p, 3, overlayScale);
            if (overlayUrl) {
              const overlayBytes = await fetch(overlayUrl).then(res => res.arrayBuffer());
              const overlayImage = await pdfDoc.embedPng(overlayBytes);
              const overlay = computeOverlayPlacement({
                layout: {
                  fitScale: 1,
                  translateX: 0,
                  translateY: 0,
                  offsetX: 0,
                  offsetY: 0,
                  contentWidth: targetDisplayWidth,
                  contentHeight: targetDisplayHeight,
                },
                rotation: overlayMeta.rotation,
                pageWidth: overlayMeta.pageWidth,
                pageHeight: overlayMeta.pageHeight,
              });
              pdfPage.drawImage(overlayImage, {
                x: overlay.x,
                y: overlay.y,
                width: overlay.width,
                height: overlay.height,
                rotate: degrees(overlay.rotateDegrees),
                opacity: 1,
              });
            } else if (pagesWithCanvasObjects.has(p)) {
              // Same contract as the structure-preserving path: a page the user
              // edited is never exported without its edits, and never silently.
              throw new OverlayRenderError(
                `The edits on page ${p} could not be rendered into the export. Export was stopped rather than save the page without them. Please try again; if this keeps happening, reload the document (your edits are saved locally) and export once more.`,
              );
            }
          }

          return { bytes: await pdfDoc.save(), notes: compatNotes };

          async function getCompositedResizedPageDataUrl(
            source: ArrayBuffer | Uint8Array,
            pageNumber: number,
            targetDisplayWidth: number,
            targetDisplayHeight: number,
            multiplier: number,
          ) {
            const pdfjsLib = await import('pdfjs-dist');
            pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
              'pdfjs-dist/build/pdf.worker.min.mjs',
              import.meta.url,
            ).toString();

            const sourceView = source instanceof Uint8Array ? source : new Uint8Array(source);
            const loadingTask = pdfjsLib.getDocument({ data: clonePdfBytes(sourceView) });
            try {
              const renderedDoc = await loadingTask.promise;
              const renderedPage = await renderedDoc.getPage(pageNumber);
              const sourceViewport = renderedPage.getViewport({ scale: multiplier });
              const sourceCanvas = document.createElement('canvas');
              sourceCanvas.width = Math.max(1, Math.round(sourceViewport.width));
              sourceCanvas.height = Math.max(1, Math.round(sourceViewport.height));
              const sourceCtx = sourceCanvas.getContext('2d');
              if (!sourceCtx) throw new Error('This browser could not provide a 2D canvas for visual export.');
              sourceCtx.fillStyle = '#ffffff';
              sourceCtx.fillRect(0, 0, sourceCanvas.width, sourceCanvas.height);
              await renderedPage.render({
                canvasContext: sourceCtx,
                viewport: sourceViewport,
                canvas: sourceCanvas,
              }).promise;

              const originalOverlayUrl = await buildOverlay(pageNumber, multiplier);
              if (originalOverlayUrl) {
                await drawImageUrl(sourceCtx, originalOverlayUrl, sourceCanvas.width, sourceCanvas.height);
              }

              const targetCanvas = document.createElement('canvas');
              targetCanvas.width = Math.max(1, Math.round(targetDisplayWidth * multiplier));
              targetCanvas.height = Math.max(1, Math.round(targetDisplayHeight * multiplier));
              const targetCtx = targetCanvas.getContext('2d');
              if (!targetCtx) throw new Error('This browser could not provide a 2D canvas for visual export.');
              targetCtx.fillStyle = '#ffffff';
              targetCtx.fillRect(0, 0, targetCanvas.width, targetCanvas.height);
              targetCtx.drawImage(sourceCanvas, 0, 0, targetCanvas.width, targetCanvas.height);
              return targetCanvas.toDataURL('image/png');
            } finally {
              await loadingTask.destroy().catch(() => {});
            }
          }
        }
      }
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : 'Export failed';
      console.error('Export build failed:', e);
      return { ok: false, message };
    }
  }, [
    state.pdfFile,
    state.pageSize,
    state.sourcePageCount,
    state.preflightReport,
    state.grantedTextEditConsent,
    commitAllEdits,
    snapshotAllFabricPages,
    getOverlayDataUrl,
    getPageBaseDims,
    getTargetPageSize,
    getTextBlocks,
    getExportRevision,
    serializeDocumentSnapshot,
  ]);

  type ExportPdfResult =
    | {
        ok: true;
        fileName: string;
        verification: PdfPostExportVerification;
        /** Fidelity downgrades the engine performed. Empty means none. */
        disclosures: string[];
      }
    | {
        ok: false;
        message: string;
        impact?: PdfExportImpact;
        verification?: PdfPostExportVerification;
        /** Loss the engine will accept if the user grants it. See `buildExportedPdf`. */
        consent?: ServerTextEditConsentRequest;
        /**
         * A destructive page plan awaits acknowledgement. Export is refused
         * until the returned token is passed back as `pageApprovalToken`.
         */
        pageImpact?: PdfEditorPageExportImpact;
        /** Exact authoring revision whose consequences were presented. */
        approvalRevision?: string;
        processingRequired?: boolean;
      };

  /**
   * Deliver a build to the user's disk.
   *
   * Everything that decides *what* the file contains happened in
   * `buildExportedPdf`; this function only gates on consent and hands the bytes
   * to the browser. If the preview already built these bytes, they are reused
   * from the cache — the file is then provably the previewed document, not a
   * second attempt at it.
   */
  const exportPdf = useCallback(async (
    options: {
      confirmedMode?: PdfEditorExportMode;
      consent?: ServerTextEditConsentRequest | null;
      pageApprovalToken?: string;
      approvalRevision?: string;
      /**
       * Set only after the user has seen the redaction consequences. The bytes
       * are already built and cached; this is an honesty gate, not a rebuild.
       */
      redactionApproved?: boolean;
    } = {},
  ): Promise<ExportPdfResult> => {
    if (!state.pdfFile) return { ok: false, message: 'Open a PDF before exporting.' };

    commitAllEdits();
    snapshotAllFabricPages();
    const sessionId = documentSessionRef.current;
    const revision = getExportRevision();
    const isCurrent = () => sessionId === documentSessionRef.current && revision === getExportRevision();
    if ((options.approvalRevision && options.approvalRevision !== revision)
      || (options.consent && options.approvalRevision !== revision)) {
      return { ok: false, message: 'The document changed after this review. Review the current revision before approving the export.' };
    }
    set({ isExporting: true });
    try {
      const build = await buildExportedPdf({ consent: options.consent });
      if (!isCurrent()) return { ok: false, message: 'The document changed during export. Review the current revision and retry.' };
      if (!build.ok) {
        return {
          ok: false,
          message: build.message,
          approvalRevision: revision,
          ...(build.impact ? { impact: build.impact } : {}),
          ...(build.verification ? { verification: build.verification } : {}),
          ...(build.consent ? { consent: build.consent } : {}),
          ...(build.processingRequired ? { processingRequired: true } : {}),
        };
      }

      if (build.pageImpact) {
        const session = pageSessionRef.current;
        if (!session) {
          return { ok: false, message: 'The page plan is no longer available. Reopen the document.', pageImpact: build.pageImpact };
        }
        const suppliedApproval = options.approvalRevision === revision
          && options.pageApprovalToken === build.pageImpact.approvalToken;
        const approvedSession = suppliedApproval
          ? approvePdfEditorPageSession(session, build.pageImpact)
          : { ...session, approvedToken: pageApprovalRevisionRef.current === revision ? session.approvedToken : undefined };
        if (build.pageImpact.requiresConfirmation && !isPdfEditorPageSessionApproved(approvedSession)) {
          return {
            ok: false,
            message: 'This page plan changes the document. Review the page changes before downloading.',
            pageImpact: build.pageImpact,
            approvalRevision: revision,
          };
        }
        if (suppliedApproval) {
          pageSessionRef.current = approvedSession;
          pageApprovalRevisionRef.current = revision;
        }

        // Delivery goes through the Phase 3D gate, but the gate is handed the
        // already-previewed bytes instead of re-exporting. That is what keeps
        // P = E structural: the gate proves the previewed bytes against the
        // disclosed plan, and the download can only be those bytes.
        if (build.prePlanBytes) {
          const pageDecision = decidePdfEditorPageExportStrategy(approvedSession.plan);
          const gate = await exportPdfEditorPageSession({
            session: approvedSession,
            source: build.prePlanBytes,
            report: state.preflightReport,
            deps: {
              exportPagePlan: async () => ({ bytes: build.pdfBytes, decision: pageDecision }),
            },
          });
          if (!isCurrent()) return { ok: false, message: 'The document changed during export. Review the current revision and retry.' };
          if (gate.outcome !== 'exported') {
            return {
              ok: false,
              message: gate.reason,
              ...(gate.kind === 'refused' ? { pageImpact: build.pageImpact } : {}),
            };
          }
        }
      }

      if (build.requiredConfirmation.requiresConfirmation
        && (options.approvalRevision !== revision || options.confirmedMode !== build.requiredConfirmation.decision.mode)) {
        return {
          ok: false,
          message: 'Review the export consequences before downloading.',
          impact: build.requiredConfirmation,
          approvalRevision: revision,
        };
      }

      // Redaction is irreversible in the downloaded file, so a successful
      // build is not enough: the user must have seen the consequences. The
      // build stays cached, so confirming downloads the exact previewed bytes.
      if (redactionMarksRef.current.length > 0
        && (!options.redactionApproved || options.approvalRevision !== revision)) {
        return {
          ok: false,
          message: 'Review the redactions before downloading.',
          impact: build.requiredConfirmation,
          approvalRevision: revision,
        };
      }

      commitAllEdits();
      snapshotAllFabricPages();
      if (!isCurrent()) return { ok: false, message: 'The document changed during export. Review the current revision and retry.' };
      set({
        lastExportVerification: build.verification,
        lastExportDisclosures: build.disclosures,
      });
      // The bytes exist and stay cached, so accepting the impact costs another
      // click and no rebuild — and the file they get is the one they were shown.
      const pdfBytes = build.pdfBytes;
      const pdfArrayBuffer = pdfBytes.buffer.slice(
        pdfBytes.byteOffset,
        pdfBytes.byteOffset + pdfBytes.byteLength,
      ) as ArrayBuffer;
      const blob     = new Blob([pdfArrayBuffer], { type: 'application/pdf' });
      const url      = URL.createObjectURL(blob);
      const a        = Object.assign(document.createElement('a'), {
        href:     url,
        download: build.fileName,
      });
      a.style.display = 'none';
      document.body.appendChild(a);
      try {
        a.click();
      } finally {
        a.remove();
        // Revoking immediately (or on the next task) can race the browser's
        // download hand-off. Keep the immutable Blob URL alive long enough for
        // Chromium, Firefox, and Safari to acquire it, then release it.
        window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
      }
      return {
        ok: true,
        fileName: a.download,
        verification: build.verification,
        disclosures: build.disclosures,
      };
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : 'Export failed';
      console.error('Export failed:', e);
      return { ok: false, message };
    } finally {
      if (sessionId === documentSessionRef.current) set({ isExporting: false });
    }
  }, [state.pdfFile, state.preflightReport, buildExportedPdf, commitAllEdits, getExportRevision, snapshotAllFabricPages, set]);

  type RenderExportedPageResult =
    | {
        ok: true;
        width: number;
        height: number;
        pixelWidth: number;
        pixelHeight: number;
        /** Downgrades the engine performed. The preview must show these. */
        disclosures: string[];
        /**
         * Non-null when Save will ask the user to accept something first. The
         * page on screen is still the page they would get.
         */
        pendingConfirmation: PdfExportImpact | null;
      }
    | {
        ok: false;
        message: string;
        /** Set when the refusal is recoverable by granting the loss. */
        impact?: PdfExportImpact;
        consent?: ServerTextEditConsentRequest;
        processingRequired?: boolean;
      };

  /**
   * Render a page of the export **as it will be saved**, onto `target`.
   *
   * This is the only preview the editor has, and it renders the export's own
   * bytes with PDF.js. There is deliberately no approximation to fall back on:
   * when the build fails or is refused there is nothing truthful to draw, and a
   * comforting picture of a document the user cannot actually get is the exact
   * lie the module forbids.
   */
  const renderExportedPageToCanvas = useCallback(async (
    page: number,
    target: HTMLCanvasElement,
    options: { outputScale?: number } = {},
  ): Promise<RenderExportedPageResult> => {
    const session = documentSessionRef.current;
    const build = await buildExportedPdf();
    if (!build.ok) {
      return {
        ok: false,
        message: build.message,
        ...(build.impact ? { impact: build.impact } : {}),
        ...(build.consent ? { consent: build.consent } : {}),
        ...(build.processingRequired ? { processingRequired: true } : {}),
      };
    }
    const revision = getExportRevision();
    const isCurrent = () => session === documentSessionRef.current && revision === getExportRevision();
    const stalePreview = { ok: false as const, message: 'The document changed while rendering the preview. Review the current revision.' };
    if (!isCurrent()) return stalePreview;

    // The default follows the device rather than a fixed multiplier: a retina
    // screen gets its own ratio's worth of detail, and the caller that knows
    // the panel's zoom (and so how large this raster will be displayed) passes
    // its own scale through the same pure helper.
    const outputScale = options.outputScale
      ?? resolvePdfEditorPreviewOutputScale({ devicePixelRatio: currentDevicePixelRatio() });
    const pdfjsLib = await import('pdfjs-dist');
    pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
      'pdfjs-dist/build/pdf.worker.min.mjs',
      import.meta.url,
    ).toString();

    // PDF.js transfers the buffer it is given to its worker, which would detach
    // the cached bytes and leave Save with an empty file. Hand it a copy and the
    // cached array stays intact for delivery.
    const loadingTask = pdfjsLib.getDocument({ data: clonePdfBytes(build.pdfBytes) });
    try {
      const exportedDoc = await loadingTask.promise;
      const clampedPage = Math.min(Math.max(1, page), exportedDoc.numPages);
      const exportedPage = await exportedDoc.getPage(clampedPage);
      if (!isCurrent()) return stalePreview;
      const viewport = exportedPage.getViewport({ scale: outputScale });

      target.width = Math.round(viewport.width);
      target.height = Math.round(viewport.height);
      const ctx = target.getContext('2d');
      if (!ctx) return { ok: false, message: 'This browser could not provide a 2D canvas for the preview.' };

      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, target.width, target.height);
      // The exported page paints its own background; white underneath only keeps
      // a transparent PDF from showing the panel through it.
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, target.width, target.height);
      // `annotationMode: ENABLE` makes PDF.js paint the annotation appearance
      // streams into this canvas. This is what keeps P = E true for W4: the
      // preview shows the same annotation dictionaries the download contains,
      // rather than a second overlay drawn by the editor.
      await exportedPage.render({ canvasContext: ctx, viewport, canvas: target, annotationMode: 1 }).promise;
      if (!isCurrent()) return stalePreview;

      return {
        ok: true,
        width: viewport.width / outputScale,
        height: viewport.height / outputScale,
        pixelWidth: target.width,
        pixelHeight: target.height,
        disclosures: build.disclosures,
        pendingConfirmation: build.requiredConfirmation.requiresConfirmation
          ? build.requiredConfirmation
          : null,
      };
    } finally {
      await loadingTask.destroy().catch(() => {});
    }
  }, [buildExportedPdf, getExportRevision]);

  const prepareOcrCopy = useCallback(async (): Promise<PdfEditorOcrCopyRequest | null> => {
    if (!currentFileRef.current || isResettingSessionRef.current || ocrControllerRef.current) return null;
    commitAllEdits();
    snapshotAllFabricPages();
    const session = documentSessionRef.current;
    const revision = getExportRevision();
    const snapshot = JSON.parse(serializeDocumentSnapshot()) as EditorDocumentSnapshot;
    let hasWork = snapshot.pageSize !== 'original' || snapshot.annotations.length > 0 || snapshot.redactionMarks.length > 0
      || countFabricCanvasObjects(Object.values(snapshot.canvasStates)) > 0
      || (pageSessionRef.current ? pdfEditorPageSessionHasChanges(pageSessionRef.current) : false)
      || restoringPagesRef.current.size > 0 || failedRestorePagesRef.current.size > 0;
    const sourceDoc = getPdfDocOrNull();
    if (!sourceDoc) return null;
    for (const [key, edit] of Object.entries(snapshot.textEdits)) {
      const [page, index] = key.split(':').map(Number);
      const block = (await getTextBlocks(page, 1, sourceDoc)).find(candidate => candidate.index === index);
      if (!block || isEffectiveTextEdit(edit, block)) { hasWork = true; break; }
    }
    if (session !== documentSessionRef.current || revision !== getExportRevision()) return null;
    if (hasWork) {
      setState(prev => ({ ...prev, ocrFailed: true, ocrMessage: 'OCR uses the original PDF, not this edited draft. Export your work and open that copy first. Nothing was uploaded or replaced.' }));
      return null;
    }
    const request = { session, revision };
    ocrCopyRequestRef.current = request;
    setState(prev => ({ ...prev, ocrFailed: false, ocrMessage: null }));
    return request;
  }, [commitAllEdits, snapshotAllFabricPages, getExportRevision, serializeDocumentSnapshot, getTextBlocks]);

  const runOcrCopy = useCallback(async (request: PdfEditorOcrCopyRequest) => {
    commitAllEdits();
    snapshotAllFabricPages();
    const source = currentFileRef.current;
    const ownsSession = () => request.session === documentSessionRef.current;
    const isCurrent = () => ownsSession() && request.revision === getExportRevision();
    if (!source || ocrControllerRef.current || ocrCopyRequestRef.current !== request || !ownsSession()) return false;
    if (!isCurrent()) {
      setState(prev => ({ ...prev, ocrFailed: true, ocrMessage: 'The document changed after the OCR review. Export your work and open that copy before trying OCR. Nothing was uploaded or replaced.' }));
      return false;
    }
    if (!processingConsentRef.current.isAllowed(request.session)) return false;
    const controller = new AbortController();
    ocrControllerRef.current = controller;
    serverBuildsRef.current.add(controller);
    setState(prev => ({ ...prev, isOcrProcessing: true, isServerProcessing: true, ocrFailed: false, ocrMessage: 'Processing the full PDF on the server to make an English searchable raster copy.' }));
    try {
      const form = new FormData();
      form.append('file', source, source.name || 'document.pdf');
      form.append('language', 'eng');
      const response = await fetch('/api/pdf-editor/ocr', { method: 'POST', body: form, cache: 'no-store', signal: controller.signal });
      const body = await response.json() as { pdf?: string; error?: string; status?: string };
      if (!isCurrent()) {
        if (ownsSession()) setState(prev => ({ ...prev, ocrFailed: true, ocrMessage: 'The document changed while OCR was running. Its copy was not downloaded and your current work was not replaced. Export and open a copy before retrying.' }));
        return false;
      }
      if (!response.ok || body.status === 'refused' || !body.pdf) throw new Error(body.error || 'OCR could not prepare a searchable copy. The current PDF is unchanged.');
      const bytes = Uint8Array.from(atob(body.pdf), char => char.charCodeAt(0));
      if (!hasPdfSignature(bytes)) throw new Error('OCR returned no usable PDF. The current document is unchanged.');
      const url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
      const link = Object.assign(document.createElement('a'), { href: url, download: source.name.replace(/\.pdf$/i, '') + '-ocr.pdf' });
      document.body.appendChild(link);
      try { link.click(); } finally { link.remove(); window.setTimeout(() => URL.revokeObjectURL(url), 30_000); }
      setState(prev => ({ ...prev, ocrMessage: 'English searchable raster copy downloaded. The open PDF is unchanged. OCR text may be inaccurate; it is not faithful visible scan editing.' }));
      return true;
    } catch (error) {
      if (ownsSession()) setState(prev => ({ ...prev, ocrFailed: true, ocrMessage: error instanceof Error ? error.message : 'OCR failed. The open PDF is unchanged.' }));
      return false;
    } finally {
      serverBuildsRef.current.delete(controller);
      if (ocrControllerRef.current === controller) ocrControllerRef.current = null;
      if (ownsSession()) setState(prev => ({ ...prev, isOcrProcessing: false, isServerProcessing: serverBuildsRef.current.size > 0 }));
    }
  }, [commitAllEdits, snapshotAllFabricPages, getExportRevision]);

  /**
   * Record the loss the user accepted in the export dialog, and return the full
   * grant so the caller can retry immediately.
   *
   * It returns the merged value rather than relying on the state it just set,
   * because a retry in the same tick would still read the previous render's
   * value and re-trigger the dialog it just answered.
   *
   * Grants accumulate: an encrypted document is refused for fidelity before any
   * box is inspected, so the unnamed-text guard can only appear on the retry, and
   * dropping the earlier grant there would bounce the user between two dialogs
   * forever. Bumping `editVersion` is what makes the preview rebuild under the
   * new grant.
   */
  const grantTextEditConsent = useCallback((
    requested: ServerTextEditConsentRequest,
    approvalRevision: string | null,
  ): ServerTextEditConsentRequest | null => {
    commitAllEdits();
    snapshotAllFabricPages();
    if (!approvalRevision || approvalRevision !== getExportRevision()) return null;
    const previous = textConsentRef.current?.revision === approvalRevision ? textConsentRef.current.consent : null;
    const consent = mergeServerTextEditConsent(previous, requested);
    textConsentRef.current = { revision: approvalRevision, consent };
    setState(prev => ({
      ...prev,
      grantedTextEditConsent: consent,
      editVersion: prev.editVersion + 1,
    }));
    return consent;
  }, [commitAllEdits, getExportRevision, snapshotAllFabricPages]);


  useEffect(() => {
    const page = resolveSourcePage(state.currentPage);
    syncPageLayers(getLiveFabric(page));
  }, [getLiveFabric, resolveSourcePage, state.currentPage, syncPageLayers]);

  return {
    state,
    set,
    /** Bumped when the device's pixel ratio changes; callers may key on it. */
    dprEpoch,
    loadPdf,
    renderPage,
    registerFabricCanvas,
    unregisterFabricCanvas,
    snapshotFabricPage,
    snapshotAllFabricPages,
    addTextbox,
    addEmoji,
    addImage,
    addShape,
    addShapeFromDrag,
    getTextBlocks,
    getOriginalTextEdit,
    getEditedText,
    setTextEdit,
    selectOriginalTextBlock,
    clearOriginalTextSelection,
    toggleRedactionMark,
    unmarkRedaction,
    clearRedactions,
    toggleAnnotationForBlock,
    addAnnotationAtPoint,
    replyToAnnotation,
    updateAnnotation,
    removeAnnotation,
    selectAnnotation,
    setAnnotationKind,
    setAnnotationStyle,
    startSignature,
    stopSignature,
    applyStyleToSelection,
    undo,
    redo,
    deleteSelected,
    updateSelectedObjectGeometry,
    nudgeSelectedObject,
    updateSelectedObjectStyle,
    toggleSelectedObjectLock,
    toggleSelectedObjectHidden,
    duplicateSelectedObject,
    copySelectedObject,
    pasteObjectToCurrentPage,
    alignSelectedObjects,
    distributeSelectedObjects,
    selectPageLayer,
    togglePageLayerLock,
    togglePageLayerHidden,
    movePageLayer,
    groupSelectedObjects,
    ungroupSelectedObject,
    isFabricTextEditing,
    exportPdf,
    grantTextEditConsent,
    requestProcessingConsent,
    confirmProcessingConsent,
    cancelProcessingConsent,
    prepareOcrCopy,
    runOcrCopy,
    clearCurrentRecovery,
    getExportRevision,
    flushAutosave,
    getRecoverableSession,
    restoreRecoverableSession,
    commitAllEdits,
    setPageSize,
    applyPageOperation,
    positionForSourcePage,
    getOverlayDataUrl,
    renderExportedPageToCanvas,
    getPageDisplaySize,
    getPageBaseDimensions,
    renderThumbnail,
    searchDocument,
    getDocumentOutline,
    getDocumentComments,
    HEADING_SIZES,
  };
}
