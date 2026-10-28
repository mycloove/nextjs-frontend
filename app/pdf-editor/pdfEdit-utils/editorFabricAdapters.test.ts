import assert from 'node:assert/strict';
import test from 'node:test';
import {
  clonePdfEditorFabricObject,
  movePdfEditorFabricObject,
  renewPdfEditorFabricObjectIds,
  restorePdfEditorFabricCanvas,
  snapshotPdfEditorFabricCanvas,
} from './editorFabricAdapters.ts';

const properties = ['peId', 'peName', 'peLocked', 'peHidden', 'evented', 'lockMovementX'];

test('typing snapshots keep real interaction flags without changing the live editing state', () => {
  const text = { isEditing: true, _savedProps: { selectable: true, hasControls: true, lockMovementX: false } };
  const canvas = {
    getObjects: () => [text],
    toJSON: () => ({ objects: [{ text: 'Changed', selectable: false, hasControls: false, lockMovementX: true }] }),
  };
  const snapshot = snapshotPdfEditorFabricCanvas(canvas, ['selectable', 'hasControls', 'lockMovementX']);
  assert.deepEqual(snapshot.objects[0], { text: 'Changed', selectable: true, hasControls: true, lockMovementX: false });
  assert.equal(text.isEditing, true);
  assert.equal(canvas.toJSON().objects[0].hasControls, false);
});

test('clone uses the V5 callback and forwards serialized properties without mutating the source', async () => {
  const clone = { peId: 'original', left: 80, fill: '#dd0000', dispose() {} };
  let finish: (value: typeof clone) => void = () => {};
  const source = {
    clone(callback: typeof finish, included?: string[]) {
      assert.equal(this, source);
      assert.equal(included, properties);
      finish = callback;
      return source;
    },
  };
  let completed = false;
  const pending = clonePdfEditorFabricObject(source, properties).then(value => { completed = true; return value; });
  await Promise.resolve();
  assert.equal(completed, false);
  finish(clone);
  assert.equal(await pending, clone);
  assert.equal(clone.peId, 'original');
});

test('clone refuses missing methods, empty images, and synchronous engine failures', async () => {
  await assert.rejects(clonePdfEditorFabricObject({}, properties), /cannot be copied/);
  await assert.rejects(clonePdfEditorFabricObject({ clone: callback => callback(null, true) }, properties), /could not copy/);
  await assert.rejects(clonePdfEditorFabricObject({ clone: () => { throw new Error('image failed'); } }, properties), /image failed/);
});

test('a timed-out image clone is not accepted later and releases its image resource', async () => {
  let finish: (value: { dispose: () => void }) => void = () => {};
  let disposed = false;
  const pending = clonePdfEditorFabricObject({ clone: callback => { finish = callback; } }, properties, 1);
  await assert.rejects(pending, /could not finish loading/);
  finish({ dispose: () => { disposed = true; } });
  assert.equal(disposed, true);
});

test('a broken late callback must never dispose the source object', async () => {
  let disposed = false;
  let finish: (value: typeof source) => void = () => {};
  const source = {
    dispose: () => { disposed = true; },
    clone(callback: typeof finish) { finish = callback; },
  };
  await assert.rejects(clonePdfEditorFabricObject(source, properties, 1), /could not finish loading/);
  finish(source);
  assert.equal(disposed, false);
});

test('duplicate identity renewal reaches nested group children but not the source tree', () => {
  const object = (children: ReturnType<typeof leaf>[] = []) => ({ ...leaf(), getObjects: () => children });
  function leaf() { return { peId: 'source', set(values: Record<string, unknown>) { Object.assign(this, values); } }; }
  const child = leaf();
  const nested = object([child]);
  const root = object([nested, leaf()]);
  let id = 0;
  renewPdfEditorFabricObjectIds(root, () => `copy-${++id}`);
  assert.equal(id, 4);
  assert.equal(new Set([root.peId, nested.peId, child.peId, root.getObjects()[1].peId]).size, 4);
});

test('stacking invokes all four actual V5 methods on the owning canvas', () => {
  const a = {}, b = {}, c = {};
  let objects = [a, b, c];
  const move = (object: object, index: number) => { objects = objects.filter(item => item !== object); objects.splice(index, 0, object); };
  const canvas = {
    getObjects: () => objects,
    bringToFront(object: object) { assert.equal(this, canvas); move(object, objects.length - 1); },
    sendToBack(object: object) { move(object, 0); },
    bringForward(object: object) { move(object, objects.indexOf(object) + 1); },
    sendBackwards(object: object) { move(object, objects.indexOf(object) - 1); },
  };
  assert.equal(movePdfEditorFabricObject(canvas, a, 'front'), true);
  assert.deepEqual(objects, [b, c, a]);
  movePdfEditorFabricObject(canvas, a, 'back');
  assert.deepEqual(objects, [a, b, c]);
  movePdfEditorFabricObject(canvas, a, 'forward');
  assert.deepEqual(objects, [b, a, c]);
  movePdfEditorFabricObject(canvas, a, 'backward');
  assert.deepEqual(objects, [a, b, c]);
});

test('unsupported or ineffective stacking fails loudly, but an object at the edge is a no-op', () => {
  const a = {}, b = {};
  assert.throws(() => movePdfEditorFabricObject({ getObjects: () => [a, b] }, a, 'front'), /unavailable/);
  const broken = { getObjects: () => [a, b], bringToFront() {} };
  assert.throws(() => movePdfEditorFabricObject(broken, a, 'front'), /did not change/);
  assert.equal(movePdfEditorFabricObject(broken, b, 'front'), false);
});

function staging(state: Record<string, unknown>) {
  let finish = () => {};
  let disposed = false;
  const canvas = {
    loadFromJSON(json: Record<string, unknown>, callback: () => void) {
      assert.notEqual(json, state);
      finish = callback;
      return canvas;
    },
    toJSON: () => state,
    dispose: () => { disposed = true; },
  };
  return { canvas, finish: () => finish(), disposed: () => disposed };
}

test('restore waits for V5 image completion, verifies objects, commits once and disposes staging', async () => {
  const state = { objects: [{ type: 'image', peId: 'image-1', peLocked: true, peHidden: false }] };
  const stage = staging(state);
  let commits = 0;
  const pending = restorePdfEditorFabricCanvas(state, properties, {
    createCanvas: () => stage.canvas,
    isCurrent: () => true,
    commit: canvas => { assert.equal(canvas, stage.canvas); commits += 1; },
  });
  await Promise.resolve();
  assert.equal(commits, 0);
  assert.equal(stage.disposed(), false);
  stage.finish();
  assert.equal(await pending, true);
  assert.equal(commits, 1);
  assert.equal(stage.disposed(), true);
});

test('a replaced session or canvas cannot receive a late restore', async () => {
  const state = { objects: [{ type: 'rect', peId: 'shape-1' }] };
  const stage = staging(state);
  let current = true;
  const pending = restorePdfEditorFabricCanvas(state, properties, {
    createCanvas: () => stage.canvas,
    isCurrent: () => current,
    commit: () => assert.fail('stale restore committed'),
  });
  current = false;
  stage.finish();
  assert.equal(await pending, false);
  assert.equal(stage.disposed(), true);
});

test('restore refuses a silently dropped nested image rather than committing a partial group', async () => {
  const state = { objects: [{ type: 'group', objects: [{ type: 'image', peId: 'image-1' }] }] };
  const stage = staging({ objects: [{ type: 'group', objects: [] }] });
  const pending = restorePdfEditorFabricCanvas(state, properties, {
    createCanvas: () => stage.canvas,
    isCurrent: () => true,
    commit: () => assert.fail('partial group committed'),
  });
  stage.finish();
  await assert.rejects(pending, /could not be restored/);
  assert.equal(stage.disposed(), true);
});

test('restore refuses changed text, position, and serialized interaction flags', async () => {
  const original = { type: 'textbox', peId: 'text-1', text: 'Keep me', left: 42, evented: false };
  for (const changed of [{ text: 'Lost' }, { left: 0 }, { evented: true }]) {
    const state = { objects: [original] };
    const stage = staging({ objects: [{ ...original, ...changed }] });
    const pending = restorePdfEditorFabricCanvas(state, properties, {
      createCanvas: () => stage.canvas,
      isCurrent: () => true,
      commit: () => assert.fail('changed object committed'),
    });
    stage.finish();
    await assert.rejects(pending, /lost/);
  }
});

test('a timed-out restore never commits even if V5 eventually invokes its callback', async () => {
  const state = { objects: [{ type: 'image', peId: 'image-1' }] };
  const stage = staging(state);
  const pending = restorePdfEditorFabricCanvas(state, properties, {
    createCanvas: () => stage.canvas,
    isCurrent: () => true,
    commit: () => assert.fail('expired restore committed'),
  }, 1);
  await assert.rejects(pending, /took too long/);
  assert.equal(stage.disposed(), false);
  stage.finish();
  assert.equal(stage.disposed(), true);
});
