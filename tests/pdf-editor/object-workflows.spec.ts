import { readFile } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';
import { PDFDocument } from 'pdf-lib';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';

async function openDocument(page: Page) {
  const document = await PDFDocument.create();
  for (let index = 1; index <= 2; index += 1) {
    document.addPage([612, 792]).drawText(`UNCHANGED SOURCE PAGE ${index}`, { x: 40, y: 750, size: 12 });
  }
  await page.goto('/pdf-editor');
  const input = page.getByTestId('pdf-upload-input');
  await expect(input).toHaveAttribute('data-editor-ready', 'true', { timeout: 30_000 });
  await input.setInputFiles({ name: 'objects.pdf', mimeType: 'application/pdf', buffer: Buffer.from(await document.save()) });
  await expect(page.getByTestId('pdf-tool-select')).toBeEnabled({ timeout: 30_000 });
  await expect(page.locator('.pe-loading-overlay')).toHaveCount(0, { timeout: 30_000 });
}

async function goToPage(page: Page, number: number) {
  const input = page.getByTestId('pdf-page-jump');
  await input.fill(String(number));
  await input.press('Enter');
  await expect(page.getByTestId('pdf-tool-select')).toBeEnabled({ timeout: 30_000 });
  await expect(page.locator(`[data-pdf-page-shell="${number}"] canvas.upper-canvas`)).toHaveCount(1, { timeout: 30_000 });
}

async function savedObjects(page: Page, number: number) {
  await expect(page.getByTestId('pdf-save-status')).toContainText('Saved locally', { timeout: 15_000 });
  return page.evaluate(async (pageNumber) => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('smilepdf:editor:v1', 1);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      const record = await new Promise<{ draft: { canvasStates: Record<string, { objects?: Record<string, unknown>[] }> } }>((resolve, reject) => {
        const request = database.transaction('drafts', 'readonly').objectStore('drafts').get('latest');
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      return record.draft.canvasStates[String(pageNumber)]?.objects ?? [];
    } finally {
      database.close();
    }
  }, number);
}

async function geometry(page: Page, values: Record<string, number>) {
  for (const [label, value] of Object.entries(values)) {
    const input = page.getByTestId('pdf-object-geometry').getByRole('spinbutton', { name: label, exact: true });
    await input.fill(String(value));
    await input.press('Enter');
  }
}

async function shapeColor(page: Page, color: string) {
  await page.getByLabel('Shape fill color').evaluate((element, value) => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(element, value);
    element.dispatchEvent(new Event('input', { bubbles: true }));
    element.dispatchEvent(new Event('change', { bubbles: true }));
  }, color);
}

async function rectangle(page: Page) {
  await page.getByRole('button', { name: 'Shapes', exact: true }).click();
  await page.getByTestId('pdf-tool-rect').click();
  const frame = await page.locator('.pe-page-frame').boundingBox();
  expect(frame).not.toBeNull();
  await page.mouse.move(frame!.x + frame!.width * 0.2, frame!.y + frame!.height * 0.2);
  await page.mouse.down();
  await page.mouse.move(frame!.x + frame!.width * 0.5, frame!.y + frame!.height * 0.4, { steps: 8 });
  await page.mouse.up();
  await expect(page.getByTestId('pdf-object-geometry')).toBeVisible();
}

test('text duplicate and cross-page clipboard survive undo redo recovery and export', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'Full object workflow uses the desktop inspector.');
  await openDocument(page);
  await page.getByRole('button', { name: 'Insert', exact: true }).click();
  await page.getByTestId('pdf-tool-text').click();
  await page.keyboard.insertText('OBJECT COPY CHECK');
  await page.getByTestId('pdf-tool-select').click();
  await page.getByRole('button', { name: 'Text 1', exact: true }).click();
  const beforeMove = (await savedObjects(page, 1))[0];
  await geometry(page, { X: 85, Y: 160 });
  const original = (await savedObjects(page, 1))[0];
  expect([original.width, original.height, original.scaleX, original.scaleY])
    .toEqual([beforeMove.width, beforeMove.height, beforeMove.scaleX, beforeMove.scaleY]);
  await page.getByRole('button', { name: 'Duplicate', exact: true }).click();
  await expect(page.locator('.pe-layer-row')).toHaveCount(2, { timeout: 10_000 });
  const duplicated = await savedObjects(page, 1);
  expect(new Set(duplicated.map(object => object.peId)).size).toBe(2);
  expect(duplicated[0].peId).toBe(original.peId);
  expect(duplicated[1].left).toBe(Number(original.left) + 12);
  expect(duplicated[1].top).toBe(Number(original.top) + 12);
  expect(duplicated[1].text).toBe(original.text);
  await page.getByRole('button', { name: 'Copy', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Paste object on this page', exact: true })).toBeVisible();
  await goToPage(page, 2);
  await page.getByRole('button', { name: 'Paste object on this page', exact: true }).click();
  await expect(page.locator('.pe-layer-row')).toHaveCount(1);
  const pasted = await savedObjects(page, 2);
  expect(duplicated.map(object => object.peId)).not.toContain(pasted[0].peId);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(page.locator('.pe-layer-row')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Paste object on this page', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Redo', exact: true }).click();
  await expect(page.locator('.pe-layer-row')).toHaveCount(1);
  expect((await savedObjects(page, 2))[0].peId).toBe(pasted[0].peId);
  await page.getByRole('button', { name: 'Paste object on this page', exact: true }).click();
  await expect(page.locator('.pe-layer-row')).toHaveCount(2);
  const secondPage = await savedObjects(page, 2);
  expect(new Set([...duplicated, ...secondPage].map(object => object.peId)).size).toBe(4);

  await page.reload();
  await expect(page.getByTestId('pdf-upload-input')).toHaveAttribute('data-editor-ready', 'true', { timeout: 30_000 });
  await page.getByTestId('pdf-recovery-resume').click();
  await expect(page.locator('.pe-layer-row')).toHaveCount(2, { timeout: 30_000 });
  await goToPage(page, 2);
  await expect(page.locator('.pe-layer-row')).toHaveCount(2);
  const pending = page.waitForEvent('download');
  await page.getByTestId('pdf-export-button').click();
  const output = testInfo.outputPath('objects.pdf');
  await (await pending).saveAs(output);
  let exportNotes = '';
  if (await page.getByTestId('pdf-export-disclosures').count()) {
    await page.getByTestId('pdf-export-disclosures').click();
    exportNotes = await page.locator('.pe-status-panel').innerText();
  }
  await testInfo.attach('object-export-state', { contentType: 'application/json', body: JSON.stringify({ duplicated, secondPage, exportNotes }, null, 2) });
  const document = await pdfjs.getDocument({ data: new Uint8Array(await readFile(output)) }).promise;
  try {
    expect(document.numPages).toBe(2);
    for (let number = 1; number <= 2; number += 1) {
      const content = await (await document.getPage(number)).getTextContent();
      const text = content.items.filter(item => 'str' in item);
      expect(text.map(item => item.str).join(' ')).toContain(`UNCHANGED SOURCE PAGE ${number}`);
      const copies = text.filter(item => item.str === 'OBJECT COPY CHECK');
      expect(copies, `Extracted ${JSON.stringify(text.map(item => item.str))}. ${exportNotes}`).toHaveLength(2);
      const expected = number === 1 ? duplicated : secondPage;
      for (const [index, object] of expected.entries()) {
        expect(copies[index].transform[4]).toBeCloseTo(Number(object.left), 0);
        const baseline = 792 - copies[index].transform[5];
        expect(baseline).toBeGreaterThan(Number(object.top));
        expect(baseline).toBeLessThan(Number(object.top) + Number(object.height) + 2);
      }
    }
  } finally {
    await document.destroy();
  }
});

test('shape layer order and lock visibility survive history and recovery', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'Full object workflow uses the desktop inspector.');
  await openDocument(page);
  await rectangle(page);
  await geometry(page, { X: 100, Y: 160, W: 120, H: 80 });
  await shapeColor(page, '#cc2200');
  const before = (await savedObjects(page, 1))[0];
  await page.getByRole('button', { name: 'Duplicate', exact: true }).click();
  await expect(page.locator('.pe-layer-row')).toHaveCount(2, { timeout: 10_000 });
  await shapeColor(page, '#0066dd');
  const objects = await savedObjects(page, 1);
  expect(objects[0].fill).toBe('#cc2200');
  expect(objects[1].fill).toBe('#0066dd');
  await page.getByRole('button', { name: 'Move Shape 2 backward', exact: true }).click();
  await expect(page.locator('.pe-layer-name')).toHaveText(['Shape 1', 'Shape 2']);
  expect((await savedObjects(page, 1)).map(object => object.peId)).toEqual([objects[1].peId, before.peId]);
  await page.getByRole('button', { name: 'Move Shape 2 forward', exact: true }).click();
  await expect(page.locator('.pe-layer-name')).toHaveText(['Shape 2', 'Shape 1']);
  await page.getByRole('button', { name: 'Lock Shape 1', exact: true }).click();
  await page.getByRole('button', { name: 'Hide Shape 1', exact: true }).click();
  await savedObjects(page, 1);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Hide Shape 1', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Redo', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Show Shape 1', exact: true })).toBeVisible();
  const restored = (await savedObjects(page, 1)).find(object => object.peId === before.peId)!;
  expect(restored.peLocked).toBe(true);
  expect(restored.lockMovementX).toBe(true);
  expect(restored.lockScalingX).toBe(true);
  expect(restored.visible).toBe(false);
  expect(restored.evented).toBe(false);
  await page.reload();
  await expect(page.getByTestId('pdf-upload-input')).toHaveAttribute('data-editor-ready', 'true', { timeout: 30_000 });
  await page.getByTestId('pdf-recovery-resume').click();
  await expect(page.getByRole('button', { name: 'Show Shape 1', exact: true })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole('button', { name: 'Unlock Shape 1', exact: true })).toBeVisible();
  await expect(page.locator('.pe-layer-name')).toHaveText(['Shape 2', 'Shape 1']);
});
