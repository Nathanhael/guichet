# Bundle A / Slice 2 — Revoke Sessions on `users.isExternal` Flip Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the staleness window on the `users.isExternal` flag — every codepath that mutates it triggers session-and-refresh-token revocation atomically with the change, so no pre-flip token can be used for destructive admin actions after Azure re-attestation flips a user's B2B-guest status.

**Architecture:** Introduce a single deep helper `flipIsExternal(deps, userId, nextValue)` in `services/auth/`. It reads the current value, no-ops when unchanged, and on actual flip writes the new value + an `auth.session_revoked` audit row inside one transaction, then fires the Redis-backed revocation cascade via `revokeUserSessions` (which already cascades to refresh tokens internally). The two real flip sites — both in `server/routes/sso.ts` (invite-claim path L341, re-attestation path L375) — replace their inline `db.update(users).set({ isExternal })` with the helper. After this slice, slice #71 can safely delete the `blockExternalUsers` middleware because no stale-token path survives a flip.

**Tech Stack:** TypeScript, Drizzle ORM, Redis pub/sub for revocation, Vitest + PGLite (in-process Postgres) for unit tests, Docker-only npm/node/npx execution.

**Parent issue:** [#67](https://github.com/Nathanhael/guichet/issues/67) (PRD #65, RFC #63). Blocks: [#71](https://github.com/Nathanhael/guichet/issues/71). Blocked by: [#66](https://github.com/Nathanhael/guichet/issues/66) (PR #73 — must be merged first).

---

## Pre-flight: Decisions Locked Before Coding

### Decisions taken (recommendation: keep as-is)

**D1. Single named helper, not inline duplication.**
Two flip callsites today; future SSO/admin paths might add a third. A helper keeps the revoke contract in one place and removes drift risk between callsites. Helper name: `flipIsExternal(userId, nextValue)`.

**D2. Helper lives at `server/services/auth/isExternalFlip.ts`.**
Auth-domain operation. Re-exported via the existing `services/auth/index.ts` barrel from slice #66.

**D3. Deps-injection seam (`createFlipIsExternal(deps)`) for testability.**
Pattern matches `createTicketLifecycle({ db })` from the lifecycle module. Enables PGLite-based unit tests that supply a mock `revokeUserSessions`. Production wiring lives in the barrel: it imports `db` from `../../db.js` and `revokeUserSessions` from `../sessionRevocation.js` and exports a closed-over function so callers don't need to thread deps.

**D4. Audit action and reason name.**
Action: `auth.session_revoked` (per issue #67 acceptance). Reason: `isExternal_flip` in the metadata. ActorId: the affected `userId` (the user is the one re-attesting via SSO; no external admin actor in the flip path today).

**D5. Cascade order: UPDATE + audit (in txn) → commit → `revokeUserSessions`.**
Strict atomicity across Postgres + Redis is impossible. After commit, even if the Redis revoke fails (Redis down, network hiccup), the flag has flipped and an audit row records the intent. The next request from a stale token would still be served until Redis recovers — we accept that as a **logged** failure (non-fatal) because slice #71's destructive-admin guards still re-validate via the JWT claim. Issue #71 will tighten this further by removing the per-call DB recheck path.

**D6. Idempotent: helper no-ops when current value equals `nextValue`.**
Avoids spurious revocations on every SSO login (Azure re-attestation runs on every login; most users' `isExternal` won't actually change). Returns `{ flipped: false }` without writing anything.

**D7. Member-invite path (`server/trpc/routers/partner/members.ts:243`) is NOT a flip site.**
That path inserts a brand-new user with `isExternal: true`. New user has no prior sessions to revoke. Keep its inline `INSERT ... isExternal: true` unchanged.

**D8. Boundary coverage is split across two test files.**
Issue #67 accepts "extend `session.boundary.test.ts` OR new test file". Going with **new file** `services/auth/isExternalFlip.test.ts` for the helper's unit + integration coverage; `session.boundary.test.ts` from slice #66 stays focused on token-shape + actor-narrowing. The new file uses PGLite for the DB layer and mocks `revokeUserSessions` (Redis surface) to assert the cascade is fired exactly once with the right args.

### Open question — full-lifecycle integration test

**Q. Do we need a Redis-backed integration test that asserts "pre-flip token rejected" end-to-end?**

The issue's acceptance row reads: *"asserts the full cascade: pre-flip token works → flag flipped → revocation cascades → pre-flip token rejected → re-auth produces token with new isExternal value"*. The unit test using a mocked `revokeUserSessions` proves the helper *invokes* the cascade with the right args — but doesn't prove that calling the real `revokeUserSessions` actually causes `isRevoked()` to return true for the pre-flip token.

**Recommended:** add a small integration test (`isExternalFlip.integration.test.ts` or a guarded block inside the unit file) that uses real Redis (the Docker compose Redis, available in the same env that runs `scripts/ci.ps1`) to round-trip: mint pre-flip JWT → call helper with real `revokeUserSessions` → call real `isRevoked()` against the pre-flip JWT's payload → assert it returns `true`. Keep the unit suite mocked for fast feedback; add the integration test as a separate it-block guarded by a `REDIS_URL` env check so it skips cleanly when Redis isn't available.

This plan includes the integration test as Task 9; if you want it skipped, drop that task and document the gap in the PR body.

---

## File Structure

### Files to create

| Path | Responsibility |
|---|---|
| `server/services/auth/isExternalFlip.ts` | Pure helper: `createFlipIsExternal(deps)` factory + `flipIsExternal(deps, userId, nextValue)` impl. Reads current value, no-ops when unchanged, writes UPDATE + audit row in one txn, then fires `revokeUserSessions`. |
| `server/services/auth/isExternalFlip.test.ts` | Unit tests: actual flip writes UPDATE + audit + calls `revokeUserSessions`; idempotent no-flip skips writes; throws when user not found. PGLite DB + mock `revokeUserSessions`. |
| `server/services/auth/isExternalFlip.integration.test.ts` | Integration test: real Redis round-trip — pre-flip JWT's payload reads as not-revoked, then after helper call reads as revoked. Skips cleanly when `REDIS_URL` is unset. |

### Files to modify

| Path | Change |
|---|---|
| `server/services/auth/index.ts` | Re-export `flipIsExternal` (the production-bound closed-over version). |
| `server/routes/sso.ts` (L341) | Replace `await db.update(users).set({ externalId: oid, name, isExternal }).where(eq(users.id, user.id))` with separate `externalId + name` update and a `flipIsExternal(user.id, isExternal)` call. |
| `server/routes/sso.ts` (L373–376) | Replace the `set({ name, email, isExternal, ... })` with `set({ name, email, ... })` (drop `isExternal` from the bulk update) and a `flipIsExternal(user.id, isExternal)` call right after. |
| `CHANGELOG.md` | Unreleased entry: "Revoke sessions on `users.isExternal` flip — closes the staleness window between Azure re-attestation and JWT rotation." |

### Files NOT touched in this slice

- `server/trpc/routers/partner/members.ts` — invite path is INSERT, not a flip.
- `server/trpc/trpc.ts` — `blockExternalUsers` middleware deletion stays in slice #71.
- `server/services/sessionRevocation.ts` — the existing `revokeUserSessions` API is sufficient (it already cascades to refresh tokens internally).
- `server/services/auth/session.boundary.test.ts` — keeps its slice-1 focus on token shape + actor narrowing.

---

## Conventions

- **Test runner:** `docker compose exec server npm test -- <path/to/file.test.ts>`. Vitest passthrough.
- **Type check:** `docker compose exec server npx tsc --noEmit -p .`
- **CI:** `powershell -File scripts/ci.ps1` (final task only)
- **Server reload after edits:** `docker compose restart server` (memory: tsx watch unreliable on Windows bind mount). Required before any test that exercises a runtime change in `server/`. NOT required for pure-Vitest runs (Vitest re-loads modules each invocation).
- **Commit style:** `feat(auth): <description>` for new helper code, `refactor(auth): <description>` for SSO callsite migration, `test(auth): <description>` for test-only commits. One commit per task.
- **Branch:** create a feature branch off main (after #66 merges) named `feat/bundle-a-slice-2-flip-revocation`.

---

## Tasks

### Task 1: Create the helper file with type contract (no behavior yet)

**Files:**
- Create: `server/services/auth/isExternalFlip.ts`

- [ ] **Step 1: Scaffold the deps interface and factory shape**

```typescript
// server/services/auth/isExternalFlip.ts

import type { PgDatabase } from 'drizzle-orm/pg-core';
import type * as schema from '../../db/schema.js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDb = PgDatabase<any, typeof schema, any>;

export interface FlipDeps {
  db: AnyDb;
  revokeUserSessions: (userId: string) => Promise<unknown>;
}

export interface FlipResult {
  flipped: boolean;
}

export function createFlipIsExternal(_deps: FlipDeps) {
  return async (_userId: string, _nextValue: boolean): Promise<FlipResult> => {
    throw new Error('not implemented');
  };
}
```

- [ ] **Step 2: Type-check passes**

Run: `docker compose exec server npx tsc --noEmit -p .`
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add server/services/auth/isExternalFlip.ts
git commit -m "feat(auth): scaffold flipIsExternal helper signature"
```

---

### Task 2: Test — flipIsExternal updates the user row and writes audit on actual flip

**Files:**
- Create: `server/services/auth/isExternalFlip.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// server/services/auth/isExternalFlip.test.ts

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { eq, and, desc } from 'drizzle-orm';

import { auditLog, users } from '../../db/schema.js';
import { createTestDb, type TestDbHandle } from '../../test/pglite-setup.js';
import { createFlipIsExternal } from './isExternalFlip.js';

let handle: TestDbHandle;

beforeEach(async () => {
  handle = await createTestDb();
});

afterEach(async () => {
  await handle.close();
});

describe('flipIsExternal — actual flip', () => {
  it('updates users.isExternal and writes auth.session_revoked audit row when value changes', async () => {
    await handle.db.insert(users).values({
      id: 'u-flip',
      email: 'flip@x.test',
      name: 'Flip User',
      isExternal: false,
    });

    const revokeMock = vi.fn().mockResolvedValue(0);
    const flip = createFlipIsExternal({ db: handle.db, revokeUserSessions: revokeMock });

    const result = await flip('u-flip', true);

    expect(result.flipped).toBe(true);

    const [row] = await handle.db
      .select({ isExternal: users.isExternal })
      .from(users)
      .where(eq(users.id, 'u-flip'));
    expect(row.isExternal).toBe(true);

    const [audit] = await handle.db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.action, 'auth.session_revoked'), eq(auditLog.targetId, 'u-flip')))
      .orderBy(desc(auditLog.createdAt))
      .limit(1);
    expect(audit).toBeDefined();
    expect(audit.actorId).toBe('u-flip');
    expect(audit.targetType).toBe('user');
    expect((audit.metadata as Record<string, unknown>).reason).toBe('isExternal_flip');
    expect((audit.metadata as Record<string, unknown>).from).toBe(false);
    expect((audit.metadata as Record<string, unknown>).to).toBe(true);
  });

  it('flips in the reverse direction (true → false) just as well', async () => {
    await handle.db.insert(users).values({
      id: 'u-flip-back',
      email: 'flipback@x.test',
      name: 'Flip Back',
      isExternal: true,
    });

    const revokeMock = vi.fn().mockResolvedValue(0);
    const flip = createFlipIsExternal({ db: handle.db, revokeUserSessions: revokeMock });

    const result = await flip('u-flip-back', false);

    expect(result.flipped).toBe(true);

    const [row] = await handle.db
      .select({ isExternal: users.isExternal })
      .from(users)
      .where(eq(users.id, 'u-flip-back'));
    expect(row.isExternal).toBe(false);
  });
});
```

Note on PGLite: this is the same substrate the lifecycle suites use (`createTestDb` from `server/test/pglite-setup.ts`). It's in-process, no Docker required for the unit test path.

- [ ] **Step 2: Add the test file to the .gitignore allowlist**

The repo blocks `**/*.test.ts` by default and allows specific subdirs. Confirm the slice-1 line `!server/services/auth/*.test.ts` is still present (added in slice #66). If for any reason it's missing, add it back near line 91 of `.gitignore`.

Run: `git check-ignore -v server/services/auth/isExternalFlip.test.ts`
Expected: no match (file is allowed). If it shows ignore output, fix the allowlist.

- [ ] **Step 3: Run the test, expect failure**

Run: `docker compose exec server npm test -- services/auth/isExternalFlip.test.ts --run`
Expected: FAIL — `not implemented` from the scaffold.

- [ ] **Step 4: Implement the helper (txn body, no revoke call yet)**

Replace the body of `createFlipIsExternal` in `server/services/auth/isExternalFlip.ts`:

```typescript
import { eq } from 'drizzle-orm';
import { auditLog, users } from '../../db/schema.js';
import logger from '../../utils/logger.js';

export function createFlipIsExternal(deps: FlipDeps) {
  return async (userId: string, nextValue: boolean): Promise<FlipResult> => {
    const result = await deps.db.transaction(async (tx) => {
      const [row] = await tx
        .select({ isExternal: users.isExternal })
        .from(users)
        .where(eq(users.id, userId))
        .limit(1);

      if (!row) {
        throw new Error(`flipIsExternal: user ${userId} not found`);
      }

      if (row.isExternal === nextValue) {
        return { flipped: false as const, prev: row.isExternal };
      }

      await tx.update(users).set({ isExternal: nextValue }).where(eq(users.id, userId));

      await tx.insert(auditLog).values({
        action: 'auth.session_revoked',
        actorId: userId,
        partnerId: null,
        targetType: 'user',
        targetId: userId,
        metadata: { reason: 'isExternal_flip', from: row.isExternal, to: nextValue },
      });

      return { flipped: true as const, prev: row.isExternal };
    });

    if (result.flipped) {
      try {
        await deps.revokeUserSessions(userId);
      } catch (err) {
        logger.error(
          { err: err instanceof Error ? err.message : String(err), userId },
          '[auth] flipIsExternal: revocation cascade failed (DB write committed)'
        );
      }
    }

    return { flipped: result.flipped };
  };
}
```

- [ ] **Step 5: Run the test, expect pass**

Run: `docker compose exec server npm test -- services/auth/isExternalFlip.test.ts --run`
Expected: PASS — both flip directions green.

- [ ] **Step 6: Commit**

```bash
git add server/services/auth/isExternalFlip.ts server/services/auth/isExternalFlip.test.ts
git commit -m "feat(auth): flipIsExternal updates users.isExternal + writes audit row on flip"
```

---

### Task 3: Test — idempotent no-flip when value unchanged

**Files:**
- Modify: `server/services/auth/isExternalFlip.test.ts`

- [ ] **Step 1: Append the no-flip test**

```typescript
describe('flipIsExternal — idempotent no-flip', () => {
  it('returns flipped=false and writes nothing when nextValue equals current', async () => {
    await handle.db.insert(users).values({
      id: 'u-stable',
      email: 'stable@x.test',
      name: 'Stable',
      isExternal: false,
    });

    const revokeMock = vi.fn().mockResolvedValue(0);
    const flip = createFlipIsExternal({ db: handle.db, revokeUserSessions: revokeMock });

    const result = await flip('u-stable', false);

    expect(result.flipped).toBe(false);
    expect(revokeMock).not.toHaveBeenCalled();

    const auditRows = await handle.db
      .select()
      .from(auditLog)
      .where(eq(auditLog.targetId, 'u-stable'));
    expect(auditRows).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run the test, expect pass**

Run: `docker compose exec server npm test -- services/auth/isExternalFlip.test.ts --run`
Expected: PASS — no-flip case green; the impl from Task 2 already handles this branch.

- [ ] **Step 3: Commit**

```bash
git add server/services/auth/isExternalFlip.test.ts
git commit -m "test(auth): assert flipIsExternal is idempotent on no-flip"
```

---

### Task 4: Test — cascade fires `revokeUserSessions` on flip

**Files:**
- Modify: `server/services/auth/isExternalFlip.test.ts`

- [ ] **Step 1: Append the cascade test**

```typescript
describe('flipIsExternal — revocation cascade', () => {
  it('calls revokeUserSessions exactly once with the userId on actual flip', async () => {
    await handle.db.insert(users).values({
      id: 'u-cascade',
      email: 'cascade@x.test',
      name: 'Cascade',
      isExternal: false,
    });

    const revokeMock = vi.fn().mockResolvedValue(0);
    const flip = createFlipIsExternal({ db: handle.db, revokeUserSessions: revokeMock });

    await flip('u-cascade', true);

    expect(revokeMock).toHaveBeenCalledTimes(1);
    expect(revokeMock).toHaveBeenCalledWith('u-cascade');
  });

  it('still returns flipped=true and persists the UPDATE when revoke throws (DB write is the source of truth)', async () => {
    await handle.db.insert(users).values({
      id: 'u-cascade-fail',
      email: 'cascadefail@x.test',
      name: 'Cascade Fail',
      isExternal: false,
    });

    const revokeMock = vi.fn().mockRejectedValue(new Error('Redis down'));
    const flip = createFlipIsExternal({ db: handle.db, revokeUserSessions: revokeMock });

    const result = await flip('u-cascade-fail', true);

    expect(result.flipped).toBe(true);
    const [row] = await handle.db
      .select({ isExternal: users.isExternal })
      .from(users)
      .where(eq(users.id, 'u-cascade-fail'));
    expect(row.isExternal).toBe(true);
    expect(revokeMock).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run the test, expect pass**

Run: `docker compose exec server npm test -- services/auth/isExternalFlip.test.ts --run`
Expected: PASS — cascade-on-flip + cascade-failure-non-fatal both green.

- [ ] **Step 3: Commit**

```bash
git add server/services/auth/isExternalFlip.test.ts
git commit -m "test(auth): assert flipIsExternal cascades to revokeUserSessions"
```

---

### Task 5: Test — throws on missing user

**Files:**
- Modify: `server/services/auth/isExternalFlip.test.ts`

- [ ] **Step 1: Append the not-found test**

```typescript
describe('flipIsExternal — error modes', () => {
  it('throws when the userId does not exist', async () => {
    const revokeMock = vi.fn().mockResolvedValue(0);
    const flip = createFlipIsExternal({ db: handle.db, revokeUserSessions: revokeMock });

    await expect(flip('u-nonexistent', true)).rejects.toThrow(/not found/i);
    expect(revokeMock).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the test, expect pass**

Run: `docker compose exec server npm test -- services/auth/isExternalFlip.test.ts --run`
Expected: PASS — throw-on-missing already implemented.

- [ ] **Step 3: Commit**

```bash
git add server/services/auth/isExternalFlip.test.ts
git commit -m "test(auth): assert flipIsExternal throws on missing user"
```

---

### Task 6: Wire the production-bound `flipIsExternal` in the auth barrel

**Files:**
- Modify: `server/services/auth/index.ts`

- [ ] **Step 1: Read the current barrel**

Run: `Read server/services/auth/index.ts`. Note the existing exports added by slice #66 (types, capabilities, actor builders).

- [ ] **Step 2: Append the prod-bound flipIsExternal**

Append to `server/services/auth/index.ts`:

```typescript
import { db } from '../../db.js';
import { revokeUserSessions } from '../sessionRevocation.js';
import { createFlipIsExternal } from './isExternalFlip.js';

export type { FlipDeps, FlipResult } from './isExternalFlip.js';
export { createFlipIsExternal } from './isExternalFlip.js';

/**
 * Production-bound `flipIsExternal`. Closes the staleness window when a
 * user's Azure B2B-guest status changes: writes the new flag value + an
 * `auth.session_revoked` audit row in one transaction, then fires the
 * Redis-backed revocation cascade (which itself cascades to the user's
 * refresh-token families). No-op when the value is already current.
 *
 * Callers: `server/routes/sso.ts` invite-claim and re-attestation paths.
 */
export const flipIsExternal = createFlipIsExternal({ db, revokeUserSessions });
```

- [ ] **Step 3: Type-check passes**

Run: `docker compose exec server npx tsc --noEmit -p .`
Expected: No errors.

- [ ] **Step 4: Commit**

```bash
git add server/services/auth/index.ts
git commit -m "feat(auth): wire production-bound flipIsExternal in barrel"
```

---

### Task 7: Migrate SSO invite-claim path (`sso.ts:341`)

**Files:**
- Modify: `server/routes/sso.ts` (around line 341)

- [ ] **Step 1: Read the current callsite**

Run: `Read server/routes/sso.ts` from line 320 to line 365. Confirm the `db.update(users).set({ externalId: oid, name, isExternal })` still matches what the plan describes.

- [ ] **Step 2: Replace the inline `set({ ..., isExternal })` with separate update + flip**

Locate this block (around line 341):

```typescript
        await db.update(users).set({ externalId: oid, name, isExternal }).where(eq(users.id, user.id));
        await db.insert(auditLog).values({
          action: 'sso.invite_claimed',
          ...
        });
```

Replace with:

```typescript
        // Update the non-flag fields first; let flipIsExternal own the flag
        // change so the staleness-window revocation cascade is centralized.
        await db.update(users).set({ externalId: oid, name }).where(eq(users.id, user.id));
        await flipIsExternal(user.id, isExternal);
        await db.insert(auditLog).values({
          action: 'sso.invite_claimed',
          ...
        });
```

Add the import at the top of the file (alongside other `services/` imports):

```typescript
import { flipIsExternal } from '../services/auth/index.js';
```

- [ ] **Step 3: Type-check passes**

Run: `docker compose exec server npx tsc --noEmit -p .`
Expected: No errors.

- [ ] **Step 4: Existing route tests still pass**

Run: `docker compose exec server npm test -- routes --run`
Expected: PASS. Behavioral note: pre-existing invite-claim users had `isExternal=null` or the same value as the SSO-derived `isExternal`. The flip helper no-ops in the same-value case so existing flows are unchanged.

- [ ] **Step 5: Commit**

```bash
git add server/routes/sso.ts
git commit -m "refactor(auth): SSO invite-claim path uses flipIsExternal for cascade"
```

---

### Task 8: Migrate SSO re-attestation path (`sso.ts:373–376`)

**Files:**
- Modify: `server/routes/sso.ts` (around lines 373–376)

- [ ] **Step 1: Read the current callsite**

Run: `Read server/routes/sso.ts` from line 364 to line 390. Locate the existing-user re-attestation update.

- [ ] **Step 2: Drop `isExternal` from the bulk update; add a flip call**

Locate this block (around line 373):

```typescript
      await db
        .update(users)
        .set({ name, email, isExternal, ...(nextLang && { lang: nextLang }) })
        .where(eq(users.id, user.id));
```

Replace with:

```typescript
      await db
        .update(users)
        .set({ name, email, ...(nextLang && { lang: nextLang }) })
        .where(eq(users.id, user.id));
      await flipIsExternal(user.id, isExternal);
```

(Import was added in Task 7.)

- [ ] **Step 3: Type-check passes**

Run: `docker compose exec server npx tsc --noEmit -p .`
Expected: No errors.

- [ ] **Step 4: Existing route tests still pass**

Run: `docker compose exec server npm test -- routes --run`
Expected: PASS.

- [ ] **Step 5: Restart server (tsx watch unreliable on Windows bind mount)**

Run: `docker compose restart server`

- [ ] **Step 6: Manual smoke (optional but recommended)**

Open the dev login page in a second tab as an existing user that the seed marks `isExternal: false`. Trigger SSO; the SSO callback re-attests the user. Verify in `audit_log` (via `docker compose exec server npx drizzle-kit studio` or psql) that no `auth.session_revoked` row was written (because the value didn't actually flip). Then manually toggle the user's `isExternal` in the DB to `true` and trigger another SSO login that lands on `isExternal=false`; verify a single `auth.session_revoked` row appears with metadata `{ reason: 'isExternal_flip', from: true, to: false }`.

- [ ] **Step 7: Commit**

```bash
git add server/routes/sso.ts
git commit -m "refactor(auth): SSO re-attestation path uses flipIsExternal for cascade"
```

---

### Task 9: Integration test — pre-flip JWT becomes revoked after flip (real Redis)

**Files:**
- Create: `server/services/auth/isExternalFlip.integration.test.ts`

This test exercises the cascade end-to-end against the real Redis instance available in the dev compose stack. It skips cleanly when Redis isn't reachable so the unit suite can run without it.

- [ ] **Step 1: Write the integration test**

```typescript
// server/services/auth/isExternalFlip.integration.test.ts
//
// Integration test for the full flip cascade. Hits real Redis (the dev
// compose stack) so we can assert that calling the production-wired
// flipIsExternal makes a previously-issued JWT's payload read as revoked.
//
// Skips when REDIS_URL is unset (e.g., a CI env without Redis).

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { eq } from 'drizzle-orm';

import { users } from '../../db/schema.js';
import { db } from '../../db.js';
import { isRevoked } from '../sessionRevocation.js';
import { flipIsExternal } from './index.js';

const REDIS_AVAILABLE = !!process.env.REDIS_URL;
const skipIfNoRedis = REDIS_AVAILABLE ? it : it.skip;

const USER_ID = 'integration-flip-user';

describe('flipIsExternal — Redis integration', () => {
  beforeAll(async () => {
    // Seed a user. Ignore conflict so re-runs are idempotent.
    try {
      await db.insert(users).values({
        id: USER_ID,
        email: 'integration-flip@x.test',
        name: 'Integration Flip',
        isExternal: false,
      });
    } catch {
      // Already exists from a prior run — fine. Reset state instead.
      await db.update(users).set({ isExternal: false }).where(eq(users.id, USER_ID));
    }
  });

  afterAll(async () => {
    await db.delete(users).where(eq(users.id, USER_ID));
  });

  skipIfNoRedis(
    'pre-flip JWT payload is not revoked; after flipIsExternal the same payload reads as revoked',
    async () => {
      const issuedAtSeconds = Math.floor(Date.now() / 1000) - 60;
      const preFlipPayload = { userId: USER_ID, jti: 'integration-jti-pre', iat: issuedAtSeconds };

      // Pre-flip: token must look valid.
      expect(await isRevoked(preFlipPayload)).toBe(false);

      // Trigger the flip — this should persist the new value, write the
      // audit row, and fire revokeUserSessions.
      const result = await flipIsExternal(USER_ID, true);
      expect(result.flipped).toBe(true);

      // Post-flip: the same payload (with iat older than the cutoff) is now
      // revoked because revokeUserSessions wrote a `auth:user:revoked_after:`
      // key in Redis.
      expect(await isRevoked(preFlipPayload)).toBe(true);
    }
  );
});
```

- [ ] **Step 2: Restart server (so it loads with Redis env)**

Run: `docker compose restart server`

- [ ] **Step 3: Run the integration test against the dev compose Redis**

Run: `docker compose exec -T server npm test -- services/auth/isExternalFlip.integration.test.ts --run`
Expected: PASS — pre-flip payload reads as not-revoked, post-flip reads as revoked.
If the test is skipped, it's because the server container's `REDIS_URL` isn't set; verify via `docker compose exec server printenv REDIS_URL`. If you want it to run, ensure `REDIS_URL` is in `docker-compose.yml`'s server env. (It typically is — check `services.server.environment`.)

- [ ] **Step 4: Commit**

```bash
git add server/services/auth/isExternalFlip.integration.test.ts
git commit -m "test(auth): integration — pre-flip JWT becomes revoked after flipIsExternal"
```

---

### Task 10: CHANGELOG entry

**Files:**
- Modify: `CHANGELOG.md`

- [ ] **Step 1: Add the Unreleased entry**

In `CHANGELOG.md`, append to the Unreleased section's existing Bundle A bullet (or add a new bullet under the same `### Added`):

```markdown
- **Bundle A slice 2 — `users.isExternal` flip revocation** (issue #67) — new `flipIsExternal(userId, nextValue)` helper in `services/auth/` writes the new flag value + an `auth.session_revoked` audit row in one transaction, then fires the Redis-backed session-and-refresh-token revocation cascade. No-op when the value is unchanged. The two SSO write sites (invite-claim path and existing-user re-attestation path in `routes/sso.ts`) now call the helper instead of inlining `db.update(users).set({ isExternal })`. Closes the staleness window between Azure re-attestation and JWT rotation; unblocks slice #71's deletion of the per-call `blockExternalUsers` middleware.
```

- [ ] **Step 2: Commit**

```bash
git add CHANGELOG.md
git commit -m "docs: changelog entry for users.isExternal flip-revocation cascade"
```

---

### Task 11: Run local CI

**Files:**
- None (verification only)

- [ ] **Step 1: Run scripts/ci.ps1**

Run: `powershell -File scripts/ci.ps1`

Expected: ALL GREEN (mod the pre-existing E2E drift the spawn task is tracking)
- typecheck: ✓
- test-server: ✓ (new isExternalFlip suites pass; existing routes + auth boundary suites pass)
- test-client: ✓ (no client changes)
- migrate: ✓ (no schema changes)
- e2e: pre-existing drift on main (22 failures unrelated to Bundle A) — note in PR body, do not block

- [ ] **Step 2: Open the PR**

```bash
git push -u origin feat/bundle-a-slice-2-flip-revocation
gh pr create --title "feat(auth): Bundle A slice 2 — revoke sessions on users.isExternal flip" --body "$(cat <<'EOF'
Closes #67 · Parent #65 · Builds on #66 (PR #73)

## Summary
- New `flipIsExternal(userId, nextValue)` helper in `server/services/auth/` — writes the new flag value + an `auth.session_revoked` audit row inside one transaction, then fires `revokeUserSessions` (which already cascades to the user's refresh-token families). No-op when the value is unchanged.
- Both SSO write sites in `server/routes/sso.ts` now call the helper instead of inlining `db.update(users).set({ isExternal })`:
  - L341 — invite-claim path (first SSO login of a pre-invited user)
  - L373–376 — existing-user re-attestation path (every SSO login)
- Helper uses the deps-injection seam pattern (`createFlipIsExternal({ db, revokeUserSessions })`) so unit tests can supply a PGLite DB + mock revoke; the production-wired closed-over function is exported from the `services/auth/` barrel.
- Three test files: unit (`isExternalFlip.test.ts` — flip both directions, idempotent no-flip, cascade invocation, missing-user error), and integration (`isExternalFlip.integration.test.ts` — real Redis round-trip; skips when `REDIS_URL` is unset).

## What this PR does NOT do
- Does not delete `blockExternalUsers` middleware — slice #71 owns that, after both #66 and this slice are merged.
- Does not migrate the `partner.invite` path — it INSERTs a new user with `isExternal: true`, no flip semantics.

## Test plan
- [x] `docker compose exec server npx tsc --noEmit -p .` — 0 errors
- [x] `docker compose exec server npm test` — all server suites pass
- [x] `docker compose exec client npm test` — all client suites pass
- [x] Integration test passes against dev compose Redis (or skips cleanly if Redis unset)
- [x] Manual smoke: re-attestation with no flag change writes no audit row; flag flip writes one `auth.session_revoked` row with `{ reason: 'isExternal_flip', from, to }` metadata
- [ ] Playwright E2E — pre-existing 22 failures on main, unrelated to this slice (see spawn task "Triage 22 failing E2E specs")

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## Self-Review Checklist (run before declaring plan complete)

**1. Spec coverage** — every issue #67 acceptance row has a task:

| Acceptance criterion | Task |
|---|---|
| Enumerate every codepath that writes `users.isExternal` | Pre-flight (sso.ts:341, sso.ts:375 — flip sites; sso.ts:353 INSERT and members.ts:243 INSERT — not flips, deliberately excluded with rationale) |
| Each enumerated codepath invokes the auth module's revocation cascade | Tasks 7, 8 |
| Atomically with the flag change (or in same txn boundary if applicable) | Task 2 step 4 (UPDATE + audit in one PG txn; cascade fires post-commit per D5) |
| Audit row `auth.session_revoked` with reason `isExternal_flip` | Task 2 (assertion in test; impl in step 4) |
| Boundary test extended (or new file) asserting full cascade | Tasks 2–5 (unit) + Task 9 (integration) |
| Both directions (internal↔external) trigger revocation | Task 2 step 1 (both directions covered in tests) |
| No regression in existing partner-removal-of-guest path | Task 7 step 4 + Task 8 step 4 (existing route tests must still pass) |
| `scripts/ci.ps1` passes | Task 11 |

**2. Placeholder scan** — no "TBD", no "implement later", no "similar to Task N", no generic "add error handling" — all code shown inline.

**3. Type consistency** — `FlipDeps` shape (`db`, `revokeUserSessions`), `FlipResult` shape (`flipped: boolean`), and `createFlipIsExternal(deps)` factory signature are identical across Task 1, Task 2 step 4, Task 6, and Task 9. Helper invocation `flipIsExternal(userId, nextValue)` is identical in Tasks 7 and 8 and Task 10.

**4. Open scope items surfaced (not silenced):**
- D5 (cascade order: DB-then-Redis, non-fatal Redis failure) is documented in pre-flight; tested by Task 4's "still returns flipped=true when revoke throws" case.
- The "full lifecycle integration" expectation from issue #67 is split: unit tests assert the cascade is *invoked* with mocks; the integration test (Task 9) asserts the cascade *takes effect* in real Redis. If you want to drop Task 9, document the gap in the PR body.

---

## End

Slice 2 ships: every `users.isExternal` write goes through one helper that owns the revocation cascade and audit trail. Slice #71 can now safely delete the `blockExternalUsers` middleware because no stale-token path survives a flip.
