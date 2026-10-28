import { expect, test, type Page } from '@playwright/test';
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { PDFDocument } from 'pdf-lib';

/**
 * Canvas-object coordinates are page points, not screen pixels.
 *
 * Fabric's viewport carries the zoom (`fc.setZoom`), so `getPointer`, `left`,
 * `top` and every object extent are already in the page's point space. The
 * editor used to divide by zoom when reading an object and multiply by zoom
 * when writing one. At Fit page that made a drag stop at the *middle* of the
 * page: the object was written at `zoom` times the gesture and clamped there.
 * This test drives a real drag at a zoom well below 1 and proves the object
 * reaches the bottom-right corner the user aimed at.
 */
const fixtures = path.join(__dirname, 'fixtures');

async function uploadPlain(page: Page) {
  await page.goto('/pdf-editor');
  await page.evaluate(async () => {
    localStorage.clear();
    const databases = await indexedDB.databases();
    await Promise.all(databases.map(database => (
      database.name
        ? new Promise<void>((resolve) => {
            const request = indexedDB.deleteDatabase(database.name!);
            request.onsuccess = () => resolve();
            request.onerror = () => resolve();
            request.onblocked = () => resolve();
          })
        : Promise.resolve()
    )));
  });
  const input = page.getByTestId('pdf-upload-input');
  await expect(input).toHaveAttribute('data-editor-ready', 'true', { timeout: 30_000 });
  await input.setInputFiles(path.join(fixtures, 'phase-1e-plain.pdf'));
  await expect(page.getByTestId('pdf-page-jump')).toBeVisible({ timeout: 30_000 });
  await expect(page.locator('.pe-loading-overlay')).toHaveCount(0, { timeout: 30_000 });
  await page.waitForFunction(() => {
    const canvas = document.querySelector('.pe-page-frame canvas') as HTMLCanvasElement | null;
    return Boolean(canvas && canvas.width > 200 && canvas.height > 200);
  }, null, { timeout: 30_000 });
}

/**
 * Bounding box of saturated pixels in a screenshot of the page.
 *
 * The fixture is black text on white, so the only saturated content is the
 * inserted colour emoji. This measures where the user actually sees it,
 * without reaching into Fabric's internals.
 */
async function emojiBounds(page: Page, selector: string) {
  const base64 = (await page.locator(selector).screenshot()).toString('base64');
  return page.evaluate(async (imageBase64) => {
    const image = new Image();
    image.src = `data:image/png;base64,${imageBase64}`;
    await image.decode();
    const canvas = document.createElement('canvas');
    canvas.width = image.width;
    canvas.height = image.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(image, 0, 0);
    const data = ctx.getImageData(0, 0, image.width, image.height).data;
    let minX = Number.POSITIVE_INFINITY;
    let minY = Number.POSITIVE_INFINITY;
    let maxX = -1;
    let maxY = -1;
    for (let y = 0; y < image.height; y += 1) {
      for (let x = 0; x < image.width; x += 1) {
        const offset = (y * image.width + x) * 4;
        const r = data[offset];
        const g = data[offset + 1];
        const b = data[offset + 2];
        const max = Math.max(r, g, b);
        const min = Math.min(r, g, b);
        const saturation = max === 0 ? 0 : (max - min) / max;
        if (saturation > 0.4 && max > 90) {
          if (x < minX) minX = x;
          if (y < minY) minY = y;
          if (x > maxX) maxX = x;
          if (y > maxY) maxY = y;
        }
      }
    }
    if (maxX < 0 || maxY < 0) return null;
    return {
      x: minX,
      y: minY,
      width: maxX - minX + 1,
      height: maxY - minY + 1,
      imageWidth: image.width,
      imageHeight: image.height,
    };
  }, base64);
}

async function addText(page: Page, value: string) {
  await expect(page.getByTestId('pdf-tool-text')).toBeEnabled({ timeout: 30_000 });
  await page.getByTestId('pdf-tool-text').click();
  await page.keyboard.insertText(value);
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('pdf-object-geometry')).toBeVisible();
}

async function downloadedText(page: Page, output: string) {
  const pending = page.waitForEvent('download');
  await page.getByTestId('pdf-export-button').click();
  await (await pending).saveAs(output);
  const bytes = new Uint8Array(await readFile(output));
  expect((await PDFDocument.load(bytes)).getPageCount()).toBe(1);
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const task = pdfjs.getDocument({ data: bytes, useSystemFonts: true });
  const doc = await task.promise;
  try {
    const content = await (await doc.getPage(1)).getTextContent();
    return content.items.map(item => 'str' in item ? item.str : '').join(' ');
  } finally {
    await task.destroy();
  }
}

test('copy, duplicate, undo, and locked hidden recovery preserve added text', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'Canvas command integration.');
  await uploadPlain(page);
  await addText(page, 'COPIED EDITOR TEXT');
  const rows = page.getByTestId('pdf-page-layers').getByRole('listitem');
  const controls = page.getByTestId('pdf-object-geometry');
  await controls.getByRole('button', { name: 'Duplicate', exact: true }).click();
  await expect(rows).toHaveCount(2);
  await controls.getByRole('button', { name: 'Copy', exact: true }).click();
  await page.getByRole('button', { name: 'Paste object on this page', exact: true }).click();
  await expect(rows).toHaveCount(3);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(rows).toHaveCount(2);
  await page.getByRole('button', { name: 'Redo', exact: true }).click();
  await expect(rows).toHaveCount(3);
  await rows.first().locator('.pe-layer-name').click();
  await controls.getByRole('button', { name: 'Lock', exact: true }).click();
  await controls.getByRole('button', { name: 'Hide', exact: true }).click();
  await expect(rows.getByRole('button', { name: /^Show / })).toHaveCount(1);
  await page.getByRole('button', { name: 'Close editor', exact: true }).click();
  await expect(page.getByTestId('pdf-upload-input')).toHaveAttribute('data-editor-ready', 'true');
  await page.reload();
  await expect(page.getByTestId('pdf-upload-input')).toHaveAttribute('data-editor-ready', 'true', { timeout: 30_000 });
  await page.getByTestId('pdf-recovery-resume').click();
  await expect(rows).toHaveCount(3, { timeout: 30_000 });
  await expect(rows.getByRole('button', { name: /^Unlock / })).toHaveCount(1);
  await expect(rows.getByRole('button', { name: /^Show / })).toHaveCount(1);
  const text = await downloadedText(page, testInfo.outputPath('restored-objects.pdf'));
  expect(text.match(/COPIED EDITOR TEXT/g)).toHaveLength(2);
});

test('a completed clipboard copy can be pasted into a different PDF', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'Clipboard ownership integration.');
  await uploadPlain(page);
  await addText(page, 'CROSS DOCUMENT COPY');
  await page.getByTestId('pdf-object-geometry').getByRole('button', { name: 'Copy', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Paste object on this page', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Close editor', exact: true }).click();
  const target = await PDFDocument.create();
  target.addPage([612, 792]).drawText('TARGET DOCUMENT', { x: 72, y: 700 });
  await page.getByTestId('pdf-upload-input').setInputFiles({
    name: 'clipboard-target.pdf', mimeType: 'application/pdf', buffer: Buffer.from(await target.save()),
  });
  await expect(page.getByTestId('pdf-tool-text')).toBeEnabled({ timeout: 30_000 });
  await expect(page.getByTestId('pdf-page-layers').getByRole('listitem')).toHaveCount(0);
  await page.getByRole('button', { name: 'Paste object on this page', exact: true }).click();
  await expect(page.getByTestId('pdf-page-layers').getByRole('listitem')).toHaveCount(1);
  const text = await downloadedText(page, testInfo.outputPath('clipboard-target.pdf'));
  expect(text).toContain('TARGET DOCUMENT');
  expect(text.match(/CROSS DOCUMENT COPY/g)).toHaveLength(1);
});

async function pageColor(page: Page, selector: string) {
  const png = (await page.locator(selector).screenshot()).toString('base64');
  return page.evaluate(async encoded => {
    const image = new Image();
    image.src = `data:image/png;base64,${encoded}`;
    await image.decode();
    const canvas = document.createElement('canvas');
    canvas.width = image.width;
    canvas.height = image.height;
    const ctx = canvas.getContext('2d')!;
    ctx.drawImage(image, 0, 0);
    const [r, , b] = ctx.getImageData(Math.round(image.width * 210 / 612), Math.round(image.height * 250 / 792), 1, 1).data;
    return r > 200 && b < 70 ? 'red' : b > 200 && r < 70 ? 'blue' : 'other';
  }, png);
}

test('copied groups ungroup into independently selectable text objects', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'Group identity and history integration.');
  await uploadPlain(page);
  await addText(page, 'GROUP COPY TEXT');
  const controls = page.getByTestId('pdf-object-geometry');
  const rows = page.getByTestId('pdf-page-layers').getByRole('listitem');
  const geometry = await page.locator('.pe-geometry-grid input').evaluateAll(inputs => inputs.map(input => Number((input as HTMLInputElement).value)));
  await controls.getByRole('button', { name: 'Duplicate', exact: true }).click();
  await expect(rows).toHaveCount(2);
  await page.getByTestId('pdf-tool-select').click();
  const frame = await page.locator('.pe-page-frame').boundingBox();
  expect(frame).not.toBeNull();
  const point = (y: number) => ({ x: frame!.x + frame!.width * (geometry[0] + 50) / 612, y: frame!.y + frame!.height * y / 792 });
  const first = point(geometry[1] + Math.min(4, geometry[3] / 4));
  const second = point(geometry[1] + 12 + geometry[3] - 3);
  await page.mouse.click(first.x, first.y);
  await page.keyboard.down('Shift');
  await page.mouse.click(second.x, second.y);
  await page.keyboard.up('Shift');
  await expect(controls.getByRole('button', { name: 'Group', exact: true })).toBeEnabled();
  await controls.getByRole('button', { name: 'Group', exact: true }).click();
  await expect(rows).toHaveCount(1);
  await controls.getByRole('button', { name: 'Duplicate', exact: true }).click();
  await expect(rows).toHaveCount(2);
  await controls.getByRole('button', { name: 'Ungroup', exact: true }).click();
  await expect(rows).toHaveCount(3);
  await rows.last().locator('.pe-layer-name').click();
  await controls.getByRole('button', { name: 'Ungroup', exact: true }).click();
  await expect(rows).toHaveCount(4);
  const positions: number[] = [];
  for (let index = 0; index < 4; index += 1) {
    await rows.nth(index).locator('.pe-layer-name').click();
    positions.push(Math.round(Number(await page.locator('.pe-geometry-grid input').first().inputValue())));
  }
  expect(new Set(positions).size).toBeGreaterThanOrEqual(3);
  const text = await downloadedText(page, testInfo.outputPath('grouped-copy.pdf'));
  expect(text.match(/GROUP COPY TEXT/g)).toHaveLength(4);
});

test('image layer order survives V5 undo, redo, and actual export preview', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'Image restoration and stacking integration.');
  await uploadPlain(page);
  const images = await page.evaluate(() => ['#ff0000', '#0000ff'].map(color => {
    const canvas = document.createElement('canvas');
    canvas.width = 60;
    canvas.height = 40;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, 60, 40);
    return canvas.toDataURL('image/png').split(',')[1];
  }));
  await page.getByRole('button', { name: 'Insert', exact: true }).click();
  await page.getByTestId('pdf-tool-image').click();
  for (const [index, image] of images.entries()) {
    const chooser = page.waitForEvent('filechooser');
    await page.getByRole('button', { name: 'Upload Image', exact: true }).click();
    await (await chooser).setFiles({ name: `image-${index}.png`, mimeType: 'image/png', buffer: Buffer.from(image, 'base64') });
    await expect(page.getByTestId('pdf-page-layers').getByRole('listitem')).toHaveCount(index + 1);
    const fields = page.locator('.pe-geometry-grid input');
    await expect(fields).toHaveCount(4);
    for (const [field, value] of [140, 200, 140, 100].entries()) {
      await fields.nth(field).fill(String(value));
      await fields.nth(field).press('Enter');
    }
  }
  const rows = page.getByTestId('pdf-page-layers').getByRole('listitem');
  await expect(rows).toHaveCount(2);
  const order = await rows.locator('.pe-layer-name').allTextContents();
  await expect.poll(() => pageColor(page, '.pe-page-frame')).toBe('blue');
  await rows.first().getByRole('button', { name: / backward$/ }).click();
  await expect(rows.locator('.pe-layer-name')).toHaveText([...order].reverse());
  await expect.poll(() => pageColor(page, '.pe-page-frame')).toBe('red');
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect.poll(() => pageColor(page, '.pe-page-frame')).toBe('blue');
  await page.getByRole('button', { name: 'Redo', exact: true }).click();
  await expect.poll(() => pageColor(page, '.pe-page-frame')).toBe('red');
  await page.getByRole('button', { name: 'Preview final PDF', exact: true }).click();
  await expect(page.locator('.pe-preview-status')).toHaveCount(1, { timeout: 10_000 });
  await expect(page.locator('.pe-preview-status')).toHaveCount(0, { timeout: 60_000 });
  await expect(page.locator('.pe-preview-blocked')).toHaveCount(0);
  expect(await pageColor(page, '.pe-preview-canvas')).toBe('red');
  await downloadedText(page, testInfo.outputPath('ordered-images.pdf'));
});

test('an inserted object drags to the bottom-right at Fit page', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'Pointer-driven canvas test.');

  // A short window forces a zoom well below 1, which is where the coordinate
  // mistake became a drag that stopped halfway across the sheet.
  await page.setViewportSize({ width: 1280, height: 720 });
  await uploadPlain(page);
  await page.getByTestId('pdf-fit-page').click();

  const frame = page.locator('.pe-page-frame');
  await expect.poll(async () => (await frame.boundingBox())?.height ?? 0, { timeout: 15_000 })
    .toBeLessThan(700);
  const frameBox = await frame.boundingBox();
  expect(frameBox).not.toBeNull();

  await page.getByRole('button', { name: 'Insert', exact: true }).click();
  await page.getByTestId('pdf-tool-emoji').click();
  await page.locator('.pe-emoji-btn').first().click();
  await page.waitForTimeout(600);

  const before = await emojiBounds(page, '.pe-page-frame');
  expect(before, 'the inserted emoji should be visible').not.toBeNull();
  expect(before!.width).toBeGreaterThan(2);
  // Inserted at (100,100) points, so it starts in the top-left of the page.
  expect(before!.x / before!.imageWidth).toBeLessThan(0.4);
  expect(before!.y / before!.imageHeight).toBeLessThan(0.4);

  const scaleX = frameBox!.width / before!.imageWidth;
  const scaleY = frameBox!.height / before!.imageHeight;
  const startX = frameBox!.x + (before!.x + before!.width / 2) * scaleX;
  const startY = frameBox!.y + (before!.y + before!.height / 2) * scaleY;
  const targetX = frameBox!.x + frameBox!.width * 0.82;
  const targetY = frameBox!.y + frameBox!.height * 0.82;

  await page.mouse.move(startX, startY);
  await page.mouse.down();
  for (let step = 1; step <= 12; step += 1) {
    await page.mouse.move(
      startX + ((targetX - startX) * step) / 12,
      startY + ((targetY - startY) * step) / 12,
    );
    await page.waitForTimeout(15);
  }
  await page.mouse.up();
  await page.waitForTimeout(400);

  const after = await emojiBounds(page, '.pe-page-frame');
  expect(after, 'the emoji should still be visible after the drag').not.toBeNull();
  const centerX = (after!.x + after!.width / 2) / after!.imageWidth;
  const centerY = (after!.y + after!.height / 2) / after!.imageHeight;
  expect(centerX, 'the object stopped before the right side of the page').toBeGreaterThan(0.65);
  expect(centerY, 'the object stopped before the bottom of the page').toBeGreaterThan(0.65);
});
