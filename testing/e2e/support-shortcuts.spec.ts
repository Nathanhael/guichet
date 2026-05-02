/**
 * E2E: SupportView Tier-1 keyboard shortcuts
 *
 * Verifies:
 *  - Ctrl+K opens the command palette.
 *  - Palette's shortcut-hint column shows the new Tier-1 bindings.
 *  - Ctrl+Enter triggers the close-ticket confirmation modal when a ticket is open.
 *
 * Prerequisites:
 *   - Server running at E2E_BASE_URL (default http://localhost:3001)
 *   - Seeded demo database (support_lucas)
 */

import { test, expect } from './helpers/fixtures';
import { test as partnerTest, expect as partnerExpect } from './helpers/partnerFixture';
import { loginAsDemo } from './helpers/auth';

test.describe('SupportView keyboard shortcuts', () => {
  test('Ctrl+K opens the palette and Tier-1 hints are visible', async ({ page }) => {
    await loginAsDemo(page, 'support_lucas');

    // Wait for SupportView to mount before pressing Ctrl+K — UserMenuChip
    // is the stable nav anchor since the Phase 9 chrome unification dropped
    // the visible command-palette trigger button (palette is hotkey-only).
    await expect(page.locator('button[aria-haspopup="dialog"]').first()).toBeVisible({ timeout: 15000 });

    // Dispatching the keydown via the DOM avoids Playwright/Chrome
    // shortcut-capture quirks (Ctrl+K routes to the browser's address bar
    // under some conditions in headless chromium).
    await page.evaluate(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, bubbles: true }));
    });

    // Locale-flexible match: EN "Command Palette" / FR "Palette de commandes" /
    // NL "Opdrachtenpalet".
    const palette = page.getByRole('dialog', { name: /palette|command|opdracht/i });
    await expect(palette).toBeVisible();

    // Hints that are always visible (no-ticket-required commands). Match by
    // key-binding tail rather than localized command labels.
    await expect(palette.getByRole('button', { name: /ctrl\+b/i })).toBeVisible();
    await expect(palette.getByRole('button', { name: /ctrl\+shift\+f/i })).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(palette).toBeHidden();
  });

  test('palette shows always-visible Tier-2 shortcut hints', async ({ page }) => {
    await loginAsDemo(page, 'support_lucas');
    await expect(page.locator('button[aria-haspopup="dialog"]').first()).toBeVisible({ timeout: 15000 });

    await page.evaluate(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, bubbles: true }));
    });

    const palette = page.getByRole('dialog', { name: /palette|command|opdracht/i });
    await expect(palette).toBeVisible();

    // Tier-2 bindings that don't require an active ticket. Match by binding
    // tail (locale-independent). Open-status-picker = Ctrl+. ;
    // Toggle-customer-info = Ctrl+Shift+C (post-Phase-9 — was Ctrl+Shift+A).
    await expect(palette.getByRole('button', { name: /ctrl\+\./i })).toBeVisible();
    await expect(palette.getByRole('button', { name: /ctrl\+shift\+c/i })).toBeVisible();
  });
});

// #117 follow-up (2026-05-02): Ctrl+Enter close-confirmation moved here on
// partnerFixture so it doesn't ride on the seed-Acme `openFirstTicket`
// pollution that put it on the e2e baseline-failures list. The other 2
// tests above stay on the seed pattern — they're palette-UI only and
// don't touch ticket state.
partnerTest.describe('SupportView keyboard shortcuts — ticket-active', () => {
  partnerTest('Ctrl+Enter opens the close-ticket confirmation when a ticket is active', async ({ page, partnerFixture }) => {
    const lucas = await partnerFixture.createUser({
      role: 'support',
      departments: ['general'],
    });
    await partnerFixture.createTicket();

    await partnerFixture.loginAs(lucas.userId, { waitFor: 'networkidle' });
    await page.reload();
    await page.waitForLoadState('networkidle');

    const ticketRow = page.locator('li[data-ticket-row][data-ticket-variant="queue"]').first();
    await partnerExpect(ticketRow).toBeVisible({ timeout: 10000 });
    await ticketRow.click();
    await page.waitForLoadState('networkidle');

    // The fixture creates an unassigned ticket; Ctrl+Enter close is gated on
    // the active user being the support assignee, so click Join first.
    const joinBtn = page.getByRole('button', { name: /join|deelnemen|rejoindre/i }).first();
    if (await joinBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await joinBtn.click();
      await page.waitForLoadState('networkidle');
    }

    await page.keyboard.press('Control+Enter');

    // triggerCloseTicket surfaces the shared ConfirmDialog. Title is
    // locale-dependent (fixture user lang defaults vary), so match all.
    await partnerExpect(
      page.getByText(/close ticket\?|fermer le ticket|ticket sluiten/i),
    ).toBeVisible();
  });
});
