import assert from 'node:assert/strict';
import test from 'node:test';

import type { PdfVerificationSnapshot } from './editorExportVerification.ts';
import { verifyGeneratedPdf, verifyPdfExportSnapshots } from './editorExportVerification.ts';
import { PDFDocument, PDFName } from 'pdf-lib';
import { exportPdfEditorPagePlan } from './editorPageExport.ts';
import type { PdfEditorPagePlan } from './editorPageModel.ts';

function snapshot(overrides: Partial<PdfVerificationSnapshot> = {}): PdfVerificationSnapshot {
  return {
    byteLength: 100,
    pageCount: 2,
    pageText: ['Contract page one', 'Contract page two'],
    pageRotations: [0, 90],
    metadata: { Title: 'Golden contract', Author: 'SmilePDF' },
    formFieldNames: ['customer.name'],
    readers: { pdfjs: true, pdfLib: true },
    preflight: {
      status: 'complete', scannedAt: 1, pageCount: 2, warnings: [],
      features: {
        encryption: { present: false, restricted: false },
        digitalSignatures: { present: true, count: 1 },
        forms: { present: true, fieldCount: 2, signatureFieldCount: 1 },
        annotations: { present: true, count: 1 },
        links: { present: true, count: 1 },
        outline: { present: true, itemCount: 2 },
        attachments: { present: true, count: 1 },
        taggedContent: { present: true },
        metadata: { present: true },
        javascript: { present: false },
        rotatedPages: { present: true, count: 1 },
      },
    },
    ...overrides,
  };
}

test('structure-preserving verification locks retained document structure', () => {
  const result = verifyPdfExportSnapshots({
    mode: 'structure-preserving',
    source: snapshot(),
    output: snapshot({ byteLength: 180 }),
  });
  assert.equal(result.ok, true);
  assert.equal(result.allowedLosses.length, 0);
  assert.equal(result.checks.some(check => check.id === 'attachments' && check.status === 'passed'), true);
});

test('structure-preserving verification ignores reader-derived PDF version normalization', () => {
  const source = snapshot({
    metadata: {
      Title: 'Golden contract',
      Author: 'SmilePDF',
      PDFFormatVersion: '1.4',
      IsLinearized: 'false',
    },
  });
  const output = snapshot({
    metadata: {
      Title: 'Golden contract',
      Author: 'SmilePDF',
      PDFFormatVersion: '1.7',
      IsLinearized: 'true',
    },
  });

  const result = verifyPdfExportSnapshots({ mode: 'structure-preserving', source, output });

  assert.equal(result.ok, true);
  assert.equal(result.checks.some(check => check.id === 'metadata' && check.status === 'passed'), true);
});

test('structure-preserving verification discloses rather than blocks a re-encoded metadata field', () => {
  const result = verifyPdfExportSnapshots({
    mode: 'structure-preserving',
    source: snapshot({ metadata: { Title: 'Golden contract', Author: 'SmilePDF' } }),
    output: snapshot({ metadata: { Title: 'Golden contract' } }),
  });

  // Metadata is not page content: a re-encoded Info field is disclosed as an
  // allowed loss so the user keeps their edited document, and the content
  // checks (pages, text, structure) remain the corruption gate.
  assert.equal(result.ok, true);
  assert.equal(result.checks.some(check => check.id === 'metadata-Author' && check.status === 'allowed-loss'), true);
  assert.equal(result.allowedLosses.includes('document metadata field Author'), true);
});

test('structure-preserving verification treats save-tool metadata churn as an expected loss', () => {
  const result = verifyPdfExportSnapshots({
    mode: 'structure-preserving',
    source: snapshot({ metadata: { Title: 'Golden contract', Author: 'SmilePDF', Producer: 'Original App', ModDate: 'D:20200101000000Z' } }),
    output: snapshot({ metadata: { Title: 'Golden contract', Author: 'SmilePDF', Producer: 'SmilePDF Editor', ModDate: 'D:20260827000000Z' } }),
  });

  assert.equal(result.ok, true);
  assert.equal(result.checks.some(check => check.id === 'metadata-Producer' && check.status === 'allowed-loss'), true);
  assert.equal(result.checks.some(check => check.id === 'metadata-ModDate' && check.status === 'allowed-loss'), true);
  // Whitespace-only re-encoding is not a change at all.
  const reencoded = verifyPdfExportSnapshots({
    mode: 'structure-preserving',
    source: snapshot({ metadata: { Title: 'Golden  contract', Author: ' SmilePDF ' } }),
    output: snapshot({ metadata: { Title: 'Golden contract', Author: 'SmilePDF' } }),
  });
  assert.equal(reencoded.ok, true);
  assert.equal(reencoded.checks.some(check => check.id === 'metadata' && check.status === 'passed'), true);
});

test('structure-preserving verification blocks a contract-violating output', () => {
  const output = snapshot();
  output.preflight = structuredClone(output.preflight);
  output.preflight.features.links = { present: false, count: 0 };
  const result = verifyPdfExportSnapshots({ mode: 'structure-preserving', source: snapshot(), output });
  assert.equal(result.ok, false);
  assert.match(result.failures.join(' '), /links contract failed/);
});

test('structure-preserving verification locks signature markers and form field identity', () => {
  const output = snapshot({ formFieldNames: ['replacement.name'] });
  output.preflight = structuredClone(output.preflight);
  output.preflight.features.digitalSignatures = { present: false, count: 0 };
  const result = verifyPdfExportSnapshots({ mode: 'structure-preserving', source: snapshot(), output });
  assert.equal(result.ok, false);
  assert.match(result.failures.join(' '), /digital-signature markers contract failed/);
  assert.match(result.failures.join(' '), /customer\.name/);
});

test('compatibility verification permits declared structural loss but still requires readable pages and text', () => {
  const output = snapshot({ pageRotations: [0, 0], metadata: {}, formFieldNames: [] });
  output.preflight = structuredClone(output.preflight);
  output.preflight.features.forms = { present: false, fieldCount: 0, signatureFieldCount: 0 };
  output.preflight.features.links = { present: false, count: 0 };
  output.preflight.features.outline = { present: false, itemCount: 0 };
  output.preflight.features.attachments = { present: false, count: 0 };
  output.preflight.features.taggedContent = { present: false };
  const result = verifyPdfExportSnapshots({ mode: 'compatibility-render', source: snapshot(), output });
  assert.equal(result.ok, true);
  assert.equal(result.allowedLosses.includes('form fields'), true);
  assert.equal(result.checks.some(check => check.status === 'allowed-loss'), true);
});

test('visual text fallback permits flattened edited pages without pretending text stayed searchable', () => {
  const output = snapshot({
    pageText: ['', 'Contract page two'],
    pageRotations: [0, 0],
    metadata: {},
    formFieldNames: [],
  });
  output.preflight = structuredClone(output.preflight);
  output.preflight.features.forms = { present: false, fieldCount: 0, signatureFieldCount: 0 };
  output.preflight.features.links = { present: false, count: 0 };
  output.preflight.features.outline = { present: false, itemCount: 0 };
  output.preflight.features.attachments = { present: false, count: 0 };
  output.preflight.features.taggedContent = { present: false };

  const result = verifyPdfExportSnapshots({
    mode: 'compatibility-render',
    source: snapshot(),
    output,
    visualTextFallback: { flattenedTextPages: [1] },
  });

  assert.equal(result.ok, true);
  assert.equal(
    result.allowedLosses.includes('searchable source text on visually flattened edited pages'),
    true,
  );
  assert.equal(
    result.checks.some(check => check.id === 'visual-text-fallback-1' && check.status === 'passed'),
    true,
  );
});

test('byte-preserving verification requires exact source bytes', () => {
  const failed = verifyPdfExportSnapshots({
    mode: 'byte-preserving', source: snapshot(), output: snapshot(), bytesEqual: false,
  });
  assert.equal(failed.ok, false);
  assert.match(failed.failures.join(' '), /changed the source bytes/);
});

test('structural text verification checks replacement and removal without requiring old full-page text', () => {
  const result = verifyPdfExportSnapshots({
    mode: 'structure-preserving',
    source: snapshot({ pageText: ['Contract Original clause', 'Contract page two'] }),
    output: snapshot({ pageText: ['Contract Replacement clause', 'Contract page two'] }),
    textReplacements: [{ page: 1, originalText: 'Original', replacementText: 'Replacement' }],
  });
  assert.equal(result.ok, true);
  assert.equal(result.checks.some(check => check.id === 'removed-text-1' && check.status === 'passed'), true);
});

test('structural text verification fails when cover-and-retype leaves original text extractable', () => {
  const result = verifyPdfExportSnapshots({
    mode: 'structure-preserving',
    source: snapshot(),
    output: snapshot({ pageText: ['Contract page one Replacement', 'Contract page two'] }),
    textReplacements: [{ page: 1, originalText: 'page one', replacementText: 'Replacement' }],
  });
  assert.equal(result.ok, false);
  assert.match(result.failures.join(' '), /still extractable/);
});

test('structural text verification permits an untouched duplicate when one occurrence was removed', () => {
  const result = verifyPdfExportSnapshots({
    mode: 'structure-preserving',
    source: snapshot({ pageText: ['Repeat clause Repeat clause', 'Contract page two'] }),
    output: snapshot({ pageText: ['Replacement clause Repeat clause', 'Contract page two'] }),
    textReplacements: [{ page: 1, originalText: 'Repeat', replacementText: 'Replacement' }],
  });

  assert.equal(result.ok, true);
  assert.equal(result.checks.some(check => check.id === 'removed-text-1' && check.status === 'passed'), true);
});

test('structural text verification allows style-only edits that re-author the identical text', () => {
  const result = verifyPdfExportSnapshots({
    mode: 'structure-preserving',
    source: snapshot({ pageText: ['Contract page one', 'Contract page two'] }),
    output: snapshot({ pageText: ['Contract page one', 'Contract page two'] }),
    textReplacements: [{ page: 1, originalText: 'page one', replacementText: 'page one' }],
  });

  assert.equal(result.ok, true);
  assert.equal(result.checks.some(check => check.id === 'removed-text-1' && check.status === 'passed'), true);
  assert.equal(result.checks.some(check => check.id === 'edited-text-1' && check.status === 'passed'), true);
});

test('structural text verification allows additive edits that keep the original as a substring', () => {
  const result = verifyPdfExportSnapshots({
    mode: 'structure-preserving',
    source: snapshot({ pageText: ['Invoice Total due', 'Contract page two'] }),
    output: snapshot({ pageText: ['Invoice Total: 500 due', 'Contract page two'] }),
    textReplacements: [{ page: 1, originalText: 'Total', replacementText: 'Total: 500' }],
  });

  assert.equal(result.ok, true);
  assert.equal(result.checks.some(check => check.id === 'removed-text-1' && check.status === 'passed'), true);
});

test('structural text verification allows multiple identical style-only edits on one page', () => {
  const result = verifyPdfExportSnapshots({
    mode: 'structure-preserving',
    source: snapshot({ pageText: ['Name Name Name', 'Contract page two'] }),
    output: snapshot({ pageText: ['Name Name Name', 'Contract page two'] }),
    textReplacements: [
      { page: 1, originalText: 'Name', replacementText: 'Name' },
      { page: 1, originalText: 'Name', replacementText: 'Name' },
      { page: 1, originalText: 'Name', replacementText: 'Name' },
    ],
  });

  assert.equal(result.ok, true);
});

test('structural text verification still fails a cover-and-retype leftover on a style-only page', () => {
  const result = verifyPdfExportSnapshots({
    mode: 'structure-preserving',
    source: snapshot({ pageText: ['Secret clause', 'Contract page two'] }),
    output: snapshot({ pageText: ['Secret clause Public', 'Contract page two'] }),
    textReplacements: [{ page: 1, originalText: 'Secret', replacementText: 'Public' }],
  });

  assert.equal(result.ok, false);
  assert.match(result.failures.join(' '), /still extractable/);
});

test('added vector text is required to be extractable after reopening', () => {
  const withText = verifyPdfExportSnapshots({
    mode: 'structure-preserving',
    source: snapshot(),
    output: snapshot({ pageText: ['Contract page one New note', 'Contract page two'] }),
    addedText: [{ page: 1, text: 'New note' }],
  });
  assert.equal(withText.ok, true);
  assert.equal(withText.checks.some(check => check.id === 'added-text-1' && check.status === 'passed'), true);

  const withoutText = verifyPdfExportSnapshots({
    mode: 'structure-preserving',
    source: snapshot(),
    output: snapshot(),
    addedText: [{ page: 1, text: 'Missing note' }],
  });
  assert.equal(withoutText.ok, false);
  assert.ok(withoutText.failures.some(failure => failure.includes('Added text on page 1')));
});

test('editing or redacting one run never excuses blanking its neighbors', () => {
  for (const replacementText of ['', 'REPLACEMENT']) {
    const result = verifyPdfExportSnapshots({
      mode: 'structure-preserving',
      source: snapshot({ pageText: ['SECRET KEEP NEIGHBOR', 'Contract page two'] }),
      output: snapshot({ pageText: [replacementText, 'Contract page two'] }),
      textReplacements: [{ page: 1, originalText: 'SECRET', replacementText }],
    });
    assert.equal(result.ok, false);
    assert.match(result.failures.join(' '), /retained|unchanged/i);
  }
});

test('a partial redaction retains the other identical occurrence', () => {
  const source = snapshot({ pageText: ['SECRET SECRET', 'Contract page two'] });
  const textReplacements = [{ page: 1, originalText: 'SECRET', replacementText: '' }];
  assert.equal(verifyPdfExportSnapshots({ mode: 'structure-preserving', source, output: snapshot({ pageText: ['SECRET', 'Contract page two'] }), textReplacements }).ok, true);
  assert.equal(verifyPdfExportSnapshots({ mode: 'structure-preserving', source, output: snapshot({ pageText: ['', 'Contract page two'] }), textReplacements }).ok, false);
});

test('only explicitly described neighboring text loss is allowed', () => {
  const result = verifyPdfExportSnapshots({
    mode: 'structure-preserving', source: snapshot({ pageText: ['OLD ADJACENT KEEP', 'Contract page two'] }),
    output: snapshot({ pageText: ['KEEP NEW', 'Contract page two'] }),
    textReplacements: [{ page: 1, originalText: 'OLD', replacementText: 'NEW' }],
    allowedTextLosses: [{ page: 1, text: 'ADJACENT' }],
    sourceTextRuns: [
      { page: 1, text: 'OLD', retained: false },
      { page: 1, text: 'ADJACENT', retained: false },
      { page: 1, text: 'KEEP', retained: true },
    ],
  });
  assert.equal(result.ok, true);
  assert.ok(result.allowedLosses.some(loss => loss.includes('ADJACENT')));
});

test('source-run retention accepts editing a later duplicate without losing the first', () => {
  const runs = ['FIRST', 'LABEL', 'MIDDLE', 'LABEL', 'LAST'];
  const source = snapshot({ pageText: [runs.join(' '), 'Contract page two'] });
  const sourceTextRuns = runs.map((text, index) => ({ page: 1, text, retained: index !== 3 }));
  const textReplacements = [{ page: 1, originalText: 'LABEL', replacementText: 'NEW' }];
  // A structural writer may append the new run after the retained source runs.
  for (const text of ['FIRST LABEL MIDDLE NEW LAST', 'FIRST LABEL MIDDLE LAST NEW']) {
    const result = verifyPdfExportSnapshots({
      mode: 'structure-preserving', source, sourceTextRuns, textReplacements,
      output: snapshot({ pageText: [text, 'Contract page two'] }),
    });
    assert.equal(result.ok, true, result.failures.join(' '));
  }
  const missingDuplicate = verifyPdfExportSnapshots({
    mode: 'structure-preserving', source, sourceTextRuns, textReplacements,
    output: snapshot({ pageText: ['FIRST MIDDLE LAST NEW', 'Contract page two'] }),
  });
  assert.equal(missingDuplicate.ok, false);
  assert.match(missingDuplicate.failures.join(' '), /LABEL/);
});

test('a source-run manifest must cover the source and only discard declared occurrences', () => {
  const source = snapshot({ pageText: ['OLD KEEP', 'Contract page two'] });
  const output = snapshot({ pageText: ['KEEP NEW', 'Contract page two'] });
  const textReplacements = [{ page: 1, originalText: 'OLD', replacementText: 'NEW' }];
  const manifests = [
    [{ page: 1, text: 'OLD', retained: false }],
    [{ page: 1, text: 'OLD', retained: false }, { page: 1, text: 'KEEP', retained: false }],
    [{ page: 1, text: 'OLD', retained: true }, { page: 1, text: 'KEEP', retained: true }],
    [{ page: 1, text: 'KEEP', retained: true }, { page: 1, text: 'OLD', retained: false }],
  ];
  for (const sourceTextRuns of manifests) {
    const result = verifyPdfExportSnapshots({ mode: 'structure-preserving', source, output, textReplacements, sourceTextRuns });
    assert.equal(result.ok, false, JSON.stringify(sourceTextRuns));
    assert.match(result.failures.join(' '), /manifest/i);
  }
});

test('retained runs cannot borrow occurrences from replacements or added text', () => {
  const source = snapshot({ pageText: ['OLD KEEP', 'Contract page two'] });
  const sourceTextRuns = [{ page: 1, text: 'OLD', retained: false }, { page: 1, text: 'KEEP', retained: true }];
  const textReplacements = [{ page: 1, originalText: 'OLD', replacementText: 'KEEP' }];
  const addedText = [{ page: 1, text: 'KEEP' }];
  for (const count of [1, 2, 3]) {
    const result = verifyPdfExportSnapshots({
      mode: 'structure-preserving', source, sourceTextRuns, textReplacements, addedText,
      output: snapshot({ pageText: [Array(count).fill('KEEP').join(' '), 'Contract page two'] }),
    });
    assert.equal(result.ok, count === 3, result.failures.join(' '));
  }
});

test('exact source-run accounting handles many duplicate removals without candidate matching', () => {
  const sourceTextRuns = Array.from({ length: 512 }, (_, index) => ({ page: 1, text: 'LABEL', retained: index % 4 !== 3 }));
  const textReplacements = sourceTextRuns.filter(run => !run.retained).map(run => ({ page: run.page, originalText: run.text, replacementText: 'NEW' }));
  const result = verifyPdfExportSnapshots({
    mode: 'structure-preserving', sourceTextRuns, textReplacements,
    source: snapshot({ pageText: [sourceTextRuns.map(run => run.text).join(' '), 'Contract page two'] }),
    output: snapshot({ pageText: [sourceTextRuns.map(run => run.retained ? run.text : 'NEW').join(' '), 'Contract page two'] }),
  });
  assert.equal(result.ok, true, result.failures.join(' '));
});

test('final bytes verify mapped replacements and reject dropped added graphics', async () => {
  const makePdf = async (edited: boolean, shape: boolean) => {
    const pdf = await PDFDocument.create();
    const first = pdf.addPage([300, 400]);
    first.drawText('ORIGINAL', { x: 20, y: 380, size: 12 });
    first.drawText('BETWEEN', { x: 20, y: 350, size: 12 });
    first.drawText(edited ? 'REPLACEMENT' : 'ORIGINAL', { x: 20, y: 320, size: 12 });
    first.drawText('KEEP NEIGHBOR', { x: 20, y: 300, size: 12 });
    if (shape) first.drawRectangle({ x: 20, y: 200, width: 80, height: 30 });
    pdf.addPage([300, 400]).drawText('PAGE TWO', { x: 20, y: 340, size: 12 });
    return pdf.save();
  };
  const source = await makePdf(false, false);
  const plan: PdfEditorPagePlan = { sourcePageCount: 2, entries: [
    { id: 'p2', sourcePage: 2, rotation: 0 },
    { id: 'p1', sourcePage: 1, rotation: 0 },
    { id: 'p1-copy', sourcePage: 1, rotation: 90 },
  ] };
  for (const shape of [true, false]) {
    const output = await exportPdfEditorPagePlan({ source: await makePdf(true, shape), plan });
    const result = await verifyGeneratedPdf({
      mode: 'compatibility-render', sourceBytes: source, outputBytes: output.bytes, pagePlan: plan,
      textReplacements: [{ page: 1, originalText: 'ORIGINAL', replacementText: 'REPLACEMENT' }],
      sourceTextRuns: [
        { page: 1, text: 'ORIGINAL', retained: true },
        { page: 1, text: 'BETWEEN', retained: true },
        { page: 1, text: 'ORIGINAL', retained: false },
        { page: 1, text: 'KEEP NEIGHBOR', retained: true },
        { page: 2, text: 'PAGE TWO', retained: true },
      ],
      addedPaint: [{ page: 1, paths: 1, images: 0 }],
    });
    assert.equal(result.ok, shape, result.failures.join(' '));
    assert.equal(result.output?.pageCount, 3);
    assert.equal(result.output?.byteLength, output.bytes.byteLength);
    if (!shape) assert.match(result.failures.join(' '), /drawing|graphic/i);
  }
  const wrong = await verifyGeneratedPdf({
    mode: 'compatibility-render', sourceBytes: source, outputBytes: await makePdf(true, true), pagePlan: plan,
    textReplacements: [{ page: 1, originalText: 'ORIGINAL', replacementText: 'REPLACEMENT' }],
  });
  assert.equal(wrong.ok, false);
});

test('page-plan verification retains image-only drawing inventories without canvas additions', async (t) => {
  const pdf = await PDFDocument.create();
  // Opaque RGB pixels keep this fixture entirely in memory and independent of fonts.
  const image = pdf.context.register(pdf.context.stream(new Uint8Array([255, 0, 0]), {
    Type: 'XObject', Subtype: 'Image', Width: 1, Height: 1, ColorSpace: 'DeviceRGB', BitsPerComponent: 8,
  }));
  for (let index = 0; index < 2; index += 1) {
    const page = pdf.addPage([300, 400]);
    page.node.set(PDFName.of('Resources'), pdf.context.obj({ XObject: { Img: image } }));
    page.node.set(PDFName.of('Contents'), pdf.context.register(pdf.context.stream('q 80 0 0 100 20 50 cm /Img Do Q')));
  }
  const source = await pdf.save();
  const plan: PdfEditorPagePlan = { sourcePageCount: 2, entries: [
    { id: 'p2', sourcePage: 2, rotation: 0 },
    { id: 'p1', sourcePage: 1, rotation: 90 },
    { id: 'p1-copy', sourcePage: 1, rotation: 180 },
  ] };
  const planned = await exportPdfEditorPagePlan({ source, plan });
  const verify = (outputBytes: Uint8Array, paintSourceBytes?: Uint8Array) => verifyGeneratedPdf({
    mode: 'compatibility-render', sourceBytes: source, outputBytes, pagePlan: plan, paintSourceBytes,
  });

  await t.test('reorder, duplication and rotation preserve image-only pages', async () => {
    const result = await verify(planned.bytes);
    assert.equal(result.ok, true, result.failures.join(' '));
    assert.equal(result.output?.pageCount, 3);
    assert.deepEqual(result.output?.pageText, ['', '', '']);
    assert.deepEqual(result.output?.pageRotations, [0, 90, 180]);
    assert.equal(result.output?.pagePaint?.length, 3);
    assert.ok(result.output?.pagePaint?.every(page => page.images > 0));
  });

  for (const index of [0, 1, 2]) {
    await t.test(`blanking mapped output page ${index + 1} fails`, async () => {
      const blanked = await PDFDocument.load(planned.bytes);
      blanked.getPage(index).node.delete(PDFName.of('Contents'));
      const result = await verify(await blanked.save());
      assert.equal(result.ok, false, 'An image-only page was blanked without changing text, count or rotation.');
      assert.deepEqual(result.output?.pageText, ['', '', '']);
      assert.equal(result.output?.pageCount, 3);
      assert.deepEqual(result.output?.pageRotations, [0, 90, 180]);
      assert.ok(result.checks.some(check => check.id === `retained-graphics-${index + 1}` && check.status === 'failed'));
    });
  }

  await t.test('an image annotation cannot substitute for missing page content', async () => {
    const blanked = await PDFDocument.load(planned.bytes);
    const page = blanked.getPage(2);
    page.node.delete(PDFName.of('Contents'));
    const appearance = blanked.context.register(blanked.context.stream('/Img Do', {
      Type: 'XObject', Subtype: 'Form', BBox: [0, 0, 1, 1], Resources: page.node.Resources(),
    }));
    page.node.set(PDFName.of('Annots'), blanked.context.obj([{
      Type: 'Annot', Subtype: 'Stamp', Name: 'Approved', F: 4, Rect: [20, 50, 100, 150], AP: { N: appearance },
    }]));
    const result = await verify(await blanked.save());
    assert.equal(result.ok, false);
    assert.equal(result.output?.pagePaint?.[2].images, 0);
  });

  await t.test('the supplied post-server inventory permits intentional loss only on its mapped pages', async () => {
    const committed = await PDFDocument.load(source);
    committed.getPage(0).node.delete(PDFName.of('Contents'));
    const paintSourceBytes = await committed.save();
    const output = await exportPdfEditorPagePlan({ source: paintSourceBytes, plan });
    const permitted = await verify(output.bytes, paintSourceBytes);
    assert.equal(permitted.ok, true, permitted.failures.join(' '));
    const withoutCommittedSource = await verify(output.bytes);
    assert.equal(withoutCommittedSource.ok, false);
    const furtherLoss = await PDFDocument.load(output.bytes);
    furtherLoss.getPage(0).node.delete(PDFName.of('Contents'));
    const rejected = await verify(await furtherLoss.save(), paintSourceBytes);
    assert.equal(rejected.ok, false);
    assert.ok(rejected.checks.some(check => check.id === 'retained-graphics-1' && check.status === 'failed'));
    committed.removePage(1);
    const wrongSourceCount = await verify(planned.bytes, await committed.save());
    assert.equal(wrongSourceCount.ok, false);
    assert.match(wrongSourceCount.failures.join(' '), /paint.*source.*count/i);
  });

  await t.test('legacy no-plan verification does not opt into paint inventory scans', async () => {
    const result = await verifyGeneratedPdf({ mode: 'byte-preserving', sourceBytes: source, outputBytes: source });
    assert.equal(result.ok, true, result.failures.join(' '));
    assert.equal(result.output?.pagePaint, undefined);
  });
});
