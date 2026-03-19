# Multi-Partner Team Management & Platform Enhancements

**Date:** 2026-03-20
**Status:** Draft

## Overview

Extend Tessera to support multi-partner user assignment, partner lifecycle management (active/inactive), enhanced department schema, and improved platform operator tooling. Partner admins gain the ability to manage their team directly — adding existing users and inviting external users — while platform operators get better operational visibility through system health monitoring and audit logging.

## 1. Department Schema Change

### Current
`partners.departments` JSONB: `[{ id, label }]`
`memberships.dept`: single string

### Proposed
`partners.departments` JSONB:
```json
[
  {
    "id": "digital-service-center",
    "name": "Digital Service Center",
    "description": "First-line digital support for consumer broadband and TV"
  },
  {
    "id": "sales",
    "name": "Sales",
    "description": "New customer acquisition"
  }
]
```

- `id` — auto-generated slug from `name`, **immutable once created** (even if `name` is later renamed, `id` stays the same — tickets and membership assignments reference `id`)
- `name` — display name, typed by admin, shown in UI
- `description` — optional, explains department purpose

`memberships.dept` (text) → `memberships.departments` (JSONB array of department IDs):
- `["sales", "billing"]` → user sees only those departments
- `[]` or `null` → generalist, sees all departments

### Where department name appears

| Context | Shows |
|---|---|
| SupportView sidebar chips | `name` |
| Ticket badges | `name` |
| Admin Departments tab | `name` + `description` |
| Admin Team tab | `name` for assignment |

### Admin Departments Tab Changes
- Input fields become: Name (required) + Description (optional)
- `id` is auto-generated (slugified from name) at creation time only — displayed as read-only after creation
- Rename `label` to `name` throughout codebase
- Remove existing `.toUpperCase()` on id — slugs are lowercase

### Ticket Department Assignment
Tickets retain a single `dept` field (unchanged). When an agent creates a ticket, they pick one department. Support users with multiple assigned departments see tickets from all their assigned departments in the sidebar — the multi-department assignment is a **visibility filter**, not a ticket-level change.

## 2. Partner Status (Active / Inactive)

### Schema
New `status` field on `partners` table: `'active' | 'inactive'` (default: `'active'`).
Kept separate from existing `deletedAt` soft-delete.

### Behavior

| State | Behavior |
|---|---|
| Active | Normal operation |
| Inactive | No logins to that partner, no new tickets, open tickets auto-closed |

### Enforcement Points
The inactive status must be enforced at multiple layers:
1. **Login** (`server/routes/auth.ts`): Filter out memberships for inactive partners from the response. If all memberships are inactive, login succeeds but user sees "Partner inactive" state.
2. **Switch-partner** (`server/routes/auth.ts`): Reject switches to inactive partners with clear error message.
3. **Socket — ticket creation** (`server/socket/handlers.ts`): Reject `ticket:new` events for inactive partners.
4. **tRPC middleware**: Partner router procedures should validate `partner.status === 'active'` before mutations (reads allowed for historical data).

### When a partner is deactivated:
1. All open tickets for that partner are auto-closed
2. Server emits `partner:deactivated` socket event to all connected clients on that partner — clients immediately show PartnerUnavailable screen and disconnect active chat sessions gracefully
3. GDPR purge handles data cleanup after 30 days (existing service)
4. Users with multiple partners can switch to another via PartnerSwitcher
5. Users whose only partner is inactive see: "Partner is currently inactive. Contact your administrator."
6. Platform operator can reactivate at any time

### Reactivation:
- Sets status back to `active`
- Users can log in again
- Existing data (config, departments, memberships) preserved
- No tickets are restored (already closed + potentially purged)

## 3. AdminView → Team Tab

New tab in AdminView for partner-level user management.

### Member Table
Columns: Name, Email, Role, Departments, Actions (edit departments, remove)

### Two Actions

**Add Existing User (internal)**
- Modal with email input + role select (agent or support) + department multi-select
- Looks up user by email — user must already exist in the system
- Admin explicitly picks the role for this partner (agent or support)
- Admin picks which departments to assign
- Membership created instantly, no approval flow
- Errors: "User not found", "User already on this partner"

**Invite External User (new)**
- Modal with: email, name, role (agent or support radio), department multi-select
- Creates new user in `users` table with temporary password (displayed once to admin, who communicates it to the user)
- Creates membership for this partner
- Azure SSO: `externalId` links on first Azure login
- Errors: "Email already in use"

### Guardrails
- Partner admins can only assign `agent` or `support` roles (not admin, manager, or platform_operator)
- Cannot remove yourself from the partner
- Cannot remove a user's last membership (platform operator must handle that via PlatformView)
- Email uniqueness enforced at user creation

## 4. Server: New tRPC Procedures

### Partner Router (admin access)

| Procedure | Input | Behavior |
|---|---|---|
| `partner.listMembers` | `{ limit?, offset? }` (uses ctx.partnerId) | Returns paginated memberships for this partner joined with user data |
| `partner.addMemberByEmail` | `{ email, role, departments? }` | Lookup existing user by email. Validate not already a member. Role must be agent or support. Create new membership. |
| `partner.inviteExternalUser` | `{ email, name, role, departments? }` | Create new user (temp password) + membership. Role limited to agent/support. Returns temp password for admin to share. |
| `partner.removeMember` | `{ membershipId }` | Delete membership. Cannot remove self. Cannot remove user's last membership. |
| `partner.updateMember` | `{ membershipId, departments? }` | Update department assignment for this partner. |

### Platform Router (platform_operator access)

| Procedure | Input | Behavior |
|---|---|---|
| `platform.deactivatePartner` | `{ partnerId }` | Set status to inactive. Auto-close all open tickets. Emit `partner:deactivated` socket event. Write audit log entry. |
| `platform.reactivatePartner` | `{ partnerId }` | Set status back to active. Write audit log entry. |
| `platform.getAuditLog` | `{ action?, partnerId?, actorId?, search?, limit, offset }` | Paginated audit log with filters. |
| `platform.getSystemHealth` | — | Enhanced: Postgres, Redis status + GDPR last run info. |

## 5. SupportView Sidebar Changes

### Department Chip Filtering
- Chips filtered to show only the user's assigned departments (from their membership)
- `[All]` button always shown as first chip — shows tickets from all assigned departments
- Unassigned users (generalist: `departments` is `[]` or `null`) see all partner departments
- Chips show department `name`
- Horizontal scroll for overflow (existing `overflow-x-auto`)

## 6. PlatformView Enhancements

### Nav Bar
- Remove Postgres/Redis health dots from nav (moved to System tab)
- Clean nav: branding, role badge, dark mode toggle, sign out

### Partners Tab — Active/Inactive Split

**Active Partners** (top):
- Current partner cards
- Buttons: Configure, Enter, Deactivate
- "Deactivate" replaces current "Delete Partner" button

**Inactive Partners** (bottom, collapsible):
- Same cards but visually muted (opacity-40)
- Buttons: Reactivate, Delete Permanently
- No "Enter" button
- "Delete Permanently" requires typing partner name to confirm (hard delete)

### Users Tab — Enhanced
- Add column: "Partners" — shows which partners each user belongs to
- Existing functionality unchanged (invite, delete)

### System Tab (new)

**Services section:**
- Postgres: connection status, active connections
- Redis: connection status, memory usage
- Grafana: external link (opens in new tab)
- Prometheus: external link (opens in new tab)

**Alerts section:**
- Actionable alerts needing attention
- Dismissable
- Examples: "Redis memory above 80%", "3 users have no partner assigned", "GDPR purge failed"

**GDPR section:**
- Retention period (30 days)
- Last purge: timestamp + success/failure
- Records purged: ticket + message count
- Next purge: scheduled timestamp

### Audit Log Tab (new)

**Filters:**
- Action type dropdown (all actions, user management, partner management, system)
- Partner dropdown
- User dropdown
- Search text

**Log entries:**
- Timestamp, Actor (user or "System"), Action description
- Paginated with "Load more"
- Includes: partner activations/deactivations, user additions/removals, GDPR purges, membership changes, external user invitations, partner config changes

## 7. Audit Log Table Schema

```sql
CREATE TABLE audit_log (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  action        TEXT NOT NULL,          -- e.g. 'partner.deactivated', 'member.added', 'gdpr.purge'
  actor_id      UUID REFERENCES users(id),  -- NULL for system actions
  partner_id    TEXT REFERENCES partners(id),  -- NULL for global actions
  target_type   TEXT,                   -- e.g. 'user', 'partner', 'ticket'
  target_id     TEXT,                   -- ID of the affected entity
  metadata      JSONB DEFAULT '{}',     -- additional context (e.g. { role: 'support', departments: ['sales'] })
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_audit_log_partner_created ON audit_log (partner_id, created_at DESC);
CREATE INDEX idx_audit_log_actor_created ON audit_log (actor_id, created_at DESC);
CREATE INDEX idx_audit_log_action ON audit_log (action);
```

### Action Types

| Action | Actor | Description |
|---|---|---|
| `partner.deactivated` | Platform operator | Partner set to inactive |
| `partner.reactivated` | Platform operator | Partner set to active |
| `partner.deleted` | Platform operator | Partner permanently deleted |
| `partner.config_updated` | Admin | Partner configuration changed |
| `member.added` | Admin | Existing user added to partner |
| `member.invited` | Admin | External user invited to partner |
| `member.removed` | Admin | Membership removed |
| `member.updated` | Admin | Department assignment changed |
| `gdpr.purge` | System | Daily GDPR purge completed |
| `tickets.auto_closed` | System | Tickets closed due to partner deactivation |

## 8. PartnerUnavailable Guards (already implemented)

Shared `PartnerUnavailable` component handles three states:
- **Deleted partner**: "Partner no longer exists" — platform operators get "Back to Platform", regular users get "Sign Out"
- **Inactive partner**: "Partner is currently inactive" — multi-partner users get PartnerSwitcher to switch to another partner, single-partner users get "Contact your administrator" + "Sign Out"

## 9. Existing Infrastructure (no changes needed)

- `memberships` junction table already supports multi-partner
- `/switch-partner` endpoint already issues new JWT (needs inactive check added)
- `PartnerSwitcher` component already renders for users with 2+ memberships
- GDPR daily purge service continues unchanged
- `PartnerUnavailable` guards already in place

## 10. Migration Notes

### Schema migrations
- `partners.departments` JSONB: rename `label` → `name`, add optional `description` field, generate lowercase slug `id` from existing uppercase `id` values
- `memberships.dept` (text) → `memberships.departments` (JSONB array): migrate `"DSC"` → `["dsc"]`, `null` → `[]`
- `partners` table: add `status` column (`text NOT NULL DEFAULT 'active'`)
- New `audit_log` table (see Section 7)
- `tickets.dept`: migrate existing uppercase values to lowercase slugs to match new department IDs
- `daily_stats.dept_counts` JSONB keys: migrate uppercase keys to lowercase slugs
- `topic_alerts.dept`: migrate to lowercase slugs

### Code migrations
- `server/routes/auth.ts` switch-partner endpoint: migrate from raw SQL to Drizzle ORM for consistency and to pick up new column names
- `server/trpc/routers/partner.ts` updateDepartments: remove `.toUpperCase()`, accept `{ name, description }` instead of `{ id, label }`
- `client/src/types/index.ts`: unify `UserRole` type to include all five roles (`agent | support | manager | admin | platform_operator`)
- All references to `dept` (singular) in membership context → `departments` (array)
