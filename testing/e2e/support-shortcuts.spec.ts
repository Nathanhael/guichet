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

const BASE = process.env.E2E_BASE_URL || 'http://localhost:3001';
const DEMO_PASSWORD = 'password123';

async function loginAsDemo(page: Page, userId: string) {
  await page.goto(BASE);
  await page.waitForLoadState('load');

  const data = await page.evaluate(
    async ({ uid, pw }) => {
      const res = await fetch('/api/v1/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ id: uid, password: pw }),
      });
      if (!res.ok) return { ok: false, status: res.status };
      const json = await res.json();
      return { ok: true, ...json };
    },
    { uid: userId, pw: DEMO_PASSWORD }
  );

  if (!data.ok) throw new Error(`login failed for ${userId}: ${data.status}`);

  // Seed sessionStorage so Zustand hydrates user + partner on reload.
  await page.evaluate(({ user, memberships }) => {
    sessionStorage.setItem('user', JSON.stringify(user));
    sessionStorage.setItem('memberships', JSON.stringify(memberships));
    if (memberships?.length > 0) {
      sessionStorage.setItem('activeMembershipId', memberships[0].id);
      sessionStorage.setItem('activePartnerId', memberships[0].partnerId);
    }
  }, data);

  await page.reload();
  await page.waitForLoadState('load');
  return data;
}

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

    // Wait for SupportNav to mount before pressing Ctrl+K — otherwise the
    // keydown listener registered by useKeyboardShortcuts may not be
    // attached yet.
    await expect(page.getByRole('button', { name: /command palette/i })).toBeVisible();

    // Dispatching the keydown via the DOM avoids Playwright/Chrome
    // shortcut-capture quirks (Ctrl+K routes to the browser's address bar
    // under some conditions in headless chromium).
    await page.evaluate(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, bubbles: true }));
    });

    const palette = page.getByRole('dialog', { name: /command palette/i });
    await expect(palette).toBeVisible();

    // Hints that are always visible (no-ticket-required commands).
    // Action-group hints (Ctrl+Enter, Alt+T, Alt+W, Ctrl+/) live inside
    // commands gated on `!!activeTab` and are hidden by the palette when
    // no tab is open — test 3 covers one of them with an active ticket.
    await expect(palette.getByRole('button', { name: /toggle queue sidebar ctrl\+b/i })).toBeVisible();
    await expect(palette.getByRole('button', { name: /toggle focus mode esc/i })).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(palette).toBeHidden();
  });

  test('clicking the Ctrl+K nav badge opens the palette', async ({ page }) => {
    await loginAsDemo(page, 'support_lucas');

    await page.getByRole('button', { name: /command palette/i }).click();
    await expect(page.getByRole('dialog', { name: /command palette/i })).toBeVisible();
  });

  test('Ctrl+Enter opens the close-ticket confirmation when a ticket is active', async ({ page }) => {
    await loginAsDemo(page, 'support_lucas');

    const opened = await openFirstTicket(page);
    test.skip(!opened, 'No tickets in the queue to exercise Ctrl+Enter');

    await page.keyboard.press('Control+Enter');

    // triggerCloseTicket surfaces the shared ConfirmDialog with title "Close ticket?"
    await expect(page.getByText(/close ticket\?/i)).toBeVisible();
  });
});
