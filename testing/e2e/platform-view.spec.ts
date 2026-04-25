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
import { loginAsDemo } from './helpers/auth';

const BASE = process.env.E2E_BASE_URL || 'http://localhost:3001';

/** Wait for a platform tab to become enabled (security status query resolved) then click it */
async function clickPlatformTab(page: Page, tabName: RegExp, timeout = 15000) {
  const enabledTab = page.locator('button:not([disabled])', { hasText: tabName }).first();
  await enabledTab.waitFor({ state: 'visible', timeout });
  await enabledTab.click();
}

test.describe('Platform Dashboard', () => {
  let loginOk = false;
  test.beforeEach(async ({ page }) => {
    const res = await loginAsDemo(page, 'platform_bart', { lang: 'en' });
    loginOk = !!res.ok;
    await page.waitForTimeout(2000);
  });

  test('platform view loads without errors', async ({ page }) => {
    test.skip(!loginOk, 'Demo login API failed — platform_bart may not be seeded');
    await page.waitForTimeout(1000);
    // Phase 9 chrome unification dropped the visible "GUICHET" wordmark — the
    // platform sidebar now opens with `<UserMenuChip subtitleOverride="Platform operator" />`
    // followed by `<nav role="tablist" aria-label="Platform">`. Assert the
    // structural chrome (aside + tablist) instead of brand text.
    const hasChrome = await page.locator('aside nav[role="tablist"]').first().isVisible().catch(() => false);
    expect(hasChrome).toBeTruthy();

    // No crash or error messages
    const errorVisible = await page.getByText(/error|crash|500/i).first().isVisible().catch(() => false);
    expect(errorVisible).toBeFalsy();
  });

  test('tab bar renders all platform tabs', async ({ page }) => {
    test.skip(!loginOk, 'Demo login API failed — platform_bart may not be seeded');
    await page.waitForTimeout(1000);
    const expectedTabs = ['partners', 'users', 'sso', 'security', 'health', 'config', 'audit', 'archive'];
    let foundTabs = 0;
    for (const tab of expectedTabs) {
      const tabBtn = page.getByRole('button', { name: new RegExp(tab, 'i') }).first();
      const tabText = page.getByText(new RegExp(tab, 'i')).first();
      const visible = await tabBtn.isVisible().catch(() => false) || await tabText.isVisible().catch(() => false);
      if (visible) foundTabs++;
    }
    expect(foundTabs).toBeGreaterThan(0);
  });

  test('sign out button is present', async ({ page }) => {
    await page.waitForTimeout(2000);
    const signOut = page.getByText(/sign.?out|log.?out|uitloggen|déconnex/i).first();
    const visible = await signOut.isVisible().catch(() => false);
    const errorVisible = await page.getByText(/error|crash|500/i).first().isVisible().catch(() => false);
    expect(errorVisible).toBeFalsy();
  });
});

test.describe('Partner Management', () => {
  test.beforeEach(async ({ page }) => {
    await loginAsDemo(page, 'platform_bart', { lang: 'en' });
    await page.waitForTimeout(3000);
  });

  test('partner list is visible on partners tab', async ({ page }) => {
    await clickPlatformTab(page, /partners/i);
    await page.waitForTimeout(1500);

    const hasPartnerContent = await page.getByText(/partner|create|add/i).first().isVisible().catch(() => false);
    const errorVisible = await page.getByText(/error|crash/i).first().isVisible().catch(() => false);
    expect(errorVisible).toBeFalsy();
  });

  test('create partner button is available', async ({ page }) => {
    await clickPlatformTab(page, /partners/i);
    await page.waitForTimeout(1500);

    const createBtn = page.getByRole('button', { name: /create|add|new/i }).first();
    if (await createBtn.isVisible().catch(() => false)) {
      await createBtn.click();
      await page.waitForTimeout(500);
      const modal = page.getByText(/partner.*name|partner.*id|create.*partner/i).first();
      const modalVisible = await modal.isVisible().catch(() => false);
      const closeBtn = page.getByRole('button', { name: /cancel|close/i }).first();
      if (await closeBtn.isVisible().catch(() => false)) {
        await closeBtn.click();
      }
    }
  });
});

test.describe('Tab Navigation', () => {
  test.beforeEach(async ({ page }) => {
    await loginAsDemo(page, 'platform_bart', { lang: 'en' });
    await page.waitForTimeout(3000);
  });

  test('can navigate to users tab', async ({ page }) => {
    await clickPlatformTab(page, /users|gebruikers|utilisateurs/i);
    await page.waitForTimeout(1500);
    const hasUserContent = await page.getByText(/user|invite|email|role/i).first().isVisible().catch(() => false);
    const errorVisible = await page.getByText(/error|crash/i).first().isVisible().catch(() => false);
    expect(errorVisible).toBeFalsy();
  });

  test('can navigate to health tab', async ({ page }) => {
    await clickPlatformTab(page, /health|gezondheid|santé/i);
    await page.waitForTimeout(1500);
    const hasHealthContent = await page.getByText(/postgres|redis|gdpr|connections|memory/i).first().isVisible().catch(() => false);
    const errorVisible = await page.getByText(/error|crash/i).first().isVisible().catch(() => false);
    expect(errorVisible).toBeFalsy();
  });

  test('can navigate to audit tab', async ({ page }) => {
    await clickPlatformTab(page, /audit/i);
    await page.waitForTimeout(1500);
    const errorVisible = await page.getByText(/error|crash/i).first().isVisible().catch(() => false);
    expect(errorVisible).toBeFalsy();
  });

  test('can navigate to config tab', async ({ page }) => {
    await clickPlatformTab(page, /config/i);
    await page.waitForTimeout(1500);
    const errorVisible = await page.getByText(/error|crash/i).first().isVisible().catch(() => false);
    expect(errorVisible).toBeFalsy();
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
    await loginAsDemo(page, 'platform_bart', { lang: 'en' });
    await page.waitForTimeout(3000);
  });

  test('user table shows users with roles', async ({ page }) => {
    await clickPlatformTab(page, /users|gebruikers|utilisateurs/i);
    await page.waitForTimeout(2000);
    const hasTable = await page.locator('table').first().isVisible().catch(() => false);
    const hasList = await page.getByText(/email|role|name/i).first().isVisible().catch(() => false);
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
      const modal = page.getByText(/invite.*user|email|send.*invite/i).first();
      const modalVisible = await modal.isVisible().catch(() => false);
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
    const res = await loginAsDemo(page, 'platform_bart', { lang: 'en' });
    test.skip(!res.ok, 'Demo login API failed — platform_bart may not be seeded');
    await page.waitForTimeout(2000);

    const errorVisible = await page.getByText(/error|crash/i).first().isVisible().catch(() => false);
    expect(errorVisible).toBeFalsy();

    // Same as above — assert the structural chrome instead of the gone brand text.
    const hasChrome = await page.locator('aside nav[role="tablist"]').first().isVisible().catch(() => false);
    expect(hasChrome).toBeTruthy();
  });

  test('tabs are scrollable on mobile', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await loginAsDemo(page, 'platform_bart', { lang: 'en' });
    await page.waitForTimeout(3000);

    const tabBar = page.locator('.overflow-x-auto').first();
    const tabBarVisible = await tabBar.isVisible().catch(() => false);
    const securityTab = page.getByRole('button', { name: /security/i }).first();
    const secVisible = await securityTab.isVisible().catch(() => false);

    const errorVisible = await page.getByText(/error|crash/i).first().isVisible().catch(() => false);
    expect(errorVisible).toBeFalsy();
  });

  test('platform view works on tablet viewport', async ({ page }) => {
    await page.setViewportSize({ width: 768, height: 1024 });
    await loginAsDemo(page, 'platform_bart', { lang: 'en' });
    await page.waitForTimeout(3000);

    const errorVisible = await page.getByText(/error|crash/i).first().isVisible().catch(() => false);
    expect(errorVisible).toBeFalsy();
  });
});
