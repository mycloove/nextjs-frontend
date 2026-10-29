import assert from 'node:assert/strict';
import test from 'node:test';

import {
  PDF_EDITOR_MAX_ZOOM,
  PDF_EDITOR_MIN_ZOOM,
  calculatePdfEditorFitZoom,
  clampPdfEditorZoom,
  getPdfEditorVirtualRange,
  includesPdfEditorSearchQuery,
  normalizePdfEditorPageJump,
  normalizePdfEditorSearchQuery,
  retainPdfEditorSearchIndex,
} from './editorShell.ts';

test('fit modes are deterministic and remain within editor zoom limits', () => {
  assert.equal(calculatePdfEditorFitZoom({
    mode: 'actual-size', pageWidth: 600, pageHeight: 800, viewportWidth: 1200, viewportHeight: 900,
  }), 1);
  assert.equal(calculatePdfEditorFitZoom({
    mode: 'fit-width', pageWidth: 600, pageHeight: 800, viewportWidth: 664, viewportHeight: 900,
  }), 1);
  assert.equal(calculatePdfEditorFitZoom({
    mode: 'fit-page', pageWidth: 600, pageHeight: 800, viewportWidth: 1264, viewportHeight: 864,
  }), 1);
  assert.equal(calculatePdfEditorFitZoom({
    mode: 'fit-width', pageWidth: 100, pageHeight: 100, viewportWidth: 2000, viewportHeight: 1000,
  }), 3);
});

test('page jump clamps valid input and rejects ambiguous input', () => {
  assert.equal(normalizePdfEditorPageJump('7', 12), 7);
  assert.equal(normalizePdfEditorPageJump('99', 12), 12);
  assert.equal(normalizePdfEditorPageJump('-2', 12), 1);
  assert.equal(normalizePdfEditorPageJump('page two', 12), null);
  assert.equal(normalizePdfEditorPageJump('', 12), null);
});

test('virtual range bounds visible rows with overscan', () => {
  assert.deepEqual(getPdfEditorVirtualRange({
    scrollTop: 640, viewportHeight: 480, itemHeight: 160, itemCount: 100, overscan: 2,
  }), { start: 2, end: 9 });
  assert.deepEqual(getPdfEditorVirtualRange({
    scrollTop: 0, viewportHeight: 320, itemHeight: 160, itemCount: 3, overscan: 2,
  }), { start: 0, end: 3 });
});

test('search matching is case-insensitive and ignores repeated query whitespace', () => {
  assert.equal(includesPdfEditorSearchQuery('Quarterly Revenue Report', ' revenue   report '), true);
  assert.equal(includesPdfEditorSearchQuery('Quarterly  Revenue\nReport', 'revenue report'), true);
  assert.equal(includesPdfEditorSearchQuery('Quarterly Revenue Report', 'r'), false);
});

test('search refresh retains the selected result rather than returning to the first match', () => {
  const results = [{ id: 'p1:0' }, { id: 'p2:4' }, { id: 'p3:1' }];
  assert.equal(retainPdfEditorSearchIndex(results, 'p2:4', 1), 1);
  assert.equal(retainPdfEditorSearchIndex(results.slice(1), 'p2:4', 1), 0);
  assert.equal(retainPdfEditorSearchIndex(results.slice(0, 2), 'removed', 8), 1);
  assert.equal(retainPdfEditorSearchIndex([], 'removed', 1), 0);
});

test('zoom clamp keeps every requested scale inside the supported editor range', () => {
  assert.equal(clampPdfEditorZoom(1), 1);
  assert.equal(clampPdfEditorZoom(0.0001), PDF_EDITOR_MIN_ZOOM);
  assert.equal(clampPdfEditorZoom(1000), PDF_EDITOR_MAX_ZOOM);
  assert.equal(clampPdfEditorZoom(-4), PDF_EDITOR_MIN_ZOOM);
  assert.equal(clampPdfEditorZoom(PDF_EDITOR_MIN_ZOOM), PDF_EDITOR_MIN_ZOOM);
  assert.equal(clampPdfEditorZoom(PDF_EDITOR_MAX_ZOOM), PDF_EDITOR_MAX_ZOOM);
});

test('zoom clamp falls back to actual size for non-finite input instead of producing NaN geometry', () => {
  assert.equal(clampPdfEditorZoom(Number.NaN), 1);
  assert.equal(clampPdfEditorZoom(Number.POSITIVE_INFINITY), 1);
  assert.equal(clampPdfEditorZoom(Number.NEGATIVE_INFINITY), 1);
});

test('fit-page never exceeds fit-width for the same page and viewport', () => {
  const geometry = { pageWidth: 612, pageHeight: 792, viewportWidth: 1440, viewportHeight: 700 } as const;
  const fitWidth = calculatePdfEditorFitZoom({ mode: 'fit-width', ...geometry });
  const fitPage = calculatePdfEditorFitZoom({ mode: 'fit-page', ...geometry });
  assert.ok(fitPage <= fitWidth, `fit-page ${fitPage} must not exceed fit-width ${fitWidth}`);
});

test('fit modes stay clamped for degenerate viewports and zero-sized pages', () => {
  for (const mode of ['fit-width', 'fit-page'] as const) {
    const tinyViewport = calculatePdfEditorFitZoom({
      mode, pageWidth: 612, pageHeight: 792, viewportWidth: 0, viewportHeight: 0,
    });
    assert.ok(tinyViewport >= PDF_EDITOR_MIN_ZOOM && tinyViewport <= PDF_EDITOR_MAX_ZOOM);

    const zeroPage = calculatePdfEditorFitZoom({
      mode, pageWidth: 0, pageHeight: 0, viewportWidth: 1440, viewportHeight: 900,
    });
    assert.equal(zeroPage, PDF_EDITOR_MAX_ZOOM);
  }
});

test('actual-size ignores viewport and page geometry entirely', () => {
  assert.equal(calculatePdfEditorFitZoom({
    mode: 'actual-size', pageWidth: 0, pageHeight: 0, viewportWidth: 0, viewportHeight: 0,
  }), 1);
  assert.equal(calculatePdfEditorFitZoom({
    mode: 'actual-size', pageWidth: 99999, pageHeight: 99999, viewportWidth: 320, viewportHeight: 480,
  }), 1);
});

test('fit modes honour explicit padding overrides used by the responsive shell', () => {
  const withDefaultPadding = calculatePdfEditorFitZoom({
    mode: 'fit-width', pageWidth: 600, pageHeight: 800, viewportWidth: 1000, viewportHeight: 900,
  });
  const withoutPadding = calculatePdfEditorFitZoom({
    mode: 'fit-width', pageWidth: 600, pageHeight: 800, viewportWidth: 1000, viewportHeight: 900,
    horizontalPadding: 0,
  });
  assert.ok(withoutPadding > withDefaultPadding);
  assert.equal(withoutPadding, 1000 / 600);
});

test('page jump accepts numeric input and truncates fractional pages', () => {
  assert.equal(normalizePdfEditorPageJump(4, 12), 4);
  assert.equal(normalizePdfEditorPageJump(4.9, 12), 4);
  assert.equal(normalizePdfEditorPageJump('  9  ', 12), 9);
  assert.equal(normalizePdfEditorPageJump('12', 12), 12);
  assert.equal(normalizePdfEditorPageJump('1', 1), 1);
});

test('page jump rejects unusable documents and non-finite requests', () => {
  assert.equal(normalizePdfEditorPageJump('3', 0), null);
  assert.equal(normalizePdfEditorPageJump('3', -5), null);
  assert.equal(normalizePdfEditorPageJump(Number.NaN, 12), null);
  assert.equal(normalizePdfEditorPageJump(Number.POSITIVE_INFINITY, 12), null);
});

test('virtual range never leaves the item bounds for large documents', () => {
  const itemCount = 500;
  const range = getPdfEditorVirtualRange({
    scrollTop: 79_000, viewportHeight: 900, itemHeight: 160, itemCount, overscan: 3,
  });
  assert.ok(range.start >= 0);
  assert.ok(range.end <= itemCount);
  assert.ok(range.start <= range.end);
});

test('virtual range keeps memory bounded by rendering far fewer rows than the document', () => {
  const itemCount = 500;
  const range = getPdfEditorVirtualRange({
    scrollTop: 12_000, viewportHeight: 900, itemHeight: 160, itemCount, overscan: 2,
  });
  assert.ok(range.end - range.start < 20, 'virtualized window must stay small for 500-page documents');
});

test('virtual range degrades safely for empty or unmeasured lists', () => {
  assert.deepEqual(getPdfEditorVirtualRange({
    scrollTop: 0, viewportHeight: 400, itemHeight: 160, itemCount: 0,
  }), { start: 0, end: 0 });
  assert.deepEqual(getPdfEditorVirtualRange({
    scrollTop: 0, viewportHeight: 400, itemHeight: 0, itemCount: 40,
  }), { start: 0, end: 0 });
});

test('virtual range tolerates negative scroll offsets from elastic scrolling', () => {
  assert.deepEqual(getPdfEditorVirtualRange({
    scrollTop: -240, viewportHeight: 320, itemHeight: 160, itemCount: 50, overscan: 1,
  }), { start: 0, end: 3 });
});

test('search query normalization collapses whitespace and case for stable matching', () => {
  assert.equal(normalizePdfEditorSearchQuery('  Quarterly   Revenue \n Report '), 'quarterly revenue report');
  assert.equal(normalizePdfEditorSearchQuery(''), '');
  assert.equal(normalizePdfEditorSearchQuery('   '), '');
});

test('search requires at least two characters so single keystrokes do not match everything', () => {
  assert.equal(includesPdfEditorSearchQuery('Revenue', 'Re'), true);
  assert.equal(includesPdfEditorSearchQuery('Revenue', 'R'), false);
  assert.equal(includesPdfEditorSearchQuery('Revenue', ' '), false);
  assert.equal(includesPdfEditorSearchQuery('Revenue', ''), false);
});

test('search matching works for non-latin scripts used by the product', () => {
  assert.equal(includesPdfEditorSearchQuery('বার্ষিক প্রতিবেদন', 'প্রতিবেদন'), true);
  assert.equal(includesPdfEditorSearchQuery('বার্ষিক প্রতিবেদন', 'হিসাব'), false);
});
