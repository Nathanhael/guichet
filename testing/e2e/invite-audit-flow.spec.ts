/**
 * E2E: External invite → Pending Invites worklist → Partner-scoped audit log
 *
 * Exercises the round-trip for the "pending-invite worklist + partner-scoped
 * audit log" feature shipped in:
 *   - 38403db feat(members): add admin role to invite flow + harden guest offboarding
 *   - ee80a4f feat(admin): pending-invite worklist + partner-scoped audit log
 */

import { test, expect, type Page } from '@playwright/test';
import { loginAsDemo } from './helpers/auth';

async function gotoAdminTab(page: Page, label: RegExp): Promise<void> {
  const nav = page.locator('aside button').filter({ hasText: label }).first();
  await nav.waitFor({ state: 'visible', timeout: 10_000 });
  await nav.click();
  await page.waitForTimeout(300);
}

async function gotoPlatformTab(page: Page, label: RegExp): Promise<void> {
  const btn = page.locator('[role="tab"]', { hasText: label }).first();
  await btn.waitFor({ state: 'visible', timeout: 15_000 });
  await btn.click();
  await page.waitForTimeout(500);
}

function uniqueEmail(): string {
  const suffix = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  return `e2e-invite-${suffix}@e2e.test`;
}

/**
 * Open the Invite B2B guest dialog, submit as the requested role, and wait for
 * the server to acknowledge. Throws with server body on non-200 so failures
 * surface the real cause instead of a generic modal-still-open timeout.
 *
 * Note: the listMembers query filters out admins by default, so callers who
 * need the new member to appear in the Team table should pass `support` (and
 * accept that at least one department checkbox will be selected). Callers
 * that only care about the audit trail can pass `admin`.
 */
async function inviteGuest(
  page: Page,
  email: string,
  name: string,
  role: 'support' | 'admin',
): Promise<void> {
  const inviteBtn = page.getByRole('button', { name: /invite b2b guest/i }).first();
  await inviteBtn.waitFor({ state: 'visible', timeout: 10_000 });
  if (await inviteBtn.isDisabled()) {
    throw new Error('Invite B2B guest button is disabled');
  }
  await inviteBtn.click();

  const dialog = page.getByRole('dialog').first();
  await dialog.waitFor({ state: 'visible', timeout: 5_000 });

  // Soft-Product redesign normalized placeholder casing to sentence/email form:
  //   "FULL NAME" -> "Full name", "EMAIL@DOMAIN.COM" -> "user@domain.com".
  await dialog.locator('input[placeholder="Full name"]').fill(name);
  await dialog.locator('input[placeholder="user@domain.com"]').fill(email);
  await dialog.locator('select').first().selectOption(role);

  if (role === 'support') {
    // Support role needs at least one department. Click "Select all" (or fall
    // back to the first checkbox if the text changed).
    const selectAll = dialog.getByRole('button', { name: /select all|deselect all/i }).first();
    if (await selectAll.isVisible().catch(() => false)) {
      const label = await selectAll.textContent();
      if (/^select all/i.test(label ?? '')) await selectAll.click();
    } else {
      const firstDeptCheckbox = dialog.locator('input[type="checkbox"]').first();
      await firstDeptCheckbox.check().catch(() => undefined);
    }
  }

  // Soft-Product redesign renamed the submit button: "Provision user" -> "Send invite".
  const submitBtn = dialog.getByRole('button', { name: /send invite/i }).first();

  // Wait for the actual tRPC mutation response so we know the server handled
  // it. The client fires this as a POST to /api/v1/trpc/partner.inviteExternalUser.
  const responsePromise = page.waitForResponse(
    r => /trpc\/partner\.inviteExternalUser/.test(r.url()) && r.request().method() === 'POST',
    { timeout: 15_000 },
  );
  await submitBtn.click();
  const response = await responsePromise;
  if (response.status() !== 200) {
    const body = await response.text().catch(() => '<no body>');
    throw new Error(`inviteExternalUser returned ${response.status()}: ${body.slice(0, 500)}`);
  }

  // Post-Phase-9 invite flow has a 2-stage UX: on success the modal pivots
  // to the "Local record created" handoff panel surfacing the Azure B2B
  // step the operator still needs to do. The dialog only fully closes once
  // we click "Done" — wait for the handoff panel, then dismiss.
  const doneBtn = dialog.getByRole('button', { name: /^done$/i }).first();
  await doneBtn.waitFor({ state: 'visible', timeout: 10_000 });
  await doneBtn.click();
  await dialog.waitFor({ state: 'hidden', timeout: 10_000 });
}

test.describe('Invite → Audit Log → Pending Invites worklist', () => {
  test('invite external guest surfaces member.invited entry in Audit Log tab', async ({ page }) => {
    const res = await loginAsDemo(page, 'admin_emma');
    if (!res.ok) {
      throw new Error(
        `Fixture user 'admin_emma' failed to log in (status ${res.status}). ` +
          'Check server/seed.ts — this is a test setup bug, not a skip condition.',
      );
    }

    const email = uniqueEmail();

    await gotoAdminTab(page, /^team$/i);
    await inviteGuest(page, email, 'E2E Invite Subject', 'admin');

    // Navigate to Audit Log tab and filter by member.invited.
    await gotoAdminTab(page, /audit log/i);

    const actionSelect = page.locator('select').filter({ has: page.locator('option[value="member.invited"]') }).first();
    await actionSelect.waitFor({ state: 'visible', timeout: 10_000 });
    await actionSelect.selectOption('member.invited');
    await page.waitForTimeout(1000);

    // The row for our fresh invite must be visible in the table body.
    const rowWithEmail = page.locator('tbody tr', { hasText: email }).first();
    await expect(rowWithEmail).toBeVisible({ timeout: 10_000 });
  });

  // The "removed guest shows member.removed rows when wasExternal filter is enabled"
  // test was deleted in Bundle D / RFC #82 cleanup. Pending invites no longer
  // surface in the team table since the "B2B Guest invites" panel split (commit
  // 36339bc); the table only renders activated members, so the Trash2 Remove
  // button this test depended on cannot be reached for a freshly invited user
  // without faking the Azure link or adding a pre-activated test fixture to
  // seed.ts. The `member.removed` + wasExternal=true audit path is exercised by
  // `server/__integration__/*` at the service layer instead.

  test('platform operator Pending Invites tab lists unlinked external members', async ({ page }) => {
    // Seed a pending invite first as the tenant admin.
    const loginEmma = await loginAsDemo(page, 'admin_emma');
    if (!loginEmma.ok) {
      throw new Error(
        `Fixture user 'admin_emma' failed to log in (status ${loginEmma.status}). ` +
          'Check server/seed.ts — this is a test setup bug, not a skip condition.',
      );
    }

    const email = uniqueEmail();
    await gotoAdminTab(page, /^team$/i);
    await inviteGuest(page, email, 'E2E Pending', 'admin');

    const loginBart = await loginAsDemo(page, 'platform_bart', { lang: 'en' });
    if (!loginBart.ok) {
      throw new Error(
        `Fixture user 'platform_bart' failed to log in (status ${loginBart.status}). ` +
          'Check server/seed.ts — this is a test setup bug, not a skip condition.',
      );
    }
    await page.waitForTimeout(2000);

    await gotoPlatformTab(page, /invites|uitnodigingen|invitations/i);

    await expect(page.getByText(/pending entra invites/i).first()).toBeVisible({ timeout: 10_000 });

    const row = page.locator('tbody tr', { hasText: email }).first();
    await expect(row).toBeVisible({ timeout: 10_000 });

    const copyBtn = row.getByRole('button', { name: /copy email/i }).first();
    await expect(copyBtn).toBeVisible();
  });

  test('platform operator can revoke a pending invite → row disappears, mutation returns 200', async ({ page }) => {
    // Seed a pending invite as admin_emma.
    const loginEmma = await loginAsDemo(page, 'admin_emma');
    if (!loginEmma.ok) {
      throw new Error(
        `Fixture user 'admin_emma' failed to log in (status ${loginEmma.status}). ` +
          'Check server/seed.ts — this is a test setup bug, not a skip condition.',
      );
    }

    const email = uniqueEmail();
    await gotoAdminTab(page, /^team$/i);
    await inviteGuest(page, email, 'E2E Revoke Me', 'admin');

    // Switch to platform operator.
    await page.evaluate(() => sessionStorage.clear());
    const loginBart = await loginAsDemo(page, 'platform_bart', { lang: 'en' });
    if (!loginBart.ok) {
      throw new Error(
        `Fixture user 'platform_bart' failed to log in (status ${loginBart.status}). ` +
          'Check server/seed.ts — this is a test setup bug, not a skip condition.',
      );
    }
    await page.waitForTimeout(2000);

    await gotoPlatformTab(page, /invites|uitnodigingen|invitations/i);
    await expect(page.getByText(/pending entra invites/i).first()).toBeVisible({ timeout: 10_000 });

    const row = page.locator('tbody tr', { hasText: email }).first();
    await expect(row).toBeVisible({ timeout: 10_000 });

    // Click the Revoke button inside that row.
    await row.getByRole('button', { name: /^revoke$/i }).click();

    // Custom ConfirmDialog (role="dialog" aria-modal="true") opens. Click its
    // Revoke button and wait for the tRPC mutation response.
    const dialog = page.getByRole('dialog').first();
    await dialog.waitFor({ state: 'visible', timeout: 5_000 });

    const revokePromise = page.waitForResponse(
      r => /trpc\/platform\.revokePendingInvite/.test(r.url()) && r.request().method() === 'POST',
      { timeout: 15_000 },
    );
    await dialog.getByRole('button', { name: /^revoke$/i }).click();
    const revokeResp = await revokePromise;
    if (revokeResp.status() !== 200) {
      const body = await revokeResp.text().catch(() => '<no body>');
      throw new Error(`revokePendingInvite returned ${revokeResp.status()}: ${body.slice(0, 500)}`);
    }

    // Row for that email must be gone after the list invalidates.
    const removedRow = page.locator('tbody tr', { hasText: email });
    await expect(removedRow).toHaveCount(0, { timeout: 10_000 });
  });
});
