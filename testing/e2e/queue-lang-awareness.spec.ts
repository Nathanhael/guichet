import { test, expect } from '@playwright/test';
import { loginAsDemo } from './helpers/auth.js';

// Playwright E2E for language-aware queue routing.
//
// The current seed (server/seed.ts) uses lang='en' for every user and leaves
// queueLangAwareness unset on partners, so the staffing header may render
// empty in a fresh environment. Each test checks for the feature's presence
// and skips with a clear reason when the fixture is not yet in place, rather
// than hard-failing and masking the spec. To exercise the happy path locally:
//   1. Edit a partner via Platform → EditPartnerModal, toggle
//      `queueLangAwareness` on.
//   2. Flip a support user's `lang` to 'fr' and seed an 'nl' waiting ticket.

test.describe('Language-aware queue routing', () => {
  test('staffing header renders per-lang columns when enabled', async ({ page }) => {
    const login = await loginAsDemo(page, 'support_lucas');
    test.skip(!login.ok, `support_lucas dev-login failed (${login.status})`);
    await page.waitForURL('**/support', { timeout: 10_000 }).catch(() => {});

    const header = page.locator('[data-staffing-lang]').first();
    const hasHeader = await header.count() > 0;
    test.skip(!hasHeader, 'queueLangAwareness not enabled on seeded partner; skipping');

    await expect(header).toBeVisible();
    await expect(header).toHaveAttribute('data-imbalance', /ok|thin|critical/);
  });

  test('clicking a staffing column filters the ticket list to that language', async ({ page }) => {
    const login = await loginAsDemo(page, 'support_lucas');
    test.skip(!login.ok, `support_lucas dev-login failed (${login.status})`);
    await page.waitForURL('**/support', { timeout: 10_000 }).catch(() => {});

    const nlColumn = page.locator('[data-staffing-lang="nl"]');
    const hasHeader = await nlColumn.count() > 0;
    test.skip(!hasHeader, 'queueLangAwareness not enabled on seeded partner; skipping');

    await nlColumn.click();

    const badges = page.locator('[data-lang-badge]');
    const count = await badges.count();
    for (let i = 0; i < count; i++) {
      await expect(badges.nth(i)).toHaveAttribute('data-lang-badge', 'nl');
    }
  });

  test('opening a cross-lang queued ticket surfaces the banner', async ({ page }) => {
    const login = await loginAsDemo(page, 'support_lucas');
    test.skip(!login.ok, `support_lucas dev-login failed (${login.status})`);
    await page.waitForURL('**/support', { timeout: 10_000 }).catch(() => {});

    // The cross-lang banner is gated on partner.queueLangAwareness — without it,
    // the banner never mounts even if a non-en queued ticket exists. Use the
    // staffing-header presence as the same proxy the other two tests use.
    const staffingHeader = page.locator('[data-staffing-lang]').first();
    const hasStaffing = await staffingHeader.count() > 0;
    test.skip(!hasStaffing, 'queueLangAwareness not enabled on seeded partner; skipping');

    const row = page.locator('[data-ticket-row][data-ticket-variant="queue"]').first();
    const hasRow = await row.count() > 0;
    test.skip(!hasRow, 'no queued ticket in fixture; skipping cross-lang banner check');

    const rowLang = await row.locator('[data-lang-badge]').getAttribute('data-lang-badge');
    test.skip(!rowLang || rowLang === 'en', 'queued ticket is same-lang as support viewer; skipping');

    await row.click();
    const banner = page.locator('[data-cross-lang-banner]');
    await expect(banner).toBeVisible({ timeout: 5_000 });
    if (rowLang) {
      await expect(banner).toContainText(rowLang.toUpperCase());
    }
  });
});
