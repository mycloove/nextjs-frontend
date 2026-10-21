/**
 * Phase 3E: the page session.
 *
 * Phases 3A–3D produced a plan model, an exporter, a disclosure builder, and an
 * enforcement gate — and none of them were reachable from the product. Each one
 * assumed a caller that owned "the current plan", "the plan the user approved",
 * and "the history of plans". No such owner existed, so the hook kept using the
 * Phase 1 export path and the page modules stayed dead code with green tests.
 *
 * This module is that owner. It is the only place allowed to hold page state, so
 * the invariants below have a single enforcement point instead of being re-derived
 * in a React hook where every new call site is a chance to forget one.
 *
 * Invariants:
 *
 * 1. **Approval is data, not a moment.** The approved token is stored next to the
 *    plan it was granted for. Mutating the plan does not "invalidate" the
 *    approval by convention — the token simply no longer matches, and the gate
 *    recomputes that independently. Editing after approving therefore cannot
 *    export silently, even if a caller forgets to clear anything.
 *
 * 2. **Rejected operations change nothing.** A failed op returns the previous
 *    session object unchanged, so a rejected edit cannot land in history, cannot
 *    mark the document dirty, and cannot trigger an autosave that persists a
 *    state the user never reached.
 *
 * 3. **History holds plans, not operations.** Undo restores a plan snapshot
 *    rather than computing an inverse operation. Inverses are where page-editor
 *    bugs live (what is the inverse of "duplicate page 2" after a reorder?), and
 *    plans are small enough that snapshots are cheaper than that risk.
 *
 * 4. **Unchanged plans stay byte-preserving.** The session never rewrites a plan
 *    it did not need to change, because `decidePdfEditorPageExportStrategy` keys
 *    byte-preserving export off an untouched plan.
 *
 * Pure and framework-free: no React, no DOM, no PDF I/O at module scope. The
 * exporter reaches PDF code only through the injectable Phase 3D gate.
 */

import {
  applyPdfEditorPageOperation,
  createPdfEditorPagePlan,
  getPdfEditorPagePlanImpact,
  isPdfEditorPagePlanUnchanged,
} from './editorPageModel.ts';
import type {
  PdfEditorPageOperation,
  PdfEditorPagePlan,
  PdfEditorPagePlanError,
  PdfEditorPageRotation,
} from './editorPageModel.ts';
import { decidePdfEditorPageExportStrategy } from './editorPageExport.ts';
import {
  buildPdfEditorPageExportImpact,
  getPdfEditorPagePlanSignature,
} from './editorPageImpact.ts';
import type { PdfEditorPageExportImpact } from './editorPageImpact.ts';
import { exportApprovedPdfEditorPagePlan } from './editorPageExportGate.ts';
import type {
  PdfEditorPageExportGateDeps,
  PdfEditorPageExportGateResult,
} from './editorPageExportGate.ts';
import type { PdfDocumentPreflight } from './editorPreflight.ts';

/** Bounded so a long session cannot grow memory without limit. */
export const PDF_EDITOR_PAGE_HISTORY_LIMIT = 100;

export type PdfEditorPageSession = {
  plan: PdfEditorPagePlan;
  /** Past plans, oldest first. Never includes `plan`. */
  past: readonly PdfEditorPagePlan[];
  /** Future plans after undo, next-to-redo first. Cleared by any new edit. */
  future: readonly PdfEditorPagePlan[];
  /**
   * Approval token from the last confirmed disclosure, if any. Retained across
   * edits on purpose: staleness is detected by comparison, not by clearing.
   */
  approvedToken?: string;
  /** Bumped on every accepted mutation so autosave can detect real changes. */
  revision: number;
};

export type PdfEditorPageSessionResult =
  | { ok: true; session: PdfEditorPageSession; changed: boolean }
  | { ok: false; reason: PdfEditorPagePlanError; session: PdfEditorPageSession };

export function createPdfEditorPageSession(sourcePageCount: number): PdfEditorPageSession | null {
  const created = createPdfEditorPagePlan(sourcePageCount);
  if (!created.ok) return null;
  return { plan: created.plan, past: [], future: [], revision: 0 };
}

function pushHistory(
  session: PdfEditorPageSession,
  nextPlan: PdfEditorPagePlan,
): PdfEditorPageSession {
  const past = [...session.past, session.plan];
  return {
    plan: nextPlan,
    // Trim the oldest entries, never the newest: recent undo steps are the ones
    // a user actually reaches for.
    past: past.length > PDF_EDITOR_PAGE_HISTORY_LIMIT
      ? past.slice(past.length - PDF_EDITOR_PAGE_HISTORY_LIMIT)
      : past,
    // A new edit makes the old redo branch unreachable; keeping it would let
    // redo jump to a plan that never followed from the current one.
    future: [],
    approvedToken: session.approvedToken,
    revision: session.revision + 1,
  };
}

/**
 * Apply a page operation. Rejections return the original session so callers can
 * surface a message without any state having moved.
 *
 * A successful operation that produces an identical plan (rotating by 360, moving
 * a page onto itself) reports `changed: false` and is not recorded, so undo never
 * contains steps that visibly do nothing.
 */
export function applyPdfEditorPageSessionOperation(
  session: PdfEditorPageSession,
  operation: PdfEditorPageOperation,
): PdfEditorPageSessionResult {
  const result = applyPdfEditorPageOperation(session.plan, operation);
  if (!result.ok) return { ok: false, reason: result.reason, session };

  if (
    getPdfEditorPagePlanSignature(result.plan) === getPdfEditorPagePlanSignature(session.plan)
  ) {
    return { ok: true, session, changed: false };
  }

  return { ok: true, session: pushHistory(session, result.plan), changed: true };
}

export function undoPdfEditorPageSession(session: PdfEditorPageSession): PdfEditorPageSession {
  if (session.past.length === 0) return session;
  const previous = session.past[session.past.length - 1];
  return {
    plan: previous,
    past: session.past.slice(0, -1),
    future: [session.plan, ...session.future],
    approvedToken: session.approvedToken,
    revision: session.revision + 1,
  };
}

export function redoPdfEditorPageSession(session: PdfEditorPageSession): PdfEditorPageSession {
  if (session.future.length === 0) return session;
  const [next, ...rest] = session.future;
  return {
    plan: next,
    past: [...session.past, session.plan],
    future: rest,
    approvedToken: session.approvedToken,
    revision: session.revision + 1,
  };
}

export function canUndoPdfEditorPageSession(session: PdfEditorPageSession) {
  return session.past.length > 0;
}

export function canRedoPdfEditorPageSession(session: PdfEditorPageSession) {
  return session.future.length > 0;
}

/** True when the page plan alone would force a non-byte-preserving export. */
export function pdfEditorPageSessionHasChanges(session: PdfEditorPageSession) {
  return !isPdfEditorPagePlanUnchanged(session.plan);
}

/**
 * Build the disclosure for the *current* plan. Callers show this and, if
 * `requiresConfirmation`, must record the returned token via
 * `approvePdfEditorPageSession` before exporting.
 */
export function describePdfEditorPageSessionExport(
  session: PdfEditorPageSession,
  report: PdfDocumentPreflight | null,
): PdfEditorPageExportImpact {
  const decision = decidePdfEditorPageExportStrategy(session.plan);
  const planImpact = getPdfEditorPagePlanImpact(session.plan);
  return buildPdfEditorPageExportImpact(session.plan, planImpact, decision, report);
}

/**
 * Record an approval. The token is only stored if it matches a disclosure built
 * from the current plan, so a stale or fabricated token cannot be parked in the
 * session to unlock a later export.
 */
export function approvePdfEditorPageSession(
  session: PdfEditorPageSession,
  impact: PdfEditorPageExportImpact,
): PdfEditorPageSession {
  const current = decidePdfEditorPageExportStrategy(session.plan);
  const expected = `${current.strategy}:${getPdfEditorPagePlanSignature(session.plan)}`;
  if (impact.approvalToken !== expected) return session;
  return { ...session, approvedToken: impact.approvalToken };
}

/** True when the stored approval still authorises exporting the current plan. */
export function isPdfEditorPageSessionApproved(session: PdfEditorPageSession) {
  const decision = decidePdfEditorPageExportStrategy(session.plan);
  return (
    session.approvedToken === `${decision.strategy}:${getPdfEditorPagePlanSignature(session.plan)}`
  );
}

/**
 * Export through the Phase 3D gate.
 *
 * The impact is rebuilt here rather than accepted as an argument so the gate
 * always compares against a disclosure describing the plan being exported; the
 * gate then re-derives the strategy itself and refuses on any mismatch. Passing
 * a caller-held impact would let a stale dialog authorise the wrong export.
 */
export async function exportPdfEditorPageSession(options: {
  session: PdfEditorPageSession;
  source: ArrayBuffer | Uint8Array;
  report: PdfDocumentPreflight | null;
  deps?: Partial<PdfEditorPageExportGateDeps>;
}): Promise<PdfEditorPageExportGateResult> {
  const { session, source, report, deps } = options;
  const impact = describePdfEditorPageSessionExport(session, report);
  return exportApprovedPdfEditorPagePlan({
    source,
    plan: session.plan,
    impact,
    approvedToken: session.approvedToken,
    deps,
  });
}

/* ------------------------------------------------------------------ *
 * Persistence
 * ------------------------------------------------------------------ */

/**
 * Serialized page plan for the draft record.
 *
 * Only the plan is persisted, not undo history: history is session-scoped, and
 * restoring a redo branch from a crashed session would let a user redo forward
 * into a state they had already abandoned. Entry ids are also dropped — they are
 * derivable and regenerating them keeps stored drafts smaller and forward
 * compatible.
 */
export type SerializedPdfEditorPagePlan = {
  sourcePageCount: number;
  entries: { sourcePage: number; rotation: PdfEditorPageRotation }[];
};

export function serializePdfEditorPagePlan(
  plan: PdfEditorPagePlan,
): SerializedPdfEditorPagePlan {
  return {
    sourcePageCount: plan.sourcePageCount,
    entries: plan.entries.map((entry) => ({
      sourcePage: entry.sourcePage,
      rotation: entry.rotation,
    })),
  };
}

const VALID_ROTATIONS = new Set([0, 90, 180, 270]);

/**
 * Rebuild a plan from stored data, or return `null` if the data cannot be
 * trusted.
 *
 * Restoration is strict on purpose. A draft is attacker-adjacent input (it lives
 * in localStorage) and a malformed plan would otherwise reach the exporter,
 * which would then rebuild a document from page indices that do not exist. A
 * `null` return means "fall back to a fresh plan", which loses page edits but
 * never produces a wrong document.
 *
 * `expectedSourcePageCount` is checked because a draft can be restored against a
 * re-opened file: if the page count disagrees, the stored plan describes a
 * different document and must not be applied.
 */
export function deserializePdfEditorPagePlan(
  raw: unknown,
  expectedSourcePageCount: number,
): PdfEditorPagePlan | null {
  if (!raw || typeof raw !== 'object') return null;
  const candidate = raw as Partial<SerializedPdfEditorPagePlan>;

  if (!Number.isInteger(candidate.sourcePageCount) || candidate.sourcePageCount !== expectedSourcePageCount) {
    return null;
  }
  if (!Array.isArray(candidate.entries) || candidate.entries.length === 0) return null;

  const usedIds = new Set<string>();
  const entries = [];
  for (const entry of candidate.entries) {
    if (!entry || typeof entry !== 'object') return null;
    const { sourcePage, rotation } = entry as { sourcePage?: unknown; rotation?: unknown };
    if (
      !Number.isInteger(sourcePage) ||
      (sourcePage as number) < 1 ||
      (sourcePage as number) > expectedSourcePageCount
    ) {
      return null;
    }
    if (typeof rotation !== 'number' || !VALID_ROTATIONS.has(rotation)) return null;

    // Regenerate ids so duplicated pages keep the unique keys the UI relies on.
    let occurrence = 1;
    let id = `p${sourcePage}#${occurrence}`;
    while (usedIds.has(id)) {
      occurrence += 1;
      id = `p${sourcePage}#${occurrence}`;
    }
    usedIds.add(id);

    entries.push({
      id,
      sourcePage: sourcePage as number,
      rotation: rotation as PdfEditorPageRotation,
    });
  }

  return { sourcePageCount: expectedSourcePageCount, entries };
}

/** Restore a session from a stored plan, falling back to a fresh plan. */
export function restorePdfEditorPageSession(
  raw: unknown,
  expectedSourcePageCount: number,
): PdfEditorPageSession | null {
  const restored = deserializePdfEditorPagePlan(raw, expectedSourcePageCount);
  if (restored) return { plan: restored, past: [], future: [], revision: 0 };
  return createPdfEditorPageSession(expectedSourcePageCount);
}
