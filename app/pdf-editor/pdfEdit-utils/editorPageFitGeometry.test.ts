import assert from 'node:assert/strict';
import test from 'node:test';

import {
  computePageSizeFit,
  computeOverlayPlacement,
  normalizePdfRotation,
  type PdfPageFitLayout,
} from './editorPageFitGeometry.ts';

/**
 * Independent re-implementation of how a PDF viewer displays a page: content
 * is scaled about the origin then translated inside its stream, and afterwards
 * the whole page is turned by `/Rotate` (clockwise) — the rotation mapping acts
 * on absolute page coordinates with no further scaling.
 */
function rotatePoint(
  raw: { x: number; y: number },
  opts: { boxWidth: number; boxHeight: number; rotation: number },
): { x: number; y: number } {
  const { boxWidth, boxHeight, rotation } = opts;
  switch (rotation) {
    case 90: return { x: boxHeight - raw.y, y: raw.x };
    case 180: return { x: boxWidth - raw.x, y: boxHeight - raw.y };
    case 270: return { x: raw.y, y: boxWidth - raw.x };
    default: return { x: raw.x, y: raw.y };
  }
}

/** Maps a pre-transform content-stream point to display space. */
function contentPoint(
  raw: { x: number; y: number },
  opts: {
    layout: PdfPageFitLayout;
    boxWidth: number;
    boxHeight: number;
    rotation: number;
  },
): { x: number; y: number } {
  const { layout } = opts;
  return rotatePoint(
    { x: raw.x * layout.fitScale + layout.translateX, y: raw.y * layout.fitScale + layout.translateY },
    opts,
  );
}

const PAGE_SIZES = [
  { key: 'a4', width: 595.28, height: 841.89 },
  { key: 'a3', width: 841.89, height: 1190.55 },
  { key: 'a2', width: 1190.55, height: 1683.78 },
  { key: 'letter', width: 612, height: 792 },
  { key: 'legal', width: 612, height: 1008 },
];

// Varied base pages, including sizes larger than every preset so shrink is
// exercised, and landscape/portrait both.
const BASE_PAGES = [
  { name: 'portrait medium', w: 480, h: 640 },
  { name: 'landscape wide', w: 1200, h: 500 },
  { name: 'portrait large', w: 900, h: 1500 },
  { name: 'square-ish', w: 700, h: 700 },
];

function close(actual: number, expected: number, eps = 1e-6) {
  return Math.abs(actual - expected) <= eps;
}

function bbox(points: Array<{ x: number; y: number }>) {
  const xs = points.map(p => p.x);
  const ys = points.map(p => p.y);
  return { minX: Math.min(...xs), minY: Math.min(...ys), maxX: Math.max(...xs), maxY: Math.max(...ys) };
}

test('normalizes rotation values including negatives and junk', () => {
  assert.equal(normalizePdfRotation(0), 0);
  assert.equal(normalizePdfRotation(90), 90);
  assert.equal(normalizePdfRotation(-90), 270);
  assert.equal(normalizePdfRotation(450), 90);
  assert.equal(normalizePdfRotation(45), 0);
});

test('unrotated pages reproduce the previous renderer maths', () => {
  const layout = computePageSizeFit({ rawWidth: 1200, rawHeight: 500, rotation: 0, targetWidth: 612, targetHeight: 792 });
  const fitScale = Math.min(1, 612 / 1200, 792 / 500);
  assert.ok(Math.abs(layout.fitScale - fitScale) < 1e-9);
  assert.ok(close(layout.contentWidth, 1200 * fitScale));
  assert.ok(close(layout.contentHeight, 500 * fitScale));
  assert.ok(close(layout.offsetX, (612 - 1200 * fitScale) / 2));
  assert.ok(close(layout.offsetY, (792 - 500 * fitScale) / 2));
  assert.deepEqual(layout.newSize, { width: 612, height: 792 });
});

test('original size keeps existing boxes untouched', () => {
  const layout = computePageSizeFit({ rawWidth: 800, rawHeight: 600, rotation: 180 });
  assert.equal(layout.fitScale, 1);
  assert.equal(layout.translateX, 0);
  assert.equal(layout.translateY, 0);
  assert.equal(layout.newSize, undefined);
});

test('content never enlarges beyond 100 percent', () => {
  // A6-sized base into A2 preset: target is far bigger than the source.
  const layout = computePageSizeFit({ rawWidth: 297.64, rawHeight: 420.94, rotation: 0, targetWidth: 1190.55, targetHeight: 1683.78 });
  assert.equal(layout.fitScale, 1);
  assert.equal(layout.offsetX > 0 && layout.offsetY > 0, true);
});


test('content is centred and shrunk in display space for every rotation and preset', () => {
  for (const base of BASE_PAGES) {
    for (const rotation of [0, 90, 180, 270] as const) {
      for (const preset of PAGE_SIZES) {
        const layout = computePageSizeFit({
          rawWidth: base.w,
          rawHeight: base.h,
          rotation,
          targetWidth: preset.width,
          targetHeight: preset.height,
        });
        assert.ok(layout.newSize, `${base.name}/${rotation}/${preset.key} must resize`);

        const rawContent = [
          { x: 0, y: 0 },
          { x: base.w, y: 0 },
          { x: base.w, y: base.h },
          { x: 0, y: base.h },
        ];
        const displayed = rawContent.map(p => contentPoint(p, {
          layout,
          boxWidth: layout.newSize!.width,
          boxHeight: layout.newSize!.height,
          rotation,
        }));
        const box = bbox(displayed);
        assert.ok(close(box.minX, layout.offsetX) && close(box.maxX, layout.offsetX + layout.contentWidth),
          `x centring failed: ${base.name} rot=${rotation} ${preset.key}: ${JSON.stringify(box)} vs x=${layout.offsetX}`);
        assert.ok(close(box.minY, layout.offsetY) && close(box.maxY, layout.offsetY + layout.contentHeight),
          `y centring failed: ${base.name} rot=${rotation} ${preset.key}: ${JSON.stringify(box)} vs y=${layout.offsetY}`);
      }
    }
  }
});

/**
 * pdf-lib's drawImage rotation semantics reproduced independently: an image at
 * anchor (ax, ay), size (iw, ih), rotated CCW by θ about the anchor.
 */
function overlayCorners(placement: { x: number; y: number; width: number; height: number; rotateDegrees: number }) {
  const rad = placement.rotateDegrees * Math.PI / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  return [
    { dx: 0, dy: 0 },
    { dx: placement.width, dy: 0 },
    { dx: placement.width, dy: placement.height },
    { dx: 0, dy: placement.height },
  ].map(({ dx, dy }) => ({
    x: placement.x + dx * cos - dy * sin,
    y: placement.y + dx * sin + dy * cos,
  }));
}

test('overlay PNG lands exactly on the displayed content box for every rotation', () => {
  // The overlay PNG covers the whole source page, so wherever it displays it
  // must coincide with the displayed scaled-content box — that equivalence IS
  // "signature stays where the editor showed it".
  for (const base of BASE_PAGES) {
    for (const rotation of [0, 90, 180, 270] as const) {
      for (const preset of PAGE_SIZES) {
        const layout = computePageSizeFit({
          rawWidth: base.w,
          rawHeight: base.h,
          rotation,
          targetWidth: preset.width,
          targetHeight: preset.height,
        });
        assert.ok(layout.newSize);
        const boxW = layout.newSize.width;
        const boxH = layout.newSize.height;
        const overlay = computeOverlayPlacement({ layout, rotation, pageWidth: boxW, pageHeight: boxH });

        const drawn = overlayCorners(overlay).map(p => rotatePoint(
          p,
          { boxWidth: boxW, boxHeight: boxH, rotation },
        ));
        const drawnBox = bbox(drawn);
        const eps = 1e-6;
        assert.ok(
          close(drawnBox.minX, layout.offsetX, eps)
          && close(drawnBox.minY, layout.offsetY, eps)
          && close(drawnBox.maxX, layout.offsetX + layout.contentWidth, eps)
          && close(drawnBox.maxY, layout.offsetY + layout.contentHeight, eps),
          `overlay misplacement: ${base.name} rot=${rotation} ${preset.key}: ${JSON.stringify({ drawnBox, layout, overlay })}`,
        );
      }
    }
  }
});

test('overlay for original-size rotated pages covers the full page', () => {
  for (const rotation of [90, 180, 270] as const) {
    const layout = computePageSizeFit({ rawWidth: 500, rawHeight: 800, rotation });
    // No resize happens for "original", so the box stays 500 × 800 regardless
    // of rotation — exactly what pdf-lib's getSize() reports post-layout.
    const overlay = computeOverlayPlacement({
      layout,
      rotation,
      pageWidth: 500,
      pageHeight: 800,
    });
    const drawn = bbox(
      overlayCorners(overlay).map(p => rotatePoint(p, { boxWidth: 500, boxHeight: 800, rotation })),
    );
    // Full-page overlay with zero margins must span exactly the display page
    // after the viewer applies rotation.
    const viewW = rotation === 90 || rotation === 270 ? 800 : 500;
    const viewH = rotation === 90 || rotation === 270 ? 500 : 800;
    assert.ok(close(drawn.minX, 0) && close(drawn.minY, 0) && close(drawn.maxX, viewW) && close(drawn.maxY, viewH),
      `rot=${rotation}: ${JSON.stringify(drawn)} expected ${viewW}×${viewH}`);
  }
});

test('degenerate pages fall back to identity instead of inventing geometry', () => {
  const zero = computePageSizeFit({ rawWidth: 0, rawHeight: 100, rotation: 0, targetWidth: 612, targetHeight: 792 });
  assert.equal(zero.fitScale, 1);
  assert.equal(zero.newSize, undefined);
});

/* ── Fill mode ("zoom metaphor") ──────────────────────────────────────────── */

import {
  computePageSizeFitFill,
  PDF_FILL_ROTATE_THRESHOLD,
  type PdfPageFillLayout,
} from './editorPageFitGeometry.ts';

/**
 * Display mapping with **per-axis** content scaling and an optional extra page
 * rotation applied via setRotation (which changes what the viewer does).
 */
function fillContentPoint(
  raw: { x: number; y: number },
  opts: {
    fill: PdfPageFillLayout;
    boxWidth: number;
    boxHeight: number;
    rotation: number;
  },
): { x: number; y: number } {
  const { fill } = opts;
  const scaled = { x: raw.x * fill.scaleX + fill.translateX, y: raw.y * fill.scaleY + fill.translateY };
  return rotatePoint(scaled, opts);
}

test('fill maps the page corners exactly onto the full display frame (overlay coincidence)', () => {
  for (const base of BASE_PAGES) {
    for (const rotation of [0, 90, 180, 270] as const) {
      for (const preset of PAGE_SIZES) {
        const fill = computePageSizeFitFill({
          rawWidth: base.w,
          rawHeight: base.h,
          rotation,
          targetWidth: preset.width,
          targetHeight: preset.height,
        });
        assert.ok(fill.newSize, `${base.name}/${rotation}/${preset.key} must resize`);
        const boxW = fill.newSize.width;
        const boxH = fill.newSize.height;
        const effR = fill.effectiveRotation;
        const quarter = effR === 90 || effR === 270;

        // All four source-page corners through the content transform.
        const mapped = [
          { x: 0, y: 0 },
          { x: base.w, y: 0 },
          { x: base.w, y: base.h },
          { x: 0, y: base.h },
        ].map(p => fillContentPoint(p, { fill, boxWidth: boxW, boxHeight: boxH, rotation: effR }));
        const bounds = bbox(mapped);

        // The visible display frame: raw box, axes swapped for quarter turns.
        const dispW = quarter ? boxH : boxW;
        const dispH = quarter ? boxW : boxH;
        const eps = 1e-6;
        // Zero translation must make content cover the frame edge-to-edge with
        // every corner landing on a frame corner.
        const cornerSet = [
          { x: 0, y: 0 }, { x: dispW, y: 0 }, { x: dispW, y: dispH }, { x: 0, y: dispH },
        ];
        const matched = new Set<number>();
        for (const m of mapped) {
          const idx = cornerSet.findIndex(c => close(c.x, m.x, eps) && close(c.y, m.y, eps));
          assert.ok(idx >= 0 && !matched.has(idx),
            `corner mapping not a bijection onto frame: ${base.name} rot=${rotation} ${preset.key}: ${JSON.stringify({ mapped, dispW, dispH })}`);
          matched.add(idx);
        }
        void bounds;
      }
    }
  }
});

test('overlay PNG covers the whole display page in fill mode for every rotation', () => {
  for (const base of BASE_PAGES) {
    for (const rotation of [0, 90, 180, 270] as const) {
      for (const preset of PAGE_SIZES) {
        const fill = computePageSizeFitFill({
          rawWidth: base.w,
          rawHeight: base.h,
          rotation,
          targetWidth: preset.width,
          targetHeight: preset.height,
        });
        const boxW = fill.newSize!.width;
        const boxH = fill.newSize!.height;
        const effR = fill.effectiveRotation;
        const quarter = effR === 90 || effR === 270;
        const overlay = computeOverlayPlacement({
          layout: {
            fitScale: 1,
            translateX: 0,
            translateY: 0,
            offsetX: 0,
            offsetY: 0,
            contentWidth: quarter ? boxH : boxW,
            contentHeight: quarter ? boxW : boxH,
          },
          rotation: effR as 0 | 90 | 180 | 270,
          pageWidth: boxW,
          pageHeight: boxH,
        });

        // Overlay corners, then through the viewer mapping. In fill mode the
        // mapped overlay must equal the content's own footprint: the same
        // full-bleed display frame the corner test asserts for content.
        const drawn = bbox(overlayCorners(overlay).map(p => rotatePoint(
          p,
          { boxWidth: boxW, boxHeight: boxH, rotation: effR },
        )));
        const dispW = quarter ? boxH : boxW;
        const dispH = quarter ? boxW : boxH;
        const eps = 1e-6;
        assert.ok(
          close(drawn.minX, 0, eps) && close(drawn.minY, 0, eps)
          && close(drawn.maxX, dispW, eps) && close(drawn.maxY, dispH, eps),
          `fill overlay not coincident: ${base.name} rot=${rotation} ${preset.key}: ${JSON.stringify({ drawn, overlay })}`,
        );
      }
    }
  }
});

test('page-size fill preserves visual orientation even for extreme aspect mismatch', () => {
  // A4-ish base into Letter: mild.
  const mild = computePageSizeFitFill({ rawWidth: 595.28, rawHeight: 841.89, rotation: 0, targetWidth: 612, targetHeight: 792 });
  assert.equal(mild.rotateForFit, undefined);
  assert.equal(mild.distorted, true);

  // Same aspect base into same-aspect target: no distortion flag.
  const uniform = computePageSizeFitFill({ rawWidth: 600, rawHeight: 800, rotation: 0, targetWidth: 1200, targetHeight: 1600 });
  assert.equal(uniform.distorted, false);
  assert.equal(uniform.rotateForFit, undefined);

  // Very wide landscape into portrait A4: do not auto-rotate. Editor-added
  // signatures, images, and emoji must stay on the same visual anchors instead
  // of switching page orientation under the user.
  const wide = computePageSizeFitFill({ rawWidth: 1200, rawHeight: 500, rotation: 0, targetWidth: 595.28, targetHeight: 841.89 });
  assert.equal(wide.rotateForFit, undefined);
  assert.equal(wide.effectiveRotation, 0);
  assert.deepEqual(wide.newSize, { width: 595.28, height: 841.89 });
  assert.ok(wide.distorted);

  // Original keeps identity.
  const original = computePageSizeFitFill({ rawWidth: 800, rawHeight: 600, rotation: 180 });
  assert.equal(original.scaleX, 1);
  assert.equal(original.newSize, undefined);
  assert.equal(original.effectiveRotation, 180);

  assert.ok(PDF_FILL_ROTATE_THRESHOLD === 1.35);
});

