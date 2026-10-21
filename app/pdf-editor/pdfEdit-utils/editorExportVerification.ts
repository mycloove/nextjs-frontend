import type { PdfEditorExportMode } from './editorExport.ts';
import { scriptOfCodePoint } from './editorFontPolicy.ts';
import {
  verifyPdfEditorContentRemoval,
  type ContentRemovalExpectation,
} from './editorContentRemoval.ts';
import {
  scanPdfDocumentPreflight,
  scanPdfSourceSignals,
} from './editorPreflight.ts';
import type {
  PdfDocumentPreflight,
  PdfPreflightDocument,
} from './editorPreflight.ts';

export type PdfVerificationSnapshot = {
  byteLength: number;
  pageCount: number;
  pageText: string[];
  pageRotations: number[];
  metadata: Record<string, string>;
  formFieldNames: string[];
  preflight: PdfDocumentPreflight;
  readers: {
    pdfjs: boolean;
    pdfLib: boolean;
  };
};

export type PdfVerificationCheck = {
  id: string;
  status: 'passed' | 'failed' | 'allowed-loss';
  detail: string;
};

export type PdfPostExportVerification = {
  ok: boolean;
  mode: PdfEditorExportMode;
  verifiedAt: number;
  checks: PdfVerificationCheck[];
  failures: string[];
  allowedLosses: string[];
  output: PdfVerificationSnapshot | null;
};

export type PdfTextReplacementVerification = {
  page: number;
  originalText: string;
  replacementText: string;
};

export type PdfVisualTextFallbackVerification = {
  /**
   * Pages intentionally flattened because structural text editing could not be
   * verified. Source text is not expected to remain searchable on these pages.
   */
  flattenedTextPages?: number[];
};

const STRUCTURE_FEATURES = [
  ['digitalSignatures', 'digital-signature markers'],
  ['forms', 'form fields'],
  ['annotations', 'annotations'],
  ['links', 'links'],
  ['outline', 'outline items'],
  ['attachments', 'attachments'],
] as const;

const COMPATIBILITY_ALLOWED_LOSSES = [
  'form fields',
  'annotations',
  'links',
  'outline items',
  'attachments',
  'tagged-content structure',
  'document metadata',
  'digital-signature validity',
  'source page rotation dictionaries',
] as const;

const DOCUMENT_INFO_METADATA_KEYS = new Set([
  'Title',
  'Author',
  'Subject',
  'Keywords',
  'Creator',
  'Producer',
  'CreationDate',
  'ModDate',
  'Trapped',
]);

function normalizeText(value: string) {
  return value.replace(/\s+/g, ' ').trim();
}

/**
 * Shaped scripts are drawn in visual glyph order: a Bengali vowel sign precedes
 * the consonant it follows logically. Extractors that ignore `/ActualText`
 * (including pdf.js, which this verifier uses) therefore return the characters
 * in visual order. Exact substring matching would report a correct export as
 * failed, while a code-point inventory still proves nothing was substituted or
 * dropped. Only scripts the vector path actually shapes get this fallback.
 */
function hasShapedScript(value: string): boolean {
  for (const char of value) {
    const script = scriptOfCodePoint(char.codePointAt(0) ?? 0);
    if (script === 'Bengali') return true;
  }
  return false;
}

function containsCodePointInventory(actual: string, expected: string): boolean {
  const counts = new Map<string, number>();
  for (const char of actual) {
    if (/\s/.test(char)) continue;
    counts.set(char, (counts.get(char) ?? 0) + 1);
  }
  for (const char of expected) {
    if (/\s/.test(char)) continue;
    const remaining = counts.get(char) ?? 0;
    if (remaining === 0) return false;
    counts.set(char, remaining - 1);
  }
  return true;
}

function countTextOccurrences(haystack: string, needle: string) {
  if (!needle) return 0;
  let count = 0;
  let offset = 0;
  while (offset <= haystack.length - needle.length) {
    const index = haystack.indexOf(needle, offset);
    if (index < 0) break;
    count += 1;
    offset = index + Math.max(1, needle.length);
  }
  return count;
}

function normalizeMetadata(info: unknown): Record<string, string> {
  if (!info || typeof info !== 'object') return {};
  const normalized: Record<string, string> = {};
  const entries = Object.entries(info as Record<string, unknown>);

  for (const [key, value] of entries) {
    if (DOCUMENT_INFO_METADATA_KEYS.has(key)
      && (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean')) {
      normalized[key] = String(value);
    }
  }

  const custom = (info as Record<string, unknown>).Custom;
  if (custom && typeof custom === 'object') {
    for (const [key, value] of Object.entries(custom as Record<string, unknown>)) {
      if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
        normalized[`Custom.${key}`] = String(value);
      }
    }
  }

  return normalized;
}

function comparableMetadata(metadata: Record<string, string>) {
  return Object.entries(metadata).filter(([key]) => (
    DOCUMENT_INFO_METADATA_KEYS.has(key) || key.startsWith('Custom.')
  ));
}

/**
 * Producer and the two document dates are stamped by whatever tool last saved
 * the file — including this editor — so their change is expected, not loss.
 * The remaining Info fields are user-facing content; when the editing pipeline
 * re-encodes one (any editor save legitimately rewrites the Info dictionary),
 * the change is disclosed as an allowed loss rather than blocking the export.
 * The page, text, and structure checks are what prove the document content
 * survived; a metadata note must never cost the user their edited file.
 */
const TOOL_OWNED_METADATA_KEYS = new Set(['Producer', 'CreationDate', 'ModDate']);

function normalizeMetadataValue(value: string) {
  return value.replace(/\s+/g, ' ').trim();
}

export function compareDocumentMetadata(
  source: Record<string, string>,
  output: Record<string, string>,
): {
  passed: boolean;
  problems: { key: string; sourceValue: string; outputValue: string; toolOwned: boolean }[];
} {
  const problems = comparableMetadata(source)
    .filter(([key, value]) => normalizeMetadataValue(output[key] ?? '') !== normalizeMetadataValue(value))
    .map(([key, value]) => ({
      key,
      sourceValue: value,
      outputValue: output[key] ?? '(removed)',
      toolOwned: TOOL_OWNED_METADATA_KEYS.has(key),
    }));
  return { passed: problems.length === 0, problems };
}

function featureCount(report: PdfDocumentPreflight, feature: typeof STRUCTURE_FEATURES[number][0]) {
  const value = report.features[feature];
  if ('fieldCount' in value) return value.fieldCount;
  if ('itemCount' in value) return value.itemCount;
  return value.count;
}

export async function inspectPdfForExportVerification(
  bytes: ArrayBuffer | Uint8Array,
): Promise<PdfVerificationSnapshot> {
  const source = bytes instanceof Uint8Array ? bytes.slice() : new Uint8Array(bytes.slice(0));
  // pdfjs-dist's browser build assumes a DOM/worker environment. In Node (unit
  // tests, server-side verification) it fails before parsing; the package's own
  // guidance is to use the legacy build there. The browser keeps the default
  // build so the product path is unchanged.
  //
  // Both specifiers are static on purpose. This used to compute the specifier
  // into a variable and mark the import `webpackIgnore`, which made the browser
  // run a native `import('pdfjs-dist')` with a bare package name. That cannot
  // resolve outside a bundler, so every export preview failed with
  // "Failed to resolve module specifier 'pdfjs-dist'". Letting the bundler see
  // the real specifier is what makes the browser build resolvable.
  const [{ PDFDocument }, pdfjs] = await Promise.all([
    import('pdf-lib'),
    typeof window === 'undefined'
      ? import(/* webpackIgnore: true */ 'pdfjs-dist/legacy/build/pdf.mjs')
      : import('pdfjs-dist'),
  ]);

  let pdfLibDocument;
  try {
    pdfLibDocument = await PDFDocument.load(source.slice(), { updateMetadata: false });
  } catch (error) {
    throw new Error(`pdf-lib could not reopen the exported PDF: ${error instanceof Error ? error.message : 'invalid PDF'}`);
  }

  let loadingTask;
  let pdfjsDocument;
  try {
    loadingTask = pdfjs.getDocument({ data: source.slice() });
    pdfjsDocument = await loadingTask.promise;
  } catch (error) {
    throw new Error(`PDF.js could not reopen the exported PDF: ${error instanceof Error ? error.message : 'invalid PDF'}`);
  }

  try {
    const pageText: string[] = [];
    const pageRotations: number[] = [];
    for (let pageNumber = 1; pageNumber <= pdfjsDocument.numPages; pageNumber += 1) {
      const page = await pdfjsDocument.getPage(pageNumber);
      const content = await page.getTextContent() as { items: Array<{ str?: string }> };
      pageText.push(normalizeText(content.items.map((item: { str?: string }) => item.str ?? '').join(' ')));
      pageRotations.push(((page.rotate ?? 0) % 360 + 360) % 360);
    }

    const [metadata, fieldObjects] = await Promise.all([
      pdfjsDocument.getMetadata().catch(() => null),
      pdfjsDocument.getFieldObjects().catch(() => null),
    ]);
    const preflight = await scanPdfDocumentPreflight(
      pdfjsDocument as unknown as PdfPreflightDocument,
      scanPdfSourceSignals(source),
    );
    const pdfLibPageCount = pdfLibDocument.getPageCount();
    if (pdfLibPageCount !== pdfjsDocument.numPages) {
      throw new Error(`Reader page-count mismatch: PDF.js found ${pdfjsDocument.numPages}, pdf-lib found ${pdfLibPageCount}.`);
    }

    return {
      byteLength: source.byteLength,
      pageCount: pdfjsDocument.numPages,
      pageText,
      pageRotations,
      metadata: normalizeMetadata(metadata?.info),
      formFieldNames: Object.keys(fieldObjects ?? {}).sort(),
      preflight,
      readers: { pdfjs: true, pdfLib: true },
    };
  } finally {
    await pdfjsDocument.destroy();
    await loadingTask.destroy?.();
  }
}

export type PdfTextAdditionVerification = {
  page: number;
  text: string;
};

export function verifyPdfExportSnapshots(options: {
  mode: PdfEditorExportMode;
  source: PdfVerificationSnapshot;
  output: PdfVerificationSnapshot;
  bytesEqual?: boolean;
  textReplacements?: PdfTextReplacementVerification[];
  visualTextFallback?: PdfVisualTextFallbackVerification;
  addedText?: PdfTextAdditionVerification[];
  /** Output pages whose source text was intentionally removed. */
  redactedPages?: number[];
}): PdfPostExportVerification {
  const { mode, source, output } = options;
  const checks: PdfVerificationCheck[] = [];
  const failures: string[] = [];
  const allowedLosses: string[] = mode === 'compatibility-render' ? [...COMPATIBILITY_ALLOWED_LOSSES] : [];
  const pass = (id: string, detail: string) => checks.push({ id, status: 'passed', detail });
  const fail = (id: string, detail: string) => {
    checks.push({ id, status: 'failed', detail });
    failures.push(detail);
  };

  if (output.readers.pdfjs && output.readers.pdfLib) pass('reopen', 'PDF.js and pdf-lib reopened the output.');
  else fail('reopen', 'The exported PDF did not reopen in both verification readers.');

  if (output.pageCount === source.pageCount) pass('page-count', `${output.pageCount} pages reopened.`);
  else fail('page-count', `Expected ${source.pageCount} pages, found ${output.pageCount}.`);

  const flattenedTextPages = new Set(options.visualTextFallback?.flattenedTextPages ?? []);
  if (flattenedTextPages.size > 0) {
    allowedLosses.push('searchable source text on visually flattened edited pages');
  }

  const editedPages = new Set([
    ...(options.textReplacements ?? []).map(edit => edit.page),
    ...(options.redactedPages ?? []),
    ...flattenedTextPages,
  ]);
  source.pageText.forEach((expected, index) => {
    if (editedPages.has(index + 1)) return;
    const normalized = normalizeText(expected);
    if (!normalized) return;
    const actual = normalizeText(output.pageText[index] ?? '');
    if (actual.includes(normalized)) pass(`text-${index + 1}`, `Required searchable text was retained for page ${index + 1}.`);
    else fail(`text-${index + 1}`, `Required searchable text was not found after reopening page ${index + 1}.`);
  });
  options.addedText?.forEach((addition, index) => {
    const expected = normalizeText(addition.text);
    const actual = normalizeText(output.pageText[addition.page - 1] ?? '');
    if (!expected || actual.includes(expected)) {
      pass(
        `added-text-${index + 1}`,
        `Added text on page ${addition.page} is selectable/searchable after reopening.`,
      );
    } else if (hasShapedScript(expected) && containsCodePointInventory(actual, expected)) {
      pass(
        `added-text-${index + 1}`,
        `Added text on page ${addition.page} is extractable with every character present; shaped scripts may be returned in visual order by extractors that ignore /ActualText.`,
      );
    } else {
      fail(
        `added-text-${index + 1}`,
        `Added text on page ${addition.page} was not extractable after reopening; vector text was not written correctly.`,
      );
    }
  });
  options.textReplacements?.forEach((edit, index) => {
    const sourceText = normalizeText(source.pageText[edit.page - 1] ?? '');
    const actual = normalizeText(output.pageText[edit.page - 1] ?? '');
    const original = normalizeText(edit.originalText);
    const replacement = normalizeText(edit.replacementText);
    const editsOnSamePage = (options.textReplacements ?? []).filter(
      candidate => candidate.page === edit.page,
    );
    const sameOriginalEditCount = editsOnSamePage.filter(
      candidate => normalizeText(candidate.originalText) === original,
    ).length;
    // A replacement can legitimately re-author the original string: style-only
    // edits leave the text unchanged (bold/colour/alignment), and additive
    // edits such as "Total" -> "Total: 500" keep the original as a substring.
    // The server-side structural editor removes the source glyphs and re-inserts
    // the replacement as fresh PDF text, so those re-introduced occurrences are
    // newly authored content, not un-removed source glyphs. Credit them back so
    // we do not raise false "still extractable" failures, while still catching
    // genuine cover-and-retype leftovers.
    const reintroducedByReplacements = editsOnSamePage.reduce(
      (sum, candidate) => sum + countTextOccurrences(normalizeText(candidate.replacementText), original),
      0,
    );
    const expectedMaximum = Math.max(
      0,
      countTextOccurrences(sourceText, original) - sameOriginalEditCount,
    ) + reintroducedByReplacements;
    const actualCount = countTextOccurrences(actual, original);

    if (!original || actualCount <= expectedMaximum) {
      pass(`removed-text-${index + 1}`, `Original text was absent after reopening page ${edit.page}.`);
    } else {
      fail(
        `removed-text-${index + 1}`,
        `Original text is still extractable after reopening page ${edit.page}; its occurrence count did not decrease as required.`,
      );
    }

    if (!replacement || actual.includes(replacement)) {
      pass(`edited-text-${index + 1}`, `Edited searchable text was verified on page ${edit.page}.`);
    } else {
      fail(`edited-text-${index + 1}`, `Edited searchable text was not found after reopening page ${edit.page}.`);
    }
  });

  if (mode === 'byte-preserving') {
    if (options.bytesEqual) pass('exact-bytes', 'Output bytes match the source exactly.');
    else fail('exact-bytes', 'Byte-preserving export changed the source bytes.');
  }

  if (mode !== 'compatibility-render') {
    if (JSON.stringify(output.pageRotations) === JSON.stringify(source.pageRotations)) {
      pass('rotation', 'Page rotation dictionaries were retained.');
    } else {
      fail('rotation', 'One or more page rotation dictionaries changed.');
    }

    for (const [feature, label] of STRUCTURE_FEATURES) {
      const expected = featureCount(source.preflight, feature);
      const actual = featureCount(output.preflight, feature);
      if (actual >= expected) pass(feature, `${label} retained (${actual}/${expected}).`);
      else fail(feature, `${label} contract failed (${actual}/${expected} retained).`);
    }

    const missingFormFields = source.formFieldNames.filter(name => !output.formFieldNames.includes(name));
    if (!missingFormFields.length) {
      pass('form-field-identity', 'Form field names were retained.');
    } else {
      fail('form-field-identity', `Form fields were removed or renamed: ${missingFormFields.join(', ')}.`);
    }

    if (!source.preflight.features.taggedContent.present || output.preflight.features.taggedContent.present) {
      pass('tagged-content', 'Tagged-content structure presence was retained.');
    } else {
      fail('tagged-content', 'Tagged-content structure was removed.');
    }

    const metadata = compareDocumentMetadata(source.metadata, output.metadata);
    if (metadata.passed) pass('metadata', 'Document metadata was retained.');
    else metadata.problems.forEach(({ key, sourceValue, outputValue, toolOwned }) => {
      const detail = toolOwned
        ? `Document metadata field ${key} was refreshed by the editing pipeline (the saving tool stamps its own value; document content is unaffected).`
        : `Document metadata field ${key} changed or was removed (source: "${sourceValue}", exported: "${outputValue}"). Pages, text, and structure were verified intact.`;
      allowedLosses.push(`document metadata field ${key}`);
      checks.push({ id: `metadata-${key}`, status: 'allowed-loss', detail });
    });
  } else {
    allowedLosses.forEach(detail => checks.push({ id: `allowed-${detail}`, status: 'allowed-loss', detail }));
    flattenedTextPages.forEach(page => {
      pass(
        `visual-text-fallback-${page}`,
        `Page ${page} was intentionally flattened after structural text editing could not be verified.`,
      );
    });
  }

  return {
    ok: failures.length === 0,
    mode,
    verifiedAt: Date.now(),
    checks,
    failures,
    allowedLosses,
    output,
  };
}

export async function verifyGeneratedPdf(options: {
  mode: PdfEditorExportMode;
  sourceBytes: ArrayBuffer | Uint8Array;
  outputBytes: ArrayBuffer | Uint8Array;
  textReplacements?: PdfTextReplacementVerification[];
  visualTextFallback?: PdfVisualTextFallbackVerification;
  /**
   * Text the user redacted. Unlike a rewrite, absence is the only acceptable
   * result: the W0 verifier decodes the produced content streams and refuses to
   * call a page clean when it cannot read it.
   */
  addedText?: PdfTextAdditionVerification[];
  redactedPages?: number[];
  /**
   * Text the final output must no longer draw. Checked against content streams,
   * not reader extraction, so a visually hidden glyph is still a failure.
   */
  redactions?: ContentRemovalExpectation[];
}): Promise<PdfPostExportVerification> {
  try {
    const [source, output] = await Promise.all([
      inspectPdfForExportVerification(options.sourceBytes),
      inspectPdfForExportVerification(options.outputBytes),
    ]);
    const sourceBytes = options.sourceBytes instanceof Uint8Array
      ? options.sourceBytes
      : new Uint8Array(options.sourceBytes);
    const outputBytes = options.outputBytes instanceof Uint8Array
      ? options.outputBytes
      : new Uint8Array(options.outputBytes);
    const bytesEqual = sourceBytes.byteLength === outputBytes.byteLength
      && sourceBytes.every((value, index) => value === outputBytes[index]);
    const verification = verifyPdfExportSnapshots({
      mode: options.mode,
      source,
      output,
      bytesEqual,
      textReplacements: options.textReplacements,
      visualTextFallback: options.visualTextFallback,
      addedText: options.addedText,
      redactedPages: options.redactedPages,
    });

    if (!options.redactions?.length) return verification;

    // The snapshot checks answer "is the intended content still there". For
    // redaction the question is the opposite, and extraction is not enough: the
    // glyphs must be gone from the content stream. This is the W0 proof.
    //
    // Repeated source strings are grouped before checking: redacting one of two
    // identical runs on a page must leave exactly one occurrence, not zero, or
    // a correct removal would be reported as retained.
    const grouped = new Map<string, { page?: number; text: string; label: string; count: number }>();
    for (const expectation of options.redactions) {
      const key = `${expectation.page ?? 'all'}:${normalizeText(expectation.text)}`;
      const existing = grouped.get(key);
      if (existing) existing.count += 1;
      else grouped.set(key, { ...expectation, count: 1 });
    }
    const redactions = [...grouped.values()].map((expectation) => {
      const sourceCount = typeof expectation.page === 'number'
        ? countTextOccurrences(
            normalizeText(source.pageText[expectation.page - 1] ?? ''),
            normalizeText(expectation.text),
          )
        : 0;
      return {
        ...expectation,
        maxOccurrences: Math.max(0, sourceCount - expectation.count),
      };
    });
    const removal = await verifyPdfEditorContentRemoval(outputBytes, redactions);
    const removalChecks: PdfVerificationCheck[] = removal.findings.map((finding, index) => ({
      id: `redaction-${index + 1}`,
      status: finding.status === 'removed' ? 'passed' : 'failed',
      detail: finding.status === 'removed'
        ? `${finding.label}: the source text is absent from the exported content streams.`
        : `${finding.label}: ${finding.reason ?? 'removal could not be proven.'}`,
    }));
    const removalFailures = removal.findings
      .filter(finding => finding.status !== 'removed')
      .map(finding => `${finding.label}: ${finding.reason ?? 'removal could not be proven.'}`);
    return {
      ...verification,
      ok: verification.ok && removal.status === 'clean',
      checks: [...verification.checks, ...removalChecks],
      failures: [...verification.failures, ...removalFailures],
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'The exported PDF could not be verified.';
    return {
      ok: false,
      mode: options.mode,
      verifiedAt: Date.now(),
      checks: [{ id: 'reopen', status: 'failed', detail: message }],
      failures: [message],
      allowedLosses: [],
      output: null,
    };
  }
}

/**
 * Extend an ordinary export verification with the W0 content-removal proof.
 *
 * Fail-safe by construction: a page the verifier cannot decode, or whose text
 * is drawn through a font encoding it cannot map, makes the finding
 * `unverified`, and `unverified` fails the export exactly like a retained
 * occurrence. "We could not check" is never reported as removed.
 *
 * A verifier crash is also a failure, not a pass: the outer `try` already
 * covers snapshot inspection, but this second byte-level pass is awaited
 * separately so a decoder bug cannot turn redaction into an unverified download.
 */
export async function applyContentRemovalVerification(
  verification: PdfPostExportVerification,
  outputBytes: Uint8Array,
  expectations?: ContentRemovalExpectation[],
): Promise<PdfPostExportVerification> {
  if (!expectations || expectations.length === 0) return verification;

  try {
    const report = await verifyPdfEditorContentRemoval(outputBytes, expectations);
    const checks: PdfVerificationCheck[] = report.findings.map((finding, index) => ({
      id: `content-removal-${index + 1}`,
      status: finding.status === 'removed' ? 'passed' : 'failed',
      detail: finding.status === 'removed'
        ? `${finding.label}: "${finding.text}" is not drawn in the exported file.`
        : finding.reason
          ?? `${finding.label}: removal could not be proven.`,
    }));
    if (report.pagesUndecodable.length > 0) {
      checks.push({
        id: 'content-removal-decodable',
        status: 'failed',
        detail:
          `Page ${report.pagesUndecodable.join(', ')} could not be decoded, so absence of `
          + 'redacted text cannot be proven on it.',
      });
    }
    const removalFailures = checks
      .filter((check) => check.status === 'failed')
      .map((check) => check.detail);
    return {
      ...verification,
      ok: verification.ok && report.status === 'clean',
      checks: [...verification.checks, ...checks],
      failures: [...verification.failures, ...removalFailures],
    };
  } catch (error) {
    const message = error instanceof Error
      ? error.message
      : 'The redaction could not be verified against the exported bytes.';
    return {
      ...verification,
      ok: false,
      checks: [
        ...verification.checks,
        { id: 'content-removal', status: 'failed', detail: message },
      ],
      failures: [...verification.failures, message],
    };
  }
}
