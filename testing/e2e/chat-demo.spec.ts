import { test, expect, type Page } from '@playwright/test';
import * as path from 'path';
import * as fs from 'fs';
import { loginAsDemo } from './helpers/auth';

const BASE = process.env.E2E_BASE_URL || 'http://localhost:3001';

/** Enable AI features via platform API */
async function enableAiFeatures(page: Page) {
  // Navigate first so relative fetch URLs work (page may be about:blank)
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

/** Intercept tRPC AI calls for the seamless demo */
async function mockAiResponses(page: Page) {
  return page.route('**/api/v1/trpc/**', async (route) => {
    const url = route.request().url();

    // 1. Message Improvement (Agent - Dutch)
    if (url.includes('ai.improveMessage') && (url.includes('role=agent') || url.includes('%22role%22%3A%22agent%22'))) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          result: { data: { improved: 'Hallo Alex, ik heb geen signaal meer op de televisie. De decoder reageert niet en er branden geen lampjes. Kun je controleren of er een algemene storing is in mijn regio?' } },
        }),
      });
    }
    // 2. Message Improvement (Support - French to Step-by-Step)
    else if (url.includes('ai.improveMessage') && (url.includes('role=support') || url.includes('%22role%22%3A%22support%22'))) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          result: { data: { improved: "Je comprends l'urgence. Suivez ces étapes :\n1. Débranchez le décodeur.\n2. Attendez 30 secondes.\n3. Rebranchez-le.\nJe vérifie également le réseau de mon côté." } },
        }),
      });
    }
    // 3. Translation (Dutch to French for Support)
    else if (url.includes('ai.translateMessage') && (url.includes('targetLang=fr') || url.includes('%22targetLang%22%3A%22fr%22'))) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          result: { data: { translated: "Bonjour Alex, je n'ai plus de signal sur la télévision. Le décodeur ne répond pas et aucun voyant n'est allumé. Pouvez-vous vérifier s'il y a une panne dans ma région ?" } },
        }),
      });
    }
    // 4. Translation (French to Dutch for Agent)
    else if (url.includes('ai.translateMessage') && (url.includes('targetLang=nl') || url.includes('%22targetLang%22%3A%22nl%22'))) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          result: { data: { translated: "Ik begrijp de urgentie. Volg deze stappen:\n1. Koppel de decoder los.\n2. Wacht 30 seconden.\n3. Sluit hem weer aan.\nIk controleer ook het netwerk aan mijn kant." } },
        }),
      });
    }
    else {
      await route.continue();
    }
  });
}

test('record seamless language-agnostic chat demo', async ({ browser }) => {
  // This demo records a video of the chat flow — requires business hours open, AI enabled,
  // and seeded data. Run manually with: E2E_CHAT_DEMO=1 npx playwright test chat-demo
  test.skip(!process.env.E2E_CHAT_DEMO, 'Set E2E_CHAT_DEMO=1 to run this recording demo');
  test.setTimeout(120000);
  const videoDir = path.resolve('docs', 'videos');
  if (!fs.existsSync(videoDir)) fs.mkdirSync(videoDir, { recursive: true });

  const agentContext = await browser.newContext({
    recordVideo: { dir: videoDir, size: { width: 1280, height: 720 } },
    viewport: { width: 1280, height: 720 },
    colorScheme: 'dark'
  });
  const supportContext = await browser.newContext({
    recordVideo: { dir: videoDir, size: { width: 1280, height: 720 } },
    viewport: { width: 1280, height: 720 },
    colorScheme: 'dark'
  });

  const agentPage = await agentContext.newPage();
  const supportPage = await supportContext.newPage();

  // 1. Setup AI
  await enableAiFeatures(agentPage);
  await mockAiResponses(agentPage);
  await mockAiResponses(supportPage);

  // 2. Login
  await loginAsDemo(agentPage, 'agent_julie', { lang: 'nl', waitFor: 'networkidle' });
  await loginAsDemo(supportPage, 'support_lucas', { lang: 'fr', waitFor: 'networkidle' });
  await agentPage.waitForTimeout(3000);
  await supportPage.waitForTimeout(1000);

  // --- ACT 1: Agent Creates/Selects Ticket & Sends Message ---

  const tickets = agentPage.locator('aside li, aside button.flex-col');
  if (await tickets.count() === 0) {
    const newBtn = agentPage.locator('button').filter({ hasText: /New|Nieuw/i }).first();
    await newBtn.click();
    await agentPage.waitForTimeout(1000);
    await agentPage.locator('select').first().selectOption({ index: 1 });
    await agentPage.locator('button', { hasText: /Create|Aanmaken/i }).click();
    await agentPage.waitForTimeout(4000);
  } else {
    await tickets.first().click();
    await agentPage.waitForTimeout(1500);
  }

  const agentTextArea = agentPage.locator('textarea').first();
  await agentTextArea.type('hey alex de tv is dood geen lampjes op de box en m\'n match begint zo kun je checken of het stuk is?', { delay: 50 });
  await agentPage.waitForTimeout(1500);

  const agentImproveBtn = agentPage.locator('button[aria-label="Improve message"]');
  await agentImproveBtn.click();
  await agentPage.waitForTimeout(3000);
  await agentPage.keyboard.press('Enter');
  await agentPage.waitForTimeout(1000);

  // --- ACT 2: Support Receives Translation & Responds ---

  await supportPage.locator('aside li, aside button.flex-col').first().click();
  await supportPage.waitForTimeout(4000); // Wait for translation to load

  const supportTextArea = supportPage.locator('textarea').first();
  await supportTextArea.type('Je m\'en occupe. Je vais vous donner des étapes pour relancer le boîtier.', { delay: 50 });
  await supportPage.waitForTimeout(1500);

  const supportImproveBtn = supportPage.locator('button[aria-label="Improve message"]');
  await supportImproveBtn.click();
  await supportPage.waitForTimeout(3500);
  await supportPage.keyboard.press('Enter');
  await supportPage.waitForTimeout(2000);

  // --- ACT 3: Agent Sees Dutch Step-by-Step ---

  await agentPage.waitForTimeout(4000);
  // Wait for the specific Dutch translation to appear
  await expect(agentPage.getByText("Ik begrijp de urgentie").first()).toBeVisible({ timeout: 10000 });
  await agentPage.waitForTimeout(3000);

  await agentContext.close();
  await supportContext.close();
});
