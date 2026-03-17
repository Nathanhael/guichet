import { Browser } from '@playwright/test';
import { expect } from '@playwright/test';
import { loginInContext } from './login.js';

export async function setupChat(browser: Browser, ticketMessage: string) {
  const agentContext = await browser.newContext();
  const supportContext = await browser.newContext();

  const agentPage = await loginInContext(agentContext, 'agentA');
  const supportPage = await loginInContext(supportContext, 'supportA');

  // Agent creates ticket
  await expect(agentPage.locator('form')).toBeVisible({ timeout: 15000 });
  await agentPage.getByPlaceholder(/Describe the problem/i).fill(ticketMessage);
  await agentPage.getByRole('button', { name: /Connect with support/i }).click();

  // Wait for agent to enter chat
  const agentChatInput = agentPage.getByPlaceholder(/Type a message/i);
  await expect(agentChatInput).toBeVisible({ timeout: 20000 });

  // Support finds and claims ticket
  let ticketVisible = false;
  for (let i = 0; i < 5; i++) {
    const ticketEntry = supportPage.getByRole('listitem').filter({ hasText: /E2E Agent A/i }).first();
    if (await ticketEntry.isVisible()) {
      ticketVisible = true;
      await ticketEntry.getByRole('button', { name: /Join/i }).click();
      break;
    }
    await supportPage.reload({ waitUntil: 'networkidle' });
    await supportPage.waitForTimeout(2000);
  }

  if (!ticketVisible) throw new Error("Ticket did not appear in support queue");
  const supportChatInput = supportPage.getByPlaceholder(/Type a message/i);
  await expect(supportChatInput).toBeVisible({ timeout: 10000 });

  return { agentContext, agentPage, agentChatInput, supportContext, supportPage, supportChatInput };
}