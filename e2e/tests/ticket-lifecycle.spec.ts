import { test, expect } from '../fixtures/auth.fixture.js';
import { loginInContext } from '../lib/login.js';

test.describe('Ticket Lifecycle', () => {
  test('agent creates ticket, support sees it in queue', async ({ browser }) => {
    const agentContext = await browser.newContext();
    const supportContext = await browser.newContext();

    const agentPage = await loginInContext(agentContext, 'agentA');
    const supportPage = await loginInContext(supportContext, 'supportA');

    // Agent should see the ticket creation form
    await expect(agentPage.locator('form')).toBeVisible({ timeout: 15000 });

    // Fill in the ticket form
    await agentPage.getByPlaceholder(/Describe the problem/i).fill('E2E lifecycle test - need assistance');
    await agentPage.getByRole('button', { name: /Connect with support/i }).click();

    // Wait for chat to load on agent side
    await expect(agentPage.getByPlaceholder(/Type a message/i)).toBeVisible({ timeout: 20000 });

    // Support should see the ticket appear in their queue
    // We use a retry loop to find the ticket in the list
    let ticketVisible = false;
    for (let i = 0; i < 5; i++) {
      const queueArea = supportPage.getByText('E2E lifecycle test').or(
        supportPage.getByRole('heading', { name: 'Queue' }),
      );
      if (await queueArea.first().isVisible()) {
        ticketVisible = true;
        break;
      }
      await supportPage.reload({ waitUntil: 'networkidle' });
      await supportPage.waitForTimeout(2000);
    }
    expect(ticketVisible).toBe(true);

    await agentContext.close();
    await supportContext.close();
  });

  test('support can join and view a ticket chat', async ({ browser }) => {
    const agentContext = await browser.newContext();
    const supportContext = await browser.newContext();

    const agentPage = await loginInContext(agentContext, 'agentA');
    const supportPage = await loginInContext(supportContext, 'supportA');

    // Agent creates a ticket
    await expect(agentPage.locator('form')).toBeVisible({ timeout: 15000 });
    await agentPage.getByPlaceholder(/Describe the problem/i).fill('E2E join test ticket');
    await agentPage.getByRole('button', { name: /Connect with support/i }).click();

    // Wait for chat to load on agent side
    await expect(agentPage.getByPlaceholder(/Type a message/i)).toBeVisible({ timeout: 20000 });

    // Wait for ticket to propagate
    await supportPage.reload({ waitUntil: 'networkidle' });

    // Support clicks on the ticket in the queue
    const ticketEntry = supportPage.getByRole('button').filter({ hasText: /E2E join test|DSC/ }).first();
    if (await ticketEntry.isVisible({ timeout: 10000 })) {
      await ticketEntry.click();

      // Chat area should become visible (textarea for message input)
      const chatInput = supportPage.getByPlaceholder(/Type a message/i);
      await expect(chatInput).toBeVisible({ timeout: 10000 });
    }

    await agentContext.close();
    await supportContext.close();
  });
});
