# Ticket List Performance & Context Fixes

**Date**: 2026-03-29
**Scope**: 2 targeted fixes in `server/trpc/context.ts` and `server/trpc/routers/ticket.ts`
**Risk**: Low — additive interface change + query removal

## Problem

1. **TRPCUser missing departments**: `jwtPayloadSchema` includes `departments` but `TRPCUser` interface and `createContext` mapping omit it. This forces downstream code to re-query the database for data already present in the JWT.

2. **N+1 department query in ticket.list**: The `list` procedure queries the `memberships` table on every call for support users to fetch their assigned departments — even though this data is already in the JWT payload.

## Non-Problem (Kept As-Is)

3. **fetchLabelsForTickets "1+1" pattern**: The labels fetch uses a single batch `WHERE IN` query for all ticket IDs on the page. This is O(2) total queries, not O(N+1). Adding a `LEFT JOIN` + `array_agg` + `GROUP BY` on every ticket column would increase complexity for marginal gain. **Decision: keep current pattern.**

4. **Socket revocation 5-minute interval**: Short-lived access tokens (15min) already cap the blast radius. The current interval is a reasonable trade-off between Redis load and security responsiveness. tRPC middleware checks revocation per-request. **Decision: keep current interval.**

## Fix 1: Add `departments` to TRPCUser

**File**: `server/trpc/context.ts`

### Interface Change

Add `departments` field to `TRPCUser`:

```typescript
export interface TRPCUser {
  id: string;
  role: UserRole;
  partnerId?: string;
  membershipId?: string;
  departments?: string[];  // ← NEW
  isPlatformOperator: boolean;
  platformStepUpAt?: number;
  tokenJti?: string;
  tokenExp?: number;
  tokenIat?: number;
}
```

### Context Mapping

Map `decoded.departments` in `createContext`:

```typescript
user = {
  id: decoded.userId,
  role: decoded.role as UserRole,
  partnerId: decoded.partnerId,
  membershipId: decoded.membershipId,
  departments: (decoded.departments as string[]) || [],  // ← NEW
  isPlatformOperator: isPlatformAdmin(!!decoded.isPlatformOperator),
  platformStepUpAt: decoded.platformStepUpAt,
  tokenJti: decoded.jti,
  tokenExp: decoded.exp,
  tokenIat: decoded.iat,
};
```

## Fix 2: Eliminate Redundant Department Query

**File**: `server/trpc/routers/ticket.ts`

### Before (lines 58-69)

```typescript
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

### After

```typescript
if (!ctx.user.isPlatformOperator && ctx.user.role === 'support') {
  const depts = ctx.user.departments;
  if (Array.isArray(depts) && depts.length > 0) {
    conditions.push(inArray(tickets.dept, depts));
  }
}
```

### Cleanup

- Remove `memberships` from the import if no longer used elsewhere in `ticket.ts`
- The `membershipId` check is no longer needed (departments are directly available)

## Trade-off: Staleness Window

Department assignments are now read from the JWT, not live from the database. Changes to a user's departments won't take effect until their next token refresh (max 15 minutes with default `ACCESS_TOKEN_EXPIRY`). This is consistent with how role changes and partner switches already work — the JWT is the source of truth for the session.

## Testing

- Verify support users with departments only see tickets in their assigned departments
- Verify support users with empty/null departments (generalists) see all tickets
- Verify admin and platform operators are unaffected
- Verify agents still only see their own tickets
