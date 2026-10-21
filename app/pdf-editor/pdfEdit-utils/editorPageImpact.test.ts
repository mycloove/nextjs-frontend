import assert from 'node:assert/strict';
import test from 'node:test';

import {
  applyPdfEditorPageOperation,
  createPdfEditorPagePlan,
  getPdfEditorPagePlanImpact,
} from './editorPageModel.ts';
import type { PdfEditorPagePlan } from './editorPageModel.ts';
import { decidePdfEditorPageExportStrategy } from './editorPageExport.ts';
import type { PdfDocumentPreflight } from './editorPreflight.ts';
import {
  buildPdfEditorPageExportImpact,
  describePdfEditorPageChanges,
  getPdfEditorPagePlanSignature,
  isApprovedPdfEditorPageExport,
} from './editorPageImpact.ts';

type PreflightFeatures = PdfDocumentPreflight['features'];

/** Clean, fully-scanned document. Individual tests turn on only what they assert. */
function preflight(
  overrides: Partial<PreflightFeatures> = {},
  status: PdfDocumentPreflight['status'] = 'complete',
): PdfDocumentPreflight {
  return {
    status,
    scannedAt: 0,
    pageCount: 3,
    warnings: [],
    features: {
      encryption: { present: false, restricted: false },
      digitalSignatures: { present: false, count: 0 },
      forms: { present: false, fieldCount: 0, signatureFieldCount: 0 },
      annotations: { present: false, count: 0 },
      links: { present: false, count: 0 },
      outline: { present: false, itemCount: 0 },
      attachments: { present: false, count: 0 },
      taggedContent: { present: false },
      metadata: { present: false },
      javascript: { present: false },
      rotatedPages: { present: false, count: 0 },
      ...overrides,
    },
  };
}

function planFrom(sourcePageCount: number): PdfEditorPagePlan {
  const created = createPdfEditorPagePlan(sourcePageCount);
  assert.equal(created.ok, true);
  if (!created.ok) throw new Error('plan setup failed');
  return created.plan;
}

function apply(
  plan: PdfEditorPagePlan,
  operation: Parameters<typeof applyPdfEditorPageOperation>[1],
): PdfEditorPagePlan {
  const result = applyPdfEditorPageOperation(plan, operation);
  assert.equal(result.ok, true);
  if (!result.ok) throw new Error('operation setup failed');
  return result.plan;
}

function impactFor(plan: PdfEditorPagePlan, report: PdfDocumentPreflight | null) {
  return buildPdfEditorPageExportImpact(
    plan,
    getPdfEditorPagePlanImpact(plan),
    decidePdfEditorPageExportStrategy(plan),
    report,
  );
}

const ids = (impact: { consequences: { id: string }[] }) =>
  impact.consequences.map((item) => item.id);

test('untouched plan promises exact preservation and never asks for confirmation', () => {
  const impact = impactFor(planFrom(3), preflight());

  assert.equal(impact.strategy, 'byte-preserving');
  assert.equal(impact.severity, 'none');
  assert.equal(impact.requiresConfirmation, false);
  assert.deepEqual(impact.consequences, []);
  assert.ok(impact.pageChanges.includes('Pages are unchanged.'));
  assert.ok(impact.pageChanges.some((line) => line.includes('will have 3 pages')));
});

test('byte-preserving export raises no scan warning even when the document was never inspected', () => {
  // Copying the source bytes cannot lose anything, so an unknown feature set is
  // irrelevant here. Warning anyway would train users to ignore warnings.
  const impact = impactFor(planFrom(2), null);

  assert.equal(impact.strategy, 'byte-preserving');
  assert.deepEqual(impact.scanWarnings, []);
  assert.equal(impact.requiresConfirmation, false);
});

test('rotation on a plain document is lossless, so it exports without a prompt', () => {
  const plan = apply(planFrom(3), { type: 'rotate', pages: [1], delta: 90 });
  const impact = impactFor(plan, preflight());

  assert.equal(impact.strategy, 'rotation-in-place');
  assert.equal(impact.severity, 'none');
  assert.equal(impact.requiresConfirmation, false);
  assert.deepEqual(impact.consequences, []);
  assert.ok(impact.preservationNotes.some((note) => note.includes('Form fields')));
  assert.ok(impact.pageChanges.some((line) => line.includes('will be rotated')));
});

test('rotation of a signed document escalates to a critical confirmation', () => {
  const plan = apply(planFrom(3), { type: 'rotate', pages: [2], delta: 180 });
  const impact = impactFor(plan, preflight({ digitalSignatures: { present: true, count: 1 } }));

  assert.equal(impact.severity, 'critical');
  assert.equal(impact.requiresConfirmation, true);
  assert.deepEqual(ids(impact), ['page-rotate-signatures']);
  assert.ok(impact.consequences[0].title.includes('will become invalid'));
});

test('reordering pages requires confirmation even when nothing else is at stake', () => {
  const plan = apply(planFrom(3), { type: 'move', from: 1, to: 3 });
  const impact = impactFor(plan, preflight());

  assert.equal(impact.strategy, 'page-rebuild');
  assert.equal(impact.severity, 'warning');
  assert.equal(impact.requiresConfirmation, true);
  assert.deepEqual(ids(impact), []);
  assert.ok(impact.pageChanges.includes('Pages will be saved in a new order.'));
  assert.equal(impact.confirmLabel, 'Export rebuilt PDF');
});

test('page removal is critical on its own and names the pages that will be lost', () => {
  const plan = apply(planFrom(3), { type: 'delete', pages: [2] });
  const impact = impactFor(plan, preflight());

  assert.equal(impact.severity, 'critical');
  assert.equal(impact.requiresConfirmation, true);
  assert.equal(ids(impact)[0], 'page-removal');
  assert.ok(impact.consequences[0].detail.includes('Removed source page: 2'));
  assert.ok(impact.consequences[0].detail.includes('original file on your device is not modified'));
  assert.equal(impact.confirmLabel, 'Export without removed pages');
  assert.ok(impact.pageChanges.some((line) => line.includes('will have 2 pages')));
});

test('rebuild discloses every interactive feature the scan actually found', () => {
  const plan = apply(planFrom(3), { type: 'move', from: 3, to: 1 });
  const impact = impactFor(
    plan,
    preflight({
      forms: { present: true, fieldCount: 4, signatureFieldCount: 0 },
      links: { present: true, count: 2 },
      outline: { present: true, itemCount: 7 },
      attachments: { present: true, count: 1 },
      taggedContent: { present: true },
      javascript: { present: true },
    }),
  );

  assert.deepEqual(ids(impact), [
    'page-rebuild-tags',
    'page-rebuild-forms',
    'page-rebuild-annotations',
    'page-rebuild-outline',
    'page-rebuild-attachments',
    'page-rebuild-javascript',
  ]);
  // Counts come from the scan, so the warning is specific instead of hand-wavy.
  assert.ok(impact.consequences[1].detail.includes('4 detected form fields'));
  assert.ok(impact.consequences[3].detail.includes('7 detected outline items'));
  assert.equal(impact.severity, 'critical'); // accessibility tags are unrecoverable
});

test('a complete scan that found nothing is allowed to stay silent about features', () => {
  const plan = apply(planFrom(3), { type: 'duplicate', pages: [1] });
  const impact = impactFor(plan, preflight());

  assert.deepEqual(ids(impact), []);
  assert.deepEqual(impact.scanWarnings, []);
  assert.ok(impact.pageChanges.some((line) => line.includes('will appear more than once')));
});

test('an uninspected document reports consequences as possible, never as absent', () => {
  const plan = apply(planFrom(3), { type: 'delete', pages: [3] });
  const impact = impactFor(plan, null);

  // Absence was never proven, so every preservation risk must still be surfaced.
  assert.deepEqual(ids(impact), [
    'page-removal',
    'page-rebuild-signatures',
    'page-rebuild-encryption',
    'page-rebuild-tags',
    'page-rebuild-forms',
    'page-rebuild-annotations',
    'page-rebuild-outline',
    'page-rebuild-attachments',
  ]);
  assert.ok(impact.consequences[1].title.includes('may become invalid'));
  assert.equal(impact.scanWarnings.length, 1);
  assert.ok(impact.scanWarnings[0].includes('not inspected'));
});

test('a partial scan is disclosed and downgrades certainty to "may"', () => {
  const plan = apply(planFrom(3), { type: 'move', from: 2, to: 1 });
  const impact = impactFor(plan, preflight({}, 'partial'));

  assert.ok(impact.consequences.some((item) => item.title.includes('may be removed')));
  assert.equal(impact.scanWarnings.length, 1);
  assert.ok(impact.scanWarnings[0].includes('partly inspected'));
});

test('a confirmed feature is stated as certain, not as a possibility', () => {
  const plan = apply(planFrom(3), { type: 'move', from: 2, to: 1 });
  const impact = impactFor(plan, preflight({ outline: { present: true, itemCount: 3 } }));

  const outline = impact.consequences.find((item) => item.id === 'page-rebuild-outline');
  assert.ok(outline);
  assert.ok(outline.title.includes('will be removed'));
});

test('approval is bound to the exact plan that was shown to the user', () => {
  const reordered = apply(planFrom(3), { type: 'move', from: 1, to: 3 });
  const shown = impactFor(reordered, preflight());
  assert.equal(isApprovedPdfEditorPageExport(shown.approvalToken, shown), true);

  // Deleting a page after approving a reorder must invalidate that approval.
  const alsoDeleted = apply(reordered, { type: 'delete', pages: [1] });
  const escalated = impactFor(alsoDeleted, preflight());

  assert.notEqual(escalated.approvalToken, shown.approvalToken);
  assert.equal(isApprovedPdfEditorPageExport(shown.approvalToken, escalated), false);
  assert.equal(isApprovedPdfEditorPageExport(undefined, escalated), false);
});

test('rotation changes invalidate a previous approval as well', () => {
  const rotated = apply(planFrom(3), { type: 'rotate', pages: [1], delta: 90 });
  const signed = preflight({ digitalSignatures: { present: true, count: 1 } });
  const first = impactFor(rotated, signed);

  const rotatedAgain = apply(rotated, { type: 'rotate', pages: [2], delta: 90 });
  const second = impactFor(rotatedAgain, signed);

  assert.notEqual(first.approvalToken, second.approvalToken);
  assert.equal(isApprovedPdfEditorPageExport(first.approvalToken, second), false);
});

test('exports that need no confirmation are approved without a token', () => {
  const impact = impactFor(planFrom(3), preflight());
  assert.equal(isApprovedPdfEditorPageExport(undefined, impact), true);
});

test('plan signature captures order and rotation, so it detects either change', () => {
  const base = planFrom(3);
  const moved = apply(base, { type: 'move', from: 1, to: 2 });
  const turned = apply(base, { type: 'rotate', pages: [1], delta: 90 });

  assert.equal(getPdfEditorPagePlanSignature(base), getPdfEditorPagePlanSignature(planFrom(3)));
  assert.notEqual(getPdfEditorPagePlanSignature(base), getPdfEditorPagePlanSignature(moved));
  assert.notEqual(getPdfEditorPagePlanSignature(base), getPdfEditorPagePlanSignature(turned));
});

test('page change descriptions are singular and plural correct', () => {
  const single = apply(planFrom(4), { type: 'delete', pages: [2] });
  const many = apply(planFrom(4), { type: 'delete', pages: [1, 2, 3] });

  assert.ok(
    describePdfEditorPageChanges(getPdfEditorPagePlanImpact(single))
      .some((line) => line.startsWith('1 page will be removed: 2.')),
  );
  assert.ok(
    describePdfEditorPageChanges(getPdfEditorPagePlanImpact(many))
      .some((line) => line.includes('3 pages will be removed: 1, 2 and 3.')),
  );
});
