import { defineConfig, devices } from '@playwright/test';

// End-to-end tests run against a production build served by `vite preview`,
// with the same base path GitHub Pages uses, so service worker scope, CSP and
// asset paths are exercised as deployed.
const base = process.env.ROGUE_ARCHIVE_BASE ?? '/rogue_archive/';
const port = 4173;

export default defineConfig({
  testDir: 'e2e',
  timeout: 90_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: `http://localhost:${port}${base}`,
    trace: 'off',
  },
  projects: [
    { name: 'desktop-chromium', use: { ...devices['Desktop Chrome'] }, testIgnore: /mobile\.spec/ },
    { name: 'mobile-chromium', use: { ...devices['Pixel 7'] }, testMatch: /mobile\.spec/ },
  ],
  webServer: {
    command: `pnpm --filter @rogue-archive/web exec vite preview --port ${port} --strictPort`,
    url: `http://localhost:${port}${base}`,
    reuseExistingServer: !process.env.CI,
    env: { ROGUE_ARCHIVE_BASE: base },
  },
});
