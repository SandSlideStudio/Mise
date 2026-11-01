import { defineConfig, devices } from '@playwright/test';

/**
 * The browser tests: the built app, run the way a kitchen runs it, driven in
 * Chromium. They share one database and one server, so they run one at a
 * time, in file order. `npm run test:e2e`; e2e/server.mjs says what it needs.
 */

export const PORT = Number(process.env.E2E_PORT ?? 3210);
export const HTTPS_PORT = PORT + 433;

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  use: {
    // localhost counts as secure, so the service worker runs as over HTTPS.
    baseURL: `http://localhost:${PORT}`,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'node e2e/server.mjs',
    url: `http://localhost:${PORT}/api/health`,
    reuseExistingServer: false,
    timeout: 120_000,
    stdout: 'ignore',
    stderr: 'pipe',
    env: { E2E_PORT: String(PORT), E2E_HTTPS_PORT: String(HTTPS_PORT) },
  },
});
