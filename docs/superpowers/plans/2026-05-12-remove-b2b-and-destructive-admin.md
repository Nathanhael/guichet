# Remove Azure B2B-guest support + `destructive_admin` capability machinery

Date: 2026-05-12
Status: Draft — pending user confirmation on Decisions A/B/C below.

## Goal

Rip out two intertwined subsystems:

1. **Azure B2B guest support** — partner employees invited as guests into our Azure
   tenant, stamped `users.isExternal = true`, restricted to a single partner, and
   shown with a `GUEST` badge across the UI.
2. **`destructive_admin` / `audit_read` / `ai_config_read` capability gates** —
   the entire reason these caps exist is to read `actor.isExternal` and block
   guests from destructive admin actions and internal-only admin reads. With
   B2B gone, the caps collapse to `tenant_admin || platform_admin`, which is
   already what the procedure factories (`partnerAdminProcedure`,
   `platformProcedure`) enforce.

Net effect: simpler auth, one fewer JWT claim, one fewer DB column to write,
~10 deleted files, and every `trpcActor(ctx, { capability: ... })` call site
either drops the option (kept for partnerId narrowing) or drops the call.

## Decisions (LOCKED 2026-05-12)

| # | Question | Choice |
|---|----------|--------|
| A | Drop `users.is_external` DB column now (new migration `0018_drop_is_external.sql`) or defer until pre-prod squash? | **DROP NOW.** New migration `server/drizzle/0018_drop_is_external.sql` + matching schema diff + snapshot. |
| B | Keep `services/auth/capabilities.ts` skeleton? | **DELETE ENTIRELY.** The 3 wired caps are all B2B-gates; the other 6 are uncalled skeleton. Remove `Capability` type from `types.ts`, remove `capability` option from `trpcActor` / `socketActor`, remove `can()` / `assertCan()` / `CapabilityDeniedError`. If future work needs caps, re-introduce them then. |
| C | Delete the `guest_badge_*`, `guest_admin_disabled_*`, `sso_guest_multi_partner_message` i18n keys? | **DELETE.** Zero callers after UI gut. |

## Surface map

### Server — auth core (delete or trim)

| File | Change |
|------|--------|
| `server/services/auth/capabilities.ts` | **DELETE FILE** (Decision B2). |
| `server/services/auth/capabilities.test.ts` | **DELETE FILE.** |
| `server/services/auth/types.ts` | Drop `Capability` type entirely. Drop `isExternal: boolean` from `UserActor`. Keep `UserRole`, `Actor`, `SystemActor`, `SYSTEM_ACTOR`, `isUserActor`. |
| `server/services/auth/actor.ts` | Drop the `opts?: { capability?: Capability }` parameter from `trpcActor` and `socketActor`. Drop the `can()` import. Drop `isExternal` from `actorFactory`, `trpcActor`, `socketActor`. Rewrite JSDoc — no more B2B-guest example. |
| `server/services/auth/isExternalFlip.ts` | **DELETE.** |
| `server/services/auth/isExternalFlip.test.ts` | **DELETE.** |
| `server/services/auth/isExternalFlip.integration.test.ts` | **DELETE.** |
| `server/services/auth/index.ts` | Drop `flipIsExternal` re-export. |
| `server/services/auth/authSession.ts` | Drop `isExternal` from `BuildAuthTokenInput` and `BuildAuthResponseInput` user payload. |
| `server/services/auth/jwt.ts` | Drop `isExternal: z.boolean().optional()` from JWT zod schema and from the typed payload. |
| `server/services/auth/jwt.test.ts` | Drop the `JWT payload schema — isExternal claim` describe block. |
| `server/services/auth/session.boundary.test.ts` | Trim `isExternal` references. |
| `server/services/auth/authSession.test.ts` | Trim `isExternal` from fixtures + assertions. |
| `server/services/auth/actor.test.ts` | Drop the `destructive_admin` capability assertion blocks (the `capability` option no longer exists); trim `isExternal` from factory cases. |

### Server — SSO + routes + middleware

| File | Change |
|------|--------|
| `server/routes/sso.ts` | Drop the `claims.acct === 1 \|\| !!claims.idp` parse (L309), drop `flipIsExternal()` calls (L351, L387), drop new-user `isExternal` insert (L368), drop the guest single-partner reject branch (L455–L471), drop `isExternal` from `buildAuthToken` + `buildAuthResponse` (L585, L596). |
| `server/routes/auth/devLogin.ts` | Drop `isExternal` from any minted payload. |
| `server/routes/auth/session.ts` | Drop `isExternal` from session response. |
| `server/middleware/auth.ts` | Drop `isExternal` propagation onto `req.user`. |
| `server/trpc/context.ts` | Drop `isExternal` from the `ctx.user` shape. |
| `server/scripts/break_glass.ts` | Drop `isExternal: false` from minted JWT. |
| `server/scripts/add_lang_tickets.ts` | Drop `isExternal` from any selected user fields (if present). |

### Server — socket

| File | Change |
|------|--------|
| `server/socket/handlers/auth.ts` | Drop `socket.data.isExternal = !!decoded.isExternal` (L167) and the typed `isExternal?: boolean` from the decoded payload. |
| `server/socket/handlers/types.ts` | Drop `isExternal` from `requireIdentified` / `requirePartnerScope` guard return shape. |
| `server/socket/partnerScope.test.ts` | Trim `isExternal` fixtures. |
| All `server/socket/handlers/*.test.ts` and `server/services/{message,ticket}Lifecycle/*.test.ts` | Drop `isExternal` from `actorFactory()` / fixture inputs. Mechanical sweep. |

### Server — tRPC routers (drop the `capability` option, keep the actor call)

Each call site of `trpcActor(ctx, { capability: 'destructive_admin' })` becomes
either `trpcActor(ctx)` (if `actor` is consumed downstream) or `void trpcActor(ctx)` (kept only for the partnerId-narrowing throw). The `capability` option no longer exists on the function signature after Decision B2.

Note: `partnerAdminProcedure` already enforces admin role, so the capability check was redundant for ALL of these even before B2B removal.

| File | Calls |
|------|-------|
| `server/trpc/routers/cannedResponse.ts` | 5× `destructive_admin` |
| `server/trpc/routers/label.ts` | 3× `destructive_admin` |
| `server/trpc/routers/webhook.ts` | 5× `destructive_admin` |
| `server/trpc/routers/partner/members.ts` | 2× `destructive_admin` (in `updateMemberDepartments` + delete-membership mutation) |
| `server/trpc/routers/partner/config.ts` | 4× `destructive_admin` + 1× `ai_config_read` |
| `server/trpc/routers/partner/audit.ts` | 3× `audit_read` |
| `server/trpc/trpc.ts` | Drop the `destructive_admin` comment block that documents the migration history. |

### Server — DB + types

| File | Change |
|------|--------|
| `server/db/schema.ts` | **Drop** `isExternal: boolean('is_external').notNull().default(false)` from `users` table type (Decision A). Drop `isExternal?: boolean` from the `participants` JSONB `$type<>`. |
| `server/drizzle/0018_drop_is_external.sql` | **NEW.** `ALTER TABLE "users" DROP COLUMN "is_external";` |
| `server/drizzle/meta/0018_snapshot.json` + `_journal.json` | Generate via `docker compose exec server npx drizzle-kit generate` after schema.ts edit. |
| `server/services/userQueries.ts` | Drop `isExternal: users.isExternal` from any select; drop from return types and tests. |
| `server/services/userQueries.test.ts` | Trim cases. |
| `server/types/index.ts` | Drop `isExternal` from `AuthUser` and related types. |

### Server — tests dedicated to B2B (DELETE)

| File | Reason |
|------|--------|
| `server/__tests__/destructiveAdminProcedure.test.ts` | Pinned the `trpcActor(ctx, { capability: 'destructive_admin' })` convention — convention is gone. |
| `server/__tests__/ssoGuestB2b.test.ts` | B2B claim parse + multi-partner reject path is gone. |
| `server/trpc/routers/webhook.guestGating.test.ts` | Gating is gone. |
| `server/trpc/routers/partner.audit.guestGating.test.ts` | Gating is gone. |
| `server/trpc/routers/partner.listAdmins.test.ts` | Trim audit_read-derived assertions; keep the underlying admin-only test. |
| `server/services/messageLifecycle/{send,edit,delete,react}.test.ts` | Trim `isExternal` from `actorFactory()` fixtures. |
| `server/services/ticketLifecycle/{create,assign,transfer,close,leave,returnToQueue,reclaim,messages}.test.ts` | Same. |
| `server/services/roles.test.ts` | Trim. |
| `server/trpc/routers/{cannedResponse,support,presence,partner.audit,partner.updateMemberDepartments}.test.ts` | Trim. |
| `server/__integration__/tenantIsolation.test.ts` | Trim. |

### Client (DELETE)

| File | Action |
|------|--------|
| `client/src/components/GuestBadge.tsx` | DELETE. |
| `client/src/components/ExternalGuestGuard.tsx` | DELETE. |
| `client/src/hooks/useIsExternalAdmin.ts` | DELETE. |
| `client/src/utils/guestDisable.ts` | DELETE. |

### Client (trim)

| File | Change |
|------|--------|
| `client/src/components/admin/AdminTeam.tsx` | Drop `<GuestBadge>` rendering, drop `isExternal` column / styling, drop `ExternalGuestGuard` wrappers on destructive controls. |
| `client/src/components/admin/AdminCannedResponses.tsx` | Drop `ExternalGuestGuard` / `disabledIfExternal` from edit/delete buttons. |
| `client/src/components/admin/AdminLabels.tsx` | Same. |
| `client/src/components/admin/AdminBusinessHours.tsx` | Same. |
| `client/src/components/admin/AdminDepartments.tsx` | Same (SLA edit + dept CRUD). |
| `client/src/components/admin/AdminWebhooks.tsx` | Same (CRUD + secret rotate + test). |
| `client/src/views/AdminView.tsx` | Drop guest-related gating + the `useIsExternalAdmin` hook usage. |
| `client/src/views/LoginView.tsx` | Drop the `sso_error=guest_multi_partner_mapping` branch + copy. |
| `client/src/components/ui/UserMenuChip.tsx` | Drop `<GuestBadge>` next to identity. |
| `client/src/components/ui/Avatar.tsx` | Drop `isExternal` prop + ring/border treatment. |
| `client/src/components/support/SidebarFooter.tsx` | Drop `<GuestBadge>` on team rows. |
| `client/src/components/chat/ChatHeader.tsx` | Drop `<GuestBadge>` in participant line. |
| `client/src/components/chat/Message.tsx` | Drop `<GuestBadge>` next to sender name. |
| `client/src/types/index.ts` | Drop `isExternal?: boolean` from `AuthUser` + participant types. |
| `client/src/store/useStore.ts` | Drop `isExternal` from auth slice + any setter. |
| `client/src/locales/{en,fr,nl}.ts` | Delete the 6 guest_* keys + `sso_guest_multi_partner_message` (Decision C). |
| `client/src/components/admin/__tests__/AdminCannedResponses.test.tsx` | Trim guest-related assertions. |

### Docs

| File | Change |
|------|--------|
| `CLAUDE.md` (root + project) | Delete the **Azure B2B Guest Support** bullet under "Key Conventions" and any `destructive_admin` references in the AI/auth section. |
| `docs/TENANT_IDENTITY_SPEC.md` | DELETE (the entire doc is the B2B spec). |
| `docs/AUDIT_RUNBOOK.md` | Strip B2B-guest paragraph. |
| `docs/SSO_SETUP_RUNBOOK.md` | Strip B2B-guest section. |
| `docs/TECHNICAL.md` | Strip. |
| `docs/TESTING.md` | Strip. |
| `docs/USER_GUIDE.md` | Strip GUEST badge mention. |
| `docs/AZURE_CUTOVER_RUNBOOK.md` | Strip. |
| `docs/BREAK_GLASS_RUNBOOK.md` | Verify no `isExternal` mention remains. |
| `README.md` | Verify no B2B mention remains. |
| `CHANGELOG.md` | **Leave intact** — historical record. Add new entry for this removal. |
| `.env.example` | Verify (probably no change). |

## Execution order

1. **Delete `capabilities.ts` + `capabilities.test.ts`; rewrite `types.ts` + `actor.ts`** — server core change. Drop the `Capability` type entirely. Drop the `capability` option from `trpcActor` / `socketActor`. Drop `isExternal` from `UserActor`. This breaks every router + many tests in one go, on purpose.
2. **tRPC routers** — sweep all 22 capability call sites, replace with bare `trpcActor(ctx)` or `void trpcActor(ctx)`. Server compiles again.
3. **SSO callback** — drop B2B claim parse, drop multi-partner reject, drop `flipIsExternal` calls.
4. **JWT + authSession + middleware + context** — drop the `isExternal` claim/field. Tokens minted before the change still parse (Zod `.optional()` already handles legacy; we're removing the field from the schema entirely, which is also forward-compatible: extra unknown claims are ignored).
5. **Socket handlers** — drop `socket.data.isExternal` set + reads.
6. **DELETE `isExternalFlip.ts`** + its 2 tests.
7. **Schema + migration** — drop `isExternal` from `users` table type and drop `isExternal?` from `participants` JSONB type. Generate migration `0018_drop_is_external.sql` via `drizzle-kit generate`. Apply against local Docker DB via `npm run db:migrate`. Take a backup first (`npm run db:backup`).
8. **Client guts** — delete the 4 dedicated files, rip wrappers + props out of the 13 callers, drop store + types + locales.
9. **Tests** — delete the 4 dedicated B2B test files; sweep `actorFactory({ isExternal: ... })` calls and the `destructive_admin`/`audit_read` test cases out of the multi-purpose tests.
10. **Docs** — delete `TENANT_IDENTITY_SPEC.md`, strip B2B sections from the 8 other docs, update `CLAUDE.md`, add `CHANGELOG.md` entry.
11. **`scripts/ci.ps1`** — run until green. Expect failures in steps 1–2 until step 2 finishes; expect test-server failures until step 9.

## Risks + notes

- **No forced re-login.** Removing `isExternal` from the JWT schema is safe — existing tokens parse fine (extra/missing optional claims are ignored).
- **`partner_id` narrowing** in routers still depends on `trpcActor(ctx)` for the partnerId-required throw. Keep the call site; drop only the `capability` option.
- **`partnerAdminProcedure` already enforces admin role**, so every `destructive_admin` call site was redundant defense — removing it doesn't widen access for internal users; it only removes the block on (now-gone) guest users.
- **`platform_operator` bypass** is preserved: `partnerAdminProcedure` allows platform operators through regardless.
- **`participants` JSONB** has historical rows with `isExternal: true/false`. Removing the field from the `$type<>` is purely a TS-level narrowing — existing rows are tolerated (unknown JSONB keys ignored at read).
- **Migration (Decision A — drop now)**: irreversible. Take `npm run db:backup` before running `npm run db:migrate`. The `participants` JSONB will still contain `isExternal` keys on historical rows — that's fine, unknown JSONB keys are ignored at read.
- **Production cutover**: per `[drizzle_squash_for_prod]` memory, all dev migrations get collapsed into a single `0000` for prod. `0018_drop_is_external.sql` will fold into the squash. No prod-DB risk because there's no prod DB yet.
- **e2e**: No e2e specs were found that exercise the B2B path (grep returned zero hits in `testing/e2e`). Nothing to update there.
- **`docs/superpowers/plans/2026-04-2{7,8}*`** plans documenting the introduction of `destructive_admin` / actor — leave intact as historical record (they're plans, not active docs).

## Definition of done

- `scripts/ci.ps1` green (typecheck, lint, audit, test-server, test-client, build, e2e).
- `git grep -i "isExternal\|destructive_admin\|audit_read\|ai_config_read\|GuestBadge\|ExternalGuestGuard\|guest_multi_partner\|B2B"` returns only:
  - `CHANGELOG.md` entries (historical)
  - `docs/superpowers/plans/` historical plans
  - `server/drizzle/0000_initial.sql` + earlier snapshots (historical migration ledger — column was added then dropped)
  - `server/drizzle/0018_drop_is_external.sql` (the drop migration itself)
- A platform operator can still enter any partner via `/enter-partner`.
- A tenant admin (internal) can still CRUD webhooks, labels, canned responses, departments, members, SLA, AI config — no regression.
- A user logging in via SSO whose Azure account is `acct === 1` (guest) is no longer rejected on multi-partner mapping — they enter the picker like any internal user. (If product wants to keep that reject, surface it in code review.)
