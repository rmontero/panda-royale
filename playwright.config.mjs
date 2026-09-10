// Playwright config for the E2E UI tests (tests/e2e.spec.mjs).
//   npm i -D @playwright/test && npx playwright install chromium
//   npm run test:e2e
//
// For the pass-and-play flow it auto-serves index.html on 127.0.0.1:8799.
// For the online flow, pass a real backend: E2E_BASE_URL=https://www.pnd.ad
import { defineConfig, devices } from '@playwright/test';

const usingExternal = !!process.env.E2E_BASE_URL;

export default defineConfig({
  testDir: './tests',
  testMatch: /e2e\.spec\.mjs$/,
  timeout: 30_000,
  use: { ...devices['Pixel 7'], baseURL: process.env.E2E_BASE_URL || 'http://127.0.0.1:8799' },
  // Only spin up the static server when testing locally (pass-and-play).
  webServer: usingExternal ? undefined : {
    command: 'python3 -m http.server 8799 --bind 127.0.0.1',
    url: 'http://127.0.0.1:8799/index.html',
    reuseExistingServer: true,
    timeout: 10_000,
  },
});
