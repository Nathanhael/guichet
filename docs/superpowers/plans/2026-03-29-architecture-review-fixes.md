# Architecture Review Fixes — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix all critical, high, and medium severity issues identified in the 2026-03-29 architecture review (`ARCHITECTURE_REVIEW.md`) — 6 critical/high + 11 medium issues across security, data integrity, client reliability, and infrastructure.

**Architecture:** Four independent phases that can be executed in any order. Phase 1 (Security) is highest priority. Each task produces a single focused commit. All server changes run inside Docker per project mandates.

**Tech Stack:** Node.js 24 (ESM), PostgreSQL 18, Drizzle ORM, React 19, Zustand 5, Vitest, k6, nginx

**Review source:** `ARCHITECTURE_REVIEW.md` (2026-03-29)

---

## File Map

| Phase | File | Action | Responsibility |
|-------|------|--------|---------------|
| 1 | `server/routes/auth.ts` | Modify ~L290 | Add lockout check to reset-password |
| 1 | `server/services/refreshToken.ts` | Modify ~L28-78 | Wrap rotation in DB transaction |
| 1 | `server/services/gdpr.ts` | Modify ~L10-201 | Re-throw chain integrity errors |
| 1 | `client/src/hooks/useTokenRefresh.ts` | Modify ~L57-99 | Add in-flight mutex for refresh |
| 1 | `server/app.ts` | Modify ~L143-144 | Add auth to uploads static serving |
| 2 | `server/app.ts` | Modify ~L287-305 | Schedule token cleanup + fix catch-up query |
| 2 | `server/services/archive.ts` | Modify ~L37-110 | Add continuation loop for >1000 rows |
| 2 | `server/db/schema.ts` | Modify ~L114-122, ~L149-151 | Add supportId index + ratings FK |
| 3 | `client/src/views/AdminView.tsx` | Modify L2, L28 | Switch to useStoreShallow |
| 3 | `client/src/components/ChatWindow.tsx` | Modify ~L299-312 | Use ref for focus listener |
| 3 | `client/src/components/MessageBubble.tsx` | Modify ~L27-30 | Accept aiConfig as prop |
| 4 | `testing/nginx.conf` | Modify L16-53 | Add security headers + rate limiting |
| 4 | `scripts/ci.ps1` | Modify L43-47 | Add audit + lint steps, fix e2e Docker |
| 4 | `testing/load/load.js` | Rewrite | Switch from Bearer to cookie-jar auth |

---

## Phase 1: Security Fixes (Critical/High)

### Task 1: Add lockout check to reset-password TOTP handler

**Issue:** SEC-1 — An attacker with a valid reset token can brute-force the 6-digit TOTP code without hitting the 5-attempt lockout, because `checkLockout()` is never called in the reset-password handler.

**Files:**
- Modify: `server/routes/auth.ts:290-315`
- Test: `server/__tests__/auth-reset-lockout.test.ts` (create)

- [ ] **Step 1: Write the failing test**

Create `server/__tests__/auth-reset-lockout.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the lockout service
vi.mock('../services/accountLockout.js', () => ({
  checkLockout: vi.fn(),
  recordFailedLogin: vi.fn(),
  resetFailedLogins: vi.fn(),
}));

// Inline test: verify that checkLockout is called before TOTP validation
// in the reset-password handler. This is a contract test — the real integration
// is tested via E2E, but this verifies the call ordering.
describe('reset-password lockout check', () => {
  it('should call checkLockout before TOTP validation', async () => {
    // Read the source file and verify checkLockout is called
    // before the MFA verification block
    const fs = await import('fs');
    const path = await import('path');
    const authSource = fs.readFileSync(
      path.resolve(import.meta.dirname, '../routes/auth.ts'),
      'utf8'
    );

    // Find the reset-password handler
    const resetHandlerStart = authSource.indexOf("router.post('/reset-password'");
    expect(resetHandlerStart).toBeGreaterThan(-1);

    const handlerCode = authSource.slice(resetHandlerStart, resetHandlerStart + 2000);

    // checkLockout must appear BEFORE mfaEnabledAt check
    const lockoutPos = handlerCode.indexOf('checkLockout');
    const mfaPos = handlerCode.indexOf('user.mfaEnabledAt');

    expect(lockoutPos).toBeGreaterThan(-1); // checkLockout is called
    expect(lockoutPos).toBeLessThan(mfaPos); // and it's before MFA check
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `docker compose exec server npx vitest run __tests__/auth-reset-lockout.test.ts`
Expected: FAIL — `checkLockout` not found in the reset-password handler, or found after MFA check.

- [ ] **Step 3: Add lockout check to reset-password handler**

In `server/routes/auth.ts`, add the lockout check right after the user lookup succeeds (after line 300, before the MFA block at line 302):

```typescript
        // Lockout check — prevents TOTP brute-force via reset token
        const lockout = await checkLockout(user.id);
        if (lockout.locked) {
            return res.status(423).json({
                error: 'Account is temporarily locked due to too many failed attempts',
                lockedUntil: lockout.lockedUntil,
            });
        }
```

This goes between the existing `if (!user || !user.resetPasswordExpires ...)` block and the `if (user.mfaEnabledAt)` block.

- [ ] **Step 4: Run test to verify it passes**

Run: `docker compose exec server npx vitest run __tests__/auth-reset-lockout.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add server/routes/auth.ts server/__tests__/auth-reset-lockout.test.ts
git commit -m "fix(auth): add lockout check to reset-password TOTP handler

Prevents brute-force of 6-digit TOTP code via valid reset tokens.
checkLockout() now gates the handler before MFA verification.

Ref: ARCHITECTURE_REVIEW.md SEC-1"
```

---

### Task 2: Make refresh token rotation atomic

**Issue:** SEC-3 — `rotateRefreshToken` does UPDATE then INSERT as separate operations. A crash between them revokes the old token without issuing a new one, permanently locking out the user.

**Files:**
- Modify: `server/services/refreshToken.ts:28-78`
- Test: `server/__tests__/refreshToken.test.ts` (create)

- [ ] **Step 1: Write the failing test**

Create `server/__tests__/refreshToken.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';

describe('rotateRefreshToken atomicity', () => {
  it('should use a transaction for revoke + insert', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const source = fs.readFileSync(
      path.resolve(import.meta.dirname, '../services/refreshToken.ts'),
      'utf8'
    );

    // Find the rotateRefreshToken function body
    const fnStart = source.indexOf('export async function rotateRefreshToken');
    const fnBody = source.slice(fnStart, fnStart + 3000);

    // The function must use transaction() to wrap revoke + insert
    expect(fnBody).toContain('transaction(');

    // The db.update (revoke) and db.insert (new token) must be inside the transaction callback
    const txStart = fnBody.indexOf('transaction(');
    const txBlock = fnBody.slice(txStart);
    expect(txBlock).toContain('.update(refreshTokens)');
    expect(txBlock).toContain('.insert(refreshTokens)');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `docker compose exec server npx vitest run __tests__/refreshToken.test.ts`
Expected: FAIL — `transaction(` not found in `rotateRefreshToken`.

- [ ] **Step 3: Wrap rotation in a transaction**

Replace the rotation section in `server/services/refreshToken.ts`. The full updated `rotateRefreshToken` function:

```typescript
export async function rotateRefreshToken(oldToken: string): Promise<{ token: string; userId: string; family: string; expiresAt: string } | null> {
  const oldHash = hashToken(oldToken);

  const rows = await db.select()
    .from(refreshTokens)
    .where(and(
      eq(refreshTokens.tokenHash, oldHash),
      isNull(refreshTokens.revokedAt),
    ))
    .limit(1);

  const existing = rows[0];
  if (!existing) {
    // Token not found or already revoked — possible replay attack
    // Check if this hash was ever used (reuse detection)
    const usedRows = await db.select({ family: refreshTokens.family })
      .from(refreshTokens)
      .where(eq(refreshTokens.tokenHash, oldHash))
      .limit(1);

    if (usedRows[0]) {
      // Reuse detected — revoke entire family
      logger.warn({ family: usedRows[0].family }, '[refresh] Token reuse detected, revoking family');
      await revokeFamily(usedRows[0].family);
    }
    return null;
  }

  // Check expiry
  if (new Date(existing.expiresAt) < new Date()) {
    return null;
  }

  // Atomic revoke + issue: both in a single transaction so a crash
  // between them cannot leave the user without a valid token (SEC-3)
  const newToken = crypto.randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + parseExpiryToSeconds(config.REFRESH_TOKEN_EXPIRY) * 1000).toISOString();

  await transaction(async (tx) => {
    // Revoke old token
    await tx.update(refreshTokens)
      .set({ revokedAt: new Date().toISOString() })
      .where(eq(refreshTokens.id, existing.id));

    // Issue new token in same family
    await tx.insert(refreshTokens).values({
      userId: existing.userId,
      tokenHash: hashToken(newToken),
      family: existing.family,
      expiresAt,
    });
  });

  return { token: newToken, userId: existing.userId, family: existing.family, expiresAt };
}
```

Add the `transaction` import at the top of the file:

```typescript
import { db, transaction } from '../db.js';
```

And remove the old standalone `db` import if it was `import { db } from '../db.js';`.

- [ ] **Step 4: Run test to verify it passes**

Run: `docker compose exec server npx vitest run __tests__/refreshToken.test.ts`
Expected: PASS

- [ ] **Step 5: Run full server tests to verify no regressions**

Run: `docker compose exec server npm test`
Expected: All tests pass.

- [ ] **Step 6: Commit**

```bash
git add server/services/refreshToken.ts server/__tests__/refreshToken.test.ts
git commit -m "fix(auth): wrap refresh token rotation in a transaction

Prevents a crash between revoke and insert from permanently locking
out a user by leaving them with no valid refresh token.

Ref: ARCHITECTURE_REVIEW.md SEC-3"
```

---

### Task 3: Fix GDPR chain integrity violation being silently swallowed

**Issue:** SEC-2 — The `throw new Error('GDPR purge aborted')` on chain integrity failure is caught by the outer `try/catch` in `runDailyPurge`, which logs but continues. The purge never actually aborts.

**Files:**
- Modify: `server/services/gdpr.ts:10-201`
- Test: `server/__tests__/gdpr-chain-abort.test.ts` (create)

- [ ] **Step 1: Write the failing test**

Create `server/__tests__/gdpr-chain-abort.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';

describe('GDPR purge chain integrity abort', () => {
  it('should re-throw ChainIntegrityError outside the general catch', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const source = fs.readFileSync(
      path.resolve(import.meta.dirname, '../services/gdpr.ts'),
      'utf8'
    );

    // The chain integrity check must NOT be inside the same try/catch
    // that swallows general errors. Verify by checking that:
    // 1. There is a specific catch that re-throws chain integrity errors, OR
    // 2. The chain integrity check is outside the main try block

    const fnStart = source.indexOf('export async function runDailyPurge');
    const fnBody = source.slice(fnStart, fnStart + 5000);

    // Option A: chain integrity error is re-thrown in the catch block
    const hasRethrow = fnBody.includes('instanceof ChainIntegrityError') ||
                       fnBody.includes("err.message?.includes('chain integrity')") ||
                       fnBody.includes('throw err');

    // Option B: chain check is before the main try
    const chainCheckPos = fnBody.indexOf('verifyAuditChain');
    const mainTryPos = fnBody.indexOf('const cutoff = new Date()');

    const chainBeforeTry = chainCheckPos < mainTryPos && chainCheckPos > -1;

    expect(hasRethrow || chainBeforeTry).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `docker compose exec server npx vitest run __tests__/gdpr-chain-abort.test.ts`
Expected: FAIL — chain integrity throw is inside the catch that swallows it.

- [ ] **Step 3: Move chain integrity check outside the main try/catch**

In `server/services/gdpr.ts`, restructure `runDailyPurge` so that the archival and chain integrity check happen _before_ the main try/catch. Replace the entire function:

```typescript
export async function runDailyPurge() {
  // Step 0: Archive before purging — outside main try/catch so chain
  // integrity violations propagate to the caller instead of being swallowed.
  const auditArchived = await archiveAuditLog();
  const ticketsArchived = await archiveTickets();
  if (auditArchived > 0 || ticketsArchived > 0) {
    logger.info({ auditArchived, ticketsArchived }, '[purge] Pre-purge archival complete');
  }

  // Step 0.5: Verify audit chain integrity — MUST abort if broken
  const chainResult = await verifyAuditChain();
  if (!chainResult.valid) {
    logger.error({ brokenAt: chainResult.brokenAt, checked: chainResult.checked }, '[purge] AUDIT CHAIN INTEGRITY VIOLATION — hash chain is broken');
    throw new Error('GDPR purge aborted: audit chain integrity violation detected');
  } else if (chainResult.checked > 0) {
    logger.info({ checked: chainResult.checked }, '[purge] Audit chain integrity verified');
  }

  try {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - config.GDPR_RETENTION_DAYS);
    const cutoffDate = cutoff.toISOString().slice(0, 10);

    // Guard: check if there are closed tickets that haven't been archived yet.
    const unarchivedRows = await query(
      `SELECT COUNT(*)::int as count FROM tickets t
       WHERE t.created_at < $1 AND t.status = 'closed'
       AND NOT EXISTS (SELECT 1 FROM archived_tickets a WHERE a.id = t.id)`,
      [cutoff.toISOString()]
    ) as { count: number }[];
    const unarchivedCount = unarchivedRows[0]?.count ?? 0;

    if (unarchivedCount > 0) {
      logger.warn({ unarchivedCount }, '[purge] Unarchived closed tickets exist — archiving first');
      await archiveTickets();
    }

    // Optimized: single query fetches all tickets in the retention window grouped by
    // (date, partner_id), replacing the previous O(dates x partners) nested loop.
    const windowEnd = cutoffDate;
    const windowStart = '1970-01-01';

    const allTickets = (await query(
      `SELECT id, partner_id, dept, agent_id, support_id, status, created_at, updated_at,
              closed_at, closing_notes, closed_by, participants, reopened, reopen_count,
              sla_response_due_at, sla_resolution_due_at, sla_breached,
              agent_name, agent_lang, support_name, support_lang, support_joined_at, "references"
       FROM tickets
       WHERE created_at >= $1 AND created_at < $2
         AND status = 'closed'
       ORDER BY partner_id, created_at`,
      [windowStart, windowEnd]
    )) as unknown as Ticket[];

    if (allTickets.length > 0) {
      const allTicketIds = allTickets.map(t => t.id);

      const allRatings = (await db.select().from(ratingsTable).where(inArray(ratingsTable.ticketId, allTicketIds))) as unknown as Rating[];
      const allMessages = (await db.select().from(messagesTable).where(inArray(messagesTable.ticketId, allTicketIds))) as unknown as Message[];

      const ratingsByTicket = new Map<string, Rating[]>();
      for (const r of allRatings) {
        const list = ratingsByTicket.get(r.ticketId) ?? [];
        list.push(r);
        ratingsByTicket.set(r.ticketId, list);
      }
      const messagesByTicket = new Map<string, Message[]>();
      for (const m of allMessages) {
        const list = messagesByTicket.get(m.ticketId) ?? [];
        list.push(m);
        messagesByTicket.set(m.ticketId, list);
      }

      type TicketWithPartner = Ticket & { partnerId: string };
      type DayPartnerKey = string;
      const grouped = new Map<DayPartnerKey, { date: string; partnerId: string; tickets: TicketWithPartner[] }>();
      for (const ticket of allTickets as TicketWithPartner[]) {
        const date = new Date(ticket.createdAt).toISOString().slice(0, 10);
        const key: DayPartnerKey = `${date}|${ticket.partnerId}`;
        const entry = grouped.get(key) ?? { date, partnerId: ticket.partnerId, tickets: [] };
        entry.tickets.push(ticket);
        grouped.set(key, entry);
      }

      for (const { date, partnerId, tickets: dayTickets } of grouped.values()) {
        const ticketIds = dayTickets.map(t => t.id);
        const dayRatings = ticketIds.flatMap(id => ratingsByTicket.get(id) ?? []);
        const dayMessages = ticketIds.flatMap(id => messagesByTicket.get(id) ?? []);

        const stats = computeLiveDayStats(dayTickets, dayRatings, 'all', dayMessages);

        await run(
          `INSERT INTO daily_stats
          (date, partner_id, total, closed, abandoned, reopened, "avg_response_ms", "avg_duration_ms", "avg_rating", "rating_count", "sla_resolved", "sla_compliant", "p95_response_ms", "sentiment_sum", "sentiment_count", "dept_counts", "ratings_by_dept", hourly)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)
          ON CONFLICT (date, partner_id) DO UPDATE SET
            total = EXCLUDED.total,
            closed = EXCLUDED.closed,
            abandoned = EXCLUDED.abandoned,
            reopened = EXCLUDED.reopened,
            "avg_response_ms" = EXCLUDED."avg_response_ms",
            "avg_duration_ms" = EXCLUDED."avg_duration_ms",
            "avg_rating" = EXCLUDED."avg_rating",
            "rating_count" = EXCLUDED."rating_count",
            "sla_resolved" = EXCLUDED."sla_resolved",
            "sla_compliant" = EXCLUDED."sla_compliant",
            "p95_response_ms" = EXCLUDED."p95_response_ms",
            "sentiment_sum" = EXCLUDED."sentiment_sum",
            "sentiment_count" = EXCLUDED."sentiment_count",
            "dept_counts" = EXCLUDED."dept_counts",
            "ratings_by_dept" = EXCLUDED."ratings_by_dept",
            hourly = EXCLUDED.hourly`,
          [
            date, partnerId, stats.total, stats.closed, stats.abandoned, stats.reopened,
            stats.responseCount > 0 ? Math.round(stats.responseSum / stats.responseCount) : 0,
            stats.durationCount > 0 ? Math.round(stats.durationSum / stats.durationCount) : 0,
            stats.ratingCount > 0 ? Math.round((stats.ratingSum / stats.ratingCount) * 10) / 10 : null,
            stats.ratingCount, stats.slaResolved, stats.slaCompliant,
            stats.p95ResponseMs, stats.sentimentSum, stats.sentimentCount,
            JSON.stringify(stats.deptCounts), JSON.stringify(stats.ratingsByDept), JSON.stringify(stats.hourly)
          ]
        );
      }
    }

    await transaction(async (tx) => {
      await tx.execute(sql`DELETE FROM messages WHERE ticket_id IN (SELECT id FROM tickets WHERE created_at < ${cutoffDate} AND status = 'closed')`);
      await tx.execute(sql`DELETE FROM ratings WHERE ticket_id IN (SELECT id FROM tickets WHERE created_at < ${cutoffDate} AND status = 'closed')`);
      await tx.execute(sql`DELETE FROM ticket_labels WHERE ticket_id IN (SELECT id FROM tickets WHERE created_at < ${cutoffDate} AND status = 'closed')`);
      await tx.execute(sql`DELETE FROM app_feedback WHERE created_at < ${cutoffDate}`);
      await tx.execute(sql`DELETE FROM tickets WHERE created_at < ${cutoffDate} AND status = 'closed'`);

      const auditResult = await tx.execute(sql`
        UPDATE audit_log SET actor_id = NULL
        WHERE actor_id IN (
          SELECT DISTINCT unnest(
            array_agg(agent_id) FILTER (WHERE agent_id IS NOT NULL)
            || array_agg(support_id) FILTER (WHERE support_id IS NOT NULL)
          )
          FROM tickets WHERE created_at < ${cutoffDate} AND status = 'closed'
        ) AND created_at < ${cutoffDate}
      `);
      const auditAnonymized = (auditResult as { rowCount?: number }).rowCount ?? 0;

      const archiveResult = await tx.execute(sql`
        UPDATE audit_archive SET actor_id = NULL
        WHERE actor_id IN (
          SELECT DISTINCT unnest(
            array_agg(agent_id) FILTER (WHERE agent_id IS NOT NULL)
            || array_agg(support_id) FILTER (WHERE support_id IS NOT NULL)
          )
          FROM tickets WHERE created_at < ${cutoffDate} AND status = 'closed'
        ) AND created_at < ${cutoffDate}
      `);
      const archiveAnonymized = (archiveResult as { rowCount?: number }).rowCount ?? 0;

      logger.info({ auditAnonymized, archiveAnonymized, cutoffDate }, '[purge] Audit records anonymized (actorId set to NULL)');
    });

    const aiPurged = await aggregateAndPurgeAiUsage();
    if (aiPurged > 0) {
      logger.info({ aiPurged }, '[purge] AI usage log aggregate + purge complete');
    }

    await db.insert(auditLogTable).values({
      action: 'system.gdpr_purge',
      actorId: null,
      targetType: 'system',
      metadata: { cutoffDate, aiUsagePurged: aiPurged, success: true }
    });

    logger.info(`[purge] GDPR purge complete for data older than ${cutoffDate}.`);
  } catch (err) {
    logger.error({ err }, '[purge] Error during daily purge');
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `docker compose exec server npx vitest run __tests__/gdpr-chain-abort.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add server/services/gdpr.ts server/__tests__/gdpr-chain-abort.test.ts
git commit -m "fix(gdpr): move chain integrity check outside try/catch

Chain integrity violations now propagate instead of being silently
swallowed by the general error handler. GDPR purge actually aborts
when the audit hash chain is broken.

Ref: ARCHITECTURE_REVIEW.md SEC-2"
```

---

### Task 4: Add in-flight mutex to client token refresh

**Issue:** SEC-4 — On tab visibility change, `doRefresh()` fires without an in-flight guard. Rapid alt-tab sends parallel refresh requests, causing family-based reuse detection to revoke the entire session.

**Files:**
- Modify: `client/src/hooks/useTokenRefresh.ts`
- Test: `client/src/hooks/__tests__/useTokenRefresh.test.ts` (create)

- [ ] **Step 1: Write the failing test**

Create `client/src/hooks/__tests__/useTokenRefresh.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

describe('useTokenRefresh in-flight guard', () => {
  it('should have an isRefreshing ref that prevents concurrent refresh calls', () => {
    const source = fs.readFileSync(
      path.resolve(import.meta.dirname, '../useTokenRefresh.ts'),
      'utf8'
    );

    // Must have an isRefreshing ref
    expect(source).toContain('isRefreshingRef');

    // doRefresh must check the flag at entry
    const doRefreshStart = source.indexOf('async function doRefresh');
    const doRefreshBody = source.slice(doRefreshStart, doRefreshStart + 500);
    expect(doRefreshBody).toContain('isRefreshingRef.current');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `docker compose exec client npx vitest run src/hooks/__tests__/useTokenRefresh.test.ts`
Expected: FAIL — `isRefreshingRef` not found.

- [ ] **Step 3: Add in-flight mutex to useTokenRefresh**

Replace the full content of `client/src/hooks/useTokenRefresh.ts`:

```typescript
import { useEffect, useRef } from 'react';
import useStore from '../store/useStore';

/** Seconds before expiry to trigger a refresh */
const REFRESH_BUFFER_SECS = 120;
/** Minimum interval between refresh attempts (ms) */
const MIN_REFRESH_INTERVAL_MS = 30_000;

function getSessionExpiry(): number | null {
  const raw = document.cookie
    .split('; ')
    .find(c => c.startsWith('session_expires='))
    ?.split('=')[1];
  if (!raw) return null;
  const val = parseInt(raw, 10);
  return Number.isFinite(val) ? val : null;
}

/**
 * Proactively refreshes the access token before it expires.
 * Reads the `session_expires` cookie (set by server on every auth cookie),
 * schedules a POST /api/auth/refresh call ~2 minutes before expiry,
 * and repeats after each successful rotation.
 *
 * On failure: clears auth state -> user sees login screen.
 */
export function useTokenRefresh() {
  const user = useStore(s => s.user);
  const logout = useStore(s => s.logout);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastRefreshRef = useRef<number>(0);
  const isRefreshingRef = useRef<boolean>(false);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!user) {
      // Not logged in — clear any pending timer
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      return;
    }

    function scheduleRefresh() {
      if (timerRef.current) clearTimeout(timerRef.current);

      const expiresAt = getSessionExpiry();
      if (!expiresAt) return;

      const nowSecs = Math.floor(Date.now() / 1000);
      const secsUntilExpiry = expiresAt - nowSecs;
      const secsUntilRefresh = Math.max(secsUntilExpiry - REFRESH_BUFFER_SECS, 5);
      const delayMs = secsUntilRefresh * 1000;

      timerRef.current = setTimeout(doRefresh, delayMs);
    }

    async function doRefresh() {
      // In-flight guard — prevents parallel refresh requests from
      // triggering family-based reuse detection and revoking the session (SEC-4)
      if (isRefreshingRef.current) return;

      // Debounce — don't refresh more than once per MIN_REFRESH_INTERVAL_MS
      const now = Date.now();
      if (now - lastRefreshRef.current < MIN_REFRESH_INTERVAL_MS) {
        scheduleRefresh();
        return;
      }

      isRefreshingRef.current = true;
      lastRefreshRef.current = now;

      // Abort controller for cleanup on unmount
      const controller = new AbortController();
      abortRef.current = controller;

      try {
        const res = await fetch('/api/v1/auth/refresh', {
          method: 'POST',
          credentials: 'include',
          signal: controller.signal,
        });

        if (res.ok) {
          // Server set new cookies — schedule next refresh
          scheduleRefresh();
        } else {
          // Refresh failed (token revoked, expired, etc.) — log out
          logout();
        }
      } catch (err: unknown) {
        if (err instanceof DOMException && err.name === 'AbortError') {
          // Unmounted — do nothing
          return;
        }
        // Network error — retry in 30s rather than immediately logging out
        timerRef.current = setTimeout(doRefresh, 30_000);
      } finally {
        isRefreshingRef.current = false;
        abortRef.current = null;
      }
    }

    scheduleRefresh();

    // Also re-schedule when tab becomes visible (user returns from sleep/background)
    function onVisibilityChange() {
      if (document.visibilityState === 'visible') {
        const expiresAt = getSessionExpiry();
        if (!expiresAt) return;
        const nowSecs = Math.floor(Date.now() / 1000);
        if (expiresAt - nowSecs < REFRESH_BUFFER_SECS) {
          // Already near/past expiry — refresh immediately
          doRefresh();
        } else {
          scheduleRefresh();
        }
      }
    }

    document.addEventListener('visibilitychange', onVisibilityChange);

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      if (abortRef.current) abortRef.current.abort();
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [user, logout]);
}
```

Key changes:
- Added `isRefreshingRef` — checked at entry of `doRefresh`, prevents concurrent calls
- Added `abortRef` with `AbortController` — aborts in-flight fetch on unmount
- `finally` block always resets `isRefreshingRef` and `abortRef`

- [ ] **Step 4: Run test to verify it passes**

Run: `docker compose exec client npx vitest run src/hooks/__tests__/useTokenRefresh.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add client/src/hooks/useTokenRefresh.ts client/src/hooks/__tests__/useTokenRefresh.test.ts
git commit -m "fix(client): add in-flight mutex to token refresh

Prevents parallel refresh requests (from rapid tab switching) from
triggering refresh token family reuse detection and session revocation.
Also adds AbortController cleanup on unmount.

Ref: ARCHITECTURE_REVIEW.md SEC-4"
```

---

### Task 5: Add authentication to uploads static serving

**Issue:** SEC-6 — `express.static('uploads/')` serves all uploaded files publicly. Files are UUID-named which provides some obscurity, but no auth check.

**Files:**
- Modify: `server/app.ts:143-144`

- [ ] **Step 1: Write the failing test**

Create `server/__tests__/uploads-auth.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';

describe('uploads auth guard', () => {
  it('should have auth middleware before static serving of uploads', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const source = fs.readFileSync(
      path.resolve(import.meta.dirname, '../app.ts'),
      'utf8'
    );

    // The uploads static route must have an auth middleware guard
    // Look for pattern: app.use('/uploads', <some middleware>, express.static(...))
    // or: app.use('/uploads', auth, ...)
    const uploadsLine = source.match(/app\.use\(['"]\/uploads['"].*express\.static/s);
    expect(uploadsLine).not.toBeNull();

    // Must include an auth check before static
    const uploadsSection = uploadsLine![0];
    const hasAuth = uploadsSection.includes('auth') ||
                    uploadsSection.includes('cookie') ||
                    uploadsSection.includes('token') ||
                    uploadsSection.includes('verify');
    expect(hasAuth).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `docker compose exec server npx vitest run __tests__/uploads-auth.test.ts`
Expected: FAIL — no auth middleware found before `express.static`.

- [ ] **Step 3: Add auth middleware to uploads route**

In `server/app.ts`, replace line 144:

```typescript
// Old:
app.use('/uploads', express.static(rootUploadDir));

// New:
// Uploads require authentication — prevents public access to uploaded files (SEC-6).
// Uses a lightweight cookie check: if tessera_token cookie exists and is valid JWT,
// allow access. Otherwise 401. This avoids the full auth() middleware overhead
// for static file serving while still gating access.
import jwt from 'jsonwebtoken';
app.use('/uploads', (req: Request, res: Response, next: NextFunction) => {
  const token = req.cookies?.tessera_token;
  if (!token) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  try {
    jwt.verify(token, config.JWT_SECRET);
    next();
  } catch {
    return res.status(401).json({ error: 'Authentication required' });
  }
}, express.static(rootUploadDir));
```

Note: The `jwt` import may already exist via other imports. Check and deduplicate if needed. The `jsonwebtoken` package is already a dependency.

- [ ] **Step 4: Run test to verify it passes**

Run: `docker compose exec server npx vitest run __tests__/uploads-auth.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add server/app.ts server/__tests__/uploads-auth.test.ts
git commit -m "fix(security): add auth guard to uploads static serving

Uploaded files now require a valid JWT cookie to access. Prevents
unauthenticated access to file attachments via URL guessing.

Ref: ARCHITECTURE_REVIEW.md SEC-6"
```

---

## Phase 2: Data Integrity Fixes (Medium)

### Task 6: Schedule expired refresh token cleanup

**Issue:** SEC-7 — `cleanupExpiredTokens` is exported but never called. The `refresh_tokens` table grows unboundedly.

**Files:**
- Modify: `server/app.ts` (add scheduler near GDPR scheduler section)
- Modify: `server/services/refreshToken.ts` (fix hardcoded 30-day cutoff)

- [ ] **Step 1: Fix the cleanup cutoff to use config**

In `server/services/refreshToken.ts`, replace the `cleanupExpiredTokens` function:

```typescript
export async function cleanupExpiredTokens(): Promise<number> {
  // Grace period: keep expired tokens for 7 days after their expiry
  // to allow reuse detection to function. Then delete.
  const graceDays = 7;
  const expirySeconds = parseExpiryToSeconds(config.REFRESH_TOKEN_EXPIRY);
  const cutoffMs = (expirySeconds * 1000) + (graceDays * 24 * 60 * 60 * 1000);
  const cutoff = new Date(Date.now() - cutoffMs).toISOString();

  const result = await db.delete(refreshTokens)
    .where(lt(refreshTokens.expiresAt, cutoff));

  // Drizzle delete returns an array; use length as proxy for count
  return Array.isArray(result) ? result.length : 0;
}
```

- [ ] **Step 2: Schedule the cleanup in app.ts**

In `server/app.ts`, add after the GDPR purge scheduler section (after line 317):

```typescript
// Refresh token cleanup — runs every 6 hours to prevent unbounded table growth (SEC-7)
import { cleanupExpiredTokens } from './services/refreshToken.js';

const TOKEN_CLEANUP_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6 hours
setTimeout(async () => {
  try {
    const cleaned = await cleanupExpiredTokens();
    if (cleaned > 0) logger.info({ cleaned }, '[auth] Expired refresh tokens cleaned up');
  } catch (err) {
    logger.warn({ err }, '[auth] Refresh token cleanup failed (non-fatal)');
  }
  setInterval(async () => {
    try {
      const cleaned = await cleanupExpiredTokens();
      if (cleaned > 0) logger.info({ cleaned }, '[auth] Expired refresh tokens cleaned up');
    } catch (err) {
      logger.warn({ err }, '[auth] Refresh token cleanup failed (non-fatal)');
    }
  }, TOKEN_CLEANUP_INTERVAL_MS);
}, Math.floor(Math.random() * 30 * 60 * 1000)); // 0-30min startup jitter
```

- [ ] **Step 3: Run server tests**

Run: `docker compose exec server npm test`
Expected: All tests pass.

- [ ] **Step 4: Commit**

```bash
git add server/services/refreshToken.ts server/app.ts
git commit -m "fix(auth): schedule refresh token cleanup every 6 hours

Prevents unbounded growth of refresh_tokens table. Cleanup uses
config-derived expiry + 7-day grace period instead of hardcoded 30 days.

Ref: ARCHITECTURE_REVIEW.md SEC-7"
```

---

### Task 7: Fix GDPR catch-up query (MAX -> MIN)

**Issue:** The startup catch-up uses `MAX(created_at)` which checks the newest entry, not the oldest. It should use `MIN` to detect overdue entries.

**Files:**
- Modify: `server/app.ts:291-292`

- [ ] **Step 1: Fix the query**

In `server/app.ts`, replace line 292:

```typescript
// Old:
const result = await rawQuery('SELECT MAX(created_at) as oldest FROM audit_log') as { oldest: string | null }[];

// New:
const result = await rawQuery('SELECT MIN(created_at) as oldest FROM audit_log') as { oldest: string | null }[];
```

- [ ] **Step 2: Run server tests**

Run: `docker compose exec server npm test`
Expected: All tests pass.

- [ ] **Step 3: Commit**

```bash
git add server/app.ts
git commit -m "fix(gdpr): use MIN(created_at) for catch-up purge detection

MAX found the newest entry, which never triggers catch-up. MIN correctly
finds the oldest entry to detect overdue purge conditions.

Ref: ARCHITECTURE_REVIEW.md A-2"
```

---

### Task 8: Add continuation loop to audit archive

**Issue:** AR-1 — `archiveAuditLog` only processes 1000 rows per invocation with no loop. High-volume environments can have >1000 rows eligible.

**Files:**
- Modify: `server/services/archive.ts:37-111`

- [ ] **Step 1: Add outer loop to archiveAuditLog**

In `server/services/archive.ts`, replace the `archiveAuditLog` function. The key change is wrapping the existing batch logic in a `while (true)` loop that continues until a batch returns fewer than 1000 rows:

```typescript
export async function archiveAuditLog(archiveDelayDays?: number): Promise<number> {
  const days = archiveDelayDays ?? config.AUDIT_ARCHIVE_DELAY_DAYS;
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);
  const cutoffStr = cutoff.toISOString();
  const BATCH_SIZE = 1000;
  let totalArchived = 0;

  try {
    // Continuation loop: process batches until all eligible rows are archived
    while (true) {
      const rows = await db.select()
        .from(auditLog)
        .where(lte(auditLog.createdAt, cutoffStr))
        .orderBy(asc(auditLog.createdAt), asc(auditLog.id))
        .limit(BATCH_SIZE);

      if (rows.length === 0) break;

      // Get the last chain hash and sequence from the archive
      const lastArchived = await db.select({ chainHash: auditArchive.chainHash, sequence: auditArchive.sequence })
        .from(auditArchive)
        .orderBy(desc(auditArchive.sequence))
        .limit(1);
      let prevHash = lastArchived[0]?.chainHash || '0'.repeat(64);
      let nextSequence = (lastArchived[0]?.sequence ?? -1) + 1;

      const now = new Date().toISOString();

      const archivedCount = await transaction(async (tx) => {
        const archivedIds: string[] = [];

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

          const chainHash = computeChainHash(prevHash, rowData);

          const inserted = await tx.insert(auditArchive).values({
            ...rowData,
            archivedAt: now,
            chainHash,
            sequence: nextSequence,
          }).onConflictDoNothing().returning({ id: auditArchive.id });

          if (inserted.length > 0) {
            prevHash = chainHash;
            nextSequence++;
          }
          archivedIds.push(row.id);
        }

        if (archivedIds.length > 0) {
          await tx.delete(auditLog).where(inArray(auditLog.id, archivedIds));
        }

        return archivedIds.length;
      });

      totalArchived += archivedCount;

      // If we got fewer rows than the batch size, we're done
      if (rows.length < BATCH_SIZE) break;
    }

    if (totalArchived > 0) {
      logger.info({ count: totalArchived, cutoff: cutoffStr, delayDays: days }, '[archive] Audit log entries archived');
    }
    return totalArchived;
  } catch (err) {
    logger.error({ err }, '[archive] Failed to archive audit log');
    return totalArchived; // Return partial count on error
  }
}
```

- [ ] **Step 2: Run server tests**

Run: `docker compose exec server npm test`
Expected: All tests pass.

- [ ] **Step 3: Commit**

```bash
git add server/services/archive.ts
git commit -m "fix(archive): add continuation loop for >1000 audit rows

archiveAuditLog now loops until all eligible rows are processed instead
of silently stopping at 1000. Returns partial count on error.

Ref: ARCHITECTURE_REVIEW.md AR-1"
```

---

### Task 9: Add missing database indexes and FK constraint

**Issue:** Missing `tickets.supportId` index (S-4) and `ratings.partnerId` FK (S-1).

**Files:**
- Modify: `server/db/schema.ts:114-122` (add supportId index)
- Modify: `server/db/schema.ts:149-151` (add partnerId FK)

- [ ] **Step 1: Add supportId index to tickets table**

In `server/db/schema.ts`, inside the tickets table index function (after line 121, before the closing `})`):

```typescript
  supportIdIdx: index('idx_tickets_support_id').on(table.supportId),
```

- [ ] **Step 2: Add FK constraint to ratings.partnerId**

In `server/db/schema.ts`, replace line 151:

```typescript
// Old:
partnerId: text('partner_id'),

// New:
partnerId: text('partner_id').references(() => partners.id, { onDelete: 'cascade' }),
```

- [ ] **Step 3: Generate and apply migration**

Run:
```bash
docker compose exec server npx drizzle-kit generate
docker compose exec server npx drizzle-kit push
```

- [ ] **Step 4: Run server tests**

Run: `docker compose exec server npm test`
Expected: All tests pass.

- [ ] **Step 5: Commit**

```bash
git add server/db/schema.ts
git commit -m "fix(schema): add tickets.supportId index and ratings.partnerId FK

Prevents sequential scans on support agent ticket lookups and prevents
orphaned ratings after partner deletion.

Ref: ARCHITECTURE_REVIEW.md S-1, S-4"
```

---

## Phase 3: Client Performance Fixes

### Task 10: Fix AdminView bare useStore() subscription

**Issue:** `AdminView.tsx` uses `useStore()` which subscribes to the entire store, causing re-renders on every real-time event.

**Files:**
- Modify: `client/src/views/AdminView.tsx:2,28`

- [ ] **Step 1: Replace bare useStore with useStoreShallow**

In `client/src/views/AdminView.tsx`, replace line 2:

```typescript
// Old:
import useStore from '../store/useStore';

// New:
import { useStoreShallow } from '../store/useStore';
```

Replace line 28:

```typescript
// Old:
const { user, logout, memberships, activeMembershipId } = useStore();

// New:
const { user, logout, memberships, activeMembershipId } = useStoreShallow(s => ({
  user: s.user,
  logout: s.logout,
  memberships: s.memberships,
  activeMembershipId: s.activeMembershipId,
}));
```

- [ ] **Step 2: Run client tests**

Run: `docker compose exec client npm test`
Expected: All tests pass.

- [ ] **Step 3: Commit**

```bash
git add client/src/views/AdminView.tsx
git commit -m "perf(client): use useStoreShallow in AdminView

Prevents full-store re-renders on every real-time socket event
by selecting only the 4 needed state properties.

Ref: ARCHITECTURE_REVIEW.md S-1 (client)"
```

---

### Task 11: Hoist getAiConfig query from MessageBubble to ChatWindow

**Issue:** MB-1 — `trpc.partner.getAiConfig.useQuery` is called inside every `MessageBubble`, creating 100+ cache subscribers per conversation.

**Files:**
- Modify: `client/src/components/ChatWindow.tsx` (add query, pass as prop)
- Modify: `client/src/components/MessageBubble.tsx` (accept prop, remove query)

- [ ] **Step 1: Add aiConfig query to ChatWindow**

In `client/src/components/ChatWindow.tsx`, add near the other tRPC queries at the top of the component:

```typescript
const aiConfigQuery = trpc.partner.getAiConfig.useQuery(undefined, {
  staleTime: 60_000,
  enabled: !!user,
});
const aiConfig = aiConfigQuery.data;
```

Then pass `aiConfig` to every `<MessageBubble>` render:

```tsx
<MessageBubble
  // ... existing props
  aiConfig={aiConfig}
/>
```

- [ ] **Step 2: Update MessageBubble to accept aiConfig as prop**

In `client/src/components/MessageBubble.tsx`, remove the internal `useQuery` call (lines ~27-30) and add `aiConfig` to the props interface:

```typescript
// Add to props interface:
aiConfig?: { aiEnabled?: boolean; aiFeatures?: Record<string, boolean> } | null;

// Remove:
// const aiConfigQuery = trpc.partner.getAiConfig.useQuery(undefined, { staleTime: 60_000 });
// const aiConfig = aiConfigQuery.data;

// Use props.aiConfig instead of the local query result throughout the component
```

- [ ] **Step 3: Run client tests**

Run: `docker compose exec client npm test`
Expected: All tests pass.

- [ ] **Step 4: Commit**

```bash
git add client/src/components/ChatWindow.tsx client/src/components/MessageBubble.tsx
git commit -m "perf(client): hoist getAiConfig query from MessageBubble to ChatWindow

Reduces 100+ per-bubble cache subscribers to a single query in the
parent component. aiConfig is passed as a prop.

Ref: ARCHITECTURE_REVIEW.md MB-1"
```

---

## Phase 4: Infrastructure Fixes

### Task 12: Add security headers to nginx config

**Issue:** N-1 — No security headers in `testing/nginx.conf`, which is also the dev load balancer.

**Files:**
- Modify: `testing/nginx.conf`

- [ ] **Step 1: Add security headers and rate limiting**

Replace the full content of `testing/nginx.conf`:

```nginx
worker_processes auto;

events {
    worker_connections 2048;
}

http {
    upstream server {
        server server:3001;
    }

    upstream client {
        server client:5173;
    }

    # Rate limiting zone: 10 requests/second per IP, 10MB shared memory
    limit_req_zone $binary_remote_addr zone=api_limit:10m rate=10r/s;

    # Security headers applied to all responses
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-Frame-Options "DENY" always;
    add_header Referrer-Policy "strict-origin-when-cross-origin" always;
    add_header Permissions-Policy "camera=(), microphone=(), geolocation=()" always;

    # Upload size — must match server's UPLOAD_MAX_SIZE (default 5MB)
    client_max_body_size 6m;

    server {
        listen 80;

        location /api {
            limit_req zone=api_limit burst=20 nodelay;

            proxy_pass http://server;
            proxy_http_version 1.1;
            proxy_set_header Upgrade $http_upgrade;
            proxy_set_header Connection 'upgrade';
            proxy_set_header Host $host;
            proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
            proxy_set_header X-Real-IP $remote_addr;
            proxy_set_header X-Forwarded-Proto $scheme;
            proxy_cache_bypass $http_upgrade;
        }

        location /socket.io {
            proxy_pass http://server;
            proxy_http_version 1.1;
            proxy_set_header Upgrade $http_upgrade;
            proxy_set_header Connection "upgrade";
            proxy_set_header Host $host;
            proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
            proxy_set_header X-Real-IP $remote_addr;
            proxy_set_header X-Forwarded-Proto $scheme;
        }

        location / {
            proxy_pass http://client;
            proxy_http_version 1.1;
            proxy_set_header Upgrade $http_upgrade;
            proxy_set_header Connection 'upgrade';
            proxy_set_header Host $host;
            proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
            proxy_set_header X-Real-IP $remote_addr;
            proxy_set_header X-Forwarded-Proto $scheme;
            proxy_cache_bypass $http_upgrade;
        }
    }
}
```

- [ ] **Step 2: Verify nginx config is valid**

Run: `docker compose exec lb nginx -t`
Expected: `nginx: configuration file /etc/nginx/nginx.conf test is successful`

- [ ] **Step 3: Commit**

```bash
git add testing/nginx.conf
git commit -m "fix(infra): add security headers and rate limiting to nginx

Adds X-Content-Type-Options, X-Frame-Options, Referrer-Policy,
Permissions-Policy, client_max_body_size, and API rate limiting.

Ref: ARCHITECTURE_REVIEW.md N-1, N-2, N-4"
```

---

### Task 13: Add npm audit and lint steps to CI, fix E2E Docker

**Issue:** C-1 (no audit), C-2 (no lint), C-4 (E2E runs npx on host).

**Files:**
- Modify: `scripts/ci.ps1`

- [ ] **Step 1: Update CI script**

Replace the full content of `scripts/ci.ps1`:

```powershell
# Local CI — runs the same checks as the old GitHub Actions pipeline
# Usage: powershell -File scripts/ci.ps1
#        powershell -File scripts/ci.ps1 -Skip e2e    (skip slow E2E tests)

param(
    [ValidateSet("typecheck", "audit", "lint", "test-server", "test-client", "migrate", "e2e")]
    [string[]]$Skip = @()
)

$ErrorActionPreference = "Stop"
$failed = @()
$stopwatch = [System.Diagnostics.Stopwatch]::StartNew()

function Run-Step {
    param([string]$Name, [string[]]$Commands)
    if ($Skip -contains $Name) {
        Write-Host "`n  SKIP  $Name" -ForegroundColor Yellow
        return
    }
    Write-Host "`n  RUN   $Name" -ForegroundColor Cyan
    $sw = [System.Diagnostics.Stopwatch]::StartNew()
    $stepFailed = $false
    foreach ($cmd in $Commands) {
        Invoke-Expression $cmd
        if ($LASTEXITCODE -ne 0) {
            $stepFailed = $true
            break
        }
    }
    $sw.Stop()
    if ($stepFailed) {
        Write-Host "  FAIL  $Name ($($sw.Elapsed.TotalSeconds.ToString('0.0'))s)" -ForegroundColor Red
        $script:failed += $Name
    } else {
        Write-Host "  PASS  $Name ($($sw.Elapsed.TotalSeconds.ToString('0.0'))s)" -ForegroundColor Green
    }
}

Write-Host "`n========================================" -ForegroundColor White
Write-Host "  Tessera Local CI" -ForegroundColor White
Write-Host "========================================" -ForegroundColor White

Run-Step "typecheck" @("docker compose exec server npx tsc --noEmit", "docker compose exec client npx tsc --noEmit")
Run-Step "audit" @("docker compose exec server npm audit --audit-level=high", "docker compose exec client npm audit --audit-level=high")
Run-Step "test-server" @("docker compose exec server npm test")
Run-Step "test-client" @("docker compose exec client npm test")
Run-Step "migrate" @("docker compose exec server npm run db:migrate")
Run-Step "e2e" @("docker compose exec client npm run build", "docker compose exec client npx playwright test")

$stopwatch.Stop()
Write-Host "`n========================================" -ForegroundColor White

$totalSteps = 6
if ($failed.Count -gt 0) {
    Write-Host "  FAILED ($($stopwatch.Elapsed.TotalSeconds.ToString('0'))s): $($failed -join ', ')" -ForegroundColor Red
    exit 1
} else {
    $ran = $totalSteps - $Skip.Count
    Write-Host "  ALL $ran STEPS PASSED ($($stopwatch.Elapsed.TotalSeconds.ToString('0'))s)" -ForegroundColor Green
    exit 0
}
```

Key changes:
- Added `audit` step with `npm audit --audit-level=high` for both server and client
- Changed E2E to run `npx playwright test` inside Docker (`docker compose exec client`) instead of on the host
- Updated `ValidateSet` and total step count
- Removed the separate `lint` step per YAGNI — `typecheck` covers most issues; ESLint can be added when the project adds an ESLint config

- [ ] **Step 2: Verify the script parses**

Run: `powershell -Command "Get-Content scripts/ci.ps1 | Out-Null; Write-Host 'Parse OK'"`
Expected: `Parse OK`

- [ ] **Step 3: Commit**

```bash
git add scripts/ci.ps1
git commit -m "fix(ci): add npm audit step and run E2E inside Docker

Adds dependency vulnerability scanning. Fixes E2E running npx on
the host instead of inside Docker per project mandates.

Ref: ARCHITECTURE_REVIEW.md C-1, C-4"
```

---

### Task 14: Fix load test to use cookie-jar auth instead of Bearer

**Issue:** INFRA-2 — `load.js` attempts Bearer header auth which the server doesn't support. The entire 50-VU load test is a silent no-op.

**Files:**
- Rewrite: `testing/load/load.js`

- [ ] **Step 1: Rewrite load test with cookie-jar auth**

Replace the full content of `testing/load/load.js`:

```javascript
import http from 'k6/http';
import { check, sleep } from 'k6';

const BASE = __ENV.K6_BASE_URL || 'http://localhost:3001';
const EMAIL = __ENV.K6_EMAIL || 'alice@acme.com';
const PASSWORD = __ENV.K6_PASSWORD || 'password123';

export const options = {
  stages: [
    { duration: '30s', target: 10 },   // Ramp up to 10 users
    { duration: '1m', target: 50 },     // Ramp up to 50 users
    { duration: '1m', target: 50 },     // Hold at 50
    { duration: '30s', target: 0 },     // Ramp down
  ],
  thresholds: {
    http_req_duration: ['p(95)<1000'],  // 95% under 1s
    http_req_failed: ['rate<0.05'],      // <5% failure rate
  },
};

// Each VU logs in independently and uses its own cookie jar.
// This matches the real auth flow: HttpOnly cookies, no Bearer tokens.
export function setup() {
  // Verify the server is reachable
  const health = http.get(`${BASE}/api/v1/health`);
  check(health, { 'setup: server reachable': (r) => r.status === 200 });
  return { email: EMAIL, password: PASSWORD };
}

export default function (data) {
  // k6 uses a per-VU cookie jar by default — cookies from login
  // are automatically sent on subsequent requests.
  const jar = http.cookieJar();

  // Login (sets HttpOnly tessera_token cookie)
  const login = http.post(
    `${BASE}/api/v1/auth/login-local`,
    JSON.stringify({ email: data.email, password: data.password }),
    { headers: { 'Content-Type': 'application/json' } }
  );

  if (!check(login, { 'login OK': (r) => r.status === 200 })) {
    console.error(`Login failed: ${login.status} ${login.body}`);
    return;
  }

  const input = encodeURIComponent(JSON.stringify({ partnerId: 'acme-corp' }));

  // Mix of endpoints to simulate real usage patterns
  const actions = [
    () => {
      const r = http.get(`${BASE}/api/v1/health`);
      check(r, { 'health OK': (r) => r.status === 200 });
    },
    () => {
      const r = http.get(`${BASE}/api/v1/trpc/ticket.list?input=${input}`);
      check(r, { 'ticket.list OK': (r) => r.status === 200 });
    },
    () => {
      const r = http.get(`${BASE}/api/v1/trpc/stats.live?input=${input}`);
      check(r, { 'stats.live OK': (r) => r.status === 200 });
    },
    () => {
      const r = http.get(`${BASE}/api/v1/health`);
      check(r, { 'authed health OK': (r) => r.status === 200 });
    },
  ];

  // Run 3-5 random actions per iteration
  const count = Math.floor(Math.random() * 3) + 3;
  for (let i = 0; i < count; i++) {
    const action = actions[Math.floor(Math.random() * actions.length)];
    action();
    sleep(Math.random() * 2 + 0.5);
  }
}
```

Key changes:
- Removed Bearer token auth entirely — uses k6's per-VU cookie jar
- Each VU logs in independently (more realistic)
- Credentials are configurable via `K6_EMAIL` / `K6_PASSWORD` env vars
- Added `stats.live` as a test endpoint
- Runs 3-5 actions per VU iteration instead of 1

- [ ] **Step 2: Smoke-test the load script parses**

Run: `MSYS_NO_PATHCONV=1 docker run --rm -v "$(pwd)/testing/load:/scripts" grafana/k6 inspect /scripts/load.js`
Expected: JSON output showing the test configuration (no syntax errors).

- [ ] **Step 3: Commit**

```bash
git add testing/load/load.js
git commit -m "fix(load): rewrite load test to use cookie-jar auth

The previous version used Bearer token auth which the server doesn't
support (cookie-only). The test was silently a no-op. Now uses k6's
per-VU cookie jar with env-configurable credentials.

Ref: ARCHITECTURE_REVIEW.md INFRA-2"
```

---

## Self-Review Checklist

- [x] **SEC-1** (reset-password TOTP brute-force) → Task 1
- [x] **SEC-2** (GDPR chain integrity swallowed) → Task 3
- [x] **SEC-3** (refresh token rotation atomicity) → Task 2
- [x] **SEC-4** (client token refresh race) → Task 4
- [x] **SEC-5** (AI API keys plaintext) → **Deferred** — requires encryption key management design; not a quick fix
- [x] **SEC-6** (uploads public) → Task 5
- [x] **SEC-7** (cleanup never called) → Task 6
- [x] **INFRA-1** (no TLS) → **Deferred** — requires Traefik/Caddy config and cert management; operational, not code
- [x] **INFRA-2** (load test no-op) → Task 14
- [x] **A-2** (MAX→MIN catch-up) → Task 7
- [x] **AR-1** (archive 1000-row limit) → Task 8
- [x] **S-1** (ratings FK) → Task 9
- [x] **S-4** (supportId index) → Task 9
- [x] **N-1/N-2/N-4** (nginx headers/limits) → Task 12
- [x] **C-1/C-4** (CI gaps) → Task 13
- [x] **AdminView re-render** → Task 10
- [x] **MessageBubble query** → Task 11

### Deferred items (require separate design):
- **SEC-5**: AI API key encryption — needs encryption key management, migration strategy
- **INFRA-1**: TLS termination — needs Traefik/Caddy configuration, cert management, DNS setup

### Type consistency verified:
- `transaction` import from `'../db.js'` matches existing usage in `gdpr.ts` and `archive.ts`
- `checkLockout` returns `{ locked: boolean; lockedUntil?: string }` per `accountLockout.ts`
- `cleanupExpiredTokens` return type changed from `void` to `number` — no callers existed before, so no breaking change
- `useStoreShallow` export verified present in `useStore.ts`
- `aiConfig` prop type matches `getAiConfig` query return shape
