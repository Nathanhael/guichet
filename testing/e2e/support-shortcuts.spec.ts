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

import { type Page } from '@playwright/test';
import { test, expect } from './helpers/fixtures';
import { loginAsDemo } from './helpers/auth';

const BASE = process.env.E2E_BASE_URL || 'http://localhost:3001';

async function openFirstTicket(page: Page) {
  // data-ticket-row is stamped by QueueTicketRow — distinguishes real ticket rows
  // from collapsible section headers that the legacy `aside li` selector matched.
  const ticketItem = page.locator('li[data-ticket-row]').first();
  if (await ticketItem.isVisible({ timeout: 10000 }).catch(() => false)) {
    await ticketItem.click();
    await page.waitForLoadState('networkidle');
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

  test('Ctrl+Enter opens the close-ticket confirmation when a ticket is active', async ({ page, ticketFixture }) => {
    const result = await loginAsDemo(page, 'support_lucas');
    if (!result.ok) throw new Error(`login failed for support_lucas: ${result.status}`);

    const partnerId = await page.evaluate(() => sessionStorage.getItem('activePartnerId'));
    if (!partnerId) throw new Error('loginAsDemo did not seed activePartnerId');
    await ticketFixture.create({ partnerId });
    await page.reload();
    await page.waitForLoadState('networkidle');

    const opened = await openFirstTicket(page);
    if (!opened) throw new Error('Could not open the fixture-created ticket from the queue');

    // The fixture creates an unassigned ticket; Ctrl+Enter close is gated on
    // the active user being the support assignee, so click Join first.
    const joinBtn = page.getByRole('button', { name: /join|deelnemen/i }).first();
    if (await joinBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await joinBtn.click();
      await page.waitForLoadState('networkidle');
    }

    await page.keyboard.press('Control+Enter');

    // triggerCloseTicket surfaces the shared ConfirmDialog. Title is locale-
    // dependent (lucas's seed lang is fr), so match against all locales.
    await expect(
      page.getByText(/close ticket\?|fermer le ticket|ticket sluiten/i),
    ).toBeVisible();
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
