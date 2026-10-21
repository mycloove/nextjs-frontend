/**
 * Geometry of one original text span, derived from a PDF.js text item.
 *
 * Why this is a pure module of its own
 * -----------------------------------
 * These four numbers are not presentation. The same rectangle is
 *
 *   1. the click target drawn over the page (`PdfEditorCanvas`), and
 *   2. the rectangle the structural text engine **redacts** — every glyph
 *      inside it is deleted from the content stream.
 *
 * So an over-large rectangle is not a cosmetic problem, it is data loss and a
 * failed export. The engine's unnamed-text guard refuses any edit whose box
 * covers text `originalText` does not name, and the transaction is atomic, so a
 * single inflated box loses the whole document. That is precisely what a former
 * `Math.max(12, …)` floor on both axes did: on an ordinary 9–10pt document a
 * 12pt-tall box reaches into the line above or below, so editing *any* line
 * refused the export and the user got no file at all.
 *
 * The rectangle therefore tracks the real glyph extents. {@link MIN_TEXT_BLOCK_EXTENT}
 * exists only to keep a degenerate zero-extent rect — which would match no
 * glyphs and be refused for the opposite reason — out of the payload. Minimums
 * that exist to make a control comfortable to click belong to the component
 * that draws it (`PdfEditorCanvas` already applies its own, larger ones), never
 * to the value the engine redacts.
 */

/**
 * The fields this module reads from a PDF.js `getTextContent()` item.
 *
 * Declared structurally rather than imported so the derivation can be tested
 * without pdfjs-dist, a DOM, or a real document.
 */
export type PdfTextItemGeometrySource = {
  str: string;
  /** Advance width in text space. PDF.js omits it for some items. */
  width?: number;
  /** Glyph height in text space. Also optional. */
  height?: number;
};

/**
 * Font ascent/descent as fractions of the font size (PDF.js `styles` reports
 * them this way). Undefined means the producer did not expose metrics.
 */
export type PdfTextFontMetrics = {
  ascent?: number;
  descent?: number;
};

export type PdfEditorTextBlockGeometry = {
  /** Left edge, device pixels, top-left origin. */
  x: number;
  /** Top edge, device pixels, top-left origin. */
  y: number;
  width: number;
  height: number;
  /**
   * The run's full font box in device pixels: ascent above the baseline plus
   * descent below it. This is what the hover target and the black preview bar
   * paint, so no visible glyph can peek outside while no neighbouring run is
   * included. The engine rectangle above stays tighter on purpose.
   */
  fontBox: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  /**
   * Size to render the editing control at, in the transform's own space.
   * Floored for legibility, so it is a *display* value and nothing that
   * reaches the document may be derived from it.
   *
   * It used to be documented as safe "because it is never sent as the engine's
   * `fontSize`". That was not true: `usePdfEditor`'s edit record seeded
   * `fontSize` from this field, `isEffectiveTextEdit` then compared the floored
   * display value against the source point size and reported a size change the
   * user never made, and `toServerTextEditRequest` duly asked the engine to
   * re-render the line at the floor. Anything that reaches the document must
   * use {@link PdfEditorTextBlockGeometry.sourceFontSize} instead.
   */
  fontSize: number;
  /**
   * The size the document actually sets this run at, unfloored, in the
   * transform's own space — divide by the viewport scale for points.
   *
   * This is the only size that may be stored, compared, or sent onward: it is
   * a property of the document, so it does not change when the user zooms.
   */
  sourceFontSize: number;
};

/**
 * Smallest rectangle side we will hand to the engine, in device pixels.
 *
 * One pixel, not twelve. Large enough that the rect encloses its own glyphs at
 * any realistic size, small enough that it cannot reach an adjacent line even
 * in 6pt body text set solid.
 */
export const MIN_TEXT_BLOCK_EXTENT = 1;

/** Floor for the *displayed* size only. Never widens the redaction rect. */
export const MIN_TEXT_BLOCK_FONT_SIZE = 8;

/** Used when the transform carries no scale and PDF.js reports no height. */
const FALLBACK_FONT_SIZE = 12;

/** Rough advance-per-character, as a fraction of the size. */
const FALLBACK_WIDTH_PER_CHARACTER = 0.5;

/** Rough line box, as a multiple of the size. */
const FALLBACK_HEIGHT_RATIO = 1.2;

/**
 * PDF.js reports the full font em box as `item.height`, but the ink sits in
 * the lower part of it: the top quarter of the em box is where the *previous*
 * line's descenders land when a document sets text solid (leading == em, the
 * Cambria-style default of many PDF producers). Including that region
 * in the redaction rectangle made the engine's unnamed-text guard read whole
 * neighbouring lines as unnamed text and refuse the entire atomic transaction
 * — every line of a densely set document at once, so nothing could be exported.
 *
 * The rectangle therefore starts at the ascent line instead of the em top.
 * Redaction is intersection-based, so every glyph of the edited span is still
 * deleted (its ink runs from the ascent down past the baseline, all inside the
 * shrunken rectangle), while the line above — whose descenders end ~0.2em
 * short of this baseline — is no longer touched. The bottom edge stays on the
 * baseline, clear of the next line's ascenders by the same ~0.2em.
 */
const GLYPH_TOP_INSET_FRACTION = 0.25;

/**
 * Below this, a basis term is treated as zero. PDF.js's unchanged axes are
 * exact zeros; a rotated page's terms are the viewport scale, never this small.
 */
const ROTATION_EPSILON = 1e-6;

/**
 * Turn one PDF.js text item into the editor's rectangle.
 *
 * `deviceTransform` is the item's transform already composed with the
 * viewport's — i.e. `pdfjsLib.Util.transform(viewport.transform, item.transform)`.
 * The composition stays with the caller so this function needs no pdfjs import
 * and the arithmetic that decides a refusal stays provable in isolation.
 *
 * `zoom` scales the text-space extents to match the viewport the transform was
 * built for.
 */
export function deriveTextBlockGeometry(
  item: PdfTextItemGeometrySource,
  deviceTransform: readonly number[],
  zoom: number,
  metrics: PdfTextFontMetrics = {},
): PdfEditorTextBlockGeometry {
  const itemWidth = normalizeExtent(item.width);
  const itemHeight = normalizeExtent(item.height);
  const scale = Number.isFinite(zoom) && zoom > 0 ? zoom : 1;
  // The composed `[a, b, c, d, e, f]`: text-space axes, then the origin.
  const a = deviceTransform[0] ?? 0;
  const b = deviceTransform[1] ?? 0;
  const c = deviceTransform[2] ?? 0;
  const d = deviceTransform[3] ?? 0;
  const e = deviceTransform[4] ?? 0;
  const f = deviceTransform[5] ?? 0;

  /**
   * The transform's own scale is the document's real size. Kept unfloored for
   * the fallbacks below: flooring here would inflate the rect of genuinely
   * small text, which is the whole failure this module exists to prevent.
   */
  const sourceFontSize = normalizeExtent(
    Math.hypot(b, d),
  )
    || itemHeight * scale
    || FALLBACK_FONT_SIZE;

  const width = Math.max(
    MIN_TEXT_BLOCK_EXTENT,
    (itemWidth || item.str.length * sourceFontSize * FALLBACK_WIDTH_PER_CHARACTER) * scale,
  );
  const height = Math.max(
    MIN_TEXT_BLOCK_EXTENT,
    (itemHeight || sourceFontSize * FALLBACK_HEIGHT_RATIO) * scale,
  );

  const topInset = height * GLYPH_TOP_INSET_FRACTION;
  const inkHeight = height - topInset;

  /**
   * The visual/target box is the face's full ascent and descent, not the
   * inset engine rectangle. `metrics` are em fractions from PDF.js. The ascent
   * is never allowed below the ink height, and when the producer exposes no
   * metrics a typical descent is assumed: the target and the black bar must
   * cover every visible tail, while still stopping at this run's own advance.
   */
  const metricAscent = Number.isFinite(metrics.ascent) && (metrics.ascent as number) > 0
    ? (metrics.ascent as number) * sourceFontSize
    : 0;
  const metricDescent = Number.isFinite(metrics.descent) && (metrics.descent as number) > 0
    ? (metrics.descent as number) * sourceFontSize
    : 0;
  const ascentPx = Math.max(inkHeight, metricAscent);
  // Respect a reported descent exactly: solid-set text has no vertical slack,
  // and adding a generic margin would put the neighbouring line inside the
  // cover. The generous fallback is only for producers that expose no metrics.
  const descentPx = metricDescent > 0 ? metricDescent : inkHeight * 0.35;

  /**
   * Rotated pages need the rectangle built from the text's own axes.
   *
   * The composition above contains the page rotation: for a page turned 90°,
   * `[a, b, c, d]` is `[0, 14, 14, 0]`, so the baseline runs *down* the page
   * and the ascent points *right*. The unrotated formula below treats every
   * run as horizontal (`x = e`, `y = baseline - height`), which put the hit box
   * and the redaction rectangle hundreds of points to the right of the rotated
   * glyphs - outside the page entirely, so clicking the text did nothing and
   * the export still contained it.
   *
   * The advance and ascent are mapped through those same axes, then their
   * four corners are reduced to an axis-aligned box: the rectangle the engine
   * receives is still top-left based in visual space, exactly as its contract
   * says. For unrotated text `b` and `c` are zero and the original arithmetic
   * is used unchanged.
   */
  if (Math.abs(b) > ROTATION_EPSILON || Math.abs(c) > ROTATION_EPSILON) {
    const advanceAxis = Math.hypot(a, b) || 1;
    const ascentAxis = Math.hypot(c, d) || 1;
    const advanceX = (a / advanceAxis) * width;
    const advanceY = (b / advanceAxis) * width;
    const ascentX = (c / ascentAxis) * inkHeight;
    const ascentY = (d / ascentAxis) * inkHeight;
    const originX = e;
    const originY = f;
    const corners = [
      { x: originX, y: originY },
      { x: originX + advanceX, y: originY + advanceY },
      { x: originX + ascentX, y: originY + ascentY },
      { x: originX + advanceX + ascentX, y: originY + advanceY + ascentY },
    ];
    const xs = corners.map(corner => corner.x);
    const ys = corners.map(corner => corner.y);
    const left = Math.min(...xs);
    const top = Math.min(...ys);

    const upX = c / ascentAxis;
    const upY = d / ascentAxis;
    const fontCorners = [
      { x: originX + upX * ascentPx, y: originY + upY * ascentPx },
      { x: originX - upX * descentPx, y: originY - upY * descentPx },
      { x: originX + advanceX + upX * ascentPx, y: originY + advanceY + upY * ascentPx },
      { x: originX + advanceX - upX * descentPx, y: originY + advanceY - upY * descentPx },
    ];
    const fontXs = fontCorners.map(corner => corner.x);
    const fontYs = fontCorners.map(corner => corner.y);
    const fontLeft = Math.min(...fontXs);
    const fontTop = Math.min(...fontYs);

    return {
      x: left,
      y: top,
      width: Math.max(MIN_TEXT_BLOCK_EXTENT, Math.max(...xs) - left),
      height: Math.max(MIN_TEXT_BLOCK_EXTENT, Math.max(...ys) - top),
      fontBox: {
        x: fontLeft,
        y: fontTop,
        width: Math.max(MIN_TEXT_BLOCK_EXTENT, Math.max(...fontXs) - fontLeft),
        height: Math.max(MIN_TEXT_BLOCK_EXTENT, Math.max(...fontYs) - fontTop),
      },
      fontSize: Math.max(MIN_TEXT_BLOCK_FONT_SIZE, sourceFontSize),
      sourceFontSize,
    };
  }

  return {
    x: e,
    // PDF.js reports the text baseline; the editor's boxes are top-left based.
    // The top inset keeps the rectangle on glyph ink instead of the em-box top.
    y: f - height + topInset,
    width,
    height: inkHeight,
    fontBox: {
      x: e,
      y: f - ascentPx,
      width,
      height: ascentPx + descentPx,
    },
    fontSize: Math.max(MIN_TEXT_BLOCK_FONT_SIZE, sourceFontSize),
    sourceFontSize,
  };
}

/**
 * Decimal places kept when a size is converted to document points.
 *
 * Four: finer than any size a PDF states or a user can pick, coarse enough to
 * erase the last bits of a double. See {@link documentFontSize} for why erasing
 * them is not cosmetic.
 */
const DOCUMENT_FONT_SIZE_PRECISION = 4;

/**
 * The point size of a run, from a size read at some viewport scale.
 *
 * Why the rounding is load-bearing
 * --------------------------------
 * {@link PdfEditorTextBlockGeometry.sourceFontSize} lives in the space of the
 * transform it was read from, so a caller divides by the scale to get points.
 * Plain division makes the result depend on *which* zoom it was read at: a 6pt
 * line read at Fit width came back as `5.999999999999999`, and read at scale 1
 * — which is what the export path uses — as exactly `6`.
 *
 * `isEffectiveTextEdit` compares the size stored in an edit record against the
 * size of the block it belongs to. Two spellings of the same 6pt therefore read
 * as a size change the user never made, so *every* untouched line on the page
 * became an edit: 21 phantom edits on a 59-line page, each asking the engine to
 * redact a line and put the same text back. The engine's unnamed-text guard
 * then correctly refused — a box on a solid-set line covers its neighbour's
 * glyphs — and the atomic transaction discarded the one real edit with them.
 * The user saw "Atomic text-edit transaction refused" for a document they had
 * touched a single line of, and only at Fit width.
 *
 * Quantising here makes the point size a property of the document, identical at
 * every zoom, which is what the rest of the module already assumes it is.
 */
export function documentFontSize(input: { sourceFontSize: number; zoom: number }): number {
  const scale = normalizeExtent(input.zoom) || 1;
  const size = normalizeExtent(input.sourceFontSize) || FALLBACK_FONT_SIZE;
  const factor = 10 ** DOCUMENT_FONT_SIZE_PRECISION;
  return Math.round((size / scale) * factor) / factor;
}

/** Treat NaN, Infinity and negatives as "not reported" rather than propagating. */
function normalizeExtent(value: number | undefined): number {
  return Number.isFinite(value) && (value as number) > 0 ? (value as number) : 0;
}
