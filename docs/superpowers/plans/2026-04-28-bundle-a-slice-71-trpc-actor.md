# Bundle A / Slice 6 (#71) — tRPC actor migration + delete `blockExternalUsers`

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the last per-call B2B-guest middleware indirection from the tRPC layer. Every handler that previously hung a `blockExternalUsers` middleware now resolves the actor with `trpcActor(ctx)` and asserts the capability inline with `assertCan(actor, 'destructive_admin')`. After this slice, `services/auth/` is the sole arbiter of "who is acting" + "may they perform this action" on every protected tRPC handler we currently gate.

**Architecture:** Slice #66 (PR [#73](https://github.com/Nathanhael/guichet/pull/73)) landed `services/auth/` (canonical `Actor`, `RULES`, `assertCan`, JWT carrying `isExternal`). Slice #67 made every `users.isExternal` flip atomically revoke pre-flip sessions + refresh tokens via `flipIsExternal`. The intermediate slice #71 step swapped the `blockExternalUsers` middleware body to read `ctx.user.isExternal` from the JWT claim (no DB hit). This slice closes the loop: the middleware itself + its 3 procedure-factory wrappers + the `gatedPartnerAdminNoGuests` inline composition in `webhook.ts` are deleted, and the 13 affected handlers consume `trpcActor(ctx)` + `assertCan(actor, 'destructive_admin')` directly.

The `destructive_admin` capability rule (`capabilities.ts`) already encodes the same predicate the middleware enforced: `!actor.isExternal && (isTenantAdmin(role) || isPlatformAdmin(isPlatformOperator))`. Migration is a literal port.

**Tech Stack:** TypeScript, tRPC 11, Vitest, Drizzle. No new deps.

**Parent issue:** [#71](https://github.com/Nathanhael/guichet/issues/71). Parent PRD: [#65](https://github.com/Nathanhael/guichet/issues/65). RFC: [#63](https://github.com/Nathanhael/guichet/issues/63). Blocks: [#72](https://github.com/Nathanhael/guichet/issues/72).

---

## Pre-flight: Decisions Locked Before Coding

**D1. Inline `assertCan`, not a new middleware factory.**
The user-facing convention from issue #71 says "trpcActor inside handler bodies is for type narrowing and blockExternal enforcement". A capability middleware would re-introduce the indirection we're removing. Inline matches slice #68's socket-handler pattern (`socketActor(socket)` at top, `assertCan(actor, cap)` next).

**D2. Switch `destructiveAdminProcedure` callsites to `partnerAdminProcedure`.**
Every current callsite of `destructiveAdminProcedure` and `internalAdminReadProcedure` already manually checks `ctx.user.partnerId` and throws BAD_REQUEST when null. `partnerAdminProcedure` (= `partnerScopedProcedure.use(adminCheck)`) makes that guarantee at the procedure-factory layer, so the manual non-null check disappears and `trpcActor(ctx)` succeeds without re-throwing. `partnerInternalAdminReadProcedure` is already partner-scoped, so its callsites switch to plain `partnerAdminProcedure`.

**D3. Don't widen scope to non-gated handlers.**
The issue convention is explicit: `trpcActor` is for narrowing + B2B gate enforcement. Other handlers continue to read `ctx.user.id` / `ctx.user.partnerId` directly via the procedure factory's narrowing. A future bundle can sweep them; this slice doesn't.

**D4. Test substrate: `createCaller` with synthetic ctx, not Express integration.**
The two existing guest-gating tests (`partner.audit.guestGating.test.ts`, `partner.listAdmins.test.ts`) drive `partnerAuditRouter.createCaller({ user: ... })` directly. New webhook + config gating tests follow the same pattern. Source-regex test in `__tests__/destructiveAdminProcedure.test.ts` is gitignored local-only — pivot in place to assert the new pattern (no `blockExternalUsers`, handlers contain `assertCan(actor, 'destructive_admin')`).

**D5. New runtime integration test: `webhook.create` rejects B2B guest with FORBIDDEN.**
Issue acceptance row: "B2B guest is still blocked from destructive admin actions — assert this in a new tRPC integration test". The webhook router has no behavioral test today, only the source-regex one. Add `webhook.guestGating.test.ts` mirroring `partner.audit.guestGating.test.ts`'s shape.

**D6. Code comment documenting the `trpcActor` convention.**
Per the issue: "convention documented in code comment". Land a short JSDoc comment at the top of `actor.ts`'s `trpcActor` export explaining: procedure factories own role-level gating; `trpcActor` is for type narrowing + capability enforcement inside handler bodies.

---

## File Structure

### Files to modify

| Path | Change |
|---|---|
| `server/trpc/routers/webhook.ts` | Drop `gatedPartnerAdminNoGuests`. 5 destructive ops use `gatedPartnerAdmin` + inline `trpcActor` + `assertCan`. |
| `server/trpc/routers/partner/audit.ts` | 2 `partnerInternalAdminReadProcedure` ops switch to `partnerAdminProcedure` + inline guard. |
| `server/trpc/routers/partner/members.ts` | `listAdmins` (read) + 3 destructive ops switch from `internalAdminReadProcedure` / `destructiveAdminProcedure` to `partnerAdminProcedure` + inline guard. |
| `server/trpc/routers/partner/config.ts` | 2 destructive ops switch from `destructiveAdminProcedure` to `partnerAdminProcedure` + inline guard. |
| `server/trpc/trpc.ts` | Delete `blockExternalUsers`, `destructiveAdminProcedure`, `internalAdminReadProcedure`, `partnerInternalAdminReadProcedure`. |
| `server/services/auth/actor.ts` | Tighten `trpcActor` JSDoc to document the convention. |
| `CHANGELOG.md` | Unreleased entry: "Bundle A slice 6 — tRPC handlers consume `trpcActor` + `assertCan` directly; `blockExternalUsers` middleware deleted." |

### Files to create

| Path | Responsibility |
|---|---|
| `server/trpc/routers/webhook.guestGating.test.ts` | Behavioral test: `webhook.create` returns FORBIDDEN for `isExternal=true` admin caller; succeeds for internal admin + platform operator. |

### Files to pivot in place (local-only, gitignored)

| Path | Change |
|---|---|
| `server/__tests__/destructiveAdminProcedure.test.ts` | Pivot source-regex assertions: assert `blockExternalUsers` is gone; assert each previously-gated handler body contains `assertCan(actor, 'destructive_admin')`. |

---

## Conventions

- Test runner: `docker compose exec -T server npm test -- <path/to/file.test.ts>`. Vitest passthrough.
- Type check: `docker compose exec -T server npx tsc --noEmit -p .`
- CI: `powershell -File scripts/ci.ps1` (final task only).
- Server reload: `docker compose restart server` after each handler-file edit (memory: tsx watch unreliable on Windows bind mount). NOT required for pure-Vitest unit runs.
- Commit style: `refactor(auth):` for handler migrations, `feat(auth):` for the deletions, `test(auth):` for test-only commits. One commit per task.
- Branch: `feat/bundle-a-slice-71-trpc-actor` off main.

---

## Tasks

### Task 1: Migrate `webhook.ts` to inline `trpcActor` + `assertCan`

5 destructive ops (`create`, `update`, `regenerateSecret`, `delete`, `test`) currently routed through `gatedPartnerAdminNoGuests`. Switch to plain `gatedPartnerAdmin`; add `trpcActor` + `assertCan(actor, 'destructive_admin')` at top of each handler body. Replace `ctx.user.partnerId` with `actor.partnerId`, `ctx.user.id` with `actor.userId`. Drop the `gatedPartnerAdminNoGuests` constant.

Imports: drop `blockExternalUsers` from `'../trpc.js'`; add `trpcActor, assertCan` from `'../../services/auth/index.js'`.

After edit: `docker compose restart server` is not strictly required for Vitest, but run `docker compose exec -T server npm test -- webhook --run` to confirm related tests still pass.

### Task 2: Migrate `partner/audit.ts`

2 reads (`getAuditLog`, `getForTicket`) on `partnerInternalAdminReadProcedure` switch to `partnerAdminProcedure`. Inline `trpcActor(ctx)` + `assertCan(actor, 'destructive_admin')` at top. Replace `ctx.user.partnerId` with `actor.partnerId`.

Drop `partnerInternalAdminReadProcedure` from imports; keep `partnerAdminProcedure`. Existing `verifyChain`, `exportAuditLog`, `listActions`, `listTargetTypes` are untouched.

Run: `docker compose exec -T server npm test -- partner.audit --run`. Both `partner.audit.test.ts` and `partner.audit.guestGating.test.ts` should still pass — they exercise FORBIDDEN through `createCaller` and the inline check delivers the same code.

### Task 3: Migrate `partner/members.ts`

`listAdmins` (read, was `internalAdminReadProcedure`) and 3 destructive ops (`inviteExternalUser`, `updateMember`, `removeMember`, was `destructiveAdminProcedure`) switch to `partnerAdminProcedure`. Inline `trpcActor` + `assertCan(actor, 'destructive_admin')`. Drop `internalAdminReadProcedure` and `destructiveAdminProcedure` from imports.

`listMembers`, `memberStats` stay on `adminProcedure` — unchanged.

Run: `docker compose exec -T server npm test -- partner.listAdmins --run`. Test should still pass.

### Task 4: Migrate `partner/config.ts`

2 destructive ops (`updateDepartments`, `updateDepartmentSla`) switch from `destructiveAdminProcedure` to `partnerAdminProcedure`. Inline guard. Drop `destructiveAdminProcedure` from imports.

`updateBusinessHours`, `getManifest`, etc. stay on `adminProcedure` — unchanged.

Run: `docker compose exec -T server npm test -- partner --run` to spot any regressions across partner suites.

### Task 5: Add new behavioral test — `webhook.guestGating.test.ts`

New file `server/trpc/routers/webhook.guestGating.test.ts`. Drives `webhookRouter.createCaller(...)` with three callers (internal admin / platform operator / B2B guest admin) and asserts:

| Caller | Action | Expected |
|---|---|---|
| internal admin (`isExternal=false`) | `webhook.create({ url, events })` | succeeds |
| platform operator (`isPlatformOperator=true`) | `webhook.create(...)` | succeeds |
| B2B guest admin (`isExternal=true`) | `webhook.create(...)` | FORBIDDEN |

Mock `db`, `services/encryption`, `services/webhookDispatch.validateWebhookUrl`, drizzle ops the same way `partner.audit.guestGating.test.ts` mocks them. Pattern copy-pasta.

Run: `docker compose exec -T server npm test -- webhook.guestGating --run`. Expect PASS.

### Task 6: Delete the wrappers + middleware in `trpc.ts`

Now that all 13 callsites are migrated, delete:
- `blockExternalUsers` (lines 110–144)
- `destructiveAdminProcedure` (line 160)
- `internalAdminReadProcedure` (line 170)
- `partnerInternalAdminReadProcedure` (line 178)

Confirm via grep that no other source file imports any of these names. Run `docker compose exec -T server npx tsc --noEmit -p .` — must be clean.

### Task 7: Pivot the local source-regex test

`server/__tests__/destructiveAdminProcedure.test.ts` (gitignored, local-only) currently asserts source patterns that are about to disappear. Pivot the file in place to assert the new shape:

- `trpcSource` no longer matches `blockExternalUsers`, `destructiveAdminProcedure`, `internalAdminReadProcedure`, `partnerInternalAdminReadProcedure`.
- Each previously-gated handler in `webhook.ts`, `partner/audit.ts`, `partner/members.ts`, `partner/config.ts` matches `assertCan\(actor,\s*'destructive_admin'\)` somewhere in its body.
- `webhook.create` etc. now use plain `gatedPartnerAdmin`, not `gatedPartnerAdminNoGuests` (which no longer exists).

Do NOT `git add` this file — it's `__tests__/` which the repo gitignores. Verify with `git check-ignore -v server/__tests__/destructiveAdminProcedure.test.ts` (expected: ignored).

Run: `docker compose exec -T server npm test -- destructiveAdminProcedure --run`. Expect PASS.

### Task 8: `trpcActor` JSDoc tightening

Edit `server/services/auth/actor.ts`. The current JSDoc says "tighten in slice #71 when tRPC handlers begin consuming actor.name". Replace with:

```
/**
 * Narrow a tRPC Context into a typed UserActor.
 *
 * **Convention:** procedure factories (`partnerScopedProcedure`, `adminProcedure`,
 * `roleProcedure`, etc.) keep their existing role-level gating. `trpcActor` inside
 * handler bodies is for (a) type narrowing of `ctx.user.partnerId` to non-null,
 * and (b) inline capability enforcement via `assertCan(actor, cap)` for guards
 * that vary per-handler (e.g. the B2B-guest block on destructive admin actions).
 *
 * Throws `TRPCError` if the context lacks an authenticated user, lacks partner
 * scope, or fails the optional `opts.capability` gate.
 */
```

### Task 9: CHANGELOG entry + run CI

Append to the Unreleased section's existing Bundle A bullet (or a new bullet under `### Changed`):

```markdown
- **Bundle A slice 6 — tRPC actor migration** (issue #71) — every previously-gated tRPC handler (`webhook.create/update/regenerateSecret/delete/test`, `partner.audit.getAuditLog/getForTicket`, `partner.members.listAdmins/inviteExternalUser/updateMember/removeMember`, `partner.config.updateDepartments/updateDepartmentSla`) now resolves a typed `UserActor` via `trpcActor(ctx)` and asserts `destructive_admin` inline via `assertCan(actor, 'destructive_admin')`. The `blockExternalUsers` middleware and its 3 procedure-factory wrappers (`destructiveAdminProcedure`, `internalAdminReadProcedure`, `partnerInternalAdminReadProcedure`) are deleted. Behavior unchanged: B2B guests still blocked, platform operators still bypass. Single source of truth for the rule lives in `services/auth/capabilities.ts:RULES.destructive_admin`.
```

Run: `powershell -File scripts/ci.ps1`. All steps green. Commit individually per task; final commit is the changelog.

### Task 10: Open PR or FF-merge

Per Bundle A pattern: FF-merge to main, push, close #71 with the merge commit SHA. Since slices have been landing as direct commits to main without PRs in the recent history (slices 4+5 commit `5c62321` etc.), continue that pattern unless the user requests a PR.

---

## Self-Review Checklist

| Acceptance criterion | Task |
|---|---|
| `blockExternalUsers` middleware deleted | Task 6 |
| `destructiveAdminProcedure` rewired through `assertCan(actor, 'destructive_admin')` | Tasks 1, 3, 4 |
| `internalAdminReadProcedure` / `partnerInternalAdminReadProcedure` rewired similarly | Tasks 2, 3 |
| Handler bodies that previously did `ctx.user.partnerId!` now use `actor.partnerId` | Tasks 1–4 |
| Procedure factory convention documented | Task 8 |
| No regression in existing tRPC router tests | Tasks 1–4 each run their suite |
| New tRPC integration test for B2B guest FORBIDDEN | Task 5 |
| No remaining DB reads of `users.isExternal` on protected request paths | Task 6 (deletion of middleware drops the last one) |
| `scripts/ci.ps1` passes | Task 9 |

---

## End

After this slice + #72 cleanup, `services/auth/` is the only entry point for identity + capability resolution across both transports. No callsite outside `services/auth/` reads `ctx.user.partnerId!` non-null assertions for the gated handlers.
