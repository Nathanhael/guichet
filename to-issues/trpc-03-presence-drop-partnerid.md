## What to build

Remove the `partnerId: z.string()` field from the input schema of `presence.getOnlineStatus`. Switch the procedure to `partnerScopedProcedure` and derive `partnerId` from `ctx.user.partnerId`. Update the client call site to stop sending `partnerId`.

Source plan: `docs/superpowers/plans/2026-04-24-trpc-tenant-isolation-hardening.md` (Step 4).
Source PRD: `docs/superpowers/specs/2026-04-24-trpc-tenant-isolation-prd.md` (US 12).

## Acceptance criteria

- [ ] `getOnlineStatus` input schema no longer includes `partnerId`
- [ ] Procedure uses `partnerScopedProcedure`; reads `ctx.user.partnerId` server-side
- [ ] All client callers updated; none pass `partnerId`
- [ ] `tsc --noEmit` passes on both server and client (catches stragglers)
- [ ] Existing presence behavior unchanged for in-tenant callers
- [ ] `scripts/ci.ps1 -Skip e2e` passes green

## Blocked by

- None - can start immediately
