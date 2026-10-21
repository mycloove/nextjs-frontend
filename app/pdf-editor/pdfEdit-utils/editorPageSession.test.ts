import assert from 'node:assert/strict';
import test from 'node:test';

import {
  PDF_EDITOR_PAGE_HISTORY_LIMIT,
  applyPdfEditorPageSessionOperation,
  approvePdfEditorPageSession,
  canRedoPdfEditorPageSession,
  canUndoPdfEditorPageSession,
  createPdfEditorPageSession,
  describePdfEditorPageSessionExport,
  deserializePdfEditorPagePlan,
  exportPdfEditorPageSession,
  isPdfEditorPageSessionApproved,
  pdfEditorPageSessionHasChanges,
  redoPdfEditorPageSession,
  restorePdfEditorPageSession,
  serializePdfEditorPagePlan,
  undoPdfEditorPageSession,
} from './editorPageSession.ts';
import type { PdfEditorPageSession } from './editorPageSession.ts';
import {
  parsePdfEditorFeatureFlagValue,
  resolvePdfEditorFeatureFlags,
} from './editorFeatureFlags.ts';
import type { PdfEditorPageExportDecision } from './editorPageExport.ts';
import type { PdfPagePlanVerification } from './editorPageExportVerification.ts';

function newSession(pages = 4): PdfEditorPageSession {
  const session = createPdfEditorPageSession(pages);
  assert.ok(session, 'expected a session for a valid page count');
  return session;
}

/** A rebuild decision, matching what a delete/reorder plan really produces. */
const REBUILD_DECISION: PdfEditorPageExportDecision = {
  strategy: 'page-rebuild',
  preservation: 'page-content-only',
  reason: 'test double',
  declaredLosses: [],
};

function verification(ok: boolean): PdfPagePlanVerification {
  return {
    ok,
    strategy: 'page-rebuild',
    verifiedAt: 0,
    checks: [],
    failures: ok ? [] : ['page-count mismatch'],
    allowedLosses: [],
    output: null,
  };
}

function order(session: PdfEditorPageSession) {
  return session.plan.entries.map((entry) => entry.sourcePage);
}

/* ------------------------------ flags ------------------------------ */

test('feature flags only accept explicit recognised values', () => {
  assert.equal(parsePdfEditorFeatureFlagValue('true'), true);
  assert.equal(parsePdfEditorFeatureFlagValue(' OFF '), false);
  // Unrecognised input must read as "said nothing", not as false, so a typo
  // cannot silently disable the export gate.
  assert.equal(parsePdfEditorFeatureFlagValue('maybe'), null);
  assert.equal(parsePdfEditorFeatureFlagValue(''), null);
  assert.equal(parsePdfEditorFeatureFlagValue(undefined), null);
});

test('a malformed flag value falls back to the safe default', () => {
  const flags = resolvePdfEditorFeatureFlags({
    NEXT_PUBLIC_PDF_EDITOR_PAGE_EXPORT_GATE: 'ye',
  });
  assert.equal(flags.pageExportGate, true);
});

test('the export gate can still be explicitly disabled for incident response', () => {
  const flags = resolvePdfEditorFeatureFlags({
    NEXT_PUBLIC_PDF_EDITOR_PAGE_EXPORT_GATE: 'false',
  });
  assert.equal(flags.pageExportGate, false);
});

/* ---------------------------- operations ---------------------------- */

test('a rejected operation leaves the session completely untouched', () => {
  const session = newSession();
  const result = applyPdfEditorPageSessionOperation(session, {
    type: 'delete',
    pages: [1, 2, 3, 4],
  });

  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.reason, 'would-delete-every-page');
  // Same object identity: nothing to autosave, nothing in history.
  assert.equal(result.session, session);
  assert.equal(result.session.revision, 0);
});

test('an operation that changes nothing is not recorded in history', () => {
  const session = newSession();
  const result = applyPdfEditorPageSessionOperation(session, {
    type: 'rotate',
    pages: [1],
    delta: 360,
  });

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.changed, false);
  assert.equal(canUndoPdfEditorPageSession(result.session), false);
  assert.equal(result.session.revision, 0);
});

test('undo and redo walk plan snapshots in both directions', () => {
  let session = newSession();

  const moved = applyPdfEditorPageSessionOperation(session, { type: 'move', from: 1, to: 3 });
  assert.equal(moved.ok, true);
  if (!moved.ok) return;
  session = moved.session;
  assert.deepEqual(order(session), [2, 3, 1, 4]);

  const deleted = applyPdfEditorPageSessionOperation(session, { type: 'delete', pages: [4] });
  assert.equal(deleted.ok, true);
  if (!deleted.ok) return;
  session = deleted.session;
  assert.deepEqual(order(session), [2, 3, 1]);

  session = undoPdfEditorPageSession(session);
  assert.deepEqual(order(session), [2, 3, 1, 4]);

  session = undoPdfEditorPageSession(session);
  assert.deepEqual(order(session), [1, 2, 3, 4]);
  assert.equal(canUndoPdfEditorPageSession(session), false);

  session = redoPdfEditorPageSession(session);
  assert.deepEqual(order(session), [2, 3, 1, 4]);
  assert.equal(canRedoPdfEditorPageSession(session), true);
});

test('a new edit after undo discards the unreachable redo branch', () => {
  let session = newSession();
  const first = applyPdfEditorPageSessionOperation(session, { type: 'move', from: 1, to: 4 });
  assert.equal(first.ok, true);
  if (!first.ok) return;

  session = undoPdfEditorPageSession(first.session);
  assert.equal(canRedoPdfEditorPageSession(session), true);

  const second = applyPdfEditorPageSessionOperation(session, { type: 'delete', pages: [2] });
  assert.equal(second.ok, true);
  if (!second.ok) return;
  assert.equal(canRedoPdfEditorPageSession(second.session), false);
});

test('history is bounded and drops the oldest states first', () => {
  let session = newSession(3);
  for (let i = 0; i < PDF_EDITOR_PAGE_HISTORY_LIMIT + 10; i += 1) {
    const result = applyPdfEditorPageSessionOperation(session, {
      type: 'rotate',
      pages: [1],
      delta: 90,
    });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    session = result.session;
  }
  assert.equal(session.past.length, PDF_EDITOR_PAGE_HISTORY_LIMIT);
  // The most recent state is still the immediate predecessor.
  assert.equal(canUndoPdfEditorPageSession(session), true);
});

/* ------------------------- approval binding ------------------------- */

test('an unchanged plan needs no confirmation and stays byte-preserving', () => {
  const session = newSession();
  assert.equal(pdfEditorPageSessionHasChanges(session), false);

  const impact = describePdfEditorPageSessionExport(session, null);
  assert.equal(impact.strategy, 'byte-preserving');
  assert.equal(impact.requiresConfirmation, false);
});

test('approval granted for one plan does not authorise a later, different plan', () => {
  let session = newSession();
  const edited = applyPdfEditorPageSessionOperation(session, { type: 'delete', pages: [2] });
  assert.equal(edited.ok, true);
  if (!edited.ok) return;
  session = edited.session;

  session = approvePdfEditorPageSession(session, describePdfEditorPageSessionExport(session, null));
  assert.equal(isPdfEditorPageSessionApproved(session), true);

  // Editing again must revoke authority without anyone clearing the token.
  const further = applyPdfEditorPageSessionOperation(session, { type: 'delete', pages: [1] });
  assert.equal(further.ok, true);
  if (!further.ok) return;
  assert.equal(isPdfEditorPageSessionApproved(further.session), false);
});

test('a fabricated approval token is refused rather than stored', () => {
  let session = newSession();
  const edited = applyPdfEditorPageSessionOperation(session, { type: 'delete', pages: [3] });
  assert.equal(edited.ok, true);
  if (!edited.ok) return;
  session = edited.session;

  const forged = { ...describePdfEditorPageSessionExport(session, null), approvalToken: 'forged' };
  const after = approvePdfEditorPageSession(session, forged);

  assert.equal(after.approvedToken, undefined);
  assert.equal(isPdfEditorPageSessionApproved(after), false);
});

/* --------------------------- gate wiring --------------------------- */

test('an unapproved page export is refused before any bytes are produced', async () => {
  let session = newSession();
  const edited = applyPdfEditorPageSessionOperation(session, { type: 'delete', pages: [2] });
  assert.equal(edited.ok, true);
  if (!edited.ok) return;
  session = edited.session;

  let exporterCalls = 0;
  const result = await exportPdfEditorPageSession({
    session,
    source: new Uint8Array([1, 2, 3]),
    report: null,
    deps: {
      exportPagePlan: async () => {
        exporterCalls += 1;
        throw new Error('exporter must not run for an unapproved export');
      },
    },
  });

  assert.equal(result.outcome, 'unapproved');
  assert.equal(result.kind, 'refused');
  assert.equal(exporterCalls, 0, 'no bytes may exist for a refused export');
});

test('an approved page export runs the gate and returns verified bytes', async () => {
  let session = newSession();
  const edited = applyPdfEditorPageSessionOperation(session, { type: 'move', from: 1, to: 2 });
  assert.equal(edited.ok, true);
  if (!edited.ok) return;
  session = edited.session;
  session = approvePdfEditorPageSession(session, describePdfEditorPageSessionExport(session, null));

  const result = await exportPdfEditorPageSession({
    session,
    source: new Uint8Array([1, 2, 3]),
    report: null,
    deps: {
      exportPagePlan: async () => ({
        bytes: new Uint8Array([9, 9]),
        decision: REBUILD_DECISION,
      }),
      verifyPagePlan: async () => verification(true),
    },
  });

  assert.equal(result.outcome, 'exported');
  if (result.outcome !== 'exported') return;
  assert.deepEqual(Array.from(result.bytes), [9, 9]);
});

test('bytes are withheld when verification of the page export fails', async () => {
  let session = newSession();
  const edited = applyPdfEditorPageSessionOperation(session, { type: 'move', from: 1, to: 2 });
  assert.equal(edited.ok, true);
  if (!edited.ok) return;
  session = edited.session;
  session = approvePdfEditorPageSession(session, describePdfEditorPageSessionExport(session, null));

  const result = await exportPdfEditorPageSession({
    session,
    source: new Uint8Array([1, 2, 3]),
    report: null,
    deps: {
      exportPagePlan: async () => ({
        bytes: new Uint8Array([7, 7, 7]),
        decision: REBUILD_DECISION,
      }),
      verifyPagePlan: async () => verification(false),
    },
  });

  assert.equal(result.outcome, 'verification-failed');
  if (result.outcome !== 'verification-failed') return;
  assert.equal(result.withheldByteLength, 3);
  assert.ok(!('bytes' in result), 'unverified bytes must never be returned');
});

/* --------------------------- persistence --------------------------- */

test('a serialized plan round-trips back into the same page order', () => {
  let session = newSession();
  const moved = applyPdfEditorPageSessionOperation(session, { type: 'move', from: 1, to: 3 });
  assert.equal(moved.ok, true);
  if (!moved.ok) return;
  const rotated = applyPdfEditorPageSessionOperation(moved.session, {
    type: 'rotate',
    pages: [2],
    delta: 90,
  });
  assert.equal(rotated.ok, true);
  if (!rotated.ok) return;
  session = rotated.session;

  const restored = deserializePdfEditorPagePlan(serializePdfEditorPagePlan(session.plan), 4);
  assert.ok(restored);
  assert.deepEqual(
    restored.entries.map((e) => [e.sourcePage, e.rotation]),
    session.plan.entries.map((e) => [e.sourcePage, e.rotation]),
  );
});

test('duplicated pages keep unique ids after restore', () => {
  const session = newSession(2);
  const duplicated = applyPdfEditorPageSessionOperation(session, {
    type: 'duplicate',
    pages: [1],
  });
  assert.equal(duplicated.ok, true);
  if (!duplicated.ok) return;

  const restored = deserializePdfEditorPagePlan(
    serializePdfEditorPagePlan(duplicated.session.plan),
    2,
  );
  assert.ok(restored);
  const ids = restored.entries.map((entry) => entry.id);
  assert.equal(new Set(ids).size, ids.length, 'restored entry ids must stay unique');
});

test('a stored plan for a different document is refused', () => {
  const session = newSession(4);
  const stored = serializePdfEditorPagePlan(session.plan);
  // Same draft, reopened against a 9-page file: the plan describes another document.
  assert.equal(deserializePdfEditorPagePlan(stored, 9), null);
});

test('malformed stored plans are refused instead of reaching the exporter', () => {
  assert.equal(deserializePdfEditorPagePlan(null, 3), null);
  assert.equal(deserializePdfEditorPagePlan({ sourcePageCount: 3, entries: [] }, 3), null);
  assert.equal(
    deserializePdfEditorPagePlan(
      { sourcePageCount: 3, entries: [{ sourcePage: 99, rotation: 0 }] },
      3,
    ),
    null,
    'a page outside the document must not be restorable',
  );
  assert.equal(
    deserializePdfEditorPagePlan(
      { sourcePageCount: 3, entries: [{ sourcePage: 1, rotation: 45 }] },
      3,
    ),
    null,
    'an off-axis rotation must not be restorable',
  );
});

test('an unusable stored plan falls back to a fresh, unchanged session', () => {
  const restored = restorePdfEditorPageSession({ garbage: true }, 5);
  assert.ok(restored);
  assert.equal(pdfEditorPageSessionHasChanges(restored), false);
  assert.deepEqual(order(restored), [1, 2, 3, 4, 5]);
});
