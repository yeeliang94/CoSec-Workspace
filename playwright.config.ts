import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests/e2e',
  workers: 1,
  timeout: 60000,
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://127.0.0.1:4300',
    // Playwright's own Chromium, so test runs never start the owner's Google Chrome.
    headless: true,
    trace: 'retain-on-failure',
  },
  reporter: 'list',
});
