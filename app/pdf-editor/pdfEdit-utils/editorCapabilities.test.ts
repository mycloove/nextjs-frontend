import assert from 'node:assert/strict';
import test from 'node:test';
import { pdfEditorAnnotationBlocker, supportedOriginalTextStyle } from './editorCapabilities.ts';

test('original text only accepts size, color and alignment, without pretending to change styles', () => {
  assert.deepEqual(supportedOriginalTextStyle({
    fontFamily: 'Courier', bold: false, italic: true, underline: true,
    heading: 'h1', bgColor: '#ff0000', lineHeight: 2,
    fontSize: 18, color: '#ff0000', align: 'center',
  }), { fontSize: 18, color: '#ff0000', align: 'center' });
  assert.deepEqual(supportedOriginalTextStyle({ bold: true }), {});
  assert.deepEqual(supportedOriginalTextStyle({ fontSize: NaN }), {});
});

test('annotations require inspected original-size unrotated source and every output instance', () => {
  const page = { page: 1, pageSize: 'original', sourceRotation: 0, entries: [{ sourcePage: 1, rotation: 0 }] };
  assert.equal(pdfEditorAnnotationBlocker(page), null);
  assert.match(pdfEditorAnnotationBlocker({ ...page, pageSize: 'a4' })!, /Original/);
  assert.match(pdfEditorAnnotationBlocker({ ...page, sourceRotation: undefined })!, /not been inspected/);
  assert.match(pdfEditorAnnotationBlocker({ ...page, sourceRotation: 90 })!, /rotated/);
  assert.match(pdfEditorAnnotationBlocker({ ...page, entries: [...page.entries, { sourcePage: 1, rotation: 90 }] })!, /rotated/);
  assert.equal(pdfEditorAnnotationBlocker({ ...page, entries: [...page.entries, { sourcePage: 2, rotation: 90 }] }), null);
});
