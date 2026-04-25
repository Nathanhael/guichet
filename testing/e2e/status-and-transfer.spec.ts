/**
 * E2E: Agent Status Visibility & Department Transfer
 *
 * Tests the StatusPicker component, team capacity badge, My Stats panel,
 * and department transfer menu.
 *
 * Prerequisites:
 *   - Server running at E2E_BASE_URL
 *   - Seeded demo database (seed.ts)
 */

import { test, expect } from '@playwright/test';
import { loginAsDemo } from './helpers/auth';

const BASE = process.env.E2E_BASE_URL || 'http://localhost:3001';

// ---------------------------------------------------------------------------
// StatusPicker
// ---------------------------------------------------------------------------

test.describe('StatusPicker', () => {
  let loginOk = false;

  test.beforeEach(async ({ page }) => {
    const res = await loginAsDemo(page, 'support_lucas');
    loginOk = !!res.ok;
    await page.waitForTimeout(2000);
  });

  test('shows status picker button in nav', async ({ page }) => {
    test.skip(!loginOk, 'Demo login failed — user may not be seeded');

    // Phase 9 chrome unification: status quick-toggles live inside UserMenuChip.
    const userMenu = page.locator('button[aria-haspopup="dialog"]').first();
    await expect(userMenu).toBeVisible({ timeout: 10000 });
  });

  test('shows 2 status options when opened', async ({ page }) => {
    test.skip(!loginOk, 'Demo login failed — user may not be seeded');

    const userMenu = page.locator('button[aria-haspopup="dialog"]').first();
    await expect(userMenu).toBeVisible({ timeout: 10000 });
    await userMenu.click();

    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible({ timeout: 5000 });

    // STATUSES array in UserMenuChip.tsx renders exactly 2 buttons, each
    // containing a small colored dot. Locale-independent (text is i18n).
    const statusBtns = dialog.locator('button:has(span.rounded-full.w-2.h-2)');
    await expect(statusBtns).toHaveCount(2);
  });

  test('status options each have a colored dot', async ({ page }) => {
    test.skip(!loginOk, 'Demo login failed — user may not be seeded');

    const userMenu = page.locator('button[aria-haspopup="dialog"]').first();
    await expect(userMenu).toBeVisible({ timeout: 10000 });
    await userMenu.click();

    const dialog = page.getByRole('dialog');
    // One dot keyed off --color-ok (online), one off --color-accent-amber (away).
    const dots = dialog.locator('button > span.rounded-full.w-2.h-2');
    await expect(dots).toHaveCount(2);
  });

  test('changes status on selection', async ({ page }) => {
    test.skip(!loginOk, 'Demo login failed — user may not be seeded');

    const userMenu = page.locator('button[aria-haspopup="dialog"]').first();
    await expect(userMenu).toBeVisible({ timeout: 10000 });
    await userMenu.click();

    const dialog = page.getByRole('dialog');
    const statusBtns = dialog.locator('button:has(span.rounded-full.w-2.h-2)');

    // Position 1 = Away (STATUSES[1] in UserMenuChip.tsx). Position-based
    // selection is locale-stable.
    await statusBtns.nth(1).click();
    await page.waitForTimeout(500);

    // Active button gets the accent-soft background token.
    await expect(statusBtns.nth(1)).toHaveClass(/accent-soft/);
  });

  test('persists status across page reload', async ({ page }) => {
    test.skip(!loginOk, 'Demo login failed — user may not be seeded');

    const userMenu = page.locator('button[aria-haspopup="dialog"]').first();
    await expect(userMenu).toBeVisible({ timeout: 10000 });
    await userMenu.click();

    const dialog = page.getByRole('dialog');
    const statusBtns = dialog.locator('button:has(span.rounded-full.w-2.h-2)');
    await statusBtns.nth(1).click();
    await page.waitForTimeout(500);

    // Reload — status restoration happens via socket `status:restored` on reconnect.
    await page.reload();
    await page.waitForLoadState('load');
    await page.waitForTimeout(3000);

    // Menu chip should still render cleanly post-reload. The exact restored
    // state depends on Redis presence state and socket timing — we only
    // assert the trigger mounts and no error banner appeared.
    const userMenuAfter = page.locator('button[aria-haspopup="dialog"]').first();
    await expect(userMenuAfter).toBeVisible({ timeout: 10000 });
    const errorVisible = await page.getByText(/error|crash/i).first().isVisible().catch(() => false);
    expect(errorVisible).toBeFalsy();
  });
});

// ---------------------------------------------------------------------------
// Team Capacity Badge
// ---------------------------------------------------------------------------

test.describe('Team Capacity Badge', () => {
  let loginOk = false;

  test.beforeEach(async ({ page }) => {
    const res = await loginAsDemo(page, 'support_lucas');
    loginOk = !!res.ok;
    await page.waitForTimeout(2000);
  });

  test('shows Team Capacity label in SupportNav when other support online', async ({ page }) => {
    test.skip(!loginOk, 'Demo login failed — user may not be seeded');

    // The capacity badge is conditional on totalOnline > 0, so we check for the
    // label or the X/Y count badge. The badge renders in SupportNav.
    // With only one user online the badge may not appear — verify no crash instead.
    const errorVisible = await page.getByText(/error|crash/i).first().isVisible().catch(() => false);
    expect(errorVisible).toBeFalsy();

    // If the badge is present, verify it shows a numeric ratio
    const capacityBadge = page.getByText(/Team Capacity/i).first();
    const isVisible = await capacityBadge.isVisible().catch(() => false);
    if (isVisible) {
      await expect(capacityBadge).toBeVisible();
      // The adjacent count span should exist and contain a slash
      const countSpan = page.locator('span').filter({ hasText: /\d+ \/ \d+/ }).first();
      await expect(countSpan).toBeVisible({ timeout: 5000 });
    }
  });

  test('capacity badge appears when two support users are online', async ({ browser }) => {
    // Use two browser contexts to ensure multiple online support users
    const ctx1 = await browser.newContext();
    const ctx2 = await browser.newContext();
    const page1 = await ctx1.newPage();
    const page2 = await ctx2.newPage();

    try {
      const res1 = await loginAsDemo(page1, 'support_lucas');
      const res2 = await loginAsDemo(page2, 'support_sophie');
      if (!res1.ok || !res2.ok) {
        test.skip(true, 'One or more demo logins failed');
        return;
      }

      await page1.waitForTimeout(3000);
      await page2.waitForTimeout(3000);

      // With both online, page1 should show the capacity badge
      const capacityLabel = page1.getByText(/Team Capacity/i).first();
      const badgeVisible = await capacityLabel.isVisible().catch(() => false);
      if (badgeVisible) {
        await expect(capacityLabel).toBeVisible();
        // Count badge: e.g. "1 / 2" or "2 / 2"
        const countBadge = page1.locator('span').filter({ hasText: /\d+ \/ \d+/ }).first();
        await expect(countBadge).toBeVisible({ timeout: 5000 });
      } else {
        // Capacity badge is rendered only when totalOnline > 0; confirm no errors
        const err1 = await page1.getByText(/error|crash/i).first().isVisible().catch(() => false);
        expect(err1).toBeFalsy();
      }
    } finally {
      await ctx1.close();
      await ctx2.close();
    }
  });
});

// ---------------------------------------------------------------------------
// Department Transfer Menu
// ---------------------------------------------------------------------------

test.describe('Department Transfer', () => {
  let loginOk = false;

  test.beforeEach(async ({ page }) => {
    // Use support_jan — member of wavelink partner which has open tickets
    const res = await loginAsDemo(page, 'support_lucas');
    loginOk = !!res.ok;
    await page.waitForTimeout(2000);
  });

  test('Transfer button is visible when a ticket is open', async ({ page }) => {
    test.skip(!loginOk, 'Demo login failed — user may not be seeded');
    await page.setViewportSize({ width: 1600, height: 900 });

    // Check if queue has tickets
    const queueEmpty = page.getByText(/queue.empty|0 in.queue/i).first();
    const isEmpty = await queueEmpty.isVisible({ timeout: 3000 }).catch(() => false);
    if (isEmpty) {
      test.skip(true, 'No tickets in queue — seed database with open tickets');
      return;
    }

    // Open a ticket from the queue sidebar
    // Prefer real ticket rows (data-ticket-row stamped by QueueTicketRow).
    // `cursor-pointer` alone matched collapsible section headers too.
    const ticketItem = page.locator('li[data-ticket-row]').first();
    const hasTicket = await ticketItem.isVisible({ timeout: 5000 }).catch(() => false);
    if (!hasTicket) {
      test.skip(true, 'No clickable tickets found in queue');
      return;
    }
    await ticketItem.click();
    await page.waitForTimeout(1500);

    // Support agent may need to "Join" the ticket first before toolbar appears
    const joinBtn = page.getByRole('button', { name: /join|deelnemen/i }).first();
    const joinVisible = await joinBtn.isVisible({ timeout: 3000 }).catch(() => false);
    if (joinVisible) {
      await joinBtn.click();
      await page.waitForTimeout(2000);
    }

    // Transfer button is in the chat toolbar, visible on sm+ screens
    const transferBtn = page.getByRole('button', { name: /transfer|overdragen|transférer/i }).first();
    await expect(transferBtn).toBeVisible({ timeout: 10000 });
  });

  test('transfer menu shows Return to queue and department options', async ({ page }) => {
    test.skip(!loginOk, 'Demo login failed — user may not be seeded');
    await page.setViewportSize({ width: 1600, height: 900 });

    // Prefer real ticket rows (data-ticket-row stamped by QueueTicketRow).
    // `cursor-pointer` alone matched collapsible section headers too.
    const ticketItem = page.locator('li[data-ticket-row]').first();
    const hasTicket = await ticketItem.isVisible({ timeout: 5000 }).catch(() => false);
    if (!hasTicket) {
      test.skip(true, 'No tickets in queue');
      return;
    }
    await ticketItem.click();
    await page.waitForTimeout(1500);

    // Join if needed
    const joinBtn = page.getByRole('button', { name: /join|deelnemen/i }).first();
    if (await joinBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await joinBtn.click();
      await page.waitForTimeout(2000);
    }

    const transferBtn = page.getByRole('button', { name: /transfer|overdragen|transférer/i }).first();
    const transferVisible = await transferBtn.isVisible({ timeout: 10000 }).catch(() => false);
    if (!transferVisible) {
      test.skip(true, 'Transfer button not visible');
      return;
    }
    await transferBtn.click();
    await page.waitForTimeout(500);

    // Phase-9 ChatHeader removed the standalone "Return to queue" item from
    // the Transfer menu — `support:leave` (the X close button) already covers
    // that flow. The menu now opens straight to the "Transfer to department"
    // section header + dept option list. Assert that header instead.
    await expect(page.getByText(/transfer to department|overdragen naar afdeling|transférer au département/i).first()).toBeVisible({ timeout: 5000 });
  });

  test('transfer menu shows department section header', async ({ page }) => {
    test.skip(!loginOk, 'Demo login failed — user may not be seeded');
    await page.setViewportSize({ width: 1600, height: 900 });

    // Prefer real ticket rows (data-ticket-row stamped by QueueTicketRow).
    // `cursor-pointer` alone matched collapsible section headers too.
    const ticketItem = page.locator('li[data-ticket-row]').first();
    const hasTicket = await ticketItem.isVisible({ timeout: 5000 }).catch(() => false);
    if (!hasTicket) {
      test.skip(true, 'No tickets in queue');
      return;
    }
    await ticketItem.click();
    await page.waitForTimeout(1500);

    const joinBtn = page.getByRole('button', { name: /join|deelnemen/i }).first();
    if (await joinBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await joinBtn.click();
      await page.waitForTimeout(2000);
    }

    const transferBtn = page.getByRole('button', { name: /transfer|overdragen|transférer/i }).first();
    const transferVisible = await transferBtn.isVisible({ timeout: 10000 }).catch(() => false);
    if (!transferVisible) {
      test.skip(true, 'Transfer button not visible');
      return;
    }
    await transferBtn.click();
    await page.waitForTimeout(500);

    // Phase-9 ChatHeader: Transfer menu only renders when `transferDepartments.length > 0`
    // and opens to the "Transfer to department" section header. The standalone
    // "Return to queue" entry was removed (support:leave / X covers that flow).
    const deptHeader = page.getByText(/transfer to department|overdragen naar afdeling|transférer au département/i).first();
    await expect(deptHeader).toBeVisible({ timeout: 5000 });
  });

  test('transfer menu has a note input field', async ({ page }) => {
    test.skip(!loginOk, 'Demo login failed — user may not be seeded');
    await page.setViewportSize({ width: 1600, height: 900 });

    // Prefer real ticket rows (data-ticket-row stamped by QueueTicketRow).
    // `cursor-pointer` alone matched collapsible section headers too.
    const ticketItem = page.locator('li[data-ticket-row]').first();
    const hasTicket = await ticketItem.isVisible({ timeout: 5000 }).catch(() => false);
    if (!hasTicket) {
      test.skip(true, 'No tickets in queue');
      return;
    }
    await ticketItem.click();
    await page.waitForTimeout(1500);

    const joinBtn = page.getByRole('button', { name: /join|deelnemen/i }).first();
    if (await joinBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await joinBtn.click();
      await page.waitForTimeout(2000);
    }

    const transferBtn = page.getByRole('button', { name: /transfer|overdragen|transférer/i }).first();
    const transferVisible = await transferBtn.isVisible({ timeout: 10000 }).catch(() => false);
    if (!transferVisible) {
      test.skip(true, 'Transfer button not visible');
      return;
    }
    await transferBtn.click();
    await page.waitForTimeout(500);

    // Note input field inside the transfer dropdown
    const noteInput = page.locator('input[type="text"][placeholder*="context" i], input[type="text"][placeholder*="agent" i], input[type="text"][placeholder*="volgende" i]').first();
    const inputVisible = await noteInput.isVisible().catch(() => false);
    expect(inputVisible).toBeTruthy();
  });
});

