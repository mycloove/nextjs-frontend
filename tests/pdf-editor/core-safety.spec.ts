import { readFile } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';
import { PDFDocument } from 'pdf-lib';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { allowServerProcessing } from './processing-consent';

test.setTimeout(180_000);
test.use({ actionTimeout: 15_000 });

async function openDocument(page: Page, waitForCanvas = true) {
  const pdf = await PDFDocument.create();
  pdf.setCreationDate(new Date('2026-10-28T00:00:00Z'));
  pdf.setModificationDate(new Date('2026-10-28T00:00:00Z'));
  for (let number = 1; number <= 3; number++) {
    const sheet = pdf.addPage([612, 792]);
    sheet.drawText(`PAGE ${number} TITLE`, { x: 60, y: 730, size: 16 });
    sheet.drawText('SEARCH MARKER', { x: 60, y: 650, size: 14 });
  }
  await page.goto('/pdf-editor');
  const input = page.getByTestId('pdf-upload-input');
  await expect(input).toHaveAttribute('data-editor-ready', 'true', { timeout: 60_000 });
  await input.setInputFiles({ name: 'core-safety.pdf', mimeType: 'application/pdf', buffer: Buffer.from(await pdf.save()) });
  if (waitForCanvas) await expect(page.getByTestId('pdf-tool-select')).toBeEnabled({ timeout: 60_000 });
}

async function openNavigation(page: Page) {
  if (await page.getByTestId('pdf-navigation-panel').getAttribute('aria-hidden') === 'true') {
    await page.getByTestId('pdf-navigation-toggle').click();
  }
}

test('tabs own their arrows and the page field cannot replay stale navigation', async ({ page }) => {
  await openDocument(page);
  await openNavigation(page);
  const tabs = page.getByRole('tab', { name: 'Pages', exact: true });
  await tabs.focus();
  await tabs.press('ArrowRight');
  await expect(page.getByRole('tab', { name: 'Arrange', exact: true })).toBeFocused();
  await expect(page.getByTestId('pdf-page-jump')).toHaveValue('1');
  if (await page.locator('.pe-drawer-scrim').count()) await page.getByTestId('pdf-navigation-panel').getByRole('button', { name: 'Return to page', exact: true }).click();
  const jump = page.getByTestId('pdf-page-jump');
  await jump.fill('2');
  await jump.press('Enter');
  await page.getByTestId('pdf-page-prev').click();
  await expect(jump).toHaveValue('1');
  await jump.focus();
  await jump.press('Tab');
  await expect(jump).toHaveValue('1');
  await jump.fill('invalid');
  await jump.press('Tab');
  await expect(jump).toHaveValue('1');
});

test('a search refresh preserves its selected match and output page', async ({ page }) => {
  await openDocument(page);
  await page.getByTestId('pdf-document-search').fill('SEARCH MARKER');
  await expect(page.locator('.pe-search-meta')).toHaveText('1/3');
  await page.getByRole('button', { name: 'Next search result', exact: true }).click();
  await expect(page.getByTestId('pdf-page-jump')).toHaveValue('2');
  await page.getByTestId('pdf-tool-editText').click();
  await page.getByTestId('pdf-original-text-2-0').fill('REVISED PAGE TWO');
  await expect(page.getByTestId('pdf-save-status')).toContainText('Saved locally');
  await expect(page.locator('.pe-search-meta')).toHaveText('2/3');
  await expect(page.getByTestId('pdf-page-jump')).toHaveValue('2');
  await expect(page.getByTestId('pdf-original-text-2-0')).toHaveValue('REVISED PAGE TWO');
});

test('narrow drawers are exclusive, inert when closed, and insertion panels remain reachable', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await openDocument(page);
  const navigation = page.getByTestId('pdf-navigation-panel');
  const inspector = page.getByTestId('pdf-inspector-panel');
  await expect(navigation).toHaveAttribute('aria-hidden', 'true');
  await expect(inspector).toHaveAttribute('aria-hidden', 'true');
  for (const theme of ['dark', 'light']) {
    await page.evaluate(value => document.documentElement.setAttribute('data-theme', value), theme);
    await page.getByTestId('pdf-navigation-toggle').click();
    await expect(navigation).toBeVisible();
    await page.getByTestId('pdf-inspector-toggle').click();
    await expect(navigation).toHaveAttribute('aria-hidden', 'true');
    await expect(inspector).toBeVisible();
    expect(await navigation.evaluate(element => (element as HTMLElement).inert)).toBe(true);
    await inspector.getByRole('button', { name: 'Return to page', exact: true }).click();
    await page.getByTestId('pdf-commands-open').click();
    await page.getByTestId('pdf-palette-input').fill('Insert image');
    await page.getByRole('option', { name: 'Insert image' }).click();
    await expect(inspector).toBeVisible();
    await expect(navigation).toHaveAttribute('aria-hidden', 'true');
    const bounds = await inspector.boundingBox();
    expect(bounds!.x).toBeGreaterThanOrEqual(0);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(390);
    await page.screenshot({ path: testInfo.outputPath(`core-drawer-${theme}.png`) });
    await inspector.getByRole('button', { name: 'Return to page', exact: true }).click();
    await page.getByTestId('pdf-help-open').click();
    await expect(page.getByTestId('pdf-shortcuts-dialog')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('pdf-help-open')).toBeFocused();
  }
});

for (const failedLayer of ['page', 'fabric'] as const) {
  test(`${failedLayer} initialization failure is bounded and retryable without replacing the document`, async ({ page }) => {
    await page.addInitScript(layer => {
      const state = window as typeof window & { __failEditorCanvas?: boolean };
      state.__failEditorCanvas = true;
      const original = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function(this: HTMLCanvasElement, type: string, options?: unknown) {
        const target = this.dataset.editorLayer === (layer === 'page' ? 'source' : 'objects');
        if (state.__failEditorCanvas && target) return null;
        return original.call(this, type, options);
      } as typeof original;
    }, failedLayer);
    await openDocument(page, false);
    await expect(page.getByTestId('pdf-canvas-failure')).toBeVisible({ timeout: 60_000 });
    await expect(page.getByTestId('pdf-tool-text')).toBeDisabled();
    await page.getByTestId('pdf-commands-open').click();
    await page.getByTestId('pdf-palette-input').fill('Add text box');
    await expect(page.getByRole('option', { name: /Add text box/ })).toBeDisabled();
    await page.keyboard.press('Escape');
    await page.evaluate(() => { (window as typeof window & { __failEditorCanvas?: boolean }).__failEditorCanvas = false; });
    await page.getByTestId('pdf-canvas-retry').click();
    await expect(page.getByTestId('pdf-tool-text')).toBeEnabled({ timeout: 30_000 });
    await expect(page.getByTestId('pdf-canvas-failure')).toHaveCount(0);
    await expect(page.getByTestId('pdf-page-jump')).toHaveValue('1');
  });
}

test('object arrows nudge exactly once instead of also changing the page', async ({ page }, testInfo) => {
  test.skip(['tablet', 'mobile'].includes(testInfo.project.name), 'Geometry inspection is covered on each desktop browser engine.');
  await openDocument(page);
  await page.getByRole('button', { name: 'Shapes', exact: true }).click();
  await page.getByTestId('pdf-tool-rect').click();
  const frame = (await page.locator('.pe-page-frame').boundingBox())!;
  await page.mouse.move(frame.x + frame.width * 0.2, frame.y + frame.height * 0.4);
  await page.mouse.down();
  await page.mouse.move(frame.x + frame.width * 0.45, frame.y + frame.height * 0.55, { steps: 5 });
  await page.mouse.up();
  const x = page.getByTestId('pdf-object-geometry').getByRole('spinbutton', { name: 'X', exact: true });
  const before = Number(await x.inputValue());
  await page.keyboard.press('ArrowRight');
  await expect(x).toHaveValue(String(before + 1));
  await expect(page.getByTestId('pdf-page-jump')).toHaveValue('1');
});

test('preview cancellation cannot publish a late result and retry starts a fresh failed request', async ({ page }) => {
  await openDocument(page);
  await allowServerProcessing(page);
  await page.getByTestId('pdf-tool-editText').click();
  await page.getByTestId('pdf-original-text-1-0').fill('RETRY THIS EDIT');
  let requests = 0;
  let release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/api/pdf-editor/apply-text-edits', async route => {
    if (route.request().method() !== 'POST') return route.continue();
    requests++;
    if (requests === 1) await held;
    await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'Retryable preview failure' }) });
  });
  await page.getByRole('button', { name: 'Preview final PDF', exact: true }).click();
  try {
    await expect.poll(() => requests).toBe(1);
    await page.getByRole('button', { name: 'Cancel preview', exact: true }).click();
    await expect(page.locator('.pe-preview-blocked')).toContainText('Preview cancelled');
  } finally { release(); }
  await expect(page.getByTestId('pdf-processing-status')).not.toContainText('Server processing now');
  await expect(page.getByTestId('pdf-preview-canvas')).not.toHaveAttribute('data-preview-ready', 'true');
  await page.getByRole('button', { name: 'Retry preview', exact: true }).click();
  await expect.poll(() => requests).toBe(2);
  await expect(page.getByTestId('pdf-preview-blocked')).toContainText('Retryable preview failure');
  await page.getByRole('button', { name: 'Close export preview', exact: true }).click();
  await expect(page.getByTestId('pdf-preview-canvas')).toHaveCount(0);
  await expect(page.getByTestId('pdf-original-text-1-0')).toHaveValue('RETRY THIS EDIT');
});

test('final download retains edited text graphics and annotations after page duplication', async ({ page }, testInfo) => {
  test.skip(['tablet', 'mobile'].includes(testInfo.project.name), 'The combined artifact gate runs on each desktop browser engine.');
  await openDocument(page);
  await allowServerProcessing(page);
  await page.getByTestId('pdf-tool-editText').click();
  await page.getByTestId('pdf-original-text-1-0').fill('EDITED TITLE');
  await expect(page.getByTestId('pdf-save-status')).toContainText('Saved locally');
  await page.getByRole('button', { name: 'Shapes', exact: true }).click();
  await page.getByTestId('pdf-tool-rect').click();
  const frame = (await page.locator('.pe-page-frame').boundingBox())!;
  await page.mouse.move(frame.x + frame.width * 0.2, frame.y + frame.height * 0.4);
  await page.mouse.down();
  await page.mouse.move(frame.x + frame.width * 0.45, frame.y + frame.height * 0.55, { steps: 5 });
  await page.mouse.up();
  await expect(page.getByTestId('pdf-page-layers')).not.toContainText('No added objects');
  await page.getByTestId('pdf-tool-annotate').click();
  await page.getByTestId('pdf-annotation-kind-highlight').click();
  await page.getByRole('button', { name: 'Add highlight on "SEARCH MARKER"', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Remove highlight on "SEARCH MARKER"', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.getByTestId('pdf-tool-select').click();
  await expect(page.locator('[data-testid^="pdf-annotation-mark-"]')).toHaveCount(1);
  await expect(page.getByTestId('pdf-page-layers')).not.toContainText('No added objects');
  await openNavigation(page);
  await page.getByRole('tab', { name: 'Arrange', exact: true }).click();
  await page.getByTestId('pdf-organizer-duplicate-1').click();
  const processing = page.waitForResponse(response => response.url().includes('/api/pdf-editor/apply-text-edits') && response.request().method() === 'POST');
  await page.getByTestId('pdf-export-button').click();
  const processed = await processing;
  if (!processed.ok()) throw new Error(`Structural processing returned ${processed.status()}: ${await processed.text()}`);
  await expect(page.getByTestId('pdf-export-impact-dialog')).toBeVisible({ timeout: 60_000 });
  const downloaded = page.waitForEvent('download');
  await page.getByTestId('pdf-export-confirm').click();
  const output = testInfo.outputPath('combined-final.pdf');
  await (await downloaded).saveAs(output);
  const pdf = await pdfjs.getDocument({ data: new Uint8Array(await readFile(output)) }).promise;
  try {
    expect(pdf.numPages).toBe(4);
    for (const number of [1, 2]) {
      const sheet = await pdf.getPage(number);
      const text = (await sheet.getTextContent()).items.map(item => 'str' in item ? item.str : '').join(' ');
      expect(text).toContain('EDITED TITLE');
      expect(text).toContain('SEARCH MARKER');
      expect(text).not.toContain('PAGE 1 TITLE');
      expect((await sheet.getAnnotations()).some(annotation => annotation.subtype === 'Highlight')).toBe(true);
      const operators = await sheet.getOperatorList({ annotationMode: 0 });
      expect(operators.fnArray.filter(operation => operation === pdfjs.OPS.constructPath).length).toBeGreaterThan(0);
    }
  } finally { await pdf.destroy(); }
});
