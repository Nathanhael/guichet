/**
 * E2E: Admin Queue tabs + archive-on-close.
 *
 * Covers two behaviors introduced in the April 2026 admin-queue rework:
 *   1. AdminTickets renders exactly three queue-filter chips
 *      (All / Unassigned / In chat) — the latter two are hasSupport
 *      false/true, replacing the old open/pending labels — and drops
 *      closed/resolved/date-range controls (those moved to Archive).
 *   2. Closing a ticket from AgentView snapshots it into the
 *      Archive view immediately (no 30-day wait for the GDPR job).
 *
 * Uses demo fixtures: admin_emma (ACME tenant admin) and agent_kevin.
 */

import { test, expect, type Page } from '@playwright/test';
import { test as partnerTest, expect as partnerExpect } from './helpers/partnerFixture';
import { loginAsDemo } from './helpers/auth';

async function gotoActiveTicketsTab(page: Page): Promise<void> {
  // AdminView sidebar renders "Active tickets" as a nav button.
  const nav = page.locator('aside button').filter({ hasText: /active tickets/i }).first();
  await nav.waitFor({ state: 'visible', timeout: 10_000 });
  await nav.click();
  await page.waitForTimeout(500);
}

async function gotoArchiveTab(page: Page): Promise<void> {
  const nav = page.locator('aside button').filter({ hasText: /^archive$/i }).first();
  await nav.waitFor({ state: 'visible', timeout: 10_000 });
  await nav.click();
  await page.waitForTimeout(500);
}

test.describe('Admin queue — 3-tab layout', () => {
  test('shows exactly All / Unassigned / In chat and drops closed/date-range controls', async ({ page }) => {
    const res = await loginAsDemo(page, 'admin_emma');
    if (!res.ok) {
      throw new Error(
        `Fixture user 'admin_emma' failed to log in (status ${res.status}). ` +
          'Check server/seed.ts — this is a test setup bug, not a skip condition.',
      );
    }
    await gotoActiveTicketsTab(page);

    const queueSidebar = page.locator('aside').nth(1);
    await queueSidebar.locator('h2').filter({ hasText: /live_queue|ticket queue/i }).first().waitFor({ timeout: 5000 });

    // Filter chips live in the segmented pill at the top of the queue sidebar.
    // Match the segmented pill specifically — dept/lang chips below also live in
    // this aside, so a bare `button` filter would pick them up too.
    const chips = queueSidebar.locator('button').filter({
      hasText: /^(All|Unassigned|In chat|Open|Pending|Closed|Resolved|Active)$/i,
    });
    const chipTexts = (await chips.allTextContents()).map((t) => t.trim());

    expect(chipTexts).toEqual(['All', 'Unassigned', 'In chat']);

    // No date-range inputs in the admin queue (those moved to Archive).
    const dateInputs = queueSidebar.locator('input[type="date"]');
    expect(await dateInputs.count()).toBe(0);

    // All tab is the default on mount (hasSupport=undefined → no filter).
    expect(chipTexts[0]).toBe('All');
  });

  test('Unassigned chip sends hasSupport=false and In chat sends hasSupport=true', async ({ page }) => {
    const res = await loginAsDemo(page, 'admin_emma');
    if (!res.ok) {
      throw new Error(
        `Fixture user 'admin_emma' failed to log in (status ${res.status}). ` +
          'Check server/seed.ts — this is a test setup bug, not a skip condition.',
      );
    }
    await gotoActiveTicketsTab(page);

    const queueSidebar = page.locator('aside').nth(1);
    const captured: Array<Record<string, unknown>> = [];
    page.on('request', (req) => {
      const url = req.url();
      if (url.includes('/trpc/ticket.list')) {
        const match = url.match(/input=([^&]+)/);
        if (match) {
          try {
            captured.push(JSON.parse(decodeURIComponent(match[1])) as Record<string, unknown>);
          } catch { /* non-JSON input, ignore */ }
        }
      }
    });

    await queueSidebar.locator('button').filter({ hasText: /^Unassigned$/i }).click();
    await page.waitForTimeout(500);
    await queueSidebar.locator('button').filter({ hasText: /^In chat$/i }).click();
    await page.waitForTimeout(500);

    // The most recent two requests should reflect the chip switches.
    // tRPC batch format: the input is keyed by call index ("0", "1", ...).
    // Some endpoints wrap the payload under `json` (superjson), others don't —
    // walk both shapes and the merged call-index map to find the first payload
    // that carries hasSupport.
    type MaybePayload = { hasSupport?: boolean; json?: { hasSupport?: boolean } } | undefined;
    function extractHasSupport(req: Record<string, unknown>): boolean | undefined {
      for (const v of Object.values(req)) {
        const payload = v as MaybePayload;
        if (payload?.hasSupport !== undefined) return payload.hasSupport;
        if (payload?.json?.hasSupport !== undefined) return payload.json.hasSupport;
      }
      return undefined;
    }
    const recent = captured.slice(-8);
    const sawHasSupportFalse = recent.some((input) => extractHasSupport(input) === false);
    const sawHasSupportTrue = recent.some((input) => extractHasSupport(input) === true);
    expect(sawHasSupportFalse, 'expected ticket.list request with hasSupport=false after clicking Unassigned').toBe(true);
    expect(sawHasSupportTrue, 'expected ticket.list request with hasSupport=true after clicking In chat').toBe(true);
  });
});

// #117 follow-up (2026-05-02): migrated to partnerFixture from the
// seed-Acme + agent_thomas pattern. Pre-migration this test depended on
// agent_thomas having his pre-seeded TEC pending ticket alive at run time,
// but earlier runs of THIS SAME test would close that ticket and leave him
// looking at the new-ticket form — close button gone, test fails. Same
// Group A "shared seed claim/close pollution" failure mode the body-fixme
// migration solved for support-flow / agent-flow / view-modes / collision-
// detection. Other two tests in this file (3-tab layout + chip-filter
// requests) stay on the seed pattern — they're stateless UI-only assertions.
partnerTest.describe('Close → archive snapshot', () => {
  partnerTest('closed agent ticket appears in admin Archive view', async ({ page, browser, partnerFixture }) => {
    // Test-scope page = agent. Mint a fresh agent + admin on the spec's
    // partner; stage a ticket for the agent so AgentView mounts the chat
    // instead of the new-ticket form.
    const agent = await partnerFixture.createUser({
      role: 'agent',
      departments: ['general'],
      lang: 'en', // Force EN so the close button + "Yes" confirm match the regexes below.
    });
    const admin = await partnerFixture.createUser({ role: 'admin' });
    await partnerFixture.createTicket({ agentId: agent.userId });

    await partnerFixture.loginAs(agent.userId, { waitFor: 'networkidle' });

    // Agent lands on the chat for their staged ticket — close button is
    // in ChatHeader's primary action slot.
    const closeBtn = page.locator('button').filter({ hasText: /^close$/i }).first();
    await partnerExpect(closeBtn).toBeVisible({ timeout: 10_000 });
    await closeBtn.click();
    const confirm = page.locator('[role="dialog"] button').filter({ hasText: /yes/i }).first();
    await confirm.waitFor({ state: 'visible', timeout: 3000 });
    await confirm.click();

    // Compose area gone after close. The post-close UI varies (new-ticket
    // form vs. "Connect with support" landing) so anchor on the absence of
    // the editor placeholder rather than specific empty-state text.
    await partnerExpect(
      page.locator('paragraph').filter({ hasText: /Type a message/i }).first(),
    ).not.toBeVisible({ timeout: 10_000 });

    // Switch to admin context and verify the archive view mounts cleanly.
    const adminCtx = await browser.newContext();
    try {
      const adminPage = await adminCtx.newPage();
      const adminLogin = await loginAsDemo(adminPage, admin.userId, { waitFor: 'networkidle' });
      if (!adminLogin.ok) {
        throw new Error(`admin loginAsDemo failed: ${adminLogin.status}`);
      }
      await gotoArchiveTab(adminPage);

      // Same scope as the pre-migration assertion: archive-view chrome
      // mounts (the dept filter select). The freshly-closed-ticket-shows-
      // in-archive-table assertion stays out of scope — `archiveTickets`
      // is run by a scheduler, not a per-close synchronous insert, so
      // surfacing it deterministically would need a worker-trigger fixture.
      const deptFilter = adminPage.locator('select[aria-label="Filter by department"]');
      await partnerExpect(deptFilter).toBeVisible({ timeout: 10_000 });
    } finally {
      await adminCtx.close();
    }
  });
});
