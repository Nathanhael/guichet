/**
 * E2E: Rate-limit countdown UI on the "Verify Now" button.
 *
 * The server rate-limits verifyAuditChain to 1 call per 60s per operator.
 * When a second click hits the limit, the server returns TOO_MANY_REQUESTS
 * with "Retry in Ns" — the client parses that and flips the button into a
 * live countdown ("Retry in 59s"), disabled until the clock runs out.
 *
 * This spec asserts the *UI* response to the rate-limit, not the underlying
 * Redis behaviour (that's covered by router-level tests). We only need to
 * see the button flip into the countdown state after a second click.
 */

import { execSync } from 'node:child_process';
import { test, expect, type Page } from '@playwright/test';
import { loginAsDemo } from './helpers/auth';

// The verify-chain rate-limit key has a 60s TTL in Redis. If another spec
// (e.g. platform-chain-integrity) has just run a verify for the same
// operator, the first click here will already hit 429 — making the test
// "did the limiter engage?" indistinguishable from environmental state.
// Clear the key in beforeEach so the first click is always the legitimate
// one and the second click is the one we're actually asserting on.
function clearVerifyChainLimit(userId: string): void {
  try {
    execSync(
      `docker compose exec -T -e REDISCLI_AUTH=devpassword redis redis-cli DEL rate:verify-audit-chain:${userId}`,
      { stdio: 'ignore' },
    );
  } catch {
    // If the docker exec fails (e.g. running outside compose), we fall back
    // to simply trusting whatever state Redis is in — the test will still
    // assert correctly if the first click lands on a clean counter.
  }
}

async function gotoPlatformTab(page: Page, label: RegExp): Promise<void> {
  const btn = page.locator('[role="tab"]', { hasText: label }).first();
  await btn.waitFor({ state: 'visible', timeout: 15_000 });
  await btn.click();
  await page.waitForTimeout(500);
}

test.describe('Platform — Verify Now rate-limit countdown', () => {
  test.beforeEach(() => {
    clearVerifyChainLimit('platform_bart');
  });

  test('second click within the window surfaces a live "Retry in Ns" countdown', async ({ page }) => {
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

    // First click: wait for the 200 OK so the mutation has fully landed
    // before we try the second one. Under parallel playwright workers, a
    // sibling spec (platform-chain-integrity) may already have consumed the
    // same operator's per-60s slot — clear + reload + retry in that case
    // so this test's pass/fail tracks the limiter UI, not worker ordering.
    const clickOnce = async (btn = verifyBtn) => {
      const r = page.waitForResponse(
        resp => /trpc\/platform\.verifyAuditChain/.test(resp.url()) && resp.request().method() === 'POST',
        { timeout: 30_000 },
      );
      await btn.click();
      return r;
    };

    let first = await clickOnce();
    if (first.status() === 429) {
      clearVerifyChainLimit('platform_bart');
      await page.reload();
      await gotoPlatformTab(page, /^health$/i);
      const reloadedBtn = page.locator('#verify-audit-chain-btn');
      await reloadedBtn.waitFor({ state: 'visible', timeout: 10_000 });
      await expect(reloadedBtn).toHaveText(/verify now/i, { timeout: 15_000 });
      first = await clickOnce(reloadedBtn);
    }
    expect(first.status()).toBe(200);

    // The button might still be mid-re-render after the mutation resolves.
    // Wait for the "Verify Now" label to return before firing the rate-limit
    // click — otherwise we'd click a disabled "Verifying…" button.
    await expect(verifyBtn).toHaveText(/verify now/i, { timeout: 10_000 });

    // Second click: server should reject with TOO_MANY_REQUESTS. tRPC
    // surfaces the 4xx as HTTP 429 on this endpoint.
    const secondResp = page.waitForResponse(
      r => /trpc\/platform\.verifyAuditChain/.test(r.url()) && r.request().method() === 'POST',
      { timeout: 30_000 },
    );
    await verifyBtn.click();
    const second = await secondResp;
    expect(second.status()).toBe(429);

    // The UI flips to a live countdown. The data-retry-remaining attribute
    // carries the integer seconds; poll until it's set and positive so we're
    // not racing the useEffect that reads the error and starts the timer.
    await expect
      .poll(
        async () => {
          const attr = await verifyBtn.getAttribute('data-retry-remaining');
          return attr ? parseInt(attr, 10) : 0;
        },
        { timeout: 10_000 },
      )
      .toBeGreaterThan(0);

    // Button label reflects the remaining time ("Retry in 59s", etc.) and
    // the button itself is disabled so a third click can't fire.
    await expect(verifyBtn).toHaveText(/^Retry in \d+s$/);
    await expect(verifyBtn).toBeDisabled();
  });
});
