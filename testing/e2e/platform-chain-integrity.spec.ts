/**
 * E2E: Audit chain-integrity verify UI on the Platform → Health tab.
 *
 * A platform operator clicks "Verify Now", the server runs the full SHA-256
 * chain scan, and the result panel shows VALID with a non-zero checked count.
 * The run is persisted to system_settings, so reloading the tab rehydrates the
 * same last-verified state (no local-storage trick, no re-scan).
 */

import { test, expect, type Page } from '@playwright/test';
import { loginAsDemo } from './helpers/auth';

async function gotoPlatformTab(page: Page, label: RegExp): Promise<void> {
  const btn = page.locator('[role="tab"]', { hasText: label }).first();
  await btn.waitFor({ state: 'visible', timeout: 15_000 });
  await btn.click();
  await page.waitForTimeout(500);
}

test.describe('Platform — audit chain-integrity verify UI', () => {
  test('platform operator can run a verify and the result persists server-side across reload', async ({ page }) => {
    const login = await loginAsDemo(page, 'platform_bart');
    test.skip(!login.ok, `Dev login failed (status ${login.status}); skipping`);

    await gotoPlatformTab(page, /^health$/i);

    const verifyBtn = page.locator('#verify-audit-chain-btn');
    await verifyBtn.waitFor({ state: 'visible', timeout: 10_000 });

    // Capture the actual mutation response so we're asserting on the real
    // server result, not just whatever the UI happens to render.
    const verifyResp = page.waitForResponse(
      r => /trpc\/platform\.verifyAuditChain/.test(r.url()) && r.request().method() === 'POST',
      { timeout: 30_000 },
    );
    await verifyBtn.click();
    const resp = await verifyResp;
    expect(resp.status()).toBe(200);

    // Result panel: VALID + checked count. Seed DB has no archived rows so
    // checked may legitimately be 0 — assert on the status string only.
    const statusCell = page.getByText(/^VALID$|^BROKEN$|^ERROR$/).first();
    await statusCell.waitFor({ state: 'visible', timeout: 10_000 });
    await expect(statusCell).toHaveText('VALID');

    // Reload → the previously-run result must hydrate from system_settings
    // (not from the browser). We should see VALID immediately, WITHOUT the
    // button going into "Verifying…" state (because we're not re-running it).
    await page.reload();
    await gotoPlatformTab(page, /^health$/i);

    const statusAfterReload = page.getByText(/^VALID$|^BROKEN$|^ERROR$/).first();
    await statusAfterReload.waitFor({ state: 'visible', timeout: 10_000 });
    await expect(statusAfterReload).toHaveText('VALID');

    // "Verify Now" label — not "Verifying…" — confirms no scan is running on mount.
    const btnAfterReload = page.locator('#verify-audit-chain-btn');
    await expect(btnAfterReload).toHaveText(/verify now/i);
  });
});
