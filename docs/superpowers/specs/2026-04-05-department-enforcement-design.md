# Department Enforcement & AdminTeam Fixes

**Date**: 2026-04-05
**Status**: Approved
**Scope**: Remove implicit "generalist" concept, enforce department assignments for support role, fix AdminTeam stat card filters, protect manual memberships from SSO sync.

---

## Problem

1. **Agents show department assignments** — Agents select a department at ticket creation time; they don't belong to departments. Yet AdminTeam displays department badges for agents and allows editing them. (Already partially fixed in prior commit.)
2. **Generalist anti-pattern** — Support users with empty departments implicitly see all tickets. This is indistinguishable from "admin forgot to configure" and silently expands access when new departments are added.
3. **Stat card filters are broken** — "Support Staff" card uses text search (`ILIKE '%support%'`), which also matches agents whose name/email contains "support". "Currently Online" sends "online" as a search string, which doesn't filter by online status at all.
4. **SSO sync can delete manual memberships** — When an admin manually invites an external user, the SSO cleanup code revokes their membership on next login because they aren't in any mapped Azure groups.

## Decisions

- **Support users must have ≥1 department assigned.** No more implicit "empty = all."
- **Enforcement at the group mapping level** (primary) and modal level (secondary). SSO group mappings are the source of truth; manual invites are rare exceptions for external help.
- **Empty departments for support = empty queue**, not full access. Show "No departments assigned — contact your admin."
- **Stat cards use a dedicated `role` filter parameter**, not text search. Online filtering stays client-side.
- **Quick filter tags**: `Agent`, `Support`, `Admin`, `Unconfigured`. The `Unconfigured` tag finds support users with no departments.
- **Manual memberships are protected from SSO sync** via a `source` column on `memberships`.
- **"Select all / Deselect all" shortcut** in all department selection UIs (GroupMappingsPanel, AddExistingUserModal, InviteExternalUserModal).

---

## Design

### 1. Database: `memberships.source` column

Add a `source` column to the `memberships` table.

| Value | Meaning |
|-------|---------|
| `'sso'` | Created/managed by SSO group mapping sync (default) |
| `'manual'` | Created by admin via Invite External / Add Existing |

- Type: pgEnum `membership_source` (`'sso'`, `'manual'`)
- Default: `'sso'` (safe for existing data — system is SSO-first)
- Nullable: no

**Migration**: Generate via `drizzle-kit generate`, apply via `drizzle-kit push`.

### 2. Backend: `partner.ts` mutations

#### `listMembers`

Add optional `role` filter parameter:

```typescript
input: z.object({
  limit: z.number().min(1).max(100).default(50),
  offset: z.number().min(0).default(0),
  search: z.string().optional(),
  role: z.enum(['agent', 'support', 'admin']).optional(), // NEW
})
```

When `role` is provided, add `eq(memberships.role, input.role)` to filters (exact match, no ILIKE).

Update search SQL:
- Remove `Generalist` and `Global Agent` matching.
- Remove `grants`/`access` special case.
- Add `Unconfigured` matching: support users with `jsonb_array_length(departments) = 0`.

Also return `source` field in the select so the client can display a `MANUAL` badge.

#### `addMemberByEmail`

- Set `source: 'manual'`.
- Reject empty departments when `role === 'support'`: throw `BAD_REQUEST` with message "Support role requires at least one department".
- Agents always get `departments: []` (already done).

#### `inviteExternalUser`

- Set `source: 'manual'`.
- Same department validation as `addMemberByEmail`.

#### `updateMember`

- Reject empty departments when membership role is `support`: throw `BAD_REQUEST`.
- Agents always get `departments: []` (already done).

### 3. Backend: `ticket.ts` — department isolation

Current logic (line 58-66):
```typescript
// Empty/null departments = generalist (sees all)
if (depts.length > 0) {
  conditions.push(inArray(tickets.dept, depts));
}
```

New logic:
```typescript
// Empty departments = unconfigured (sees nothing)
if (depts.length > 0) {
  conditions.push(inArray(tickets.dept, depts));
} else {
  conditions.push(sql`1 = 0`); // No departments assigned — return nothing
}
```

Update comment to reflect new semantics.

### 4. SSO callback: `sso.ts`

#### Auto-created memberships
When inserting a new membership from group mapping sync:
- Set `source: 'sso'`.

#### Role sync
When updating role based on Azure groups:
- Only update memberships where `source = 'sso'`.

#### Cleanup/revocation
When removing memberships for users no longer in mapped Azure groups:
- Only delete memberships where `source = 'sso'`.
- Manual memberships are never touched by SSO sync.

#### Warning for empty departments
When a group mapping has `defaultDepartments: []` and `defaultRole: 'support'`:
- Log a warning: `[SSO] Support membership created with no departments — user will see empty queue`.
- Still create the membership (don't block login), but the user will see the "no departments" empty state.

### 5. Client: `AdminTeam.tsx`

#### Stat cards → proper role filters

Replace `handleQuickFilter(stat.filter)` with dedicated state:

```typescript
const [roleFilter, setRoleFilter] = useState<string>('');
```

Stat card behavior:
- **Total Members**: `setRoleFilter('')` — clears filter, shows all
- **Support Staff**: `setRoleFilter('support')` — exact role match via backend
- **Agents**: `setRoleFilter('agent')` — exact role match via backend
- **Currently Online**: sets a separate `onlineOnly` boolean state. The fetched `data` is filtered client-side via `data.filter(m => onlineStatusMap.has(m.userId))` before rendering. This filter composes with `roleFilter` — e.g. clicking "Support Staff" then "Currently Online" shows only online support users.

Pass `roleFilter` to `listMembers` query as the `role` parameter. `onlineOnly` is applied client-side after data is fetched.

Active stat card gets visual highlight based on `roleFilter`/`onlineOnly` state (not search string).

#### Quick filter tags

Tags: `Agent`, `Support`, `Admin`, `Unconfigured`.

- `Agent`, `Support`, `Admin`: set `roleFilter` directly (not search).
- `Unconfigured`: sets `search` to `"unconfigured"` — backend matches support users with empty departments.

Active tag highlight checks both `roleFilter` and `search`.

#### Inline department edit

When editing a support user's departments:
- Disable "Save" button when zero departments selected.
- Show hint text below checkboxes: "Support requires at least one department".

#### `MANUAL` badge

For memberships with `source === 'manual'`, show a small badge next to the role badge:
```
SUPPORT  MANUAL
```

Styled as: `text-[7px] border border-accent-amber/30 text-accent-amber px-1 font-mono font-bold tracking-tighter`.

### 6. Client: `AddExistingUserModal`

- When `role === 'support'`: require ≥1 department checked before submit button is enabled.
- Add "Select all / Deselect all" toggle button above department checkboxes.
- Disable submit button with visual indication when support + zero departments.

### 7. Client: `InviteExternalUserModal`

- Same enforcement as `AddExistingUserModal`.
- Same "Select all / Deselect all" toggle.

### 8. Client: `GroupMappingsPanel`

- When `defaultRole === 'support'`: require ≥1 department in `defaultDepartments` before save.
- Add "Select all / Deselect all" toggle button above department checkboxes.
- Disable save button with hint when support + zero departments.

### 9. Client: `QueueSidebar.tsx`

When support user has zero departments assigned (`assignedDepartmentIds.length === 0`):

- Replace ticket queue with centered empty state:
  - Icon: `Shield` (from lucide-react)
  - Heading: "No departments assigned"
  - Subtext: "Contact your administrator to configure department access."
- Hide department filter chips (nothing to filter).
- Archive tab and search tab show the same empty state.

### 10. Seed: `seed.ts`

- Already fixed: agents get `departments: []`.
- Add `source: 'sso'` to seeded memberships (default behavior).

---

## Files to modify

| File | Change |
|------|--------|
| `server/db/schema.ts` | Add `membershipSourceEnum`, add `source` column to `memberships` |
| `server/trpc/routers/partner.ts` | `listMembers`: add `role` param, update search SQL. Mutations: add `source`, enforce dept validation. |
| `server/trpc/routers/ticket.ts` | Empty depts = sees nothing for support |
| `server/routes/sso.ts` | Set `source: 'sso'`, skip manual memberships in sync/cleanup |
| `client/src/components/admin/AdminTeam.tsx` | Stat cards use `roleFilter`. Tags: Agent/Support/Admin/Unconfigured. Inline edit enforcement. MANUAL badge. |
| `client/src/components/platform/GroupMappingsPanel.tsx` | Require ≥1 dept for support. Select all toggle. |
| `client/src/components/support/QueueSidebar.tsx` | Empty dept empty state |
| `server/seed.ts` | Already done |

## Out of scope

- Migrating existing "generalist" support memberships to have all departments assigned. Existing users will see the "no departments" empty state, prompting admins to configure them.
- UI for bulk-assigning departments to unconfigured users.
- Enforcing departments for admin role (admins see all by design).
