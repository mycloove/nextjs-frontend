/**
 * W3 — Redaction authoring model.
 *
 * A redaction is authored in three visible steps: detect the text runs the PDF
 * already contains, mark the runs that must disappear, then review the list
 * before export. Nothing here removes content; the marks are a contract for the
 * server engine, which performs the removal and proves it on the output bytes.
 *
 * Why the box and the source text are both stored
 * ------------------------------------------------
 * The server finds the glyphs to delete by searching for `originalText` inside
 * the box. A box alone is not enough: PDF text items routinely carry inflated
 * paragraph-sized bounds, and deleting everything under such a box would remove
 * text the user never marked. The source text is the safety contract; the box
 * only disambiguates repeated strings. A mark with no source text is refused
 * here, before it can reach the engine.
 *
 * Coordinates are PDF points with a top-left origin in the page's visual space,
 * matching the server contract and the vector export. Text blocks arrive in the
 * rendered page's pixel space at the current zoom, so every mark is divided by
 * that zoom exactly once.
 */

export type PdfEditorRedactionMark = {
  /** Stable identity; derived from the source run so a toggle cannot duplicate. */
  id: string;
  /** 1-based source page, the coordinate space the server edits. */
  page: number;
  /** `page:index` of the text run, stable across zoom changes. */
  blockKey: string;
  /** The exact source run the user marked. Never the edited text. */
  originalText: string;
  /** Top-left origin, PDF points, visual space. */
  x: number;
  y: number;
  width: number;
  height: number;
  /**
   * `font` when the rectangle is the run's full ascent/descent box rather than
   * the legacy baseline-to-ascent ink box. New marks use the font box so the
   * engine's image-pixel removal covers descenders; the flag lets the preview
   * paint exactly that rectangle instead of expanding it a second time.
   */
  box?: 'font';
};

export type PdfEditorRedactionSource = {
  page: number;
  index: number;
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
};

export type PdfEditorRedactionError =
  | 'invalid-page'
  | 'invalid-block'
  | 'invalid-zoom'
  | 'invalid-box'
  | 'missing-source-text';

export type PdfEditorRedactionMarkResult =
  | { ok: true; mark: PdfEditorRedactionMark }
  | { ok: false; reason: PdfEditorRedactionError; message: string };

export type PdfEditorRedactionToggleResult = {
  marks: readonly PdfEditorRedactionMark[];
  action: 'added' | 'removed';
};

const roundPoint = (value: number) => Math.round(value * 1000) / 1000;

export const PDF_EDITOR_REDACTION_TITLE = 'Redaction removes content permanently';

export function pdfEditorRedactionBlockKey(page: number, index: number): string {
  return `${page}:${index}`;
}

/**
 * Converts a detected text run into the server's coordinate space. A block with
 * no extractable text cannot be proven removed, so it is refused rather than
 * marked as an empty rectangle that would silently delete its neighbours.
 */
export function createPdfEditorRedactionMark(
  source: PdfEditorRedactionSource,
  zoom: number,
): PdfEditorRedactionMarkResult {
  if (!Number.isInteger(source.page) || source.page < 1) {
    return { ok: false, reason: 'invalid-page', message: 'A redaction needs a valid page number.' };
  }
  if (!Number.isInteger(source.index) || source.index < 0) {
    return { ok: false, reason: 'invalid-block', message: 'A redaction needs a valid text-run index.' };
  }
  if (!Number.isFinite(zoom) || zoom <= 0) {
    return { ok: false, reason: 'invalid-zoom', message: 'The page has no usable zoom, so the box cannot be measured.' };
  }
  if (!source.text.trim()) {
    return { ok: false, reason: 'missing-source-text', message: 'This text run has no extractable source text, so removal cannot be proven.' };
  }
  const width = source.width / zoom;
  const height = source.height / zoom;
  if (![source.x, source.y, source.width, source.height].every(Number.isFinite) || width <= 0 || height <= 0) {
    return { ok: false, reason: 'invalid-box', message: 'This text run has no usable box on the page.' };
  }

  const blockKey = pdfEditorRedactionBlockKey(source.page, source.index);
  return {
    ok: true,
    mark: {
      id: `redact:${blockKey}`,
      page: source.page,
      blockKey,
      originalText: source.text,
      x: roundPoint(source.x / zoom),
      y: roundPoint(source.y / zoom),
      width: roundPoint(width),
      height: roundPoint(height),
      box: 'font',
    },
  };
}

/** Add a mark, or remove it if the same source run is already marked. */
export function togglePdfEditorRedactionMark(
  marks: readonly PdfEditorRedactionMark[],
  mark: PdfEditorRedactionMark,
): PdfEditorRedactionToggleResult {
  const existing = marks.findIndex(candidate => candidate.blockKey === mark.blockKey);
  if (existing >= 0) {
    return {
      marks: marks.filter((_, index) => index !== existing),
      action: 'removed',
    };
  }
  return { marks: [...marks, mark], action: 'added' };
}

export function removePdfEditorRedactionMark(
  marks: readonly PdfEditorRedactionMark[],
  id: string,
): readonly PdfEditorRedactionMark[] {
  return marks.filter(mark => mark.id !== id);
}

export function isPdfEditorRedactionMarked(
  marks: readonly PdfEditorRedactionMark[],
  page: number,
  index: number,
): boolean {
  const key = pdfEditorRedactionBlockKey(page, index);
  return marks.some(mark => mark.blockKey === key);
}

export type PdfEditorRedactionDisplayBox = {
  /** CSS pixels, relative to the rendered page. */
  left: number;
  top: number;
  width: number;
  height: number;
};

/**
 * How much room the black preview bar needs around the glyph bounds.
 *
 * The stored mark is the engine rectangle: about 0.75em of ink above the
 * baseline. The bar is a *visual* claim, and a reader judges it by what it
 * covers, so it is anchored to the **font's own ascent and descent** instead:
 *
 * - a glyph can rise above the 0.75em ink box (tall ascenders, capitals,
 *   parentheses, accents). Only bleeding a few percent above the ink top left
 *   their tops visible;
 * - descenders (`g`, `y`, `p`) fall below the baseline, and some faces descend
 *   further than the generic 0.25em;
 * - italic overhang and antialiasing need horizontal room as well.
 *
 * The result is deliberately generous: overlapping the line's own leading is
 * harmless for a redaction bar, while any visible glyph sliver reads as a
 * failed redaction. This is display-only. The stored rectangle - and therefore
 * the server's removal and neighbour-safety guard - keeps its exact bounds.
 */
export const REDACTION_MARK_EDGE_RATIO = 0.12;
export const REDACTION_MARK_MIN_EDGE = 2;
export const REDACTION_MARK_SIDE_RATIO = 0.25;
/** Fallback descent when PDF.js does not expose font metrics: 0.45em. */
export const REDACTION_MARK_DESCENT_RATIO = 0.6;
/** Fallback ascent when PDF.js does not expose font metrics: 1.05em. */
export const REDACTION_MARK_ASCENT_RATIO = 1.4;

export type PdfEditorRedactionFontMetrics = {
  /** Ascent above the baseline, in document points. */
  ascent?: number;
  /** Descent below the baseline, in document points, as a positive value. */
  descent?: number;
};

export function pdfEditorRedactionDisplayBox(
  mark: Pick<PdfEditorRedactionMark, 'x' | 'y' | 'width' | 'height'>,
  zoom: number,
  metrics: PdfEditorRedactionFontMetrics = {},
): PdfEditorRedactionDisplayBox {
  const safeZoom = Number.isFinite(zoom) && zoom > 0 ? zoom : 1;
  const inkWidth = Math.max(4, mark.width * safeZoom);
  const inkHeight = Math.max(4, mark.height * safeZoom);
  // The stored box ends at the baseline; everything is anchored there so a
  // measured ascent can move the top without moving the bottom.
  const baseline = mark.y * safeZoom + inkHeight;
  const measuredAscent = Number.isFinite(metrics.ascent) && (metrics.ascent as number) > 0
    ? (metrics.ascent as number) * safeZoom
    : 0;
  const measuredDescent = Number.isFinite(metrics.descent) && (metrics.descent as number) > 0
    ? (metrics.descent as number) * safeZoom
    : 0;
  /**
   * Rotated text keeps its font metrics along a different visual axis: the
   * run's height is the advance and its width is the ink thickness. Applying
   * ascent/descent to the height there would stretch the bar along the line
   * instead of across it. A clearly taller-than-wide box is the rotated case.
   */
  const vertical = inkHeight > inkWidth * 1.5;
  // Everything proportional to the font uses the ink thickness perpendicular
  // to the run: height for horizontal text, width for rotated text.
  const fontBase = vertical ? inkWidth : inkHeight;
  const edge = Math.max(REDACTION_MARK_MIN_EDGE, fontBase * REDACTION_MARK_EDGE_RATIO);
  const padX = Math.max(REDACTION_MARK_MIN_EDGE, fontBase * REDACTION_MARK_SIDE_RATIO);
  // Without source metrics, assume a tall face rather than the bare 0.75em ink
  // box. A too-tall bar only overlaps the line's own leading; a too-short one
  // leaves the top of a capital or accented glyph visible.
  const ascent = measuredAscent > 0
    ? Math.max(fontBase, measuredAscent)
    : fontBase * REDACTION_MARK_ASCENT_RATIO;
  const descent = measuredDescent > 0
    ? measuredDescent
    : fontBase * REDACTION_MARK_DESCENT_RATIO;
  const fontExtent = ascent + descent + edge * 2;

  if (vertical) {
    const padAlong = Math.max(REDACTION_MARK_MIN_EDGE, fontBase * REDACTION_MARK_SIDE_RATIO);
    const thickness = Math.max(inkWidth, fontExtent);
    return {
      left: mark.x * safeZoom + inkWidth / 2 - thickness / 2,
      top: mark.y * safeZoom - padAlong,
      width: thickness,
      height: inkHeight + padAlong * 2,
    };
  }

  return {
    left: mark.x * safeZoom - padX,
    top: baseline - ascent - edge,
    width: inkWidth + padX * 2,
    height: fontExtent,
  };
}

export type PdfEditorRedactionImpact = {
  count: number;
  pages: number[];
  summary: string;
};

export function describePdfEditorRedactionImpact(
  marks: readonly PdfEditorRedactionMark[],
): PdfEditorRedactionImpact {
  const pages = [...new Set(marks.map(mark => mark.page))].sort((a, b) => a - b);
  const count = marks.length;
  if (count === 0) {
    return { count, pages, summary: 'No text is marked for removal.' };
  }
  return {
    count,
    pages,
    summary: `${count} text run${count === 1 ? '' : 's'} on page${pages.length === 1 ? '' : 's'} ${pages.join(', ')} will be permanently removed from the exported file.`,
  };
}

/** Text the final export verifier must prove absent. */
export function pdfEditorRedactionExpectations(
  marks: readonly PdfEditorRedactionMark[],
): { page: number; text: string; label: string }[] {
  return marks.map(mark => ({
    page: mark.page,
    text: mark.originalText,
    label: `Redacted text on page ${mark.page}`,
  }));
}

/**
 * Draft recovery is strict about what it restores: a malformed mark is dropped,
 * and the rest survive. Rejecting the whole draft over one bad rectangle would
 * strand every other edit the user made.
 */
export function normalizePdfEditorRedactionMarks(
  value: unknown,
): PdfEditorRedactionMark[] {
  if (!Array.isArray(value)) return [];
  const marks: PdfEditorRedactionMark[] = [];
  const seen = new Set<string>();

  for (const candidate of value) {
    if (!candidate || typeof candidate !== 'object') continue;
    const record = candidate as Record<string, unknown>;
    const page = record.page;
    const originalText = record.originalText;
    const x = record.x;
    const y = record.y;
    const width = record.width;
    const height = record.height;
    if (!Number.isInteger(page) || (page as number) < 1) continue;
    if (typeof originalText !== 'string' || !originalText.trim()) continue;
    if (![x, y, width, height].every(value => typeof value === 'number' && Number.isFinite(value))) continue;
    if ((width as number) <= 0 || (height as number) <= 0) continue;

    const blockKey = typeof record.blockKey === 'string' && record.blockKey
      ? record.blockKey
      : pdfEditorRedactionBlockKey(page as number, 0);
    if (seen.has(blockKey)) continue;
    seen.add(blockKey);

    marks.push({
      id: typeof record.id === 'string' && record.id ? record.id : `redact:${blockKey}`,
      page: page as number,
      blockKey,
      originalText,
      x: roundPoint(x as number),
      y: roundPoint(y as number),
      width: roundPoint(width as number),
      height: roundPoint(height as number),
      ...(record.box === 'font' ? { box: 'font' as const } : {}),
    });
  }

  return marks;
}
