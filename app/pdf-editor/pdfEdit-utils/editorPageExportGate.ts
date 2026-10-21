/**
 * Phase 3D: the page export enforcement gate.
 *
 * Phases 3A, 3B, and 3C made page changes plannable, executable and provable,
 * and disclosable and approvable. All three were inert: the impact module could
 * describe exactly what a rebuild was about to destroy, but nothing refused an
 * export that ignored it, because there was no single place an export had to
 * pass through. This module is that place. Every page-plan export goes through
 * it, or it does not happen.
 *
 * Order of operations is the whole point:
 *
 * 1. Re-derive the strategy from the plan and refuse if it disagrees with the
 *    disclosure the user was shown.
 * 2. Refuse if the disclosure no longer describes the plan being exported.
 * 3. Refuse if the export needed confirmation and did not get it.
 * 4. Only then produce bytes.
 * 5. Prove the bytes, and withhold them entirely if the proof fails.
 *
 * Refusal happens before step 4 so that unapproved output never exists. A gate
 * that writes the file and then decides whether it was allowed to has already
 * lost: the bytes are in memory, one careless `then` away from a download.
 *
 * The result is a discriminated union rather than a thrown error, and it
 * separates "we refused" from "it broke". Those two need different handling: a
 * refusal means ask the user again, a fault means something is wrong with the
 * document or the code and retrying the same way will fail the same way.
 */

import {
  decidePdfEditorPageExportStrategy,
  exportPdfEditorPagePlan,
} from './editorPageExport.ts';
import type {
  PdfEditorPageExportDecision,
  PdfEditorPageExportStrategy,
  PdfEditorPagePlanExportInput,
} from './editorPageExport.ts';
import { verifyGeneratedPdfEditorPagePlan } from './editorPageExportVerification.ts';
import type { PdfPagePlanVerification } from './editorPageExportVerification.ts';
import {
  getPdfEditorPagePlanSignature,
  isApprovedPdfEditorPageExport,
} from './editorPageImpact.ts';
import type { PdfEditorPageExportImpact } from './editorPageImpact.ts';
import type { PdfEditorPagePlan } from './editorPageModel.ts';

export type PdfEditorPageExportGateOutcome =
  | 'exported'
  | 'stale-impact'
  | 'unapproved'
  | 'export-failed'
  | 'verification-failed';

/**
 * Why a disclosure was considered stale. `strategy` means the plan now needs a
 * structurally different export than the one described; `plan` means the same
 * kind of export, but of a different set of pages than the one described.
 */
export type PdfEditorPageExportStalenessCause = 'strategy' | 'plan';

export type PdfEditorPageExportGateResult =
  | {
      outcome: 'exported';
      kind: 'exported';
      reason: string;
      bytes: Uint8Array;
      decision: PdfEditorPageExportDecision;
      verification: PdfPagePlanVerification;
    }
  | {
      outcome: 'stale-impact';
      kind: 'refused';
      reason: string;
      cause: PdfEditorPageExportStalenessCause;
      /** Strategy the user was actually shown. */
      disclosedStrategy: PdfEditorPageExportStrategy;
      /** Strategy the current plan really needs, so callers can re-disclose. */
      currentStrategy: PdfEditorPageExportStrategy;
    }
  | {
      outcome: 'unapproved';
      kind: 'refused';
      reason: string;
      disclosedStrategy: PdfEditorPageExportStrategy;
    }
  | {
      outcome: 'export-failed';
      kind: 'failed';
      reason: string;
    }
  | {
      outcome: 'verification-failed';
      kind: 'failed';
      reason: string;
      verification: PdfPagePlanVerification;
      /**
       * Size of the output that was produced and then dropped. Recorded so a
       * withheld export is still diagnosable without the bytes escaping.
       */
      withheldByteLength: number;
    };

/**
 * The exporter and verifier are injectable so refusal and failure paths can be
 * tested without hand-crafting pathological PDFs. Production callers pass
 * nothing and get the real Phase 3B modules.
 */
export type PdfEditorPageExportGateDeps = {
  exportPagePlan: (input: PdfEditorPagePlanExportInput) => Promise<{
    bytes: Uint8Array;
    decision: PdfEditorPageExportDecision;
  }>;
  verifyPagePlan: (options: {
    plan: PdfEditorPagePlan;
    decision: PdfEditorPageExportDecision;
    sourceBytes: ArrayBuffer | Uint8Array;
    outputBytes: ArrayBuffer | Uint8Array;
  }) => Promise<PdfPagePlanVerification>;
};

export type PdfEditorPageExportGateInput = {
  source: ArrayBuffer | Uint8Array;
  plan: PdfEditorPagePlan;
  /**
   * The impact record that was actually shown to the user. Taken as input
   * instead of rebuilt internally, so the gate enforces the disclosure the user
   * saw rather than a fresh one they never read.
   */
  impact: PdfEditorPageExportImpact;
  /** Token the user's confirmation produced, if they confirmed at all. */
  approvedToken?: string;
  deps?: Partial<PdfEditorPageExportGateDeps>;
};

const DEFAULT_DEPS: PdfEditorPageExportGateDeps = {
  exportPagePlan: exportPdfEditorPagePlan,
  verifyPagePlan: verifyGeneratedPdfEditorPagePlan,
};

/**
 * Disclosure identity a Phase 3C impact must carry for this exact plan.
 *
 * Phase 3C composes its approval token from the strategy plus the plan
 * signature but does not export the builder, and the impact record carries no
 * plan signature of its own. Rather than trust the caller to hand over a fresh
 * impact, the gate re-derives the identity from the exported signature function
 * and compares. The duplication is deliberate and pinned by a test: if the
 * token composition ever changes, the gate refuses instead of waving exports
 * through, which is the failure direction worth having.
 */
export function expectedPdfEditorPageExportApprovalToken(
  plan: PdfEditorPagePlan,
  strategy: PdfEditorPageExportStrategy,
): string {
  return `${strategy}:${getPdfEditorPagePlanSignature(plan)}`;
}

/** A failed verification record for cases where verification itself broke. */
function verificationFault(
  decision: PdfEditorPageExportDecision,
  detail: string,
): PdfPagePlanVerification {
  return {
    ok: false,
    strategy: decision.strategy,
    verifiedAt: Date.now(),
    checks: [{ id: 'verify', status: 'failed', detail }],
    failures: [detail],
    allowedLosses: decision.declaredLosses,
    output: null,
  };
}

/**
 * The only sanctioned way to turn an approved page plan into downloadable
 * bytes. Refuses before producing anything, and never returns bytes it could
 * not prove.
 */
export async function exportApprovedPdfEditorPagePlan(
  input: PdfEditorPageExportGateInput,
): Promise<PdfEditorPageExportGateResult> {
  const deps = { ...DEFAULT_DEPS, ...input.deps };
  const { impact } = input;

  // Re-derived from the plan rather than read from the impact: a plan edited
  // after the dialog was shown must not ride the old disclosure.
  const decision = decidePdfEditorPageExportStrategy(input.plan);

  if (decision.strategy !== impact.strategy) {
    return {
      outcome: 'stale-impact',
      kind: 'refused',
      cause: 'strategy',
      reason: `This plan now needs a ${decision.strategy} export, but the disclosure described a ${impact.strategy} export.`,
      disclosedStrategy: impact.strategy,
      currentStrategy: decision.strategy,
    };
  }

  // Same strategy is not the same transaction. Approving the removal of page 3
  // must not authorise removing page 4 instead, and the disclosure's page list
  // would be describing pages that are no longer the ones being exported.
  if (expectedPdfEditorPageExportApprovalToken(input.plan, decision.strategy) !== impact.approvalToken) {
    return {
      outcome: 'stale-impact',
      kind: 'refused',
      cause: 'plan',
      reason: 'The page plan changed after this export was disclosed, so the disclosure no longer describes it.',
      disclosedStrategy: impact.strategy,
      currentStrategy: decision.strategy,
    };
  }

  // Deliberately does not report which token would have worked. A refusal that
  // hands back the key it just refused is not a refusal.
  if (!isApprovedPdfEditorPageExport(input.approvedToken, impact)) {
    return {
      outcome: 'unapproved',
      kind: 'refused',
      reason: `A ${impact.strategy} export of this plan requires confirmation, and this export was not confirmed.`,
      disclosedStrategy: impact.strategy,
    };
  }

  let exported: { bytes: Uint8Array; decision: PdfEditorPageExportDecision };
  try {
    exported = await deps.exportPagePlan({ source: input.source, plan: input.plan });
  } catch (error) {
    return {
      outcome: 'export-failed',
      kind: 'failed',
      reason: error instanceof Error ? error.message : 'The page plan could not be exported.',
    };
  }

  // The executor reports which strategy it used. That report is checked, not
  // believed: bytes produced by a different strategy than the one disclosed
  // would be verified against the wrong contract and shipped under the wrong
  // promise.
  if (exported.decision.strategy !== decision.strategy) {
    return {
      outcome: 'export-failed',
      kind: 'failed',
      reason: `The exporter produced a ${exported.decision.strategy} export where a ${decision.strategy} export was disclosed and approved.`,
    };
  }

  let verification: PdfPagePlanVerification;
  try {
    verification = await deps.verifyPagePlan({
      plan: input.plan,
      // The re-derived decision, not the exporter's self-report, so the proof is
      // against what was promised to the user.
      decision,
      sourceBytes: input.source,
      outputBytes: exported.bytes,
    });
  } catch (error) {
    // The real verifier converts its own errors into a failed check, but a gate
    // that can crash is not a gate, so an unexpected throw is still a refusal
    // to hand over bytes rather than an unhandled rejection.
    verification = verificationFault(
      decision,
      error instanceof Error ? error.message : 'The exported PDF could not be verified.',
    );
  }

  if (!verification.ok) {
    return {
      outcome: 'verification-failed',
      kind: 'failed',
      reason: verification.failures[0] ?? 'The exported PDF could not be proven to match the page plan.',
      verification,
      // The bytes are not carried out of this branch. An export that could not
      // be proven correct must not be downloadable, even accidentally.
      withheldByteLength: exported.bytes.byteLength,
    };
  }

  return {
    outcome: 'exported',
    kind: 'exported',
    reason: decision.reason,
    bytes: exported.bytes,
    decision,
    verification,
  };
}
