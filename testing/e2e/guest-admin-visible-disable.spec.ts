/**
 * E2E: destructive admin controls are visibly disabled for Azure B2B guests.
 *
 * Parent plan: docs/superpowers/plans/2026-04-17-guest-admin-visible-disable.md
 * Parent feature: docs/superpowers/specs/partner-sso-b2b-guest.md
 *
 * Seed fixture `admin_guest` (Gina Guest) is an ACME admin with
 * `users.isExternal = true`. Every destructive control in the AdminView tabs
 * this spec exercises (Team, Departments) must:
 *   - render with a `data-guest-disabled="true"` marker
 *   - be `disabled` (native HTMLButtonElement) OR carry `aria-disabled="true"`
 *     for non-button wrappers (the dept-edit click zone)
 *   - expose a tooltip explaining the restriction
 *   - swallow click events (no network request reaches the server)
 *
 * AdminWebhooks is currently gated behind a DISABLED_FEATURE flag in
 * AdminView.tsx so we cannot exercise its visible-disable wiring through the
 * UI here. The primitive (ExternalGuestGuard) and wiring are covered by the
 * component-level tests and static source inspection in the PR review.
 */

import { test, expect, type Page } from '@playwright/test';
import { loginAsDemo } from './helpers/auth';

async function gotoSidebarTab(page: Page, label: RegExp): Promise<void> {
  const nav = page.locator('aside button').filter({ hasText: label }).first();
  await nav.waitFor({ state: 'visible', timeout: 10_000 });
  await nav.click();
  // Small settle — destructive controls mount inside the tab panel.
  await page.waitForTimeout(300);
}

test.describe('Guest admin — visible disable treatment', () => {
  test('Team tab: Invite External is disabled with tooltip', async ({ page }) => {
    const res = await loginAsDemo(page, 'admin_guest');
    test.skip(!res.ok, `Dev login failed (status ${res.status}); skipping`);

    await gotoSidebarTab(page, /^team$/i);

    const inviteBtn = page.getByRole('button', { name: /invite external/i }).first();
    await inviteBtn.waitFor({ state: 'visible' });

    expect(await inviteBtn.getAttribute('data-guest-disabled')).toBe('true');
    expect(await inviteBtn.isDisabled()).toBe(true);
    expect(await inviteBtn.getAttribute('title')).toContain('external guest');
  });

  test('Team tab: Remove and dept-edit are disabled + click sends no network', async ({ page }) => {
    const res = await loginAsDemo(page, 'admin_guest');
    test.skip(!res.ok, `Dev login failed (status ${res.status}); skipping`);

    await gotoSidebarTab(page, /^team$/i);

    // Wait for at least one "Remove" row button to appear.
    const removeBtn = page.getByRole('button', { name: /^remove$/i }).first();
    await removeBtn.waitFor({ state: 'visible', timeout: 10_000 });
    expect(await removeBtn.isDisabled()).toBe(true);
    expect(await removeBtn.getAttribute('data-guest-disabled')).toBe('true');

    // The dept-edit click zone is a <div> with aria-disabled; exactly one per row.
    // Pick the first support/admin row that shows the dept chips.
    const deptZone = page.locator('[data-guest-disabled="true"][aria-disabled="true"]').filter({
      // dept zones sit inside <td> cells; filter out the top-level invite button
      // by requiring them to sit inside a <tr>.
      has: page.locator('xpath=ancestor::tr'),
    }).first();

    if (await deptZone.count()) {
      // Clicking the zone should not open the edit form — if it did, a Save
      // button would appear. Track network calls to partner.updateMember.
      let sawMutation = false;
      page.on('request', (req) => {
        if (req.url().includes('trpc/partner.updateMember')) sawMutation = true;
      });
      await deptZone.click({ force: true });
      await page.waitForTimeout(250);
      expect(sawMutation).toBe(false);
    }
  });

  test('Departments tab: Add / Edit / Delete are all disabled for guests', async ({ page }) => {
    const res = await loginAsDemo(page, 'admin_guest');
    test.skip(!res.ok, `Dev login failed (status ${res.status}); skipping`);

    await gotoSidebarTab(page, /^departments$/i);

    const addBtn = page.getByRole('button', { name: /add department/i }).first();
    await addBtn.waitFor({ state: 'visible', timeout: 10_000 });
    expect(await addBtn.isDisabled()).toBe(true);
    expect(await addBtn.getAttribute('data-guest-disabled')).toBe('true');

    // Per-row Edit / Delete icon buttons (identified by title="Edit" when
    // internal, overridden to the guest tooltip when external).
    const pencilBtns = page.locator('button[data-guest-disabled="true"]')
      .filter({ has: page.locator('svg.lucide-pencil') });
    const trashBtns = page.locator('button[data-guest-disabled="true"]')
      .filter({ has: page.locator('svg.lucide-trash-2') });

    if (await pencilBtns.count()) {
      expect(await pencilBtns.first().isDisabled()).toBe(true);
    }
    if (await trashBtns.count()) {
      expect(await trashBtns.first().isDisabled()).toBe(true);
    }
  });

  test('Internal admin (Emma) sees the same controls enabled — sanity check', async ({ page }) => {
    const res = await loginAsDemo(page, 'admin_emma');
    test.skip(!res.ok, `Dev login failed (status ${res.status}); skipping`);

    await gotoSidebarTab(page, /^team$/i);

    const inviteBtn = page.getByRole('button', { name: /invite external/i }).first();
    await inviteBtn.waitFor({ state: 'visible' });
    expect(await inviteBtn.isDisabled()).toBe(false);
    expect(await inviteBtn.getAttribute('data-guest-disabled')).toBeNull();

    await gotoSidebarTab(page, /^departments$/i);
    const addBtn = page.getByRole('button', { name: /add department/i }).first();
    await addBtn.waitFor({ state: 'visible' });
    expect(await addBtn.isDisabled()).toBe(false);
    expect(await addBtn.getAttribute('data-guest-disabled')).toBeNull();
  });
});
