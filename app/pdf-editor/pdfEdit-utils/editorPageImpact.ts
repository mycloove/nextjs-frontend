/**
 * Page-plan export impact (Phase 3C).
 *
 * Phase 3B made page operations executable and provable, but nothing told the
 * user what a page export was about to cost them. A reorder and a full rebuild
 * are wildly different transactions: one keeps every form field and bookmark,
 * the other throws them away. Presenting both with the same generic "export?"
 * prompt would be dishonest, so this module derives the consequences from the
 * chosen strategy plus what preflight actually found in the source.
 *
 * Two rules drive everything here:
 *
 * 1. Never claim safety that was not proven. If preflight is missing or partial,
 *    absence of a feature is unknown, not "not present". Unknowns are disclosed
 *    as "may" with an explicit uncertainty note instead of being silently
 *    dropped, because a confident-but-wrong "nothing will be lost" is worse than
 *    an honest "this could not be fully scanned".
 *
 * 2. Approval is bound to the exact plan, not to the act of clicking confirm.
 *    Approving a two-page reorder must not authorise a later export that also
 *    deletes a page.
 *
 * Pure module: no PDF I/O, no DOM, type-only imports, so it is unit testable.
 */

import type { PdfEditorPagePlan, PdfEditorPagePlanImpact } from './editorPageModel';
import type {
  PdfEditorPageExportDecision,
  PdfEditorPageExportStrategy,
} from './editorPageExport';
import type { PdfDocumentPreflight, PdfExportConsequence } from './editorPreflight';

export type PdfEditorPageImpactSeverity = 'none' | 'warning' | 'critical';

export type PdfEditorPageExportImpact = {
  strategy: PdfEditorPageExportStrategy;
  preservation: PdfEditorPageExportDecision['preservation'];
  severity: PdfEditorPageImpactSeverity;
  requiresConfirmation: boolean;
  title: string;
  summary: string;
  /** Plain-language page changes, e.g. "Page 3 will be removed". */
  pageChanges: string[];
  consequences: PdfExportConsequence[];
  preservationNotes: string[];
  /** Disclosed gaps in what could be inspected. Never silently omitted. */
  scanWarnings: string[];
  confirmLabel: string;
  /**
   * Identity of exactly what was approved. A confirmation is only valid for the
   * plan and strategy it was shown for.
   */
  approvalToken: string;
};

/** Stable identity for a plan: page order plus per-page editor rotation. */
export function getPdfEditorPagePlanSignature(plan: PdfEditorPagePlan): string {
  const entries = plan.entries.map((entry) => `${entry.sourcePage}@${entry.rotation}`).join(',');
  return `${plan.sourcePageCount}/${plan.entries.length}[${entries}]`;
}

function buildApprovalToken(
  strategy: PdfEditorPageExportStrategy,
  plan: PdfEditorPagePlan,
): string {
  return `${strategy}:${getPdfEditorPagePlanSignature(plan)}`;
}

const MAX_LISTED_PAGES = 8;

function formatPageList(pages: readonly number[]): string {
  const shown = pages.slice(0, MAX_LISTED_PAGES);
  const remaining = pages.length - shown.length;
  const body =
    shown.length > 1
      ? `${shown.slice(0, -1).join(', ')} and ${shown[shown.length - 1]}`
      : String(shown[0]);
  return remaining > 0 ? `${shown.join(', ')} and ${remaining} more` : body;
}

function pluralPages(count: number): string {
  return count === 1 ? 'page' : 'pages';
}

/**
 * Page changes stated as output consequences, not as internal operations.
 * "Page 3 will be removed" is actionable; "delete op at index 2" is not.
 */
export function describePdfEditorPageChanges(impact: PdfEditorPagePlanImpact): string[] {
  const changes: string[] = [];

  if (impact.removedSourcePages.length > 0) {
    changes.push(
      `${impact.removedSourcePages.length} ${pluralPages(impact.removedSourcePages.length)} will be removed: ${formatPageList(impact.removedSourcePages)}.`,
    );
  }
  if (impact.duplicatedSourcePages.length > 0) {
    changes.push(
      `${impact.duplicatedSourcePages.length} ${pluralPages(impact.duplicatedSourcePages.length)} will appear more than once: ${formatPageList(impact.duplicatedSourcePages)}.`,
    );
  }
  if (impact.reordered) {
    changes.push('Pages will be saved in a new order.');
  }
  if (impact.rotatedPositions.length > 0) {
    changes.push(
      `${impact.rotatedPositions.length} ${pluralPages(impact.rotatedPositions.length)} will be rotated: output ${pluralPages(impact.rotatedPositions.length)} ${formatPageList(impact.rotatedPositions)}.`,
    );
  }
  if (changes.length === 0) {
    changes.push('Pages are unchanged.');
  }

  changes.push(`The exported file will have ${impact.outputPageCount} ${pluralPages(impact.outputPageCount)}.`);
  return changes;
}

/**
 * A feature is only "absent" if a complete scan said so. Anything else is
 * unknown, and unknown must read as "may" rather than as a guarantee.
 */
type FeatureState = 'present' | 'absent' | 'unknown';

function featureState(
  report: PdfDocumentPreflight | null,
  pick: (features: PdfDocumentPreflight['features']) => boolean,
): FeatureState {
  if (!report) return 'unknown';
  if (pick(report.features)) return 'present';
  return report.status === 'complete' ? 'absent' : 'unknown';
}

function willOrMay(state: FeatureState): string {
  return state === 'present' ? 'will' : 'may';
}

function rebuildConsequences(report: PdfDocumentPreflight | null): PdfExportConsequence[] {
  const consequences: PdfExportConsequence[] = [];
  const features = report?.features;

  const signatures = featureState(report, (f) => f.digitalSignatures.present);
  if (signatures !== 'absent') {
    consequences.push({
      id: 'page-rebuild-signatures',
      severity: 'critical',
      title: `Digital signatures ${willOrMay(signatures)} become invalid`,
      detail:
        'Rebuilding the page tree changes the signed bytes. Signature validity cannot survive a page reorder, delete, or duplicate.',
    });
  }

  const encryption = featureState(report, (f) => f.encryption.present);
  if (encryption !== 'absent') {
    consequences.push({
      id: 'page-rebuild-encryption',
      severity: 'critical',
      title: `Password protection and permissions ${willOrMay(encryption)} be removed`,
      detail: 'The rebuilt file is not guaranteed to carry source encryption or usage restrictions forward.',
    });
  }

  const tagged = featureState(report, (f) => f.taggedContent.present);
  if (tagged !== 'absent') {
    consequences.push({
      id: 'page-rebuild-tags',
      severity: 'critical',
      title: `Accessibility tags ${willOrMay(tagged)} be removed`,
      detail:
        'The rebuilt document does not recreate the source structure tree, so screen-reader reading order is lost.',
    });
  }

  const forms = featureState(report, (f) => f.forms.present);
  if (forms !== 'absent') {
    const count = features?.forms.present ? features.forms.fieldCount : 0;
    consequences.push({
      id: 'page-rebuild-forms',
      severity: 'warning',
      title: `Form fields ${willOrMay(forms)} stop being interactive`,
      detail: count
        ? `${count} detected form field${count === 1 ? '' : 's'} will not be copied into the rebuilt page tree.`
        : 'Any interactive form fields are not copied into the rebuilt page tree.',
    });
  }

  const annotations = featureState(
    report,
    (f) => f.annotations.present || f.links.present,
  );
  if (annotations !== 'absent') {
    consequences.push({
      id: 'page-rebuild-annotations',
      severity: 'warning',
      title: `Links, comments, and annotations ${willOrMay(annotations)} be removed`,
      detail:
        'Page appearance is copied, but click targets, comment threads, and annotation metadata are not recreated.',
    });
  }

  const outline = featureState(report, (f) => f.outline.present);
  if (outline !== 'absent') {
    const count = features?.outline.present ? features.outline.itemCount : 0;
    consequences.push({
      id: 'page-rebuild-outline',
      severity: 'warning',
      title: `Bookmarks ${willOrMay(outline)} be removed`,
      detail: count
        ? `${count} detected outline item${count === 1 ? '' : 's'} cannot be remapped to the new page order.`
        : 'Outline entries cannot be remapped to the new page order.',
    });
  }

  const attachments = featureState(report, (f) => f.attachments.present);
  if (attachments !== 'absent') {
    const count = features?.attachments.present ? features.attachments.count : 0;
    consequences.push({
      id: 'page-rebuild-attachments',
      severity: 'warning',
      title: `Embedded attachments ${willOrMay(attachments)} be removed`,
      detail: count
        ? `${count} detected attachment${count === 1 ? '' : 's'} will not be copied into the rebuilt file.`
        : 'Embedded files are not copied into the rebuilt file.',
    });
  }

  const javascript = featureState(report, (f) => f.javascript.present);
  if (javascript === 'present') {
    consequences.push({
      id: 'page-rebuild-javascript',
      severity: 'warning',
      title: 'Document actions will be removed',
      detail: 'Embedded PDF JavaScript and document-level actions are not copied.',
    });
  }

  return consequences;
}

function mutationConsequences(report: PdfDocumentPreflight | null): PdfExportConsequence[] {
  const consequences: PdfExportConsequence[] = [];

  const signatures = featureState(report, (f) => f.digitalSignatures.present);
  if (signatures !== 'absent') {
    consequences.push({
      id: 'page-rotate-signatures',
      severity: 'critical',
      title: `Digital signatures ${willOrMay(signatures)} become invalid`,
      detail:
        'Saving a rotation rewrites the file. The original stays untouched, but the exported copy cannot keep signature validity.',
    });
  }

  const encryption = featureState(report, (f) => f.encryption.present);
  if (encryption !== 'absent') {
    consequences.push({
      id: 'page-rotate-encryption',
      severity: 'critical',
      title: `Document security ${willOrMay(encryption)} not carry forward`,
      detail: 'The exported copy is not guaranteed to retain source passwords, encryption, or permissions.',
    });
  }

  return consequences;
}

function scanWarningsFor(report: PdfDocumentPreflight | null): string[] {
  if (!report) {
    return ['The document was not inspected, so preservation consequences could not be confirmed.'];
  }
  if (report.status === 'partial') {
    return ['The document could only be partly inspected, so some consequences are reported as possible rather than certain.'];
  }
  return [];
}

export function buildPdfEditorPageExportImpact(
  plan: PdfEditorPagePlan,
  planImpact: PdfEditorPagePlanImpact,
  decision: PdfEditorPageExportDecision,
  report: PdfDocumentPreflight | null,
): PdfEditorPageExportImpact {
  const approvalToken = buildApprovalToken(decision.strategy, plan);
  const pageChanges = describePdfEditorPageChanges(planImpact);
  const scanWarnings = scanWarningsFor(report);

  if (decision.strategy === 'byte-preserving') {
    return {
      strategy: decision.strategy,
      preservation: decision.preservation,
      severity: 'none',
      requiresConfirmation: false,
      title: 'Original PDF can be preserved exactly',
      summary: 'Pages are untouched, so the downloaded bytes will match the source file.',
      pageChanges,
      consequences: [],
      preservationNotes: [
        'Forms, links, annotations, bookmarks, tags, metadata, encryption, and signatures remain byte-for-byte unchanged.',
      ],
      // An untouched export cannot lose anything, so an incomplete scan does not
      // change the outcome and must not raise a pointless warning.
      scanWarnings: [],
      confirmLabel: 'Export PDF',
      approvalToken,
    };
  }

  if (decision.strategy === 'rotation-in-place') {
    const consequences = mutationConsequences(report);
    const critical = consequences.some((item) => item.severity === 'critical');
    const severity: PdfEditorPageImpactSeverity = critical
      ? 'critical'
      : consequences.length > 0
        ? 'warning'
        : 'none';

    return {
      strategy: decision.strategy,
      preservation: decision.preservation,
      severity,
      // A lossless rotation on an unsigned document does not need a modal.
      // Prompting on every harmless export teaches users to dismiss warnings,
      // which makes the genuinely destructive prompt less effective.
      requiresConfirmation: severity !== 'none',
      title: critical
        ? 'Review document security before rotating'
        : 'Rotation keeps the source document structure',
      summary: critical
        ? 'Rotation is written onto the existing document, but protected properties of this file need your attention.'
        : 'Rotation is written onto the existing document, so interactive content is kept.',
      pageChanges,
      consequences,
      preservationNotes: [
        'Form fields, links, annotations, bookmarks, attachments, and metadata stay in the exported document.',
        'Page count and page order are unchanged.',
      ],
      scanWarnings,
      confirmLabel: 'Export rotated PDF',
      approvalToken,
    };
  }

  const consequences = rebuildConsequences(report);
  const removesPages = planImpact.removedSourcePages.length > 0;

  if (removesPages) {
    // Page removal is unconditionally critical. It is the one consequence that
    // does not depend on what preflight found: content simply will not be in
    // the output, and no later step can recover it.
    consequences.unshift({
      id: 'page-removal',
      severity: 'critical',
      title: `${planImpact.removedSourcePages.length} ${pluralPages(planImpact.removedSourcePages.length)} will not be in the exported file`,
      detail: `Removed source ${pluralPages(planImpact.removedSourcePages.length)}: ${formatPageList(planImpact.removedSourcePages)}. The original file on your device is not modified.`,
    });
  }

  const critical = consequences.some((item) => item.severity === 'critical');

  return {
    strategy: decision.strategy,
    preservation: decision.preservation,
    severity: critical ? 'critical' : 'warning',
    // A rebuild always asks, even when the source is a plain unsigned PDF,
    // because the page tree itself is being replaced.
    requiresConfirmation: true,
    title: removesPages
      ? 'Pages will be permanently removed from the export'
      : 'Page changes require rebuilding the PDF',
    summary:
      'Changing page order or page count means the PDF must be rebuilt. Review what the rebuilt file cannot carry over.',
    pageChanges,
    consequences,
    preservationNotes: [
      'Page content, page sizes, and searchable text of the kept pages are copied into the rebuilt file.',
      'Document title, author, subject, and creator are carried forward.',
    ],
    scanWarnings,
    confirmLabel: removesPages ? 'Export without removed pages' : 'Export rebuilt PDF',
    approvalToken,
  };
}

/**
 * Approval check. The token binds strategy and plan together, so editing the
 * plan after confirming invalidates the approval instead of quietly reusing it.
 */
export function isApprovedPdfEditorPageExport(
  approvedToken: string | undefined,
  impact: PdfEditorPageExportImpact,
): boolean {
  if (!impact.requiresConfirmation) return true;
  return approvedToken === impact.approvalToken;
}
