# Audit & Compliance Runbook

Operational reference for the Guichet audit subsystem: the WORM archive, the
SHA-256 hash chain, the chain-verify scheduler, partner-scoped verify, the
ticket-lifecycle emitter, the webhook-backed alerting, and the retention
observability counters.

Treat this as the first document to open when:

- Prometheus fires `AuditChainTamperDetected`
- Prometheus fires `AuditChainVerifyServiceError`
- Prometheus fires `TicketAuditEmitterSilenced`
- Prometheus fires `GdprPurgeMissing` or `GdprPurgeChainAborted`
- A tenant admin reports the partner verify button erroring out
- An auditor asks for chain-integrity attestation evidence
- The audit drawer renders empty for tickets that should have lifecycle rows

---

## 1. System components

| Component | File | Purpose |
|---|---|---|
| WORM audit archive | `server/services/archive.ts` | Immutable copy of `audit_log` with a SHA-256 hash chain. |
| Chain verify service | `server/services/archive.ts::verifyAuditChain` | Recomputes the full chain and returns `{ valid, checked, brokenAt, ... }`. |
| Shared verify runner | `server/services/chainVerifySchedule.ts::runChainVerify` | Persists results to `system_settings`, broadcasts webhooks, increments metrics. Used by both the operator button and the daily scheduler. |
| Daily scheduler | `server/services/chainVerifySchedule.ts::scheduleDailyChainVerify` | Armed at boot with a 10–40m startup jitter, then a 24h interval. Uses synthetic actor `system-scheduler`. |
| Platform verify UI | `client/src/components/admin/PlatformSystemHealth.tsx` | "Verify chain" button + staleness banner + run history table + CSV export. |
| Partner verify UI | `client/src/components/admin/PartnerAuditVerify.tsx` | Per-tenant verify button — returns the partner-scoped slice only. |
| Ticket lifecycle emitter | `server/services/ticketAudit.ts` | Fire-and-forget audit writes for ticket.created/closed/assigned/transferred/returned_to_queue/reopened. Increments `guichet_ticket_audit_events_total` BEFORE the DB write. |
| GDPR purge | `server/services/gdpr.ts::runDailyPurge` | Daily retention enforcement. Emits `guichet_gdpr_purge_runs_total` and `guichet_gdpr_rows_purged_total`. Refuses to run if the chain fails to verify. |

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
liveness signal: if `guichet_audit_chain_verify_failures_total` ever
increments, we find out within 24h of the event, not whenever someone
happened to visit System Health.

The 10–40 minute startup jitter prevents stampedes when a cluster of
servers restarts simultaneously (e.g. after a deploy).

---

## 3. Partner-scoped verify semantics

`trpc.partner.audit.verifyChain` (file: `server/trpc/routers/partner/audit.ts`)
lets tenant admins verify the chain without exposing cross-tenant data.

### What the tenant sees

| Field | Meaning |
|---|---|
| `valid` | Global chain validity. If false, SOMETHING is wrong — but the tenant doesn't know what. |
| `partnerChecked` | How many of THIS tenant's rows were verified. |
| `brokenInScope` | Whether the broken row (if any) belongs to THIS tenant. |
| `brokenAt` | The row id ONLY when `brokenInScope=true`. Otherwise `null`. |
| `error` | Service-level error surfaced as an infra problem, not a silent pass. |

### Why the walk is always global

The hash chain is a single linked sequence across all tenants — truncating
the walk to one tenant's rows would break the hash relationship and falsely
report `valid=false`. So the walk is always global, but the RESPONSE is
sliced. The global `checked` count is intentionally not exposed.

### Why brokenAt is nulled out cross-tenant

Leaking another tenant's `audit_archive.id` in a partner-scoped response is
a cross-tenant disclosure — the id is the primary key to a row that
partner has no visibility into otherwise. If the break is outside the
caller's scope they see `valid=false`, `brokenInScope=false`, `brokenAt=null`.
That tells them "the platform is investigating" without disclosing whose
rows are affected.

### Rate limiting

Per-(partner+user) window: 1 call / 60s. Keyed by
`rate:verify-audit-chain:partner:<partnerId>:<userId>`. Fails OPEN on Redis
outage — a broken Redis must not lock a tenant out of their own compliance
check.

---

## 4. Webhook payload on chain break

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

The counter `guichet_audit_chain_verify_failures_total{severity="critical"}`
is incremented in the same path — so Prometheus and webhook subscribers both
see the event regardless of which external system is receiving the signal.

Service-level errors increment `{severity="warn"}` and DO NOT broadcast —
those are infra alarms for the operator, not compliance signals for the
tenant.

---

## 5. Response playbook — chain tamper detected

Triggered by: `AuditChainTamperDetected` Prometheus alert OR a `critical`
row in the verify history with `brokenAt` set.

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

## 6. Response playbook — verify service error

Triggered by: `AuditChainVerifyServiceError` Prometheus alert OR
`guichet_audit_chain_verify_failures_total{severity="warn"}` ticking.

This means the verify itself couldn't run — a db read timeout, a Redis
outage blocking the rate limiter, or the archive store being unreachable.
It is NOT a tamper signal.

1. Check `[chainVerify]` logs for the wrapped error message.
2. Check db / Redis / storage health for the same window.
3. Fix the infra problem.
4. Manually re-run verify via System Health to clear the staleness banner.
5. Confirm the scheduler resumed normal ticks (one success entry per 24h).

The GDPR purge will also refuse to run while verify is erroring out (see
`GdprPurgeChainAborted`) — fix this first, then re-run the purge.

---

## 7. Response playbook — ticket emitter silenced

Triggered by: `TicketAuditEmitterSilenced` Prometheus alert.

The ticket lifecycle counter went from nonzero to zero without a
corresponding drop in ticket traffic. Likely causes:

1. A recent deploy broke the call sites (ticket router, socket handler, or
   transfer service no longer invokes `auditTicket*()`).
2. `db.insert(auditLog)` is hard-failing in the fire-and-forget path —
   search logs for `[ticketAudit]` errors.
3. Only closed and transferred tickets are being created (e.g. during an
   off-hours batch import that bypasses the user-facing paths). Confirm by
   checking the live ticket table.

Confirmation: open any admin ticket audit drawer. If rows are missing for
tickets created in the silent window, the emitter wiring is the root
cause. Re-deploy with the fix; the counter should resume ticking within
the next create/close/transfer action.

---

## 8. Response playbook — GDPR purge not running

Triggered by: `GdprPurgeMissing` (48h of zero runs) or `GdprPurgeChainAborted`.

### GdprPurgeMissing

1. Check `[purge]` logs for the last arming message (`Purge scheduled with
   jitter`) — this logs on every boot.
2. If the scheduler never armed, the server likely crashed during boot
   before reaching `runDailyPurge` registration.
3. If the scheduler armed but never fired, the server process was killed
   before the 24h timer could tick — check for OOM / crash loop.
4. Once the server is stable, the scheduler will arm on next boot. To
   catch up, manually trigger the purge via the platform admin tools
   (`trpc.platform.runPurge`).

### GdprPurgeChainAborted

This is a compound alert — the chain is broken AND the purge has hit it.

1. Fix the chain first (section 5 or 6).
2. Manually re-run the purge after chain is verified.
3. Do NOT disable the chain-verify gate in the purge. That guard exists
   because a broken chain means we cannot prove what we're deleting —
   purging against an unverified chain is a compliance violation even if
   the data itself is fine.

---

## 9. Grafana panel glossary

Dashboard: `monitoring/grafana/dashboards/guichet.json`.

| Panel | Metric | What it tells you |
|---|---|---|
| Ticket Lifecycle Events/s | `guichet_ticket_audit_events_total` | Liveness of the audit emitter, split by action. Flatlines = broken wiring. |
| GDPR Purge Runs (24h) | `guichet_gdpr_purge_runs_total` | Did retention enforcement run today? Split by outcome (success / chain_aborted / error). |
| GDPR Rows Purged (24h) | `guichet_gdpr_rows_purged_total` | Rolling 24h row counts by scope. Zero on idle tenants is expected. |
| Chain verify failures | `guichet_audit_chain_verify_failures_total` | Split by severity. `critical` = tamper. `warn` = infra. |
| Webhook delivery outcome | `guichet_webhook_deliveries_total` | Split by event and status class. >25% 5xx/error = partner endpoint broken. |

---

## 10. Retention windows

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

## 11. Test coverage — what locks these invariants

| Invariant | Test file |
|---|---|
| Shared runner persistence shape (latest + history) | `server/services/__tests__/chainVerifySchedule.test.ts` |
| Scheduler uses synthetic actor and marks `metadata.scheduled=true` | `server/services/__tests__/chainVerifySchedule.test.ts` |
| Partner verify passes partnerId; returns scoped slice; nulls brokenAt cross-tenant | `server/trpc/routers/__tests__/partnerVerifyChain.test.ts` |
| Partner verify rate limit is per-(partner+user) and fails open | `server/trpc/routers/__tests__/partnerVerifyChain.test.ts` |
| Ticket emitter increments metric before db.insert (ordering invariant) | `server/services/__tests__/ticketAudit.test.ts` |
| Ticket emitter DB failure does not surface to caller | `server/services/__tests__/ticketAudit.test.ts` |
| Audit drawer opens from TicketPreview and fires getForTicket | `testing/e2e/admin-ticket-audit-drawer.spec.ts` |

If any of these tests need to be weakened, assume the invariant itself is
being relaxed and cross-check this runbook before merging.
