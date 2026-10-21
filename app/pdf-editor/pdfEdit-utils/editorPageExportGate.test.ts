import assert from 'node:assert/strict';
import test from 'node:test';

import {
  applyPdfEditorPageOperation,
  createPdfEditorPagePlan,
  getPdfEditorPagePlanImpact,
} from './editorPageModel.ts';
import type { PdfEditorPagePlan } from './editorPageModel.ts';
import { decidePdfEditorPageExportStrategy } from './editorPageExport.ts';
import type { PdfEditorPageExportDecision } from './editorPageExport.ts';
import type { PdfPagePlanVerification } from './editorPageExportVerification.ts';
import { buildPdfEditorPageExportImpact } from './editorPageImpact.ts';
import type { PdfEditorPageExportImpact } from './editorPageImpact.ts';
import type { PdfDocumentPreflight } from './editorPreflight.ts';
import {
  expectedPdfEditorPageExportApprovalToken,
  exportApprovedPdfEditorPagePlan,
} from './editorPageExportGate.ts';
import type { PdfEditorPageExportGateDeps } from './editorPageExportGate.ts';

const SOURCE = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37]);
const OUTPUT = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37, 0x0a, 0x25]);

/** Clean, fully-scanned document, so consequences come only from the strategy. */
function preflight(
  overrides: Partial<PdfDocumentPreflight['features']> = {},
): PdfDocumentPreflight {
  return {
    status: 'complete',
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

function impactFor(
  plan: PdfEditorPagePlan,
  report: PdfDocumentPreflight | null = preflight(),
): PdfEditorPageExportImpact {
  return buildPdfEditorPageExportImpact(
    plan,
    getPdfEditorPagePlanImpact(plan),
    decidePdfEditorPageExportStrategy(plan),
    report,
  );
}

function passingVerification(decision: PdfEditorPageExportDecision): PdfPagePlanVerification {
  return {
    ok: true,
    strategy: decision.strategy,
    verifiedAt: 1,
    checks: [{ id: 'reopen', status: 'passed', detail: 'Both readers reopened the output.' }],
    failures: [],
    allowedLosses: decision.declaredLosses,
    output: null,
  };
}

function failingVerification(decision: PdfEditorPageExportDecision): PdfPagePlanVerification {
  const detail = 'Output page 1 does not contain source page 3 text.';
  return {
    ok: false,
    strategy: decision.strategy,
    verifiedAt: 1,
    checks: [{ id: 'order-1', status: 'failed', detail }],
    failures: [detail],
    allowedLosses: decision.declaredLosses,
    output: null,
  };
}

/**
 * Recording stubs. Every refusal assertion checks `exportCalls` stayed at zero,
 * because "refused" must mean the bytes were never produced, not that they were
 * produced and then discarded.
 */
function stubs(overrides: Partial<PdfEditorPageExportGateDeps> = {}) {
  const calls = { exportCalls: 0, verifyCalls: 0 };
  const deps: PdfEditorPageExportGateDeps = {
    exportPagePlan: async (input) => {
      calls.exportCalls += 1;
      return { bytes: OUTPUT, decision: decidePdfEditorPageExportStrategy(input.plan) };
    },
    verifyPagePlan: async (options) => {
      calls.verifyCalls += 1;
      return passingVerification(options.decision);
    },
    ...overrides,
  };
  return { calls, deps };
}

test('an untouched plan exports without a token and returns the proven bytes', async () => {
  const plan = planFrom(3);
  const impact = impactFor(plan);
  const { calls, deps } = stubs();

  const result = await exportApprovedPdfEditorPagePlan({
    source: SOURCE,
    plan,
    impact,
    deps,
  });

  assert.equal(impact.requiresConfirmation, false);
  assert.equal(result.outcome, 'exported');
  if (result.outcome !== 'exported') return;
  assert.equal(result.decision.strategy, 'byte-preserving');
  assert.deepEqual(Array.from(result.bytes), Array.from(OUTPUT));
  assert.equal(result.verification.ok, true);
  assert.equal(calls.exportCalls, 1);
  assert.equal(calls.verifyCalls, 1);
});

test('a confirmed rebuild exports and reports the verification record alongside the bytes', async () => {
  const plan = apply(planFrom(3), { type: 'delete', pages: [2] });
  const impact = impactFor(plan);
  const { calls, deps } = stubs();

  const result = await exportApprovedPdfEditorPagePlan({
    source: SOURCE,
    plan,
    impact,
    approvedToken: impact.approvalToken,
    deps,
  });

  assert.equal(impact.requiresConfirmation, true);
  assert.equal(result.outcome, 'exported');
  if (result.outcome !== 'exported') return;
  assert.equal(result.kind, 'exported');
  assert.equal(result.decision.strategy, 'page-rebuild');
  assert.equal(result.verification.allowedLosses.includes('form fields'), true);
  assert.equal(calls.exportCalls, 1);
});

test('an export that needs confirmation and has none is refused before any bytes exist', async () => {
  const plan = apply(planFrom(3), { type: 'move', from: 1, to: 3 });
  const impact = impactFor(plan);
  const { calls, deps } = stubs();

  const result = await exportApprovedPdfEditorPagePlan({
    source: SOURCE,
    plan,
    impact,
    deps,
  });

  assert.equal(result.outcome, 'unapproved');
  if (result.outcome !== 'unapproved') return;
  assert.equal(result.kind, 'refused');
  assert.equal(result.disclosedStrategy, 'page-rebuild');
  assert.match(result.reason, /requires confirmation/);
  // The refusal is the point: nothing was written, so nothing can leak.
  assert.equal(calls.exportCalls, 0);
  assert.equal(calls.verifyCalls, 0);
});

test('a token from a different plan does not authorise this export', async () => {
  const plan = apply(planFrom(3), { type: 'delete', pages: [2] });
  const otherPlan = apply(planFrom(3), { type: 'delete', pages: [3] });
  const impact = impactFor(plan);
  const { calls, deps } = stubs();

  const result = await exportApprovedPdfEditorPagePlan({
    source: SOURCE,
    plan,
    impact,
    approvedToken: impactFor(otherPlan).approvalToken,
    deps,
  });

  assert.equal(result.outcome, 'unapproved');
  assert.equal(calls.exportCalls, 0);
});

test('a disclosure whose strategy no longer matches the plan is refused as stale', async () => {
  // Rotation was disclosed; the plan then had a page deleted, which escalates
  // the export to a rebuild the user never saw described.
  const rotated = apply(planFrom(3), { type: 'rotate', pages: [1], delta: 90 });
  const disclosed = impactFor(rotated, preflight({ digitalSignatures: { present: true, count: 1 } }));
  const escalated = apply(rotated, { type: 'delete', pages: [2] });
  const { calls, deps } = stubs();

  const result = await exportApprovedPdfEditorPagePlan({
    source: SOURCE,
    plan: escalated,
    impact: disclosed,
    approvedToken: disclosed.approvalToken,
    deps,
  });

  assert.equal(result.outcome, 'stale-impact');
  if (result.outcome !== 'stale-impact') return;
  assert.equal(result.kind, 'refused');
  assert.equal(result.cause, 'strategy');
  assert.equal(result.disclosedStrategy, 'rotation-in-place');
  assert.equal(result.currentStrategy, 'page-rebuild');
  assert.equal(calls.exportCalls, 0);
});

test('a same-strategy plan edit is still refused, because the disclosure named other pages', async () => {
  const deletedTwo = apply(planFrom(4), { type: 'delete', pages: [2] });
  const disclosed = impactFor(deletedTwo);
  // Both are rebuilds, so the strategy check alone would let this through.
  const deletedThree = apply(planFrom(4), { type: 'delete', pages: [3] });
  const { calls, deps } = stubs();

  const result = await exportApprovedPdfEditorPagePlan({
    source: SOURCE,
    plan: deletedThree,
    impact: disclosed,
    approvedToken: disclosed.approvalToken,
    deps,
  });

  assert.equal(result.outcome, 'stale-impact');
  if (result.outcome !== 'stale-impact') return;
  assert.equal(result.cause, 'plan');
  assert.equal(result.currentStrategy, 'page-rebuild');
  assert.equal(result.disclosedStrategy, 'page-rebuild');
  assert.equal(calls.exportCalls, 0);
});

test('an unconfirmed export is refused even when the disclosure itself is stale', async () => {
  // Staleness is checked first: re-disclosing is the only correct next step, so
  // reporting "unapproved" here would send the caller to ask for the wrong
  // approval.
  const rotated = apply(planFrom(3), { type: 'rotate', pages: [1], delta: 90 });
  const disclosed = impactFor(rotated);
  const escalated = apply(rotated, { type: 'delete', pages: [2] });
  const { calls, deps } = stubs();

  const result = await exportApprovedPdfEditorPagePlan({
    source: SOURCE,
    plan: escalated,
    impact: disclosed,
    deps,
  });

  assert.equal(result.outcome, 'stale-impact');
  assert.equal(calls.exportCalls, 0);
});

test('the gate binds approval to the same token composition Phase 3C produces', async () => {
  // The gate re-derives the token instead of reading a plan signature off the
  // impact, so this pins the two derivations together.
  const plan = apply(planFrom(3), { type: 'move', from: 3, to: 1 });
  const impact = impactFor(plan);

  assert.equal(
    expectedPdfEditorPageExportApprovalToken(plan, 'page-rebuild'),
    impact.approvalToken,
  );
  assert.notEqual(
    expectedPdfEditorPageExportApprovalToken(plan, 'rotation-in-place'),
    impact.approvalToken,
  );
});

test('an exporter that throws is reported as a failure, not as a refusal', async () => {
  const plan = apply(planFrom(3), { type: 'move', from: 2, to: 1 });
  const impact = impactFor(plan);
  const { calls, deps } = stubs({
    exportPagePlan: async () => {
      calls.exportCalls += 1;
      throw new Error('Page plan targets 3 source pages but the document has 5.');
    },
  });

  const result = await exportApprovedPdfEditorPagePlan({
    source: SOURCE,
    plan,
    impact,
    approvedToken: impact.approvalToken,
    deps,
  });

  assert.equal(result.outcome, 'export-failed');
  if (result.outcome !== 'export-failed') return;
  assert.equal(result.kind, 'failed');
  assert.match(result.reason, /but the document has 5/);
  assert.equal(calls.verifyCalls, 0);
});

test('an exporter that silently switches strategy is rejected instead of trusted', async () => {
  const plan = apply(planFrom(3), { type: 'rotate', pages: [1], delta: 90 });
  const impact = impactFor(plan);
  const { deps } = stubs({
    exportPagePlan: async () => ({
      bytes: OUTPUT,
      decision: {
        strategy: 'page-rebuild',
        preservation: 'page-content-only',
        reason: 'rebuilt anyway',
        declaredLosses: ['form fields'],
      },
    }),
  });

  const result = await exportApprovedPdfEditorPagePlan({
    source: SOURCE,
    plan,
    impact,
    approvedToken: impact.approvalToken,
    deps,
  });

  assert.equal(result.outcome, 'export-failed');
  if (result.outcome !== 'export-failed') return;
  assert.match(result.reason, /produced a page-rebuild export where a rotation-in-place export/);
});

test('bytes that fail verification are withheld entirely', async () => {
  const plan = apply(planFrom(3), { type: 'move', from: 3, to: 1 });
  const impact = impactFor(plan);
  const { deps } = stubs({
    verifyPagePlan: async (options) => failingVerification(options.decision),
  });

  const result = await exportApprovedPdfEditorPagePlan({
    source: SOURCE,
    plan,
    impact,
    approvedToken: impact.approvalToken,
    deps,
  });

  assert.equal(result.outcome, 'verification-failed');
  if (result.outcome !== 'verification-failed') return;
  assert.equal(result.kind, 'failed');
  assert.equal('bytes' in result, false);
  assert.equal(result.withheldByteLength, OUTPUT.byteLength);
  assert.match(result.reason, /does not contain source page 3 text/);
  assert.equal(result.verification.failures.length, 1);
});

test('a verifier that throws withholds the bytes instead of rejecting the promise', async () => {
  const plan = apply(planFrom(3), { type: 'duplicate', pages: [1] });
  const impact = impactFor(plan);
  const { deps } = stubs({
    verifyPagePlan: async () => {
      throw new Error('PDF.js could not reopen the exported PDF.');
    },
  });

  const result = await exportApprovedPdfEditorPagePlan({
    source: SOURCE,
    plan,
    impact,
    approvedToken: impact.approvalToken,
    deps,
  });

  assert.equal(result.outcome, 'verification-failed');
  if (result.outcome !== 'verification-failed') return;
  assert.match(result.reason, /could not reopen/);
  assert.equal(result.verification.ok, false);
});

test('verification is asked to prove the disclosed strategy against the original source', async () => {
  const plan = apply(planFrom(3), { type: 'delete', pages: [3] });
  const impact = impactFor(plan);
  let seen: { strategy: string; sourceBytes: ArrayBuffer | Uint8Array; outputBytes: ArrayBuffer | Uint8Array } | null = null;
  const { deps } = stubs({
    verifyPagePlan: async (options) => {
      seen = {
        strategy: options.decision.strategy,
        sourceBytes: options.sourceBytes,
        outputBytes: options.outputBytes,
      };
      return passingVerification(options.decision);
    },
  });

  const result = await exportApprovedPdfEditorPagePlan({
    source: SOURCE,
    plan,
    impact,
    approvedToken: impact.approvalToken,
    deps,
  });

  assert.equal(result.outcome, 'exported');
  assert.ok(seen);
  const observed = seen as unknown as {
    strategy: string;
    sourceBytes: Uint8Array;
    outputBytes: Uint8Array;
  };
  assert.equal(observed.strategy, 'page-rebuild');
  assert.deepEqual(Array.from(observed.sourceBytes), Array.from(SOURCE));
  assert.deepEqual(Array.from(observed.outputBytes), Array.from(OUTPUT));
});

test('a signed document cannot be rotated out without confirmation', async () => {
  // Rotation is normally frictionless, so this proves the gate follows the
  // disclosure's own escalation rather than a hardcoded strategy allowlist.
  const plan = apply(planFrom(3), { type: 'rotate', pages: [2], delta: 180 });
  const impact = impactFor(plan, preflight({ digitalSignatures: { present: true, count: 1 } }));
  const { calls, deps } = stubs();

  const refused = await exportApprovedPdfEditorPagePlan({ source: SOURCE, plan, impact, deps });
  assert.equal(impact.requiresConfirmation, true);
  assert.equal(refused.outcome, 'unapproved');
  assert.equal(calls.exportCalls, 0);

  const approved = await exportApprovedPdfEditorPagePlan({
    source: SOURCE,
    plan,
    impact,
    approvedToken: impact.approvalToken,
    deps,
  });
  assert.equal(approved.outcome, 'exported');
  assert.equal(calls.exportCalls, 1);
});

test('the gate refuses on the real exporter path too, without reaching pdf-lib', async () => {
  // No deps injected: the default exporter would throw on this fake source, so
  // an "unapproved" result proves the refusal happens before pdf-lib is called.
  const plan = apply(planFrom(3), { type: 'delete', pages: [1] });
  const impact = impactFor(plan);

  const result = await exportApprovedPdfEditorPagePlan({ source: SOURCE, plan, impact });

  assert.equal(result.outcome, 'unapproved');
});
