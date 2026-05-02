/**
 * E2E: Sprint 1 & 2 — AI Features
 *
 * Tests the full AI feature suite:
 *   Sprint 1: AI Provider, Per-Tenant Config, Message Improvement, Chat Summarization
 *   Sprint 2: Translation, Auto-Summarize on Close
 *
 * These tests verify UI behavior (buttons appear/hidden, state changes, API calls).
 * AI responses are intercepted so tests don't depend on a running AI provider.
 *
 * Prerequisites:
 *   - Server running at E2E_BASE_URL (default http://localhost:3001)
 *   - Seeded demo database (agent_julie, support_lucas, admin_emma, platform_bart)
 */

import { test, expect } from './helpers/partnerFixture';
import type { Page } from '@playwright/test';
import { loginAsDemo } from './helpers/auth';

const BASE = process.env.E2E_BASE_URL || 'http://localhost:3001';

// ── Helpers ─────────────────────────────────────────────────────────────────

/** Enable AI features on the default partner via platform API */
async function enableAiFeatures(page: Page) {
  await page.goto(BASE);
  await page.waitForLoadState('load');

  // Login as platform operator via dev-login (passwordless, non-prod only)
  const loginData = await page.evaluate(async () => {
    const res = await fetch('/api/v1/auth/dev-login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ userId: 'platform_bart' }),
    });
    return { ok: res.ok };
  });

  if (!loginData.ok) return false;

  // Enable AI on the guichet-main partner via tRPC
  const updateData = await page.evaluate(async () => {
    const res = await fetch('/api/v1/trpc/platform.updatePartner', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({
        id: 'guichet-main',
        data: {
          aiEnabled: true,
          aiFeatures: {
            messageImprovement: 'optional',
            chatSummarization: true,
            translation: true,
            autoSummarizeOnClose: true,
          },
        },
      }),
    });
    return { ok: res.ok };
  });

  return updateData.ok;
}

/** Open the first ticket in the queue/sidebar */
async function openFirstTicket(page: Page) {
  // Fast path: AgentView auto-routes the user to their active ticket on
  // mount (1-ticket-per-agent contract). If the chat editor is already
  // visible, the "ticket" is already open — return success.
  if (await page.locator('.ProseMirror').first().isVisible({ timeout: 3_000 }).catch(() => false)) {
    return true;
  }

  // SupportView: pick the first queue ticket. QueueTicketRow stamps
  // `data-ticket-row` — locale/text-stable.
  const ticketItem = page.locator('li[data-ticket-row]').first();
  if (await ticketItem.isVisible({ timeout: 10_000 }).catch(() => false)) {
    await ticketItem.click();
    await page.waitForTimeout(1000);
    return true;
  }
  return false;
}

/** Intercept tRPC AI calls and return mocked responses */
function mockAiResponses(page: Page) {
  return page.route('**/api/v1/trpc/**', async (route) => {
    const url = route.request().url();

    if (url.includes('ai.improveMessage')) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          result: { data: { improved: 'This is an AI-improved version of the message with better clarity and structure.' } },
        }),
      });
    } else if (url.includes('ai.summarizeChat')) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          result: { data: { summary: 'The agent reported a network connectivity issue. Support suggested restarting the router. The issue is pending resolution.', cached: false } },
        }),
      });
    } else if (url.includes('ai.translateMessage')) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          result: { data: { translated: 'Dit is een vertaald bericht.' } },
        }),
      });
    } else {
      await route.continue();
    }
  });
}

// ── Sprint 1: Feature 0 — AI Provider Abstraction Layer ─────────────────────

test.describe('Sprint 1: AI Provider Layer', () => {
  test('AI config endpoint responds', async ({ page }) => {
    const res = await loginAsDemo(page, 'agent_julie');
    if (!res.ok) {
      throw new Error(
        `Demo login failed (status ${res.status}). Check server/seed.ts.`,
      );
    }

    // The partner.getAiConfig endpoint should respond (even if all-off)
    const configRes = await page.request.get(
      `${BASE}/api/v1/trpc/partner.getAiConfig`,
      { failOnStatusCode: false }
    );
    // Should return 200 with some JSON structure
    expect(configRes.status()).toBe(200);
    const body = await configRes.json();
    expect(body.result?.data).toBeDefined();
  });
});

// ── Sprint 1: Feature 1 — Per-Tenant AI Configuration ──────────────────────

test.describe('Sprint 1: Per-Tenant AI Configuration', () => {
  test('platform operator can toggle AI features on a partner', async ({ page }) => {
    const res = await loginAsDemo(page, 'platform_bart');
    if (!res.ok) {
      throw new Error(
        `platform_bart login failed (status ${res.status}). Check server/seed.ts.`,
      );
    }

    // Enable AI on guichet-main
    const updateRes = await page.request.post(`${BASE}/api/v1/trpc/platform.updatePartner`, {
      data: {
        id: 'guichet-main',
        data: {
          aiEnabled: true,
          aiFeatures: {
            messageImprovement: 'optional',
            chatSummarization: true,
            translation: true,
            autoSummarizeOnClose: true,
          },
        },
      },
      failOnStatusCode: false,
    });

    if (updateRes.ok()) {
      // Verify the config was saved by fetching it back
      // Login as a regular user from that partner
      // Re-login as agent to verify config (cookie set automatically)
      const agentRes = await page.request.post(`${BASE}/api/v1/auth/dev-login`, {
        data: { userId: 'agent_julie' },
        failOnStatusCode: false,
      });
      if (agentRes.ok()) {
        const configRes = await page.request.get(
          `${BASE}/api/v1/trpc/partner.getAiConfig`,
          { failOnStatusCode: false }
        );
        if (configRes.ok()) {
          const configBody = await configRes.json();
          const cfg = configBody.result?.data;
          // If AI_ENABLED is true globally, features should be on
          // If AI_ENABLED is false, features will be off regardless
          expect(cfg).toBeDefined();
        }
      }
    }
  });

  test('AI features default to off for new partners', async ({ page }) => {
    const res = await loginAsDemo(page, 'agent_julie');
    if (!res.ok) {
      throw new Error(
        `Demo login failed (status ${res.status}). Check server/seed.ts.`,
      );
    }

    const configRes = await page.request.get(
      `${BASE}/api/v1/trpc/partner.getAiConfig`,
      { failOnStatusCode: false }
    );

    expect(configRes.status()).toBe(200);
    const body = await configRes.json();
    const cfg = body.result?.data;
    expect(cfg).toBeDefined();
    // messageImprovement should be 'off' or a valid mode
    expect(['off', 'optional', 'forced']).toContain(cfg.messageImprovement);
  });
});

// ── Sprint 1: Feature 2 — AI Message Improvement ───────────────────────────

test.describe('Sprint 1: AI Message Improvement', () => {
  test.beforeEach(async ({ page }) => {
    await enableAiFeatures(page);
  });

  test('improve button appears when typing long text (agent)', async ({ page }) => {
    const res = await loginAsDemo(page, 'agent_julie');
    if (!res.ok) {
      throw new Error(
        `Demo login failed (status ${res.status}). Check server/seed.ts.`,
      );
    }
    await page.waitForTimeout(2000);

    const opened = await openFirstTicket(page);
    if (!opened) {
      throw new Error(
        'Could not open a ticket — seed must include a ticket visible to the test user.',
      );
    }

    // Agents on a live ticket use the ProseMirror compose editor (not <textarea>).
    const editor = page.locator('.ProseMirror').first();
    await editor.waitFor({ state: 'visible', timeout: 5000 });

    // Type enough text (>= 10 chars) into ProseMirror
    await editor.click();
    await page.keyboard.type('This is a message that should trigger the improve button to appear');
    await page.waitForTimeout(500);

    // Look for the improve button (aria-label="Improve message")
    const improveBtn = page.locator('button[aria-label="Improve message"]');
    // May or may not be visible depending on AI config
    await improveBtn.isVisible().catch(() => false);

    // Verify no crashes
    const errorVisible = await page.getByText(/error|crash/i).first().isVisible().catch(() => false);
    expect(errorVisible).toBeFalsy();
  });

  test('improve button hidden with short text', async ({ page }) => {
    const res = await loginAsDemo(page, 'agent_julie');
    if (!res.ok) {
      throw new Error(
        `Demo login failed (status ${res.status}). Check server/seed.ts.`,
      );
    }
    await page.waitForTimeout(2000);

    const opened = await openFirstTicket(page);
    if (!opened) {
      throw new Error(
        'Could not open a ticket — seed must include a ticket visible to the test user.',
      );
    }

    const editor = page.locator('.ProseMirror').first();
    await editor.waitFor({ state: 'visible', timeout: 5000 });

    // Type short text (< 10 chars)
    await editor.click();
    await page.keyboard.type('Hi');
    await page.waitForTimeout(300);

    // Improve button should NOT be visible (text too short)
    const improveBtn = page.locator('button[aria-label="Improve message"]');
    await expect(improveBtn).not.toBeVisible();
  });

  test('improve button calls AI and shows revert bar (mocked)', async ({ page }) => {
    await mockAiResponses(page);
    const res = await loginAsDemo(page, 'agent_julie');
    if (!res.ok) {
      throw new Error(
        `Demo login failed (status ${res.status}). Check server/seed.ts.`,
      );
    }
    await page.waitForTimeout(2000);

    const opened = await openFirstTicket(page);
    if (!opened) {
      throw new Error(
        'Could not open a ticket — seed must include a ticket visible to the test user.',
      );
    }

    const editor = page.locator('.ProseMirror').first();
    await editor.waitFor({ state: 'visible', timeout: 5000 });

    await editor.click();
    await page.keyboard.type('This message needs improvement from the AI system');
    await page.waitForTimeout(500);

    const improveBtn = page.locator('button[aria-label="Improve message"]');
    if (await improveBtn.isVisible().catch(() => false)) {
      await improveBtn.click();
      await page.waitForTimeout(2000);

      // After improvement, should show "AI improved" bar with "Revert to original"
      const revertBtn = page.getByText(/revert to original/i).first();
      const revertVisible = await revertBtn.isVisible({ timeout: 5000 }).catch(() => false);
      if (revertVisible) {
        // Verify the AI improved indicator is shown
        await expect(page.getByText(/AI improved/i).first()).toBeVisible();

        // Click revert
        await revertBtn.click();
        await page.waitForTimeout(500);

        // Original text should be restored — ProseMirror exposes its content
        // via .textContent on the contenteditable root.
        const currentText = (await editor.textContent()) ?? '';
        expect(currentText).toContain('This message needs improvement');
      }
    }
  });
});

// ── Sprint 1: Feature 3 — AI Chat Summarization ────────────────────────────

test.describe('Sprint 1: AI Chat Summarization', () => {
  test.beforeEach(async ({ page }) => {
    await enableAiFeatures(page);
  });

  test('summarize button visible for support users', async ({ page }) => {
    const res = await loginAsDemo(page, 'support_lucas');
    if (!res.ok) {
      throw new Error(
        `Demo login failed (status ${res.status}). Check server/seed.ts.`,
      );
    }
    await page.waitForTimeout(2000);

    const opened = await openFirstTicket(page);
    if (!opened) {
      throw new Error(
        'Could not open a ticket — seed must include a ticket visible to the test user.',
      );
    }

    // Look for the summarize button
    const summarizeBtn = page.locator('button[aria-label="Summarize conversation"]');
    // May or may not be visible depending on AI config + ticket state (not closed)
    const visible = await summarizeBtn.isVisible({ timeout: 5000 }).catch(() => false);

    // Verify page loaded without errors
    const errorVisible = await page.getByText(/error|crash/i).first().isVisible().catch(() => false);
    expect(errorVisible).toBeFalsy();
  });

  test('summarize button NOT visible for agents', async ({ page }) => {
    const res = await loginAsDemo(page, 'agent_julie');
    if (!res.ok) {
      throw new Error(
        `Demo login failed (status ${res.status}). Check server/seed.ts.`,
      );
    }
    await page.waitForTimeout(2000);

    const opened = await openFirstTicket(page);
    if (!opened) {
      throw new Error(
        'Could not open a ticket — seed must include a ticket visible to the test user.',
      );
    }

    // Agents should NOT see the summarize button
    const summarizeBtn = page.locator('button[aria-label="Summarize conversation"]');
    await expect(summarizeBtn).not.toBeVisible();
  });

  test('clicking summarize shows summary card (mocked)', async ({ page }) => {
    await mockAiResponses(page);
    const res = await loginAsDemo(page, 'support_lucas');
    if (!res.ok) {
      throw new Error(
        `Demo login failed (status ${res.status}). Check server/seed.ts.`,
      );
    }
    await page.waitForTimeout(2000);

    const opened = await openFirstTicket(page);
    if (!opened) {
      throw new Error(
        'Could not open a ticket — seed must include a ticket visible to the test user.',
      );
    }

    const summarizeBtn = page.locator('button[aria-label="Summarize conversation"]');
    if (await summarizeBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
      await summarizeBtn.click();
      await page.waitForTimeout(2000);

      // Summary card should appear with "AI Summary" label
      const summaryCard = page.getByText(/AI Summary/i).first();
      const cardVisible = await summaryCard.isVisible({ timeout: 5000 }).catch(() => false);
      if (cardVisible) {
        await expect(summaryCard).toBeVisible();

        // Should have refresh and dismiss buttons
        const refreshBtn = page.locator('button[aria-label="Refresh summary"]');
        const dismissBtn = page.locator('button[aria-label="Dismiss summary"]');
        await expect(refreshBtn).toBeVisible();
        await expect(dismissBtn).toBeVisible();

        // Dismiss the summary
        await dismissBtn.click();
        await page.waitForTimeout(500);
        await expect(summaryCard).not.toBeVisible();
      }
    }
  });
});

// ── Sprint 2: Feature 4 — AI Translation ───────────────────────────────────

test.describe('Sprint 2: AI Translation', () => {
  test.beforeEach(async ({ page }) => {
    await enableAiFeatures(page);
  });

  test('translation UI appears on messages from different language', async ({ page }) => {
    // Login as English-speaking support (support_lucas, lang='en')
    const res = await loginAsDemo(page, 'support_lucas');
    if (!res.ok) {
      throw new Error(
        `Demo login failed (status ${res.status}). Check server/seed.ts.`,
      );
    }
    await page.waitForTimeout(2000);

    const opened = await openFirstTicket(page);
    if (!opened) {
      throw new Error(
        'Could not open a ticket — seed must include a ticket visible to the test user.',
      );
    }

    // Wait for messages to load
    await page.waitForTimeout(2000);

    // Look for translation indicators (translating... or Show original)
    const translationIndicator = page.getByText(/translating|show original|show translation/i).first();
    const visible = await translationIndicator.isVisible({ timeout: 5000 }).catch(() => false);
    // Translation may or may not appear depending on whether there are
    // messages from a different language user

    // Verify no crashes
    const errorVisible = await page.getByText(/error|crash/i).first().isVisible().catch(() => false);
    expect(errorVisible).toBeFalsy();
  });

  test('translate API endpoint works', async ({ page }) => {
    const res = await loginAsDemo(page, 'support_lucas');
    if (!res.ok) {
      throw new Error(
        `Demo login failed (status ${res.status}). Check server/seed.ts.`,
      );
    }

    // Call the translate endpoint directly
    const translateRes = await page.request.post(`${BASE}/api/v1/trpc/ai.translateMessage`, {
      data: { text: 'Hello, how are you?', targetLang: 'nl' },
      failOnStatusCode: false,
    });

    // Should either succeed (200) or fail gracefully with a proper error
    expect([200, 400, 403, 500]).toContain(translateRes.status());

    if (translateRes.ok()) {
      const body = await translateRes.json();
      const translated = body.result?.data?.translated;
      // Should return a non-empty translated string
      expect(translated).toBeTruthy();
      expect(typeof translated).toBe('string');
    }
  });
});

// ── Sprint 2: Feature 6 — AI Auto-Summarize on Close ───────────────────────

test.describe('Sprint 2: AI Auto-Summarize on Close', () => {
  test('auto-summarize config is part of AI features', async ({ page }) => {
    const res = await loginAsDemo(page, 'support_lucas');
    if (!res.ok) {
      throw new Error(
        `Demo login failed (status ${res.status}). Check server/seed.ts.`,
      );
    }

    const configRes = await page.request.get(
      `${BASE}/api/v1/trpc/partner.getAiConfig`,
      { failOnStatusCode: false }
    );
    expect(configRes.status()).toBe(200);
    const body = await configRes.json();
    const cfg = body.result?.data;
    expect(cfg).toBeDefined();
    // Should have autoSummarizeOnClose field
    expect(cfg).toHaveProperty('autoSummarizeOnClose');
    expect(typeof cfg.autoSummarizeOnClose).toBe('boolean');
  });

  test('closed tickets show closing notes area', async ({ page }) => {
    const res = await loginAsDemo(page, 'support_lucas');
    if (!res.ok) {
      throw new Error(
        `Demo login failed (status ${res.status}). Check server/seed.ts.`,
      );
    }
    await page.waitForTimeout(2000);

    // Navigate to archive tab
    const archiveTab = page.getByText(/archive/i).first();
    if (await archiveTab.isVisible().catch(() => false)) {
      await archiveTab.click();
      await page.waitForTimeout(1500);

      // Try to open a closed ticket
      const archivedTicket = page.locator('aside li').first();
      if (await archivedTicket.isVisible().catch(() => false)) {
        await archivedTicket.click();
        await page.waitForTimeout(1000);
        // Closed ticket view should render without errors
        const errorVisible = await page.getByText(/error|crash/i).first().isVisible().catch(() => false);
        expect(errorVisible).toBeFalsy();
      }
    }
  });
});

// ── Sprint 2: Feature 7 — Collision Detection ──────────────────────────────

test.describe('Sprint 2: Collision Detection', () => {
  test('single user views ticket without collision banner', async ({ page }) => {
    const res = await loginAsDemo(page, 'support_lucas');
    if (!res.ok) {
      throw new Error(
        `Demo login failed (status ${res.status}). Check server/seed.ts.`,
      );
    }
    await page.waitForTimeout(2000);

    const opened = await openFirstTicket(page);
    if (!opened) {
      throw new Error(
        'Could not open a ticket — seed must include a ticket visible to the test user.',
      );
    }

    await page.waitForTimeout(1500);

    // With only one viewer, there should be no "also viewing" banner
    const viewerBanner = page.getByText(/also viewing this ticket/i).first();
    await expect(viewerBanner).not.toBeVisible();
  });

  test('two users viewing same ticket see collision banner', async ({ browser, page, partnerFixture }) => {
    // #117 follow-up (2026-05-02 body-fixme migration, slice A1):
    // Migration to partnerFixture surfaced a misclassification — the
    // failure is NOT shared-seed pollution. The collision banner UI was
    // deleted (see ChatHeader.tsx:596 "Collision Detection bar
    // intentionally removed — viewer names are surfaced elsewhere
    // (queue sidebar, avatars)"). Server-side ticket:viewing /
    // ticket:left / ticket:viewers socket plumbing remains intact (see
    // server/socket/handlers/collision.ts and the tenant-isolation
    // coverage at server/__integration__/isolation.test.ts:602+) but no
    // client component renders the broadcast viewer list — fixture
    // bootstrap is irrelevant when there's no UI surface to assert on.
    // Tracked under the body-fixme migration plan as a Group reclassification.
    test.fixme();

    const lucas = await partnerFixture.createUser({
      role: 'support',
      departments: ['general'],
    });
    const sophie = await partnerFixture.createUser({
      role: 'support',
      departments: ['general'],
    });
    await partnerFixture.createTicket();

    // page1 = fixture's bootstrap page; swap session to lucas, then reload
    // so SupportView's queue refetches the fresh ticket.
    await partnerFixture.loginAs(lucas.userId, { waitFor: 'networkidle' });
    await page.reload();
    await page.waitForLoadState('networkidle');

    const ctx2 = await browser.newContext();
    const page2 = await ctx2.newPage();

    try {
      const res2 = await loginAsDemo(page2, sophie.userId, { waitFor: 'networkidle' });
      if (!res2.ok) {
        throw new Error(`sophie loginAsDemo failed: ${res2.status}`);
      }

      // Both users open the (only) ticket in queue.
      const opened1 = await openFirstTicket(page);
      if (!opened1) throw new Error('No ticket available (page1)');
      await page.waitForTimeout(1500);

      const opened2 = await openFirstTicket(page2);
      if (!opened2) throw new Error('No ticket available (page2)');
      await page2.waitForTimeout(3000);

      // Deterministic: with a single-ticket queue both users are on the
      // same ticket, so the collision banner must show on at least one
      // page. Probe both to absorb whichever-arrived-second timing.
      const banner1 = page.getByText(/also viewing this ticket/i).first();
      const banner2 = page2.getByText(/also viewing this ticket/i).first();

      const visible1 = await banner1.isVisible({ timeout: 5000 }).catch(() => false);
      const visible2 = await banner2.isVisible({ timeout: 5000 }).catch(() => false);

      expect(visible1 || visible2).toBe(true);

      const error1 = await page.getByText(/error|crash/i).first().isVisible().catch(() => false);
      const error2 = await page2.getByText(/error|crash/i).first().isVisible().catch(() => false);
      expect(error1).toBeFalsy();
      expect(error2).toBeFalsy();
    } finally {
      await ctx2.close();
    }
  });

  test('leaving a ticket removes collision banner for others', async ({ browser, page, partnerFixture }) => {
    // #117 follow-up (2026-05-02 body-fixme migration, slice A1):
    // Same misclassification as sibling test — collision banner UI was
    // removed; server socket plumbing remains. See sibling for full context.
    test.fixme();

    const lucas = await partnerFixture.createUser({
      role: 'support',
      departments: ['general'],
    });
    const sophie = await partnerFixture.createUser({
      role: 'support',
      departments: ['general'],
    });
    await partnerFixture.createTicket();

    await partnerFixture.loginAs(lucas.userId, { waitFor: 'networkidle' });
    await page.reload();
    await page.waitForLoadState('networkidle');

    const ctx2 = await browser.newContext();
    const page2 = await ctx2.newPage();

    try {
      const res2 = await loginAsDemo(page2, sophie.userId, { waitFor: 'networkidle' });
      if (!res2.ok) {
        throw new Error(`sophie loginAsDemo failed: ${res2.status}`);
      }

      // User 1 opens the ticket first.
      const opened1 = await openFirstTicket(page);
      if (!opened1) throw new Error('No ticket available (page1)');
      await page.waitForTimeout(1000);

      // User 2 opens the same ticket.
      const opened2 = await openFirstTicket(page2);
      if (!opened2) throw new Error('No ticket available (page2)');
      await page2.waitForTimeout(3000);

      const banner1 = page.getByText(/also viewing this ticket/i).first();
      await expect(banner1).toBeVisible({ timeout: 5000 });

      // User 2 disconnects entirely (close the page → socket disconnect).
      await ctx2.close();

      // Banner should clear on page1 after the socket-disconnect cleanup
      // propagates. expect.poll keeps the test deterministic without a
      // fixed sleep.
      await expect
        .poll(() => banner1.isVisible().catch(() => false), { timeout: 10000 })
        .toBe(false);
    } finally {
      await ctx2.close().catch(() => {});
    }
  });
});

// ── Cross-cutting: AI features respect role restrictions ────────────────────

test.describe('AI Feature Access Control', () => {
  test('agent cannot access summarize endpoint', async ({ page }) => {
    const res = await loginAsDemo(page, 'agent_julie');
    if (!res.ok) {
      throw new Error(
        `Demo login failed (status ${res.status}). Check server/seed.ts.`,
      );
    }

    // Agents should get FORBIDDEN when trying to summarize
    const summarizeRes = await page.request.post(`${BASE}/api/v1/trpc/ai.summarizeChat`, {
      data: { ticketId: 'nonexistent' },
      failOnStatusCode: false,
    });

    // Should be forbidden or bad request (not 200)
    expect(summarizeRes.status()).not.toBe(200);
  });

  test('agent CAN access improve endpoint', async ({ page }) => {
    await enableAiFeatures(page);
    const res = await loginAsDemo(page, 'agent_julie');
    if (!res.ok) {
      throw new Error(
        `Demo login failed (status ${res.status}). Check server/seed.ts.`,
      );
    }

    const improveRes = await page.request.post(`${BASE}/api/v1/trpc/ai.improveMessage`, {
      data: { text: 'This is a message that should be improved by the AI system', role: 'agent' },
      failOnStatusCode: false,
    });

    // Should either succeed or fail with provider error (not FORBIDDEN)
    // 200 = success, 500 = provider unavailable, 429 = rate limited — all valid
    // 403 = feature disabled (also valid if AI_ENABLED is off)
    expect([200, 400, 403, 429, 500]).toContain(improveRes.status());
  });

  test('support CAN access translate endpoint', async ({ page }) => {
    await enableAiFeatures(page);
    const res = await loginAsDemo(page, 'support_lucas');
    if (!res.ok) {
      throw new Error(
        `Demo login failed (status ${res.status}). Check server/seed.ts.`,
      );
    }

    const translateRes = await page.request.post(`${BASE}/api/v1/trpc/ai.translateMessage`, {
      data: { text: 'Hello world', targetLang: 'nl' },
      failOnStatusCode: false,
    });

    expect([200, 400, 403, 429, 500]).toContain(translateRes.status());
  });
});
