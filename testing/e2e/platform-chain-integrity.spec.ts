/**
 * E2E: Audit chain-integrity verify UI on the Platform → Health tab.
 *
 * A platform operator clicks "Verify Now", the server runs the full SHA-256
 * chain scan, and the result panel shows VALID with a non-zero checked count.
 * The run is persisted to system_settings, so reloading the tab rehydrates the
 * same last-verified state (no local-storage trick, no re-scan).
 */

import { execSync } from 'node:child_process';
import { test, expect, type Page } from '@playwright/test';
import { loginAsDemo } from './helpers/auth';

async function gotoPlatformTab(page: Page, label: RegExp): Promise<void> {
  const btn = page.locator('[role="tab"]', { hasText: label }).first();
  await btn.waitFor({ state: 'visible', timeout: 15_000 });
  await btn.click();
  await page.waitForTimeout(500);
}

// The verify-chain rate-limit has a 60s TTL keyed by operator. If a sibling
// spec (e.g. platform-chain-rate-limit) ran a verify in the same playwright
// run, the first click here would return 429 and this test would mis-fail.
// Clear the key so we always start this spec from a clean counter.
function clearVerifyChainLimit(userId: string): void {
  try {
    execSync(
      `docker compose exec -T -e REDISCLI_AUTH=devpassword redis redis-cli DEL rate:verify-audit-chain:${userId}`,
      { stdio: 'ignore' },
    );
  } catch {
    // Fall through — if we're running outside docker compose the caller
    // accepts the risk of environmental flake.
  }
}

test.describe('Platform — audit chain-integrity verify UI', () => {
  test.beforeEach(() => {
    clearVerifyChainLimit('platform_bart');
  });

  test('platform operator can run a verify and the result persists server-side across reload', async ({ page }) => {
    const login = await loginAsDemo(page, 'platform_bart');
    if (!login.ok) {
      throw new Error(
        `Fixture user 'platform_bart' failed to log in (status ${login.status}). ` +
          'Check server/seed.ts — this is a test setup bug, not a skip condition.',
      );
    }

    await gotoPlatformTab(page, /^health$/i);

    const verifyBtn = page.locator('#verify-audit-chain-btn');
    await verifyBtn.waitFor({ state: 'visible', timeout: 10_000 });

    // Capture the actual mutation response so we're asserting on the real
    // server result, not just whatever the UI happens to render. Since
    // Playwright may run this spec in parallel with platform-chain-rate-limit
    // (same operator, same Redis counter), an initial 429 here means a
    // sibling test just consumed the single-per-60s slot — clear the key and
    // retry once rather than tying this test's pass/fail to parallel order.
    const clickOnce = async () => {
      const resp = page.waitForResponse(
        r => /trpc\/platform\.verifyAuditChain/.test(r.url()) && r.request().method() === 'POST',
        { timeout: 30_000 },
      );
      await verifyBtn.click();
      return resp;
    };

    let resp = await clickOnce();
    if (resp.status() === 429) {
      // Clear server-side + reload to wipe the client-side retry-countdown
      // state that keeps the button disabled after the initial 429 response.
      clearVerifyChainLimit('platform_bart');
      await page.reload();
      await gotoPlatformTab(page, /^health$/i);
      const reloadedBtn = page.locator('#verify-audit-chain-btn');
      await reloadedBtn.waitFor({ state: 'visible', timeout: 10_000 });
      await expect(reloadedBtn).toHaveText(/verify now/i, { timeout: 15_000 });
      const retry = page.waitForResponse(
        r => /trpc\/platform\.verifyAuditChain/.test(r.url()) && r.request().method() === 'POST',
        { timeout: 30_000 },
      );
      await reloadedBtn.click();
      resp = await retry;
    }
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
