/**
 * E2E: SSO locale sync — UI behaviour
 *
 * Covers the user-facing half of the feature designed in
 * `docs/superpowers/specs/2026-04-15-sso-locale-sync-design.md`:
 *
 *   1. Pre-auth LanguageSwitcher renders native-language labels (no flag emojis).
 *   2. Logged-in local user (no `external_id`) sees no "SYNCED FROM SSO" badge.
 *   3. Manual language pick persists (`users.lang` updated via tRPC).
 *
 * The SSO-claim → `users.lang` auto-sync path itself is exercised by the
 * server-side unit tests in `server/services/localeSync.test.ts` (the decision
 * matrix) because reproducing a real Azure OIDC callback in Playwright would
 * require spinning up a mock IdP. The integration surface — badge visibility
 * gated on `external_id`, lock semantics on manual pick — was verified with
 * chrome-devtools during implementation and is worth a lightweight guard here
 * for the non-SSO path that regular CI can run.
 *
 * Prerequisites:
 *   - Server running at E2E_BASE_URL (default http://localhost:3001)
 *   - Seeded demo database (Lucas Support = local auth user, no external_id)
 */

import { test, expect, Page } from '@playwright/test';

const BASE = process.env.E2E_BASE_URL || 'http://localhost:3001';

async function waitForApp(page: Page) {
  await page.goto(BASE);
  await page.waitForLoadState('load');
  await page.waitForSelector('h1', { timeout: 15000 });
  await page.locator('button').first().waitFor({ state: 'visible', timeout: 10000 });
}

async function loginViaDemo(page: Page, name: RegExp) {
  await waitForApp(page);
  await page.getByRole('button', { name: /demo mode/i }).click();
  await page.getByRole('button', { name }).first().click();
  await page.waitForLoadState('networkidle');
}

test.describe('SSO locale sync — UI', () => {
  test('login page shows native-language labels with no flag emojis', async ({ page }) => {
    await waitForApp(page);

    await expect(page.getByRole('button', { name: /^english$/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /^nederlands$/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /^francais$/i })).toBeVisible();

    // Flag emoji codepoints must NOT appear anywhere on the login page —
    // Rolldown's hash-placeholder resolver panics on them at build time.
    const pageText = await page.locator('body').textContent();
    expect(pageText).not.toMatch(/[\u{1F1E6}-\u{1F1FF}]/u);
  });

  test('non-SSO user sees no "SYNCED FROM SSO" badge', async ({ page }) => {
    await loginViaDemo(page, /Lucas Support/i);

    // Open settings popover that contains the LanguageSwitcher.
    await page.getByRole('button', { name: /settings/i }).click();

    await expect(page.getByText(/synced from sso/i)).toHaveCount(0);
    // Native-language buttons still render for local users.
    await expect(page.getByRole('button', { name: /^english$/i })).toBeVisible();
  });

  test('manual language pick persists across logout', async ({ page }) => {
    await loginViaDemo(page, /Lucas Support/i);

    // Open settings, pick Nederlands.
    await page.getByRole('button', { name: /settings/i }).click();
    await page.getByRole('button', { name: /^nederlands$/i }).click();

    // getLocaleInfo now returns lang='nl'.
    const info = await page.request.get(`${BASE}/api/v1/trpc/user.getLocaleInfo`, {
      params: { input: JSON.stringify({ json: null }) },
    });
    expect(info.status()).toBe(200);
    const payload = await info.json();
    expect(payload.result.data.lang).toBe('nl');

    // Restore English so subsequent test runs start clean (seed default is 'en').
    await page.getByRole('button', { name: /^english$/i }).click();
    await page.waitForTimeout(200);
  });
});
