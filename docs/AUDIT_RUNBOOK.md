# Audit & Compliance Runbook

Operational reference for the Guichet audit subsystem: the WORM archive, the
SHA-256 hash chain, the chain-verify scheduler, partner-scoped verify, the
ticket-lifecycle emitter, the webhook-backed alerting, and the retention
observability counters.

Treat this as the first document to open when:

- The Health page in PlatformView shows a red `Audit chain integrity broken` banner (or the live `audit:chain:broken` socket toast pops)
- The Health page shows the amber `Audit chain has not been verified in over 25 hours` banner
- The Health page shows `GDPR purge failed` / `GDPR purge overdue` banners
- The chain-broken webhook fired (configured in `partner.webhooks`)
- A tenant admin reports the partner verify button erroring out
- An auditor asks for chain-integrity attestation evidence
- The audit drawer renders empty for tickets that should have lifecycle rows

---

## 1. System components

| Component | File | Purpose |
|---|---|---|
| WORM audit archive | `server/services/archive.ts` | Immutable copy of `audit_log` with a SHA-256 hash chain. |
| Chain verify service | `server/services/archive.ts::verifyAuditChain` | Recomputes the full chain and returns `{ valid, checked, brokenAt, ... }`. |
| Shared verify runner | `server/services/chainVerifySchedule.ts::runChainVerify` | Persists results to `system_settings`, broadcasts the chain-broken webhook, and emits the `audit:chain:broken` socket event to the platform-operators room on critical breaks. Used by both the operator button and the daily scheduler. |
| Daily scheduler | `server/services/chainVerifySchedule.ts::scheduleDailyChainVerify` | Armed at boot with a 10–40m startup jitter, then a 24h interval. Uses synthetic actor `system-scheduler`. |
| Platform verify UI | `client/src/components/admin/PlatformSystemHealth.tsx` | "Verify chain" button + staleness banner + run history table + CSV export. |
| Partner verify UI | `client/src/components/admin/PartnerAuditVerify.tsx` | Per-tenant verify button — returns the partner-scoped slice only. |
| Ticket lifecycle module | `server/services/ticketLifecycle/` | Owns every state transition that produces an audit row. Emits ticket.created / closed / assigned / transferred / returned_to_queue / reopened / **left / reclaimed**. The audit insert runs INSIDE the lifecycle transaction — a DB failure rolls back the whole event. |
| GDPR purge | `server/services/gdpr.ts::runDailyPurge` | Daily retention enforcement. Refuses to run if the chain fails to verify; surfaces last-run + outcome via the Health page. |

---

## 2. Scheduled vs manual verify

Both paths go through the same `runChainVerify` runner, so records in
`system_settings.audit_chain_last_verify` and `audit_chain_verify_history` are
identical in shape regardless of origin. The only difference is the actor
identity:

| Origin | `ranBy` | `ranByName` | `metadata.scheduled` |
|---|---|---|---|
| Platform operator clicks "Verify" | Their user id | Their display name | `false` |
| Daily scheduler tick | `system-scheduler` | `Daily scheduler` | `true` |
| Partner admin clicks "Verify chain" | Their user id | Their display name | n/a (partner record only) |

The verify-history UI (System Health → Run History) stamps a `Scheduled` badge
on scheduler rows so operators can distinguish the two at a glance.

### Why the scheduler exists

Chain integrity is cheap to verify and expensive to forget. Without a daily
run, a tamper that happened in week 1 could sit undetected for months until
someone clicks the button. The scheduler turns chain verification into a
liveness signal: a critical break flips the `chainBroken` flag on the
in-app Health page and pushes `audit:chain:broken` to the operator room
within 24h of the event, not whenever someone happened to visit System Health.

The 10–40 minute startup jitter prevents stampedes when a cluster of
servers restarts simultaneously (e.g. after a deploy).

---

## 3. Webhook payload on chain break

`broadcastWebhook('audit.chain_broken', ...)` fires when
`verifyAuditChain` returns `valid=false` with a non-null `brokenAt` AND the
break was not categorised as a service-level error (i.e. it's a real tamper,
not a db timeout).

Payload shape (`audit.chain_broken`):

```json
{
  "brokenAt": "<audit_archive.id or null>",
  "ranBy": "<user id or 'system-scheduler'>",
  "ranAt": "<ISO timestamp>",
  "severity": "critical"
}
```

The same code path also pushes the `audit:chain:broken` socket event to
the `platform:operators` room — the Health page in PlatformView lights up
instantly without waiting for the next 5-minute poll.

Service-level errors (severity=warn) DO NOT broadcast or push — those are
infra alarms for the operator, not compliance signals for the tenant.

---

## 4. Response playbook — chain tamper detected

Triggered by: red `Audit chain integrity broken` banner on the Health page,
the `audit:chain:broken` socket toast, OR a `critical` row in the verify
history with `brokenAt` set.

1. **Freeze new writes to the archive.** Set the archive service to
   read-only by pausing the archiver cron if running. This prevents the
   tamper investigation from racing against new row hashes.
2. **Snapshot `audit_archive`.** `pg_dump` the table to a compressed file
   stored out-of-band (S3 / blob storage with WORM lock if available). This
   is the evidence chain of custody — do this before running any more
   verify attempts.
3. **Identify which row.** Query `audit_archive` at `brokenAt`. Log the
   `action`, `actorId`, `partnerId`, `createdAt`. Cross-reference to
   `audit_log` for the same action+time to see if the pre-archive row is
   consistent.
4. **Check for `system.chain_broken_detected` rows.** The runner writes an
   audit entry when it detects a break — the `metadata` field carries the
   `brokenAt` id and whether the detection was scheduler-originated.
5. **Determine the blast radius.** If only one row is corrupt, it's most
   likely a bit-flip or a bad migration. If many consecutive rows fail,
   assume a deliberate rewrite and escalate to security.
6. **Do not delete rows.** The WORM table is evidence. Corruption does not
   authorise deletion.
7. **After investigation, decide on chain repair.** Options are
   (a) accept the break and rebuild the chain from `brokenAt + 1`,
   recording the gap in a compliance log, or (b) restore from backup.
   Both require a signed-off incident report.

---

## 5. Response playbook — verify service error

Triggered by: a verify history row with `error` set (severity=warn) — the
Health page chain panel shows status `ERROR` and the run history table
records the wrapped reason.

This means the verify itself couldn't run — a db read timeout, a Redis
outage blocking the rate limiter, or the archive store being unreachable.
It is NOT a tamper signal.

1. Check `[chainVerify]` logs for the wrapped error message.
2. Check db / Redis / storage health for the same window.
3. Fix the infra problem.
4. Manually re-run verify via System Health to clear the staleness banner.
5. Confirm the scheduler resumed normal ticks (one success entry per 24h).

The GDPR purge will also refuse to run while verify is erroring out — fix
this first, then re-run the purge.

---

## 6. Response playbook — ticket emitter silenced

Triggered by: an unexplained gap in `audit_log` rows for `ticket.*` actions
during a window with normal ticket traffic. (No active alert fires for this
condition after the Prometheus removal — review when investigating other
tamper / staleness signals.)

The ticket lifecycle counter went from nonzero to zero without a
corresponding drop in ticket traffic. Likely causes:

1. A recent deploy broke the lifecycle factory wiring in `server/app.ts`
   (`createTicketLifecycle({ db })`) or stopped passing `lifecycle` into
   `HandlerContext` — the socket handlers would still respond but no
   verb would actually run.
2. `tx.insert(auditLog)` is failing inside the lifecycle transaction. Unlike
   the pre-deepening emitter (which was fire-and-forget), this aborts the
   whole transition — search logs for transaction-rollback errors and for
   the lifecycle's own thrown errors. The mutation will also have rolled
   back, so user-facing operations are visibly failing too.
3. The boot-time reclaim sweep in `server/services/ticketReclaim.ts` is the
   only background path that bumps the counter without a live event — if
   the sweep is disabled (`RECLAIM_TIMEOUT_MINS=0`) and live traffic is low,
   a quiet window is expected.

Confirmation: open any admin ticket audit drawer. If rows are missing for
tickets created in the silent window, the lifecycle wiring is the root
cause. Re-deploy with the fix; the counter should resume ticking within
the next create/close/assign/transfer/leave/reclaim action.

---

## 7. Response playbook — GDPR purge not running

Triggered by: amber `GDPR purge overdue` banner on the Health page (last
`system.gdpr_purge` audit row >25h ago) or red `GDPR purge failed` banner.

### GDPR purge overdue (no recent run)

1. Check `[purge]` logs for the last arming message (`Purge scheduled with
   jitter`) — this logs on every boot.
2. If the scheduler never armed, the server likely crashed during boot
   before reaching `runDailyPurge` registration.
3. If the scheduler armed but never fired, the server process was killed
   before the 24h timer could tick — check for OOM / crash loop.
4. Once the server is stable, the scheduler will arm on next boot. To
   catch up, manually trigger the purge via the platform admin tools
   (`trpc.platform.runPurge`).

### GDPR purge aborted by chain failure

If the most recent `[purge]` log entry shows `AUDIT_CHAIN_VERIFY_FAIL_MSG`,
the chain was broken AND the purge has refused to run as a precaution.

1. Fix the chain first (section 4 or 5).
2. Manually re-run the purge after chain is verified.
3. Do NOT disable the chain-verify gate in the purge. That guard exists
   because a broken chain means we cannot prove what we're deleting —
   purging against an unverified chain is a compliance violation even if
   the data itself is fine.

---

## 8. Retention windows

| Data | Retention | Defined in |
|---|---|---|
| `audit_log` (live) | Rolled into `audit_archive` after `AUDIT_ARCHIVE_DELAY_DAYS` (default 2d) | `server/services/archive.ts` |
| `audit_archive` (WORM) | Indefinite — evidence, never purged | `server/services/archive.ts` |
| `tickets` (open/pending) | Never purged while live | `server/services/gdpr.ts` (skipped) |
| `tickets` (closed) + `messages` | `GDPR_RETENTION_DAYS` (default 30d) | `server/services/gdpr.ts` |
| `ai_usage_log` | `GDPR_RETENTION_DAYS` (rolled up to `daily_ai_usage` first) | `server/services/gdpr.ts` |
| `rating.comment` | `RATING_COMMENT_RETENTION_DAYS` (default 30d) — nullified, row kept | `server/services/gdpr.ts` |
| Abandoned invites | 7d from creation | `server/services/gdpr.ts::purgeAbandonedInvites` |
| Chain verify history | Last 50 runs | `server/services/chainVerifySchedule.ts` |
| Agent status log | 30d (rolled up to `daily_agent_status`) | `CLAUDE.md` retention notes |

---

## 9. Test coverage — what locks these invariants

| Invariant | Test file |
|---|---|
| Shared runner persistence shape (latest + history) | `server/services/__tests__/chainVerifySchedule.test.ts` |
| Scheduler uses synthetic actor and marks `metadata.scheduled=true` | `server/services/__tests__/chainVerifySchedule.test.ts` |
| Partner verify passes partnerId; returns scoped slice; nulls brokenAt cross-tenant | `server/trpc/routers/__tests__/partnerVerifyChain.test.ts` |
| Partner verify rate limit is per-(partner+user) and fails open | `server/trpc/routers/__tests__/partnerVerifyChain.test.ts` |
| Ticket emitter increments metric before db.insert (ordering invariant) | `server/services/ticketLifecycle/audit.ts` (asserted indirectly by every lifecycle verb test — the metric tick is the first line of `writeAudit`) |
| Audit write rolls back the whole lifecycle event on FK violation | `server/services/ticketLifecycle/{reclaim,leave,returnToQueue,assign,transfer,close,create}.test.ts` (each suite has a "transactional rollback" boundary case) |
| `ticket.left` and `ticket.reclaimed` audit rows land for every leave / reclaim | `server/services/ticketLifecycle/{leave,reclaim}.test.ts` (audit-invariant assertion in the happy path + the "secondary leaves" case for `ticket.left`) |
| Audit drawer opens from TicketPreview and fires getForTicket | `testing/e2e/admin-ticket-audit-drawer.spec.ts` |

If any of these tests need to be weakened, assume the invariant itself is
being relaxed and cross-check this runbook before merging.
