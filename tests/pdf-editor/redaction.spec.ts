import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { expect, test, type Page } from '@playwright/test';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { allowServerProcessing } from './processing-consent';

const fixtures = path.join(__dirname, 'fixtures');

async function uploadFixture(page: Page, name: string) {
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
  await input.setInputFiles(path.join(fixtures, name));
  await expect(page.getByTestId('pdf-page-jump')).toBeVisible({ timeout: 30_000 });
  await expect(page.locator('.pe-loading-overlay')).toHaveCount(0, { timeout: 30_000 });
  // Let the debounced Fit page pass settle before measuring a target. The text
  // layer can render one frame before the zoom changes, and a box measured in
  // the old zoom is not the box the click will use.
  await page.waitForTimeout(700);
  await allowServerProcessing(page);
}

async function uploadPlain(page: Page) {
  await uploadFixture(page, 'phase-1e-plain.pdf');
  await expect(page.getByText('1 / 1', { exact: true })).toBeVisible({ timeout: 30_000 });
}

test('redactions are reviewable and export refuses when removal cannot be proven', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'Redaction authoring is viewport-independent.');

  await uploadPlain(page);

  // The removal engine is unavailable. A redaction must refuse, never flatten
  // the page into a local cover-up that leaves the glyphs extractable.
  await page.route('**/api/pdf-editor/apply-text-edits', route => route.fulfill({
    status: 503,
    contentType: 'application/json',
    body: JSON.stringify({ error: 'Redaction engine unavailable' }),
  }));

  await page.getByTestId('pdf-tool-redact').click();
  const target = page.locator('[data-testid^="pdf-redaction-target-"]').first();
  await expect(target).toBeVisible({ timeout: 20_000 });
  /* The hit area must sit on the page, not in normal flow underneath it.
     A stylesheet brace that accidentally nested these rules inside a
     `prefers-reduced-motion` media query produced exactly that: unstyled
     buttons and their "REDACT" labels stacked below the document. */
  await expect(target).toHaveCSS('position', 'absolute');
  await expect(target.locator('.pe-redaction-target-label')).toHaveCSS('opacity', '0');
  const targetBox = await target.boundingBox();
  const pageBox = await page.locator('[data-pdf-page-shell="1"]').boundingBox();
  expect(targetBox).not.toBeNull();
  expect(pageBox).not.toBeNull();
  expect(targetBox!.y).toBeGreaterThanOrEqual(pageBox!.y);
  expect(targetBox!.y + targetBox!.height).toBeLessThanOrEqual(pageBox!.y + pageBox!.height);
  await target.click();

  const mark = page.locator('[data-testid^="pdf-redaction-mark-"]').first();
  await expect(mark).toBeVisible();
  await expect(mark).toHaveAttribute('aria-pressed', 'true');
  /* The bar is a visual promise: it must cover the descender space below the
     ink box, or a `g`/`y`/`p` tail stays readable under a "redacted" run. */
  const markBox = await mark.boundingBox();
  expect(markBox).not.toBeNull();
  /* The painted bar is the run's full font box plus a sub-pixel antialiasing
     bleed. It must cover the same hover target, not be a generic taller slab
     that could reach into the neighbouring line. */
  expect(markBox!.height).toBeGreaterThanOrEqual(targetBox!.height - 1);
  expect(markBox!.height).toBeLessThanOrEqual(targetBox!.height + 4);
  expect(markBox!.x).toBeLessThanOrEqual(targetBox!.x);
  expect(markBox!.y).toBeLessThanOrEqual(targetBox!.y);
  expect(markBox!.x + markBox!.width).toBeGreaterThanOrEqual(targetBox!.x + targetBox!.width);
  expect(markBox!.y + markBox!.height).toBeGreaterThanOrEqual(
    targetBox!.y + targetBox!.height,
  );
  await expect(page.getByTestId('pdf-redaction-review')).toContainText(/Page 1/);
  await expect(page.getByTestId('pdf-redaction-review')).toContainText(/permanently removed/);

  let downloaded = false;
  page.on('download', () => { downloaded = true; });
  await page.getByTestId('pdf-export-button').click();

  await expect(page.getByTestId('pdf-editor-toast')).toContainText(/Redaction was not applied/, {
    timeout: 30_000,
  });
  expect(downloaded).toBe(false);

  // Unmarking restores the source run as a markable target and clears review.
  await mark.click();
  await expect(mark).toHaveCount(0);
  await expect(page.getByTestId('pdf-redaction-review')).toContainText(/No text is marked/);
});

test('the export preview drops the redacted run after a mark', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'Redaction authoring is viewport-independent.');

  await uploadPlain(page);

  // Open the preview first, so this proves an already-rendered preview is
  // invalidated by a later mark instead of continuing to show the old page.
  await page.getByRole('button', { name: /Preview final PDF/i }).click();
  await expect(page.locator('.pe-preview-status')).toHaveCount(1, { timeout: 10_000 });
  await expect(page.locator('.pe-preview-status')).toHaveCount(0, { timeout: 60_000 });

  await page.getByTestId('pdf-tool-redact').click();
  const target = page.locator('[data-testid^="pdf-redaction-target-"]').first();
  await expect(target).toBeVisible({ timeout: 20_000 });
  await target.click();
  await expect(page.locator('[data-testid^="pdf-redaction-mark-"]').first()).toBeVisible();

  // The stale page must be cleared while the new bytes are built, then replaced
  // by the redacted page. If the old build survived, the marked region would
  // still contain glyphs.
  await expect(page.locator('.pe-preview-status')).toHaveCount(1, { timeout: 10_000 });
  await expect(page.locator('.pe-preview-status')).toHaveCount(0, { timeout: 60_000 });

  const markBox = await page.locator('[data-testid^="pdf-redaction-mark-"]').first().boundingBox();
  const frameBox = await page.locator('[data-pdf-page-shell="1"] .pe-page-frame').boundingBox();
  expect(markBox).not.toBeNull();
  expect(frameBox).not.toBeNull();

  const pixels = await page.evaluate(({ mark, frame }) => {
    const canvas = document.querySelector('.pe-preview-canvas') as HTMLCanvasElement | null;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return null;
    const x = Math.max(0, Math.floor(((mark.x - frame.x) / frame.width) * canvas.width));
    const y = Math.max(0, Math.floor(((mark.y - frame.y) / frame.height) * canvas.height));
    const w = Math.max(1, Math.floor((mark.width / frame.width) * canvas.width));
    const h = Math.max(1, Math.floor((mark.height / frame.height) * canvas.height));
    const data = ctx.getImageData(x, y, w, h).data;
    let dark = 0;
    for (let index = 0; index < data.length; index += 4) {
      const luminance = 0.2126 * data[index] + 0.7152 * data[index + 1] + 0.0722 * data[index + 2];
      if (luminance < 128) dark += 1;
    }
    return { dark, total: data.length / 4 };
  }, { mark: markBox!, frame: frameBox! });

  expect(pixels).not.toBeNull();
  expect(pixels!.total).toBeGreaterThan(0);
  expect(pixels!.dark, 'the preview still draws the redacted glyphs').toBe(0);
});

test('a scanned OCR run loses its visible image pixels through the descenders', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'Redaction authoring is viewport-independent.');

  // The words live in an image with an invisible text layer above them. An
  // ink-height box stops at the baseline, so image redaction blanked the top of
  // the letters and left every `g`/`y`/`p` tail visible in the preview. The
  // engine rectangle is now the run's full font box, and the painted bar is the
  // same rectangle, so the area the user sees covered is the area removed.
  await uploadFixture(page, 'phase-scanned-ocr.pdf');
  await page.getByTestId('pdf-tool-redact').click();
  const target = page.locator('[data-testid^="pdf-redaction-target-"]').first();
  await expect(target).toBeVisible({ timeout: 20_000 });
  const targetBox = await target.boundingBox();
  expect(targetBox).not.toBeNull();
  await target.click();
  const mark = page.locator('[data-testid^="pdf-redaction-mark-"]').first();
  await expect(mark).toBeVisible();

  // Before the preview changes the canvas width (and therefore the fit zoom),
  // the cover and the hover target must be the same font box.
  const initialMarkBox = await mark.boundingBox();
  expect(initialMarkBox).not.toBeNull();
  expect(initialMarkBox!.height).toBeGreaterThanOrEqual(targetBox!.height - 1);

  await page.getByRole('button', { name: /Preview final PDF/i }).click();
  await expect(page.locator('.pe-preview-status')).toHaveCount(1, { timeout: 10_000 });
  await expect(page.locator('.pe-preview-status')).toHaveCount(0, { timeout: 60_000 });

  const markBox = await mark.boundingBox();
  const frameBox = await page.locator('[data-pdf-page-shell="1"] .pe-page-frame').boundingBox();
  expect(markBox).not.toBeNull();
  expect(frameBox).not.toBeNull();

  const pixels = await page.evaluate(({ mark: box, frame }) => {
    const canvas = document.querySelector('.pe-preview-canvas') as HTMLCanvasElement | null;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return null;
    // The scanned run can extend to the page edge; clamp the sample so
    // out-of-bounds pixels are not counted as black.
    const x = Math.max(0, Math.min(canvas.width - 1, Math.floor(((box.x - frame.x) / frame.width) * canvas.width)));
    const y = Math.max(0, Math.min(canvas.height - 1, Math.floor(((box.y - frame.y) / frame.height) * canvas.height)));
    const w = Math.max(1, Math.min(canvas.width - x, Math.floor((box.width / frame.width) * canvas.width)));
    const h = Math.max(1, Math.min(canvas.height - y, Math.floor((box.height / frame.height) * canvas.height)));
    const data = ctx.getImageData(x, y, w, h).data;
    let dark = 0;
    for (let index = 0; index < data.length; index += 4) {
      const luminance = 0.2126 * data[index] + 0.7152 * data[index + 1] + 0.0722 * data[index + 2];
      if (luminance < 128) dark += 1;
    }
    return { dark, total: data.length / 4 };
  }, { mark: markBox!, frame: frameBox! });

  expect(pixels).not.toBeNull();
  expect(pixels!.total).toBeGreaterThan(0);
  expect(pixels!.dark, 'the scanned image still shows the descender tails').toBe(0);
});

test('a scanned OCR run whose text layer rides high loses the ink below its box', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'Redaction authoring is viewport-independent.');

  /* An OCR layer's baseline is an estimate and routinely rides a few points
     above the ink it describes, so the font box PDF.js reports stops short of
     the scanned descenders. Image redaction is clipped to the rectangle and the
     rectangle is what the bar covers, so an ink-tight box left every `g`/`y`/`p`
     tail of the image readable under a run the review called removed. The engine
     now starts from the matched run's own box, the document's own authority on
     how far it reaches. */
  await uploadFixture(page, 'phase-scanned-ocr-offset.pdf');
  await page.getByTestId('pdf-tool-redact').click();
  const target = page.locator('[data-testid^="pdf-redaction-target-"]').first();
  await expect(target).toBeVisible({ timeout: 20_000 });
  await target.click();
  const mark = page.locator('[data-testid^="pdf-redaction-mark-"]').first();
  await expect(mark).toBeVisible();

  await page.getByRole('button', { name: /Preview final PDF/i }).click();
  await expect(page.locator('.pe-preview-status')).toHaveCount(1, { timeout: 10_000 });
  await expect(page.locator('.pe-preview-status')).toHaveCount(0, { timeout: 60_000 });

  const markBox = await mark.boundingBox();
  const frameBox = await page.locator('[data-pdf-page-shell="1"] .pe-page-frame').boundingBox();
  expect(markBox).not.toBeNull();
  expect(frameBox).not.toBeNull();

  const pixels = await page.evaluate(({ mark: box, frame }) => {
    const canvas = document.querySelector('.pe-preview-canvas') as HTMLCanvasElement | null;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return null;
    // Start where the mark box ends and run a comfortable way down the page.
    // Nothing else is drawn on this fixture, so any dark pixel there is a
    // descender that survived the redaction.
    const top = Math.max(
      0,
      Math.min(canvas.height - 1, Math.floor(((box.y + box.height - frame.y) / frame.height) * canvas.height)),
    );
    const bottom = Math.min(
      canvas.height,
      Math.ceil(((box.y + box.height - frame.y + 40) / frame.height) * canvas.height),
    );
    const height = Math.max(1, bottom - top);
    const data = ctx.getImageData(0, top, canvas.width, height).data;
    let dark = 0;
    for (let index = 0; index < data.length; index += 4) {
      const luminance = 0.2126 * data[index] + 0.7152 * data[index + 1] + 0.0722 * data[index + 2];
      if (luminance < 128) dark += 1;
    }
    return { dark, total: data.length / 4 };
  }, { mark: markBox!, frame: frameBox! });

  expect(pixels).not.toBeNull();
  expect(pixels!.total).toBeGreaterThan(0);
  expect(pixels!.dark, 'the scanned image still shows descenders below the mark').toBe(0);
});

test('a confirmed redaction removes the source glyphs from the downloaded file', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'Redaction authoring is viewport-independent.');

  await uploadPlain(page);
  await page.getByTestId('pdf-tool-redact').click();
  const target = page.locator('[data-testid^="pdf-redaction-target-"]').first();
  await expect(target).toBeVisible({ timeout: 20_000 });
  const label = await target.getAttribute('aria-label');
  const sourceText = /Mark "(.+)" for redaction/.exec(label ?? '')?.[1];
  expect(sourceText, 'the first detected run should name its source text').toBeTruthy();
  await target.click();
  await expect(page.locator('[data-testid^="pdf-redaction-mark-"]').first()).toBeVisible();

  const downloadPromise = page.waitForEvent('download', { timeout: 60_000 });
  await page.getByTestId('pdf-export-button').click();
  const confirm = page.getByTestId('pdf-export-confirm');
  await expect(confirm).toHaveText(/Export redacted PDF/i, { timeout: 30_000 });
  await confirm.click();

  await expect(page.getByTestId('pdf-editor-toast')).toContainText(/exported and verified successfully/, {
    timeout: 60_000,
  });
  const download = await downloadPromise;
  const outputPath = path.join(testInfo.outputDir, 'redacted.pdf');
  await download.saveAs(outputPath);

  const bytes = new Uint8Array(await readFile(outputPath));
  const document = await pdfjs.getDocument({ data: bytes.slice() }).promise;
  try {
    let text = '';
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      const rendered = await document.getPage(pageNumber);
      const content = await rendered.getTextContent();
      text += ` ${content.items.map(item => ('str' in item ? item.str : '')).join(' ')}`;
    }
    const normalized = text.replace(/\s+/g, ' ').trim().toLowerCase();
    const needle = (sourceText ?? '').replace(/\s+/g, ' ').trim().toLowerCase();
    expect(needle.length).toBeGreaterThan(0);
    expect(normalized).not.toContain(needle);
  } finally {
    await document.destroy();
  }
});

test('a redaction on a rotated page removes the rotated source glyphs', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'Redaction authoring is viewport-independent.');

  await uploadFixture(page, 'phase-1e-complex.pdf');
  await page.getByTestId('pdf-page-next').click();
  await expect(page.getByText('2 / 2', { exact: true })).toBeVisible({ timeout: 30_000 });

  await page.getByTestId('pdf-tool-redact').click();
  const frame = page.locator('[data-pdf-page-shell="2"] .pe-page-frame');
  const target = page.locator(
    '[data-pdf-page-shell="2"] [data-testid^="pdf-redaction-target-"]',
  ).first();
  await expect(target).toBeVisible({ timeout: 20_000 });

  /* The run on this page is rotated 90 degrees. Its box must follow the
     rotated basis and stay on the page; the old horizontal-only geometry put
     it entirely outside the page, so the click landed on the workspace. */
  const targetBox = await target.boundingBox();
  const frameBox = await frame.boundingBox();
  expect(targetBox).not.toBeNull();
  expect(frameBox).not.toBeNull();
  expect(targetBox!.x).toBeGreaterThanOrEqual(frameBox!.x);
  expect(targetBox!.y).toBeGreaterThanOrEqual(frameBox!.y);
  expect(targetBox!.x + targetBox!.width).toBeLessThanOrEqual(frameBox!.x + frameBox!.width + 1);
  expect(targetBox!.y + targetBox!.height).toBeLessThanOrEqual(frameBox!.y + frameBox!.height + 1);

  const label = await target.getAttribute('aria-label');
  const sourceText = /Mark "(.+)" for redaction/.exec(label ?? '')?.[1];
  expect(sourceText, 'the rotated run should name its source text').toBeTruthy();

  await target.click();
  await expect(
    page.locator('[data-pdf-page-shell="2"] [data-testid^="pdf-redaction-mark-"]').first(),
  ).toBeVisible();

  const downloadPromise = page.waitForEvent('download', { timeout: 60_000 });
  await page.getByTestId('pdf-export-button').click();
  const confirm = page.getByTestId('pdf-export-confirm');
  await expect(confirm).toHaveText(/Export redacted PDF/i, { timeout: 30_000 });
  await confirm.click();

  await expect(page.getByTestId('pdf-editor-toast')).toContainText(/exported and verified successfully/, {
    timeout: 60_000,
  });
  const download = await downloadPromise;
  const outputPath = path.join(testInfo.outputDir, 'redacted-rotated.pdf');
  await download.saveAs(outputPath);

  const bytes = new Uint8Array(await readFile(outputPath));
  const document = await pdfjs.getDocument({ data: bytes.slice() }).promise;
  try {
    let text = '';
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      const rendered = await document.getPage(pageNumber);
      const content = await rendered.getTextContent();
      text += ` ${content.items.map(item => ('str' in item ? item.str : '')).join(' ')}`;
    }
    const normalized = text.replace(/\s+/g, ' ').trim().toLowerCase();
    const needle = (sourceText ?? '').replace(/\s+/g, ' ').trim().toLowerCase();
    expect(needle.length).toBeGreaterThan(0);
    expect(normalized).not.toContain(needle);
  } finally {
    await document.destroy();
  }
});
