import { readFile } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';
import { PDFDocument } from 'pdf-lib';
import type { OriginalTextEdit } from '../../app/pdf-editor/pdfEdit-hooks/usePdfEditor';

async function openDocument(page: Page) {
  const pdf = await PDFDocument.create();
  pdf.setCreationDate(new Date('2026-10-28T00:00:00Z'));
  pdf.setModificationDate(new Date('2026-10-28T00:00:00Z'));
  for (let number = 1; number <= 2; number++) pdf.addPage([612, 792]).drawText(`SOURCE PAGE ${number}`, { x: 60, y: 700, size: 16 });
  const bytes = Buffer.from(await pdf.save());
  await page.goto('/pdf-editor');
  const input = page.getByTestId('pdf-upload-input');
  await expect(input).toHaveAttribute('data-editor-ready', 'true', { timeout: 30_000 });
  await input.setInputFiles({ name: 'rollout.pdf', mimeType: 'application/pdf', buffer: bytes });
  await expect(page.getByTestId('pdf-tool-select')).toBeEnabled({ timeout: 30_000 });
  return bytes;
}

async function openPanel(page: Page, panel: 'navigation' | 'inspector') {
  if (await page.getByTestId(`pdf-${panel}-panel`).getAttribute('aria-hidden') === 'true') await page.getByTestId(`pdf-${panel}-toggle`).click();
  await expect(page.getByTestId(`pdf-${panel}-panel`)).toBeVisible();
}

test('production flags disable new authoring but preserve an unchanged exact-byte download', async ({ page }, testInfo) => {
  const bytes = await openDocument(page);
  // Also prove the real production toolbar is not obscured by another layer.
  await page.getByTestId('pdf-tool-select').click();
  await expect(page.getByTestId('pdf-tool-editText')).toBeDisabled();
  await expect(page.getByTestId('pdf-tool-redact')).toHaveCount(0);
  await page.getByTestId('pdf-commands-open').click();
  await page.getByTestId('pdf-palette-input').fill('Edit original text');
  await expect(page.getByRole('option', { name: /Edit original text/ })).toBeDisabled();
  await page.keyboard.press('Escape');
  await openPanel(page, 'navigation');
  await page.getByRole('tab', { name: 'Arrange', exact: true }).click();
  await expect(page.getByTestId('pdf-organizer-duplicate-1')).toBeDisabled();
  const download = page.waitForEvent('download');
  await page.getByTestId('pdf-export-button').click();
  const output = testInfo.outputPath('unchanged-rollout.pdf');
  await (await download).saveAs(output);
  expect(Buffer.from(await readFile(output)).equals(bytes)).toBe(true);
});

for (const pending of ['page-plan', 'text-edit'] as const) {
  test(`rollback retains a restored ${pending} and refuses delivery before upload`, async ({ page }) => {
    await openDocument(page);
    await openPanel(page, 'inspector');
    await page.getByRole('combobox', { name: 'Page size' }).selectOption('a4');
    await page.getByRole('combobox', { name: 'Page size' }).selectOption('original');
    await expect(page.getByTestId('pdf-save-status')).toContainText('Saved locally', { timeout: 15_000 });
    await page.evaluate(async kind => {
      const database = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open('smilepdf:editor:v1', 1);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      try {
        const transaction = database.transaction('drafts', 'readwrite');
        const done = new Promise<void>((resolve, reject) => { transaction.oncomplete = () => resolve(); transaction.onerror = () => reject(transaction.error); });
        const store = transaction.objectStore('drafts');
        const record = await new Promise<{ key: string; draft: { documentId: string; pagePlan: { entries: { id: string; sourcePage: number; rotation: number }[] }; textEdits: Record<string, OriginalTextEdit> } }>((resolve, reject) => {
          const request = store.get('latest'); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
        });
        if (kind === 'page-plan') record.draft.pagePlan.entries.splice(1, 0, { ...record.draft.pagePlan.entries[0], id: 'pre-rollback-duplicate' });
        else record.draft.textEdits['1:0'] = { text: 'PENDING SOURCE EDIT', fontSize: 16, fontFamily: 'Helvetica', color: '#000000', bold: false, italic: false, underline: false, align: 'left', lineHeight: 1.4 };
        store.put(record); store.put({ ...record, key: record.draft.documentId });
        await done;
      } finally { database.close(); }
    }, pending);
    await page.reload();
    await page.getByTestId('pdf-recovery-resume').click();
    await expect(page.getByTestId('pdf-tool-select')).toBeEnabled({ timeout: 30_000 });
    let posts = 0;
    let downloads = 0;
    page.on('request', request => { if (request.method() === 'POST' && request.url().includes('/api/pdf-editor/')) posts++; });
    page.on('download', () => { downloads++; });
    await page.getByTestId('pdf-export-button').click();
    await expect(page.getByTestId('pdf-editor-toast')).toContainText(pending === 'page-plan' ? 'Page operations are disabled' : 'Structural text editing is disabled');
    expect(posts).toBe(0);
    expect(downloads).toBe(0);
    const retained = await page.evaluate(async kind => {
      const database = await new Promise<IDBDatabase>(resolve => { const request = indexedDB.open('smilepdf:editor:v1', 1); request.onsuccess = () => resolve(request.result); });
      try {
        const record = await new Promise<{ draft: { pagePlan: { entries: unknown[] }; textEdits: Record<string, { text: string }> } }>(resolve => { const request = database.transaction('drafts').objectStore('drafts').get('latest'); request.onsuccess = () => resolve(request.result); });
        return kind === 'page-plan' ? record.draft.pagePlan.entries.length === 3 : record.draft.textEdits['1:0']?.text === 'PENDING SOURCE EDIT';
      } finally { database.close(); }
    }, pending);
    expect(retained).toBe(true);
  });
}
