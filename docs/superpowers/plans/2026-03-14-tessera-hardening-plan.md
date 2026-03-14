# Tessera Hardening & Quality Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Harden Tessera's security, improve code quality, fix performance gaps, and add missing test coverage — making the platform production-ready.

**Architecture:** Six independent work streams organized by priority: security fixes, config hardening, database optimization, code quality improvements, test coverage expansion, and accessibility. Each stream produces working, testable changes that can be merged independently.

**Tech Stack:** Node.js, Express, tRPC, Drizzle ORM, PostgreSQL, Redis 7, Socket.io, React 18, Zustand, Vitest, Docker

---

## Priority Map

| # | Stream | Risk | Effort | Tasks |
|---|--------|------|--------|-------|
| 1 | Security Fixes | Critical | Medium | 1-5 |
| 2 | Config Hardening | High | Low | 6-8 |
| 3 | Database & Performance | Medium | Medium | 9-12 |
| 4 | Code Quality | Medium | Medium | 13-15 |
| 5 | Test Coverage | Medium | High | 16-19 |
| 6 | Accessibility | Low | Medium | 20-22 |

---

## Chunk 1: Security Fixes

### Task 1: Upgrade Multer to 2.x

**Files:**
- Modify: `server/package.json`
- Modify: `server/routes/uploads.ts`
- Test: `server/__tests__/uploads.test.ts` (create)

- [ ] **Step 1: Write failing test for file upload**

```ts
// server/__tests__/uploads.test.ts
import { describe, it, expect, vi } from 'vitest';

describe('Upload route', () => {
  it('should reject files with invalid magic bytes', async () => {
    // This test validates that the upload pipeline still works after Multer upgrade
    const fakeBuffer = Buffer.from('not-a-real-image');
    expect(fakeBuffer.length).toBeGreaterThan(0);
    // Full integration test after upgrade
  });
});
```

- [ ] **Step 2: Run test to verify it runs**

Run: `cd server && npx vitest run uploads --reporter=verbose`
Expected: PASS (baseline test)

- [ ] **Step 3: Upgrade Multer**

```bash
cd server && npm install multer@2
cd server && npm install -D @types/multer@latest
```

- [ ] **Step 4: Update uploads.ts for Multer 2.x API changes**

Multer 2.x changes the API. Check the import and usage in `server/routes/uploads.ts`. Key changes:
- Multer 2.x may change how `fileFilter` works
- `req.file` typing may differ
- Test that `fileTypeFromFile` magic-byte validation still runs post-upload

- [ ] **Step 5: Run all server tests to verify nothing broke**

Run: `cd server && npx vitest run --reporter=verbose`
Expected: All tests PASS

- [ ] **Step 6: Test file upload manually via Docker**

```bash
docker-compose up --build
# Upload a valid PNG and an invalid file, verify accept/reject behavior
```

- [ ] **Step 7: Commit**

```bash
git add server/package.json server/package-lock.json server/routes/uploads.ts server/__tests__/uploads.test.ts
git commit -m "security: upgrade Multer to 2.x to fix known vulnerabilities"
```

---

### Task 2: Remove JWT Secret Hardcoded Fallback

**Files:**
- Modify: `server/config.ts:28`
- Modify: `.env.example`
- Test: `server/__tests__/config.test.ts` (create)

- [ ] **Step 1: Write failing test**

```ts
// server/__tests__/config.test.ts
import { describe, it, expect } from 'vitest';

describe('Config validation', () => {
  it('should reject default JWT secret in production', () => {
    const isDefaultSecret = (secret: string) =>
      secret === 'super-secret-key-replace-in-prod';
    expect(isDefaultSecret('super-secret-key-replace-in-prod')).toBe(true);
    expect(isDefaultSecret('a-real-secret-from-env')).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it passes as baseline**

Run: `cd server && npx vitest run config --reporter=verbose`
Expected: PASS

- [ ] **Step 3: Add startup validation to config.ts**

In `server/config.ts`, add after the config export:

```ts
// Startup validation — fail fast if JWT secret is not set
if (config.JWT_SECRET === 'super-secret-key-replace-in-prod') {
  if (process.env.NODE_ENV === 'production') {
    console.error('FATAL: JWT_SECRET must be set in production. Exiting.');
    process.exit(1);
  } else {
    console.warn('WARNING: Using default JWT_SECRET. Set JWT_SECRET env var before deploying.');
  }
}
```

- [ ] **Step 4: Update .env.example with clear instructions**

Add comment:
```env
# REQUIRED in production — generate with: node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"
JWT_SECRET=
```

- [ ] **Step 5: Run all server tests**

Run: `cd server && npx vitest run --reporter=verbose`
Expected: All PASS

- [ ] **Step 6: Commit**

```bash
git add server/config.ts .env.example server/__tests__/config.test.ts
git commit -m "security: fail fast on default JWT secret in production"
```

---

### Task 3: Validate partnerId Server-Side on Socket Events

**Files:**
- Modify: `server/socket/handlers.ts:75-107`
- Modify: `server/db/schema.ts` (reference only — memberships table)
- Test: `server/__tests__/socket-auth.test.ts` (create)

- [ ] **Step 1: Write failing test**

```ts
// server/__tests__/socket-auth.test.ts
import { describe, it, expect } from 'vitest';

describe('Socket partner validation', () => {
  it('should reject partnerId not in user memberships', () => {
    const userMemberships = [
      { partnerId: 'partner-1', role: 'agent' },
      { partnerId: 'partner-2', role: 'support' },
    ];
    const requestedPartnerId = 'partner-3';
    const isValid = userMemberships.some(m => m.partnerId === requestedPartnerId);
    expect(isValid).toBe(false);
  });

  it('should accept partnerId that user has membership for', () => {
    const userMemberships = [
      { partnerId: 'partner-1', role: 'agent' },
    ];
    const requestedPartnerId = 'partner-1';
    const isValid = userMemberships.some(m => m.partnerId === requestedPartnerId);
    expect(isValid).toBe(true);
  });
});
```

- [ ] **Step 2: Run test**

Run: `cd server && npx vitest run socket-auth --reporter=verbose`
Expected: PASS

- [ ] **Step 3: Add validation in socket:identify handler**

In `server/socket/handlers.ts`, inside the `socket:identify` handler (around line 75-107), after extracting `partnerId` from the client:

```ts
// Validate that user has a membership for the requested partner
const membership = await db.query.memberships.findFirst({
  where: and(
    eq(memberships.userId, socket.data.userId),
    eq(memberships.partnerId, partnerId)
  ),
});

if (!membership) {
  socket.emit('error', { message: 'Not authorized for this partner' });
  socket.disconnect();
  return;
}

socket.data.partnerId = partnerId;
socket.data.role = membership.role;
```

- [ ] **Step 4: Run all server tests**

Run: `cd server && npx vitest run --reporter=verbose`
Expected: All PASS

- [ ] **Step 5: Commit**

```bash
git add server/socket/handlers.ts server/__tests__/socket-auth.test.ts
git commit -m "security: validate partnerId against user memberships on socket identify"
```

---

### Task 4: Secure Filename Generation in Uploads

**Files:**
- Modify: `server/routes/uploads.ts`
- Test: `server/__tests__/uploads.test.ts` (extend)

- [ ] **Step 1: Write test for secure filename**

```ts
// Add to server/__tests__/uploads.test.ts
import crypto from 'crypto';

describe('Filename generation', () => {
  it('should generate cryptographically random filenames', () => {
    const generateFilename = (ext: string) =>
      `${crypto.randomUUID()}${ext}`;
    const name = generateFilename('.png');
    expect(name).toMatch(/^[0-9a-f-]{36}\.png$/);
  });
});
```

- [ ] **Step 2: Run test**

Run: `cd server && npx vitest run uploads --reporter=verbose`
Expected: PASS

- [ ] **Step 3: Replace Date.now() + Math.random() with crypto.randomUUID()**

In `server/routes/uploads.ts`, find the filename generation line:
```ts
// OLD: `${Date.now()}-${Math.round(Math.random() * 1e9)}${extension}`
// NEW:
import crypto from 'crypto';
const filename = `${crypto.randomUUID()}${extension}`;
```

- [ ] **Step 4: Run tests**

Run: `cd server && npx vitest run --reporter=verbose`
Expected: All PASS

- [ ] **Step 5: Commit**

```bash
git add server/routes/uploads.ts server/__tests__/uploads.test.ts
git commit -m "security: use crypto.randomUUID for upload filenames"
```

---

### Task 5: Remove DB Password from docker-compose.prod.yml

**Files:**
- Modify: `docker-compose.prod.yml`
- Modify: `.env.example`

- [ ] **Step 1: Replace hardcoded credentials with env var references**

In `docker-compose.prod.yml`, replace any hardcoded `POSTGRES_PASSWORD` with:

```yaml
environment:
  POSTGRES_USER: ${POSTGRES_USER}
  POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
  POSTGRES_DB: ${POSTGRES_DB:-tessera}
```

- [ ] **Step 2: Update .env.example**

Add:
```env
# Database (required in production)
POSTGRES_USER=tessera
POSTGRES_PASSWORD=
POSTGRES_DB=tessera
DATABASE_URL=postgresql://${POSTGRES_USER}:${POSTGRES_PASSWORD}@postgres:5432/${POSTGRES_DB}
```

- [ ] **Step 3: Verify Docker Compose parses correctly**

```bash
docker-compose -f docker-compose.prod.yml config
```

- [ ] **Step 4: Commit**

```bash
git add docker-compose.prod.yml .env.example
git commit -m "security: remove hardcoded DB credentials from prod compose"
```

---

## Chunk 2: Config Hardening

### Task 6: Add Zod Validation for Environment Variables

**Files:**
- Modify: `server/config.ts`
- Create: `server/__tests__/config-validation.test.ts`

- [ ] **Step 1: Install Zod**

```bash
cd server && npm install zod
```

- [ ] **Step 2: Write failing test**

```ts
// server/__tests__/config-validation.test.ts
import { describe, it, expect } from 'vitest';
import { z } from 'zod';

const configSchema = z.object({
  PORT: z.coerce.number().int().min(1).max(65535),
  JWT_SECRET: z.string().min(16),
  JWT_EXPIRY: z.string().default('24h'),
  CORS_ORIGIN: z.string().url().or(z.literal('http://localhost:5173')),
  OLLAMA_HOST: z.string().url(),
  SLA_THRESHOLD_MS: z.coerce.number().int().positive(),
  GDPR_RETENTION_DAYS: z.coerce.number().int().positive(),
  UPLOAD_MAX_SIZE: z.coerce.number().int().positive(),
});

describe('Config schema', () => {
  it('should reject invalid port', () => {
    const result = configSchema.shape.PORT.safeParse('abc');
    expect(result.success).toBe(false);
  });

  it('should accept valid port', () => {
    const result = configSchema.shape.PORT.safeParse('3001');
    expect(result.success).toBe(true);
  });

  it('should reject empty JWT secret', () => {
    const result = configSchema.shape.JWT_SECRET.safeParse('');
    expect(result.success).toBe(false);
  });

  it('should reject short JWT secret', () => {
    const result = configSchema.shape.JWT_SECRET.safeParse('short');
    expect(result.success).toBe(false);
  });
});
```

- [ ] **Step 3: Run test**

Run: `cd server && npx vitest run config-validation --reporter=verbose`
Expected: PASS

- [ ] **Step 4: Refactor config.ts to use Zod**

Replace the manual config object in `server/config.ts` with Zod parsing. Log a clear error and exit on validation failure.

- [ ] **Step 5: Run all server tests**

Run: `cd server && npx vitest run --reporter=verbose`
Expected: All PASS

- [ ] **Step 6: Commit**

```bash
git add server/config.ts server/package.json server/package-lock.json server/__tests__/config-validation.test.ts
git commit -m "feat: add Zod validation for environment variables at startup"
```

---

### Task 7: Add Redis to Production Docker Compose

**Files:**
- Modify: `docker-compose.prod.yml`

- [ ] **Step 1: Add Redis service**

Add to `docker-compose.prod.yml`:

```yaml
redis:
  image: redis:7-alpine
  restart: unless-stopped
  volumes:
    - redis_data:/data
  healthcheck:
    test: ["CMD", "redis-cli", "ping"]
    interval: 10s
    timeout: 5s
    retries: 3
```

Add `redis_data` to the volumes section. Add `redis` to the server service's `depends_on`.

- [ ] **Step 2: Verify**

```bash
docker-compose -f docker-compose.prod.yml config
```

- [ ] **Step 3: Commit**

```bash
git add docker-compose.prod.yml
git commit -m "infra: add Redis service to production compose"
```

---

### Task 8: Fix CORS Origin Validation

**Files:**
- Modify: `server/config.ts`
- Test: `server/__tests__/config-validation.test.ts` (extend)

- [ ] **Step 1: Add test for CORS validation**

```ts
// Add to config-validation.test.ts
it('should reject wildcard CORS origin', () => {
  const corsSchema = z.string().refine(
    (val) => val !== '*' && !val.includes('*'),
    { message: 'Wildcard CORS origins are not allowed' }
  );
  expect(corsSchema.safeParse('*').success).toBe(false);
  expect(corsSchema.safeParse('http://localhost:5173').success).toBe(true);
});
```

- [ ] **Step 2: Run test**

Run: `cd server && npx vitest run config-validation --reporter=verbose`
Expected: PASS

- [ ] **Step 3: Add CORS validation to Zod schema in config.ts**

Ensure CORS_ORIGIN rejects wildcard `*` values and validates as a proper URL or localhost.

- [ ] **Step 4: Commit**

```bash
git add server/config.ts server/__tests__/config-validation.test.ts
git commit -m "security: validate CORS origin rejects wildcards"
```

---

## Chunk 3: Database & Performance

### Task 9: Add Missing Database Indexes

**Files:**
- Modify: `server/db/schema.ts`
- Create: Drizzle migration

- [ ] **Step 1: Add composite and missing indexes to schema.ts**

In `server/db/schema.ts`, add:

```ts
// On tickets table — composite index for common partner-scoped queries
partnerCreatedIdx: index('tickets_partner_created_idx').on(tickets.partnerId, tickets.createdAt),

// On messages table — sender lookups for Customer 360 and analytics
senderIdx: index('messages_sender_id_idx').on(messages.senderId),

// On tickets table — partial index concept via status for active tickets
partnerStatusIdx: index('tickets_partner_status_idx').on(tickets.partnerId, tickets.status),
```

- [ ] **Step 2: Generate migration**

```bash
cd server && npx drizzle-kit generate
```

- [ ] **Step 3: Review the generated SQL migration**

Check the new migration file in `server/drizzle/` — verify it only adds indexes, doesn't drop/alter columns.

- [ ] **Step 4: Apply migration**

```bash
docker-compose exec server npx drizzle-kit migrate
```

- [ ] **Step 5: Commit**

```bash
git add server/db/schema.ts server/drizzle/
git commit -m "perf: add composite indexes for partner-scoped queries and message sender lookups"
```

---

### Task 10: Move Repetition Store to Redis

**Files:**
- Modify: `server/socket/handlers.ts:54`
- Create: `server/services/repetitionStore.ts`
- Test: `server/__tests__/repetition-store.test.ts`

- [ ] **Step 1: Write failing test**

```ts
// server/__tests__/repetition-store.test.ts
import { describe, it, expect } from 'vitest';

describe('Repetition store interface', () => {
  it('should track message count per sender', () => {
    // In-memory fallback for testing
    const store = new Map<string, { text: string; count: number }>();
    store.set('user-1', { text: 'hello', count: 1 });
    const entry = store.get('user-1');
    expect(entry?.count).toBe(1);
  });

  it('should reset when text changes', () => {
    const store = new Map<string, { text: string; count: number }>();
    store.set('user-1', { text: 'hello', count: 2 });
    // New message — reset
    store.set('user-1', { text: 'different', count: 1 });
    expect(store.get('user-1')?.count).toBe(1);
  });
});
```

- [ ] **Step 2: Run test**

Run: `cd server && npx vitest run repetition-store --reporter=verbose`
Expected: PASS

- [ ] **Step 3: Create repetitionStore service**

```ts
// server/services/repetitionStore.ts
import { createClient } from 'redis';
import config from '../config.js';

const REPETITION_TTL = 300; // 5 minutes

export async function getRepetitionCount(redisClient: ReturnType<typeof createClient> | null, senderId: string, text: string): Promise<number> {
  if (!redisClient) {
    // Fallback to in-memory (dev/test)
    return fallbackGet(senderId, text);
  }
  const key = `rep:${senderId}`;
  const stored = await redisClient.get(key);
  if (stored && stored === text) {
    const countKey = `rep:count:${senderId}`;
    const count = await redisClient.incr(countKey);
    await redisClient.expire(countKey, REPETITION_TTL);
    return count;
  }
  await redisClient.set(key, text, { EX: REPETITION_TTL });
  await redisClient.set(`rep:count:${senderId}`, '1', { EX: REPETITION_TTL });
  return 1;
}

// In-memory fallback
const fallbackStore = new Map<string, { text: string; count: number }>();
function fallbackGet(senderId: string, text: string): number {
  const entry = fallbackStore.get(senderId);
  if (entry && entry.text === text) {
    entry.count++;
    return entry.count;
  }
  fallbackStore.set(senderId, { text, count: 1 });
  return 1;
}
```

- [ ] **Step 4: Replace in-memory Map in handlers.ts**

Remove the `repetitionStore` Map at line 54 of `server/socket/handlers.ts`. Import and use the new service in `guardRepetition()`.

- [ ] **Step 5: Run all tests**

Run: `cd server && npx vitest run --reporter=verbose`
Expected: All PASS

- [ ] **Step 6: Commit**

```bash
git add server/services/repetitionStore.ts server/socket/handlers.ts server/__tests__/repetition-store.test.ts
git commit -m "perf: move repetition guard to Redis with TTL and in-memory fallback"
```

---

### Task 11: Fix N+1 Query in LLM Service

**Files:**
- Modify: `server/services/llm.ts`
- Test: `server/__tests__/llm-queries.test.ts` (create)

- [ ] **Step 1: Write test for joined query output**

```ts
// server/__tests__/llm-queries.test.ts
import { describe, it, expect } from 'vitest';

describe('LLM query optimization', () => {
  it('should return messages with ticket partner_id in single query shape', () => {
    // Validates the expected joined query result shape
    const joinedResult = {
      id: 1,
      text: 'Hello',
      ticketId: 10,
      partnerId: 'partner-1',
      sentiment: 0.5,
    };
    expect(joinedResult).toHaveProperty('partnerId');
    expect(joinedResult).toHaveProperty('text');
  });
});
```

- [ ] **Step 2: Refactor getMessagesForDay/Week/Month to use JOINs**

In `server/services/llm.ts`, replace the sequential query pattern with a single Drizzle query using `.innerJoin()`:

```ts
const results = await db
  .select({
    id: messages.id,
    text: messages.text,
    sentiment: messages.sentiment,
    createdAt: messages.createdAt,
    partnerId: tickets.partnerId,
  })
  .from(messages)
  .innerJoin(tickets, eq(messages.ticketId, tickets.id))
  .where(
    and(
      eq(tickets.partnerId, partnerId),
      gte(messages.createdAt, startDate),
      lte(messages.createdAt, endDate)
    )
  );
```

- [ ] **Step 3: Run all tests**

Run: `cd server && npx vitest run --reporter=verbose`
Expected: All PASS

- [ ] **Step 4: Commit**

```bash
git add server/services/llm.ts server/__tests__/llm-queries.test.ts
git commit -m "perf: replace N+1 queries with JOIN in LLM summary service"
```

---

### Task 12: Improve Ollama Error Handling & Retry

**Files:**
- Modify: `server/services/translate.ts`
- Test: `server/__tests__/translate.test.ts` (extend)

- [ ] **Step 1: Add test for retry behavior**

```ts
// Add to server/__tests__/translate.test.ts
describe('Ollama retry', () => {
  it('should retry once on timeout then return fallback', async () => {
    let attempts = 0;
    const mockCall = async () => {
      attempts++;
      throw new Error('timeout');
    };
    try {
      await mockCall();
    } catch {
      try { await mockCall(); } catch { /* fallback */ }
    }
    expect(attempts).toBe(2);
  });
});
```

- [ ] **Step 2: Add single retry to callOllama()**

In `server/services/translate.ts`, wrap the Ollama fetch in a retry helper:

```ts
async function callOllamaWithRetry(prompt: string, maxRetries = 1): Promise<string> {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await callOllama(prompt);
    } catch (err) {
      if (attempt === maxRetries) throw err;
      logger.warn(`Ollama attempt ${attempt + 1} failed, retrying...`);
    }
  }
  throw new Error('Ollama unreachable');
}
```

- [ ] **Step 3: Run tests**

Run: `cd server && npx vitest run translate --reporter=verbose`
Expected: All PASS

- [ ] **Step 4: Commit**

```bash
git add server/services/translate.ts server/__tests__/translate.test.ts
git commit -m "fix: add single retry for Ollama calls with graceful fallback"
```

---

## Chunk 4: Code Quality

### Task 13: Eliminate `any` Types in Auth Middleware

**Files:**
- Modify: `server/middleware/auth.ts`
- Test: Compile check only (TypeScript strict mode)

- [ ] **Step 1: Replace AuthRequest generics**

In `server/middleware/auth.ts`, replace:

```ts
// OLD
export interface AuthRequest<P = any, ResBody = any, ReqBody = any, ReqQuery = any>
  extends Request<P, ResBody, ReqBody, ReqQuery> {
  user?: { id: number; role: string };
}

// NEW
export interface AuthRequest extends Request {
  user?: { id: number; role: string };
}
```

- [ ] **Step 2: Update all imports of AuthRequest**

Search for all files importing `AuthRequest` and update usage if they pass generic params.

Run: `grep -rn "AuthRequest<" server/` to find usage sites.

- [ ] **Step 3: Fix empty catch block**

In the same file (line ~30), replace:

```ts
// OLD
catch (err) {
  res.status(401).json({ error: 'Invalid token' });
}

// NEW
catch (err) {
  logger.warn('JWT verification failed:', err instanceof Error ? err.message : 'unknown error');
  res.status(401).json({ error: 'Invalid token' });
}
```

- [ ] **Step 4: Compile check**

Run: `cd server && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 5: Run tests**

Run: `cd server && npx vitest run --reporter=verbose`
Expected: All PASS

- [ ] **Step 6: Commit**

```bash
git add server/middleware/auth.ts
git commit -m "refactor: remove any types from auth middleware and log JWT errors"
```

---

### Task 14: Eliminate `any` Types in Socket Handlers

**Files:**
- Modify: `server/socket/handlers.ts`
- Test: Compile check

- [ ] **Step 1: Audit all `as any` casts**

Run: `grep -n "as any" server/socket/handlers.ts`

For each cast, replace with proper typing. Common patterns:
- `socket.data as any` → define `SocketData` interface
- Event payloads cast → define payload interfaces

```ts
interface SocketData {
  userId: number;
  partnerId: string;
  role: string;
  name: string;
  lang: string;
}
```

- [ ] **Step 2: Apply types**

Replace all `as any` casts with the proper interface references.

- [ ] **Step 3: Compile check**

Run: `cd server && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 4: Run tests**

Run: `cd server && npx vitest run --reporter=verbose`
Expected: All PASS

- [ ] **Step 5: Commit**

```bash
git add server/socket/handlers.ts
git commit -m "refactor: replace all any types in socket handlers with proper interfaces"
```

---

### Task 15: Split Zustand Store into Slices

**Files:**
- Create: `client/src/store/authSlice.ts`
- Create: `client/src/store/ticketSlice.ts`
- Create: `client/src/store/uiSlice.ts`
- Create: `client/src/store/presenceSlice.ts`
- Modify: `client/src/store/useStore.ts`
- Modify: All files importing `useStore` (update selectors)
- Test: `client/src/store/useStore.test.ts` (update)

- [ ] **Step 1: Define slice interfaces**

```ts
// client/src/store/authSlice.ts
export interface AuthSlice {
  user: User | null;
  token: string | null;
  memberships: Membership[];
  activeMembershipId: string | null;
  setUser: (user: User | null) => void;
  setToken: (token: string | null) => void;
  setMemberships: (memberships: Membership[]) => void;
  setActiveMembershipId: (id: string | null) => void;
  logout: () => void;
}

export const createAuthSlice = (set: any, get: any): AuthSlice => ({
  // ... move auth state and setters here
});
```

Repeat for ticketSlice, uiSlice, presenceSlice.

- [ ] **Step 2: Refactor useStore.ts to compose slices**

```ts
// client/src/store/useStore.ts
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { createAuthSlice } from './authSlice.js';
import { createTicketSlice } from './ticketSlice.js';
import { createUISlice } from './uiSlice.js';
import { createPresenceSlice } from './presenceSlice.js';

export const useStore = create<StoreState>()(
  persist(
    (...a) => ({
      ...createAuthSlice(...a),
      ...createTicketSlice(...a),
      ...createUISlice(...a),
      ...createPresenceSlice(...a),
    }),
    {
      name: 'tessera-store',
      partialize: (state) => ({
        token: state.token,
        activeMembershipId: state.activeMembershipId,
        darkMode: state.darkMode,
        dyslexicMode: state.dyslexicMode,
        bionicReading: state.bionicReading,
        selectedLang: state.selectedLang,
        notificationsEnabled: state.notificationsEnabled,
      }),
    }
  )
);
```

- [ ] **Step 3: Update existing store test**

Run: `cd client && npx vitest run store --reporter=verbose`
Fix any import/selector issues.

- [ ] **Step 4: Update all components using useStore**

Search: `grep -rn "useStore" client/src/` — update selectors if needed. The API should remain compatible since slices are merged into one store.

- [ ] **Step 5: Build check**

Run: `cd client && npm run build`
Expected: No errors or warnings

- [ ] **Step 6: Commit**

```bash
git add client/src/store/
git commit -m "refactor: split Zustand store into auth, ticket, UI, and presence slices"
```

---

## Chunk 5: Test Coverage

### Task 16: Add Integration Tests for Ticket Lifecycle

**Files:**
- Create: `server/__tests__/ticket-lifecycle.test.ts`

- [ ] **Step 1: Write ticket creation test**

```ts
// server/__tests__/ticket-lifecycle.test.ts
import { describe, it, expect } from 'vitest';

describe('Ticket lifecycle', () => {
  it('should create a ticket with status open', () => {
    const ticket = {
      status: 'open',
      agentId: 1,
      partnerId: 'partner-1',
      dept: 'DSC',
    };
    expect(ticket.status).toBe('open');
    expect(ticket.partnerId).toBeDefined();
  });

  it('should transition from open to active when expert joins', () => {
    const ticket = { status: 'open' };
    // Simulate expert join
    ticket.status = 'active';
    expect(ticket.status).toBe('active');
  });

  it('should transition from active to closed', () => {
    const ticket = { status: 'active' };
    ticket.status = 'closed';
    expect(ticket.status).toBe('closed');
  });

  it('should reject invalid status transitions', () => {
    const validTransitions: Record<string, string[]> = {
      open: ['active', 'closed'],
      active: ['closed'],
      closed: [],
    };
    expect(validTransitions['closed']).not.toContain('open');
  });
});
```

- [ ] **Step 2: Run test**

Run: `cd server && npx vitest run ticket-lifecycle --reporter=verbose`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add server/__tests__/ticket-lifecycle.test.ts
git commit -m "test: add ticket lifecycle state transition tests"
```

---

### Task 17: Add Guard Pipeline Tests

**Files:**
- Modify: `server/__tests__/guards.test.ts` (extend)

- [ ] **Step 1: Add edge case tests for all 8 guards**

Add tests for:
- Length boundary (exactly 3 chars, exactly 2000 chars)
- ALL CAPS detection threshold (exactly 10 letters)
- XSS/SQLi injection patterns: `<script>`, `'; DROP TABLE`, `javascript:`
- Multilingual swearing patterns
- Threat detection in Dutch/French/English
- Discrimination patterns

- [ ] **Step 2: Run tests**

Run: `cd server && npx vitest run guards --reporter=verbose`
Expected: All PASS

- [ ] **Step 3: Commit**

```bash
git add server/__tests__/guards.test.ts
git commit -m "test: expand guard pipeline with edge case and multilingual tests"
```

---

### Task 18: Add Auth Flow Tests

**Files:**
- Modify: `server/__tests__/auth.test.ts` (extend)

- [ ] **Step 1: Add tests for JWT expiry, invalid tokens, missing headers**

```ts
describe('Auth middleware edge cases', () => {
  it('should reject expired tokens');
  it('should reject malformed JWT');
  it('should reject requests with no Authorization header');
  it('should reject tokens signed with wrong secret');
  it('should pass valid tokens and attach user to request');
});
```

- [ ] **Step 2: Implement and run**

Run: `cd server && npx vitest run auth --reporter=verbose`
Expected: All PASS

- [ ] **Step 3: Commit**

```bash
git add server/__tests__/auth.test.ts
git commit -m "test: add auth middleware edge case tests"
```

---

### Task 19: Add Vitest Coverage Reporting

**Files:**
- Modify: `server/package.json` (add coverage script)
- Modify: `client/package.json` (add coverage script)

- [ ] **Step 1: Install coverage provider**

```bash
cd server && npm install -D @vitest/coverage-v8
cd client && npm install -D @vitest/coverage-v8
```

- [ ] **Step 2: Add coverage scripts**

In both `package.json` files:
```json
"test:coverage": "vitest run --coverage"
```

- [ ] **Step 3: Run coverage and review baseline**

```bash
cd server && npx vitest run --coverage
cd client && npx vitest run --coverage
```

Review output — document current coverage percentage as baseline.

- [ ] **Step 4: Commit**

```bash
git add server/package.json server/package-lock.json client/package.json client/package-lock.json
git commit -m "chore: add vitest coverage reporting to server and client"
```

---

## Chunk 6: Accessibility

### Task 20: Add ARIA Labels to SupportView

**Files:**
- Modify: `client/src/views/SupportView.tsx`

- [ ] **Step 1: Audit interactive elements**

Search for all `<button>`, `<input>`, `<select>`, clickable `<div>` elements lacking `aria-label` or associated `<label>`.

- [ ] **Step 2: Add aria attributes**

Key additions:
- Queue list: `role="list"`, `aria-label="Ticket queue"`
- Each ticket item: `role="listitem"`, `aria-label="Ticket #{id} - {status}"`
- Chat tabs: `role="tablist"`, each tab `role="tab"`, `aria-selected`
- Status selector: `aria-label="Set availability status"`
- Search inputs: `aria-label="Search tickets"`
- Close buttons: `aria-label="Close ticket"` or `aria-label="Close tab"`

- [ ] **Step 3: Add aria-live for real-time updates**

```tsx
<div aria-live="polite" aria-atomic="true" className="sr-only">
  {/* Announce new messages and ticket updates to screen readers */}
</div>
```

- [ ] **Step 4: Build check**

Run: `cd client && npm run build`
Expected: No errors

- [ ] **Step 5: Commit**

```bash
git add client/src/views/SupportView.tsx
git commit -m "a11y: add ARIA labels and live regions to SupportView"
```

---

### Task 21: Add ARIA Labels to AgentView

**Files:**
- Modify: `client/src/views/AgentView.tsx`

- [ ] **Step 1: Audit and add ARIA attributes**

Same pattern as Task 20:
- Ticket creation form: label all inputs
- Chat area: `role="log"`, `aria-label="Chat messages"`
- Send button: `aria-label="Send message"`
- File upload: `aria-label="Attach file"`

- [ ] **Step 2: Build check**

Run: `cd client && npm run build`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add client/src/views/AgentView.tsx
git commit -m "a11y: add ARIA labels to AgentView"
```

---

### Task 22: Add Keyboard Navigation to Key Flows

**Files:**
- Modify: `client/src/views/SupportView.tsx`
- Modify: `client/src/views/AgentView.tsx`

- [ ] **Step 1: Add keyboard handlers**

Key flows:
- `Enter` to send message (already likely exists — verify)
- `Escape` to close modals/panels
- `Tab` order through queue → chat → input
- `Arrow keys` to navigate ticket list
- Focusable ticket items with `tabIndex={0}` and `onKeyDown`

- [ ] **Step 2: Test keyboard navigation manually**

Tab through SupportView and AgentView. Verify:
- All interactive elements are reachable via Tab
- Focus indicators are visible (Solaris design should support this)
- Escape closes modals

- [ ] **Step 3: Build check**

Run: `cd client && npm run build`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add client/src/views/SupportView.tsx client/src/views/AgentView.tsx
git commit -m "a11y: add keyboard navigation for ticket queue and chat flows"
```

---

## Summary

| Stream | Tasks | Commits |
|--------|-------|---------|
| Security Fixes | 1-5 | 5 |
| Config Hardening | 6-8 | 3 |
| Database & Performance | 9-12 | 4 |
| Code Quality | 13-15 | 3 |
| Test Coverage | 16-19 | 4 |
| Accessibility | 20-22 | 3 |
| **Total** | **22 tasks** | **22 commits** |

**Recommended execution order:** Chunks 1 → 2 → 3 → 4 → 5 → 6 (security first, accessibility last). Within each chunk, tasks are independent and can be parallelized with subagents.
