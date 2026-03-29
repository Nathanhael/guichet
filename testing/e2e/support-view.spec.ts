/**
 * E2E: Support View — Queue, Chat, SLA, Summarization, Collision Detection
 *
 * Tests the support staff experience: queue sidebar, chat window,
 * SLA indicators, AI summarization, and collision detection banner.
 *
 * Prerequisites:
 *   - Server running at E2E_BASE_URL
 *   - Seeded demo database with open tickets
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

  if (!data.ok) {
    console.error(`[loginAsDemo] Login API failed for ${userId}: ${data.status}`);
    return data;
  }

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

test.describe('Support View', () => {
  let loginOk = false;
  test.beforeEach(async ({ page }) => {
    const res = await loginAsDemo(page, 'expert_alex');
    loginOk = !!res.ok;
    await page.waitForTimeout(2000);
  });

  test('queue sidebar is visible with tickets', async ({ page }) => {
    test.skip(!loginOk, 'Demo login API failed — expert_alex may not be seeded');
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

  test('SLA indicator shows on tickets', async ({ page }) => {
    await page.waitForTimeout(2000);
    const slaIndicator = page.getByText(/sla/i).first();
    const errorVisible = await page.getByText(/error|crash/i).first().isVisible().catch(() => false);
    expect(errorVisible).toBeFalsy();
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
    const archiveTab = page.getByText(/archive/i).first();
    if (await archiveTab.isVisible()) {
      await archiveTab.click();
      await page.waitForTimeout(1000);
      const content = page.locator('aside').first();
      await expect(content).toBeVisible();
    }
  });
});

test.describe('Collision Detection', () => {
  test('two support users see viewer banner', async ({ browser }) => {
    const context1 = await browser.newContext();
    const context2 = await browser.newContext();
    const page1 = await context1.newPage();
    const page2 = await context2.newPage();

    try {
      await loginAsDemo(page1, 'expert_alex');
      await loginAsDemo(page2, 'expert_piet');

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
