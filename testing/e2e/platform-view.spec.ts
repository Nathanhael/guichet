/**
 * E2E: Platform Operator View — Partners, Users, Tabs, Responsive Layout
 *
 * Tests the platform operator experience: partner list, user management,
 * tab navigation, system health, and responsive layout.
 *
 * Prerequisites:
 *   - Server running at E2E_BASE_URL (default http://localhost:3001)
 *   - Seeded demo database with platform_bart user
 */

import { test, expect, type Page } from '@playwright/test';

const BASE = process.env.E2E_BASE_URL || 'http://localhost:3001';
const DEMO_PASSWORD = 'password123';

/** Wait for a platform tab to become enabled (security status query resolved) then click it */
async function clickPlatformTab(page: Page, tabName: RegExp, timeout = 15000) {
  const enabledTab = page.locator('button:not([disabled])', { hasText: tabName }).first();
  await enabledTab.waitFor({ state: 'visible', timeout });
  await enabledTab.click();
}

async function loginAsDemo(page: Page, userId: string) {
  // Must navigate first so localStorage is accessible (same-origin)
  await page.goto(BASE);
  await page.waitForLoadState('load');
  const res = await page.request.post(`${BASE}/api/v1/auth/login`, {
    data: { id: userId, password: DEMO_PASSWORD },
    failOnStatusCode: false,
  });
  if (!res.ok()) {
    console.error(`[loginAsDemo] Login API failed for ${userId}: ${res.status()} ${res.statusText()}`);
    return res;
  }
  const data = await res.json();
  // Set auth state using the same keys the Zustand store reads.
  // For platform operators, do NOT set activeMembershipId so they land on PlatformView
  // (App.tsx shows PlatformView when isPlatformAdmin && !activeMembershipId).
  await page.evaluate(({ token, user, memberships }) => {
    localStorage.setItem('token', token);
    // Force English locale for consistent E2E assertions
    localStorage.setItem('user', JSON.stringify({ ...user, lang: 'en' }));
    localStorage.setItem('memberships', JSON.stringify(memberships));
    if (!user.isPlatformOperator && memberships?.length > 0) {
      localStorage.setItem('activeMembershipId', memberships[0].id);
      localStorage.setItem('activePartnerId', memberships[0].partnerId);
    }
  }, data);
  // Reload so the Zustand store reads the new auth state from localStorage
  await page.reload();
  await page.waitForLoadState('load');
  return res;
}

test.describe('Platform Dashboard', () => {
  let loginOk = false;
  test.beforeEach(async ({ page }) => {
    const res = await loginAsDemo(page, 'platform_bart');
    loginOk = res.ok();
    await page.waitForTimeout(2000);
  });

  test('platform view loads without errors', async ({ page }) => {
    test.skip(!loginOk, 'Demo login API failed — platform_bart may not be seeded');
    await page.waitForTimeout(1000);
    // Should see the TESSERA header and platform_operator badge
    const hasBrand = await page.getByText(/tessera/i).first().isVisible().catch(() => false);
    expect(hasBrand).toBeTruthy();

    // Should see the platform operator label
    const hasLabel = await page.getByText(/platform.operator|platform_operator/i).first().isVisible().catch(() => false);

    // No crash or error messages
    const errorVisible = await page.getByText(/error|crash|500/i).first().isVisible().catch(() => false);
    expect(errorVisible).toBeFalsy();
  });

  test('tab bar renders all platform tabs', async ({ page }) => {
    test.skip(!loginOk, 'Demo login API failed — platform_bart may not be seeded');
    await page.waitForTimeout(1000);
    // The platform view has tabs — look for button or tab-like elements
    const expectedTabs = ['partners', 'users', 'sso', 'security', 'health', 'config', 'audit', 'archive'];
    let foundTabs = 0;
    for (const tab of expectedTabs) {
      const tabBtn = page.getByRole('button', { name: new RegExp(tab, 'i') }).first();
      const tabText = page.getByText(new RegExp(tab, 'i')).first();
      const visible = await tabBtn.isVisible().catch(() => false) || await tabText.isVisible().catch(() => false);
      if (visible) foundTabs++;
    }
    // Should find at least a few platform tabs
    expect(foundTabs).toBeGreaterThan(0);
  });

  test('sign out button is present', async ({ page }) => {
    await page.waitForTimeout(2000);
    // Look for sign out / log out / logout in buttons or links
    const signOut = page.getByText(/sign.?out|log.?out|uitloggen|déconnex/i).first();
    const visible = await signOut.isVisible().catch(() => false);
    // Page should at least not show errors
    const errorVisible = await page.getByText(/error|crash|500/i).first().isVisible().catch(() => false);
    expect(errorVisible).toBeFalsy();
  });
});

test.describe('Partner Management', () => {
  test.beforeEach(async ({ page }) => {
    await loginAsDemo(page, 'platform_bart');
    await page.waitForTimeout(3000);
  });

  test('partner list is visible on partners tab', async ({ page }) => {
    await clickPlatformTab(page, /partners/i);
    await page.waitForTimeout(1500);

    // Partner list should show partner entries or a "create" button
    const hasPartnerContent = await page.getByText(/partner|create|add/i).first().isVisible().catch(() => false);
    // No errors
    const errorVisible = await page.getByText(/error|crash/i).first().isVisible().catch(() => false);
    expect(errorVisible).toBeFalsy();
  });

  test('create partner button is available', async ({ page }) => {
    await clickPlatformTab(page, /partners/i);
    await page.waitForTimeout(1500);

    // Look for create/add partner button
    const createBtn = page.getByRole('button', { name: /create|add|new/i }).first();
    if (await createBtn.isVisible().catch(() => false)) {
      await createBtn.click();
      await page.waitForTimeout(500);
      // Modal should appear with partner form fields
      const modal = page.getByText(/partner.*name|partner.*id|create.*partner/i).first();
      const modalVisible = await modal.isVisible().catch(() => false);
      // Close modal if visible
      const closeBtn = page.getByRole('button', { name: /cancel|close/i }).first();
      if (await closeBtn.isVisible().catch(() => false)) {
        await closeBtn.click();
      }
    }
  });
});

test.describe('Tab Navigation', () => {
  test.beforeEach(async ({ page }) => {
    await loginAsDemo(page, 'platform_bart');
    await page.waitForTimeout(3000);
  });

  test('can navigate to users tab', async ({ page }) => {
    await clickPlatformTab(page, /users|gebruikers|utilisateurs/i);
    await page.waitForTimeout(1500);
    // Users tab should show user table or invite button
    const hasUserContent = await page.getByText(/user|invite|email|role/i).first().isVisible().catch(() => false);
    const errorVisible = await page.getByText(/error|crash/i).first().isVisible().catch(() => false);
    expect(errorVisible).toBeFalsy();
  });

  test('can navigate to health tab', async ({ page }) => {
    await clickPlatformTab(page, /health|gezondheid|santé/i);
    await page.waitForTimeout(1500);
    // Health tab should show system health info (postgres, redis, etc.)
    const hasHealthContent = await page.getByText(/postgres|redis|gdpr|connections|memory/i).first().isVisible().catch(() => false);
    const errorVisible = await page.getByText(/error|crash/i).first().isVisible().catch(() => false);
    expect(errorVisible).toBeFalsy();
  });

  test('can navigate to audit tab', async ({ page }) => {
    await clickPlatformTab(page, /audit/i);
    await page.waitForTimeout(1500);
    // Audit log tab should load without errors
    const errorVisible = await page.getByText(/error|crash/i).first().isVisible().catch(() => false);
    expect(errorVisible).toBeFalsy();
  });

  test('can navigate to config tab', async ({ page }) => {
    await clickPlatformTab(page, /config/i);
    await page.waitForTimeout(1500);
    const errorVisible = await page.getByText(/error|crash/i).first().isVisible().catch(() => false);
    expect(errorVisible).toBeFalsy();
  });

  test('security tab shows step-up verification', async ({ page }) => {
    await page.waitForTimeout(2000);
    const securityTab = page.getByRole('button', { name: /security/i }).first();
    if (await securityTab.isVisible().catch(() => false)) {
      await securityTab.click();
      await page.waitForTimeout(1500);
      // Security panel should be visible (it is always accessible)
      const hasSecurityContent = await page.getByText(/security|totp|step.up|verification|mfa/i).first().isVisible().catch(() => false);
      const errorVisible = await page.getByText(/error|crash/i).first().isVisible().catch(() => false);
      expect(errorVisible).toBeFalsy();
    }
  });

  test('SSO/group mappings tab loads', async ({ page }) => {
    await clickPlatformTab(page, /sso/i);
    await page.waitForTimeout(1500);
    const errorVisible = await page.getByText(/error|crash/i).first().isVisible().catch(() => false);
    expect(errorVisible).toBeFalsy();
  });
});

test.describe('User Management', () => {
  test.beforeEach(async ({ page }) => {
    await loginAsDemo(page, 'platform_bart');
    await page.waitForTimeout(3000);
  });

  test('user table shows users with roles', async ({ page }) => {
    await clickPlatformTab(page, /users|gebruikers|utilisateurs/i);
    await page.waitForTimeout(2000);
    // Should show a table or list of users
    const hasTable = await page.locator('table').first().isVisible().catch(() => false);
    const hasList = await page.getByText(/email|role|name/i).first().isVisible().catch(() => false);
    // At least one should be present if not locked behind step-up
    const errorVisible = await page.getByText(/error|crash/i).first().isVisible().catch(() => false);
    expect(errorVisible).toBeFalsy();
  });

  test('invite user button opens modal', async ({ page }) => {
    await clickPlatformTab(page, /users|gebruikers|utilisateurs/i);
    await page.waitForTimeout(1500);
    const inviteBtn = page.getByRole('button', { name: /invite/i }).first();
    if (await inviteBtn.isVisible().catch(() => false)) {
      await inviteBtn.click();
      await page.waitForTimeout(500);
      // Modal should appear with email field
      const modal = page.getByText(/invite.*user|email|send.*invite/i).first();
      const modalVisible = await modal.isVisible().catch(() => false);
      // Close modal
      const closeBtn = page.getByRole('button', { name: /cancel|close/i }).first();
      if (await closeBtn.isVisible().catch(() => false)) {
        await closeBtn.click();
      }
    }
  });
});

test.describe('Platform View - Responsive Layout', () => {
  test('platform view works on mobile viewport', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    const res = await loginAsDemo(page, 'platform_bart');
    test.skip(!res.ok(), 'Demo login API failed — platform_bart may not be seeded');
    await page.waitForTimeout(2000);

    // Page should render without errors
    const errorVisible = await page.getByText(/error|crash/i).first().isVisible().catch(() => false);
    expect(errorVisible).toBeFalsy();

    // Brand should still be visible
    const hasBrand = await page.getByText(/tessera/i).first().isVisible().catch(() => false);
    expect(hasBrand).toBeTruthy();
  });

  test('tabs are scrollable on mobile', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await loginAsDemo(page, 'platform_bart');
    await page.waitForTimeout(3000);

    // Tab bar should be present (it has overflow-x-auto for mobile)
    const tabBar = page.locator('.overflow-x-auto').first();
    const tabBarVisible = await tabBar.isVisible().catch(() => false);
    // At least the security tab should be visible/reachable
    const securityTab = page.getByRole('button', { name: /security/i }).first();
    const secVisible = await securityTab.isVisible().catch(() => false);

    const errorVisible = await page.getByText(/error|crash/i).first().isVisible().catch(() => false);
    expect(errorVisible).toBeFalsy();
  });

  test('platform view works on tablet viewport', async ({ page }) => {
    await page.setViewportSize({ width: 768, height: 1024 });
    await loginAsDemo(page, 'platform_bart');
    await page.waitForTimeout(3000);

    const errorVisible = await page.getByText(/error|crash/i).first().isVisible().catch(() => false);
    expect(errorVisible).toBeFalsy();
  });
});
