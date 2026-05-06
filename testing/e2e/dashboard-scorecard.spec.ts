/**
 * E2E: Admin Dashboard — Z2 scorecard click-throughs.
 *
 * Spec §5: each scorecard card routes to its drill-down destination
 * (SLA -> ticket queue filtered by breach, CSAT -> AdminSatisfaction,
 * Volume -> ticket queue).
 *
 * Mocks the onboarding tRPC response so the assertion runs even on a
 * brand-new partner that would otherwise see the onboarding checklist.
 */

import { test, expect, type Page } from '@playwright/test';
import { loginAsDemo, BASE } from './helpers/auth';
import { mockDashboardTrpc } from './helpers/trpc-mock';

async function mockDashboard(page: Page) {
  await mockDashboardTrpc(page, {
    'dashboard.getOnboardingState': {
      isNewPartner: false,
      steps: [],
    },
  });
}

test.describe('Admin Dashboard — Z2 scorecard click-throughs', () => {
  test.beforeEach(async ({ page }) => {
    const res = await loginAsDemo(page, 'admin_emma');
    if (!res.ok) {
      throw new Error(
        `Fixture user 'admin_emma' failed to log in (status ${res.status}). ` +
          'Check server/seed.ts — this is a test setup bug, not a skip condition.',
      );
    }
    await mockDashboard(page);
    await page.goto(`${BASE}/`);
    await page.waitForLoadState('load');
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
