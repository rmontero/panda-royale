// End-to-end UI tests for both game modes.
//
// Runs the real static app in a browser. Pass-and-play is fully client-side and
// needs no backend. The online (separate-phones) flow needs the /api functions,
// so it is only exercised when a base URL with a live backend is provided.
//
// SETUP (once):
//   npm i -D @playwright/test && npx playwright install chromium
//
// RUN (pass-and-play only, no backend needed):
//   npx playwright test tests/e2e.spec.mjs
//   # serves index.html on a local static server automatically (see webServer)
//
// RUN (including online flow, against a deployed backend):
//   E2E_BASE_URL=https://www.pnd.ad npx playwright test tests/e2e.spec.mjs
//
// This file is config-in-spec via test.use; if you prefer a playwright.config,
// point testDir here and drop the webServer block.

import { test, expect, devices } from '@playwright/test';

const BASE = process.env.E2E_BASE_URL || 'http://127.0.0.1:8799';
const ONLINE = !!process.env.E2E_BASE_URL; // online flow only when a real backend is given

test.use({ ...devices['Pixel 7'] }); // a phone viewport — this app lives on a phone

/* ------------------------------------------------------------------ *
 * Pass-and-play (One shared phone) — 100% client-side
 * ------------------------------------------------------------------ */
test.describe('Pass and Play', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => { try { localStorage.clear(); } catch {} });
    await page.goto(BASE + '/');
  });

  test('start, add players, enter round 1, dice-count validation, scoreboard', async ({ page }) => {
    // Home: two mode cards, no manual code-join field
    await expect(page.getByText('Pass and Play')).toBeVisible();
    await expect(page.locator('#codeInput')).toHaveCount(0);

    // Start pass-and-play
    await page.getByRole('button', { name: /Pass and Play/i }).click();

    // Add two players
    await page.locator('#addPlayer').fill('Ada');
    await page.getByRole('button', { name: /^Add$/ }).click();
    await page.locator('#addPlayer').fill('Grace');
    await page.getByRole('button', { name: /^Add$/ }).click();
    await expect(page.getByText('Ada')).toBeVisible();
    await expect(page.getByText('Grace')).toBeVisible();

    // Enter dice for the first player (round 1 = single yellow die)
    await page.getByRole('button', { name: /Enter dice/i }).first().click();
    // yellow accordion open by default; type a value
    const yellowInput = page.locator('.dexpand .acc-ins input').first();
    await yellowInput.fill('5');
    // round score reads "Round 1 score: 5"
    await expect(page.locator('.round-row .rr-total')).toHaveText('5');
    await page.getByRole('button', { name: /Save round/i }).click();
    // back on lobby, that player shows a check + score
    await expect(page.locator('.player-row .pill-btn.done').first()).toContainText('5');

    // Scoreboard shows both players
    await page.getByRole('button', { name: /Menu/i }).click();
    await page.getByRole('button', { name: /Scoreboard/i }).click();
    await expect(page.locator('table.board')).toBeVisible();
    await expect(page.getByText('Ada')).toBeVisible();
  });

  test('round-1 rejects a non-yellow die (hard stop)', async ({ page }) => {
    await page.getByRole('button', { name: /Pass and Play/i }).click();
    await page.locator('#addPlayer').fill('Ada');
    await page.getByRole('button', { name: /^Add$/ }).click();
    await page.getByRole('button', { name: /Enter dice/i }).first().click();
    // open purple and enter a value (illegal in round 1)
    await page.getByRole('button', { name: 'Purple' }).click();
    await page.locator('.dexpand .acc-ins input').first().fill('3');
    await page.getByRole('button', { name: /Save round/i }).click();
    // a toast complains and we stay on the entry screen (not saved)
    await expect(page.locator('.toast')).toBeVisible();
    await expect(page.locator('.round-row')).toBeVisible();
  });

  test('caps at 10 players — add controls disappear', async ({ page }) => {
    await page.getByRole('button', { name: /Pass and Play/i }).click();
    for (let i = 1; i <= 10; i++) {
      await page.locator('#addPlayer').fill('P' + i);
      await page.getByRole('button', { name: /^Add$/ }).click();
    }
    await expect(page.locator('#addPlayer')).toHaveCount(0);
  });
});

/* ------------------------------------------------------------------ *
 * Online (Separate phones) — needs the /api backend
 * ------------------------------------------------------------------ */
test.describe('Online', () => {
  test.skip(!ONLINE, 'set E2E_BASE_URL to a deployment with a live backend to run the online flow');

  test('host creates a game, sees code + QR; a second device joins and both appear', async ({ browser }) => {
    // Host
    const host = await browser.newContext({ ...devices['Pixel 7'] });
    const hostPage = await host.newPage();
    await hostPage.addInitScript(() => { try { localStorage.clear(); } catch {} });
    await hostPage.goto(BASE + '/');
    await hostPage.locator('#nameInput').fill('Host');
    await hostPage.getByRole('button', { name: /^Online/ }).click();

    // code + QR shown on the initial screen
    await expect(hostPage.locator('.code-big')).toBeVisible();
    await expect(hostPage.locator('.qr-wrap svg.qr')).toBeVisible();
    const code = (await hostPage.locator('.code-big').innerText()).trim();
    expect(code).toMatch(/^[A-Z0-9]{4}$/);

    // Joiner (fresh device) joins via ?code= deep link, gives its own name
    const joiner = await browser.newContext({ ...devices['Pixel 7'] });
    const joinPage = await joiner.newPage();
    await joinPage.addInitScript(() => { try { localStorage.clear(); } catch {} });
    await joinPage.goto(BASE + '/?code=' + code);
    // name field shown (unknown name); enter and join
    await joinPage.locator('#nameInput').fill('Guest');
    await joinPage.getByRole('button', { name: /^Online/ }).click();

    // Host sees the joiner appear (polling)
    await expect(hostPage.getByText('Guest')).toBeVisible({ timeout: 8000 });

    await host.close();
    await joiner.close();
  });
});
