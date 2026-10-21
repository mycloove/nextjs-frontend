import 'regenerator-runtime/runtime.js';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
// `regenerator-runtime` must load before fontkit, which references the global
// without defining it; the same order rule the product's embedder follows.
import fontkit from '@pdf-lib/fontkit';
import { PDFDocument, StandardFonts } from 'pdf-lib';

import {
  extractContentStreamText,
  extractPdfPageText,
  isContentRemovalProven,
  parseToUnicodeCMap,
  verifyPdfEditorContentRemoval,
} from './editorContentRemoval.ts';
import { applyContentRemovalVerification } from './editorExportVerification.ts';
import type { PdfPostExportVerification } from './editorExportVerification.ts';
import {
  exportStructurePreservingPdf,
  type PdfEditorTextMutation,
} from './editorExport.ts';
import { verifyGeneratedPdf } from './editorExportVerification.ts';

// pdfjs-dist also calls `Promise.try`, which Node 22.12 does not provide while
// the browser targets do. This is a test-harness shim, not a product polyfill.
if (typeof (Promise as { try?: unknown }).try !== 'function') {
  (Promise as unknown as { try: <T>(fn: () => T) => Promise<T> }).try = <T>(fn: () => T) => (
    new Promise<T>((resolve) => resolve(fn()))
  );
}

// pdfjs-dist's browser build is also used by the product verifier, and it
// constructs a DOMMatrix at module scope. Browsers always have it; Node does
// not. Text extraction only needs the 2D matrix shape with a handful of
// operations, so this keeps the real verifier under test instead of mocking it.
if (!(globalThis as { DOMMatrix?: unknown }).DOMMatrix) {
  (globalThis as { DOMMatrix?: unknown }).DOMMatrix = class DOMMatrix {
    a = 1; b = 0; c = 0; d = 1; e = 0; f = 0;
    constructor(init?: number[] | { a?: number; b?: number; c?: number; d?: number; e?: number; f?: number }) {
      if (Array.isArray(init)) {
        [this.a, this.b, this.c, this.d, this.e, this.f] = init;
      } else if (init) {
        this.a = init.a ?? 1; this.b = init.b ?? 0;
        this.c = init.c ?? 0; this.d = init.d ?? 1;
        this.e = init.e ?? 0; this.f = init.f ?? 0;
      }
    }
    multiplySelf(other: { a: number; b: number; c: number; d: number; e: number; f: number }) {
      const { a, b, c, d, e, f } = this;
      this.a = a * other.a + b * other.c;
      this.b = a * other.b + b * other.d;
      this.c = c * other.a + d * other.c;
      this.d = c * other.b + d * other.d;
      this.e = e * other.a + f * other.c + other.e;
      this.f = e * other.b + f * other.d + other.f;
      return this;
    }
    translateSelf(x = 0, y = 0) {
      this.e += this.a * x + this.c * y;
      this.f += this.b * x + this.d * y;
      return this;
    }
    scaleSelf(x = 1, y = x) {
      this.a *= x; this.b *= x; this.c *= y; this.d *= y;
      return this;
    }
  };
}

// pdfjs hashes fingerprint bytes with the `Uint8Array#toHex` proposal, which
// Node did not ship in this runtime. Browsers have it; tests need the same API.
// pdfjs also uses the `Map#getOrInsertComputed` proposal at module scope.
if (typeof (Map.prototype as { getOrInsertComputed?: unknown }).getOrInsertComputed !== 'function') {
  (Map.prototype as {
    getOrInsertComputed?: <K, V>(key: K, compute: (key: K) => V) => V;
  }).getOrInsertComputed = function getOrInsertComputed<K, V>(this: Map<K, V>, key: K, compute: (key: K) => V): V {
    if (!this.has(key)) this.set(key, compute(key));
    return this.get(key) as V;
  };
}
if (typeof (Uint8Array.prototype as { toHex?: unknown }).toHex !== 'function') {
  (Uint8Array.prototype as { toHex?: () => string }).toHex = function toHex() {
    return Array.from(this as unknown as Uint8Array, byte => byte.toString(16).padStart(2, '0')).join('');
  };
}

// The product verifier imports the same pdfjs singleton. In Node there is no
// Next-bundled worker URL, so point it at the package's worker module; without
// this every `getDocument()` call fails before it can parse the bytes. Imported
// dynamically so the DOM/Map/Uint8Array shims above exist first.
const pdfjs = await import('pdfjs-dist');
pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  '../../../node_modules/pdfjs-dist/build/pdf.worker.mjs',
  import.meta.url,
).toString();

const CONFIDENTIAL = 'Annual salary: 4,250,000 BDT';

async function buildSourcePdf(lines: string[][]): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);

  for (const pageLines of lines) {
    const page = pdf.addPage([600, 400]);
    pageLines.forEach((line, index) => {
      page.drawText(line, { x: 60, y: 320 - index * 24, size: 13, font });
    });
  }

  return pdf.save();
}

function textEdit(overrides: Partial<PdfEditorTextMutation> = {}): PdfEditorTextMutation {
  return {
    page: 1,
    x: 60,
    y: 80,
    width: 320,
    height: 20,
    sourceFontSize: 13,
    text: 'Annual salary: [redacted]',
    fontSize: 13,
    fontFamily: 'Helvetica',
    color: '#111111',
    bold: false,
    italic: false,
    underline: false,
    align: 'left',
    lineHeight: 1.15,
    ...overrides,
  };
}

test('content stream text extraction reads literal, hex and array-form operands', () => {
  const stream = new TextEncoder().encode(
    'BT /F1 12 Tf (Hello) Tj 0 -14 Td [(Wor) -20 (ld)] TJ 0 -14 Td <00480069> Tj ET',
  );
  const extracted = extractContentStreamText(stream);

  assert.equal(extracted.showOperatorCount, 3);
  assert.equal(extracted.text, 'HelloWorldHi');
  assert.equal(extracted.confidence, 'readable');
});

test('extraction ignores numeric operands and non-text operators', () => {
  const stream = new TextEncoder().encode(
    '1 0 0 1 60 320 cm 0.5 0.5 0.5 rg 10 20 30 40 re f BT (Kept) Tj ET',
  );
  const extracted = extractContentStreamText(stream);

  assert.equal(extracted.text, 'Kept');
  assert.equal(extracted.showOperatorCount, 1);
});

test('a string operand not followed by a show operator is not counted as drawn text', () => {
  // `/Title (Draft) ` inside a marked-content dictionary is metadata, not page text.
  const stream = new TextEncoder().encode('BT /Span <</Title (Draft)>> BDC (Shown) Tj EMC ET');
  const extracted = extractContentStreamText(stream);

  assert.equal(extracted.text.includes('Shown'), true);
  assert.equal(extracted.text.includes('Draft'), false);
});

test('escaped parentheses and octal escapes decode without truncating the run', () => {
  const stream = new TextEncoder().encode(String.raw`BT (Net \(after tax\)\040paid) Tj ET`);
  const extracted = extractContentStreamText(stream);

  assert.equal(extracted.text, 'Net (after tax) paid');
});

/**
 * A `/ToUnicode` CMap maps character codes back to characters. Parsing it is
 * what makes identity-H glyph indices readable again — without it, a redaction
 * on any embedded-subset document was refused as unverifiable.
 */
test('a /ToUnicode CMap parses codespacerange, bfchar and both bfrange forms', () => {
  const parsed = parseToUnicodeCMap(`
    1 begincodespacerange
    <0000> <FFFF>
    endcodespacerange
    2 beginbfchar
    <0003> <0020>
    <0004> <0031>
    endbfchar
    2 beginbfrange
    <0020> <0022> <0041>
    <0030> <0031> [<0058> <0059>]
    endbfrange
  `);

  assert.equal(parsed?.codeBytes, 2);
  assert.equal(parsed?.map.get(0x0003), ' ');
  assert.equal(parsed?.map.get(0x0004), '1');
  assert.equal(parsed?.map.get(0x0020), 'A');
  assert.equal(parsed?.map.get(0x0022), 'C');
  assert.equal(parsed?.map.get(0x0030), 'X');
  assert.equal(parsed?.map.get(0x0031), 'Y');
});

test('a CMap with no mappings is rejected so the caller stays fail-safe', () => {
  assert.equal(parseToUnicodeCMap('1 begincodespacerange <0000> <FFFF> endcodespacerange'), null);
});

test('identity-H glyph codes decode through the active Tf font map', () => {
  const stream = new TextEncoder().encode('BT /F1 12 Tf <000100020003> Tj ET');
  const fonts = new Map([['F1', {
    codeBytes: 2,
    toUnicode: new Map([[1, 'A'], [2, 'B'], [3, 'C']]),
  }]]);

  const extracted = extractContentStreamText(stream, fonts);
  assert.equal(extracted.text, 'ABC');
  assert.equal(extracted.confidence, 'readable');
});

test('glyph codes without a usable font map stay opaque, never guessed', () => {
  const unmappedCode = new TextEncoder().encode('BT /F1 12 Tf <00010099> Tj ET');
  const fonts = new Map([['F1', {
    codeBytes: 2,
    toUnicode: new Map([[1, 'A']]),
  }]]);

  assert.equal(extractContentStreamText(unmappedCode, fonts).confidence, 'opaque');
  // No font map at all keeps the old fail-safe reading of non-textual bytes.
  const noFontMap = new TextEncoder().encode('BT /F1 12 Tf <11012202> Tj ET');
  assert.equal(extractContentStreamText(noFontMap).confidence, 'opaque');
});

async function buildEmbeddedFontPdf(lines: string[]): Promise<Uint8Array> {
  const fontBytes = await readFile(
    new URL('../../../public/fonts/pdf-editor/LiberationSans-Regular.ttf', import.meta.url),
  );
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  const font = await pdf.embedFont(new Uint8Array(fontBytes), { subset: true });
  const page = pdf.addPage([600, 400]);
  lines.forEach((line, index) => {
    page.drawText(line, { x: 60, y: 320 - index * 24, size: 13, font });
  });
  return pdf.save();
}

/**
 * Regression for the reported failure: a real embedded subset font draws
 * identity-H glyph indices, which the decoder could not map back to characters.
 * The redacted text could then never be *proven* absent and the export was
 * refused with "draws text through an embedded font encoding we cannot map back
 * to characters". Reading the page's `/ToUnicode` map restores the proof — and
 * the same fix removes the mirror-image bug where unmapped glyph bytes were
 * misread as readable text and a still-present secret was called removed.
 */
test('text drawn with an embedded subset font is decoded and verified via /ToUnicode', async () => {
  const source = await buildEmbeddedFontPdf(['Employment Contract', CONFIDENTIAL]);
  const pages = await extractPdfPageText(source);
  assert.equal(pages[0].status, 'decoded');
  assert.equal(pages[0].confidence, 'readable');
  assert.ok(pages[0].text.includes(CONFIDENTIAL), pages[0].text);

  const retained = await verifyPdfEditorContentRemoval(source, [
    { label: 'Redacted text on page 1', text: CONFIDENTIAL, page: 1 },
  ]);
  assert.equal(retained.status, 'retained');

  const cleaned = await buildEmbeddedFontPdf(['Employment Contract', '[redacted]']);
  const removed = await verifyPdfEditorContentRemoval(cleaned, [
    { label: 'Redacted text on page 1', text: CONFIDENTIAL, page: 1 },
  ]);
  assert.equal(removed.status, 'clean', removed.findings[0].reason);
  assert.equal(isContentRemovalProven(removed), true);
});

test('page text extraction reports the text each page actually draws', async () => {
  const source = await buildSourcePdf([
    ['Employment Contract', CONFIDENTIAL],
    ['Signature page'],
  ]);

  const pages = await extractPdfPageText(source);

  assert.equal(pages.length, 2);
  assert.equal(pages[0].status, 'decoded');
  assert.ok(pages[0].text.includes(CONFIDENTIAL));
  assert.ok(pages[1].text.includes('Signature page'));
});

test('a document that cannot be parsed is reported as undecodable, never as clean', async () => {
  const garbage = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37, 0x00, 0x01]);

  const pages = await extractPdfPageText(garbage);
  assert.equal(pages[0].status, 'undecodable');
  assert.match(pages[0].reason ?? '', /could not be parsed/);

  const report = await verifyPdfEditorContentRemoval(garbage, [
    { label: 'Salary', text: CONFIDENTIAL },
  ]);
  assert.equal(report.status, 'unverified');
  assert.equal(isContentRemovalProven(report), false);
});

/**
 * This is the W0 blocker test.
 *
 * The editor calls this exact function when the user edits text on an
 * original-size page. It documents the current, shipping behaviour: the white
 * cover rectangle hides the old text visually, but the bytes remain and any
 * extractor recovers them.
 *
 * When W3 routes text edits through real content removal, this test must be
 * changed to assert `status: 'clean'`. Until then it must keep failing loudly if
 * anyone claims the export sanitizes anything.
 */
test('KNOWN DEFECT: structure-preserving text edit leaves the original text in the file', async () => {
  const source = await buildSourcePdf([['Employment Contract', CONFIDENTIAL]]);

  const exported = await exportStructurePreservingPdf({
    source,
    textMutations: [textEdit()],
  });

  const report = await verifyPdfEditorContentRemoval(exported, [
    { label: 'Salary line', text: CONFIDENTIAL, page: 1 },
  ]);

  assert.equal(report.status, 'retained');
  assert.equal(isContentRemovalProven(report), false);
  assert.deepEqual(report.findings[0].pages, [1]);
  assert.match(report.findings[0].reason ?? '', /still drawn on page 1/);
  assert.match(report.summary, /still present in the exported file/);
});

test('the replacement text is added while the original is retained, so both coexist', async () => {
  const source = await buildSourcePdf([['Employment Contract', CONFIDENTIAL]]);

  const exported = await exportStructurePreservingPdf({
    source,
    textMutations: [textEdit({ text: 'Annual salary: [redacted]' })],
  });

  const pages = await extractPdfPageText(exported);
  const pageText = pages[0].text;

  // Both the new value and the value the user believed they replaced are present.
  assert.ok(pageText.includes('Annual salary: [redacted]'));
  assert.ok(pageText.includes(CONFIDENTIAL));
});

test('removal verification is scoped to the requested page', async () => {
  const source = await buildSourcePdf([
    ['Page one summary'],
    ['Page two', CONFIDENTIAL],
  ]);

  const onPageOne = await verifyPdfEditorContentRemoval(source, [
    { label: 'Salary', text: CONFIDENTIAL, page: 1 },
  ]);
  assert.equal(onPageOne.status, 'clean');

  const acrossDocument = await verifyPdfEditorContentRemoval(source, [
    { label: 'Salary', text: CONFIDENTIAL },
  ]);
  assert.equal(acrossDocument.status, 'retained');
  assert.deepEqual(acrossDocument.findings[0].pages, [2]);
});

test('verification tolerates the operand splitting that PDF text runs introduce', async () => {
  // pdf-lib may split a run across operands; normalization must still match.
  const stream = new TextEncoder().encode('BT [(Annual salary: 4,250,000) -18 ( BDT)] TJ ET');
  const extracted = extractContentStreamText(stream);

  assert.equal(extracted.text.replace(/\s+/g, ' '), CONFIDENTIAL);
});

test('a page absent from the export is unverified rather than assumed removed', async () => {
  const source = await buildSourcePdf([['Only page']]);

  const report = await verifyPdfEditorContentRemoval(source, [
    { label: 'Salary', text: CONFIDENTIAL, page: 4 },
  ]);

  assert.equal(report.status, 'unverified');
  assert.match(report.findings[0].reason ?? '', /not present in the exported document/);
});

test('an empty expectation cannot be reported as proof of removal', async () => {
  const source = await buildSourcePdf([['Only page']]);

  const report = await verifyPdfEditorContentRemoval(source, [
    { label: 'Blank', text: '   ' },
  ]);

  assert.equal(report.status, 'unverified');
  assert.equal(isContentRemovalProven(report), false);
});

test('removal is confirmed when the text was never in the document', async () => {
  const source = await buildSourcePdf([['Employment Contract', 'Position: Engineer']]);

  const report = await verifyPdfEditorContentRemoval(source, [
    { label: 'Salary', text: CONFIDENTIAL },
  ]);

  assert.equal(report.status, 'clean');
  assert.equal(isContentRemovalProven(report), true);
  assert.equal(report.findings[0].status, 'removed');
  assert.equal(report.pagesUndecodable.length, 0);
});

function baseVerification(): PdfPostExportVerification {
  return {
    ok: true,
    mode: 'compatibility-render',
    verifiedAt: 0,
    checks: [],
    failures: [],
    allowedLosses: [],
    output: null,
  };
}

test('redaction export verification fails when the source text survives the rebuild', async () => {
  const output = await buildSourcePdf([
    ['Employment Contract', CONFIDENTIAL],
  ]);

  const verification = await applyContentRemovalVerification(
    baseVerification(),
    output,
    [{ label: 'Salary on page 1', text: CONFIDENTIAL, page: 1 }],
  );

  assert.equal(verification.ok, false);
  assert.equal(
    verification.checks.some((check) => check.id === 'content-removal-1' && check.status === 'failed'),
    true,
  );
  assert.match(verification.failures.join(' '), /still drawn|recoverable/i);
});

test('redaction export verification passes only when the rebuilt bytes no longer draw the text', async () => {
  const output = await buildSourcePdf([
    ['Employment Contract', '[redacted]'],
  ]);

  const verification = await applyContentRemovalVerification(
    baseVerification(),
    output,
    [{ label: 'Salary on page 1', text: CONFIDENTIAL, page: 1 }],
  );

  assert.equal(verification.ok, true, verification.failures.join(' '));
  assert.equal(
    verification.checks.some((check) => check.id === 'content-removal-1' && check.status === 'passed'),
    true,
  );
});

test('an unverifiable redaction page is a failed export, never a clean one', async () => {
  const output = await buildSourcePdf([
    ['Employment Contract', '[redacted]'],
  ]);

  const verification = await applyContentRemovalVerification(
    baseVerification(),
    output,
    [{ label: 'Salary on page 9', text: CONFIDENTIAL, page: 9 }],
  );

  assert.equal(verification.ok, false);
  assert.equal(
    verification.checks.some((check) => check.id === 'content-removal-1' && check.status === 'failed'),
    true,
  );
});

test('redaction verification fails when the glyphs are still drawn in the content stream', async () => {
  const source = await buildSourcePdf([[CONFIDENTIAL]]);
  const removed = await buildSourcePdf([[]]);

  const passed = await verifyGeneratedPdf({
    mode: 'structure-preserving',
    sourceBytes: source,
    outputBytes: removed,
    redactedPages: [1],
    redactions: [{ label: 'Salary on page 1', text: CONFIDENTIAL, page: 1 }],
  });
  assert.equal(passed.ok, true, passed.failures.join(' '));
  assert.equal(
    passed.checks.some(check => check.id === 'redaction-1' && check.status === 'passed'),
    true,
  );

  const failed = await verifyGeneratedPdf({
    mode: 'structure-preserving',
    sourceBytes: source,
    outputBytes: source,
    redactedPages: [1],
    redactions: [{ label: 'Salary on page 1', text: CONFIDENTIAL, page: 1 }],
  });
  assert.equal(failed.ok, false);
  assert.match(failed.failures.join(' '), /still drawn/);
});

test('redacting one of two identical runs leaves the other occurrence allowed', async () => {
  const source = await buildSourcePdf([[CONFIDENTIAL, CONFIDENTIAL]]);
  const oneRemains = await buildSourcePdf([[CONFIDENTIAL]]);
  const noneRemains = await buildSourcePdf([[]]);

  const expectation = { label: 'Salary on page 1', text: CONFIDENTIAL, page: 1 };
  for (const outputBytes of [oneRemains, noneRemains]) {
    const report = await verifyGeneratedPdf({
      mode: 'structure-preserving',
      sourceBytes: source,
      outputBytes,
      redactedPages: [1],
      redactions: [expectation],
    });
    assert.equal(report.ok, true);
  }

  const untouched = await verifyGeneratedPdf({
    mode: 'structure-preserving',
    sourceBytes: source,
    outputBytes: source,
    redactedPages: [1],
    redactions: [expectation],
  });
  assert.equal(untouched.ok, false);
});


