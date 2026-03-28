# tRPC Router Code Review - 2026-03-28

Reviewer: Claude Opus 4.6 (Senior Code Review)
Scope: All 17 tRPC routers + middleware in `server/trpc/`

---

## Overall Assessment

The codebase demonstrates strong fundamentals: consistent partner-scoping patterns, proper audit logging, good Zod validation, and careful separation of platform vs tenant operations. The middleware hierarchy (`protectedProcedure` -> `adminProcedure` / `platformProcedure` / `partnerScopedProcedure`) is well-designed. Below are issues found, organized by severity.

---

## CRITICAL Issues

### C1. SQL Injection via unsanitized search input (ticket.ts:55, message.ts:104)

**File:** `server/trpc/routers/ticket.ts` lines 54-59
**File:** `server/trpc/routers/message.ts` lines 103-104

The search pattern is built via string interpolation with user input:
```ts
const q = `%${input.search}%`;
```
If `input.search` contains `%` or `_` characters (SQL LIKE wildcards), it changes query semantics. While not a full SQL injection (Drizzle parameterizes the value), a user can craft `%` to match everything or use `_` for single-char wildcards, causing unintended data exposure or denial-of-service via expensive ILIKE scans.

**Fix:** Escape LIKE meta-characters before interpolation:
```ts
function escapeLike(str: string): string {
  return str.replace(/[%_\\]/g, '\\$&');
}
const q = `%${escapeLike(input.search)}%`;
```

### C2. Ticket list missing role-based filtering (ticket.ts:24-36)

**File:** `server/trpc/routers/ticket.ts` lines 24-36

The `ticket.list` endpoint uses `protectedProcedure` (any authenticated user). An `agent` user can see ALL tickets for their partner -- including tickets belonging to other agents. Per the architecture, agents should only see their own tickets (`agentId === ctx.user.id`), while support/admin see all.

**Fix:** Add role-based filtering:
```ts
if (ctx.user.role === 'agent' && !ctx.user.isPlatformOperator) {
  conditions.push(eq(tickets.agentId, ctx.user.id));
}
```

### C3. Stats router `[key: string]: unknown` index signature (stats.ts:25)

**File:** `server/trpc/routers/stats.ts` line 25

```ts
interface RawMessageRow {
  // ...typed fields...
  [key: string]: unknown;  // <-- breaks type safety
}
```

This index signature effectively makes the type `any`-like. Combined with `as unknown as RawMessageRow[]` casts on lines 222-223, this defeats TypeScript's safety guarantees. The CLAUDE.md mandates "No `any` types."

**Fix:** Remove the index signature. Map raw pg rows explicitly or use Drizzle's typed select.

---

## IMPORTANT Issues

### I1. Platform operator can access feedback without partner scope (feedback.ts:24)

**File:** `server/trpc/routers/feedback.ts` lines 23-26

```ts
if (ctx.user.isPlatformOperator && !ctx.user.partnerId) {
  data = await db.select().from(appFeedback).orderBy(desc(appFeedback.createdAt));
}
```

A platform operator without a partner context gets ALL feedback across ALL tenants in a single unscoped query. While platform operators are trusted, this is a cross-tenant data leak that violates the multi-tenancy mandate. Other routers (ratings, stats) correctly require partner context even for platform operators.

**Fix:** Require partner context or add explicit `partnerId` input parameter for platform operators, consistent with the ticket.list pattern.

### I2. `resendInvite` leaks full user record (platform.ts:517)

**File:** `server/trpc/routers/platform.ts` line 517

```ts
const user = (await db.select().from(users).where(eq(users.id, input.userId)).limit(1))[0];
```

This `select()` without column specification fetches ALL columns including `password`, `mfaSecret`, `mfaRecoveryCodes`, `passwordHistory`, and `platformTotpSecret`. While these aren't returned to the client (only `{ success: true }` is returned), sensitive data sits in server memory unnecessarily, increasing blast radius of a memory dump or logging accident.

**Fix:** Select only needed columns: `{ id, name, email, externalId }`.

### I3. Race condition in partner.inviteExternalUser (partner.ts:558-559)

**File:** `server/trpc/routers/partner.ts` lines 558-588

The check for existing user and the insert are not wrapped in a transaction. Two concurrent invites for the same email could both pass the existence check and both attempt to insert, causing one to fail with a raw database error instead of the friendly `CONFLICT` response.

**Fix:** Wrap the check-then-insert in a `db.transaction()`.

### I4. `listPartners` returns full partner objects including AI config (platform.ts:67-74)

**File:** `server/trpc/routers/platform.ts` lines 67-74

```ts
listPartners: platformProcedure.query(async () => {
  return await db.select().from(partners).where(isNull(partners.deletedAt))...
});
```

Unlike `getManifest` (which strips `aiConfig`, `aiProvider`, `aiModel`), `listPartners` returns everything including potentially sensitive AI provider configuration (API keys, endpoints). This is a data exposure risk even for platform operators.

**Fix:** Use explicit column selection or strip sensitive fields like `getManifest` does.

### I5. `getManifest` error handling swallows TRPCErrors (partner.ts:223-224)

**File:** `server/trpc/routers/partner.ts` lines 222-225

```ts
} catch (err: unknown) {
  throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: String(err) });
}
```

This catch block converts NOT_FOUND errors thrown on line 218 into INTERNAL_SERVER_ERROR. The `if (result.length === 0) throw new TRPCError({ code: 'NOT_FOUND' })` is immediately caught and re-wrapped.

**Fix:** Add `if (err instanceof TRPCError) throw err;` before the generic handler, as done correctly in most other routers.

### I6. `updateMember` allows no role change (partner.ts:610-615)

**File:** `server/trpc/routers/partner.ts` lines 610-615

The `updateMember` mutation only accepts `departments` -- there is no `role` field in the input schema. This means tenant admins cannot change a member's role (e.g., promote agent to support). Meanwhile `platform.updateMembership` can change roles. This may be intentional but creates an inconsistency where admins must ask platform operators for role changes.

### I7. No pagination on `rating.list` (rating.ts:14-41)

**File:** `server/trpc/routers/rating.ts` lines 14-41

The `list` endpoint fetches ALL ratings for a partner with no limit or pagination. For partners with thousands of closed tickets, this could return an enormous result set.

**Fix:** Add cursor-based pagination or at minimum a `.limit(500)` cap.

### I8. `kb.aiSearch` fetches ALL articles into memory (kb.ts:99-107)

**File:** `server/trpc/routers/kb.ts` lines 99-107

```ts
const articles = await db.select(articleListColumns).from(kbArticles)
  .where(and(eq(kbArticles.partnerId, ...), eq(kbArticles.published, true)))
  .orderBy(asc(kbArticles.title));
```

This loads every published article (including full body text up to 50KB each) into memory before sending them to the AI. For a partner with hundreds of articles, this is both a memory and latency problem.

**Fix:** Add a `.limit(100)` cap, or better, implement embedding-based search. At minimum, truncate body in the query.

---

## MINOR Issues

### M1. Inconsistent procedure usage across routers

Some routers use `partnerScopedProcedure` (cannedResponse, ai, kb) while equivalent routers use `protectedProcedure` + manual partnerId checks (ticket, message, label). The `partnerScopedProcedure` approach is cleaner and guarantees `partnerId` is non-null in the type system.

**Recommendation:** Migrate ticket, message, label, rating routers to use `partnerScopedProcedure` / `partnerAdminProcedure`.

### M2. Duplicated slugify functions (partner.ts:17-24, kb.ts:11-16)

Two slightly different slug implementations exist. `partner.ts` uses `makeSlug()` and `kb.ts` uses `slugify()` with different regex patterns.

**Recommendation:** Extract to a shared utility.

### M3. Non-null assertion in label.delete (label.ts:78)

```ts
conditions.push(eq(labels.partnerId, ctx.user.partnerId!));
```

The `!` assertion could fail if `partnerId` is null and the user is not a platform operator. The code checks `isPlatformOperator` but the else branch uses `!` without a null guard.

**Fix:** Add explicit null check or use `partnerAdminProcedure`.

### M4. `stats.getGlobalStats` is a 600+ line monolith (stats.ts:145-623)

This single query handler contains ~480 lines of aggregation logic. It mixes data fetching, computation, and response shaping in one function. While functional, it is very difficult to test, debug, or modify safely.

**Recommendation:** Extract into service functions: `fetchHistoricalStats()`, `computeLiveStats()`, `aggregatePerDay()`, `buildSupportStats()`, etc.

### M5. Alerts router uses `roleProcedure(['admin'])` without partner scope (alerts.ts:24)

While it manually calls `requirePartnerId()`, using `partnerAdminProcedure` would provide this guarantee at the type level and be consistent with other admin routers.

### M6. `cannedResponse.list` passes wrong arity to `canUseSupportWorkflows` (cannedResponse.ts:18)

```ts
if (!canUseSupportWorkflows(ctx.user.role) && !ctx.user.isPlatformOperator) return [];
```

Other call sites pass two arguments: `canUseSupportWorkflows(ctx.user.role, ctx.user.isPlatformOperator)`. If the function signature requires `isPlatformOperator` for its logic, this call may not behave correctly for platform operators.

**Fix:** Pass both arguments consistently:
```ts
if (!canUseSupportWorkflows(ctx.user.role, ctx.user.isPlatformOperator)) return [];
```

---

## What Was Done Well

- **Consistent audit logging**: Nearly every mutation writes to `audit_log` with actor, target, and metadata. Excellent for compliance.
- **Partner-scoped middleware**: The `partnerScopedProcedure` and `partnerAdminProcedure` patterns are well-designed and provide type-level guarantees.
- **Sensitive field stripping**: `getManifest` and `listGlobalUsers` explicitly select safe columns. `inviteExternalUser` never logs plaintext passwords.
- **SSRF protection**: Webhook URL validation before registration is a strong security pattern.
- **Input validation**: Zod schemas are thorough -- business hours validation with overlap detection, timezone validation, and window limits are particularly well done.
- **Cursor-based pagination**: Properly implemented with `limit+1` pattern across ticket list, audit archive, and user list.
- **Transaction usage**: Label deletion correctly wraps junction table cleanup in a transaction.
- **Platform step-up**: The TOTP step-up flow with JWT refresh is a solid security pattern.

---

## Summary

| Severity | Count | Key Themes |
|----------|-------|------------|
| CRITICAL | 3 | Missing agent-level ticket filtering, LIKE wildcard injection, type safety violation |
| IMPORTANT | 8 | Cross-tenant feedback leak, sensitive data in memory, race conditions, missing pagination |
| MINOR | 6 | Inconsistent patterns, code duplication, monolithic stats handler |

**Priority fixes:** C2 (ticket access control) and I1 (cross-tenant feedback) should be addressed immediately as they have direct security implications.
