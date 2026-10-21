import assert from 'node:assert/strict';
import test from 'node:test';

import { PDFDocument, StandardFonts, degrees } from 'pdf-lib';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';

import {
  applyPdfEditorPageOperation,
  createPdfEditorPagePlan,
} from './editorPageModel.ts';
import type { PdfEditorPagePlan } from './editorPageModel.ts';
import {
  decidePdfEditorPageExportStrategy,
  expectedPdfEditorPagePlanOrder,
  expectedPdfEditorPagePlanRotations,
  exportPdfEditorPagePlan,
} from './editorPageExport.ts';

/** Each page is uniquely labelled so reordering can be proven from output text. */
async function createPagedPdf(): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.setTitle('SmilePDF page plan contract');
  pdf.setAuthor('SmilePDF');
  const font = await pdf.embedFont(StandardFonts.Helvetica);

  ['ALPHA', 'BRAVO', 'CHARLIE'].forEach((label, index) => {
    const page = pdf.addPage([612, 792]);
    page.drawText(`Page marker ${label}`, { x: 60, y: 700, size: 18, font });
    if (index === 2) page.setRotation(degrees(90));
  });

  return pdf.save();
}

function planFrom(sourcePageCount: number): PdfEditorPagePlan {
  const created = createPdfEditorPagePlan(sourcePageCount);
  assert.equal(created.ok, true);
  if (!created.ok) throw new Error('plan setup failed');
  return created.plan;
}

function apply(
  plan: PdfEditorPagePlan,
  operation: Parameters<typeof applyPdfEditorPageOperation>[1],
): PdfEditorPagePlan {
  const result = applyPdfEditorPageOperation(plan, operation);
  assert.equal(result.ok, true);
  if (!result.ok) throw new Error('operation setup failed');
  return result.plan;
}

async function readPageText(bytes: Uint8Array) {
  const task = pdfjs.getDocument({ data: bytes.slice() });
  const document = await task.promise;
  try {
    const pages: string[] = [];
    const rotations: number[] = [];
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      const page = await document.getPage(pageNumber);
      const content = await page.getTextContent();
      pages.push(content.items.map(item => ('str' in item ? item.str : '')).join(' ').replace(/\s+/g, ' ').trim());
      rotations.push(((page.rotate ?? 0) % 360 + 360) % 360);
    }
    return { pages, rotations };
  } finally {
    await document.destroy();
    await task.destroy?.();
  }
}

test('an untouched page plan keeps byte-preserving export available', async () => {
  const source = await createPagedPdf();
  const plan = planFrom(3);

  const decision = decidePdfEditorPageExportStrategy(plan);
  assert.equal(decision.strategy, 'byte-preserving');
  assert.equal(decision.declaredLosses.length, 0);

  const { bytes } = await exportPdfEditorPagePlan({ source, plan });
  assert.deepEqual(Array.from(bytes), Array.from(source));
});

test('rotation-only plans stay on the source document instead of rebuilding it', async () => {
  const source = await createPagedPdf();
  const plan = apply(planFrom(3), { type: 'rotate', pages: [1], delta: 90 });

  const decision = decidePdfEditorPageExportStrategy(plan);
  assert.equal(decision.strategy, 'rotation-in-place');
  assert.equal(decision.declaredLosses.length, 0);

  const { bytes } = await exportPdfEditorPagePlan({ source, plan });
  const output = await readPageText(bytes);

  assert.equal(output.pages.length, 3);
  assert.match(output.pages[0], /ALPHA/);
  assert.equal(output.rotations[0], 90);
  // The untouched rotated source page must keep its own rotation.
  assert.equal(output.rotations[2], 90);
});

test('editor rotation composes with the rotation the source page already had', async () => {
  const source = await createPagedPdf();
  const plan = apply(planFrom(3), { type: 'rotate', pages: [3], delta: 180 });

  const { bytes } = await exportPdfEditorPagePlan({ source, plan });
  const output = await readPageText(bytes);

  // Source page 3 was already at 90; a 180 delta must land on 270, not 180.
  assert.equal(output.rotations[2], 270);
  assert.deepEqual(expectedPdfEditorPagePlanRotations(plan, [0, 0, 90]), [0, 0, 270]);
});

test('reordering rebuilds the document and places pages in the planned order', async () => {
  const source = await createPagedPdf();
  const plan = apply(planFrom(3), { type: 'move', from: 3, to: 1 });

  const decision = decidePdfEditorPageExportStrategy(plan);
  assert.equal(decision.strategy, 'page-rebuild');
  assert.equal(decision.declaredLosses.includes('form fields'), true);
  assert.deepEqual(expectedPdfEditorPagePlanOrder(plan), [3, 1, 2]);

  const { bytes } = await exportPdfEditorPagePlan({ source, plan });
  const output = await readPageText(bytes);

  assert.equal(output.pages.length, 3);
  assert.match(output.pages[0], /CHARLIE/);
  assert.match(output.pages[1], /ALPHA/);
  assert.match(output.pages[2], /BRAVO/);
  assert.equal(output.rotations[0], 90);
});

test('deleting a page removes exactly that page and keeps the rest in order', async () => {
  const source = await createPagedPdf();
  const plan = apply(planFrom(3), { type: 'delete', pages: [2] });

  const { bytes } = await exportPdfEditorPagePlan({ source, plan });
  const output = await readPageText(bytes);

  assert.equal(output.pages.length, 2);
  assert.match(output.pages[0], /ALPHA/);
  assert.match(output.pages[1], /CHARLIE/);
  assert.equal(output.pages.some(text => /BRAVO/.test(text)), false);
});

test('duplicating a page emits the same content twice without disturbing neighbours', async () => {
  const source = await createPagedPdf();
  const plan = apply(planFrom(3), { type: 'duplicate', pages: [1] });

  const { bytes } = await exportPdfEditorPagePlan({ source, plan });
  const output = await readPageText(bytes);

  assert.equal(output.pages.length, 4);
  assert.match(output.pages[0], /ALPHA/);
  assert.match(output.pages[1], /ALPHA/);
  assert.match(output.pages[2], /BRAVO/);
  assert.match(output.pages[3], /CHARLIE/);
});

test('a rebuilt document carries document title and author forward', async () => {
  const source = await createPagedPdf();
  const plan = apply(planFrom(3), { type: 'delete', pages: [2] });

  const { bytes } = await exportPdfEditorPagePlan({ source, plan });
  const reopened = await PDFDocument.load(bytes, { updateMetadata: false });

  assert.equal(reopened.getTitle(), 'SmilePDF page plan contract');
  assert.equal(reopened.getAuthor(), 'SmilePDF');
});

test('a plan built for a different document is rejected instead of exporting wrong pages', async () => {
  const source = await createPagedPdf();
  const mismatched = apply(planFrom(5), { type: 'move', from: 2, to: 1 });

  await assert.rejects(
    () => exportPdfEditorPagePlan({ source, plan: mismatched }),
    /targets 5 source pages but the document has 3/,
  );
});
