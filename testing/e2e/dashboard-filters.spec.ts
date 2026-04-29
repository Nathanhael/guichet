/**
 * E2E: Admin Dashboard — URL-persisted filters.
 *
 * Spec: filter state lives in `window.location.search` so admins can
 * bookmark / share / reload without losing context. Verifies:
 *   - clicking a preset button writes ?preset=30d to the URL
 *   - reloading preserves the active preset
 *   - returning to the default preset (7d) strips the param to keep
 *     the URL tidy
 *   - the exclude-weekends checkbox round-trips through ?weekends=off
 *
 * Doesn't depend on dashboard data — tests pure URL mechanics.
 */

import { test, expect } from '@playwright/test';
import { loginAsDemo, BASE } from './helpers/auth';

test.describe('Admin Dashboard — URL-persisted filters', () => {
  test.beforeEach(async ({ page }) => {
    const res = await loginAsDemo(page, 'admin_emma');
    if (!res.ok) {
      throw new Error(
        `Fixture user 'admin_emma' failed to log in (status ${res.status}). ` +
          'Check server/seed.ts — this is a test setup bug, not a skip condition.',
      );
    }
    await page.goto(`${BASE}/`);
    await page.waitForLoadState('load');
  });

  test('preset button click writes preset to the URL', async ({ page }) => {
    const presetBtn = page.getByRole('button', { name: '30d' });
    await expect(presetBtn).toBeVisible();
    await presetBtn.click();
    await expect(page).toHaveURL(/[?&]preset=30d(?:&|$)/);
    await expect(presetBtn).toHaveAttribute('aria-pressed', 'true');
  });

  test('reload preserves the active preset', async ({ page }) => {
    await page.getByRole('button', { name: '14d' }).click();
    await expect(page).toHaveURL(/[?&]preset=14d(?:&|$)/);
    await page.reload();
    await page.waitForLoadState('load');
    await expect(page.getByRole('button', { name: '14d' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });

  test('returning to the default 7d preset strips the param from the URL', async ({ page }) => {
    await page.getByRole('button', { name: '30d' }).click();
    await expect(page).toHaveURL(/[?&]preset=30d(?:&|$)/);
    await page.getByRole('button', { name: '7d' }).click();
    await expect(page).not.toHaveURL(/[?&]preset=/);
  });

  test('exclude-weekends checkbox round-trips through the URL', async ({ page }) => {
    const checkbox = page.getByLabel('Exclude weekends');
    await expect(checkbox).toBeVisible();
    await checkbox.check();
    await expect(page).toHaveURL(/[?&]weekends=off(?:&|$)/);
    await page.reload();
    await page.waitForLoadState('load');
    await expect(page.getByLabel('Exclude weekends')).toBeChecked();
    await page.getByLabel('Exclude weekends').uncheck();
    await expect(page).not.toHaveURL(/[?&]weekends=/);
  });
});
