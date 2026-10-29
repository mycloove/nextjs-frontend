'use client';
import type { PdfPostExportVerification } from '../pdfEdit-utils/editorExportVerification';

import { useEffect, useRef, useState } from 'react';
import type { PdfExportImpact } from '../pdfEdit-utils/editorPreflight';
import type { ServerTextEditConsentRequest } from '../pdfEdit-utils/editorServerTextEdit';
import { resolvePdfEditorPreviewOutputScale } from '../pdfEdit-utils/editorRenderSharpness';

/**
 * The export, rendered.
 *
 * This panel used to draw its own approximation of the result — the unedited page
 * rasterised, an opaque rectangle over the edited box, and the replacement text
 * redrawn with browser fonts and browser wrap metrics. It could not match the
 * download, because the download is produced by the structural text engine using
 * the source span's own typeface, size and fill colour and PyMuPDF's layout. So
 * the colour, the size, the face, the line breaks and the page background were
 * all liable to differ, and a refused edit was shown as applied.
 *
 * Now it renders the exported bytes themselves. Everything below therefore
 * follows from one rule: show the build, or say why there is none. There is no
 * approximation left to fall back on, deliberately — a reassuring picture of a
 * document the user cannot actually obtain is the exact lie the module's "no lie"
 * invariant exists to prevent.
 *
 * It also carries its own zoom, because a column this narrow is not a reading
 * surface at layout size. The strip lives in the panel head — the head is a
 * control row, not a title row — so the row that would have named the panel
 * operates it instead, and the page area keeps the height that a heading and a
 * separate control row would have taken. Zoom changes the size the same bytes
 * are shown at, never which bytes: every rebuild is a real export of the page,
 * rasterised for the scale the panel and the device ask for (through the
 * module's pixel-budget helper). `Fit` is a layout relationship — the panel's
 * width over the page's — rather than a fixed ratio, which is why it is a state
 * of its own beside the numeric stops.
 */
interface Props {
  page: number;
  /**
   * Total pages of the plan being exported — the bound of the preview's own
   * page navigation. The preview may sit on any page of the export while the
   * editor stays on the page being edited; the head names both.
   */
  totalPages: number;
  /**
   * The page-size label, shown at the head row's right end. The head carries no
   * title, so this label and the zoom strip are all the text above the page.
   */
  pageSize: string;
  /**
   * Bumped by the hook on every committed change, including a granted consent.
   * The only trigger for a rebuild.
   */
  editVersion: number;
  documentSession: number;
  /**
   * Bumped when the device's pixel ratio changes. The ratio itself is read
   * fresh from the window when this component renders, so a bump is all the
   * signal a rebuild needs — the next build rasterises for the screen the
   * preview now sits on, instead of waiting for some other edit to happen.
   */
  dprEpoch?: number;
  /**
   * Bumped when the workspace split is dragged, because a panel-width change
   * is the one layout event the debounce lives to absorb: the page is left at
   * its previous raster while the drag runs and rebuilt once the width stops
   * moving.
   */
  resizeEpoch?: number;
  onRequestProcessing: () => void;
  onReviewExport: () => void;
  renderExportedPageToCanvas: (
    page: number,
    target: HTMLCanvasElement,
    options?: { outputScale?: number },
  ) => Promise<
    | {
        ok: true;
        width: number;
        height: number;
        pixelWidth: number;
        pixelHeight: number;
        disclosures: string[];
        changedPages: number[];
        verificationChecks: PdfPostExportVerification['checks'];
        pendingConfirmation: PdfExportImpact | null;
      }
    | { ok: false; message: string; impact?: PdfExportImpact; consent?: ServerTextEditConsentRequest; processingRequired?: boolean }
  >;
}

/**
 * Long enough that typing a sentence is one build rather than one per keystroke —
 * each build is an engine round trip — short enough to still read as live.
 */
const PREVIEW_REBUILD_DELAY_MS = 600;

/**
 * The panel's zoom ladder.
 *
 * A ladder rather than free zoom because every stop is a rebuild of the export
 * through the engine, and because a preview is for reading one page, not for
 * reproducing an arbitrary view state. 50% is the point where a readable raster
 * stops being worth the round trip; 400% is where the pixel budget starts
 * trading sharpness for survivable memory.
 */
const PREVIEW_ZOOM_STEPS = [0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4] as const;
const PREVIEW_ZOOM_MIN = PREVIEW_ZOOM_STEPS[0];
const PREVIEW_ZOOM_MAX = PREVIEW_ZOOM_STEPS[PREVIEW_ZOOM_STEPS.length - 1];

/** The panel's zoom: a stop on the ladder, or the panel/page relationship. */
type PreviewZoom = 'fit' | number;

/**
 * The next ladder stop in `direction`, from any ratio — including one that is
 * not a stop itself, which is what the ± buttons measure out of `Fit`.
 */
function nextPreviewZoomStep(from: number, direction: 1 | -1): number {
  if (direction > 0) {
    return PREVIEW_ZOOM_STEPS.find((step) => step > from + 0.001) ?? PREVIEW_ZOOM_MAX;
  }
  const lower = PREVIEW_ZOOM_STEPS.filter((step) => step < from - 0.001);
  return lower.length > 0 ? lower[lower.length - 1] : PREVIEW_ZOOM_MIN;
}

type PreviewOutcome =
  | { kind: 'ready'; contentKey: string; width: number; height: number; disclosures: string[]; changedPages: number[]; verificationChecks: PdfPostExportVerification['checks']; pendingConfirmation: PdfExportImpact | null }
  | { kind: 'blocked'; message: string; impact?: PdfExportImpact; recoverable: boolean; processingRequired?: boolean };

export default function PdfEditorPreview({
  page,
  totalPages,
  pageSize,
  editVersion,
  documentSession,
  dprEpoch,
  resizeEpoch,
  renderExportedPageToCanvas,
  onRequestProcessing,
  onReviewExport,
}: Props) {
  const previewCanvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [isRendering, setIsRendering] = useState(false);
  const [outcome, setOutcome] = useState<PreviewOutcome | null>(null);
  const [zoom, setZoom] = useState<PreviewZoom>('fit');
  const [retryEpoch, setRetryEpoch] = useState(0);
  const [paused, setPaused] = useState(false);
  const attemptRef = useRef(0);

  /**
   * The page the panel shows.
   *
   * The preview is a reading surface, so it may sit on any page of the export
   * — but opening it, or moving in the editor, puts it back on the page being
   * edited. Content keys, the build and the ladder all ride the displayed
   * page; the editor's page is only what the panel returns to.
   */
  const [displayPage, setDisplayPage] = useState(page);

  useEffect(() => {
    setDisplayPage(page);
  }, [page]);

  /**
   * Organise/drop operations can shrink the plan while the preview sits on a
   * page past its new end. The export no longer has that page, so the panel
   * cannot either.
   */
  useEffect(() => {
    if (totalPages > 0 && displayPage > totalPages) setDisplayPage(totalPages);
  }, [totalPages, displayPage]);

  /**
   * What the visible canvas is showing, as `${displayPage}:${editVersion}`.
   *
   * Written only when a build has actually been committed, and cleared when one
   * fails. It is what separates a rebuild of different content (clear first —
   * the old raster is the wrong document) from a rebuild of the same content at
   * a new scale (keep it — the old raster is the right document, just sampled
   * for a different display size).
   */
  const displayedContentRef = useRef<string | null>(null);

  /**
   * The build function's identity is not a rebuild signal.
   *
   * `renderExportedPageToCanvas` is recreated whenever any callback it closes
   * over changes state during a build — autosave alone does that. Making it an
   * effect dependency turned the preview into a self-restarting loop: build →
   * autosave state → new callback → effect restart → build. The document was
   * valid and the preview was correct, but the tab never went idle.
   *
   * The contract says rebuild on a committed edit (`editVersion`), a page
   * change, or a zoom change (`outputScale`) — and, through the two epochs, on
   * a device-ratio move and a dragged panel width, the two events that change
   * what the next build should rasterise for without changing what the export
   * *is*. Those are the dependencies; the function is read through a ref so a
   * fresh closure is still used without restarting the timer.
   */
  const renderExportedPageRef = useRef(renderExportedPageToCanvas);
  useEffect(() => {
    renderExportedPageRef.current = renderExportedPageToCanvas;
  }, [renderExportedPageToCanvas]);

  const contentKey = `${documentSession}:${displayPage}:${editVersion}`;
  const readyOutcome = outcome?.kind === 'ready' && outcome.contentKey === contentKey ? outcome : null;

  /**
   * The raster's output scale for the current display size.
   *
   * The pure helper folds the device's pixel ratio and the zoom into one
   * multiplier inside the module's pixel budget, so the panel is built for what
   * it will actually show. `Fit` is measured as the page's own layout size
   * (zoom 1): the standard page sizes lay out wider than the panel's 560px cap,
   * so fit is a shrink there, and re-measuring the panel here would make the
   * effect's dependency a DOM read — a value that can move between renders
   * without anything having happened.
   */
  const outputScale = resolvePdfEditorPreviewOutputScale({
    zoom: zoom === 'fit' ? 1 : zoom,
    cssWidth: readyOutcome?.width,
    cssHeight: readyOutcome?.height,
    // Read here, never cached: a window moved between screens must sharpen on
    // its next build rather than keep the old ratio forever.
    devicePixelRatio: typeof window === 'undefined' ? undefined : window.devicePixelRatio,
  });

  useEffect(() => {
    if (paused) return;
    const attempt = ++attemptRef.current;
    /**
     * The two kinds of rebuild, and why they clear differently.
     *
     * `editVersion`/`page` change what the export *is*: the raster on screen is
     * then the previous document, and leaving it there would present a stale
     * page as the current result — blank + "Building" is the only honest state
     * until the new bytes exist. A zoom change (through `outputScale`) changes
     * only how large the same bytes are shown: the picture is still the current
     * export, sampled for the previous scale, and it stays visible until the
     * new raster is committed in one frame.
     */
    const scaleOnly = displayedContentRef.current === contentKey;
    let cancelled = false;
    const active = () => !cancelled && attemptRef.current === attempt;
    let timeout: number | undefined;

    /**
     * Erase the previous build as soon as the inputs change.
     *
     * The debounce (and then the engine round trip) can take seconds. Leaving
     * the last page on screen during that window presented the *old* document
     * as the current result: a freshly marked redaction still showed its source
     * text, which reads as "the redaction did not work" even though the next
     * build contains it. Blank + "Building" is the only honest state until the
     * new bytes exist. Scheduled in a frame so this effect does not set state
     * synchronously on every keystroke.
     */
    const clearStaleFrame = window.requestAnimationFrame(() => {
      if (!active()) return;
      if (!scaleOnly) {
        const stale = previewCanvasRef.current;
        if (stale) clearCanvas(stale);
        setOutcome(null);
      }
      setIsRendering(true);
    });

    const timer = window.setTimeout(() => {
      /**
       * The build draws into a detached buffer and the visible canvas is
       * replaced only once the build is whole. Assigning `canvas.width` clears
       * a canvas, so drawing straight into the visible one would blank the
       * panel for the length of the engine's paint — and would throw away the
       * still-correct picture a zoom-only rebuild is allowed to keep showing.
       */
      const buffer = document.createElement('canvas');
      setIsRendering(true);
      timeout = window.setTimeout(() => {
        if (!active()) return;
        cancelled = true;
        displayedContentRef.current = null;
        if (previewCanvasRef.current) clearCanvas(previewCanvasRef.current);
        setIsRendering(false);
        setOutcome({ kind: 'blocked', recoverable: false, message: 'Preview timed out. Retry or return to editing. A server request already sent may still finish.' });
      }, 90_000);

      renderExportedPageRef.current(displayPage, buffer, { outputScale })
        .then((result) => {
          if (!active()) return;
          if (result.ok) {
            const target = previewCanvasRef.current;
            if (target) commitCanvas(target, buffer);
            displayedContentRef.current = contentKey;
            setOutcome({
              kind: 'ready',
              contentKey,
              width: result.width,
              height: result.height,
              disclosures: result.disclosures,
              changedPages: result.changedPages,
              verificationChecks: result.verificationChecks,
              pendingConfirmation: result.pendingConfirmation,
            });
            return;
          }
          // Nothing was produced, so nothing may be shown. Clearing the canvas
          // matters: leaving the previous build on screen would present a stale
          // page as the current one. It also resets the content record, so the
          // next attempt is treated as a rebuild rather than a re-sample.
          const stale = previewCanvasRef.current;
          if (stale) clearCanvas(stale);
          displayedContentRef.current = null;
          setOutcome({
            kind: 'blocked',
            // The build's own refusal is the reason there is no preview. This
            // panel used to replace it with "Preview is updating", which hid an
            // engine refusal behind a progress-sounding sentence.
            message: result.message,
            impact: result.impact,
            recoverable: Boolean(result.consent),
            processingRequired: result.processingRequired,
          });
        })
        .catch((error: unknown) => {
          if (!active()) return;
          console.error('Preview build failed', error);
          const target2 = previewCanvasRef.current;
          if (target2) clearCanvas(target2);
          displayedContentRef.current = null;
          setOutcome({
            kind: 'blocked',
            message: error instanceof Error
              ? error.message
              : 'The preview could not be built, so there is nothing to show.',
            recoverable: false,
          });
        })
        .finally(() => {
          window.clearTimeout(timeout);
          if (active()) setIsRendering(false);
        });
    }, PREVIEW_REBUILD_DELAY_MS);

    return () => {
      cancelled = true;
      window.cancelAnimationFrame(clearStaleFrame);
      window.clearTimeout(timer);
      window.clearTimeout(timeout);
    };
  }, [contentKey, displayPage, outputScale, resizeEpoch, dprEpoch, retryEpoch, paused]);

  const cancelPreview = () => {
    attemptRef.current += 1;
    setPaused(true);
    setIsRendering(false);
    setOutcome(null);
    displayedContentRef.current = null;
    if (previewCanvasRef.current) clearCanvas(previewCanvasRef.current);
  };
  const retryPreview = () => { setPaused(false); setRetryEpoch(epoch => epoch + 1); };

  /**
   * Fit is a layout relationship, not a stop on the ladder, so a ± click from
   * Fit resolves the panel's current ratio at click time: its inner width over
   * the page width of the last committed build.
   */
  const fitZoomAtClick = () => {
    const wrap = wrapRef.current;
    if (!wrap || !readyOutcome || readyOutcome.width <= 0) return 1;
    return wrap.clientWidth / readyOutcome.width;
  };

  const stepZoom = (direction: 1 | -1) => {
    const from = zoom === 'fit' ? fitZoomAtClick() : zoom;
    const next = nextPreviewZoomStep(from, direction);
    // Fit can sit past an end of the ladder — a panel narrower than the
    // smallest stop, or wider than the largest. There is nothing beyond it in
    // that direction, and stepping the "wrong" way would make the button lie
    // about which way it zooms.
    if (zoom === 'fit' && (direction > 0 ? next <= from : next >= from)) return;
    setZoom(next);
  };

  const zoomSteppable = readyOutcome !== null;
  const atLadderMin = typeof zoom === 'number' && zoom <= PREVIEW_ZOOM_MIN;
  const atLadderMax = typeof zoom === 'number' && zoom >= PREVIEW_ZOOM_MAX;

  // At a numeric zoom the page is laid out at its own width times the zoom and
  // the wrap scrolls to pan it; the inline width defeats the stylesheet's
  // `max-width: 100%`, which exists for the Fit layout it was written for.
  const zoomedWidthPx = readyOutcome && typeof zoom === 'number'
    ? Math.round(readyOutcome.width * zoom)
    : null;

  return (
    <div className="pe-preview-root">
      <style>{`
        .pe-preview-root {
          width: 100%;
          flex: 1 1 auto;
          min-height: 0;
          display: flex; flex-direction: column; align-items: center; gap: 8px;
        }
        /* The panel's page area fills the column: the wrap is the scrolling
           viewport for the page (both axes at a numeric zoom), so its height is
           what remains after the head row rather than a fixed figure that could
           leave the scrollbar's own end clipped. */
        .pe-preview-root .pe-preview-wrap {
          flex: 1 1 auto;
          min-height: 120px;
        }
        .pe-preview-review { width: 100%; display: flex; flex-wrap: wrap; align-items: center; gap: 8px; color: var(--pe-text-2); font-size: 11.5px; font-variant-numeric: tabular-nums; }
        .pe-preview-review strong { color: var(--pe-text); }
        .pe-preview-review .pe-preflight-action { margin: 0; }
        .pe-preview-review summary { cursor: pointer; }
        /* The status row exists only when it has something to say — a build in
           flight (its cancel), or pages the build changed. Everything else it
           used to carry (the panel's name, the build revision, the page
           position) either belongs to the head's controls or is internal
           bookkeeping, and repeating it here was two rows of readout above a
           page the user is trying to read. */
        /* One compact control line: the zoom strip, the page navigation and the
           page-size label stay on a single row, and the row never wraps — the
           size label (the only flexible item) gives way first, and on the
           narrowest rows the line scrolls sideways instead of stacking, so the
           page keeps the row's whole height. */
        .pe-preview-head { flex-wrap: nowrap; gap: 8px; min-width: 0; overflow-x: auto; scrollbar-width: none; }
        .pe-preview-head::-webkit-scrollbar { display: none; }
        .pe-preview-changes { width: 100%; max-height: 132px; overflow: auto; border-top: 1px solid var(--pe-line); padding-top: 8px; }
        .pe-preview-changes p { margin: 3px 0; }
        .pe-preview-changes summary:focus-visible { outline: 2px solid var(--pe-focus); }
        @media (max-width: 700px) {
          .pe-preview-zoom-btn, .pe-preview-zoom-step, .pe-preview-nav-jump { min-height: 40px; min-width: 32px; }
          .pe-preview-root .pe-preflight-action { min-height: 40px; }
        }
        /* Same object language as the command bar's zoom cluster (pe-zoom-*):
           one control strip, the accent only on the active stop. It sits in the
           panel head, so it uses that row's height and resets the head's
           uppercase treatment — the stops read as controls, "Fit" and "100%",
           rather than as two more labels in the head's voice. */
        .pe-preview-zoom {
          flex: 0 0 auto;
          display: flex; align-items: center; gap: 2px;
          padding: 2px;
          border: 1px solid var(--pe-line);
          border-radius: 8px;
          background: var(--pe-panel);
          text-transform: none;
          letter-spacing: 0;
        }
        .pe-preview-zoom-btn,
        .pe-preview-zoom-step {
          height: 26px;
          border: 0; border-radius: 5px;
          background: transparent;
          color: var(--pe-text-2);
          font-family: inherit;
          font-size: 11px; font-weight: 700;
          font-variant-numeric: tabular-nums;
          cursor: pointer;
          transition: background-color var(--pe-dur-fast) var(--pe-ease-out), color var(--pe-dur-fast) var(--pe-ease-out);
        }
        .pe-preview-zoom-btn { min-width: 34px; padding: 0 8px; }
        .pe-preview-zoom-step { width: 26px; font-size: 14px; }
        .pe-preview-zoom-btn:hover:not(:disabled),
        .pe-preview-zoom-step:hover:not(:disabled) { background: var(--pe-panel-3); color: var(--pe-text); }
        .pe-preview-zoom-btn.active { background: var(--pe-signal-soft); color: var(--pe-signal-ink); }
        /* The current stop keeps its accent while hovered: a pointer resting on
           the button is not a reason to hide which zoom the panel is showing. */
        .pe-preview-zoom-btn.active:hover:not(:disabled) { background: var(--pe-signal-soft); color: var(--pe-signal-ink); }
        .pe-preview-zoom-btn:focus-visible,
        .pe-preview-zoom-step:focus-visible { outline: 2px solid var(--pe-focus); outline-offset: 1px; }
        .pe-preview-zoom-step:disabled { opacity: .32; cursor: default; }
        /* The page the panel is on, with the same control language as the zoom
           strip. Reading the export is a real panel capability — the user can
           page through the built result without switching the editor away from
           the page being edited. */
        .pe-preview-nav {
          flex: 0 0 auto;
          display: flex; align-items: center; gap: 2px;
          padding: 2px;
          border: 1px solid var(--pe-line);
          border-radius: 8px;
          background: var(--pe-panel);
          text-transform: none;
          letter-spacing: 0;
        }
        .pe-preview-nav-pos {
          min-width: 44px;
          text-align: center;
          color: var(--pe-text-2);
          font-size: 11px; font-weight: 700;
          font-variant-numeric: tabular-nums;
        }
        /* Shown only when the panel is not on the page being edited: a small
           way back, not a decoration. Same quiet family as the other steps. */
        .pe-preview-nav-jump {
          flex: 0 0 auto;
          height: 26px;
          padding: 0 8px;
          border: 1px solid var(--pe-line);
          border-radius: 8px;
          background: var(--pe-panel);
          color: var(--pe-signal-ink);
          font-family: inherit;
          font-size: 11px; font-weight: 700;
          font-variant-numeric: tabular-nums;
          cursor: pointer;
          transition: background-color var(--pe-dur-fast) var(--pe-ease-out), color var(--pe-dur-fast) var(--pe-ease-out);
        }
        .pe-preview-nav-jump:hover:not(:disabled) { background: var(--pe-panel-3); }
        .pe-preview-nav-jump:focus-visible { outline: 2px solid var(--pe-focus); outline-offset: 1px; }
        @media (prefers-reduced-motion: reduce) {
          .pe-preview-zoom-btn,
          .pe-preview-zoom-step,
          .pe-preview-nav-jump { transition: none; }
        }
      `}</style>

      <div className="pe-preview-head">
        <div className="pe-preview-zoom" role="group" aria-label="Export preview zoom">
          <button
            type="button"
            className={`pe-preview-zoom-btn${zoom === 'fit' ? ' active' : ''}`}
            aria-pressed={zoom === 'fit'}
            onClick={() => setZoom('fit')}
            title="Fit page to preview panel"
            data-testid="pdf-preview-zoom-fit"
          >
            Fit
          </button>
          <button
            type="button"
            className={`pe-preview-zoom-btn${zoom === 1 ? ' active' : ''}`}
            aria-pressed={zoom === 1}
            onClick={() => setZoom(1)}
            title="Reset zoom to 100%"
            data-testid="pdf-preview-zoom-100"
          >
            100%
          </button>
          <button
            type="button"
            className={`pe-preview-zoom-btn${zoom === 2 ? ' active' : ''}`}
            aria-pressed={zoom === 2}
            onClick={() => setZoom(2)}
            title="Zoom to 200%"
            data-testid="pdf-preview-zoom-200"
          >
            200%
          </button>
          <button
            type="button"
            className="pe-preview-zoom-step"
            onClick={() => stepZoom(-1)}
            disabled={!zoomSteppable || atLadderMin}
            aria-label="Zoom out"
            title="Zoom out"
            data-testid="pdf-preview-zoom-out"
          >
            −
          </button>
          <button
            type="button"
            className="pe-preview-zoom-step"
            onClick={() => stepZoom(1)}
            disabled={!zoomSteppable || atLadderMax}
            aria-label="Zoom in"
            title="Zoom in"
            data-testid="pdf-preview-zoom-in"
          >
            +
          </button>
        </div>
        <div className="pe-preview-nav" role="group" aria-label="Export preview page">
          <button
            type="button"
            className="pe-preview-zoom-step"
            onClick={() => setDisplayPage(current => Math.max(1, current - 1))}
            disabled={displayPage <= 1}
            aria-label="Previous page in preview"
            title="Previous page in preview"
            data-testid="pdf-preview-page-prev"
          >
            ‹
          </button>
          <span className="pe-preview-nav-pos">{displayPage} / {Math.max(1, totalPages || displayPage)}</span>
          <button
            type="button"
            className="pe-preview-zoom-step"
            onClick={() => setDisplayPage(current => Math.min(Math.max(1, totalPages || current), current + 1))}
            disabled={displayPage >= (totalPages || displayPage)}
            aria-label="Next page in preview"
            title="Next page in preview"
            data-testid="pdf-preview-page-next"
          >
            ›
          </button>
        </div>
        {displayPage !== page && (
          <button
            type="button"
            className="pe-preview-nav-jump"
            onClick={() => setDisplayPage(page)}
            title="Show the page being edited"
          >
            Editing {page}
          </button>
        )}
        <span className="pe-preview-size" title={pageSize.toUpperCase()}>{pageSize.toUpperCase()}</span>
      </div>

      {isRendering && (
        <div className="pe-preview-review" data-testid="pdf-preview-review">
          <button type="button" className="pe-preflight-action" onClick={cancelPreview}>Cancel preview</button>
        </div>
      )}
      {!isRendering && readyOutcome && !!readyOutcome.changedPages.length && (
        <div className="pe-preview-review" data-testid="pdf-preview-review">
          <span>Changed output pages: {readyOutcome.changedPages.join(', ')}</span>
        </div>
      )}

      <div className="pe-preview-wrap" ref={wrapRef}>
        <div
          className="pe-preview-page-frame"
          style={readyOutcome
            ? {
                aspectRatio: `${readyOutcome.width} / ${readyOutcome.height}`,
                ...(zoomedWidthPx ? { width: `${zoomedWidthPx}px` } : {}),
              }
            : undefined}
        >
          <canvas
            ref={previewCanvasRef}
            className="pe-preview-canvas"
            data-testid="pdf-preview-canvas"
            data-preview-ready={readyOutcome && !isRendering ? 'true' : 'false'}
            // Hidden rather than unmounted: the ref has to survive so the next
            // build has a canvas to draw into.
            style={outcome?.kind === 'blocked' || paused
              ? { display: 'none' }
              : zoomedWidthPx
                ? { width: `${zoomedWidthPx}px`, maxWidth: 'none' }
                : undefined}
          />

          {outcome?.kind === 'blocked' && (
            <div className="pe-preview-blocked" role="status" data-testid="pdf-preview-blocked">
              <strong>{outcome.processingRequired ? 'Server permission required' : outcome.impact?.title ?? 'This document cannot be exported yet'}</strong>
              <p>{outcome.message}</p>
              {outcome.processingRequired
                ? <button type="button" className="pe-preflight-action" data-testid="pdf-preview-processing" onClick={event => { event.currentTarget.focus(); onRequestProcessing(); }}>Review processing permission</button>
                : outcome.recoverable
                  ? <button type="button" className="pe-preflight-action" onClick={event => { event.currentTarget.focus(); onReviewExport(); }}>Review export consequences</button>
                   : <button type="button" className="pe-preflight-action" disabled={isRendering} onClick={retryPreview}>Retry preview</button>}
            </div>
          )}
          {paused && <div className="pe-preview-blocked" role="status" data-testid="pdf-preview-blocked"><strong>Preview cancelled</strong><p>No download was started. A server request already sent may still finish.</p><button type="button" className="pe-preflight-action" onClick={retryPreview}>Retry preview</button></div>}
        </div>

        {isRendering && <div className="pe-preview-status" role="status">Building export preview...</div>}
      </div>
      {readyOutcome && !isRendering && (
        <div className="pe-preview-review pe-preview-changes" role="status" data-testid="pdf-preview-disclosures">
          {readyOutcome.disclosures.map(note => <p key={note}>{note}</p>)}
          {readyOutcome.pendingConfirmation && <p>Download still requires review: {readyOutcome.pendingConfirmation.summary}</p>}
          {readyOutcome.pendingConfirmation && <button type="button" className="pe-preflight-action" onClick={event => { event.currentTarget.focus(); onReviewExport(); }}>Review export consequences</button>}
          <details data-testid="pdf-preview-diagnostics"><summary>Verification details</summary><ul>{readyOutcome.verificationChecks.map((check, index) => <li key={`${check.id}-${index}`}>{check.status}: {check.detail}</li>)}</ul><p>The preview renders the generated PDF bytes. These checks are not a guarantee of every visual detail, reading order, hidden structure or external-reader behavior.</p></details>
        </div>
      )}
    </div>
  );
}

/**
 * Replace the visible canvas with a finished build in one task.
 *
 * Assigning `width`/`height` clears the canvas, so the copy has to happen after
 * the resize and in the same task: the panel never shows the blank rectangle in
 * between.
 */
function commitCanvas(target: HTMLCanvasElement, source: HTMLCanvasElement) {
  target.width = source.width;
  target.height = source.height;
  const ctx = target.getContext('2d');
  if (!ctx) throw new Error('The preview canvas is unavailable. Retry preview.');
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.drawImage(source, 0, 0);
}

function clearCanvas(target: HTMLCanvasElement) {
  const ctx = target.getContext('2d');
  if (!ctx) return;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, target.width, target.height);
}
