import assert from 'node:assert/strict';
import test from 'node:test';

import {
  PDF_EDITOR_MAX_PIXEL_RATIO,
  PDF_EDITOR_PAGE_PIXEL_BUDGET,
  PDF_EDITOR_PAGE_SETTLE_PIXEL_BUDGET,
  PDF_EDITOR_PREVIEW_BASE_PIXEL_RATIO,
  PDF_EDITOR_PREVIEW_MAX_PIXEL_RATIO,
  PDF_EDITOR_PREVIEW_PIXEL_BUDGET,
  PDF_EDITOR_THUMBNAIL_PIXEL_BUDGET,
  resolvePdfEditorPreviewOutputScale,
  resolvePdfEditorRenderScale,
} from './editorRenderSharpness.ts';

/** US Letter at 72dpi, the geometry every other number here derives from. */
const letterAt = (zoom: number) => ({ cssWidth: 612 * zoom, cssHeight: 792 * zoom });

function approximately(actual: number, expected: number, message: string) {
  assert.ok(Math.abs(actual - expected) < 1e-9, `${message} (expected ${expected}, got ${actual})`);
}

test('a standard-density device renders exactly at CSS resolution', () => {
  const scale = resolvePdfEditorRenderScale({
    cssWidth: 807.36, cssHeight: 1043.52, devicePixelRatio: 1,
  });
  assert.equal(scale.outputScale, 1);
  assert.equal(scale.pixelWidth, 807);
  assert.equal(scale.pixelHeight, 1044);
});

test('an omitted ratio is the same as a standard-density device', () => {
  const withRatio = resolvePdfEditorRenderScale({ cssWidth: 807.36, cssHeight: 1043.52, devicePixelRatio: 1 });
  const withoutRatio = resolvePdfEditorRenderScale({ cssWidth: 807.36, cssHeight: 1043.52 });
  assert.deepEqual(withoutRatio, withRatio);
});

test('retina ratios raise the backing store up to the default cap', () => {
  assert.equal(resolvePdfEditorRenderScale({ ...letterAt(1), devicePixelRatio: 2 }).outputScale, 2);
  assert.equal(resolvePdfEditorRenderScale({ ...letterAt(1), devicePixelRatio: 3 }).outputScale, PDF_EDITOR_MAX_PIXEL_RATIO);
  assert.equal(resolvePdfEditorRenderScale({ ...letterAt(1), devicePixelRatio: 4 }).outputScale, PDF_EDITOR_MAX_PIXEL_RATIO);
  assert.equal(
    resolvePdfEditorRenderScale({ ...letterAt(1), devicePixelRatio: 3, maxPixelRatio: 3 }).outputScale,
    3,
  );
});

test('the fractional ratios of scaled desktop displays are honoured', () => {
  assert.equal(resolvePdfEditorRenderScale({ ...letterAt(1), devicePixelRatio: 1.25 }).outputScale, 1.25);
  assert.equal(resolvePdfEditorRenderScale({ ...letterAt(1), devicePixelRatio: 1.5 }).outputScale, 1.5);
});

test('unusable ratios fall back to CSS resolution instead of producing NaN geometry', () => {
  for (const ratio of [0, -2, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
    const scale = resolvePdfEditorRenderScale({ ...letterAt(1), devicePixelRatio: ratio });
    assert.equal(scale.outputScale, 1, `ratio ${ratio} must not raise the scale`);
    assert.ok(Number.isInteger(scale.pixelWidth) && scale.pixelWidth > 0);
    assert.ok(Number.isInteger(scale.pixelHeight) && scale.pixelHeight > 0);
  }
});

test('backing dimensions are rounded whole pixels, never attributes with a fraction', () => {
  const scale = resolvePdfEditorRenderScale({ cssWidth: 807.36, cssHeight: 1043.52, devicePixelRatio: 1.5 });
  assert.ok(Number.isInteger(scale.pixelWidth) && Number.isInteger(scale.pixelHeight));
  assert.equal(scale.pixelWidth, 1211);
  assert.equal(scale.pixelHeight, 1565);
});

test('the pixel budget shrinks a large page below its ratio but never below CSS resolution', () => {
  const scale = resolvePdfEditorRenderScale({ ...letterAt(3), devicePixelRatio: 2 });
  assert.ok(scale.outputScale < 2, 'budget must pull the scale below the device ratio');
  assert.ok(scale.outputScale > 1, 'the scale may not fall below CSS resolution');
  assert.equal(scale.budgetLimited, true, 'a budget-shrunk scale is the budget, not the device, choosing');
  assert.ok(
    scale.pixelWidth * scale.pixelHeight <= PDF_EDITOR_PAGE_PIXEL_BUDGET + scale.pixelWidth + scale.pixelHeight,
    'the raster may only overshoot the budget by a rounding row and column',
  );
});

test('budgetLimited is reserved for pages the device itself could not satisfy', () => {
  // A standard-density letter page is smooth: neither the cap nor the budget
  // reduces the scale, so no settle render could sharpen it.
  assert.equal(resolvePdfEditorRenderScale({ ...letterAt(1), devicePixelRatio: 1 }).budgetLimited, false);
  assert.equal(resolvePdfEditorRenderScale({ ...letterAt(1), devicePixelRatio: 2 }).budgetLimited, false);
  assert.equal(resolvePdfEditorRenderScale({ ...letterAt(1), devicePixelRatio: 3 }).budgetLimited, false);
  // A page that fell to CSS resolution under an impossible budget is as
  // budget-limited as any other.
  assert.equal(
    resolvePdfEditorRenderScale({ ...letterAt(1), devicePixelRatio: 2, pixelBudget: 100 }).budgetLimited,
    true,
  );
  // A page whose budgeted scale lands exactly on the device's ratio is not
  // missing anything — the flag must not send the settle pass after it.
  const exact = Math.sqrt(PDF_EDITOR_PAGE_PIXEL_BUDGET / (612 * 3 * 792 * 3));
  assert.ok(exact > 0 && exact < 2, 'choice of zoom puts the budgeted scale inside the cap');
  assert.equal(
    resolvePdfEditorRenderScale({ ...letterAt(3), devicePixelRatio: exact, maxPixelRatio: 2 }).budgetLimited,
    false,
    'a budgeted scale equal to the device ratio is not budget-limited',
  );
});

test('the settle budget is where a zoomed page can recover the device ratio', () => {
  // Letter page at 3× on a retina display: the interaction budget gives ~1.3,
  // the settle budget gives ~1.9 — still short of 2 (an honest ceiling), but
  // visibly sharper. The settle render is a budget argument to the same
  // function, so it stays inside every prior guarantee.
  const settle = resolvePdfEditorRenderScale({
    ...letterAt(3),
    devicePixelRatio: 2,
    pixelBudget: PDF_EDITOR_PAGE_SETTLE_PIXEL_BUDGET,
  });
  const interaction = resolvePdfEditorRenderScale({ ...letterAt(3), devicePixelRatio: 2 });
  assert.ok(settle.outputScale > interaction.outputScale, 'the settle pass must raise the scale');
  assert.ok(
    settle.pixelWidth * settle.pixelHeight <= PDF_EDITOR_PAGE_SETTLE_PIXEL_BUDGET + settle.pixelWidth + settle.pixelHeight,
    'the settle raster obeys its own budget the same way',
  );
});

test('an impossible budget still renders at CSS resolution rather than failing', () => {
  const scale = resolvePdfEditorRenderScale({ ...letterAt(1), devicePixelRatio: 2, pixelBudget: 100 });
  assert.equal(scale.outputScale, 1);
  assert.deepEqual(
    { width: scale.pixelWidth, height: scale.pixelHeight },
    { width: Math.round(612), height: Math.round(792) },
  );
});

test('degenerate page geometry still yields a drawable raster', () => {
  for (const geometry of [
    { cssWidth: 0, cssHeight: 0 },
    { cssWidth: -40, cssHeight: -40 },
    { cssWidth: Number.NaN, cssHeight: Number.NaN },
    { cssWidth: Number.POSITIVE_INFINITY, cssHeight: 10 },
  ]) {
    const scale = resolvePdfEditorRenderScale({ ...geometry, devicePixelRatio: 2 });
    assert.ok(scale.pixelWidth >= 1 && Number.isInteger(scale.pixelWidth));
    assert.ok(scale.pixelHeight >= 1 && Number.isInteger(scale.pixelHeight));
  }
});

test('identical input yields identical output, and a higher ratio never renders fewer pixels', () => {
  const input = { cssWidth: 807.36, cssHeight: 1043.52, devicePixelRatio: 2 };
  assert.deepEqual(resolvePdfEditorRenderScale(input), resolvePdfEditorRenderScale({ ...input }));
  const standard = resolvePdfEditorRenderScale({ ...input, devicePixelRatio: 1 });
  const retina = resolvePdfEditorRenderScale(input);
  assert.ok(retina.pixelWidth * retina.pixelHeight >= standard.pixelWidth * standard.pixelHeight);
});

test('thumbnail-sized rasters are cheap enough to stay at the capped ratio', () => {
  const scale = resolvePdfEditorRenderScale({
    cssWidth: 142, cssHeight: 184, devicePixelRatio: 3, pixelBudget: PDF_EDITOR_THUMBNAIL_PIXEL_BUDGET,
  });
  assert.equal(scale.outputScale, PDF_EDITOR_MAX_PIXEL_RATIO);
  assert.ok(scale.pixelWidth * scale.pixelHeight <= PDF_EDITOR_THUMBNAIL_PIXEL_BUDGET);
});

test('the export preview never comes out softer than the 2x it has always been', () => {
  for (const ratio of [undefined, 1, 1.5, 0, -3, Number.NaN]) {
    assert.equal(
      resolvePdfEditorPreviewOutputScale({ ...letterAt(1), devicePixelRatio: ratio }),
      PDF_EDITOR_PREVIEW_BASE_PIXEL_RATIO,
      `ratio ${ratio} must not drop the preview below its baseline`,
    );
  }
  assert.equal(
    resolvePdfEditorPreviewOutputScale({ ...letterAt(0.5), devicePixelRatio: 1 }),
    PDF_EDITOR_PREVIEW_BASE_PIXEL_RATIO,
    'zooming out must not throw away the raster density',
  );
});

test('the export preview follows retina ratios and display zoom up to its own cap', () => {
  assert.equal(resolvePdfEditorPreviewOutputScale({ ...letterAt(1), devicePixelRatio: 2 }), 2);
  assert.equal(
    resolvePdfEditorPreviewOutputScale({ ...letterAt(1), devicePixelRatio: 3 }),
    PDF_EDITOR_PREVIEW_MAX_PIXEL_RATIO,
  );
  assert.equal(
    resolvePdfEditorPreviewOutputScale({ ...letterAt(1), devicePixelRatio: 8 }),
    PDF_EDITOR_PREVIEW_MAX_PIXEL_RATIO,
  );
  assert.equal(resolvePdfEditorPreviewOutputScale({ ...letterAt(1), devicePixelRatio: 1, zoom: 1 }), 2);
  assert.equal(resolvePdfEditorPreviewOutputScale({ ...letterAt(1), devicePixelRatio: 1, zoom: 2 }), 2);
  // A narrow page still fits the budget at a 3× zoom step, so it does reach the
  // cap — the cap is a ceiling, not an entitlement.
  assert.equal(
    resolvePdfEditorPreviewOutputScale({ cssWidth: 200, cssHeight: 260, devicePixelRatio: 1, zoom: 3 }),
    PDF_EDITOR_PREVIEW_MAX_PIXEL_RATIO,
  );
  assert.equal(
    resolvePdfEditorPreviewOutputScale({ cssWidth: 200, cssHeight: 260, devicePixelRatio: 2, zoom: 2 }),
    PDF_EDITOR_PREVIEW_MAX_PIXEL_RATIO,
  );
});

test('a full page at high zoom trades the cap for the pixel budget', () => {
  const magnified = resolvePdfEditorPreviewOutputScale({ ...letterAt(1), devicePixelRatio: 1, zoom: 3 });
  assert.ok(magnified > 1 && magnified < PDF_EDITOR_PREVIEW_MAX_PIXEL_RATIO, `expected a budgeted scale, got ${magnified}`);
  approximately(
    magnified,
    Math.sqrt(PDF_EDITOR_PREVIEW_PIXEL_BUDGET / (1836 * 2376)),
    'a budgeted preview scale is the square root of the budget over its displayed area',
  );
});

test('a deeply zoomed preview loses resolution to the budget but never below one pixel per CSS pixel', () => {
  const magnified = { cssWidth: 560, cssHeight: 725, zoom: 4, devicePixelRatio: 3 };
  const budgeted = resolvePdfEditorPreviewOutputScale(magnified);
  assert.ok(budgeted >= 1 && budgeted < PDF_EDITOR_PREVIEW_BASE_PIXEL_RATIO, `expected a budgeted scale, got ${budgeted}`);
  approximately(
    budgeted,
    Math.sqrt(PDF_EDITOR_PREVIEW_PIXEL_BUDGET / (2240 * 2900)),
    'a budgeted preview scale is the square root of the budget over its displayed area',
  );

  const impossible = resolvePdfEditorPreviewOutputScale({ ...magnified, pixelBudget: 10 });
  assert.equal(impossible, 1, 'the preview raster may not drop below CSS resolution');
});

test('the preview budget is its own, and callers can still hand it the page budget', () => {
  assert.notEqual(PDF_EDITOR_PREVIEW_PIXEL_BUDGET, PDF_EDITOR_PAGE_PIXEL_BUDGET);
  // The narrower letter page at a 2× stop sits inside the page budget just as
  // it does inside the preview's own, so an explicit budget overrides, the way
  // it always has.
  const narrow = { cssWidth: 200, cssHeight: 260, devicePixelRatio: 1, zoom: 3 };
  assert.equal(
    resolvePdfEditorPreviewOutputScale({ ...narrow, pixelBudget: PDF_EDITOR_PAGE_PIXEL_BUDGET }),
    resolvePdfEditorPreviewOutputScale(narrow),
    'a zoom stop that fits either budget must resolve to the same scale',
  );
});
