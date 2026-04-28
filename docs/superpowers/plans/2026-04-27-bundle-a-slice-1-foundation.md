# Bundle A / Slice 1 — services/auth/ Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up a new `server/services/auth/` deep module (types + capabilities + actor builders) with the `isExternal` claim wired through every JWT mint site and read by both transports — without migrating any production socket handler or tRPC router callsite.

**Architecture:** New consolidated auth module exposes `Actor` / `UserRole` / `Capability` types, a `RULES` map of 7 capabilities composing existing `roles.ts` helpers, and three actor builders (`socketActor`, `trpcActor`, `actorFactory`). JWT payload gains an optional `isExternal: boolean` claim threaded through SSO callback, dev-login, refresh, switch-partner, and enter-partner. Express auth middleware and Socket.io `setupJwtMiddleware` populate `req.user.isExternal` / `socket.data.isExternal` from the claim (defaulting to `false` if absent — supports rollout window). `services/ticketLifecycle/types.ts` and `services/ticketLifecycle/actor.ts` are gutted to single-line re-exports from the new module so no parallel `Actor` definition survives. Production socket handlers and tRPC routers are NOT touched in this slice — they keep calling lifecycle's `socketActor` (whose body now reuses auth's types) and migrate in slices #68–#71.

**Tech Stack:** TypeScript, tRPC 11, Socket.io, jose JWT, Drizzle ORM, Vitest + PGLite (in-process Postgres), Docker-only npm/node/npx execution.

**Parent issue:** [#66](https://github.com/Nathanhael/guichet/issues/66) (PRD #65, RFC #63).

---

## Pre-flight: Decisions Locked Before Coding

This slice freezes the module's public API for four parallel streams (#67, #68, #69, #70, #71). Confirm or override before writing code.

### Decisions taken (recommendation: keep as-is)

**D1. `Actor` is a union of `UserActor | SystemActor`, both defined in `auth/types.ts`.**
Rationale: PRD section "Actor shape" describes the canonical user-shaped fields; SystemActor is genuinely an actor concept (used for system-initiated lifecycle events: auto-archive, auto-summarize, GDPR purge). Keeping both in auth satisfies "no parallel Actor type definitions remain" without forcing lifecycle to invent a `LifecycleActor` superset. Issue #66's listed exports (`Actor`, `UserRole`, `Capability`) are non-exhaustive — `UserActor` and `SystemActor` are co-exported.

**D2. `isSupport` cached field is DROPPED from `UserActor`.**
Rationale: PRD's canonical 6-field list excludes it. Replacement is `isSupportLike(actor.role)` from `roles.ts`. Lifecycle internal callsites are updated mechanically (Task 16). Cost: ~10–15 callsites. Benefit: removes the "is this still in sync with role?" foot-gun.

**D3. `setupJwtMiddleware` populates `socket.data.isExternal` at handshake from the JWT.**
Rationale: Issue #66 acceptance says "socket:identify event preserves `isExternal` on `socket.data` (no DB lookup needed at identify time)". Reading from JWT at handshake is the only no-DB-lookup path. Identify handler is updated to NOT clobber the field (it currently writes `socket.data.userId/role/name/partnerId/isSupport/lang/identified` — we leave `isExternal` untouched there).

**D4. `id` field on `UserActor` is renamed to `userId` per PRD.**
Rationale: Verbatim from PRD Implementation Decisions. Mechanical rename across lifecycle services + tests in Task 16.

**D5. `name` field is KEPT on `UserActor` despite not appearing in PRD's 6-field enumeration.**
Rationale: Lifecycle services use `actor.name` for system-message generation and audit display. Dropping forces a per-call DB lookup at every system-message insertion site. `name` is parallel to `lang` (display-cached, not auth-relevant). PRD's enumeration reads as the auth-essential subset, not exhaustive.
**Override path:** if you want strict PRD adherence, drop `name`, add a `getActorName(actor)` lookup helper, and update all system-message-emitting code to await the lookup.

**D6. `kind: 'user' | 'system'` discriminator is KEPT.**
Rationale: Required for type-safe union narrowing between `UserActor` and `SystemActor`. Lifecycle relies on `isUserActor()` guard.

**D7. `isPlatformOperator` is ADDED to `UserActor`.**
Rationale: Per PRD canonical shape. Lifecycle's existing `UserActor` lacked this field; capabilities like `platform_admin` need it to evaluate.

### Open question — scope of lifecycle migration

**Q. Lifecycle's `actor.ts`: full re-export shim, or hybrid (re-exports types, keeps its own `socketActor` function)?**

Issue #66 acceptance says lifecycle `actor.ts` is "gutted to single-line re-exports from `services/auth/`". Strictly read, this means `lifecycle/actor.ts` would `export { socketActor, ... } from '../auth'`. But auth's new `socketActor` returns `UserActor | null` (RFC signature) while lifecycle's current `socketActor` returns `UserActor` non-null. Re-exporting auth's version forces every socket handler that calls lifecycle's `socketActor` to add a null check — a callsite change, contradicting "No production socket handler or tRPC router callsite is changed in this PR".

**Recommended interpretation:** lifecycle/types.ts becomes a single-line re-export of types only. Lifecycle/actor.ts KEEPS its `socketActor` function (with body adjusted to construct the new-shape `UserActor` — drops `isSupport`, renames `id`→`userId`, adds `isPlatformOperator`) but imports its types from auth. This preserves caller signatures so socket handlers don't break. Slice #7 (issue #72) deletes lifecycle/actor.ts entirely once handlers have migrated to auth's `socketActor` directly.

This plan executes the recommended interpretation. If you want strict gutting, see "Strict Mode" callout in Task 15.

---

## File Structure

### Files to create

| Path | Responsibility |
|---|---|
| `server/services/auth/types.ts` | Type contract: `UserRole`, `Capability`, `UserActor`, `SystemActor`, `Actor` union, `SYSTEM_ACTOR` const, `isUserActor` guard |
| `server/services/auth/capabilities.ts` | `RULES: Record<Capability, (UserActor) => boolean>` composing `roles.ts` helpers; `can(actor, cap)`; `assertCan(actor, cap)` (throws) |
| `server/services/auth/actor.ts` | `socketActor(socket, opts?): UserActor \| null`; `trpcActor(ctx, opts?): UserActor`; `actorFactory(overrides): UserActor` |
| `server/services/auth/index.ts` | Barrel: re-export the public surface from the 3 files above |
| `server/services/auth/capabilities.test.ts` | Truth-table test: every Capability × (role × isPlatformOperator × isExternal) combination |
| `server/services/auth/actor.test.ts` | `socketActor` + `trpcActor` happy paths + every rejection mode |
| `server/services/auth/jwt.test.ts` | New tokens contain `isExternal`; tokens missing the claim deserialize to `false` |
| `server/services/auth/session.boundary.test.ts` | Login mints token, refresh rotates family, actor flows correctly (revocation deferred to slice #67) |

### Files to modify

| Path | Change |
|---|---|
| `server/services/authSession.ts` | `buildAuthToken` accepts `isExternal: boolean` (added to payload) |
| `server/trpc/context.ts` | `jwtPayloadSchema` adds `isExternal: z.boolean().optional()`; `Context.user` gains `isExternal: boolean` |
| `server/middleware/auth.ts` | Read `decoded.isExternal ?? false`; set `req.user.isExternal` |
| `server/socket/handlers/auth.ts` | `setupJwtMiddleware` sets `socket.data.isExternal = decoded.isExternal ?? false`; identify handler does NOT touch the field |
| `server/services/roles.ts` | Add actor-adapted variants: `canAssignTenantRole(actor, targetRole)`, `canChangePresence(actor, targetUserId)`, `canAccessPartnerContext(actor)`; existing function signatures preserved |
| `server/routes/sso.ts` | Pass `isExternal` to `buildAuthToken` (read from `users.isExternal` already in scope at line ~280) |
| `server/routes/auth/devLogin.ts` | Pass `isExternal` to `buildAuthToken` (add to user SELECT, ~line 30) |
| `server/routes/auth/session.ts` | Pass `isExternal` in 3 mint sites (`/switch-partner` L49, `/refresh` L110 + L131, `/enter-partner` L200) |
| `server/services/ticketLifecycle/types.ts` | Single-line re-export of `Actor`, `UserActor`, `SystemActor` from `../auth/types` |
| `server/services/ticketLifecycle/actor.ts` | Keep `socketActor`, `systemActor`, `isUserActor` exports; bodies updated to construct new-shape `UserActor`; types imported from `../auth` |
| `server/services/ticketLifecycle/<various>.ts` | Internal callsites: `actor.id`→`actor.userId`, `actor.isSupport`→`isSupportLike(actor.role)` |
| `server/services/ticketLifecycle/<various>.test.ts` | Update Actor mocks: drop `isSupport`, rename `id`→`userId`, add `isPlatformOperator` |
| `CHANGELOG.md` | Unreleased entry: "Add `isExternal` claim to JWT payload" |

### Files NOT touched in this slice

- `server/socket/handlers/{message,ticket,presence,collision,rating,disconnect}.ts` — migrate in #68–#70
- `server/trpc/routers/**` — migrate in #71
- `server/trpc/trpc.ts` — `blockExternalUsers` middleware deletion deferred to #71
- `server/socket/partnerScope.ts` — folded in #72

---

## Conventions

- **Test runner:** `docker compose exec server npm test -- <path/to/file.test.ts>`. Vitest passthrough.
- **Type check:** `docker compose exec server npx tsc --noEmit -p .`
- **CI:** `powershell -File scripts/ci.ps1` (final task only)
- **Server reload after edits:** `docker compose restart server` (per memory: tsx watch unreliable on Windows bind mount). Required between Tasks 5 and any test that depends on a runtime change. NOT required for pure-Vitest unit tests since Vitest re-reads on each invocation.
- **Commit style:** `feat(auth): <description>` for new files, `refactor(auth): <description>` for migrations, `test(auth): <description>` for test-only commits. Each task ends with a single commit.
- **Branch:** create a feature branch off main: `git checkout -b feat/bundle-a-slice-1-auth-foundation`

---

## Tasks

### Task 1: Define `UserRole` and `Capability` types

**Files:**
- Create: `server/services/auth/types.ts`

- [ ] **Step 1: Create the types file with role + capability unions**

```typescript
// server/services/auth/types.ts

export type UserRole = 'agent' | 'support' | 'admin' | 'platform_operator';

export type Capability =
  | 'tenant_admin'
  | 'platform_admin'
  | 'support_like'
  | 'use_support_workflows'
  | 'manage_tenant'
  | 'export_tickets'
  | 'destructive_admin';
```

- [ ] **Step 2: Type-check passes**

Run: `docker compose exec server npx tsc --noEmit -p .`
Expected: No new errors (file has no consumers yet).

- [ ] **Step 3: Commit**

```bash
git add server/services/auth/types.ts
git commit -m "feat(auth): add UserRole and Capability type unions"
```

---

### Task 2: Define `UserActor`, `SystemActor`, `Actor` union

**Files:**
- Modify: `server/services/auth/types.ts`

- [ ] **Step 1: Append the actor type definitions**

```typescript
// Append to server/services/auth/types.ts

export interface UserActor {
  kind: 'user';
  userId: string;
  name: string;
  role: UserRole;
  partnerId: string;          // never null for partner-scoped actors
  isPlatformOperator: boolean;
  isExternal: boolean;         // Azure B2B guest flag
  lang: string;
}

export interface SystemActor {
  kind: 'system';
  id: '__system__';
  name: 'System';
}

export type Actor = UserActor | SystemActor;

export const SYSTEM_ACTOR: SystemActor = {
  kind: 'system',
  id: '__system__',
  name: 'System',
};

export function isUserActor(actor: Actor): actor is UserActor {
  return actor.kind === 'user';
}
```

- [ ] **Step 2: Type-check passes**

Run: `docker compose exec server npx tsc --noEmit -p .`
Expected: No new errors.

- [ ] **Step 3: Commit**

```bash
git add server/services/auth/types.ts
git commit -m "feat(auth): add UserActor, SystemActor, and Actor union types"
```

---

### Task 3: Add actor-adapted variants to `roles.ts`

The capability `RULES` table in Task 4 will compose role-helper functions. Three of the helpers take additional arguments that the canonical Actor needs to provide cleanly. Add actor-shaped wrappers now so capabilities.ts can stay tight.

**Files:**
- Modify: `server/services/roles.ts`
- Test: existing `server/services/roles.test.ts` (extend)

- [ ] **Step 1: Write the failing test**

Append to `server/services/roles.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import {
  canAssignTenantRole as canAssignTenantRoleArgs,
  canChangePresenceStatus,
  canAccessPartnerContext as canAccessPartnerContextArgs,
  canAssignTenantRoleForActor,
  canChangePresenceForActor,
  canAccessPartnerContextForActor,
} from './roles.js';
import type { UserActor } from './auth/types.js';

const userActor = (overrides: Partial<UserActor> = {}): UserActor => ({
  kind: 'user',
  userId: 'u-1',
  name: 'Test',
  role: 'admin',
  partnerId: 'p-1',
  isPlatformOperator: false,
  isExternal: false,
  lang: 'en',
  ...overrides,
});

describe('roles — actor-adapted variants', () => {
  it('canAssignTenantRoleForActor mirrors arg-form result', () => {
    const actor = userActor({ role: 'admin', isPlatformOperator: false });
    expect(canAssignTenantRoleForActor(actor, 'support')).toBe(
      canAssignTenantRoleArgs(actor.role, actor.isPlatformOperator, 'support')
    );
  });

  it('canChangePresenceForActor mirrors arg-form result', () => {
    const actor = userActor({ role: 'admin' });
    expect(canChangePresenceForActor(actor, 'u-2')).toBe(
      canChangePresenceStatus(actor.role, actor.userId, 'u-2', actor.isPlatformOperator)
    );
  });

  it('canAccessPartnerContextForActor returns true for matching partner', () => {
    const actor = userActor({ partnerId: 'p-1' });
    expect(canAccessPartnerContextForActor(actor)).toBe(
      canAccessPartnerContextArgs(actor.isPlatformOperator, actor.partnerId)
    );
  });

  it('canAccessPartnerContextForActor honors platform operators', () => {
    const actor = userActor({ isPlatformOperator: true, partnerId: 'p-7' });
    expect(canAccessPartnerContextForActor(actor)).toBe(true);
  });
});
```

- [ ] **Step 2: Run the test, expect failure**

Run: `docker compose exec server npm test -- server/services/roles.test.ts`
Expected: FAIL — `canAssignTenantRoleForActor` etc. not exported.

- [ ] **Step 3: Implement the actor-adapted variants**

Append to `server/services/roles.ts`:

```typescript
import type { UserActor } from './auth/types.js';

export function canAssignTenantRoleForActor(actor: UserActor, targetRole: UserRole): boolean {
  return canAssignTenantRole(actor.role, actor.isPlatformOperator, targetRole);
}

export function canChangePresenceForActor(actor: UserActor, targetUserId: string): boolean {
  return canChangePresenceStatus(actor.role, actor.userId, targetUserId, actor.isPlatformOperator);
}

export function canAccessPartnerContextForActor(actor: UserActor): boolean {
  return canAccessPartnerContext(actor.isPlatformOperator, actor.partnerId);
}
```

- [ ] **Step 4: Run the test, expect pass**

Run: `docker compose exec server npm test -- server/services/roles.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/services/roles.ts server/services/roles.test.ts
git commit -m "feat(auth): add actor-adapted variants to roles helpers"
```

---

### Task 4: Implement `capabilities.ts` with `RULES` map + `can` + `assertCan`

**Files:**
- Create: `server/services/auth/capabilities.ts`
- Test: `server/services/auth/capabilities.test.ts`

- [ ] **Step 1: Write the truth-table failing test**

```typescript
// server/services/auth/capabilities.test.ts

import { describe, it, expect } from 'vitest';
import { can, assertCan } from './capabilities.js';
import type { Capability, UserActor, UserRole } from './types.js';

const ALL_ROLES: UserRole[] = ['agent', 'support', 'admin', 'platform_operator'];
const ALL_CAPS: Capability[] = [
  'tenant_admin',
  'platform_admin',
  'support_like',
  'use_support_workflows',
  'manage_tenant',
  'export_tickets',
  'destructive_admin',
];

const actor = (overrides: Partial<UserActor>): UserActor => ({
  kind: 'user',
  userId: 'u-1',
  name: 'Test',
  role: 'agent',
  partnerId: 'p-1',
  isPlatformOperator: false,
  isExternal: false,
  lang: 'en',
  ...overrides,
});

// Truth table — assert ground truth per (role × isPlatformOperator × isExternal × cap).
// Format: [role, isPlatformOperator, isExternal, capability, expected]
const TRUTH_TABLE: Array<[UserRole, boolean, boolean, Capability, boolean]> = [
  // tenant_admin: role === 'admin' (platform operators do NOT get tenant_admin via this cap)
  ['agent',             false, false, 'tenant_admin',          false],
  ['support',           false, false, 'tenant_admin',          false],
  ['admin',             false, false, 'tenant_admin',          true],
  ['admin',             false, true,  'tenant_admin',          true],   // isExternal does not gate tenant_admin alone
  ['platform_operator', true,  false, 'tenant_admin',          false],

  // platform_admin: isPlatformOperator === true
  ['agent',             false, false, 'platform_admin',        false],
  ['admin',             false, false, 'platform_admin',        false],
  ['platform_operator', true,  false, 'platform_admin',        true],
  ['platform_operator', true,  true,  'platform_admin',        true],   // platform operators are never B2B guests in practice

  // support_like: support OR admin OR platform operator
  ['agent',             false, false, 'support_like',          false],
  ['support',           false, false, 'support_like',          true],
  ['admin',             false, false, 'support_like',          true],
  ['platform_operator', true,  false, 'support_like',          true],

  // use_support_workflows: support OR admin OR platform_operator (same as support_like in current rules)
  ['agent',             false, false, 'use_support_workflows', false],
  ['support',           false, false, 'use_support_workflows', true],
  ['admin',             false, false, 'use_support_workflows', true],
  ['platform_operator', true,  false, 'use_support_workflows', true],

  // manage_tenant: admin OR platform_operator
  ['agent',             false, false, 'manage_tenant',         false],
  ['support',           false, false, 'manage_tenant',         false],
  ['admin',             false, false, 'manage_tenant',         true],
  ['platform_operator', true,  false, 'manage_tenant',         true],

  // export_tickets: same access set as use_support_workflows
  ['agent',             false, false, 'export_tickets',        false],
  ['support',           false, false, 'export_tickets',        true],
  ['admin',             false, false, 'export_tickets',        true],
  ['platform_operator', true,  false, 'export_tickets',        true],

  // destructive_admin: !isExternal && (tenant_admin || platform_admin)
  ['admin',             false, false, 'destructive_admin',     true],
  ['admin',             false, true,  'destructive_admin',     false],  // B2B guest blocked
  ['platform_operator', true,  false, 'destructive_admin',     true],
  ['platform_operator', true,  true,  'destructive_admin',     false],
  ['support',           false, false, 'destructive_admin',     false],
  ['agent',             false, false, 'destructive_admin',     false],
];

describe('capabilities — truth table', () => {
  for (const [role, isPlatformOperator, isExternal, cap, expected] of TRUTH_TABLE) {
    it(`${cap}: role=${role} platform=${isPlatformOperator} external=${isExternal} → ${expected}`, () => {
      const a = actor({ role, isPlatformOperator, isExternal });
      expect(can(a, cap)).toBe(expected);
    });
  }
});

describe('capabilities — exhaustive cap coverage', () => {
  it('every Capability has a rule (no undefined results)', () => {
    const a = actor({ role: 'admin', isPlatformOperator: false, isExternal: false });
    for (const cap of ALL_CAPS) {
      expect(typeof can(a, cap)).toBe('boolean');
    }
  });

  it('rule signatures stay total over UserRole', () => {
    for (const role of ALL_ROLES) {
      const a = actor({ role });
      for (const cap of ALL_CAPS) {
        expect(typeof can(a, cap)).toBe('boolean');
      }
    }
  });
});

describe('assertCan', () => {
  it('returns silently when the actor has the capability', () => {
    const a = actor({ role: 'admin' });
    expect(() => assertCan(a, 'manage_tenant')).not.toThrow();
  });

  it('throws an Error when the actor lacks the capability', () => {
    const a = actor({ role: 'agent' });
    expect(() => assertCan(a, 'manage_tenant')).toThrow();
  });

  it('throws when destructive_admin is requested by a B2B guest', () => {
    const a = actor({ role: 'admin', isExternal: true });
    expect(() => assertCan(a, 'destructive_admin')).toThrow();
  });
});
```

- [ ] **Step 2: Run the test, expect failure**

Run: `docker compose exec server npm test -- server/services/auth/capabilities.test.ts`
Expected: FAIL — `capabilities.ts` does not exist.

- [ ] **Step 3: Implement `capabilities.ts`**

```typescript
// server/services/auth/capabilities.ts

import type { Capability, UserActor } from './types.js';
import {
  isTenantAdmin,
  isPlatformAdmin,
  isSupportLike,
  canUseSupportWorkflows,
  canManageTenant,
  canExportTickets,
} from '../roles.js';

type Rule = (actor: UserActor) => boolean;

export const RULES: Record<Capability, Rule> = {
  tenant_admin: (a) => isTenantAdmin(a.role),
  platform_admin: (a) => isPlatformAdmin(a.isPlatformOperator),
  support_like: (a) => isSupportLike(a.role) || isPlatformAdmin(a.isPlatformOperator),
  use_support_workflows: (a) => canUseSupportWorkflows(a.role, a.isPlatformOperator),
  manage_tenant: (a) => canManageTenant(a.role, a.isPlatformOperator),
  export_tickets: (a) => canExportTickets(a.role, a.isPlatformOperator),
  destructive_admin: (a) =>
    !a.isExternal && (isTenantAdmin(a.role) || isPlatformAdmin(a.isPlatformOperator)),
};

export function can(actor: UserActor, cap: Capability): boolean {
  return RULES[cap](actor);
}

export class CapabilityDeniedError extends Error {
  constructor(public readonly capability: Capability) {
    super(`Actor does not have capability: ${capability}`);
    this.name = 'CapabilityDeniedError';
  }
}

export function assertCan(actor: UserActor, cap: Capability): void {
  if (!RULES[cap](actor)) {
    throw new CapabilityDeniedError(cap);
  }
}
```

- [ ] **Step 4: Run the test, expect pass**

Run: `docker compose exec server npm test -- server/services/auth/capabilities.test.ts`
Expected: PASS — all truth-table rows green, exhaustive coverage and assertCan blocks green.

- [ ] **Step 5: Commit**

```bash
git add server/services/auth/capabilities.ts server/services/auth/capabilities.test.ts
git commit -m "feat(auth): add capability RULES map with can/assertCan + truth-table test"
```

---

### Task 5: Add `isExternal` to JWT payload schema

**Files:**
- Modify: `server/trpc/context.ts`
- Test: `server/services/auth/jwt.test.ts`

- [ ] **Step 1: Write the failing JWT-shape test**

```typescript
// server/services/auth/jwt.test.ts

import { describe, it, expect } from 'vitest';
import { jwtVerify, SignJWT } from 'jose';
import { jwtPayloadSchema } from '../../trpc/context.js';

const secret = new TextEncoder().encode('test-secret-min-32-chars-padding-padding');

async function mintToken(payload: Record<string, unknown>): Promise<string> {
  return new SignJWT(payload)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('15m')
    .setJti('jti-test')
    .sign(secret);
}

describe('JWT payload schema — isExternal claim', () => {
  it('parses tokens that contain isExternal=true', async () => {
    const token = await mintToken({
      userId: 'u-1',
      role: 'admin',
      partnerId: 'p-1',
      isPlatformOperator: false,
      isExternal: true,
    });
    const { payload } = await jwtVerify(token, secret);
    const parsed = jwtPayloadSchema.parse(payload);
    expect(parsed.isExternal).toBe(true);
  });

  it('parses tokens that contain isExternal=false', async () => {
    const token = await mintToken({
      userId: 'u-1',
      role: 'admin',
      partnerId: 'p-1',
      isPlatformOperator: false,
      isExternal: false,
    });
    const { payload } = await jwtVerify(token, secret);
    const parsed = jwtPayloadSchema.parse(payload);
    expect(parsed.isExternal).toBe(false);
  });

  it('parses legacy tokens (missing isExternal claim) without throwing', async () => {
    const token = await mintToken({
      userId: 'u-1',
      role: 'admin',
      partnerId: 'p-1',
      isPlatformOperator: false,
      // no isExternal
    });
    const { payload } = await jwtVerify(token, secret);
    const parsed = jwtPayloadSchema.parse(payload);
    expect(parsed.isExternal).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run the test, expect failure**

Run: `docker compose exec server npm test -- server/services/auth/jwt.test.ts`
Expected: FAIL — schema does not include `isExternal`, parser strips it.

- [ ] **Step 3: Add `isExternal` to schema**

In `server/trpc/context.ts`, find `jwtPayloadSchema` (zod). Add `isExternal: z.boolean().optional()` next to the other fields. Keep all other fields untouched.

```typescript
// In server/trpc/context.ts — extend the existing schema, do not rewrite it.
// (Locate the existing jwtPayloadSchema and add the line below.)

export const jwtPayloadSchema = z.object({
  userId: z.string(),
  role: z.enum(['agent', 'support', 'admin', 'platform_operator']),
  partnerId: z.string().optional(),
  membershipId: z.string().optional(),
  departments: z.array(z.string()).optional(),
  isPlatformOperator: z.boolean(),
  isExternal: z.boolean().optional(),     // ← ADD THIS LINE
  jti: z.string().optional(),
  exp: z.number().optional(),
  iat: z.number().optional(),
});
```

(If the existing schema is shaped differently than shown, only add the `isExternal` line and keep the rest verbatim. Use Read first to confirm the surrounding structure.)

- [ ] **Step 4: Run the test, expect pass**

Run: `docker compose exec server npm test -- server/services/auth/jwt.test.ts`
Expected: PASS — three cases green.

- [ ] **Step 5: Commit**

```bash
git add server/trpc/context.ts server/services/auth/jwt.test.ts
git commit -m "feat(auth): add optional isExternal claim to JWT payload schema"
```

---

### Task 6: Add `isExternal` parameter to `buildAuthToken`

**Files:**
- Modify: `server/services/authSession.ts`

- [ ] **Step 1: Read the current `buildAuthToken` signature**

Run: open `server/services/authSession.ts:73` to confirm the existing parameter object shape.

- [ ] **Step 2: Add `isExternal` to the input type and payload write**

Locate `buildAuthToken` and modify its input type + the `payload` object it signs. Concretely:

```typescript
// server/services/authSession.ts — extend the existing function

export async function buildAuthToken(input: {
  userId: string;
  role: UserRole;
  departments?: string[];
  partnerId?: string;
  membershipId?: string;
  isPlatformOperator: boolean;
  isExternal: boolean;          // ← NEW required param
}): Promise<string> {
  const payload = {
    jti: randomUUID(),
    userId: input.userId,
    role: input.role,
    departments: input.departments ?? [],
    partnerId: input.partnerId,
    membershipId: input.membershipId,
    isPlatformOperator: input.isPlatformOperator,
    isExternal: input.isExternal,     // ← NEW field in payload
  };
  // existing signing code unchanged
  ...
}
```

(Type-check will catch every callsite and force them to pass `isExternal` — addressed in Task 7.)

- [ ] **Step 3: Type-check fails (expected — this lights up Task 7's surface)**

Run: `docker compose exec server npx tsc --noEmit -p .`
Expected: FAIL with 5 callsite errors — one per mint site (sso.ts, devLogin.ts, session.ts × 3).

- [ ] **Step 4: Do NOT commit yet — Task 7 closes the loop**

Hold the working tree dirty. Type errors are intentional and resolved in Task 7. (If you want a clean intermediate commit, make `isExternal` optional with `false` default, but the cleaner end-state is required + every callsite explicit.)

---

### Task 7: Wire `isExternal` through 5 JWT mint sites

**Files:**
- Modify: `server/routes/sso.ts` (line ~308)
- Modify: `server/routes/auth/devLogin.ts` (line ~48)
- Modify: `server/routes/auth/session.ts` (lines ~49, ~110, ~131, ~200)

Each site already loads (or can cheaply load) `users.isExternal` from the DB.

- [ ] **Step 1: SSO callback — pass `isExternal` from the looked-up user row**

In `server/routes/sso.ts` around line 308:

Locate the `await buildAuthToken({ ... })` call. The handler already has the user row in scope (it sets `user.isExternal` for `buildAuthResponse`). Pass the same value to `buildAuthToken`:

```typescript
const token = await buildAuthToken({
  userId,
  role,
  departments,
  partnerId,
  membershipId,
  isPlatformOperator,
  isExternal: user.isExternal ?? false,    // ← ADD
});
```

- [ ] **Step 2: dev-login — pass from the user lookup**

In `server/routes/auth/devLogin.ts` around line 48:

Add `isExternal` to the user SELECT (extend the existing Drizzle query) and pass through:

```typescript
const user = await db
  .select({
    id: users.id,
    name: users.name,
    email: users.email,
    isPlatformOperator: users.isPlatformOperator,
    isExternal: users.isExternal,    // ← ADD if not already selected
    // ...
  })
  .from(users)
  .where(eq(users.id, userId))
  .limit(1);

// ...

const token = await buildAuthToken({
  userId,
  role,
  departments,
  partnerId,
  membershipId,
  isPlatformOperator,
  isExternal: user[0]?.isExternal ?? false,    // ← ADD
});
```

- [ ] **Step 3: `/switch-partner` — pass from user lookup**

In `server/routes/auth/session.ts` around line 49:

The handler reads `req.user.id`. Look up `users.isExternal` (or accept it from `req.user.isExternal` once Task 8 lands). For now, lookup explicitly:

```typescript
const userRow = await db
  .select({ isExternal: users.isExternal })
  .from(users)
  .where(eq(users.id, req.user.id))
  .limit(1);

const token = await buildAuthToken({
  userId: req.user.id,
  role: membership.role,
  departments: membership.departments,
  partnerId,
  membershipId: membership.id,
  isPlatformOperator: req.user.isPlatformOperator,
  isExternal: userRow[0]?.isExternal ?? false,    // ← ADD
});
```

- [ ] **Step 4: `/refresh` (platform operator branch, line ~110)**

```typescript
const userRow = await db
  .select({ isExternal: users.isExternal })
  .from(users)
  .where(eq(users.id, refreshResult.userId))
  .limit(1);

const token = await buildAuthToken({
  userId: refreshResult.userId,
  role: 'platform_operator',
  departments: [],
  partnerId: undefined,
  membershipId: undefined,
  isPlatformOperator: true,
  isExternal: userRow[0]?.isExternal ?? false,    // ← ADD
});
```

- [ ] **Step 5: `/refresh` (normal user branch, line ~131)**

Reuse the same `userRow` lookup if convenient (one query, used by both branches):

```typescript
const token = await buildAuthToken({
  userId: refreshResult.userId,
  role: membership.role,
  departments: membership.departments,
  partnerId: refreshResult.partnerId,
  membershipId: membership.id,
  isPlatformOperator: false,
  isExternal: userRow[0]?.isExternal ?? false,    // ← ADD
});
```

- [ ] **Step 6: `/enter-partner` (line ~200)**

```typescript
const userRow = await db
  .select({ isExternal: users.isExternal })
  .from(users)
  .where(eq(users.id, req.user.id))
  .limit(1);

const token = await buildAuthToken({
  userId: req.user.id,
  role: 'admin',
  departments: [],
  partnerId,
  membershipId: `platform_${req.user.id}_${partnerId}`,
  isPlatformOperator: true,
  isExternal: userRow[0]?.isExternal ?? false,    // ← ADD
});
```

- [ ] **Step 7: Type-check passes**

Run: `docker compose exec server npx tsc --noEmit -p .`
Expected: No errors.

- [ ] **Step 8: Existing route tests still pass**

Run: `docker compose exec server npm test -- server/routes`
Expected: All routes tests green (no behavioral change yet — `isExternal` is a passive payload field).

- [ ] **Step 9: Commit**

```bash
git add server/services/authSession.ts server/routes/sso.ts server/routes/auth/devLogin.ts server/routes/auth/session.ts
git commit -m "feat(auth): mint isExternal claim at all 5 JWT sites"
```

---

### Task 8: Express middleware reads `isExternal`

**Files:**
- Modify: `server/middleware/auth.ts`
- Modify: `server/types/index.ts` (or wherever `Request.user` shape is declared)

- [ ] **Step 1: Locate `req.user` type declaration**

Run: `grep -rn "interface .* User\|type AuthRequest\|declare global" server/middleware server/types server/trpc/context.ts | head -20`

The `req.user` shape is typically extended via Express module augmentation in `server/types/index.ts` or directly in `middleware/auth.ts`. Find the augmented type and add `isExternal: boolean`.

- [ ] **Step 2: Add `isExternal: boolean` to the user shape**

```typescript
// In the relevant type declaration

interface AuthenticatedUser {
  id: string;
  role: UserRole;
  partnerId?: string;
  membershipId?: string;
  departments?: string[];
  isPlatformOperator: boolean;
  isExternal: boolean;        // ← ADD
  tokenJti?: string;
  tokenExp?: number;
  tokenIat?: number;
}
```

- [ ] **Step 3: Read `decoded.isExternal` in the middleware and set `req.user.isExternal`**

In `server/middleware/auth.ts`, locate where `req.user` is assembled (around the `jwtVerify` + `jwtPayloadSchema.parse` call):

```typescript
req.user = {
  id: decoded.userId,
  role: decoded.role,
  partnerId: decoded.partnerId,
  membershipId: decoded.membershipId,
  departments: decoded.departments,
  isPlatformOperator: isPlatformAdmin(decoded.isPlatformOperator),
  isExternal: decoded.isExternal ?? false,    // ← ADD; default false during rollout
  tokenJti: decoded.jti,
  tokenExp: decoded.exp,
  tokenIat: decoded.iat,
};
```

- [ ] **Step 4: Type-check passes**

Run: `docker compose exec server npx tsc --noEmit -p .`
Expected: No errors.

- [ ] **Step 5: Existing middleware tests pass**

Run: `docker compose exec server npm test -- server/middleware`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add server/middleware/auth.ts server/types/index.ts
git commit -m "feat(auth): read isExternal from JWT in Express middleware"
```

---

### Task 9: Socket `setupJwtMiddleware` populates `socket.data.isExternal`

**Files:**
- Modify: `server/socket/handlers/auth.ts`
- Modify: socket data type declaration (often in `server/socket/types.ts` or inline in the same file)

- [ ] **Step 1: Locate the socket.data type augmentation**

Run: `grep -rn "interface .*SocketData\|declare module.*socket.io" server/socket | head -10`

The `socket.data` shape is declared as a `SocketData` interface or via `declare module 'socket.io'`. Find it.

- [ ] **Step 2: Add `isExternal: boolean` to socket data type**

```typescript
interface SocketData {
  userId?: string;
  role?: UserRole;
  partnerId?: string;
  isPlatformOperator?: boolean;     // (might already be present, see step 3)
  isExternal?: boolean;             // ← ADD
  // ... existing fields
}
```

- [ ] **Step 3: Set `socket.data.isExternal` in `setupJwtMiddleware`**

In `server/socket/handlers/auth.ts` around line 163 (where `authedUserId`, `authedPartnerId`, `authedIsPlatformOperator` are written):

```typescript
io.use(async (socket, next) => {
  // ... existing JWT extraction + verification ...
  socket.data.authedUserId = decoded.userId;
  socket.data.authedPartnerId = decoded.partnerId;
  socket.data.authedIsPlatformOperator = decoded.isPlatformOperator;
  socket.data.isExternal = decoded.isExternal ?? false;    // ← ADD; survives identify
  socket.data.tokenExp = decoded.exp;
  socket.data.jti = decoded.jti;
  socket.data.iat = decoded.iat;
  next();
});
```

**Important:** the `socket:identify` handler (around line 244) writes `socket.data.userId/role/name/partnerId/isSupport/lang/identified`. Do NOT add an `isExternal` write there — the handshake-time value is the source of truth and identify must not overwrite it (would erase the field for any reconnect that re-runs identify against the same socket).

- [ ] **Step 4: Type-check passes**

Run: `docker compose exec server npx tsc --noEmit -p .`
Expected: No errors.

- [ ] **Step 5: Restart server (tsx watch unreliable on Windows bind mount)**

Run: `docker compose restart server`

- [ ] **Step 6: Existing socket-handler tests pass**

Run: `docker compose exec server npm test -- server/socket`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add server/socket/handlers/auth.ts server/socket/types.ts
git commit -m "feat(auth): populate socket.data.isExternal in setupJwtMiddleware from JWT"
```

---

### Task 10: Implement `actorFactory` (test seam)

**Files:**
- Create: `server/services/auth/actor.ts` (initial creation; will gain trpcActor + socketActor in subsequent tasks)
- Test: `server/services/auth/actor.test.ts` (initial)

- [ ] **Step 1: Write the failing factory test**

```typescript
// server/services/auth/actor.test.ts

import { describe, it, expect } from 'vitest';
import { actorFactory } from './actor.js';

describe('actorFactory', () => {
  it('returns a fully-populated UserActor with sensible defaults', () => {
    const a = actorFactory({ userId: 'u-1' });
    expect(a.kind).toBe('user');
    expect(a.userId).toBe('u-1');
    expect(typeof a.name).toBe('string');
    expect(a.role).toBe('agent');
    expect(typeof a.partnerId).toBe('string');
    expect(a.isPlatformOperator).toBe(false);
    expect(a.isExternal).toBe(false);
    expect(typeof a.lang).toBe('string');
  });

  it('honors overrides verbatim', () => {
    const a = actorFactory({
      userId: 'u-7',
      role: 'admin',
      isExternal: true,
      partnerId: 'p-99',
      lang: 'fr',
      name: 'Alice',
    });
    expect(a.userId).toBe('u-7');
    expect(a.role).toBe('admin');
    expect(a.isExternal).toBe(true);
    expect(a.partnerId).toBe('p-99');
    expect(a.lang).toBe('fr');
    expect(a.name).toBe('Alice');
  });

  it('always sets kind="user" regardless of overrides', () => {
    // @ts-expect-error — test seam: can't override kind
    const a = actorFactory({ userId: 'u-1', kind: 'system' });
    expect(a.kind).toBe('user');
  });
});
```

- [ ] **Step 2: Run the test, expect failure**

Run: `docker compose exec server npm test -- server/services/auth/actor.test.ts`
Expected: FAIL — `actor.ts` does not exist.

- [ ] **Step 3: Implement `actorFactory`**

```typescript
// server/services/auth/actor.ts

import type { UserActor } from './types.js';

export function actorFactory(
  overrides: Partial<Omit<UserActor, 'kind'>> & { userId: string }
): UserActor {
  return {
    kind: 'user',
    userId: overrides.userId,
    name: overrides.name ?? 'Test User',
    role: overrides.role ?? 'agent',
    partnerId: overrides.partnerId ?? 'p-test',
    isPlatformOperator: overrides.isPlatformOperator ?? false,
    isExternal: overrides.isExternal ?? false,
    lang: overrides.lang ?? 'en',
  };
}
```

- [ ] **Step 4: Run the test, expect pass**

Run: `docker compose exec server npm test -- server/services/auth/actor.test.ts`
Expected: PASS — three cases green.

- [ ] **Step 5: Commit**

```bash
git add server/services/auth/actor.ts server/services/auth/actor.test.ts
git commit -m "feat(auth): add actorFactory test seam"
```

---

### Task 11: Implement `trpcActor`

**Files:**
- Modify: `server/services/auth/actor.ts`
- Modify: `server/services/auth/actor.test.ts`

- [ ] **Step 1: Write the failing trpcActor tests**

Append to `server/services/auth/actor.test.ts`:

```typescript
import { TRPCError } from '@trpc/server';
import { trpcActor } from './actor.js';
import { CapabilityDeniedError } from './capabilities.js';
import type { Context } from '../../trpc/context.js';

const buildCtx = (overrides: Partial<NonNullable<Context['user']>> & { id: string }): Context => ({
  user: {
    id: overrides.id,
    role: overrides.role ?? 'admin',
    partnerId: overrides.partnerId ?? 'p-1',
    membershipId: overrides.membershipId,
    departments: overrides.departments,
    isPlatformOperator: overrides.isPlatformOperator ?? false,
    isExternal: overrides.isExternal ?? false,
    tokenJti: overrides.tokenJti,
    tokenExp: overrides.tokenExp,
    tokenIat: overrides.tokenIat,
  },
  // other Context fields if any (req, res, etc.) — fill with the minimum needed by your Context type
} as Context);

describe('trpcActor — happy path', () => {
  it('narrows ctx.user into a typed UserActor', () => {
    const ctx = buildCtx({ id: 'u-1', role: 'admin', partnerId: 'p-1' });
    const a = trpcActor(ctx);
    expect(a.userId).toBe('u-1');
    expect(a.role).toBe('admin');
    expect(a.partnerId).toBe('p-1');
    expect(a.isExternal).toBe(false);
  });

  it('preserves isExternal=true from context', () => {
    const ctx = buildCtx({ id: 'u-2', isExternal: true });
    const a = trpcActor(ctx);
    expect(a.isExternal).toBe(true);
  });
});

describe('trpcActor — rejection modes', () => {
  it('throws TRPCError UNAUTHORIZED when ctx.user is null', () => {
    const ctx = { user: null } as Context;
    expect(() => trpcActor(ctx)).toThrow(TRPCError);
  });

  it('throws TRPCError when partnerId is missing (partner-scoped contract)', () => {
    const ctx = buildCtx({ id: 'u-1', partnerId: undefined });
    expect(() => trpcActor(ctx)).toThrow(TRPCError);
  });

  it('throws TRPCError FORBIDDEN when capability check fails', () => {
    const ctx = buildCtx({ id: 'u-1', role: 'agent' });
    expect(() => trpcActor(ctx, { capability: 'manage_tenant' })).toThrow(TRPCError);
  });

  it('throws TRPCError FORBIDDEN when destructive_admin requested by B2B guest', () => {
    const ctx = buildCtx({ id: 'u-1', role: 'admin', isExternal: true });
    expect(() => trpcActor(ctx, { capability: 'destructive_admin' })).toThrow(TRPCError);
  });
});
```

- [ ] **Step 2: Run the test, expect failure**

Run: `docker compose exec server npm test -- server/services/auth/actor.test.ts`
Expected: FAIL — `trpcActor` not defined.

- [ ] **Step 3: Implement `trpcActor`**

Append to `server/services/auth/actor.ts`:

```typescript
import { TRPCError } from '@trpc/server';
import type { Context } from '../../trpc/context.js';
import type { Capability, UserActor } from './types.js';
import { can } from './capabilities.js';

export function trpcActor(ctx: Context, opts?: { capability?: Capability }): UserActor {
  if (!ctx.user) {
    throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Not authenticated' });
  }
  if (!ctx.user.partnerId) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: 'Partner context required',
    });
  }
  const actor: UserActor = {
    kind: 'user',
    userId: ctx.user.id,
    name: ctx.user.name ?? '',           // ctx.user may not carry name; harmless empty default
    role: ctx.user.role,
    partnerId: ctx.user.partnerId,
    isPlatformOperator: ctx.user.isPlatformOperator,
    isExternal: ctx.user.isExternal ?? false,
    lang: ctx.user.lang ?? 'en',          // ditto
  };
  if (opts?.capability && !can(actor, opts.capability)) {
    throw new TRPCError({
      code: 'FORBIDDEN',
      message: `Missing capability: ${opts.capability}`,
    });
  }
  return actor;
}
```

**Note:** `Context['user']` may not currently carry `name` and `lang`. If type errors surface, extend the `Context` type to include them (or accept the `?? ''` / `?? 'en'` fallbacks). Both fields are sourced from `users` table in the SSO/dev-login handlers — they can be carried in the JWT next iteration. For Slice 1, the fallbacks are acceptable since no production callsite consumes `actor.name`/`actor.lang` from `trpcActor` yet.

- [ ] **Step 4: Run the test, expect pass**

Run: `docker compose exec server npm test -- server/services/auth/actor.test.ts`
Expected: PASS — happy-path and 4 rejection modes green.

- [ ] **Step 5: Commit**

```bash
git add server/services/auth/actor.ts server/services/auth/actor.test.ts
git commit -m "feat(auth): add trpcActor with capability gating"
```

---

### Task 12: Implement `socketActor`

**Files:**
- Modify: `server/services/auth/actor.ts`
- Modify: `server/services/auth/actor.test.ts`

- [ ] **Step 1: Write the failing socketActor tests**

Append to `server/services/auth/actor.test.ts`:

```typescript
import type { Socket } from 'socket.io';
import { socketActor } from './actor.js';

const buildSocket = (data: Record<string, unknown>): Socket => {
  const emitted: Array<{ event: string; payload: unknown }> = [];
  return {
    data,
    emit: (event: string, payload: unknown) => {
      emitted.push({ event, payload });
      return true;
    },
    // attach for assertions
    __emitted: emitted,
  } as unknown as Socket;
};

describe('socketActor — happy path', () => {
  it('returns a UserActor when socket.data is fully populated and identified', () => {
    const s = buildSocket({
      identified: true,
      userId: 'u-1',
      role: 'support',
      name: 'Bob',
      partnerId: 'p-1',
      isExternal: false,
      isPlatformOperator: false,
      lang: 'en',
    });
    const a = socketActor(s);
    expect(a).not.toBeNull();
    expect(a?.userId).toBe('u-1');
    expect(a?.role).toBe('support');
    expect(a?.partnerId).toBe('p-1');
    expect(a?.isExternal).toBe(false);
  });

  it('preserves isExternal=true from socket.data', () => {
    const s = buildSocket({
      identified: true,
      userId: 'u-1',
      role: 'admin',
      name: 'Carol',
      partnerId: 'p-1',
      isExternal: true,
      isPlatformOperator: false,
      lang: 'en',
    });
    const a = socketActor(s);
    expect(a?.isExternal).toBe(true);
  });
});

describe('socketActor — rejection modes', () => {
  it('returns null and emits error when not identified', () => {
    const s = buildSocket({ identified: false });
    const a = socketActor(s);
    expect(a).toBeNull();
    expect((s as any).__emitted[0].event).toBe('error');
  });

  it('returns null and emits error when partnerId is missing', () => {
    const s = buildSocket({
      identified: true,
      userId: 'u-1',
      role: 'support',
      name: 'Bob',
      partnerId: undefined,
      isExternal: false,
      isPlatformOperator: false,
      lang: 'en',
    });
    const a = socketActor(s);
    expect(a).toBeNull();
    expect((s as any).__emitted[0].event).toBe('error');
  });

  it('returns null and emits error when capability check fails', () => {
    const s = buildSocket({
      identified: true,
      userId: 'u-1',
      role: 'agent',
      name: 'Alice',
      partnerId: 'p-1',
      isExternal: false,
      isPlatformOperator: false,
      lang: 'en',
    });
    const a = socketActor(s, { capability: 'manage_tenant' });
    expect(a).toBeNull();
    expect((s as any).__emitted[0].event).toBe('error');
  });

  it('returns null when destructive_admin requested by B2B guest', () => {
    const s = buildSocket({
      identified: true,
      userId: 'u-1',
      role: 'admin',
      name: 'Bob',
      partnerId: 'p-1',
      isExternal: true,
      isPlatformOperator: false,
      lang: 'en',
    });
    const a = socketActor(s, { capability: 'destructive_admin' });
    expect(a).toBeNull();
  });

  it('treats missing isExternal field as false (legacy token rollout)', () => {
    const s = buildSocket({
      identified: true,
      userId: 'u-1',
      role: 'admin',
      name: 'Bob',
      partnerId: 'p-1',
      // no isExternal
      isPlatformOperator: false,
      lang: 'en',
    });
    const a = socketActor(s);
    expect(a?.isExternal).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test, expect failure**

Run: `docker compose exec server npm test -- server/services/auth/actor.test.ts`
Expected: FAIL — `socketActor` not defined.

- [ ] **Step 3: Implement `socketActor`**

Append to `server/services/auth/actor.ts`:

```typescript
import type { Socket } from 'socket.io';

export function socketActor(socket: Socket, opts?: { capability?: Capability }): UserActor | null {
  const data = socket.data as Record<string, unknown>;
  if (!data.identified) {
    socket.emit('error', { message: 'Not identified' });
    return null;
  }
  const userId = data.userId as string | undefined;
  const role = data.role as UserActor['role'] | undefined;
  const partnerId = data.partnerId as string | undefined;
  const name = (data.name as string) ?? '';
  const lang = (data.lang as string) ?? 'en';
  const isPlatformOperator = Boolean(data.isPlatformOperator);
  const isExternal = Boolean(data.isExternal);

  if (!userId || !role || !partnerId) {
    socket.emit('error', { message: 'Partner scope required' });
    return null;
  }

  const actor: UserActor = {
    kind: 'user',
    userId,
    name,
    role,
    partnerId,
    isPlatformOperator,
    isExternal,
    lang,
  };

  if (opts?.capability && !can(actor, opts.capability)) {
    socket.emit('error', { message: `Missing capability: ${opts.capability}` });
    return null;
  }

  return actor;
}
```

**Note:** `socket.data.isPlatformOperator` is currently NOT set by the identify handler (handlers/auth.ts line 244 sets userId/role/name/partnerId/isSupport/lang/identified). The `setupJwtMiddleware` writes `socket.data.authedIsPlatformOperator` (different key) at handshake. To satisfy `socketActor`'s read, either:
- (a) Add `socket.data.isPlatformOperator = effectiveRole === 'platform_operator' ? true : false` to the identify handler — minimal write.
- (b) Have `socketActor` read `data.authedIsPlatformOperator` instead.

Recommendation: **(a)**. Add one line to identify handler to surface the field consistently with the other identify writes. This is NOT a "production handler callsite change" — it's a single field write in setup, parallel to existing writes.

- [ ] **Step 4: Add `isPlatformOperator` write to identify handler**

In `server/socket/handlers/auth.ts` around line 244–250, add:

```typescript
socket.data.userId = userId;
socket.data.role = effectiveRole;
socket.data.name = name;
socket.data.partnerId = partnerId;
socket.data.isSupport = isSupport;       // (existing — leave for old socketActor)
socket.data.lang = userRow.lang;
socket.data.isPlatformOperator =          // ← ADD
  effectiveRole === 'platform_operator' || socket.data.authedIsPlatformOperator === true;
socket.data.identified = true;
```

- [ ] **Step 5: Run the test, expect pass**

Run: `docker compose exec server npm test -- server/services/auth/actor.test.ts`
Expected: PASS — happy-path + 5 rejection modes green.

- [ ] **Step 6: Commit**

```bash
git add server/services/auth/actor.ts server/services/auth/actor.test.ts server/socket/handlers/auth.ts
git commit -m "feat(auth): add socketActor with capability gating"
```

---

### Task 13: Barrel export

**Files:**
- Create: `server/services/auth/index.ts`

- [ ] **Step 1: Write the barrel**

```typescript
// server/services/auth/index.ts

export type {
  UserRole,
  Capability,
  UserActor,
  SystemActor,
  Actor,
} from './types.js';

export { SYSTEM_ACTOR, isUserActor } from './types.js';

export { RULES, can, assertCan, CapabilityDeniedError } from './capabilities.js';

export { actorFactory, trpcActor, socketActor } from './actor.js';
```

- [ ] **Step 2: Type-check passes**

Run: `docker compose exec server npx tsc --noEmit -p .`
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add server/services/auth/index.ts
git commit -m "feat(auth): add barrel export for services/auth"
```

---

### Task 14: Migrate `ticketLifecycle/types.ts` to re-export

**Files:**
- Modify: `server/services/ticketLifecycle/types.ts`

- [ ] **Step 1: Read the current file**

Run: `Read server/services/ticketLifecycle/types.ts`. Note any imports/exports beyond Actor (there may be lifecycle-specific types in the same file — leave those alone).

- [ ] **Step 2: Replace the local Actor / UserActor / SystemActor definitions with re-exports**

The file currently defines `Actor`, `UserActor`, `SystemActor`. Replace those definitions (and only those) with:

```typescript
// Top of server/services/ticketLifecycle/types.ts (or wherever the type definitions live)

export type { Actor, UserActor, SystemActor } from '../auth/types.js';
export { isUserActor } from '../auth/types.js';
```

Leave any other lifecycle-only types in this file unchanged.

- [ ] **Step 3: Type-check fails (lights up callsites that use `actor.id` and `actor.isSupport`)**

Run: `docker compose exec server npx tsc --noEmit -p .`
Expected: errors in lifecycle services and tests — `Property 'id' does not exist on type 'UserActor'` and `Property 'isSupport' does not exist`. Tasks 15 and 16 close these.

- [ ] **Step 4: Do NOT commit yet** — Tasks 15 and 16 finish the migration; commit at the end of Task 16.

---

### Task 15: Update `ticketLifecycle/actor.ts` to construct new-shape UserActor

**Files:**
- Modify: `server/services/ticketLifecycle/actor.ts`

- [ ] **Step 1: Read the current file**

Run: `Read server/services/ticketLifecycle/actor.ts`. Note the existing `socketActor` function body — it constructs the old-shape UserActor with `id`/`isSupport`.

- [ ] **Step 2: Rewrite imports to source types from auth, and update body to new shape**

```typescript
// server/services/ticketLifecycle/actor.ts

import type { Socket } from 'socket.io';
import type { Actor, SystemActor, UserActor } from '../auth/types.js';
import { isUserActor } from '../auth/types.js';

export const systemActor: SystemActor = {
  kind: 'system',
  id: '__system__',
  name: 'System',
};

// Re-export the type guard from auth so existing imports keep resolving.
export { isUserActor };

/**
 * Lifecycle-specific socketActor — preserved with old NON-NULL signature
 * so existing socket-handler callsites keep compiling. New code should
 * import socketActor from '../auth' instead, which returns UserActor | null.
 *
 * This file is deleted in Slice 7 (issue #72) once handlers migrate.
 */
export function socketActor(socket: Socket): UserActor {
  const data = socket.data as Record<string, unknown>;
  return {
    kind: 'user',
    userId: data.userId as string,
    name: (data.name as string) ?? '',
    role: data.role as UserActor['role'],
    partnerId: data.partnerId as string,
    isPlatformOperator: Boolean(data.isPlatformOperator),
    isExternal: Boolean(data.isExternal),
    lang: (data.lang as string) ?? 'en',
  };
}
```

> **Strict Mode (alternative):** if you elected the strict reading of issue #66 — full re-export — replace the entire file with:
> ```typescript
> export { socketActor, actorFactory, isUserActor, SYSTEM_ACTOR as systemActor } from '../auth';
> ```
> and accept that every socket handler in `server/socket/handlers/*.ts` needs a null check around `socketActor(socket)`. That is a callsite change and contradicts issue #66's "no production socket handler callsite changed" — only choose strict if you intend to bundle slice #68's handler migration into this PR.

- [ ] **Step 3: Type-check still fails — lifecycle internal callsites**

Run: `docker compose exec server npx tsc --noEmit -p .`
Expected: errors remain in lifecycle service files (uses of `actor.id` / `actor.isSupport`). Task 16 fixes these.

- [ ] **Step 4: Do NOT commit yet** — bundled commit in Task 16.

---

### Task 16: Migrate lifecycle internal callsites + tests

**Files:**
- Modify (mechanical): every `server/services/ticketLifecycle/*.ts` and `server/services/ticketLifecycle/*.test.ts` that references `actor.id` or `actor.isSupport`

- [ ] **Step 1: Inventory the callsites**

Run:
```bash
docker compose exec server grep -rn "actor\.id\|actor\.isSupport" server/services/ticketLifecycle
```
Note the file:line list. Expected: ~10–25 hits across `assign.ts`, `close.ts`, `create.ts`, `leave.ts`, `reclaim.ts`, `returnToQueue.ts`, `transfer.ts` and their tests.

- [ ] **Step 2: For each `actor.id` reference, change to `actor.userId`**

Use `Edit` per-file. The replacement is mechanical: `actor.id` → `actor.userId`. Be careful not to touch `systemActor.id` (the SystemActor literal `'__system__'`) — only `UserActor` instances need renaming. The discriminator narrows the type, so `actor.id` after `isUserActor(actor)` is the UserActor case (rename); `actor.id` on the SystemActor branch is fine.

Pragmatic approach: search for the specific patterns:
- `actor.id` after `isUserActor(actor)` narrowing → rename to `actor.userId`
- destructured `const { id, ... } = actor` → rename binding
- `userActor.id` (variables typed as `UserActor`) → rename

- [ ] **Step 3: For each `actor.isSupport` reference, replace with `isSupportLike(actor.role)`**

Add to the file's imports: `import { isSupportLike } from '../roles.js';` (path may differ per directory depth).
Replace `actor.isSupport` with `isSupportLike(actor.role)`.

- [ ] **Step 4: Update test mocks — drop `isSupport`, rename `id`→`userId`, add `isPlatformOperator`**

For every test factory that constructs a UserActor mock object, the shape change is:

```typescript
// Before
const mockActor: UserActor = {
  kind: 'user',
  id: 'u-1',
  name: 'Test',
  role: 'support',
  isSupport: true,
  isExternal: false,
  lang: 'en',
  partnerId: 'p-1',
};

// After
const mockActor: UserActor = {
  kind: 'user',
  userId: 'u-1',                       // RENAMED
  name: 'Test',
  role: 'support',
  partnerId: 'p-1',
  isPlatformOperator: false,           // ADDED
  isExternal: false,
  lang: 'en',
  // isSupport DROPPED
};
```

- [ ] **Step 5: Type-check passes**

Run: `docker compose exec server npx tsc --noEmit -p .`
Expected: No errors.

- [ ] **Step 6: Lifecycle tests pass**

Run: `docker compose exec server npm test -- server/services/ticketLifecycle`
Expected: PASS — all existing lifecycle tests green with the new actor shape.

- [ ] **Step 7: Commit (bundled with Tasks 14 + 15)**

```bash
git add server/services/ticketLifecycle/ server/services/auth/
git commit -m "refactor(auth): migrate ticketLifecycle Actor to canonical auth/types"
```

---

### Task 17: Session boundary test (login → refresh → actor flows)

**Files:**
- Create: `server/services/auth/session.boundary.test.ts`

- [ ] **Step 1: Write the boundary test**

```typescript
// server/services/auth/session.boundary.test.ts

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { jwtVerify } from 'jose';
import { createTestDb, type TestDbHandle } from '../../test/pglite-setup.js';
import { users, partners, memberships } from '../../db/schema.js';
import { buildAuthToken } from '../authSession.js';
import { createRefreshToken, rotateRefreshToken } from '../refreshToken.js';
import { actorFactory } from './actor.js';
import { config } from '../../config.js';

const secret = new TextEncoder().encode(config.jwtSecret);

describe('session boundary — login → refresh → actor', () => {
  let handle: TestDbHandle;

  beforeEach(async () => {
    handle = await createTestDb();
    // Seed: one partner, one user (non-external), one membership.
    await handle.db.insert(partners).values({
      id: 'p-1',
      name: 'Acme',
      status: 'active',
    });
    await handle.db.insert(users).values({
      id: 'u-1',
      email: 'alice@acme.com',
      name: 'Alice',
      lang: 'en',
      isPlatformOperator: false,
      isExternal: false,
    });
    await handle.db.insert(memberships).values({
      id: 'm-1',
      userId: 'u-1',
      partnerId: 'p-1',
      role: 'admin',
      departments: [],
    });
  });

  afterEach(async () => {
    await handle.close();
  });

  it('mints a token whose payload exposes isExternal=false for a non-guest user', async () => {
    const token = await buildAuthToken({
      userId: 'u-1',
      role: 'admin',
      partnerId: 'p-1',
      membershipId: 'm-1',
      departments: [],
      isPlatformOperator: false,
      isExternal: false,
    });
    const { payload } = await jwtVerify(token, secret);
    expect(payload.isExternal).toBe(false);
    expect(payload.userId).toBe('u-1');
  });

  it('mints a token with isExternal=true for a B2B guest', async () => {
    const token = await buildAuthToken({
      userId: 'u-1',
      role: 'admin',
      partnerId: 'p-1',
      membershipId: 'm-1',
      departments: [],
      isPlatformOperator: false,
      isExternal: true,
    });
    const { payload } = await jwtVerify(token, secret);
    expect(payload.isExternal).toBe(true);
  });

  it('refresh-token rotation issues a fresh token and invalidates the old one', async () => {
    const created = await createRefreshToken('u-1', 'p-1');
    const rotated = await rotateRefreshToken(created.token);
    expect(rotated).not.toBeNull();
    expect(rotated?.userId).toBe('u-1');
    expect(rotated?.token).not.toBe(created.token);

    const replay = await rotateRefreshToken(created.token);
    expect(replay).toBeNull();
  });

  it('actorFactory + can(...) enforces destructive_admin against a guest synthetic actor', async () => {
    const { can } = await import('./capabilities.js');
    const guest = actorFactory({ userId: 'u-1', role: 'admin', isExternal: true });
    expect(can(guest, 'destructive_admin')).toBe(false);

    const internal = actorFactory({ userId: 'u-1', role: 'admin', isExternal: false });
    expect(can(internal, 'destructive_admin')).toBe(true);
  });

  // NB: revocation cascade on isExternal flip is NOT tested here — that lands in slice #67
  // (issue #67). This test ONLY asserts the token + actor shape carry isExternal correctly.
});
```

- [ ] **Step 2: Run the test, expect pass**

Run: `docker compose exec server npm test -- server/services/auth/session.boundary.test.ts`
Expected: PASS — four cases green. PGLite setup applies migrations and seeds work.

If this fails because the test environment cannot resolve `config.jwtSecret` or migrations fail against PGLite, address those infrastructure issues before continuing — boundary suite must run cleanly against the in-memory DB.

- [ ] **Step 3: Commit**

```bash
git add server/services/auth/session.boundary.test.ts
git commit -m "test(auth): add session boundary suite (login + refresh + actor)"
```

---

### Task 18: CHANGELOG entry

**Files:**
- Modify: `CHANGELOG.md`

- [ ] **Step 1: Add the Unreleased entry**

In `CHANGELOG.md`, under the Unreleased section (create one if absent), add:

```markdown
## Unreleased

### Added
- New `services/auth/` module exposes a canonical `Actor`, a 7-capability authorization vocabulary (`tenant_admin`, `platform_admin`, `support_like`, `use_support_workflows`, `manage_tenant`, `export_tickets`, `destructive_admin`), and `socketActor` / `trpcActor` / `actorFactory` builders. (Bundle A slice 1, issue #66)
- JWT payload now carries an `isExternal` claim; tokens missing the claim deserialize to `false` for the rollout window. All 5 mint sites (SSO, dev-login, refresh, switch-partner, enter-partner) populate the claim.

### Changed
- `services/ticketLifecycle/types.ts` and `services/ticketLifecycle/actor.ts` migrate to the canonical `Actor` shape: `id` renamed to `userId`, `isSupport` cached field removed (callers use `isSupportLike(actor.role)`), `isPlatformOperator` added.
```

- [ ] **Step 2: Commit**

```bash
git add CHANGELOG.md
git commit -m "docs: changelog entry for services/auth foundation"
```

---

### Task 19: Run local CI

**Files:**
- None (verification only)

- [ ] **Step 1: Run scripts/ci.ps1**

Run: `powershell -File scripts/ci.ps1`

Expected: ALL GREEN
- typecheck: ✓
- test-server: ✓ (new auth tests pass; existing lifecycle tests pass)
- test-client: ✓ (no client changes)
- migrate: ✓ (no schema changes)
- e2e: ✓

- [ ] **Step 2: If any step fails, fix and re-run before considering the slice complete**

Common failure modes to anticipate:
- A test factory in lifecycle still constructs the old-shape UserActor (missed in Task 16). Search: `grep -rn "isSupport:\|id: 'u-" server/services/ticketLifecycle/*.test.ts`.
- A server route test mints a token without `isExternal` and now fails Zod parsing. Solution: route tests should mint via the real `buildAuthToken` (which now requires the param), not by hand-crafting payload objects.
- E2E playwright test fails because login flow requires real backend; check the dev seed user has `isExternal: false` set.

- [ ] **Step 3: Open the PR**

```bash
git push -u origin feat/bundle-a-slice-1-auth-foundation
gh pr create --title "feat(auth): Bundle A slice 1 — services/auth foundation + JWT isExternal" --body "$(cat <<'EOF'
## Summary
- Adds `server/services/auth/` deep module: types, capabilities, actor builders, barrel
- Adds `isExternal` claim to JWT payload (5 mint sites + Express middleware + socket setup middleware); legacy tokens default to `false`
- Migrates `services/ticketLifecycle/{types,actor}.ts` to canonical Actor (id→userId, drop isSupport, add isPlatformOperator)
- Adds 4 boundary test files: capabilities truth-table, actor builders, JWT shape, session lifecycle

## What it does NOT do (intentionally)
- Does not migrate any production socket handler — slices #68/#69/#70
- Does not migrate any tRPC router or delete `blockExternalUsers` middleware — slice #71
- Does not implement isExternal-flip session revocation cascade — slice #67
- Does not delete legacy session/refreshToken/sessionRevocation files — slice #72

## Test plan
- [x] `scripts/ci.ps1` green (typecheck + server + client + migrate + e2e)
- [x] New tests: capabilities truth table (every cell), actor builders (happy + every rejection), JWT shape (carries / missing-defaults-false), session boundary (login mint + refresh rotate)
- [x] Existing ticketLifecycle tests green after Actor shape migration
- [x] Manual smoke: dev-login + ticket flow works end-to-end

Closes #66
EOF
)"
```

---

## Self-Review Checklist (run before declaring plan complete)

**1. Spec coverage** — every issue #66 acceptance row has a task:

| Acceptance criterion | Task |
|---|---|
| `services/auth/` directory with types/capabilities/actor/index | 1, 2, 4, 10–13 |
| Capability set of 7 defined | 1 (types), 4 (rules) |
| Each rule composes existing roles helpers | 4 |
| `roles.ts` actor-adapted variants | 3 |
| `buildAuthToken` accepts `isExternal` | 6 |
| All 5 mint sites pass it | 7 |
| Express middleware reads it onto `req.user` | 8 |
| Socket `setupJwtMiddleware` populates `socket.data.isExternal` | 9 |
| `socket:identify` preserves the value (no DB lookup) | 9 (note: identify does NOT write isExternal, so handshake value persists) |
| `ticketLifecycle/types.ts` re-export | 14 |
| `ticketLifecycle/actor.ts` updated (preserves caller signature for slice-1 scope; full re-export deferred to #72) | 15 |
| `capabilities.test.ts` truth table | 4 |
| `actor.test.ts` happy + rejection modes | 10, 11, 12 |
| `jwt.test.ts` carries / missing-defaults-false | 5 |
| `session.boundary.test.ts` login + refresh + actor | 17 |
| No production socket handler / tRPC router callsite changed | (verified by inspection — only `socket/handlers/auth.ts` middleware/identify is touched, which is setup not a per-event handler; no `trpc/routers/**` files modified) |
| CHANGELOG entry | 18 |
| `scripts/ci.ps1` passes | 19 |

**2. Placeholder scan** — no "TBD", no "implement later", no "similar to Task N", no "add appropriate validation" — all code shown inline.

**3. Type consistency** — `UserActor` always has fields `kind, userId, name, role, partnerId, isPlatformOperator, isExternal, lang`. No task references `actor.id` after the rename. `Capability` set of 7 used identically in Task 4 (RULES keys), Task 10 truth table, Task 11/12 rejection tests.

**4. Open scope items surfaced (not silenced):**
- Strict Mode lifecycle/actor.ts re-export (Task 15 callout) — defaults to hybrid; user can elect strict.
- `Context['user']` may not currently carry `name`/`lang` (Task 11 note) — fallbacks acceptable for slice 1; tighten in slice #71 when tRPC handlers consume `actor.name`.
- `socket.data.isPlatformOperator` write added to identify handler (Task 12 step 4) — minimal, parallel to existing identify writes.

---

## End

Slice 1 ships: new `services/auth/` module is the source of truth for identity types, capabilities, and actor builders. Every JWT carries `isExternal`. Lifecycle's parallel Actor type is gone. Production callsites (handlers + routers) are untouched and will migrate in slices #67–#72.
