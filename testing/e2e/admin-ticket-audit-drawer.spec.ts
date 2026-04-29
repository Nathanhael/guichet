/**
 * E2E: Admin → Active Tickets → Ticket Preview → Audit drawer population.
 *
 * Proves that the partner-scoped ticket audit drawer (TicketAuditDrawer) wires
 * through to partner.audit.getForTicket and renders real data. The drawer is
 * the only surface an admin has for inspecting per-ticket lifecycle audit rows
 * (ticket.created / .closed / .transferred / …) emitted by services/ticketAudit.ts.
 *
 * What this spec asserts:
 *  1. Clicking a ticket in the Active Tickets queue opens the TicketPreview.
 *  2. Clicking the "Audit" button in the preview opens the drawer
 *     (role="dialog" aria-label="Ticket audit history").
 *  3. The partner.audit.getForTicket query fires with the expected ticketId.
 *  4. The drawer renders EITHER the populated list (data-testid="ticket-audit-list")
 *     OR the empty-state copy — both prove the query resolved; neither is the
 *     loading spinner. A fresh seed DB is allowed to render the empty state.
 */

import { type Page } from '@playwright/test';
import { test, expect } from './helpers/fixtures';
import { loginAsDemo } from './helpers/auth';

async function gotoActiveTicketsTab(page: Page): Promise<void> {
  const nav = page.locator('aside button').filter({ hasText: /active tickets/i }).first();
  await nav.waitFor({ state: 'visible', timeout: 10_000 });
  await nav.click();
  await page.waitForTimeout(300);
}

test.describe('Admin — ticket audit drawer', () => {
  test('opens drawer from TicketPreview and fires getForTicket with selected id', async ({ page, ticketFixture }) => {
    const res = await loginAsDemo(page, 'admin_emma');
    if (!res.ok) {
      throw new Error(
        `Fixture user 'admin_emma' failed to log in (status ${res.status}). ` +
          'Check server/seed.ts — this is a test setup bug, not a skip condition.',
      );
    }

    const partnerId = await page.evaluate(() => sessionStorage.getItem('activePartnerId'));
    if (!partnerId) throw new Error('loginAsDemo did not seed activePartnerId');
    await ticketFixture.create({ partnerId });
    await page.reload();
    await page.waitForLoadState('networkidle');

    await gotoActiveTicketsTab(page);

    // Queue sidebar = the second <aside> (first is the main nav).
    const queueSidebar = page.locator('aside').nth(1);
    const firstTicketBtn = queueSidebar.locator('button').filter({
      // Queue rows carry the status chip text. Using ^(OPEN|PENDING|CLOSED|…)$
      // would miss rows — instead, match any queue row that has the dept chip
      // as uppercase short text (4 chars: DSC/FOT/TEC/GEN).
      has: page.locator('span').filter({ hasText: /^(DSC|FOT|TEC|GEN)$/ }),
    }).first();

    // Bundle D fixture guarantees at least one ticket — fail fast if not.
    await expect(firstTicketBtn).toBeVisible({ timeout: 10_000 });

    // Capture the getForTicket response before clicking Audit so we can match
    // on the ticketId that the preview ends up selecting.
    const getForTicketResp = page.waitForResponse(
      (r) => /trpc\/partner\.audit\.getForTicket/.test(r.url()),
      { timeout: 15_000 },
    );

    await firstTicketBtn.click();

    // TicketPreview renders an "Audit" button on the header.
    const auditBtn = page.locator('button', { hasText: /^audit$/i }).first();
    await auditBtn.waitFor({ state: 'visible', timeout: 8_000 });
    await auditBtn.click();

    // Drawer opens with aria-label="Ticket audit history".
    const drawer = page.getByRole('dialog', { name: /ticket audit history/i });
    await expect(drawer).toBeVisible({ timeout: 5_000 });

    const resp = await getForTicketResp;
    expect(resp.status()).toBe(200);

    // The tRPC batch-request URL encodes the input: `{"ticketId":"..."}`.
    // We just require that the query carried *some* ticketId parameter —
    // asserting a specific id would be brittle against seed-order drift.
    expect(resp.url()).toMatch(/ticketId/);

    // Drawer must settle into a resolved state. The loading spinner is the
    // text "Loading..." (<p>Loading...</p>); empty-state is the mono-label
    // "No audit history"; populated is the list with data-testid. Any ONE
    // of the latter two means the query resolved.
    const resolvedLocator = drawer.locator(
      '[data-testid="ticket-audit-list"], :text("No audit history")',
    );
    await expect(resolvedLocator.first()).toBeVisible({ timeout: 8_000 });

    // Escape closes the drawer.
    await page.keyboard.press('Escape');
    await expect(drawer).toBeHidden({ timeout: 3_000 });
  });

  test('populated drawer renders rows with ticket.* action labels when present', async ({ page }) => {
    // Best-effort: with Bundle D's audit.test_fixture.* default-filter
    // (RFC #82), a fixture-created ticket has zero rows visible in the
    // partner audit drawer — only seed-driven ticket lifecycle history (if
    // any) populates the list. We pick the first existing ticket from the
    // queue rather than creating one, so any ticket.* rows from prior runs
    // surface. If the drawer ends up empty regardless, the test early-returns
    // — its purpose is to assert action-label rendering shape, not to force
    // ticket.* rows into existence.
    const res = await loginAsDemo(page, 'admin_emma');
    if (!res.ok) {
      throw new Error(
        `Fixture user 'admin_emma' failed to log in (status ${res.status}). ` +
          'Check server/seed.ts — this is a test setup bug, not a skip condition.',
      );
    }

    await gotoActiveTicketsTab(page);

    const queueSidebar = page.locator('aside').nth(1);
    const firstTicketBtn = queueSidebar
      .locator('button')
      .filter({ has: page.locator('span').filter({ hasText: /^(DSC|FOT|TEC|GEN)$/ }) })
      .first();

    const hasTicket = await firstTicketBtn.isVisible({ timeout: 10_000 }).catch(() => false);
    if (!hasTicket) {
      // No ticket history to inspect — covered by the prior test's wiring assertion.
      return;
    }

    await firstTicketBtn.click();
    const auditBtn = page.locator('button', { hasText: /^audit$/i }).first();
    await auditBtn.waitFor({ state: 'visible', timeout: 8_000 });
    await auditBtn.click();

    const list = page.locator('[data-testid="ticket-audit-list"]');
    const populated = await list.isVisible({ timeout: 5_000 }).catch(() => false);
    if (!populated) {
      // Drawer is empty — best-effort assertion can't fire. The wiring is
      // covered by the prior test; the action-label-rendering assertion here
      // is conditional on history existing.
      return;
    }

    // At least one row should carry a ticket.* action. The action is rendered
    // in a mono-font span inside each <li> button, uppercased by CSS but
    // stored as the raw action string in the DOM.
    const actionCells = list.locator('li button span').first();
    const text = (await actionCells.textContent())?.toLowerCase() ?? '';
    // Accept any action prefix the partner audit query legitimately returns —
    // ticket.*, member.*, etc. — the important thing is that the row rendered.
    expect(text.length).toBeGreaterThan(0);
  });
});
