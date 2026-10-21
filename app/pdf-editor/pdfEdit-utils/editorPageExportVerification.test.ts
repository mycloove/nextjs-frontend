import assert from 'node:assert/strict';
import test from 'node:test';

import type { PdfVerificationSnapshot } from './editorExportVerification.ts';
import {
  applyPdfEditorPageOperation,
  createPdfEditorPagePlan,
} from './editorPageModel.ts';
import type { PdfEditorPagePlan } from './editorPageModel.ts';
import { decidePdfEditorPageExportStrategy } from './editorPageExport.ts';
import { verifyPdfEditorPagePlanSnapshots } from './editorPageExportVerification.ts';

function snapshot(overrides: Partial<PdfVerificationSnapshot> = {}): PdfVerificationSnapshot {
  return {
    byteLength: 100,
    pageCount: 3,
    pageText: ['Page marker ALPHA', 'Page marker BRAVO', 'Page marker CHARLIE'],
    pageRotations: [0, 0, 90],
    metadata: { Title: 'Page plan contract', Author: 'SmilePDF' },
    formFieldNames: ['customer.name'],
    readers: { pdfjs: true, pdfLib: true },
    preflight: {
      status: 'complete', scannedAt: 1, pageCount: 3, warnings: [],
      features: {
        encryption: { present: false, restricted: false },
        digitalSignatures: { present: false, count: 0 },
        forms: { present: true, fieldCount: 1, signatureFieldCount: 0 },
        annotations: { present: false, count: 0 },
        links: { present: false, count: 0 },
        outline: { present: false, itemCount: 0 },
        attachments: { present: false, count: 0 },
        taggedContent: { present: false },
        metadata: { present: true },
        javascript: { present: false },
        rotatedPages: { present: true, count: 1 },
      },
    },
    ...overrides,
  };
}

function planFrom(sourcePageCount: number): PdfEditorPagePlan {
  const created = createPdfEditorPagePlan(sourcePageCount);
  if (!created.ok) throw new Error('plan setup failed');
  return created.plan;
}

function apply(
  plan: PdfEditorPagePlan,
  operation: Parameters<typeof applyPdfEditorPageOperation>[1],
): PdfEditorPagePlan {
  const result = applyPdfEditorPageOperation(plan, operation);
  if (!result.ok) throw new Error('operation setup failed');
  return result.plan;
}

function verify(plan: PdfEditorPagePlan, output: PdfVerificationSnapshot, bytesEqual?: boolean) {
  return verifyPdfEditorPagePlanSnapshots({
    plan,
    decision: decidePdfEditorPageExportStrategy(plan),
    source: snapshot(),
    output,
    bytesEqual,
  });
}

test('a correctly reordered export passes ordering verification', () => {
  const plan = apply(planFrom(3), { type: 'move', from: 3, to: 1 });
  const result = verify(plan, snapshot({
    pageText: ['Page marker CHARLIE', 'Page marker ALPHA', 'Page marker BRAVO'],
    pageRotations: [90, 0, 0],
  }));

  assert.equal(result.ok, true);
  assert.equal(result.strategy, 'page-rebuild');
  assert.equal(result.failures.length, 0);
});

test('an export that ignores the reorder is rejected even though the PDF is valid', () => {
  const plan = apply(planFrom(3), { type: 'move', from: 3, to: 1 });
  // The exporter silently kept source order; page count and validity look fine.
  const result = verify(plan, snapshot());

  assert.equal(result.ok, false);
  assert.equal(result.failures.some(failure => failure.includes('does not contain source page')), true);
});

test('a dropped page is caught by the planned page-count contract', () => {
  const plan = apply(planFrom(3), { type: 'delete', pages: [2] });
  const result = verify(plan, snapshot({
    pageCount: 1,
    pageText: ['Page marker ALPHA'],
    pageRotations: [0],
  }));

  assert.equal(result.ok, false);
  assert.equal(result.failures.some(failure => failure.includes('Planned 2 pages, found 1')), true);
});

test('duplicated pages must both carry the duplicated source content', () => {
  const plan = apply(planFrom(3), { type: 'duplicate', pages: [1] });
  const result = verify(plan, snapshot({
    pageCount: 4,
    pageText: [
      'Page marker ALPHA',
      'Page marker ALPHA',
      'Page marker BRAVO',
      'Page marker CHARLIE',
    ],
    pageRotations: [0, 0, 0, 90],
  }));

  assert.equal(result.ok, true);
});

test('rotation verification composes the editor delta with the source rotation', () => {
  const plan = apply(planFrom(3), { type: 'rotate', pages: [3], delta: 180 });
  const passing = verify(plan, snapshot({ pageRotations: [0, 0, 270] }));
  assert.equal(passing.ok, true);

  // 180 alone would ignore the source page's existing 90 degrees.
  const failing = verify(plan, snapshot({ pageRotations: [0, 0, 180] }));
  assert.equal(failing.ok, false);
  assert.equal(failing.failures.some(failure => failure.includes('Planned rotations')), true);
});

test('an untouched plan must return the source bytes unchanged', () => {
  const plan = planFrom(3);

  assert.equal(verify(plan, snapshot(), true).ok, true);
  const mutated = verify(plan, snapshot({ byteLength: 180 }), false);
  assert.equal(mutated.ok, false);
  assert.equal(mutated.failures.some(failure => failure.includes('changed the source bytes')), true);
});

test('rotation-only export is still held to form and metadata preservation', () => {
  const plan = apply(planFrom(3), { type: 'rotate', pages: [1], delta: 90 });
  const result = verify(plan, snapshot({
    pageRotations: [90, 0, 90],
    formFieldNames: [],
  }));

  assert.equal(result.strategy, 'rotation-in-place');
  assert.equal(result.ok, false);
  assert.equal(result.failures.some(failure => failure.includes('Form fields were removed')), true);
});

test('a rebuild is not penalised for the structure losses it declared up front', () => {
  const plan = apply(planFrom(3), { type: 'move', from: 3, to: 1 });
  const result = verify(plan, snapshot({
    pageText: ['Page marker CHARLIE', 'Page marker ALPHA', 'Page marker BRAVO'],
    pageRotations: [90, 0, 0],
    formFieldNames: [],
    metadata: {},
  }));

  assert.equal(result.ok, true);
  assert.equal(result.allowedLosses.includes('form fields'), true);
  assert.equal(result.checks.some(check => check.status === 'allowed-loss'), true);
});

test('a plan whose source no longer matches is rejected before positional checks are trusted', () => {
  const plan = apply(planFrom(3), { type: 'move', from: 2, to: 1 });
  const result = verifyPdfEditorPagePlanSnapshots({
    plan,
    decision: decidePdfEditorPageExportStrategy(plan),
    source: snapshot({ pageCount: 4 }),
    output: snapshot({
      pageText: ['Page marker BRAVO', 'Page marker ALPHA', 'Page marker CHARLIE'],
      pageRotations: [0, 0, 90],
    }),
  });

  assert.equal(result.ok, false);
  assert.equal(result.failures.some(failure => failure.includes('Plan targets 3 source pages')), true);
});

test('image-only pages are reported as unverifiable rather than failing ordering', () => {
  const plan = apply(planFrom(3), { type: 'move', from: 3, to: 1 });
  const result = verifyPdfEditorPagePlanSnapshots({
    plan,
    decision: decidePdfEditorPageExportStrategy(plan),
    source: snapshot({ pageText: ['Page marker ALPHA', 'Page marker BRAVO', '   '] }),
    output: snapshot({
      pageText: ['', 'Page marker ALPHA', 'Page marker BRAVO'],
      pageRotations: [90, 0, 0],
    }),
  });

  assert.equal(result.ok, true);
  assert.equal(
    result.checks.some(check => check.id === 'order-1' && check.status === 'allowed-loss'),
    true,
  );
});
