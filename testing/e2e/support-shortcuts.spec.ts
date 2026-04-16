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

  // Trigger a reload so the session cookie is picked up by the SPA
  await page.goto(BASE);
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

    await page.keyboard.press('Control+K');

    const palette = page.getByRole('dialog', { name: /command palette/i });
    await expect(palette).toBeVisible();

    // Hint column should display the new Tier-1 bindings
    await expect(palette.getByText('Ctrl+Enter', { exact: false })).toBeVisible();
    await expect(palette.getByText('Alt+T', { exact: false })).toBeVisible();
    await expect(palette.getByText('Alt+W', { exact: false })).toBeVisible();
    await expect(palette.getByText('Ctrl+/', { exact: false })).toBeVisible();

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
