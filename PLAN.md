# Tessera — Next Sprint Plan

**Created**: 2026-03-24
**Status**: Ready to implement

---

## Feature 1: MFA Admin Management

**Size**: Small
**Problem**: Platform operators can't see who has MFA enabled or force-disable it for a locked-out user.

### Backend

**File**: `server/trpc/routers/platform.ts`

1. **Update `listGlobalUsers` query** — add `mfa_enabled_at` and `locked_until` to the SELECT so the UI knows MFA and lockout status per user.

2. **New procedure: `platform.disableMfa`**
   - Input: `{ userId: string }`
   - Guard: `platformProcedure` (platform operators only)
   - Logic:
     ```
     1. Verify target user exists and has MFA enabled (mfaEnabledAt != null)
     2. Set mfaSecret = null, mfaEnabledAt = null, mfaRecoveryCodes = []
     3. Create audit log entry: action = 'security.mfa_force_disabled'
     4. Send email notification to user (fire-and-forget)
     5. Return { success: true }
     ```
   - Email template: `renderMfaDisabledByAdmin({ name, operatorName })`

3. **New procedure: `platform.unlockUser`** (bonus, pairs well)
   - Input: `{ userId: string }`
   - Logic: reset `failedLoginAttempts = 0`, `lockedUntil = null`
   - Audit: `'security.user_unlocked'`

### Frontend

**File**: `client/src/components/platform/UserTable.tsx`

1. **MFA status badge** — Show shield icon per user row:
   - Green-filled shield: MFA enabled
   - Grey outline shield: MFA not enabled
   - Red lock icon: Account currently locked

2. **Actions dropdown/buttons per user** — Add "Disable MFA" and "Unlock Account" actions:
   - "Disable MFA" → confirmation dialog → calls `platform.disableMfa`
   - "Unlock Account" → confirmation dialog → calls `platform.unlockUser`
   - Both show toast on success

### Email Template

**File**: `server/services/mailTemplates.ts`

Add `renderMfaDisabledByAdmin({ name, operatorName })`:
```
Subject: Tessera — Two-Factor Authentication Disabled
Body: "Hi {name}, a platform administrator ({operatorName}) has disabled
two-factor authentication on your account. If this was not expected,
contact your administrator immediately."
```

### Test Plan

- [ ] Platform operator can see MFA badge on user row
- [ ] Platform operator can disable MFA for a user with MFA enabled
- [ ] Disabled user can log in without MFA challenge
- [ ] Audit log records `security.mfa_force_disabled` with actor + target
- [ ] Email sent to user when MFA is force-disabled
- [ ] Non-platform-operator cannot call `disableMfa`
- [ ] Platform operator can unlock a locked account
- [ ] Locked badge disappears after unlock

---

## Feature 2: Notification Preferences

**Size**: Medium
**Problem**: No way for users to opt out of specific email types.

### Database

**Migration**: `server/drizzle/0009_notification_preferences.sql`

Option A — JSONB column on users table:
```sql
ALTER TABLE users ADD COLUMN notification_preferences jsonb DEFAULT '{}';
```

Option B — Separate table (more normalized, better for querying):
```sql
CREATE TABLE notification_preferences (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  account_locked BOOLEAN NOT NULL DEFAULT true,
  mfa_enabled BOOLEAN NOT NULL DEFAULT true,
  mfa_disabled BOOLEAN NOT NULL DEFAULT true,
  password_changed BOOLEAN NOT NULL DEFAULT true,
  ticket_archived BOOLEAN NOT NULL DEFAULT true,
  updated_at TIMESTAMP DEFAULT NOW()
);
```

**Recommendation**: Option A (JSONB) — simpler, no joins, easy to extend. Schema:
```typescript
interface NotificationPreferences {
  accountLocked?: boolean;    // default true
  mfaEnabled?: boolean;       // default true
  mfaDisabled?: boolean;      // default true
  passwordChanged?: boolean;  // default true
}
```
Missing keys = default `true` (opt-out model: everything on unless explicitly turned off).

### Backend

**File**: `server/trpc/routers/user.ts`

1. **`user.getNotificationPrefs`** — `protectedProcedure`
   - Returns current user's notification preferences JSONB
   - Defaults to `{}` (all enabled)

2. **`user.updateNotificationPrefs`** — `protectedProcedure`
   - Input: partial `NotificationPreferences` object
   - Merges with existing prefs (spread, not replace)
   - Audit log: `'user.notification_prefs_updated'`

**File**: `server/services/mail.ts` — Add preference check helper:
```typescript
static async shouldSendNotification(
  userId: string,
  notificationType: keyof NotificationPreferences
): Promise<boolean> {
  const user = await db.select({ notificationPreferences: users.notificationPreferences })
    .from(users).where(eq(users.id, userId)).limit(1);
  const prefs = (user[0]?.notificationPreferences || {}) as NotificationPreferences;
  return prefs[notificationType] !== false; // default true
}
```

Update all `MailService.send*` methods to check preferences before sending.

### Frontend

**File**: `client/src/components/UserSecurityModal.tsx`

Add "Notifications" section (below MFA, above password change):
- Toggle switches for each notification type
- Labels: "Account lockout alerts", "MFA changes", "Password changes"
- Auto-save on toggle (debounced mutation)
- Show "All notifications enabled" summary when all are on

### Test Plan

- [ ] Default preferences return all enabled
- [ ] User can disable specific notification type
- [ ] Disabled notification type does NOT send email
- [ ] Re-enabling notification type resumes emails
- [ ] Preferences survive page reload
- [ ] Platform operators cannot change another user's prefs (scoped to self)

---

## Feature 3: API Documentation

**Size**: Medium
**Problem**: No documentation for REST + tRPC endpoints.

### Approach

Use a **hybrid strategy**:

1. **REST endpoints** (auth, uploads, logos) → OpenAPI/Swagger via `swagger-jsdoc` + `swagger-ui-express`
2. **tRPC endpoints** → Auto-generated reference using `trpc-openapi` OR a custom static docs page

### Backend — REST API Docs

**New file**: `server/docs/openapi.ts`

```typescript
import swaggerJsdoc from 'swagger-jsdoc';

export const openapiSpec = swaggerJsdoc({
  definition: {
    openapi: '3.0.0',
    info: { title: 'Tessera API', version: '1.0.0' },
    servers: [{ url: '/api' }],
    components: {
      securitySchemes: {
        bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
      },
    },
  },
  apis: ['./routes/*.ts'], // JSDoc annotations on route handlers
});
```

**File**: `server/app.ts` — Mount Swagger UI:
```typescript
import swaggerUi from 'swagger-ui-express';
import { openapiSpec } from './docs/openapi.js';

app.use('/api/docs', swaggerUi.serve, swaggerUi.setup(openapiSpec));
```

**Auth routes** — Add JSDoc annotations:
```typescript
/**
 * @openapi
 * /auth/login-local:
 *   post:
 *     summary: Authenticate with email and password
 *     tags: [Authentication]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               email: { type: string }
 *               password: { type: string }
 *     responses:
 *       200: { description: JWT token + user profile }
 *       401: { description: Invalid credentials }
 *       423: { description: Account locked }
 */
```

### Backend — tRPC Docs

**Option A (Recommended)**: Static markdown generated from router definitions
- Script: `server/scripts/generate-trpc-docs.ts`
- Walks all routers, extracts procedure names, input schemas (Zod → JSON Schema), auth level
- Outputs `server/docs/trpc-reference.md`

**Option B**: `trpc-openapi` plugin to expose tRPC procedures as REST endpoints with OpenAPI docs
- More complex, requires `.meta()` on every procedure
- Better for external consumers

**Recommendation**: Start with Option A (static docs), move to Option B if external API access is needed.

### Frontend — Docs Link

- Add "API Docs" link in PlatformView nav bar (only for platform operators)
- Opens `/api/docs` in new tab

### Dependencies

```bash
npm install swagger-jsdoc swagger-ui-express
npm install -D @types/swagger-jsdoc @types/swagger-ui-express
```

### Test Plan

- [ ] `/api/docs` serves Swagger UI
- [ ] All REST endpoints documented with request/response schemas
- [ ] tRPC reference doc generated and up-to-date
- [ ] Docs only accessible to authenticated platform operators (or behind token)
- [ ] No sensitive information exposed in docs (no example tokens, passwords)

---

## Implementation Order

```
1. MFA Admin Management     ✅ DONE 2026-03-24
2. API Documentation         ✅ DONE 2026-03-24
3. Notification Preferences  ✅ DONE 2026-03-24
```

---

## Security Hardening Backlog (Separate Sprint)

These items were identified but deferred — tackle after the three features above:

| # | Item | Effort |
|---|------|--------|
| # | Item | Effort | Status |
|---|------|--------|--------|
| 1 | CSP headers (Helmet config) | Small | ✅ Done 2026-03-24 |
| 2 | SSO state → Redis | Small | ✅ Done 2026-03-24 |
| 3 | Rate limit uploads + tRPC | Medium | |
| 4 | SSO JWT signature verification (JWKS) | Medium | |
| 5 | React error boundaries per view | Small | ✅ Done 2026-03-24 |
| 6 | Socket.io `error` event listener | Small | ✅ Done 2026-03-24 |
| 7 | Socket disconnect resource cleanup | Medium | |
| 8 | tRPC retry config | Small | ✅ Done 2026-03-24 |
| 9 | Expand test coverage (socket, uploads, tRPC routers) | Large | |
| 10 | Multi-tenant isolation integration tests | Medium | |
| 11 | Pre-commit hooks (husky + lint) | Small | |
| 12 | GDPR purge jitter | Small | ✅ Done 2026-03-24 |
