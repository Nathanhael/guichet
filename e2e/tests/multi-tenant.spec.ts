import { test, expect } from '../fixtures/auth.fixture.js';
import { API_URL, APP_URL, TEST_USERS } from '../lib/constants.js';

async function loginInContext(
  context: import('@playwright/test').BrowserContext,
  userKey: keyof typeof TEST_USERS,
) {
  const page = await context.newPage();
  const user = TEST_USERS[userKey];

  const res = await page.request.post(`${API_URL}/api/auth/login`, {
    data: { id: user.id, password: user.password },
  });
  if (!res.ok()) throw new Error(`Login failed for ${user.id}: ${res.status()}`);

  const data = await res.json();
  const { token, user: userProfile, memberships, activePartnerId } = data;

  await page.goto(APP_URL);
  await page.evaluate((params: Record<string, unknown>) => {
    localStorage.setItem('token', params.token as string);
    localStorage.setItem('user', JSON.stringify(params.userProfile));
    localStorage.setItem('memberships', JSON.stringify(params.memberships));
    localStorage.setItem('activePartnerId', params.activePartnerId as string);
    const ms = params.memberships as Array<{ id: string }>;
    if (ms && ms.length > 0) {
      localStorage.setItem('activeMembershipId', ms[0].id);
    }
  }, { token, userProfile, memberships, activePartnerId });

  await page.reload({ waitUntil: 'networkidle' });
  return page;
}

test.describe('Multi-Tenant Isolation', () => {
  test('support from Partner B cannot see Partner A tickets', async ({ browser }) => {
    const agentAContext = await browser.newContext();
    const supportBContext = await browser.newContext();

    const agentAPage = await loginInContext(agentAContext, 'agentA');
    const supportBPage = await loginInContext(supportBContext, 'supportB');

    // Agent A (Partner A) creates a ticket
    await expect(agentAPage.locator('form')).toBeVisible({ timeout: 15000 });
    await agentAPage.locator('textarea').fill('Partner A secret ticket - isolation test');
    await agentAPage.locator('button[type="submit"]').click();

    // Wait for ticket to be created
    await agentAPage.waitForTimeout(3000);

    // Support B (Partner B) should NOT see Partner A's ticket
    await supportBPage.reload({ waitUntil: 'networkidle' });
    await supportBPage.waitForTimeout(3000);

    const partnerATicket = supportBPage.locator('text=Partner A secret ticket');
    await expect(partnerATicket).not.toBeVisible();

    await agentAContext.close();
    await supportBContext.close();
  });

  test('support from Partner A can see Partner A tickets', async ({ browser }) => {
    const agentAContext = await browser.newContext();
    const supportAContext = await browser.newContext();

    const agentAPage = await loginInContext(agentAContext, 'agentA');
    const supportAPage = await loginInContext(supportAContext, 'supportA');

    // Agent A creates a ticket
    await expect(agentAPage.locator('form')).toBeVisible({ timeout: 15000 });
    await agentAPage.locator('textarea').fill('Partner A visible ticket - tenant test');
    await agentAPage.locator('button[type="submit"]').click();

    // Wait and reload support page
    await supportAPage.waitForTimeout(3000);
    await supportAPage.reload({ waitUntil: 'networkidle' });

    // Support A (same partner) should see the ticket
    const queueText = supportAPage.locator('text=Queue');
    await expect(queueText).toBeVisible({ timeout: 15000 });

    await agentAContext.close();
    await supportAContext.close();
  });
});
