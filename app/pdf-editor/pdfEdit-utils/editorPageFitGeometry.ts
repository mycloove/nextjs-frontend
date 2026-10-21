/**
 * Page-size fit geometry for the compatibility renderer.
 *
 * Everything here is pure so the export path's most fragile arithmetic can be
 * unit-tested without a PDF engine. The renderer shrinks source content
 * (never enlarges) to fit the requested page size and centres it — that is the
 * agreed product behaviour — while signature, emoji and other Fabric-overlay
 * objects must land exactly where they appeared in the editor, whatever the
 * target size.
 *
 * Coordinate spaces (each named because mixing them is precisely the class of
 * bug this module closes):
 *
 * - **Raw** — the PDF page's own user space, as pdf-lib reports via `getSize()`
 *   and transforms via `scaleContent`/`translateContent`. Origin bottom-left,
 *   y up. Unaffected by `/Rotate`.
 * - **View** — what PDF.js and therefore the editor canvas show: raw dims with
 *   axes swapped when `/Rotate` is 90 or 270. Fabric-overlay objects live in
 *   this space and are rasterised into a full-page PNG at export time.
 */

export type PdfPageFitLayout = {
  /** Uniform shrink factor (never above 1) applied to content. */
  fitScale: number;
  /** Content translation in **raw** user space for `translateContent`. */
  translateX: number;
  translateY: number;
  /** Horizontal centring margin between page edge and content, display space. */
  offsetX: number;
  /** Vertical centring margin in display space. */
  offsetY: number;
  /** Scaled content size in display space (`fitScale × view` dims). */
  contentWidth: number;
  contentHeight: number;
  /** Size the page's boxes should be resized to (`undefined` = keep as-is). */
  newSize?: { width: number; height: number };
};

/** Placement of the full-page overlay PNG, expressed in raw user space. */
export type PdfOverlayPlacement = {
  x: number;
  y: number;
  width: number;
  height: number;
  /** Counter-rotation (CCW degrees, per PDF spec) so the PNG reads upright. */
  rotateDegrees: number;
};

const QUARTERS = new Set([0, 90, 180, 270]);

/**
 * Normalise a `/Rotate` value to one of 0/90/180/270. Viewers treat unknown
 * values modulo 360; negative values are legal in the wild.
 */
export function normalizePdfRotation(rotation: number): 0 | 90 | 180 | 270 {
  const wrapped = ((Math.round(rotation) % 360) + 360) % 360;
  return (QUARTERS.has(wrapped) ? wrapped : 0) as 0 | 90 | 180 | 270;
}

function identityLayout(viewWidth: number, viewHeight: number): PdfPageFitLayout {
  return {
    fitScale: 1,
    translateX: 0,
    translateY: 0,
    offsetX: 0,
    offsetY: 0,
    contentWidth: viewWidth,
    contentHeight: viewHeight,
  };
}

/**
 * Shrink-to-fit-and-centre layout for one page.
 *
 * `targetWidth`/`targetHeight` describe the requested export page (a preset
 * such as A4), in display space. Omit them for `original`: the document keeps
 * its existing boxes and the returned layout is the identity — no resize, no
 * translation — so the caller's existing behaviour survives untouched.
 */
export function computePageSizeFit(input: {
  /** Raw (unrotated) page size, e.g. from pdf-lib's `getSize()`. */
  rawWidth: number;
  rawHeight: number;
  /** Normalised page rotation (0/90/180/270). */
  rotation: 0 | 90 | 180 | 270;
  /** Requested export page size in display space, or nothing for `original`. */
  targetWidth?: number;
  targetHeight?: number;
}): PdfPageFitLayout {
  const { rawWidth, rawHeight, rotation } = input;
  const rotated = rotation === 90 || rotation === 270;
  // The view swaps axes for quarter-turn rotations; that is exactly what PDF.js
  // viewport dims report and what the editor canvas is sized against.
  const viewWidth = rotated ? rawHeight : rawWidth;
  const viewHeight = rotated ? rawWidth : rawHeight;

  if (!Number.isFinite(viewWidth) || !Number.isFinite(viewHeight) || viewWidth <= 0 || viewHeight <= 0) {
    // Degenerate page: refuse to invent geometry. Identity is the only honest
    // answer and keeps whatever the source page already renders.
    return identityLayout(viewWidth, viewHeight);
  }

  const hasTarget = input.targetWidth !== undefined || input.targetHeight !== undefined;
  const targetWidth = input.targetWidth ?? viewWidth;
  const targetHeight = input.targetHeight ?? viewHeight;

  if (
    !hasTarget
    || !Number.isFinite(targetWidth) || !Number.isFinite(targetHeight)
    || targetWidth <= 0 || targetHeight <= 0
  ) {
    return identityLayout(viewWidth, viewHeight);
  }

  const fitScale = shrinkToFit(viewWidth, viewHeight, targetWidth, targetHeight);
  const contentWidth = viewWidth * fitScale;
  const contentHeight = viewHeight * fitScale;
  const offsetX = (targetWidth - contentWidth) / 2;
  const offsetY = (targetHeight - contentHeight) / 2;

  if (rotation === 0 || rotation === 180) {
    // A half turn keeps box dims, and its centre-flipping translation reduces
    // to the same correction as the unrotated case because 2·offset equals
    // target − content. Covered by the property tests alongside this module.
    return { fitScale, translateX: offsetX, translateY: offsetY, offsetX, offsetY, contentWidth, contentHeight, newSize: { width: targetWidth, height: targetHeight } };
  }
  // 90/270: the viewer swaps the raw axes, so the stored boxes must be the
  // swapped target dims for the display to come out targetWidth × targetHeight,
  // and the raw-space translation components cross over. Both derivations are
  // proven by the property tests in editorPageFitGeometry.test.ts.
  return {
    fitScale,
    translateX: offsetY,
    translateY: offsetX,
    offsetX,
    offsetY,
    contentWidth,
    contentHeight,
    newSize: { width: targetHeight, height: targetWidth },
  };
}

function shrinkToFit(viewWidth: number, viewHeight: number, targetWidth: number, targetHeight: number) {
  return Math.min(
    1,
    targetWidth / Math.max(viewWidth, Number.EPSILON),
    targetHeight / Math.max(viewHeight, Number.EPSILON),
  );
}

/**
 * Where to draw the full-page overlay PNG (in raw user space) so that after the
 * page's own rotation it sits exactly over the scaled, centred content.
 *
 * Derived by asking, for each rotation, which raw rectangle the viewer's
 * display mapping sends to the displayed content box. The PNG is authored in
 * viewer orientation, so it carries a counter-rotation equal to the page's
 * rotation; the composition reads upright in any viewer. For unrotated pages
 * this is exactly the rect the renderer has always drawn.
 *
 * `pageWidth`/`pageHeight` are the raw box dims after applying `layout.newSize`
 * (pass `getSize()` post-resize), or the untouched source dims for `original`.
 */
export function computeOverlayPlacement(input: {
  layout: PdfPageFitLayout;
  rotation: 0 | 90 | 180 | 270;
  pageWidth: number;
  pageHeight: number;
}): PdfOverlayPlacement {
  const { layout, rotation, pageWidth, pageHeight } = input;
  const { contentWidth, contentHeight, offsetX, offsetY } = layout;

  switch (rotation) {
    case 90:
      // Raw box is (targetHeight × targetWidth); the viewer maps
      // xd = box_height − y, yd = x. Anchoring the CCW-90-rotated image at
      // (offsetY + contentHeight, boxHeight − offsetX − contentWidth) makes its
      // occupied rect land exactly on the displayed content box.
      return {
        x: offsetY + contentHeight,
        y: pageHeight - offsetX - contentWidth,
        width: contentWidth,
        height: contentHeight,
        rotateDegrees: 90,
      };
    case 180:
      return {
        x: pageWidth - offsetX,
        y: pageHeight - offsetY,
        width: contentWidth,
        height: contentHeight,
        rotateDegrees: 180,
      };
    case 270:
      return {
        x: pageWidth - offsetY - contentHeight,
        y: offsetX + contentWidth,
        width: contentWidth,
        height: contentHeight,
        rotateDegrees: 270,
      };
    default:
      // r=0 keeps the previous inline renderer maths exactly.
      return { x: offsetX, y: offsetY, width: contentWidth, height: contentHeight, rotateDegrees: 0 };
  }
}

/** Distortion above this scale-axis ratio triggers auto-rotate instead of stretch. */
export const PDF_FILL_ROTATE_THRESHOLD = 1.35;

export type PdfPageFillLayout = {
  /** Per-axis content scales in **raw** user space (`scaleContent`). */
  scaleX: number;
  scaleY: number;
  /** Fill mode never translates content. Kept for call-site symmetry. */
  translateX: number;
  translateY: number;
  /** Raw box dims the caller must pass to `setSize`. */
  newSize?: { width: number; height: number };
  /**
   * Extra quarter-turn (beyond the page's own `/Rotate`) requested when the
   * aspect-ratio mismatch was too extreme to solve by stretching. The caller
   * must apply it with `setRotation`; every other field already accounts for
   * it.
   */
  rotateForFit?: 90 | 270;
  /** The rotation the caller ends up with after applying `rotateForFit`. */
  effectiveRotation: 0 | 90 | 180 | 270;
  /** True when the chosen size stretches content visibly non-uniformly. */
  distorted?: boolean;
};

/**
 * "Zoom metaphor" layout: the whole page — content and every Fabric edit with
 * it — maps onto the requested size exactly, so an element sitting at 62% from
 * the left and 20% from the top stays at 62% / 20% whatever size is chosen,
 * exactly like zooming the editor canvas keeps relative placement stable.
 *
 * Aspect mismatch is solved by per-axis scaling, not page auto-rotation. This
 * is deliberate editor behaviour: a signature placed near the lower-right of
 * the page must stay near that same visual anchor when the user changes paper
 * size from the right panel.
 *
 * Omit `targetWidth`/`targetHeight` for `original`: identity.
 *
 * Derivation note (mirrors the shrink-fit module docs): the viewer maps a raw
 * point through the content transform, then turns the whole page clockwise by
 * the effective rotation. Solving "the content region must cover the display
 * page exactly" for each rotation parity yields the scales below — proven by
 * the property tests, including overlay coincidence via
 * {@link computeOverlayPlacement}.
 */
export function computePageSizeFitFill(input: {
  rawWidth: number;
  rawHeight: number;
  rotation: 0 | 90 | 180 | 270;
  targetWidth?: number;
  targetHeight?: number;
}): PdfPageFillLayout {
  const { rawWidth, rawHeight, rotation } = input;
  const identity: PdfPageFillLayout = {
    scaleX: 1,
    scaleY: 1,
    translateX: 0,
    translateY: 0,
    effectiveRotation: rotation,
  };

  const hasTarget = input.targetWidth !== undefined || input.targetHeight !== undefined;
  if (!hasTarget || !Number.isFinite(rawWidth) || !Number.isFinite(rawHeight) || rawWidth <= 0 || rawHeight <= 0) {
    return identity;
  }
  const targetWidth = input.targetWidth ?? (rotation === 90 || rotation === 270 ? rawHeight : rawWidth);
  const targetHeight = input.targetHeight ?? (rotation === 90 || rotation === 270 ? rawWidth : rawHeight);
  if (!Number.isFinite(targetWidth) || !Number.isFinite(targetHeight) || targetWidth <= 0 || targetHeight <= 0) {
    return identity;
  }

  // Stretch factors if the page keeps its current displayed orientation. For
  // quarter rotations the viewer crosses axes, so the raw-axis scales are
  // swapped relative to display axes.
  const uprightQuarter = rotation === 90 || rotation === 270;
  const uprightScaleX = uprightQuarter
    ? targetHeight / Math.max(rawWidth, Number.EPSILON)
    : targetWidth / Math.max(rawWidth, Number.EPSILON);
  const uprightScaleY = uprightQuarter
    ? targetWidth / Math.max(rawHeight, Number.EPSILON)
    : targetHeight / Math.max(rawHeight, Number.EPSILON);
  const uprightDistortion = Math.max(uprightScaleX / uprightScaleY, uprightScaleY / uprightScaleX);

  const rotateForFit: 90 | 270 | undefined = undefined;
  const effectiveRotation = rotation;
  const newSize = uprightQuarter
    ? { width: targetHeight, height: targetWidth }
    : { width: targetWidth, height: targetHeight };
  const scaleX = uprightScaleX;
  const scaleY = uprightScaleY;

  // No-op boxes stay undefined so the caller can skip the resize entirely.
  const needsResize = Math.abs(newSize.width - rawWidth) > 1e-9 || Math.abs(newSize.height - rawHeight) > 1e-9;

  return {
    scaleX,
    scaleY,
    translateX: 0,
    translateY: 0,
    ...(needsResize || rotateForFit ? { newSize } : {}),
    rotateForFit,
    effectiveRotation,
    distorted: Math.max(scaleX / scaleY, scaleY / scaleX) > 1 + 1e-6,
  };
}

