import { test, expect } from '../fixtures/auth.fixture.js';

test.describe('Authentication', () => {
  test('agent login lands on AgentView', async ({ loginAs, page }) => {
    await loginAs('agentA');
    
    // Check for "Select your user" - if visible, login failed
    await expect(page.locator('text=Select your user')).not.toBeVisible();

    // Check for closed notice - if visible, business hours guard is active
    const closedNotice = page.locator('text=Support chat closed');
    if (await closedNotice.isVisible()) {
      console.warn('E2E: Business hours guard is active (chat is closed).');
    }

    // AgentView has a form for ticket creation
    await expect(page.locator('form')).toBeVisible({ timeout: 15000 });
    await expect(page.getByText('Agent', { exact: true }).first()).toBeVisible();
  });

  test('support login lands on SupportView', async ({ loginAs, page }) => {
    await loginAs('supportA');
    // SupportView has a "Queue" heading
    await expect(page.getByRole('heading', { name: 'Queue' })).toBeVisible({ timeout: 15000 });
  });

  test('admin login lands on AdminView', async ({ loginAs, page }) => {
    await loginAs('adminA');
    // AdminView has a "Dashboard" nav button
    await expect(page.getByRole('button', { name: 'Dashboard' })).toBeVisible({ timeout: 15000 });
  });
});
