import assert from 'node:assert/strict';
import test from 'node:test';

import {
  applyPdfEditorPageOperation,
  createPdfEditorPagePlan,
  expectedPdfEditorOutputPageCount,
  getEffectivePdfEditorPageRotation,
  getPdfEditorPagePlanImpact,
  isPdfEditorPagePlanUnchanged,
  type PdfEditorPagePlan,
} from './editorPageModel.ts';

function plan(sourcePageCount: number): PdfEditorPagePlan {
  const created = createPdfEditorPagePlan(sourcePageCount);
  assert.ok(created.ok, 'expected a valid plan for this test setup');
  return created.plan;
}

function order(value: PdfEditorPagePlan) {
  return value.entries.map((entry) => entry.sourcePage);
}

function apply(value: PdfEditorPagePlan, operation: Parameters<typeof applyPdfEditorPageOperation>[1]) {
  const result = applyPdfEditorPageOperation(value, operation);
  assert.ok(result.ok, `expected operation ${operation.type} to succeed`);
  return result.plan;
}

test('a new plan is a 1:1 identity map of the source document', () => {
  const created = plan(4);
  assert.deepEqual(order(created), [1, 2, 3, 4]);
  assert.ok(created.entries.every((entry) => entry.rotation === 0));
  assert.equal(new Set(created.entries.map((entry) => entry.id)).size, 4);
  assert.equal(isPdfEditorPagePlanUnchanged(created), true);
  assert.equal(expectedPdfEditorOutputPageCount(created), 4);
});

test('a plan cannot be created for a document with no usable page count', () => {
  for (const invalid of [0, -3, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
    const result = createPdfEditorPagePlan(invalid);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.reason, 'invalid-source-page-count');
  }
});

test('move reorders pages without adding or losing any source page', () => {
  const moved = apply(plan(5), { type: 'move', from: 1, to: 4 });
  assert.deepEqual(order(moved), [2, 3, 4, 1, 5]);
  assert.equal(expectedPdfEditorOutputPageCount(moved), 5);

  const back = apply(moved, { type: 'move', from: 4, to: 1 });
  assert.deepEqual(order(back), [1, 2, 3, 4, 5]);
  assert.equal(isPdfEditorPagePlanUnchanged(back), true);
});

test('move rejects positions outside the current plan', () => {
  const source = plan(3);
  for (const operation of [
    { type: 'move', from: 0, to: 2 },
    { type: 'move', from: 9, to: 2 },
    { type: 'move', from: 1.5, to: 2 },
  ] as const) {
    const result = applyPdfEditorPageOperation(source, operation);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.reason, 'page-out-of-range');
  }

  const badTarget = applyPdfEditorPageOperation(source, { type: 'move', from: 1, to: 7 });
  assert.equal(badTarget.ok, false);
  if (!badTarget.ok) assert.equal(badTarget.reason, 'invalid-target-index');
});

test('rotation stays on the 0/90/180/270 axis and wraps instead of accumulating', () => {
  let rotated = apply(plan(2), { type: 'rotate', pages: [1], delta: 90 });
  assert.equal(rotated.entries[0].rotation, 90);
  assert.equal(rotated.entries[1].rotation, 0);

  rotated = apply(rotated, { type: 'rotate', pages: [1], delta: 270 });
  assert.equal(rotated.entries[0].rotation, 0, 'a full turn must return to zero');
  assert.equal(isPdfEditorPagePlanUnchanged(rotated), true);

  const negative = apply(plan(1), { type: 'rotate', pages: [1], delta: -90 });
  assert.equal(negative.entries[0].rotation, 270);
});

test('rotation rejects off-axis angles and unusable selections', () => {
  const source = plan(3);

  const offAxis = applyPdfEditorPageOperation(source, { type: 'rotate', pages: [1], delta: 45 });
  assert.equal(offAxis.ok, false);
  if (!offAxis.ok) assert.equal(offAxis.reason, 'invalid-rotation');

  const empty = applyPdfEditorPageOperation(source, { type: 'rotate', pages: [], delta: 90 });
  assert.equal(empty.ok, false);
  if (!empty.ok) assert.equal(empty.reason, 'empty-page-selection');

  const outOfRange = applyPdfEditorPageOperation(source, { type: 'rotate', pages: [4], delta: 90 });
  assert.equal(outOfRange.ok, false);
  if (!outOfRange.ok) assert.equal(outOfRange.reason, 'page-out-of-range');
});

test('delete removes exactly the selected positions and reports them as removed', () => {
  const deleted = apply(plan(5), { type: 'delete', pages: [2, 4] });
  assert.deepEqual(order(deleted), [1, 3, 5]);
  assert.equal(expectedPdfEditorOutputPageCount(deleted), 3);

  const impact = getPdfEditorPagePlanImpact(deleted);
  assert.deepEqual(impact.removedSourcePages, [2, 4]);
  assert.equal(impact.hasPageMutation, true);
  assert.equal(impact.reordered, false, 'a pure delete is not a reorder');
});

test('delete can never empty the document', () => {
  const source = plan(3);
  const all = applyPdfEditorPageOperation(source, { type: 'delete', pages: [1, 2, 3] });
  assert.equal(all.ok, false);
  if (!all.ok) assert.equal(all.reason, 'would-delete-every-page');

  const single = applyPdfEditorPageOperation(plan(1), { type: 'delete', pages: [1] });
  assert.equal(single.ok, false);
  if (!single.ok) assert.equal(single.reason, 'would-delete-every-page');

  const repeated = applyPdfEditorPageOperation(source, { type: 'delete', pages: [2, 2, 2] });
  assert.ok(repeated.ok, 'duplicate selections must collapse, not over-count');
  if (repeated.ok) assert.deepEqual(order(repeated.plan), [1, 3]);
});

test('duplicate inserts a copy directly after each selected page with a unique id', () => {
  const duplicated = apply(plan(3), { type: 'duplicate', pages: [2] });
  assert.deepEqual(order(duplicated), [1, 2, 2, 3]);
  assert.equal(new Set(duplicated.entries.map((entry) => entry.id)).size, 4);

  const twice = apply(duplicated, { type: 'duplicate', pages: [2] });
  assert.deepEqual(order(twice), [1, 2, 2, 2, 3]);
  assert.equal(new Set(twice.entries.map((entry) => entry.id)).size, 5, 'ids must stay unique');

  const impact = getPdfEditorPagePlanImpact(twice);
  assert.deepEqual(impact.duplicatedSourcePages, [2]);
  assert.equal(impact.outputPageCount, 5);
});

test('duplicate preserves the rotation of the page it copies', () => {
  const rotated = apply(plan(2), { type: 'rotate', pages: [1], delta: 180 });
  const duplicated = apply(rotated, { type: 'duplicate', pages: [1] });
  assert.deepEqual(order(duplicated), [1, 1, 2]);
  assert.equal(duplicated.entries[1].rotation, 180);
  assert.notEqual(duplicated.entries[0].id, duplicated.entries[1].id);
});

test('operations never mutate the plan they were given', () => {
  const source = plan(3);
  const snapshot = JSON.stringify(source);

  apply(source, { type: 'move', from: 1, to: 3 });
  apply(source, { type: 'rotate', pages: [1, 2, 3], delta: 90 });
  apply(source, { type: 'delete', pages: [1] });
  apply(source, { type: 'duplicate', pages: [1] });

  assert.equal(JSON.stringify(source), snapshot, 'page plans must be treated as immutable');
});

test('an untouched plan stays eligible for byte-preserving export', () => {
  const untouched = plan(3);
  assert.equal(isPdfEditorPagePlanUnchanged(untouched), true);
  assert.equal(getPdfEditorPagePlanImpact(untouched).hasPageMutation, false);

  for (const operation of [
    { type: 'move', from: 1, to: 2 },
    { type: 'rotate', pages: [1], delta: 90 },
    { type: 'delete', pages: [1] },
    { type: 'duplicate', pages: [1] },
  ] as const) {
    const mutated = apply(untouched, operation);
    assert.equal(isPdfEditorPagePlanUnchanged(mutated), false, `${operation.type} must count as a mutation`);
    assert.equal(getPdfEditorPagePlanImpact(mutated).hasPageMutation, true);
  }
});

test('impact reports a pure reorder separately from added or removed pages', () => {
  const reordered = apply(plan(4), { type: 'move', from: 4, to: 1 });
  const impact = getPdfEditorPagePlanImpact(reordered);
  assert.equal(impact.reordered, true);
  assert.deepEqual(impact.removedSourcePages, []);
  assert.deepEqual(impact.duplicatedSourcePages, []);
  assert.equal(impact.outputPageCount, 4);
  assert.deepEqual(impact.rotatedPositions, []);
});

test('impact reports rotated output positions rather than source page numbers', () => {
  const rotated = apply(plan(3), { type: 'rotate', pages: [3], delta: 90 });
  const moved = apply(rotated, { type: 'move', from: 3, to: 1 });
  const impact = getPdfEditorPagePlanImpact(moved);
  assert.deepEqual(order(moved), [3, 1, 2]);
  assert.deepEqual(impact.rotatedPositions, [1], 'position 1 now holds the rotated page');
});

test('expected output page count follows deletes and duplicates for export verification', () => {
  const trimmed = apply(plan(10), { type: 'delete', pages: [1, 2, 3] });
  assert.equal(expectedPdfEditorOutputPageCount(trimmed), 7);

  const grown = apply(trimmed, { type: 'duplicate', pages: [1, 2] });
  assert.equal(expectedPdfEditorOutputPageCount(grown), 9);
});

test('effective rotation combines source rotation with the editor delta', () => {
  assert.equal(getEffectivePdfEditorPageRotation({ rotation: 0 }, 90), 90);
  assert.equal(getEffectivePdfEditorPageRotation({ rotation: 90 }, 90), 180);
  assert.equal(getEffectivePdfEditorPageRotation({ rotation: 270 }, 270), 180);
  assert.equal(getEffectivePdfEditorPageRotation({ rotation: 90 }, -90), 0);
});

test('effective rotation ignores unusable source rotation instead of producing a bad angle', () => {
  for (const bad of [45, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.equal(getEffectivePdfEditorPageRotation({ rotation: 90 }, bad), 90);
  }
});

test('a long chain of page operations stays internally consistent', () => {
  let current = plan(6);
  current = apply(current, { type: 'duplicate', pages: [1, 6] });
  current = apply(current, { type: 'rotate', pages: [2], delta: 90 });
  current = apply(current, { type: 'delete', pages: [3] });
  current = apply(current, { type: 'move', from: 1, to: 5 });

  const impact = getPdfEditorPagePlanImpact(current);
  assert.equal(current.entries.length, impact.outputPageCount);
  assert.equal(new Set(current.entries.map((entry) => entry.id)).size, current.entries.length);
  assert.ok(current.entries.every((entry) => entry.sourcePage >= 1 && entry.sourcePage <= current.sourcePageCount));
  assert.ok(current.entries.every((entry) => [0, 90, 180, 270].includes(entry.rotation)));
  assert.ok(current.entries.length >= 1);
});
