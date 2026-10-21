import { expect, test, type Page } from '@playwright/test';
import path from 'node:path';

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
