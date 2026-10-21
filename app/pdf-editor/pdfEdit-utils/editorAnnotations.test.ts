import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createPdfEditorAnnotation,
  createPdfEditorTextAnnotation,
  describePdfEditorAnnotationImpact,
  mapPdfEditorAnnotationsToOutput,
  normalizePdfEditorAnnotations,
  pdfEditorAnnotationBlockKey,
  pdfEditorAnnotationReplies,
  pdfEditorAnnotationSubtype,
  pruneOrphanPdfEditorAnnotations,
  removePdfEditorAnnotation,
  togglePdfEditorTextAnnotation,
  updatePdfEditorAnnotation,
  type PdfEditorAnnotation,
} from './editorAnnotations.ts';

const annotation = (overrides: Partial<PdfEditorAnnotation> = {}): PdfEditorAnnotation => ({
  id: 'a1',
  kind: 'highlight',
  page: 1,
  x: 10,
  y: 20,
  width: 80,
  height: 12,
  color: '#ffe14d',
  author: 'Reviewer',
  contents: '',
  createdAt: '2026-01-01T00:00:00.000Z',
  ...overrides,
});

test('a text run is converted from rendered pixels to points exactly once', () => {
  const result = createPdfEditorTextAnnotation({
    kind: 'underline',
    zoom: 2,
    source: { page: 1, index: 4, x: 200, y: 60, width: 160, height: 24 },
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(
    { x: result.annotation.x, y: result.annotation.y, width: result.annotation.width, height: result.annotation.height },
    { x: 100, y: 30, width: 80, height: 12 },
  );
  assert.equal(result.annotation.blockKey, pdfEditorAnnotationBlockKey(1, 4));
  assert.equal(result.annotation.color, '#c44735');
});

test('an invalid zoom is refused rather than treated as 1', () => {
  const result = createPdfEditorTextAnnotation({
    kind: 'highlight',
    zoom: 0,
    source: { page: 1, index: 0, x: 1, y: 1, width: 10, height: 10 },
  });
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.reason, 'invalid-zoom');
});

test('a note needs contents and a link needs a usable address', () => {
  const note = createPdfEditorAnnotation({
    kind: 'note',
    page: 1,
    geometry: { x: 10, y: 10, width: 24, height: 24 },
    contents: '   ',
  });
  assert.equal(note.ok, false);
  if (!note.ok) assert.equal(note.reason, 'missing-contents');

  const link = createPdfEditorAnnotation({
    kind: 'link',
    page: 1,
    geometry: { x: 10, y: 10, width: 100, height: 16 },
    uri: 'javascript:alert(1)',
  });
  assert.equal(link.ok, false);
  if (!link.ok) assert.equal(link.reason, 'invalid-uri');

  const valid = createPdfEditorAnnotation({
    kind: 'link',
    page: 1,
    geometry: { x: 10, y: 10, width: 100, height: 16 },
    uri: 'https://example.com/report',
  });
  assert.equal(valid.ok, true);
  if (valid.ok) assert.equal(valid.annotation.uri, 'https://example.com/report');
});

test('a reply must point at another annotation and carry text', () => {
  const orphan = createPdfEditorAnnotation({
    kind: 'reply',
    page: 1,
    geometry: { x: 10, y: 10, width: 20, height: 20 },
    contents: 'Agreed.',
  });
  assert.equal(orphan.ok, false);
  if (!orphan.ok) assert.equal(orphan.reason, 'invalid-reply');

  const reply = createPdfEditorAnnotation({
    kind: 'reply',
    page: 1,
    geometry: { x: 10, y: 10, width: 20, height: 20 },
    contents: 'Agreed.',
    replyTo: 'a1',
  });
  assert.equal(reply.ok, true);
  if (reply.ok) assert.equal(reply.annotation.replyTo, 'a1');
});

test('toggling a markup annotation removes the same run, not a different one', () => {
  const first = annotation({ id: 'h1', blockKey: '1:2', kind: 'highlight' });
  const other = annotation({ id: 'h2', blockKey: '1:3', kind: 'highlight' });
  const added = togglePdfEditorTextAnnotation([other], first);
  assert.equal(added.action, 'added');
  assert.equal(added.annotations.length, 2);

  const removed = togglePdfEditorTextAnnotation(added.annotations, first);
  assert.equal(removed.action, 'removed');
  assert.deepEqual(removed.annotations.map(item => item.id), ['h2']);
});

test('removing an annotation removes its replies', () => {
  const parent = annotation({ id: 'p' });
  const child = annotation({ id: 'c', kind: 'reply', replyTo: 'p', contents: 'ok' });
  const grandchild = annotation({ id: 'g', kind: 'reply', replyTo: 'c', contents: 'ok' });
  const sibling = annotation({ id: 's' });
  const remaining = removePdfEditorAnnotation([parent, child, grandchild, sibling], 'p');
  assert.deepEqual(remaining.map(item => item.id), ['s']);
  assert.deepEqual(pdfEditorAnnotationReplies([parent, child, sibling], 'p').map(item => item.id), ['c']);
});

test('editing only touches reviewer-owned fields', () => {
  const list = [annotation({ id: 'a1' })];
  const updated = updatePdfEditorAnnotation(list, 'a1', {
    contents: 'Please verify the total.',
    color: '#123456',
    stamp: 'Draft',
  });
  assert.equal(updated[0].contents, 'Please verify the total.');
  assert.equal(updated[0].color, '#123456');
  // A highlight is not a stamp; the stamp change must be ignored.
  assert.equal(updated[0].stamp, undefined);
  assert.equal(updated[0].page, 1);
  assert.equal(updated[0].x, 10);
});

test('output page mapping follows duplicates and drops deleted pages', () => {
  const entries = [
    { sourcePage: 2 },
    { sourcePage: 1 },
    { sourcePage: 2 },
  ];
  const mapped = mapPdfEditorAnnotationsToOutput(
    [annotation({ id: 'p2', page: 2 }), annotation({ id: 'p3', page: 3 })],
    entries,
  );
  assert.deepEqual(
    mapped.map(item => `${item.id}@${item.page}`),
    ['p2@1', 'p2#2@3'],
  );
});

test('a reply follows its parent onto every duplicated page occurrence', () => {
  const entries = [
    { sourcePage: 2 },
    { sourcePage: 1 },
    { sourcePage: 2 },
  ];
  const parent = annotation({ id: 'p', page: 2, kind: 'note', contents: 'Check.' });
  const reply = annotation({ id: 'c', page: 2, kind: 'reply', contents: 'Agreed.', replyTo: 'p' });
  const mapped = mapPdfEditorAnnotationsToOutput([parent, reply], entries);
  assert.deepEqual(
    mapped.map(item => `${item.id}@${item.page}<-${item.replyTo ?? ''}`),
    ['p@1<-', 'c@1<-p', 'p#2@3<-', 'c#2@3<-p#2'],
  );
});

test('subtypes match the PDF names viewers expect', () => {
  assert.equal(pdfEditorAnnotationSubtype('highlight'), 'Highlight');
  assert.equal(pdfEditorAnnotationSubtype('strikeout'), 'StrikeOut');
  assert.equal(pdfEditorAnnotationSubtype('note'), 'Text');
  assert.equal(pdfEditorAnnotationSubtype('reply'), 'Text');
  assert.equal(pdfEditorAnnotationSubtype('stamp'), 'Stamp');
});

test('impact text counts annotations and names their pages', () => {
  const impact = describePdfEditorAnnotationImpact([
    annotation({ id: 'a', page: 1 }),
    annotation({ id: 'b', page: 3, kind: 'note', contents: 'x' }),
  ]);
  assert.equal(impact.count, 2);
  assert.deepEqual(impact.pages, [1, 3]);
  assert.match(impact.summary, /2 annotations/);
});

test('draft recovery drops malformed records and orphan replies individually', () => {
  const normalized = normalizePdfEditorAnnotations([
    annotation({ id: 'good' }),
    { id: 'bad', kind: 'highlight', page: 1, x: 1, y: 1, width: 0, height: 10 },
    annotation({ id: 'reply', kind: 'reply', replyTo: 'missing', contents: 'x' }),
    'not an object',
  ]);
  assert.deepEqual(normalized.map(item => item.id), ['good']);
  assert.deepEqual(
    pruneOrphanPdfEditorAnnotations([annotation({ id: 'reply', kind: 'reply', replyTo: 'missing', contents: 'x' })]),
    [],
  );
});
