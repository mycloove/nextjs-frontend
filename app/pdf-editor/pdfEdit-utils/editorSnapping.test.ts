import assert from 'node:assert/strict';
import test from 'node:test';

import {
  PDF_EDITOR_SNAP_THRESHOLD,
  pdfEditorRectDistance,
  selectPdfEditorSnapObjects,
  snapPdfEditorObjectGeometry,
} from './editorSnapping.ts';

const bounds = { width: 400, height: 600 };

const object = (id: string, x: number, y: number, width = 40, height = 20) => ({
  id,
  geometry: { x, y, width, height },
});

test('the page centre snaps a box that is within the threshold', () => {
  const result = snapPdfEditorObjectGeometry({
    geometry: { x: 178, y: 40, width: 40, height: 20 },
    bounds,
    objects: [],
  });
  // Centre of the box is 198, page centre is 200 — a 2pt pull.
  assert.equal(result.geometry.x, 180);
  assert.equal(result.snappedX, true);
  assert.deepEqual(result.guides, [{ axis: 'x', position: 200, kind: 'page' }]);
});

test('page edges are snap targets', () => {
  const result = snapPdfEditorObjectGeometry({
    geometry: { x: 3, y: 4, width: 40, height: 20 },
    bounds,
    objects: [],
  });
  assert.deepEqual(result.geometry, { x: 0, y: 0, width: 40, height: 20 });
  assert.equal(result.snappedX, true);
  assert.equal(result.snappedY, true);
});

test('another object\'s edges are snap targets', () => {
  const result = snapPdfEditorObjectGeometry({
    geometry: { x: 155, y: 100, width: 40, height: 20 },
    bounds,
    objects: [object('a', 198, 300, 40, 20)],
  });
  // Right edge 195 is 3pt from the neighbour's left edge at 198, closer than
  // the 5pt pull to the page centre at 200.
  assert.equal(result.geometry.x, 158);
  assert.deepEqual(result.guides, [{ axis: 'x', position: 198, kind: 'object' }]);
});

test('movement outside the threshold is left alone', () => {
  const result = snapPdfEditorObjectGeometry({
    geometry: { x: 120, y: 250, width: 40, height: 20 },
    bounds,
    objects: [],
    threshold: PDF_EDITOR_SNAP_THRESHOLD,
  });
  assert.deepEqual(result.geometry, { x: 120, y: 250, width: 40, height: 20 });
  assert.equal(result.snappedX, false);
  assert.equal(result.snappedY, false);
  assert.deepEqual(result.guides, []);
});

test('the dragged object never snaps to itself', () => {
  const result = snapPdfEditorObjectGeometry({
    geometry: { x: 120, y: 250, width: 40, height: 20 },
    bounds,
    objects: [object('moving', 121, 251)],
    movingId: 'moving',
  });
  assert.equal(result.snappedX, false);
  assert.equal(result.snappedY, false);
});

test('malformed geometry never produces NaN', () => {
  const result = snapPdfEditorObjectGeometry({
    geometry: { x: Number.NaN, y: Number.POSITIVE_INFINITY, width: 40, height: 20 },
    bounds: { width: Number.NaN, height: Number.POSITIVE_INFINITY },
    objects: [{ id: 'bad', geometry: { x: Number.NaN, y: 0, width: 0, height: 0 } }],
    threshold: Number.NaN,
  });
  assert.equal(Object.values(result.geometry).every(Number.isFinite), true);
});

test('objects farther than the nearby reach are ignored once a page is busy', () => {
  const moving = { x: 400, y: 100, width: 40, height: 20 };
  const nearA = object('a', 330, 100);
  const nearB = object('b', 350, 100);
  // Left edge at 394 would win a 6pt snap, but it sits far below the drag.
  const far = object('far', 394, 500, 2, 2);

  assert.ok(pdfEditorRectDistance(moving, far.geometry) > 160);
  const considered = selectPdfEditorSnapObjects(moving, [nearA, nearB, far]);
  assert.deepEqual(considered.map(item => item.id), ['a', 'b']);

  const result = snapPdfEditorObjectGeometry({
    geometry: moving,
    bounds: { width: 1000, height: 1000 },
    objects: [nearA, nearB, far],
  });
  assert.equal(result.snappedX, false);
});

test('with fewer than three objects every object stays a snap reference', () => {
  const moving = { x: 400, y: 100, width: 40, height: 20 };
  const far = object('far', 394, 500, 2, 2);
  const considered = selectPdfEditorSnapObjects(moving, [far]);
  assert.deepEqual(considered.map(item => item.id), ['far']);
});

test('hidden objects are never snap targets', () => {
  const considered = selectPdfEditorSnapObjects(
    { x: 10, y: 10, width: 20, height: 20 },
    [object('hidden', 10, 10), object('shown', 40, 40)].map((item, index) => (
      index === 0 ? { ...item, hidden: true } : item
    )),
  );
  assert.deepEqual(considered.map(item => item.id), ['shown']);
});
