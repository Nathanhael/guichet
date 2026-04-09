# Auth Routes + Partner Router Split — Design Spec

**Date**: 2026-04-09
**Goal**: Split `server/routes/auth.ts` (852 lines) and `server/trpc/routers/partner.ts` (772 lines) into domain-focused sub-files for AI agent navigability. Same pattern as the platform router split.

## Motivation

These are the 2nd and 3rd largest files in the project. AI agents must load the entire file to edit any single route or procedure, wasting context and increasing error risk. Both have natural domain boundaries.

---

## Part 1: Auth Routes Split

### Current State

`server/routes/auth.ts` — 852 lines, 8 POST endpoints, shared rate limiter infrastructure (~180 lines).

Imported by: `server/app.ts` only (`import authRoutes from './routes/auth.js'`).

### File Structure

```
server/routes/auth/
├── index.ts        (~20 lines)  — barrel: creates Express router, mounts sub-routers
├── rateLimit.ts    (~180 lines) — Redis-backed rate limiters, memory fallback, cleanup interval
├── login.ts        (~270 lines) — /login, /login-local (platform operator local auth)
├── password.ts     (~160 lines) — /forgot-password, /reset-password
└── session.ts      (~220 lines) — /refresh, /logout, /switch-partner, /enter-partner
```

The old `server/routes/auth.ts` is deleted after the split.

### Route Assignments

#### rateLimit.ts

Shared infrastructure — no routes, only exports:
- `loginRateLimit` middleware
- `resetPasswordRateLimit` middleware
- `refreshRateLimit` middleware
- Redis-backed `rateLimit()` helper function
- In-memory fallback `memoryLimiter` Map + cleanup interval
- Rate limit constants (`AUTH_RATE_WINDOW_SECS`, `AUTH_RATE_MAX_LOGIN`, `AUTH_RATE_MAX_RESET`, `AUTH_RATE_MAX_REFRESH`)

**Imports**: `config`, `logger`, `getRedisClients`

#### login.ts

| Route | Line | Description |
|-------|------|-------------|
| `POST /login-local` | 342 | Platform operator local login (email/password + MFA) |
| `POST /login` | 482 | Primary login — delegates to local or SSO flow |

**Imports**: `rateLimit.ts` (loginRateLimit), `db`, `users`, `memberships`, `partners`, `auditLog`, `authSession.*`, `accountLockout.*`, `passwords.*`, `refreshToken.*`, `roles.*`, `sessionRevocation.*`

Owns the `DUMMY_ARGON2_HASH` constant (only consumer).

#### password.ts

| Route | Line | Description |
|-------|------|-------------|
| `POST /forgot-password` | 185 | Send password reset email |
| `POST /reset-password` | 248 | Verify token + set new password |

**Imports**: `rateLimit.ts` (resetPasswordRateLimit), `db`, `users`, `auditLog`, `MailService`, `passwords.*`, `authSession.*`, `crypto`, `config`

#### session.ts

| Route | Line | Description |
|-------|------|-------------|
| `POST /refresh` | 679 | Rotate refresh token, issue new access token |
| `POST /logout` | 755 | Revoke current token, clear cookies |
| `POST /switch-partner` | 613 | Switch active partner context (new JWT) |
| `POST /enter-partner` | 776 | Platform operator enters partner context |

**Imports**: `rateLimit.ts` (refreshRateLimit), `db`, `users`, `memberships`, `partners`, `auditLog`, `authSession.*`, `refreshToken.*`, `roles.*`, `sessionRevocation.*`, `platformStepUp.*`, `auth` middleware

### Barrel Pattern (index.ts)

```typescript
import express from 'express';
import { registerLoginRoutes } from './login.js';
import { registerPasswordRoutes } from './password.js';
import { registerSessionRoutes } from './session.js';

const router = express.Router();

registerLoginRoutes(router);
registerPasswordRoutes(router);
registerSessionRoutes(router);

export default router;
```

Each sub-file exports a `register*Routes(router: express.Router)` function that mounts its routes on the passed-in router. This keeps the barrel thin and avoids Express router merging complexity.

### What Changes

| File | Change |
|------|--------|
| `server/routes/auth.ts` | Deleted — replaced by `auth/` directory |
| `server/routes/auth/index.ts` | New — barrel mounting sub-routers |
| `server/routes/auth/rateLimit.ts` | New — shared rate limiter infrastructure |
| `server/routes/auth/login.ts` | New — login routes |
| `server/routes/auth/password.ts` | New — password reset routes |
| `server/routes/auth/session.ts` | New — session management routes |
| `server/app.ts` | Import path: `./routes/auth.js` → `./routes/auth/index.js` |
| `server/routes/auth.enterPartner.test.ts` | Import path update if it references auth routes directly |

### What Doesn't Change

- All API endpoints (`/api/v1/auth/*`) — identical paths, identical behavior
- SSO routes (`server/routes/sso.ts`) — separate file, unaffected
- Client-side auth calls — zero changes

---

## Part 2: Partner Router Split

### Current State

`server/trpc/routers/partner.ts` — 772 lines, 13 procedures (mix of `adminProcedure` and `protectedProcedure`), 2 helper functions.

### File Structure

```
server/trpc/routers/partner/
├── index.ts        (~20 lines)  — barrel merging sub-routers via procedure spreading
├── config.ts       (~380 lines) — partner configuration (manifest, AI, SLA, business hours, departments)
└── members.ts      (~350 lines) — member management (list, add, invite, update, remove)
```

The old `server/trpc/routers/partner.ts` is deleted after the split.

### Procedure Assignments

#### config.ts

| Procedure | Middleware | ~Lines |
|-----------|-----------|--------|
| `getManifest` | adminProcedure | ~20 |
| `getAiConfig` | protectedProcedure | ~12 |
| `getSlaConfig` | adminProcedure | ~18 |
| `updateSlaConfig` | adminProcedure | ~42 |
| `getBusinessHours` | protectedProcedure | ~33 |
| `updateBusinessHours` | adminProcedure | ~53 |
| `updateDepartments` | adminProcedure | ~56 |

Owns helper functions: `makeSlug()`, `scheduleFromLegacyBusinessHours()`

**Imports**: `db`, `partners`, `auditLog`, `adminProcedure`, `protectedProcedure`, `businessHours.*`, `ai/index.*`, `config`

#### members.ts

| Procedure | Middleware | ~Lines |
|-----------|-----------|--------|
| `listMembers` | adminProcedure | ~78 |
| `addMemberByEmail` | adminProcedure | ~59 |
| `inviteExternalUser` | adminProcedure | ~97 |
| `updateMember` | adminProcedure | ~48 |
| `removeMember` | adminProcedure | ~46 |

**Imports**: `db`, `users`, `memberships`, `partners`, `auditLog`, `adminProcedure`, `hashPassword`, `roles.*`, `randomBytes`, `config`

### Barrel Pattern (index.ts)

```typescript
import { router } from '../../trpc.js';
import { partnerConfigRouter } from './config.js';
import { partnerMembersRouter } from './members.js';

export const partnerRouter = router({
  ...partnerConfigRouter._def.procedures,
  ...partnerMembersRouter._def.procedures,
});
```

Same procedure-spreading pattern as the platform router split.

### What Changes

| File | Change |
|------|--------|
| `server/trpc/routers/partner.ts` | Deleted — replaced by `partner/` directory |
| `server/trpc/routers/partner/index.ts` | New — barrel merging sub-routers |
| `server/trpc/routers/partner/config.ts` | New — config procedures |
| `server/trpc/routers/partner/members.ts` | New — member procedures |
| `server/trpc/router.ts` | Import path: `./routers/partner.js` → `./routers/partner/index.js` |
| `server/trpc/routers/partner.businessHours.test.ts` | Import path update |

### What Doesn't Change

- All client-side `trpc.partner.*` calls — identical namespace, identical shape
- `AppRouter` type — identical

---

## Verification

1. TypeScript compiles (`docker compose exec server npx tsc --noEmit`)
2. All server tests pass (`docker compose exec server npm test`)
3. No client-side code changes
4. API endpoints and tRPC procedure names identical before and after
