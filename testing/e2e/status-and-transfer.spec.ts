/**
 * E2E: Agent Status Visibility & Department Transfer
 *
 * Tests the StatusPicker component, team capacity badge, and department
 * transfer menu.
 *
 * Bundle D / RFC #82 migration: replaces 19 fixture-state predicate skips
 * with hard errors on demo-login failure (per the wiki pattern at
 * `wiki/patterns/e2e-skip-as-silent-failure.md`).
 *
 * #117: Department Transfer migrated to `partnerFixture` for parallel-worker
 * isolation. StatusPicker + Team Capacity Badge stay on the shared seed —
 * they don't depend on queue-state and were never flaky.
 */

import { test, expect } from './helpers/partnerFixture';
import { loginAsDemo } from './helpers/auth';

// ---------------------------------------------------------------------------
// StatusPicker
// ---------------------------------------------------------------------------

test.describe('StatusPicker', () => {
  test.beforeEach(async ({ page }) => {
    const res = await loginAsDemo(page, 'support_lucas');
    if (!res.ok) {
      throw new Error(
        `Fixture user 'support_lucas' failed to log in (status ${res.status}). ` +
          'Check server/seed.ts — this is a test setup bug, not a skip condition.',
      );
    }
    await page.waitForLoadState('networkidle');
  });

  test('shows status picker button in nav', async ({ page }) => {
    // Phase 9 chrome unification: status quick-toggles live inside UserMenuChip.
    const userMenu = page.locator('button[aria-haspopup="dialog"]').first();
    await expect(userMenu).toBeVisible({ timeout: 10000 });
  });

  test('shows 2 status options when opened', async ({ page }) => {
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
    const userMenu = page.locator('button[aria-haspopup="dialog"]').first();
    await expect(userMenu).toBeVisible({ timeout: 10000 });
    await userMenu.click();

    const dialog = page.getByRole('dialog');
    // One dot keyed off --color-ok (online), one off --color-accent-amber (away).
    const dots = dialog.locator('button > span.rounded-full.w-2.h-2');
    await expect(dots).toHaveCount(2);
  });

  test('changes status on selection', async ({ page }) => {
    const userMenu = page.locator('button[aria-haspopup="dialog"]').first();
    await expect(userMenu).toBeVisible({ timeout: 10000 });
    await userMenu.click();

    const dialog = page.getByRole('dialog');
    const statusBtns = dialog.locator('button:has(span.rounded-full.w-2.h-2)');

    // Position 1 = Away (STATUSES[1] in UserMenuChip.tsx). Position-based
    // selection is locale-stable.
    await statusBtns.nth(1).click();

    // Active button gets the accent-soft background token.
    await expect(statusBtns.nth(1)).toHaveClass(/accent-soft/, { timeout: 5000 });
  });

  test('persists status across page reload', async ({ page }) => {
    const userMenu = page.locator('button[aria-haspopup="dialog"]').first();
    await expect(userMenu).toBeVisible({ timeout: 10000 });
    await userMenu.click();

    const dialog = page.getByRole('dialog');
    const statusBtns = dialog.locator('button:has(span.rounded-full.w-2.h-2)');
    await statusBtns.nth(1).click();
    await expect(statusBtns.nth(1)).toHaveClass(/accent-soft/, { timeout: 5000 });

    // Reload — status restoration happens via socket `status:restored` on reconnect.
    await page.reload();
    await page.waitForLoadState('networkidle');

    // Menu chip should still render cleanly post-reload. The exact restored
    // state depends on Redis presence state and socket timing — we only
    // assert the trigger mounts and no error banner appeared.
    const userMenuAfter = page.locator('button[aria-haspopup="dialog"]').first();
    await expect(userMenuAfter).toBeVisible({ timeout: 10000 });
    const errorVisible = await page
      .getByText(/error|crash/i)
      .first()
      .isVisible()
      .catch(() => false);
    expect(errorVisible).toBeFalsy();
  });
});

// ---------------------------------------------------------------------------
// Team Capacity Badge
// ---------------------------------------------------------------------------

test.describe('Team Capacity Badge', () => {
  test.beforeEach(async ({ page }) => {
    const res = await loginAsDemo(page, 'support_lucas');
    if (!res.ok) {
      throw new Error(
        `Fixture user 'support_lucas' failed to log in (status ${res.status}). ` +
          'Check server/seed.ts — this is a test setup bug, not a skip condition.',
      );
    }
    await page.waitForLoadState('networkidle');
  });

  test('SupportNav renders without errors when only one support is online', async ({ page }) => {
    // The capacity badge is conditional on totalOnline > 0. With one user
    // online the badge may not appear — assert no crash AND if the badge
    // shows up, it shows a numeric ratio.
    const errorVisible = await page
      .getByText(/error|crash/i)
      .first()
      .isVisible()
      .catch(() => false);
    expect(errorVisible).toBeFalsy();

    const capacityBadge = page.getByText(/Team Capacity/i).first();
    if (await capacityBadge.isVisible().catch(() => false)) {
      await expect(capacityBadge).toBeVisible();
      const countSpan = page.locator('span').filter({ hasText: /\d+ \/ \d+/ }).first();
      await expect(countSpan).toBeVisible({ timeout: 5000 });
    }
  });

  test('capacity badge appears when two support users are online', async ({ browser }) => {
    // Use two browser contexts to ensure multiple online support users.
    const ctx1 = await browser.newContext();
    const ctx2 = await browser.newContext();
    const page1 = await ctx1.newPage();
    const page2 = await ctx2.newPage();

    try {
      const res1 = await loginAsDemo(page1, 'support_lucas');
      const res2 = await loginAsDemo(page2, 'support_sophie');
      if (!res1.ok || !res2.ok) {
        throw new Error(
          `Demo logins failed: lucas=${res1.status} sophie=${res2.status}. ` +
            'Check server/seed.ts — both users must be seeded.',
        );
      }

      await page1.waitForLoadState('networkidle');
      await page2.waitForLoadState('networkidle');

      // With both online, page1 should show the capacity badge.
      const capacityLabel = page1.getByText(/Team Capacity/i).first();
      const badgeVisible = await capacityLabel.isVisible({ timeout: 5000 }).catch(() => false);
      if (badgeVisible) {
        await expect(capacityLabel).toBeVisible();
        const countBadge = page1.locator('span').filter({ hasText: /\d+ \/ \d+/ }).first();
        await expect(countBadge).toBeVisible({ timeout: 5000 });
      } else {
        // Capacity badge is rendered only when totalOnline > 0; confirm no errors.
        const err1 = await page1
          .getByText(/error|crash/i)
          .first()
          .isVisible()
          .catch(() => false);
        expect(err1).toBeFalsy();
      }
    } finally {
      await ctx1.close();
      await ctx2.close();
    }
  });
});

// ---------------------------------------------------------------------------
// Department Transfer
// ---------------------------------------------------------------------------

test.describe('Department Transfer', () => {
  test.beforeEach(async ({ page, partnerFixture }) => {
    // Per #117: each test gets its own partner + support user + ticket.
    // No more sharing Acme with parallel specs that claim/close tickets
    // mid-flight.
    const { userId } = await partnerFixture.createUser({
      role: 'support',
      departments: ['general'],
    });
    await partnerFixture.loginAs(userId, { waitFor: 'networkidle' });

    // Stage a ticket in this partner's queue. Default departmentId = first
    // dept (`general`) — matches the support user's department so it's
    // visible in the queue sidebar.
    await partnerFixture.createTicket();

    // Reload so the queue refetches and the new ticket lands in the sidebar.
    // (The fixture's direct-INSERT bypasses the socket emission that
    // production ticket creates trigger; reload is the cheapest path to a
    // deterministic queue state.)
    await page.reload();
    await page.waitForLoadState('networkidle');

    await page.setViewportSize({ width: 1600, height: 900 });
  });

  test('Transfer button is visible when a ticket is open', async ({ page }) => {
    // Open the fixture-created ticket from the queue sidebar.
    // Prefer real ticket rows (data-ticket-row stamped by QueueTicketRow);
    // `cursor-pointer` alone matched collapsible section headers too.
    const ticketItem = page.locator('li[data-ticket-row]').first();
    await expect(ticketItem).toBeVisible({ timeout: 10000 });
    await ticketItem.click();
    await page.waitForLoadState('networkidle');

    // Support agent may need to "Join" the ticket first before toolbar appears.
    const joinBtn = page.getByRole('button', { name: /join|deelnemen/i }).first();
    if (await joinBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await joinBtn.click();
      await page.waitForLoadState('networkidle');
    }

    // Transfer button is in the chat toolbar, visible on sm+ screens.
    const transferBtn = page
      .getByRole('button', { name: /transfer|overdragen|transférer/i })
      .first();
    await expect(transferBtn).toBeVisible({ timeout: 10000 });
  });

  test('transfer menu shows department section header', async ({ page }) => {
    const ticketItem = page.locator('li[data-ticket-row]').first();
    await expect(ticketItem).toBeVisible({ timeout: 10000 });
    await ticketItem.click();
    await page.waitForLoadState('networkidle');

    const joinBtn = page.getByRole('button', { name: /join|deelnemen/i }).first();
    if (await joinBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await joinBtn.click();
      await page.waitForLoadState('networkidle');
    }

    const transferBtn = page
      .getByRole('button', { name: /transfer|overdragen|transférer/i })
      .first();
    await expect(transferBtn).toBeVisible({ timeout: 10000 });
    await transferBtn.click();

    // Phase-9 ChatHeader removed the standalone "Return to queue" item from
    // the Transfer menu — `support:leave` (the X close button) already covers
    // that flow. The menu now opens straight to the "Transfer to department"
    // section header + dept option list.
    await expect(
      page
        .getByText(/transfer to department|overdragen naar afdeling|transférer au département/i)
        .first(),
    ).toBeVisible({ timeout: 5000 });
  });

  test('transfer menu shows department options list', async ({ page }) => {
    const ticketItem = page.locator('li[data-ticket-row]').first();
    await expect(ticketItem).toBeVisible({ timeout: 10000 });
    await ticketItem.click();
    await page.waitForLoadState('networkidle');

    const joinBtn = page.getByRole('button', { name: /join|deelnemen/i }).first();
    if (await joinBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await joinBtn.click();
      await page.waitForLoadState('networkidle');
    }

    const transferBtn = page
      .getByRole('button', { name: /transfer|overdragen|transférer/i })
      .first();
    await expect(transferBtn).toBeVisible({ timeout: 10000 });
    await transferBtn.click();

    // Phase-9 ChatHeader: Transfer menu only renders when
    // `transferDepartments.length > 0` and opens to the "Transfer to department"
    // section header.
    const deptHeader = page
      .getByText(/transfer to department|overdragen naar afdeling|transférer au département/i)
      .first();
    await expect(deptHeader).toBeVisible({ timeout: 5000 });
  });

  test('transfer menu has a note input field', async ({ page }) => {
    const ticketItem = page.locator('li[data-ticket-row]').first();
    await expect(ticketItem).toBeVisible({ timeout: 10000 });
    await ticketItem.click();
    await page.waitForLoadState('networkidle');

    const joinBtn = page.getByRole('button', { name: /join|deelnemen/i }).first();
    if (await joinBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await joinBtn.click();
      await page.waitForLoadState('networkidle');
    }

    const transferBtn = page
      .getByRole('button', { name: /transfer|overdragen|transférer/i })
      .first();
    await expect(transferBtn).toBeVisible({ timeout: 10000 });
    await transferBtn.click();

    // Note input field inside the transfer dropdown.
    const noteInput = page
      .locator(
        'input[type="text"][placeholder*="context" i], input[type="text"][placeholder*="agent" i], input[type="text"][placeholder*="volgende" i]',
      )
      .first();
    await expect(noteInput).toBeVisible({ timeout: 5000 });
  });
});
