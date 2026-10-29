import { defineConfig, devices } from '@playwright/test';

const externalBaseUrl = process.env.PLAYWRIGHT_BASE_URL;
// Next's development proxy uses localhost in Request.url. Match its origin
// instead of weakening the shared credit endpoint's same-origin validation.
const baseURL = externalBaseUrl ?? 'http://localhost:3100';
const appDirectory = __dirname;
const rollout = process.env.PDF_EDITOR_TEST_ROLLOUT === 'off';
if (rollout && !externalBaseUrl) throw new Error('Rollout verification requires PLAYWRIGHT_BASE_URL pointing to a production build.');

export default defineConfig({
  testDir: './tests/pdf-editor',
  testMatch: rollout ? '**/rollout.spec.ts' : '**/*.spec.ts',
  testIgnore: rollout ? undefined : '**/rollout.spec.ts',
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
    {
      name: 'firefox',
      testMatch: rollout ? '**/rollout.spec.ts' : ['**/core-safety.spec.ts', '**/intake.spec.ts', '**/local-first.spec.ts'],
      use: { ...devices['Desktop Firefox'], browserName: 'firefox', viewport: { width: 1440, height: 1000 } },
    },
    {
      name: 'webkit',
      testMatch: rollout ? '**/rollout.spec.ts' : ['**/core-safety.spec.ts', '**/intake.spec.ts', '**/local-first.spec.ts'],
      use: { ...devices['Desktop Safari'], browserName: 'webkit', viewport: { width: 1440, height: 1000 } },
    },
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
