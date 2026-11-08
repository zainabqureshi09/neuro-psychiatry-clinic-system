import { defineConfig, devices } from '@playwright/test';

/**
 * Browser-level E2E configuration.
 *
 * - Chromium only (installed via `npx playwright install chromium`).
 * - Starts the real Express backend (:5000) and the Next.js frontend (:3000).
 * - Synthetic fixtures are seeded BEFORE this runs (scripts/e2eFixtures.ts), so
 *   the backend's dev auto-seed path never executes (users already exist).
 */
export default defineConfig({
  testDir: './e2e',
  timeout: 90_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [
    ['list'],
    ['json', { outputFile: 'scratch/e2e-results.json' }],
    ['html', { open: 'never', outputFolder: 'scratch/e2e-html' }],
  ],
  use: {
    // Must match the origin Next.js dev expects; 127.0.0.1 gets its HMR and
    // internals blocked as a cross-origin request.
    baseURL: 'http://localhost:3000',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off',
    actionTimeout: 25_000,
    navigationTimeout: 60_000,
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  globalSetup: './e2e/global-setup.ts',
  globalTeardown: './e2e/global-teardown.ts',
  webServer: [
    {
      command: 'npm run backend',
      url: 'http://127.0.0.1:5000/api/health',
      // Force our own instance: a reused stray server would keep its in-memory
      // rate-limit counters and return 429 for login attempts.
      reuseExistingServer: false,
      timeout: 120_000,
      // The auth rate limiter bypasses itself when NODE_ENV=test, which is the
      // documented hook for automated testing. Cookies stay non-secure over
      // http and no production-only guards engage.
      env: { NODE_ENV: 'test' },
    },
    {
      command: 'npm run dev',
      url: 'http://127.0.0.1:3000',
      reuseExistingServer: true,
      timeout: 240_000,
    },
  ],
});
