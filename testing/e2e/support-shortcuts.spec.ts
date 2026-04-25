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

import { test, expect, type Page } from '@playwright/test';
import { loginAsDemo } from './helpers/auth';

const BASE = process.env.E2E_BASE_URL || 'http://localhost:3001';

async function openFirstTicket(page: Page) {
  const ticketItem = page.locator('aside li, aside button').first();
  if (await ticketItem.isVisible({ timeout: 5000 }).catch(() => false)) {
    await ticketItem.click();
    await page.waitForTimeout(500);
    return true;
  }
  return false;
}

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

  test('Ctrl+Enter opens the close-ticket confirmation when a ticket is active', async ({ page }) => {
    const result = await loginAsDemo(page, 'support_lucas');
    if (!result.ok) throw new Error(`login failed for support_lucas: ${result.status}`);

    const opened = await openFirstTicket(page);
    test.skip(!opened, 'No tickets in the queue to exercise Ctrl+Enter');

    await page.keyboard.press('Control+Enter');

    // triggerCloseTicket surfaces the shared ConfirmDialog with title "Close ticket?"
    await expect(page.getByText(/close ticket\?/i)).toBeVisible();
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
