# Auth Routes + Partner Router Split Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split `server/routes/auth.ts` (852 lines) into 5 domain files and `server/trpc/routers/partner.ts` (772 lines) into 3 domain files, with zero API/client changes.

**Architecture:** Auth routes use Express `register*Routes(router)` pattern with shared rate limiter module. Partner router uses tRPC procedure-spreading barrel (same as platform split). Both use `NodeNext` module resolution — all directory imports must use explicit `/index.js`.

**Tech Stack:** Express 5, tRPC 11, Drizzle ORM, Zod, TypeScript (NodeNext)

**Source files to read:** Subagents should read the original monolith files to extract exact code. Do NOT modify the originals until Task 6 (auth) and Task 10 (partner) which create the barrels and delete the monoliths.

---

## Part 1: Auth Routes Split

### Task 1: Create `auth/rateLimit.ts` — shared rate limiter infrastructure

**Files:**
- Create: `server/routes/auth/rateLimit.ts`

- [ ] **Step 1: Read the source file and extract the rate limiter section**

Read `server/routes/auth.ts` lines 1-184. Extract:
- Lines 31-131: Rate limiter constants, memoryLimiter Map, cleanup interval, `fallbackRateLimit()`, `redisRateLimit()`, `loginRateLimit()`, `resetPasswordRateLimit()`, `refreshRateLimit()`
- Lines 133-152: `setRefreshCookie()`, `clearRefreshCookie()`
- Lines 154-176: `maskEmail()`, `findRecoveryCodeIndex()`
- Line 180: `import { getRedisClients } from '../utils/redis.js'` — adjust to `../../utils/redis.js`
- Lines 182-183: `FORGOT_PW_WINDOW_SECS`, `FORGOT_PW_MAX_PER_EMAIL` constants

Write to `server/routes/auth/rateLimit.ts` with these adjustments:
- All imports use `../../` prefix (one level deeper than before)
- Add `export` to: `loginRateLimit`, `resetPasswordRateLimit`, `refreshRateLimit`, `setRefreshCookie`, `clearRefreshCookie`, `maskEmail`, `findRecoveryCodeIndex`, `DUMMY_ARGON2_HASH` (from line 23), `FORGOT_PW_WINDOW_SECS`, `FORGOT_PW_MAX_PER_EMAIL`
- Import `express` types: `import { Request, Response } from 'express';`
- Import `crypto` for `findRecoveryCodeIndex`
- Import `config` from `../../config.js`
- Import `logger` from `../../utils/logger.js`
- Import `getRedisClients` from `../../utils/redis.js`

- [ ] **Step 2: Commit**

```bash
git add server/routes/auth/rateLimit.ts
git commit -m "refactor(auth): extract rate limiter + shared helpers to auth/rateLimit.ts"
```

---

### Task 2: Create `auth/password.ts` — forgot-password, reset-password

**Files:**
- Create: `server/routes/auth/password.ts`

- [ ] **Step 1: Read source and extract password routes**

Read `server/routes/auth.ts` lines 185-341. These are:
- `POST /forgot-password` (lines 185-247)
- `POST /reset-password` (lines 248-341)

Write `server/routes/auth/password.ts`:

```typescript
import express from 'express';
import crypto from 'crypto';
import { z } from 'zod';
import { db } from '../../db.js';
import { auditLog, users } from '../../db/schema.js';
import { eq } from 'drizzle-orm';
import { validateBody } from '../../middleware/validator.js';
import config from '../../config.js';
import logger from '../../utils/logger.js';
import { MailService } from '../../services/mail.js';
import { hashPassword, validatePasswordStrength, isPasswordReused, PASSWORD_HISTORY_LIMIT } from '../../utils/passwords.js';
import { findUserByEmail } from '../../services/authSession.js';
import { revokeUserSessions } from '../../services/sessionRevocation.js';
import { revokeAllUserRefreshTokens } from '../../services/refreshToken.js';
import { getRedisClients } from '../../utils/redis.js';
import { resetPasswordRateLimit, FORGOT_PW_WINDOW_SECS, FORGOT_PW_MAX_PER_EMAIL } from './rateLimit.js';

export function registerPasswordRoutes(router: express.Router): void {
  // Paste the two router.post() blocks from lines 185-341 here exactly as-is
  // (the route paths, middleware, handlers stay identical)
}
```

The function body contains the exact code from lines 185-341 of the original file. Read and copy it verbatim — only import paths change (add one `../` prefix to all relative imports).

- [ ] **Step 2: Commit**

```bash
git add server/routes/auth/password.ts
git commit -m "refactor(auth): extract password routes (forgot, reset)"
```

---

### Task 3: Create `auth/login.ts` — login-local, login

**Files:**
- Create: `server/routes/auth/login.ts`

- [ ] **Step 1: Read source and extract login routes**

Read `server/routes/auth.ts` lines 342-612. These are:
- `POST /login-local` (lines 342-481) — platform operator local auth with MFA
- `POST /login` (lines 482-612) — primary login dispatcher

Write `server/routes/auth/login.ts`:

```typescript
import express, { Request, Response } from 'express';
import crypto from 'crypto';
import { z } from 'zod';
import { db } from '../../db.js';
import { auditLog, partners, memberships, users } from '../../db/schema.js';
import { eq, and, isNull } from 'drizzle-orm';
import { validateBody } from '../../middleware/validator.js';
import config from '../../config.js';
import logger from '../../utils/logger.js';
import { User } from '../../types/index.js';
import { hashPassword, verifyPassword, validatePasswordStrength, isPasswordReused, PASSWORD_HISTORY_LIMIT } from '../../utils/passwords.js';
import { checkLockout, recordFailedLogin, resetFailedLogins } from '../../services/accountLockout.js';
import { buildAuthResponse, findUserByEmail, listUserMemberships, setAuthCookie, parseExpiryToSeconds } from '../../services/authSession.js';
import { createRefreshToken } from '../../services/refreshToken.js';
import { loginRateLimit, setRefreshCookie, maskEmail, findRecoveryCodeIndex, DUMMY_ARGON2_HASH } from './rateLimit.js';

export function registerLoginRoutes(router: express.Router): void {
  // Paste the two router.post() blocks from lines 342-612 here exactly as-is
}
```

- [ ] **Step 2: Commit**

```bash
git add server/routes/auth/login.ts
git commit -m "refactor(auth): extract login routes (login-local, login)"
```

---

### Task 4: Create `auth/session.ts` — refresh, logout, switch-partner, enter-partner

**Files:**
- Create: `server/routes/auth/session.ts`

- [ ] **Step 1: Read source and extract session routes**

Read `server/routes/auth.ts` lines 613-852. These are:
- `POST /switch-partner` (lines 613-678)
- `POST /refresh` (lines 679-754)
- `POST /logout` (lines 755-775)
- `POST /enter-partner` (lines 776-852)

Write `server/routes/auth/session.ts`:

```typescript
import express, { Request, Response } from 'express';
import { z } from 'zod';
import { db } from '../../db.js';
import { auditLog, partners, memberships, users } from '../../db/schema.js';
import { eq, and, isNull } from 'drizzle-orm';
import { validateBody } from '../../middleware/validator.js';
import config from '../../config.js';
import logger from '../../utils/logger.js';
import { AuthRequest } from '../../middleware/auth.js';
import { buildAuthResponse, buildAuthToken, getEnterPartnerContext, listUserMemberships, setAuthCookie, clearAuthCookie, parseExpiryToSeconds } from '../../services/authSession.js';
import { canAccessPartnerContext, isPlatformAdmin } from '../../services/roles.js';
import { revokeToken, revokeUserSessions } from '../../services/sessionRevocation.js';
import { isPlatformStepUpSatisfied } from '../../services/platformStepUp.js';
import { createRefreshToken, rotateRefreshToken, revokeAllUserRefreshTokens } from '../../services/refreshToken.js';
import { refreshRateLimit, setRefreshCookie, clearRefreshCookie } from './rateLimit.js';

export function registerSessionRoutes(router: express.Router): void {
  // Paste the four router.post() blocks from lines 613-852 here exactly as-is
  // Note: switch-partner and enter-partner use inline `(await import('../middleware/auth.js')).auth`
  // Change these to `(await import('../../middleware/auth.js')).auth`
}
```

- [ ] **Step 2: Commit**

```bash
git add server/routes/auth/session.ts
git commit -m "refactor(auth): extract session routes (refresh, logout, switch, enter)"
```

---

### Task 5: Verify auth sub-files compile independently

**Files:**
- No changes — verification only

- [ ] **Step 1: Check all 4 auth sub-files exist**

```bash
ls server/routes/auth/
```

Expected: `login.ts`, `password.ts`, `rateLimit.ts`, `session.ts`

- [ ] **Step 2: Commit** (skip if nothing to fix)

---

### Task 6: Create `auth/index.ts` barrel + delete old `auth.ts` + update imports

**Files:**
- Create: `server/routes/auth/index.ts`
- Delete: `server/routes/auth.ts`
- Modify: `server/app.ts:18` — update import path

- [ ] **Step 1: Create the barrel file**

```typescript
import express from 'express';
import logger from '../../utils/logger.js';
import { registerLoginRoutes } from './login.js';
import { registerPasswordRoutes } from './password.js';
import { registerSessionRoutes } from './session.js';

const router = express.Router();
logger.info('[Auth] Routes file loaded');

registerPasswordRoutes(router);
registerLoginRoutes(router);
registerSessionRoutes(router);

export default router;
```

- [ ] **Step 2: Delete the old monolith**

```bash
rm server/routes/auth.ts
```

- [ ] **Step 3: Update app.ts import path**

In `server/app.ts`, change line 18:
```typescript
// FROM:
import authRoutes from './routes/auth.js';
// TO:
import authRoutes from './routes/auth/index.js';
```

- [ ] **Step 4: Commit**

```bash
git add server/routes/auth/ server/routes/auth.ts server/app.ts
git commit -m "refactor(auth): add barrel index.ts, delete monolith auth.ts, update app.ts import"
```

---

## Part 2: Partner Router Split

### Task 7: Create `partner/config.ts` — partner configuration procedures

**Files:**
- Create: `server/trpc/routers/partner/config.ts`

- [ ] **Step 1: Read source and extract config procedures**

Read `server/trpc/routers/partner.ts` lines 1-443. Extract:
- Lines 15-48: `makeSlug()` and `scheduleFromLegacyBusinessHours()` helper functions
- Lines 50-209: `businessHoursWindowSchema` and related Zod schemas (if any before first procedure)
- Lines 211-443: procedures `getManifest`, `getAiConfig`, `getSlaConfig`, `updateSlaConfig`, `getBusinessHours`, `updateBusinessHours`, `updateDepartments`

Write `server/trpc/routers/partner/config.ts`:

```typescript
import { z } from 'zod';
import { router, adminProcedure, protectedProcedure } from '../../trpc.js';
import { db } from '../../../db.js';
import { partners, auditLog } from '../../../db/schema.js';
import { eq } from 'drizzle-orm';
import { TRPCError } from '@trpc/server';
import logger from '../../../utils/logger.js';
import { getBusinessHoursStatus, type BusinessHoursSchedule } from '../../../services/businessHours.js';
import { getPartnerAiConfig } from '../../../services/ai/index.js';
import config from '../../../config.js';

// Paste makeSlug() and scheduleFromLegacyBusinessHours() helpers here
// Paste any Zod schemas (businessHoursWindowSchema, etc.) here

export const partnerConfigRouter = router({
  // Paste getManifest, getAiConfig, getSlaConfig, updateSlaConfig,
  // getBusinessHours, updateBusinessHours, updateDepartments here
});
```

All import paths use `../../../` (one level deeper). Include ALL Zod schemas referenced by the procedures.

- [ ] **Step 2: Commit**

```bash
git add server/trpc/routers/partner/config.ts
git commit -m "refactor(partner): extract config sub-router (manifest, AI, SLA, business hours, depts)"
```

---

### Task 8: Create `partner/members.ts` — member management procedures

**Files:**
- Create: `server/trpc/routers/partner/members.ts`

- [ ] **Step 1: Read source and extract member procedures**

Read `server/trpc/routers/partner.ts` lines 444-773. These are:
- `listMembers` (lines 444-521)
- `addMemberByEmail` (lines 522-580)
- `inviteExternalUser` (lines 581-677)
- `updateMember` (lines 678-725)
- `removeMember` (lines 726-773)

Write `server/trpc/routers/partner/members.ts`:

```typescript
import { z } from 'zod';
import { router, adminProcedure } from '../../trpc.js';
import { db } from '../../../db.js';
import { partners, users, memberships, auditLog } from '../../../db/schema.js';
import { eq, ne, and, or, ilike, sql } from 'drizzle-orm';
import { TRPCError } from '@trpc/server';
import logger from '../../../utils/logger.js';
import { randomBytes } from 'crypto';
import { hashPassword } from '../../../utils/passwords.js';
import { canAssignTenantRole } from '../../../services/roles.js';
import config from '../../../config.js';

export const partnerMembersRouter = router({
  // Paste listMembers, addMemberByEmail, inviteExternalUser,
  // updateMember, removeMember here
});
```

- [ ] **Step 2: Commit**

```bash
git add server/trpc/routers/partner/members.ts
git commit -m "refactor(partner): extract members sub-router (list, add, invite, update, remove)"
```

---

### Task 9: Verify partner sub-files compile independently

**Files:**
- No changes — verification only

- [ ] **Step 1: Check both partner sub-files exist**

```bash
ls server/trpc/routers/partner/
```

Expected: `config.ts`, `members.ts`

- [ ] **Step 2: Commit** (skip if nothing to fix)

---

### Task 10: Create `partner/index.ts` barrel + delete old `partner.ts` + update imports

**Files:**
- Create: `server/trpc/routers/partner/index.ts`
- Delete: `server/trpc/routers/partner.ts`
- Modify: `server/trpc/router.ts` — update import path
- Modify: `server/trpc/routers/partner.businessHours.test.ts` — update import path

- [ ] **Step 1: Create the barrel file**

```typescript
import { router } from '../../trpc.js';
import { partnerConfigRouter } from './config.js';
import { partnerMembersRouter } from './members.js';

// Re-export schemas used by test files
export { validatedBusinessHoursScheduleSchema } from './config.js';

export const partnerRouter = router({
  ...partnerConfigRouter._def.procedures,
  ...partnerMembersRouter._def.procedures,
});
```

- [ ] **Step 2: Delete the old monolith**

```bash
rm server/trpc/routers/partner.ts
```

- [ ] **Step 3: Update router.ts import path**

In `server/trpc/router.ts`, change:
```typescript
// FROM:
import { partnerRouter } from './routers/partner.js';
// TO:
import { partnerRouter } from './routers/partner/index.js';
```

- [ ] **Step 4: Update test import path**

In `server/trpc/routers/partner.businessHours.test.ts`, find all occurrences of:
```typescript
from './partner.js'
```
Replace with:
```typescript
from './partner/index.js'
```
This includes both static imports (like `validatedBusinessHoursScheduleSchema`) and any dynamic imports.

- [ ] **Step 5: Commit**

```bash
git add server/trpc/routers/partner/ server/trpc/routers/partner.ts server/trpc/router.ts server/trpc/routers/partner.businessHours.test.ts
git commit -m "refactor(partner): add barrel index.ts, delete monolith, update imports"
```

---

## Part 3: Verification + Docs

### Task 11: Verify — typecheck + tests

**Files:**
- No file changes — verification only

- [ ] **Step 1: Copy files to Docker container and run typecheck**

```bash
# From the main tessera directory:
docker cp server/routes/auth tessera-server-1:/app/routes/auth
docker cp server/trpc/routers/partner tessera-server-1:/app/trpc/routers/partner
docker cp server/app.ts tessera-server-1:/app/app.ts
docker cp server/trpc/router.ts tessera-server-1:/app/trpc/router.ts
docker cp server/trpc/routers/partner.businessHours.test.ts tessera-server-1:/app/trpc/routers/partner.businessHours.test.ts
# Remove old monoliths from container:
docker compose exec server sh -c "rm -f /app/routes/auth.ts /app/trpc/routers/partner.ts"
docker compose exec server npx tsc --noEmit
```

Expected: No errors.

- [ ] **Step 2: Run server tests**

```bash
docker compose exec server npm test
```

Expected: All tests pass.

- [ ] **Step 3: Fix any issues and commit**

```bash
git add -A
git commit -m "fix: resolve import paths after auth+partner split"
```

---

### Task 12: Update CLAUDE.md project structure

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Update the routes section**

Find:
```
│   ├── routes/
│   │   ├── auth.ts                # /api/auth/* (login, switch-partner, enter-partner, refresh, logout)
```

Replace with:
```
│   ├── routes/
│   │   ├── auth/                  # /api/auth/* — split into domain modules
│   │   │   ├── index.ts           # Barrel mounting sub-routers
│   │   │   ├── rateLimit.ts       # Redis-backed rate limiters + shared helpers
│   │   │   ├── login.ts           # /login, /login-local
│   │   │   ├── password.ts        # /forgot-password, /reset-password
│   │   │   └── session.ts         # /refresh, /logout, /switch-partner, /enter-partner
```

- [ ] **Step 2: Update the partner router entry in the routers list**

In the tRPC routers comment, change `partner,` to `partner/,` to indicate it's now a directory (same as `platform/`).

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: update CLAUDE.md for auth routes + partner router split"
```
