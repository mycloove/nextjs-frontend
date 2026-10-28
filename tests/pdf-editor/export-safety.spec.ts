import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { expect, test, type Page } from '@playwright/test';
import { PDFDict, PDFDocument, PDFName } from 'pdf-lib';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { allowServerProcessing } from './processing-consent';

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

test('identical file metadata never reuses another document export', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'Source identity uses the same hook on each viewport.');
  const sources: Buffer[] = [];
  for (const text of ['DOCUMENT AAA', 'DOCUMENT BBB']) {
    const doc = await PDFDocument.create();
    doc.setCreationDate(new Date('2025-01-01T00:00:00Z'));
    doc.setModificationDate(new Date('2025-01-01T00:00:00Z'));
    doc.addPage([612, 792]).drawText(text, { x: 72, y: 700, size: 18 });
    sources.push(Buffer.from(await doc.save()));
  }
  const length = Math.max(...sources.map(source => source.length));
  const padded = sources.map(source => {
    const bytes = Buffer.alloc(length, 32);
    source.copy(bytes);
    return bytes;
  });
  expect(padded[0].equals(padded[1])).toBe(false);
  await page.goto('/pdf-editor');
  for (const [index, source] of padded.entries()) {
    const input = page.getByTestId('pdf-upload-input');
    await expect(input).toHaveAttribute('data-editor-ready', 'true', { timeout: 30_000 });
    await input.evaluate((element, bytes) => {
      const transfer = new DataTransfer();
      transfer.items.add(new File([new Uint8Array(bytes)], 'same-metadata.pdf', {
        type: 'application/pdf', lastModified: 1_700_000_000_000,
      }));
      (element as HTMLInputElement).files = transfer.files;
      element.dispatchEvent(new Event('change', { bubbles: true }));
    }, [...source]);
    await expect(page.getByTestId('pdf-export-button')).toBeEnabled({ timeout: 30_000 });
    await expect(page.locator('.pe-loading-overlay')).toHaveCount(0, { timeout: 30_000 });
    const downloadPromise = page.waitForEvent('download');
    await page.getByTestId('pdf-export-button').click();
    await expect(page.getByTestId('pdf-editor-toast')).toContainText('exported and verified', { timeout: 30_000 });
    const download = await downloadPromise;
    const output = testInfo.outputPath(`document-${index}.pdf`);
    await download.saveAs(output);
    expect(Buffer.from(await readFile(output)).equals(source)).toBe(true);
    if (index === 0) await page.getByRole('button', { name: 'Close editor', exact: true }).click();
  }
});

test('preview and download use identical built bytes without a second server edit', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'The byte identity contract is viewport-independent.');
  await page.addInitScript(() => {
    const state = window as typeof window & { __pdfEditorWorkerInputs?: number[][] };
    state.__pdfEditorWorkerInputs = [];
    const send = Worker.prototype.postMessage;
    Worker.prototype.postMessage = function(message, transfer) {
      const data = message?.data?.data;
      if (message?.action === 'GetDocRequest' && ArrayBuffer.isView(data)) {
        state.__pdfEditorWorkerInputs!.push([...new Uint8Array(data.buffer, data.byteOffset, data.byteLength)]);
      }
      return Reflect.apply(send, this, [message, transfer]);
    };
  });
  await upload(page, 'phase-1e-plain.pdf', 1);
  await allowServerProcessing(page);
  let serverEdits = 0;
  page.on('request', request => {
    if (request.url().endsWith('/api/pdf-editor/apply-text-edits')) serverEdits += 1;
  });
  await page.getByTestId('pdf-tool-editText').click();
  await page.getByTestId('pdf-original-text-1-0').fill('VERIFIED PREVIEW BYTES');
  await page.getByRole('button', { name: 'Preview final PDF', exact: true }).click();
  await expect(page.locator('.pe-preview-status')).toHaveCount(1, { timeout: 10_000 });
  await expect(page.locator('.pe-preview-status')).toHaveCount(0, { timeout: 60_000 });
  await expect(page.locator('.pe-preview-blocked')).toHaveCount(0);
  const previewBytes = await page.evaluate(() => (
    (window as typeof window & { __pdfEditorWorkerInputs?: number[][] }).__pdfEditorWorkerInputs?.at(-1)
  ));
  expect(previewBytes?.length).toBeGreaterThan(100);
  const callsBeforeDownload = serverEdits;
  const downloadPromise = page.waitForEvent('download');
  await page.getByTestId('pdf-export-button').click();
  const download = await downloadPromise;
  const output = testInfo.outputPath('previewed.pdf');
  await download.saveAs(output);
  expect(Buffer.from(await readFile(output)).equals(Buffer.from(previewBytes!))).toBe(true);
  expect(serverEdits).toBe(callsBeforeDownload);
  expect(callsBeforeDownload).toBeGreaterThan(0);
  const reopened = await reopenDownload(output);
  expect(reopened.pageText[0]).toContain('VERIFIED PREVIEW BYTES');
});

test('an unchanged export retries after a transient transport failure', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'Transport retry uses the same hook on each viewport.');
  await upload(page, 'phase-1e-plain.pdf', 1);
  await allowServerProcessing(page);
  await page.getByTestId('pdf-tool-editText').click();
  await page.getByTestId('pdf-original-text-1-0').fill('RETRIED DOCUMENT');
  let requests = 0;
  await page.route('**/api/pdf-editor/apply-text-edits', async route => {
    requests += 1;
    if (requests === 1) {
      await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'Temporary test outage' }) });
    } else {
      await route.continue();
    }
  });
  await page.getByTestId('pdf-export-button').click();
  await expect(page.getByTestId('pdf-editor-toast')).toContainText('Temporary test outage', { timeout: 30_000 });
  const pending = page.waitForEvent('download');
  await page.getByTestId('pdf-export-button').click();
  const output = testInfo.outputPath('retry.pdf');
  await (await pending).saveAs(output);
  expect(requests).toBe(2);
  expect((await reopenDownload(output)).pageText[0]).toContain('RETRIED DOCUMENT');
});

test('editing during an awaited build cannot deliver the old revision', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'Revision ownership uses the same hook on each viewport.');
  await upload(page, 'phase-1e-plain.pdf', 1);
  await allowServerProcessing(page);
  await page.getByTestId('pdf-tool-editText').click();
  const text = page.getByTestId('pdf-original-text-1-0');
  await text.fill('FIRST REVISION');
  let release = () => {};
  let received = () => {};
  const held = new Promise<void>(resolve => { release = resolve; });
  const waiting = new Promise<void>(resolve => { received = resolve; });
  let holdNext = true;
  await page.route('**/api/pdf-editor/apply-text-edits', async route => {
    if (!holdNext) return route.continue();
    holdNext = false;
    const response = await route.fetch();
    received();
    await held;
    await route.fulfill({ response });
  });
  let downloads = 0;
  page.on('download', () => { downloads += 1; });
  await page.getByTestId('pdf-export-button').click();
  await waiting;
  await text.fill('SECOND REVISION');
  release();
  await expect(page.getByTestId('pdf-editor-toast')).toContainText('document changed', { timeout: 30_000 });
  expect(downloads).toBe(0);
  const pending = page.waitForEvent('download');
  await page.getByTestId('pdf-export-button').click();
  await expect(page.getByTestId('pdf-editor-toast')).toContainText('exported and verified', { timeout: 30_000 });
  const output = testInfo.outputPath('current-revision.pdf');
  await (await pending).saveAs(output);
  const reopened = await reopenDownload(output);
  expect(reopened.pageText[0]).toContain('SECOND REVISION');
  expect(reopened.pageText[0]).not.toContain('FIRST REVISION');
  expect(downloads).toBe(1);
});

test('critical export approval cannot be replayed after a document change', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'Approval ownership uses the same hook on each viewport.');
  await upload(page);
  await page.getByTestId('pdf-page-size').selectOption('a4');
  let downloads = 0;
  page.on('download', () => { downloads += 1; });
  await page.getByTestId('pdf-export-button').click();
  await expect(page.getByTestId('pdf-export-impact-dialog')).toBeVisible({ timeout: 60_000 });
  expect(downloads).toBe(0);
  // Programmatic change models a queued action while the modal is already open.
  await page.getByTestId('pdf-page-size').selectOption('letter');
  await page.getByTestId('pdf-export-confirm').click();
  await expect(page.getByTestId('pdf-editor-toast')).toContainText('changed after this review', { timeout: 30_000 });
  expect(downloads).toBe(0);
  await page.getByTestId('pdf-export-button').click();
  await expect(page.getByTestId('pdf-export-impact-dialog')).toBeVisible({ timeout: 60_000 });
  const pending = page.waitForEvent('download');
  await page.getByTestId('pdf-export-confirm').click();
  await pending;
  expect(downloads).toBe(1);
});

test('closing a document aborts its pending client wait without affecting the next export', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'Client cancellation uses the same hook on each viewport.');
  await page.addInitScript(() => {
    const state = window as typeof window & { __pdfEditorAborts?: number };
    state.__pdfEditorAborts = 0;
    const fetch = window.fetch;
    window.fetch = (input, options) => {
      if (String(input).endsWith('/api/pdf-editor/apply-text-edits')) {
        options?.signal?.addEventListener('abort', () => { state.__pdfEditorAborts! += 1; }, { once: true });
      }
      return fetch(input, options);
    };
  });
  await upload(page, 'phase-1e-plain.pdf', 1);
  await allowServerProcessing(page);
  await page.getByTestId('pdf-tool-editText').click();
  await page.getByTestId('pdf-original-text-1-0').fill('CLOSED DOCUMENT EDIT');
  let release = () => {};
  let received = () => {};
  const held = new Promise<void>(resolve => { release = resolve; });
  const waiting = new Promise<void>(resolve => { received = resolve; });
  await page.route('**/api/pdf-editor/apply-text-edits', async route => {
    const response = await route.fetch();
    received();
    await held;
    await route.fulfill({ response });
  });
  let downloads = 0;
  page.on('download', () => { downloads += 1; });
  try {
    // Preview builds remain cancellable by closing; the download overlay blocks editing.
    await page.getByRole('button', { name: 'Preview final PDF', exact: true }).click();
    await waiting;
    await page.getByRole('button', { name: 'Close editor', exact: true }).click();
    await expect(page.getByTestId('pdf-upload-input')).toHaveAttribute('data-editor-ready', 'true');
    expect(await page.evaluate(() => (window as typeof window & { __pdfEditorAborts?: number }).__pdfEditorAborts)).toBe(1);
    expect(downloads).toBe(0);
  } finally {
    release();
  }
  const source = await PDFDocument.create();
  source.addPage([612, 792]).drawText('NEW SESSION SOURCE', { x: 72, y: 700, size: 18 });
  const bytes = Buffer.from(await source.save());
  await page.getByTestId('pdf-upload-input').setInputFiles({ name: 'new-session.pdf', mimeType: 'application/pdf', buffer: bytes });
  await expect(page.getByTestId('pdf-export-button')).toBeEnabled({ timeout: 30_000 });
  await expect(page.locator('.pe-loading-overlay')).toHaveCount(0, { timeout: 30_000 });
  const pending = page.waitForEvent('download');
  await page.getByTestId('pdf-export-button').click();
  const output = testInfo.outputPath('new-session.pdf');
  await (await pending).saveAs(output);
  expect(Buffer.from(await readFile(output)).equals(bytes)).toBe(true);
  expect(downloads).toBe(1);
});

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
  await expect(page.getByTestId('pdf-upload-input')).toHaveAttribute('data-editor-ready', 'true', { timeout: 30_000 });
  await expect(page.getByTestId('pdf-recovery-resume')).toBeVisible();
  await page.getByTestId('pdf-recovery-resume').click();
  await expect(page.getByTestId('pdf-export-button')).toBeEnabled({ timeout: 30_000 });
  await allowServerProcessing(page);

  const downloadPromise = page.waitForEvent('download');
  await page.getByTestId('pdf-export-button').click();
  await expect(page.getByTestId('pdf-export-impact-dialog')).toBeVisible({ timeout: 60_000 });
  await page.getByTestId('pdf-export-confirm').click();
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

test('page-size export requires signature-impact approval before download', async ({ page }, testInfo) => {
  await upload(page);
  await page.getByTestId('pdf-page-size').selectOption('a4');
  await expect(page.getByTestId('pdf-save-status')).toContainText('Saved locally', { timeout: 15_000 });
  await expectInsideViewport(page, 'pdf-export-button');
  await expect(page).toHaveScreenshot(`editor-workflow-${testInfo.project.name}.png`);
  const downloadPromise = page.waitForEvent('download');
  await page.getByTestId('pdf-export-button').click();
  await expect(page.getByTestId('pdf-export-impact-dialog')).toBeVisible({ timeout: 60_000 });
  await page.getByTestId('pdf-export-confirm').click();
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
  await allowServerProcessing(page);
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
