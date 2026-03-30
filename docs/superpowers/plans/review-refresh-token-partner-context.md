# Code Review: Refresh Token Partner Context (b51b4fb → ac771e2)

**Task**: Architecture Review Task 2 — preserve partner context across token refresh to prevent cross-tenant authorization bypass.

---

## What Was Done Well

- The core security goal is achieved. The stored `partnerId` is now the authoritative source of partner identity on `/refresh`, rather than the positionally-arbitrary `activeMemberships[0]`.
- `rotateRefreshToken` correctly propagates `existing.partnerId` into the new token row inside the same atomic transaction, so the partner binding survives every rotation without re-reading the database outside the transaction.
- The `/refresh` fallback path (stored partner no longer active → fall back to `activeMemberships[0]`) is a sound design choice that prevents hard lockout on partner deactivation.
- The `membership` null-guard and associated cookie-clear + 401 is a meaningful improvement over the prior code which would have silently built a token with `undefined` role and partnerId.
- All four call sites (`/login-local`, `/login`, `/switch-partner`, `/enter-partner`) correctly pass `partnerId`.
- `partnerId` is typed `string | null` throughout, consistent with the nullable schema column.

---

## Issues Found

### Critical

**None.**

---

### Important

**1. Missing Drizzle migration file**

The `partnerId` column is added to the schema in `server/db/schema.ts` but no corresponding migration file exists in the diff or migration directory. The project uses `db:migrate` as its migration path. Without a generated migration, any environment running against an existing database will have a schema mismatch — the column will not exist, and every `INSERT` into `refresh_tokens` (login, switch-partner, enter-partner) will fail at runtime with a column-not-found error.

Required action: run `docker compose exec server npx drizzle-kit generate` and commit the resulting migration file.

**2. `rotateRefreshToken` return type not reflected in `createRefreshToken`**

`rotateRefreshToken` returns `partnerId: string | null` in its result object, and the `/refresh` route correctly reads `result.partnerId`. However, `createRefreshToken` returns `{ token, family, expiresAt }` — it does not return `partnerId`. This is fine at the call sites today (they already know the partnerId they passed in), but it creates an asymmetry that could mislead a future caller who expects the return value of `createRefreshToken` to be self-describing. The return type should either include `partnerId` or a comment should explicitly document why it is omitted.

**3. Null-membership 401 does not rotate the token first**

In the `/refresh` route, if `storedPartnerId` is set but the membership is not found, and the fallback `activeMemberships[0]` is also absent, the handler returns 401 and clears cookies. However, it does not call `revokeFamily` on the presented token. The presented token is left active in the database. An attacker who obtains a valid refresh token for a user who has since lost all memberships can replay that token indefinitely until it expires (up to 7 days). Recommendation: call `revokeAllUserRefreshTokens(result.userId)` before returning 401 in this branch.

---

### Suggestions

**4. No index on `refresh_tokens.partner_id`**

The `/refresh` route calls `activeMemberships.find(m => m.partnerId === result.partnerId)` in application code, which is fine. But `partner_id` has no database index. If a future query filters refresh tokens by partnerId directly (e.g., "revoke all tokens for partner X"), it will do a full table scan. Consider adding `index('idx_refresh_tokens_partner').on(table.partnerId)` to the schema, consistent with the existing `userId` and `family` indexes.

**5. `defaultMembership` variable in `/refresh` is now a dead name**

The diff removes `const defaultMembership = activeMemberships[0]` and replaces it with `preferredMembership` / `membership`. The old name is gone. This is correct. However, other code in the same function still uses the pattern of optional chaining on membership fields (leftover from when the variable was `defaultMembership?.role`). After this change, the null-check is now explicit (`if (!membership)`) and the downstream accesses are non-optional (`membership.role`, `membership.partnerId`). This is strictly better — just confirming no stale optional accesses remain. Verified clean.

**6. Platform operators have no `partnerId` on their refresh token at initial login**

When a platform operator logs in without a default membership, `defaultMembership?.partnerId` is `undefined` → stored as `null`. On refresh, `result.partnerId` is `null`, so `preferredMembership` is `null`, and the code falls back to `activeMemberships[0]`. If the operator also has no active memberships (pure platform operator), the new `if (!membership)` guard fires and clears cookies, logging them out. This is a behavior change from the prior code, which would have built a token with `undefined` partnerId (functionally equivalent for operators). Verify that platform operators who have no partner memberships can still refresh their token — they should be excluded from the membership check or the guard should special-case `isPlatformOperator`.

---

## Plan Alignment

| Requirement | Status |
|---|---|
| Add `partnerId` column to `refresh_tokens` | Done — schema updated, nullable, no FK |
| `createRefreshToken` accepts and stores `partnerId` | Done |
| `rotateRefreshToken` propagates `partnerId` to new row | Done, inside the existing atomic transaction |
| All 4 call sites in `auth.ts` pass `partnerId` | Done (`/login-local`, `/login`, `/switch-partner`, `/enter-partner`) |
| `/refresh` prefers stored partner over `activeMemberships[0]` | Done with correct fallback logic |
| Migration file generated | **Missing** — blocking issue |
| Platform operator edge case handled | Unverified — potential regression |

---

## Summary

The implementation correctly addresses the cross-tenant bypass risk. Two items need attention before merging: (1) the missing migration file is a hard blocker for existing deployments, and (2) the no-membership 401 path should revoke the token to prevent replay. The platform operator edge case should be verified to avoid an unintended logout regression.
