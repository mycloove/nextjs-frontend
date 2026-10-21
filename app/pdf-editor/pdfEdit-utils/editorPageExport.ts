/**
 * Phase 3B: the only sanctioned way to turn a page plan into PDF bytes.
 *
 * This module is deliberately additive. It does not extend PdfEditorExportMode
 * or alter any Phase 1 export path, so the existing byte-preserving contract and
 * the Phase 1E verification gate keep behaving exactly as before.
 *
 * The core idea is that a page plan does not deserve a single exporter. Rotating
 * a page and reordering a document are structurally different operations, and
 * pretending otherwise would either destroy structure unnecessarily or silently
 * claim preservation that did not happen. So the plan first selects a strategy:
 *
 * - byte-preserving: the plan is untouched, so the source bytes are returned.
 * - rotation-in-place: page order and count are unchanged, so rotation is written
 *   onto the source document itself and forms/annotations/outline survive.
 * - page-rebuild: order or page count changed, which genuinely requires building
 *   a new document. The losses that causes are declared, never hidden.
 */

import { PDFDocument, degrees } from 'pdf-lib';

import {
  expectedPdfEditorOutputPageCount,
  getEffectivePdfEditorPageRotation,
  isPdfEditorPagePlanUnchanged,
} from './editorPageModel.ts';
import type { PdfEditorPagePlan, PdfEditorPageRotation } from './editorPageModel.ts';
import { clonePdfBytes } from './editorExport.ts';

export type PdfEditorPageExportStrategy =
  | 'byte-preserving'
  | 'rotation-in-place'
  | 'page-rebuild';

export type PdfEditorPageExportDecision = {
  strategy: PdfEditorPageExportStrategy;
  preservation: 'exact' | 'source-structure' | 'page-content-only';
  reason: string;
  /** Structure that this strategy cannot carry into the output. */
  declaredLosses: readonly string[];
};

export type PdfEditorPagePlanExportInput = {
  source: ArrayBuffer | Uint8Array;
  plan: PdfEditorPagePlan;
};

/**
 * Structure that a rebuilt document cannot be claimed to preserve. Rebuilding
 * copies page content into a fresh document, so anything anchored to the old
 * document object graph does not survive.
 */
const PAGE_REBUILD_LOSSES = [
  'form fields',
  'annotations',
  'links',
  'outline items',
  'attachments',
  'tagged-content structure',
  'digital-signature validity',
] as const;

/** Info fields worth carrying into a rebuilt document so metadata loss stays small. */
const CARRIED_METADATA = [
  ['getTitle', 'setTitle'],
  ['getAuthor', 'setAuthor'],
  ['getSubject', 'setSubject'],
  ['getCreator', 'setCreator'],
] as const;

function isSameOrderAndCount(plan: PdfEditorPagePlan) {
  if (plan.entries.length !== plan.sourcePageCount) return false;
  return plan.entries.every((entry, index) => entry.sourcePage === index + 1);
}

export function decidePdfEditorPageExportStrategy(
  plan: PdfEditorPagePlan,
): PdfEditorPageExportDecision {
  if (isPdfEditorPagePlanUnchanged(plan)) {
    return {
      strategy: 'byte-preserving',
      preservation: 'exact',
      reason: 'The page plan is an untouched identity map of the source document.',
      declaredLosses: [],
    };
  }

  if (isSameOrderAndCount(plan)) {
    return {
      strategy: 'rotation-in-place',
      preservation: 'source-structure',
      reason: 'Only page rotation changed, so rotation can be written onto the source document.',
      declaredLosses: [],
    };
  }

  return {
    strategy: 'page-rebuild',
    preservation: 'page-content-only',
    reason: 'Page order or page count changed, which requires building a new document.',
    declaredLosses: [...PAGE_REBUILD_LOSSES],
  };
}

/** Source page numbers, in output order. Verification uses this to prove ordering. */
export function expectedPdfEditorPagePlanOrder(plan: PdfEditorPagePlan): number[] {
  return plan.entries.map((entry) => entry.sourcePage);
}

/**
 * Rotation each output page must end up with, given the rotations the source
 * pages actually had. Index 0 is the first output page.
 */
export function expectedPdfEditorPagePlanRotations(
  plan: PdfEditorPagePlan,
  sourceRotations: readonly number[],
): PdfEditorPageRotation[] {
  return plan.entries.map((entry) => getEffectivePdfEditorPageRotation(
    entry,
    sourceRotations[entry.sourcePage - 1] ?? 0,
  ));
}

export async function exportPdfEditorPagePlan(
  input: PdfEditorPagePlanExportInput,
): Promise<{ bytes: Uint8Array; decision: PdfEditorPageExportDecision }> {
  const decision = decidePdfEditorPageExportStrategy(input.plan);

  if (decision.strategy === 'byte-preserving') {
    return { bytes: clonePdfBytes(input.source), decision };
  }

  const source = await PDFDocument.load(input.source, {
    updateMetadata: false,
    throwOnInvalidObject: true,
  });
  const sourcePages = source.getPages();

  // A plan built against a different document would silently export the wrong
  // pages, so this mismatch is treated as a hard failure rather than clamped.
  if (sourcePages.length !== input.plan.sourcePageCount) {
    throw new Error(
      `Page plan targets ${input.plan.sourcePageCount} source pages but the document has ${sourcePages.length}.`,
    );
  }

  const sourceRotations = sourcePages.map((page) => page.getRotation().angle);
  const rotations = expectedPdfEditorPagePlanRotations(input.plan, sourceRotations);

  if (decision.strategy === 'rotation-in-place') {
    input.plan.entries.forEach((entry, index) => {
      sourcePages[entry.sourcePage - 1].setRotation(degrees(rotations[index]));
    });
    const bytes = await source.save({ addDefaultPage: false, updateFieldAppearances: false });
    return { bytes, decision };
  }

  const output = await PDFDocument.create();
  for (const [get, set] of CARRIED_METADATA) {
    const value = source[get]();
    if (typeof value === 'string' && value.length > 0) output[set](value);
  }

  // Copied in one call so repeated source pages share copied resources instead
  // of duplicating fonts and images per occurrence.
  const copied = await output.copyPages(
    source,
    input.plan.entries.map((entry) => entry.sourcePage - 1),
  );
  copied.forEach((page, index) => {
    page.setRotation(degrees(rotations[index]));
    output.addPage(page);
  });

  const bytes = await output.save({ addDefaultPage: false, updateFieldAppearances: false });
  return { bytes, decision };
}

/** Page count the exported document must have, re-exported for export callers. */
export function expectedPdfEditorPagePlanPageCount(plan: PdfEditorPagePlan) {
  return expectedPdfEditorOutputPageCount(plan);
}
