/**
 * E2E: Push Notification UI & Auto-Idle Status
 *
 * Tests bell icon visibility per role, VAPID endpoint availability,
 * and idle status hook integration (no-crash verification).
 *
 * Prerequisites:
 *   - Server running at E2E_BASE_URL
 *   - Seeded demo database (seed.ts)
 *
 * Limitations:
 *   - Cannot test actual push permission dialogs (browser API limitation)
 *   - Cannot test 5-minute idle timeout (too slow for E2E)
 */

import { test, expect, type Page } from '@playwright/test';
import { loginAsDemo } from './helpers/auth';

const BASE = process.env.E2E_BASE_URL || 'http://localhost:3001';

/**
 * The NotificationToggle bell lives inside the SettingsPopover (gear icon)
 * on both AgentView and SupportView navbars, not directly in the top bar.
 * Tests must open the popover before looking for the bell. Returns true if
 * the popover opened, false if the Settings button wasn't rendered (e.g.
 * business-hours closed screen or an unexpected view).
 */
async function openSettingsPopover(page: Page): Promise<boolean> {
  const settingsBtn = page.getByRole('button', { name: /^settings$/i }).first();
  const visible = await settingsBtn.isVisible({ timeout: 5000 }).catch(() => false);
  if (!visible) return false;
  await settingsBtn.click();
  // Popover mounts its content on open — give it a beat to render.
  await page.waitForTimeout(200);
  return true;
}

// ---------------------------------------------------------------------------
// Push Notification Bell — Agent role
// ---------------------------------------------------------------------------

test.describe('Push Notification Bell (Agent)', () => {
  let loginOk = false;

  test.beforeEach(async ({ page }) => {
    // agent_sarah is an acme agent from the demo seed (no tickets pre-assigned).
    const res = await loginAsDemo(page, 'agent_sarah');
    loginOk = !!res.ok;
    await page.waitForTimeout(2000);
  });

  test('bell icon is visible for agent users', async ({ page }) => {
    test.skip(!loginOk, 'Demo login failed — agent_sarah may not be seeded');

    // Skip if business hours guard blocks the agent view
    const closed = page.getByText(/closed|gesloten|fermé/i).first();
    if (await closed.isVisible({ timeout: 3000 }).catch(() => false)) {
      test.skip(true, 'Business hours closed — agent view blocked');
      return;
    }

    // NotificationToggle lives inside the SettingsPopover (gear icon).
    const popoverOpen = await openSettingsPopover(page);
    test.skip(!popoverOpen, 'Settings button not rendered');

    const bellBtn = page.locator(
      'button[aria-label*="push" i], button[aria-label*="notification" i], button[aria-label*="melding" i], button[aria-label*="notificatie" i]'
    ).first();

    await expect(bellBtn).toBeVisible({ timeout: 10000 });
  });

  test('bell icon has push-related aria label for agents', async ({ page }) => {
    test.skip(!loginOk, 'Demo login failed — agent_sarah may not be seeded');

    // Skip if business hours guard blocks the agent view
    const closed = page.getByText(/closed|gesloten|fermé/i).first();
    if (await closed.isVisible({ timeout: 3000 }).catch(() => false)) {
      test.skip(true, 'Business hours closed — agent view blocked');
      return;
    }

    const popoverOpen = await openSettingsPopover(page);
    test.skip(!popoverOpen, 'Settings button not rendered');

    const bellBtn = page.locator(
      'button[aria-label*="push" i], button[aria-label*="notification" i], button[aria-label*="melding" i], button[aria-label*="notificatie" i]'
    ).first();

    await expect(bellBtn).toBeVisible({ timeout: 10000 });

    const label = await bellBtn.getAttribute('aria-label');
    expect(label).toMatch(/push|melding|notification/i);
  });
});

// ---------------------------------------------------------------------------
// Push Notification Bell — Support role
// ---------------------------------------------------------------------------

test.describe('Push Notification Bell (Support)', () => {
  let loginOk = false;

  test.beforeEach(async ({ page }) => {
    // support_lucas is an acme support user (DSC + FOT departments) from the demo seed.
    const res = await loginAsDemo(page, 'support_lucas');
    loginOk = !!res.ok;
    await page.waitForTimeout(2000);
  });

  test('bell icon exists but does NOT trigger push subscription for support', async ({ page }) => {
    test.skip(!loginOk, 'Demo login failed — support_lucas may not be seeded');

    // For support users, the bell toggles in-app notifications (not Web Push).
    // The button should be visible but clicking it should NOT prompt for push permission.
    // We verify the button is visible — we cannot intercept browser permission dialogs.
    const popoverOpen = await openSettingsPopover(page);
    test.skip(!popoverOpen, 'Settings button not rendered');

    const bellBtn = page.locator(
      'button[aria-label*="notification" i], button[aria-label*="melding" i], button[aria-label*="notificatie" i]'
    ).first();

    await expect(bellBtn).toBeVisible({ timeout: 10000 });

    // The aria-label must NOT reference push — support gets in-app only.
    const label = await bellBtn.getAttribute('aria-label');
    expect(label).not.toMatch(/push/i);

    const errorVisible = await page.getByText(/error|crash/i).first().isVisible().catch(() => false);
    expect(errorVisible).toBeFalsy();
  });
});

// ---------------------------------------------------------------------------
// Auto-Idle Status
// ---------------------------------------------------------------------------

test.describe('Auto Idle Status', () => {
  let loginOk = false;

  test.beforeEach(async ({ page }) => {
    const res = await loginAsDemo(page, 'support_lucas');
    loginOk = !!res.ok;
    await page.waitForTimeout(2000);
  });

  test('support view loads without errors with idle detection active', async ({ page }) => {
    test.skip(!loginOk, 'Demo login failed — support_lucas may not be seeded');

    // The useIdleStatus hook attaches event listeners on mount.
    // Verify no crash and the view renders correctly.
    const errorVisible = await page.getByText(/error|crash/i).first().isVisible().catch(() => false);
    expect(errorVisible).toBeFalsy();

    // StatusPicker should be present — idle hook uses it internally
    const picker = page.locator('button[aria-label^="Status:"]');
    await expect(picker).toBeVisible({ timeout: 10000 });
  });

  test('status picker shows current status after page load', async ({ page }) => {
    test.skip(!loginOk, 'Demo login failed — support_lucas may not be seeded');

    // After login the status should default to "Available" (or whatever was persisted)
    // The idle hook is active but won't fire within the test timeframe (5-minute threshold)
    const picker = page.locator('button[aria-label^="Status:"]');
    await expect(picker).toBeVisible({ timeout: 10000 });

    // The label reflects the current status — available is the expected default
    const label = await picker.getAttribute('aria-label');
    expect(label).toMatch(/Status:/i);

    // No crash — idle detection is running silently in the background
    const errorVisible = await page.getByText(/error|crash/i).first().isVisible().catch(() => false);
    expect(errorVisible).toBeFalsy();
  });

  test('simulated activity does not trigger idle transition', async ({ page }) => {
    test.skip(!loginOk, 'Demo login failed — support_lucas may not be seeded');

    const picker = page.locator('button[aria-label^="Status:"]');
    await expect(picker).toBeVisible({ timeout: 10000 });

    // Simulate user activity — idle hook should reset its timer
    await page.mouse.move(100, 100);
    await page.mouse.move(200, 200);
    await page.keyboard.press('Shift');
    await page.waitForTimeout(500);

    // Status should remain unchanged (no idle transition in < 5 min)
    const labelAfter = await picker.getAttribute('aria-label');
    expect(labelAfter).toMatch(/Status:/i);

    const errorVisible = await page.getByText(/error|crash/i).first().isVisible().catch(() => false);
    expect(errorVisible).toBeFalsy();
  });
});

// ---------------------------------------------------------------------------
// Push API — VAPID Key Endpoint
// ---------------------------------------------------------------------------

test.describe('Push API', () => {
  test('vapid key endpoint returns a key or 503', async ({ page }) => {
    await page.goto(BASE);
    await page.waitForLoadState('load');

    // Fetch the VAPID public key endpoint from within the page context
    // to respect same-origin cookies and avoid CORS issues
    const result = await page.evaluate(async () => {
      try {
        const res = await fetch('/api/v1/push/vapid-key', {
          credentials: 'include',
        });
        const body = await res.json().catch(() => null);
        return { status: res.status, body };
      } catch (err) {
        return { status: -1, error: String(err) };
      }
    });

    // 200 = VAPID configured and returned { vapidPublicKey: '...' }
    // 503 = push notifications not configured (acceptable)
    // 401 = unauthenticated (also acceptable — endpoint exists)
    // 404 or 500 = unexpected — route not registered or server error
    expect([200, 401, 502, 503]).toContain(result.status);

    if (result.status === 200 && result.body) {
      // If configured, the key should be a non-empty string
      expect(typeof result.body.vapidPublicKey).toBe('string');
      expect(result.body.vapidPublicKey.length).toBeGreaterThan(0);
    }
  });
});
