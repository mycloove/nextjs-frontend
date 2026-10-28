import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';
import { degrees, PDFDocument } from 'pdf-lib';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { allowServerProcessing } from './processing-consent';

async function sourcePdf(text = 'ORIGINAL HEADING', secondPageRotated = false) {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([612, 792]);
  page.drawText(text, { x: 72, y: 700, size: 18 });
  page.drawText('UNCHANGED NEIGHBOR', { x: 72, y: 600, size: 18 });
  if (secondPageRotated) {
    const second = pdf.addPage([612, 792]);
    second.drawText('ROTATED SOURCE', { x: 72, y: 700, size: 18 });
    second.setRotation(degrees(90));
  }
  return Buffer.from(await pdf.save());
}

async function openPdf(page: Page, bytes: Buffer, name = 'local-first.pdf', navigate = true) {
  if (navigate) await page.goto('/pdf-editor');
  const input = page.getByTestId('pdf-upload-input');
  await expect(input).toHaveAttribute('data-editor-ready', 'true', { timeout: 30_000 });
  await input.setInputFiles({ name, mimeType: 'application/pdf', buffer: bytes });
  await expect(page.getByTestId('pdf-tool-select')).toBeEnabled({ timeout: 30_000 });
  await expect(page.locator('.pe-loading-overlay')).toHaveCount(0, { timeout: 30_000 });
}

async function countEditorPosts(page: Page) {
  const posts: { url: string; body: string }[] = [];
  await page.route('**/api/pdf-editor/**', async route => {
    const request = route.request();
    if (request.method() === 'POST') posts.push({ url: request.url(), body: request.postData() ?? '' });
    await route.continue();
  });
  return posts;
}

async function readPdfText(filename: string) {
  const pdf = await pdfjs.getDocument({ data: new Uint8Array(await readFile(filename)) }).promise;
  try {
    const content = await (await pdf.getPage(1)).getTextContent();
    return content.items.map(item => 'str' in item ? item.str : '').join(' ');
  } finally { await pdf.destroy(); }
}

test('no document POST before consent; cancel stays local, approval performs a real text export', async ({ page }, testInfo) => {
  const posts = await countEditorPosts(page);
  await openPdf(page, await sourcePdf());
  await expect(page.getByTestId('pdf-processing-status')).toContainText('not allowed');
  await page.getByTestId('pdf-tool-editText').click();
  const text = page.getByTestId('pdf-original-text-1-0');
  await text.fill('LOCAL FIRST EDIT');
  await page.getByRole('button', { name: 'Preview final PDF', exact: true }).click();
  await expect(page.getByTestId('pdf-preview-processing')).toBeVisible({ timeout: 30_000 });
  expect(posts).toHaveLength(0);
  await page.getByTestId('pdf-preview-processing').click();
  const dialog = page.getByTestId('pdf-processing-dialog');
  await expect(dialog).toContainText('entire PDF');
  await expect(dialog).toContainText('temporary');
  await expect(page.getByTestId('pdf-processing-cancel')).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(page.getByTestId('pdf-processing-confirm')).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(page.getByTestId('pdf-processing-cancel')).toBeFocused();
  await page.keyboard.press('Control+z');
  await expect(text).toHaveValue('LOCAL FIRST EDIT');
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(page.getByTestId('pdf-preview-processing')).toBeFocused();
  expect(posts).toHaveLength(0);
  let downloads = 0;
  page.on('download', () => { downloads += 1; });
  await page.getByTestId('pdf-export-button').click();
  await expect(dialog).toBeVisible({ timeout: 30_000 });
  expect(downloads).toBe(0);
  expect(posts).toHaveLength(0);
  const downloaded = page.waitForEvent('download');
  await page.getByTestId('pdf-processing-confirm').click();
  const output = testInfo.outputPath('consented.pdf');
  await (await downloaded).saveAs(output);
  expect(posts.length).toBeGreaterThan(0);
  expect(posts.every(post => post.url.endsWith('/apply-text-edits'))).toBe(true);
  expect(posts.every(post => !/"(?:acknowledgeFidelityLoss|allowNeighbourLoss|redact)":true/.test(post.body))).toBe(true);
  const exported = await readPdfText(output);
  expect(exported).toContain('LOCAL FIRST EDIT');
  expect(exported).toContain('UNCHANGED NEIGHBOR');
  expect(exported).not.toContain('ORIGINAL HEADING');
  await expect(page.getByTestId('pdf-processing-status')).toContainText('Server permitted, idle');
});

test('an already-queued consent click cannot authorize a replacement or recovered document', async ({ page }) => {
  const posts = await countEditorPosts(page);
  await openPdf(page, await sourcePdf('FIRST SOURCE'));
  await page.getByTestId('pdf-processing-review').click();
  // Capture the real mounted button handler, modelling a click queued before replacement.
  await page.getByTestId('pdf-processing-confirm').evaluate(element => {
    const propsKey = Object.keys(element).find(key => key.startsWith('__reactProps$'))!;
    const props = (element as unknown as Record<string, { onClick: () => void }>)[propsKey];
    (window as typeof window & { __staleProcessingClick?: () => void }).__staleProcessingClick = props.onClick;
  });
  await page.getByRole('button', { name: 'Close editor', exact: true }).evaluate((element: HTMLButtonElement) => element.click());
  await openPdf(page, await sourcePdf('SECOND SOURCE'), 'same-name.pdf', false);
  await page.evaluate(() => (window as typeof window & { __staleProcessingClick?: () => void }).__staleProcessingClick?.());
  await expect(page.getByTestId('pdf-processing-status')).toContainText('not allowed');
  await page.getByTestId('pdf-tool-editText').click();
  await page.getByTestId('pdf-original-text-1-0').fill('SECOND DRAFT');
  await page.getByTestId('pdf-export-button').click();
  await expect(page.getByTestId('pdf-processing-dialog')).toBeVisible({ timeout: 30_000 });
  await page.getByTestId('pdf-processing-cancel').click();
  expect(posts).toHaveLength(0);
  await allowServerProcessing(page);
  await expect(page.getByTestId('pdf-save-status')).toContainText('Saved locally', { timeout: 15_000 });
  await page.reload();
  await expect(page.getByTestId('pdf-upload-input')).toHaveAttribute('data-editor-ready', 'true', { timeout: 30_000 });
  await page.getByTestId('pdf-recovery-resume').click();
  await expect(page.getByTestId('pdf-processing-status')).toContainText('not allowed');
  await page.getByTestId('pdf-export-button').click();
  await expect(page.getByTestId('pdf-processing-dialog')).toBeVisible({ timeout: 30_000 });
  expect(posts).toHaveLength(0);
});

test('original controls are honest while added text and annotation exports stay local', async ({ page }, testInfo) => {
  const posts = await countEditorPosts(page);
  await openPdf(page, await sourcePdf());
  await page.getByTestId('pdf-tool-editText').click();
  await page.getByTestId('pdf-original-text-1-0').click();
  for (const name of ['Font family', 'Heading style', 'Line spacing', 'Text fill']) await expect(page.getByLabel(name, { exact: true })).toBeDisabled();
  for (const name of ['Bold', 'Italic', 'Underline']) await expect(page.getByRole('button', { name, exact: true })).toBeDisabled();
  await expect(page.getByLabel('Font size', { exact: true })).toBeEnabled();
  await expect(page.getByTestId('pdf-text-capability')).toContainText('editing area only');
  await page.getByRole('button', { name: 'Insert', exact: true }).click();
  await page.getByTestId('pdf-tool-text').click();
  await page.keyboard.insertText('LOCAL ADDED TEXT');
  await page.getByTestId('pdf-tool-select').click();
  await page.getByRole('button', { name: 'Text 1', exact: true }).click();
  for (const name of ['Font family', 'Heading style', 'Line spacing', 'Text fill']) await expect(page.getByLabel(name, { exact: true })).toBeEnabled();
  for (const name of ['Bold', 'Italic', 'Underline']) await expect(page.getByRole('button', { name, exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Bold', exact: true }).click();
  await page.getByTestId('pdf-tool-annotate').click();
  await page.getByTestId('pdf-annotation-kind-note').click();
  await page.locator('.pe-page-frame').click({ position: { x: 100, y: 240 } });
  await expect(page.locator('[data-testid^="pdf-annotation-mark-"]')).toHaveCount(1);
  const downloaded = page.waitForEvent('download');
  await page.getByTestId('pdf-export-button').click();
  const output = testInfo.outputPath('local-only.pdf');
  await (await downloaded).saveAs(output);
  expect(posts).toHaveLength(0);
  await expect(page.getByTestId('pdf-processing-dialog')).toHaveCount(0);
  const text = await readPdfText(output);
  expect(text).toContain('ORIGINAL HEADING');
  expect(text).toContain('LOCAL ADDED TEXT');
  const pdf = await pdfjs.getDocument({ data: new Uint8Array(await readFile(output)) }).promise;
  try { expect((await (await pdf.getPage(1)).getAnnotations()).some(annotation => annotation.subtype === 'Text')).toBe(true); }
  finally { await pdf.destroy(); }
});

test('clearing current recovery drains delayed saves and preserves another PDF and its latest pointer', async ({ page }) => {
  const kept = await sourcePdf('KEPT SOURCE');
  const cleared = await sourcePdf('CLEARED SOURCE');
  const ids = { kept: 'sha256-' + createHash('sha256').update(kept).digest('hex'), cleared: 'sha256-' + createHash('sha256').update(cleared).digest('hex') };
  await openPdf(page, kept, 'kept.pdf');
  await page.getByTestId('pdf-tool-editText').click();
  await page.getByTestId('pdf-original-text-1-0').fill('KEPT DRAFT');
  await expect(page.getByTestId('pdf-save-status')).toContainText('Saved locally', { timeout: 15_000 });
  await page.getByRole('button', { name: 'Close editor', exact: true }).click();
  await openPdf(page, cleared, 'cleared.pdf', false);
  await page.getByTestId('pdf-tool-editText').click();
  await page.getByTestId('pdf-original-text-1-0').fill('OPEN WORK');
  await expect(page.getByTestId('pdf-save-status')).toContainText('Saved locally', { timeout: 15_000 });
  await page.evaluate(async ids => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('smilepdf:editor:v1', 1);
      request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
    });
    const transaction = database.transaction('drafts', 'readwrite');
    const done = new Promise<void>((resolve, reject) => { transaction.oncomplete = () => resolve(); transaction.onerror = () => reject(transaction.error); });
    const store = transaction.objectStore('drafts');
    for (const id of [ids.kept, ids.cleared]) {
      const record = await new Promise<{ draft: { version: number }; key: string }>((resolve, reject) => {
        const request = store.get(id); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
      });
      localStorage.setItem(`smilepdf:editor:draft:v2:${id}`, JSON.stringify({ ...record.draft, version: id === ids.kept ? 2 : 3 }));
      if (id === ids.kept) store.put({ ...record, key: 'latest' });
    }
    await done;
    database.close();
    localStorage.setItem('unrelated-recovery-test', 'keep');
    const state = window as typeof window & { __releaseRecoveryOpen?: () => void; __recoveryOpenHeld?: boolean };
    const originalOpen = indexedDB.open.bind(indexedDB);
    let holdNext = true;
    indexedDB.open = (name, version) => {
      const request = originalOpen(name, version);
      if (name !== 'smilepdf:editor:v1' || !holdNext) return request;
      holdNext = false;
      const setter = Object.getOwnPropertyDescriptor(IDBRequest.prototype, 'onsuccess')!.set!;
      Object.defineProperty(request, 'onsuccess', { set(callback: (event: Event) => void) {
        setter.call(request, (event: Event) => { state.__recoveryOpenHeld = true; state.__releaseRecoveryOpen = () => callback.call(request, event); });
      } });
      return request;
    };
  }, ids);
  await page.getByTestId('pdf-original-text-1-0').fill('DELAYED OPEN WORK');
  await page.waitForFunction(() => (window as typeof window & { __recoveryOpenHeld?: boolean }).__recoveryOpenHeld);
  await page.getByTestId('pdf-recovery-clear').click();
  await expect(page.getByTestId('pdf-recovery-dialog')).toContainText('current work stays open');
  await page.getByTestId('pdf-recovery-confirm').click();
  await expect(page.getByTestId('pdf-recovery-clear')).toContainText('Removing');
  await page.evaluate(() => (window as typeof window & { __releaseRecoveryOpen?: () => void }).__releaseRecoveryOpen?.());
  await expect(page.getByTestId('pdf-recovery-status')).toContainText('removed and disabled', { timeout: 15_000 });
  await expect(page.getByTestId('pdf-original-text-1-0')).toHaveValue('DELAYED OPEN WORK');
  await page.getByTestId('pdf-original-text-1-0').fill('STILL OPEN WORK');
  await page.waitForTimeout(1200); // Cross the real 600ms autosave window after deletion.
  const stored = await page.evaluate(async ids => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('smilepdf:editor:v1', 1); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
    });
    try {
      const transaction = database.transaction(['drafts', 'sources'], 'readonly');
      const read = (store: string, key: string) => new Promise<unknown>((resolve, reject) => {
        const request = transaction.objectStore(store).get(key); request.onsuccess = () => resolve(request.result ?? null); request.onerror = () => reject(request.error);
      });
      const records = await Promise.all([read('drafts', ids.cleared), read('sources', ids.cleared), read('drafts', ids.kept), read('sources', ids.kept), read('drafts', 'latest')]);
      return { clearedDraft: records[0], clearedSource: records[1], keptDraft: !!records[2], keptSource: !!records[3], latest: (records[4] as { draft: { documentId: string } })?.draft.documentId,
        clearedFallback: localStorage.getItem(`smilepdf:editor:draft:v2:${ids.cleared}`), keptFallback: JSON.parse(localStorage.getItem(`smilepdf:editor:draft:v2:${ids.kept}`)!), unrelated: localStorage.getItem('unrelated-recovery-test') };
    } finally { database.close(); }
  }, ids);
  expect(stored).toMatchObject({ clearedDraft: null, clearedSource: null, keptDraft: true, keptSource: true, latest: ids.kept, clearedFallback: null, keptFallback: { version: 2, documentId: ids.kept }, unrelated: 'keep' });
  await page.getByRole('button', { name: 'Close editor', exact: true }).click();
  await expect(page.getByTestId('pdf-close-dialog')).toBeVisible();
  await page.getByTestId('pdf-close-cancel').click();
  await expect(page.getByTestId('pdf-original-text-1-0')).toHaveValue('STILL OPEN WORK');
});

test('fallback recovery says the source must be reselected and clears only the current hash', async ({ page }) => {
  await page.addInitScript(() => Object.defineProperty(window, 'indexedDB', { value: undefined }));
  await openPdf(page, await sourcePdf());
  await page.getByTestId('pdf-tool-editText').click();
  await page.getByTestId('pdf-original-text-1-0').fill('FALLBACK DRAFT');
  await expect(page.getByTestId('pdf-recovery-status')).toContainText('Reselect the original PDF', { timeout: 15_000 });
  await page.getByTestId('pdf-recovery-clear').click();
  await page.getByTestId('pdf-recovery-confirm').click();
  await expect(page.getByTestId('pdf-recovery-status')).toContainText('removed and disabled');
  expect(await page.evaluate(() => Object.keys(localStorage).filter(key => key.startsWith('smilepdf:editor:draft:v2:')))).toHaveLength(0);
});

test('annotation limits are enforced before authoring and incompatible restored data blocks export without deletion', async ({ page }) => {
  const posts = await countEditorPosts(page);
  await openPdf(page, await sourcePdf('ORIGINAL HEADING', true));
  await page.getByTestId('pdf-page-next').click();
  await page.getByTestId('pdf-tool-annotate').click();
  await expect(page.getByTestId('pdf-annotation-capability')).toContainText('rotated');
  await expect(page.getByTestId('pdf-annotation-kind-note')).toBeDisabled();
  const rotatedTarget = page.getByTestId('pdf-annotation-target-2-0');
  await expect(rotatedTarget).toBeVisible({ timeout: 20_000 });
  await rotatedTarget.click();
  await expect(rotatedTarget).toHaveAttribute('aria-pressed', 'false');
  await page.getByTestId('pdf-page-prev').click();
  await page.getByTestId('pdf-annotation-kind-note').click();
  await page.locator('.pe-page-frame').click({ position: { x: 100, y: 240 } });
  await expect(page.locator('[data-testid^="pdf-annotation-mark-"]')).toHaveCount(1);
  await page.getByTestId('pdf-tool-select').click();
  await expect(page.getByTestId('pdf-page-size').locator('option[value="a4"]')).toBeDisabled();
  await page.getByRole('tab', { name: 'Arrange', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Rotate output page 1 right', exact: true })).toBeDisabled();
  await expect(page.getByTestId('pdf-save-status')).toContainText('Saved locally', { timeout: 15_000 });
  await page.evaluate(async () => {
    const database = await new Promise<IDBDatabase>(resolve => { const request = indexedDB.open('smilepdf:editor:v1', 1); request.onsuccess = () => resolve(request.result); });
    const transaction = database.transaction('drafts', 'readwrite');
    const done = new Promise<void>(resolve => { transaction.oncomplete = () => resolve(); });
    const store = transaction.objectStore('drafts');
    const record = await new Promise<{ key: string; draft: { documentId: string; pageSize: string } }>(resolve => { const request = store.get('latest'); request.onsuccess = () => resolve(request.result); });
    record.draft.pageSize = 'a4';
    store.put(record); store.put({ ...record, key: record.draft.documentId });
    await done; database.close();
  });
  await page.reload();
  await expect(page.getByTestId('pdf-upload-input')).toHaveAttribute('data-editor-ready', 'true', { timeout: 30_000 });
  await page.getByTestId('pdf-recovery-resume').click();
  await expect(page.locator('[data-testid^="pdf-annotation-mark-"]')).toHaveCount(1, { timeout: 30_000 });
  let downloads = 0;
  page.on('download', () => { downloads += 1; });
  await page.getByTestId('pdf-export-button').click();
  await expect(page.getByTestId('pdf-editor-toast')).toContainText('Original page size');
  expect(downloads).toBe(0);
  expect(posts).toHaveLength(0);
  await expect(page.locator('[data-testid^="pdf-annotation-mark-"]')).toHaveCount(1);
});

test('OCR requires its own raster-copy acknowledgement and privacy grant and downloads without replacing the source', async ({ page }, testInfo) => {
  const posts = await countEditorPosts(page);
  await openPdf(page, await sourcePdf());
  await page.getByTestId('pdf-ocr-copy').click();
  await expect(page.getByTestId('pdf-ocr-dialog')).toContainText('rasterizes every page');
  expect(posts).toHaveLength(0);
  await page.getByTestId('pdf-ocr-confirm').click();
  await expect(page.getByTestId('pdf-processing-dialog')).toBeVisible();
  expect(posts).toHaveLength(0);
  const responded = page.waitForResponse(response => response.url().endsWith('/api/pdf-editor/ocr'));
  const downloaded = page.waitForEvent('download', { timeout: 90_000 }).catch(() => null);
  await page.getByTestId('pdf-processing-confirm').click();
  const response = await responded;
  const result = await response.json() as { error?: string };
  expect(response.ok(), result.error ?? 'The real OCR service must succeed for this positive gate.').toBe(true);
  const output = testInfo.outputPath('ocr-copy.pdf');
  const download = await downloaded;
  if (!download) throw new Error('The real OCR service returned no downloadable copy.');
  expect(download.suggestedFilename()).toBe('local-first-ocr.pdf');
  await download.saveAs(output);
  expect(posts).toHaveLength(1);
  expect(posts[0].url).toContain('/ocr');
  expect(posts[0].body).toContain('eng');
  expect(await readPdfText(output)).toContain('ORIGINAL');
  await expect(page.getByTestId('pdf-ocr-status')).toContainText('open PDF is unchanged');
  await page.getByTestId('pdf-tool-editText').click();
  await expect(page.getByTestId('pdf-original-text-1-0')).toHaveValue('ORIGINAL HEADING');
});

test('OCR failures remain visible, duplicate requests are blocked, and edited work refuses OCR before upload', async ({ page }) => {
  await openPdf(page, await sourcePdf());
  await allowServerProcessing(page);
  let requests = 0;
  let release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/api/pdf-editor/ocr', async route => {
    requests += 1;
    await held;
    await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'Durable OCR failure' }) });
  });
  await page.getByTestId('pdf-ocr-copy').click();
  await page.getByTestId('pdf-ocr-confirm').click();
  try {
    await expect(page.getByTestId('pdf-ocr-copy')).toBeDisabled();
    await expect.poll(() => requests).toBe(1);
    await page.getByTestId('pdf-ocr-copy').evaluate((element: HTMLButtonElement) => element.click());
    expect(requests).toBe(1);
  } finally { release(); }
  await expect(page.getByTestId('pdf-ocr-status')).toContainText('Durable OCR failure');
  await page.getByTestId('pdf-tool-editText').click();
  await page.getByTestId('pdf-original-text-1-0').fill('PRESERVE CURRENT WORK');
  await expect(page.getByTestId('pdf-ocr-status')).toContainText('Durable OCR failure');
  await page.getByTestId('pdf-ocr-copy').click();
  await expect(page.getByTestId('pdf-ocr-status')).toContainText('Export your work and open that copy first');
  await expect(page.getByTestId('pdf-ocr-dialog')).toHaveCount(0);
  expect(requests).toBe(1);
  await expect(page.getByTestId('pdf-original-text-1-0')).toHaveValue('PRESERVE CURRENT WORK');
});

test('processing disclosure stays readable and contained in both themes and narrow viewports', async ({ page }, testInfo) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await openPdf(page, await sourcePdf());
  await page.getByTestId('pdf-processing-review').click();
  for (const theme of ['dark', 'light']) {
    await page.evaluate(theme => document.documentElement.setAttribute('data-theme', theme), theme);
    for (const width of [1280, 390]) {
      await page.setViewportSize({ width, height: 844 });
      const dialog = page.getByTestId('pdf-processing-dialog');
      const measurement = await dialog.evaluate(element => {
        const rect = element.getBoundingClientRect();
        const surface = getComputedStyle(element).backgroundColor;
        const body = getComputedStyle(element.querySelector('.pe-document-explanation')!).color;
        const confirm = getComputedStyle(element.querySelector('[data-testid="pdf-processing-confirm"]')!);
        const luminance = (color: string) => {
          const channels = color.match(/[\d.]+/g)!.slice(0, 3).map(Number).map(channel => {
            const value = channel / 255;
            return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
          });
          return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
        };
        const contrast = (a: string, b: string) => (Math.max(luminance(a), luminance(b)) + 0.05) / (Math.min(luminance(a), luminance(b)) + 0.05);
        return { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom, text: contrast(body, surface), button: contrast(confirm.color, confirm.backgroundColor) };
      });
      expect(measurement.left).toBeGreaterThanOrEqual(0);
      expect(measurement.top).toBeGreaterThanOrEqual(0);
      expect(measurement.right).toBeLessThanOrEqual(width);
      expect(measurement.bottom).toBeLessThanOrEqual(844);
      expect(measurement.text).toBeGreaterThanOrEqual(4.5);
      expect(measurement.button).toBeGreaterThanOrEqual(4.5);
      await page.screenshot({ path: testInfo.outputPath(`processing-${theme}-${width}.png`) });
    }
  }
});

test('work edited during OCR prevents delivery of a stale copy without replacing or losing current edits', async ({ page }) => {
  const source = await sourcePdf();
  await openPdf(page, source);
  await allowServerProcessing(page);
  let requests = 0;
  let downloads = 0;
  let release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  page.on('download', () => { downloads += 1; });
  await page.route('**/api/pdf-editor/ocr', async route => {
    requests += 1;
    await held;
    // A transport success is held to exercise the live revision check, not OCR recognition.
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ pdf: source.toString('base64') }) });
  });
  await page.getByTestId('pdf-ocr-copy').click();
  await page.getByTestId('pdf-ocr-confirm').click();
  try {
    await expect.poll(() => requests).toBe(1);
    await expect(page.getByTestId('pdf-processing-status')).toContainText('Server processing now');
    await page.getByTestId('pdf-tool-editText').click();
    await page.getByTestId('pdf-original-text-1-0').fill('CHANGED WHILE OCR RAN');
  } finally { release(); }
  await expect(page.getByTestId('pdf-ocr-status')).toContainText('changed while OCR was running');
  expect(downloads).toBe(0);
  await expect(page.getByTestId('pdf-original-text-1-0')).toHaveValue('CHANGED WHILE OCR RAN');
  await page.getByTestId('pdf-ocr-copy').click();
  await expect(page.getByTestId('pdf-ocr-status')).toContainText('Export your work and open that copy first');
  expect(requests).toBe(1);
});
