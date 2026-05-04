/**
 * E2E: Agent Flow — Ticket lifecycle from the agent's perspective.
 *
 * Tests adapt to current DB state: if agent has an open ticket,
 * tests exercise messaging/close on it. If no ticket, tests create one.
 *
 * Seed users: agent_julie (agent), support_lucas (support, DSC/FOT)
 */

import { test, expect } from './helpers/partnerFixture';
import type { Page } from '@playwright/test';
import { loginAsDemo } from './helpers/auth';

const BASE = process.env.E2E_BASE_URL || 'http://localhost:3001';

/** Close the agent's current ticket via the Close button if visible. */
async function closeCurrentTicket(page: Page): Promise<boolean> {
  const closeBtn = page.getByText(/close/i).first();
  if (!(await closeBtn.isVisible({ timeout: 2000 }).catch(() => false))) return false;
  await closeBtn.click();
  await page.waitForTimeout(500);
  // Confirm dialog
  const confirmBtn = page.getByText(/confirm|bevestig|yes/i).first();
  if (await confirmBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
    await confirmBtn.click();
  }
  await page.waitForTimeout(2000);
  return true;
}

// Bundle D follow-up: removed describe.serial so test 4 (rating modal) can
// run independently of test 3's failure.
test.describe('Agent Flow — Ticket Lifecycle', () => {
  test('agent can view or create a ticket', async ({ page }) => {
    const res = await loginAsDemo(page, 'agent_julie');
    if (!res.ok) {
      throw new Error(
        `Fixture user 'agent_julie' failed to log in (status ${res.status}). ` +
          'Check server/seed.ts — this is a test setup bug, not a skip condition.',
      );
    }
    await page.waitForLoadState('networkidle');

    // Agent either sees the ticket form (no open ticket) or the chat view (has ticket)
    const hasChat = await page.locator('.ProseMirror, [contenteditable]').first().isVisible({ timeout: 5000 }).catch(() => false);
    const hasForm = await page.getByText(/Dispatch|DSC/i).first().isVisible({ timeout: 2000 }).catch(() => false);

    // One of these must be true — the agent view loaded
    expect(hasChat || hasForm).toBeTruthy();

    if (hasForm) {
      // Create a ticket — select dept, fill reference fields, type message
      await page.getByText(/Dispatch|DSC/i).first().click();
      await page.waitForTimeout(500);

      // Fill reference fields (DSC requires "Order ID"). TicketForm renders
      // ref inputs as `<input type="text">` with no placeholder attr — select
      // by type, not placeholder.
      const refInputs = page.locator('input[type="text"]');
      const refCount = await refInputs.count();
      for (let i = 0; i < refCount; i++) {
        await refInputs.nth(i).fill(`E2E-${Date.now()}`);
      }
      await page.waitForTimeout(300);

      const editor = page.locator('.ProseMirror, textarea, [contenteditable]').first();
      if (await editor.isVisible()) {
        await editor.click();
        await page.keyboard.type('E2E agent ticket');
      }
      await page.waitForTimeout(500);
      const submitBtn = page.locator('button[type="submit"]').first();
      if (await submitBtn.isEnabled({ timeout: 3000 }).catch(() => false)) {
        await submitBtn.click();
        await page.waitForTimeout(3000);
      }
      // Should now be in chat view
      await expect(page.locator('.ProseMirror, [contenteditable]').first()).toBeVisible({ timeout: 8000 });
    }
  });

  test('agent sends a message in active chat', async ({ page }) => {
    const res = await loginAsDemo(page, 'agent_julie');
    if (!res.ok) {
      throw new Error(
        `Fixture user 'agent_julie' failed to log in (status ${res.status}). ` +
          'Check server/seed.ts — this is a test setup bug, not a skip condition.',
      );
    }
    await page.waitForLoadState('networkidle');

    // The previous serial test creates/exercises julie's ticket, so by the
    // time this runs julie should be in chat. The seed also gives her one
    // pending DSC ticket (ticket_dsc_julie). Either way the editor must
    // mount — if not, real regression.
    const editor = page.locator('.ProseMirror, [contenteditable]').first();
    await expect(editor).toBeVisible({ timeout: 10000 });

    await editor.click();
    const testMsg = `E2E msg ${Date.now()}`;
    await page.keyboard.type(testMsg);

    // julie is fr-locale; "envoyer" / NL "stuur" / EN "send".
    const sendBtn = page.locator('button').filter({ hasText: /send|stuur|verzend|envoyer/i }).first();
    await expect(sendBtn).toBeVisible({ timeout: 5000 });
    await sendBtn.click();
    await page.waitForTimeout(2000);
    // Message should appear in the chat
    await expect(page.getByText(testMsg).first()).toBeVisible({ timeout: 8000 });
  });

  test('support joins and exchanges messages with agent', async ({ page, browser, partnerFixture }) => {
    // #117 follow-up (2026-05-02 body-fixme migration, slice B): the
    // pre-migration symptom — julie's ticket appearing under lucas's
    // collapsed "Claimed by others" section because his
    // `supportOpenTickets` zustand state is empty on a fresh page —
    // doesn't manifest with a fresh-partner setup. The fixture ticket
    // starts unassigned (queue) so the support user is the first to
    // claim it, and lands in his "My Chats" cleanly instead of being
    // stuck in the collapsed Claimed-by-others rail.
    //
    // This means migration unblocks the test as a side effect. The
    // separate question — does the prod zustand-restoration bug bite
    // real users when a support staff with a server-assigned ticket
    // lands on a fresh page? — is NOT proven absent by this test. If
    // the bug surfaces in QA, file a separate issue for a session-
    // restoration repro.
    test.setTimeout(60_000);

    const agent = await partnerFixture.createUser({
      role: 'agent',
      departments: ['general'],
    });
    const lucas = await partnerFixture.createUser({
      role: 'support',
      departments: ['general'],
    });
    await partnerFixture.createTicket({ agentId: agent.userId });

    // Test-scope page = agent. The fixture's bootstrap session is
    // platform_bart; swap to the fresh agent and reload so AgentView
    // hydrates with the freshly-seeded ticket.
    await partnerFixture.loginAs(agent.userId, { waitFor: 'networkidle' });
    await page.reload();
    await page.waitForLoadState('networkidle');

    const supportCtx = await browser.newContext();
    const supportPage = await supportCtx.newPage();
    const agentPage = page;

    try {
      const supportRes = await loginAsDemo(supportPage, lucas.userId, { waitFor: 'networkidle' });
      if (!supportRes.ok) {
        throw new Error(`lucas loginAsDemo failed: ${supportRes.status}`);
      }

      // Agent should have landed on chat for the seeded ticket.
      await expect(agentPage.locator('.ProseMirror, [contenteditable]').first()).toBeVisible({ timeout: 10000 });

      // Support: pick the unassigned queue row (no pre-existing My Chats
      // tickets on a fresh fixture user).
      const ticketRow = supportPage.locator('li[data-ticket-row][data-ticket-variant="queue"]').first();
      await expect(ticketRow).toBeVisible({ timeout: 10000 });
      await ticketRow.click();
      await supportPage.waitForLoadState('networkidle');

      const joinBtn = supportPage.getByText(/^join$|^jump in$|^deelnemen$|^rejoindre$/i).first();
      await expect(joinBtn).toBeVisible({ timeout: 5000 });
      await joinBtn.click();
      await supportPage.waitForLoadState('networkidle');

      const supportEditor = supportPage.locator('.ProseMirror, [contenteditable]').first();
      await expect(supportEditor).toBeVisible({ timeout: 10000 });

      await supportEditor.click();
      const replyMsg = `Support reply ${Date.now()}`;
      await supportPage.keyboard.type(replyMsg);

      const sendBtn = supportPage.locator('button').filter({ hasText: /send|verzend|envoyer/i }).first();
      await expect(sendBtn).toBeVisible({ timeout: 5000 });
      await sendBtn.click();

      // Agent's chat should pick up the support reply via socket — no reload
      // needed; message:new propagates to the ticket room both peers are in.
      await expect(agentPage.getByText(replyMsg).first()).toBeVisible({ timeout: 10000 });
    } finally {
      await supportCtx.close();
    }
  });

  test('closing ticket shows rating modal and returns to form', async ({ page, browser, partnerFixture }) => {
    // #117 follow-up (2026-05-02 body-fixme migration, slice B): same
    // fixture pattern as the sibling join-and-message test. Fresh
    // partner with one agent + one support user + one queued ticket;
    // support joins and closes; agent sees rating modal or empty form.
    test.setTimeout(60_000);

    const agent = await partnerFixture.createUser({
      role: 'agent',
      departments: ['general'],
    });
    const lucas = await partnerFixture.createUser({
      role: 'support',
      departments: ['general'],
    });
    await partnerFixture.createTicket({ agentId: agent.userId });

    await partnerFixture.loginAs(agent.userId, { waitFor: 'networkidle' });
    await page.reload();
    await page.waitForLoadState('networkidle');

    const supportCtx = await browser.newContext();
    const supportPage = await supportCtx.newPage();
    const agentPage = page;

    try {
      const supportRes = await loginAsDemo(supportPage, lucas.userId, { waitFor: 'networkidle' });
      if (!supportRes.ok) {
        throw new Error(`lucas loginAsDemo failed: ${supportRes.status}`);
      }

      // Agent on chat.
      await expect(agentPage.locator('.ProseMirror, [contenteditable]').first()).toBeVisible({ timeout: 10000 });

      // Support joins from queue.
      const ticketRow = supportPage.locator('li[data-ticket-row][data-ticket-variant="queue"]').first();
      await expect(ticketRow).toBeVisible({ timeout: 10000 });
      await ticketRow.click();
      await supportPage.waitForLoadState('networkidle');

      const joinBtn = supportPage.getByText(/^join$|^jump in$|^deelnemen$|^rejoindre$/i).first();
      await expect(joinBtn).toBeVisible({ timeout: 5000 });
      await joinBtn.click();
      await supportPage.waitForLoadState('networkidle');

      await expect(supportPage.locator('.ProseMirror, [contenteditable]').first()).toBeVisible({ timeout: 10000 });

      // Support closes the ticket.
      const closed = await closeCurrentTicket(supportPage);
      if (!closed) throw new Error('Could not close ticket from support side');

      // Agent should see either the rating modal OR the back-to-form state
      // — both prove the close propagated to the agent's view.
      const ratingModal = agentPage.getByText(/rate|beoordeel|how was/i).first();
      const ticketForm = agentPage.getByText(/general|support|department/i).first();

      await expect
        .poll(async () => {
          const r = await ratingModal.isVisible().catch(() => false);
          const f = await ticketForm.isVisible().catch(() => false);
          return r || f;
        }, { timeout: 12000 })
        .toBe(true);
    } finally {
      await supportCtx.close();
    }
  });
});
