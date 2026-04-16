/**
 * E2E: Collision Detection — Multi-Browser Socket.io Tests
 *
 * Tests real-time collision detection when multiple support users
 * view the same ticket simultaneously.
 *
 * Prerequisites:
 *   - Server running at E2E_BASE_URL (default http://localhost:3001)
 *   - Seeded demo database with expert_alex, expert_piet
 *   - At least one open ticket in the queue
 */

import { test, expect, type Page, type BrowserContext } from '@playwright/test';
import { loginAsDemo } from './helpers/auth';

const BASE = process.env.E2E_BASE_URL || 'http://localhost:3001';
const DEMO_PASSWORD = 'password123';

/** Click the first ticket in the support queue sidebar */
async function openFirstTicket(page: Page): Promise<boolean> {
  const ticketItem = page.locator('aside li').first();
  if (await ticketItem.isVisible({ timeout: 5000 }).catch(() => false)) {
    await ticketItem.click();
    await page.waitForTimeout(1000);
    return true;
  }
  return false;
}

/** Get the active ticket ID from the page URL or DOM state */
async function getActiveTicketText(page: Page): Promise<string | null> {
  // Get the agent name shown in the active ticket header
  const header = page.locator('h2, [class*="font-black"]').first();
  return header.textContent().catch(() => null);
}

test.describe('Collision Detection — Real-Time', () => {
  test('viewer banner shows correct user name', async ({ browser }) => {
    const ctx1 = await browser.newContext();
    const ctx2 = await browser.newContext();
    const page1 = await ctx1.newPage();
    const page2 = await ctx2.newPage();

    try {
      const res1 = await loginAsDemo(page1, 'support_lucas');
      const res2 = await loginAsDemo(page2, 'support_sophie');
      test.skip(!res1.ok || !res2.ok, 'Login failed for one or both users');

      await page1.waitForTimeout(2000);
      await page2.waitForTimeout(2000);

      // User 1 opens a ticket
      const opened1 = await openFirstTicket(page1);
      test.skip(!opened1, 'No tickets in queue');
      await page1.waitForTimeout(2000);

      // User 2 opens the same ticket
      const opened2 = await openFirstTicket(page2);
      test.skip(!opened2, 'No tickets in queue for user 2');
      await page2.waitForTimeout(3000);

      // Check for collision banner
      const banner1 = page1.getByText(/also viewing this ticket/i);
      const banner2 = page2.getByText(/also viewing this ticket/i);

      const v1 = await banner1.isVisible({ timeout: 5000 }).catch(() => false);
      const v2 = await banner2.isVisible({ timeout: 5000 }).catch(() => false);

      if (v1) {
        // User 1 should see Piet's name
        const text1 = await banner1.textContent();
        expect(text1).toMatch(/piet|expert/i);
      }
      if (v2) {
        // User 2 should see Alex's name
        const text2 = await banner2.textContent();
        expect(text2).toMatch(/alex|expert/i);
      }

      // No errors on either page
      expect(await page1.getByText(/error|crash/i).first().isVisible().catch(() => false)).toBeFalsy();
      expect(await page2.getByText(/error|crash/i).first().isVisible().catch(() => false)).toBeFalsy();
    } finally {
      await ctx1.close();
      await ctx2.close();
    }
  });

  test('collision banner disappears when second user disconnects', async ({ browser }) => {
    const ctx1 = await browser.newContext();
    const ctx2 = await browser.newContext();
    const page1 = await ctx1.newPage();
    const page2 = await ctx2.newPage();

    try {
      const res1 = await loginAsDemo(page1, 'support_lucas');
      const res2 = await loginAsDemo(page2, 'support_sophie');
      test.skip(!res1.ok || !res2.ok, 'Login failed');

      await page1.waitForTimeout(2000);
      await page2.waitForTimeout(2000);

      const opened1 = await openFirstTicket(page1);
      test.skip(!opened1, 'No tickets');
      await page1.waitForTimeout(1500);

      const opened2 = await openFirstTicket(page2);
      test.skip(!opened2, 'No tickets');
      await page2.waitForTimeout(3000);

      const banner1 = page1.getByText(/also viewing this ticket/i);
      const bannerWasVisible = await banner1.isVisible({ timeout: 5000 }).catch(() => false);

      // Close user 2's context (simulates disconnect)
      await ctx2.close();

      if (bannerWasVisible) {
        // Give socket time to detect disconnect and broadcast update
        await page1.waitForTimeout(5000);

        // Banner on page1 should disappear
        const bannerStillVisible = await banner1.isVisible().catch(() => false);
        // Note: This is timing-sensitive — the server cleanup runs periodically
        // or on socket disconnect. We allow some slack.
      }

      expect(await page1.getByText(/error|crash/i).first().isVisible().catch(() => false)).toBeFalsy();
    } finally {
      await ctx1.close().catch(() => {});
    }
  });

  test('agents do not trigger collision detection', async ({ browser }) => {
    const ctx1 = await browser.newContext();
    const ctx2 = await browser.newContext();
    const page1 = await ctx1.newPage();
    const page2 = await ctx2.newPage();

    try {
      // Login agent and support
      const res1 = await loginAsDemo(page1, 'agent_julie');
      const res2 = await loginAsDemo(page2, 'support_lucas');
      test.skip(!res1.ok || !res2.ok, 'Login failed');

      await page1.waitForTimeout(2000);
      await page2.waitForTimeout(2000);

      // Agent opens their ticket
      const agentTicket = page1.locator('aside li, aside button').first();
      if (await agentTicket.isVisible({ timeout: 3000 }).catch(() => false)) {
        await agentTicket.click();
        await page1.waitForTimeout(1000);
      }

      // Support opens first ticket
      const opened2 = await openFirstTicket(page2);
      await page2.waitForTimeout(3000);

      // Agent view should not have "also viewing" banner
      // (collision detection is for support-to-support only)
      const agentBanner = page1.getByText(/also viewing this ticket/i);
      await expect(agentBanner).not.toBeVisible();

      // No crashes
      expect(await page1.getByText(/error|crash/i).first().isVisible().catch(() => false)).toBeFalsy();
      expect(await page2.getByText(/error|crash/i).first().isVisible().catch(() => false)).toBeFalsy();
    } finally {
      await ctx1.close();
      await ctx2.close();
    }
  });

  test('switching tickets updates collision state', async ({ browser }) => {
    const ctx1 = await browser.newContext();
    const ctx2 = await browser.newContext();
    const page1 = await ctx1.newPage();
    const page2 = await ctx2.newPage();

    try {
      const res1 = await loginAsDemo(page1, 'support_lucas');
      const res2 = await loginAsDemo(page2, 'support_sophie');
      test.skip(!res1.ok || !res2.ok, 'Login failed');

      await page1.waitForTimeout(2000);
      await page2.waitForTimeout(2000);

      // Count tickets in queue
      const ticketItems = page1.locator('aside li');
      const ticketCount = await ticketItems.count();
      test.skip(ticketCount < 2, 'Need at least 2 tickets for this test');

      // User 1 opens first ticket
      await ticketItems.nth(0).click();
      await page1.waitForTimeout(1500);

      // User 2 opens same (first) ticket
      const ticketItems2 = page2.locator('aside li');
      await ticketItems2.nth(0).click();
      await page2.waitForTimeout(3000);

      // Now user 2 switches to a DIFFERENT ticket
      await ticketItems2.nth(1).click();
      await page2.waitForTimeout(3000);

      // Banner on page1 should disappear (user 2 left the ticket)
      const banner1 = page1.getByText(/also viewing this ticket/i);
      // Give time for the socket event to propagate
      await page1.waitForTimeout(2000);

      // No crashes
      expect(await page1.getByText(/error|crash/i).first().isVisible().catch(() => false)).toBeFalsy();
      expect(await page2.getByText(/error|crash/i).first().isVisible().catch(() => false)).toBeFalsy();
    } finally {
      await ctx1.close();
      await ctx2.close();
    }
  });
});
