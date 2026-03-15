import { test, expect } from '../fixtures/auth.fixture.js';

test.describe('Admin Dashboard', () => {
  test('admin sees dashboard with navigation tabs', async ({ loginAs, page }) => {
    await loginAs('adminA');

    // Dashboard tab should be visible
    await expect(page.locator('text=Dashboard')).toBeVisible({ timeout: 15000 });

    // Stats area should render (grid with cards)
    const statsArea = page.locator('[class*="grid"]').first();
    await expect(statsArea).toBeVisible({ timeout: 10000 });
  });

  test('admin can navigate between tabs', async ({ loginAs, page }) => {
    await loginAs('adminA');
    await expect(page.locator('text=Dashboard')).toBeVisible({ timeout: 15000 });

    // Click AI Insights tab
    const aiTab = page.locator('button').filter({ hasText: /AI Insights/i });
    if (await aiTab.isVisible({ timeout: 5000 })) {
      await aiTab.click();
      // Page should not crash - content area updates
      await page.waitForTimeout(1000);
    }

    // Click Active Tickets tab
    const ticketsTab = page.locator('button').filter({ hasText: /Tickets|Active/i }).first();
    if (await ticketsTab.isVisible({ timeout: 5000 })) {
      await ticketsTab.click();
      await page.waitForTimeout(1000);
    }

    // Click Feedback tab
    const feedbackTab = page.locator('button').filter({ hasText: /Feedback/i });
    if (await feedbackTab.isVisible({ timeout: 5000 })) {
      await feedbackTab.click();
      await page.waitForTimeout(1000);
    }

    // Navigate back to Dashboard
    await page.locator('button').filter({ hasText: /Dashboard/i }).first().click();
    await expect(page.locator('text=Dashboard')).toBeVisible({ timeout: 5000 });
  });

  test('non-admin cannot see admin dashboard', async ({ loginAs, page }) => {
    await loginAs('agentA');

    // Agent should see the ticket form, not the dashboard
    await expect(page.locator('form')).toBeVisible({ timeout: 15000 });
    await expect(page.locator('button').filter({ hasText: /AI Insights/i })).not.toBeVisible();
  });
});
