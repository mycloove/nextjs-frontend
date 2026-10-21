/**
 * Where the editable text control for one original span is drawn, and how big.
 *
 * Why this is a pure module of its own
 * -----------------------------------
 * `editorTextBlockGeometry` answers "which rectangle does the engine redact" —
 * it deliberately tracks the real glyph extents and nothing else, because every
 * pixel it adds is data the engine deletes. This module answers the *other*
 * question: given that rectangle, where does the `<textarea>` the user types
 * into go? Those are different rectangles with different constraints, and
 * conflating them is what broke the editor twice:
 *
 *   * putting click ergonomics into the redaction rect (the former
 *     `Math.max(12, …)` floor) made every export refuse; and
 *   * drawing the control straight from the redaction rect with absolute CSS
 *     minimums bolted on made the controls escape the page — a `<textarea>`
 *     with no `rows` is two lines tall, and an 18px `minHeight` on a page
 *     scaled to 60% is three times the height of the line it belongs to, so
 *     the bottom rows hung past the page edge onto the workspace background.
 *
 * So the split is: geometry is document truth and must stay minimal; layout is
 * presentation and may grow — but only inside the page it is drawn on. Both are
 * pure functions with colocated tests, because both decide things a screenshot
 * cannot prove and a component cannot be unit-tested for.
 *
 * The three invariants this function exists to hold, at every zoom level
 * ---------------------------------------------------------------------
 *  1. **The control never leaves the page.** Not by inflation, not by a
 *     minimum, not by growing to fit what the user typed, not by the user
 *     dragging an edge outwards. Whatever the fit mode, a control that hangs off
 *     the paper reads as a broken editor.
 *  2. **The text is never clipped.** The box is sized from the font it will
 *     actually render, so one line always fits; anything longer stays reachable
 *     by scrolling inside the control rather than being hidden.
 *  3. **The size the page draws is the size the control draws.** Zoom is
 *     applied exactly once, by the caller, when it converts the record's point
 *     size to device pixels. A control whose glyphs are scaled by zoom twice is
 *     illegible at Fit page and clipped at Fit width — which is precisely the
 *     bug this module was written for.
 */

/** Padding and border of the control, in CSS pixels. Must match the component. */
export type PdfEditorTextControlChrome = {
  borderWidth: number;
  paddingX: number;
  paddingY: number;
};

/**
 * The chrome the canvas actually draws — deliberately none of it.
 *
 * The frame the user sees is painted with `outline` and `box-shadow`, and
 * neither takes part in layout. That is the point: with no border and no
 * padding, the control's *content* box is the glyph rectangle itself, so the
 * replacement text starts exactly where the original glyphs started and is set
 * at exactly their size. Anything else is a lie on screen — the engine
 * re-inserts text at the rectangle's own left edge, so 3px of padding drew the
 * preview 3px right of where the export puts it, visibly out of step with the
 * rest of the line at Fit page.
 *
 * Layout chrome is also the one thing in a control that cannot scale with the
 * zoom: a border stays 1px at 40% and at 300%. So any non-zero value here makes
 * the box a constant taller and its text a constant narrower than the page
 * around it, which is precisely how a one-line span acquires a second line at
 * Fit page — the wrap the user sees as "the boxes are too big". Keeping it at
 * zero is what makes the control a true multiple of itself at every zoom, which
 * `editorTextControlLayout.test.ts` asserts.
 *
 * The arithmetic below still accounts for chrome, and callers may pass their own:
 * a future control with a real border must have it subtracted from the room its
 * text gets, or the box silently stops fitting its own line.
 */
export const PDF_EDITOR_TEXT_CONTROL_CHROME: PdfEditorTextControlChrome = {
  borderWidth: 0,
  paddingX: 0,
  paddingY: 0,
};

/**
 * Smallest side of a control, in CSS pixels — a pointer target, nothing more.
 *
 * Six, not eighteen. Large enough to click at any zoom, small enough that it
 * cannot visibly inflate a line box even in 6pt text viewed at 40%. Ergonomic
 * minimums belong here, in the layer that draws, and never in the rectangle the
 * engine redacts.
 */
export const MIN_TEXT_CONTROL_EXTENT = 6;

/** Absolute floor for a rendered font size. Guards against 0 and NaN only. */
export const MIN_TEXT_CONTROL_FONT_SIZE = 1;

export type PdfEditorTextControlLayout = {
  /** Offsets from the page's top-left corner, CSS pixels. */
  left: number;
  top: number;
  /** Border-box size of the control. */
  width: number;
  height: number;
  /**
   * Room left between the control's origin and the page's far edge.
   *
   * The component applies these as `maxWidth`/`maxHeight`, which is what stops
   * a control from growing off the paper: text longer than the original grows
   * the box only while there is page left, and scrolls inside it after that.
   */
  maxWidth: number;
  maxHeight: number;
  /** Size to render the control's text at, CSS pixels. Never re-scaled. */
  fontSize: number;
};

export type PdfEditorTextControlInput = {
  /**
   * The span's rectangle in the rendered page's pixel space — i.e. a
   * `TextBlock`'s `x`/`y`/`width`/`height`, which already carry the zoom.
   */
  block: { x: number; y: number; width: number; height: number };
  /**
   * The size to draw the control's text at, in the same pixel space.
   *
   * The caller converts: `edit.fontSize * zoom`, where `edit.fontSize` is the
   * document's point size — as is `TextBlock.fontSize`, which seeds it. Passing
   * a value that already carries the zoom applies it twice, and that is exactly
   * the defect this module was written for: the box grew by zoom and its glyphs
   * by zoom², so Fit width clipped the text and Fit page shrank it away.
   */
  fontSize: number;
  /** The control's CSS `line-height` multiplier. */
  lineHeight: number;
  /**
   * Width the *original* run needs to stay on one line, at the font the control
   * actually renders in, in CSS pixels. Optional — omit it and the advance width
   * PDF.js reported is used as-is.
   *
   * That reported width is the run as the document's own embedded font set it,
   * but the control cannot render in that font: `getTextContent()` gives a font
   * *name*, and the editor falls back to Helvetica/Arial. A hair more advance
   * width in the substitute is enough to wrap a line that does not wrap in the
   * document, which doubles the control's height — and whether it happens at all
   * depends on how the size rounds, so the same line wrapped at Actual size while
   * fitting at Fit page and Fit width. The user sees one line of their document
   * drawn as two, in a box twice as tall as the lines around it.
   *
   * This is the *original* run's requirement, never the current content's. Text
   * typed past the end of the run must wrap and grow the box downwards, exactly
   * as the engine reflows it into the same rectangle; widening to fit a whole
   * typed paragraph would march the box across the page instead.
   */
  contentWidth?: number;
  /**
   * Height the control's own text needs, measured from the live element; omit it
   * before the first measurement.
   *
   * A replacement longer than the original wraps, and a box frozen at one line
   * would hide every line after the first — the same "where did my text go?"
   * failure as a double-scaled font, arrived at from the other direction. It is
   * clamped to the page like every other extent here, so growth can never carry
   * the control off the paper.
   */
  contentHeight?: number;
  /**
   * Size the user has dragged this control to, in the same pixel space as
   * `block`; omit either axis that has not been dragged.
   *
   * Floors, not overrides — deliberately. Dragging is there to make a box
   * *bigger* when a replacement needs more room than the layout gave it, so a
   * drag may not take the box below the glyph rectangle it covers (that would
   * leave part of the run being edited outside the box the user is typing into)
   * nor below one line of its own font. And like every other extent here they
   * are clamped to the page, so no drag can put a control on the workspace
   * background.
   *
   * The caller stores these zoom-normalised and multiplies back up, so a box
   * dragged at Actual size keeps the same size *relative to the page* at Fit
   * page and Fit width — see {@link resizedTextControlExtent}.
   */
  userWidth?: number;
  userHeight?: number;
  /** Size of the rendered page, CSS pixels. Non-positive means "not yet known". */
  page: { width: number; height: number };
  chrome?: PdfEditorTextControlChrome;
};

export function layoutPdfEditorTextControl(
  input: PdfEditorTextControlInput,
): PdfEditorTextControlLayout {
  const chrome = input.chrome ?? PDF_EDITOR_TEXT_CONTROL_CHROME;
  const chromeX = 2 * (positive(chrome.borderWidth) + positive(chrome.paddingX));
  const chromeY = 2 * (positive(chrome.borderWidth) + positive(chrome.paddingY));

  const blockX = finite(input.block.x);
  const blockY = finite(input.block.y);
  const blockWidth = positive(input.block.width);
  const blockHeight = positive(input.block.height);
  const lineHeight = Math.max(1, positive(input.lineHeight) || 1);

  let fontSize = Math.max(MIN_TEXT_CONTROL_FONT_SIZE, positive(input.fontSize));

  // The box has to hold one whole line of the font it is about to render, or
  // the text the user came to edit is cut in half by `overflow`. The glyph
  // rectangle is *shorter* than a line box by design — it starts at the ascent
  // line so it cannot reach the line above — so this is normally what decides
  // the height, and the growth over the glyph box is a fraction of an em.
  const singleLine = fontSize * lineHeight + chromeY;
  let width = Math.max(
    blockWidth,
    // Chrome added, not compared: `contentWidth` is what the *text* needs, and
    // any border or padding sits outside it.
    positive(input.contentWidth) + chromeX,
    // A dragged size is already a border-box extent, so it joins the chain raw.
    positive(input.userWidth),
    MIN_TEXT_CONTROL_EXTENT,
    chromeX,
  );
  let height = Math.max(
    blockHeight,
    singleLine,
    positive(input.contentHeight),
    positive(input.userHeight),
    MIN_TEXT_CONTROL_EXTENT,
  );

  const pageWidth = positive(input.page.width);
  const pageHeight = positive(input.page.height);
  if (pageWidth <= 0 || pageHeight <= 0) {
    // No page to stay inside yet. The canvas does not draw controls before the
    // page has rendered, so this is a guard rather than a real layout.
    return {
      left: blockX,
      top: blockY,
      width,
      height,
      maxWidth: width,
      maxHeight: height,
      fontSize,
    };
  }

  width = Math.min(width, pageWidth);
  height = Math.min(height, pageHeight);

  // Move the control rather than shrink it. Shrinking to fit would hide part of
  // the very glyphs being edited, and the glyph rectangle is always inside the
  // page already — only the ergonomic minimum and the line box can push a
  // control past an edge, and those are ours to place.
  const left = clamp(blockX, 0, pageWidth - width);
  const top = clamp(blockY, 0, pageHeight - height);

  // Last resort: on a page too small to show one line at this size, the font
  // gives way. Clipping the text would be the alternative, and invisible text
  // in a text editor is never the better failure.
  const room = height - chromeY;
  const needed = fontSize * lineHeight;
  // The epsilon keeps binary rounding out of the decision. `height` was computed
  // *from* `needed` a few lines up, and `(needed + chromeY) - chromeY` does not
  // reproduce `needed` exactly in floating point — so without it a plain 6px
  // line at 1.15 leading reports a shortfall of 1e-15 and gets "rescued" down to
  // 5.999999999999999. A shortfall below a millionth of a pixel is arithmetic
  // noise, not a page too small to show the line.
  if (room < needed - 1e-6) {
    fontSize = Math.max(MIN_TEXT_CONTROL_FONT_SIZE, room / lineHeight);
  }

  return {
    left,
    top,
    width,
    height,
    maxWidth: Math.max(width, pageWidth - left),
    maxHeight: Math.max(height, pageHeight - top),
    fontSize,
  };
}

/**
 * The extent a drag has asked for, normalised out of display space.
 *
 * Kept here, pure and tested, for one reason: it divides by the zoom. Every
 * defect this module and its sibling were written for came from a length that
 * carried the display zoom being stored, compared, or re-scaled as though it did
 * not. A dragged size is measured in device pixels off a page drawn at some
 * zoom, and it is *stored* — so it has to be divided by that zoom exactly once,
 * on the way in, or a box dragged at Fit page comes back three times too big at
 * Fit width.
 *
 * Returns the new extent in page-relative units (the layout multiplies it back
 * by the current zoom). Never below the ergonomic minimum: a drag that would
 * collapse a box to nothing leaves the user with no target to drag back out.
 */
export function resizedTextControlExtent(input: {
  /** Border-box extent when the drag began, device pixels. */
  startExtent: number;
  /** Pointer travel along the dragged axis since then, device pixels. */
  delta: number;
  /** Display zoom the drag is happening at. */
  zoom: number;
}): number {
  const zoom = positive(input.zoom) || 1;
  const dragged = positive(input.startExtent) + finite(input.delta);
  return Math.max(MIN_TEXT_CONTROL_EXTENT, dragged) / zoom;
}

/** Treat NaN and Infinity as zero rather than propagating them into styles. */
function finite(value: number | undefined): number {
  return Number.isFinite(value) ? (value as number) : 0;
}

/** Treat NaN, Infinity and negatives as "not reported". */
function positive(value: number | undefined): number {
  return Number.isFinite(value) && (value as number) > 0 ? (value as number) : 0;
}

function clamp(value: number, min: number, max: number): number {
  if (max < min) return min;
  return Math.min(max, Math.max(min, value));
}
