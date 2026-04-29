/**
 * E2E: Agent Flow — Ticket lifecycle from the agent's perspective.
 *
 * Tests adapt to current DB state: if agent has an open ticket,
 * tests exercise messaging/close on it. If no ticket, tests create one.
 *
 * Seed users: agent_julie (agent), support_lucas (support, DSC/FOT)
 */

import { test, expect, type Page } from '@playwright/test';
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

test.describe.serial('Agent Flow — Ticket Lifecycle', () => {
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

    // julie is fr-locale; "envoyer" / NL "verzenden" / EN "send".
    const sendBtn = page.locator('button').filter({ hasText: /send|verzend|envoyer/i }).first();
    await expect(sendBtn).toBeVisible({ timeout: 5000 });
    await sendBtn.click();
    await page.waitForTimeout(2000);
    // Message should appear in the chat
    await expect(page.getByText(testMsg).first()).toBeVisible({ timeout: 8000 });
  });

  test('support joins and exchanges messages with agent', async ({ browser }) => {
    // Bundle D: multi-context flow with serial-cadence ticket-state coupling.
    // Same pattern as support-flow's multi-context tests. The single-context
    // flows above (test 1 + 2) cover the core agent behaviors. Out of slice 2
    // mechanical scope — needs deeper rewrite to use ticketFixture across
    // contexts.
    test.fixme();

    const agentCtx = await browser.newContext();
    const supportCtx = await browser.newContext();
    const agentPage = await agentCtx.newPage();
    const supportPage = await supportCtx.newPage();

    try {
      const agentRes = await loginAsDemo(agentPage, 'agent_julie');
      const supportRes = await loginAsDemo(supportPage, 'support_lucas');
      test.skip(!agentRes.ok || !supportRes.ok, 'Seed users not available');

      await agentPage.waitForTimeout(3000);
      await supportPage.waitForTimeout(3000);

      // Agent must have an active chat
      const agentHasChat = await agentPage.locator('.ProseMirror, [contenteditable]').first().isVisible({ timeout: 5000 }).catch(() => false);
      test.skip(!agentHasChat, 'Agent has no active ticket');

      // Support: find Julie's ticket — may be under "My Chats" (assigned) or "Queue" (unassigned)
      const ticketRow = supportPage.getByText('Julie Agent').first();
      const ticketVisible = await ticketRow.isVisible({ timeout: 10000 }).catch(() => false);
      test.skip(!ticketVisible, 'Julie\'s ticket not in support queue');

      // Click to select/preview, then join to enter socket room + open tab
      await ticketRow.click();
      await supportPage.waitForTimeout(1500);

      // Join button should appear in preview (even for pre-assigned tickets,
      // since this browser session hasn't emitted support:join yet)
      const joinBtn = supportPage.getByText(/join|jump in/i).first();
      if (await joinBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
        await joinBtn.click();
        await supportPage.waitForTimeout(3000);
      }

      // Wait for compose editor
      const supportEditor = supportPage.locator('.ProseMirror, [contenteditable]').first();
      const editorReady = await supportEditor.isVisible({ timeout: 10000 }).catch(() => false);
      test.skip(!editorReady, 'Support editor not visible — ticket may not show Join for assigned support');
      if (editorReady) {
        await supportEditor.click();
        const replyMsg = `Support reply ${Date.now()}`;
        await supportPage.keyboard.type(replyMsg);

        const sendBtn = supportPage.locator('button').filter({ hasText: /send|verzend/i }).first();
        if (await sendBtn.isVisible({ timeout: 2000 })) {
          await sendBtn.click();
          await supportPage.waitForTimeout(2000);
        }

        // Agent should see support's reply
        const replyVisible = await agentPage.getByText(replyMsg).isVisible({ timeout: 10000 }).catch(() => false);
        expect(replyVisible).toBeTruthy();
      }
    } finally {
      await agentCtx.close();
      await supportCtx.close();
    }
  });

  test('closing ticket shows rating modal and returns to form', async ({ browser }) => {
    // Bundle D: same multi-context fragility — see fixme above.
    test.fixme();

    const agentCtx = await browser.newContext();
    const supportCtx = await browser.newContext();
    const agentPage = await agentCtx.newPage();
    const supportPage = await supportCtx.newPage();

    try {
      const agentRes = await loginAsDemo(agentPage, 'agent_julie');
      const supportRes = await loginAsDemo(supportPage, 'support_lucas');
      test.skip(!agentRes.ok || !supportRes.ok, 'Seed users not available');

      await agentPage.waitForTimeout(3000);
      await supportPage.waitForTimeout(3000);

      // Support must be in the ticket (from previous test or already joined)
      const supportEditor = supportPage.locator('.ProseMirror, [contenteditable]').first();
      const supportInChat = await supportEditor.isVisible({ timeout: 5000 }).catch(() => false);

      if (!supportInChat) {
        // Try to join Julie's ticket
        const ticketRow = supportPage.getByText('Julie Agent').first();
        if (await ticketRow.isVisible({ timeout: 5000 })) {
          await ticketRow.click();
          await supportPage.waitForTimeout(1000);
          const joinBtn = supportPage.getByText(/join|jump in/i).first();
          if (await joinBtn.isVisible({ timeout: 3000 })) {
            await joinBtn.click();
            await supportPage.waitForTimeout(2000);
          }
        }
      }

      // Support closes the ticket
      const closed = await closeCurrentTicket(supportPage);
      test.skip(!closed, 'Could not close ticket from support');

      // Agent should see rating modal or return to ticket form
      await agentPage.waitForTimeout(3000);
      const ratingModal = agentPage.getByText(/rate|beoordeel|how was/i).first();
      const ticketForm = agentPage.getByText(/Dispatch|DSC/i).first();
      const ratingVisible = await ratingModal.isVisible({ timeout: 8000 }).catch(() => false);
      const formVisible = await ticketForm.isVisible({ timeout: 3000 }).catch(() => false);

      // Either rating modal shows or we're back at the form (both indicate close worked)
      expect(ratingVisible || formVisible).toBeTruthy();
    } finally {
      await agentCtx.close();
      await supportCtx.close();
    }
  });
});
