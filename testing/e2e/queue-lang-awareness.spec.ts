import { test, expect } from '@playwright/test';
import { loginAsDemo } from './helpers/auth.js';

// Playwright E2E for language-aware queue routing.
//
// The current seed (server/seed.ts) uses lang='en' for every user and leaves
// queueLangAwareness unset on partners, so the staffing header doesn't render
// in a fresh environment. This whole spec is gated behind an explicit env-flag
// opt-in (Bundle D / RFC #82) — match the pattern used by sla-flow's
// E2E_INCLUDE_SLA_LIFECYCLE branch. To exercise locally:
//   1. Edit a partner via Platform → EditPartnerModal, toggle
//      `queueLangAwareness` on.
//   2. Flip a support user's `lang` to 'fr' and seed an 'nl' waiting ticket.
//   3. Run with `E2E_INCLUDE_QUEUE_LANG_AWARENESS=1 npx playwright test ...`

test.describe('Language-aware queue routing', () => {
  test.skip(
    !process.env.E2E_INCLUDE_QUEUE_LANG_AWARENESS,
    'queueLangAwareness is feature-flag-gated; set E2E_INCLUDE_QUEUE_LANG_AWARENESS=1 to opt in',
  );

  test('staffing header renders per-lang columns when enabled', async ({ page }) => {
    const login = await loginAsDemo(page, 'support_lucas');
    if (!login.ok) {
      throw new Error(
        `Fixture user 'support_lucas' failed to log in (status ${login.status}). ` +
          'Check server/seed.ts — this is a test setup bug, not a skip condition.',
      );
    }
    await page.waitForURL('**/support', { timeout: 10_000 }).catch(() => {});

    const header = page.locator('[data-staffing-lang]').first();
    await expect(header).toBeVisible({ timeout: 10_000 });
    await expect(header).toHaveAttribute('data-imbalance', /ok|thin|critical/);
  });

  test('clicking a staffing column filters the ticket list to that language', async ({ page }) => {
    const login = await loginAsDemo(page, 'support_lucas');
    if (!login.ok) {
      throw new Error(
        `Fixture user 'support_lucas' failed to log in (status ${login.status}). ` +
          'Check server/seed.ts — this is a test setup bug, not a skip condition.',
      );
    }
    await page.waitForURL('**/support', { timeout: 10_000 }).catch(() => {});

    const nlColumn = page.locator('[data-staffing-lang="nl"]');
    await expect(nlColumn).toBeVisible({ timeout: 10_000 });
    await nlColumn.click();

    const badges = page.locator('[data-lang-badge]');
    const count = await badges.count();
    for (let i = 0; i < count; i++) {
      await expect(badges.nth(i)).toHaveAttribute('data-lang-badge', 'nl');
    }
  });

  test('opening a cross-lang queued ticket surfaces the banner', async ({ page }) => {
    const login = await loginAsDemo(page, 'support_lucas');
    if (!login.ok) {
      throw new Error(
        `Fixture user 'support_lucas' failed to log in (status ${login.status}). ` +
          'Check server/seed.ts — this is a test setup bug, not a skip condition.',
      );
    }
    await page.waitForURL('**/support', { timeout: 10_000 }).catch(() => {});

    const staffingHeader = page.locator('[data-staffing-lang]').first();
    await expect(staffingHeader).toBeVisible({ timeout: 10_000 });

    const row = page.locator('[data-ticket-row][data-ticket-variant="queue"]').first();
    await expect(row).toBeVisible({ timeout: 10_000 });

    const rowLang = await row.locator('[data-lang-badge]').getAttribute('data-lang-badge');
    if (!rowLang || rowLang === 'en') {
      throw new Error(
        'Queued ticket is same-lang as support viewer (en/en); cannot exercise cross-lang banner. ' +
          'Seed an nl/fr queued ticket per the file-level instructions.',
      );
    }

    await row.click();
    const banner = page.locator('[data-cross-lang-banner]');
    await expect(banner).toBeVisible({ timeout: 5_000 });
    await expect(banner).toContainText(rowLang.toUpperCase());
  });
});
