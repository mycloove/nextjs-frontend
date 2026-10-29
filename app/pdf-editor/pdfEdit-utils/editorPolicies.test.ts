import assert from 'node:assert/strict';
import test from 'node:test';

import {
  appendBoundedDocumentHistory,
  createDocumentHistory,
} from './editorHistory.ts';
import {
  getDraftStorageKey,
  parsePdfEditorDraft,
  savePdfEditorDraft,
  type PdfEditorDraftV2,
} from './editorPersistence.ts';
import {
  isDeleteShortcut,
  isEditableShortcutTarget,
  resolvePdfEditorShortcut,
} from './editorShortcuts.ts';
import {
  classifyPdfLoadFailure,
  hasPdfSignature,
  validatePdfFileMetadata,
  validatePdfPageCount,
} from './editorIntake.ts';

const createDraft = (): PdfEditorDraftV2 => ({
  version: 2,
  documentId: 'sha256-document',
  fileName: 'contract.pdf',
  fileSize: 1024,
  fileLastModified: 10,
  savedAt: 20,
  pageSize: 'a4',
  textEdits: {},
  canvasStates: {},
});

test('document history coalesces related edits and drops the redo branch', () => {
  const initial = createDocumentHistory('initial', 1_000);
  const typedOnce = appendBoundedDocumentHistory(initial.entries, initial.index, 'typed-a', {
    coalesceKey: 'text:1:4',
    recordedAt: 1_100,
  });
  const typedAgain = appendBoundedDocumentHistory(typedOnce.entries, typedOnce.index, 'typed-ab', {
    coalesceKey: 'text:1:4',
    recordedAt: 1_200,
  });

  assert.deepEqual(typedAgain.entries.map(entry => entry.snapshot), ['initial', 'typed-ab']);

  const laterEdit = appendBoundedDocumentHistory(typedAgain.entries, typedAgain.index, 'shape-added', {
    recordedAt: 2_000,
  });
  const forked = appendBoundedDocumentHistory(laterEdit.entries, 1, 'replacement-edit', {
    recordedAt: 2_100,
  });

  assert.deepEqual(forked.entries.map(entry => entry.snapshot), [
    'initial',
    'typed-ab',
    'replacement-edit',
  ]);
  assert.equal(forked.index, 2);
});

test('document history enforces entry and memory bounds while retaining undo depth', () => {
  let history = createDocumentHistory('0000', 1_000);
  for (let index = 1; index <= 5; index += 1) {
    history = appendBoundedDocumentHistory(history.entries, history.index, `${index}`.repeat(4), {
      maxEntries: 3,
      maxBytes: 17,
      recordedAt: 1_000 + index,
    });
  }

  assert.equal(history.entries.length, 2);
  assert.deepEqual(history.entries.map(entry => entry.snapshot), ['4444', '5555']);
  assert.equal(history.bytes, 16);
});

test('draft parser normalizes legacy text values and rejects invalid envelopes', () => {
  const parsed = parsePdfEditorDraft(JSON.stringify({
    ...createDraft(),
    pageSize: 'unsupported',
    textEdits: {
      '1:0': 'Legacy text',
      invalid: { fontSize: 20 },
    },
    canvasStates: {
      1: { objects: [] },
      invalid: 'not-an-object',
    },
  }));

  assert.ok(parsed);
  assert.equal(parsed.pageSize, 'original');
  assert.equal(parsed.textEdits['1:0'].text, 'Legacy text');
  assert.equal(parsed.textEdits.invalid, undefined);
  assert.deepEqual(parsed.canvasStates['1'], { objects: [] });
  assert.equal(parsed.canvasStates.invalid, undefined);
  assert.equal(parsePdfEditorDraft('{broken-json'), null);
  assert.equal(parsePdfEditorDraft(JSON.stringify({ version: 1 })), null);
});

test('draft v3 keeps annotations and drops malformed ones individually', () => {
  const parsed = parsePdfEditorDraft(JSON.stringify({
    ...createDraft(),
    version: 3,
    annotations: [
      {
        id: 'keep',
        kind: 'highlight',
        page: 1,
        x: 10,
        y: 12,
        width: 80,
        height: 14,
        color: '#FFE14D',
        author: 'Reviewer',
        contents: '',
        createdAt: '2026-01-01T00:00:00.000Z',
      },
      // Invalid page — dropped.
      { id: 'bad-page', kind: 'highlight', page: 0, x: 1, y: 1, width: 10, height: 10 },
      // A note with no text is refused by the annotation contract.
      {
        id: 'empty-note',
        kind: 'note',
        page: 1,
        x: 1,
        y: 1,
        width: 20,
        height: 20,
        contents: '  ',
      },
    ],
  }));
  assert.ok(parsed);
  assert.deepEqual(parsed.annotations?.map(annotation => annotation.id), ['keep']);
  assert.equal(parsed.annotations?.[0].color, '#ffe14d');
  assert.equal(parsed.version, 3);
});

test('draft v2 upgrades to v3 and a stored page plan survives the round trip', () => {
  const upgraded = parsePdfEditorDraft(JSON.stringify(createDraft()));
  assert.ok(upgraded);
  assert.equal(upgraded.version, 3);
  assert.equal(upgraded.pagePlan, undefined);

  const withPlan = parsePdfEditorDraft(JSON.stringify({
    ...createDraft(),
    version: 3,
    pagePlan: {
      sourcePageCount: 3,
      entries: [
        { sourcePage: 2, rotation: 90 },
        { sourcePage: 1, rotation: 0 },
        { sourcePage: 2, rotation: 0 },
      ],
    },
  }));
  assert.ok(withPlan);
  assert.deepEqual(withPlan.pagePlan, {
    sourcePageCount: 3,
    entries: [
      { sourcePage: 2, rotation: 90 },
      { sourcePage: 1, rotation: 0 },
      { sourcePage: 2, rotation: 0 },
    ],
  });

  // A malformed plan is dropped, but the rest of the draft is not thrown away.
  const malformed = parsePdfEditorDraft(JSON.stringify({
    ...createDraft(),
    version: 3,
    pagePlan: { sourcePageCount: 2, entries: [{ sourcePage: 'two', rotation: 0 }] },
  }));
  assert.ok(malformed);
  assert.equal(malformed.pagePlan, undefined);
});

test('local draft fallback reports successful writes and storage quota failures', () => {
  const values = new Map<string, string>();
  const storage = {
    setItem: (key: string, value: string) => values.set(key, value),
  } as unknown as Storage;
  const draft = createDraft();

  assert.deepEqual(savePdfEditorDraft(storage, draft), { ok: true, savedAt: draft.savedAt });
  assert.equal(values.has(getDraftStorageKey(draft.documentId)), true);

  const fullStorage = {
    setItem: () => {
      throw new DOMException('Storage is full', 'QuotaExceededError');
    },
  } as unknown as Storage;
  const result = savePdfEditorDraft(fullStorage, draft);
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.reason, 'quota');
});

test('editor shortcuts preserve native editing behavior', () => {
  assert.equal(isEditableShortcutTarget({ tagName: 'TEXTAREA', isContentEditable: false } as HTMLElement), true);
  assert.equal(isEditableShortcutTarget({ tagName: 'DIV', isContentEditable: true } as HTMLElement), true);
  assert.equal(isEditableShortcutTarget({
    tagName: 'DIV',
    isContentEditable: false,
    closest: (selector: string) => selector.includes('role="textbox"') ? ({} as Element) : null,
  } as HTMLElement), true);
  assert.equal(isEditableShortcutTarget({ tagName: 'BUTTON', isContentEditable: false } as HTMLElement), false);
  assert.equal(isDeleteShortcut({ key: 'Delete', ctrlKey: false, metaKey: false, altKey: false }), true);
  assert.equal(isDeleteShortcut({ key: 'Backspace', ctrlKey: true, metaKey: false, altKey: false }), false);
});

test('PDF intake validates metadata, bytes, and editor page limits', () => {
  assert.equal(validatePdfFileMetadata({ name: 'valid.pdf', size: 1024, type: 'application/pdf' }), null);
  assert.equal(validatePdfFileMetadata({ name: 'empty.pdf', size: 0, type: 'application/pdf' })?.code, 'empty-file');
  assert.equal(validatePdfFileMetadata({ name: 'image.png', size: 1024, type: 'image/png' })?.code, 'not-pdf');
  assert.equal(hasPdfSignature(new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31])), true);
  assert.equal(hasPdfSignature(new Uint8Array([0, 0, 0x25, 0x50, 0x44, 0x46, 0x2d, 0x31])), true);
  assert.equal(hasPdfSignature(new Uint8Array([0x89, 0x50, 0x4e, 0x47])), false);
  assert.equal(validatePdfPageCount(500), null);
  assert.equal(validatePdfPageCount(501)?.code, 'page-limit');
});

test('PDF.js failures map to stable user-facing intake states', () => {
  assert.equal(classifyPdfLoadFailure({ name: 'PasswordException' }).code, 'password-protected');
  assert.equal(classifyPdfLoadFailure({ name: 'InvalidPDFException' }).code, 'invalid-pdf');
  assert.equal(classifyPdfLoadFailure(new Error('worker failed')).code, 'load-failed');
});

test('one shortcut owner prioritizes modals, controls, objects, then pages', () => {
  const event = {
    key: 'ArrowRight', ctrlKey: false, metaKey: false, altKey: false,
    shiftKey: false, defaultPrevented: false, isComposing: false, target: null,
  };
  const context = { modalOpen: false, fabricTextEditing: false, hasObjectSelection: true };
  assert.equal(resolvePdfEditorShortcut(event, context), 'nudge-right');
  assert.equal(resolvePdfEditorShortcut(event, { ...context, hasObjectSelection: false }), 'page-next');
  assert.equal(resolvePdfEditorShortcut(event, { ...context, modalOpen: true }), null);
  assert.equal(resolvePdfEditorShortcut(event, { ...context, fabricTextEditing: true }), null);
  assert.equal(resolvePdfEditorShortcut({ ...event, defaultPrevented: true }, context), null);
  assert.equal(resolvePdfEditorShortcut({ ...event, isComposing: true }, context), null);
  for (const tagName of ['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON', 'A', 'SUMMARY']) {
    assert.equal(resolvePdfEditorShortcut({ ...event, target: { tagName, isContentEditable: false } as HTMLElement }, context), null);
  }
  assert.equal(resolvePdfEditorShortcut({ ...event, target: {
    tagName: 'DIV', isContentEditable: false, closest: () => ({} as Element),
  } as unknown as HTMLElement }, context), null);
});

test('keyboard commands retain platform shortcuts without taking over native text editing', () => {
  const event = {
    key: 'z', ctrlKey: true, metaKey: false, altKey: false,
    shiftKey: false, defaultPrevented: false, isComposing: false, target: null,
  };
  const context = { modalOpen: false, fabricTextEditing: false, hasObjectSelection: false };
  assert.equal(resolvePdfEditorShortcut(event, context), 'undo');
  assert.equal(resolvePdfEditorShortcut({ ...event, shiftKey: true }, context), 'redo');
  assert.equal(resolvePdfEditorShortcut({ ...event, ctrlKey: false, metaKey: true, key: 's' }, context), 'export');
  assert.equal(resolvePdfEditorShortcut({ ...event, key: 'k' }, context), 'commands');
  assert.equal(resolvePdfEditorShortcut({ ...event, ctrlKey: false, key: '?' }, context), 'help');
  assert.equal(resolvePdfEditorShortcut({ ...event, target: { tagName: 'TEXTAREA' } as HTMLElement }, context), null);
  assert.equal(resolvePdfEditorShortcut({ ...event, altKey: true }, context), null);
});

test('modal buttons and checkboxes cannot undo or delete text behind the dialog', () => {
  const context = { modalOpen: true, fabricTextEditing: false, hasObjectSelection: false };
  const event = { key: 'z', ctrlKey: true, metaKey: false, altKey: false, shiftKey: false, defaultPrevented: false, isComposing: false };
  const inModal = { closest: () => ({} as Element), isContentEditable: false };
  assert.equal(resolvePdfEditorShortcut({ ...event, target: { ...inModal, tagName: 'BUTTON' } as unknown as HTMLElement }, context), 'suppress');
  assert.equal(resolvePdfEditorShortcut({ ...event, target: { ...inModal, tagName: 'INPUT', getAttribute: () => 'checkbox' } as unknown as HTMLElement }, context), 'suppress');
  assert.equal(resolvePdfEditorShortcut({ ...event, target: { ...inModal, tagName: 'TEXTAREA' } as unknown as HTMLElement }, context), null);
  assert.equal(resolvePdfEditorShortcut({ ...event, target: { tagName: 'TEXTAREA', closest: () => null } as unknown as HTMLElement }, context), 'suppress');
  assert.equal(resolvePdfEditorShortcut({ ...event, key: 'Backspace', ctrlKey: false, target: null }, context), 'suppress');
});
