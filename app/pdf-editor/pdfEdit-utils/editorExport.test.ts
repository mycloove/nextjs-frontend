import assert from 'node:assert/strict';
import test from 'node:test';

import {
  PDFDocument,
  StandardFonts,
  degrees,
  rgb,
} from 'pdf-lib';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';

import {
  UnsupportedScriptExportError,
  clonePdfBytes,
  countFabricCanvasObjects,
  decidePdfEditorExportMode,
  exportStructurePreservingPdf,
  findUnrenderableTextMutations,
  isEffectiveTextEdit,
  TEXT_EDIT_FONT_SIZE_TOLERANCE,
} from './editorExport.ts';
import { resolvePdfEditorFeatureFlags } from './editorFeatureFlags.ts';

/**
 * Text mutation on the unrotated first page, so a test only has to state the
 * one field it is actually about (the text).
 */
function textMutationWith(text: string) {
  return {
    page: 1,
    x: 72,
    y: 92,
    width: 300,
    height: 24,
    sourceFontSize: 18,
    text,
    fontSize: 18,
    fontFamily: 'Helvetica',
    color: '#111111',
    bold: false,
    italic: false,
    underline: false,
    align: 'left' as const,
    lineHeight: 1.15,
    backgroundColor: 'transparent',
  };
}


async function createGoldenPdf(): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.setTitle('SmilePDF preservation contract');
  pdf.setAuthor('SmilePDF test suite');
  pdf.setSubject('Golden PDF export regression corpus');
  pdf.setKeywords(['pdf-editor', 'preservation', 'golden']);

  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const first = pdf.addPage([612, 792]);
  first.drawText('Searchable contract text', {
    x: 72,
    y: 700,
    size: 18,
    font,
    color: rgb(0.1, 0.2, 0.3),
  });

  const second = pdf.addPage([420, 595]);
  second.setRotation(degrees(90));
  second.drawText('Rotated page text', { x: 48, y: 520, size: 14, font });

  const form = pdf.getForm();
  const name = form.createTextField('customer.name');
  name.setText('Ada Lovelace');
  name.addToPage(first, { x: 72, y: 620, width: 220, height: 28 });

  const linkAnnotation = pdf.context.obj({
    Type: 'Annot',
    Subtype: 'Link',
    Rect: [72, 560, 240, 585],
    Border: [0, 0, 0],
    A: { Type: 'Action', S: 'URI', URI: pdf.context.obj('https://example.com') },
  });
  const linkRef = pdf.context.register(linkAnnotation);
  first.node.Annots()?.push(linkRef);

  return pdf.save({ useObjectStreams: false });
}

test('export policy selects the least destructive renderer that satisfies the mutation', () => {
  assert.equal(decidePdfEditorExportMode({
    pageSize: 'original',
    hasTextEdits: false,
    hasCanvasObjects: false,
  }).mode, 'byte-preserving');

  assert.equal(decidePdfEditorExportMode({
    pageSize: 'original',
    hasTextEdits: true,
    hasCanvasObjects: false,
  }).mode, 'structure-preserving');

  assert.equal(decidePdfEditorExportMode({
    pageSize: 'original',
    hasTextEdits: false,
    hasCanvasObjects: true,
  }).mode, 'structure-preserving');

  assert.equal(decidePdfEditorExportMode({
    pageSize: 'a4',
    hasTextEdits: false,
    hasCanvasObjects: false,
  }).mode, 'compatibility-render');

  assert.equal(decidePdfEditorExportMode({
    pageSize: 'original',
    hasTextEdits: true,
    hasCanvasObjects: false,
    hasMutationsOnRotatedPages: true,
  }).mode, 'compatibility-render');
});

test('effective text detection ignores a selected but unchanged source block', () => {
  const source = {
    text: 'Source text',
    fontSize: 12,
    fontFamily: 'Helvetica',
    color: '#111111',
  };
  const unchanged = {
    ...source,
    bold: false,
    italic: false,
    underline: false,
    align: 'left' as const,
    lineHeight: 1.15,
    backgroundColor: 'transparent',
  };

  assert.equal(isEffectiveTextEdit(unchanged, source), false);
  assert.equal(isEffectiveTextEdit({ ...unchanged, text: 'Edited text' }, source), true);
  assert.equal(isEffectiveTextEdit({ ...unchanged, fontFamily: 'Times-Roman' }, source), true);
  assert.equal(isEffectiveTextEdit({ ...unchanged, lineHeight: 1.5 }, source), true);
});

test('a size that differs only in the last bits of a float is not an edit', () => {
  // The phantom-edit regression. A 6pt line read at Fit width is
  // `5.999999999999999`; the export path reads the same line at scale 1 and gets
  // exactly `6`. Comparing those with `!==` reported a size change on every
  // untouched line of the page, each one asking the engine to redact a line and
  // put its own text back — and a box on a solid-set line covers its
  // neighbour's glyphs, so the unnamed-text guard refused the atomic
  // transaction and took the user's one real edit down with it.
  const source = {
    text: 'Source text',
    fontSize: 6,
    fontFamily: 'Helvetica',
    color: '#111111',
  };
  const untouched = {
    ...source,
    bold: false,
    italic: false,
    underline: false,
    align: 'left' as const,
    lineHeight: 1.15,
    backgroundColor: 'transparent',
  };

  assert.equal(isEffectiveTextEdit({ ...untouched, fontSize: 5.999999999999999 }, source), false);
  assert.equal(isEffectiveTextEdit({ ...untouched, fontSize: 6.000000000000001 }, source), false);
  // Still an edit: the tolerance is narrower than any size a user can ask for.
  assert.equal(isEffectiveTextEdit({ ...untouched, fontSize: 6.5 }, source), true);
  assert.equal(isEffectiveTextEdit({ ...untouched, fontSize: 7 }, source), true);
  assert.ok(TEXT_EDIT_FONT_SIZE_TOLERANCE < 0.01, 'the tolerance can hide a real size change');
  // Inside the tolerance is noise, well past it is an edit. The boundary itself
  // is deliberately not asserted: `6 + 1e-3` is 6.001000000000000156 in binary,
  // so an exact-boundary test measures the adder, not the comparison.
  assert.equal(
    isEffectiveTextEdit({ ...untouched, fontSize: 6 + TEXT_EDIT_FONT_SIZE_TOLERANCE / 2 }, source),
    false,
  );
  assert.equal(
    isEffectiveTextEdit({ ...untouched, fontSize: 6 + TEXT_EDIT_FONT_SIZE_TOLERANCE * 10 }, source),
    true,
  );
  // Nonsense sizes still register, rather than silently comparing equal.
  assert.equal(isEffectiveTextEdit({ ...untouched, fontSize: Number.NaN }, source), true);
});

test('Fabric object counting ignores initialized empty canvases', () => {
  assert.equal(countFabricCanvasObjects([
    { version: '5.5.2', objects: [] },
    { objects: [{ type: 'rect' }, { type: 'textbox' }] },
    {},
  ]), 2);
});

test('golden no-op export is byte-identical and reopens with structure and text intact', async () => {
  const source = await createGoldenPdf();
  const exported = clonePdfBytes(source);

  assert.notEqual(exported, source);
  assert.deepEqual(exported, source);

  const reopened = await PDFDocument.load(exported);
  assert.equal(reopened.getPageCount(), 2);
  assert.deepEqual(reopened.getPage(0).getSize(), { width: 612, height: 792 });
  assert.equal(reopened.getPage(1).getRotation().angle, 90);
  assert.equal(reopened.getTitle(), 'SmilePDF preservation contract');
  assert.equal(reopened.getAuthor(), 'SmilePDF test suite');
  assert.deepEqual(reopened.getForm().getFields().map(field => field.getName()), ['customer.name']);

  const loadingTask = pdfjs.getDocument({ data: exported.slice() });
  const parsed = await loadingTask.promise;
  try {
    assert.equal(parsed.numPages, 2);
    const first = await parsed.getPage(1);
    const second = await parsed.getPage(2);
    const firstText = await first.getTextContent();
    const secondText = await second.getTextContent();
    const firstAnnotations = await first.getAnnotations();

    assert.match(firstText.items.map(item => 'str' in item ? item.str : '').join(' '), /Searchable contract text/);
    assert.match(secondText.items.map(item => 'str' in item ? item.str : '').join(' '), /Rotated page text/);
    assert.equal(second.rotate, 90);
    assert.equal(firstAnnotations.some(annotation => annotation.subtype === 'Widget'), true);
    assert.equal(firstAnnotations.some(annotation => annotation.subtype === 'Link'), true);
  } finally {
    await parsed.destroy();
  }
});

test('edited export appends mutations while preserving source document structure', async () => {
  const source = await createGoldenPdf();
  const transparentPng = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAF/gL+X8fQ7wAAAABJRU5ErkJggg==',
    'base64',
  );
  const exported = await exportStructurePreservingPdf({
    source,
    textMutations: [{
      page: 1,
      x: 72,
      y: 74,
      width: 250,
      height: 24,
      sourceFontSize: 18,
      text: 'Searchable edited contract text',
      fontSize: 18,
      fontFamily: 'Helvetica',
      color: '#16324f',
      bold: true,
      italic: false,
      underline: true,
      align: 'left',
      lineHeight: 1.15,
      backgroundColor: '#ffffff',
    }],
    overlayMutations: [{
      page: 1,
      pngBytes: transparentPng,
      width: 612,
      height: 792,
    }],
  });

  assert.notDeepEqual(exported, source);
  const reopened = await PDFDocument.load(exported);
  assert.equal(reopened.getPageCount(), 2);
  assert.deepEqual(reopened.getPage(0).getSize(), { width: 612, height: 792 });
  assert.deepEqual(reopened.getPage(1).getSize(), { width: 420, height: 595 });
  assert.equal(reopened.getPage(1).getRotation().angle, 90);
  assert.equal(reopened.getTitle(), 'SmilePDF preservation contract');
  assert.equal(reopened.getAuthor(), 'SmilePDF test suite');
  assert.equal(reopened.getSubject(), 'Golden PDF export regression corpus');
  assert.equal(reopened.getKeywords(), 'pdf-editor preservation golden');
  assert.equal(reopened.getForm().getTextField('customer.name').getText(), 'Ada Lovelace');

  const loadingTask = pdfjs.getDocument({ data: exported.slice() });
  const parsed = await loadingTask.promise;
  try {
    const first = await parsed.getPage(1);
    const second = await parsed.getPage(2);
    const firstText = await first.getTextContent();
    const secondText = await second.getTextContent();
    const firstAnnotations = await first.getAnnotations();
    const firstTextValue = firstText.items.map(item => 'str' in item ? item.str : '').join(' ');

    assert.match(firstTextValue, /Searchable contract text/);
    assert.match(firstTextValue, /Searchable edited contract text/);
    assert.match(secondText.items.map(item => 'str' in item ? item.str : '').join(' '), /Rotated page text/);
    assert.equal(second.rotate, 90);
    assert.equal(firstAnnotations.some(annotation => annotation.subtype === 'Widget'), true);
    assert.equal(firstAnnotations.some(annotation => annotation.subtype === 'Link'), true);
  } finally {
    await parsed.destroy();
  }
});

test('structure-preserving exporter rejects edited rotated pages so callers can use compatibility fallback', async () => {
  const source = await createGoldenPdf();
  await assert.rejects(
    exportStructurePreservingPdf({
      source,
      textMutations: [{
        page: 2,
        x: 48,
        y: 60,
        width: 180,
        height: 20,
        sourceFontSize: 14,
        text: 'Rotated edit',
        fontSize: 14,
        fontFamily: 'Helvetica',
        color: '#111111',
        bold: false,
        italic: false,
        underline: false,
        align: 'left',
        lineHeight: 1.15,
        backgroundColor: 'transparent',
      }],
    }),
    /does not yet support edited rotated page 2/,
  );
});

test('export refuses right-to-left text instead of writing it in visual disorder', async () => {
  const source = await createGoldenPdf();

  // Indic scripts are shaped and exported now; bidi reordering is the remaining
  // gap, so Hebrew is the script that must still be refused rather than mangled.
  await assert.rejects(
    exportStructurePreservingPdf({
      source,
      textMutations: [textMutationWith('שלום עולם')],
    }),
    (error: unknown) => {
      assert.ok(error instanceof UnsupportedScriptExportError);
      assert.equal(error.refusals.length, 1);
      assert.equal(error.refusals[0].page, 1);
      assert.equal(error.refusals[0].mutationIndex, 0);
      // The message must name the script and say the edit was dropped, so the
      // user is not left guessing which field failed or what happened to it.
      assert.match(error.message, /Hebrew/);
      assert.match(error.message, /was not applied/);
      return true;
    },
  );
});

test('refused export leaves the source bytes completely untouched', async () => {
  const source = await createGoldenPdf();
  const before = clonePdfBytes(source);

  await assert.rejects(exportStructurePreservingPdf({
    source,
    textMutations: [textMutationWith('שלום עולם')],
  }));

  // The guard runs before any drawing, so a refusal must not have mutated the
  // caller's buffer. A silently-corrupted input would be worse than mangled text.
  assert.deepEqual(source, before);
});

test('guard reports every offending edit rather than only the first', () => {
  const refusals = findUnrenderableTextMutations([
    textMutationWith('Plain Latin heading'),
    textMutationWith('שלום עולם'),
    { ...textMutationWith('مرحبا بالعالم'), page: 2 },
  ]);

  assert.deepEqual(refusals.map(refusal => refusal.mutationIndex), [1, 2]);
  assert.deepEqual(refusals.map(refusal => refusal.page), [1, 2]);
  assert.match(refusals[1].message, /Arabic/);
});

test('scripts that once forced a refusal now export as shaped runs', () => {
  // Regression lock for the shaping work: these previously hit the refusal path
  // and must never silently return to it.
  assert.deepEqual(findUnrenderableTextMutations([
    textMutationWith('আমার সোনার বাংলা'),
    textMutationWith('नमस्ते दुनिया'),
  ]), []);
});

test('scripts that render correctly one glyph per code point still export', async () => {
  const source = await createGoldenPdf();

  // Latin is the everyday path and must be entirely unaffected by the guard.
  const latin = await exportStructurePreservingPdf({
    source,
    textMutations: [textMutationWith('Edited contract clause')],
  });
  assert.ok(latin.byteLength > 0);

  // Cyrillic needs an embedded font, not shaping, so refusing it would block
  // text this renderer can place honestly. Only the standard-font substitution
  // applies here, which is a separate concern from reordering.
  assert.deepEqual(findUnrenderableTextMutations([textMutationWith('Привет мир')]), []);
});

test('disabling the flag restores the legacy unguarded export path', async () => {
  const source = await createGoldenPdf();
  const flags = resolvePdfEditorFeatureFlags({
    NEXT_PUBLIC_PDF_EDITOR_TEXT_SHAPING_GUARD: 'off',
  });

  assert.equal(flags.textShapingGuard, false);
  // Escape hatch for incident response: the old behaviour must still be
  // reachable without editing code, even though it produces wrong glyphs.
  const exported = await exportStructurePreservingPdf({
    source,
    flags,
    textMutations: [textMutationWith('আমার সোনার বাংলা')],
  });
  assert.ok(exported.byteLength > 0);
});


