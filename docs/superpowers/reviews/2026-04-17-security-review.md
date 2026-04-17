# Security Review — 2026-04-17

**Scope**: Security review covering auth, SSO/B2B guest, socket, multi-tenancy, input validation
**Reviewer**: Claude (agent)
**Prior review**: `docs/superpowers/reviews/code-review-full.md` (2026-04-09, 188 commits ago)

## Summary

The codebase continues to demonstrate strong security fundamentals. The Azure B2B guest feature is well-implemented with defense-in-depth (`blockExternalUsers` middleware + client-side UX disable), the SSRF guards on link preview and webhook dispatch are solid, and session revocation continues to fail closed. One HIGH finding: the dev-login endpoint is runtime-gated by `NODE_ENV === 'production'` but mounted unconditionally — a staging/CI server with a misconfigured env string exposes a full auth bypass. Three MEDIUM findings cover the `linkPreviewRouter` lacking per-user rate-limiting (cheap SSRF amplification against external hosts), the `inviteExternalUser` flow creating stranded accounts with no login path, and `isExternal` being sourced from the Zustand store with stale-flag risk. Two LOW and two INFO findings round out the report. **1 high, 3 medium, 2 low, 2 info.**

## Findings

### HIGH: Dev-login endpoint mounted unconditionally — env-string bypass exposes full auth bypass

**File**: `server/routes/auth/devLogin.ts:32-34`, `server/routes/auth/index.ts:14`

**Detail**: `registerDevLoginRoutes(router)` is called unconditionally at server startup in `auth/index.ts`. The only protection is a runtime check *inside* the handler: `if (config.NODE_ENV === 'production') { return res.status(404).end(); }`. Any environment where `NODE_ENV` is not the exact string `'production'` — including `staging`, `test`, `demo`, or simply unset — leaves `POST /api/v1/auth/dev-login` active. The endpoint accepts a `userId`, issues a full JWT + refresh token for any user in the database, bypasses password verification, MFA, and account lockout entirely. The E2E helper at `testing/e2e/helpers/auth.ts:75` calls this endpoint directly — it is tested and expected to be functional in non-prod environments.

**Recommendation**: Gate registration at the call site, not inside the handler:

```ts
// server/routes/auth/index.ts
if (config.NODE_ENV !== 'production') {
  registerDevLoginRoutes(router);
}
```

The in-handler 404 can remain as belt-and-suspenders. This ensures the route literal does not exist in production regardless of handler-level state inspection.

---

### MEDIUM: `linkPreview.fetchForCompose` has no per-user rate limit — server-side request amplification

**File**: `server/trpc/routers/linkPreview.ts:26-43`

**Detail**: `fetchForCompose` is a `protectedProcedure` query that accepts arbitrary text, extracts the first URL, and triggers a live outbound HTTP fetch (2s timeout, DNS pre-resolution, 50KB read). It is subject only to the global tRPC limiter of 200 req/min per IP (`server/app.ts:155-159`), which is shared across all tRPC procedures. This means any authenticated user can drive 200 outbound connections/minute from the server's egress to arbitrary external hosts. While the SSRF guard (`isSafeUrl` with DNS pre-resolution and `redirect: 'error'`) prevents fetching internal addresses, the endpoint can:

1. Be used to scan/probe external hosts from the server's IP.
2. Exhaust server file descriptors with 2s-timeout connections at scale.
3. Amplify DDoS traffic from the server's egress toward a third party.

**Recommendation**: Add a per-user Redis counter specific to this procedure (20 fetches/minute per user is generous for a compose-area preview):

```ts
const key = `rl:lp:${ctx.user.id}`;
const count = await redis.incr(key);
if (count === 1) await redis.expire(key, 60);
if (count > 20) throw new TRPCError({ code: 'TOO_MANY_REQUESTS' });
```

---

### MEDIUM: `inviteExternalUser` creates stranded accounts with no reachable login path

**File**: `server/trpc/routers/partner/members.ts:149-220`

**Detail**: `inviteExternalUser` inserts a user row (`email`, `name`, no `password`, no `externalId`) and a membership, then returns silently — no email is sent, no Azure B2B invitation is triggered programmatically. The comment in `platform/users.ts:184-186` explains the intent (Azure sends the B2B invite separately), but `inviteExternalUser` is available to **tenant admins**, not just platform operators. If the Azure B2B invitation is never sent (admin error, email typo, Azure misconfiguration), the user row exists permanently with no login path: no password, no SSO identity, and the password-reset flow is gated to `isPlatformOperator`.

The SSO callback will link by email on next login (`sso.ts:254-275`) — but only if `preferred_username` exactly matches the stored email. Any case difference or alias mismatch creates a second orphan row. More critically: a pre-created row can be claimed by any Azure identity that presents the matching email, which could be abused if the invited email is attacker-controlled.

**Recommendation**: Add a `pendingInvite: true` column to track unlinked invited accounts, surface a warning in the AdminTeam UI ("This user has not yet logged in via SSO"), and/or restrict `inviteExternalUser` to platform operators who can actually coordinate Azure B2B invitations.

---

### LOW: `isExternal` flag sourced from Zustand store — stale flag risk on privilege change

**File**: `client/src/hooks/useIsExternalAdmin.ts:14-16`

**Detail**: `useIsExternalAdmin()` reads `s.user?.isExternal` from the Zustand store seeded at login. The server-side `blockExternalUsers` middleware re-fetches from the DB on every destructive mutation call, so the server is authoritative. However, if a user's `isExternal` flag changes server-side between sessions (e.g., B2B guest promotion reversed), the client UI will show stale state (buttons enabled when they should be disabled, or vice versa) until the user re-authenticates. The enabled-but-server-rejected direction is purely a UX issue (server blocks correctly); the disabled-but-server-allowed direction causes a confusing "why can't I click this?" experience for legitimately re-promoted users.

**Recommendation**: Accept current behavior and document that server is authoritative (add a comment to the hook). Alternatively, refresh `isExternal` from `trpc.user.me` on partner switch.

---

### LOW: Redis cache key for link previews uses unbounded raw URL

**File**: `server/services/linkPreview.ts:27`, `server/services/linkPreview.ts:37`

**Detail**: Cache keys are `og:${url}` with no per-URL length limit enforced before Redis operations. URLs are extracted via regex from message text — `extractUrls` deduplicates and slices to 3 items but does not cap individual URL length. A crafted URL of 10,000+ characters would produce an unusually large Redis key on every cache miss. Redis supports keys up to 512MB but recommends under 1KB for performance. No SSRF risk here (the length check happens after `isSafeUrl` passes), but worth noting.

**Recommendation**: Add `if (url.length > 2048) return null;` at the top of `fetchOgData` before any cache or DNS operation.

---

### INFO: SSO email-to-externalId linking has a narrow TOCTOU window

**File**: `server/routes/sso.ts:251-275`

**Detail**: The email-based linking path (`SELECT by email` → check `user.password` → `UPDATE set externalId`) is not atomic. A concurrent password-reset flow could set a password on the account between the select and the update. Exploitation requires an attacker to control both an SSO identity and a password-reset email token arriving in the same microsecond window — practically impossible. Flagging for awareness; no action required.

---

### INFO: Ticket reclaim is fully server-driven — no client trust issues

**File**: `server/services/ticketReclaim.ts`

**Detail**: Reviewed for client-supplied identity trust and race conditions per scope. The reclaim runs on a server-side timer with no socket event accepting client input. The `UPDATE ... WHERE supportId = $expected` pattern is atomic and prevents clobbering races. No issues found.

---

## Strengths observed

- **`destructiveAdminProcedure` coverage is complete**: All destructive admin mutations (webhook CRUD + secret rotate + test, member add/update/remove/invite, department update) correctly use `destructiveAdminProcedure` or `gatedPartnerAdminNoGuests`. The source-level assertion tests in `server/__tests__/destructiveAdminProcedure.test.ts` catch future regressions.
- **SSO B2B guest detection is correct**: `acct === 1 || !!claims.idp` matches Microsoft's documented B2B guest signals. Multi-partner rejection is fail-closed with audit log write. Nonce + Redis-backed one-time state tokens implement proper CSRF protection.
- **`auth_method` column removal is clean**: Zero dead references found in TypeScript source.
- **SSRF defenses are layered and correct**: `linkPreview.ts` uses DNS pre-resolution checking all A/AAAA records, IPv6-mapped IPv4 normalization, and `redirect: 'error'`. `webhookDispatch.ts` mirrors the same pattern.
- **Session revocation fails closed**: `isRevoked()` returns `true` on Redis errors (line 93-94 of `sessionRevocation.ts`) — confirmed correct.
- **Refresh token rotation is race-safe**: Atomic `UPDATE ... RETURNING` prevents concurrent-rotation races; family revocation on replay is correct.
- **Socket identity is fully server-side**: All handlers use `socket.data.userId`; `agentId` in `ticketNewSchema` is marked deprecated and ignored.
- **`savedView` and `status` routers are correctly isolated**: All queries filter by both `partnerId` and `userId`; `getAgentStats` enforces self-or-admin before cross-user data exposure.
- **DOMPurify config is correct**: `markdown.ts` uses a narrow allowlist with `afterSanitizeAttributes` hook forcing `rel="noopener noreferrer"` on all anchors.

## Areas not reviewed / time-boxed

- `server/trpc/routers/platform/` beyond `users.ts` (audit, SSO mappings, system, partner list) — spot-checked but not fully read.
- `server/services/gdpr.ts` and `server/services/archive.ts` — WORM hash chain integrity not re-verified in this pass.
- `client/src/components/chat/ComposeArea.tsx` and `MessageContent.tsx` — only `markdown.ts` and `LinkPreviewCard.tsx` were fully read.
- `server/services/ai/` — AI provider SSRF (`validateUrl.ts`) and usage rate limiting not re-reviewed.
