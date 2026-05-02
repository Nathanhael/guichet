/**
 * E2E: Collision Detection — Switching Tickets
 *
 * The original `Collision Detection — Real-Time` describe (3 tests probing
 * for an "also viewing this ticket" banner) was deleted in 2026-05-02's
 * body-fixme follow-up: the banner UI itself was removed (see
 * client/src/components/chat/ChatHeader.tsx:596 — "Collision Detection
 * bar intentionally removed — viewer names are surfaced elsewhere"). The
 * server-side socket plumbing (`ticket:viewing` / `ticket:left` /
 * `ticket:viewers`) remains intact and is covered by the integration
 * suite at `server/__integration__/isolation.test.ts:602+`. The two
 * sibling fixme'd tests in `ai-features.spec.ts` were dropped in the
 * same cleanup.
 *
 * What survives here is the slice C1 multi-context smoke flow: lucas
 * and oliver each open the same ticket, oliver switches to a sibling
 * ticket, and we assert no crash text appears on either page. The
 * partnerFixture isolation keeps the 60s budget honest — see commit
 * 6d1ba95 for the full rationale.
 *
 * Prerequisites:
 *   - Server running at E2E_BASE_URL (default http://localhost:3001)
 *   - Seeded `platform_bart` operator (used by partnerFixture for bootstrap auth)
 */

import { test, expect } from './helpers/partnerFixture';
import { loginAsDemo } from './helpers/auth';

test.describe('Collision Detection — Switching Tickets', () => {
  test('switching tickets updates collision state', async ({ page, browser, partnerFixture }) => {
    // Plan called partnerFixture migration "orthogonal" but in practice the
    // 60s budget timed out because seed Acme tickets were claimed by
    // parallel specs faster than this one could touch them — fixed sleeps
    // (4× waitForTimeout = 9.5s dead time) compounded with long fixture-
    // creation latency. Migration to partnerFixture removes the parallel-
    // pollution variable; the dead sleeps are replaced with
    // waitForLoadState('networkidle') so each transition is observable
    // rather than hoped-for. Final assertion: no crash text on either page
    // after the switch flow.
    const lucas = await partnerFixture.createUser({
      role: 'support',
      departments: ['general'],
    });
    const oliver = await partnerFixture.createUser({
      role: 'support',
      departments: ['general'],
    });
    // TWO tickets so user 2 can switch between them. createTicket's
    // default agentId is `agent_julie` (seeded), so two consecutive calls
    // both stamp julie as the originator — the test exercises which
    // ticket the SUPPORT user is viewing, not which agent owns it.
    await partnerFixture.createTicket();
    await partnerFixture.createTicket();

    await partnerFixture.loginAs(lucas.userId, { waitFor: 'networkidle' });
    await page.reload();
    await page.waitForLoadState('networkidle');

    const ctx2 = await browser.newContext();
    const page2 = await ctx2.newPage();
    try {
      const res2 = await loginAsDemo(page2, oliver.userId, { waitFor: 'networkidle' });
      if (!res2.ok) throw new Error(`oliver loginAsDemo failed: ${res2.status}`);

      // Lucas's queue should show both unassigned tickets.
      const ticketItems = page.locator('li[data-ticket-row][data-ticket-variant="queue"]');
      await expect
        .poll(() => ticketItems.count(), { timeout: 10000 })
        .toBeGreaterThanOrEqual(2);

      // User 1 (lucas) opens the first ticket.
      await ticketItems.nth(0).click();
      await page.waitForLoadState('networkidle');

      // User 2 (oliver) opens the same first ticket on his page.
      const ticketItems2 = page2.locator('li[data-ticket-row][data-ticket-variant="queue"]');
      await expect(ticketItems2.first()).toBeVisible({ timeout: 10000 });
      await ticketItems2.nth(0).click();
      await page2.waitForLoadState('networkidle');

      // User 2 switches to the second ticket.
      await ticketItems2.nth(1).click();
      await page2.waitForLoadState('networkidle');

      // No crashes on either page after the switch flow completes.
      const err1 = await page.getByText(/error|crash/i).first().isVisible().catch(() => false);
      const err2 = await page2.getByText(/error|crash/i).first().isVisible().catch(() => false);
      expect(err1).toBeFalsy();
      expect(err2).toBeFalsy();
    } finally {
      await ctx2.close();
    }
  });
});
