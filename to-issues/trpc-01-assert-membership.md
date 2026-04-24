## What to build

Centralize the membership check currently living as a private function inside `server/trpc/routers/support.ts`. Create `server/services/membership.ts` exporting `assertMembership(userId, partnerId, isPlatformOperator)`. Replace the in-router implementation with an import from the new module.

Source plan: `docs/superpowers/plans/2026-04-24-trpc-tenant-isolation-hardening.md` (Step 1).
Source PRD: `docs/superpowers/specs/2026-04-24-trpc-tenant-isolation-prd.md` (US 2, 10, 11).

## Acceptance criteria

- [ ] `server/services/membership.ts` exists and exports `assertMembership`
- [ ] Throws `TRPCError { code: 'FORBIDDEN' }` when no membership row exists
- [ ] Returns void when a membership row exists
- [ ] Platform operators (`isPlatformOperator=true`) skip the DB check and pass
- [ ] `server/trpc/routers/support.ts` imports from the new module; private copy removed
- [ ] Unit test covers: non-member rejected, member passes, platform operator skipped
- [ ] Existing `support.*` behavior tests still pass unchanged
- [ ] `scripts/ci.ps1 -Skip e2e` passes green

## Blocked by

- None - can start immediately
