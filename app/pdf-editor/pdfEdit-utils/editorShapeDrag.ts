/**
 * W4 — drag-to-create geometry.
 *
 * A drag is authored in rendered pixels but stored in PDF points, exactly like
 * every other object geometry in this editor. This module owns the conversion
 * boundary: clamp the two endpoints to the page, normalise the drag rectangle,
 * and refuse anything too small to be grabbable afterwards. Inverted drags
 * (right-to-left, bottom-to-top) are legal and common; the rectangle is
 * normalised, while `from`/`to` keep the direction the user actually drew so a
 * line or arrow points the way they dragged it.
 */

import type {
  PdfEditorObjectBounds,
  PdfEditorObjectGeometry,
} from './editorObjectOps.ts';

export type PdfEditorDragShape = 'rect' | 'circle' | 'line' | 'arrow';

export const PDF_EDITOR_MIN_DRAG_SIZE = 4;

export type PdfEditorDragPoint = {
  x: number;
  y: number;
};

export type PdfEditorDragGeometry = PdfEditorObjectGeometry & {
  /** Direction of the drag, clamped to the page. */
  from: PdfEditorDragPoint;
  to: PdfEditorDragPoint;
  /** Degrees, clockwise, for an arrow head. */
  angle: number;
  length: number;
  flippedX: boolean;
  flippedY: boolean;
};

const finite = (value: number, fallback = 0) => (
  Number.isFinite(value) ? value : fallback
);

const roundPoint = (value: number) => Math.round(value * 1000) / 1000;

function clampPoint(point: PdfEditorDragPoint, bounds: PdfEditorObjectBounds): PdfEditorDragPoint {
  const pageWidth = Math.max(0, finite(bounds.width));
  const pageHeight = Math.max(0, finite(bounds.height));
  return {
    x: roundPoint(Math.min(pageWidth, Math.max(0, finite(point.x)))),
    y: roundPoint(Math.min(pageHeight, Math.max(0, finite(point.y)))),
  };
}

/**
 * Build the geometry for a drag, or `null` when the drag is too small.
 *
 * `null` is not an error: a click that moves two pixels is a click, not a
 * degenerate rectangle, and creating a 2pt shape would leave an object the user
 * cannot select or delete. The canvas treats `null` as "cancel the preview".
 */
export function createPdfEditorDragGeometry(
  tool: PdfEditorDragShape,
  start: PdfEditorDragPoint,
  end: PdfEditorDragPoint,
  bounds: PdfEditorObjectBounds,
  minimum = PDF_EDITOR_MIN_DRAG_SIZE,
): PdfEditorDragGeometry | null {
  const from = clampPoint(start, bounds);
  const to = clampPoint(end, bounds);
  const width = Math.abs(to.x - from.x);
  const height = Math.abs(to.y - from.y);
  const length = Math.hypot(to.x - from.x, to.y - from.y);
  const limit = Math.max(1, finite(minimum, PDF_EDITOR_MIN_DRAG_SIZE));
  const linear = tool === 'line' || tool === 'arrow';

  if (linear ? length < limit : (width < limit || height < limit)) return null;

  return {
    x: roundPoint(Math.min(from.x, to.x)),
    y: roundPoint(Math.min(from.y, to.y)),
    width: roundPoint(width),
    height: roundPoint(height),
    from,
    to,
    angle: roundPoint(Math.atan2(to.y - from.y, to.x - from.x) * 180 / Math.PI),
    length: roundPoint(length),
    flippedX: to.x < from.x,
    flippedY: to.y < from.y,
  };
}
