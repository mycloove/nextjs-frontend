/**
 * Device-pixel scale for every raster this editor owns.
 *
 * Every canvas in the module used to be sized in CSS pixels — `canvas.width`
 * was the page's CSS width at the current zoom. On a DPR 2 or 3 screen that
 * stretched one canvas pixel across two or three physical pixels, so the page,
 * its hairlines and the thumbnails all read as soft. This decides the backing
 * store's multiplier so the raster lands on physical pixels instead.
 *
 * Two guarantees the callers are allowed to rely on:
 *
 *  - **Never below 1×**: a device that reports no usable ratio is rendered
 *    exactly as before, and a raster that would exceed the pixel budget still
 *    renders at CSS resolution. There is no input that makes the editor
 *    blurrier than it already was.
 *  - **Integer backing size**: `canvas.width`/`canvas.height` are unsigned long
 *    attributes; a fraction handed to one is truncated silently, which shaved a
 *    pixel off every page. The pixel size is rounded here, once, so no caller
 *    has to think about it.
 *
 * Pure by construction — the ratio arrives as an argument rather than a
 * `window` read, so the budget arithmetic is testable and the callers own the
 * only environment access in the module.
 */

export interface PdfEditorRenderScaleInput {
  /** Page size in CSS pixels, at the current zoom. */
  cssWidth: number;
  cssHeight: number;
  /** Physical pixels per CSS pixel, i.e. `window.devicePixelRatio`. */
  devicePixelRatio?: number;
  /** Upper bound on the multiplier. Above 2 the memory stops buying legibility. */
  maxPixelRatio?: number;
  /**
   * Total backing-store pixels allowed for one raster. It bounds the scale, not
   * the arithmetic: the returned size is rounded to whole pixels, so the
   * raster may finish a rounding row over it — never a meaningful amount.
   * Defaults to {@link PDF_EDITOR_PAGE_PIXEL_BUDGET}.
   */
  pixelBudget?: number;
}

export interface PdfEditorRenderScale {
  /** Backing pixels per CSS pixel. Always ≥ 1. */
  outputScale: number;
  /** Integer backing-store width to assign to `canvas.width`. */
  pixelWidth: number;
  /** Integer backing-store height to assign to `canvas.height`. */
  pixelHeight: number;
  /**
   * True when the pixel budget, not the device, chose the scale — the raster
   * the device itself asked for would cost more than the budget allows. A
   * caller may spend one settle re-render on such a page at a raised budget;
   * a page at the device's own ratio is already as sharp as the screen, and
   * re-rendering it can never sharpen anything.
   */
  budgetLimited: boolean;
}

/** Above 2×, a second extra copy of every page buys no further legibility. */
export const PDF_EDITOR_MAX_PIXEL_RATIO = 2;
/** One 3× zoomed letter page at 2×, with room to spare. ~48 MB at 4 bytes/px. */
export const PDF_EDITOR_PAGE_PIXEL_BUDGET = 12_000_000;
/**
 * The budget the settle pass may spend on a page that the interaction budget
 * rendered below the device's own ratio. Only a page visibly inside the
 * viewport gets this pass, so a deep zoom buys sharpness for the page being
 * read without handing the same figure to every page of a continuous list.
 * One letter page at 2× (~26 MB at 4 bytes/px) with room to spare.
 */
export const PDF_EDITOR_PAGE_SETTLE_PIXEL_BUDGET = 24_000_000;
/** Thumbnails are re-rendered per page in a list; keep each of them small. */
export const PDF_EDITOR_THUMBNAIL_PIXEL_BUDGET = 2_000_000;
/** The multiplier the export preview has always used; retina and zoom add to it. */
export const PDF_EDITOR_PREVIEW_BASE_PIXEL_RATIO = 2;
/** 3× is the point where a zoomed preview page stops gaining detail. */
export const PDF_EDITOR_PREVIEW_MAX_PIXEL_RATIO = 3;
/**
 * The preview renders one page, never a list, so it can spend a little more
 * than the page raster on the 2×–3× stops a reader actually uses. Above this,
 * a zoomed page trades sharpness for a surviving tab — an honest ceiling, the
 * same one the page raster carries.
 */
export const PDF_EDITOR_PREVIEW_PIXEL_BUDGET = 18_000_000;

function positiveOr(value: number | undefined, fallback: number) {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : fallback;
}

function budgetOr(value: number | undefined, fallback: number) {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? value
    : fallback;
}

export function resolvePdfEditorRenderScale(input: PdfEditorRenderScaleInput): PdfEditorRenderScale {
  const cssWidth = positiveOr(input.cssWidth, 1);
  const cssHeight = positiveOr(input.cssHeight, 1);
  const devicePixelRatio = positiveOr(input.devicePixelRatio, 1);
  const maxPixelRatio = Math.max(1, positiveOr(input.maxPixelRatio, PDF_EDITOR_MAX_PIXEL_RATIO));
  const pixelBudget = budgetOr(input.pixelBudget, PDF_EDITOR_PAGE_PIXEL_BUDGET);

  const deviceScale = Math.min(maxPixelRatio, Math.max(1, devicePixelRatio));
  let outputScale = deviceScale;
  const cssPixels = cssWidth * cssHeight;
  let budgetLimited = false;
  if (cssPixels * outputScale * outputScale > pixelBudget) {
    // Shrink towards the budget, never below CSS resolution: when even 1×
    // exceeds it (an enormous page, a deliberately tiny budget) the
    // never-worse-than-before guarantee wins and the raster stays over budget.
    outputScale = Math.max(1, Math.sqrt(pixelBudget / cssPixels));
    // Strictly below the device scale means the budget did the choosing. The
    // clamp can also land exactly on the device scale (a page whose budgeted
    // scale rounds to it): that page is not missing any sharpness, so it is
    // not flagged — the settle pass is for pages that are.
    budgetLimited = outputScale < deviceScale - 1e-9;
  }

  return {
    outputScale,
    pixelWidth: Math.max(1, Math.round(cssWidth * outputScale)),
    pixelHeight: Math.max(1, Math.round(cssHeight * outputScale)),
    budgetLimited,
  };
}

export interface PdfEditorPreviewScaleInput {
  /** Display zoom of the preview; 1 is the page as laid out at "100%". */
  zoom?: number;
  /** Page size at 100%, in CSS pixels — what the panel lays out. */
  cssWidth?: number;
  cssHeight?: number;
  devicePixelRatio?: number;
  maxPixelRatio?: number;
  pixelBudget?: number;
}

/**
 * Output scale for the export preview raster.
 *
 * The preview has always been built at a fixed 2×: reasonable on a standard
 * screen, soft on a retina one, and never able to answer the user who zooms in
 * because they cannot read the text. It now follows the two things that
 * actually raise the required resolution — the device's pixel ratio and the
 * panel's display zoom — up to a cap, still never below the 2× it has always
 * had at 100%.
 *
 * The preview renders one page, never the pages of a list, so it may spend a
 * little more per raster than the page budget (see
 * {@link PDF_EDITOR_PREVIEW_PIXEL_BUDGET}). Unlike the page floor it may take
 * the scale below 2×: a page magnified to four times its layout size would
 * otherwise ask for a raster no device can hold, and a soft picture at 400%
 * still beats an out-of-memory tab. It never goes below 1×.
 */
export function resolvePdfEditorPreviewOutputScale(input: PdfEditorPreviewScaleInput = {}): number {
  const devicePixelRatio = positiveOr(input.devicePixelRatio, 1);
  const zoom = positiveOr(input.zoom, 1);
  const maxPixelRatio = Math.max(1, positiveOr(input.maxPixelRatio, PDF_EDITOR_PREVIEW_MAX_PIXEL_RATIO));
  const pixelBudget = budgetOr(input.pixelBudget, PDF_EDITOR_PREVIEW_PIXEL_BUDGET);

  let outputScale = Math.min(
    maxPixelRatio,
    Math.max(PDF_EDITOR_PREVIEW_BASE_PIXEL_RATIO, devicePixelRatio * zoom),
  );
  const cssWidth = positiveOr(input.cssWidth, 0) * zoom;
  const cssHeight = positiveOr(input.cssHeight, 0) * zoom;
  if (cssWidth > 0 && cssHeight > 0 && cssWidth * cssHeight * outputScale * outputScale > pixelBudget) {
    outputScale = Math.max(1, Math.min(outputScale, Math.sqrt(pixelBudget / (cssWidth * cssHeight))));
  }

  return outputScale;
}
