import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { expect, test, type Page } from '@playwright/test';
import { PDFDict, PDFDocument, PDFName } from 'pdf-lib';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';

const fixtures = path.join(__dirname, 'fixtures');

async function expectInsideViewport(page: Page, testId: string) {
  const bounds = await page.getByTestId(testId).evaluate(element => {
    const rect = element.getBoundingClientRect();
    return {
      left: rect.left,
      top: rect.top,
      right: rect.right,
      bottom: rect.bottom,
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
    };
  });
  expect(bounds.left).toBeGreaterThanOrEqual(0);
  expect(bounds.top).toBeGreaterThanOrEqual(0);
  expect(bounds.right).toBeLessThanOrEqual(bounds.viewportWidth);
  expect(bounds.bottom).toBeLessThanOrEqual(bounds.viewportHeight);
}

async function upload(page: Page, name = 'phase-1e-complex.pdf', expectedPages = 2) {
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
  await expect(page.getByText(`1 / ${expectedPages}`, { exact: true })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId('pdf-page-size')).toHaveValue('original');
  await expect(page.locator('.pe-loading-overlay')).toHaveCount(0, { timeout: 30_000 });
}

async function reopenDownload(downloadPath: string) {
  const bytes = new Uint8Array(await readFile(downloadPath));
  const [pdfLibDocument, pdfjsDocument] = await Promise.all([
    PDFDocument.load(bytes.slice(), { updateMetadata: false }),
    pdfjs.getDocument({ data: bytes.slice() }).promise,
  ]);
  try {
    let signatureValueCount = 0;
    for (const [, object] of pdfLibDocument.context.enumerateIndirectObjects()) {
      if (object instanceof PDFDict && object.has(PDFName.of('ByteRange'))) {
        signatureValueCount += 1;
      }
    }
    const pageText: string[] = [];
    const pageRotations: number[] = [];
    const annotations: unknown[][] = [];
    for (let pageNumber = 1; pageNumber <= pdfjsDocument.numPages; pageNumber += 1) {
      const pdfPage = await pdfjsDocument.getPage(pageNumber);
      const content = await pdfPage.getTextContent();
      pageText.push(content.items.map(item => 'str' in item ? item.str : '').join(' '));
      pageRotations.push(pdfPage.rotate ?? 0);
      annotations.push(await pdfPage.getAnnotations());
    }
    const [fieldObjects, outline, attachments, markInfo] = await Promise.all([
      pdfjsDocument.getFieldObjects(),
      pdfjsDocument.getOutline(),
      pdfjsDocument.getAttachments(),
      pdfjsDocument.getMarkInfo(),
    ]);
    return {
      pageCount: pdfLibDocument.getPageCount(),
      title: pdfLibDocument.getTitle(),
      author: pdfLibDocument.getAuthor(),
      subject: pdfLibDocument.getSubject(),
      keywords: pdfLibDocument.getKeywords(),
      creationDate: pdfLibDocument.getCreationDate()?.toISOString(),
      modificationDate: pdfLibDocument.getModificationDate()?.toISOString(),
      signatureValueCount,
      fields: pdfLibDocument.getForm().getFields().map(field => field.getName()),
      pdfjsFieldRoots: Object.keys(fieldObjects ?? {}),
      pageText,
      pageRotations,
      annotations,
      outlineCount: outline?.length ?? 0,
      attachmentCount: Object.keys(attachments ?? {}).length,
      tagged: markInfo?.Marked === true,
    };
  } finally {
    await pdfjsDocument.destroy();
  }
}

test('export preview renders the exported bytes without a blocked panel', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'The preview verifies the desktop bundle path.');
  // The narrow layout moves the inspector to a fixed rail; the panel must still
  // fit inside the viewport instead of clipping its right edge.
  await page.setViewportSize({ width: 1180, height: 900 });
  await upload(page, 'phase-1e-plain.pdf', 1);

  await page.getByRole('button', { name: 'Preview final PDF' }).click();
  const previewCanvas = page.locator('.pe-preview-canvas');
  await expect(previewCanvas).toBeVisible();

  // A rendered export sets the canvas backing size before PDF.js paints. The
  // untouched default is 300x150, so anything larger proves bytes were drawn.
  await expect.poll(
    () => previewCanvas.evaluate(canvas => (canvas as HTMLCanvasElement).width),
    { timeout: 60_000 },
  ).toBeGreaterThan(300);

  await expect(page.locator('.pe-preview-blocked')).toHaveCount(0);
  await expectInsideViewport(page, 'pdf-inspector-panel');
});

test('upload, autosave, refresh, recover, export, and reopen', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'The full workflow runs once; responsive projects validate the dialog.');
  await upload(page);
  await page.getByTestId('pdf-tool-editText').click();
  const sourceText = page.locator('textarea[data-pdf-text="true"]').filter({ hasText: 'Phase 1E searchable source text' });
  await expect(sourceText).toBeVisible({ timeout: 15_000 });
  await sourceText.fill('Phase 1E edited and recovered text');
  await expect(page.getByTestId('pdf-save-status')).toContainText('Saved locally', { timeout: 15_000 });
  await page.reload();
  await expect(page.getByTestId('pdf-recovery-resume')).toBeVisible();
  await page.getByTestId('pdf-recovery-resume').click();
  await expect(page.getByTestId('pdf-export-button')).toBeEnabled({ timeout: 30_000 });

  const downloadPromise = page.waitForEvent('download');
  await page.getByTestId('pdf-export-button').click();
  // The success toast auto-dismisses after 3s; start waiting before the
  // export hand-off completes so slow parallel runs cannot miss it.
  await expect(page.getByTestId('pdf-editor-toast')).toContainText(/verified/i, { timeout: 30_000 });
  const download = await downloadPromise;
  const outputPath = path.join(testInfo.outputDir, await download.suggestedFilename());
  await download.saveAs(outputPath);

  const reopened = await reopenDownload(outputPath);
  expect(reopened.pageCount).toBe(2);
  expect(reopened.title).toBe('Phase 1E complex preservation corpus');
  expect(reopened.author).toBe('SmilePDF verification suite');
  expect(reopened.subject).toContain('Forms, links, outlines');
  expect(reopened.keywords).toContain('phase-1e');
  expect(reopened.creationDate).toBe('2025-01-02T03:04:05.000Z');
  expect(reopened.modificationDate).toBe('2025-01-02T03:04:05.000Z');
  expect(reopened.signatureValueCount).toBeGreaterThanOrEqual(1);
  expect(reopened.fields).toContain('customer.name');
  expect(reopened.fields).toContain('approval.signature');
  expect(reopened.pdfjsFieldRoots).toContain('customer');
  expect(reopened.pdfjsFieldRoots).toContain('approval.signature');
  expect(reopened.pageText[0]).toContain('Phase 1E edited and recovered text');
  expect(reopened.pageText[1]).toContain('Phase 1E rotated page text');
  expect(reopened.pageRotations).toEqual([0, 90]);
  expect(reopened.annotations[0].some(annotation => (
    annotation as { subtype?: string; url?: string }
  ).subtype === 'Link' && (annotation as { url?: string }).url === 'https://example.com/phase-1e')).toBe(true);
  expect(reopened.annotations[0].some(annotation => (
    annotation as { subtype?: string; contentsObj?: { str?: string } }
  ).subtype === 'Text' && (
    annotation as { contentsObj?: { str?: string } }
  ).contentsObj?.str === 'Phase 1E preservation note')).toBe(true);
  expect(reopened.outlineCount).toBeGreaterThanOrEqual(1);
  expect(reopened.attachmentCount).toBeGreaterThanOrEqual(1);
  expect(reopened.tagged).toBe(true);
});

test('page-size export downloads a verified rebuilt PDF without blocking prompts', async ({ page }, testInfo) => {
  await upload(page);
  await page.getByTestId('pdf-page-size').selectOption('a4');
  await expect(page.getByTestId('pdf-save-status')).toContainText('Saved locally', { timeout: 15_000 });
  await expectInsideViewport(page, 'pdf-export-button');
  await expect(page).toHaveScreenshot(`editor-workflow-${testInfo.project.name}.png`);
  const downloadPromise = page.waitForEvent('download');
  await page.getByTestId('pdf-export-button').click();
  // The success toast auto-dismisses after 3s; start waiting before the
  // export hand-off completes so slow parallel runs cannot miss it.
  await expect(page.getByTestId('pdf-editor-toast')).toContainText(/verified/i, { timeout: 30_000 });
  const download = await downloadPromise;
  const outputPath = path.join(testInfo.outputDir, `compatibility-${testInfo.project.name}.pdf`);
  await download.saveAs(outputPath);
  expect((await reopenDownload(outputPath)).pageCount).toBe(2);
});

test('structure export fallback downloads a verified PDF without blocking prompts', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'Fallback policy is viewport-independent.');
  await upload(page, 'phase-1e-plain.pdf', 1);
  await page.getByTestId('pdf-tool-editText').click();
  const sourceText = page.locator('textarea[data-pdf-text="true"]').filter({ hasText: 'Phase 1E plain browser workflow' });
  await expect(sourceText).toBeVisible({ timeout: 15_000 });
  await sourceText.fill('Phase 1E compatibility fallback text');
  await expect(page.getByTestId('pdf-save-status')).toContainText('Saved locally', { timeout: 15_000 });
  await page.evaluate(() => {
    (globalThis as typeof globalThis & { __SMILEPDF_E2E_FORCE_STRUCTURE_EXPORT_FAILURE__?: boolean })
      .__SMILEPDF_E2E_FORCE_STRUCTURE_EXPORT_FAILURE__ = true;
  });

  const downloadPromise = page.waitForEvent('download');
  await page.getByTestId('pdf-export-button').click();
  // The success toast auto-dismisses after 3s; start waiting before the
  // export hand-off completes so slow parallel runs cannot miss it.
  await expect(page.getByTestId('pdf-editor-toast')).toContainText(/verified/i, { timeout: 30_000 });
  const download = await downloadPromise;
  const outputPath = path.join(testInfo.outputDir, 'fallback-approved.pdf');
  await download.saveAs(outputPath);
  const reopened = await reopenDownload(outputPath);
  expect(reopened.pageCount).toBe(1);
  expect(reopened.pageText[0]).toContain('Phase 1E compatibility fallback text');
  expect(reopened.fields).toEqual([]);
});
