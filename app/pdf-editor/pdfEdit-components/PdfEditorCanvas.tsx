'use client';
// ─────────────────────────────────────────────────────────────
//  PdfEditorCanvas.tsx
//  Renders one PDF page via PDF.js onto a <canvas>,
//  then mounts a Fabric.js canvas on top for editing.
// ─────────────────────────────────────────────────────────────

import { Fragment, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { OriginalTextEdit, TextBlock, ToolType } from '../pdfEdit-hooks/usePdfEditor';
import { PDF_EDITOR_PAGE_SETTLE_PIXEL_BUDGET } from '../pdfEdit-utils/editorRenderSharpness';
import type { PdfEditorRedactionMark } from '../pdfEdit-utils/editorRedaction';
import { pdfEditorRedactionDisplayBox } from '../pdfEdit-utils/editorRedaction';

/**
 * Space between the first (interaction-budgeted) frame and the settle
 * re-render. Long enough to stay out of the way of an ongoing zoom gesture
 * (the stale guard drops the pass anyway if the effect re-runs), short enough
 * that the sharpened frame lands almost immediately after the click.
 */
const PDF_EDITOR_SETTLE_DELAY_MS = 180;
import {
  isPdfEditorTextMarkupKind,
  type PdfEditorAnnotation,
  type PdfEditorAnnotationKind,
} from '../pdfEdit-utils/editorAnnotations';
import {
  createPdfEditorDragGeometry,
  type PdfEditorDragGeometry,
  type PdfEditorDragShape,
} from '../pdfEdit-utils/editorShapeDrag';
import type { PdfEditorSnapGuide } from '../pdfEdit-utils/editorSnapping';
import {
  layoutPdfEditorTextControl,
  resizedTextControlExtent,
  PDF_EDITOR_TEXT_CONTROL_CHROME as TEXT_CONTROL_CHROME,
  type PdfEditorTextControlLayout,
} from '../pdfEdit-utils/editorTextControlLayout';

type FabricObjectLike = {
  type?: string;
  isEditing?: boolean;
  exitEditing?: () => void;
  enterEditing?: () => void;
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
  textAlign?: 'left' | 'center' | 'right';
};

type FabricPointerEvent = {
  e: Event;
};

type FabricCanvasLike = {
  setDimensions: (dim: { width: number; height: number }) => void;
  setZoom: (zoom: number) => void;
  calcOffset?: () => void;
  requestRenderAll?: () => void;
  dispose: () => void;
  isDrawingMode: boolean;
  freeDrawingBrush?: { color: string; width: number };
  selection?: boolean;
  defaultCursor: string;
  hoverCursor?: string;
  off: (eventName: string, handler?: (event: FabricPointerEvent) => void) => void;
  on: (eventName: string, handler: (event: FabricPointerEvent) => void) => void;
  getPointer: (event: Event) => { x: number; y: number };
  add: (object: FabricObjectLike) => void;
  setActiveObject: (object: FabricObjectLike) => void;
  getActiveObject: () => FabricObjectLike | null | undefined;
  remove: (object: FabricObjectLike) => void;
  renderAll: () => void;
  toJSON: (propertiesToInclude?: string[]) => Record<string, unknown>;
  loadFromJSON: (json: Record<string, unknown>, callback?: () => void) => void | Promise<void>;
  lowerCanvasEl?: HTMLCanvasElement | null;
  disposed?: boolean;
  destroyed?: boolean;
};

type FabricNamespaceLike = {
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
  Textbox: new (text: string, options: Record<string, unknown>) => FabricObjectLike;
  PencilBrush: new (canvas: FabricCanvasLike) => { color: string; width: number };
};

interface Props {
  page:          number;
  zoom:          number;
  activeTool:    ToolType;
  onReady:       (page: number, fc: FabricCanvasLike) => void | boolean | Promise<void | boolean>;
  onFailure?: (page: number, message: string | null) => void;
  renderPage:    (page: number, canvas: HTMLCanvasElement, zoom: number, pixelBudget?: number) => Promise<{ width: number; height: number; budgetLimited: boolean }>;
  getTextBlocks: (page: number, zoom: number) => Promise<TextBlock[]>;
  getOriginalTextEdit: (block: TextBlock) => OriginalTextEdit;
  getEditedText: (page: number, index: number, originalText: string) => string;
  setTextEdit:   (page: number, index: number, value: string, block?: TextBlock) => void;
  selectOriginalTextBlock: (block: TextBlock) => void;
  selectedOriginalTextKey: string | null;
  onBeforeDispose: (page: number) => void;
  /** Called once per mounted frame, when its first raster has been committed. */
  onFirstFrame?: () => void;
  searchHighlight?: { x: number; y: number; width: number; height: number } | null;
  /** W3 authoring state. Only consumed while the redact tool is active. */
  redactionMarks: readonly PdfEditorRedactionMark[];
  onToggleRedaction: (block: TextBlock) => void;
  onUnmarkRedaction: (id: string) => void;
  /** W4 drag-to-create: the hook owns object creation and history. */
  onShapeDragCreate?: (page: number, tool: PdfEditorDragShape, geometry: PdfEditorDragGeometry) => void;
  /** W4 snapping: guide lines in PDF points. */
  snapGuides?: readonly PdfEditorSnapGuide[];
  /** W4 annotations. */
  annotations?: readonly PdfEditorAnnotation[];
  annotationKind?: PdfEditorAnnotationKind;
  selectedAnnotationId?: string | null;
  onToggleAnnotation?: (block: TextBlock) => void;
  onAddAnnotationAt?: (page: number, point: { x: number; y: number }) => void;
  onSelectAnnotation?: (id: string | null) => void;
}

/**
 * The raster that is actually on screen, and the geometry it was drawn at.
 *
 * A page change and a zoom change both go through this value, and it only ever
 * moves in one step: the new raster is finished off-screen first, lands in a
 * single frame, and *then* this says so. That is what keeps the two layers in
 * agreement — the overlays below (text boxes, redaction marks, hotspots) are
 * positioned from the committed frame, never from the requested zoom, so a
 * raster and the boxes on it can never be at different scales while the next
 * page is still being drawn.
 *
 * The previous frame deliberately stays in place until the next one commits:
 * whatever is on screen keeps working — the user can still read it, and an
 * in-flight text selection is not yanked out from under a pointer.
 */
type CommittedFrame = {
  /** Source page the raster shows. */
  page: number;
  /** Display width, CSS pixels. */
  width: number;
  /** Display height, CSS pixels. */
  height: number;
  /** Display zoom the raster was drawn at. */
  zoom: number;
};

/** A block set is only ever displayed together with the frame it was measured on. */
type CommittedTextBlocks = {
  page: number;
  zoom: number;
  blocks: TextBlock[];
};

/** Stable identity for "no blocks to show", so dependants do not re-run on every render. */
const EMPTY_TEXT_BLOCKS: TextBlock[] = [];

export default function PdfEditorCanvas({
  page, zoom, activeTool, onReady, onFailure, renderPage,
  getTextBlocks, getOriginalTextEdit, getEditedText, setTextEdit,
  selectOriginalTextBlock, selectedOriginalTextKey, onBeforeDispose, onFirstFrame, searchHighlight,
  redactionMarks, onToggleRedaction, onUnmarkRedaction,
  onShapeDragCreate, snapGuides = [], annotations = [], annotationKind = 'highlight',
  selectedAnnotationId = null, onToggleAnnotation, onAddAnnotationAt, onSelectAnnotation,
}: Props) {
  const pdfCanvasRef    = useRef<HTMLCanvasElement>(null);
  const fabricCanvasRef = useRef<HTMLCanvasElement>(null);
  const fabricRef       = useRef<FabricCanvasLike | null>(null);
  const wrapRef         = useRef<HTMLDivElement>(null);
  const fabricNsRef     = useRef<FabricNamespaceLike | null>(null);
  const [frame, setFrame] = useState<CommittedFrame | null>(null);
  /** Latest committed frame, readable from callbacks that must not re-run on it. */
  const frameRef        = useRef<CommittedFrame | null>(null);
  const onFirstFrameRef = useRef(onFirstFrame);
  /** Fires once per mount: the first raster this component ever showed. */
  const firstFrameReportedRef = useRef(false);
  /**
   * Height each edit control's text currently needs, keyed `page:index`.
   *
   * Measured from the live element rather than computed, because only the
   * browser knows where a proportional font wraps. It is fed back through
   * `layoutPdfEditorTextControl`, which clamps it to the page — so a long
   * replacement grows its box downward and still cannot leave the paper.
   */
  const [contentHeights, setContentHeights] = useState<Record<string, number>>({});
  /** Reused for text metrics; never attached to the document. */
  const measureCanvasRef = useRef<HTMLCanvasElement | null>(null);
  /**
   * Sizes the user has dragged controls out to, keyed by {@link dragKeyOf}.
   *
   * Stored zoom-normalised - divided by the zoom on the way in by
   * `resizedTextControlExtent`, multiplied back on the way out - so a box dragged
   * at Actual size keeps the same size *relative to the page* when the user
   * switches to Fit page or Fit width. Storing device pixels here would make a
   * dragged box three times too big at the next preset: the same mixing of
   * display space and document space that the rest of this file was fixed for.
   *
   * Deliberately not cleared when the blocks reload. That happens on every zoom
   * change, and a size the user set by hand should outlive a zoom change.
   */
  const [userSizes, setUserSizes] = useState<Record<string, { width?: number; height?: number }>>({});
  const dragRef = useRef<{
    key: string;
    axis: 'x' | 'y' | 'xy';
    startX: number;
    startY: number;
    startWidth: number;
    startHeight: number;
  } | null>(null);
  const [renderingFrame, setRenderingFrame] = useState(false);
  const [pageFailure, setPageFailure] = useState<string | null>(null);
  const [layerFailure, setLayerFailure] = useState<string | null>(null);
  const [retryEpoch, setRetryEpoch] = useState(0);
  const callbacksRef = useRef({ onReady, onBeforeDispose, onShapeDragCreate, onAddAnnotationAt });
  callbacksRef.current = { onReady, onBeforeDispose, onShapeDragCreate, onAddAnnotationAt };
  const failure = pageFailure ?? layerFailure;
  useEffect(() => { onFailure?.(page, failure); }, [onFailure, page, failure]);
  const [blockSet, setBlockSet] = useState<CommittedTextBlocks | null>(null);
  /** Live rectangle for a drag-to-create shape, in CSS pixels. */
  const [shapePreview, setShapePreview] = useState<{ left: number; top: number; width: number; height: number } | null>(null);
  const shapeDragRef = useRef<{ start: { x: number; y: number } } | null>(null);
  const hasPageDimensions = frame !== null && frame.width > 0 && frame.height > 0;
  // Written during render, so the value read by an effect body or a cleanup is
  // always the frame the current UI was rendered from — the commit is atomic,
  // and every reader below participates in it.
  frameRef.current = frame;
  onFirstFrameRef.current = onFirstFrame;
  /** The zoom the caller most recently asked for. A raster drawn at an older
   * request is never committed: it would land on screen already stale. */
  const requestedZoomRef = useRef(zoom);
  requestedZoomRef.current = zoom;
  const framePage = frame?.page ?? null;
  /**
   * Everything the *displayed* layers are positioned from.
   *
   * `zoom` is what the caller has asked for; `displayZoom` is what is on screen
   * right now. They differ only while the next frame is being drawn — and in
   * that window the old raster is still the one the user is looking at, so the
   * overlays have to keep agreeing with it, not with the request.
   */
  const displayDims = { width: frame?.width ?? 0, height: frame?.height ?? 0 };
  const displayZoom = frame?.zoom ?? zoom;
  /** Overlays belong to a page only once that page's raster is the one on screen. */
  const showingRequestedPage = frame?.page === page;
  const textBlocks = blockSet && blockSet.page === frame?.page && blockSet.zoom === frame?.zoom
    ? blockSet.blocks
    : EMPTY_TEXT_BLOCKS;
  const textAreaRefs = useRef<Record<string, HTMLTextAreaElement | null>>({});
  const focusKeyRef = useRef<string | null>(null);
  const selectionRef = useRef<{ start: number; end: number } | null>(null);

  /**
   * Width the original run needs to stay on one line, in CSS pixels.
   *
   * Measured, not estimated: the control renders in a substitute font (PDF.js
   * reports a font *name* only), so the advance width the document recorded is
   * close but not equal to what this box needs. Off-screen canvas metrics use the
   * same shaping the DOM does; a whole pixel is added because the two round
   * sub-pixel fractions differently and being a fraction short still wraps.
   *
   * `edit` — not the block — supplies the font, so a user who switches the family
   * or turns on bold gets a box that fits that choice too.
   */
  const measuredRunWidth = (
    text: string,
    fontSize: number,
    edit: { fontFamily: string; bold: boolean; italic: boolean },
  ) => {
    const canvas = measureCanvasRef.current ??= document.createElement('canvas');
    const context = canvas.getContext('2d');
    if (!context) return 0;
    context.font = `${edit.italic ? 'italic ' : ''}${edit.bold ? '700 ' : '400 '}`
      + `${fontSize}px ${edit.fontFamily}, Helvetica, Arial, sans-serif`;
    return Math.ceil(context.measureText(text).width) + 1;
  };

  /**
   * Height the control's rendered font needs for one line of itself, CSS pixels.
   *
   * A box floored at one *line box* (`fontSize × lineHeight`) can still shave
   * its own glyphs: a proportional font's ascent+descent are usually taller
   * than 1.15 em, the real glyphs overshoot the line box symmetrically, and an
   * `overflow` control clips paint — not just layout — so the shaved top the
   * user reported is ink overflow the element never grows for.
   *
   * `fontBoundingBoxAscent/Descent` are the font's own line extents for the
   * exact family, weight and pixel size the control renders in. Their sum is
   * therefore the smallest height that cannot shave anything. Browsers without
   * the metrics return 0 — no floor, which is the behaviour this replaces.
   */
  const measuredFontLineExtent = (
    fontSize: number,
    edit: { fontFamily: string; bold: boolean; italic: boolean },
  ) => {
    const canvas = measureCanvasRef.current ??= document.createElement('canvas');
    const context = canvas.getContext('2d');
    if (!context || !(fontSize > 0)) return 0;
    context.font = `${edit.italic ? 'italic ' : ''}${edit.bold ? '700 ' : '400 '}`
      + `${fontSize}px ${edit.fontFamily}, Helvetica, Arial, sans-serif`;
    const metrics = context.measureText(' ');
    const extent = metrics.fontBoundingBoxAscent + metrics.fontBoundingBoxDescent;
    return Number.isFinite(extent) && extent > 0 ? extent : 0;
  };

  /**
   * Key a dragged size is stored under: the block's position *and* its original
   * text.
   *
   * `page:index` alone is not stable across documents. This component is keyed by
   * page number, so opening another file reuses the same mounted canvas for a
   * different set of runs, and a height dragged in the old document would be
   * applied to whatever now sits at that index. The original text does not change
   * while a document is open - edits are tracked elsewhere - so appending it drops
   * a stored size exactly when the run underneath it changes, and never merely
   * because the user zoomed or typed.
   */
  const dragKeyOf = (block: TextBlock) => `${block.page}:${block.index}:${block.text}`;

  /**
   * Thickness of a drag edge, CSS pixels.
   *
   * Grabbable at ordinary sizes, and never more than a third of the box it sits
   * on. Kept thin — a 2px hairline grip — so the handle reads as a subtle edge,
   * not heavy chrome. A flat 6px grip is exactly the fixed-size chrome that had
   * to come out of this control: on a 6pt line at Fit page the box itself is
   * about 6px tall, and chrome that cannot scale with the page is what put
   * controls over their neighbours' text in the first place.
   */
  const dragEdgeThickness = (extent: number) => Math.max(2, Math.min(2.5, extent / 3));

  const beginTextControlResize = (
    block: TextBlock,
    axis: 'x' | 'y' | 'xy',
    layout: PdfEditorTextControlLayout,
    event: ReactPointerEvent<HTMLDivElement>,
  ) => {
    // Keeps the caret out of the textarea underneath, so a drag on the edge is a
    // drag and not also a click into the text.
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    // The box being dragged is the box being worked on. Selecting it is what
    // keeps its handles on screen for the whole drag, including once the pointer
    // has travelled outside the strip it started on.
    selectOriginalTextBlock(block);
    dragRef.current = {
      key: dragKeyOf(block),
      axis,
      startX: event.clientX,
      startY: event.clientY,
      startWidth: layout.width,
      // Store the content size, not the frame's display-only top clearance.
      startHeight: layout.height - layout.paddingTop,
    };
  };

  const continueTextControlResize = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag) return;
    const deltaX = event.clientX - drag.startX;
    const deltaY = event.clientY - drag.startY;
    if (drag.axis === 'xy') {
      // The corner drags both extents at once — each through the same
      // zoom-normalised, floor-clamped arithmetic as its single-axis sibling.
      setUserSizes(prev => ({
        ...prev,
        [drag.key]: {
          ...prev[drag.key],
          width: resizedTextControlExtent({ startExtent: drag.startWidth, delta: deltaX, zoom: displayZoom }),
          height: resizedTextControlExtent({ startExtent: drag.startHeight, delta: deltaY, zoom: displayZoom }),
        },
      }));
      return;
    }
    const horizontal = drag.axis === 'x';
    const extent = resizedTextControlExtent({
      startExtent: horizontal ? drag.startWidth : drag.startHeight,
      delta: horizontal ? deltaX : deltaY,
      zoom: displayZoom,
    });
    setUserSizes(prev => ({
      ...prev,
      [drag.key]: horizontal
        ? { ...prev[drag.key], width: extent }
        : { ...prev[drag.key], height: extent },
    }));
  };

  const endTextControlResize = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    dragRef.current = null;
  };

  /**
   * Border-box height this control's text needs, excluding frame-only clearance.
   *
   * `scrollHeight` is measured against the element's *current* box, so the
   * applied height has to come off first: a box already sized to one line
   * reports one line however much text it holds, and a box that grew once could
   * never shrink back. React's own inline value goes straight back, in the same
   * tick, before the browser paints. The border is added because `scrollHeight`
   * excludes it while the box is `border-box` — the layout function's other
   * extents are all border-box too, and mixing the two is how a control ends up
   * a hairline short of its own text.
   */
  const neededTextControlHeight = (el: HTMLTextAreaElement) => {
    const applied = el.style.height;
    el.style.height = 'auto';
    const measured = el.scrollHeight;
    el.style.height = applied;
    // The added top clearance is reapplied by layout; counting it here would
    // make the box grow again on every keystroke.
    const topClearance = Math.max(0, (parseFloat(el.style.paddingTop) || 0) - TEXT_CONTROL_CHROME.paddingY);
    return measured + 2 * TEXT_CONTROL_CHROME.borderWidth - topClearance;
  };

  const measureTextControl = (key: string) => {
    const el = textAreaRefs.current[key];
    if (!el) return;
    const measured = neededTextControlHeight(el);
    setContentHeights(prev => (
      Math.abs((prev[key] ?? 0) - measured) < 0.5 ? prev : { ...prev, [key]: measured }
    ));
  };

  const restoreTextAreaFocus = (key: string) => {
    if (activeTool !== 'editText') return;
    const el = textAreaRefs.current[key];
    if (!el) return;
    if (document.activeElement !== el) el.focus();
    if (selectionRef.current) {
      el.setSelectionRange(selectionRef.current.start, selectionRef.current.end);
    }
  };

  // ── Step 1: render the PDF page ────────────────────────────
  //
  // The raster is finished off-screen and only ever lands in one piece. A
  // detached buffer canvas does the drawing; the visible canvas is resized and
  // blitted from it at the end, in the same task. Nothing clears the live
  // canvas ahead of the next raster, which is exactly what removes the white
  // flash between pages — the previous frame stays readable right up to the
  // moment the new one is complete.
  useEffect(() => {
    const canvas = pdfCanvasRef.current;
    if (!canvas) return;
    let cancelled = false;
    let settleTimer: number | undefined;
    setPageFailure(null);
    const deadline = window.setTimeout(() => {
      if (cancelled) return;
      cancelled = true;
      setRenderingFrame(false);
      setPageFailure('The page took too long to render. Your edits are retained; retry the page.');
    }, 30_000);
    const buffer = document.createElement('canvas');
    const retryDelays = [0, 40, 120, 240, 400];

    /**
     * One frame, one step: size, blit, announce.
     *
     * The buffer carries the CSS size `renderPage` stamped on it, and it is
     * copied rather than recomputed — that string is the one set of numbers
     * every downstream coordinate (Fabric, snapping, text geometry, export)
     * was measured in, so raster and layout can never disagree about it.
     */
    const commit = (width: number, height: number) => {
      // The caller may have asked for another zoom while this raster was being
      // drawn (a page-change fit lands a few milliseconds after the click). A
      // frame drawn at the older request is not committed at all: the effect
      // re-runs for the new zoom and the first thing on screen is the settled
      // scale. Nothing has been written to the live canvas yet, so there is
      // nothing to undo either.
      if (requestedZoomRef.current !== zoom) return;
      canvas.width  = buffer.width;
      canvas.height = buffer.height;
      canvas.style.width  = buffer.style.width;
      canvas.style.height = buffer.style.height;
      const context = canvas.getContext('2d');
      if (!context) throw new Error('The page canvas is unavailable.');
      context.drawImage(buffer, 0, 0);
      window.clearTimeout(deadline);
      setRenderingFrame(false);
      setFrame({ page, width, height, zoom });
      // The shell above this frame keeps the scrollbar honest while the page is
      // off-screen (`content-visibility: auto`). Its remembered size is fed the
      // frame's real committed height — label row and gap included — instead of
      // the old fixed 900px estimate, so a tall or small page no longer makes
      // the scroll position jolt when it is painted the first time.
      const shell = canvas.closest('.pe-page-shell');
      if (shell instanceof HTMLElement) {
        shell.style.setProperty('--pe-page-intr', `${Math.round(height + 34)}px`);
      }
      if (!firstFrameReportedRef.current) {
        firstFrameReportedRef.current = true;
        onFirstFrameRef.current?.();
      }
    };

    const renderWithRetry = async () => {
      setRenderingFrame(true);
      for (const delay of retryDelays) {
        if (cancelled || !canvas.isConnected) return;
        if (delay > 0) await new Promise(resolve => setTimeout(resolve, delay));
        if (cancelled || !canvas.isConnected) return;

        const { width, height, budgetLimited } = await renderPage(page, buffer, zoom);
        if (cancelled || !canvas.isConnected) return;
        if (width > 0 && height > 0 && buffer.width > 0 && buffer.height > 0) {
          commit(width, height);
          // The zoom pass above could not use the device's own ratio: the
          // interaction budget chose its scale instead. Once the gesture has
          // settled, one re-render at the settle budget sharpens this page —
          // gated to pages actually in the viewport, so a continuous list at a
          // deep zoom does not hand every page the same memory. Stale-safe by
          // the same guard `commit` uses: a zoom changed between scheduling
          // and the settle render never lands.
          if (budgetLimited) {
            settleAfterCommit();
          }
          return;
        }
      }
      // Nothing arrived: a document that is not open yet, or a page that
      // refused to draw. Stop claiming progress instead of spinning forever.
      if (!cancelled) throw new Error('No usable page frame was produced.');
    };

    /**
     * The settle pass, scheduled one commit out.
     *
     * Gated to the page visibly inside the scroll stage at fire time — this is
     * deliberately a lazy read, not an IntersectionObserver: the gate is a
     * one-shot decision for one pending render, not a persistent map the
     * effect would have to keep in step with the scroll position.
     */
    const settleAfterCommit = () => {
      if (settleTimer !== undefined) window.clearTimeout(settleTimer);
      settleTimer = window.setTimeout(() => {
        void (async () => {
          if (cancelled || !canvas.isConnected) return;
          const stage = canvas.closest('.pe-edit-stage');
          const box = canvas.getBoundingClientRect();
          if (stage instanceof HTMLElement) {
            const viewport = stage.getBoundingClientRect();
            const inView = box.bottom > viewport.top && box.top < viewport.bottom
              && box.right > viewport.left && box.left < viewport.right;
            if (!inView) return;
          }
          const { width, height } = await renderPage(
            page,
            buffer,
            zoom,
            PDF_EDITOR_PAGE_SETTLE_PIXEL_BUDGET,
          );
          if (cancelled || !canvas.isConnected) return;
          if (width > 0 && height > 0 && buffer.width > 0 && buffer.height > 0) {
            commit(width, height);
          }
        })().catch(error => {
          if (!cancelled) setPageFailure(error instanceof Error ? error.message : 'The page refinement failed.');
        });
      }, PDF_EDITOR_SETTLE_DELAY_MS);
    };

    renderWithRetry().catch((error) => {
      if (!cancelled) {
        setRenderingFrame(false);
        window.clearTimeout(deadline);
        setPageFailure(error instanceof Error ? error.message : 'The page could not be rendered.');
        console.warn('PDF page render failed', error);
      }
    });

    return () => {
      cancelled = true;
      window.clearTimeout(deadline);
      if (settleTimer !== undefined) {
        window.clearTimeout(settleTimer);
        settleTimer = undefined;
      }
    };
  }, [page, zoom, renderPage, retryEpoch]);

  useEffect(() => {
    let cancelled = false;
    const needsTextBlocks = activeTool === 'editText'
      || activeTool === 'redact'
      || (activeTool === 'annotate' && isPdfEditorTextMarkupKind(annotationKind));
    if (!needsTextBlocks) {
      setBlockSet(null);
      return;
    }
    // Blocks are measured against a specific raster, so they are only ever
    // fetched for the frame that is committed — and kept while it stays on
    // screen. A block set for the wrong scale is never displayed (`textBlocks`
    // checks the pair below), so nothing has to be blanked out while the next
    // page is still being drawn.
    if (!frame) return;

    const { page: framePage, zoom: frameZoom } = frame;
    setContentHeights({});
    getTextBlocks(framePage, frameZoom).then(blocks => {
      if (!cancelled) setBlockSet({ page: framePage, zoom: frameZoom, blocks });
    }).catch(error => {
      if (!cancelled) setPageFailure(error instanceof Error ? error.message : 'Text controls could not be prepared.');
    });

    return () => {
      cancelled = true;
    };
  }, [activeTool, annotationKind, frame, getTextBlocks]);

  // Measure the controls once their elements exist. Only the browser knows where
  // a proportional font wraps, so the boxes are laid out from a measurement
  // rather than an estimate. This settles in one pass — `neededTextControlHeight`
  // reads the content's height, not the box's, so growing a box does not change
  // what the next measurement would say — and the effect does not re-run on the
  // state it sets.
  useEffect(() => {
    if (activeTool !== 'editText' || textBlocks.length === 0) return;
    const measured: Record<string, number> = {};
    textBlocks.forEach(block => {
      const el = textAreaRefs.current[`${block.page}:${block.index}`];
      if (el) measured[`${block.page}:${block.index}`] = neededTextControlHeight(el);
    });
    setContentHeights(prev => {
      const changed = Object.keys(measured).some(
        key => Math.abs((prev[key] ?? 0) - measured[key]) >= 0.5,
      );
      return changed ? { ...prev, ...measured } : prev;
    });
  }, [activeTool, textBlocks]);

  // ── Step 2: mount Fabric canvas once a frame is committed ──
  //
  // The lifecycle is keyed on the committed page, not on the requested one:
  // the editing layer is rebuilt when a new raster actually lands, so a
  // pointer can never edit a page that is not the one on screen. The size and
  // zoom are read from the frame ref on purpose — a zoom change on the same
  // page resizes this canvas through the effect below instead of tearing it
  // down and remounting it.
  useEffect(() => {
    if (framePage === null || !fabricCanvasRef.current) return;
    const mountedFrame = frameRef.current;
    if (!mountedFrame) return;
    const mountedPage = mountedFrame.page;
    let cancelled = false;
    setLayerFailure(null);
    const deadline = window.setTimeout(() => {
      if (cancelled) return;
      cancelled = true;
      if (fabricRef.current) {
        callbacksRef.current.onBeforeDispose(mountedPage);
        fabricRef.current.dispose();
        fabricRef.current = null;
      }
      setLayerFailure('The editing layer took too long to initialize. Saved objects are retained; retry the page.');
    }, 30_000);

    const loadFabric = async () => {
      const fabricCanvas = fabricCanvasRef.current;
      if (!fabricCanvas || !fabricCanvas.isConnected) return;
      if (!fabricCanvas.getContext('2d')) throw new Error('The editing canvas is unavailable. Retry the page.');

      // Dynamically import fabric to avoid SSR issues
      const fabricModule = await import('fabric');
      if (cancelled || !fabricCanvas.isConnected) return;
      const fabric = ((fabricModule as unknown as { fabric?: FabricNamespaceLike }).fabric
        ?? (fabricModule as unknown as FabricNamespaceLike)) as FabricNamespaceLike;
      fabricNsRef.current = fabric;
      // Store globally so hook can access it without re-importing
      (window as Window).__fabric__ = fabric as unknown as Window['__fabric__'];

      // Fabric v5 defaults `enableRetinaScaling` to true: the overlay backing
      // store follows the device pixel ratio, so object chrome and selection
      // handles read as sharp as the page raster underneath. One honest
      // boundary: the ratio is cached by the module at import time, so a
      // mid-session screen move leaves the chrome at the old density until
      // the document is reopened. The page raster has no such limit — its
      // ratio is read fresh on every frame.
      const fc = new fabric.Canvas(fabricCanvas, {
        width:           mountedFrame.width,
        height:          mountedFrame.height,
        selection:       true,
        backgroundColor: 'transparent',
        preserveObjectStacking: true,
      });
      fc.setZoom(mountedFrame.zoom);
      fc.calcOffset?.();

      if (cancelled || !fabricCanvas.isConnected) {
        fc.dispose();
        return;
      }

      fabricRef.current = fc;
      const ready = await callbacksRef.current.onReady(mountedPage, fc);
      if (cancelled) return;
      if (ready === false) throw new Error('The editing layer could not restore every saved object. Retry without discarding your draft.');
      window.clearTimeout(deadline);
    };

    void loadFabric().catch(error => {
      if (cancelled) return;
      window.clearTimeout(deadline);
      setLayerFailure(error instanceof Error ? error.message : 'The editing layer could not initialize.');
    });

    return () => {
      cancelled = true;
      window.clearTimeout(deadline);
      if (fabricRef.current) {
        callbacksRef.current.onBeforeDispose(mountedPage);
        fabricRef.current.dispose();
        fabricRef.current = null;
      }
    };
  }, [framePage, retryEpoch]);

  useEffect(() => {
    const fc = fabricRef.current;
    if (!fc || !frame) return;

    fc.setDimensions({ width: frame.width, height: frame.height });
    fc.setZoom(frame.zoom);
    fc.calcOffset?.();
    fc.requestRenderAll?.();
  }, [frame]);

  // ── Step 3: update cursor / mode when tool changes ─────────
  useEffect(() => {
    const fc = fabricRef.current;
    if (!fc) return;

    const isShapeDrawTool = activeTool === 'rect' || activeTool === 'circle'
      || activeTool === 'line' || activeTool === 'arrow';
    const isAnnotate = activeTool === 'annotate';
    // Page-space bounds come off the committed frame, so a drag that starts in
    // the window where the next page is still being drawn is still measured
    // against the grid the pointer is actually on.
    const pageBounds = {
      width: Math.max(1, displayDims.width / Math.max(0.01, displayZoom)),
      height: Math.max(1, displayDims.height / Math.max(0.01, displayZoom)),
    };
    const toPagePoint = (event: Event) => {
      // `getPointer` already removes the canvas viewport zoom: with
      // `fc.setZoom(zoom)` it returns the page's own point coordinates.
      // Dividing again put every dragged shape at 1/zoom of the gesture.
      const pointer = fc.getPointer(event);
      return { x: pointer.x, y: pointer.y };
    };

    fc.isDrawingMode = (activeTool === 'signature');
    if (activeTool === 'signature') {
      const fabric = fabricNsRef.current;
      if (fabric && !fc.freeDrawingBrush) {
        fc.freeDrawingBrush = new fabric.PencilBrush(fc);
      }
      if (fc.freeDrawingBrush) {
        fc.freeDrawingBrush.color = '#000000';
        fc.freeDrawingBrush.width = 2;
      }
      fc.selection = false;
      fc.hoverCursor = 'crosshair';
    } else if (isShapeDrawTool || isAnnotate) {
      // No object dragging while a drawing/annotation tool owns the pointer;
      // the drag is the gesture, not a move of the object under it.
      fc.selection = false;
      fc.hoverCursor = 'crosshair';
    } else {
      // Redaction marks are made by clicking the text-block overlay above the
      // Fabric canvas. Object selection underneath would steal that click and
      // move a shape instead of marking a line.
      fc.selection = activeTool !== 'redact';
      fc.hoverCursor = activeTool === 'redact' ? 'crosshair' : 'move';
    }
    fc.defaultCursor =
      activeTool === 'text'      ? 'text'    :
      activeTool === 'signature' ? 'crosshair':
      activeTool === 'redact'    ? 'crosshair':
      activeTool === 'select'    ? 'default'  : 'crosshair';

    // Double-click to add text when the text tool is active — and only while
    // the requested page is the one on screen: the pointer coordinates belong
    // to the raster under it, and a textbox may not be added to the page the
    // user just left.
    fc.off('mouse:dblclick');
    if (activeTool === 'text' && showingRequestedPage) {
      fc.on('mouse:dblclick', (e: FabricPointerEvent) => {
        const ptr = fc.getPointer(e.e);
        const fabric = fabricNsRef.current;
        if (!fabric) return;
        const tb = new fabric.Textbox('Type here…', {
          left:      ptr.x,
          top:       ptr.y,
          width:     240,
          fontSize:  14,
          editable:  true,
        });
        fc.add(tb);
        fc.setActiveObject(tb);
        tb.enterEditing?.();
        fc.renderAll();
      });
    }

    // ── W4 drag-to-create / annotation pointer handlers ──────
    //
    // Handlers are bound per tool and removed by identity in this effect's
    // cleanup. The blanket `off('mouse:up')` this replaced also removed the
    // hook's own guide-clearing listener on every render.
    const bound: { event: string; handler: (event: FabricPointerEvent) => void }[] = [];
    const bind = (event: string, handler: (event: FabricPointerEvent) => void) => {
      fc.on(event, handler);
      bound.push({ event, handler });
    };
    shapeDragRef.current = null;
    setShapePreview(null);

    if (isShapeDrawTool && showingRequestedPage) {
      bind('mouse:down', (event) => {
        const original = event.e as MouseEvent | undefined;
        if (original && 'button' in original && original.button !== 0) return;
        const start = toPagePoint(event.e);
        shapeDragRef.current = { start };
        setShapePreview({
          left: start.x * displayZoom,
          top: start.y * displayZoom,
          width: 0,
          height: 0,
        });
      });
      bind('mouse:move', (event) => {
        const drag = shapeDragRef.current;
        if (!drag) return;
        const current = toPagePoint(event.e);
        setShapePreview({
          left: Math.min(drag.start.x, current.x) * displayZoom,
          top: Math.min(drag.start.y, current.y) * displayZoom,
          width: Math.abs(current.x - drag.start.x) * displayZoom,
          height: Math.abs(current.y - drag.start.y) * displayZoom,
        });
      });
      bind('mouse:up', (event) => {
        const drag = shapeDragRef.current;
        shapeDragRef.current = null;
        setShapePreview(null);
        if (!drag) return;
        const geometry = createPdfEditorDragGeometry(
          activeTool as PdfEditorDragShape,
          drag.start,
          toPagePoint(event.e),
          pageBounds,
        );
        // A click, not a drag: nothing is created and the tool stays active so
        // the user can try again. A 2pt shape would be unselectable afterwards.
        if (geometry) callbacksRef.current.onShapeDragCreate?.(page, activeTool as PdfEditorDragShape, geometry);
      });
    }

    if (isAnnotate && displayDims.width > 0 && !isPdfEditorTextMarkupKind(annotationKind) && showingRequestedPage) {
      bind('mouse:down', (event) => {
        const original = event.e as MouseEvent | undefined;
        if (original && 'button' in original && original.button !== 0) return;
        callbacksRef.current.onAddAnnotationAt?.(page, toPagePoint(event.e));
      });
    }

    return () => {
      bound.forEach(({ event, handler }) => fc.off(event, handler));
    };
  }, [
    activeTool,
    annotationKind,
    displayDims.height,
    displayDims.width,
    displayZoom,
    // Save/status renders must not tear down a drag in progress. Only the
    // active tool or its coordinate space owns this listener's lifetime.
    page,
    showingRequestedPage,
  ]);

  return (
    <div
      ref={wrapRef}
      style={{
        position: 'relative',
        // The wrapper is the raster's own size, never "the full width until
        // the first render arrives": a full-width box collapsing to
        // page-width was one of the two dozen frames the old open wobbled
        // through. Before the first commit there is simply nothing here, and
        // the stage placeholder says so.
        width:    failure && !hasPageDimensions ? 'min(440px, 100%)' : displayDims.width,
        height:   failure && !hasPageDimensions ? 220 : displayDims.height,
        display:  'block',
        visibility: hasPageDimensions || failure ? 'visible' : 'hidden',
      }}
    >
      <style>{`
        .pe-canvas-failure { position: absolute; inset: 0; z-index: 20; display: grid; place-content: center; gap: 12px; padding: 20px; background: var(--pe-panel); color: var(--pe-text); font-family: inherit; font-size: 13px; line-height: 1.5; text-align: center; }
        .pe-canvas-failure p { margin: 0; max-width: 360px; }
        .pe-canvas-failure button { justify-self: center; min-height: 40px; }
        /* W3 authoring marks. These are previews of intent, not the removal:
           the black bar disappears with the glyphs on export because the
           engine deletes the text and this overlay is never written to the
           PDF. The red outline distinguishes "marked" from "already redacted". */
        .pe-redaction-target,
        .pe-redaction-mark {
          position: absolute; margin: 0; padding: 0; box-sizing: border-box;
          font-family: inherit;
        }
        .pe-redaction-target {
          z-index: 10; border: 1px dashed transparent; border-radius: 3px;
          background: transparent; cursor: crosshair;
        }
        .pe-redaction-target:hover,
        .pe-redaction-target:focus-visible {
          border-color: var(--pe-danger);
          background: var(--pe-danger-soft);
          outline: none;
        }
        .pe-redaction-target-label {
          position: absolute; left: 0; top: -19px;
          padding: 2px 5px; border-radius: 3px;
          background: var(--pe-danger); color: #fff;
          font-size: 9px; font-weight: 800; letter-spacing: .4px;
          text-transform: uppercase; white-space: nowrap;
          opacity: 0; pointer-events: none;
          transition: opacity var(--pe-dur-fast) var(--pe-ease-out);
        }
        .pe-redaction-target:hover .pe-redaction-target-label,
        .pe-redaction-target:focus-visible .pe-redaction-target-label { opacity: 1; }
        .pe-redaction-mark {
          z-index: 11; border: 1px solid var(--pe-danger);
          border-radius: 2px; background: #0b0b0e;
          color: #fff; cursor: pointer; overflow: visible;
        }
        .pe-redaction-mark:focus-visible {
          outline: 2px solid var(--pe-focus); outline-offset: 2px;
        }
        .pe-redaction-mark:hover { background: #211014; }
        /* The bar can be only a few points tall on small type. Widen the hit
           area without changing the reviewed box, and show the remove affordance
           on hover/focus so "click to remove" is visible, not just a tooltip. */
        .pe-redaction-mark::after {
          content: ''; position: absolute; inset: -6px -3px;
        }
        .pe-redaction-mark::before {
          content: '×';
          position: absolute; right: 2px; top: 50%;
          transform: translateY(-50%);
          font-size: 12px; font-weight: 700; line-height: 1;
          color: #fff; opacity: 0; pointer-events: none;
          transition: opacity var(--pe-dur-fast) var(--pe-ease-out);
        }
        .pe-redaction-mark:hover::before,
        .pe-redaction-mark:focus-visible::before { opacity: 1; }
        /* W4 annotation targets. Same interaction as redaction — click the run
           to add, click again to remove — but the colour is the annotation's own
           so the mark reads as a highlight, not a destructive intent. */
        .pe-annotation-target {
          position: absolute; margin: 0; padding: 0; box-sizing: border-box;
          font-family: inherit; z-index: 10;
          border: 1px dashed transparent; border-radius: 3px;
          background: transparent; cursor: crosshair;
        }
        .pe-annotation-target:hover,
        .pe-annotation-target:focus-visible {
          border-style: solid; outline: none;
        }
        @media (prefers-reduced-motion: reduce) {
          .pe-redaction-target-label,
          .pe-redaction-mark::before { transition: none; }
        }
        /* A raster in flight is reported as a 2px hairline on the frame's top
           edge: a sweep that says "a frame is coming", never a percentage that
           cannot be known. In reduced motion it stops sweeping and simply
           stays, which is the same fact without the motion. */
        .pe-page-rendering {
          position: absolute; left: 0; right: 0; top: 0; height: 2px;
          overflow: hidden; pointer-events: none; z-index: 13;
        }
        .pe-page-rendering::after {
          content: ''; position: absolute; top: 0; bottom: 0; width: 40%;
          background: var(--pe-signal);
          animation: pe-page-rendering-sweep 1.1s cubic-bezier(0.16, 1, 0.3, 1) infinite;
        }
        @keyframes pe-page-rendering-sweep {
          from { transform: translateX(-110%); }
          to   { transform: translateX(360%); }
        }
        @media (prefers-reduced-motion: reduce) {
          .pe-page-rendering::after { animation: none; width: 100%; opacity: .5; }
        }
      `}</style>
      {failure && <div className="pe-canvas-failure" role="alert" data-testid="pdf-canvas-failure"><strong>Page not ready</strong><p>{failure}</p><button type="button" className="pe-preflight-action" data-testid="pdf-canvas-retry" onClick={() => { setPageFailure(null); setLayerFailure(null); setRetryEpoch(epoch => epoch + 1); }}>Retry page and editing layer</button></div>}
      {/* PDF render layer */}
      <canvas
        ref={pdfCanvasRef}
        data-editor-layer="source"
        style={{
          position: 'absolute',
          top: 0, left: 0,
          display: 'block',
          userSelect: 'none',
          pointerEvents: 'none',
        }}
      />

      {/* Fabric editing layer */}
      <canvas
        ref={fabricCanvasRef}
        data-editor-layer="objects"
        style={{
          position: 'absolute',
          top: 0, left: 0,
          display: 'block',
        }}
      />

      {/* W4 snapping guides — the lines the dragged object actually sits on.
          Drawn above the canvas, never into it, so export is untouched. */}
      {showingRequestedPage && snapGuides.map((guide, index) => (
        <div
          key={`snap-${guide.axis}-${guide.position}-${index}`}
          aria-hidden="true"
          style={{
            position: 'absolute',
            zIndex: 12,
            pointerEvents: 'none',
            background: 'var(--pe-signal)',
            opacity: 0.85,
            ...(guide.axis === 'x'
              ? { left: guide.position * displayZoom - 0.5, top: 0, width: 1, height: displayDims.height }
              : { top: guide.position * displayZoom - 0.5, left: 0, height: 1, width: displayDims.width }),
          }}
        />
      ))}

      {/* Drag-to-create preview. Dashed because it is an intent, not content. */}
      {shapePreview && (shapePreview.width > 0 || shapePreview.height > 0) && (
        <div
          aria-hidden="true"
          data-testid="pdf-shape-drag-preview"
          style={{
            position: 'absolute',
            left: shapePreview.left,
            top: shapePreview.top,
            width: Math.max(1, shapePreview.width),
            height: Math.max(1, shapePreview.height),
            border: '1px dashed var(--pe-signal)',
            background: 'var(--pe-signal-soft)',
            pointerEvents: 'none',
            zIndex: 11,
          }}
        />
      )}

      {/* W4 annotation intent. These are the boxes that will become real PDF
          annotations; the export preview is what proves their final position.
          Authoring overlays appear only once the requested page is the one on
          screen: while the next page is still being drawn, the previous page
          stays visible as a raster, but its controls do not — a click meant
          for page N must never land on page N−1's marks. */}
      {showingRequestedPage && annotations.filter(annotation => annotation.page === page).map(annotation => {
        const isMarkup = isPdfEditorTextMarkupKind(annotation.kind);
        if (activeTool === 'annotate' && isMarkup && annotation.kind === annotationKind) return null;
        const label = annotation.contents.trim() || annotation.kind;
        return (
          <div
            key={annotation.id}
            data-testid={`pdf-annotation-mark-${annotation.id}`}
            title={`${annotation.author}: ${label}`}
            aria-label={`${annotation.kind} annotation by ${annotation.author}: ${label}`}
            onClick={(event) => {
              event.stopPropagation();
              onSelectAnnotation?.(annotation.id);
            }}
            style={{
              position: 'absolute',
              left: annotation.x * displayZoom,
              top: annotation.y * displayZoom,
              width: Math.max(4, annotation.width * displayZoom),
              height: Math.max(4, annotation.height * displayZoom),
              zIndex: 12,
              // A markup mark must not steal the click from the text target
              // underneath it: that click is how a mark is removed.
              pointerEvents: activeTool === 'select'
                || (activeTool === 'annotate' && !isMarkup)
                ? 'auto'
                : 'none',
              cursor: 'pointer',
              background: `${annotation.color}40`,
              border: `1px solid ${annotation.color}`,
              borderRadius: annotation.kind === 'note' ? 3 : 1,
              boxShadow: annotation.id === selectedAnnotationId
                ? '0 0 0 2px var(--pe-focus)'
                : 'none',
            }}
          />
        );
      })}

      {activeTool === 'annotate' && isPdfEditorTextMarkupKind(annotationKind) && showingRequestedPage && (
        <>
          {textBlocks
            .filter(block => block.page === page && block.text.trim())
            .map(block => {
              const existing = annotations.find(annotation => (
                annotation.kind === annotationKind
                && annotation.blockKey === `${block.page}:${block.index}`
              ));
              const preview = block.text.length > 70 ? `${block.text.slice(0, 67)}…` : block.text;
              return (
                <button
                  key={`annotate-target-${block.page}-${block.index}`}
                  type="button"
                  className="pe-annotation-target"
                  data-testid={`pdf-annotation-target-${block.page}-${block.index}`}
                  aria-pressed={Boolean(existing)}
                  aria-label={`${existing ? 'Remove' : 'Add'} ${annotationKind} on "${preview}"`}
                  title={`${existing ? 'Remove' : 'Add'} ${annotationKind}: "${preview}"`}
                  style={{
                    left: block.x,
                    top: block.y,
                    width: Math.max(6, block.width),
                    height: Math.max(6, block.height),
                    borderColor: existing?.color ?? 'var(--pe-signal)',
                    background: existing ? `${existing.color}30` : 'transparent',
                  }}
                  onClick={(event) => {
                    event.stopPropagation();
                    onToggleAnnotation?.(block);
                  }}
                />
              );
            })}
        </>
      )}

      {activeTool === 'editText' && showingRequestedPage && textBlocks.map(block => {
        const edit = getOriginalTextEdit(block);
        const key = `${block.page}:${block.index}`;
        /**
         * The control's fill is fully opaque — the canvas raster it sits over
         * must not read through it. At 92% the page's own glyphs underneath a
         * box showed as ghosted strokes beside the text being edited: an
         * unreadable double image that also read as "the edit did not take".
         * A colour the user picked keeps whatever alpha it has, because the
         * export paints exactly that colour that is what the control may
         * show; only the default fill, which exists to be a clean editing
         * surface, is opaque.
         */
        const bgColor = edit.backgroundColor && edit.backgroundColor !== 'transparent'
          ? edit.backgroundColor
          : 'rgb(255, 255, 255)';
        // `edit.fontSize` is in document points, so this is the one and only
        // place the zoom is applied to it — the committed zoom, because the
        // boxes this control draws over are the committed raster's own runs.
        // Everything else about the box — the pointer minimum, the room for a
        // line, staying inside the page — is decided by the pure function so
        // it can be proven at every zoom.
        const userSize = userSizes[dragKeyOf(block)];
        /**
         * The font's own line extent for this zoom, as an extra height floor.
         * A line box taller than the glyphs is the rule, not an exception —
         * this is what stops the control from shaving the top of its own
         * line, including for the handful of fonts whose em box exceeds the
         * reported rectangle outright.
         */
        const fontLineExtent = measuredFontLineExtent(edit.fontSize * displayZoom, edit);
        const layout = layoutPdfEditorTextControl({
          block,
          fontSize: edit.fontSize * displayZoom,
          // `block.text`, never the edited value: the box owes the *document's*
          // line a width, and anything typed past it wraps and grows downwards.
          contentWidth: measuredRunWidth(block.text, edit.fontSize * displayZoom, edit),
          lineHeight: edit.lineHeight,
          topClearance: 4 * displayZoom,
          contentHeight: Math.max(fontLineExtent, contentHeights[key] ?? 0),
          // Back into device pixels for the layout to clamp against the page.
          // A drag can only ever enlarge a box: these arrive as floors, so they
          // cannot pull it off the run it covers or below one line of its font.
          userWidth: (userSize?.width ?? 0) * displayZoom,
          userHeight: (userSize?.height ?? 0) * displayZoom,
          page: displayDims,
        });
        const focused = selectedOriginalTextKey === key;
        const dragKey = dragKeyOf(block);
        const edgeX = dragEdgeThickness(layout.width);
        const edgeY = dragEdgeThickness(layout.height);
        /**
         * A resize handle: an invisible *hit area* inside the box's own right
         * or bottom border, with a thin visual line drawn inside it. The two
         * are separated on purpose: the visible line stays a hairline (a heavy
         * strip over a 6pt line reads as chrome), while the hit area stays
         * comfortably grabbable — a 2px target is why a bottom-edge drag felt
         * impossible while the right edge, sitting on a taller target, worked.
         * Every hit area remains inside its own box, so it can never intercept
         * a click meant for an overlapping neighbour (the original defect that
         * tied handles to the selection in the first place).
         *
         * Handles on the selected box only, and a corner handle that grows
         * both extents at once — width alone was reachable, height was not,
         * and resizing a box professionally means both directions.
         */
        const dragEdge = (axis: 'x' | 'y' | 'xy') => {
          const corner = axis === 'xy';
          const hit = corner ? 12 : Math.max(axis === 'x' ? edgeX : edgeY, 9);
          return (
            <div
              key={`${dragKey}:${axis}`}
              data-testid={`pdf-text-resize-${axis}-${block.page}-${block.index}`}
              title="Resize the editing area only; this does not resize the PDF text layout"
              onPointerDown={(event) => beginTextControlResize(block, axis, layout, event)}
              onPointerMove={continueTextControlResize}
              onPointerUp={endTextControlResize}
              onPointerCancel={endTextControlResize}
              style={{
                position: 'absolute',
                left: axis === 'y' ? layout.left : layout.left + layout.width - hit,
                top: axis === 'x' ? layout.top : layout.top + layout.height - hit,
                width: axis === 'y' ? Math.max(0, layout.width - edgeX) : hit,
                height: axis === 'x' ? layout.height : hit,
                boxSizing: 'border-box',
                cursor: axis === 'x' ? 'ew-resize' : axis === 'y' ? 'ns-resize' : 'nwse-resize',
                // Above its own control's text - the only way a strip drawn inside
                // the box can be grabbed - and above the neighbours that overlap
                // it, which is why only the selected box may have one.
                zIndex: 10,
                // Pointer events only, so a touch drag resizes the box instead of
                // scrolling the page under it.
                touchAction: 'none',
              }}
            >
              {/* The visible hairline, pinned to the box's own edge. */}
              <div style={{
                position: 'absolute',
                ...(axis === 'x'
                  ? { right: 0, top: 0, width: edgeX, height: '100%' }
                  : axis === 'y'
                    ? { left: 0, bottom: 0, width: '100%', height: edgeY }
                    : { right: 0, bottom: 0, width: edgeX, height: edgeY }),
                borderRadius: 2,
                background: 'var(--pe-signal-soft)',
              }} />
            </div>
          );
        };
        return (
        <Fragment key={key}>
        {/*
          The source run's full font box, painted opaque. The control's text sits
          on the engine rectangle — that is where the export puts the replacement
          text, so it is where the caret must sit — but a run's ink reaches
          past that rectangle: ascenders above it, descenders below it. Those
          parts read through beside the box as a second, ghost line. This
          shroud covers the whole font box with the control's own fill, so no
          part of the original run can show anywhere around the box, without
          moving the box or its text at all. One pixel each side is the
          canvas raster's own antialiasing fringe; vertically it stays exact,
          because the next line's ink can start within a hairline of this
          font box and bleed there would paint over the neighbour.
          Beneath every control (the boxes are 8–9) and deaf to the pointer,
          so it never stands between the user and a box or the page.
        */}
        <div
          style={{
            position: 'absolute',
            left: (block.fontBox ?? block).x - 1,
            top: (block.fontBox ?? block).y,
            width: Math.max(0, (block.fontBox ?? block).width + 2),
            height: Math.max(0, (block.fontBox ?? block).height),
            background: bgColor,
            pointerEvents: 'none',
            zIndex: 7,
          }}
        />
        <textarea
          ref={(el) => { textAreaRefs.current[key] = el; }}
          data-testid={`pdf-original-text-${block.page}-${block.index}`}
          aria-label={`Original text editing area, page ${block.page}, block ${block.index + 1}`}
          data-pdf-text="true"
          data-page={block.page}
          data-index={block.index}
          data-font-size={edit.fontSize}
          data-font-family={edit.fontFamily}
          data-color={edit.color}
          data-bold={edit.bold}
          data-italic={edit.italic}
          data-underline={edit.underline}
          data-align={edit.align}
          data-line-height={edit.lineHeight}
          data-bg-color={edit.backgroundColor || 'transparent'}
          value={getEditedText(block.page, block.index, block.text)}
          onFocus={() => {
            focusKeyRef.current = key;
            selectOriginalTextBlock(block);
          }}
          onMouseDown={() => {
            focusKeyRef.current = key;
            selectOriginalTextBlock(block);
          }}
          onChange={(e) => {
            const start = e.target.selectionStart ?? e.target.value.length;
            const end = e.target.selectionEnd ?? e.target.value.length;
            selectionRef.current = { start, end };
            setTextEdit(block.page, block.index, e.target.value, block);
            measureTextControl(key);
            requestAnimationFrame(() => restoreTextAreaFocus(key));
          }}
          title="Edit original PDF text"
          rows={1}
          style={{
            position: 'absolute',
            left: layout.left,
            top: layout.top,
            width: layout.width,
            // Explicit, not a minimum: a `<textarea>`'s intrinsic height is its
            // `rows`, so `minHeight` alone left every control two lines tall —
            // three to five times its line at Fit page, which is what pushed the
            // bottom ones past the page edge.
            height: layout.height,
            // Bounds that growth at the page's far edge. A control may grow over
            // its neighbours — so does the exported text — but never onto the
            // workspace background.
            maxWidth: layout.maxWidth,
            maxHeight: layout.maxHeight,
            boxSizing: 'border-box',
            // The focused control sits above its neighbours: once a box can grow
            // to fit what was typed into it, it may overlap the following lines,
            // and the one being edited is the one that must stay readable.
            zIndex: focused ? 9 : 8,
            // Derived from the same constant the layout arithmetic uses. Hard-code
            // either half and the box silently stops fitting its own text.
            padding: `${TEXT_CONTROL_CHROME.paddingY}px ${TEXT_CONTROL_CHROME.paddingX}px`,
            // Offset the lifted frame, keeping the text's original position.
            paddingTop: TEXT_CONTROL_CHROME.paddingY + layout.paddingTop,
            borderWidth: TEXT_CONTROL_CHROME.borderWidth,
            borderStyle: 'solid',
            borderColor: 'transparent',
            borderRadius: 4,
            // The visible frame is an outline, not a border, because an outline
            // is drawn outside the box and takes no part in layout. So the text
            // area's text origin stays on the glyph rectangle: the replacement
            // text sits where the original glyphs sat, at their size — and a
            // frame that stays a hairline at 40% cannot steal a line's worth of
            // room from the box the way a border did.
            outline: '1px solid var(--pe-control-outline)',
            outlineOffset: -1,
            // The browser's own resize grip stays off; the two drag edges below
            // replace it. The grip is a fixed ~13px widget, so on a 6pt line at
            // Fit page it is drawn larger than the box it decorates and straight
            // over the text - and a grip drag only writes inline width/height,
            // which React replaces on the next render, so the box sprang back at
            // the next keystroke. The edges below store the dragged size in state,
            // zoom-normalised, and hand it to the layout function as a floor, so
            // it survives typing and zooming and still cannot leave the page.
            resize: 'none',
            // `hidden` here truncated anything past the box with no way to reach
            // it. The box now grows to its content instead, so this only ever
            // applies where the page itself has run out of room.
            overflow: 'auto',
            background: bgColor,
            color: edit.color,
            fontFamily: `${edit.fontFamily}, Helvetica, Arial, sans-serif`,
            fontSize: layout.fontSize,
            fontWeight: edit.bold ? 700 : 400,
            fontStyle: edit.italic ? 'italic' : 'normal',
            textDecoration: edit.underline ? 'underline' : 'none',
            textAlign: edit.align,
            lineHeight: edit.lineHeight,
            boxShadow: focused
              ? '0 0 0 1px var(--pe-control-focus)'
              : '0 0 0 1px var(--pe-control-outline-soft)',
          }}
        />
        {focused && dragEdge('y')}
        {focused && dragEdge('x')}
        {focused && dragEdge('xy')}
        </Fragment>
      );
      })}

      {activeTool === 'redact' && showingRequestedPage && (
        <>
          {textBlocks
            .filter(block => block.page === page
              && block.text.trim()
              && !redactionMarks.some(mark => mark.blockKey === `${block.page}:${block.index}`))
            .map(block => {
              const preview = block.text.length > 70 ? `${block.text.slice(0, 67)}…` : block.text;
              // The full font box, not the inset engine rectangle, so the
              // hover cover includes ascenders and descenders. It is still
              // this run's own advance, so a neighbouring run is not painted.
              const hit = block.fontBox ?? block;
              return (
                <button
                  key={`redact-target-${block.page}-${block.index}`}
                  type="button"
                  className="pe-redaction-target"
                  data-testid={`pdf-redaction-target-${block.page}-${block.index}`}
                  aria-label={`Mark "${preview}" for redaction on page ${block.page}`}
                  title={`Mark "${preview}" for redaction`}
                  style={{
                    left: hit.x,
                    top: hit.y,
                    width: Math.max(6, hit.width),
                    height: Math.max(6, hit.height),
                  }}
                  onClick={(event) => {
                    event.stopPropagation();
                    onToggleRedaction(block);
                  }}
                >
                  <span className="pe-redaction-target-label">Redact</span>
                </button>
              );
            })}
          {redactionMarks
            .filter(mark => mark.page === page)
            .map(mark => {
              const preview = mark.originalText.length > 70
                ? `${mark.originalText.slice(0, 67)}…`
                : mark.originalText;
              const sourceBlock = textBlocks.find(block => (
                block.page === mark.page && `${block.page}:${block.index}` === mark.blockKey
              ));
              // Paint exactly the run's font box. The engine rectangle stored in
              // the mark deliberately stays tighter; the whole run is still
              // deleted, so nothing visible inside this bar survives. Using the
              // font box (rather than a generic expansion) is what keeps the
              // cover off the line above and below.
              const fontBox = sourceBlock?.fontBox;
              const display = fontBox
                ? {
                    left: fontBox.x,
                    top: fontBox.y,
                    width: Math.max(4, fontBox.width),
                    height: Math.max(4, fontBox.height),
                  }
                : mark.box === 'font'
                  ? {
                      left: mark.x * displayZoom,
                      top: mark.y * displayZoom,
                      width: Math.max(4, mark.width * displayZoom),
                      height: Math.max(4, mark.height * displayZoom),
                    }
                  : pdfEditorRedactionDisplayBox(mark, displayZoom, {
                      ascent: sourceBlock?.fontAscent,
                      descent: sourceBlock?.fontDescent,
                    });
              return (
                <button
                  key={mark.id}
                  type="button"
                  className="pe-redaction-mark"
                  data-testid={`pdf-redaction-mark-${mark.page}-${mark.blockKey}`}
                  aria-pressed="true"
                  aria-label={`Remove redaction for "${preview}" on page ${mark.page}`}
                  title={`Marked for redaction. Click to remove: "${preview}"`}
                  style={{
                    left: display.left,
                    top: display.top,
                    width: display.width,
                    height: display.height,
                  }}
                  onClick={(event) => {
                    event.stopPropagation();
                    onUnmarkRedaction(mark.id);
                  }}
                />
              );
            })}
        </>
      )}

      {searchHighlight && showingRequestedPage && (
        <div
          data-testid="pdf-search-highlight"
          aria-hidden="true"
          style={{
            position: 'absolute',
            left: searchHighlight.x * displayZoom,
            top: searchHighlight.y * displayZoom,
            width: Math.max(12, searchHighlight.width * displayZoom),
            height: Math.max(12, searchHighlight.height * displayZoom),
            zIndex: 7,
            pointerEvents: 'none',
            background: 'var(--pe-search-highlight)',
            boxShadow: '0 0 0 2px var(--pe-search-ring)',
            borderRadius: 2,
          }}
        />
      )}

      {/* Honest pending indicator. It says "a frame is being drawn", never how
          far along it is — a percentage here would be invented. The old
          full-surface "Rendering page N…" scrim that sat over the previous
          frame is gone: a transition that keeps the last good frame visible
          has nothing to apologise for. */}
      {renderingFrame && (
        <div className="pe-page-rendering" data-testid="pdf-page-rendering" aria-hidden="true" />
      )}
    </div>
  );
}
