import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createPdfEditorDragGeometry,
  PDF_EDITOR_MIN_DRAG_SIZE,
} from './editorShapeDrag.ts';

const bounds = { width: 200, height: 300 };

test('a rectangle drag keeps its size and normalises the origin', () => {
  const geometry = createPdfEditorDragGeometry(
    'rect',
    { x: 120, y: 180 },
    { x: 20, y: 30 },
    bounds,
  );
  assert.ok(geometry);
  assert.deepEqual(
    { x: geometry.x, y: geometry.y, width: geometry.width, height: geometry.height },
    { x: 20, y: 30, width: 100, height: 150 },
  );
  assert.equal(geometry.flippedX, true);
  assert.equal(geometry.flippedY, true);
  assert.deepEqual(geometry.from, { x: 120, y: 180 });
  assert.deepEqual(geometry.to, { x: 20, y: 30 });
});

test('a drag smaller than the minimum is cancelled', () => {
  assert.equal(
    createPdfEditorDragGeometry('rect', { x: 10, y: 10 }, { x: 13, y: 60 }, bounds),
    null,
  );
  assert.equal(
    createPdfEditorDragGeometry('circle', { x: 10, y: 10 }, { x: 60, y: 13 }, bounds),
    null,
  );
});

test('line and arrow drags are measured by length, not by bounding box', () => {
  const thin = createPdfEditorDragGeometry(
    'line',
    { x: 10, y: 10 },
    { x: 40, y: 10 },
    bounds,
  );
  assert.ok(thin);
  assert.equal(thin.height, 0);
  assert.equal(thin.length, 30);
  assert.equal(thin.angle, 0);

  assert.equal(
    createPdfEditorDragGeometry('arrow', { x: 10, y: 10 }, { x: 12, y: 11 }, bounds),
    null,
  );
});

test('the minimum size is the documented grab floor', () => {
  assert.equal(
    createPdfEditorDragGeometry(
      'rect',
      { x: 0, y: 0 },
      { x: PDF_EDITOR_MIN_DRAG_SIZE - 1, y: 50 },
      bounds,
    ),
    null,
  );
  assert.ok(createPdfEditorDragGeometry(
    'rect',
    { x: 0, y: 0 },
    { x: PDF_EDITOR_MIN_DRAG_SIZE, y: PDF_EDITOR_MIN_DRAG_SIZE },
    bounds,
  ));
});

test('a drag beyond the page edge is clamped and stays inside the page', () => {
  const geometry = createPdfEditorDragGeometry(
    'rect',
    { x: -30, y: -20 },
    { x: 260, y: 400 },
    bounds,
  );
  assert.ok(geometry);
  assert.deepEqual(
    { x: geometry.x, y: geometry.y, width: geometry.width, height: geometry.height },
    { x: 0, y: 0, width: 200, height: 300 },
  );
  assert.equal(geometry.from.x, 0);
  assert.equal(geometry.to.y, 300);
});

test('non-finite drag input never produces NaN', () => {
  const geometry = createPdfEditorDragGeometry(
    'line',
    { x: Number.NaN, y: Number.NEGATIVE_INFINITY },
    { x: 60, y: 20 },
    { width: Number.POSITIVE_INFINITY, height: 100 },
  );
  assert.ok(geometry);
  assert.equal(
    [geometry.x, geometry.y, geometry.width, geometry.height, geometry.angle].every(Number.isFinite),
    true,
  );
});

test('an upward-right drag produces the matching arrow angle', () => {
  const geometry = createPdfEditorDragGeometry(
    'arrow',
    { x: 20, y: 80 },
    { x: 20, y: 20 },
    bounds,
  );
  assert.ok(geometry);
  assert.equal(geometry.angle, -90);
  assert.equal(geometry.flippedY, true);
  assert.equal(geometry.flippedX, false);
});
