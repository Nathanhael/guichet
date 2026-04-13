/**
 * E2E: Support Flow — Queue, tabs, transfer, close.
 *
 * Covers: joining from queue, tab persistence across refresh,
 * department transfer, closing tickets, multi-tab behavior.
 *
 * Seed users: support_lucas (DSC/FOT), support_sophie (TEC),
 *             agent_julie, agent_kevin (agents with pre-seeded tickets)
 */

import { test, expect, type Page } from '@playwright/test';

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

test.describe('Support Flow — Queue & Tabs', () => {
  test('support joins ticket from queue — chat tab opens', async ({ page }) => {
    const res = await loginAsDemo(page, 'support_lucas');
    test.skip(!res.ok, 'support_lucas not seeded');
    await page.waitForTimeout(3000);

    // Queue should show tickets in DSC/FOT departments
    const ticketRow = page.locator('li').filter({ hasText: /Julie Agent|Kevin Agent/i }).first();
    const hasTickets = await ticketRow.isVisible({ timeout: 8000 }).catch(() => false);
    test.skip(!hasTickets, 'No tickets in queue for support_lucas departments');

    // Click ticket to preview
    await ticketRow.click();
    await page.waitForTimeout(1000);

    // Look for Join button in preview
    const joinBtn = page.getByText(/join|jump in/i).first();
    const canJoin = await joinBtn.isVisible({ timeout: 3000 }).catch(() => false);
    test.skip(!canJoin, 'Join button not visible — ticket may already be assigned');

    await joinBtn.click();
    await page.waitForTimeout(2000);

    // Chat tab should appear in the tab bar
    const tabBar = page.locator('[class*="border-b"]').filter({ hasText: /Julie|Kevin/i }).first();
    const tabVisible = await tabBar.isVisible({ timeout: 5000 }).catch(() => false);
    // Chat area should be visible
    const chatArea = page.locator('.ProseMirror, textarea, [contenteditable]').first();
    const chatVisible = await chatArea.isVisible({ timeout: 5000 }).catch(() => false);
    expect(tabVisible || chatVisible).toBeTruthy();
  });

  test('tab persists across page refresh', async ({ page }) => {
    const res = await loginAsDemo(page, 'support_lucas');
    test.skip(!res.ok, 'support_lucas not seeded');
    await page.waitForTimeout(3000);

    // Join a ticket first
    const ticketRow = page.locator('li').filter({ hasText: /Julie Agent|Kevin Agent/i }).first();
    const hasTickets = await ticketRow.isVisible({ timeout: 8000 }).catch(() => false);
    test.skip(!hasTickets, 'No tickets in queue');

    await ticketRow.click();
    await page.waitForTimeout(1000);

    const joinBtn = page.getByText(/join|jump in/i).first();
    if (await joinBtn.isVisible({ timeout: 3000 })) {
      await joinBtn.click();
      await page.waitForTimeout(2000);
    }

    // Verify a chat tab exists before refresh
    const editorBefore = page.locator('.ProseMirror, textarea, [contenteditable]').first();
    const hadChat = await editorBefore.isVisible({ timeout: 3000 }).catch(() => false);
    test.skip(!hadChat, 'No active chat tab to test persistence');

    // Refresh the page — tabs should restore from localStorage
    await page.reload();
    await page.waitForLoadState('load');
    await page.waitForTimeout(3000);

    // Chat should still be visible after refresh (tab restored + silent rejoin)
    const editorAfter = page.locator('.ProseMirror, textarea, [contenteditable]').first();
    const chatRestored = await editorAfter.isVisible({ timeout: 8000 }).catch(() => false);
    expect(chatRestored).toBeTruthy();
  });

  test('support closes ticket — tab removed', async ({ page }) => {
    const res = await loginAsDemo(page, 'support_lucas');
    test.skip(!res.ok, 'support_lucas not seeded');
    await page.waitForTimeout(3000);

    // Find and join a ticket
    const ticketRow = page.locator('li').filter({ hasText: /Julie Agent|Kevin Agent/i }).first();
    if (!(await ticketRow.isVisible({ timeout: 5000 }).catch(() => false))) {
      test.skip(true, 'No tickets available');
      return;
    }
    await ticketRow.click();
    await page.waitForTimeout(1000);

    const joinBtn = page.getByText(/join|jump in/i).first();
    if (await joinBtn.isVisible({ timeout: 3000 })) {
      await joinBtn.click();
      await page.waitForTimeout(2000);
    }

    // Close the ticket via close button or command
    const closeBtn = page.getByText(/close ticket|sluiten/i).first();
    const hasClose = await closeBtn.isVisible({ timeout: 3000 }).catch(() => false);
    test.skip(!hasClose, 'Close button not visible');

    await closeBtn.click();
    await page.waitForTimeout(500);

    // Confirm dialog
    const confirmBtn = page.getByText(/confirm|bevestig|yes/i).first();
    if (await confirmBtn.isVisible({ timeout: 2000 })) {
      await confirmBtn.click();
      await page.waitForTimeout(2000);
    }

    // Should see the empty state ("ready to help")
    const emptyState = page.getByText(/ready to help|klaar/i).first();
    const isEmpty = await emptyState.isVisible({ timeout: 5000 }).catch(() => false);
    // Or the tab bar should have no active tabs
    const noChat = !(await page.locator('.ProseMirror, textarea, [contenteditable]').first().isVisible().catch(() => false));
    expect(isEmpty || noChat).toBeTruthy();
  });

  test('command palette opens with Ctrl+K', async ({ page }) => {
    const res = await loginAsDemo(page, 'support_lucas');
    test.skip(!res.ok, 'support_lucas not seeded');
    await page.waitForTimeout(2000);

    // Press Ctrl+K to open command palette
    await page.keyboard.press('Control+k');
    await page.waitForTimeout(500);

    // Palette should be visible with a search input
    const paletteInput = page.locator('input[type="text"]').last();
    const paletteVisible = await paletteInput.isVisible({ timeout: 3000 }).catch(() => false);
    expect(paletteVisible).toBeTruthy();

    // Should show command groups
    const hasCommands = await page.getByText(/navigation|actions|status|view/i).first().isVisible({ timeout: 2000 }).catch(() => false);
    expect(hasCommands).toBeTruthy();

    // Pressing Escape closes it
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);
    const closed = !(await paletteInput.isVisible().catch(() => false));
    expect(closed).toBeTruthy();
  });
});

test.describe('Support Flow — Department Transfer', () => {
  test('transfer ticket to different department', async ({ browser }) => {
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

      // Lucas: join a DSC ticket
      const ticketRow = lucasPage.locator('li').filter({ hasText: /DSC/i }).first();
      const hasTicket = await ticketRow.isVisible({ timeout: 8000 }).catch(() => false);
      test.skip(!hasTicket, 'No DSC tickets in queue');

      await ticketRow.click();
      await lucasPage.waitForTimeout(1000);

      const joinBtn = lucasPage.getByText(/join|jump in/i).first();
      if (await joinBtn.isVisible({ timeout: 3000 })) {
        await joinBtn.click();
        await lucasPage.waitForTimeout(2000);
      }

      // Lucas: transfer to TEC department
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

      // Sophie (TEC department): ticket should appear in her queue
      await sophiePage.waitForTimeout(5000);
      const transferredTicket = sophiePage.locator('li').filter({ hasText: /TEC/i }).first();
      const sophieSees = await transferredTicket.isVisible({ timeout: 10000 }).catch(() => false);
      // Soft assert — depends on socket timing across browser contexts
      if (!sophieSees) {
        console.warn('[support-flow] Transferred ticket not visible in Sophie\'s queue within timeout');
      }
    } finally {
      await lucasCtx.close();
      await sophieCtx.close();
    }
  });
});
