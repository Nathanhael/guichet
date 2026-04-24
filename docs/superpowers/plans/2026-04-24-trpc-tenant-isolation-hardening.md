# tRPC Tenant-Isolation Hardening

**Date**: 2026-04-24
**Branch**: `security/trpc-tenant-isolation`
**Status**: Planned — awaiting greenlight to execute.

---

## Context

Multi-tenancy is enforced via `partnerId` filters on every DB query. Two patterns coexist:

- **Pattern A** — `partnerId` read from JWT context (`ctx.user.partnerId`). Safe; server-trusted.
- **Pattern B** — `partnerId` read from client-supplied `input.partnerId`. Requires an explicit authorization check before use.

Pattern B is used today in `presence.ts`, `support.ts`, `ticket.ts`, and all of `platform/*`. The checks are ad-hoc (`!== ctx.user.partnerId`, `assertMembership`, if-else on `isPlatformOperator`). Any new endpoint that accepts `partnerId` without the right check would silently leak cross-tenant data.

Socket layer already solved this: `server/socket/partnerScope.ts` centralizes the check via `requirePartnerScope(socket, ticketId)`. The tRPC layer lacks the equivalent.

A second, subtler class of leak exists even under Pattern A: endpoints that take an object ID (`ticketId`, `messageId`) and load by ID without a `partnerId` filter, then check the loaded row's `partnerId` afterward ("load-then-check"). Works, but every new route re-hand-writes the check and can forget it.

## Goals

1. Make Pattern A the default. Shrink Pattern B's footprint to two auditable locations.
2. Eliminate hand-written tenant checks for ID-based lookups by routing through one helper.
3. Align REST (tRPC) tenant semantics with Socket.io: operators must **enter** a partner to cross tenants.
4. Guard the invariants with a cheap CI check so the rules survive future contributors.

## Non-goals

- No change to the JWT shape or revocation flow.
- No change to socket handlers (already correct).
- No backfill of behavior-level cross-tenant leak tests across all endpoints (opportunistic going forward).

## Plan

### Step 1 — Extract `assertMembership`

- New file: `server/services/membership.ts`.
- Export `assertMembership(userId, partnerId, isPlatformOperator)` — behavior identical to the private copy in `support.ts`.
- Unit test: non-member throws FORBIDDEN; member passes; platform operator skipped.
- Update `support.ts` imports.

### Step 2 — New helper `loadTicketForUser`

- Location: `server/services/membership.ts` (same file; single-purpose module).
- Signature:
  ```ts
  loadTicketForUser(ticketId: string, ctx: { user: TRPCUser }): Promise<TicketRow>
  ```
- Behavior: load ticket by `id`; if `ticket.partnerId !== ctx.user.partnerId` → throw FORBIDDEN. **No operator bypass.** Operators must have entered the partner already.
- Unit test: owns it; cross-tenant rejected; NOT_FOUND when ticket missing.

### Step 3 — Port ID-based loaders to the helper

Replace hand-written load-then-check in:
- `server/trpc/routers/message.ts` — `list` query (lines 40–57).
- `server/trpc/routers/sla.ts` — `getForTicket` query (lines 17–27).
- Any other router surfaced by the CI check in Step 8.

Each site: delete the manual partner-mismatch branch, call `loadTicketForUser` instead.

### Step 4 — Drop dead `partnerId` input in `presence.getOnlineStatus`

- Remove `partnerId: z.string()` from input schema.
- Replace `input.partnerId` with `ctx.user.partnerId`. Use `partnerScopedProcedure` to narrow.
- No behavior change for callers in the same tenant (which is all of them — the existing `!==` check already enforced it). Platform operators lose the ability to query cross-tenant online status here; they'd use a dedicated platform endpoint if ever needed (none today).
- Update the client call site to stop sending `partnerId`.

### Step 5 — Split `ticket.list` operator branch

- Current `ticket.list` takes optional `partnerId` for operators. Split:
  - `ticket.list` — stays on `partnerScopedProcedure`. Drop the `partnerId` input field and the operator branch. Agents/support/admins only.
  - `platform.listPartnerTickets` — new endpoint on `platformProcedure`. Takes `partnerId: z.string()`. Same query shape otherwise.
- Update callers:
  - `AdminTickets` / `SupportView` queue → use `ticket.list` (no change — they never sent `partnerId`).
  - `PlatformView` any cross-partner ticket view → new endpoint.
- If there is no current platform UI that reads cross-partner tickets without entering, skip the new endpoint and only delete the operator branch. Decide during execution.

### Step 6 — Policy: operators must "enter" a partner

Matches existing socket behavior (`server/socket/partnerScope.ts` has no operator bypass). No code change — this is the invariant that Steps 1–5 enforce. Document in `CLAUDE.md` under "Multi-Tenancy":

> Platform operators cross tenants only via `platform.*` endpoints or by calling `POST /enter-partner` to mint a JWT with the target `partnerId`. No non-platform endpoint accepts cross-tenant input.

### Step 7 — Allowlist the two Pattern-B homes

- `server/trpc/routers/support.ts` — legitimate (multi-partner users browsing before entering).
- `server/trpc/routers/platform/**` — operator scope by construction (`platformProcedure`).
- All other routers: Pattern A only.

### Step 8 — CI grep guard

- New script: `scripts/check-trpc-tenant-isolation.mjs`.
- Logic: for every file under `server/trpc/routers/` except the allowlist (`support.ts`, `platform/**`), fail if `partnerId:\s*z\.` appears inside an `.input(` block.
- Wire into `scripts/ci.ps1` as a new step after typecheck and before tests.
- ~25 LOC. Runs in <1s.

## Execution order

1. Step 1 (extract `assertMembership`) — no behavior change; safe first.
2. Step 2 (build `loadTicketForUser`) — new helper, no callers yet.
3. Step 3 (port `message.list`, `sla.getForTicket`) — behavior-preserving refactor; behavior test remains green.
4. Step 4 (`presence.getOnlineStatus`) — client call site updates in same PR.
5. Step 5 (`ticket.list` split) — biggest blast radius; check client call sites carefully.
6. Step 7 + Step 8 (allowlist + CI guard) — lock the door behind us.
7. Step 6 (doc update in `CLAUDE.md`) — concurrent with Step 8 PR.

## Testing

- Unit: `membership.test.ts` for both `assertMembership` and `loadTicketForUser`.
- Behavior: existing `message.list` and `sla.getForTicket` tests should remain green after Step 3. Add one cross-tenant FORBIDDEN assertion if not present.
- CI: `scripts/ci.ps1` runs the new grep guard.
- Manual smoke: platform operator flow — enter partner → view tickets → send message → close ticket. Same flow for a multi-partner user in `support.*`.

## Rollback

Each step is independently revertable. Revert order: CI guard → ticket.list split → presence → message/sla helper calls → `loadTicketForUser` → `assertMembership` extraction.

## Out of scope

- Behavior-level cross-tenant leak tests for every tenant-scoped endpoint. Opportunistic going forward; not a prerequisite for this plan.
- Replacing existing `partnerScopedProcedure` usages. They already follow Pattern A; no change needed.
- Changes to Socket.io handlers. Already correct.
