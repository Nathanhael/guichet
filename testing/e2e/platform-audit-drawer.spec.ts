/**
 * E2E: Platform-scoped audit log — targetType dropdown populates from
 * server (listTargetTypes) and the row-click metadata drawer renders valid
 * JSON. Mirrors admin-audit-target-type-filter.spec.ts for the platform view.
 */

import { test, expect, type Page } from '@playwright/test';
import { loginAsDemo } from './helpers/auth';

async function gotoPlatformTab(page: Page, label: RegExp): Promise<void> {
  const btn = page.locator('[role="tab"]', { hasText: label }).first();
  await btn.waitFor({ state: 'visible', timeout: 15_000 });
  await btn.click();
  await page.waitForTimeout(500);
}

test.describe('Platform — audit log drawer + targetType filter', () => {
  test('targetType dropdown is populated from server and the filter reaches the query', async ({ page }) => {
    const login = await loginAsDemo(page, 'platform_bart');
    test.skip(!login.ok, `Dev login failed (status ${login.status}); skipping`);

    await gotoPlatformTab(page, /^audit$/i);

    const select = page.locator('#platform-target-type-filter');
    await select.waitFor({ state: 'visible', timeout: 10_000 });

    // Options are loaded async via listTargetTypes; poll until populated.
    await expect
      .poll(
        async () =>
          (
            await select.locator('option').evaluateAll((els) =>
              els.map((e) => (e as HTMLOptionElement).value).filter((v) => v !== ''),
            )
          ).length,
        { timeout: 10_000 },
      )
      .toBeGreaterThan(0);

    const values = await select.locator('option').evaluateAll(
      (els) => els.map((e) => (e as HTMLOptionElement).value).filter((v) => v !== ''),
    );
    // Platform server emits at least 'partner' and 'user'.
    expect(values).toContain('partner');
    expect(values).toContain('user');

    const chosen = 'partner';
    const filteredResp = page.waitForResponse(
      (r) => {
        const u = r.url();
        if (!/trpc\/platform\.getAuditLog/.test(u)) return false;
        return u.includes('targetType') && u.includes(encodeURIComponent(chosen));
      },
      { timeout: 10_000 },
    );
    await select.selectOption(chosen);
    const resp = await filteredResp;
    expect(resp.status()).toBe(200);
  });

  test('clicking a platform audit row opens the drawer with valid JSON', async ({ page }) => {
    const login = await loginAsDemo(page, 'platform_bart');
    test.skip(!login.ok, `Dev login failed (status ${login.status}); skipping`);

    await gotoPlatformTab(page, /^audit$/i);

    const firstRow = page.locator('tbody tr[data-audit-row-id]').first();
    await firstRow.waitFor({ state: 'visible', timeout: 10_000 });
    await firstRow.click();

    const drawer = page.getByRole('dialog', { name: /audit entry details/i });
    await expect(drawer).toBeVisible({ timeout: 5_000 });

    const jsonBlock = page.locator('[data-testid="audit-metadata-json"]');
    await expect(jsonBlock).toBeVisible();
    const jsonText = await jsonBlock.textContent();
    expect(() => JSON.parse(jsonText ?? '')).not.toThrow();

    // Platform drawer renders the Partner id field (partnerId is passed on
    // AuditEntry for platform rows). It's labelled "Partner id" in the markup.
    await expect(drawer.getByText(/partner id/i).first()).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(drawer).toBeHidden({ timeout: 3_000 });
  });
});
