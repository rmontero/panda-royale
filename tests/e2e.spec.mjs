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

  test('start, add players, enter round 1, scoreboard', async ({ page }) => {
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
    // roster names (scoped to .player-row .name to avoid the "hand to X" button)
    await expect(page.locator('.player-row .name', { hasText: 'Ada' })).toBeVisible();
    await expect(page.locator('.player-row .name', { hasText: 'Grace' })).toBeVisible();

    // Enter dice for the first player (round 1 = single yellow die)
    await page.getByRole('button', { name: /Enter dice/i }).first().click();
    const yellowInput = page.locator('.dexpand .acc-ins input').first();
    await yellowInput.fill('5');
    await expect(page.locator('.round-row .rr-total')).toHaveText('5');
    await page.getByRole('button', { name: /Save round/i }).click();
    // back on lobby, one player shows a check + score
    await expect(page.locator('.player-row .pill-btn.done').first()).toContainText('5');

    // Scoreboard shows the roster
    await page.getByRole('button', { name: /Menu/i }).click();
    await page.getByRole('button', { name: /Scoreboard/i }).click();
    await expect(page.locator('table.board')).toBeVisible();
    await expect(page.locator('table.board').getByText('Ada')).toBeVisible();
  });

  test('round-1 rejects too many dice (hard stop)', async ({ page }) => {
    await page.getByRole('button', { name: /Pass and Play/i }).click();
    await page.locator('#addPlayer').fill('Ada');
    await page.getByRole('button', { name: /^Add$/ }).click();
    await page.getByRole('button', { name: /Enter dice/i }).first().click();
    // round 1 shows yellow only; entering TWO yellow values is too many
    await page.locator('.dexpand .acc-ins input').first().fill('5 6');
    await page.getByRole('button', { name: /Save round/i }).click();
    // hard stop: a toast complains and we stay on the entry screen (not saved)
    await expect(page.locator('.toast')).toBeVisible();
    await expect(page.locator('.round-row')).toBeVisible();
  });

  test('caps at 10 players — add controls disappear', async ({ page }) => {
    await page.getByRole('button', { name: /Pass and Play/i }).click();
    for (let i = 1; i <= 10; i++) {
      await page.locator('#addPlayer').fill('P' + i);
      await page.getByRole('button', { name: /^Add$/ }).click();
      // wait for this add to land before the next (tolerant of boot re-renders)
      await expect(page.locator('.player-row .name')).toHaveCount(i, { timeout: 8000 });
    }
    // cap reached: exactly 10 players and the add-player input is gone
    await expect(page.locator('.player-row .name')).toHaveCount(10);
    await expect(page.locator('#addPlayer')).toHaveCount(0);
  });

  test('keyboard: Tab opens next color, Shift+Tab opens previous', async ({ page }) => {
    // one player; bump to round 2 (via the round stepper) where every color is
    // enterable and the accordion holds multiple colors.
    await page.getByRole('button', { name: /Pass and Play/i }).click();
    await page.locator('#addPlayer').fill('Ada');
    await page.getByRole('button', { name: /^Add$/ }).click();
    await page.locator('[data-a="round-next"]').click(); // round 1 → 2

    // round 2: entry opens with the first color already expanded
    await page.getByRole('button', { name: /Enter dice/i }).first().click();
    const openColor = () => page.locator('.dexpand .acc-lab').innerText();
    const firstColor = await openColor();

    // FORWARD: Tab advances to the next color and focuses its first input
    await page.locator('.dexpand .acc-ins input').first().focus();
    await page.keyboard.press('Tab');
    const secondColor = await openColor();
    expect(secondColor).not.toBe(firstColor);
    await expect(page.locator('.dexpand .acc-ins input').first()).toBeFocused();

    // BACKWARD: Shift+Tab from the (single-input) second color reopens the first
    await page.keyboard.press('Shift+Tab');
    expect(await openColor()).toBe(firstColor);
    await expect(page.locator('.dexpand .acc-ins input').last()).toBeFocused();

    // From the first color, Tab through every color/input in turn; the step
    // that leaves the last input lands focus on the Save button. Stop as soon
    // as Save is focused (further Tabs would hand off to native tab order).
    await page.locator('.dexpand .acc-ins input').first().focus();
    const save = page.getByRole('button', { name: /Save round/i });
    let landed = false;
    for (let i = 0; i < 30; i++) {
      await page.keyboard.press('Tab');
      if (await save.evaluate(el => el === document.activeElement)) { landed = true; break; }
    }
    expect(landed).toBe(true);
  });

  test('validation: out-of-range value dropped on blur; Save focus validates the round', async ({ page }) => {
    await page.getByRole('button', { name: /Pass and Play/i }).click();
    await page.locator('#addPlayer').fill('Ada');
    await page.getByRole('button', { name: /^Add$/ }).click();
    await page.locator('[data-a="round-next"]').click(); // round 2 (every color enterable)
    await page.getByRole('button', { name: /Enter dice/i }).first().click();

    // BLUR (via Tab): yellow max is 8 — entering 99 is out of range. Tabbing
    // off the field validates it: toasts and drops the bad value.
    const yellow = page.locator('.dexpand .acc-ins input').first();
    await yellow.click();
    await yellow.fill('99');
    await page.keyboard.press('Tab'); // leaves yellow → blur validation runs
    await expect(page.locator('.toast')).toBeVisible();
    // come back to yellow: the out-of-range value was tidied away
    await page.keyboard.press('Shift+Tab');
    await expect(page.locator('.dexpand .acc-ins input').first()).toHaveValue('');

    // SAVE FOCUS validates the whole round: enter one valid value then focus
    // Save. Round 2 needs more dice than one, so the early warning fires.
    await yellow.click();
    await yellow.fill('4');
    await page.getByRole('button', { name: /Save round/i }).focus();
    await expect(page.locator('.toast')).toBeVisible();
    // still on entry — the early warning saved nothing
    await expect(page.locator('.round-row')).toBeVisible();
  });
});

/* ------------------------------------------------------------------ *
 * Online (Separate phones) — needs the /api backend
 *
 * On a deployment where online play is paywalled (config:flags
 * onlinePaywalled=true), the create flow needs a Pro code. Provide one via
 * E2E_PRO_CODE to exercise the full create→join flow; otherwise the test
 * asserts the CORRECT gated behavior (clicking Online opens the upgrade screen).
 * ------------------------------------------------------------------ */
test.describe('Online', () => {
  test.skip(!ONLINE, 'set E2E_BASE_URL to a deployment with a live backend to run the online flow');

  test('online gating + (with a Pro code) create → code+QR → second device joins', async ({ browser, request }) => {
    const flags = await (await request.get(BASE + '/api/flags')).json().catch(() => ({}));
    const gated = !!(flags.paywallEnabled && flags.onlinePaywalled);
    const proCode = process.env.E2E_PRO_CODE || null;

    const host = await browser.newContext({ ...devices['Pixel 7'] });
    const hostPage = await host.newPage();
    await hostPage.addInitScript((code) => {
      try { localStorage.clear(); if (code) localStorage.setItem('pr.pro', JSON.stringify({ code })); } catch {}
    }, proCode);
    await hostPage.goto(BASE + '/');
    await hostPage.locator('#nameInput').fill('Host');
    await hostPage.getByRole('button', { name: /^Online/ }).click();

    if (gated && !proCode) {
      // correct gated behavior: routed to the upgrade screen, no lobby/code
      await expect(hostPage.getByText(/Panda Royale Pro|Unlock Pro|Pro code/i).first()).toBeVisible();
      await expect(hostPage.locator('.code-big')).toHaveCount(0);
      await host.close();
      test.info().annotations.push({ type: 'note', description: 'online is paywalled; set E2E_PRO_CODE to test the full create/join flow' });
      return;
    }

    // free (or Pro): full create → code + QR → join
    await expect(hostPage.locator('.code-big')).toBeVisible();
    await expect(hostPage.locator('.qr-wrap svg.qr')).toBeVisible();
    const code = (await hostPage.locator('.code-big').innerText()).trim();
    expect(code).toMatch(/^[A-Z0-9]{4}$/);

    const joiner = await browser.newContext({ ...devices['Pixel 7'] });
    const joinPage = await joiner.newPage();
    await joinPage.addInitScript(() => { try { localStorage.clear(); } catch {} });
    await joinPage.goto(BASE + '/?code=' + code);
    await joinPage.locator('#nameInput').fill('Guest');
    await joinPage.getByRole('button', { name: /^Online/ }).click();

    await expect(hostPage.locator('.player-row .name', { hasText: 'Guest' })).toBeVisible({ timeout: 8000 });

    await host.close();
    await joiner.close();
  });
});
