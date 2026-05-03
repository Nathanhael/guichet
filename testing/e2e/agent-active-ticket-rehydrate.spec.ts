/**
 * E2E: AgentView active-ticket persistence — regression for commit 3e31a4e.
 *
 * AgentView used to keep its active-ticket focus only in the in-memory
 * Zustand store, so a hard refresh dropped the focus and the agent had to
 * pick the chat back from scratch. The fix mirrors SupportView's
 * `guichet:activeTab:${membershipId}` pattern: writes the ticket id to
 * `guichet:activeTicket:${membershipId}` whenever it changes and restores
 * it on mount, but only when the saved id still matches a non-closed
 * ticket. Closed/transferred falls through to the auto-route below.
 *
 * Test 1 covers the happy path: open ticket → reload → same chat focused.
 * Test 2 covers the safety branch: when the saved id no longer matches an
 * open agent ticket, the hydrate effect skips and auto-route picks
 * whatever the agent currently has (or TicketForm when nothing).
 */

import { test, expect } from './helpers/partnerFixture';

test.describe('AgentView active-ticket rehydration', () => {
  test('hard refresh restores the same chat the agent was viewing', async ({ page, partnerFixture }) => {
    const agent = await partnerFixture.createUser({
      role: 'agent',
      departments: [partnerFixture.departments[0].id],
    });
    const ticketId = await partnerFixture.createTicket({ agentId: agent.userId });

    await partnerFixture.loginAs(agent.userId, { waitFor: 'networkidle' });

    // ProseMirror compose = chat view mounted, agent is in their ticket.
    await expect(page.locator('.ProseMirror').first()).toBeVisible({ timeout: 10000 });

    // The persistence key uses the membership id (NOT the partner id) —
    // it's stored in sessionStorage by the auth slice and survives the
    // reload below. Read it from the page so the test isn't coupled to
    // any particular membership-id scheme.
    const membershipId = await page.evaluate(() => sessionStorage.getItem('activeMembershipId'));
    expect(membershipId).toBeTruthy();

    const savedBefore = await page.evaluate(
      (mid) => localStorage.getItem(`guichet:activeTicket:${mid}`),
      membershipId,
    );
    expect(savedBefore).toBe(ticketId);

    // Hard refresh — this is the surface that used to drop focus.
    await page.reload({ waitUntil: 'networkidle' });

    // Strongest evidence the rehydration ran: ProseMirror mounted again
    // (TicketForm has no .ProseMirror — it uses a textarea). If the
    // hydrate effect had skipped, agentTicket auto-route would pick the
    // same id by coincidence here (one open ticket only), so the value
    // check below is what actually proves the persist+hydrate path.
    await expect(page.locator('.ProseMirror').first()).toBeVisible({ timeout: 10000 });

    const savedAfter = await page.evaluate(
      (mid) => localStorage.getItem(`guichet:activeTicket:${mid}`),
      membershipId,
    );
    expect(savedAfter).toBe(ticketId);
  });

  test('saved id pointing at a no-longer-open ticket does not pin focus', async ({ page, partnerFixture }) => {
    // Stage an agent without any tickets, then plant a stale saved id
    // before login. After login the hydrate effect must reject the id
    // (no matching non-closed ticket) and fall through to the auto-route,
    // which has nothing to route to → TicketForm renders instead of a
    // ghost chat.
    const agent = await partnerFixture.createUser({
      role: 'agent',
      departments: [partnerFixture.departments[0].id],
    });

    await partnerFixture.loginAs(agent.userId, { waitFor: 'networkidle' });

    const membershipId = await page.evaluate(() => sessionStorage.getItem('activeMembershipId'));
    expect(membershipId).toBeTruthy();

    // Plant a stale saved id. `evaluate` runs in the page's localStorage
    // scope, so the value persists across the reload below.
    await page.evaluate(
      ([mid, stale]) => localStorage.setItem(`guichet:activeTicket:${mid}`, stale),
      [membershipId, 'ticket-that-does-not-exist'] as const,
    );

    await page.reload({ waitUntil: 'networkidle' });

    // No chat — TicketForm should be the surface (department picker
    // visible). The exact label varies by partner manifest; the
    // fixture's first department always has a name set.
    const deptName = partnerFixture.departments[0].name;
    await expect(page.getByText(deptName).first()).toBeVisible({ timeout: 10000 });

    // ProseMirror is the chat editor. TicketForm uses a plain textarea
    // (or contenteditable wrapper). Assert no chat editor mounted.
    const proseMirrorVisible = await page
      .locator('.ProseMirror')
      .first()
      .isVisible({ timeout: 1500 })
      .catch(() => false);
    expect(proseMirrorVisible).toBeFalsy();

    // Persist effect should have cleaned the stale entry now that
    // activeTicketId resolved to null after auto-route had nothing to
    // pick.
    const savedAfter = await page.evaluate(
      (mid) => localStorage.getItem(`guichet:activeTicket:${mid}`),
      membershipId,
    );
    expect(savedAfter).toBeNull();
  });
});
