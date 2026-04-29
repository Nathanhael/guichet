/**
 * E2E: Admin Dashboard — onboarding mode.
 *
 * Spec §7: a brand-new partner (zero closed tickets, zero non-admin
 * staff) sees a 4-step checklist instead of the 5 zones; auto-hides as
 * soon as the first ticket lands or the first non-admin teammate joins.
 *
 * The seeded Acme partner has data, so we mock `dashboard.getOnboardingState`
 * via Playwright's network interception to flip the gate. The behavior
 * under test is the UI gate, not the backend computation (covered by the
 * pure-service unit tests).
 */

import { test, expect, type Page } from '@playwright/test';
import { loginAsDemo, BASE } from './helpers/auth';
import { mockDashboardTrpc } from './helpers/trpc-mock';

async function mockOnboardingState(
  page: Page,
  isNewPartner: boolean,
  doneSteps: Array<'departments' | 'team' | 'businessHours' | 'sla'> = [],
) {
  const stepIds = ['departments', 'team', 'businessHours', 'sla'] as const;
  const stepLabels: Record<(typeof stepIds)[number], string> = {
    departments: 'Add your departments',
    team: 'Invite teammates',
    businessHours: 'Set business hours',
    sla: 'Configure SLA',
  };
  await mockDashboardTrpc(page, {
    'dashboard.getOnboardingState': {
      isNewPartner,
      steps: stepIds.map((id) => ({
        id,
        label: stepLabels[id],
        done: doneSteps.includes(id),
      })),
    },
  });
}

test.describe('Admin Dashboard — onboarding mode', () => {
  test.beforeEach(async ({ page }) => {
    const res = await loginAsDemo(page, 'admin_emma');
    if (!res.ok) {
      throw new Error(
        `Fixture user 'admin_emma' failed to log in (status ${res.status}). ` +
          'Check server/seed.ts — this is a test setup bug, not a skip condition.',
      );
    }
  });

  test('renders the 4-step checklist when isNewPartner=true', async ({ page }) => {
    await mockOnboardingState(page, true);
    await page.goto(`${BASE}/`);
    await page.waitForLoadState('load');

    await expect(page.getByText('Add your departments')).toBeVisible();
    await expect(page.getByText('Invite teammates')).toBeVisible();
    await expect(page.getByText('Set business hours')).toBeVisible();
    await expect(page.getByText('Configure SLA')).toBeVisible();
  });

  test('hides the dashboard zones when in onboarding mode', async ({ page }) => {
    await mockOnboardingState(page, true);
    await page.goto(`${BASE}/`);
    await page.waitForLoadState('load');

    await expect(page.getByTestId('dashboard-zone-actions')).toHaveCount(0);
    await expect(page.getByTestId('dashboard-zone-scorecard')).toHaveCount(0);
    await expect(page.getByTestId('dashboard-zone-trends')).toHaveCount(0);
    await expect(page.getByTestId('dashboard-view')).toHaveAttribute('data-mode', 'onboarding');
  });

  test('shows the dashboard zones when isNewPartner=false', async ({ page }) => {
    await mockOnboardingState(page, false);
    await page.goto(`${BASE}/`);
    await page.waitForLoadState('load');

    await expect(page.getByTestId('dashboard-zone-actions')).toBeVisible();
    await expect(page.getByText('Add your departments')).toHaveCount(0);
  });

  test('progress chip reflects done step count', async ({ page }) => {
    await mockOnboardingState(page, true, ['departments', 'businessHours']);
    await page.goto(`${BASE}/`);
    await page.waitForLoadState('load');

    await expect(page.getByTestId('onboarding-progress')).toHaveText(/2 of 4/);
  });

  test('each step is a link to its setup destination', async ({ page }) => {
    await mockOnboardingState(page, true);
    await page.goto(`${BASE}/`);
    await page.waitForLoadState('load');

    const teamStep = page.getByTestId('onboarding-step-team');
    const link = teamStep.getByRole('link');
    await expect(link).toHaveAttribute('href', '/admin/team');
  });
});
