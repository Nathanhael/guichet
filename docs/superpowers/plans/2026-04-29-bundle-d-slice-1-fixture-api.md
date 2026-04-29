# Bundle D / Slice 1 — Fixture API + status-and-transfer migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Introduce a `trpc.testFixtures.*` router at `server/trpc/routers/testFixtures.ts` with three production-safety layers (module-load assert, conditional mount, per-procedure recheck). Add a Playwright helper at `testing/e2e/helpers/fixtures.ts` that auto-registers per-test cleanup. Migrate `testing/e2e/status-and-transfer.spec.ts` end-to-end as proof. Skip count drops by ~19; fixture pattern is proven; remaining specs migrate in slice 2.

**Architecture:** Three procedures in slice 1 — `createTicket`, `cleanup`, `resetAgentStatus`. The fourth procedure (`ensureTicketInQueue`) lands in slice 2 if-and-only-if a callsite needs it. Production-safety contract: `server/utils/assertNotProduction.ts` is imported at module-load by `testFixtures.ts` (panic on import in prod); `server/trpc/router.ts` conditionally mounts `testFixtures` only when `NODE_ENV !== 'production'`; each procedure also re-asserts inside its resolver. Fixture procedures call the existing `lifecycle.create()` core service for ticket creation, mirroring the production codepath rather than open-coding INSERTs. Fixture-emitted audit rows use a labeled action (`audit.test_fixture.*`) so platform audit views can filter them out.

**Tech Stack:** Express + tRPC 11, Vitest + node, Playwright. Existing PGLite test harness (no Docker dependency for unit tests). Existing `lifecycle.create` for ticket creation. Existing `loginAsDemo` Playwright helper for auth.

**Parent issue:** [#83](https://github.com/Nathanhael/guichet/issues/83) (PRD), RFC [#82](https://github.com/Nathanhael/guichet/issues/82). Blocks: slice 2 spec migrations.

---

## Pre-flight: Decisions Locked Before Coding

### D1. Module-load assert is a thrown Error, not a process.exit.

`assertNotProduction()` throws `new Error('testFixtures router cannot be imported in production')`. The server will fail to start because the import is reached during `server/trpc/router.ts` loading. `process.exit` would be harder to test (Vitest cannot recover); `throw` is observable in the boundary test via `expect(() => require('...')).toThrow()`.

### D2. Conditional mount is a static `if`, not a dynamic env check inside the router.

`server/trpc/router.ts`:
```ts
const fixturesRouter = config.NODE_ENV !== 'production' ? testFixturesRouter : undefined;
export const appRouter = router({
  // ...all existing routes...
  ...(fixturesRouter ? { testFixtures: fixturesRouter } : {}),
});
```
The router key `testFixtures` does not exist on the production tRPC client. Calls to `trpc.testFixtures.*` fail at typecheck time on a prod build, not at runtime.

### D3. Per-procedure recheck uses a shared middleware, not inline `if (config.NODE_ENV ...)`.

```ts
// inside testFixtures.ts
const fixtureProcedure = protectedProcedure.use(({ next }) => {
  if (config.NODE_ENV === 'production') {
    throw new TRPCError({ code: 'NOT_FOUND', message: 'Test fixtures unavailable' });
  }
  return next();
});
```
Defense in depth against an operator misconfiguring `NODE_ENV` after server start. `NOT_FOUND` (not `FORBIDDEN`) so a misbehaving caller can't fingerprint the production environment by error code.

### D4. Fixtures inherit the caller's auth via `protectedProcedure`.

The fixture procedures extend `protectedProcedure`, not `publicProcedure`. The Playwright helper authenticates first (via existing `loginAsDemo`) and the fixture call inherits the JWT cookie. This is the simplest possible contract and reuses every existing auth check.

### D5. Cross-tenant by design — allowlisted in tenant-isolation script.

`createTicket` accepts a client-supplied `partnerId` because tests are intentionally cross-tenant (a test for partner Acme may run as a `support_lucas` who is also a member of Betacorp). The tenant-isolation script at `server/scripts/check-trpc-tenant-isolation.mjs` is updated to allowlist `testFixtures.ts` (alongside `support.ts` and `platform/**`).

### D6. Cleanup is idempotent and stale-safe.

`cleanup` accepts `ticketIds: number[]`. For each id, the procedure runs `DELETE FROM tickets WHERE id = $1` plus cascading deletes (messages, ticket_labels, ratings, audit rows under `target_id = $1`). Stale ids (already deleted) are no-ops, not errors. The `userIds` array resets `agent_status_log` rows in the last 24 hours and clears Redis presence keys; user rows are NOT deleted.

### D7. Ticket creation calls `lifecycle.create()` — no open-coded INSERT.

`createTicket` translates its input into a `lifecycle.create()` call so audit rows, queue position broadcasts, and socket emissions match production. The audit row's action is `audit.test_fixture.ticket_created` (rewritten by the fixture wrapper before insertion) instead of `ticket.created`. Platform audit views filter `audit.test_fixture.*` by default to keep the audit log readable.

### D8. Playwright helper uses `test.extend` for fixture-scoped cleanup.

The new file at `testing/e2e/helpers/fixtures.ts` exports an extended `test`:
```ts
export const test = base.extend<{ ticketFixture: TicketFixture }>({
  ticketFixture: async ({ page }, use) => {
    const created: number[] = [];
    const fixture: TicketFixture = {
      async create(opts) {
        const id = await callTrpc(page, 'testFixtures.createTicket', opts);
        created.push(id);
        return id;
      },
      // ...
    };
    await use(fixture);
    if (created.length > 0) {
      await callTrpc(page, 'testFixtures.cleanup', { ticketIds: created });
    }
  },
});
```
Specs `import { test, expect } from './helpers/fixtures'` and get auto-cleanup. Forgetting cleanup is impossible by construction.

### D9. Slice 1 migrates only `status-and-transfer.spec.ts`.

Highest-density skip cluster: 10 runtime-predicate skips + 9 inline-fixture skips = 19 in one file. Migrating it end-to-end proves the fixture API can replace both forms. Slice 2 handles the remaining 25 spec files.

### D10. `loginAsDemo` is unchanged.

The fixture pattern composes with the existing `loginAsDemo` helper. Tests log in first, then call `ticketFixture.create()`. No changes to `helpers/auth.ts`.

### D11. Slice 1 does NOT add the CI grep guard.

The grep guard lands in slice 3 after slice 2 migrations remove the offending patterns. Adding it earlier would break CI on the unmigrated specs.

---

## File Structure

### Files to create

| Path | Responsibility |
|---|---|
| `server/utils/assertNotProduction.ts` | One-function module: throws if `NODE_ENV === 'production'`. Imported at module-load by any file that should not exist in prod. |
| `server/utils/__tests__/assertNotProduction.test.ts` | Unit tests for the helper. |
| `server/trpc/routers/testFixtures.ts` | The fixture router. Module-load assert + `fixtureProcedure` + three procedures. |
| `server/__tests__/trpc/routers/testFixtures.boundary.test.ts` | Boundary test: file panics on import in prod. |
| `server/__tests__/trpc/routers/testFixtures.auth.test.ts` | Auth boundary: each procedure rejects unauthenticated callers. |
| `server/__tests__/trpc/routers/testFixtures.createTicket.test.ts` | Happy path + invalid partner + invalid agent email. |
| `server/__tests__/trpc/routers/testFixtures.cleanup.test.ts` | Idempotency + stale-safety. |
| `server/__tests__/trpc/routers/testFixtures.resetAgentStatus.test.ts` | Status / Redis state matches expected. |
| `testing/e2e/helpers/fixtures.ts` | Playwright `test.extend` with per-test ticket-fixture slot. |

### Files to modify

| Path | Change |
|---|---|
| `server/trpc/router.ts` | Conditional mount: include `testFixtures` only when `NODE_ENV !== 'production'`. |
| `server/scripts/check-trpc-tenant-isolation.mjs` | Allowlist `testFixtures.ts` alongside `support.ts`. |
| `server/services/dashboard/auditLog.ts` (or equivalent platform audit-log filter) | Filter `audit.test_fixture.*` by default; explicit toggle to include. |
| `testing/e2e/status-and-transfer.spec.ts` | Migrate every `test.skip` to use `ticketFixture.create()` or hard-error on demo-login fail. |
| `CHANGELOG.md` | Unreleased entry: "Bundle D slice 1 — fixture API + status-and-transfer migration." |

### Files NOT touched in this slice

- Any spec file other than `status-and-transfer.spec.ts` — slice 2.
- `testing/e2e/helpers/auth.ts` — `loginAsDemo` stays as-is.
- `scripts/ci.ps1` — grep guard is slice 3.
- `wiki/decisions/` — decision page is slice 3 once full bundle ships.
- Existing seed scripts — fixtures replace per-test seed reliance, not the seed itself.

---

## Conventions

- **Server tests:** `docker compose exec server npm test -- <path>`. Vitest passthrough.
- **Server type-check:** `docker compose exec server npx tsc --noEmit -p .`
- **Server reload after edit:** `docker compose restart server` (tsx watch unreliable on Windows bind mount per memory).
- **E2E test (one spec):** `docker compose exec client npx playwright test testing/e2e/status-and-transfer.spec.ts --workers=1 --reporter=line`
- **CI:** `powershell -File scripts/ci.ps1` (final task only)
- **Commit style:** `feat(server): ...` for new server code, `feat(testing): ...` for testing helpers, `refactor(testing): ...` for spec migrations, `test(server): ...` for test-only commits. One commit per task.
- **Branch:** `feat/bundle-d-slice-1-fixture-api` off `main`.

---

## Tasks

### Task 1: `assertNotProduction` utility + tests

**Files:**
- Create: `server/utils/assertNotProduction.ts`
- Create: `server/utils/__tests__/assertNotProduction.test.ts`

- [ ] **Step 1: Create the utility**

```ts
// server/utils/assertNotProduction.ts
import config from '../config.js';

export function assertNotProduction(reason?: string): void {
  if (config.NODE_ENV === 'production') {
    throw new Error(
      `Production-restricted module loaded${reason ? `: ${reason}` : ''}. ` +
        `This file must not be imported when NODE_ENV=production.`,
    );
  }
}
```

- [ ] **Step 2: Write tests**

```ts
// server/utils/__tests__/assertNotProduction.test.ts
import { describe, it, expect, vi, afterEach } from 'vitest';

describe('assertNotProduction', () => {
  afterEach(() => {
    vi.resetModules();
  });

  it('returns silently when NODE_ENV !== production', async () => {
    vi.doMock('../../config.js', () => ({ default: { NODE_ENV: 'development' } }));
    const { assertNotProduction } = await import('../assertNotProduction.js');
    expect(() => assertNotProduction()).not.toThrow();
  });

  it('throws when NODE_ENV === production', async () => {
    vi.doMock('../../config.js', () => ({ default: { NODE_ENV: 'production' } }));
    const { assertNotProduction } = await import('../assertNotProduction.js');
    expect(() => assertNotProduction()).toThrow(/Production-restricted/);
  });

  it('includes the supplied reason in the error message', async () => {
    vi.doMock('../../config.js', () => ({ default: { NODE_ENV: 'production' } }));
    const { assertNotProduction } = await import('../assertNotProduction.js');
    expect(() => assertNotProduction('test fixtures')).toThrow(/test fixtures/);
  });
});
```

- [ ] **Step 3: Run tests**

```bash
docker compose exec server npm test -- utils/__tests__/assertNotProduction.test.ts --run
```
Expected: 3 PASS.

- [ ] **Step 4: Commit**

```bash
git add server/utils/assertNotProduction.ts server/utils/__tests__/assertNotProduction.test.ts
git commit -m "feat(server): assertNotProduction helper for prod-restricted module guards"
```

---

### Task 2: testFixtures router skeleton + module-load assert

**Files:**
- Create: `server/trpc/routers/testFixtures.ts`
- Create: `server/__tests__/trpc/routers/testFixtures.boundary.test.ts`

- [ ] **Step 1: Create the skeleton**

```ts
// server/trpc/routers/testFixtures.ts
import { TRPCError } from '@trpc/server';
import { router, protectedProcedure } from '../trpc.js';
import config from '../../config.js';
import { assertNotProduction } from '../../utils/assertNotProduction.js';

// Module-load guard. Importing this file in production fails the server boot.
assertNotProduction('testFixtures router');

const fixtureProcedure = protectedProcedure.use(({ next }) => {
  if (config.NODE_ENV === 'production') {
    throw new TRPCError({ code: 'NOT_FOUND', message: 'Test fixtures unavailable' });
  }
  return next();
});

export const testFixturesRouter = router({
  // procedures land in tasks 3-5
});

export type TestFixturesRouter = typeof testFixturesRouter;
```

- [ ] **Step 2: Write the boundary test**

```ts
// server/__tests__/trpc/routers/testFixtures.boundary.test.ts
import { describe, it, expect, vi, afterEach } from 'vitest';

describe('testFixtures router — production boundary', () => {
  afterEach(() => {
    vi.resetModules();
  });

  it('throws on import when NODE_ENV === production', async () => {
    vi.doMock('../../../config.js', () => ({ default: { NODE_ENV: 'production' } }));
    await expect(import('../../../trpc/routers/testFixtures.js')).rejects.toThrow(
      /Production-restricted module/,
    );
  });

  it('imports cleanly when NODE_ENV !== production', async () => {
    vi.doMock('../../../config.js', () => ({ default: { NODE_ENV: 'test' } }));
    const mod = await import('../../../trpc/routers/testFixtures.js');
    expect(mod.testFixturesRouter).toBeDefined();
  });
});
```

- [ ] **Step 3: Run tests**

```bash
docker compose exec server npm test -- __tests__/trpc/routers/testFixtures.boundary.test.ts --run
```
Expected: 2 PASS.

- [ ] **Step 4: Commit**

```bash
git add server/trpc/routers/testFixtures.ts server/__tests__/trpc/routers/testFixtures.boundary.test.ts
git commit -m "feat(server): testFixtures router skeleton with module-load production guard"
```

---

### Task 3: `createTicket` procedure

**Files:**
- Modify: `server/trpc/routers/testFixtures.ts`
- Create: `server/__tests__/trpc/routers/testFixtures.createTicket.test.ts`

- [ ] **Step 1: Add the procedure**

```ts
// inside testFixtures.ts
import { z } from 'zod';
import { db } from '../../db.js';
import { partners, users } from '../../db/schema.js';
import { eq } from 'drizzle-orm';
import { createTicketTx } from '../../services/ticketLifecycle/mutations.js';
import { auditFixtureAction } from '../../services/auditFixtures.js'; // helper added in Task 6
import logger from '../../utils/logger.js';

// inside the router definition:
createTicket: fixtureProcedure
  .input(z.object({
    partnerId: z.string(),
    agentEmail: z.string().email().optional(),
    status: z.enum(['open', 'pending', 'closed']).default('open'),
    assignToSupportEmail: z.string().email().optional(),
    body: z.string().default('E2E fixture'),
    departmentId: z.string().optional(),
  }))
  .mutation(async ({ input, ctx }) => {
    // Resolve agent (default: agent_julie) and optional support assignee.
    const agentEmail = input.agentEmail ?? 'agent_julie@guichet.test';
    const [agent] = await db.select().from(users).where(eq(users.email, agentEmail)).limit(1);
    if (!agent) {
      throw new TRPCError({ code: 'BAD_REQUEST', message: `Fixture agent not found: ${agentEmail}` });
    }
    const [partner] = await db.select().from(partners).where(eq(partners.id, input.partnerId)).limit(1);
    if (!partner) {
      throw new TRPCError({ code: 'BAD_REQUEST', message: `Partner not found: ${input.partnerId}` });
    }

    // Call the lifecycle's tx-side helper directly.
    const ticketId = await db.transaction(async (tx) => {
      const result = await createTicketTx(tx, {
        partnerId: input.partnerId,
        agentId: agent.id,
        agentName: agent.name,
        body: input.body,
        departmentId: input.departmentId ?? null,
      });
      return result.ticketId;
    });

    // Optionally close or assign-to-support post-create. Status transitions go
    // through their own lifecycle entry points so audit rows + socket events
    // match production. Fixture wraps audit action labels.
    if (input.assignToSupportEmail) {
      const [support] = await db.select().from(users)
        .where(eq(users.email, input.assignToSupportEmail)).limit(1);
      if (support) {
        await db.update(/* tickets */).set({ supportId: support.id, supportName: support.name }).where(/* ... */);
      }
    }
    if (input.status === 'closed') {
      // close via lifecycle
    }

    await auditFixtureAction({
      partnerId: input.partnerId,
      action: 'audit.test_fixture.ticket_created',
      targetType: 'ticket',
      targetId: ticketId,
      actorId: ctx.user.id,
      metadata: { fixtureBy: ctx.user.id },
    });

    logger.info({ ticketId, partnerId: input.partnerId }, '[testFixtures] Created ticket');
    return { ticketId };
  }),
```

> NOTE: The above sketch shows the contract — exact `createTicketTx` signature must match `server/services/ticketLifecycle/mutations.ts:185`. The agent should hit a `lifecycle.create` entry point if one exists in the public surface; if `createTicketTx` is private, expose a thin wrapper at the lifecycle's `index.ts` first, then use it here. **Read `server/services/ticketLifecycle/index.ts` and `mutations.ts` before implementing — adjust the call shape to match the real exports.**

- [ ] **Step 2: Write tests**

```ts
// server/__tests__/trpc/routers/testFixtures.createTicket.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { setupTestDb, teardownTestDb, callTrpcAuthed } from '../../helpers.js';

describe('testFixtures.createTicket', () => {
  beforeEach(setupTestDb);
  afterEach(teardownTestDb);

  it('creates a ticket assigned to the default agent when agentEmail is omitted', async () => {
    const { ticketId } = await callTrpcAuthed('testFixtures.createTicket', {
      partnerId: 'acme',
    });
    expect(typeof ticketId).toBe('number');
    // Verify the ticket exists in DB with the expected default agent.
    // ...
  });

  it('rejects with BAD_REQUEST when partnerId does not exist', async () => {
    await expect(
      callTrpcAuthed('testFixtures.createTicket', { partnerId: 'nonexistent' }),
    ).rejects.toThrow(/Partner not found/);
  });

  it('rejects with BAD_REQUEST when agentEmail does not match a seeded user', async () => {
    await expect(
      callTrpcAuthed('testFixtures.createTicket', {
        partnerId: 'acme',
        agentEmail: 'ghost@nowhere.test',
      }),
    ).rejects.toThrow(/Fixture agent not found/);
  });

  it('emits audit row with action audit.test_fixture.ticket_created', async () => {
    const { ticketId } = await callTrpcAuthed('testFixtures.createTicket', {
      partnerId: 'acme',
    });
    // Query audit_log; assert the row exists with the labeled action.
    // ...
  });
});
```

- [ ] **Step 3: Run tests, expect pass**

```bash
docker compose exec server npm test -- __tests__/trpc/routers/testFixtures.createTicket.test.ts --run
```

- [ ] **Step 4: Commit**

```bash
git add server/trpc/routers/testFixtures.ts server/__tests__/trpc/routers/testFixtures.createTicket.test.ts server/services/auditFixtures.ts
git commit -m "feat(server): testFixtures.createTicket — create ticket via lifecycle, label audit action"
```

---

### Task 4: `cleanup` procedure

**Files:**
- Modify: `server/trpc/routers/testFixtures.ts`
- Create: `server/__tests__/trpc/routers/testFixtures.cleanup.test.ts`

- [ ] **Step 1: Add the procedure**

```ts
cleanup: fixtureProcedure
  .input(z.object({
    ticketIds: z.array(z.number()).optional(),
    userIds: z.array(z.string()).optional(),
  }))
  .mutation(async ({ input }) => {
    if (input.ticketIds && input.ticketIds.length > 0) {
      // Cascade-delete: messages, ticket_labels, ratings, audit rows.
      // PG FK cascade may already cover most; verify in schema and only do
      // explicit deletes for tables without ON DELETE CASCADE.
      await db.delete(tickets).where(inArray(tickets.id, input.ticketIds));
    }
    if (input.userIds && input.userIds.length > 0) {
      // Reset agent_status_log rows in last 24h
      const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      await db.delete(agentStatusLog).where(and(
        inArray(agentStatusLog.userId, input.userIds),
        gte(agentStatusLog.startedAt, since),
      ));
      // Clear Redis presence keys for each user.
      const redis = getRedis();
      for (const uid of input.userIds) {
        await redis.del(`presence:${uid}`);
      }
    }
  }),
```

- [ ] **Step 2: Write tests**

Idempotency: calling cleanup with the same ids twice in a row succeeds both times. Stale-safety: calling with ids that don't exist is a no-op, not an error.

```ts
describe('testFixtures.cleanup', () => {
  it('deletes the requested ticket ids', async () => { /* ... */ });
  it('is idempotent when called twice with the same ids', async () => { /* ... */ });
  it('is stale-safe when called with non-existent ids', async () => {
    await expect(
      callTrpcAuthed('testFixtures.cleanup', { ticketIds: [999999999] }),
    ).resolves.not.toThrow();
  });
  it('clears Redis presence keys for the requested userIds', async () => { /* ... */ });
});
```

- [ ] **Step 3: Run tests, expect pass**

- [ ] **Step 4: Commit**

```bash
git add server/trpc/routers/testFixtures.ts server/__tests__/trpc/routers/testFixtures.cleanup.test.ts
git commit -m "feat(server): testFixtures.cleanup — idempotent + stale-safe ticket/user cleanup"
```

---

### Task 5: `resetAgentStatus` procedure

**Files:**
- Modify: `server/trpc/routers/testFixtures.ts`
- Create: `server/__tests__/trpc/routers/testFixtures.resetAgentStatus.test.ts`

- [ ] **Step 1: Add the procedure**

```ts
resetAgentStatus: fixtureProcedure
  .input(z.object({
    userId: z.string(),
    status: z.enum(['online', 'away']).default('online'),
  }))
  .mutation(async ({ input }) => {
    const redis = getRedis();
    // Clear any open status_log row, set new status, persist Redis presence.
    const now = new Date().toISOString();
    await db.transaction(async (tx) => {
      // Close any open status_log row for this user (no end time yet).
      await tx.update(agentStatusLog)
        .set({ endedAt: now, duration: sql`EXTRACT(EPOCH FROM (${now}::timestamp - started_at))::int` })
        .where(and(eq(agentStatusLog.userId, input.userId), isNull(agentStatusLog.endedAt)));
      // Insert new open status_log row.
      await tx.insert(agentStatusLog).values({
        userId: input.userId,
        status: input.status,
        startedAt: now,
      });
    });
    await redis.set(`presence:${input.userId}`, JSON.stringify({ status: input.status, ts: Date.now() }));
  }),
```

- [ ] **Step 2: Write tests**

```ts
describe('testFixtures.resetAgentStatus', () => {
  it('clears prior open status row and inserts a new one', async () => { /* ... */ });
  it('writes Redis presence key with the requested status', async () => { /* ... */ });
});
```

- [ ] **Step 3: Run tests, expect pass**

- [ ] **Step 4: Commit**

```bash
git add server/trpc/routers/testFixtures.ts server/__tests__/trpc/routers/testFixtures.resetAgentStatus.test.ts
git commit -m "feat(server): testFixtures.resetAgentStatus — Redis presence + status_log rewrite"
```

---

### Task 6: `auditFixtures` helper for labeled audit actions

**Files:**
- Create: `server/services/auditFixtures.ts`
- Modify: `server/trpc/routers/platform/audit.ts` (or wherever audit-log default filtering lives)

- [ ] **Step 1: Create the audit helper**

```ts
// server/services/auditFixtures.ts
import { assertNotProduction } from '../utils/assertNotProduction.js';
import { db } from '../db.js';
import { auditLog } from '../db/schema.js';

assertNotProduction('auditFixtures');

interface FixtureAuditArgs {
  partnerId: string | null;
  action: `audit.test_fixture.${string}`;
  targetType: string;
  targetId: string | number;
  actorId: string;
  metadata?: Record<string, unknown>;
}

export async function auditFixtureAction(args: FixtureAuditArgs): Promise<void> {
  await db.insert(auditLog).values({
    partnerId: args.partnerId,
    action: args.action,
    actorId: args.actorId,
    targetType: args.targetType,
    targetId: String(args.targetId),
    metadata: args.metadata ?? {},
    // chainHash, prevHash etc. computed by the audit service if applicable
  });
}
```

- [ ] **Step 2: Filter `audit.test_fixture.*` from default platform audit views**

Locate the audit-log query in `server/trpc/routers/platform/audit.ts` (or wherever `getAuditLog` lives). Add a default `WHERE action NOT LIKE 'audit.test_fixture.%'`. Add an explicit `includeFixtures: z.boolean().default(false)` input flag that disables the filter.

Existing partner audit router already filters `ticket.*` actions by default — same pattern. Mirror it.

- [ ] **Step 3: Write tests**

```ts
describe('platform audit log — fixture filter', () => {
  it('excludes audit.test_fixture.* by default', async () => { /* ... */ });
  it('includes audit.test_fixture.* when includeFixtures=true', async () => { /* ... */ });
});
```

- [ ] **Step 4: Run tests + tenant-isolation script, expect pass**

```bash
docker compose exec server npm test -- audit --run
docker compose exec server node server/scripts/check-trpc-tenant-isolation.mjs
```

- [ ] **Step 5: Commit**

```bash
git add server/services/auditFixtures.ts server/trpc/routers/platform/audit.ts server/__tests__/trpc/routers/platformAudit.test.ts
git commit -m "feat(server): audit.test_fixture.* action label + default filter in platform views"
```

---

### Task 7: Conditional mount + auth boundary test

**Files:**
- Modify: `server/trpc/router.ts`
- Modify: `server/scripts/check-trpc-tenant-isolation.mjs`
- Create: `server/__tests__/trpc/routers/testFixtures.auth.test.ts`

- [ ] **Step 1: Conditional mount**

```ts
// server/trpc/router.ts
import config from '../config.js';
// ...other imports...

// Lazy import — testFixtures throws on import in production. The static
// import would propagate the panic. We need the symbol present at type level
// for the router shape, but the file body never executes in prod.
type TestFixturesRouter = typeof import('./routers/testFixtures.js').testFixturesRouter | undefined;
let testFixturesRouter: TestFixturesRouter;
if (config.NODE_ENV !== 'production') {
  testFixturesRouter = (await import('./routers/testFixtures.js')).testFixturesRouter;
}

export const appRouter = router({
  status: statusRouter,
  // ...all existing routes...
  ...(testFixturesRouter ? { testFixtures: testFixturesRouter } : {}),
});
```

> NOTE: top-level await may not be supported in the current TS config. Alternative: synchronous mount with a dynamic-`if` and `require()` (CJS) or restructure to a factory function. Verify TS config + Node ESM mode before picking the syntax.

- [ ] **Step 2: Allowlist `testFixtures.ts` in tenant-isolation script**

```js
// server/scripts/check-trpc-tenant-isolation.mjs (modified)
function isAllowlisted(relPath) {
  const parts = relPath.split(/[\\/]/);
  if (parts[parts.length - 1] === 'support.ts') return true;
  if (parts[parts.length - 1] === 'testFixtures.ts') return true; // NEW
  if (parts[0] === 'platform') return true;
  return false;
}
```

- [ ] **Step 3: Auth boundary test**

```ts
// server/__tests__/trpc/routers/testFixtures.auth.test.ts
describe('testFixtures — auth boundary', () => {
  it('createTicket rejects unauthenticated callers with UNAUTHORIZED', async () => {
    await expect(
      callTrpcUnauthed('testFixtures.createTicket', { partnerId: 'acme' }),
    ).rejects.toMatchObject({ data: { code: 'UNAUTHORIZED' } });
  });
  it('cleanup rejects unauthenticated callers', async () => { /* ... */ });
  it('resetAgentStatus rejects unauthenticated callers', async () => { /* ... */ });
});
```

- [ ] **Step 4: Run tests + tenant-isolation script + typecheck**

```bash
docker compose exec server npm test -- __tests__/trpc/routers/testFixtures --run
docker compose exec server node server/scripts/check-trpc-tenant-isolation.mjs
docker compose exec server npx tsc --noEmit -p .
```

- [ ] **Step 5: Restart server (tsx watch unreliable)**

```bash
docker compose restart server
```

- [ ] **Step 6: Commit**

```bash
git add server/trpc/router.ts server/scripts/check-trpc-tenant-isolation.mjs server/__tests__/trpc/routers/testFixtures.auth.test.ts
git commit -m "feat(server): conditionally mount testFixtures + allowlist in tenant-isolation guard"
```

---

### Task 8: Playwright fixture helper

**Files:**
- Create: `testing/e2e/helpers/fixtures.ts`

- [ ] **Step 1: Implement `test.extend` with auto-cleanup**

```ts
// testing/e2e/helpers/fixtures.ts
import { test as base, type Page } from '@playwright/test';

const BASE = process.env.E2E_BASE_URL ?? 'http://localhost:3001';

export interface CreateTicketOptions {
  partnerId: string;
  agentEmail?: string;
  status?: 'open' | 'pending' | 'closed';
  assignToSupportEmail?: string;
  body?: string;
  departmentId?: string;
}

export interface TicketFixture {
  create(opts: CreateTicketOptions): Promise<number>;
  /** Mark a ticket id as "do not auto-cleanup" — used by tests asserting on close-state. */
  retain(id: number): void;
  /** Reset agent presence + status_log for a user. Auto-undone in afterEach. */
  resetAgentStatus(userId: string, status?: 'online' | 'away'): Promise<void>;
}

async function callFixtureTrpc<T>(
  page: Page,
  procedure: string,
  input: unknown,
): Promise<T> {
  const url = `${BASE}/api/v1/trpc/${procedure}`;
  const res = await page.request.post(url, {
    data: { json: input },
    headers: { 'Content-Type': 'application/json' },
  });
  if (!res.ok()) {
    const body = await res.text();
    throw new Error(`fixture ${procedure} failed (${res.status()}): ${body}`);
  }
  const json = await res.json();
  // tRPC wraps responses in { result: { data: { json: ... } } }
  return json.result.data.json as T;
}

export const test = base.extend<{ ticketFixture: TicketFixture }>({
  ticketFixture: async ({ page }, use) => {
    const created: number[] = [];
    const retained = new Set<number>();
    const resetUsers: string[] = [];

    const fixture: TicketFixture = {
      async create(opts) {
        const { ticketId } = await callFixtureTrpc<{ ticketId: number }>(
          page,
          'testFixtures.createTicket',
          opts,
        );
        created.push(ticketId);
        return ticketId;
      },
      retain(id) {
        retained.add(id);
      },
      async resetAgentStatus(userId, status = 'online') {
        await callFixtureTrpc(page, 'testFixtures.resetAgentStatus', { userId, status });
        resetUsers.push(userId);
      },
    };

    await use(fixture);

    // Teardown — runs in afterEach automatically.
    const ticketIds = created.filter((id) => !retained.has(id));
    if (ticketIds.length > 0 || resetUsers.length > 0) {
      try {
        await callFixtureTrpc(page, 'testFixtures.cleanup', {
          ticketIds: ticketIds.length > 0 ? ticketIds : undefined,
          userIds: resetUsers.length > 0 ? resetUsers : undefined,
        });
      } catch (err) {
        // Cleanup failures should not fail the test outright but should log.
        console.error('[ticketFixture] cleanup failed:', err);
      }
    }
  },
});

export { expect } from '@playwright/test';
```

- [ ] **Step 2: No tests in this task** — the helper is exercised end-to-end by the spec migration in Task 9.

- [ ] **Step 3: Commit**

```bash
git add testing/e2e/helpers/fixtures.ts
git commit -m "feat(testing): Playwright ticketFixture helper with auto-cleanup in afterEach"
```

---

### Task 9: Migrate `status-and-transfer.spec.ts`

**Files:**
- Modify: `testing/e2e/status-and-transfer.spec.ts`

- [ ] **Step 1: Read the current file in full** — already read in plan prep. 19 skip points to eliminate (10 runtime predicates, 9 inline).

- [ ] **Step 2: Rewrite the import and replace `loginOk`-predicate skips with hard errors**

```ts
// Replace:
import { test, expect } from '@playwright/test';
import { loginAsDemo } from './helpers/auth';
// With:
import { test, expect } from './helpers/fixtures';
import { loginAsDemo } from './helpers/auth';
```

Replace every `let loginOk = false; ...` block with:

```ts
test.beforeEach(async ({ page }) => {
  const res = await loginAsDemo(page, 'support_lucas');
  if (!res.ok) {
    throw new Error(
      `Fixture user 'support_lucas' failed to log in (status ${res.status}). ` +
      `Check server/seed.ts — this is a test setup bug, not a skip condition.`,
    );
  }
  await page.waitForLoadState('networkidle');  // Replace fragile waitForTimeout(2000)
});
```

Delete every `test.skip(!loginOk, ...)` line.

- [ ] **Step 3: Replace the "find a ticket in queue" inline-fixture skips with `ticketFixture.create`**

For each test that did:
```ts
const queueEmpty = page.getByText(/queue.empty|0 in.queue/i).first();
const isEmpty = await queueEmpty.isVisible({ timeout: 3000 }).catch(() => false);
if (isEmpty) { test.skip(true, '...'); return; }
const ticketItem = page.locator('li[data-ticket-row]').first();
const hasTicket = await ticketItem.isVisible({ timeout: 5000 }).catch(() => false);
if (!hasTicket) { test.skip(true, '...'); return; }
```

Replace with:
```ts
test('transfer menu shows Return to queue and department options', async ({ page, ticketFixture }) => {
  // Determine the active partnerId for support_lucas. The seed configures him
  // as a member of `wavelink` (which has departments configured for transfer
  // testing). The active partner is set by loginAsDemo from the first
  // membership — verify by reading sessionStorage if needed.
  const partnerId = await page.evaluate(() => sessionStorage.getItem('activePartnerId'));
  if (!partnerId) throw new Error('No active partner — login flow regression');

  // Create a fresh ticket the test owns.
  await ticketFixture.create({ partnerId, status: 'open' });
  await page.reload();
  await page.waitForLoadState('networkidle');

  // The ticket is now visible in the queue — the assertion shape stays.
  const ticketItem = page.locator('li[data-ticket-row]').first();
  await expect(ticketItem).toBeVisible({ timeout: 10000 });
  await ticketItem.click();
  await page.waitForLoadState('networkidle');

  // ...existing Join + Transfer button + assertion logic, unchanged...
});
```

For the "Transfer button not visible" predicate skips: those were defensive against the page state. After the fixture pattern, the ticket is guaranteed to exist. If the Transfer button still isn't visible, that's a real bug — let the test fail with a clear `await expect(transferBtn).toBeVisible()` error.

- [ ] **Step 4: Run the spec, expect pass**

```bash
docker compose exec client npx playwright test testing/e2e/status-and-transfer.spec.ts --workers=1 --reporter=line
```

Expected: all 10 tests PASS. Zero skips. (Note: prior fixture-state predicates are gone; predicate-skip count: 19 → 0.)

- [ ] **Step 5: Run the spec a second time** — verify cleanup discipline

```bash
docker compose exec client npx playwright test testing/e2e/status-and-transfer.spec.ts --workers=1 --reporter=line
```

Expected: all 10 tests PASS again. Tickets created in the first run were cleaned up; the second run does not see leftover state.

- [ ] **Step 6: Commit**

```bash
git add testing/e2e/status-and-transfer.spec.ts
git commit -m "refactor(testing): migrate status-and-transfer.spec.ts to ticketFixture (-19 skips)"
```

---

### Task 10: CHANGELOG entry

**Files:**
- Modify: `CHANGELOG.md`

- [ ] **Step 1: Add the Unreleased entry**

```markdown
## [Unreleased]

### Added

- **Bundle D slice 1 — testFixtures router + Playwright ticketFixture + status-and-transfer migration** (issue #83) — new `server/trpc/routers/testFixtures.ts` exposes `createTicket`, `cleanup`, and `resetAgentStatus` procedures; production-safety contract enforced via three layers (module-load assert, conditional router mount, per-procedure recheck). New `testing/e2e/helpers/fixtures.ts` provides a `test.extend` Playwright fixture with auto-cleanup in `afterEach`. `status-and-transfer.spec.ts` migrated end-to-end as proof — 19 fixture-state predicate skips eliminated; all 10 tests now pass deterministically. Per-call DB hits remain in production codepaths only; fixtures are unreachable in prod (boundary test asserts). Slice 2 will migrate the remaining 25 spec files.
```

- [ ] **Step 2: Commit**

```bash
git add CHANGELOG.md
git commit -m "docs: changelog entry for Bundle D slice 1 (fixture API + status-and-transfer)"
```

---

### Task 11: Run local CI

**Files:**
- None (verification only)

- [ ] **Step 1: Run `scripts/ci.ps1`**

```bash
powershell -File scripts/ci.ps1
```

Expected:
- typecheck: ✓
- test-client: ✓ (no client changes)
- test-server: ✓ (assertNotProduction, testFixtures.boundary, testFixtures.auth, testFixtures.createTicket, testFixtures.cleanup, testFixtures.resetAgentStatus, audit-filter all green)
- migrate: ✓ (no schema changes)
- e2e: ✓ — total run shows fewer skips than before by ~19. status-and-transfer.spec.ts: 10 PASS / 0 SKIP. Other specs unchanged.

- [ ] **Step 2: If e2e shows new failures unrelated to status-and-transfer**, those are pre-existing drift (per the 2026-04-28 triage). Document in PR description but do not block on them.

- [ ] **Step 3: Open the PR**

```bash
git push -u origin feat/bundle-d-slice-1-fixture-api
gh pr create --repo Nathanhael/guichet --title "feat(server,testing): Bundle D slice 1 — fixture API + status-and-transfer migration" --body "$(cat <<'EOF'
Closes #83 · Companion to RFC #82

## Summary
- New `server/trpc/routers/testFixtures.ts` with three procedures (`createTicket`, `cleanup`, `resetAgentStatus`) gated by three layers of production-safety: module-load assert, conditional router mount, per-procedure recheck.
- New `server/utils/assertNotProduction.ts` helper for prod-restricted module guards.
- New `testing/e2e/helpers/fixtures.ts` Playwright `test.extend` with auto-cleanup in `afterEach`.
- Audit log: fixture-emitted rows use `audit.test_fixture.*` action labels; platform audit view filters them by default.
- Tenant-isolation script allowlists `testFixtures.ts` (cross-tenant by design for E2E).
- `status-and-transfer.spec.ts` migrated end-to-end: 19 fixture-state predicate skips eliminated; all 10 tests now pass deterministically.

## Production safety
- Boundary test (`testFixtures.boundary.test.ts`) asserts the router file panics on import in prod.
- Auth test (`testFixtures.auth.test.ts`) asserts each procedure rejects unauthenticated callers.
- Conditional mount in `router.ts` means the `testFixtures` key does not exist on the production tRPC client.

## What this PR does NOT do
- Does not migrate any spec other than `status-and-transfer.spec.ts` — slice 2 migrates the remaining 25 spec files.
- Does not add the CI grep guard — slice 3 lands that after slice 2 clears the offending patterns.
- Does not change `loginAsDemo` or any seed scripts.

## Test plan
- [x] `docker compose exec server npx tsc --noEmit -p .` — 0 errors
- [x] `docker compose exec server npm test` — all server suites pass (new boundary + auth + per-procedure + audit-filter green)
- [x] `docker compose exec server node server/scripts/check-trpc-tenant-isolation.mjs` — clean
- [x] `docker compose exec client npx playwright test testing/e2e/status-and-transfer.spec.ts --workers=1` — 10 PASS / 0 SKIP
- [x] Re-run the same Playwright command — 10 PASS / 0 SKIP (cleanup discipline verified)
- [x] `powershell -File scripts/ci.ps1` — green; e2e total skip count down by ~19

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## Self-Review Checklist (run before declaring plan complete)

**1. Spec coverage** — every PRD #83 acceptance row applicable to slice 1 has a task:

| Acceptance criterion (slice 1 scope) | Task |
|---|---|
| Fixture API exists at `trpc.testFixtures.*` | Tasks 2-5 |
| Production-safety: 3 layers + boundary test | Tasks 1, 2, 7 |
| Auth boundary: each procedure rejects unauth | Task 7 |
| `audit.test_fixture.*` filtered by default | Task 6 |
| Tenant-isolation guard allowlist | Task 7 |
| Playwright `test.extend` with auto-cleanup | Task 8 |
| One canonical spec migrated end-to-end | Task 9 |
| Zero skips in migrated spec | Task 9 |
| Re-run cleanliness verified | Task 9, Step 5 |
| CHANGELOG entry | Task 10 |
| `scripts/ci.ps1` passes | Task 11 |
| New non-prod-gated `test.skip` patterns introduced: 0 | (Convention — slice 1 only deletes them) |

**2. Placeholder scan** — Task 3, Task 6, Task 7 contain "verify before implementing" notes for things the plan author cannot fully spec without reading the surrounding code (exact `createTicketTx` signature, top-level await support, audit-log default-filter location). These are NOTEs the implementer reads first; they are not silent placeholders.

**3. Type consistency** — `CreateTicketOptions`, `TicketFixture`, `FixtureAuditArgs`, the `fixtureProcedure` shape, and the `callFixtureTrpc` response unwrap are all consistent across Tasks 3, 6, 7, 8.

**4. Open scope items surfaced (not silenced):**
- `ensureTicketInQueue` deferred to slice 2; not in slice 1's three procedures.
- `auditFixtures` filter location (Task 6) is "wherever the platform audit-log query lives" — implementer should `grep getAuditLog` and confirm before editing.
- `lifecycle.create` integration (Task 3) requires reading `services/ticketLifecycle/index.ts` for the public surface; the plan sketches the contract but defers the exact call shape to the implementer.
- Top-level await in router.ts (Task 7) is a TS-config concern that may force a syntactic alternative.

---

## End

Slice 1 ships: fixture API + Playwright helper + one canonical spec migrated. Slice 2 (remaining 25 specs) can start as soon as this merges. Slice 3 (CI grep guard + wiki decision page) lands after slice 2.
