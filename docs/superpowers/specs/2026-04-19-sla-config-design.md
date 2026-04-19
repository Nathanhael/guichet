# SLA Config — Design Spec

**Date:** 2026-04-19
**Scope:** Introduce real per-department SLA monitoring. Config lives in AdminView, breaches fire topic alerts, counter is business-hours aware.
**Status:** Draft — awaiting approval before implementation.

## Problem

CLAUDE.md and `.env.example` (pre-commit `976444f`) reference SLA infrastructure that does not exist:

- `server/services/sla.ts` — absent
- `SlaIndicator` component — absent
- `SLA_THRESHOLD_MS` env var — zero code references, pure ghost
- `AdminAlerts.tsx` — exists but implements **topic alerts** (incident clustering), not SLA config

Partners currently have no way to configure response-time expectations per department, and support staff have no visual indication when a ticket is approaching or breaching its SLA.

## Non-Goals

- Resolution-time SLA (ticket created → closed). First-response only in v1.
- Per-priority thresholds. SLA applies to all tickets in a department equally.
- SLA reporting dashboard / historical metrics. v1 is live enforcement only; reporting is a follow-up.
- Pausing SLA on "waiting for customer" status. Counter runs during business hours regardless of who's expected to reply.

## Solution

Per-department first-response-time SLA. Partner admins set a threshold (in minutes) per department in AdminView. A worker checks open tickets every 60s; breaches write to `topic_alerts` (reusing existing AdminAlerts UI). Counter pauses outside the partner's business hours.

## Scope Decisions (from brainstorming pass)

| decision | choice | rationale |
|---|---|---|
| metric | first response time (ticket created → first non-whisper staff message) | clearest, simplest, most impactful SLA for a live-chat product |
| breach behavior | write row to `topic_alerts` + `SlaIndicator` badge on ticket | reuses proven Alertmanager UX; no new notification channel |
| granularity | per-department | per-partner is too coarse; per-priority is over-engineered for v1 |
| business-hours | pause counter outside hours | prevents noise for overnight tickets; requires business hours config on partner |
| storage | JSONB inside `partners.departments[]` alongside `id` / `name` / `description` | avoids new table; already the pattern for per-dept config |

## Data Model

### `partners.departments` JSONB (extended)

```ts
type Department = {
  id: string;                    // existing
  name: string;                  // existing
  description?: string;          // existing
  sla?: {
    enabled: boolean;            // default: false — SLA off per dept until admin opts in
    firstResponseMinutes: number; // e.g. 15, 30, 60
    warnAtPercent: number;       // default: 75 — badge turns amber at 75% of threshold
  };
};
```

No migration needed — Drizzle JSONB column accepts the new optional field. Existing departments with no `sla` key = SLA disabled.

### New column: `tickets.first_staff_response_at`

Nullable `timestamptz`. Set once when the first non-whisper message from a non-agent (support/admin/platform-operator) is inserted. Drives:
- SLA worker queries ("tickets with `first_staff_response_at IS NULL` and `created_at` older than threshold")
- Future reporting
- Quick breach-check without walking the messages table

Backfill strategy: on migration, for each closed ticket, set to the earliest staff message timestamp. For open tickets, leave NULL and let new messages populate going forward.

### New table: `sla_breaches`

```sql
id           uuid primary key
ticket_id    uuid not null references tickets(id) on delete cascade
partner_id   uuid not null references partners(id)
department   text not null
breached_at  timestamptz not null
threshold_minutes int not null
resolved_at  timestamptz  -- set when first_staff_response_at is populated
```

Separate from `topic_alerts` because:
- ticket_id FK for drill-down
- deduplication per (ticket_id) — one breach row per ticket
- resolution tracking (when staff finally responded)

The topic-alert row is a **denormalized projection** that lets AdminAlerts show the breach alongside topic alerts. The `sla_breaches` table is the source of truth.

## Service Layer — `server/services/sla.ts`

### `computeSlaState(ticket, dept, schedule, now)`

Pure function. Given a ticket, its department config, the partner's business-hours schedule, and current time, returns:

```ts
type SlaState =
  | { status: 'disabled' }
  | { status: 'met'; respondedInMinutes: number }
  | { status: 'ok'; elapsedMinutes: number; remainingMinutes: number }
  | { status: 'warning'; elapsedMinutes: number; remainingMinutes: number }
  | { status: 'breached'; overdueMinutes: number };
```

Elapsed time is business-hours-adjusted: if the ticket was created Friday 17:00 and business hours end at 17:30, Friday night + weekend don't count. Reuses `businessHours.ts` time-math helpers.

### `runSlaSweep()`

Runs every 60s via a scheduled task (same pattern as `chainVerifySchedule.ts`). For each active partner:

1. Load partner's business hours schedule and department configs
2. If currently outside business hours for the partner timezone → skip
3. Query open tickets (`status IN ('open','pending')` AND `first_staff_response_at IS NULL`) for this partner
4. For each ticket, compute `computeSlaState`
5. If `breached` and no existing `sla_breaches` row → insert breach + emit `topic_alert` row + broadcast socket event `sla:breach`
6. Metric: `guichet_sla_breaches_total{partnerId,department}` counter

### `markFirstStaffResponse(ticketId, messageTimestamp, senderRole)`

Called from the message-send socket handler. If ticket's `first_staff_response_at` is NULL and sender role is NOT `agent` and message is not whisper/system, UPDATE the ticket. If an `sla_breaches` row exists, set `resolved_at`. Broadcast `sla:resolved` socket event so UI updates.

## tRPC Endpoints

### `partner.updateDepartmentSla` (admin only)

```ts
input: {
  partnerId: string,
  departmentId: string,
  sla: { enabled: boolean, firstResponseMinutes: number, warnAtPercent: number } | null
}
```

Validates `firstResponseMinutes ≥ 1 && ≤ 480` (8h max — use business hours for longer). Mutates the JSONB in place via a transaction (follow the same atomic-member-mutation pattern from commit `052cef1`). Audit-logs the change (`partner.department.sla_updated` action).

### `sla.getTicketState` (any authenticated)

```ts
input: { ticketId: string }
output: SlaState
```

Partner-scoped; used by `SlaIndicator` to fetch live state on ticket open or socket event.

### `sla.listBreaches` (admin only)

```ts
input: { partnerId: string, status: 'active' | 'resolved', limit, cursor }
output: { items: SlaBreach[], nextCursor }
```

For the breach log inside AdminAlerts.

## UI Components

### `AdminDepartments` (existing — modify)

Add "SLA" column to the dept table. Each row:
- Toggle: SLA enabled / disabled
- If enabled: number input for threshold minutes + warn % dropdown (50 / 75 / 90)
- Save commits via `partner.updateDepartmentSla`

### `SlaIndicator` (new — `client/src/components/SlaIndicator.tsx`)

Badge next to ticket title in ChatWindow header:
- `status: 'disabled'` → don't render
- `status: 'met'` → green dot + "Met"
- `status: 'ok'` → muted text "SLA: 8m left"
- `status: 'warning'` → amber text "SLA: 2m left"
- `status: 'breached'` → red text "SLA: 15m over" + red left-border on ticket row in QueueSidebar

Reads initial state from `sla.getTicketState`, subscribes to `sla:breach` + `sla:resolved` socket events for this ticket.

### `AdminAlerts` (existing — modify)

Add "SLA Breaches" tab next to "Topic Alerts". Lists rows from `sla.listBreaches`. Each row: ticket link, dept, breached-at timestamp, overdue minutes, resolved-at (or "Active").

## Socket Events

| event | payload | emitted by | consumed by |
|---|---|---|---|
| `sla:breach` | `{ ticketId, partnerId, department, overdueMinutes }` | `runSlaSweep` | SlaIndicator, QueueSidebar |
| `sla:resolved` | `{ ticketId, partnerId, respondedInMinutes }` | `markFirstStaffResponse` | SlaIndicator, QueueSidebar |

Partner-scoped (filtered via `partnerScope.ts`).

## Breach Worker Lifecycle

- Start: `server/app.ts` after DB connection, same pattern as `chainVerifySchedule`
- Interval: 60s (configurable via `SLA_SWEEP_INTERVAL_MS` env, default 60000 — this env var is **legitimately global** because it's a job scheduling knob, not a business rule)
- Shutdown: graceful on SIGTERM
- Error handling: log + metric increment + alert rule `SlaWorkerDown` (self-arming, fires if `guichet_sla_sweep_runs_total` is flat for 5m)

## Alert Rules (Prometheus / Alertmanager)

- `SlaBreachRateHigh` — >10 breaches per partner per hour for 30m
- `SlaWorkerDown` — `guichet_sla_sweep_runs_total` flat for 5m
- `SlaResolutionLag` — median `resolved_at - breached_at` exceeds 30m for 1h

## Metrics

- `guichet_sla_breaches_total{partnerId,department}` counter
- `guichet_sla_resolutions_total{partnerId,department}` counter
- `guichet_sla_sweep_runs_total` counter
- `guichet_sla_sweep_duration_seconds` histogram
- `guichet_sla_first_response_minutes{partnerId,department}` histogram (observed on resolution)

## Test Strategy

### Unit (`server/services/sla.test.ts`)

- `computeSlaState` table-driven tests: disabled, met, ok, warning, breached cases with various time offsets
- Business-hours math: ticket created Friday 17:29 with 30m SLA and 07:30–17:30 hours → breach fires Monday 08:00 (not Friday 17:59)
- Idempotency: `runSlaSweep` run twice in a row doesn't duplicate breach rows
- Multi-tenancy: sweep for partner A doesn't see partner B's tickets

### Integration (Playwright)

- Admin configures SLA → creates ticket → wait past threshold → breach appears in AdminAlerts + badge on ticket
- Staff replies → `first_staff_response_at` set → `resolved_at` set → socket event received → badge clears
- Admin disables SLA on dept → no new breaches recorded

### Load (k6)

- `testing/load/sla-sweep.js` — 100 partners × 50 open tickets each, verify sweep completes < 30s

## Rollout

1. Schema migration: add `tickets.first_staff_response_at` column (nullable, no default), create `sla_breaches` table. Backfill `first_staff_response_at` for closed tickets in the same migration.
2. Deploy backend with `SLA_SWEEP_INTERVAL_MS=0` (disabled) to verify migration.
3. Turn on worker (`SLA_SWEEP_INTERVAL_MS=60000`).
4. Ship UI (`SlaIndicator`, `AdminDepartments` extension, `AdminAlerts` tab).
5. Default all department SLAs to `enabled: false` — admins must opt in.

## Follow-Ups (Out of Scope for v1)

- Resolution-time SLA (second metric, same infra)
- Per-priority thresholds inside a department
- Historical SLA compliance report + export
- "Waiting for customer" pause logic
- SLA escalation (auto-transfer or notify supervisor on breach)

## Cleanup Tasks (Do Before Starting v1)

- Remove `SLA_THRESHOLD_MS` line from `.env.example` — the env ghost is misleading once real SLA ships with no such env var.
- Remove stale "Alerts & SLA: Per-department SLA config with `SlaIndicator` component" line from CLAUDE.md (current text describes infra that doesn't exist).
- The follow-up task chip "Migrate business hours + SLA to partner admin config" is now superseded — re-chip as **business hours only** (remove `BUSINESS_HOURS_START/END` env fallbacks, require schedule at partner creation).

## Open Questions

- [ ] Should agents see SLA state on their own tickets, or support/admin only?
- [ ] Should closing a ticket with no staff reply (agent abandoned) mark as breach or just "no response"?
- [ ] Timezone: partner business hours are `Europe/Brussels` by default — does SLA math use partner TZ or server TZ? (proposal: partner TZ)
- [ ] Should `SlaIndicator` appear in QueueSidebar too, or chat-header only?
