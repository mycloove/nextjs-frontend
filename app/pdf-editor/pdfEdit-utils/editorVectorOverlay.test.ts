import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { PDFDocument } from 'pdf-lib';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';

import {
  parsePdfEditorVectorColor,
  planPdfEditorVectorPage,
} from './editorVectorOverlay.ts';
import { exportStructurePreservingPdf } from './editorExport.ts';
import { verifyGeneratedPdf } from './editorExportVerification.ts';

const exportFonts = {
  'latin-regular': readFileSync(new URL('../../../public/fonts/pdf-editor/LiberationSans-Regular.ttf', import.meta.url)),
  'latin-bold': readFileSync(new URL('../../../public/fonts/pdf-editor/LiberationSans-Bold.ttf', import.meta.url)),
  'latin-italic': readFileSync(new URL('../../../public/fonts/pdf-editor/LiberationSans-Italic.ttf', import.meta.url)),
  'latin-boldItalic': readFileSync(new URL('../../../public/fonts/pdf-editor/LiberationSans-BoldItalic.ttf', import.meta.url)),
  'bengali-regular': readFileSync(new URL('../../../public/fonts/pdf-editor/NotoSansBengali-Regular.ttf', import.meta.url)),
  'bengali-bold': readFileSync(new URL('../../../public/fonts/pdf-editor/NotoSansBengali-Bold.ttf', import.meta.url)),
};

const base = {
  page: 1,
  width: 400,
  height: 600,
};

const pageWith = (objects: unknown[]) => ({
  ...base,
  state: { version: '5.5.2', objects },
});

test('left-aligned Latin text becomes a positioned real-text operation', () => {
  const plan = planPdfEditorVectorPage(pageWith([{
    type: 'textbox',
    left: 40,
    top: 80,
    width: 200,
    height: 30,
    scaleX: 1,
    scaleY: 1,
    fontSize: 14,
    text: 'Vector hello',
    fill: '#112233',
    fontFamily: 'Helvetica',
    textAlign: 'left',
    lineHeight: 1.2,
  }]));

  assert.equal(plan.ok, true);
  if (!plan.ok) return;
  assert.equal(plan.hasText, true);
  assert.deepEqual(plan.operations.map(operation => operation.kind), ['text']);
  const operation = plan.operations[0];
  assert.equal(operation.kind, 'text');
  if (operation.kind !== 'text') return;
  assert.equal(operation.text, 'Vector hello');
  assert.equal(operation.size, 14);
  assert.equal(operation.font, 'latin-regular');
  assert.equal(operation.x, 40);
  // 600 - 80 - 14
  assert.equal(operation.y, 506);
  assert.equal(operation.maxWidth, 200);
  assert.deepEqual(operation.color.color.map(channel => Math.round(channel * 255)), [17, 34, 51]);
});

test('bold italic text picks the matching embedded face and scaled geometry', () => {
  const plan = planPdfEditorVectorPage(pageWith([{
    type: 'textbox',
    left: 10,
    top: 20,
    width: 200,
    height: 40,
    scaleX: 2,
    scaleY: 2,
    fontSize: 10,
    text: 'Styled',
    fill: 'black',
    fontWeight: 'bold',
    fontStyle: 'italic',
  }]));
  assert.equal(plan.ok, true);
  if (!plan.ok || plan.operations[0].kind !== 'text') return;
  assert.equal(plan.operations[0].font, 'latin-boldItalic');
  assert.equal(plan.operations[0].size, 20);
  assert.equal(plan.operations[0].maxWidth, 400);
});

test('rectangles, ellipses, lines and freehand paths stay vector', () => {
  const plan = planPdfEditorVectorPage(pageWith([
    { type: 'rect', left: 10, top: 20, width: 80, height: 40, scaleX: 1, scaleY: 1, fill: 'rgba(255,235,59,0.45)', stroke: 'none', strokeWidth: 2 },
    { type: 'ellipse', left: 100, top: 20, rx: 20, ry: 10, scaleX: 1, scaleY: 1, fill: 'transparent', stroke: '#000', strokeWidth: 2 },
    { type: 'line', left: 10, top: 100, x1: 0, y1: 0, x2: 50, y2: 0, stroke: '#000', strokeWidth: 2 },
    { type: 'path', left: 10, top: 120, scaleX: 1, scaleY: 1, fill: 'transparent', stroke: '#000', strokeWidth: 2, path: [['M', 0, 0], ['Q', 10, 20, 20, 0], ['L', 30, 0]] },
  ]));
  assert.equal(plan.ok, true);
  if (!plan.ok) return;
  assert.deepEqual(plan.operations.map(operation => operation.kind), ['rect', 'ellipse', 'line', 'polyline']);
  const rect = plan.operations[0];
  assert.equal(rect.kind, 'rect');
  if (rect.kind !== 'rect') return;
  assert.equal(rect.y, 600 - 20 - 40);
  assert.ok(rect.fill);
  assert.equal(rect.fill?.opacity, 0.45);
  assert.equal(rect.stroke, null);

  const polyline = plan.operations[3];
  assert.equal(polyline.kind, 'polyline');
  if (polyline.kind !== 'polyline') return;
  assert.ok(polyline.points.length > 4);
  assert.equal(polyline.points[0].y, 480);
});

test('unsupported objects send the whole page to the disclosed raster fallback', () => {
  const plan = planPdfEditorVectorPage(pageWith([
    { type: 'textbox', left: 0, top: 0, width: 100, text: 'ok', fontSize: 12, scaleX: 1, scaleY: 1, fill: '#000' },
    { type: 'image', left: 0, top: 0, width: 50, height: 50 },
  ]));
  assert.equal(plan.ok, false);
  if (plan.ok) return;
  assert.deepEqual(plan.reasons, ['image']);
});

test('rotated, centered and right-to-left text are refused, not guessed', () => {
  const rotated = planPdfEditorVectorPage(pageWith([{ type: 'textbox', text: 'Hi', fontSize: 12, width: 100, angle: 45, scaleX: 1, scaleY: 1, fill: '#000' }]));
  assert.equal(rotated.ok, false);

  const centered = planPdfEditorVectorPage(pageWith([{ type: 'textbox', text: 'Hi', fontSize: 12, width: 100, textAlign: 'center', scaleX: 1, scaleY: 1, fill: '#000' }]));
  assert.equal(centered.ok, false);

  const hebrew = planPdfEditorVectorPage(pageWith([{ type: 'textbox', text: 'שלום', fontSize: 12, width: 100, scaleX: 1, scaleY: 1, fill: '#000' }]));
  assert.equal(hebrew.ok, false);
  if (!hebrew.ok) assert.ok(hebrew.reasons.some(reason => reason.includes('bidirectional')));
});

test('Bengali text is placed with the embedded Bengali face, not rasterised', () => {
  const bengali = planPdfEditorVectorPage(pageWith([{
    type: 'textbox',
    text: 'বাংলা কি ক্ষ',
    fontSize: 12,
    width: 200,
    scaleX: 1,
    scaleY: 1,
    fill: '#000',
  }]));
  assert.equal(bengali.ok, true);
  if (!bengali.ok || bengali.operations[0].kind !== 'text') return;
  assert.equal(bengali.operations[0].font, 'bengali-regular');

  const bold = planPdfEditorVectorPage(pageWith([{
    type: 'textbox',
    text: 'বাংলা',
    fontSize: 12,
    width: 200,
    scaleX: 1,
    scaleY: 1,
    fill: '#000',
    fontWeight: 'bold',
  }]));
  assert.equal(bold.ok, true);
  if (bold.ok && bold.operations[0].kind === 'text') {
    assert.equal(bold.operations[0].font, 'bengali-bold');
  }

  const italic = planPdfEditorVectorPage(pageWith([{
    type: 'textbox',
    text: 'বাংলা',
    fontSize: 12,
    width: 200,
    scaleX: 1,
    scaleY: 1,
    fill: '#000',
    fontStyle: 'italic',
  }]));
  assert.equal(italic.ok, false);
});

test('colour parsing covers the canvas palette and refuses unknown values', () => {
  assert.deepEqual(parsePdfEditorVectorColor('#abc'), { color: [170 / 255, 187 / 255, 204 / 255], opacity: 1 });
  assert.deepEqual(parsePdfEditorVectorColor('rgba(10, 20, 30, 0.5)'), { color: [10 / 255, 20 / 255, 30 / 255], opacity: 0.5 });
  assert.equal(parsePdfEditorVectorColor('transparent'), null);
  assert.equal(parsePdfEditorVectorColor('var(--pe-signal)'), null);
});

async function extractText(bytes: Uint8Array): Promise<string> {
  const loadingTask = pdfjs.getDocument({ data: bytes.slice() });
  const document = await loadingTask.promise;
  try {
    const page = await document.getPage(1);
    const content = await page.getTextContent();
    return content.items.map(item => ('str' in item ? item.str : '')).join(' ');
  } finally {
    await document.destroy();
  }
}

async function emptySource(): Promise<Uint8Array> {
  const source = await PDFDocument.create();
  source.addPage([400, 600]);
  return source.save();
}

test('embedded vector text is selectable in the exported PDF', async () => {
  const source = await emptySource();
  const exported = await exportStructurePreservingPdf({
    source,
    vectorFonts: exportFonts,
    vectorMutations: [{
      kind: 'text',
      page: 1,
      opacity: 1,
      x: 40,
      y: 500,
      text: 'Vector hello',
      size: 14,
      font: 'latin-regular',
      color: { color: [0.1, 0.2, 0.3], opacity: 1 },
      maxWidth: 200,
      lineHeight: 1.2,
    }],
  });

  assert.match(await extractText(exported), /Vector hello/);
});

test('Bengali survives a vector export round trip and is verified as extractable', async () => {
  const source = await emptySource();
  const bengali = 'বাংলা কি ক্ষ';
  const exported = await exportStructurePreservingPdf({
    source,
    vectorFonts: exportFonts,
    vectorMutations: [{
      kind: 'text',
      page: 1,
      opacity: 1,
      x: 40,
      y: 500,
      text: bengali,
      size: 18,
      font: 'bengali-regular',
      color: { color: [0, 0, 0], opacity: 1 },
      maxWidth: 300,
      lineHeight: 1.2,
    }],
  });

  const extracted = await extractText(exported);
  for (const char of bengali) {
    if (/\s/.test(char)) continue;
    assert.ok(extracted.includes(char), `expected ${char} in extracted text ${extracted}`);
  }

  const verification = await verifyGeneratedPdf({
    mode: 'structure-preserving',
    sourceBytes: source,
    outputBytes: exported,
    addedText: [{ page: 1, text: bengali }],
  });
  assert.equal(verification.ok, true);
  assert.equal(
    verification.checks.some(check => check.id === 'added-text-1' && check.status === 'passed'),
    true,
  );
});

test('vector text refuses to export when its embedded font was not supplied', async () => {
  await assert.rejects(
    exportStructurePreservingPdf({
      source: await emptySource(),
      vectorMutations: [{
        kind: 'text',
        page: 1,
        opacity: 1,
        x: 0,
        y: 100,
        text: 'No font',
        size: 12,
        font: 'latin-regular',
        color: { color: [0, 0, 0], opacity: 1 },
        maxWidth: 100,
        lineHeight: 1.2,
      }],
    }),
    /Embedded export font latin-regular is unavailable/,
  );
});
