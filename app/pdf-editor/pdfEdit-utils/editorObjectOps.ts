/**
 * W4 — object geometry, alignment and layer metadata.
 *
 * The canvas stores object positions in *screen* coordinates (they scale with
 * the zoom level), while every inspector value the user sees and every export
 * statement is in PDF points. Mixing the two is how an object "at 72pt" silently
 * lands somewhere else after a zoom change. These functions therefore take and
 * return point-space geometry; the hook is the only place that converts to and
 * from the Fabric screen space, and it does so exactly once.
 *
 * Alignment and distribution are pure because their only honest definition is
 * geometric: align to the selection's own bounding box, never to an invisible
 * page grid the user was not shown.
 */

export type PdfEditorObjectGeometry = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type PdfEditorObjectBounds = {
  width: number;
  height: number;
};

export type PdfEditorAlignMode =
  | 'left'
  | 'center'
  | 'right'
  | 'top'
  | 'middle'
  | 'bottom';

export type PdfEditorDistributeAxis = 'horizontal' | 'vertical';

export type PdfEditorAlignedObject = {
  id: string;
  geometry: PdfEditorObjectGeometry;
};

export type PdfEditorLayerKind = 'text' | 'image' | 'shape';

export type PdfEditorObjectStyle = {
  fill: string | null;
  stroke: string | null;
  strokeWidth: number;
  strokeDashArray: number[] | null;
  opacity: number;
};

export type PdfEditorLayer = {
  id: string;
  name: string;
  kind: PdfEditorLayerKind;
  locked: boolean;
  hidden: boolean;
  selected: boolean;
};

/** An object smaller than this is impossible to grab or see after clamping. */
export const PDF_EDITOR_MIN_OBJECT_SIZE = 4;

const finite = (value: number, fallback = 0) => (
  Number.isFinite(value) ? value : fallback
);

export function geometryChanged(
  left: PdfEditorObjectGeometry,
  right: PdfEditorObjectGeometry,
  epsilon = 0.01,
) {
  return Math.abs(left.x - right.x) > epsilon
    || Math.abs(left.y - right.y) > epsilon
    || Math.abs(left.width - right.width) > epsilon
    || Math.abs(left.height - right.height) > epsilon;
}

/**
 * Keep an object wholly inside the page and above the minimum grab size.
 * Clamping the size before the position matters: a rectangle wider than the
 * page must shrink first, or its left edge would be pushed off the page by the
 * right-edge clamp.
 */
export function clampPdfEditorObjectGeometry(
  geometry: PdfEditorObjectGeometry,
  bounds: PdfEditorObjectBounds,
): PdfEditorObjectGeometry {
  const pageWidth = Math.max(PDF_EDITOR_MIN_OBJECT_SIZE, finite(bounds.width, PDF_EDITOR_MIN_OBJECT_SIZE));
  const pageHeight = Math.max(PDF_EDITOR_MIN_OBJECT_SIZE, finite(bounds.height, PDF_EDITOR_MIN_OBJECT_SIZE));
  const width = Math.min(pageWidth, Math.max(PDF_EDITOR_MIN_OBJECT_SIZE, finite(geometry.width, PDF_EDITOR_MIN_OBJECT_SIZE)));
  const height = Math.min(pageHeight, Math.max(PDF_EDITOR_MIN_OBJECT_SIZE, finite(geometry.height, PDF_EDITOR_MIN_OBJECT_SIZE)));
  const x = Math.min(pageWidth - width, Math.max(0, finite(geometry.x)));
  const y = Math.min(pageHeight - height, Math.max(0, finite(geometry.y)));
  return {
    x: Math.round(x * 1000) / 1000,
    y: Math.round(y * 1000) / 1000,
    width: Math.round(width * 1000) / 1000,
    height: Math.round(height * 1000) / 1000,
  };
}

/** Arrow-key movement, clamped to the page instead of disappearing off it. */
export function nudgePdfEditorObjectGeometry(
  geometry: PdfEditorObjectGeometry,
  dx: number,
  dy: number,
  bounds: PdfEditorObjectBounds,
): PdfEditorObjectGeometry {
  return clampPdfEditorObjectGeometry({
    ...geometry,
    x: geometry.x + finite(dx),
    y: geometry.y + finite(dy),
  }, bounds);
}

function selectionBounds(items: readonly PdfEditorAlignedObject[]) {
  const left = Math.min(...items.map(item => item.geometry.x));
  const top = Math.min(...items.map(item => item.geometry.y));
  const right = Math.max(...items.map(item => item.geometry.x + item.geometry.width));
  const bottom = Math.max(...items.map(item => item.geometry.y + item.geometry.height));
  return { left, top, right, bottom, width: right - left, height: bottom - top };
}

/**
 * Align every selected object to the selection's own bounding box.
 *
 * Returning new objects (and not mutating the input) lets the caller decide how
 * the change enters history; a failed or no-op alignment must not create an undo
 * step.
 */
export function alignPdfEditorObjects(
  items: readonly PdfEditorAlignedObject[],
  mode: PdfEditorAlignMode,
): PdfEditorAlignedObject[] {
  if (items.length < 2) return [...items];
  const box = selectionBounds(items);
  return items.map((item) => {
    const { geometry } = item;
    switch (mode) {
      case 'left':
        return { ...item, geometry: { ...geometry, x: box.left } };
      case 'center':
        return { ...item, geometry: { ...geometry, x: box.left + (box.width - geometry.width) / 2 } };
      case 'right':
        return { ...item, geometry: { ...geometry, x: box.right - geometry.width } };
      case 'top':
        return { ...item, geometry: { ...geometry, y: box.top } };
      case 'middle':
        return { ...item, geometry: { ...geometry, y: box.top + (box.height - geometry.height) / 2 } };
      case 'bottom':
        return { ...item, geometry: { ...geometry, y: box.bottom - geometry.height } };
      default:
        return item;
    }
  });
}

/**
 * Evenly space the gaps between objects along one axis.
 *
 * The outer two objects stay where they are; only the interior positions move.
 * Distributing by *gap* (not by centre) is what keeps a mixed-size selection
 * visually even, and it is the definition a designer expects from "distribute".
 */
export function distributePdfEditorObjects(
  items: readonly PdfEditorAlignedObject[],
  axis: PdfEditorDistributeAxis,
): PdfEditorAlignedObject[] {
  if (items.length < 3) return [...items];
  const horizontal = axis === 'horizontal';
  const sorted = [...items].sort((left, right) => (
    horizontal
      ? left.geometry.x - right.geometry.x
      : left.geometry.y - right.geometry.y
  ));
  const first = sorted[0].geometry;
  const last = sorted[sorted.length - 1].geometry;
  const span = horizontal
    ? (last.x + last.width) - first.x
    : (last.y + last.height) - first.y;
  const totalSize = sorted.reduce(
    (sum, item) => sum + (horizontal ? item.geometry.width : item.geometry.height),
    0,
  );
  const gap = (span - totalSize) / (sorted.length - 1);
  let cursor = horizontal ? first.x : first.y;

  return sorted.map((item, index) => {
    const next = index === 0 || index === sorted.length - 1
      ? item
      : {
          ...item,
          geometry: horizontal
            ? { ...item.geometry, x: cursor }
            : { ...item.geometry, y: cursor },
        };
    cursor += (horizontal ? item.geometry.width : item.geometry.height) + gap;
    return next;
  });
}

/**
 * Human layer names. Fabric's default labels ("Rectangle 3") are not available
 * across the serialized boundary, and a layer panel full of "Object" rows is not
 * usable; a stable kind + index label is.
 */
export function pdfEditorLayerName(kind: PdfEditorLayerKind, index: number) {
  const base = kind === 'text' ? 'Text' : kind === 'image' ? 'Image' : 'Shape';
  return `${base} ${index + 1}`;
}

/** The id a newly added object receives; persisted so layer selection survives reloads. */
export function createPdfEditorObjectId(seed: number) {
  return `pe-obj-${Math.max(0, Math.round(seed)).toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}
