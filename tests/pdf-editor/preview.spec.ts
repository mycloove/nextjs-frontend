import { expect, test, type Page } from '@playwright/test';
import path from 'node:path';
import { allowServerProcessing } from './processing-consent';

/**
 * The export preview must rebuild on a committed edit.
 *
 * This is the user-facing half of P = E: the preview is rendered from the
 * export's own bytes, and it must be invalidated by `editVersion`. A preview
 * that keeps the previous page after a text edit is indistinguishable from
 * "the edit did nothing", so this test measures the rendered canvas itself
 * rather than trusting a state flag.
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
    return Boolean(canvas && canvas.width > 400 && canvas.height > 400);
  }, null, { timeout: 30_000 });
}

async function previewSignature(page: Page) {
  return page.locator('.pe-preview-canvas').evaluate((canvas) => {
    const element = canvas as HTMLCanvasElement;
    const ctx = element.getContext('2d');
    if (!ctx) return null;
    const data = ctx.getImageData(0, 0, element.width, element.height).data;
    let hash = 2166136261;
    for (let index = 0; index < data.length; index += 16) {
      hash ^= data[index];
      hash = Math.imul(hash, 16777619);
    }
    return { width: element.width, height: element.height, hash: hash >>> 0 };
  });
}

test('a text edit rebuilds the rendered preview', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'The preview is viewport-independent.');

  await uploadPlain(page);

  await page.getByRole('button', { name: /Preview final PDF/i }).click();
  await expect(page.locator('.pe-preview-status')).toHaveCount(1, { timeout: 10_000 });
  await expect(page.locator('.pe-preview-status')).toHaveCount(0, { timeout: 60_000 });
  const before = await previewSignature(page);
  expect(before).not.toBeNull();
  expect(before!.width).toBeGreaterThan(300);
  await allowServerProcessing(page);

  await page.getByTestId('pdf-tool-editText').click();
  const textarea = page.getByTestId('pdf-original-text-1-0');
  await expect(textarea).toBeVisible({ timeout: 20_000 });
  await textarea.fill('A DIFFERENT HEADING FOR THE PREVIEW');

  await expect(page.locator('.pe-preview-status')).toHaveCount(1, { timeout: 10_000 });
  await expect(page.locator('.pe-preview-status')).toHaveCount(0, { timeout: 60_000 });
  await page.waitForTimeout(300);

  const after = await previewSignature(page);
  expect(after).not.toBeNull();
  expect(after!.width).toBe(before!.width);
  expect(after!.height).toBe(before!.height);
  expect(after!.hash, 'the preview still renders the pre-edit page').not.toBe(before!.hash);
  await expect(page.locator('.pe-preview-blocked')).toHaveCount(0);
});

/**
 * The panel's zoom changes the display size of the same bytes.
 *
 * The panel's whole job is that a user can read the export, and a 42%-wide
 * column is not a reading size. The stops are pinned against each other rather
 * than against absolute pixels: at 100% the page is laid out at its own width,
 * at 200% at twice that, and Fit is the panel's inner width — which is what
 * makes the ladder a zoom rather than three unrelated layouts. The head carries
 * no percentage readout, so the active stop is read from the buttons' own
 * `aria-pressed` — the same state a screen reader gets.
 */
test('the preview zoom controls re-scale the page and return to fit', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'The preview is viewport-independent.');

  await uploadPlain(page);

  await page.getByRole('button', { name: /Preview final PDF/i }).click();
  await expect(page.locator('.pe-preview-status')).toHaveCount(1, { timeout: 10_000 });
  await expect(page.locator('.pe-preview-status')).toHaveCount(0, { timeout: 60_000 });

  const fitStop = page.getByTestId('pdf-preview-zoom-fit');
  const actualSizeStop = page.getByTestId('pdf-preview-zoom-100');
  const canvasBox = async () => {
    const box = await page.locator('.pe-preview-canvas').boundingBox();
    expect(box).not.toBeNull();
    return box!;
  };

  await expect(fitStop).toHaveAttribute('aria-pressed', 'true');
  const atFit = await canvasBox();
  const fitWidth = await page.locator('.pe-preview-wrap').evaluate((wrap) => wrap.clientWidth);
  expect(Math.abs(atFit.width - fitWidth), 'Fit does not fill the panel width').toBeLessThanOrEqual(2);

  // The page area is the panel's scrolling viewport, so it has to end inside the
  // stage — which clips — or the scrollbar's own end (and the page bottom under
  // it) would be unreachable.
  const wrapBox = await page.locator('.pe-preview-wrap').boundingBox();
  const stageBox = await page.locator('.pe-preview-stage').boundingBox();
  expect(wrapBox).not.toBeNull();
  expect(stageBox).not.toBeNull();
  expect(wrapBox!.y + wrapBox!.height).toBeLessThanOrEqual(stageBox!.y + stageBox!.height + 1);

  await actualSizeStop.click();
  await expect(actualSizeStop).toHaveAttribute('aria-pressed', 'true');
  await expect(fitStop).toHaveAttribute('aria-pressed', 'false');
  const atActualSize = await canvasBox();
  // This fixture's page lays out wider than the panel column, so Fit is a
  // shrink and 100% has to read larger than Fit — the point of the control.
  expect(atActualSize.width).toBeGreaterThan(atFit.width);

  await page.getByTestId('pdf-preview-zoom-200').click();
  await expect(page.getByTestId('pdf-preview-zoom-200')).toHaveAttribute('aria-pressed', 'true');
  const atDoubleSize = await canvasBox();
  expect(Math.abs(atDoubleSize.width - atActualSize.width * 2)).toBeLessThanOrEqual(2);
  expect(atDoubleSize.width).toBeGreaterThan(atFit.width);

  await fitStop.click();
  await expect(fitStop).toHaveAttribute('aria-pressed', 'true');
  const backToFit = await canvasBox();
  expect(Math.abs(backToFit.width - fitWidth)).toBeLessThanOrEqual(2);

  await expect(page.locator('.pe-preview-blocked')).toHaveCount(0);
});
