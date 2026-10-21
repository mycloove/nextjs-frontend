/**
 * W4 — snapping and alignment guides.
 *
 * Snapping is the visual half of the object controls: geometry is stored in PDF
 * points everywhere else, so the guides and the snap decision are computed in
 * points too, and only the canvas multiplies by the live zoom. A snap computed
 * in screen pixels would move an object by a different amount after a zoom
 * change, which is the same class of bug the geometry helpers already document.
 *
 * The only honest reference lines are visible ones: the page's own edges and
 * centre, and the edges/centres of objects the user can actually see. Snapping
 * to a hidden or locked neighbour the user cannot perceive is indistinguishable
 * from a random jump. When a page holds several objects only nearby ones are
 * considered, so a dense page does not pull every drag across the sheet.
 */

import type {
  PdfEditorObjectBounds,
  PdfEditorObjectGeometry,
} from './editorObjectOps.ts';

export const PDF_EDITOR_SNAP_THRESHOLD = 6;
/** Objects farther than this from the moving box stop being snap references. */
export const PDF_EDITOR_SNAP_NEARBY_REACH = 160;

export type PdfEditorSnapAxis = 'x' | 'y';
export type PdfEditorSnapGuideKind = 'page' | 'object';

export type PdfEditorSnapObject = {
  id: string;
  geometry: PdfEditorObjectGeometry;
  /** Hidden objects are never snap targets; the user cannot see the line. */
  hidden?: boolean;
};

export type PdfEditorSnapInput = {
  geometry: PdfEditorObjectGeometry;
  bounds: PdfEditorObjectBounds;
  objects: readonly PdfEditorSnapObject[];
  /** The dragged object itself must not snap to its own previous position. */
  movingId?: string;
  threshold?: number;
};

export type PdfEditorSnapGuide = {
  axis: PdfEditorSnapAxis;
  /** Position on the axis, in PDF points from the page's top-left origin. */
  position: number;
  kind: PdfEditorSnapGuideKind;
};

export type PdfEditorSnapResult = {
  geometry: PdfEditorObjectGeometry;
  guides: readonly PdfEditorSnapGuide[];
  snappedX: boolean;
  snappedY: boolean;
};

type SnapCandidate = {
  position: number;
  kind: PdfEditorSnapGuideKind;
};

const finite = (value: number, fallback = 0) => (
  Number.isFinite(value) ? value : fallback
);

function roundPoint(value: number) {
  return Math.round(value * 1000) / 1000;
}

/**
 * Distance between two axis-aligned rectangles, zero when they overlap.
 * Used only to decide whether a neighbour is close enough to guide a drag.
 */
export function pdfEditorRectDistance(
  left: PdfEditorObjectGeometry,
  right: PdfEditorObjectGeometry,
): number {
  const dx = Math.max(0, left.x - (right.x + right.width), right.x - (left.x + left.width));
  const dy = Math.max(0, left.y - (right.y + right.height), right.y - (left.y + left.height));
  return Math.hypot(dx, dy);
}

/**
 * Pick the visible objects a drag should snap against.
 *
 * A page with one or two objects keeps all of them: there is no noise to filter,
 * and dropping a neighbour would make the feature feel arbitrary. From three
 * objects upward, only nearby visible ones remain, which is what keeps a busy
 * page from producing guides the user did not aim at.
 */
export function selectPdfEditorSnapObjects(
  geometry: PdfEditorObjectGeometry,
  objects: readonly PdfEditorSnapObject[],
  movingId?: string,
): PdfEditorSnapObject[] {
  const visible = objects.filter(object => (
    !object.hidden && object.id !== movingId
  ));
  if (visible.length < 3) return visible;
  return visible.filter(object => (
    pdfEditorRectDistance(geometry, object.geometry) <= PDF_EDITOR_SNAP_NEARBY_REACH
  ));
}

function candidatesForAxis(
  axis: PdfEditorSnapAxis,
  bounds: PdfEditorObjectBounds,
  objects: readonly PdfEditorSnapObject[],
): SnapCandidate[] {
  const candidates: SnapCandidate[] = axis === 'x'
    ? [
        { position: 0, kind: 'page' },
        { position: finite(bounds.width) / 2, kind: 'page' },
        { position: finite(bounds.width), kind: 'page' },
      ]
    : [
        { position: 0, kind: 'page' },
        { position: finite(bounds.height) / 2, kind: 'page' },
        { position: finite(bounds.height), kind: 'page' },
      ];

  for (const object of objects) {
    const { geometry } = object;
    if (axis === 'x') {
      candidates.push(
        { position: geometry.x, kind: 'object' },
        { position: geometry.x + geometry.width / 2, kind: 'object' },
        { position: geometry.x + geometry.width, kind: 'object' },
      );
    } else {
      candidates.push(
        { position: geometry.y, kind: 'object' },
        { position: geometry.y + geometry.height / 2, kind: 'object' },
        { position: geometry.y + geometry.height, kind: 'object' },
      );
    }
  }
  return candidates.filter(candidate => Number.isFinite(candidate.position));
}

function anchorsForAxis(
  axis: PdfEditorSnapAxis,
  geometry: PdfEditorObjectGeometry,
): number[] {
  const anchors = axis === 'x'
    ? [geometry.x, geometry.x + geometry.width / 2, geometry.x + geometry.width]
    : [geometry.y, geometry.y + geometry.height / 2, geometry.y + geometry.height];
  return anchors.filter(Number.isFinite);
}

function bestSnap(
  axis: PdfEditorSnapAxis,
  anchors: readonly number[],
  candidates: readonly SnapCandidate[],
  threshold: number,
): { delta: number; guide: PdfEditorSnapGuide } | null {
  let best: { delta: number; guide: PdfEditorSnapGuide } | null = null;
  for (const anchor of anchors) {
    for (const candidate of candidates) {
      const delta = candidate.position - anchor;
      if (Math.abs(delta) > threshold) continue;
      if (!best || Math.abs(delta) < Math.abs(best.delta)) {
        best = {
          delta,
          guide: {
            axis,
            position: candidate.position,
            kind: candidate.kind,
          },
        };
      }
    }
  }
  return best;
}

/**
 * Snap a dragged box to the page and to visible neighbours.
 *
 * The returned geometry preserves the box's size; only its position moves.
 * `guides` are the lines that actually matched after clamping, so the overlay
 * never draws a guide the object does not sit on.
 */
export function snapPdfEditorObjectGeometry(
  input: PdfEditorSnapInput,
): PdfEditorSnapResult {
  const threshold = Math.max(0, finite(input.threshold ?? PDF_EDITOR_SNAP_THRESHOLD));
  const width = Math.max(0, finite(input.geometry.width));
  const height = Math.max(0, finite(input.geometry.height));
  const near = selectPdfEditorSnapObjects(input.geometry, input.objects, input.movingId);

  const xSnap = bestSnap(
    'x',
    anchorsForAxis('x', input.geometry),
    candidatesForAxis('x', input.bounds, near),
    threshold,
  );
  const ySnap = bestSnap(
    'y',
    anchorsForAxis('y', input.geometry),
    candidatesForAxis('y', input.bounds, near),
    threshold,
  );

  const pageWidth = Math.max(0, finite(input.bounds.width));
  const pageHeight = Math.max(0, finite(input.bounds.height));
  const nextX = Math.min(
    Math.max(0, pageWidth - width),
    Math.max(0, finite(input.geometry.x) + (xSnap?.delta ?? 0)),
  );
  const nextY = Math.min(
    Math.max(0, pageHeight - height),
    Math.max(0, finite(input.geometry.y) + (ySnap?.delta ?? 0)),
  );
  const geometry: PdfEditorObjectGeometry = {
    x: roundPoint(nextX),
    y: roundPoint(nextY),
    width: roundPoint(width),
    height: roundPoint(height),
  };

  const guides: PdfEditorSnapGuide[] = [];
  const guideMatches = (
    guide: PdfEditorSnapGuide | undefined,
    axis: PdfEditorSnapAxis,
  ) => {
    if (!guide) return false;
    const anchors = anchorsForAxis(axis, geometry);
    return anchors.some(anchor => Math.abs(anchor - guide.position) <= 0.01);
  };
  if (xSnap && guideMatches(xSnap.guide, 'x')) guides.push({ ...xSnap.guide, axis: 'x' });
  if (ySnap && guideMatches(ySnap.guide, 'y')) guides.push({ ...ySnap.guide, axis: 'y' });

  return {
    geometry,
    guides,
    snappedX: guides.some(guide => guide.axis === 'x'),
    snappedY: guides.some(guide => guide.axis === 'y'),
  };
}
