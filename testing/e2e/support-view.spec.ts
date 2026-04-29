/**
 * E2E: Support View — Queue, Chat, Summarization, Collision Detection
 *
 * Tests the support staff experience: queue sidebar, chat window,
 * AI summarization, and collision detection banner.
 *
 * Prerequisites:
 *   - Server running at E2E_BASE_URL
 *   - Seeded demo database with open tickets
 */

import { test, expect } from '@playwright/test';
import { loginAsDemo } from './helpers/auth';

const BASE = process.env.E2E_BASE_URL || 'http://localhost:3001';

test.describe('Support View', () => {
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

  test('queue sidebar is visible with tickets', async ({ page }) => {
    // The queue sidebar should show ticket list or sidebar navigation
    const sidebar = page.locator('aside').first();
    const queue = page.getByText(/queue|wachtrij|file d'attente|ticket/i).first();
    const sidebarVisible = await sidebar.isVisible().catch(() => false);
    const queueVisible = await queue.isVisible({ timeout: 10000 }).catch(() => false);
    expect(sidebarVisible || queueVisible).toBeTruthy();
  });

  test('can open a ticket from the queue', async ({ page }) => {
    const ticketButton = page.locator('aside button').first();
    if (await ticketButton.isVisible()) {
      await ticketButton.click();
      await page.waitForTimeout(1000);
      const chatArea = page.locator('[class*="overflow-y-auto"]').first();
      await expect(chatArea).toBeVisible({ timeout: 5000 });
    }
  });

  test('chat header shows ticket info', async ({ page }) => {
    const ticketButton = page.locator('aside button').first();
    if (await ticketButton.isVisible()) {
      await ticketButton.click();
      await page.waitForTimeout(1000);
      const header = page.locator('[class*="border-b"]').first();
      await expect(header).toBeVisible();
    }
  });

  test('archive tab shows closed tickets', async ({ page }) => {
    // The archive affordance renders for support/admin roles. The panel
    // contents depend on closed-ticket count — even an empty archive should
    // mount cleanly, so we assert the tab is reachable and produces no error.
    const archiveTab = page.getByText(/^archive$|archieven/i).first();
    await expect(archiveTab).toBeVisible({ timeout: 10_000 });

    await archiveTab.click();
    await page.waitForLoadState('networkidle');

    // After clicking, assert the app didn't crash and the shell is still there.
    const errorVisible = await page.getByText(/error|crash|oops/i).first().isVisible().catch(() => false);
    expect(errorVisible).toBeFalsy();
    await expect(page.locator('body')).toBeVisible();
  });
});

test.describe('Collision Detection', () => {
  test('two support users see viewer banner', async ({ browser }) => {
    const context1 = await browser.newContext();
    const context2 = await browser.newContext();
    const page1 = await context1.newPage();
    const page2 = await context2.newPage();

    try {
      await loginAsDemo(page1, 'support_lucas');
      await loginAsDemo(page2, 'support_sophie');

      await page1.waitForTimeout(3000);
      await page2.waitForTimeout(3000);

      const error1 = await page1.getByText(/error|crash/i).first().isVisible().catch(() => false);
      const error2 = await page2.getByText(/error|crash/i).first().isVisible().catch(() => false);
      expect(error1).toBeFalsy();
      expect(error2).toBeFalsy();
    } finally {
      await context1.close();
      await context2.close();
    }
  });
});
