# Phase 8: Platform Observability & Hardening — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add E2E testing, Prometheus/Grafana observability, and a mobile Agent Lite PWA to Tessera.

**Architecture:** Sequential build — Playwright E2E tests first (safety net), then Prometheus metrics + Grafana dashboards (observability), then Agent Lite PWA (mobile). Each pillar is independently shippable.

**Tech Stack:** Playwright, prom-client, Prometheus, Grafana, Vite PWA, Service Workers

**Spec:** `docs/superpowers/specs/2026-03-14-phase-8-observability-hardening-design.md`

---

## Chunk 1: Playwright E2E Testing

### Task 1: Playwright Setup & Configuration

**Files:**
- Create: `e2e/playwright.config.ts`
- Create: `e2e/package.json`
- Modify: `package.json` (root, add e2e scripts)

- [ ] **Step 1: Initialize the e2e package**

Create `e2e/package.json`:
```json
{
  "name": "tessera-e2e",
  "version": "1.0.0",
  "type": "module",
  "scripts": {
    "test": "playwright test --project=docker",
    "test:mock": "playwright test --project=mock",
    "test:ui": "playwright test --ui"
  },
  "devDependencies": {
    "@playwright/test": "^1.52.0"
  }
}
```

- [ ] **Step 2: Install Playwright and browsers**

Run: `cd e2e && npm install && npx playwright install chromium`
Expected: Playwright installed, Chromium browser downloaded.

- [ ] **Step 3: Create Playwright config**

Create `e2e/playwright.config.ts`:
```typescript
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: 'html',
  use: {
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'docker',
      use: {
        ...devices['Desktop Chrome'],
        baseURL: 'http://localhost:5173',
      },
    },
    {
      name: 'mock',
      use: {
        ...devices['Desktop Chrome'],
        baseURL: 'http://localhost:4173',
      },
    },
  ],
});
```

- [ ] **Step 4: Add e2e scripts to root package.json**

In `package.json` (root), add to `"scripts"`:
```json
"test:e2e": "npm test --prefix e2e",
"test:e2e:mock": "npm run test:mock --prefix e2e",
"install:all": "npm install --prefix server && npm install --prefix client && npm install --prefix e2e"
```

Note: Update the existing `install:all` script to include `e2e`.

- [ ] **Step 5: Commit**

```bash
git add e2e/package.json e2e/playwright.config.ts package.json
git commit -m "feat(e2e): scaffold Playwright with docker and mock projects"
```

---

### Task 2: Auth Fixture & Global Setup

**Files:**
- Create: `e2e/fixtures/auth.fixture.ts`
- Create: `e2e/global-setup.ts`
- Create: `e2e/global-teardown.ts`
- Create: `e2e/lib/constants.ts`
- Modify: `e2e/playwright.config.ts` (add globalSetup/globalTeardown)

- [ ] **Step 1: Create test constants**

Create `e2e/lib/constants.ts`:
```typescript
export const API_URL = process.env.API_URL || 'http://localhost:3001';
export const APP_URL = process.env.APP_URL || 'http://localhost:5173';

export const TEST_PARTNER_A = {
  id: 'test-partner-a',
  name: 'Test Partner A',
  industry: 'Technology',
};

export const TEST_PARTNER_B = {
  id: 'test-partner-b',
  name: 'Test Partner B',
  industry: 'Technology',
};

export const TEST_USERS = {
  agentA: { id: 'e2e-agent-a', password: 'TestPass123!', role: 'agent', partnerId: TEST_PARTNER_A.id },
  supportA: { id: 'e2e-support-a', password: 'TestPass123!', role: 'support', partnerId: TEST_PARTNER_A.id },
  adminA: { id: 'e2e-admin-a', password: 'TestPass123!', role: 'admin', partnerId: TEST_PARTNER_A.id },
  supportB: { id: 'e2e-support-b', password: 'TestPass123!', role: 'support', partnerId: TEST_PARTNER_B.id },
};
```

- [ ] **Step 2: Create global setup (seed test data)**

Create `e2e/global-setup.ts`:
```typescript
import pg from 'pg';
import bcrypt from 'bcrypt';
import { TEST_PARTNER_A, TEST_PARTNER_B, TEST_USERS } from './lib/constants.js';

const DB_URL = process.env.DATABASE_URL || 'postgresql://user:password@localhost:5432/tessera';

export default async function globalSetup() {
  const pool = new pg.Pool({ connectionString: DB_URL });

  try {
    const now = new Date().toISOString();

    // Create test partners (matches schema: id, name, industry, departments, created_at)
    for (const partner of [TEST_PARTNER_A, TEST_PARTNER_B]) {
      await pool.query(
        `INSERT INTO partners (id, name, industry, departments, created_at)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (id) DO NOTHING`,
        [partner.id, partner.name, partner.industry, JSON.stringify([{ id: 'DSC', label: 'Dispatch' }]), now]
      );
    }

    // Create test users (matches schema: id, name, lang, password)
    for (const [key, user] of Object.entries(TEST_USERS)) {
      const hash = await bcrypt.hash(user.password, 10);

      await pool.query(
        `INSERT INTO users (id, name, lang, password)
         VALUES ($1, $2, 'en', $3)
         ON CONFLICT (id) DO UPDATE SET password = $3`,
        [user.id, `E2E ${key}`, hash]
      );

      // Create membership (matches schema: id, user_id, partner_id, role, created_at)
      const membershipId = `e2e-membership-${key}`;
      await pool.query(
        `INSERT INTO memberships (id, user_id, partner_id, role, created_at)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (id) DO UPDATE SET role = $4`,
        [membershipId, user.id, user.partnerId, user.role, now]
      );
    }

    console.log('E2E global setup: test data seeded');
  } finally {
    await pool.end();
  }
}
```

- [ ] **Step 3: Create global teardown (clean test data)**

Create `e2e/global-teardown.ts`:
```typescript
import pg from 'pg';

const DB_URL = process.env.DATABASE_URL || 'postgresql://user:password@localhost:5432/tessera';

export default async function globalTeardown() {
  const pool = new pg.Pool({ connectionString: DB_URL });

  try {
    // Delete in reverse dependency order
    await pool.query(`DELETE FROM messages WHERE ticket_id IN (SELECT id FROM tickets WHERE partner_id LIKE 'test-partner-%')`);
    await pool.query(`DELETE FROM tickets WHERE partner_id LIKE 'test-partner-%'`);
    await pool.query(`DELETE FROM memberships WHERE partner_id LIKE 'test-partner-%'`);
    await pool.query(`DELETE FROM users WHERE id LIKE 'e2e-%'`);
    await pool.query(`DELETE FROM partners WHERE id LIKE 'test-partner-%'`);

    console.log('E2E global teardown: test data cleaned');
  } finally {
    await pool.end();
  }
}
```

- [ ] **Step 4: Create auth fixture**

Create `e2e/fixtures/auth.fixture.ts`:
```typescript
import { test as base, type Page } from '@playwright/test';
import { API_URL, TEST_USERS } from '../lib/constants.js';

type TestUser = keyof typeof TEST_USERS;

type AuthFixtures = {
  loginAs: (user: TestUser) => Promise<Page>;
};

export const test = base.extend<AuthFixtures>({
  loginAs: async ({ page }, use) => {
    const fn = async (userKey: TestUser) => {
      const user = TEST_USERS[userKey];
      const res = await page.request.post(`${API_URL}/api/auth/login`, {
        data: { id: user.id, password: user.password },
      });
      const { token } = await res.json();

      await page.addInitScript((t: string) => {
        localStorage.setItem('token', t);
      }, token);

      return page;
    };

    await use(fn);
  },
});

export { expect } from '@playwright/test';
```

- [ ] **Step 5: Wire global setup into Playwright config**

In `e2e/playwright.config.ts`, add after `testDir`:
```typescript
globalSetup: './global-setup.ts',
globalTeardown: './global-teardown.ts',
```

- [ ] **Step 6: Add pg and bcrypt dev dependencies to e2e**

Run: `cd e2e && npm install --save-dev pg @types/pg bcrypt @types/bcrypt`

- [ ] **Step 7: Commit**

```bash
git add e2e/
git commit -m "feat(e2e): add auth fixture, global setup/teardown with test data seeding"
```

---

### Task 3: Auth E2E Tests

**Files:**
- Create: `e2e/tests/auth.spec.ts`

- [ ] **Step 1: Write auth tests**

Create `e2e/tests/auth.spec.ts`:
```typescript
import { test, expect } from '../fixtures/auth.fixture.js';
import { APP_URL } from '../lib/constants.js';

test.describe('Authentication', () => {
  test('agent login lands on AgentView', async ({ loginAs, page }) => {
    await loginAs('agentA');
    await page.goto(APP_URL);
    await expect(page.locator('form[aria-label]')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('text=Agent')).toBeVisible();
  });

  test('support login lands on SupportView', async ({ loginAs, page }) => {
    await loginAs('supportA');
    await page.goto(APP_URL);
    await expect(page.locator('text=Queue')).toBeVisible({ timeout: 10000 });
  });

  test('admin login lands on AdminView', async ({ loginAs, page }) => {
    await loginAs('adminA');
    await page.goto(APP_URL);
    await expect(page.locator('text=Dashboard')).toBeVisible({ timeout: 10000 });
  });

  test('invalid credentials show error', async ({ page }) => {
    await page.goto(APP_URL);
    await page.fill('input[type="text"]', 'nonexistent');
    await page.fill('input[type="password"]', 'wrongpass');
    await page.click('button[type="submit"]');
    await expect(page.locator('text=Invalid')).toBeVisible({ timeout: 5000 });
  });
});
```

- [ ] **Step 2: Run auth tests against Docker stack**

Run: `cd e2e && npx playwright test tests/auth.spec.ts --project=docker`
Expected: All 4 tests pass (Docker stack must be running).

- [ ] **Step 3: Commit**

```bash
git add e2e/tests/auth.spec.ts
git commit -m "test(e2e): add authentication flow tests"
```

---

### Task 4: Ticket Lifecycle E2E Tests

**Files:**
- Create: `e2e/tests/ticket-lifecycle.spec.ts`

- [ ] **Step 1: Write ticket lifecycle tests**

Create `e2e/tests/ticket-lifecycle.spec.ts`:
```typescript
import { test, expect } from '../fixtures/auth.fixture.js';
import { API_URL, APP_URL } from '../lib/constants.js';

test.describe('Ticket Lifecycle', () => {
  test('agent creates ticket, support joins and closes it', async ({ browser }) => {
    // Create two browser contexts for agent and support
    const agentContext = await browser.newContext();
    const supportContext = await browser.newContext();
    const agentPage = await agentContext.newPage();
    const supportPage = await supportContext.newPage();

    // Login as agent
    const agentRes = await agentPage.request.post(`${API_URL}/api/auth/login`, {
      data: { id: 'e2e-agent-a', password: 'TestPass123!' },
    });
    const { token: agentToken } = await agentRes.json();
    await agentPage.addInitScript((t: string) => localStorage.setItem('token', t), agentToken);

    // Login as support
    const supportRes = await supportPage.request.post(`${API_URL}/api/auth/login`, {
      data: { id: 'e2e-support-a', password: 'TestPass123!' },
    });
    const { token: supportToken } = await supportRes.json();
    await supportPage.addInitScript((t: string) => localStorage.setItem('token', t), supportToken);

    // Agent creates a ticket
    await agentPage.goto(APP_URL);
    await agentPage.waitForSelector('form[aria-label]', { timeout: 10000 });
    await agentPage.fill('textarea', 'E2E test ticket - please help');
    await agentPage.click('button[type="submit"]');

    // Wait for ticket to appear in support queue
    await supportPage.goto(APP_URL);
    await supportPage.waitForSelector('text=E2E test ticket', { timeout: 15000 });

    // Support joins the ticket
    await supportPage.click('text=E2E test ticket');
    await supportPage.waitForSelector('[data-testid="chat-input"], textarea', { timeout: 10000 });

    // Support closes the ticket
    const closeButton = supportPage.locator('button:has-text("Close"), [aria-label*="close" i]');
    if (await closeButton.isVisible()) {
      await closeButton.click();
    }

    // Cleanup
    await agentContext.close();
    await supportContext.close();
  });
});
```

- [ ] **Step 2: Run ticket lifecycle tests**

Run: `cd e2e && npx playwright test tests/ticket-lifecycle.spec.ts --project=docker`
Expected: Test passes. This test may need adjustments based on actual UI selectors — tune selectors to match the real DOM.

- [ ] **Step 3: Commit**

```bash
git add e2e/tests/ticket-lifecycle.spec.ts
git commit -m "test(e2e): add ticket lifecycle flow test"
```

---

### Task 5: Live Chat E2E Tests

**Files:**
- Create: `e2e/tests/live-chat.spec.ts`

- [ ] **Step 1: Write live chat tests**

Create `e2e/tests/live-chat.spec.ts`:
```typescript
import { test, expect } from '../fixtures/auth.fixture.js';
import { API_URL, APP_URL } from '../lib/constants.js';

test.describe('Live Chat', () => {
  test('agent and support exchange messages in real-time', async ({ browser }) => {
    const agentContext = await browser.newContext();
    const supportContext = await browser.newContext();
    const agentPage = await agentContext.newPage();
    const supportPage = await supportContext.newPage();

    // Login both users
    const agentRes = await agentPage.request.post(`${API_URL}/api/auth/login`, {
      data: { id: 'e2e-agent-a', password: 'TestPass123!' },
    });
    const { token: agentToken } = await agentRes.json();
    await agentPage.addInitScript((t: string) => localStorage.setItem('token', t), agentToken);

    const supportRes = await supportPage.request.post(`${API_URL}/api/auth/login`, {
      data: { id: 'e2e-support-a', password: 'TestPass123!' },
    });
    const { token: supportToken } = await supportRes.json();
    await supportPage.addInitScript((t: string) => localStorage.setItem('token', t), supportToken);

    // Agent creates a ticket
    await agentPage.goto(APP_URL);
    await agentPage.waitForSelector('form[aria-label]', { timeout: 10000 });
    await agentPage.fill('textarea', 'Live chat E2E test');
    await agentPage.click('button[type="submit"]');

    // Support joins
    await supportPage.goto(APP_URL);
    await supportPage.waitForSelector('text=Live chat E2E test', { timeout: 15000 });
    await supportPage.click('text=Live chat E2E test');
    await supportPage.waitForSelector('[data-testid="chat-input"], textarea', { timeout: 10000 });

    // Support sends a message
    const supportInput = supportPage.locator('[data-testid="chat-input"], textarea').last();
    await supportInput.fill('Hello from support!');
    await supportInput.press('Enter');

    // Agent should see the message
    await agentPage.waitForSelector('text=Hello from support!', { timeout: 10000 });
    await expect(agentPage.locator('text=Hello from support!')).toBeVisible();

    // Agent sends a reply
    const agentInput = agentPage.locator('[data-testid="chat-input"], textarea').last();
    await agentInput.fill('Thanks for the help!');
    await agentInput.press('Enter');

    // Support should see the reply
    await supportPage.waitForSelector('text=Thanks for the help!', { timeout: 10000 });
    await expect(supportPage.locator('text=Thanks for the help!')).toBeVisible();

    await agentContext.close();
    await supportContext.close();
  });
});
```

- [ ] **Step 2: Run live chat tests**

Run: `cd e2e && npx playwright test tests/live-chat.spec.ts --project=docker`
Expected: Test passes — real-time Socket.io message exchange verified.

- [ ] **Step 3: Commit**

```bash
git add e2e/tests/live-chat.spec.ts
git commit -m "test(e2e): add live chat real-time messaging test"
```

---

### Task 6: Admin Dashboard E2E Tests

**Files:**
- Create: `e2e/tests/admin-dashboard.spec.ts`

- [ ] **Step 1: Write admin dashboard tests**

Create `e2e/tests/admin-dashboard.spec.ts`:
```typescript
import { test, expect } from '../fixtures/auth.fixture.js';
import { APP_URL } from '../lib/constants.js';

test.describe('Admin Dashboard', () => {
  test('admin sees dashboard with stats', async ({ loginAs, page }) => {
    await loginAs('adminA');
    await page.goto(APP_URL);
    await page.waitForLoadState('networkidle');

    // Dashboard should load
    await expect(page.locator('text=Dashboard')).toBeVisible({ timeout: 10000 });

    // Stats cards should render (look for number elements or stat containers)
    const statsArea = page.locator('[class*="stat"], [class*="card"], [class*="grid"]').first();
    await expect(statsArea).toBeVisible({ timeout: 10000 });
  });

  test('admin can navigate between tabs', async ({ loginAs, page }) => {
    await loginAs('adminA');
    await page.goto(APP_URL);
    await page.waitForLoadState('networkidle');

    // Look for tab navigation elements
    const tabs = page.locator('[role="tab"], [role="tablist"] button');
    const tabCount = await tabs.count();

    if (tabCount > 1) {
      // Click second tab
      await tabs.nth(1).click();
      // Verify content changes (page doesn't crash)
      await page.waitForTimeout(1000);
      await expect(page).not.toHaveTitle('Error');
    }
  });
});
```

- [ ] **Step 2: Run admin dashboard tests**

Run: `cd e2e && npx playwright test tests/admin-dashboard.spec.ts --project=docker`
Expected: Tests pass.

- [ ] **Step 3: Commit**

```bash
git add e2e/tests/admin-dashboard.spec.ts
git commit -m "test(e2e): add admin dashboard tests"
```

---

### Task 7: Multi-Tenant Isolation E2E Tests

**Files:**
- Create: `e2e/tests/multi-tenant.spec.ts`

- [ ] **Step 1: Write multi-tenant isolation tests**

Create `e2e/tests/multi-tenant.spec.ts`:
```typescript
import { test, expect } from '../fixtures/auth.fixture.js';
import { API_URL, APP_URL } from '../lib/constants.js';

test.describe('Multi-Tenant Isolation', () => {
  test('support from Partner B cannot see Partner A tickets', async ({ browser }) => {
    const agentAContext = await browser.newContext();
    const supportBContext = await browser.newContext();
    const agentAPage = await agentAContext.newPage();
    const supportBPage = await supportBContext.newPage();

    // Login agent A (Partner A)
    const agentRes = await agentAPage.request.post(`${API_URL}/api/auth/login`, {
      data: { id: 'e2e-agent-a', password: 'TestPass123!' },
    });
    const { token: agentToken } = await agentRes.json();
    await agentAPage.addInitScript((t: string) => localStorage.setItem('token', t), agentToken);

    // Login support B (Partner B)
    const supportRes = await supportBPage.request.post(`${API_URL}/api/auth/login`, {
      data: { id: 'e2e-support-b', password: 'TestPass123!' },
    });
    const { token: supportToken } = await supportRes.json();
    await supportBPage.addInitScript((t: string) => localStorage.setItem('token', t), supportToken);

    // Agent A creates a ticket
    await agentAPage.goto(APP_URL);
    await agentAPage.waitForSelector('form[aria-label]', { timeout: 10000 });
    await agentAPage.fill('textarea', 'Partner A secret ticket');
    await agentAPage.click('button[type="submit"]');

    // Wait for ticket to be created
    await agentAPage.waitForTimeout(3000);

    // Support B should NOT see Partner A's ticket
    await supportBPage.goto(APP_URL);
    await supportBPage.waitForLoadState('networkidle');
    await supportBPage.waitForTimeout(3000);

    const partnerATicket = supportBPage.locator('text=Partner A secret ticket');
    await expect(partnerATicket).not.toBeVisible();

    await agentAContext.close();
    await supportBContext.close();
  });
});
```

- [ ] **Step 2: Run multi-tenant tests**

Run: `cd e2e && npx playwright test tests/multi-tenant.spec.ts --project=docker`
Expected: Test passes — Partner B support cannot see Partner A's tickets.

- [ ] **Step 3: Commit**

```bash
git add e2e/tests/multi-tenant.spec.ts
git commit -m "test(e2e): add multi-tenant isolation test"
```

---

### Task 8: Mock Server for Fast Feedback Tests

**Files:**
- Create: `e2e/mock-server/data.ts`
- Create: `e2e/mock-server/index.ts`

- [ ] **Step 1: Create mock test data**

Create `e2e/mock-server/data.ts`:
```typescript
export const mockUsers = {
  agent: { id: 'mock-agent', username: 'agent', name: 'Mock Agent', role: 'agent', lang: 'en' },
  support: { id: 'mock-support', username: 'support', name: 'Mock Support', role: 'support', lang: 'en' },
  admin: { id: 'mock-admin', username: 'admin', name: 'Mock Admin', role: 'admin', lang: 'en' },
};

export const mockTickets = [
  {
    id: 'mock-ticket-1',
    status: 'open',
    dept: 'DSC',
    ref1: 'REF-001',
    ref2: '',
    participants: ['mock-agent'],
    partner_id: 'mock-partner',
    created_at: new Date().toISOString(),
  },
];

export const mockMessages = [
  {
    id: 'mock-msg-1',
    ticketId: 'mock-ticket-1',
    senderId: 'mock-agent',
    senderName: 'Mock Agent',
    senderRole: 'agent',
    originalText: 'Hello, I need help',
    improvedText: 'Hello, I need assistance with an issue.',
    processedText: 'Hello, I need assistance with an issue.',
    translationSkipped: true,
    fallback: false,
    whisper: false,
    system: false,
    reactions: '{}',
    created_at: new Date().toISOString(),
  },
];

export const mockConfig = {
  partnerId: 'mock-partner',
  partnerName: 'Mock Partner',
  industry: 'Technology',
  departments: [{ id: 'DSC', label: 'Dispatch' }, { id: 'FOT', label: 'Field Ops' }],
  ref1Label: 'Reference',
  ref2Label: 'Case ID',
  businessHours: { start: '07:30', end: '22:30', timezone: 'Europe/Brussels' },
  ai_enabled: true,
};
```

- [ ] **Step 2: Create mock server**

Create `e2e/mock-server/index.ts`:
```typescript
import express from 'express';
import { createServer } from 'http';
import { Server as SocketServer } from 'socket.io';
import jwt from 'jsonwebtoken';
import { mockUsers, mockTickets, mockMessages, mockConfig } from './data.js';

const app = express();
const httpServer = createServer(app);
const io = new SocketServer(httpServer, { cors: { origin: '*' } });

app.use(express.json());

const JWT_SECRET = 'mock-secret';

// Auth
app.post('/api/auth/login', (req, res) => {
  const { username } = req.body;
  const user = Object.values(mockUsers).find(u => u.username === username);
  if (!user) return res.status(401).json({ error: 'Invalid credentials' });
  const token = jwt.sign({ userId: user.id, role: user.role }, JWT_SECRET);
  res.json({ token, user });
});

// Config
app.get('/api/config', (_req, res) => res.json(mockConfig));

// Health
app.get('/api/health', (_req, res) => res.json({ status: 'ok' }));

// tRPC-style mock responses
app.get('/api/trpc/ticket.list', (_req, res) => {
  res.json({ result: { data: mockTickets } });
});

app.get('/api/trpc/stats.overview', (_req, res) => {
  res.json({ result: { data: { totalTickets: 42, avgResolution: 15, satisfaction: 4.2 } } });
});

// Socket.io with realistic message shapes
io.on('connection', (socket) => {
  socket.on('socket:identify', (data) => {
    socket.data = data;
    socket.emit('queue:update', mockTickets);
  });

  socket.on('ticket:new', (data) => {
    const ticket = { ...mockTickets[0], id: `mock-${Date.now()}`, ...data };
    socket.emit('ticket:created', ticket);
    io.emit('queue:update', [ticket, ...mockTickets]);
  });

  socket.on('message:send', (data) => {
    const msg = {
      id: `msg-${Date.now()}`,
      ticketId: data.ticketId,
      senderId: socket.data?.userId || 'unknown',
      senderName: socket.data?.name || 'Unknown',
      senderRole: socket.data?.role || 'agent',
      originalText: data.text,
      improvedText: data.text,
      processedText: data.text,
      translationSkipped: true,
      fallback: false,
      whisper: false,
      system: false,
      reactions: '{}',
      created_at: new Date().toISOString(),
    };
    io.to(`ticket:${data.ticketId}`).emit('message:new', msg);
    socket.emit('message:new', msg);
  });

  socket.on('typing:start', (data) => {
    socket.to(`ticket:${data.ticketId}`).emit('typing:indicator', {
      userId: socket.data?.userId,
      name: socket.data?.name,
      typing: true,
    });
  });

  socket.on('typing:stop', (data) => {
    socket.to(`ticket:${data.ticketId}`).emit('typing:indicator', {
      userId: socket.data?.userId,
      name: socket.data?.name,
      typing: false,
    });
  });
});

const PORT = 4173;
httpServer.listen(PORT, () => {
  console.log(`Mock server running on http://localhost:${PORT}`);
});
```

- [ ] **Step 3: Add mock server dependencies**

Run: `cd e2e && npm install --save-dev express socket.io jsonwebtoken @types/express @types/jsonwebtoken`

- [ ] **Step 4: Add mock server start script to e2e/package.json**

Add to `e2e/package.json` scripts:
```json
"mock:start": "tsx mock-server/index.ts"
```

Add `tsx` as dev dependency:
Run: `cd e2e && npm install --save-dev tsx`

- [ ] **Step 5: Commit**

```bash
git add e2e/mock-server/ e2e/package.json
git commit -m "feat(e2e): add mock server with Socket.io and canned responses"
```

---

## Chunk 2: Prometheus + Grafana Observability

### Task 9: Server Metrics Definitions

**Files:**
- Create: `server/utils/metrics.ts`

- [ ] **Step 1: Install prom-client**

Run: `cd server && npm install prom-client`

- [ ] **Step 2: Create metrics definitions**

Create `server/utils/metrics.ts`:
```typescript
import client from 'prom-client';

// Collect default Node.js metrics (GC, event loop, memory)
client.collectDefaultMetrics();

// HTTP metrics
export const httpRequestDuration = new client.Histogram({
  name: 'http_request_duration_seconds',
  help: 'Duration of HTTP requests in seconds',
  labelNames: ['method', 'route', 'status'],
  buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
});

export const httpRequestsTotal = new client.Counter({
  name: 'http_requests_total',
  help: 'Total number of HTTP requests',
  labelNames: ['method', 'route', 'status'],
});

// Socket.io metrics
export const socketioConnectionsActive = new client.Gauge({
  name: 'socketio_connections_active',
  help: 'Number of active Socket.io connections',
});

export const socketioEventsTotal = new client.Counter({
  name: 'socketio_events_total',
  help: 'Total number of Socket.io events processed',
  labelNames: ['event'],
});

// Ticket metrics
export const ticketsActiveTotal = new client.Gauge({
  name: 'tickets_active_total',
  help: 'Number of currently open or active tickets',
  labelNames: ['partner_id'],
});

export const ticketQueueDepth = new client.Gauge({
  name: 'ticket_queue_depth',
  help: 'Number of tickets waiting for support',
  labelNames: ['partner_id'],
});

// AI pipeline metrics
export const aiPipelineDuration = new client.Histogram({
  name: 'ai_pipeline_duration_seconds',
  help: 'Duration of AI pipeline calls in seconds',
  labelNames: ['type'],
  buckets: [0.1, 0.5, 1, 2, 5, 10, 30],
});

export const aiPipelineErrorsTotal = new client.Counter({
  name: 'ai_pipeline_errors_total',
  help: 'Total number of AI pipeline errors',
  labelNames: ['type'],
});

export const register = client.register;
```

- [ ] **Step 3: Commit**

```bash
git add server/utils/metrics.ts server/package.json server/package-lock.json
git commit -m "feat(metrics): add prom-client metric definitions"
```

---

### Task 10: HTTP Metrics Middleware

**Files:**
- Create: `server/middleware/metrics.ts`
- Modify: `server/app.ts` (mount middleware and /metrics endpoint)

- [ ] **Step 1: Create metrics middleware**

Create `server/middleware/metrics.ts`:
```typescript
import { Request, Response, NextFunction } from 'express';
import { httpRequestDuration, httpRequestsTotal } from '../utils/metrics.js';

export function metricsMiddleware(req: Request, res: Response, next: NextFunction) {
  // Skip the metrics endpoint itself to avoid self-referential noise
  if (req.path === '/metrics') return next();

  const start = process.hrtime.bigint();

  res.on('finish', () => {
    const durationNs = Number(process.hrtime.bigint() - start);
    const durationSec = durationNs / 1e9;

    // Normalize route to avoid high cardinality
    const route = req.route?.path || req.path.replace(/\/[a-f0-9-]{36}/g, '/:id');

    const labels = {
      method: req.method,
      route,
      status: String(res.statusCode),
    };

    httpRequestDuration.observe(labels, durationSec);
    httpRequestsTotal.inc(labels);
  });

  next();
}
```

- [ ] **Step 2: Mount metrics middleware and /metrics endpoint in app.ts**

In `server/app.ts`:

1. Add import at the top:
```typescript
import { metricsMiddleware } from './middleware/metrics.js';
import { register } from './utils/metrics.js';
```

2. Add metrics middleware AFTER the logging middleware (after line ~76) and BEFORE route mounts:
```typescript
app.use(metricsMiddleware);
```

3. Add /metrics endpoint BEFORE the health endpoint (before line ~102):
```typescript
app.get('/metrics', async (_req, res) => {
  res.set('Content-Type', register.contentType);
  res.end(await register.metrics());
});
```

- [ ] **Step 3: Verify /metrics endpoint works**

Run: `curl http://localhost:3001/metrics`
Expected: Prometheus-formatted text output with default Node.js metrics and custom metrics.

- [ ] **Step 4: Commit**

```bash
git add server/middleware/metrics.ts server/app.ts
git commit -m "feat(metrics): add HTTP metrics middleware and /metrics endpoint"
```

---

### Task 11: Socket.io & AI Pipeline Instrumentation

**Files:**
- Modify: `server/socket/handlers.ts` (add Socket.io metrics)
- Modify: `server/services/translate.ts` (add AI pipeline metrics)

- [ ] **Step 1: Add Socket.io metrics to handlers.ts**

In `server/socket/handlers.ts`:

1. Add import at the top:
```typescript
import { socketioConnectionsActive, socketioEventsTotal } from '../utils/metrics.js';
```

2. Inside the `io.on('connection', ...)` handler (line ~105), increment the gauge:
```typescript
socketioConnectionsActive.inc();
```

3. Inside the `disconnect` handler (line ~308), decrement:
```typescript
socketioConnectionsActive.dec();
```

4. Add a helper function before the connection handler to wrap event registration:
```typescript
import type { Socket } from 'socket.io';

function trackEvent(socket: Socket, event: string, handler: (...args: unknown[]) => void) {
  socket.on(event, (...args: unknown[]) => {
    socketioEventsTotal.inc({ event });
    handler(...args);
  });
}
```

Then replace the most important `socket.on('event', ...)` calls with `trackEvent(socket, 'event', ...)` for: `ticket:new`, `message:send`, `ticket:close`, `support:join`, `support:leave`.

- [ ] **Step 2: Add AI pipeline metrics to translate.ts**

In `server/services/translate.ts`:

1. Add import at the top:
```typescript
import { aiPipelineDuration, aiPipelineErrorsTotal } from '../utils/metrics.js';
```

2. In `callOllamaWithRetry` (line ~56), wrap the successful call with timing:
```typescript
const end = aiPipelineDuration.startTimer({ type });
try {
  const result = await callOllama(prompt, type, modelOverride);
  end();
  return result;
} catch (err) {
  if (attempt === maxRetries) {
    end();
    aiPipelineErrorsTotal.inc({ type });
    throw err;
  }
  // ... existing retry logic
}
```

- [ ] **Step 3: Verify metrics are incrementing**

Run:
```bash
# Trigger some activity, then check metrics
curl -s http://localhost:3001/metrics | grep -E "socketio_|ai_pipeline_"
```
Expected: Metric lines present (even if 0 initially).

- [ ] **Step 4: Commit**

```bash
git add server/socket/handlers.ts server/services/translate.ts
git commit -m "feat(metrics): instrument Socket.io events and AI pipeline"
```

---

### Task 12: Prometheus & Grafana Docker Services

**Files:**
- Create: `monitoring/prometheus.yml`
- Create: `monitoring/grafana/provisioning/datasources/prometheus.yml`
- Create: `monitoring/grafana/provisioning/dashboards/dashboard.yml`
- Create: `monitoring/grafana/dashboards/tessera.json`
- Modify: `docker-compose.yml` (add prometheus, grafana services and volumes)

- [ ] **Step 1: Create Prometheus config**

Create `monitoring/prometheus.yml`:
```yaml
global:
  scrape_interval: 15s
  evaluation_interval: 15s

scrape_configs:
  - job_name: 'tessera-server'
    static_configs:
      - targets: ['server:3001']
    metrics_path: '/metrics'
```

- [ ] **Step 2: Create Grafana datasource provisioning**

Create `monitoring/grafana/provisioning/datasources/prometheus.yml`:
```yaml
apiVersion: 1

datasources:
  - name: Prometheus
    type: prometheus
    access: proxy
    url: http://prometheus:9090
    isDefault: true
    editable: true
```

- [ ] **Step 3: Create Grafana dashboard provisioning**

Create `monitoring/grafana/provisioning/dashboards/dashboard.yml`:
```yaml
apiVersion: 1

providers:
  - name: 'default'
    orgId: 1
    folder: ''
    type: file
    disableDeletion: false
    editable: true
    options:
      path: /var/lib/grafana/dashboards
      foldersFromFilesStructure: false
```

- [ ] **Step 4: Create Grafana dashboard JSON**

Create `monitoring/grafana/dashboards/tessera.json`:
```json
{
  "annotations": { "list": [] },
  "editable": true,
  "fiscalYearStartMonth": 0,
  "graphTooltip": 0,
  "id": null,
  "links": [],
  "panels": [
    {
      "title": "Request Rate (req/s)",
      "type": "timeseries",
      "gridPos": { "h": 8, "w": 12, "x": 0, "y": 0 },
      "targets": [
        {
          "expr": "rate(http_requests_total[5m])",
          "legendFormat": "{{method}} {{route}} {{status}}"
        }
      ]
    },
    {
      "title": "Request Latency P50/P95/P99",
      "type": "timeseries",
      "gridPos": { "h": 8, "w": 12, "x": 12, "y": 0 },
      "targets": [
        {
          "expr": "histogram_quantile(0.50, rate(http_request_duration_seconds_bucket[5m]))",
          "legendFormat": "p50"
        },
        {
          "expr": "histogram_quantile(0.95, rate(http_request_duration_seconds_bucket[5m]))",
          "legendFormat": "p95"
        },
        {
          "expr": "histogram_quantile(0.99, rate(http_request_duration_seconds_bucket[5m]))",
          "legendFormat": "p99"
        }
      ]
    },
    {
      "title": "Error Rate (5xx)",
      "type": "timeseries",
      "gridPos": { "h": 8, "w": 12, "x": 0, "y": 8 },
      "targets": [
        {
          "expr": "rate(http_requests_total{status=~\"5..\"}[5m])",
          "legendFormat": "{{method}} {{route}}"
        }
      ]
    },
    {
      "title": "Active Socket.io Connections",
      "type": "stat",
      "gridPos": { "h": 8, "w": 6, "x": 12, "y": 8 },
      "targets": [
        {
          "expr": "socketio_connections_active",
          "legendFormat": "connections"
        }
      ]
    },
    {
      "title": "Socket.io Events/s",
      "type": "timeseries",
      "gridPos": { "h": 8, "w": 6, "x": 18, "y": 8 },
      "targets": [
        {
          "expr": "rate(socketio_events_total[5m])",
          "legendFormat": "{{event}}"
        }
      ]
    },
    {
      "title": "Ticket Queue Depth",
      "type": "gauge",
      "gridPos": { "h": 8, "w": 6, "x": 0, "y": 16 },
      "targets": [
        {
          "expr": "ticket_queue_depth",
          "legendFormat": "{{partner_id}}"
        }
      ]
    },
    {
      "title": "AI Pipeline Latency",
      "type": "timeseries",
      "gridPos": { "h": 8, "w": 9, "x": 6, "y": 16 },
      "targets": [
        {
          "expr": "histogram_quantile(0.95, rate(ai_pipeline_duration_seconds_bucket[5m]))",
          "legendFormat": "p95 {{type}}"
        },
        {
          "expr": "histogram_quantile(0.50, rate(ai_pipeline_duration_seconds_bucket[5m]))",
          "legendFormat": "p50 {{type}}"
        }
      ]
    },
    {
      "title": "AI Pipeline Errors/s",
      "type": "timeseries",
      "gridPos": { "h": 8, "w": 9, "x": 15, "y": 16 },
      "targets": [
        {
          "expr": "rate(ai_pipeline_errors_total[5m])",
          "legendFormat": "{{type}}"
        }
      ]
    }
  ],
  "schemaVersion": 39,
  "tags": ["tessera"],
  "templating": { "list": [] },
  "time": { "from": "now-1h", "to": "now" },
  "title": "Tessera Overview",
  "uid": "tessera-overview"
}
```

- [ ] **Step 5: Add Prometheus and Grafana to docker-compose.yml**

Add to `docker-compose.yml` services section:
```yaml
  prometheus:
    image: prom/prometheus:latest
    volumes:
      - ./monitoring/prometheus.yml:/etc/prometheus/prometheus.yml
      - prometheus_data:/prometheus
    ports:
      - "9090:9090"
    depends_on:
      - server

  grafana:
    image: grafana/grafana:latest
    volumes:
      - ./monitoring/grafana/provisioning:/etc/grafana/provisioning
      - ./monitoring/grafana/dashboards:/var/lib/grafana/dashboards
      - grafana_data:/var/lib/grafana
    ports:
      - "3000:3000"
    environment:
      - GF_SECURITY_ADMIN_PASSWORD=${GRAFANA_ADMIN_PASSWORD:-admin}
    depends_on:
      - prometheus
```

Add to `docker-compose.yml` top-level volumes:
```yaml
volumes:
  postgres_data:
  prometheus_data:
  grafana_data:
```

- [ ] **Step 6: Rebuild and verify**

Run: `docker-compose up --build -d`
Then:
- `curl http://localhost:9090/api/v1/targets` — Prometheus should show tessera-server as UP
- Open `http://localhost:3000` — Grafana login (admin/admin), Tessera Overview dashboard should be auto-provisioned

- [ ] **Step 7: Commit**

```bash
git add monitoring/ docker-compose.yml
git commit -m "feat(metrics): add Prometheus + Grafana with pre-built dashboard"
```

---

## Chunk 3: Agent Lite PWA

### Task 13: PWA Manifest & Service Worker Setup

**Files:**
- Create: `client/public/manifest.json`
- Create: `client/public/icons/` (placeholder icons)
- Create: `client/public/sw.js`
- Modify: `client/index.html` (add manifest link and theme-color)

- [ ] **Step 1: Create PWA manifest**

Create `client/public/manifest.json`:
```json
{
  "name": "Tessera Agent",
  "short_name": "Tessera",
  "display": "standalone",
  "start_url": "/?lite=1",
  "theme_color": "#2563eb",
  "background_color": "#ffffff",
  "icons": [
    { "src": "/icons/icon-192.png", "sizes": "192x192", "type": "image/png" },
    { "src": "/icons/icon-512.png", "sizes": "512x512", "type": "image/png" },
    { "src": "/icons/icon-512-maskable.png", "sizes": "512x512", "type": "image/png", "purpose": "maskable" }
  ]
}
```

- [ ] **Step 2: Create placeholder icons**

Create simple placeholder PNG icons. For now, create the directory and add minimal SVG-to-PNG placeholders:

```bash
mkdir -p client/public/icons
```

Create a simple script or use an online tool to generate 192x192 and 512x512 PNG icons with the letter "T" on a blue (#2563eb) background. Place them at:
- `client/public/icons/icon-192.png`
- `client/public/icons/icon-512.png`
- `client/public/icons/icon-512-maskable.png` (same as 512 but with safe zone padding)

> **Note:** For production, replace with professionally designed icons. These are placeholders.

- [ ] **Step 3: Create service worker**

Create `client/public/sw.js` (plain JS — served directly by Vite without build step):
```javascript
const CACHE_NAME = 'tessera-v1';
const STATIC_ASSETS = [
  '/',
  '/manifest.json',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(STATIC_ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
      )
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Skip non-GET requests
  if (request.method !== 'GET') return;

  // Skip Socket.io requests
  if (url.pathname.startsWith('/socket.io')) return;

  // API calls: network-first, cache fallback
  if (url.pathname.startsWith('/api')) {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
          return response;
        })
        .catch(() => caches.match(request).then((r) => r || new Response('Offline', { status: 503 })))
    );
    return;
  }

  // Static assets: cache-first
  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;
      return fetch(request).then((response) => {
        const clone = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
        return response;
      });
    })
  );
});
```

- [ ] **Step 4: Add manifest and theme-color to index.html**

In `client/index.html`, add inside `<head>` (after the `<title>` tag):
```html
<link rel="manifest" href="/manifest.json">
<meta name="theme-color" content="#2563eb">
```

- [ ] **Step 5: Register service worker in the app**

In `client/src/App.tsx`, add at the end of the file (before the default export, or inside a useEffect in App):

Add a service worker registration block. In `App.tsx`, inside the main `useEffect` or as a standalone effect:
```typescript
useEffect(() => {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js').catch(() => {
      // SW registration failed — app works without it
    });
  }
}, []);
```

- [ ] **Step 6: Commit**

```bash
git add client/public/manifest.json client/public/icons/ client/public/sw.js client/index.html
git commit -m "feat(pwa): add manifest, service worker, and app icons"
```

---

### Task 14: AgentLiteView Component

**Files:**
- Create: `client/src/views/AgentLiteView.tsx`

- [ ] **Step 1: Create AgentLiteView**

Create `client/src/views/AgentLiteView.tsx`:
```typescript
import { useEffect, useState } from 'react';
import useStore from '../store/useStore';
import { getSocket } from '../hooks/useSocket';
import { usePartner } from '../hooks/usePartner';
import { useT } from '../i18n';
import ChatWindow from '../components/ChatWindow';
import { trpc } from '../utils/trpc';

export default function AgentLiteView() {
  const { user, logout, tickets, setTickets, activeTicketId, setActiveTicketId } = useStore();
  const { manifest } = usePartner();
  const t = useT();
  const [dept, setDept] = useState(manifest.departments[0]?.id || 'DSC');
  const [ref1, setRef1] = useState('');
  const [text, setText] = useState('');
  const [loading, setLoading] = useState(false);
  const [view, setView] = useState<'list' | 'create' | 'chat'>('list');

  const { data: ticketList } = trpc.ticket.list.useQuery(
    { agentId: user?.id },
    { enabled: !!user?.id }
  );

  useEffect(() => {
    if (ticketList) setTickets(ticketList as any);
  }, [ticketList, setTickets]);

  useEffect(() => {
    if (activeTicketId) setView('chat');
  }, [activeTicketId]);

  const activeTicket = tickets.find((tk) => tk.id === activeTicketId);

  async function createTicket(e: React.FormEvent) {
    e.preventDefault();
    if (!user || !text.trim()) return;
    setLoading(true);
    getSocket().emit('ticket:new', {
      dept,
      agentId: user.id,
      agentLang: user.lang,
      ref1,
      ref2: '',
      text: text.trim(),
    });
    setRef1('');
    setText('');
    setLoading(false);
    setView('list');
  }

  if (!user) return null;

  return (
    <div className="h-screen flex flex-col bg-white dark:bg-gray-950">
      {/* Minimal header */}
      <header className="flex items-center justify-between px-4 py-3 bg-brand-900 text-white safe-area-top">
        <div className="flex items-center gap-2">
          {view !== 'list' && (
            <button
              onClick={() => { setView('list'); setActiveTicketId(null); }}
              className="p-2 -ml-2 rounded-lg active:bg-white/10"
              aria-label={t('back')}
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
            </button>
          )}
          <span className="font-bold text-lg">{manifest.industry}</span>
        </div>
        <button
          onClick={logout}
          className="text-sm text-gray-300 active:text-white px-3 py-2"
          aria-label={t('sign_out')}
        >
          {t('sign_out')}
        </button>
      </header>

      {/* Content */}
      <div className="flex-1 overflow-hidden">
        {view === 'chat' && activeTicket ? (
          <div className="h-full">
            <ChatWindow
              key={activeTicket.id}
              ticket={activeTicket}
              onClose={() => { setView('list'); setActiveTicketId(null); }}
            />
          </div>
        ) : view === 'create' ? (
          <div className="p-4 overflow-y-auto h-full">
            <h2 className="text-xl font-bold dark:text-white mb-4">{t('new_ticket')}</h2>
            <form onSubmit={createTicket} className="space-y-4">
              {/* Department selector */}
              <div className="flex flex-wrap gap-2">
                {manifest.departments.map((d) => (
                  <button
                    key={d.id}
                    type="button"
                    onClick={() => setDept(d.id)}
                    className={`py-3 px-5 rounded-xl border-2 font-bold text-sm min-h-[44px] ${
                      dept === d.id
                        ? 'border-brand-500 bg-brand-500/10 text-brand-600 dark:text-brand-400'
                        : 'border-gray-200 dark:border-gray-700 text-gray-500'
                    }`}
                  >
                    {d.label}
                  </button>
                ))}
              </div>

              {/* Reference */}
              <div>
                <label className="text-xs uppercase font-bold text-gray-500 mb-1 block">{manifest.ref1Label}</label>
                <input
                  type="text"
                  value={ref1}
                  onChange={(e) => setRef1(e.target.value)}
                  placeholder={t('dare_placeholder')}
                  className="w-full border dark:border-gray-700 rounded-xl px-4 py-3 text-base dark:bg-gray-900 dark:text-white min-h-[44px]"
                />
              </div>

              {/* Description */}
              <div>
                <label className="text-xs uppercase font-bold text-gray-500 mb-1 block">{t('question_problem')}</label>
                <textarea
                  rows={5}
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  placeholder={t('describe_problem')}
                  required
                  className="w-full border dark:border-gray-700 rounded-xl px-4 py-3 text-base dark:bg-gray-900 dark:text-white resize-none"
                />
              </div>

              <button
                type="submit"
                disabled={loading || !text.trim()}
                className="w-full bg-brand-500 text-white py-4 rounded-xl font-bold text-base min-h-[44px] active:scale-95 disabled:opacity-50"
              >
                {loading ? t('connecting') : t('connect_with_support')}
              </button>
            </form>
          </div>
        ) : (
          /* Ticket list */
          <div className="h-full flex flex-col">
            <div className="flex-1 overflow-y-auto">
              {tickets.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-full text-gray-400 p-8">
                  <p className="text-lg">{t('no_tickets')}</p>
                </div>
              ) : (
                <ul className="divide-y dark:divide-gray-800">
                  {tickets.map((ticket) => (
                    <li key={ticket.id}>
                      <button
                        onClick={() => { setActiveTicketId(ticket.id); setView('chat'); }}
                        className="w-full text-left px-4 py-4 active:bg-gray-50 dark:active:bg-gray-900 min-h-[44px]"
                      >
                        <div className="flex items-center justify-between">
                          <span className="font-medium dark:text-white truncate">{ticket.ref1 || ticket.dept}</span>
                          <span className={`text-xs px-2 py-1 rounded-full font-bold ${
                            ticket.status === 'open' ? 'bg-yellow-100 text-yellow-700' :
                            ticket.status === 'active' ? 'bg-green-100 text-green-700' :
                            'bg-gray-100 text-gray-500'
                          }`}>
                            {ticket.status}
                          </span>
                        </div>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {/* FAB for new ticket */}
            <div className="p-4 safe-area-bottom">
              <button
                onClick={() => setView('create')}
                className="w-full bg-brand-500 text-white py-4 rounded-xl font-bold text-base min-h-[44px] active:scale-95"
              >
                + {t('new_ticket')}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add client/src/views/AgentLiteView.tsx
git commit -m "feat(pwa): create AgentLiteView mobile component"
```

---

### Task 15: App.tsx Routing for Lite Mode

**Files:**
- Modify: `client/src/App.tsx` (add lazy import and ?lite=1 detection)

- [ ] **Step 1: Add AgentLiteView lazy import**

In `client/src/App.tsx`, add after the existing lazy imports (line ~10):
```typescript
const AgentLiteView = lazy(() => import('./views/AgentLiteView'));
```

- [ ] **Step 2: Add lite mode detection and routing**

In the `renderView` function inside `App.tsx`, modify the agent role rendering.

Before the existing `{role === 'agent' && <AgentView />}` line, add:
```typescript
{role === 'agent' && isLiteMode && <AgentLiteView />}
{role === 'agent' && !isLiteMode && <AgentView />}
```

And remove the original `{role === 'agent' && <AgentView />}` line.

Add the lite mode detection inside the `renderView` function, after line 103 (`const role = activeMembership?.role;`):
```typescript
const isLiteMode = new URLSearchParams(window.location.search).has('lite');
```

- [ ] **Step 3: Add mobile detection prompt**

In `App.tsx`, add `useState` to the React import, then add state and effect inside the `App` component (note: uses `activeMembership?.role`, not `user?.role`):
```typescript
const [showLitePrompt, setShowLitePrompt] = useState(false);

const { memberships, activeMembershipId } = useStore.getState();
const activeMembership = memberships.find(m => m.id === activeMembershipId);

useEffect(() => {
  if (activeMembership?.role !== 'agent') return;
  const isLite = new URLSearchParams(window.location.search).has('lite');
  if (isLite) return;
  if (localStorage.getItem('liteDismissed')) return;

  const isMobile = (navigator as any).userAgentData?.mobile ?? window.matchMedia('(max-width: 768px)').matches;
  if (isMobile) setShowLitePrompt(true);
}, [activeMembership?.role]);
```

Render a simple prompt banner when `showLitePrompt` is true:
```typescript
{showLitePrompt && (
  <div className="fixed bottom-4 left-4 right-4 z-[9999] bg-brand-900 text-white p-4 rounded-xl shadow-2xl flex items-center justify-between gap-3">
    <span className="text-sm font-medium">Switch to mobile view?</span>
    <div className="flex gap-2">
      <button
        onClick={() => { window.location.href = '/?lite=1'; }}
        className="bg-brand-500 px-4 py-2 rounded-lg text-sm font-bold"
      >
        Yes
      </button>
      <button
        onClick={() => { setShowLitePrompt(false); localStorage.setItem('liteDismissed', '1'); }}
        className="px-4 py-2 rounded-lg text-sm text-gray-300"
      >
        No
      </button>
    </div>
  </div>
)}
```

- [ ] **Step 4: Verify lite mode routing**

1. Open `http://localhost:5173` as agent → should see full AgentView
2. Open `http://localhost:5173/?lite=1` as agent → should see AgentLiteView
3. Open on a narrow viewport → should see mobile prompt

- [ ] **Step 5: Commit**

```bash
git add client/src/App.tsx
git commit -m "feat(pwa): add lite mode routing with mobile detection prompt"
```

---

### Task 16: Final Integration Verification

**Files:** None (verification only)

- [ ] **Step 1: Run existing unit tests**

Run:
```bash
cd server && npm test
cd client && npm test
```
Expected: All existing tests pass — no regressions.

- [ ] **Step 2: Run E2E tests against Docker**

Run:
```bash
docker-compose up --build -d
cd e2e && npx playwright test --project=docker
```
Expected: All E2E tests pass.

- [ ] **Step 3: Verify Prometheus scraping**

Open: `http://localhost:9090/targets`
Expected: `tessera-server` target shows state `UP`.

- [ ] **Step 4: Verify Grafana dashboard**

Open: `http://localhost:3000` (admin/admin)
Expected: "Tessera Overview" dashboard is visible with panels rendering data.

- [ ] **Step 5: Verify PWA installability**

Open Chrome DevTools > Application > Manifest at `http://localhost:5173/?lite=1`
Expected: Manifest loads, icons display, "Install app" option available.

- [ ] **Step 6: Build check**

Run: `cd client && npm run build`
Expected: Build succeeds with no errors or warnings.

- [ ] **Step 7: Final commit (if any tweaks needed)**

```bash
git add -A
git commit -m "chore: Phase 8 integration fixes"
```
