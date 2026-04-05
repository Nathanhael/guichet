# SSO-Only Auth — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove local auth (passwords, MFA, lockout) for all partner users. Only platform operators keep local login as a bootstrap/fallback mechanism. Partners authenticate exclusively via SSO.

**Architecture:** Guard existing auth code to platform operators rather than deleting it. The login flow splits into two paths: SSO (primary, all users) and local (platform operators only, hidden behind a link). The invite flow stops generating temp passwords for partner users.

**Tech Stack:** Express, tRPC, Zod, Drizzle ORM, PostgreSQL, React 19, TypeScript, Vitest

**Spec:** `docs/superpowers/specs/2026-04-04-toolbar-status-auth-design.md` — Section 3

**Docker reminder:** All `npm`, `node`, `npx` commands MUST run via `docker compose exec server ...` or `docker compose exec client ...`. Never on the host.

---

## File Structure

| Action | File | Responsibility |
|--------|------|---------------|
| Modify | `server/routes/auth.ts` | Guard local login to platform operators |
| Modify | `server/trpc/routers/mfa.ts` | Guard all MFA procedures to platform operators |
| Modify | `server/trpc/routers/user.ts` | Guard changePassword; update invite flow |
| Modify | `server/services/accountLockout.ts` | Guard lockout to platform operators |
| Modify | `server/db/schema.ts` | Default partner authMethod to `'sso'` |
| Modify | `client/src/views/LoginView.tsx` | SSO-primary login screen |
| Modify | `client/src/components/UserSecurityModal.tsx` | Conditional content by user type |
| Modify | `client/src/components/UserMenu.tsx` | Show security for platform operators only |
| Create | `server/drizzle/0002_sso_only_default.sql` | Migration for authMethod default |
| Modify | `client/src/locales/en.ts` | New translation keys |
| Modify | `client/src/locales/nl.ts` | New translation keys |
| Modify | `client/src/locales/fr.ts` | New translation keys |

---

### Task 1: Guard MFA Router to Platform Operators

**Files:**
- Modify: `server/trpc/routers/mfa.ts`
- Modify: `server/__tests__/mfa.test.ts` (if exists, update expectations)

- [ ] **Step 1: Read the current MFA router**

Read `server/trpc/routers/mfa.ts` to understand the current procedures.

- [ ] **Step 2: Add a platform operator guard to every procedure**

At the top of each procedure (beginSetup, enable, disable, getStatus, regenerateRecoveryCodes), add:

```typescript
if (!ctx.user.isPlatformOperator) {
  throw new TRPCError({ code: 'FORBIDDEN', message: 'MFA is only available for platform operators' });
}
```

The cleanest approach: create a `platformOnlyProcedure` or add the guard inline at the start of each procedure's resolver. Since there are only ~5 procedures, inline is fine.

- [ ] **Step 3: Verify server tests pass**

Run: `docker compose exec server npm test`
If there are MFA tests that test non-platform-operator access, update them to expect FORBIDDEN.

- [ ] **Step 4: Commit**

```bash
git add server/trpc/routers/mfa.ts
git commit -m "feat: guard MFA router to platform operators only"
```

---

### Task 2: Guard changePassword and Update Invite Flow

**Files:**
- Modify: `server/trpc/routers/user.ts`

- [ ] **Step 1: Read the changePassword procedure**

Read `server/trpc/routers/user.ts` to find the `changePassword` procedure.

- [ ] **Step 2: Add platform operator guard to changePassword**

At the start of the changePassword resolver, add:

```typescript
if (!ctx.user.isPlatformOperator) {
  throw new TRPCError({ code: 'FORBIDDEN', message: 'Password management is only available for platform operators' });
}
```

- [ ] **Step 3: Read the invite procedure**

Find the invite/inviteExternalUser procedure in the user or partner router.

- [ ] **Step 4: Update invite to skip temp password for non-platform users**

In the invite flow, check the partner's authMethod. If it's `'sso'`, skip password generation:

```typescript
// Only generate temp password for local auth (platform operator context)
let tempPassword: string | null = null;
let hashedPassword: string | undefined;

if (isLocal) {
  tempPassword = randomBytes(12).toString('base64url');
  hashedPassword = await hashPassword(tempPassword);
}
```

The invite flow already has this logic for `authMethod: 'sso'` — verify it works correctly when partner default is `'sso'`.

- [ ] **Step 5: Verify server tests pass**

Run: `docker compose exec server npm test`

- [ ] **Step 6: Commit**

```bash
git add server/trpc/routers/user.ts server/trpc/routers/partner.ts
git commit -m "feat: guard changePassword to platform operators, verify invite SSO flow"
```

---

### Task 3: Guard Login Route for Non-Platform Local Login

**Files:**
- Modify: `server/routes/auth.ts`

- [ ] **Step 1: Read the login POST handler**

Read `server/routes/auth.ts` to find the `POST /login` handler.

- [ ] **Step 2: Add platform operator check after user lookup**

After the user is found by email but before password verification, add a check:

```typescript
// Local login is only available for platform operators
// Partner users must use SSO
if (!user.isPlatformOperator) {
  logger.warn({ email: maskEmail(email) }, '[Auth] Local login rejected: non-platform user must use SSO');
  return res.status(403).json({ error: 'Local login is not available. Please use SSO to sign in.' });
}
```

This goes after the `findUserByEmail` call and before the `verifyPassword` call. This way, even if someone knows a partner user's password, they can't use local login.

- [ ] **Step 3: Also guard the forgot-password and reset-password endpoints**

In `POST /forgot-password`, after finding the user:

```typescript
if (!user.isPlatformOperator) {
  // Don't reveal that the user exists, just return success
  return res.json({ message: 'If this email exists, a reset link has been sent.' });
}
```

In `POST /reset-password`, after finding the user by token:

```typescript
if (!user.isPlatformOperator) {
  return res.status(403).json({ error: 'Password reset is not available for this account.' });
}
```

- [ ] **Step 4: Verify server tests pass**

Run: `docker compose exec server npm test`

- [ ] **Step 5: Commit**

```bash
git add server/routes/auth.ts
git commit -m "feat: restrict local login, forgot-password, reset-password to platform operators"
```

---

### Task 4: Guard Account Lockout to Platform Operators

**Files:**
- Modify: `server/services/accountLockout.ts`

- [ ] **Step 1: Read the current accountLockout service**

Read `server/services/accountLockout.ts`.

- [ ] **Step 2: Add platform operator guard to recordFailedLogin**

The `recordFailedLogin` function receives a user object. Add an early return for non-platform operators:

```typescript
export async function recordFailedLogin(user: { id: string; isPlatformOperator?: boolean; email?: string }): Promise<void> {
  // Lockout only applies to platform operators (partner users use SSO)
  if (!user.isPlatformOperator) return;
  // ... existing logic
}
```

This is a safety net — since Task 3 already blocks non-platform local login, this function should never be called for partner users. But defense in depth.

- [ ] **Step 3: Update tests if needed**

Check `server/__tests__/accountLockout.test.ts` — if it exists, add a test that verifies non-platform users skip lockout.

- [ ] **Step 4: Verify server tests pass**

Run: `docker compose exec server npm test`

- [ ] **Step 5: Commit**

```bash
git add server/services/accountLockout.ts
git commit -m "feat: guard account lockout to platform operators only"
```

---

### Task 5: Update Partner authMethod Default in Schema

**Files:**
- Modify: `server/db/schema.ts`
- Create: `server/drizzle/0002_sso_only_default.sql`
- Modify: `server/drizzle/meta/_journal.json`

- [ ] **Step 1: Update schema default**

In `server/db/schema.ts`, change the partner `authMethod` default:

```typescript
// Old
authMethod: authMethodEnum('auth_method').notNull().default('local'),
// New
authMethod: authMethodEnum('auth_method').notNull().default('sso'),
```

- [ ] **Step 2: Write migration SQL**

Create `server/drizzle/0002_sso_only_default.sql`:

```sql
-- Change default authMethod for new partners from 'local' to 'sso'
ALTER TABLE "partners" ALTER COLUMN "auth_method" SET DEFAULT 'sso';

-- Update existing partners that use 'local' to 'sso'
-- (breaking change: existing local-auth partners need SSO configured)
UPDATE "partners" SET "auth_method" = 'sso' WHERE "auth_method" = 'local';

-- Update partners using 'both' to 'sso' (SSO is now the only option)
UPDATE "partners" SET "auth_method" = 'sso' WHERE "auth_method" = 'both';
```

- [ ] **Step 3: Update journal**

Add entry to `server/drizzle/meta/_journal.json`:

```json
{
  "idx": 2,
  "version": "7",
  "when": 1775656800000,
  "tag": "0002_sso_only_default",
  "breakpoints": true
}
```

- [ ] **Step 4: Apply migration**

```bash
docker compose exec server node -e "
const fs = require('fs');
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const sql = fs.readFileSync('/app/drizzle/0002_sso_only_default.sql', 'utf-8');
pool.query(sql).then(() => { console.log('Migration applied'); pool.end(); }).catch(e => { console.error(e.message); pool.end(); });
"
```

- [ ] **Step 5: Commit**

```bash
git add server/db/schema.ts server/drizzle/
git commit -m "feat: default partner authMethod to 'sso', migrate existing partners"
```

---

### Task 6: Update LoginView — SSO Primary

**Files:**
- Modify: `client/src/views/LoginView.tsx`

- [ ] **Step 1: Read the current LoginView**

Read `client/src/views/LoginView.tsx` to understand the full component structure.

- [ ] **Step 2: Restructure the login screen**

The current LoginView has multiple modes: standard, demo, forgot, reset, mfa. Restructure the `standard` mode:

**Primary view:** Large SSO button(s) — one per configured SSO provider, or a generic "Sign in with SSO" button that redirects to the SSO flow.

**Secondary:** A small, understated "Platform administrator" link at the bottom. Clicking it reveals the email + password form (current standard login form).

Conceptual structure:

```tsx
{viewMode === 'standard' && !showPlatformLogin && (
  <div>
    {/* SSO login — primary */}
    <h1>TESSERA</h1>
    <p>Sign in with your organization's identity provider</p>
    <button onClick={handleSsoLogin} className="...full-width...">
      {t('sign_in_sso')}
    </button>
    
    {/* Platform admin link — small, at bottom */}
    <button onClick={() => setShowPlatformLogin(true)} className="...text-muted text-xs...">
      {t('platform_admin_login')}
    </button>
  </div>
)}

{viewMode === 'standard' && showPlatformLogin && (
  <div>
    {/* Existing email + password form */}
    <button onClick={() => setShowPlatformLogin(false)}>← {t('back_to_sso')}</button>
    {/* ... existing form ... */}
  </div>
)}
```

Add state: `const [showPlatformLogin, setShowPlatformLogin] = useState(false);`

Keep the existing `demo`, `forgot`, `reset`, `mfa` modes unchanged — they're only reachable from the platform login form.

- [ ] **Step 3: Remove the demo mode filter buttons**

The demo user list (filter by role) is a development convenience. Keep it accessible but only from the platform login path. The SSO primary view should not show demo users.

- [ ] **Step 4: Verify the component renders without errors**

Run: `docker compose exec client npx vitest run src/views/__tests__/ --reporter=verbose`

- [ ] **Step 5: Commit**

```bash
git add client/src/views/LoginView.tsx
git commit -m "feat: restructure LoginView with SSO primary, platform admin login secondary"
```

---

### Task 7: Update UserSecurityModal — Conditional Content

**Files:**
- Modify: `client/src/components/UserSecurityModal.tsx`
- Modify: `client/src/components/UserMenu.tsx`

- [ ] **Step 1: Read UserSecurityModal**

Read `client/src/components/UserSecurityModal.tsx` to understand the current structure.

- [ ] **Step 2: Add platform operator detection**

The modal needs to know if the current user is a platform operator. Read from the store:

```typescript
const user = useStore((s) => s.user);
const isPlatformOperator = user?.isPlatformOperator ?? false;
```

- [ ] **Step 3: Conditionally render sections**

```tsx
{/* Password change — platform operators only */}
{isPlatformOperator && (
  <div>
    {/* existing password change form */}
  </div>
)}

{/* MFA setup — platform operators only */}
{isPlatformOperator && (
  <div>
    {/* existing MFA setup/status/disable */}
  </div>
)}

{/* Notification preferences — always shown */}
<div>
  {/* existing notification preference toggles */}
</div>
```

For non-platform users, the modal becomes just a notification preferences panel.

- [ ] **Step 4: Update UserMenu to always show security**

In `client/src/components/UserMenu.tsx`, the `showSecurity` prop currently controls visibility. Since notification preferences are in the security modal and relevant to all users, consider showing the menu item for everyone but label it differently:

- Platform operators: "Account Security" (shield icon)
- Partner users: "Notification Preferences" (bell icon)

Or simpler: always show "Settings" and let the modal content adapt.

Update the views that render UserMenu:
- `SupportNav.tsx`: `<UserMenu showSecurity />` — keep as-is, modal will adapt
- `AgentNav.tsx`: `<UserMenu showFeedback showSecurity />` — keep as-is
- `AdminView.tsx`: `<UserMenu showSecurity />` — add showSecurity (was missing)
- `PlatformView.tsx`: `<UserMenu showSecurity />` — add showSecurity

- [ ] **Step 5: Verify build compiles**

Run: `docker compose exec client npx tsc --noEmit` (may OOM — check for errors manually)

- [ ] **Step 6: Commit**

```bash
git add client/src/components/UserSecurityModal.tsx client/src/components/UserMenu.tsx client/src/views/AdminView.tsx client/src/views/PlatformView.tsx
git commit -m "feat: conditional security modal content based on user type"
```

---

### Task 8: Add Translation Keys

**Files:**
- Modify: `client/src/locales/en.ts`
- Modify: `client/src/locales/nl.ts`
- Modify: `client/src/locales/fr.ts`

- [ ] **Step 1: Add SSO-related keys to all 3 locales**

**EN:**
```typescript
    sign_in_sso: 'Sign in with SSO',
    platform_admin_login: 'Platform administrator login',
    back_to_sso: 'Back to SSO login',
    sso_login_description: 'Sign in with your organization\'s identity provider',
    local_login_restricted: 'Local login is only available for platform administrators',
    notification_preferences: 'Notification Preferences',
```

**NL:**
```typescript
    sign_in_sso: 'Inloggen met SSO',
    platform_admin_login: 'Platform administrator login',
    back_to_sso: 'Terug naar SSO login',
    sso_login_description: 'Log in met de identiteitsprovider van uw organisatie',
    local_login_restricted: 'Lokale login is alleen beschikbaar voor platformbeheerders',
    notification_preferences: 'Meldingsvoorkeuren',
```

**FR:**
```typescript
    sign_in_sso: 'Se connecter avec SSO',
    platform_admin_login: 'Connexion administrateur plateforme',
    back_to_sso: 'Retour à la connexion SSO',
    sso_login_description: 'Connectez-vous avec le fournisseur d\'identité de votre organisation',
    local_login_restricted: 'La connexion locale est réservée aux administrateurs de la plateforme',
    notification_preferences: 'Préférences de notification',
```

- [ ] **Step 2: Commit**

```bash
git add client/src/locales/
git commit -m "feat: add SSO-only auth translation keys"
```

---

### Task 9: Update Seed Script and Test Helpers

**Files:**
- Modify: `server/seed.ts`
- Modify: `client/src/test/helpers.tsx`

- [ ] **Step 1: Update seed script**

In `server/seed.ts`, the demo partners are created with `authMethod: 'local'`. Update to `authMethod: 'sso'`:

Search for partner creation and update the authMethod values. The platform operator bootstrap account keeps its local auth.

- [ ] **Step 2: Update test helpers**

In `client/src/test/helpers.tsx`, the `makePartner` factory defaults `authMethod: 'local'`. Update to `authMethod: 'sso'`:

```typescript
authMethod: 'sso',
```

- [ ] **Step 3: Reseed database**

Run: `docker compose exec server npx tsx seed.ts`

- [ ] **Step 4: Commit**

```bash
git add server/seed.ts client/src/test/helpers.tsx
git commit -m "refactor: update seed and test helpers for SSO-only auth model"
```

---

### Task 10: Final Verification

- [ ] **Step 1: Search for remaining local-auth assumptions**

```bash
grep -rn "authMethod.*local\|default.*local" server/ client/src/ --include='*.ts' --include='*.tsx' | grep -v node_modules | grep -v '.test.' | grep -v drizzle/
```

Any remaining `'local'` defaults should be reviewed — they may be legitimate (platform operator context) or need updating.

- [ ] **Step 2: Run all tests**

```bash
docker compose exec client npx vitest run
docker compose exec server npm test
```

- [ ] **Step 3: Manual smoke test**

1. Open the app — verify SSO button is primary on login screen
2. Click "Platform administrator login" — verify email/password form appears
3. Log in as platform operator — verify security modal shows password + MFA
4. Log in as support/admin via demo — verify security modal shows only notification preferences
5. Verify platform operator can still enter partner context

- [ ] **Step 4: Commit if any cleanup needed**

```bash
git add -A
git commit -m "chore: final cleanup for SSO-only auth"
```
