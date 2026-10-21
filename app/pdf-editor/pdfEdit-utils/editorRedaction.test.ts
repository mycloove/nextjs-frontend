import assert from 'node:assert/strict';
import test from 'node:test';

import { resolvePdfEditorFeatureFlags } from './editorFeatureFlags.ts';
import {
  REDACTION_MARK_EDGE_RATIO,
  REDACTION_MARK_MIN_EDGE,
  createPdfEditorRedactionMark,
  describePdfEditorRedactionImpact,
  isPdfEditorRedactionMarked,
  normalizePdfEditorRedactionMarks,
  pdfEditorRedactionDisplayBox,
  pdfEditorRedactionExpectations,
  removePdfEditorRedactionMark,
  togglePdfEditorRedactionMark,
  type PdfEditorRedactionMark,
} from './editorRedaction.ts';

const block = {
  page: 2,
  index: 3,
  text: 'Salary: 42,000 BDT',
  x: 200,
  y: 300,
  width: 240,
  height: 20,
};

function markFor(overrides: Partial<typeof block> = {}): PdfEditorRedactionMark {
  const result = createPdfEditorRedactionMark({ ...block, ...overrides }, 2);
  assert.equal(result.ok, true);
  if (!result.ok) throw new Error('unreachable');
  return result.mark;
}

test('a detected run becomes a mark in PDF points, not screen pixels', () => {
  const result = createPdfEditorRedactionMark(block, 2);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.mark, {
    id: 'redact:2:3',
    page: 2,
    blockKey: '2:3',
    originalText: 'Salary: 42,000 BDT',
    x: 100,
    y: 150,
    width: 120,
    height: 10,
    box: 'font',
  });
});

test('marks refuse anything the removal engine cannot prove', () => {
  assert.equal(
    createPdfEditorRedactionMark({ ...block, text: '   ' }, 2).ok,
    false,
  );
  assert.equal(
    createPdfEditorRedactionMark({ ...block, width: 0 }, 2).ok,
    false,
  );
  assert.equal(
    createPdfEditorRedactionMark(block, 0).ok,
    false,
  );
  assert.equal(
    createPdfEditorRedactionMark({ ...block, page: 0 }, 2).ok,
    false,
  );
});

test('toggling the same source run adds once and removes the same mark', () => {
  const mark = markFor();
  const added = togglePdfEditorRedactionMark([], mark);
  assert.equal(added.action, 'added');
  assert.equal(added.marks.length, 1);

  const removed = togglePdfEditorRedactionMark(added.marks, mark);
  assert.equal(removed.action, 'removed');
  assert.equal(removed.marks.length, 0);

  const two = togglePdfEditorRedactionMark(
    added.marks,
    markFor({ index: 4, text: 'Bonus: 5,000 BDT' }),
  );
  assert.equal(two.marks.length, 2);
  assert.equal(isPdfEditorRedactionMarked(two.marks, 2, 3), true);
  assert.equal(isPdfEditorRedactionMarked(two.marks, 2, 9), false);
});

test('review impact and removal expectations name every page and run', () => {
  const marks = [markFor(), markFor({ page: 3, index: 1, text: 'Account 1234' })];
  const impact = describePdfEditorRedactionImpact(marks);
  assert.equal(impact.count, 2);
  assert.deepEqual(impact.pages, [2, 3]);
  assert.match(impact.summary, /permanently removed/);

  assert.deepEqual(pdfEditorRedactionExpectations(marks), [
    { page: 2, text: 'Salary: 42,000 BDT', label: 'Redacted text on page 2' },
    { page: 3, text: 'Account 1234', label: 'Redacted text on page 3' },
  ]);
});

test('removing a mark by id leaves the rest intact', () => {
  const marks = [markFor(), markFor({ page: 3, index: 1, text: 'Account 1234' })];
  assert.deepEqual(
    removePdfEditorRedactionMark(marks, 'redact:2:3').map(mark => mark.id),
    ['redact:3:1'],
  );
});

test('the redaction flag defaults on and can be switched off for rollback', () => {
  assert.equal(resolvePdfEditorFeatureFlags({}).redactionAuthoring, true);
  assert.equal(resolvePdfEditorFeatureFlags({
    NEXT_PUBLIC_PDF_EDITOR_REDACTION_AUTHORING: 'off',
  }).redactionAuthoring, false);
  assert.equal(resolvePdfEditorFeatureFlags({
    NEXT_PUBLIC_PDF_EDITOR_REDACTION_AUTHORING: 'not-a-real-value',
  }).redactionAuthoring, true);
});

test('draft recovery drops only malformed marks', () => {
  const normalized = normalizePdfEditorRedactionMarks([
    markFor(),
    { page: 1, originalText: 'Broken box', x: 1, y: 2, width: 0, height: 3 },
    { page: 1, originalText: '', x: 1, y: 2, width: 3, height: 3 },
    'not a mark',
    markFor(),
  ]);
  assert.equal(normalized.length, 1);
  assert.equal(normalized[0].id, 'redact:2:3');
  assert.deepEqual(normalizePdfEditorRedactionMarks(null), []);
  assert.deepEqual(normalizePdfEditorRedactionMarks({}), []);
});

test('the preview bar covers the full font box around the engine rectangle', () => {
  const mark = markFor();
  const display = pdfEditorRedactionDisplayBox(mark, 2);

  // The stored server rectangle is untouched; only the preview bleeds.
  assert.deepEqual(
    { x: mark.x, y: mark.y, width: mark.width, height: mark.height },
    { x: 100, y: 150, width: 120, height: 10 },
  );

  const inkLeft = mark.x * 2;
  const inkTop = mark.y * 2;
  const inkRight = inkLeft + mark.width * 2;
  const baseline = inkTop + mark.height * 2;
  assert.ok(display.left < inkLeft, 'the bar must bleed past the left ink edge');
  assert.ok(display.top < inkTop, 'the bar must cover glyph tops above the ink box');
  assert.ok(display.left + display.width > inkRight, 'the bar must bleed past the right ink edge');
  assert.ok(display.top + display.height > baseline, 'the bar must cover the descent space');
});

test('the preview bar follows the source face ascent and descent', () => {
  const mark = markFor();
  const baseline = mark.y * 2 + mark.height * 2;
  // 18pt ascent and 8pt descent at 2x; both are deeper than the fallbacks.
  const display = pdfEditorRedactionDisplayBox(mark, 2, { ascent: 18, descent: 8 });
  const edge = Math.max(REDACTION_MARK_MIN_EDGE, mark.height * 2 * REDACTION_MARK_EDGE_RATIO);

  assert.ok(Math.abs(display.top - (baseline - 36 - edge)) < 1e-9);
  assert.ok(
    Math.abs(display.top + display.height - (baseline + Math.max(mark.height, 8 * 2) + edge)) < 1e-9,
    'the bar must cover the real descent, not only the generic estimate',
  );
});

test('the preview bar scales with zoom and survives an invalid zoom', () => {
  const mark = markFor();
  const atTwo = pdfEditorRedactionDisplayBox(mark, 2, { ascent: 18, descent: 8 });
  const atFour = pdfEditorRedactionDisplayBox(mark, 4, { ascent: 18, descent: 8 });
  assert.ok(Math.abs(atFour.height - atTwo.height * 2) < 1e-9);

  const fallback = pdfEditorRedactionDisplayBox(mark, 0);
  assert.ok(fallback.left < mark.x);
  assert.ok(fallback.top < mark.y);
  assert.ok(fallback.top + fallback.height > mark.y + mark.height);
});

test('the bar expands across a rotated run instead of along it', () => {
  const mark = { ...markFor(), x: 50, y: 50, width: 10, height: 160 };
  const display = pdfEditorRedactionDisplayBox(mark, 1, { ascent: 12, descent: 4 });

  assert.ok(display.left < 50, 'the bar must cover the left side of the run');
  assert.ok(display.left + display.width > 60, 'the bar must cover the right side of the run');
  assert.ok(display.top < 50, 'the bar must pad the start of the run');
  assert.ok(display.top + display.height > 210, 'the bar must cover the end of the run');
  assert.ok(
    display.width < display.height / 2,
    'rotated runs must not stretch the bar along the line',
  );
});
