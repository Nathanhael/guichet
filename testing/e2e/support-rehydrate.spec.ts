/**
 * E2E: SupportView tab rehydration regression — #120 follow-up to #119.
 *
 * Reproduces the bug fixed in `cc69fef`: when a support user lands on a
 * fresh page (browser restart, session expire+reauth, manual hard reload)
 * and the server already has a ticket assigned to them (`supportId === user.id`),
 * the SupportView hydration effect must auto-add the ticket to
 * `supportOpenTickets` so it lands in MY CHATS as a chat tab — not in the
 * "CLAIMED BY OTHERS" collapsed rail.
 *
 * Pre-fix the test would fail because the hydration's one-shot guard set
 * itself BEFORE the filter ran, but the filter read the zustand `tickets`
 * mirror that hadn't synced yet on the same render. First fire saw
 * `tickets=[]`, locked the guard, did nothing; second fire returned early
 * on the guard. Tickets never rehydrated → ticket sat in CLAIMED BY OTHERS.
 *
 * Post-fix the hydration reads `ticketsQuery.data` directly (the source of
 * truth in the same closure), so the one-shot is honest about whether it
 * had data to work with.
 */

import { test, expect } from './helpers/partnerFixture';

test.describe('SupportView rehydration', () => {
  test('claimed ticket auto-restores to MY CHATS on fresh page load', async ({ page, partnerFixture }) => {
    // Stage a support user, then create a ticket pre-stamped with their
    // userId as the supportId. From SupportView's POV at mount, this looks
    // identical to "user claimed earlier, then closed the browser, now
    // logging in again" — a server-assigned ticket on a fresh page with no
    // zustand state to inherit from.
    const lucas = await partnerFixture.createUser({
      role: 'support',
      departments: ['general'],
    });
    await partnerFixture.createTicket({ supportId: lucas.userId });

    // Login swaps session + reloads — gets us to a clean page mount where
    // supportOpenTickets is [] (zustand isn't persisted) and the hydration
    // effect has to populate it from ticketsQuery.data.
    await partnerFixture.loginAs(lucas.userId, { waitFor: 'networkidle' });

    // The MY CHATS section header surfaces the rehydrated tab. The bug
    // pre-fix put the ticket under CLAIMED BY OTHERS instead, with MY CHATS
    // hidden entirely (the section only renders when myChats.length > 0).
    const myChatsHeader = page.getByText(/my chats|mijn chats|mes chats/i).first();
    await expect(myChatsHeader).toBeVisible({ timeout: 10000 });

    // The "Claimed by others" section should NOT appear (it only renders
    // when otherAgents.length > 0; pre-fix the rehydrated ticket landed
    // there, post-fix it goes to MY CHATS).
    const claimedByOthers = page.getByText(/claimed by others|geclaimd door anderen|réclamé par d'autres/i).first();
    await expect(claimedByOthers).not.toBeVisible({ timeout: 2000 });

    // ProseMirror compose editor mounted as the active tab's surface —
    // strongest evidence the rehydration happened: tab is in
    // supportOpenTickets, ChatTabBar renders the tab, ChatWindow mounts
    // its editor. None of that fires unless rehydration ran.
    await expect(page.locator('.ProseMirror').first()).toBeVisible({ timeout: 10000 });

    // No crash text on the page.
    const errorVisible = await page.getByText(/error|crash/i).first().isVisible().catch(() => false);
    expect(errorVisible).toBeFalsy();
  });
});
