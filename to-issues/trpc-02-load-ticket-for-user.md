## What to build

Add a second helper to `server/services/membership.ts`: `loadTicketForUser(ticketId, ctx)` that loads a ticket row and enforces tenant ownership in a single call. Throws `NOT_FOUND` if the ticket doesn't exist, `FORBIDDEN` if `ticket.partnerId !== ctx.user.partnerId`. **No platform-operator bypass** — operators must have already entered the partner.

Replace the hand-written load-then-check blocks in `server/trpc/routers/message.ts` (`list` query) and `server/trpc/routers/sla.ts` (`getForTicket` query) with the helper.

Source plan: `docs/superpowers/plans/2026-04-24-trpc-tenant-isolation-hardening.md` (Steps 2-3).
Source PRD: `docs/superpowers/specs/2026-04-24-trpc-tenant-isolation-prd.md` (US 3, 6, 13, 17).

## Acceptance criteria

- [ ] `loadTicketForUser(ticketId, ctx)` exported from `server/services/membership.ts`
- [ ] Returns the full ticket row on success (callers do not re-query)
- [ ] Throws `NOT_FOUND` when the ticket does not exist
- [ ] Throws `FORBIDDEN` when `ticket.partnerId !== ctx.user.partnerId`, including for platform operators (no bypass)
- [ ] `server/trpc/routers/message.ts` `list` uses the helper; manual partner-mismatch branch deleted
- [ ] `server/trpc/routers/sla.ts` `getForTicket` uses the helper; manual check deleted
- [ ] Unit tests cover: not-found, cross-tenant rejected (incl. operator), same-tenant returns row
- [ ] Behavior test: caller in partner A requesting partner B's ticket via `message.list` receives FORBIDDEN
- [ ] Behavior test: same assertion for `sla.getForTicket`
- [ ] `scripts/ci.ps1 -Skip e2e` passes green

## Blocked by

- Blocked by #2
