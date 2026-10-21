/**
 * Phase 3A foundation: a pure, dependency-free page plan.
 *
 * The plan is the single source of truth for "which source page appears where,
 * and at what rotation" *before* any exporter runs. It intentionally performs no
 * PDF I/O so it can be unit tested deterministically, and so page operations can
 * be added to editor history without touching the Phase 1 export contracts.
 *
 * Safety rules encoded here:
 * - A plan can never reference a page outside the source document.
 * - A plan can never become empty; a PDF must keep at least one page.
 * - Rotations are always one of 0/90/180/270, never an arbitrary angle.
 * - An untouched plan is detectable, so byte-preserving export stays available.
 */

export type PdfEditorPageRotation = 0 | 90 | 180 | 270;

export type PdfEditorPageEntry = {
  /** Stable identity for list keys, selection, and history diffing. */
  id: string;
  /** 1-based page number in the original source document. */
  sourcePage: number;
  /**
   * Editor-applied rotation delta only. The source page's own /Rotate value is
   * deliberately NOT copied here, so an untouched document with a rotated source
   * page is still reported as unchanged and keeps byte-preserving export.
   */
  rotation: PdfEditorPageRotation;
};

export type PdfEditorPagePlan = {
  sourcePageCount: number;
  entries: readonly PdfEditorPageEntry[];
};

export type PdfEditorPageOperation =
  | { type: 'move'; from: number; to: number }
  | { type: 'rotate'; pages: readonly number[]; delta: number }
  | { type: 'delete'; pages: readonly number[] }
  | { type: 'duplicate'; pages: readonly number[] };

export type PdfEditorPagePlanError =
  | 'invalid-source-page-count'
  | 'invalid-rotation'
  | 'page-out-of-range'
  | 'invalid-target-index'
  | 'empty-page-selection'
  | 'would-delete-every-page';

export type PdfEditorPagePlanResult =
  | { ok: true; plan: PdfEditorPagePlan }
  | { ok: false; reason: PdfEditorPagePlanError };

export type PdfEditorPagePlanImpact = {
  hasPageMutation: boolean;
  reordered: boolean;
  outputPageCount: number;
  removedSourcePages: readonly number[];
  duplicatedSourcePages: readonly number[];
  rotatedPositions: readonly number[];
};

export const PDF_EDITOR_PAGE_ROTATIONS: readonly PdfEditorPageRotation[] = [0, 90, 180, 270];

function normalizeRotation(value: number): PdfEditorPageRotation | null {
  if (!Number.isFinite(value) || value % 90 !== 0) return null;
  const normalized = ((value % 360) + 360) % 360;
  return normalized as PdfEditorPageRotation;
}

function makePageEntryId(sourcePage: number, occurrence: number) {
  return `p${sourcePage}#${occurrence}`;
}

function nextPageEntryId(sourcePage: number, usedIds: Set<string>) {
  let occurrence = 1;
  let candidate = makePageEntryId(sourcePage, occurrence);
  while (usedIds.has(candidate)) {
    occurrence += 1;
    candidate = makePageEntryId(sourcePage, occurrence);
  }
  usedIds.add(candidate);
  return candidate;
}

/** Sorted, de-duplicated 1-based positions, or null when any position is unusable. */
function normalizePositions(pages: readonly number[], length: number): number[] | null {
  const unique = new Set<number>();
  for (const page of pages) {
    if (!Number.isInteger(page) || page < 1 || page > length) return null;
    unique.add(page);
  }
  return [...unique].sort((a, b) => a - b);
}

export function createPdfEditorPagePlan(sourcePageCount: number): PdfEditorPagePlanResult {
  if (!Number.isInteger(sourcePageCount) || sourcePageCount < 1) {
    return { ok: false, reason: 'invalid-source-page-count' };
  }

  const entries: PdfEditorPageEntry[] = [];
  for (let sourcePage = 1; sourcePage <= sourcePageCount; sourcePage += 1) {
    entries.push({ id: makePageEntryId(sourcePage, 1), sourcePage, rotation: 0 });
  }

  return { ok: true, plan: { sourcePageCount, entries } };
}

/**
 * Rotation a renderer or exporter must actually apply: the source page rotation
 * combined with the editor-applied delta. Unusable source values degrade to 0
 * rather than producing a non-finite or off-axis angle.
 */
export function getEffectivePdfEditorPageRotation(
  entry: Pick<PdfEditorPageEntry, 'rotation'>,
  sourceRotation: number,
): PdfEditorPageRotation {
  return normalizeRotation((normalizeRotation(sourceRotation) ?? 0) + entry.rotation) ?? entry.rotation;
}

export function applyPdfEditorPageOperation(
  plan: PdfEditorPagePlan,
  operation: PdfEditorPageOperation,
): PdfEditorPagePlanResult {
  const entries = plan.entries;
  const length = entries.length;

  if (operation.type === 'move') {
    if (!Number.isInteger(operation.from) || operation.from < 1 || operation.from > length) {
      return { ok: false, reason: 'page-out-of-range' };
    }
    if (!Number.isInteger(operation.to) || operation.to < 1 || operation.to > length) {
      return { ok: false, reason: 'invalid-target-index' };
    }
    const next = [...entries];
    const [moved] = next.splice(operation.from - 1, 1);
    next.splice(operation.to - 1, 0, moved);
    return { ok: true, plan: { ...plan, entries: next } };
  }

  if (operation.type === 'rotate') {
    if (operation.pages.length === 0) return { ok: false, reason: 'empty-page-selection' };
    const positions = normalizePositions(operation.pages, length);
    if (!positions) return { ok: false, reason: 'page-out-of-range' };
    if (normalizeRotation(operation.delta) === null) return { ok: false, reason: 'invalid-rotation' };

    const targets = new Set(positions);
    const next = entries.map((entry, index) => {
      if (!targets.has(index + 1)) return entry;
      const rotation = normalizeRotation(entry.rotation + operation.delta);
      return rotation === null ? entry : { ...entry, rotation };
    });
    return { ok: true, plan: { ...plan, entries: next } };
  }

  if (operation.type === 'delete') {
    if (operation.pages.length === 0) return { ok: false, reason: 'empty-page-selection' };
    const positions = normalizePositions(operation.pages, length);
    if (!positions) return { ok: false, reason: 'page-out-of-range' };
    if (positions.length >= length) return { ok: false, reason: 'would-delete-every-page' };

    const removed = new Set(positions);
    const next = entries.filter((_, index) => !removed.has(index + 1));
    return { ok: true, plan: { ...plan, entries: next } };
  }

  if (operation.pages.length === 0) return { ok: false, reason: 'empty-page-selection' };
  const positions = normalizePositions(operation.pages, length);
  if (!positions) return { ok: false, reason: 'page-out-of-range' };

  const duplicated = new Set(positions);
  const usedIds = new Set(entries.map((entry) => entry.id));
  const next: PdfEditorPageEntry[] = [];
  entries.forEach((entry, index) => {
    next.push(entry);
    if (!duplicated.has(index + 1)) return;
    next.push({ ...entry, id: nextPageEntryId(entry.sourcePage, usedIds) });
  });
  return { ok: true, plan: { ...plan, entries: next } };
}

/** True only for an untouched plan, which is what keeps byte-preserving export legal. */
export function isPdfEditorPagePlanUnchanged(plan: PdfEditorPagePlan) {
  if (plan.entries.length !== plan.sourcePageCount) return false;
  return plan.entries.every((entry, index) => entry.sourcePage === index + 1 && entry.rotation === 0);
}

/** Page count the exported document must have; verification compares against this. */
export function expectedPdfEditorOutputPageCount(plan: PdfEditorPagePlan) {
  return plan.entries.length;
}

export function getPdfEditorPagePlanImpact(plan: PdfEditorPagePlan): PdfEditorPagePlanImpact {
  const counts = new Map<number, number>();
  const rotatedPositions: number[] = [];

  plan.entries.forEach((entry, index) => {
    counts.set(entry.sourcePage, (counts.get(entry.sourcePage) ?? 0) + 1);
    if (entry.rotation !== 0) rotatedPositions.push(index + 1);
  });

  const removedSourcePages: number[] = [];
  const duplicatedSourcePages: number[] = [];
  for (let sourcePage = 1; sourcePage <= plan.sourcePageCount; sourcePage += 1) {
    const count = counts.get(sourcePage) ?? 0;
    if (count === 0) removedSourcePages.push(sourcePage);
    if (count > 1) duplicatedSourcePages.push(sourcePage);
  }

  const reordered =
    removedSourcePages.length === 0 &&
    duplicatedSourcePages.length === 0 &&
    plan.entries.some((entry, index) => entry.sourcePage !== index + 1);

  return {
    hasPageMutation: !isPdfEditorPagePlanUnchanged(plan),
    reordered,
    outputPageCount: plan.entries.length,
    removedSourcePages,
    duplicatedSourcePages,
    rotatedPositions,
  };
}
