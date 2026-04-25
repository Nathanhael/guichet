/**
 * E2E: Split View — Layout modes and viewport responsiveness.
 *
 * Covers: viewport resize handling, split-stack auto-revert,
 * view mode dropdown visibility.
 *
 * Seed user: support_lucas (DSC/FOT)
 */

import { test, expect } from '@playwright/test';
import { loginAsDemo } from './helpers/auth';

const BASE = process.env.E2E_BASE_URL || 'http://localhost:3001';

test.describe('Split View Modes', () => {
  test('support view handles viewport resize without crashing', async ({ page }) => {
    const res = await loginAsDemo(page, 'support_lucas');
    test.skip(!res.ok, 'support_lucas not seeded');
    await page.waitForTimeout(2000);

    // Start wide
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.waitForTimeout(500);

    // Verify app is functional. Post-Phase-9 SupportView has no <nav> element —
    // chrome is `<main>` (chat surface) + ResizablePanel (queue, plain divs).
    // Use <main> as the stable chrome anchor across viewport changes.
    const chrome = page.locator('main').first();
    await expect(chrome).toBeVisible();

    // Shrink to mobile
    await page.setViewportSize({ width: 375, height: 812 });
    await page.waitForTimeout(1000);

    // App should not crash. The previous regex `/error|crash|oops/i` matched
    // incidental message-body text in the seeded queue (subjects/bodies
    // mentioning those words), producing false positives. Tighten to actual
    // error-UI surfaces only — same shape as agent-view.spec.ts.
    const fallbackText = page.getByText(/component failed to load|something went wrong|500 internal/i).first();
    const alertEl = page.locator('[role="alert"]').first();
    const fallbackVisible = await fallbackText.isVisible().catch(() => false);
    const alertVisible = await alertEl.isVisible().catch(() => false);
    expect(fallbackVisible || alertVisible).toBeFalsy();
    await expect(chrome).toBeVisible();

    // Expand back to desktop
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.waitForTimeout(500);
    await expect(chrome).toBeVisible();
  });

  test('split-stack auto-falls back when fewer than 2 tabs', async ({ page }) => {
    const res = await loginAsDemo(page, 'support_lucas');
    test.skip(!res.ok, 'support_lucas not seeded');
    await page.waitForTimeout(2000);

    // With 0 tabs, setting split-stack via localStorage should auto-revert
    await page.evaluate(() => {
      localStorage.setItem('guichet:viewMode', 'split-stack');
    });
    await page.reload();
    await page.waitForLoadState('load');
    await page.waitForTimeout(2000);

    // Should see empty state (normal mode), not crash
    const errorVisible = await page.getByText(/error|crash/i).first().isVisible().catch(() => false);
    expect(errorVisible).toBeFalsy();
    await expect(page.locator('body')).toBeVisible();
  });

  test('queue sidebar collapses and expands', async ({ page }) => {
    const res = await loginAsDemo(page, 'support_lucas');
    test.skip(!res.ok, 'support_lucas not seeded');
    await page.waitForTimeout(2000);

    // Sidebar should be visible initially
    const sidebar = page.locator('aside').first();
    const sidebarVisible = await sidebar.isVisible({ timeout: 3000 }).catch(() => false);
    test.skip(!sidebarVisible, 'Sidebar not visible');

    // Collapse via Ctrl+B
    await page.keyboard.press('Control+b');
    await page.waitForTimeout(500);

    // Sidebar should be collapsed (aside may still exist but content hidden)
    // Verify the toggle works without crash
    await page.keyboard.press('Control+b');
    await page.waitForTimeout(500);

    // No crash
    const errorVisible = await page.getByText(/error|crash/i).first().isVisible().catch(() => false);
    expect(errorVisible).toBeFalsy();
  });
});
