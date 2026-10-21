import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { expect, test, type Page } from '@playwright/test';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';

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
  await expect(page.getByText('1 / 1', { exact: true })).toBeVisible({ timeout: 30_000 });
  await expect(page.locator('.pe-loading-overlay')).toHaveCount(0, { timeout: 30_000 });
}

test('canvas text exports as embedded vector text, not a page bitmap', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'The vector export path is viewport-independent.');

  await uploadPlain(page);

  // Picking the text tool creates a selected textbox and enters editing. The
  // placeholder is selected, so typing replaces it rather than appending.
  await page.getByTestId('pdf-tool-text').click();
  await page.keyboard.insertText('Vector browser note');
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('pdf-save-status')).toContainText('Saved locally', { timeout: 15_000 });

  const downloadPromise = page.waitForEvent('download');
  await page.getByTestId('pdf-export-button').click();
  const confirm = page.getByTestId('pdf-export-confirm');
  if (await confirm.isVisible().catch(() => false)) {
    await confirm.click();
  }
  await expect(page.getByTestId('pdf-editor-toast')).toContainText(/verified/i, { timeout: 30_000 });
  const download = await downloadPromise;
  const outputPath = path.join(testInfo.outputDir, 'vector-export.pdf');
  await download.saveAs(outputPath);

  const bytes = new Uint8Array(await readFile(outputPath));
  const document = await pdfjs.getDocument({ data: bytes.slice() }).promise;
  try {
    const pdfPage = await document.getPage(1);
    const content = await pdfPage.getTextContent();
    const text = content.items.map(item => ('str' in item ? item.str : '')).join(' ');
    expect(text).toContain('Vector browser note');
  } finally {
    await document.destroy();
  }
});
