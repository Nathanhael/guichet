# Ticket List Performance Fixes — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminate a redundant database query on every ticket list call for support users by propagating JWT departments into the tRPC context.

**Architecture:** Two-file change. Add `departments` to the `TRPCUser` interface and map it from the decoded JWT in `createContext`. Then replace the `memberships` table lookup in `ticket.list` with `ctx.user.departments`. Remove the now-unused `memberships` import.

**Tech Stack:** TypeScript, Drizzle ORM, tRPC 11, Vitest

**Spec:** `docs/superpowers/specs/2026-03-29-ticket-list-perf-design.md`

---

### Task 1: Add `departments` to TRPCUser interface and context mapping

**Files:**
- Modify: `server/trpc/context.ts:25-35` (TRPCUser interface)
- Modify: `server/trpc/context.ts:48-58` (createContext user mapping)

- [ ] **Step 1: Add `departments` field to TRPCUser interface**

In `server/trpc/context.ts`, add `departments` after `membershipId` in the interface:

```typescript
export interface TRPCUser {
  id: string;
  role: UserRole;
  partnerId?: string;
  membershipId?: string;
  departments?: string[];
  isPlatformOperator: boolean;
  platformStepUpAt?: number;
  tokenJti?: string;
  tokenExp?: number;
  tokenIat?: number;
}
```

- [ ] **Step 2: Map departments from decoded JWT into user object**

In the same file, in the `createContext` function, add `departments` to the user object construction (after `membershipId`):

```typescript
user = {
  id: decoded.userId,
  role: decoded.role as UserRole,
  partnerId: decoded.partnerId,
  membershipId: decoded.membershipId,
  departments: Array.isArray(decoded.departments)
    ? (decoded.departments as string[])
    : [],
  isPlatformOperator: isPlatformAdmin(!!decoded.isPlatformOperator),
  platformStepUpAt: decoded.platformStepUpAt,
  tokenJti: decoded.jti,
  tokenExp: decoded.exp,
  tokenIat: decoded.iat,
};
```

- [ ] **Step 3: Verify typecheck passes**

Run:
```bash
docker compose exec server npx tsc --noEmit
```
Expected: No errors. The new field is optional (`departments?: string[]`), so all existing code remains valid.

- [ ] **Step 4: Commit**

```bash
git add server/trpc/context.ts
git commit -m "feat: add departments to TRPCUser context from JWT payload"
```

---

### Task 2: Replace membership query with context departments in ticket.list

**Files:**
- Modify: `server/trpc/routers/ticket.ts:4` (remove `memberships` from import)
- Modify: `server/trpc/routers/ticket.ts:58-69` (department isolation block)

- [ ] **Step 1: Replace the department isolation block**

In `server/trpc/routers/ticket.ts`, find lines 58-69:

```typescript
// H-6: Department isolation for support users with assigned departments
// Empty/null departments = generalist (sees all). Admin and platform_operator are not restricted.
if (!ctx.user.isPlatformOperator && ctx.user.role === 'support' && ctx.user.membershipId) {
  const membershipRow = await db.select({ departments: memberships.departments })
    .from(memberships)
    .where(eq(memberships.id, ctx.user.membershipId))
    .limit(1);
  const depts = membershipRow[0]?.departments as string[] | null | undefined;
  if (Array.isArray(depts) && depts.length > 0) {
    conditions.push(inArray(tickets.dept, depts));
  }
}
```

Replace with:

```typescript
// H-6: Department isolation for support users with assigned departments
// Empty/null departments = generalist (sees all). Admin and platform_operator are not restricted.
// Departments sourced from JWT context (refreshed on token rotation, max staleness = ACCESS_TOKEN_EXPIRY).
if (!ctx.user.isPlatformOperator && ctx.user.role === 'support') {
  const depts = ctx.user.departments;
  if (Array.isArray(depts) && depts.length > 0) {
    conditions.push(inArray(tickets.dept, depts));
  }
}
```

- [ ] **Step 2: Remove `memberships` from the import**

In `server/trpc/routers/ticket.ts`, line 4, change:

```typescript
import { tickets, ticketLabels, memberships } from '../../db/schema.js';
```

to:

```typescript
import { tickets, ticketLabels } from '../../db/schema.js';
```

- [ ] **Step 3: Verify typecheck passes**

Run:
```bash
docker compose exec server npx tsc --noEmit
```
Expected: No errors. `memberships` is no longer referenced anywhere in this file.

- [ ] **Step 4: Run existing server tests**

Run:
```bash
docker compose exec server npm test
```
Expected: All existing tests pass. No tests directly exercise the department isolation path in the tRPC router (confirmed via test audit), so this change won't break existing tests.

- [ ] **Step 5: Commit**

```bash
git add server/trpc/routers/ticket.ts
git commit -m "perf: use JWT departments in ticket.list instead of DB query

Removes per-request membership lookup for support users.
Department data is already present in the JWT payload."
```

---

### Task 3: Add regression test for department isolation

**Files:**
- Create: `server/__tests__/trpc/routers/ticketListDepts.test.ts`

- [ ] **Step 1: Write the test file**

Create `server/__tests__/trpc/routers/ticketListDepts.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * Source-level regression tests ensuring ticket.list uses JWT context
 * for department isolation — not a redundant DB query.
 */
describe('ticket.list department isolation', () => {
  const source = readFileSync(
    join(__dirname, '../../../trpc/routers/ticket.ts'),
    'utf-8',
  );

  it('does not query the memberships table', () => {
    // The memberships import was removed; ensure it stays removed.
    expect(source).not.toMatch(/from\s*\(\s*memberships\s*\)/);
  });

  it('uses ctx.user.departments for department filtering', () => {
    expect(source).toContain('ctx.user.departments');
  });

  it('does not reference membershipId in the department isolation block', () => {
    // The old pattern checked ctx.user.membershipId to decide whether to query.
    // Department filtering should use ctx.user.departments directly.
    const deptBlock = source.slice(
      source.indexOf('H-6: Department isolation'),
      source.indexOf('if (input.status)'),
    );
    expect(deptBlock).not.toContain('membershipId');
  });
});
```

- [ ] **Step 2: Run the test to verify it passes**

Run:
```bash
docker compose exec server npx vitest run __tests__/trpc/routers/ticketListDepts.test.ts
```
Expected: 3 passing tests.

- [ ] **Step 3: Commit**

```bash
git add server/__tests__/trpc/routers/ticketListDepts.test.ts
git commit -m "test: add regression tests for ticket.list department isolation

Ensures department filtering uses JWT context, not DB queries."
```
