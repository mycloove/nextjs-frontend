import { expect, test } from '@playwright/test';

test('intake screen keeps one clear action and refuses non-PDFs in place', async ({ page }) => {
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
  await expect(input).toBeHidden();
  await expect(page.getByText('No file chosen')).toHaveCount(0);
  await expect(page.getByRole('heading', { level: 1, name: 'Open a PDF' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Choose PDF' })).toBeVisible();

  await input.setInputFiles({
    name: 'notes.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from('not a pdf'),
  });

  const alert = page.locator('.pe-drop-error');
  await expect(alert).toBeVisible();
  await expect(alert).toContainText('Choose a PDF file');
  await expect(page.getByRole('button', { name: 'Choose another PDF' })).toBeVisible();
});
