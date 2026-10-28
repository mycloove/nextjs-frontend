import assert from 'node:assert/strict';
import test from 'node:test';

import {
  computePdfEditorExportFingerprint,
  createPdfEditorExportBuildCache,
  getOrBuildPdfEditorExport,
  PDF_EDITOR_EXPORT_BUILD_CACHE_CAPACITY,
  PdfEditorExportFingerprintError,
  type PdfEditorExportFingerprintInput,
} from './editorExportBuildCache.ts';

function input(
  overrides: Partial<PdfEditorExportFingerprintInput> = {},
): PdfEditorExportFingerprintInput {
  return {
    file: { name: 'invoice.pdf', size: 12_345, lastModified: 1_700_000_000_000, sessionId: 1 },
    pageSize: 'original',
    confirmedMode: null,
    textEdits: [{
      page: 1,
      x: 72,
      y: 691,
      width: 64.5,
      height: 9,
      text: 'Replacement',
      fontSize: 9,
      fontFamily: 'Helvetica',
      color: '#111111',
      bold: false,
      italic: false,
      underline: false,
      align: 'left',
      lineHeight: 1.15,
    }],
    redactions: [],
    canvasPages: [],
    consent: null,
    ...overrides,
  };
}

test('the same inputs always produce the same fingerprint', () => {
  assert.equal(
    computePdfEditorExportFingerprint(input()),
    computePdfEditorExportFingerprint(input()),
  );
});

test('property order never changes the fingerprint', () => {
  // Two objects built in different key orders describe the same export, so
  // reordering must not invalidate a build the user is already looking at.
  const forwards = computePdfEditorExportFingerprint(input({
    textEdits: [{ page: 1, text: 'Hi', fontSize: 9 }],
  }));
  const backwards = computePdfEditorExportFingerprint(input({
    textEdits: [{ fontSize: 9, text: 'Hi', page: 1 }],
  }));
  assert.equal(forwards, backwards);
});

test('the cache hands both consumers the identical value, not a copy', () => {
  // This is the P = E guarantee in one assertion: the preview stores a build and
  // Save gets back the very same object, so it cannot write different bytes.
  const cache = createPdfEditorExportBuildCache<Uint8Array>();
  const bytes = new Uint8Array([0x25, 0x50, 0x44, 0x46]);
  const fingerprint = computePdfEditorExportFingerprint(input());

  assert.equal(cache.set(fingerprint, bytes), bytes);
  assert.equal(cache.get(fingerprint), bytes);
  // Reference equality, deliberately — a structurally equal copy would let the
  // two paths drift apart again.
  assert.ok(cache.get(fingerprint) === bytes);
});

test('editing the text invalidates the build', () => {
  const before = computePdfEditorExportFingerprint(input());
  const after = computePdfEditorExportFingerprint(input({
    textEdits: [{ ...(input().textEdits[0] as object), text: 'Something else' }],
  }));
  assert.notEqual(before, after);
});

test('a style property this module has never heard of still invalidates the build', () => {
  // The fingerprint walks whatever it is given rather than a hand-listed set of
  // fields, so a property added to a text mutation later cannot silently leave a
  // stale preview on screen.
  const before = computePdfEditorExportFingerprint(input());
  const after = computePdfEditorExportFingerprint(input({
    textEdits: [{ ...(input().textEdits[0] as object), letterSpacing: 0.4 }],
  }));
  assert.notEqual(before, after);
});

test('geometry changes invalidate the build, including a sign flip', () => {
  const edit = input().textEdits[0] as Record<string, unknown>;
  const base = computePdfEditorExportFingerprint(input());

  // The rectangle is what gets redacted, so a shifted box is a different export.
  assert.notEqual(base, computePdfEditorExportFingerprint(input({
    textEdits: [{ ...edit, width: 64.6 }],
  })));
  // -0 and 0 are different placements once a transform is applied to them.
  assert.notEqual(
    computePdfEditorExportFingerprint(input({ textEdits: [{ ...edit, x: 0 }] })),
    computePdfEditorExportFingerprint(input({ textEdits: [{ ...edit, x: -0 }] })),
  );
});

test('edit order is part of the identity', () => {
  const first = { page: 1, text: 'A' };
  const second = { page: 1, text: 'B' };
  // Ids are assigned by position (`text-1`, `text-2`) and the engine applies
  // them in order, so a swap is a different transaction.
  assert.notEqual(
    computePdfEditorExportFingerprint(input({ textEdits: [first, second] })),
    computePdfEditorExportFingerprint(input({ textEdits: [second, first] })),
  );
});

test('a different value of the same shape does not collide', () => {
  const base = input();
  assert.notEqual(
    computePdfEditorExportFingerprint(base),
    computePdfEditorExportFingerprint(input({ pageSize: 'a4' })),
  );
  assert.notEqual(
    computePdfEditorExportFingerprint(base),
    computePdfEditorExportFingerprint(input({ confirmedMode: 'compatibility-render' })),
  );
  assert.notEqual(
    computePdfEditorExportFingerprint(base),
    computePdfEditorExportFingerprint(input({ file: null })),
  );
  // A different document of identical size and name is still a different export.
  assert.notEqual(
    computePdfEditorExportFingerprint(base),
    computePdfEditorExportFingerprint(input({
      file: { name: 'invoice.pdf', size: 12_345, lastModified: 1_700_000_000_001, sessionId: 1 },
    })),
  );
});

test('added canvas objects are part of the identity', () => {
  const base = computePdfEditorExportFingerprint(input());
  const withObject = computePdfEditorExportFingerprint(input({
    canvasPages: [{ page: 2, state: { objects: [{ type: 'textbox', text: 'Note' }] } }],
  }));
  const movedObject = computePdfEditorExportFingerprint(input({
    canvasPages: [{ page: 2, state: { objects: [{ type: 'textbox', text: 'Note', left: 4 }] } }],
  }));

  assert.notEqual(base, withObject);
  assert.notEqual(withObject, movedObject);
});

test('granted consent is part of the identity, so approval cannot be inherited', () => {
  // A build the user approved a specific loss for must not be served for a
  // document they have since changed, and an un-granted build must not be served
  // from a granted one.
  const withoutConsent = computePdfEditorExportFingerprint(input());
  const withConsent = computePdfEditorExportFingerprint(input({
    consent: { acknowledgeFidelityLoss: true, allowNeighbourLossEditIds: [], reasons: [] },
  }));
  const widerConsent = computePdfEditorExportFingerprint(input({
    consent: { acknowledgeFidelityLoss: true, allowNeighbourLossEditIds: ['text-2'], reasons: [] },
  }));

  assert.notEqual(withoutConsent, withConsent);
  assert.notEqual(withConsent, widerConsent);
});

test('scalars of different types never share an encoding', () => {
  const shapes: unknown[] = [1, '1', true, null, undefined, [1], { 0: 1 }];
  const fingerprints = shapes.map((value) => computePdfEditorExportFingerprint(
    input({ textEdits: [{ value } as object] }),
  ));
  assert.equal(new Set(fingerprints).size, shapes.length);
});

test('adjacent strings cannot be confused with each other', () => {
  // Length prefixes: without them, {a:'x', b:'y'} and {a:'xy', b:''} could
  // serialise identically.
  assert.notEqual(
    computePdfEditorExportFingerprint(input({ textEdits: [{ a: 'x', b: 'y' }] })),
    computePdfEditorExportFingerprint(input({ textEdits: [{ a: 'xy', b: '' }] })),
  );
});

test('a value that cannot be encoded losslessly is refused, never approximated', () => {
  // Encoding an unsupported type as `{}` would make two different exports share
  // a fingerprint, which is a wrong file delivered in silence.
  assert.throws(
    () => computePdfEditorExportFingerprint(input({ consent: new Map([['a', 1]]) })),
    PdfEditorExportFingerprintError,
  );
  assert.throws(
    () => computePdfEditorExportFingerprint(input({ consent: new Date(0) })),
    PdfEditorExportFingerprintError,
  );
  assert.throws(
    () => computePdfEditorExportFingerprint(input({ textEdits: [{ onDone: () => {} }] })),
    PdfEditorExportFingerprintError,
  );

  const circular: Record<string, unknown> = {};
  circular.self = circular;
  assert.throws(
    () => computePdfEditorExportFingerprint(input({ consent: circular })),
    PdfEditorExportFingerprintError,
  );
});

test('the same object appearing twice is not mistaken for a cycle', () => {
  const shared = { text: 'Repeated' };
  assert.doesNotThrow(() => computePdfEditorExportFingerprint(
    input({ textEdits: [shared, shared] }),
  ));
});

test('the cache evicts the oldest entry and keeps the most recently used', () => {
  const cache = createPdfEditorExportBuildCache<string>(2);
  assert.equal(PDF_EDITOR_EXPORT_BUILD_CACHE_CAPACITY, 2);

  cache.set('a', 'A');
  cache.set('b', 'B');
  // Touch 'a' so 'b' becomes the least recently used.
  assert.equal(cache.get('a'), 'A');
  cache.set('c', 'C');

  assert.equal(cache.size, 2);
  assert.equal(cache.get('a'), 'A');
  assert.equal(cache.get('c'), 'C');
  assert.equal(cache.get('b'), undefined);
});

test('a cached build can be dropped, and the cache cleared', () => {
  const cache = createPdfEditorExportBuildCache<string>();
  cache.set('a', 'A');
  cache.delete('a');
  assert.equal(cache.get('a'), undefined);

  cache.set('b', 'B');
  cache.clear();
  assert.equal(cache.size, 0);
  assert.equal(cache.get('b'), undefined);
});

test('a capacity below one still stores the current build', () => {
  const cache = createPdfEditorExportBuildCache<string>(0);
  cache.set('a', 'A');
  assert.equal(cache.get('a'), 'A');
});

test('identical file metadata cannot reuse a build from a different open session', () => {
  const first = input();
  const second = input({ file: { ...first.file!, sessionId: 2 } });
  assert.notEqual(computePdfEditorExportFingerprint(first), computePdfEditorExportFingerprint(second));
});

test('overlapping preview and download builds share successful work', async () => {
  const cache = createPdfEditorExportBuildCache<Promise<{ ok: boolean; bytes: Uint8Array }>>();
  let calls = 0;
  const result = { ok: true, bytes: new Uint8Array([1, 2, 3]) };
  const build = async () => { calls += 1; return result; };
  const [preview, download] = await Promise.all([
    getOrBuildPdfEditorExport(cache, 'revision', build),
    getOrBuildPdfEditorExport(cache, 'revision', build),
  ]);
  assert.equal(calls, 1);
  assert.equal(preview, download);
  assert.equal(await getOrBuildPdfEditorExport(cache, 'revision', build), result);
  assert.equal(calls, 1);
});

test('an unchanged failed build can be retried after the service recovers', async () => {
  const cache = createPdfEditorExportBuildCache<Promise<{ ok: boolean }>>();
  let calls = 0;
  const build = async () => ({ ok: ++calls > 1 });
  assert.equal((await getOrBuildPdfEditorExport(cache, 'revision', build)).ok, false);
  assert.equal(cache.size, 0);
  assert.equal((await getOrBuildPdfEditorExport(cache, 'revision', build)).ok, true);
  assert.equal(calls, 2);
});

test('a thrown build is evicted without deleting a replacement cache entry', async () => {
  const cache = createPdfEditorExportBuildCache<Promise<{ ok: boolean }>>();
  await assert.rejects(getOrBuildPdfEditorExport(cache, 'revision', async () => { throw new Error('offline'); }));
  assert.equal(cache.size, 0);
  const replacement = Promise.resolve({ ok: true });
  await getOrBuildPdfEditorExport(cache, 'revision', async () => {
    cache.set('revision', replacement);
    return { ok: false };
  });
  assert.equal(cache.get('revision'), replacement);
});
