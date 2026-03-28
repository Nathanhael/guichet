# Critical Security Fixes — Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix 8 critical security vulnerabilities identified in the 2026-03-28 codebase review.

**Architecture:** Each fix is isolated to 1-3 files with a matching test. Fixes are ordered from smallest/safest to largest/most complex. Schema changes generate Drizzle migrations.

**Tech Stack:** TypeScript, Drizzle ORM, PostgreSQL 18, Vitest, Socket.io, React 19, tRPC 11

**Important:** All commands must run through Docker. Never run `npm`/`node`/`npx` on the host.

---

## Task 1: Replace `sql.raw()` with parameterized interval in lockout

**Files:**
- Modify: `server/services/accountLockout.ts` (line 46)
- Test: `server/__tests__/services/accountLockout.test.ts`

- [ ] **Step 1: Write the failing test**

Create `server/__tests__/services/accountLockout.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

// We need to verify that sql.raw is NOT used in the lockout query.
// Import the module source and check for sql.raw usage pattern.
import { readFileSync } from 'fs';
import { join } from 'path';

describe('accountLockout', () => {
  it('does not use sql.raw() in any query', () => {
    const source = readFileSync(
      join(__dirname, '../../services/accountLockout.ts'),
      'utf-8'
    );
    expect(source).not.toContain('sql.raw');
  });

  it('uses parameterized interval for lockout duration', () => {
    const source = readFileSync(
      join(__dirname, '../../services/accountLockout.ts'),
      'utf-8'
    );
    // Should use multiplication with INTERVAL '1 minute' pattern
    expect(source).toMatch(/INTERVAL\s+'1 minute/i);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `docker compose exec server npx vitest run __tests__/services/accountLockout.test.ts`
Expected: FAIL — source still contains `sql.raw`

- [ ] **Step 3: Fix the sql.raw usage**

In `server/services/accountLockout.ts`, find line 46 containing:

```ts
THEN (NOW() + INTERVAL '${sql.raw(String(LOCKOUT_MINUTES))} minutes')::text
```

Replace with:

```ts
THEN (NOW() + (${LOCKOUT_MINUTES} * INTERVAL '1 minute'))::text
```

This keeps LOCKOUT_MINUTES as a Drizzle parameter (safe) instead of raw SQL interpolation.

- [ ] **Step 4: Run test to verify it passes**

Run: `docker compose exec server npx vitest run __tests__/services/accountLockout.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add server/services/accountLockout.ts server/__tests__/services/accountLockout.test.ts
git commit -m "fix(security): replace sql.raw with parameterized interval in lockout query"
```

---

## Task 2: Hash TOTP token before using as Redis key

**Files:**
- Modify: `server/services/platformStepUp.ts` (lines ~121, 139)
- Test: `server/__tests__/services/platformStepUp.test.ts`

- [ ] **Step 1: Write the failing test**

Create `server/__tests__/services/platformStepUp.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

describe('platformStepUp', () => {
  it('does not embed raw TOTP tokens in Redis keys', () => {
    const source = readFileSync(
      join(__dirname, '../../services/platformStepUp.ts'),
      'utf-8'
    );
    // Should NOT have pattern: `totp:used:${userId}:${token}`
    // where token is the raw input parameter
    const rawKeyPattern = /`totp:used:\$\{userId\}:\$\{token\}`/;
    expect(source).not.toMatch(rawKeyPattern);
  });

  it('hashes the token before constructing the Redis key', () => {
    const source = readFileSync(
      join(__dirname, '../../services/platformStepUp.ts'),
      'utf-8'
    );
    expect(source).toContain("createHash('sha256')");
    expect(source).toContain(".update(token)");
    expect(source).toContain(".digest('hex')");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `docker compose exec server npx vitest run __tests__/services/platformStepUp.test.ts`
Expected: FAIL — raw token pattern still found

- [ ] **Step 3: Add crypto import and hash the token**

In `server/services/platformStepUp.ts`, add to the imports at top of file:

```ts
import { createHash } from 'crypto';
```

Then find both occurrences of:

```ts
const key = `totp:used:${userId}:${token}`;
```

Replace each with:

```ts
const hashedToken = createHash('sha256').update(token).digest('hex');
const key = `totp:used:${userId}:${hashedToken}`;
```

This applies to both `markTokenUsed` and `isTokenUsed` functions.

- [ ] **Step 4: Run test to verify it passes**

Run: `docker compose exec server npx vitest run __tests__/services/platformStepUp.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add server/services/platformStepUp.ts server/__tests__/services/platformStepUp.test.ts
git commit -m "fix(security): hash TOTP token before using as Redis key"
```

---

## Task 3: Return generic error messages for INTERNAL_SERVER_ERROR

**Files:**
- Modify: `server/trpc/routers/feedback.ts` (lines ~72-76)
- Modify: `server/trpc/routers/rating.ts` (lines ~63-65, ~116-118, ~260-263)
- Test: `server/__tests__/trpc/routers/errorLeak.test.ts`

- [ ] **Step 1: Write the failing test**

Create `server/__tests__/trpc/routers/errorLeak.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const GENERIC_MSG = 'An unexpected error occurred';

describe('error message leak prevention', () => {
  const files = [
    { name: 'feedback.ts', path: '../../trpc/routers/feedback.ts' },
    { name: 'rating.ts', path: '../../trpc/routers/rating.ts' },
  ];

  for (const file of files) {
    describe(file.name, () => {
      it('does not pass errMsg() directly to INTERNAL_SERVER_ERROR TRPCError', () => {
        const source = readFileSync(join(__dirname, file.path), 'utf-8');
        // Should NOT have: throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: errMsg(err) })
        // or: throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message })  where message = errMsg(err)
        const lines = source.split('\n');
        for (let i = 0; i < lines.length; i++) {
          if (lines[i].includes("'INTERNAL_SERVER_ERROR'")) {
            // The TRPCError for INTERNAL_SERVER_ERROR should use the generic message
            const context = lines.slice(Math.max(0, i - 2), i + 3).join('\n');
            expect(context).toContain(GENERIC_MSG);
          }
        }
      });
    });
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `docker compose exec server npx vitest run __tests__/trpc/routers/errorLeak.test.ts`
Expected: FAIL — current code passes errMsg() to client

- [ ] **Step 3: Fix feedback.ts error handling**

In `server/trpc/routers/feedback.ts`, find the catch block (~line 72):

```ts
} catch (err: unknown) {
  const message = errMsg(err);
  logger.error({ err: message }, 'tRPC: Error creating feedback');
  throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message });
}
```

Replace with:

```ts
} catch (err: unknown) {
  logger.error({ err: errMsg(err) }, 'tRPC: Error creating feedback');
  throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'An unexpected error occurred' });
}
```

- [ ] **Step 4: Fix rating.ts error handling**

In `server/trpc/routers/rating.ts`, find each catch block that throws `INTERNAL_SERVER_ERROR` (there are ~3 occurrences). For each one, apply the same pattern:

```ts
// BEFORE (each occurrence):
} catch (err: unknown) {
  const message = errMsg(err);
  logger.error({ err: message }, 'tRPC: Error ...');
  throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message });
}

// AFTER (each occurrence):
} catch (err: unknown) {
  logger.error({ err: errMsg(err) }, 'tRPC: Error ...');
  throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'An unexpected error occurred' });
}
```

Keep the logger message descriptive (each has a different context string). Only change the TRPCError message.

- [ ] **Step 5: Run test to verify it passes**

Run: `docker compose exec server npx vitest run __tests__/trpc/routers/errorLeak.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add server/trpc/routers/feedback.ts server/trpc/routers/rating.ts server/__tests__/trpc/routers/errorLeak.test.ts
git commit -m "fix(security): return generic error messages for INTERNAL_SERVER_ERROR"
```

---

## Task 4: Add UNIQUE constraint on ratings.ticket_id and use ON CONFLICT

**Files:**
- Modify: `server/db/schema.ts` (ratings table, ~line 148)
- Modify: `server/socket/handlers.ts` (rating:submit handler, ~line 630)
- Migration: generated via `drizzle-kit generate`
- Test: `server/__tests__/socket/ratingRace.test.ts`

- [ ] **Step 1: Write the failing test**

Create `server/__tests__/socket/ratingRace.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

describe('rating:submit race condition fix', () => {
  it('schema has unique constraint on ratings.ticket_id', () => {
    const source = readFileSync(
      join(__dirname, '../../db/schema.ts'),
      'utf-8'
    );
    // Should have a unique index on ticketId in the ratings table
    expect(source).toMatch(/uniqueTicket.*ticketId|unique.*ticket_id/i);
  });

  it('handler uses ON CONFLICT instead of SELECT-then-INSERT', () => {
    const source = readFileSync(
      join(__dirname, '../../socket/handlers.ts'),
      'utf-8'
    );
    // The rating insert should use ON CONFLICT
    expect(source).toMatch(/ON CONFLICT.*ticket_id.*DO NOTHING/i);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `docker compose exec server npx vitest run __tests__/socket/ratingRace.test.ts`
Expected: FAIL — no unique constraint, no ON CONFLICT

- [ ] **Step 3: Add unique index to schema**

In `server/db/schema.ts`, find the ratings table definition. Add a unique index. The table currently has indexes defined like:

```ts
export const ratings = pgTable('ratings', {
  id: text('id').primaryKey(),
  ticketId: text('ticket_id').notNull().references(() => tickets.id, { onDelete: 'cascade' }),
  // ... other columns
}, (table) => ({
  ticketIdx: index('idx_ratings_ticket').on(table.ticketId),
  supportIdx: index('idx_ratings_support').on(table.supportId),
  createdAtIdx: index('idx_ratings_created_at').on(table.createdAt),
}));
```

Change `ticketIdx` from a regular index to a unique index:

```ts
}, (table) => ({
  uniqueTicketIdx: uniqueIndex('idx_ratings_ticket_unique').on(table.ticketId),
  supportIdx: index('idx_ratings_support').on(table.supportId),
  createdAtIdx: index('idx_ratings_created_at').on(table.createdAt),
}));
```

Make sure `uniqueIndex` is imported from `drizzle-orm/pg-core` at the top of the file. Check if it's already imported — if not, add it to the existing import line:

```ts
import { pgTable, text, integer, timestamp, jsonb, index, uniqueIndex, pgEnum, boolean } from 'drizzle-orm/pg-core';
```

- [ ] **Step 4: Generate the migration**

Run: `docker compose exec server npx drizzle-kit generate`
Expected: A new migration file in `server/drizzle/` that creates the unique index.

- [ ] **Step 5: Apply the migration**

Run: `docker compose exec server npm run db:migrate`
Expected: Migration applies successfully.

- [ ] **Step 6: Update the socket handler to use ON CONFLICT**

In `server/socket/handlers.ts`, find the rating:submit handler (~line 630). Replace the check-then-insert pattern:

```ts
// BEFORE:
const existing = await get('SELECT id FROM ratings WHERE ticket_id = $1', [ticketId]);
if (existing) {
  return;
}
// ... build values ...
await run('INSERT INTO ratings (id, ticket_id, agent_id, support_id, rating, comment, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7)', [...]);
```

With an atomic ON CONFLICT:

```ts
// AFTER:
const result = await run(
  `INSERT INTO ratings (id, ticket_id, agent_id, support_id, rating, comment, created_at)
   VALUES ($1, $2, $3, $4, $5, $6, $7)
   ON CONFLICT (ticket_id) DO NOTHING`,
  [id, ticketId, socket.data.userId, supportId, rating, comment, new Date().toISOString()]
);
// If result.rowCount === 0, the rating already existed (duplicate submission)
```

Remove the `SELECT ... existing` check entirely — the ON CONFLICT handles it atomically.

- [ ] **Step 7: Run test to verify it passes**

Run: `docker compose exec server npx vitest run __tests__/socket/ratingRace.test.ts`
Expected: PASS

- [ ] **Step 8: Commit**

```bash
git add server/db/schema.ts server/socket/handlers.ts server/__tests__/socket/ratingRace.test.ts server/drizzle/
git commit -m "fix(security): add unique constraint on ratings.ticket_id to prevent race condition"
```

---

## Task 5: Add pagination to `user.list`

**Files:**
- Modify: `server/trpc/routers/user.ts` (user.list procedure, ~line 10)
- Test: `server/__tests__/trpc/routers/userList.test.ts`

- [ ] **Step 1: Write the failing test**

Create `server/__tests__/trpc/routers/userList.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

describe('user.list pagination', () => {
  it('query includes LIMIT clause', () => {
    const source = readFileSync(
      join(__dirname, '../../trpc/routers/user.ts'),
      'utf-8'
    );
    // The user.list SQL should enforce a LIMIT
    expect(source.toLowerCase()).toMatch(/limit\s+\$/);
  });

  it('input schema accepts limit and offset params', () => {
    const source = readFileSync(
      join(__dirname, '../../trpc/routers/user.ts'),
      'utf-8'
    );
    expect(source).toContain('limit:');
    expect(source).toContain('offset:');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `docker compose exec server npx vitest run __tests__/trpc/routers/userList.test.ts`
Expected: FAIL — no LIMIT in current query

- [ ] **Step 3: Add pagination to user.list**

In `server/trpc/routers/user.ts`, find the `list` procedure. Update the input schema and query:

```ts
// BEFORE:
list: platformProcedure
  .query(async () => {
    const { rows } = await query(`
      SELECT id, name, lang, is_platform_operator,
        (SELECT json_agg(DISTINCT role) FROM memberships WHERE user_id = users.id) as roles
      FROM users
      WHERE deleted_at IS NULL
      ORDER BY is_platform_operator DESC, name ASC
    `);
    return rows;
  }),

// AFTER:
list: platformProcedure
  .input(z.object({
    limit: z.number().int().min(1).max(500).default(100),
    offset: z.number().int().min(0).default(0),
  }).default({}))
  .query(async ({ input }) => {
    const { rows: users } = await query(`
      SELECT id, name, lang, is_platform_operator,
        (SELECT json_agg(DISTINCT role) FROM memberships WHERE user_id = users.id) as roles
      FROM users
      WHERE deleted_at IS NULL
      ORDER BY is_platform_operator DESC, name ASC
      LIMIT $1 OFFSET $2
    `, [input.limit, input.offset]);

    const { rows: countRows } = await query(`
      SELECT COUNT(*)::int as total FROM users WHERE deleted_at IS NULL
    `);

    return { users, total: countRows[0]?.total ?? 0 };
  }),
```

Make sure `z` is imported from `zod` at the top of the file (it should already be).

- [ ] **Step 4: Run test to verify it passes**

Run: `docker compose exec server npx vitest run __tests__/trpc/routers/userList.test.ts`
Expected: PASS

- [ ] **Step 5: Run full server tests to check for breakage**

Run: `docker compose exec server npm test`
Expected: All existing tests pass. The `.default({})` on input ensures backward compatibility — callers that pass no input get the defaults.

- [ ] **Step 6: Commit**

```bash
git add server/trpc/routers/user.ts server/__tests__/trpc/routers/userList.test.ts
git commit -m "fix(security): add pagination to user.list to prevent unbounded query"
```

---

## Task 6: Validate AI provider baseUrl against SSRF

**Files:**
- Create: `server/services/ai/validateUrl.ts`
- Modify: `server/services/ai/factory.ts` (~line 109)
- Test: `server/__tests__/services/ai/validateUrl.test.ts`

- [ ] **Step 1: Write the failing test**

Create `server/__tests__/services/ai/validateUrl.test.ts`:

```ts
import { describe, it, expect } from 'vitest';

// Will import after implementation
// import { validateAiBaseUrl } from '../../../services/ai/validateUrl';

describe('validateAiBaseUrl', () => {
  // These tests document expected behavior. They will fail until the function exists.

  it('rejects http:// in production', async () => {
    const { validateAiBaseUrl } = await import('../../../services/ai/validateUrl');
    expect(() => validateAiBaseUrl('http://example.com', false)).toThrow('HTTPS required');
  });

  it('allows http:// in development', async () => {
    const { validateAiBaseUrl } = await import('../../../services/ai/validateUrl');
    expect(() => validateAiBaseUrl('http://example.com', true)).not.toThrow();
  });

  it('rejects localhost', async () => {
    const { validateAiBaseUrl } = await import('../../../services/ai/validateUrl');
    expect(() => validateAiBaseUrl('https://localhost/api', false)).toThrow('private');
  });

  it('rejects 127.0.0.1', async () => {
    const { validateAiBaseUrl } = await import('../../../services/ai/validateUrl');
    expect(() => validateAiBaseUrl('https://127.0.0.1/api', false)).toThrow('private');
  });

  it('rejects 10.x.x.x', async () => {
    const { validateAiBaseUrl } = await import('../../../services/ai/validateUrl');
    expect(() => validateAiBaseUrl('https://10.0.0.5:8080/v1', false)).toThrow('private');
  });

  it('rejects 172.16.x.x', async () => {
    const { validateAiBaseUrl } = await import('../../../services/ai/validateUrl');
    expect(() => validateAiBaseUrl('https://172.16.0.1/v1', false)).toThrow('private');
  });

  it('rejects 192.168.x.x', async () => {
    const { validateAiBaseUrl } = await import('../../../services/ai/validateUrl');
    expect(() => validateAiBaseUrl('https://192.168.1.1/v1', false)).toThrow('private');
  });

  it('rejects 169.254.x.x (AWS metadata)', async () => {
    const { validateAiBaseUrl } = await import('../../../services/ai/validateUrl');
    expect(() => validateAiBaseUrl('https://169.254.169.254/latest', false)).toThrow('private');
  });

  it('rejects 0.0.0.0', async () => {
    const { validateAiBaseUrl } = await import('../../../services/ai/validateUrl');
    expect(() => validateAiBaseUrl('https://0.0.0.0/api', false)).toThrow('private');
  });

  it('allows valid public HTTPS URL', async () => {
    const { validateAiBaseUrl } = await import('../../../services/ai/validateUrl');
    expect(() => validateAiBaseUrl('https://api.openai.com/v1', false)).not.toThrow();
  });

  it('allows undefined (uses default)', async () => {
    const { validateAiBaseUrl } = await import('../../../services/ai/validateUrl');
    expect(() => validateAiBaseUrl(undefined, false)).not.toThrow();
  });

  it('rejects invalid URLs', async () => {
    const { validateAiBaseUrl } = await import('../../../services/ai/validateUrl');
    expect(() => validateAiBaseUrl('not-a-url', false)).toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `docker compose exec server npx vitest run __tests__/services/ai/validateUrl.test.ts`
Expected: FAIL — module does not exist

- [ ] **Step 3: Create the validation function**

Create `server/services/ai/validateUrl.ts`:

```ts
/**
 * Validates AI provider base URLs to prevent SSRF attacks.
 * Rejects private IP ranges, loopback, link-local, and metadata endpoints.
 */
export function validateAiBaseUrl(url: string | undefined, isDev: boolean): void {
  if (!url) return; // undefined means "use default" — safe

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`Invalid AI base URL: ${url}`);
  }

  // Enforce HTTPS in production
  if (!isDev && parsed.protocol !== 'https:') {
    throw new Error(`HTTPS required for AI base URL in production (got ${parsed.protocol})`);
  }

  // Check hostname against private/reserved ranges
  const hostname = parsed.hostname.toLowerCase();

  // Loopback
  if (hostname === 'localhost' || hostname === '::1') {
    throw new Error(`AI base URL must not point to a private or reserved address: ${hostname}`);
  }

  // IP address checks
  const ipv4Match = hostname.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (ipv4Match) {
    const [, a, b, c, d] = ipv4Match.map(Number);
    const isPrivate =
      a === 0 ||                              // 0.0.0.0/8
      a === 10 ||                             // 10.0.0.0/8
      a === 127 ||                            // 127.0.0.0/8
      (a === 172 && b >= 16 && b <= 31) ||    // 172.16.0.0/12
      (a === 192 && b === 168) ||             // 192.168.0.0/16
      (a === 169 && b === 254);               // 169.254.0.0/16 (link-local / AWS IMDS)

    if (isPrivate) {
      throw new Error(`AI base URL must not point to a private or reserved address: ${hostname}`);
    }
  }
}
```

- [ ] **Step 4: Wire the validation into factory.ts**

In `server/services/ai/factory.ts`, add the import at the top:

```ts
import { validateAiBaseUrl } from './validateUrl';
import { config } from '../../config';
```

Then find where `buildProvider` is called with `aiConfig.baseUrl` (~line 109). Add validation before the call:

```ts
// Add before buildProvider call:
const isDev = config.NODE_ENV === 'development';
validateAiBaseUrl(aiConfig.baseUrl as string | undefined, isDev);
```

- [ ] **Step 5: Run test to verify it passes**

Run: `docker compose exec server npx vitest run __tests__/services/ai/validateUrl.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add server/services/ai/validateUrl.ts server/services/ai/factory.ts server/__tests__/services/ai/validateUrl.test.ts
git commit -m "fix(security): validate AI base URL to prevent SSRF attacks"
```

---

## Task 7: Fix GDPR purge guard to check unarchived tickets

**Files:**
- Modify: `server/services/gdpr.ts` (~lines 33-40)
- Test: `server/__tests__/services/gdprGuard.test.ts`

- [ ] **Step 1: Write the failing test**

Create `server/__tests__/services/gdprGuard.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

describe('GDPR purge guard', () => {
  it('checks for unarchived tickets instead of relying on archiveTickets return value', () => {
    const source = readFileSync(
      join(__dirname, '../../services/gdpr.ts'),
      'utf-8'
    );
    // The old pattern: `if (ticketsArchived === 0` should be replaced
    expect(source).not.toMatch(/ticketsArchived\s*===\s*0/);
  });

  it('queries for tickets not yet in archived_tickets', () => {
    const source = readFileSync(
      join(__dirname, '../../services/gdpr.ts'),
      'utf-8'
    );
    // Should check for unarchived tickets via NOT EXISTS or LEFT JOIN
    expect(source).toMatch(/NOT EXISTS.*archived_tickets|LEFT JOIN.*archived_tickets.*IS NULL/i);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `docker compose exec server npx vitest run __tests__/services/gdprGuard.test.ts`
Expected: FAIL — old pattern still present

- [ ] **Step 3: Replace the purge guard logic**

In `server/services/gdpr.ts`, find the guard block (~lines 33-40):

```ts
// BEFORE:
if (ticketsArchived === 0 && (closedTicketCount[0]?.count ?? 0) > 0) {
  logger.warn('GDPR purge: no tickets archived but closed tickets exist — skipping purge as safety guard');
  return;
}
```

Replace with:

```ts
// AFTER:
// Check if there are closed tickets that haven't been archived yet
const { rows: unarchived } = await query(
  `SELECT COUNT(*)::int as count FROM tickets t
   WHERE t.created_at < $1 AND t.status = 'closed'
   AND NOT EXISTS (SELECT 1 FROM archived_tickets a WHERE a.id = t.id)`,
  [cutoff.toISOString()]
);
const unarchivedCount = unarchived[0]?.count ?? 0;

if (unarchivedCount > 0) {
  logger.warn({ unarchivedCount }, 'GDPR purge: unarchived closed tickets exist — archiving first');
  // Retry archival for the missed tickets
  await archiveTickets(cutoff);
}
```

This removes the false-positive guard that blocked purges after day 1 and instead re-attempts archival if there are genuinely unarchived tickets.

- [ ] **Step 4: Run test to verify it passes**

Run: `docker compose exec server npx vitest run __tests__/services/gdprGuard.test.ts`
Expected: PASS

- [ ] **Step 5: Run full server tests**

Run: `docker compose exec server npm test`
Expected: All tests pass.

- [ ] **Step 6: Commit**

```bash
git add server/services/gdpr.ts server/__tests__/services/gdprGuard.test.ts
git commit -m "fix(critical): GDPR purge guard no longer blocks after day 1"
```

---

## Task 8: Remove demo credentials from client bundle

**Files:**
- Modify: `client/src/views/LoginView.tsx` (lines ~15-50 and demo login handler)
- Modify: `server/trpc/routers/user.ts` (demoList procedure — add password field to server response)
- Create: `server/trpc/routers/__tests__/demoLogin.test.ts`
- Test: `client/src/__tests__/nodemocreds.test.ts`

- [ ] **Step 1: Write the client-side failing test**

Create `client/src/__tests__/nodemocreds.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

describe('demo credentials not in client bundle', () => {
  it('LoginView does not contain hardcoded demo password', () => {
    const source = readFileSync(
      join(__dirname, '../views/LoginView.tsx'),
      'utf-8'
    );
    expect(source).not.toContain('cGFzc3dvcmQxMjM'); // base64 of password123
    expect(source).not.toContain('DEMO_PASSWORD');
    expect(source).not.toContain('password123');
  });

  it('LoginView does not contain hardcoded demo user list', () => {
    const source = readFileSync(
      join(__dirname, '../views/LoginView.tsx'),
      'utf-8'
    );
    expect(source).not.toContain('HARDCODED_DEMO_USERS');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `docker compose exec client npx vitest run src/__tests__/nodemocreds.test.ts`
Expected: FAIL — LoginView still contains DEMO_PASSWORD and HARDCODED_DEMO_USERS

- [ ] **Step 3: Add demo login server endpoint**

In `server/trpc/routers/user.ts`, add a new procedure `demoLogin` alongside the existing `demoList`:

```ts
demoLogin: publicProcedure
  .input(z.object({ email: z.string().email() }))
  .mutation(async ({ input }) => {
    if (process.env.DEMO_MODE !== 'true') {
      throw new TRPCError({ code: 'FORBIDDEN', message: 'Demo mode is not enabled' });
    }

    // Verify the email belongs to a real user
    const { rows } = await query(
      'SELECT id FROM users WHERE email = $1 AND deleted_at IS NULL',
      [input.email]
    );
    if (rows.length === 0) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Demo user not found' });
    }

    // Return the demo password — server-side only, gated by DEMO_MODE
    return { password: 'password123' };
  }),
```

- [ ] **Step 4: Remove hardcoded credentials from LoginView**

In `client/src/views/LoginView.tsx`:

1. **Delete** the `DEMO_PASSWORD` constant (line ~15)
2. **Delete** the `HARDCODED_DEMO_USERS` array (lines ~19-30)
3. **Update the demo login handler** to fetch from the server instead:

Replace the demo login logic (wherever demo users are rendered and clicked) with:

```tsx
// Instead of using hardcoded password, fetch from server
const handleDemoLogin = async (email: string) => {
  try {
    const { password } = await trpc.user.demoLogin.mutate({ email });
    // Use the fetched password to log in
    await handleLogin(email, password);
  } catch (err) {
    setError(t('demo_login_failed'));
  }
};
```

4. **For the demo user list**, the component should already be fetching from `trpc.user.demoList` (or needs to be updated to do so). If it currently uses `HARDCODED_DEMO_USERS` to render the demo user buttons, replace with a `trpc.user.demoList.useQuery()` call:

```tsx
const { data: demoUsers } = trpc.user.demoList.useQuery(undefined, {
  enabled: isDemoMode, // from config or feature flag
});
```

- [ ] **Step 5: Run client test to verify it passes**

Run: `docker compose exec client npx vitest run src/__tests__/nodemocreds.test.ts`
Expected: PASS — no demo credentials in source

- [ ] **Step 6: Run full test suites**

Run: `docker compose exec server npm test && docker compose exec client npm test`
Expected: All tests pass.

- [ ] **Step 7: Commit**

```bash
git add client/src/views/LoginView.tsx server/trpc/routers/user.ts client/src/__tests__/nodemocreds.test.ts
git commit -m "fix(security): remove demo credentials from client bundle, gate behind server-side DEMO_MODE"
```

---

## Final Steps

- [ ] **Run full CI**

```powershell
powershell -File scripts/ci.ps1 -Skip e2e
```

Expected: typecheck, client tests, server tests, and migrations all pass.

- [ ] **Create the branch and squash if needed**

```bash
git checkout -b fix/critical-security
# Branch already has all commits from above
```
