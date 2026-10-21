import { defineConfig, devices } from '@playwright/test';

const externalBaseUrl = process.env.PLAYWRIGHT_BASE_URL;
const baseURL = externalBaseUrl ?? 'http://127.0.0.1:3100';
const appDirectory = __dirname;

export default defineConfig({
  testDir: './tests/pdf-editor',
  testMatch: '**/*.spec.ts',
  outputDir: 'test-results/pdf-editor',
  fullyParallel: false,
  // The preservation workflow intentionally performs PDF parsing, IndexedDB
  // recovery, server-side structural editing, download, and independent reopen
  // verification. Keep assertion timeouts focused while giving the complete
  // transaction a realistic budget on cold CI workers.
  timeout: 120_000,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? [['line'], ['html', { open: 'never' }]] : 'line',
  use: {
    baseURL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  expect: {
    toHaveScreenshot: { animations: 'disabled', caret: 'hide', maxDiffPixelRatio: 0.015 },
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], browserName: 'chromium', viewport: { width: 1440, height: 1000 } } },
    { name: 'tablet', use: { ...devices['iPad (gen 7) landscape'], browserName: 'chromium' } },
    { name: 'mobile', use: { ...devices['iPhone 13'], browserName: 'chromium' } },
  ],
  webServer: externalBaseUrl ? undefined : {
    command: 'npm run dev -- --hostname 127.0.0.1 --port 3100',
    cwd: appDirectory,
    env: {
      NEXT_DIST_DIR: '.next-pdf-editor-e2e',
    },
    url: `${baseURL}/pdf-editor`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
