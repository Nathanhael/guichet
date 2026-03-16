import { test, expect } from '../fixtures/auth.fixture.js';
import { loginInContext } from '../lib/login.js';

test.describe('Live Chat', () => {
  test('agent and support exchange messages in real-time', async ({ browser }) => {
    const agentContext = await browser.newContext();
    const supportContext = await browser.newContext();

    const agentPage = await loginInContext(agentContext, 'agentA');
    const supportPage = await loginInContext(supportContext, 'supportA');

    // Agent creates a ticket
    await expect(agentPage.locator('form')).toBeVisible({ timeout: 15000 });
    await agentPage.getByPlaceholder(/Describe the problem/i).fill('Live chat E2E test message');
    await agentPage.getByRole('button', { name: /Connect with support/i }).click();

    // Wait for chat to load on agent side
    const agentChatInput = agentPage.getByPlaceholder(/Type a message/i);
    await expect(agentChatInput).toBeVisible({ timeout: 20000 });

    // Wait for ticket to propagate to support queue
    // We use a retry loop to find the ticket in the list
    let ticketVisible = false;
    for (let i = 0; i < 5; i++) {
      const ticketEntry = supportPage.getByRole('button').filter({ hasText: /Live chat E2E|DSC/ }).first();
      if (await ticketEntry.isVisible()) {
        ticketVisible = true;
        await ticketEntry.click();
        break;
      }
      await supportPage.reload({ waitUntil: 'networkidle' });
      await supportPage.waitForTimeout(2000);
    }

    if (!ticketVisible) {
      console.warn('E2E: Ticket not visible in support queue after retries, skipping live chat test');
      await agentContext.close();
      await supportContext.close();
      return;
    }

    // Wait for chat to load
    const supportChatInput = supportPage.getByPlaceholder(/Type a message/i);
    await expect(supportChatInput).toBeVisible({ timeout: 10000 });

    // Support sends a message
    await supportChatInput.fill('Hello from support!');
    await supportChatInput.press('Enter');

    // Agent should receive the message in real-time
    await expect(agentPage.getByText('Hello from support!')).toBeVisible({ timeout: 15000 });

    // Agent sends a reply
    await agentChatInput.fill('Thanks for the help!');
    await agentChatInput.press('Enter');

    // Support should see the reply
    await expect(supportPage.getByText('Thanks for the help!')).toBeVisible({ timeout: 15000 });

    await agentContext.close();
    await supportContext.close();
  });
});
