import { test, expect } from '../fixtures/auth.fixture.js';

test.describe('Network Resilience', () => {
  test('client handles offline mode gracefully', async ({ page, loginAs }) => {
    await loginAs('agentA');
    await page.goto('/');

    // Verify initial connection
    await expect(page.locator('textarea')).toBeVisible();

    // Go offline
    await page.context().setOffline(true);

    // Verify UI shows disconnected state
    // Note: We check for the connection banner which should appear in the App.tsx
    await expect(page.getByTestId('connection-banner')).toBeVisible({ timeout: 10000 });

    // Attempt to send a message (should show optimistic update or error)
    await page.locator('textarea').fill('Offline message test');
    await page.locator('button[type="submit"]').click();

    // Verify message is still there (optimistic) or showing as pending
    await expect(page.locator('text=Offline message test')).toBeVisible();

    // Go back online
    await page.context().setOffline(false);

    // Banner should disappear
    await expect(page.getByTestId('connection-banner')).not.toBeVisible({ timeout: 15000 });
  });

  test('client reconnects after connection loss', async ({ page, loginAs }) => {
    await loginAs('supportA');
    await page.goto('/');

    // Simulate connection drop by going offline then online quickly
    await page.context().setOffline(true);
    await page.waitForTimeout(2000);
    await page.context().setOffline(false);

    // Verify UI recovers
    await expect(page.locator('textarea')).toBeVisible();
    await expect(page.locator('text=Disconnected')).not.toBeVisible();
  });
});
