## What to build

Remove the client-supplied `partnerId: z.string().optional()` input from `ticket.list` and delete the platform-operator branch. The endpoint stays on `partnerScopedProcedure` and derives `partnerId` from JWT context — single code path for agent/support/admin.

Grep the codebase for any caller that passes `partnerId` to `ticket.list` (likely `PlatformView`-adjacent components). If a cross-partner caller exists, add `platform.listPartnerTickets` on `platformProcedure` with the same query shape and update that caller. If no cross-partner caller exists, skip the new endpoint — the deletion stands alone. Document the grep result in the PR description.

Source plan: `docs/superpowers/plans/2026-04-24-trpc-tenant-isolation-hardening.md` (Step 5).
Source PRD: `docs/superpowers/specs/2026-04-24-trpc-tenant-isolation-prd.md` (US 9, 13, 14).

## Acceptance criteria

- [ ] `ticket.list` input no longer accepts `partnerId`
- [ ] Platform-operator branch removed; single code path for all in-tenant roles
- [ ] Grep result documented in the PR description (callers that passed `partnerId`, or "none found")
- [ ] If any cross-partner caller exists: `platform.listPartnerTickets` added on `platformProcedure`; caller updated
- [ ] `tsc --noEmit` passes on server and client
- [ ] `AdminTickets` list and `SupportView` queue still work (no regression for in-tenant roles)
- [ ] `scripts/ci.ps1 -Skip e2e` passes green

## Blocked by

- None - can start immediately
