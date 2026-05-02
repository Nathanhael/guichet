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
 *   - Seeded `platform_bart` operator (used by partnerFixture for bootstrap auth)
 */

import { test, expect } from './helpers/partnerFixture';
import type { Page } from '@playwright/test';

const BASE = process.env.E2E_BASE_URL || 'http://localhost:3001';

async function waitForApp(page: Page) {
  await page.goto(BASE);
  await page.waitForLoadState('load');
  await page.waitForSelector('h1', { timeout: 15000 });
  await page.locator('button').first().waitFor({ state: 'visible', timeout: 10000 });
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

  // Migrated to partnerFixture (#117): a fresh fixture user has no
  // external_id and no `lang_synced_from_sso` flag, so the badge state
  // is deterministic regardless of what other parallel specs do to seed
  // users. Replaces the previous fixme that pointed at Lucas-the-shared-seed.
  test('non-SSO user sees no "SYNCED FROM SSO" badge', async ({ page, partnerFixture }) => {
    const { userId } = await partnerFixture.createUser({ role: 'support', lang: 'en' });
    await partnerFixture.loginAs(userId, { waitFor: 'networkidle' });

    // Phase 9 chrome unification: the LanguageSwitcher renders inside the
    // UserMenuChip dialog; legacy SettingsPopover trigger is gone.
    await page.locator('button[aria-haspopup="dialog"]').first().click();

    await expect(page.getByText(/synced from sso/i)).toHaveCount(0);
    // Native-language buttons still render for local users.
    await expect(page.getByRole('button', { name: /^english$/i })).toBeVisible();
  });

  test('manual language pick persists across logout', async ({ page, partnerFixture }) => {
    const { userId } = await partnerFixture.createUser({ role: 'support', lang: 'en' });
    await partnerFixture.loginAs(userId, { waitFor: 'networkidle' });

    // Open user menu chip, pick Nederlands. waitForResponse closes the
    // inherent race between the click (which fires `user.setLocale` in the
    // background) and the getLocaleInfo query — without it, the query can
    // read stale data on a slow server.
    await page.locator('button[aria-haspopup="dialog"]').first().click();
    const setLocaleResponse = page.waitForResponse((res) =>
      res.url().includes('/api/v1/trpc/user.setLocale') && res.ok(),
    );
    await page.getByRole('button', { name: /^nederlands$/i }).click();
    await setLocaleResponse;

    // getLocaleInfo now returns lang='nl'.
    const info = await page.request.get(`${BASE}/api/v1/trpc/user.getLocaleInfo`, {
      params: { input: JSON.stringify({ json: null }) },
    });
    expect(info.status()).toBe(200);
    const payload = await info.json();
    expect(payload.result.data.lang).toBe('nl');

    // No restore step needed — fresh fixture user is dropped in teardown.
  });
});
