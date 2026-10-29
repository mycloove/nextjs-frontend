import assert from 'node:assert/strict';
import test from 'node:test';

import {
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFHexString,
  PDFName,
  PDFRef,
  PDFString,
  degrees,
  decodePDFRawStream,
  PDFRawStream,
} from 'pdf-lib';

import {
  exportPdfEditorAnnotations,
  pdfEditorAnnotationExpectations,
  PdfEditorAnnotationExportError,
  verifyPdfEditorAnnotationExport,
} from './editorAnnotationExport.ts';
import type { PdfEditorAnnotation } from './editorAnnotations.ts';

const annotation = (overrides: Partial<PdfEditorAnnotation>): PdfEditorAnnotation => ({
  id: 'a1',
  kind: 'highlight',
  page: 1,
  x: 20,
  y: 30,
  width: 120,
  height: 14,
  color: '#ffe14d',
  author: 'Reviewer',
  contents: '',
  createdAt: '2026-01-02T03:04:05.000Z',
  ...overrides,
});

async function makeSource(options: { rotated?: boolean } = {}) {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([300, 400]);
  if (options.rotated) page.setRotation(degrees(90));
  pdf.addPage([300, 400]);
  return pdf.save({ addDefaultPage: false });
}

function pageAnnots(pdf: PDFDocument, pageIndex: number): PDFArray | undefined {
  return pdf.getPage(pageIndex).node.lookupMaybe(PDFName.of('Annots'), PDFArray);
}

function text(value: unknown) {
  if (value instanceof PDFString || value instanceof PDFHexString) return value.decodeText();
  return null;
}

test('highlights, notes, stamps and links are written as real annotations', async () => {
  const source = await makeSource();
  const annotations: PdfEditorAnnotation[] = [
    annotation({ id: 'highlight-1', kind: 'highlight', blockKey: '1:0' }),
    annotation({
      id: 'note-1',
      kind: 'note',
      x: 200,
      y: 80,
      width: 24,
      height: 24,
      contents: 'Check this figure.',
    }),
    annotation({ id: 'stamp-1', kind: 'stamp', x: 40, y: 300, width: 120, height: 36, stamp: 'Draft' }),
    annotation({
      id: 'link-1',
      kind: 'link',
      x: 40,
      y: 200,
      width: 160,
      height: 16,
      uri: 'https://example.com/report',
    }),
  ];

  const exported = await exportPdfEditorAnnotations({ source, annotations });
  assert.equal(exported.written, 4);

  const reopened = await PDFDocument.load(exported.bytes, { updateMetadata: false });
  const annots = pageAnnots(reopened, 0);
  assert.ok(annots);
  assert.equal(annots.size(), 4);

  const byId = new Map<string, { subtype: string; dict: PDFDict }>();
  for (let index = 0; index < annots.size(); index += 1) {
    const dict = annots.lookup(index, PDFDict);
    const id = text(dict.lookupMaybe(PDFName.of('NM'), PDFString, PDFHexString));
    if (id) {
      byId.set(id, { subtype: dict.lookup(PDFName.of('Subtype'), PDFName).decodeText(), dict });
    }
  }

  assert.equal(byId.get('highlight-1')?.subtype, 'Highlight');
  assert.equal(byId.get('note-1')?.subtype, 'Text');
  assert.equal(byId.get('stamp-1')?.subtype, 'Stamp');
  assert.equal(byId.get('link-1')?.subtype, 'Link');

  const highlight = byId.get('highlight-1')!.dict;
  // Top-left 30 in a 400pt page is user-space y 370 for the top edge.
  const rect = highlight.lookup(PDFName.of('Rect'), PDFArray);
  assert.deepEqual(
    [0, 1, 2, 3].map(index => Math.round(rect.lookup(index)!.valueOf() as number)),
    [20, 356, 140, 370],
  );
  assert.equal(highlight.lookup(PDFName.of('QuadPoints'), PDFArray).size(), 8);
  assert.ok(highlight.lookup(PDFName.of('AP'), PDFDict).get(PDFName.of('N')));

  assert.equal(
    text(byId.get('note-1')!.dict.lookupMaybe(PDFName.of('Contents'), PDFString, PDFHexString)),
    'Check this figure.',
  );
  assert.equal(byId.get('stamp-1')!.dict.lookup(PDFName.of('Name'), PDFName).decodeText(), 'Draft');
  const action = byId.get('link-1')!.dict.lookup(PDFName.of('A'), PDFDict);
  assert.equal(text(action.lookupMaybe(PDFName.of('URI'), PDFString, PDFHexString)), 'https://example.com/report');
});

test('a reply keeps its parent reference and thread relationship', async () => {
  const source = await makeSource();
  const parent = annotation({ id: 'parent', kind: 'note', contents: 'Verify the total.' });
  const reply = annotation({
    id: 'child',
    kind: 'reply',
    contents: 'Confirmed on page 2.',
    replyTo: 'parent',
  });

  const exported = await exportPdfEditorAnnotations({ source, annotations: [reply, parent] });
  const reopened = await PDFDocument.load(exported.bytes, { updateMetadata: false });
  const annots = pageAnnots(reopened, 0);
  assert.ok(annots);

  let replyDict: PDFDict | null = null;
  let parentRef: PDFRef | null = null;
  for (let index = 0; index < annots.size(); index += 1) {
    const dict = annots.lookup(index, PDFDict);
    const id = text(dict.lookupMaybe(PDFName.of('NM'), PDFString, PDFHexString));
    if (id === 'child') replyDict = dict;
    if (id === 'parent') parentRef = annots.get(index) as PDFRef;
  }

  assert.ok(replyDict);
  assert.ok(parentRef);
  assert.equal(replyDict.lookup(PDFName.of('RT'), PDFName).decodeText(), 'R');
  const linked = replyDict.get(PDFName.of('IRT'));
  assert.ok(linked instanceof PDFRef);
  assert.equal(linked.toString(), parentRef.toString());

  const verification = await verifyPdfEditorAnnotationExport({
    outputBytes: exported.bytes,
    expectations: pdfEditorAnnotationExpectations([parent, reply]),
  });
  assert.equal(verification.ok, true);
});

test('a reply whose parent is not exported is refused, not orphaned', async () => {
  const source = await makeSource();
  await assert.rejects(
    () => exportPdfEditorAnnotations({
      source,
      annotations: [annotation({ id: 'child', kind: 'reply', contents: 'x', replyTo: 'missing' })],
    }),
    (error: unknown) => error instanceof PdfEditorAnnotationExportError,
  );
});

test('a link with an unusable address is refused at export time', async () => {
  const source = await makeSource();
  await assert.rejects(
    () => exportPdfEditorAnnotations({
      source,
      annotations: [annotation({ id: 'link', kind: 'link', uri: 'javascript:alert(1)' })],
    }),
    (error: unknown) => error instanceof PdfEditorAnnotationExportError
      && /usable http/.test((error as Error).message),
  );
});

test('a rotated page is a fail-closed refusal', async () => {
  const source = await makeSource({ rotated: true });
  await assert.rejects(
    () => exportPdfEditorAnnotations({ source, annotations: [annotation({ id: 'a1' })] }),
    (error: unknown) => error instanceof PdfEditorAnnotationExportError
      && /rotated/.test((error as Error).message),
  );
});

test('the same annotation copied onto two pages verifies on both', async () => {
  const source = await makeSource();
  const first = annotation({ id: 'copy', page: 1 });
  const second = annotation({ id: 'copy#2', page: 2 });
  const exported = await exportPdfEditorAnnotations({ source, annotations: [first, second] });
  const verification = await verifyPdfEditorAnnotationExport({
    outputBytes: exported.bytes,
    expectations: pdfEditorAnnotationExpectations([first, second]),
  });
  assert.equal(verification.ok, true);
  assert.equal(verification.checks.length, 2);
});

test('verification proves subtype, page and contents presence by id', async () => {
  const source = await makeSource();
  const annotations = [
    annotation({ id: 'p1', kind: 'underline', page: 1 }),
    annotation({ id: 'p2', kind: 'stamp', page: 2, stamp: 'Approved' }),
  ];
  const exported = await exportPdfEditorAnnotations({ source, annotations });

  const good = await verifyPdfEditorAnnotationExport({
    outputBytes: exported.bytes,
    expectations: pdfEditorAnnotationExpectations(annotations),
  });
  assert.equal(good.ok, true);
  assert.equal(good.checks.every(check => check.status === 'passed'), true);

  const wrongSubtype = await verifyPdfEditorAnnotationExport({
    outputBytes: exported.bytes,
    expectations: [{ ...annotations[0], subtype: 'Highlight' }],
  });
  assert.equal(wrongSubtype.ok, false);
  assert.match(wrongSubtype.failures[0], /expected \/Highlight/);

  const wrongPage = await verifyPdfEditorAnnotationExport({
    outputBytes: exported.bytes,
    expectations: [{ ...annotations[1], page: 1, subtype: 'Stamp' }],
  });
  assert.equal(wrongPage.ok, false);
});

test('final annotation verification rejects altered intent and malformed dictionaries', async () => {
  const annotations = [
    annotation({ id: 'parent', kind: 'note', contents: 'Keep this comment.' }),
    annotation({ id: 'other', kind: 'note', contents: 'Another thread.' }),
    annotation({ id: 'reply', kind: 'reply', replyTo: 'parent', contents: 'Correct thread.' }),
    annotation({ id: 'mark', kind: 'highlight' }),
    annotation({ id: 'stamp', kind: 'stamp', stamp: 'Draft' }),
    annotation({ id: 'link', kind: 'link', uri: 'https://example.com' }),
  ];
  const exported = await exportPdfEditorAnnotations({ source: await makeSource(), annotations });
  const cases: [string, (pdf: PDFDocument, byId: Map<string, PDFDict>, annots: PDFArray) => void][] = [
    ['contents', (_pdf, ids) => { ids.get('parent')!.delete(PDFName.of('Contents')); }],
    ['rectangle', (pdf, ids) => { ids.get('mark')!.set(PDFName.of('Rect'), pdf.context.obj([0, 0, 1, 1])); }],
    ['color', (pdf, ids) => { ids.get('mark')!.set(PDFName.of('C'), pdf.context.obj([0, 0, 0])); }],
    ['quadrilaterals', (_pdf, ids) => { ids.get('mark')!.delete(PDFName.of('QuadPoints')); }],
    ['appearance', (_pdf, ids) => { ids.get('mark')!.delete(PDFName.of('AP')); }],
    ['stamp', (_pdf, ids) => { ids.get('stamp')!.set(PDFName.of('Name'), PDFName.of('Approved')); }],
    ['reply parent', (_pdf, ids, annots) => { ids.get('reply')!.set(PDFName.of('IRT'), annots.get(1)); }],
    ['identity', (_pdf, _ids, annots) => { annots.push(annots.get(0)); }],
    ['action', (_pdf, ids) => { ids.get('link')!.lookup(PDFName.of('A'), PDFDict).set(PDFName.of('S'), PDFName.of('JavaScript')); }],
    ['malformed', (_pdf, ids) => { ids.get('mark')!.set(PDFName.of('AP'), PDFName.of('Broken')); }],
  ];
  for (const [label, mutate] of cases) {
    const pdf = await PDFDocument.load(exported.bytes);
    const annots = pageAnnots(pdf, 0)!;
    const byId = new Map<string, PDFDict>();
    for (let i = 0; i < annots.size(); i++) {
      const dict = annots.lookup(i, PDFDict);
      byId.set(text(dict.lookup(PDFName.of('NM')) as PDFHexString)!, dict);
    }
    mutate(pdf, byId, annots);
    const result = await verifyPdfEditorAnnotationExport({ outputBytes: await pdf.save(), expectations: pdfEditorAnnotationExpectations(annotations) });
    assert.equal(result.ok, false, label);
  }
});

test('stamp appearance uses readable Helvetica character codes', async () => {
  const exported = await exportPdfEditorAnnotations({ source: await makeSource(), annotations: [annotation({ kind: 'stamp', stamp: 'Draft' })] });
  const pdf = await PDFDocument.load(exported.bytes);
  const dict = pageAnnots(pdf, 0)!.lookup(0, PDFDict);
  const stream = dict.lookup(PDFName.of('AP'), PDFDict).lookup(PDFName.of('N'));
  assert.ok(stream instanceof PDFRawStream);
  const operators = new TextDecoder().decode(decodePDFRawStream(stream).decode());
  assert.match(operators, /<4452414654> Tj/);
  assert.doesNotMatch(operators, /FEFF/i);
});

test('annotation verification checks effective normal appearance, not only its operator bytes', async (t) => {
  const annotations = [annotation({ id: 'mark' }), annotation({ id: 'stamp', kind: 'stamp', stamp: 'Draft' })];
  const exported = await exportPdfEditorAnnotations({ source: await makeSource(), annotations });
  const cases: [string, (pdf: PDFDocument, dict: PDFDict, stream: PDFRawStream) => void][] = [
    ['hidden flag', (pdf, dict) => { dict.set(PDFName.of('F'), pdf.context.obj(2)); }],
    ['no-view flag', (pdf, dict) => { dict.set(PDFName.of('F'), pdf.context.obj(36)); }],
    ['not printable', (pdf, dict) => { dict.set(PDFName.of('F'), pdf.context.obj(0)); }],
    ['zero fill opacity', (pdf, _dict, stream) => {
      stream.dict.lookup(PDFName.of('Resources'), PDFDict).lookup(PDFName.of('ExtGState'), PDFDict)
        .lookup(PDFName.of('GS0'), PDFDict).set(PDFName.of('ca'), pdf.context.obj(0));
    }],
    ['zero stroke opacity', (pdf, _dict, stream) => {
      stream.dict.lookup(PDFName.of('Resources'), PDFDict).lookup(PDFName.of('ExtGState'), PDFDict)
        .lookup(PDFName.of('GS0'), PDFDict).set(PDFName.of('CA'), pdf.context.obj(0));
    }],
    ['missing opacity value', (_pdf, _dict, stream) => {
      stream.dict.lookup(PDFName.of('Resources'), PDFDict).lookup(PDFName.of('ExtGState'), PDFDict)
        .lookup(PDFName.of('GS0'), PDFDict).delete(PDFName.of('ca'));
    }],
    ['wrong opacity resource type', (_pdf, _dict, stream) => {
      stream.dict.lookup(PDFName.of('Resources'), PDFDict).lookup(PDFName.of('ExtGState'), PDFDict)
        .set(PDFName.of('GS0'), PDFName.of('Broken'));
    }],
    ['unverified blend mode', (_pdf, _dict, stream) => {
      stream.dict.lookup(PDFName.of('Resources'), PDFDict).lookup(PDFName.of('ExtGState'), PDFDict)
        .lookup(PDFName.of('GS0'), PDFDict).set(PDFName.of('BM'), PDFName.of('Difference'));
    }],
    ['singular matrix', (pdf, _dict, stream) => { stream.dict.set(PDFName.of('Matrix'), pdf.context.obj([0, 0, 0, 0, 0, 0])); }],
    ['translated matrix', (pdf, _dict, stream) => { stream.dict.set(PDFName.of('Matrix'), pdf.context.obj([1, 0, 0, 1, 500, 500])); }],
    ['annotation opacity override', (pdf, dict) => { dict.set(PDFName.of('CA'), pdf.context.obj(0)); }],
    ['optional-content visibility', (pdf, dict) => { dict.set(PDFName.of('OC'), pdf.context.obj({ Type: 'OCG', Name: 'Hidden' })); }],
    ['appearance transparency group', (pdf, _dict, stream) => { stream.dict.set(PDFName.of('Group'), pdf.context.obj({ S: 'Transparency', K: true })); }],
    ['stamp font substitution', (_pdf, _dict, stream) => {
      stream.dict.lookup(PDFName.of('Resources'), PDFDict).lookup(PDFName.of('Font'), PDFDict)
        .lookup(PDFName.of('Helv'), PDFDict).set(PDFName.of('BaseFont'), PDFName.of('Symbol'));
    }],
  ];
  for (const [label, mutate] of cases) {
    await t.test(label, async () => {
      const pdf = await PDFDocument.load(exported.bytes);
      const dict = pageAnnots(pdf, 0)!.lookup(label === 'stamp font substitution' ? 1 : 0, PDFDict);
      const stream = dict.lookup(PDFName.of('AP'), PDFDict).lookup(PDFName.of('N'));
      assert.ok(stream instanceof PDFRawStream);
      mutate(pdf, dict, stream);
      const result = await verifyPdfEditorAnnotationExport({ outputBytes: await pdf.save(), expectations: pdfEditorAnnotationExpectations(annotations) });
      assert.equal(result.ok, false, label);
    });
  }
  await t.test('explicit identity matrix preserves the normal appearance', async () => {
    const pdf = await PDFDocument.load(exported.bytes);
    const dict = pageAnnots(pdf, 0)!.lookup(0, PDFDict);
    const stream = dict.lookup(PDFName.of('AP'), PDFDict).lookup(PDFName.of('N'));
    assert.ok(stream instanceof PDFRawStream);
    stream.dict.set(PDFName.of('Matrix'), pdf.context.obj([1, 0, 0, 1, 0, 0]));
    const result = await verifyPdfEditorAnnotationExport({ outputBytes: await pdf.save(), expectations: pdfEditorAnnotationExpectations(annotations) });
    assert.equal(result.ok, true, result.failures.join(' '));
  });
});
