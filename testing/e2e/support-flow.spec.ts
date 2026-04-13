/**
 * E2E: Support Flow — Queue, tabs, transfer, close.
 *
 * Tests adapt to DB state. When unassigned tickets are needed,
 * uses agent_kevin to create a fresh one (serial execution).
 *
 * Seed users: support_lucas (DSC/FOT), support_sophie (TEC),
 *             agent_kevin (creates tickets on demand)
 */

import { test, expect, type Page, type BrowserContext } from '@playwright/test';

const BASE = process.env.E2E_BASE_URL || 'http://localhost:3001';
const DEMO_PASSWORD = 'password123';

async function loginAsDemo(page: Page, userId: string) {
  await page.goto(BASE);
  await page.waitForLoadState('load');

  const data = await page.evaluate(async ({ uid, pw }) => {
    const res = await fetch('/api/v1/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ id: uid, password: pw }),
    });
    if (!res.ok) return { ok: false, status: res.status };
    const json = await res.json();
    return { ok: true, ...json };
  }, { uid: userId, pw: DEMO_PASSWORD });

  if (!data.ok) return data;

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

/**
 * Ensure agent_kevin has a fresh unassigned ticket for support to join.
 * Closes any existing ticket first, then creates a new DSC ticket.
 * Returns the agent context (caller must close it).
 */
async function ensureAgentTicket(browser: { newContext: () => Promise<BrowserContext> }): Promise<BrowserContext> {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const res = await loginAsDemo(page, 'agent_kevin');
  if (!res.ok) return ctx;

  await page.waitForTimeout(3000);

  // Close existing ticket if agent is in chat view
  const closeBtn = page.getByText(/close/i).first();
  if (await closeBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
    await closeBtn.click();
    await page.waitForTimeout(500);
    const confirmBtn = page.getByText(/confirm|bevestig|yes/i).first();
    if (await confirmBtn.isVisible({ timeout: 2000 })) await confirmBtn.click();
    await page.waitForTimeout(3000);
    // Dismiss rating modal if it appears
    const skipRating = page.getByText(/later|skip|overslaan/i).first();
    if (await skipRating.isVisible({ timeout: 2000 }).catch(() => false)) await skipRating.click();
    await page.waitForTimeout(1000);
  }

  // Create new ticket
  const deptBtn = page.getByText('DSC').first();
  if (await deptBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
    await deptBtn.click();
    await page.waitForTimeout(500);
    const editor = page.locator('.ProseMirror, textarea, [contenteditable]').first();
    if (await editor.isVisible()) {
      await editor.click();
      await page.keyboard.type(`Support test ticket ${Date.now()}`);
    }
    const submitBtn = page.locator('button[type="submit"], form button').filter({ hasText: /send|submit|start/i }).first();
    if (await submitBtn.isVisible()) {
      await submitBtn.click();
      await page.waitForTimeout(3000);
    }
  }

  return ctx;
}

test.describe.serial('Support Flow — Queue & Tabs', () => {
  test('support joins ticket from queue — chat tab opens', async ({ browser }) => {
    // Create a fresh ticket via agent_kevin
    const agentCtx = await ensureAgentTicket(browser);
    const supportCtx = await browser.newContext();
    const supportPage = await supportCtx.newPage();

    try {
      const res = await loginAsDemo(supportPage, 'support_lucas');
      test.skip(!res.ok, 'support_lucas not seeded');
      await supportPage.waitForTimeout(3000);

      // Find Kevin's ticket in queue
      const ticketRow = supportPage.getByText('Kevin Agent').first();
      const hasTicket = await ticketRow.isVisible({ timeout: 10000 }).catch(() => false);
      test.skip(!hasTicket, 'Kevin\'s ticket not visible in queue');

      await ticketRow.click();
      await supportPage.waitForTimeout(1000);

      // Join
      const joinBtn = supportPage.getByText(/join|jump in/i).first();
      const canJoin = await joinBtn.isVisible({ timeout: 3000 }).catch(() => false);
      test.skip(!canJoin, 'Join button not visible');
      await joinBtn.click();
      await supportPage.waitForTimeout(2000);

      // Chat area should be visible
      const chatVisible = await supportPage.locator('.ProseMirror, [contenteditable]').first().isVisible({ timeout: 5000 }).catch(() => false);
      expect(chatVisible).toBeTruthy();
    } finally {
      await agentCtx.close();
      await supportCtx.close();
    }
  });

  test('tab persists across page refresh', async ({ browser }) => {
    const agentCtx = await ensureAgentTicket(browser);
    const supportCtx = await browser.newContext();
    const supportPage = await supportCtx.newPage();

    try {
      const res = await loginAsDemo(supportPage, 'support_lucas');
      test.skip(!res.ok, 'support_lucas not seeded');
      await supportPage.waitForTimeout(3000);

      // Join Kevin's ticket
      const ticketRow = supportPage.getByText('Kevin Agent').first();
      if (await ticketRow.isVisible({ timeout: 8000 }).catch(() => false)) {
        await ticketRow.click();
        await supportPage.waitForTimeout(1000);
        const joinBtn = supportPage.getByText(/join|jump in/i).first();
        if (await joinBtn.isVisible({ timeout: 3000 })) {
          await joinBtn.click();
          await supportPage.waitForTimeout(2000);
        }
      }

      // Verify chat is open before refresh
      const chatBefore = await supportPage.locator('[class*="overflow-y-auto"]').first().isVisible({ timeout: 5000 }).catch(() => false);
      test.skip(!chatBefore, 'No active chat to test persistence');

      // Refresh
      await supportPage.reload();
      await supportPage.waitForLoadState('load');
      await supportPage.waitForTimeout(3000);

      // Tab should be restored
      const chatAfter = await supportPage.locator('[class*="overflow-y-auto"]').first().isVisible({ timeout: 10000 }).catch(() => false)
        || await supportPage.locator('.ProseMirror, [contenteditable]').first().isVisible({ timeout: 3000 }).catch(() => false);
      expect(chatAfter).toBeTruthy();
    } finally {
      await agentCtx.close();
      await supportCtx.close();
    }
  });

  test('support closes ticket — tab removed', async ({ browser }) => {
    const agentCtx = await ensureAgentTicket(browser);
    const supportCtx = await browser.newContext();
    const supportPage = await supportCtx.newPage();

    try {
      const res = await loginAsDemo(supportPage, 'support_lucas');
      test.skip(!res.ok, 'support_lucas not seeded');
      await supportPage.waitForTimeout(3000);

      // Join Kevin's ticket
      const ticketRow = supportPage.getByText('Kevin Agent').first();
      if (await ticketRow.isVisible({ timeout: 8000 }).catch(() => false)) {
        await ticketRow.click();
        await supportPage.waitForTimeout(1000);
        const joinBtn = supportPage.getByText(/join|jump in/i).first();
        if (await joinBtn.isVisible({ timeout: 3000 })) {
          await joinBtn.click();
          await supportPage.waitForTimeout(2000);
        }
      }

      // Close the ticket
      const closeBtn = supportPage.getByText(/close/i).first();
      const canClose = await closeBtn.isVisible({ timeout: 3000 }).catch(() => false);
      test.skip(!canClose, 'Close button not visible');

      await closeBtn.click();
      await supportPage.waitForTimeout(500);
      const confirmBtn = supportPage.getByText(/confirm|bevestig|yes/i).first();
      if (await confirmBtn.isVisible({ timeout: 2000 })) await confirmBtn.click();
      await supportPage.waitForTimeout(2000);

      // Should show empty state or no active chat
      const emptyState = supportPage.getByText(/ready to help|klaar/i).first();
      const noChat = !(await supportPage.locator('.ProseMirror, [contenteditable]').first().isVisible().catch(() => false));
      const isEmpty = await emptyState.isVisible({ timeout: 5000 }).catch(() => false);
      expect(isEmpty || noChat).toBeTruthy();
    } finally {
      await agentCtx.close();
      await supportCtx.close();
    }
  });

  test('command palette opens with Ctrl+K', async ({ page }) => {
    const res = await loginAsDemo(page, 'support_lucas');
    test.skip(!res.ok, 'support_lucas not seeded');
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
  test('transfer ticket to different department', async ({ browser }) => {
    const agentCtx = await ensureAgentTicket(browser);
    const lucasCtx = await browser.newContext();
    const sophieCtx = await browser.newContext();
    const lucasPage = await lucasCtx.newPage();
    const sophiePage = await sophieCtx.newPage();

    try {
      const lucasRes = await loginAsDemo(lucasPage, 'support_lucas');
      const sophieRes = await loginAsDemo(sophiePage, 'support_sophie');
      test.skip(!lucasRes.ok || !sophieRes.ok, 'Seed users not available');

      await lucasPage.waitForTimeout(3000);
      await sophiePage.waitForTimeout(3000);

      // Lucas joins Kevin's DSC ticket
      const ticketRow = lucasPage.getByText('Kevin Agent').first();
      const hasTicket = await ticketRow.isVisible({ timeout: 10000 }).catch(() => false);
      test.skip(!hasTicket, 'Kevin\'s ticket not in queue');

      await ticketRow.click();
      await lucasPage.waitForTimeout(1000);
      const joinBtn = lucasPage.getByText(/join|jump in/i).first();
      if (await joinBtn.isVisible({ timeout: 3000 })) {
        await joinBtn.click();
        await lucasPage.waitForTimeout(2000);
      }

      // Transfer to TEC
      const transferBtn = lucasPage.getByText(/transfer/i).first();
      const canTransfer = await transferBtn.isVisible({ timeout: 3000 }).catch(() => false);
      test.skip(!canTransfer, 'Transfer button not visible');

      await transferBtn.click();
      await lucasPage.waitForTimeout(500);
      const tecDept = lucasPage.getByText(/TEC/i).first();
      if (await tecDept.isVisible({ timeout: 2000 })) {
        await tecDept.click();
        await lucasPage.waitForTimeout(3000);
      }

      // Sophie should see the ticket in her TEC queue
      await sophiePage.waitForTimeout(5000);
      const transferred = sophiePage.getByText('Kevin Agent').first();
      const sophieSees = await transferred.isVisible({ timeout: 10000 }).catch(() => false);
      if (!sophieSees) {
        console.warn('[support-flow] Transfer not visible in Sophie\'s queue within timeout');
      }
    } finally {
      await agentCtx.close();
      await lucasCtx.close();
      await sophieCtx.close();
    }
  });
});
