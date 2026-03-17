# Comprehensive Playwright E2E Testing Plan for Real-Time Chat

This document details the strategy, implementation patterns, and specific test cases required to robustly test the real-time chat functionality between Agents and Support Specialists in the Tessera platform.

## 1. Challenges & Reliability Patterns

Testing real-time WebSockets across multiple browser contexts (Agent vs Support) is inherently flaky. To ensure reliability, we must enforce the following patterns:

*   **Robust Locators**: Never use generic `getByRole('button')` without a specific `.filter({ hasText: ... })` or explicit `name` attribute. For the support queue, always use `getByRole('listitem')` filtered by the Agent's specific name (e.g., `/E2E Agent A/i`).
*   **Agnostic Text Matching**: Because LLMs translate text dynamically (and may alter formatting), we must verify message receipt using core, non-translatable keyword fragments rather than exact string matching (e.g., `expect(page.getByText(/invoice number/i)).toBeVisible()`).
*   **Retry Loops for Propagation**: WebSockets and database transactions take time to propagate across clients. Instead of raw timeouts, use explicit retry loops that `reload` the page until an expected element appears, preventing false negatives due to network hiccups.
*   **Shared Setup Helper**: Real-time chat tests always require logging in two separate users, opening a ticket, and having the support user claim it. We need a shared `setupChat` utility to abstract this boilerplate.

## 2. Shared Helper: `setupChat`

Create a reusable utility in `e2e/lib/chat-setup.ts`:
```typescript
import { Browser } from '@playwright/test';
import { loginInContext } from './login.js';

export async function setupChat(browser: Browser, ticketMessage: string) {
  const agentContext = await browser.newContext();
  const supportContext = await browser.newContext();

  const agentPage = await loginInContext(agentContext, 'agentA');
  const supportPage = await loginInContext(supportContext, 'supportA');

  // Agent creates ticket
  await agentPage.getByPlaceholder(/Describe the problem/i).fill(ticketMessage);
  await agentPage.getByRole('button', { name: /Connect with support/i }).click();

  // Wait for agent to enter chat
  await expect(agentPage.getByPlaceholder(/Type a message/i)).toBeVisible({ timeout: 20000 });

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
  await expect(supportPage.getByPlaceholder(/Type a message/i)).toBeVisible({ timeout: 10000 });

  return { agentContext, agentPage, supportContext, supportPage };
}
```

## 3. Test Cases (8 Scenarios)

Implement these scenarios inside `e2e/tests/chat-reliability.spec.ts`:

### Core Functionality
1.  **Bi-Directional Messaging**: Agent sends a message, verify Support receives it. Support sends a reply, verify Agent receives it.
2.  **Optimistic UI Deduplication**: Ensure that when an Agent sends a message, the immediate local "pending" state successfully merges with the confirmed server response without creating duplicate message bubbles on the screen.
3.  **Read Receipts**: Agent sends a message. Support views it. Verify that the Agent UI eventually displays a "Read" status beneath the message bubble.

### Resilience & Edge Cases
4.  **Network Reconnection (Offline Mode)**: 
    *   Agent creates a ticket and sends a message.
    *   Agent loses connection (`await agentContext.setOffline(true)`).
    *   Agent sends an offline message (should display "pending" or error).
    *   Agent reconnects (`await agentContext.setOffline(false)`).
    *   Verify the pending message is successfully flushed and delivered to Support.
5.  **Simultaneous Messaging (Race Condition)**: Use `Promise.all` to have both Agent and Support hit "Enter" on a chat message at the exact same millisecond. Verify both messages appear in the correct chronological order on both screens.
6.  **Page Reload Persistence**: Support claims a ticket and exchanges a message. Support reloads the page. Verify the active tab is still open, the ticket is still claimed, and the message history loads correctly via the `ticket:history` event.

### Security & Restrictions
7.  **Support-Only Whispers**: Support sends an internal "whisper" message. Verify the Support UI shows it clearly differentiated (e.g., italicized/colored), and critically, verify the Agent UI *does not* receive or display it.
8.  **Media URL Validation**: Agent attempts to send a malicious/invalid string formatted as an image (e.g., `[image](javascript:alert(1))`). Verify the message is either rejected by the backend guard or sanitized by the UI, preventing XSS execution.

## 4. Execution Plan

1.  **Create shared helper**: `e2e/lib/chat-setup.ts`.
2.  **Author test file**: `e2e/tests/chat-reliability.spec.ts`.
3.  **Run specific test file**:
    ```bash
    docker compose run --rm e2e npx playwright test tests/chat-reliability.spec.ts --project=docker
    ```
4.  **Run full suite** to ensure no regressions:
    ```bash
    docker compose run --rm e2e npm test
    ```
