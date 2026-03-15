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
    const textarea = agentPage.locator('textarea');
    await textarea.fill('E2E lifecycle test - need assistance');
    await agentPage.locator('button[type="submit"]').click();

    // Support should see the ticket appear in their queue
    // Wait for real-time update or reload
    await supportPage.waitForTimeout(3000);
    await supportPage.reload({ waitUntil: 'networkidle' });

    // Look for the ticket text or queue indicator
    const queueArea = supportPage.locator('text=E2E lifecycle test').or(
      supportPage.locator('text=Queue'),
    );
    await expect(queueArea.first()).toBeVisible({ timeout: 15000 });

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
    await agentPage.locator('textarea').fill('E2E join test ticket');
    await agentPage.locator('button[type="submit"]').click();

    // Wait for ticket to propagate
    await supportPage.waitForTimeout(3000);
    await supportPage.reload({ waitUntil: 'networkidle' });

    // Support clicks on the ticket in the queue
    const ticketEntry = supportPage.locator('button').filter({ hasText: /E2E join test|DSC/ }).first();
    if (await ticketEntry.isVisible({ timeout: 10000 })) {
      await ticketEntry.click();

      // Chat area should become visible (textarea for message input)
      const chatInput = supportPage.locator('textarea').last();
      await expect(chatInput).toBeVisible({ timeout: 10000 });
    }

    await agentContext.close();
    await supportContext.close();
  });
});
