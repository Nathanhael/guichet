# Post-Ship Review — 2026-04-18

**Scope:** `git diff aa446ce..HEAD` on `main`
**Window:** 2026-04-17 → 2026-04-18 shipping sweep
**Themes:** local-auth rip, invite flow hardening, audit observability batches 1-9, H/M/L review remediation, E2E round 3

## Summary

| Severity | Count |
|----------|-------|
| HIGH | 2 |
| MEDIUM | 2 |
| LOW | 0 (skipped — prior sweep drained) |

## Findings

### H-1 — `purgeAbandonedInvites` can delete platform operators

**File:** `server/services/gdpr.ts:363-385`
**Confidence:** 95

`purgeAbandonedInvites` selects `WHERE externalId IS NULL AND password IS NULL AND createdAt < cutoff`. The bootstrap service (`server/services/bootstrap.ts`) creates the initial platform operator with `externalId = NULL` and `isExternal = false` (default). Password column no longer exists post local-auth rip, so the `isNull(users.password)` check may be moot depending on schema.

Any bootstrapped operator that has not yet completed first SSO login within 30 days is permanently `DELETE`d by the daily GDPR purge job. `memberships` cascade-deletes too. Worst case: fresh install, staging env, or restored-from-backup environment loses its only platform operator.

**Fix:** Add `eq(users.isExternal, true)` to the WHERE clause. Intent is to clean up B2B guest stubs, not all SSO-unclaimed accounts.

**Effort:** XS — one line + test.

---

### H-2 — `updateMembership` non-atomic, silently loses platform_operator audit trail

**File:** `server/trpc/routers/platform/users.ts:268-310`
**Confidence:** 88

Three sequential DB writes with no enclosing transaction:

1. `db.update(memberships)` — commits immediately
2. `db.insert(auditLog)` wrapped in `try/catch` with `logger.error` — silently swallowed
3. `db.update(users).set({ isPlatformOperator })` — separate commit

Security-critical flag change (`isPlatformOperator`) can complete with no audit row if the insert throws. On crash between writes 1 and 3: role changed, `isPlatformOperator` flag wrong.

**Fix:** Wrap all three in `db.transaction()`. Remove the try/catch from the audit insert — let it bubble and roll back the promotion.

**Effort:** S.

---

### M-1 — `removeMember` audit log outside transaction

**File:** `server/trpc/routers/partner/members.ts:302-325`
**Confidence:** 85

`tx.delete(memberships)` commits inside transaction. Audit `db.insert(auditLog)` runs after transaction + after session revocation for external users. Crash between commit and audit insert leaves removal permanent but unlogged. CLAUDE.md mandates audit logging for security-relevant actions; member removal qualifies.

**Fix:** Move `db.insert(auditLog)` inside the transaction block before the delete. Session revocation can remain outside (idempotent).

**Effort:** XS.

---

### M-2 — `getCrossPartnerActivity` `ORDER BY` alias may not resolve

**File:** `server/trpc/routers/platform/audit.ts:430`
**Confidence:** 80

```ts
.orderBy(sql`total_events DESC`)
```

`total_events` is a Drizzle `.as('total_events')` alias. PostgreSQL supports SELECT-clause alias in `ORDER BY`, but Drizzle's `sql` template in `orderBy()` emits a standalone fragment. Depending on Drizzle version, alias may not be in emitted SQL, causing `column does not exist` or fallback ordering.

**Fix:** Use `sql\`COUNT(*)::int DESC\`` — inline aggregate, no alias dependency.

**Effort:** XS.

---

## Items Reviewed and Clean

- All new tRPC procedures use correct middleware tier (`platformProcedure` / `adminProcedure` / `destructiveAdminProcedure`)
- `destructiveAdminProcedure` correctly composed on webhook CRUD, member mutations, dept edits
- `partnerAuditRouter.getAuditLog` and `getForTicket` correctly scope on `ctx.user.partnerId` — no cross-tenant leakage
- `verifyAuditChain` (partner-scoped) returns only partner-scope counters, suppresses broken row ID when cross-tenant
- `runChainVerify` shared runner writes identical record shapes for manual + scheduled paths
- `assertVerifyChainAllowed` Redis rate limiter fails open on Redis outage (infra errors allow)
- `archiveAuditLog` transaction uses `onConflictDoNothing` + chain-advance guard to prevent double-advancement on replay
- `ticket:transfer` socket handler uses `requirePartnerScopeWith` before mutation
- `ticket:labels:update` validates all label IDs belong to ticket's partner before update
- New metrics (`guichet_ticket_audit_events_total`, `guichet_gdpr_purge_runs_total`, `guichet_gdpr_rows_purged_total`, `auditChainVerifyFailures`) have bounded label cardinality
- `ticketAudit.ts` fire-and-forget correct — failures logged, never thrown
- `scheduleDailyChainVerify` cancels on return call, never throws to caller

---

## Recommended Next Plan

Small sweep PR combining all 4 findings:

| # | Change | Effort |
|---|---|---|
| 1 | Add `isExternal = true` guard to `purgeAbandonedInvites` + test | XS |
| 2 | Wrap `updateMembership` in transaction, unwrap silent catch | S |
| 3 | Move `removeMember` audit insert inside transaction | XS |
| 4 | Inline aggregate in `getCrossPartnerActivity` orderBy | XS |

Total: ~1-2h. All low-blast-radius, testable in isolation.
