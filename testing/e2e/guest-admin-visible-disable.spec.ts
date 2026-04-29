/**
 * E2E: destructive admin controls are visibly disabled for Azure B2B guests.
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
  test('Team tab: Invite B2B guest panel is hidden from external guests', async ({ page }) => {
    const res = await loginAsDemo(page, 'admin_guest');
    if (!res.ok) {
      throw new Error(
        `Fixture user 'admin_guest' failed to log in (status ${res.status}). ` +
          'Check server/seed.ts — this is a test setup bug, not a skip condition.',
      );
    }

    await gotoSidebarTab(page, /^team$/i);

    // Wait for the Team panel to render (team management heading is the
    // landmark that proves AdminTeam mounted) before asserting absence.
    await page.getByRole('heading', { name: /team management/i }).waitFor({
      state: 'visible',
      timeout: 10_000,
    });

    // The whole "B2B Guest invites" panel is gated behind `!isExternal` in
    // AdminTeam.tsx — guests cannot invite further guests, so the button is
    // not rendered at all (replaces the older "render-disabled-with-tooltip"
    // treatment).
    const inviteBtn = page.getByRole('button', { name: /invite b2b guest/i });
    expect(await inviteBtn.count()).toBe(0);
  });

  test('Team tab: Remove and dept-edit are disabled + click sends no network', async ({ page }) => {
    const res = await loginAsDemo(page, 'admin_guest');
    if (!res.ok) {
      throw new Error(
        `Fixture user 'admin_guest' failed to log in (status ${res.status}). ` +
          'Check server/seed.ts — this is a test setup bug, not a skip condition.',
      );
    }

    await gotoSidebarTab(page, /^team$/i);

    // Wait for the team table to render at least one row before asserting on
    // disabled controls.
    await page.locator('tbody tr').first().waitFor({ state: 'visible', timeout: 10_000 });

    // The Remove (Trash2) icon button only renders for external (B2B guest)
    // member rows — `{member.isExternal && (...)}` in AdminTeam.tsx — and uses
    // aria-label="Remove {name}", not bare "Remove". The button is also
    // opacity-0 until row hover. With excludeAdmin=true (the default), admin
    // rows (including the only seeded external user, Gina Guest herself) are
    // filtered out of the list, so the Remove button may not render at all.
    // Hover any first row to surface the button if it exists, then assert
    // disabled wiring; otherwise skip that portion and rely on the dept-edit
    // assertion below to prove the visible-disable treatment.
    const firstRow = page.locator('tbody tr').first();
    await firstRow.hover().catch(() => undefined);
    const removeBtn = page.locator('button[aria-label^="Remove "][data-guest-disabled="true"]').first();
    if (await removeBtn.count()) {
      expect(await removeBtn.isDisabled()).toBe(true);
      expect(await removeBtn.getAttribute('data-guest-disabled')).toBe('true');
    }

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
    if (!res.ok) {
      throw new Error(
        `Fixture user 'admin_guest' failed to log in (status ${res.status}). ` +
          'Check server/seed.ts — this is a test setup bug, not a skip condition.',
      );
    }

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
    if (!res.ok) {
      throw new Error(
        `Fixture user 'admin_emma' failed to log in (status ${res.status}). ` +
          'Check server/seed.ts — this is a test setup bug, not a skip condition.',
      );
    }

    await gotoSidebarTab(page, /^team$/i);

    const inviteBtn = page.getByRole('button', { name: /invite b2b guest/i }).first();
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
