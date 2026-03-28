# Remaining Fixes (Phase 3) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the remaining 28 review findings (#9-10, #12-13, #17, #19, #24-26, #28-46) — 10 high, 11 medium, 7 nitpick.

**Architecture:** Isolated fixes with tests. Each task touches 1-3 files. No schema migrations in this phase (schema changes are non-breaking additions/removals only where noted).

**Tech Stack:** TypeScript, Vitest, tRPC, Drizzle ORM, Redis, Zod, React/Zustand

---

## Batch A — High-Priority Remaining (10 items)

### Task 1: In-memory fallback rate limiter for Redis outage (#9)

**Files:**
- Modify: `server/routes/auth.ts` (lines 35-67)
- Test: `server/__tests__/rateLimiterFallback.test.ts`

The `redisRateLimit()` function fails open when Redis is unavailable. Add a local `Map`-based fallback.

- [ ] **Step 1: Write the test**

```ts
// server/__tests__/rateLimiterFallback.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'fs';
import path from 'path';

describe('Rate limiter fallback (#9)', () => {
  const authSource = fs.readFileSync(
    path.resolve(__dirname, '../routes/auth.ts'), 'utf-8'
  );

  it('has an in-memory fallback Map for rate limiting', () => {
    // Should define a Map-based fallback
    expect(authSource).toMatch(/new Map/);
    expect(authSource).toMatch(/fallback/i);
  });

  it('uses fallback when Redis is unavailable', () => {
    // The catch block or !pubClient branch should use fallback
    expect(authSource).toMatch(/fallbackRateLimit|memoryLimiter|localLimiter/);
  });

  it('fallback has TTL-based expiry', () => {
    // Should clean up stale entries
    expect(authSource).toMatch(/Date\.now|setTimeout|expire|ttl/i);
  });
});
```

- [ ] **Step 2: Run test — expect FAIL**

```bash
docker compose exec server npx vitest run __tests__/rateLimiterFallback.test.ts
```

- [ ] **Step 3: Implement in-memory fallback**

In `server/routes/auth.ts`, add before `redisRateLimit`:

```ts
// In-memory fallback rate limiter when Redis is unavailable
const memoryLimiter = new Map<string, { count: number; expiresAt: number }>();
const MEMORY_CLEANUP_INTERVAL = 60_000;

// Periodic cleanup of expired entries
setInterval(() => {
  const now = Date.now();
  for (const [key, val] of memoryLimiter) {
    if (val.expiresAt <= now) memoryLimiter.delete(key);
  }
}, MEMORY_CLEANUP_INTERVAL);

function fallbackRateLimit(key: string, maxAttempts: number, windowSecs: number): { allowed: boolean; retryAfterSecs: number } {
  const now = Date.now();
  const entry = memoryLimiter.get(key);

  if (entry && entry.expiresAt > now) {
    entry.count++;
    if (entry.count > maxAttempts) {
      return { allowed: false, retryAfterSecs: Math.ceil((entry.expiresAt - now) / 1000) };
    }
    return { allowed: true, retryAfterSecs: 0 };
  }

  memoryLimiter.set(key, { count: 1, expiresAt: now + windowSecs * 1000 });
  return { allowed: true, retryAfterSecs: 0 };
}
```

Then update both `!pubClient` and `catch` branches in `redisRateLimit` to use the fallback:

```ts
// Replace: next(); return;
// With:
const fallbackKey = `rate:${prefix}:${ip}`;
const result = fallbackRateLimit(fallbackKey, maxAttempts, AUTH_RATE_WINDOW_SECS);
if (!result.allowed) {
  res.set('Retry-After', String(result.retryAfterSecs));
  res.status(429).json({ error: 'Too many attempts. Please try again later.' });
  return;
}
next();
return;
```

- [ ] **Step 4: Run test — expect PASS**
- [ ] **Step 5: Commit**

```bash
git add server/routes/auth.ts server/__tests__/rateLimiterFallback.test.ts
git commit -m "fix: add in-memory fallback rate limiter for Redis outage (#9)"
```

---

### Task 2: Re-check platform step-up on switch-partner (#10)

**Files:**
- Modify: `server/routes/auth.ts` (lines 634-690)
- Test: `server/__tests__/switchPartnerStepUp.test.ts`

When a platform operator switches partner, `platformStepUpAt` from the old JWT is copied without re-checking freshness.

- [ ] **Step 1: Write the test**

```ts
// server/__tests__/switchPartnerStepUp.test.ts
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

describe('switch-partner step-up freshness (#10)', () => {
  const authSource = fs.readFileSync(
    path.resolve(__dirname, '../routes/auth.ts'), 'utf-8'
  );

  it('checks isPlatformStepUpSatisfied during switch-partner', () => {
    // The switch-partner handler should validate step-up freshness
    const switchBlock = authSource.slice(
      authSource.indexOf("'/switch-partner'"),
      authSource.indexOf("'/logout'")
    );
    expect(switchBlock).toMatch(/isPlatformStepUpSatisfied/);
  });

  it('clears platformStepUpAt if step-up expired', () => {
    const switchBlock = authSource.slice(
      authSource.indexOf("'/switch-partner'"),
      authSource.indexOf("'/logout'")
    );
    // If step-up is not satisfied, platformStepUpAt should be undefined/cleared
    expect(switchBlock).toMatch(/platformStepUpAt.*undefined|platformStepUpAt.*:.*isPlatformStepUpSatisfied/);
  });
});
```

- [ ] **Step 2: Run test — expect FAIL**

- [ ] **Step 3: Implement step-up check**

In `server/routes/auth.ts`, inside the switch-partner handler, after the partner status check (line 665), add step-up freshness check:

```ts
// After: if (membership.status !== 'active') { ... }
// Before: const token = buildAuthToken({ ... })

// Re-check platform step-up freshness — don't carry stale step-up across partner switch
const stepUpStillValid = req.user.isPlatformOperator
  ? isPlatformStepUpSatisfied(req.user.platformStepUpAt)
  : false;

const token = buildAuthToken({
    userId,
    role: membership.role,
    departments: (membership.departments as unknown[]) || [],
    partnerId: membership.partnerId,
    membershipId: membership.id,
    isPlatformOperator: req.user.isPlatformOperator,
    platformStepUpAt: stepUpStillValid ? req.user.platformStepUpAt : undefined,
});
```

- [ ] **Step 4: Run test — expect PASS**
- [ ] **Step 5: Commit**

```bash
git add server/routes/auth.ts server/__tests__/switchPartnerStepUp.test.ts
git commit -m "fix: re-check platform step-up freshness on partner switch (#10)"
```

---

### Task 3: Batch verifyAuditChain to prevent OOM (#12)

**Files:**
- Modify: `server/services/archive.ts` (lines 118-156)
- Test: `server/__tests__/archiveBatch.test.ts`

`verifyAuditChain` loads entire `audit_archive` table into memory.

- [ ] **Step 1: Write the test**

```ts
// server/__tests__/archiveBatch.test.ts
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

describe('verifyAuditChain batching (#12)', () => {
  const archiveSource = fs.readFileSync(
    path.resolve(__dirname, '../services/archive.ts'), 'utf-8'
  );

  it('uses batched pagination instead of loading all rows', () => {
    // Should have a BATCH_SIZE constant and loop
    expect(archiveSource).toMatch(/BATCH_SIZE|batchSize/);
  });

  it('uses .limit() in the query', () => {
    // Should limit rows fetched per iteration
    expect(archiveSource).toMatch(/\.limit\(/);
  });

  it('uses offset or keyset pagination', () => {
    // Should paginate via sequence comparison
    expect(archiveSource).toMatch(/gt\(.*sequence|\.offset\(|lastSequence|cursor/);
  });
});
```

- [ ] **Step 2: Run test — expect FAIL**

- [ ] **Step 3: Implement batched verification**

Replace the `verifyAuditChain` function in `server/services/archive.ts`:

```ts
const VERIFY_BATCH_SIZE = 10_000;

export async function verifyAuditChain(): Promise<{ valid: boolean; checked: number; brokenAt?: string }> {
  try {
    let prevHash = '0'.repeat(64);
    let checked = 0;
    let lastSequence = -1;

    while (true) {
      const rows = await db.select()
        .from(auditArchive)
        .where(gt(auditArchive.sequence, lastSequence))
        .orderBy(asc(auditArchive.sequence))
        .limit(VERIFY_BATCH_SIZE);

      if (rows.length === 0) break;

      for (const row of rows) {
        const rowData = {
          id: row.id,
          action: row.action,
          actorId: row.actorId,
          partnerId: row.partnerId,
          targetType: row.targetType,
          targetId: row.targetId,
          metadata: row.metadata,
          createdAt: row.createdAt,
        };

        const expected = computeChainHash(prevHash, rowData);
        checked++;

        if (expected !== row.chainHash) {
          logger.warn({ id: row.id, expected, actual: row.chainHash }, '[archive] Hash chain integrity violation');
          return { valid: false, checked, brokenAt: row.id };
        }

        prevHash = row.chainHash;
      }

      lastSequence = rows[rows.length - 1].sequence;

      // If we got fewer than BATCH_SIZE rows, we're done
      if (rows.length < VERIFY_BATCH_SIZE) break;
    }

    logger.info({ checked }, '[archive] Hash chain verified OK');
    return { valid: true, checked };
  } catch (err) {
    logger.error({ err }, '[archive] Failed to verify audit chain');
    return { valid: false, checked: 0 };
  }
}
```

Add `import { gt } from 'drizzle-orm';` if not already imported.

- [ ] **Step 4: Run test — expect PASS**
- [ ] **Step 5: Commit**

```bash
git add server/services/archive.ts server/__tests__/archiveBatch.test.ts
git commit -m "fix: batch verifyAuditChain to prevent OOM on large archives (#12)"
```

---

### Task 4: Move sentiment aggregation to SQL (#13)

**Files:**
- Modify: `server/trpc/routers/stats.ts` (lines 238-248)
- Test: `server/__tests__/statsSentimentSql.test.ts`

`getGlobalStats` loads all messages into memory for sentiment calculation.

- [ ] **Step 1: Write the test**

```ts
// server/__tests__/statsSentimentSql.test.ts
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

describe('Stats sentiment SQL aggregation (#13)', () => {
  const statsSource = fs.readFileSync(
    path.resolve(__dirname, '../trpc/routers/stats.ts'), 'utf-8'
  );

  it('uses SQL AVG for sentiment instead of loading all messages', () => {
    // Should use avg() or AVG in the query
    expect(statsSource).toMatch(/avg\(|AVG\(/);
  });

  it('does not select all message rows for sentiment', () => {
    // The old pattern: select all from messages then iterate
    // Should NOT have: db.select().from(messagesTable).where(inArray(messagesTable.ticketId, ...))
    // for sentiment computation specifically
    // Instead check that sentiment is computed via aggregate
    expect(statsSource).toMatch(/sentimentAvg|avgSentiment|sentiment.*avg/i);
  });
});
```

- [ ] **Step 2: Run test — expect FAIL**

- [ ] **Step 3: Replace in-memory sentiment with SQL aggregate**

In `server/trpc/routers/stats.ts`, replace the `liveMessages` block (lines 238-241) with a SQL aggregate:

```ts
// Replace:
// let liveMessages: RawMessageRow[] = [];
// if (liveTicketIds.length > 0) {
//   liveMessages = (await db.select().from(messagesTable).where(inArray(messagesTable.ticketId, liveTicketIds))) as unknown as RawMessageRow[];
// }

// With:
let sentimentAvg: number | null = null;
let sentimentCount = 0;
if (liveTicketIds.length > 0) {
  const sentimentResult = await db
    .select({
      avgSentiment: sql<number>`AVG(${messagesTable.sentiment})`,
      sentimentCount: sql<number>`COUNT(${messagesTable.sentiment})`,
    })
    .from(messagesTable)
    .where(
      and(
        inArray(messagesTable.ticketId, liveTicketIds),
        isNotNull(messagesTable.sentiment),
      )
    );
  sentimentAvg = sentimentResult[0]?.avgSentiment ?? null;
  sentimentCount = sentimentResult[0]?.sentimentCount ?? 0;
}
```

Then update the later code that iterates over `liveMessages` for sentiment to use `sentimentAvg` and `sentimentCount` directly. Any remaining `liveMessages` usage for non-sentiment purposes should be checked — if there is none, remove the variable entirely.

- [ ] **Step 4: Run test — expect PASS**
- [ ] **Step 5: Commit**

```bash
git add server/trpc/routers/stats.ts server/__tests__/statsSentimentSql.test.ts
git commit -m "fix: move sentiment aggregation to SQL AVG to prevent OOM (#13)"
```

---

### Task 5: Validate mediaUrl origin before rendering (#19)

**Files:**
- Modify: `client/src/components/MessageBubble.tsx` (lines 168-176)
- Test: `client/src/__tests__/mediaUrlValidation.test.ts`

`message.mediaUrl` rendered with no origin check.

- [ ] **Step 1: Write the test**

```ts
// client/src/__tests__/mediaUrlValidation.test.ts
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

describe('mediaUrl origin validation (#19)', () => {
  const bubbleSource = fs.readFileSync(
    path.resolve(__dirname, '../components/MessageBubble.tsx'), 'utf-8'
  );

  it('validates mediaUrl starts with /api/v1/uploads/', () => {
    expect(bubbleSource).toMatch(/mediaUrl.*startsWith.*\/api\/v1\/uploads\//);
  });

  it('adds referrerPolicy="no-referrer" to attachment img', () => {
    expect(bubbleSource).toMatch(/referrerPolicy.*no-referrer/);
  });
});
```

- [ ] **Step 2: Run test — expect FAIL**

- [ ] **Step 3: Implement validation**

In `client/src/components/MessageBubble.tsx`, change the media rendering block:

```tsx
// Replace:
// {message.mediaUrl && !isDeleted && (
//   <div className="mt-3 border border-border">
//     <img
//       src={message.mediaUrl}
//       alt="attachment"
//       className="w-full h-auto object-cover max-h-96"
//     />
//   </div>
// )}

// With:
{message.mediaUrl && !isDeleted && message.mediaUrl.startsWith('/api/v1/uploads/') && (
  <div className="mt-3 border border-border">
    <img
      src={message.mediaUrl}
      alt="attachment"
      className="w-full h-auto object-cover max-h-96"
      referrerPolicy="no-referrer"
    />
  </div>
)}
```

- [ ] **Step 4: Run test — expect PASS**
- [ ] **Step 5: Commit**

```bash
git add client/src/components/MessageBubble.tsx client/src/__tests__/mediaUrlValidation.test.ts
git commit -m "fix: validate mediaUrl origin and add referrerPolicy (#19)"
```

---

### Task 6: Move auth state from localStorage to sessionStorage (#24)

**Files:**
- Modify: `client/src/store/slices/authSlice.ts` (lines 60-99)
- Test: `client/src/__tests__/sessionStorageAuth.test.ts`

Full user object persisted in `localStorage` survives tab close on shared devices.

- [ ] **Step 1: Write the test**

```ts
// client/src/__tests__/sessionStorageAuth.test.ts
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

describe('Auth state uses sessionStorage (#24)', () => {
  const authSliceSource = fs.readFileSync(
    path.resolve(__dirname, '../store/slices/authSlice.ts'), 'utf-8'
  );

  it('uses sessionStorage instead of localStorage for user data', () => {
    // Should not use localStorage for user/memberships
    const userStorageCalls = authSliceSource.match(/localStorage\.(setItem|getItem|removeItem)\(['"]user['"]/g) || [];
    const membershipStorageCalls = authSliceSource.match(/localStorage\.(setItem|getItem|removeItem)\(['"]memberships['"]/g) || [];
    expect(userStorageCalls.length).toBe(0);
    expect(membershipStorageCalls.length).toBe(0);
  });

  it('uses sessionStorage for sensitive state', () => {
    expect(authSliceSource).toMatch(/sessionStorage/);
  });
});
```

- [ ] **Step 2: Run test — expect FAIL**

- [ ] **Step 3: Replace localStorage with sessionStorage**

In `client/src/store/slices/authSlice.ts`, replace all `localStorage` calls for `user`, `memberships`, `activeMembershipId`, and `activePartnerId` with `sessionStorage`. This is a global find-replace within the file:

Replace every `localStorage.setItem` → `sessionStorage.setItem`
Replace every `localStorage.getItem` → `sessionStorage.getItem`
Replace every `localStorage.removeItem` → `sessionStorage.removeItem`

- [ ] **Step 4: Run test — expect PASS**
- [ ] **Step 5: Commit**

```bash
git add client/src/store/slices/authSlice.ts client/src/__tests__/sessionStorageAuth.test.ts
git commit -m "fix: move auth state from localStorage to sessionStorage (#24)"
```

---

### Task 7: Include status field on presence reconnect (#25)

**Files:**
- Modify: `server/services/presence.ts` (lines 97-113)
- Test: `server/__tests__/presenceReconnect.test.ts`

The explorer found this is already fixed — the `else` branch at line 103 includes `status: 'available'` in the `hSet`. Verify and skip if confirmed.

- [ ] **Step 1: Write the test**

```ts
// server/__tests__/presenceReconnect.test.ts
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

describe('Presence reconnect includes status (#25)', () => {
  const presenceSource = fs.readFileSync(
    path.resolve(__dirname, '../services/presence.ts'), 'utf-8'
  );

  it('sets status to available in the reconnect branch', () => {
    // The else branch (existing connection) should set status
    const elseBlock = presenceSource.slice(
      presenceSource.indexOf('// Existing connection'),
      presenceSource.indexOf('await pipeline.exec()')
    );
    expect(elseBlock).toMatch(/status.*available/);
  });
});
```

- [ ] **Step 2: Run test — expect PASS (already fixed)**

If it passes, commit just the test as a regression test. If it fails, add `status: 'available'` to the `hSet` in the else branch.

- [ ] **Step 3: Commit**

```bash
git add server/__tests__/presenceReconnect.test.ts
git commit -m "test: add regression test for presence reconnect status (#25)"
```

---

### Task 8: Atomic repetition check via Lua script (#26)

**Files:**
- Modify: `server/services/repetitionStore.ts` (lines 12-27)
- Test: `server/__tests__/repetitionAtomic.test.ts`

Two separate Redis commands (get + incr) allow concurrent sends to bypass.

- [ ] **Step 1: Write the test**

```ts
// server/__tests__/repetitionAtomic.test.ts
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

describe('Repetition store atomicity (#26)', () => {
  const repSource = fs.readFileSync(
    path.resolve(__dirname, '../services/repetitionStore.ts'), 'utf-8'
  );

  it('uses a Lua script for atomic check-and-increment', () => {
    expect(repSource).toMatch(/eval|EVAL|lua|sendCommand/i);
  });

  it('does not have separate get-then-incr pattern', () => {
    // The old pattern: const storedText = await redisClient.get(key); ... await redisClient.incr(countKey);
    // Should not have both .get(key) and .incr(countKey) as separate calls
    const hasGetThenIncr = /await redisClient\.get\(key\)[\s\S]{1,200}await redisClient\.incr\(countKey\)/.test(repSource);
    expect(hasGetThenIncr).toBe(false);
  });
});
```

- [ ] **Step 2: Run test — expect FAIL**

- [ ] **Step 3: Replace with Lua script**

In `server/services/repetitionStore.ts`, replace lines 12-27 with:

```ts
// Lua script: atomic check-compare-increment
// KEYS[1] = rep:{senderId} (text key)
// KEYS[2] = rep:count:{senderId} (count key)
// ARGV[1] = text to compare
// ARGV[2] = TTL in seconds
// Returns: current count after operation
const LUA_CHECK_AND_COUNT = `
local stored = redis.call('GET', KEYS[1])
if stored == ARGV[1] then
  local count = redis.call('INCR', KEYS[2])
  redis.call('EXPIRE', KEYS[2], ARGV[2])
  return count
else
  redis.call('SET', KEYS[1], ARGV[1], 'EX', ARGV[2])
  redis.call('SET', KEYS[2], '1', 'EX', ARGV[2])
  return 1
end
`;

export async function getRepetitionCount(redisClient: ReturnType<typeof createClient> | null, senderId: string, text: string): Promise<number> {
  if (!redisClient) {
    return fallbackGet(senderId, text);
  }

  try {
    const key = `rep:${senderId}`;
    const countKey = `rep:count:${senderId}`;

    const result = await redisClient.eval(LUA_CHECK_AND_COUNT, {
      keys: [key, countKey],
      arguments: [text, String(REPETITION_TTL)],
    });

    return typeof result === 'number' ? result : Number(result) || 1;
  } catch (err) {
    logger.error({ err: err instanceof Error ? err.message : String(err) }, 'Redis repetition check failed, using fallback');
    return fallbackGet(senderId, text);
  }
}
```

- [ ] **Step 4: Run test — expect PASS**
- [ ] **Step 5: Commit**

```bash
git add server/services/repetitionStore.ts server/__tests__/repetitionAtomic.test.ts
git commit -m "fix: use Lua script for atomic repetition check (#26)"
```

---

### Task 9: Fix webhookDispatch setTimeout leak (#28)

**Files:**
- Modify: `server/services/webhookDispatch.ts` (lines 163-190)
- Test: `server/__tests__/webhookTimeoutLeak.test.ts`

The explorer found this is already correctly handled — `clearTimeout` is called on line 188 after successful fetch. However, if `validateWebhookUrl` throws (line 166), the timeout was created on line 173 after validation, so this may not be an issue. Let's verify the code flow and add `finally` if the timeout is created before the try.

- [ ] **Step 1: Write the test**

```ts
// server/__tests__/webhookTimeoutLeak.test.ts
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

describe('Webhook dispatch timeout cleanup (#28)', () => {
  const webhookSource = fs.readFileSync(
    path.resolve(__dirname, '../services/webhookDispatch.ts'), 'utf-8'
  );

  it('clears timeout in finally block or after every exit path', () => {
    // Should have clearTimeout in a finally block
    expect(webhookSource).toMatch(/finally[\s\S]*?clearTimeout/);
  });
});
```

- [ ] **Step 2: Run test — expect FAIL**

- [ ] **Step 3: Move clearTimeout to finally block**

In `server/services/webhookDispatch.ts`, wrap the fetch + clearTimeout in try/finally:

```ts
const controller = new AbortController();
const timeout = setTimeout(() => controller.abort(), 10000);

try {
  const res = await fetch(resolvedUrl.toString(), {
    method: 'POST',
    headers: { ... },
    body,
    signal: controller.signal,
  });
  // ... process response ...
} finally {
  clearTimeout(timeout);
}
```

- [ ] **Step 4: Run test — expect PASS**
- [ ] **Step 5: Commit**

```bash
git add server/services/webhookDispatch.ts server/__tests__/webhookTimeoutLeak.test.ts
git commit -m "fix: clear webhook timeout in finally block to prevent leaks (#28)"
```

---

### Task 10: Fix auth:expired reconnect loop (#31)

**Files:**
- Modify: `client/src/hooks/useSocket.ts` (lines 286-294)
- Test: `client/src/__tests__/authExpiredLoop.test.ts`

On `auth:expired`, socket disconnects and reconnects with the same expired JWT, causing a tight loop.

- [ ] **Step 1: Write the test**

```ts
// client/src/__tests__/authExpiredLoop.test.ts
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

describe('auth:expired handler prevents reconnect loop (#31)', () => {
  const socketSource = fs.readFileSync(
    path.resolve(__dirname, '../hooks/useSocket.ts'), 'utf-8'
  );

  it('calls logout on auth:expired instead of reconnecting', () => {
    const handler = socketSource.slice(
      socketSource.indexOf('handleAuthExpired'),
      socketSource.indexOf('// Attach all listeners')
    );
    // Should always logout, not disconnect+reconnect
    expect(handler).toMatch(/logout/);
    expect(handler).not.toMatch(/s\.disconnect\(\)[\s\S]{0,20}s\.connect\(\)/);
  });
});
```

- [ ] **Step 2: Run test — expect FAIL**

- [ ] **Step 3: Fix the handler**

In `client/src/hooks/useSocket.ts`, replace the `handleAuthExpired` function:

```ts
const handleAuthExpired = () => {
  const state = useStore.getState();
  // Always logout — reconnecting with same expired JWT causes a tight loop
  state.logout();
  s.disconnect();
  window.location.href = '/';
};
```

- [ ] **Step 4: Run test — expect PASS**
- [ ] **Step 5: Commit**

```bash
git add client/src/hooks/useSocket.ts client/src/__tests__/authExpiredLoop.test.ts
git commit -m "fix: prevent auth:expired reconnect loop by logging out (#31)"
```

---

## Batch B — Medium Priority (11 items)

### Task 11: Add audit log to MFA recovery code regeneration (#30)

**Files:**
- Modify: `server/trpc/routers/mfa.ts` (lines 230-236)
- Test: `server/__tests__/mfaRecoveryAudit.test.ts`

- [ ] **Step 1: Write the test**

```ts
// server/__tests__/mfaRecoveryAudit.test.ts
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

describe('MFA recovery code regeneration audit (#30)', () => {
  const mfaSource = fs.readFileSync(
    path.resolve(__dirname, '../trpc/routers/mfa.ts'), 'utf-8'
  );

  it('logs audit entry on recovery code regeneration', () => {
    // After regenerateRecoveryCodes mutation, should insert audit log
    const regenBlock = mfaSource.slice(
      mfaSource.indexOf('regenerateRecoveryCodes'),
      mfaSource.lastIndexOf('recoveryCodes: plain')
    );
    expect(regenBlock).toMatch(/auditLog/);
    expect(regenBlock).toMatch(/mfa_recovery_codes_regenerated/);
  });
});
```

- [ ] **Step 2: Run test — expect FAIL**

- [ ] **Step 3: Add audit log entry**

In `server/trpc/routers/mfa.ts`, after `db.update(users).set({ mfaRecoveryCodes: hashed })` (line 232) and before the logger.info, add:

```ts
await db.insert(auditLog).values({
  action: 'security.mfa_recovery_codes_regenerated',
  actorId: ctx.user.id,
  targetType: 'user',
  targetId: ctx.user.id,
  metadata: {},
});
```

- [ ] **Step 4: Run test — expect PASS**
- [ ] **Step 5: Commit**

```bash
git add server/trpc/routers/mfa.ts server/__tests__/mfaRecoveryAudit.test.ts
git commit -m "fix: add audit log entry for MFA recovery code regeneration (#30)"
```

---

### Task 12: Validate JWT payload with Zod (#32)

**Files:**
- Modify: `server/trpc/context.ts` (lines 9-19, 41)
- Modify: `server/middleware/auth.ts` (line 38)
- Test: `server/__tests__/jwtZodValidation.test.ts`

JWT uses `as JwtPayload` type assertion — no runtime validation.

- [ ] **Step 1: Write the test**

```ts
// server/__tests__/jwtZodValidation.test.ts
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

describe('JWT payload Zod validation (#32)', () => {
  const contextSource = fs.readFileSync(
    path.resolve(__dirname, '../trpc/context.ts'), 'utf-8'
  );
  const authSource = fs.readFileSync(
    path.resolve(__dirname, '../middleware/auth.ts'), 'utf-8'
  );

  it('defines a Zod schema for JWT payload in context.ts', () => {
    expect(contextSource).toMatch(/z\.object/);
    expect(contextSource).toMatch(/jwtPayloadSchema|JwtPayloadSchema/);
  });

  it('uses .parse() or .safeParse() on decoded JWT in context.ts', () => {
    expect(contextSource).toMatch(/\.parse\(decoded\)|\.safeParse\(decoded\)/);
  });

  it('uses Zod validation in auth middleware', () => {
    expect(authSource).toMatch(/\.parse\(decoded\)|\.safeParse\(decoded\)|jwtPayloadSchema/);
  });
});
```

- [ ] **Step 2: Run test — expect FAIL**

- [ ] **Step 3: Add Zod schema and use it**

In `server/trpc/context.ts`, add at top:

```ts
import { z } from 'zod';
```

Replace the `JwtPayload` interface with a Zod schema:

```ts
export const jwtPayloadSchema = z.object({
  userId: z.string(),
  role: z.string(),
  partnerId: z.string().optional(),
  membershipId: z.string().optional(),
  isPlatformOperator: z.boolean().optional(),
  platformStepUpAt: z.number().optional(),
  jti: z.string().optional(),
  iat: z.number().optional(),
  exp: z.number().optional(),
});

export type JwtPayload = z.infer<typeof jwtPayloadSchema>;
```

Replace `as JwtPayload` on line 41 with:

```ts
const decoded = jwtPayloadSchema.parse(jwt.verify(token, config.JWT_SECRET, { algorithms: ['HS256'] }));
```

In `server/middleware/auth.ts`, import and use the schema:

```ts
import { jwtPayloadSchema } from '../trpc/context.js';
```

Replace line 38:

```ts
const decoded = jwtPayloadSchema.parse(jwt.verify(token, config.JWT_SECRET, { algorithms: ['HS256'] }));
```

- [ ] **Step 4: Run test — expect PASS**
- [ ] **Step 5: Commit**

```bash
git add server/trpc/context.ts server/middleware/auth.ts server/__tests__/jwtZodValidation.test.ts
git commit -m "fix: validate JWT payload with Zod schema instead of type assertion (#32)"
```

---

### Task 13: Constrain presence setStatus to enum (#37)

**Files:**
- Modify: `server/trpc/routers/presence.ts` (line 26)
- Test: `server/__tests__/presenceStatusEnum.test.ts`

`status` accepts any string.

- [ ] **Step 1: Write the test**

```ts
// server/__tests__/presenceStatusEnum.test.ts
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

describe('Presence setStatus enum validation (#37)', () => {
  const presenceSource = fs.readFileSync(
    path.resolve(__dirname, '../trpc/routers/presence.ts'), 'utf-8'
  );

  it('constrains status to an enum of valid values', () => {
    expect(presenceSource).toMatch(/z\.enum\(\[.*available.*\]/);
  });

  it('does not accept arbitrary strings for status', () => {
    // Should NOT have: status: z.string()
    const statusLine = presenceSource.match(/status:\s*z\.string\(\)/);
    expect(statusLine).toBeNull();
  });
});
```

- [ ] **Step 2: Run test — expect FAIL**

- [ ] **Step 3: Replace z.string() with z.enum()**

In `server/trpc/routers/presence.ts`, line 26, change:

```ts
// From:
status: z.string(),
// To:
status: z.enum(['available', 'busy', 'away', 'offline']),
```

- [ ] **Step 4: Run test — expect PASS**
- [ ] **Step 5: Commit**

```bash
git add server/trpc/routers/presence.ts server/__tests__/presenceStatusEnum.test.ts
git commit -m "fix: constrain presence status to enum of valid values (#37)"
```

---

### Task 14: Add rate limit to logo upload endpoint (#38)

**Files:**
- Modify: `server/routes/logos.ts` (lines 69-73)
- Test: `server/__tests__/logoRateLimit.test.ts`

No rate limit on POST `/logos`.

- [ ] **Step 1: Write the test**

```ts
// server/__tests__/logoRateLimit.test.ts
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

describe('Logo upload rate limit (#38)', () => {
  const logosSource = fs.readFileSync(
    path.resolve(__dirname, '../routes/logos.ts'), 'utf-8'
  );

  it('applies rate limiting to POST endpoint', () => {
    expect(logosSource).toMatch(/rateLimit|rateLimiter|logoRateLimit/i);
  });

  it('imports rate limiting middleware', () => {
    expect(logosSource).toMatch(/import.*rateLimit|express-rate-limit|redisRateLimit/i);
  });
});
```

- [ ] **Step 2: Run test — expect FAIL**

- [ ] **Step 3: Add rate limit**

In `server/routes/logos.ts`, add rate limiting. Import `rateLimit` from `express-rate-limit`:

```ts
import rateLimit from 'express-rate-limit';

const logoRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 20, // 20 uploads per window
  message: { error: 'Too many logo uploads. Please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
});
```

Add middleware to POST route:

```ts
router.post('/', auth, logoRateLimit, (req: AuthRequest, res: Response) => {
```

- [ ] **Step 4: Run test — expect PASS**
- [ ] **Step 5: Commit**

```bash
git add server/routes/logos.ts server/__tests__/logoRateLimit.test.ts
git commit -m "fix: add rate limiting to logo upload endpoint (#38)"
```

---

### Task 15: Remove redundant dailyAiUsage index (#39)

**Files:**
- Modify: `server/db/schema.ts` (line 432)
- Test: `server/__tests__/redundantIndex.test.ts`

`datePartnerIdx` on `(date, partnerId)` is redundant given `uniqueDayKey` on `(date, partnerId, action, provider, model)`.

- [ ] **Step 1: Write the test**

```ts
// server/__tests__/redundantIndex.test.ts
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

describe('Redundant index removal (#39)', () => {
  const schemaSource = fs.readFileSync(
    path.resolve(__dirname, '../db/schema.ts'), 'utf-8'
  );

  it('does not have idx_daily_ai_usage_date_partner index', () => {
    expect(schemaSource).not.toMatch(/idx_daily_ai_usage_date_partner/);
  });

  it('still has the partner_date index for reverse lookups', () => {
    expect(schemaSource).toMatch(/idx_daily_ai_usage_partner_date/);
  });

  it('still has the unique composite index', () => {
    expect(schemaSource).toMatch(/idx_daily_ai_usage_unique/);
  });
});
```

- [ ] **Step 2: Run test — expect FAIL**

- [ ] **Step 3: Remove the redundant index**

In `server/db/schema.ts`, remove line 432:

```ts
// Remove this line:
datePartnerIdx: index('idx_daily_ai_usage_date_partner').on(table.date, table.partnerId),
```

- [ ] **Step 4: Run test — expect PASS**
- [ ] **Step 5: Commit**

```bash
git add server/db/schema.ts server/__tests__/redundantIndex.test.ts
git commit -m "fix: remove redundant dailyAiUsage date-partner index (#39)"
```

---

### Task 16: Add FK to archivedTickets.partnerId (#35)

**Files:**
- Modify: `server/db/schema.ts` (line 310)
- Test: `server/__tests__/archivedTicketsFk.test.ts`

Missing foreign key to `partners`.

- [ ] **Step 1: Write the test**

```ts
// server/__tests__/archivedTicketsFk.test.ts
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

describe('archivedTickets FK to partners (#35)', () => {
  const schemaSource = fs.readFileSync(
    path.resolve(__dirname, '../db/schema.ts'), 'utf-8'
  );

  it('has a foreign key reference from archivedTickets.partnerId to partners', () => {
    // Find the archivedTickets table definition and check for references
    const archivedBlock = schemaSource.slice(
      schemaSource.indexOf("pgTable('archived_tickets'"),
      schemaSource.indexOf('// ─── Knowledge Base')
    );
    expect(archivedBlock).toMatch(/partnerId.*references.*partners\.id/s);
  });
});
```

- [ ] **Step 2: Run test — expect FAIL**

- [ ] **Step 3: Add FK reference**

In `server/db/schema.ts`, line 310, change:

```ts
// From:
partnerId: text('partner_id').notNull(),
// To:
partnerId: text('partner_id').notNull().references(() => partners.id, { onDelete: 'restrict' }),
```

- [ ] **Step 4: Run test — expect PASS**
- [ ] **Step 5: Commit**

```bash
git add server/db/schema.ts server/__tests__/archivedTicketsFk.test.ts
git commit -m "fix: add foreign key from archivedTickets.partnerId to partners (#35)"
```

---

### Task 17: Wire DISABLE_RATE_LIMIT to auth rate limiter (#42)

**Files:**
- Modify: `server/routes/auth.ts` (lines 35-67)
- Test: `server/__tests__/disableRateLimitFlag.test.ts`

The `DISABLE_RATE_LIMIT` config flag doesn't affect the auth rate limiter.

- [ ] **Step 1: Write the test**

```ts
// server/__tests__/disableRateLimitFlag.test.ts
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

describe('DISABLE_RATE_LIMIT wired to auth limiter (#42)', () => {
  const authSource = fs.readFileSync(
    path.resolve(__dirname, '../routes/auth.ts'), 'utf-8'
  );

  it('checks DISABLE_RATE_LIMIT in redisRateLimit function', () => {
    const rateLimitFn = authSource.slice(
      authSource.indexOf('async function redisRateLimit'),
      authSource.indexOf('function loginRateLimit')
    );
    expect(rateLimitFn).toMatch(/DISABLE_RATE_LIMIT/);
  });
});
```

- [ ] **Step 2: Run test — expect FAIL**

- [ ] **Step 3: Add check**

In `server/routes/auth.ts`, at the top of `redisRateLimit` function (after line 41):

```ts
if (config.DISABLE_RATE_LIMIT) {
  next();
  return;
}
```

- [ ] **Step 4: Run test — expect PASS**
- [ ] **Step 5: Commit**

```bash
git add server/routes/auth.ts server/__tests__/disableRateLimitFlag.test.ts
git commit -m "fix: wire DISABLE_RATE_LIMIT config to auth rate limiter (#42)"
```

---

### Task 18: Trim Azure groups from SSO audit log (#45)

**Files:**
- Modify: `server/routes/sso.ts` (line 330)
- Test: `server/__tests__/ssoAuditTrim.test.ts`

Full Azure group GUIDs stored in audit metadata.

- [ ] **Step 1: Write the test**

```ts
// server/__tests__/ssoAuditTrim.test.ts
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

describe('SSO audit log trims Azure groups (#45)', () => {
  const ssoSource = fs.readFileSync(
    path.resolve(__dirname, '../routes/sso.ts'), 'utf-8'
  );

  it('logs groupCount instead of full azureGroups array', () => {
    expect(ssoSource).toMatch(/groupCount/);
  });

  it('does not store full azureGroups in audit metadata', () => {
    // Should not have: metadata: { email, azureGroups }
    expect(ssoSource).not.toMatch(/metadata.*azureGroups[^C]/);
  });
});
```

- [ ] **Step 2: Run test — expect FAIL**

- [ ] **Step 3: Trim the metadata**

In `server/routes/sso.ts`, line 330, change:

```ts
// From:
metadata: { email, azureGroups },
// To:
metadata: { email, groupCount: azureGroups.length },
```

- [ ] **Step 4: Run test — expect PASS**
- [ ] **Step 5: Commit**

```bash
git add server/routes/sso.ts server/__tests__/ssoAuditTrim.test.ts
git commit -m "fix: trim Azure groups from SSO audit log metadata (#45)"
```

---

### Task 19: Fix MFA TOTP input length inconsistency (#44)

**Files:**
- Modify: `server/trpc/routers/mfa.ts` (line 135)
- Test: `server/__tests__/mfaInputLength.test.ts`

`disable` uses `.min(6)` instead of `.length(6)` for TOTP code.

- [ ] **Step 1: Write the test**

```ts
// server/__tests__/mfaInputLength.test.ts
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

describe('MFA TOTP input length consistency (#44)', () => {
  const mfaSource = fs.readFileSync(
    path.resolve(__dirname, '../trpc/routers/mfa.ts'), 'utf-8'
  );

  it('uses consistent code length validation across all procedures', () => {
    // All code inputs should use .length(6) or .min(6).max(8) consistently
    const codeSchemas = mfaSource.match(/code: z\.string\(\)\.(length|min|max)\(\d+\)/g) || [];
    // None should be just .min(6) without .max()
    const unboundedMin = codeSchemas.filter(s => s.includes('.min(') && !mfaSource.includes(s + '.max('));
    // All should be .length(6)
    for (const schema of codeSchemas) {
      expect(schema).toMatch(/length\(6\)/);
    }
  });
});
```

- [ ] **Step 2: Run test — expect FAIL**

- [ ] **Step 3: Fix the input validation**

In `server/trpc/routers/mfa.ts`, line 135, change:

```ts
// From:
.input(z.object({ code: z.string().min(6), password: z.string().min(1) }))
// To:
.input(z.object({ code: z.string().length(6), password: z.string().min(1) }))
```

- [ ] **Step 4: Run test — expect PASS**
- [ ] **Step 5: Commit**

```bash
git add server/trpc/routers/mfa.ts server/__tests__/mfaInputLength.test.ts
git commit -m "fix: enforce consistent .length(6) on all MFA TOTP inputs (#44)"
```

---

### Task 20: Add try/catch to socket:identify DB queries (#46)

**Files:**
- Modify: `server/socket/handlers.ts` (lines 316-330)
- Test: `server/__tests__/socketIdentifyTryCatch.test.ts`

Unhandled rejection leaves socket in half-identified state.

- [ ] **Step 1: Write the test**

```ts
// server/__tests__/socketIdentifyTryCatch.test.ts
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

describe('socket:identify try/catch (#46)', () => {
  const handlersSource = fs.readFileSync(
    path.resolve(__dirname, '../socket/handlers.ts'), 'utf-8'
  );

  it('wraps socket:identify DB queries in try/catch', () => {
    // Find the socket:identify handler block
    const identifyBlock = handlersSource.slice(
      handlersSource.indexOf("'socket:identify'"),
      handlersSource.indexOf("'socket:identify'") + 3000
    );
    expect(identifyBlock).toMatch(/try\s*\{/);
    expect(identifyBlock).toMatch(/catch/);
  });

  it('disconnects socket on identify error', () => {
    const identifyBlock = handlersSource.slice(
      handlersSource.indexOf("'socket:identify'"),
      handlersSource.indexOf("'socket:identify'") + 3000
    );
    // The catch block should disconnect
    expect(identifyBlock).toMatch(/catch[\s\S]*?disconnect/);
  });
});
```

- [ ] **Step 2: Run test — check if already wrapped**

If the handler already has try/catch (many socket handlers do), this may pass. If not:

- [ ] **Step 3: Add try/catch**

Wrap the entire body of the `socket:identify` handler in a try/catch that emits an error and disconnects:

```ts
socket.on('socket:identify', async (data) => {
  try {
    // ... existing handler code ...
  } catch (err) {
    logger.error({ err: err instanceof Error ? err.message : String(err), socketId: socket.id }, '[socket] identify failed');
    socket.emit('error', { message: 'Identification failed' });
    socket.disconnect();
  }
});
```

- [ ] **Step 4: Run test — expect PASS**
- [ ] **Step 5: Commit**

```bash
git add server/socket/handlers.ts server/__tests__/socketIdentifyTryCatch.test.ts
git commit -m "fix: add try/catch to socket:identify to prevent half-identified state (#46)"
```

---

## Batch C — Nitpicks & Deferred (remaining items)

### Task 21: Replace Set with Record in ticketSlice unreadTickets (#40)

**Files:**
- Modify: `client/src/store/slices/ticketSlice.ts` (lines 6, 73-82)
- Test: `client/src/__tests__/unreadTicketsRecord.test.ts`

`Set` in Zustand state is a footgun with shallow equality.

- [ ] **Step 1: Write the test**

```ts
// client/src/__tests__/unreadTicketsRecord.test.ts
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

describe('unreadTickets uses Record instead of Set (#40)', () => {
  const ticketSliceSource = fs.readFileSync(
    path.resolve(__dirname, '../store/slices/ticketSlice.ts'), 'utf-8'
  );

  it('does not use Set for unreadTickets', () => {
    expect(ticketSliceSource).not.toMatch(/unreadTickets.*Set</);
    expect(ticketSliceSource).not.toMatch(/new Set/);
  });

  it('uses Record<string, boolean> for unreadTickets', () => {
    expect(ticketSliceSource).toMatch(/unreadTickets.*Record<string,\s*boolean>/);
  });
});
```

- [ ] **Step 2: Run test — expect FAIL**

- [ ] **Step 3: Refactor to Record**

In `client/src/store/slices/ticketSlice.ts`:
- Change type: `unreadTickets: Set<string>` → `unreadTickets: Record<string, boolean>`
- Change init: `new Set()` → `{}`
- Change add: `set.add(id)` → `{ ...prev, [id]: true }`
- Change delete: `set.delete(id)` → destructure and omit
- Change has: `set.has(id)` → `!!record[id]`
- Change size: `set.size` → `Object.keys(record).length`

- [ ] **Step 4: Run test — expect PASS**
- [ ] **Step 5: Commit**

```bash
git add client/src/store/slices/ticketSlice.ts client/src/__tests__/unreadTicketsRecord.test.ts
git commit -m "fix: replace Set with Record for unreadTickets in Zustand (#40)"
```

---

### Items intentionally deferred (not in this plan):

- **#17 (nextBoundary timezone)**: Explorer confirmed correct implementation with timezone conversion. Low risk.
- **#29 (SLA per-partner config in stats)**: Architectural change — stats computation would need SlaConfig injection per ticket. Better as a feature ticket.
- **#33 (savedViews.filters JSONB validation)**: Low risk — filters are only read by the creating user. Can be added when saved views get a UI.
- **#34 (SLA text→timestamp columns)**: Schema migration that requires data conversion. Better as a standalone migration ticket.
- **#36 (GDPR N+1 query)**: Performance optimization — only runs once daily. Better as a separate performance ticket.
- **#41 (Bearer token fallback)**: Removing it would break API clients. Needs migration plan.
- **#43 (24h JWT, no refresh)**: Architectural change — needs refresh token infrastructure. Feature ticket.

---

## Execution Order

1. Tasks 1-2 (auth.ts — rate limiter fallback + step-up check)
2. Task 3 (archive batching)
3. Task 4 (stats SQL aggregation)
4. Tasks 5-6 (client: mediaUrl + sessionStorage)
5. Task 7 (presence reconnect — likely just a test)
6. Tasks 8-9 (repetition Lua + webhook timeout)
7. Task 10 (auth:expired loop)
8. Tasks 11-12 (MFA audit + JWT Zod)
9. Tasks 13-15 (presence enum + logo rate limit + redundant index)
10. Tasks 16-20 (FK + config flag + SSO audit + MFA length + socket try/catch)
11. Task 21 (unreadTickets Record)
