# Agent Status Visibility — Design Spec

## Overview

Make agent presence statuses (Available, Break, Lunch, Meeting, Training/Focus) visible to team leads, admins, and fellow agents in real-time. Add time-in-status tracking for accountability and capacity planning.

## Decisions

- **Informational only** — statuses do not affect ticket routing
- **Persist in Redis** — status survives page refresh, clears on disconnect timeout
- **Architecture: Redis + Daily Rollup** — Redis for real-time, DB for historical stats
- **Visibility: Self + Admin** — agents see own stats, admins see everyone's
- **UI touchpoints**: QueueSidebar, AdminTeam, AdminStats, Capacity badge

## Status Values

| Status | Color Token | Hex (dark) |
|---|---|---|
| Available | `accent-green` | #22c55e |
| Break | `accent-amber` | #f59e0b |
| Lunch | `accent-orange` | #f97316 |
| Meeting | `accent-red` | #ef4444 |
| Training | `accent-blue` | #3b82f6 |

Color tokens `accent-amber` and `accent-orange` were added to `index.css` (light, dark, monochrome-light, monochrome-dark modes).

## Data Model

### Redis (real-time)

Extend existing presence hash (`presence:{partnerId}:{userId}`):

- `status` — already exists, currently unused. Values: `available`, `break`, `lunch`, `meeting`, `training`
- `statusChangedAt` — new field. ISO timestamp of last status change.

### New Table: `agent_status_log`

Granular status transition events.

| Column | Type | Purpose |
|---|---|---|
| `id` | serial PK | Row ID |
| `userId` | UUID FK → users | Agent |
| `partnerId` | UUID FK → partners | Multi-tenancy |
| `status` | text | Status value |
| `startedAt` | timestamp | When this status began |
| `endedAt` | timestamp (nullable) | When it ended (null = current) |
| `duration` | integer (nullable) | Seconds (computed on end) |

### New Table: `daily_agent_status`

Pre-aggregated daily rollup for fast stats queries.

| Column | Type | Purpose |
|---|---|---|
| `date` | date | Day (composite PK with userId + partnerId) |
| `userId` | UUID FK → users | Agent |
| `partnerId` | UUID FK → partners | Multi-tenancy |
| `availableSeconds` | integer | Total seconds in Available |
| `breakSeconds` | integer | Total in Break |
| `lunchSeconds` | integer | Total in Lunch |
| `meetingSeconds` | integer | Total in Meeting |
| `trainingSeconds` | integer | Total in Training |

## Server-Side

### Socket Handler — `support:status`

New listener in `handlers.ts`:

1. Agent emits `support:status` with `{ status }` — userId taken from `socket.data` (never client-supplied)
2. Calls `presenceService.setUserStatus()` — updates Redis hash with new status + `statusChangedAt`
3. Calls `statusService.logTransition()`:
   - Closes previous `agent_status_log` row (sets `endedAt`, computes `duration`)
   - Inserts new row with `startedAt = now`
4. Triggers `broadcastOnlineSupport()` to partner room (existing function, payload already includes `status`)

### Disconnect

Extend existing disconnect handler:

1. Close current `agent_status_log` row (`endedAt = now`, compute duration)
2. Existing `decrementUserCount()` handles Redis cleanup

### Reconnect (socket:identify)

1. Read persisted status from Redis (if hash still alive within 24h TTL)
2. Emit `status:restored` back to client with the persisted status value
3. Open new `agent_status_log` row with the restored status
4. If Redis expired, default to `available`

### Daily Rollup

New function (follows `daily_ai_usage` pattern):

- Triggered on schedule (midnight) or on-demand
- Aggregates completed `agent_status_log` rows per user/partner/day into `daily_agent_status`
- Handles midnight boundary: splits rows that span midnight into two day portions

### tRPC Endpoints — new `status` router

| Procedure | Access | Source | Returns |
|---|---|---|---|
| `status.getTeamStatus` | admin, support | Redis | Current online statuses for a partner |
| `status.getAgentStats` | self + admin | DB | Daily time-in-status for one agent |
| `status.getTeamStats` | admin only | DB | Daily time-in-status for all agents in a partner |

## Client-Side

### StatusPicker.tsx

- On mount, listen for `status:restored` event to restore persisted status instead of defaulting to "available"
- Existing `support:status` emit already works; server handler is the missing piece

### QueueSidebar.tsx

- `support:online` payload already includes `status` — render colored dot + status label next to each agent
- Add "Team Capacity" summary at bottom: count of Available vs total online

### AdminTeam.tsx

- Subscribe to `support:online` socket event for live statuses
- Add status column: colored dot + label for online agents, "Offline" with muted dot for disconnected
- Merge real-time socket data with existing tRPC member list

### AdminStats.tsx (new section or component)

- Stacked bar chart per agent showing time-in-status breakdown (Recharts)
- Date picker for day range selection
- Calls `status.getTeamStats` tRPC endpoint
- Agents see their own stats via `status.getAgentStats` in SupportView

### Capacity Badge (new component)

- Small indicator in SupportNav / AdminNav
- Reads from `support:online` data
- Shows "X / Y Available" count

### Types

Extend `OnlineSupport` interface — type `status` as union:

```typescript
status: 'available' | 'break' | 'lunch' | 'meeting' | 'training'
```

### i18n

Status labels already exist: `status_available`, `status_break`, `status_lunch`, `status_meeting`, `status_training`.

## Edge Cases

- **Multiple tabs**: Status is per-user, not per-socket. Redis stores one status per user. All tabs reflect the same value.
- **Server restart**: Redis persists (24h TTL). `agent_status_log` has the last known row. On reconnect, restored from Redis or defaults to "available."
- **Midnight boundary**: Rollup closes the day's portion of a spanning row and opens a new row for the next day.
- **Rapid switching**: All transitions logged. No debounce — these are intentional user actions.

## GDPR

- `agent_status_log`: Purged by existing GDPR service (30-day retention)
- `daily_agent_status`: On user deletion, rows anonymized (null userId) rather than deleted, preserving team-level capacity data
- All queries filter by `partnerId` (multi-tenancy enforced)

## Platform Operators

Can view any partner's team status via existing `enter-partner` flow. No special handling needed.
