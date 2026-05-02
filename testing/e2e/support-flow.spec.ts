/**
 * E2E: Support Flow — Queue, tabs, transfer, close.
 *
 * #117 follow-up (2026-05-02 body-fixme migration, slice A2): four tests
 * migrated from the Bundle-D `ticketFixture` + shared seed Acme pattern
 * to per-spec `partnerFixture` (#117). Each test owns a fresh partner
 * with `general` + `support` departments, mints its own support user,
 * and seeds exactly one queue ticket — so the cross-test claim/close
 * pollution that fixme'd tests 2/3/4 is structurally impossible.
 *
 * The `closeKevinTickets()` raw-psql workaround and the `execSync`
 * dependency are gone — fresh partners have no kevin pollution to clean.
 *
 * The command-palette test stays on the bare seed (no partnerFixture
 * destructure) — it doesn't touch tickets or claim state, so paying for
 * partner provisioning would be cost without benefit.
 */

import { test, expect } from './helpers/partnerFixture';
import { loginAsDemo } from './helpers/auth';

test.describe('Support Flow — Queue & Tabs', () => {
  test('support joins ticket from queue — chat tab opens', async ({ page, partnerFixture }) => {
    const lucas = await partnerFixture.createUser({
      role: 'support',
      departments: ['general'],
    });
    await partnerFixture.loginAs(lucas.userId, { waitFor: 'networkidle' });
    await partnerFixture.createTicket();
    await page.reload();
    await page.waitForLoadState('networkidle');

    const ticketRow = page.locator('li[data-ticket-row][data-ticket-variant="queue"]').first();
    await expect(ticketRow).toBeVisible({ timeout: 10000 });

    await ticketRow.click();
    await page.waitForLoadState('networkidle');

    const joinBtn = page.getByText(/^join$|^jump in$|^deelnemen$|^rejoindre$/i).first();
    await expect(joinBtn).toBeVisible({ timeout: 5000 });
    await joinBtn.click();
    await page.waitForLoadState('networkidle');

    await expect(page.locator('.ProseMirror').first()).toBeVisible({ timeout: 15000 });
  });

  test('tab persists across page refresh', async ({ page, partnerFixture }) => {
    const lucas = await partnerFixture.createUser({
      role: 'support',
      departments: ['general'],
    });
    await partnerFixture.loginAs(lucas.userId, { waitFor: 'networkidle' });
    await partnerFixture.createTicket();
    await page.reload();
    await page.waitForLoadState('networkidle');

    const ticketRow = page.locator('li[data-ticket-row][data-ticket-variant="queue"]').first();
    await expect(ticketRow).toBeVisible({ timeout: 10000 });
    await ticketRow.click();
    await page.waitForLoadState('networkidle');

    const joinBtn = page.getByText(/^join$|^jump in$|^deelnemen$|^rejoindre$/i).first();
    if (await joinBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await joinBtn.click();
      await page.waitForLoadState('networkidle');
    }

    // Chat is open before refresh.
    await expect(
      page.locator('[class*="overflow-y-auto"]').first(),
    ).toBeVisible({ timeout: 10000 });

    await page.reload();
    await page.waitForLoadState('networkidle');

    // Tab restored — either the scroll container or the editor.
    const chatAfter =
      (await page.locator('[class*="overflow-y-auto"]').first().isVisible({ timeout: 10000 }).catch(() => false)) ||
      (await page.locator('.ProseMirror, [contenteditable]').first().isVisible({ timeout: 3000 }).catch(() => false));
    expect(chatAfter).toBeTruthy();
  });

  test('support closes ticket — tab removed', async ({ page, partnerFixture }) => {
    const lucas = await partnerFixture.createUser({
      role: 'support',
      departments: ['general'],
    });
    await partnerFixture.loginAs(lucas.userId, { waitFor: 'networkidle' });
    await partnerFixture.createTicket();
    await page.reload();
    await page.waitForLoadState('networkidle');

    const ticketRow = page.locator('li[data-ticket-row][data-ticket-variant="queue"]').first();
    await expect(ticketRow).toBeVisible({ timeout: 10000 });
    await ticketRow.click();
    await page.waitForLoadState('networkidle');

    const joinBtn = page.getByText(/^join$|^jump in$|^deelnemen$|^rejoindre$/i).first();
    if (await joinBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await joinBtn.click();
      await page.waitForLoadState('networkidle');
    }

    // Fixture user lang defaults to nl — selectors stay locale-flexible.
    const closeBtn = page.getByText(/^close$|^sluiten$|^fermer$/i).first();
    await expect(closeBtn).toBeVisible({ timeout: 5000 });
    await closeBtn.click();
    await page.waitForTimeout(500);

    const confirmBtn = page.getByText(/confirm|bevestig|yes|oui|ja|^close$|^sluiten$|^fermer$/i).last();
    if (await confirmBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
      await confirmBtn.click();
    }
    await page.waitForTimeout(2000);

    // Compose area gone after close.
    const noChat = !(await page.locator('.ProseMirror, [contenteditable]').first().isVisible().catch(() => false));
    const emptyState = await page.getByText(/ready to help|klaar|prêt/i).first().isVisible({ timeout: 5000 }).catch(() => false);
    expect(noChat || emptyState).toBeTruthy();
  });

  test('command palette opens with Ctrl+K', async ({ page }) => {
    const res = await loginAsDemo(page, 'support_lucas');
    if (!res.ok) {
      throw new Error(`support_lucas login failed (${res.status})`);
    }
    await page.waitForTimeout(2000);

    await page.keyboard.press('Control+k');
    await page.waitForTimeout(500);

    const paletteInput = page.locator('input[type="text"]').last();
    await expect(paletteInput).toBeVisible({ timeout: 3000 });

    const hasCommands = await page.getByText(/navigation|actions|status|view/i).first().isVisible({ timeout: 2000 }).catch(() => false);
    expect(hasCommands).toBeTruthy();

    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);
    const closed = !(await paletteInput.isVisible().catch(() => false));
    expect(closed).toBeTruthy();
  });
});

test.describe('Support Flow — Department Transfer', () => {
  test('transfer ticket to different department', async ({ page, browser, partnerFixture }) => {
    test.setTimeout(60_000); // multi-context + reseed + waits

    // lucas in `general`, sophie in `support` — fixture's default 2-dept
    // partner. Ticket lands in `general` (createTicket's default = first
    // dept), lucas joins + transfers to `support`, sophie sees it queued
    // in her department.
    const lucas = await partnerFixture.createUser({
      role: 'support',
      departments: ['general'],
    });
    const sophie = await partnerFixture.createUser({
      role: 'support',
      departments: ['support'],
    });
    await partnerFixture.createTicket(); // departmentId default = 'general'

    await partnerFixture.loginAs(lucas.userId, { waitFor: 'networkidle' });
    await page.reload();
    await page.waitForLoadState('networkidle');

    const sophieCtx = await browser.newContext();
    const sophiePage = await sophieCtx.newPage();
    try {
      const sophieRes = await loginAsDemo(sophiePage, sophie.userId, { waitFor: 'networkidle' });
      if (!sophieRes.ok) {
        throw new Error(`sophie loginAsDemo failed: ${sophieRes.status}`);
      }

      // Lucas joins the queued ticket.
      const ticketRow = page.locator('li[data-ticket-row][data-ticket-variant="queue"]').first();
      await expect(ticketRow).toBeVisible({ timeout: 10000 });
      await ticketRow.click();
      await page.waitForLoadState('networkidle');

      const joinBtn = page.getByText(/join|jump in/i).first();
      if (await joinBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
        await joinBtn.click();
        await page.waitForLoadState('networkidle');
      }

      // Open the transfer menu, then click the `support` department option
      // scoped under the "Transfer to department" header so we don't grab
      // the role label or any unrelated "Support" string elsewhere.
      const transferBtn = page
        .getByRole('button', { name: /transfer|overdragen|transférer/i })
        .first();
      await expect(transferBtn).toBeVisible({ timeout: 5000 });
      await transferBtn.click();

      const transferHeader = page
        .getByText(/transfer to department|overdragen naar afdeling|transférer au département/i)
        .first();
      await expect(transferHeader).toBeVisible({ timeout: 5000 });

      // Department options sit in a list/menu next to the header. Pick the
      // one literally labelled "Support" (the only non-self dept on the
      // fixture partner).
      const supportDept = page
        .getByRole('button', { name: /^support$/i })
        .first();
      await expect(supportDept).toBeVisible({ timeout: 5000 });
      await supportDept.click();

      // Wait for the transfer to commit before checking sophie. The lifecycle
      // module's `applyEffects` dispatch is post-commit + fire-and-forget,
      // so a brief settle window before sophie reloads is the cheapest path
      // to a deterministic queue-fetch.
      await page.waitForTimeout(1500);

      // Sophie's queue auto-refetches via tRPC's socket subscription, but
      // the queue-position broadcast doesn't carry a "new ticket appeared"
      // signal that her ticket.list watcher recognises — a manual reload
      // is the deterministic cross-context way to pick up the dept change.
      await sophiePage.reload();
      await sophiePage.waitForLoadState('networkidle');

      const transferred = sophiePage
        .locator('li[data-ticket-row][data-ticket-variant="queue"]')
        .first();
      await expect(transferred).toBeVisible({ timeout: 10000 });
    } finally {
      await sophieCtx.close();
    }
  });
});
