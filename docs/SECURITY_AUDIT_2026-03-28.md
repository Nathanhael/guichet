# Tessera Security Audit — 2026-03-28

**Auditor:** Claude Opus 4.6 (4 parallel review agents)
**Scope:** Full codebase — auth, input validation, authorization, multi-tenancy, infrastructure
**Date:** 2026-03-28

---

## Executive Summary

The Tessera codebase demonstrates mature security fundamentals: pinned JWT algorithm (HS256), Argon2id password hashing, server-side identity enforcement on sockets, consistent partnerId filtering on most queries, WORM audit chain, and TOTP MFA. However, this audit identified **3 critical**, **13 high**, **12 medium**, and **9 low/info** findings across all four security domains.

**Top priority actions:**
1. Rotate all committed secrets (`.env` in repo)
2. Fix cross-tenant label deletion IDOR (CR-1)
3. Apply SSRF validation to AI `baseUrl` config
4. Add department isolation for support users
5. Fix socket `partnerId` JWT mismatch

---

## Findings by Severity

### CRITICAL (3)

| ID | Domain | File | Finding |
|----|--------|------|---------|
| **CR-1** | AuthZ | `server/trpc/routers/label.ts:72` | **Label delete IDOR** — Platform operator can delete ANY partner's label without partnerId filter. The operator bypass skips tenant scoping on a destructive write. |
| **CR-2** | Infra | `.env`, `.env.example` | **Committed secrets** — `JWT_SECRET=super-secret-key-replace-in-prod`, `PLATFORM_ADMIN_PASSWORD=admin1234`, `GRAFANA_ADMIN_PASSWORD=admin`, `POSTGRES_PASSWORD=password` all committed to repo. JWT is forgeable if this repo was ever shared. |
| **CR-3** | Infra | `.env:35`, `server/config.ts:42` | **Bootstrap password bypasses validator** — `PLATFORM_ADMIN_PASSWORD=admin1234` is 9 chars, under the `min(10)` Zod rule. Server either fails to start or the validation is not being hit as expected. |

### HIGH (13)

| ID | Domain | File | Finding |
|----|--------|------|---------|
| **H-1** | Auth | `server/routes/auth.ts:381` | **MFA challenge token is dead code** — `challengeToken` stored in Redis but never consumed on second submission. Gives false impression of secure challenge flow. |
| **H-2** | Auth | `server/trpc/routers/mfa.ts:16` | **Recovery codes have low entropy (32 bits)** — `randomBytes(4)` produces 8-char hex codes. Industry standard is 80+ bits. |
| **H-3** | Auth | `server/services/sessionRevocation.ts:16` | **Logout silently no-ops on Redis failure** — Token not revoked but cookie cleared. Revoked token remains replayable until natural expiry. |
| **H-4** | Input | `server/services/ai/factory.ts:113` | **SSRF via unvalidated `aiConfig.baseUrl`** — Partner-controlled AI base URL not checked against private/reserved IPs. Could target cloud metadata endpoints. |
| **H-5** | Input | `server/utils/security.ts:27` | **External image URLs allow tracking** — `isValidMediaUrl` accepts any HTTP(S) URL. Attacker embeds tracking pixel, leaks support staff IPs when they view the ticket. |
| **H-6** | AuthZ | `server/trpc/routers/ticket.ts:50` | **No department isolation** — Support users with assigned departments can query ALL partner tickets. `ctx.user.departments` is never read in `ticket.list`. |
| **H-7** | AuthZ | `server/trpc/routers/feedback.ts:86` | **Cross-tenant feedback mutation** — Platform operator without partner context can `markTreated` on ANY tenant's feedback items. |
| **H-8** | AuthZ | `server/socket/handlers.ts:259` | **Socket partnerId not validated against JWT** — Client-supplied `partnerId` in `socket:identify` can diverge from JWT claim, causing data to emit to wrong partner rooms. |
| **H-9** | AuthZ | `server/trpc/routers/stats.ts:153` | **Stats partner scope via manual guard** — `getGlobalStats` relies on inline `!ctx.user.partnerId` check instead of middleware chain. |
| **H-10** | Infra | `docker-compose.yml:66` | **Dev Redis has no auth** — No password on Redis in dev compose. Any container in the network can access session/presence data. |
| **H-11** | Infra | `server/app.ts:49` | **CORS allows null origin** — `!origin` passes CORS check, permitting requests from `file://` pages and sandboxed iframes. |
| **H-12** | Infra | `server/app.ts:258` | **Metrics endpoint open when `METRICS_TOKEN` unset** — Optional token means Prometheus metrics exposed publicly by default. |
| **H-13** | Infra | `client/Dockerfile.prod` | **Nginx container runs as root** — No `USER` directive in production nginx image. |

### MEDIUM (12)

| ID | Domain | File | Finding |
|----|--------|------|---------|
| **M-1** | Auth | `server/trpc/routers/mfa.ts:132` | **TOTP not marked used after MFA disable** — Same code replayable within 90s window. Inconsistent with login flow pattern. |
| **M-2** | Auth | `server/routes/sso.ts:216` | **SSO email conflict creates synthetic account** — Mangled `sso_${oid}_${email}` never receives emails. Should return error instead. |
| **M-3** | Input | `server/socket/handlers.ts:629` | **Guards fail open on Redis error** — All content moderation skipped during Redis outage. Synchronous guards (length, caps, injection) don't need Redis. |
| **M-4** | Input | `server/services/guards.ts:77` | **Swear regex global flag fragility** — Module-level singleton with `g` flag has stateful `lastIndex`. Safe today but fragile. Potential ReDoS on multi-word alternations. |
| **M-5** | Input | `server/trpc/routers/kb.ts:232` | **Unvalidated custom slug** — Accepts arbitrary characters including slashes/dots/null bytes. Should enforce `[a-z0-9-]+`. |
| **M-6** | AuthZ | `server/trpc/routers/ticket.ts:149` | **Agent IDOR on `ticket.getById`** — Agent can read any same-partner ticket by ID, not just their own. `ticket.list` enforces ownership but `getById` does not. |
| **M-7** | AuthZ | `server/trpc/routers/ticket.ts:143` | **Raw error messages to client** — Caught exceptions forward `err.message` including Postgres internals. |
| **M-8** | AuthZ | `server/socket/handlers.ts:487` | **`support:leave` no participant check** — Any support user in the partner can force-remove participants from any ticket. |
| **M-9** | Infra | `server/services/gdpr.ts:116` | **GDPR purge misses audit_log** — User `actorId` persists in audit records after erasure. |
| **M-10** | Infra | `server/services/gdpr.ts:20` | **Purge continues on broken WORM chain** — Hash chain violation logged but doesn't halt deletion. Undermines tamper detection. |
| **M-11** | Infra | `server/services/mail.ts:58` | **SMTP STARTTLS not enforced** — `secure: false` on port 587 allows MITM to strip TLS. Password reset emails at risk. |
| **M-12** | Infra | `server/app.ts:103` | **`DISABLE_RATE_LIMIT` unvalidated** — Read from raw `process.env`, not in Zod config. Could be accidentally set in production. |

### LOW / INFO (9)

| ID | Domain | File | Finding |
|----|--------|------|---------|
| **L-1** | Auth | `server/config.ts:16` | JWT_SECRET min 32 chars — borderline. Recommend 64+ for production. |
| **L-2** | Auth | `server/services/accountLockout.ts` | `checkLockout` uses stale in-memory user object. Safe due to atomic SQL but architecturally confusing. |
| **L-3** | Auth | `server/trpc/trpc.ts:25` | `platformBaseProcedure` bypasses step-up. Verify no sensitive mutations use it directly. |
| **L-4** | AuthZ | `server/trpc/trpc.ts:70` | `roleProcedure` doesn't guarantee partner scope — systemic structural risk for future consumers. |
| **L-5** | AuthZ | `server/socket/handlers.ts:193` | 5-minute revocation window on active sockets (documented trade-off). |
| **L-6** | AuthZ | `server/trpc/routers/user.ts:19` | Platform user list returns arbitrary first membership role, not partner-scoped. |
| **L-7** | Infra | `server/app.ts:127` | Request logging includes full query string — future endpoints with tokens in URLs would leak to logs. |
| **L-8** | Infra | `.env:28` | `JWT_EXPIRY=24h` is long for platform operator tokens. Consider 4-8h. |
| **L-9** | Infra | `client/nginx.conf:15` | HSTS commented out. No TLS termination in prod compose. |

---

## Remediation Priority

### Immediate (do now)

1. **Rotate all secrets** — If `.env` was ever pushed to a shared remote, rotate `JWT_SECRET`, `POSTGRES_PASSWORD`, `PLATFORM_ADMIN_PASSWORD`, `GRAFANA_ADMIN_PASSWORD`. Add `.env` to `.gitignore`.
2. **Fix label delete IDOR (CR-1)** — Remove platform operator bypass on `label.delete`. Apply `partnerId` filter unconditionally.
3. **Fix cross-tenant feedback mutation (H-7)** — Require `partnerId` in context before allowing `markTreated`.
4. **Validate AI `baseUrl` for SSRF (H-4)** — Apply `isPrivateOrReservedIP` check when saving `aiConfig.baseUrl`.

### Short-term (this sprint)

5. **Add department isolation to `ticket.list` (H-6)** — Filter non-generalist support users to their assigned departments.
6. **Validate socket `partnerId` against JWT (H-8)** — Derive from JWT or enforce match.
7. **Restrict `mediaUrl` to `/uploads/` paths (H-5)** — Or proxy external images server-side.
8. **Require `METRICS_TOKEN` in production (H-12)** — Fail closed when token is unset and request is non-local.
9. **Fix guard pipeline to fail closed for non-Redis guards (M-3)** — Separate synchronous guards from Redis-dependent ones.
10. **Halt GDPR purge on WORM chain violation (M-10)** — Throw instead of logging and continuing.
11. **Add agent ownership check to `ticket.getById` (M-6)** — Prevent intra-partner agent IDOR.

### Medium-term (next sprint)

12. **Increase recovery code entropy (H-2)** — `randomBytes(10)` for 80-bit codes.
13. **Surface logout revocation failures (H-3)** — Log security event or return 503 when Redis is down at logout.
14. **Remove dead MFA challenge token code (H-1)** — Or fully implement two-step challenge.
15. **Run nginx unprivileged (H-13)** — Switch to `nginxinc/nginx-unprivileged`.
16. **Enforce SMTP TLS (M-11)** — Set `requireTLS: true` on all mail transports.
17. **Validate `DISABLE_RATE_LIMIT` via Zod (M-12)** — Add to config.ts with production guard.
18. **Anonymize audit_log on GDPR purge (M-9)** — Null out `actorId` for purged users.
19. **Sanitize slug input (M-5)** — Enforce `[a-z0-9-]+` regex on custom slugs.
20. **Mark TOTP used in MFA enable/disable (M-1)** — Prevent 90s replay window.
21. **Create `partnerRoleProcedure` (L-4)** — Compose `partnerScopedProcedure` + role check to prevent future tenant leaks.

---

## Comparison with Previous Audit (2026-03-26)

| Area | Previous Status | Current Status |
|------|----------------|----------------|
| JWT algorithm pinning | Fixed ✅ | Still secure |
| Password hashing (Argon2id) | Secure ✅ | Still secure |
| Account lockout | Implemented ✅ | Working correctly |
| WORM audit chain | Implemented ✅ | New: purge doesn't halt on violation |
| Content moderation | Implemented ✅ | New: fails open on Redis outage |
| Multi-tenancy isolation | Reviewed ✅ | New: label delete IDOR, department gaps |
| SSRF protection | Webhooks validated ✅ | New: AI baseUrl not validated |
| Session revocation | Implemented ✅ | New: logout fails silently on Redis down |
| MFA | Implemented ✅ | New: dead challenge token, low entropy recovery codes |

---

## Methodology

Four parallel review agents examined:
- **Agent 1:** Authentication flows, session management, MFA, password policies, lockout
- **Agent 2:** Input validation, SQL injection, XSS, SSRF, file uploads, content moderation
- **Agent 3:** RBAC, multi-tenancy isolation, IDOR, privilege escalation, department filtering
- **Agent 4:** Docker security, secrets, CORS, rate limiting, GDPR, cryptography, dependencies

Each finding required ≥80% confidence after tracing the actual code paths. False positives were identified and excluded (e.g., parameterized SQL in `message:read`, Drizzle `sql` tag in KB tag filter).
