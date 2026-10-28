import { expect, test, type Page } from '@playwright/test';
import path from 'node:path';

/**
 * What the right rail shows for each left-rail tool.
 *
 * The reported defect: after editing text and returning to Select, the rail
 * kept the Text panel for a block that was no longer drawn, so Page Size
 * became unreachable from a state nothing on screen explained. These tests pin
 * the rule that replaced it — a held tool's panel is never shadowed, a
 * selection that is not on screen is dropped rather than hidden, and with
 * nothing selected the rail is the document again.
 */
const fixtures = path.join(__dirname, 'fixtures');

async function upload(page: Page, name = 'phase-1e-plain.pdf') {
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
  await page.waitForFunction(() => {
    const canvas = document.querySelector('.pe-page-frame canvas') as HTMLCanvasElement | null;
    return Boolean(canvas && canvas.width > 400 && canvas.height > 400);
  }, null, { timeout: 30_000 });
}

/** The rail's own name for what it is showing. */
const railLabel = (page: Page) => page.locator('.pe-rp-context-label');

/** Choose a text block the way a user does: click into it. */
async function selectFirstTextBlock(page: Page) {
  await page.getByTestId('pdf-tool-editText').click();
  const textarea = page.locator('textarea[data-pdf-text="true"]').first();
  await expect(textarea).toBeVisible({ timeout: 20_000 });
  await textarea.click();
}

test('leaving Edit text returns the rail to the document, so Page Size stays reachable', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'The inspector contract is viewport-independent.');

  await upload(page);
  await expect(page.getByTestId('pdf-page-size')).toHaveValue('original');
  await selectFirstTextBlock(page);
  await expect(railLabel(page)).toHaveText('Original text');
  await expect(page.getByTestId('pdf-page-size')).toHaveCount(0);
  await expect(page.getByTestId('pdf-status-bar')).toContainText('Text selected');

  // The reported gesture: back to the top tool. The block is no longer drawn
  // (the overlays exist only in Edit text), so it must not be claimed as
  // selected — by the rail or by the status bar.
  await page.getByTestId('pdf-tool-select').click();
  await expect(railLabel(page)).toHaveText('Document');
  await expect(page.getByTestId('pdf-page-size')).toBeVisible();
  await expect(page.getByTestId('pdf-page-size')).toHaveValue('original');
  await expect(page.getByTestId('pdf-status-bar')).not.toContainText('Text selected');
});

test('a held tool with its own panel is never shadowed by an earlier text selection', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'The inspector contract is viewport-independent.');

  await upload(page);
  await selectFirstTextBlock(page);
  await expect(railLabel(page)).toHaveText('Original text');

  // Sign opened its own panel before this fix only when no block had ever
  // been selected — the stale key used to swallow it.
  await page.getByTestId('pdf-tool-signature').click();
  await expect(railLabel(page)).toHaveText('Signature');
  await expect(page.locator('.pe-sign-btn')).toHaveCount(2);
  await expect(page.getByTestId('pdf-page-size')).toHaveCount(0);

  await page.getByTestId('pdf-tool-select').click();
  await expect(railLabel(page)).toHaveText('Document');
  await expect(page.getByTestId('pdf-page-size')).toBeVisible();
});

test('an object selection is released by clicking the page, bringing the document back', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'The inspector contract is viewport-independent.');

  await upload(page);
  await page.getByRole('button', { name: 'Insert', exact: true }).click();
  await page.getByTestId('pdf-tool-emoji').click();
  await expect(railLabel(page)).toHaveText('Emoji');

  await page.locator('.pe-emoji-btn').first().click();
  // Inserting returns to Select and the new object stays selected. An emoji is
  // a text object in this engine, so its panel is the text styles plus the
  // position & size section — and the document panel is gone while it is held.
  await expect(railLabel(page)).toHaveText('Added text');
  await expect(page.getByTestId('pdf-object-geometry')).toBeVisible();
  await expect(page.getByTestId('pdf-page-size')).toHaveCount(0);

  const frame = page.locator('.pe-page-frame').first();
  const box = await frame.boundingBox();
  expect(box).not.toBeNull();
  await page.mouse.click(box!.x + 12, box!.y + 12);

  await expect(railLabel(page)).toHaveText('Document');
  await expect(page.getByTestId('pdf-object-geometry')).toHaveCount(0);
  await expect(page.getByTestId('pdf-page-size')).toBeVisible();
});

test('a text block on another page is not claimed as selected', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'The inspector contract is viewport-independent.');

  await upload(page, 'phase-1e-complex.pdf');
  await selectFirstTextBlock(page);
  await expect(railLabel(page)).toHaveText('Original text');

  // Changing the page takes the block off screen. The rail must fall back to
  // the page the user is actually on rather than keep styling the block the
  // overlays no longer draw — and it must not come back selected later.
  await page.getByTestId('pdf-page-next').click();
  await expect(railLabel(page)).toHaveText('Document');
  await expect(page.getByTestId('pdf-page-size')).toBeVisible();

  await page.getByTestId('pdf-page-prev').click();
  await expect(railLabel(page)).toHaveText('Document');
});
