# High-Impact Fixes — Phase 2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix 10 high-impact findings from the 2026-03-28 codebase review.

**Architecture:** Each fix is isolated to 1-3 files. Ordered from smallest/safest to largest. Server fixes first, then client fixes.

**Tech Stack:** TypeScript, Drizzle ORM, PostgreSQL 18, Vitest, Socket.io, React 19, tRPC 11, Zustand 5

**Important:** All commands must run through Docker. Never run `npm`/`node`/`npx` on the host.

---

## Task 1: Prevent re-closing already-closed tickets

**Files:**
- Modify: `server/socket/handlers.ts` (ticket:close handler)
- Test: `server/__tests__/socket/ticketClose.test.ts`

- [ ] **Step 1: Write the failing test**

Create `server/__tests__/socket/ticketClose.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

describe('ticket:close handler', () => {
  it('fetches ticket status before closing', () => {
    const source = readFileSync(join(__dirname, '../../socket/handlers.ts'), 'utf-8');
    // The close handler should SELECT status alongside partner_id
    expect(source).toMatch(/SELECT.*status.*FROM tickets.*WHERE.*id/is);
  });

  it('returns early if ticket is already closed', () => {
    const source = readFileSync(join(__dirname, '../../socket/handlers.ts'), 'utf-8');
    // Should check status === 'closed' and return
    expect(source).toMatch(/status.*===.*'closed'/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `docker compose exec server npx vitest run __tests__/socket/ticketClose.test.ts`

- [ ] **Step 3: Fix the ticket:close handler**

In `server/socket/handlers.ts`, find the `ticket:close` handler. It currently fetches only `partner_id`:

```ts
const ticket = await get('SELECT partner_id FROM tickets WHERE id = $1', [ticketId]);
```

Change to also fetch status:

```ts
const ticket = await get('SELECT partner_id, status FROM tickets WHERE id = $1', [ticketId]);
```

Then add a guard immediately after the existing tenant check:

```ts
if (ticket.status === 'closed') {
  return; // Already closed — prevent duplicate close events
}
```

- [ ] **Step 4: Run test to verify it passes**
- [ ] **Step 5: Commit**

```bash
git add server/socket/handlers.ts server/__tests__/socket/ticketClose.test.ts
git commit -m "fix: prevent re-closing already-closed tickets"
```

---

## Task 2: Add limit to message.list query

**Files:**
- Modify: `server/trpc/routers/message.ts` (list procedure)
- Test: `server/__tests__/trpc/routers/messageList.test.ts`

- [ ] **Step 1: Write the failing test**

Create `server/__tests__/trpc/routers/messageList.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

describe('message.list', () => {
  it('applies a limit to the query', () => {
    const source = readFileSync(join(__dirname, '../../trpc/routers/message.ts'), 'utf-8');
    expect(source).toMatch(/\.limit\s*\(/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**
- [ ] **Step 3: Add .limit() to the message query**

In `server/trpc/routers/message.ts`, find the `list` procedure query. It currently does:

```ts
const rows = await query.orderBy(asc(messages.createdAt));
```

Add a limit:

```ts
const rows = await query.orderBy(asc(messages.createdAt)).limit(2000);
```

This is a hard safety cap — tickets should rarely exceed 2000 messages.

- [ ] **Step 4: Run test to verify it passes**
- [ ] **Step 5: Commit**

```bash
git add server/trpc/routers/message.ts server/__tests__/trpc/routers/messageList.test.ts
git commit -m "fix: add hard limit to message.list to prevent unbounded query"
```

---

## Task 3: Add partnerId to ratings table

**Files:**
- Modify: `server/db/schema.ts` (ratings table)
- Modify: `server/socket/handlers.ts` (rating:submit — populate partnerId on insert)
- Migration: generate via drizzle-kit
- Test: `server/__tests__/db/ratingsPartner.test.ts`

- [ ] **Step 1: Write the failing test**

Create `server/__tests__/db/ratingsPartner.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

describe('ratings table multi-tenancy', () => {
  it('has partnerId column', () => {
    const source = readFileSync(join(__dirname, '../../db/schema.ts'), 'utf-8');
    // Find the ratings table section and check for partner_id
    const ratingsMatch = source.match(/ratings\s*=\s*pgTable[\s\S]*?}\)/);
    expect(ratingsMatch).toBeTruthy();
    expect(ratingsMatch![0]).toContain("partner_id");
  });

  it('handler populates partnerId on rating insert', () => {
    const source = readFileSync(join(__dirname, '../../socket/handlers.ts'), 'utf-8');
    // The INSERT INTO ratings should include partner_id
    expect(source).toMatch(/INSERT INTO ratings.*partner_id/is);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**
- [ ] **Step 3: Add partnerId to schema**

In `server/db/schema.ts`, find the ratings table. Add a `partnerId` column:

```ts
partnerId: text('partner_id').notNull().references(() => partners.id, { onDelete: 'cascade' }),
```

Add an index:

```ts
partnerCreatedIdx: index('idx_ratings_partner_created').on(table.partnerId, table.createdAt),
```

- [ ] **Step 4: Generate and apply migration**

```bash
docker compose exec server npx drizzle-kit generate
docker compose exec server npm run db:migrate
```

Note: Existing rows won't have partnerId. The migration may need to:
1. Add column as nullable first
2. Backfill from tickets join
3. Set NOT NULL

If drizzle-kit generates a simple NOT NULL add that would fail on existing data, you'll need to write a manual migration that backfills first.

- [ ] **Step 5: Update rating:submit handler**

In `server/socket/handlers.ts`, find the rating INSERT. Add `partner_id` to both the column list and values:

The partnerId is available as `socket.data.partnerId`.

- [ ] **Step 6: Run test to verify it passes**
- [ ] **Step 7: Commit**

```bash
git add server/db/schema.ts server/socket/handlers.ts server/__tests__/db/ratingsPartner.test.ts server/drizzle/
git commit -m "fix: add partnerId to ratings table for multi-tenancy"
```

---

## Task 4: Fix removeMember TOCTOU race condition

**Files:**
- Modify: `server/trpc/routers/partner.ts` (removeMember mutation)
- Test: `server/__tests__/trpc/routers/removeMember.test.ts`

- [ ] **Step 1: Write the failing test**

Create `server/__tests__/trpc/routers/removeMember.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

describe('removeMember transaction safety', () => {
  it('uses a database transaction', () => {
    const source = readFileSync(join(__dirname, '../../trpc/routers/partner.ts'), 'utf-8');
    // The removeMember section should use db.transaction
    expect(source).toMatch(/db\.transaction/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**
- [ ] **Step 3: Wrap removeMember in a transaction**

In `server/trpc/routers/partner.ts`, find the `removeMember` mutation. The current pattern:

```ts
const userMemberships = await db.select().from(memberships)
  .where(eq(memberships.userId, membership[0].userId));
if (userMemberships.length <= 1) {
  throw new TRPCError({ code: 'FORBIDDEN', message: "Cannot remove user's last membership..." });
}
await db.delete(memberships).where(eq(memberships.id, input.membershipId));
```

Wrap in `db.transaction()`:

```ts
await db.transaction(async (tx) => {
  const userMemberships = await tx.select().from(memberships)
    .where(eq(memberships.userId, membership[0].userId));
  if (userMemberships.length <= 1) {
    throw new TRPCError({ code: 'FORBIDDEN', message: "Cannot remove user's last membership..." });
  }
  await tx.delete(memberships).where(eq(memberships.id, input.membershipId));
});
```

This ensures the count check and delete are atomic.

- [ ] **Step 4: Run test to verify it passes**
- [ ] **Step 5: Commit**

```bash
git add server/trpc/routers/partner.ts server/__tests__/trpc/routers/removeMember.test.ts
git commit -m "fix: wrap removeMember in transaction to prevent TOCTOU race"
```

---

## Task 5: Add brute-force protection to platform TOTP enable

**Files:**
- Modify: `server/trpc/routers/platformSecurity.ts` (enable procedure)
- Test: `server/__tests__/trpc/routers/platformSecurityBrute.test.ts`

- [ ] **Step 1: Write the failing test**

Create `server/__tests__/trpc/routers/platformSecurityBrute.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

describe('platform TOTP enable brute-force protection', () => {
  it('checks lockout before verifying TOTP code', () => {
    const source = readFileSync(join(__dirname, '../../trpc/routers/platformSecurity.ts'), 'utf-8');
    expect(source).toContain('isLockedOut');
  });

  it('records failed login on bad TOTP code', () => {
    const source = readFileSync(join(__dirname, '../../trpc/routers/platformSecurity.ts'), 'utf-8');
    expect(source).toContain('recordFailedLogin');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**
- [ ] **Step 3: Add lockout check and failed login recording**

In `server/trpc/routers/platformSecurity.ts`, find the `enable` procedure. Before the TOTP verification:

```ts
import { isLockedOut, recordFailedLogin, clearFailedLogins } from '../../services/accountLockout';
```

Before the `authenticator.check(...)` call, add:

```ts
const locked = await isLockedOut(ctx.user.id);
if (locked) {
  throw new TRPCError({ code: 'TOO_MANY_REQUESTS', message: 'Account temporarily locked' });
}
```

On verification failure (where it currently returns an error message), add:

```ts
await recordFailedLogin(ctx.user.id);
throw new TRPCError({ code: 'BAD_REQUEST', message: 'Invalid verification code' });
```

On success, clear failed logins:

```ts
await clearFailedLogins(ctx.user.id);
```

Check if `clearFailedLogins` exists in accountLockout — if not, it's a simple `UPDATE users SET failed_login_attempts = 0 WHERE id = $1`.

- [ ] **Step 4: Run test to verify it passes**
- [ ] **Step 5: Commit**

```bash
git add server/trpc/routers/platformSecurity.ts server/__tests__/trpc/routers/platformSecurityBrute.test.ts
git commit -m "fix(security): add brute-force protection to platform TOTP enable"
```

---

## Task 6: Add per-IP rate limit to /forgot-password

**Files:**
- Modify: `server/routes/auth.ts` (add rate limit middleware to /forgot-password route)
- Test: `server/__tests__/routes/forgotPasswordRate.test.ts`

- [ ] **Step 1: Write the failing test**

Create `server/__tests__/routes/forgotPasswordRate.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

describe('/forgot-password rate limiting', () => {
  it('has rate limit middleware on the forgot-password route', () => {
    const source = readFileSync(join(__dirname, '../../routes/auth.ts'), 'utf-8');
    // Should have a rate limit applied to the forgot-password route
    expect(source).toMatch(/forgot-password.*Rate|forgotPassword.*[Rr]ate/s);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**
- [ ] **Step 3: Add rate limit middleware**

In `server/routes/auth.ts`, find the `/forgot-password` route. Add a rate limiter similar to `loginRateLimit`. Define it near the other rate limiters:

```ts
const forgotPasswordRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10, // 10 requests per IP per 15 minutes
  standardHeaders: true,
  legacyHeaders: false,
  message: 'Too many password reset requests, please try again later',
});
```

Then apply it to the route:

```ts
router.post('/forgot-password', forgotPasswordRateLimit, async (req, res) => {
```

If the codebase uses `express-rate-limit`, import it if not already imported.

- [ ] **Step 4: Run test to verify it passes**
- [ ] **Step 5: Commit**

```bash
git add server/routes/auth.ts server/__tests__/routes/forgotPasswordRate.test.ts
git commit -m "fix(security): add per-IP rate limit to /forgot-password"
```

---

## Task 7: Filter inactive partners at query layer

**Files:**
- Modify: `server/services/authSession.ts` (listUserMemberships function)
- Test: `server/__tests__/services/authSessionFilter.test.ts`

- [ ] **Step 1: Write the failing test**

Create `server/__tests__/services/authSessionFilter.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

describe('listUserMemberships partner status filter', () => {
  it('filters by partner status at the query layer', () => {
    const source = readFileSync(join(__dirname, '../../services/authSession.ts'), 'utf-8');
    // Should have a WHERE clause or filter for partner status = 'active'
    expect(source).toMatch(/status.*active|active.*status/i);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**
- [ ] **Step 3: Add partner status filter to the query**

In `server/services/authSession.ts`, find `listUserMemberships`. It joins memberships with partners but doesn't filter on `partners.status`. Add a WHERE condition:

```ts
.where(and(
  eq(memberships.userId, userId),
  eq(partners.status, 'active')
))
```

If it already has a `.where()`, add `eq(partners.status, 'active')` to the existing `and()`.

- [ ] **Step 4: Run test to verify it passes**
- [ ] **Step 5: Commit**

```bash
git add server/services/authSession.ts server/__tests__/services/authSessionFilter.test.ts
git commit -m "fix(security): filter inactive partners at query layer in listUserMemberships"
```

---

## Task 8: Fix bare useStore() calls in ChatWindow and MessageBubble

**Files:**
- Modify: `client/src/components/ChatWindow.tsx`
- Modify: `client/src/components/MessageBubble.tsx`
- Test: `client/src/__tests__/useStoreSelectors.test.ts`

- [ ] **Step 1: Write the failing test**

Create `client/src/__tests__/useStoreSelectors.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

describe('useStore selector usage', () => {
  const files = [
    'components/ChatWindow.tsx',
    'components/MessageBubble.tsx',
  ];

  for (const file of files) {
    it(`${file} does not use bare useStore()`, () => {
      const source = readFileSync(join(__dirname, '..', file), 'utf-8');
      // Should NOT have bare useStore() calls — must use useStoreShallow or selectors
      const bareUseStore = source.match(/\buseStore\(\s*\)/g);
      expect(bareUseStore).toBeNull();
    });
  }
});
```

- [ ] **Step 2: Run test to verify it fails**
- [ ] **Step 3: Replace bare useStore() with selectors**

In each file, find `const { ... } = useStore();` and replace with `useStoreShallow`:

```ts
// BEFORE:
const { user, activeTicket, messages, ... } = useStore();

// AFTER:
import { useStoreShallow } from '../store/useStore';
const { user, activeTicket, messages, ... } = useStoreShallow(s => ({
  user: s.user,
  activeTicket: s.activeTicket,
  messages: s.messages,
  // ... only the properties actually used in this component
}));
```

Read each component carefully to determine exactly which store properties it uses. Only select those.

Check if `useStoreShallow` is already exported from `store/useStore.ts`. If not, check how other components do selective subscriptions and follow that pattern.

- [ ] **Step 4: Run test to verify it passes**
- [ ] **Step 5: Commit**

```bash
git add client/src/components/ChatWindow.tsx client/src/components/MessageBubble.tsx client/src/__tests__/useStoreSelectors.test.ts
git commit -m "perf: replace bare useStore() with selective subscriptions in ChatWindow and MessageBubble"
```

---

## Task 9: Fix duplicate socket event listeners

**Files:**
- Modify: `client/src/hooks/useSocket.ts`
- Test: `client/src/__tests__/socketListeners.test.ts`

- [ ] **Step 1: Write the failing test**

Create `client/src/__tests__/socketListeners.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

describe('socket listener deduplication', () => {
  it('listenersAttached is at module scope, not inside the hook', () => {
    const source = readFileSync(join(__dirname, '../hooks/useSocket.ts'), 'utf-8');
    // listenersAttached should be declared BEFORE the function/hook definition
    const hookStart = source.indexOf('export');
    const listenersDeclared = source.indexOf('listenersAttached');
    expect(listenersDeclared).toBeLessThan(hookStart);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**
- [ ] **Step 3: Move listenersAttached to module scope**

In `client/src/hooks/useSocket.ts`, find where `listenersAttached` is declared (likely as a `useRef` inside the hook). Change it to a module-level `let` variable:

```ts
// At top of file, alongside the module-level `let socket` singleton:
let listenersAttached = false;
```

Then in the hook, remove the `useRef` for listenersAttached and use the module-level variable instead. When the socket disconnects or is cleaned up, reset it to `false`.

- [ ] **Step 4: Run test to verify it passes**
- [ ] **Step 5: Commit**

```bash
git add client/src/hooks/useSocket.ts client/src/__tests__/socketListeners.test.ts
git commit -m "fix: move listenersAttached to module scope to prevent duplicate event handlers"
```

---

## Task 10: Sanitize ssoError query parameter

**Files:**
- Modify: `client/src/views/LoginView.tsx`
- Test: `client/src/__tests__/ssoErrorSanitize.test.ts`

- [ ] **Step 1: Write the failing test**

Create `client/src/__tests__/ssoErrorSanitize.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

describe('SSO error sanitization', () => {
  it('does not pass raw sso_error query param to setError', () => {
    const source = readFileSync(join(__dirname, '../views/LoginView.tsx'), 'utf-8');
    // Should NOT have decodeURIComponent(ssoError) passed to setError
    expect(source).not.toMatch(/setError\(decodeURIComponent/);
  });

  it('uses a whitelist for known SSO error codes', () => {
    const source = readFileSync(join(__dirname, '../views/LoginView.tsx'), 'utf-8');
    // Should have a mapping or switch for known error codes
    expect(source).toMatch(/ssoErrorMessages|SSO_ERROR_MAP|sso_error_/i);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**
- [ ] **Step 3: Replace raw error with whitelist**

In `client/src/views/LoginView.tsx`, find where `sso_error` is handled:

```ts
// BEFORE:
const ssoError = params.get('sso_error');
if (ssoError) {
  if (ssoError === 'no_matching_groups') {
    setError(t('sso_no_groups_message'));
  } else {
    setError(decodeURIComponent(ssoError));
  }
}

// AFTER:
const ssoError = params.get('sso_error');
if (ssoError) {
  const ssoErrorMessages: Record<string, string> = {
    'no_matching_groups': t('sso_no_groups_message'),
    'invalid_token': t('sso_error_generic'),
    'expired': t('sso_error_generic'),
    'unauthorized': t('sso_error_generic'),
  };
  setError(ssoErrorMessages[ssoError] || t('sso_error_generic'));
}
```

Check what translation keys exist for SSO errors. If `sso_error_generic` doesn't exist, use a reasonable fallback like `t('login_failed')` or a hardcoded string `'SSO authentication failed. Please try again.'`.

- [ ] **Step 4: Run test to verify it passes**
- [ ] **Step 5: Commit**

```bash
git add client/src/views/LoginView.tsx client/src/__tests__/ssoErrorSanitize.test.ts
git commit -m "fix(security): sanitize ssoError query parameter to prevent reflected content"
```

---

## Final Steps

- [ ] **Run full CI**

```powershell
powershell -File scripts/ci.ps1 -Skip e2e
```

Expected: All steps pass.
