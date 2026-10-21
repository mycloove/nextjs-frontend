import type {
  PdfEditorExportDecision,
  PdfEditorExportMode,
} from './editorExport';

export type PdfSourceSignals = {
  hasEncryptionDictionary: boolean;
  digitalSignatureCount: number;
  hasStructureTree: boolean;
};

export type PdfDocumentPreflight = {
  status: 'complete' | 'partial';
  scannedAt: number;
  pageCount: number;
  warnings: string[];
  features: {
    encryption: { present: boolean; restricted: boolean };
    digitalSignatures: { present: boolean; count: number };
    forms: { present: boolean; fieldCount: number; signatureFieldCount: number };
    annotations: { present: boolean; count: number };
    links: { present: boolean; count: number };
    outline: { present: boolean; itemCount: number };
    attachments: { present: boolean; count: number };
    taggedContent: { present: boolean };
    metadata: { present: boolean };
    javascript: { present: boolean };
    rotatedPages: { present: boolean; count: number };
  };
};

export type PdfExportConsequence = {
  id: string;
  severity: 'info' | 'warning' | 'critical';
  title: string;
  detail: string;
};

export type PdfExportImpact = {
  decision: PdfEditorExportDecision;
  severity: 'none' | 'warning' | 'critical';
  requiresConfirmation: boolean;
  title: string;
  summary: string;
  consequences: PdfExportConsequence[];
  preservationNotes: string[];
  confirmLabel: string;
};

export type PdfPreflightPage = {
  rotate?: number;
  getAnnotations?: () => Promise<unknown[]>;
};

export type PdfPreflightDocument = {
  numPages: number;
  getPage: (page: number) => Promise<PdfPreflightPage>;
  getAttachments?: () => Promise<Record<string, unknown> | null>;
  getOutline?: () => Promise<unknown[] | null>;
  getPermissions?: () => Promise<number[] | null>;
  getMetadata?: () => Promise<{ info?: unknown; metadata?: unknown } | null>;
  getMarkInfo?: () => Promise<{ Marked?: boolean } | null>;
  getFieldObjects?: () => Promise<Record<string, unknown[]> | null>;
  getJSActions?: () => Promise<Record<string, unknown> | null>;
};

const ASCII = {
  encrypt: new TextEncoder().encode('/Encrypt'),
  byteRange: new TextEncoder().encode('/ByteRange'),
  structureTree: new TextEncoder().encode('/StructTreeRoot'),
};

function countToken(bytes: Uint8Array, token: Uint8Array): number {
  let count = 0;
  for (let index = 0; index <= bytes.length - token.length; index += 1) {
    let matches = true;
    for (let offset = 0; offset < token.length; offset += 1) {
      if (bytes[index + offset] !== token[offset]) {
        matches = false;
        break;
      }
    }
    if (matches) {
      count += 1;
      index += token.length - 1;
    }
  }
  return count;
}

export function scanPdfSourceSignals(source: ArrayBuffer | Uint8Array): PdfSourceSignals {
  const bytes = source instanceof Uint8Array ? source : new Uint8Array(source);
  return {
    hasEncryptionDictionary: countToken(bytes, ASCII.encrypt) > 0,
    digitalSignatureCount: countToken(bytes, ASCII.byteRange),
    hasStructureTree: countToken(bytes, ASCII.structureTree) > 0,
  };
}

function objectCount(value: Record<string, unknown> | null | undefined): number {
  return value ? Object.keys(value).length : 0;
}

function outlineCount(nodes: unknown[] | null | undefined): number {
  if (!nodes) return 0;
  return nodes.reduce<number>((total, node) => {
    if (!node || typeof node !== 'object') return total + 1;
    const children = (node as { items?: unknown[] }).items;
    return total + 1 + outlineCount(Array.isArray(children) ? children : null);
  }, 0);
}

function isSignatureValue(value: unknown): boolean {
  if (typeof value === 'string') return value.toLowerCase() === 'sig' || value.toLowerCase() === 'signature';
  if (!value || typeof value !== 'object') return false;
  return Object.entries(value).some(([key, nested]) => {
    const normalizedKey = key.toLowerCase();
    if ((normalizedKey === 'fieldtype' || normalizedKey === 'ft' || normalizedKey === 'subtype') && isSignatureValue(nested)) {
      return true;
    }
    return isSignatureValue(nested);
  });
}

function annotationSubtype(annotation: unknown): string {
  if (!annotation || typeof annotation !== 'object') return '';
  const candidate = annotation as { subtype?: unknown; annotationType?: unknown; fieldType?: unknown };
  return String(candidate.subtype ?? candidate.annotationType ?? candidate.fieldType ?? '').toLowerCase();
}

async function optionalRead<T>(
  label: string,
  reader: (() => Promise<T>) | undefined,
  warnings: string[],
  fallback: T,
): Promise<T> {
  if (!reader) {
    warnings.push(`${label} inspection is unavailable in this PDF engine.`);
    return fallback;
  }
  try {
    return await reader();
  } catch {
    warnings.push(`${label} inspection could not be completed.`);
    return fallback;
  }
}

export async function scanPdfDocumentPreflight(
  document: PdfPreflightDocument,
  sourceSignals: PdfSourceSignals = {
    hasEncryptionDictionary: false,
    digitalSignatureCount: 0,
    hasStructureTree: false,
  },
): Promise<PdfDocumentPreflight> {
  const warnings: string[] = [];
  const [attachments, outline, permissions, metadata, markInfo, fieldObjects, javascript] = await Promise.all([
    optionalRead('Attachment', document.getAttachments?.bind(document), warnings, null),
    optionalRead('Outline', document.getOutline?.bind(document), warnings, null),
    optionalRead('Permission', document.getPermissions?.bind(document), warnings, null),
    optionalRead('Metadata', document.getMetadata?.bind(document), warnings, null),
    optionalRead('Tagged-content', document.getMarkInfo?.bind(document), warnings, null),
    optionalRead('Form', document.getFieldObjects?.bind(document), warnings, null),
    optionalRead('JavaScript', document.getJSActions?.bind(document), warnings, null),
  ]);

  let annotationCount = 0;
  let linkCount = 0;
  let signatureWidgetCount = 0;
  let rotatedPageCount = 0;

  for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
    try {
      const page = await document.getPage(pageNumber);
      if ((page.rotate ?? 0) % 360 !== 0) rotatedPageCount += 1;
      if (!page.getAnnotations) {
        warnings.push(`Annotation inspection is unavailable on page ${pageNumber}.`);
        continue;
      }
      const annotations = await page.getAnnotations();
      annotations.forEach((annotation) => {
        const subtype = annotationSubtype(annotation);
        if (subtype === 'link') linkCount += 1;
        else if (subtype !== 'widget') annotationCount += 1;
        if (isSignatureValue(annotation)) signatureWidgetCount += 1;
      });
    } catch {
      warnings.push(`Page ${pageNumber} could not be fully inspected.`);
    }
  }

  const fieldEntries = fieldObjects ? Object.values(fieldObjects).flat() : [];
  const signatureFieldCount = fieldEntries.filter(isSignatureValue).length || signatureWidgetCount;
  const digitalSignatureCount = Math.max(sourceSignals.digitalSignatureCount, signatureFieldCount);
  const metadataInfo = metadata?.info;
  const hasMetadata = !!metadata && (
    (metadataInfo !== null && typeof metadataInfo === 'object' && Object.keys(metadataInfo).length > 0)
    || !!metadata.metadata
  );

  return {
    status: warnings.length ? 'partial' : 'complete',
    scannedAt: Date.now(),
    pageCount: document.numPages,
    warnings,
    features: {
      encryption: {
        present: sourceSignals.hasEncryptionDictionary || permissions !== null,
        restricted: permissions !== null,
      },
      digitalSignatures: { present: digitalSignatureCount > 0, count: digitalSignatureCount },
      forms: {
        present: fieldEntries.length > 0,
        fieldCount: fieldEntries.length,
        signatureFieldCount,
      },
      annotations: { present: annotationCount > 0, count: annotationCount },
      links: { present: linkCount > 0, count: linkCount },
      outline: { present: outlineCount(outline) > 0, itemCount: outlineCount(outline) },
      attachments: { present: objectCount(attachments) > 0, count: objectCount(attachments) },
      taggedContent: { present: !!markInfo?.Marked || sourceSignals.hasStructureTree },
      metadata: { present: hasMetadata },
      javascript: { present: objectCount(javascript) > 0 },
      rotatedPages: { present: rotatedPageCount > 0, count: rotatedPageCount },
    },
  };
}

function redactionConsequence(count: number): PdfExportConsequence {
  return {
    id: 'redaction',
    severity: 'critical',
    title: 'Redacted text will be removed permanently',
    detail: `${count} marked text run${count === 1 ? '' : 's'} will be deleted from the exported content stream and verified absent. This cannot be undone in the downloaded file.`,
  };
}

function compatibilityConsequences(report: PdfDocumentPreflight | null): PdfExportConsequence[] {
  const features = report?.features;
  const consequences: PdfExportConsequence[] = [{
    id: 'document-rebuild',
    severity: 'warning',
    title: 'The PDF will be rebuilt',
    detail: 'Pages are copied into a new PDF. Visual content remains, but original document objects are not guaranteed to survive.',
  }];

  if (features?.digitalSignatures.present) consequences.push({
    id: 'digital-signatures', severity: 'critical', title: 'Digital signatures will no longer be valid',
    detail: 'Rebuilding changes the signed bytes and cannot preserve cryptographic signature validity.',
  });
  if (features?.encryption.present) consequences.push({
    id: 'encryption', severity: 'critical', title: 'Password protection and permissions may be removed',
    detail: 'The rebuilt download is not guaranteed to retain the source encryption or usage restrictions.',
  });
  if (features?.forms.present) consequences.push({
    id: 'forms', severity: 'warning', title: 'Form fields may become non-interactive',
    detail: `${features.forms.fieldCount} detected form field${features.forms.fieldCount === 1 ? '' : 's'} may be flattened or omitted.`,
  });
  if (features?.annotations.present || features?.links.present) consequences.push({
    id: 'annotations', severity: 'warning', title: 'Links and annotations may be flattened or removed',
    detail: 'Their visible appearance may remain, but click targets, comments, replies, and annotation metadata are not preserved.',
  });
  if (features?.outline.present) consequences.push({
    id: 'outline', severity: 'warning', title: 'Bookmarks may be removed',
    detail: `${features.outline.itemCount} detected outline item${features.outline.itemCount === 1 ? '' : 's'} will not be recreated by compatibility export.`,
  });
  if (features?.attachments.present) consequences.push({
    id: 'attachments', severity: 'warning', title: 'Embedded attachments may be removed',
    detail: `${features.attachments.count} detected attachment${features.attachments.count === 1 ? '' : 's'} will not be copied into the rebuilt file.`,
  });
  if (features?.taggedContent.present) consequences.push({
    id: 'tags', severity: 'critical', title: 'Accessibility tags may be removed',
    detail: 'The rebuilt document does not recreate the source structure tree or reading-order tags.',
  });
  if (features?.javascript.present) consequences.push({
    id: 'javascript', severity: 'warning', title: 'Document actions will be removed',
    detail: 'Embedded PDF JavaScript and document-level actions are not copied.',
  });

  return consequences;
}

export function buildPdfExportImpact(
  report: PdfDocumentPreflight | null,
  decision: PdfEditorExportDecision,
  options: {
    fallbackReason?: string;
    visualTextFallback?: boolean;
    /** Number of authored redaction marks, which always need confirmation. */
    redactionCount?: number;
  } = {},
): PdfExportImpact {
  const redactionCount = Math.max(0, options.redactionCount ?? 0);

  if (decision.mode === 'byte-preserving') {
    // A redaction is an edit by definition. Reaching this branch with marks
    // means the mode resolver and the mutation collector disagree; fail closed
    // with a critical confirmation instead of claiming the bytes are unchanged.
    if (redactionCount > 0) {
      return {
        decision,
        severity: 'critical',
        requiresConfirmation: true,
        title: 'Redaction cannot use the original bytes',
        summary: 'Marked text exists, but the export decision did not switch to the removal engine. Export was stopped rather than claim the file is unchanged.',
        consequences: [redactionConsequence(redactionCount)],
        preservationNotes: [],
        confirmLabel: 'Review redaction',
      };
    }
    return {
      decision,
      severity: 'none',
      requiresConfirmation: false,
      title: 'Original PDF can be preserved exactly',
      summary: 'There are no effective edits, so the downloaded bytes will match the source file.',
      consequences: [],
      preservationNotes: ['Forms, links, annotations, tags, metadata, encryption, and signatures remain byte-for-byte unchanged.'],
      confirmLabel: 'Export PDF',
    };
  }

  if (decision.mode === 'compatibility-render') {
    const consequences = compatibilityConsequences(report);
    if (redactionCount > 0) {
      consequences.unshift({
        id: 'redaction-not-applied',
        severity: 'critical',
        title: 'Redaction cannot be applied by a visual rebuild',
        detail: 'A rebuilt/rasterised page cannot prove the marked glyphs were deleted, so the redaction must be refused rather than shown as successful.',
      });
    }
    if (options.visualTextFallback) {
      consequences.unshift({
        id: 'visual-text-fallback',
        severity: 'critical',
        title: 'Edited pages will be saved as visual PDF pages',
        detail:
          'The editor could not prove a structural text replacement for this file, '
          + 'so it will render the edited pages visually instead. The page will look '
          + 'like the preview and the original text will not remain extractable, but '
          + 'the rebuilt edited page may lose selectable/searchable source text.',
      });
    }
    const isCritical = consequences.some(item => item.severity === 'critical');
    const requiresConfirmation = redactionCount > 0
      ? true
      : options.visualTextFallback ? false : isCritical;
    return {
      decision,
      severity: isCritical ? 'critical' : 'warning',
      requiresConfirmation,
      title: options.visualTextFallback
        ? 'Edited PDF is ready'
        : options.fallbackReason ? 'Compatibility export needs approval' : 'Review document changes before export',
      summary: options.visualTextFallback
        ? 'The edited page will be saved to match the preview.'
        : options.fallbackReason
        ? `The structure-preserving exporter could not finish: ${options.fallbackReason}`
        : 'Your edits require the PDF to be rebuilt. Please review how this may affect the exported document.',
      consequences,
      preservationNotes: options.visualTextFallback
        ? [
            'The original uploaded PDF is never modified.',
            'The preview is rendered from the exact bytes that will be downloaded.',
            'Use this path when visual correctness matters more than preserving the edited page text layer.',
          ]
        : ['Page appearance and searchable source page content are retained where the source can be embedded.'],
      confirmLabel: options.visualTextFallback ? 'Export PDF' : 'Export rebuilt PDF',
    };
  }

  const consequences: PdfExportConsequence[] = [];
  if (redactionCount > 0) consequences.push(redactionConsequence(redactionCount));
  if (!report) consequences.push({
    id: 'preflight-pending',
    severity: 'critical',
    title: 'Document safety scan is still pending',
    detail: 'The editor has not finished checking signatures, encryption, forms, annotations, and accessibility tags, so export needs review before download.',
  });
  if (report?.features.digitalSignatures.present) consequences.push({
    id: 'digital-signatures', severity: 'critical', title: 'Digital signatures will no longer be valid',
    detail: 'Any edit changes the signed file. The original remains untouched, but the edited download cannot retain signature validity.',
  });
  if (report?.features.encryption.present) consequences.push({
    id: 'encryption', severity: 'critical', title: 'Document security may not carry forward',
    detail: 'The edited copy is not guaranteed to retain source passwords, encryption, or usage permissions.',
  });
  if (report?.features.taggedContent.present) consequences.push({
    id: 'tagged-edit', severity: 'warning', title: 'New edits are not added to the accessibility tree',
    detail: 'Existing tags remain in the source structure, but appended editor content is not semantically tagged.',
  });

  const isCritical = consequences.some(item => item.severity === 'critical');
  // Only real security losses (signatures, encryption) should stop the user for
  // approval. Advisory warnings stay informational so a routine edit still
  // exports without an intimidating confirmation step.
  return {
    decision,
    severity: isCritical ? 'critical' : consequences.length ? 'warning' : 'none',
    requiresConfirmation: isCritical,
    title: redactionCount > 0
      ? 'Review redactions before export'
      : isCritical
        ? 'Review document security before export'
        : 'Source structure will be preserved',
    summary: redactionCount > 0
      ? 'Marked text will be deleted from the exported content stream and proven absent. Check every mark before continuing.'
      : isCritical
        ? 'The PDF can retain its source pages and interactive objects, but protected document properties need your attention.'
        : consequences.length
          ? 'Edits are added alongside the original pages. Notes about the exported file are listed below.'
          : 'Edits will be appended without rebuilding the source pages.',
    consequences,
    preservationNotes: ['Existing forms, links, annotations, outlines, attachments, metadata, and page structure remain in the source PDF.'],
    confirmLabel: redactionCount > 0 ? 'Export redacted PDF' : 'Export edited copy',
  };
}

export function countDetectedPreflightFeatures(report: PdfDocumentPreflight | null): number {
  if (!report) return 0;
  const features = report.features;
  return [
    features.encryption.present,
    features.digitalSignatures.present,
    features.forms.present,
    features.annotations.present,
    features.links.present,
    features.outline.present,
    features.attachments.present,
    features.taggedContent.present,
    features.javascript.present,
  ].filter(Boolean).length;
}

export function isConfirmedExportMode(
  confirmedMode: PdfEditorExportMode | undefined,
  impact: PdfExportImpact,
): boolean {
  if (!impact.requiresConfirmation || confirmedMode === impact.decision.mode) return true;

  // Compatibility approval is broader than structure-preserving approval. On a
  // retry after a failed structure export, it must cover the initial attempt too.
  return confirmedMode === 'compatibility-render'
    && impact.decision.mode === 'structure-preserving';
}
