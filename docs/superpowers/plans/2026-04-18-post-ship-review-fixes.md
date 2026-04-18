# Post-Ship Review Fix Sweep — 2026-04-18

**Source:** [2026-04-18-post-ship-review.md](../reviews/2026-04-18-post-ship-review.md)
**Status:** H-1 Shipped 2026-04-18 (`5eb6d24`). H-2 / M-1 / M-2 pending.
**Strategy:** Bundle remaining 3 findings as a single sweep PR. All low-blast-radius, single-file edits + tests.

## Shipped

| # | Finding | Commit |
|---|---|---|
| H-1 | `purgeAbandonedInvites` excludes platform operators | `5eb6d24` |

## Pending

| # | Finding | Effort | Risk |
|---|---|---|---|
| H-2 | `updateMembership` atomicity + audit-trail | S | medium (schema untouched, behavior changes) |
| M-1 | `removeMember` audit row inside transaction | XS | trivial |
| M-2 | `getCrossPartnerActivity` orderBy inline aggregate | XS | trivial |

---

## H-2 — Wrap `updateMembership` in a transaction, unswallow audit failure

**Branch:** `fix/update-membership-atomic`
**File:** `server/trpc/routers/platform/users.ts:268-310`

### Why
Three sequential DB writes, no enclosing transaction:
1. `db.update(memberships)` — role change
2. `db.insert(auditLog)` in `try/catch` with silent `logger.error`
3. `db.update(users).set({ isPlatformOperator })` — security flag

`isPlatformOperator` promotions can complete with no audit row if the insert throws. Crash between (1) and (3) leaves role mismatched.

### Steps
1. Replace the three sequential writes with a single `db.transaction(async (tx) => { ... })` block.
2. Use `tx.update` / `tx.insert` inside.
3. Remove the `try/catch` around `auditLog` insert — let it bubble and roll back.
4. The outer `try/catch` in the procedure handler stays (converts unknown errors to TRPCError).

### Verify
- New test in `server/__tests__/` mocking `db.insert` to throw on the audit row; assert the whole mutation rolls back (membership + isPlatformOperator unchanged).
- Existing `platform.users.test.ts` (if present) still passes.

### Commit
```
fix(platform): make updateMembership atomic and fail-loud on audit insert

Three sequential writes (membership update, audit insert, user
flag update) were not in a transaction; the audit insert was in a
silent try/catch. An isPlatformOperator promotion could complete
with zero audit trail, and a crash between writes left the user
flag inconsistent with the membership role.

Wrap all three in db.transaction, remove the audit catch so any
failure rolls back the promotion. Source: post-ship review H-2.
```

---

## M-1 — Move `removeMember` audit insert inside transaction

**Branch:** `fix/remove-member-audit-atomic`
**File:** `server/trpc/routers/partner/members.ts:302-325`

### Why
`tx.delete(memberships)` commits inside transaction; audit insert runs after transaction + after session revocation. Crash between commit and audit insert leaves removal unlogged.

### Steps
1. Move `db.insert(auditLog)` → `tx.insert(auditLog)` inside the existing `db.transaction` block.
2. Place it BEFORE the delete (or after — either order is fine; both commit together).
3. Keep `revokeUserSessions` outside the transaction (idempotent; can retry).

### Verify
- Existing `members.test.ts` or equivalent still green.
- Test: mock `tx.insert(auditLog)` to throw; assert `memberships` row still present (rollback).

### Commit
```
fix(partner): write member.removed audit inside the deletion transaction

Audit insert ran after the transaction committed, so a crash
between commit and insert left the removal permanent but with no
audit trail. Move the insert inside the transaction so removal
and audit commit atomically. Source: post-ship review M-1.
```

---

## M-2 — Inline aggregate in `getCrossPartnerActivity` orderBy

**Branch:** `fix/cross-partner-activity-orderby`
**File:** `server/trpc/routers/platform/audit.ts:430`

### Why
`sql\`total_events DESC\`` relies on Drizzle emitting a SELECT-clause alias that PostgreSQL can resolve. Depending on Drizzle version this can fail with `column does not exist` or fall back to insertion order.

### Steps
1. Replace `.orderBy(sql\`total_events DESC\`)` with `.orderBy(sql\`COUNT(*)::int DESC\`)` — or whatever the aggregate expression is in the SELECT clause. Copy it verbatim.
2. Manually verify the cross-partner activity panel in `PlatformAuditLog` still sorts by event count descending.

### Verify
- Existing router test still green.
- Manual: `trpc.platform.getCrossPartnerActivity` returns partners ordered by descending event count.

### Commit
```
fix(audit): use inline aggregate in getCrossPartnerActivity orderBy

Ordering by the `total_events` alias relied on Drizzle emitting a
SELECT-clause alias that PostgreSQL could resolve. Safer to sort
by the inline aggregate expression, which does not depend on
alias-resolution behavior across Drizzle versions. Source:
post-ship review M-2.
```

---

## Sequencing

All 3 are independent and ship-together-safe. Bundle as a single sweep PR:

1. Apply H-2 edit + test
2. Apply M-1 edit
3. Apply M-2 edit
4. Run `scripts/ci.ps1 -Skip e2e` (no E2E impact)
5. Single commit or 3 commits under one PR

Total: ~1-2h including test write-up.

## Rollback

Each fix is a pure behavior change on a single procedure; revert is per-file. No schema changes, no data migrations.
