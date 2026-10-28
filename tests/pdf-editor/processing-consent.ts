import { expect, type Page } from '@playwright/test';

/** Explicit privacy approval only. Never accepts export-impact or redaction dialogs. */
export async function allowServerProcessing(page: Page) {
  await page.getByTestId('pdf-processing-review').click();
  await expect(page.getByTestId('pdf-processing-dialog')).toBeVisible();
  await page.getByTestId('pdf-processing-confirm').click();
  await expect(page.getByTestId('pdf-processing-dialog')).toHaveCount(0);
}
