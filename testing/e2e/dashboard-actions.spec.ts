/**
 * E2E: Admin Dashboard — Z1 action-list row click-throughs.
 *
 * Spec §5: each action-list row routes to its drill-down destination
 * (SLA breach / abandoned -> ticket, feedback -> AdminFeedback, pending
 * invite -> AdminTeam Pending Invites). Z2 scorecard cards likewise route.
 *
 * Mocks the action-list and onboarding tRPC responses so the assertions
 * are deterministic regardless of seed contents — the spec is verifying
 * the link wiring, not the backend computation (covered by unit tests).
 */

import { test, expect, type Page } from '@playwright/test';
import { loginAsDemo, BASE } from './helpers/auth';
import { mockDashboardTrpc } from './helpers/trpc-mock';

async function mockDashboardForActions(page: Page) {
  await mockDashboardTrpc(page, {
    'dashboard.getOnboardingState': {
      isNewPartner: false,
      steps: [],
    },
    'dashboard.getActionList': {
      slaBreaches: [
        {
          kind: 'sla_breach',
          id: 'b-1',
          ticketId: 'ticket-acme-1',
          ticketTitle: 'Acme — login broken',
          breachedAt: new Date().toISOString(),
          linkTarget: '/admin/tickets/ticket-acme-1',
        },
      ],
      abandoned: [
        {
          kind: 'abandoned',
          id: 'ticket-acme-2',
          ticketId: 'ticket-acme-2',
          ticketTitle: 'Bigcorp — reset',
          abandonedAt: new Date().toISOString(),
          linkTarget: '/admin/tickets/ticket-acme-2',
        },
      ],
      untreatedFeedback: [
        {
          kind: 'feedback_untreated',
          id: 'fb-1',
          feedbackType: 'bug',
          preview: 'Cannot upload attachment',
          submittedAt: new Date().toISOString(),
          linkTarget: '/admin/feedback?focus=fb-1',
        },
      ],
      pendingInvites: [
        {
          kind: 'pending_invite',
          id: 'inv-1',
          email: 'new@partner.com',
          role: 'support',
          expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
          linkTarget: '/admin/team?tab=invites&focus=inv-1',
        },
      ],
    },
  });
}

test.describe('Admin Dashboard — Z1 row click-throughs', () => {
  test.beforeEach(async ({ page }) => {
    const res = await loginAsDemo(page, 'admin_emma');
    test.skip(!res.ok, 'admin_emma seed not available');
    await mockDashboardForActions(page);
    await page.goto(`${BASE}/`);
    await page.waitForLoadState('load');
  });

  test('SLA breach row links to the ticket', async ({ page }) => {
    const link = page.getByRole('link', { name: /Acme — login broken/ });
    await expect(link).toBeVisible();
    await expect(link).toHaveAttribute('href', '/admin/tickets/ticket-acme-1');
  });

  test('abandoned-ticket row links to the ticket', async ({ page }) => {
    const link = page.getByRole('link', { name: /Bigcorp — reset/ });
    await expect(link).toBeVisible();
    await expect(link).toHaveAttribute('href', '/admin/tickets/ticket-acme-2');
  });

  test('untreated-feedback row links to AdminFeedback focused on the item', async ({ page }) => {
    const link = page.getByRole('link', { name: /Cannot upload attachment/ });
    await expect(link).toBeVisible();
    await expect(link).toHaveAttribute('href', '/admin/feedback?focus=fb-1');
  });

  test('pending-invite row links to AdminTeam pending-invites tab', async ({ page }) => {
    const link = page.getByRole('link', { name: /new@partner.com/ });
    await expect(link).toBeVisible();
    await expect(link).toHaveAttribute('href', '/admin/team?tab=invites&focus=inv-1');
  });

  test('all four buckets render under their named categories', async ({ page }) => {
    await expect(page.getByText(/SLA breaches/i)).toBeVisible();
    await expect(page.getByText(/^Abandoned$/)).toBeVisible();
    await expect(page.getByText(/Untreated feedback/i)).toBeVisible();
    await expect(page.getByText(/Pending invites/i)).toBeVisible();
  });

  test('each Z2 scorecard card is a link to its drill-down destination', async ({ page }) => {
    const slaCard = page.getByRole('link', { name: 'SLA' });
    const csatCard = page.getByRole('link', { name: 'CSAT' });
    const volumeCard = page.getByRole('link', { name: 'Volume' });
    await expect(slaCard).toHaveAttribute('href', '/admin/tickets?slaBreached=1');
    await expect(csatCard).toHaveAttribute('href', '/admin/satisfaction');
    await expect(volumeCard).toHaveAttribute('href', '/admin/tickets');
  });
});
