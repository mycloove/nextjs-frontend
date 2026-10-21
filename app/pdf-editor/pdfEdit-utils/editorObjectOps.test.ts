import assert from 'node:assert/strict';
import test from 'node:test';

import {
  alignPdfEditorObjects,
  clampPdfEditorObjectGeometry,
  distributePdfEditorObjects,
  geometryChanged,
  nudgePdfEditorObjectGeometry,
  pdfEditorLayerName,
  PDF_EDITOR_MIN_OBJECT_SIZE,
  type PdfEditorAlignedObject,
} from './editorObjectOps.ts';

const object = (
  id: string,
  x: number,
  y: number,
  width = 40,
  height = 20,
): PdfEditorAlignedObject => ({ id, geometry: { x, y, width, height } });

test('geometry is clamped inside the page and above the grab minimum', () => {
  assert.deepEqual(
    clampPdfEditorObjectGeometry({ x: -20, y: -5, width: 500, height: 1 }, { width: 200, height: 100 }),
    { x: 0, y: 0, width: 200, height: PDF_EDITOR_MIN_OBJECT_SIZE },
  );
});

test('clamping a too-large width does not push the object off the left edge', () => {
  const clamped = clampPdfEditorObjectGeometry(
    { x: 150, y: 10, width: 300, height: 20 },
    { width: 200, height: 100 },
  );
  assert.equal(clamped.width, 200);
  assert.equal(clamped.x, 0);
});

test('nudging moves by points and stops at the page edge', () => {
  assert.deepEqual(
    nudgePdfEditorObjectGeometry({ x: 10, y: 10, width: 20, height: 20 }, 5, -3, { width: 100, height: 100 }),
    { x: 15, y: 7, width: 20, height: 20 },
  );
  assert.deepEqual(
    nudgePdfEditorObjectGeometry({ x: 70, y: 70, width: 20, height: 20 }, 50, 50, { width: 100, height: 100 }),
    { x: 80, y: 80, width: 20, height: 20 },
  );
});

test('non-finite movement never produces NaN geometry', () => {
  const result = nudgePdfEditorObjectGeometry(
    { x: 10, y: 10, width: 20, height: 20 },
    Number.NaN,
    Number.POSITIVE_INFINITY,
    { width: 100, height: 100 },
  );
  assert.equal(Object.values(result).every(Number.isFinite), true);
});

test('align left/right/center uses the selection bounding box', () => {
  const items = [object('a', 10, 10, 20, 20), object('b', 60, 40, 40, 20)];
  assert.deepEqual(alignPdfEditorObjects(items, 'left').map(item => item.geometry.x), [10, 10]);
  assert.deepEqual(alignPdfEditorObjects(items, 'right').map(item => item.geometry.x), [80, 60]);
  assert.deepEqual(alignPdfEditorObjects(items, 'center').map(item => item.geometry.x), [45, 35]);
});

test('align top/middle/bottom uses the selection bounding box', () => {
  const items = [object('a', 10, 10, 20, 20), object('b', 40, 60, 20, 40)];
  assert.deepEqual(alignPdfEditorObjects(items, 'top').map(item => item.geometry.y), [10, 10]);
  assert.deepEqual(alignPdfEditorObjects(items, 'bottom').map(item => item.geometry.y), [80, 60]);
  assert.deepEqual(alignPdfEditorObjects(items, 'middle').map(item => item.geometry.y), [45, 35]);
});

test('aligning fewer than two objects is a no-op', () => {
  const items = [object('a', 10, 10)];
  assert.deepEqual(alignPdfEditorObjects(items, 'left'), items);
});

test('horizontal distribution keeps the outer objects and equalises the gaps', () => {
  const items = [object('a', 0, 0, 10, 10), object('b', 20, 0, 20, 10), object('c', 100, 0, 10, 10)];
  const result = distributePdfEditorObjects(items, 'horizontal');
  const byId = new Map(result.map(item => [item.id, item.geometry.x]));
  assert.equal(byId.get('a'), 0);
  assert.equal(byId.get('c'), 100);
  // Span 110, total widths 40, one gap of 35 => b starts at 45.
  assert.equal(byId.get('b'), 45);
});

test('vertical distribution is the same rule on the other axis', () => {
  const items = [object('a', 0, 0, 10, 10), object('b', 0, 30, 10, 10), object('c', 0, 100, 10, 10)];
  const result = distributePdfEditorObjects(items, 'vertical');
  const byId = new Map(result.map(item => [item.id, item.geometry.y]));
  assert.equal(byId.get('a'), 0);
  assert.equal(byId.get('c'), 100);
  assert.equal(byId.get('b'), 50);
});

test('distribution with fewer than three objects is unchanged', () => {
  const items = [object('a', 0, 0), object('b', 30, 0)];
  assert.deepEqual(distributePdfEditorObjects(items, 'horizontal'), items);
});

test('geometry comparison ignores sub-pixel noise but catches real movement', () => {
  const base = { x: 10, y: 10, width: 20, height: 20 };
  assert.equal(geometryChanged(base, { ...base, x: 10.001 }), false);
  assert.equal(geometryChanged(base, { ...base, x: 11 }), true);
});

test('layer names are stable and human-readable', () => {
  assert.equal(pdfEditorLayerName('text', 0), 'Text 1');
  assert.equal(pdfEditorLayerName('image', 2), 'Image 3');
  assert.equal(pdfEditorLayerName('shape', 1), 'Shape 2');
});
