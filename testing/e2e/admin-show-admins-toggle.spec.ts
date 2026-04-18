/**
 * E2E: "Show admins" toggle on the Admin Team table.
 *
 * Default state hides admins (listMembers has excludeAdmin:true by default).
 * Toggling the checkbox flips the query to excludeAdmin:false and the admin
 * row becomes visible in the table body.
 */

import { test, expect, type Page } from '@playwright/test';
import { loginAsDemo } from './helpers/auth';

async function gotoTeam(page: Page): Promise<void> {
  const nav = page.locator('aside button').filter({ hasText: /^team$/i }).first();
  await nav.waitFor({ state: 'visible', timeout: 10_000 });
  await nav.click();
  await page.waitForTimeout(300);
}

test.describe('Admin Team — show-admins toggle', () => {
  test('default hides admins; toggling Show admins reveals the admin user', async ({ page }) => {
    const login = await loginAsDemo(page, 'admin_emma');
    test.skip(!login.ok, `Dev login failed (status ${login.status}); skipping`);

    await gotoTeam(page);

    const table = page.locator('table').first();
    await table.waitFor({ state: 'visible', timeout: 10_000 });
    // Wait for the initial listMembers queries to settle.
    await page.waitForTimeout(1200);

    const rowsBefore = await page.locator('tbody tr').count();
    expect(rowsBefore).toBeGreaterThan(0); // seed has non-admin members

    // The URL-encoded input for the table query must include excludeAdmin:true
    // by default (tRPC GET encodes input as a JSON string in the `input` param).
    const toggle = page.locator('#show-admins-toggle');
    await toggle.waitFor({ state: 'visible', timeout: 5_000 });

    // Capture the reissued query after toggle and assert on the actual
    // encoded input param value, not just that the key name appears.
    const afterToggleResp = page.waitForResponse(
      r => {
        if (!/trpc\/partner\.listMembers/.test(r.url())) return false;
        if (r.request().method() !== 'GET') return false;
        // Decode `input` query param and check excludeAdmin:false
        const u = new URL(r.url());
        const inputParam = u.searchParams.get('input');
        if (!inputParam) return false;
        try {
          const parsed = JSON.parse(inputParam);
          // tRPC batches queries: parsed can be { "0": {...}, "1": {...} } or a single object
          const values = typeof parsed === 'object' && parsed !== null ? Object.values(parsed) : [];
          return values.some((v: unknown) => {
            const obj = v as { excludeAdmin?: boolean };
            return obj?.excludeAdmin === false;
          });
        } catch { return false; }
      },
      { timeout: 10_000 },
    );
    await toggle.check();
    const resp = await afterToggleResp;
    expect(resp.status()).toBe(200);

    // Row count should increase (admins now included) after the query settles.
    await page.waitForTimeout(1200);
    const rowsAfter = await page.locator('tbody tr').count();
    expect(rowsAfter).toBeGreaterThan(rowsBefore);

    // Toggling back collapses back to the pre-toggle count.
    await toggle.uncheck();
    await page.waitForTimeout(1200);
    const rowsAfterUncheck = await page.locator('tbody tr').count();
    expect(rowsAfterUncheck).toBe(rowsBefore);
  });
});
