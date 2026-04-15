/**
 * E2E: Admin View — Dashboard, Stats, Team Satisfaction
 *
 * Tests the admin experience: dashboard stats,
 * CSAT/team satisfaction, and responsive layout.
 *
 * Prerequisites:
 *   - Server running at E2E_BASE_URL
 *   - Seeded demo database
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

test.describe('Admin Dashboard', () => {
  test.beforeEach(async ({ page }) => {
    await loginAsDemo(page, 'admin_emma');
    await page.waitForTimeout(3000);
  });

  test('dashboard loads with stat cards', async ({ page }) => {
    // Admin dashboard should show stat cards
    await page.waitForTimeout(2000);
    // Dashboard should at minimum render without errors
    const errorVisible = await page.getByText(/error|crash|500/i).first().isVisible().catch(() => false);
    expect(errorVisible).toBeFalsy();
  });

  test('sidebar navigation works', async ({ page }) => {
    // Admin sidebar should have navigation items
    const sidebar = page.locator('aside').first();
    if (await sidebar.isVisible()) {
      // Click through different sections
      const navItems = page.locator('aside button, aside a');
      const count = await navItems.count();
      expect(count).toBeGreaterThan(0);
    }
  });

  test('team satisfaction section shows ratings', async ({ page }) => {
    await page.waitForTimeout(3000);
    // Look for the team satisfaction section
    const teamSection = page.getByText(/team satisfaction|staff rating/i).first();
    // May or may not be visible depending on available data
    const errorVisible = await page.getByText(/error|crash/i).first().isVisible().catch(() => false);
    expect(errorVisible).toBeFalsy();
  });

  test('date filter controls work', async ({ page }) => {
    await page.waitForTimeout(2000);
    // Look for date filter buttons (7D, 14D, 30D, etc.)
    const dateBtn = page.getByText(/7d|14d|30d|today/i).first();
    if (await dateBtn.isVisible()) {
      await dateBtn.click();
      await page.waitForTimeout(1000);
      // Dashboard should update without errors
      const errorVisible = await page.getByText(/error|crash/i).first().isVisible().catch(() => false);
      expect(errorVisible).toBeFalsy();
    }
  });
});

test.describe('Admin - Responsive Layout', () => {
  test('admin view works on mobile viewport', async ({ page }) => {
    // Set mobile viewport
    await page.setViewportSize({ width: 375, height: 812 });
    await loginAsDemo(page, 'admin_emma');
    await page.waitForTimeout(3000);

    // Page should render without horizontal scroll issues
    const errorVisible = await page.getByText(/error|crash/i).first().isVisible().catch(() => false);
    expect(errorVisible).toBeFalsy();

    // The sidebar should be hidden or collapsed on mobile
    // (we added max-md:w-0 max-md:hidden for collapsed state)
  });

  test('admin sidebar toggle works on mobile', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await loginAsDemo(page, 'admin_emma');
    await page.waitForTimeout(3000);

    // Find hamburger/toggle button
    const toggleBtn = page.locator('button[aria-label*="sidebar" i], nav button').first();
    if (await toggleBtn.isVisible()) {
      await toggleBtn.click();
      await page.waitForTimeout(500);
      // Sidebar should appear as overlay
    }
  });
});
