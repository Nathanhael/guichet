# Platform Router Split — Design Spec

**Date**: 2026-04-09
**Goal**: Split the 1273-line `server/trpc/routers/platform.ts` into domain-focused sub-files to improve AI agent navigability and reduce context window pressure when editing individual procedures.

## Motivation

`platform.ts` is the largest file in the project. It contains 29 procedures spanning 5 unrelated domains (partner CRUD, user management, audit, SSO mappings, system config). AI agents must load the entire file to edit any single procedure, wasting context and increasing error risk.

## Approach

Sub-routers merged into one namespace via procedure spreading. Client calls remain `trpc.platform.*` — zero client-side changes.

## File Structure

```
server/trpc/routers/platform/
├── index.ts        (~30 lines)  — barrel merging 5 sub-routers into platformRouter
├── partners.ts     (~253 lines) — partner CRUD + lifecycle
├── users.ts        (~479 lines) — user management, invites, memberships, lockout
├── audit.ts        (~227 lines) — audit log, archive, chain verification
├── sso.ts          (~132 lines) — SSO group mappings CRUD
└── system.ts       (~134 lines) — health check, mail config, test email
```

The old `server/trpc/routers/platform.ts` is deleted after the split.

## Procedure Assignments

### partners.ts

| Procedure | ~Lines |
|-----------|--------|
| `listPartners` | 12 |
| `createPartner` | 48 |
| `updatePartner` | 111 |
| `deactivatePartner` | 32 |
| `reactivatePartner` | 20 |
| `deletePartner` | 30 |

**Imports**: `partners`, `memberships`, `tickets`, `systemSettings` schemas, `broadcastPartnerDeactivation`, `validateWebhookUrl`, `getRedisClients`, `logger`

### users.ts

| Procedure | ~Lines |
|-----------|--------|
| `listGlobalUsers` | 76 |
| `updateUser` | 39 |
| `inviteUser` | 115 |
| `resendInvite` | 62 |
| `removeMembership` | 37 |
| `updateMembership` | 61 |
| `disableUserMfa` | 34 |
| `unlockUser` | 31 |
| `deleteUser` | 24 |

**Imports**: `users`, `memberships`, `partners` schemas, `MailService`, `renderInviteNew`, `renderInviteExisting`, `renderInviteReminder`, `hashPassword`, `encrypt`, `config`, `revokeUserSessions`, `randomBytes`, `logger`

### audit.ts

| Procedure | ~Lines |
|-----------|--------|
| `getAuditLog` | 68 |
| `exportAuditLog` | 46 |
| `getArchivedAuditLog` | 40 |
| `verifyAuditChain` | 5 |
| `runArchive` | 15 |
| `getArchivedTickets` | 53 |

**Imports**: `auditLog`, `auditArchive`, `archivedTickets` schemas, `logger`

### sso.ts

| Procedure | ~Lines |
|-----------|--------|
| `listGroupMappings` | 24 |
| `addGroupMapping` | 49 |
| `updateGroupMapping` | 39 |
| `removeGroupMapping` | 20 |

**Imports**: `partnerGroupMappings`, `partners` schemas, `logger`

### system.ts

| Procedure | ~Lines |
|-----------|--------|
| `getSystemHealth` | 63 |
| `getMailConfig` | 13 |
| `updateMailConfig` | 46 |
| `sendTestEmail` | 12 |

**Imports**: `systemSettings` schema, `MailService`, `renderTestEmail`, `getRedisClients`, `config`, `logger`

## Merge Pattern (index.ts)

```typescript
import { router } from '../../trpc.js';
import { platformPartnersRouter } from './partners.js';
import { platformUsersRouter } from './users.js';
import { platformAuditRouter } from './audit.js';
import { platformSsoRouter } from './sso.js';
import { platformSystemRouter } from './system.js';

export const platformRouter = router({
  ...platformPartnersRouter._def.procedures,
  ...platformUsersRouter._def.procedures,
  ...platformAuditRouter._def.procedures,
  ...platformSsoRouter._def.procedures,
  ...platformSystemRouter._def.procedures,
});
```

All procedures are spread into a single flat router. The exported `platformRouter` has the same shape as before.

## What Changes

| File | Change |
|------|--------|
| `server/trpc/routers/platform.ts` | Deleted — replaced by `platform/` directory |
| `server/trpc/routers/platform/index.ts` | New — barrel merging sub-routers |
| `server/trpc/routers/platform/partners.ts` | New — 6 procedures |
| `server/trpc/routers/platform/users.ts` | New — 9 procedures |
| `server/trpc/routers/platform/audit.ts` | New — 6 procedures |
| `server/trpc/routers/platform/sso.ts` | New — 4 procedures |
| `server/trpc/routers/platform/system.ts` | New — 4 procedures |
| `server/trpc/routers/platform.lifecycle.audit.test.ts` | Import path: `./platform.js` → `./platform/index.js` |
| `server/trpc/routers/platform.audit.test.ts` | Import path: `./platform.js` → `./platform/index.js` |

## What Doesn't Change

- `server/trpc/router.ts` — still imports `platformRouter` from `./routers/platform.js` (Node resolves `platform/index.js`)
- All client-side `trpc.platform.*` calls — zero changes
- `AppRouter` type — identical shape
- Socket handler import of `broadcastPartnerDeactivation` — stays in `partners.ts`, but the import in `handlers.ts` already comes from the socket layer, not the router

## Verification

1. TypeScript compiles (`tsc --noEmit`)
2. Existing platform router tests pass unchanged (only import path updated)
3. Client-side tRPC calls work without modification
4. `trpc.platform.*` procedure names are identical before and after
