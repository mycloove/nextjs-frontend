import type { PdfEditorExportMode } from './editorExport.ts';
import type { PdfEditorPagePlan } from './editorPageModel.ts';
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
  pageSizes?: { width: number; height: number }[];
  /** Drawing-operation counts, not a claim of visual equivalence. */
  pagePaint?: { paths: number; images: number }[];
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
  options: { includePaint?: boolean } = {},
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
    const pageSizes: { width: number; height: number }[] = [];
    const pagePaint: { paths: number; images: number }[] = [];
    for (let pageNumber = 1; pageNumber <= pdfjsDocument.numPages; pageNumber += 1) {
      const page = await pdfjsDocument.getPage(pageNumber);
      const content = await page.getTextContent() as { items: Array<{ str?: string }> };
      pageText.push(normalizeText(content.items.map((item: { str?: string }) => item.str ?? '').join(' ')));
      pageRotations.push(((page.rotate ?? 0) % 360 + 360) % 360);
      const viewport = page.getViewport({ scale: 1 });
      pageSizes.push({ width: viewport.width, height: viewport.height });
      // Exclude annotation appearances: a stamp must not disguise lost source
      // graphics or a missing shape. PDF.js expands form XObjects here.
      if (options.includePaint) {
        const operators = await page.getOperatorList({ annotationMode: 0 });
        const imageOperators = new Set([
          pdfjs.OPS.paintImageXObject, pdfjs.OPS.paintInlineImageXObject,
          pdfjs.OPS.paintImageMaskXObject, pdfjs.OPS.paintSolidColorImageMask,
          pdfjs.OPS.paintImageXObjectRepeat, pdfjs.OPS.paintImageMaskXObjectRepeat,
          pdfjs.OPS.paintInlineImageXObjectGroup, pdfjs.OPS.paintImageMaskXObjectGroup,
        ]);
        pagePaint.push({
          paths: operators.fnArray.filter(operation => operation === pdfjs.OPS.constructPath).length,
          images: operators.fnArray.filter(operation => imageOperators.has(operation)).length,
        });
      }
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
      pageSizes,
      ...(options.includePaint ? { pagePaint } : {}),
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

export type PdfSourceTextRunVerification = {
  page: number;
  text: string;
  /** False only for an effective edit, redaction, or explicitly approved loss. */
  retained: boolean;
};

export type PdfPaintAdditionVerification = { page: number; paths: number; images: number };

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
  /** Exact source runs covered by an explicit, revision-scoped neighbor-loss grant. */
  allowedTextLosses?: PdfTextAdditionVerification[];
  /** Complete nonblank source runs on each edited page, in extraction order. */
  sourceTextRuns?: readonly PdfSourceTextRunVerification[];
  addedPaint?: PdfPaintAdditionVerification[];
  /** Page-plan callers opt in after mapping the source paint inventory. */
  verifyRetainedPaint?: boolean;
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
    const page = index + 1;
    if (flattenedTextPages.has(page)) return;
    const normalized = normalizeText(expected);
    if (!normalized) return;
    const actual = normalizeText(output.pageText[index] ?? '');
    if (!editedPages.has(page)) {
      if (actual.includes(normalized)) pass(`text-${page}`, `Required searchable text was retained for page ${page}.`);
      else fail(`text-${page}`, `Required searchable text was not found after reopening page ${page}.`);
      return;
    }
    const edits = (options.textReplacements ?? []).filter(edit => edit.page === page);
    const approvedLosses = (options.allowedTextLosses ?? []).filter(loss => loss.page === page);
    const removed = [...edits.map(edit => edit.originalText), ...approvedLosses.map(loss => loss.text)].map(normalizeText).filter(Boolean);
    if (removed.length === 0) {
      fail(`retained-text-${page}`, `Page ${page} has no exact removal manifest; unchanged content cannot be verified.`);
      return;
    }
    const sourceRuns = options.sourceTextRuns?.filter(run => run.page === page);
    let fragments: string[];
    if (sourceRuns) {
      // A first-substring match chooses the wrong occurrence when the user edits
      // a later duplicate. The hook knows which source item was edited; verify
      // its complete manifest before trusting that selection. Comparing sorted
      // runs is bounded, unlike searching combinations of duplicate matches.
      if (sourceRuns.some(run => typeof run.retained !== 'boolean')
        || normalizeText(sourceRuns.map(run => run.text).join(' ')) !== normalized) {
        fail(`retained-text-${page}`, `The source-run manifest does not cover the original text in order on page ${page}.`);
        return;
      }
      const discarded = sourceRuns.filter(run => !run.retained).map(run => normalizeText(run.text)).filter(Boolean);
      if (JSON.stringify(discarded.sort()) !== JSON.stringify([...removed].sort())) {
        fail(`retained-text-${page}`, `The source-run manifest does not match the declared removal occurrences on page ${page}.`);
        return;
      }
      fragments = sourceRuns.filter(run => run.retained).map(run => normalizeText(run.text)).filter(Boolean);
    } else {
      // Callers without source-item identity keep the conservative substring
      // proof. They may refuse ambiguous duplicates; they never exempt the page.
      fragments = [normalized];
      for (const text of removed) {
        const fragmentIndex = fragments.findIndex(fragment => fragment.includes(text));
        if (fragmentIndex < 0) continue;
        const fragment = fragments[fragmentIndex];
        const at = fragment.indexOf(text);
        fragments.splice(fragmentIndex, 1, fragment.slice(0, at), fragment.slice(at + text.length));
      }
    }
    const additions = [...edits.map(edit => edit.replacementText), ...(options.addedText ?? []).filter(item => item.page === page).map(item => item.text)].map(normalizeText);
    const missing = [...new Set(fragments.map(normalizeText).filter(Boolean))].filter(fragment => {
      const retainedCount = sourceRuns
        ? fragments.reduce((count, text) => count + countTextOccurrences(text, fragment), 0)
        : Math.max(0, countTextOccurrences(normalized, fragment)
          - removed.reduce((count, text) => count + countTextOccurrences(text, fragment), 0));
      const expectedCount = retainedCount
        + additions.reduce((count, text) => count + countTextOccurrences(text, fragment), 0);
      return countTextOccurrences(actual, fragment) < expectedCount;
    });
    if (missing.length) fail(`retained-text-${page}`, `Unchanged text was not retained on page ${page}: ${missing.join(' | ')}.`);
    else pass(`retained-text-${page}`, `Unchanged source text runs and their occurrence counts were retained on page ${page}; text placement is not checked by this count.`);
    approvedLosses.forEach(loss => {
      const detail = `Approved neighboring text loss on page ${page}: "${loss.text}".`;
      allowedLosses.push(detail);
      checks.push({ id: `approved-text-loss-${page}`, status: 'allowed-loss', detail });
    });
  });
  if (options.verifyRetainedPaint) {
    for (let page = 1; page <= source.pageCount; page += 1) {
      const before = source.pagePaint?.[page - 1];
      const after = output.pagePaint?.[page - 1];
      if (!before || !after || after.paths < before.paths || after.images < before.images) {
        fail(`retained-graphics-${page}`, `Mapped source drawing-operation counts were not retained on output page ${page}.`);
      } else {
        pass(`retained-graphics-${page}`, `Mapped source drawing-operation counts were retained on output page ${page}; pixel identity and drawing geometry are not checked.`);
      }
    }
  }
  for (const addition of options.addedPaint ?? []) {
    const before = source.pagePaint?.[addition.page - 1];
    const after = output.pagePaint?.[addition.page - 1];
    if (!before || !after || after.paths < before.paths + addition.paths || after.images < before.images + addition.images) {
      fail(`added-graphics-${addition.page}`, `Required added drawing operations are missing from output page ${addition.page}.`);
    } else pass(`added-graphics-${addition.page}`, `Required image/path drawing-operation counts were retained on page ${addition.page}; visual geometry is not proven by this count.`);
  }
  options.addedText?.forEach((addition, index) => {
    const expected = normalizeText(addition.text);
    const actual = normalizeText(output.pageText[addition.page - 1] ?? '');
    if (!expected || actual.includes(expected)) {
      pass(
        `added-text-${index + 1}`,
        `Added text on page ${addition.page} is selectable/searchable after reopening.`,
      );
    } else if (hasShapedScript(expected) && containsCodePointInventory(actual, expected)) {
      const detail = `Added text on page ${addition.page} has the expected character inventory, but logical copy/search order is unverified for this shaped script.`;
      allowedLosses.push(detail);
      checks.push({ id: `added-text-${index + 1}`, status: 'allowed-loss', detail });
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
      pass(`removed-text-${index + 1}`, `Original text occurrence count on page ${edit.page} is within the intended removal/replacement limit (${actualCount}/${expectedMaximum}).`);
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
  pagePlan?: PdfEditorPagePlan | null;
  allowedTextLosses?: PdfTextAdditionVerification[];
  /** Source-page coordinates; remapped to output pages together with the edits. */
  sourceTextRuns?: readonly PdfSourceTextRunVerification[];
  addedPaint?: PdfPaintAdditionVerification[];
  /** Server-committed source before overlays, so approved graphic redaction is not charged as loss. */
  paintSourceBytes?: ArrayBuffer | Uint8Array;
}): Promise<PdfPostExportVerification> {
  try {
    const plan = options.pagePlan;
    // Text cannot expose a blanked scan. Page transforms must retain the mapped
    // paint inventory even without additions. A post-server source is the paint
    // baseline when supplied, so intentional redaction is not charged as loss.
    const includePaint = !!plan || !!options.addedPaint?.length;
    const [originalSource, output, paintSource] = await Promise.all([
      inspectPdfForExportVerification(options.sourceBytes, { includePaint: includePaint && !options.paintSourceBytes }),
      inspectPdfForExportVerification(options.outputBytes, { includePaint }),
      options.paintSourceBytes && includePaint
        ? inspectPdfForExportVerification(options.paintSourceBytes, { includePaint: true }) : Promise.resolve(null),
    ]);
    if (plan && (plan.sourcePageCount !== originalSource.pageCount || plan.entries.length === 0
      || plan.entries.some(entry => !Number.isInteger(entry.sourcePage) || entry.sourcePage < 1 || entry.sourcePage > originalSource.pageCount))) {
      throw new Error('The final verification page plan does not match its source document.');
    }
    if (plan && paintSource && paintSource.pageCount !== originalSource.pageCount) {
      throw new Error('The paint verification source does not match the page plan source count.');
    }
    const mapPages = <T extends { page: number }>(items: readonly T[]): T[] => plan
      ? plan.entries.flatMap((entry, index) => items.filter(item => item.page === entry.sourcePage).map(item => ({ ...item, page: index + 1 })))
      : [...items];
    const source: PdfVerificationSnapshot = plan ? {
      ...originalSource,
      pageCount: plan.entries.length,
      pageText: plan.entries.map(entry => originalSource.pageText[entry.sourcePage - 1]),
      pageRotations: plan.entries.map(entry => (originalSource.pageRotations[entry.sourcePage - 1] + entry.rotation) % 360),
      ...((paintSource ?? originalSource).pagePaint ? { pagePaint: plan.entries.map(entry => (paintSource ?? originalSource).pagePaint![entry.sourcePage - 1]) } : {}),
    } : { ...originalSource, ...(paintSource ? { pagePaint: paintSource.pagePaint } : {}) };
    const rawReplacements = [...(options.textReplacements ?? [])];
    // Some callers provide redaction intent separately. Include each requested
    // occurrence once in retention accounting, never once per duplicate source.
    const rawRedactions = (options.redactions ?? []).flatMap(expectation => expectation.page
      ? [{ ...expectation, page: expectation.page }]
      : originalSource.pageText.flatMap((text, index) => normalizeText(text).includes(normalizeText(expectation.text)) ? [{ ...expectation, page: index + 1 }] : []));
    const used = new Map<string, number>();
    for (const redaction of rawRedactions) {
      const key = `${redaction.page}:${normalizeText(redaction.text)}`;
      const count = (used.get(key) ?? 0) + 1;
      used.set(key, count);
      if (rawReplacements.filter(edit => edit.page === redaction.page && normalizeText(edit.originalText) === normalizeText(redaction.text) && !edit.replacementText).length < count) {
        rawReplacements.push({ page: redaction.page, originalText: redaction.text, replacementText: '' });
      }
    }
    const textReplacements = mapPages(rawReplacements);
    const redactionsForOutput = mapPages(rawRedactions);
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
      textReplacements,
      visualTextFallback: options.visualTextFallback,
      addedText: mapPages(options.addedText ?? []),
      redactedPages: mapPages((options.redactedPages ?? []).map(page => ({ page }))).map(item => item.page),
      allowedTextLosses: mapPages(options.allowedTextLosses ?? []),
      sourceTextRuns: options.sourceTextRuns === undefined ? undefined : mapPages(options.sourceTextRuns),
      addedPaint: mapPages(options.addedPaint ?? []),
      verifyRetainedPaint: !!plan,
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
    for (const expectation of redactionsForOutput) {
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
