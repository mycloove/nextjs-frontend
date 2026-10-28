import assert from 'node:assert/strict';
import test from 'node:test';
import { createPdfEditorProcessingConsent } from './editorProcessingConsent.ts';

test('processing is opt-in and a grant belongs to one open session, not a filename', () => {
  const consent = createPdfEditorProcessingConsent();
  consent.reset(1);
  assert.equal(consent.isAllowed(1), false);
  const request = consent.request(1, 'same.pdf', 'export')!;
  assert.equal(consent.isAllowed(1), false);
  assert.equal(consent.approve(request, 1), true);
  assert.equal(consent.isAllowed(1), true);
  assert.equal(consent.isAllowed(2), false);
  consent.reset(2);
  assert.equal(consent.isAllowed(2), false);
  assert.equal(consent.approve(request, 2), false);
});

test('cancelled, superseded, forged and stale dialogs cannot grant processing', () => {
  const consent = createPdfEditorProcessingConsent();
  consent.reset(4);
  const cancelled = consent.request(4, 'one.pdf', 'ocr')!;
  assert.equal(consent.cancel(cancelled), true);
  assert.equal(consent.approve(cancelled, 4), false);
  const old = consent.request(4, 'one.pdf', 'export')!;
  const current = consent.request(4, 'one.pdf', 'preview')!;
  assert.equal(consent.approve(old, 4), false);
  assert.equal(consent.approve({ ...current }, 4), false);
  assert.equal(consent.cancel(old), false);
  assert.equal(consent.approve(current, 4), true);
  consent.reset(5);
  assert.equal(consent.request(4, 'one.pdf', 'export'), null);
  assert.equal(consent.isAllowed(5), false);
});

test('privacy request contains no export-impact or destructive loss approval', () => {
  const consent = createPdfEditorProcessingConsent();
  consent.reset(1);
  const request = consent.request(1, 'signed.pdf', 'export')!;
  assert.deepEqual(Object.keys(request).sort(), ['fileName', 'purpose', 'sequence', 'session']);
  assert.equal(consent.approve(request, 1), true);
  assert.equal('acknowledgeFidelityLoss' in request, false);
  assert.equal('allowNeighbourLoss' in request, false);
  assert.equal('redactionApproved' in request, false);
});
