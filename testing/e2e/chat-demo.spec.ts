import { test, expect, type Page } from '@playwright/test';
import * as path from 'path';
import * as fs from 'fs';

const BASE = process.env.E2E_BASE_URL || 'http://localhost:3001';
const DEMO_PASSWORD = 'password123';

/** Login helper with workspace bypass, language override and session fix */
async function loginAsDemo(page: Page, userId: string) {
  await page.goto(BASE);
  await page.waitForLoadState('load');
  const res = await page.request.post(`${BASE}/api/v1/auth/login`, {
    data: { id: userId, password: DEMO_PASSWORD },
    failOnStatusCode: false,
  });
  if (!res.ok()) return res;
  const data = await res.json();

  // Set session cookie to bypass the 'isSessionExpired' check in authSlice.ts
  const expiry = Math.floor(Date.now() / 1000) + 3600; // 1 hour from now
  await page.context().addCookies([{
    name: 'session_expires',
    value: expiry.toString(),
    path: '/',
    domain: new URL(BASE).hostname
  }]);

  await page.evaluate(({ user, memberships, uid }) => {
    localStorage.setItem('user', JSON.stringify(user));
    localStorage.setItem('memberships', JSON.stringify(memberships));
    if (memberships?.length > 0) {
      localStorage.setItem('activeMembershipId', memberships[0].id);
      localStorage.setItem('activePartnerId', memberships[0].partnerId);
    }
    // Language override
    const storedUser = JSON.parse(localStorage.getItem('user') || '{}');
    if (uid === 'agent_jan') storedUser.lang = 'nl';
    if (uid === 'expert_alex') storedUser.lang = 'fr';
    localStorage.setItem('user', JSON.stringify(storedUser));
  }, { ...data, uid: userId });

  await page.reload();
  await page.waitForLoadState('networkidle');
  return res;
}

/** Enable AI features via platform API */
async function enableAiFeatures(page: Page) {
  const res = await page.request.post(`${BASE}/api/v1/auth/login`, {
    data: { id: 'platform_bart', password: DEMO_PASSWORD },
    failOnStatusCode: false,
  });
  if (!res.ok()) return false;

  const updateRes = await page.request.post(`${BASE}/api/v1/trpc/platform.updatePartner`, {
    data: {
      id: 'tessera-main',
      data: {
        aiEnabled: true,
        aiFeatures: {
          messageImprovement: 'optional',
          chatSummarization: true,
          translation: true,
          sentimentDetection: true,
          autoSummarizeOnClose: true,
        },
      },
    },
    failOnStatusCode: false,
  });

  return updateRes.ok();
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
  await loginAsDemo(agentPage, 'agent_jan');
  await loginAsDemo(supportPage, 'expert_alex');
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
  await agentTextArea.type('hey alex de tv is dood geen lampjes op de box en m’n match begint zo kun je checken of het stuk is?', { delay: 50 });
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
  await supportTextArea.type('Je m’en occupe. Je vais vous donner des étapes pour relancer le boîtier.', { delay: 50 });
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
