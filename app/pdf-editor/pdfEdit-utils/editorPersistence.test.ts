import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createPdfEditorRecoveryQueue, deletePdfEditorRecovery, getDraftStorageKey,
  parsePdfEditorDraft, removePdfEditorRecoveryRecords, savePdfEditorDraftAsync,
  type PdfEditorDraft, type PdfEditorDraftRecord,
} from './editorPersistence.ts';

const draft = (documentId: string, version: 2 | 3 = 3): PdfEditorDraft => ({
  version, documentId, fileName: 'same.pdf', fileSize: 100, fileLastModified: 1,
  savedAt: 2, pageSize: 'original', textEdits: {}, canvasStates: {},
});

for (const latestId of ['a', 'b']) {
  test(`targeted recovery deletion preserves another PDF when latest is ${latestId}`, async () => {
    const drafts = new Map<string, PdfEditorDraftRecord>(['a', 'b', 'latest'].map(key => {
      const value = draft(key === 'latest' ? latestId : key, key === 'b' ? 2 : 3);
      return [key, { key, draft: value, savedAt: value.savedAt }];
    }));
    const sources = new Map([['a', 'source-a'], ['b', 'source-b']]);
    await removePdfEditorRecoveryRecords('a', {
      readLatest: async () => drafts.get('latest'),
      deleteDraft: async key => drafts.delete(key),
      deleteSource: async key => sources.delete(key),
    });
    assert.equal(drafts.has('a'), false);
    assert.equal(sources.has('a'), false);
    assert.deepEqual(drafts.get('b')?.draft, draft('b', 2));
    assert.equal(sources.get('b'), 'source-b');
    assert.equal(drafts.has('latest'), latestId === 'b');
    assert.equal(parsePdfEditorDraft(JSON.stringify(drafts.get('b')?.draft))?.documentId, 'b');
  });
}

test('hash-keyed fallback clear leaves another v2/v3 draft, legacy filename and unrelated state intact', async () => {
  const values = new Map([
    [getDraftStorageKey('a'), JSON.stringify(draft('a'))],
    [getDraftStorageKey('b'), JSON.stringify(draft('b', 2))],
    ['smilepdf:edits:same.pdf', 'legacy'], ['smilepdf-theme', 'dark'],
  ]);
  const storage = { removeItem: (key: string) => values.delete(key) } as unknown as Storage;
  assert.deepEqual(await deletePdfEditorRecovery('a', storage), { ok: true });
  assert.deepEqual([...values.keys()], [getDraftStorageKey('b'), 'smilepdf:edits:same.pdf', 'smilepdf-theme']);
});

test('a clear invalidates queued saves and waits for an already-started write before deletion', async () => {
  const queue = createPdfEditorRecoveryQueue();
  const events: string[] = [];
  let release!: () => void;
  let started!: () => void;
  const waiting = new Promise<void>(resolve => { started = resolve; });
  const held = new Promise<void>(resolve => { release = resolve; });
  const first = queue.save(async owns => {
    started();
    await held;
    events.push('in-flight-write');
    assert.equal(owns(), false, 'late completion may not update UI or run a fallback save');
    return true;
  });
  const staleQueued = queue.save(async () => { events.push('queued-write'); return true; });
  await waiting;
  const clear = queue.clear(async () => { events.push('delete'); });
  assert.equal(queue.isEnabled(), false);
  const later = queue.save(async () => { events.push('resurrected'); return true; });
  release();
  await Promise.all([first, staleQueued, clear, later]);
  assert.deepEqual(events, ['in-flight-write', 'delete']);
});

test('document replacement invalidates delayed opening saves but new-session writes remain ordered after clear', async () => {
  const queue = createPdfEditorRecoveryQueue();
  const events: string[] = [];
  const stale = queue.save(async () => { events.push('old'); return true; });
  const clearing = queue.clear(async () => { events.push('delete-old'); });
  queue.reset();
  const current = queue.save(async owns => { assert.equal(owns(), true); events.push('new'); return true; });
  await Promise.all([stale, clearing, current]);
  assert.deepEqual(events, ['delete-old', 'new']);
});

test('a failed removal stays disabled and an invalidated storage open cannot save', async () => {
  const queue = createPdfEditorRecoveryQueue();
  await assert.rejects(queue.clear(async () => { throw new Error('storage denied'); }), /denied/);
  assert.equal(queue.isEnabled(), false);
  assert.equal(await queue.save(async () => true), false);
  const result = await savePdfEditorDraftAsync(draft('a'), undefined, () => false);
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.reason, 'cancelled');
  const storage = { removeItem: () => { throw new Error('denied'); } } as unknown as Storage;
  const cleared = await deletePdfEditorRecovery('a', storage);
  assert.equal(cleared.ok, false);
  const inaccessible = await deletePdfEditorRecovery('a', () => { throw new Error('localStorage is inaccessible'); });
  assert.equal(inaccessible.ok, false);
});
