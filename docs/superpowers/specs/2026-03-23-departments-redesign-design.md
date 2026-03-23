# Departments Redesign + Per-Department Reference Fields

**Date:** 2026-03-23
**Status:** Approved

---

## Overview

Two tightly coupled changes:

1. **AdminDepartments UI** — replace the bulk-save inline editor with a proper per-record table (inline edit, inline delete confirmation, member count)
2. **Per-department reference fields** — departments define 1–3 custom reference field labels; AgentView renders them dynamically; tickets store references as JSONB instead of fixed `ref1`/`ref2` columns

---

## Part 1: AdminDepartments UI

### Layout

```
┌─────────────────────────────────────────────────────────┐
│ DEPARTMENTS                        [+ Add Department]   │
│ Manage your organization structure                      │
├──────────────┬──────────────┬────────────────┬──────────┤
│ NAME         │ DESCRIPTION  │ REF FIELDS     │ MEMBERS  │
├──────────────┼──────────────┼────────────────┼──────────┤
│ Billing      │ Finance      │ Invoice No,    │ 4   ✎ 🗑 │
│              │              │ Customer ID    │          │
├──────────────┼──────────────┼────────────────┼──────────┤
│ [name input] │ [desc input] │ [field inputs] │ 4   ✓ ✕  │  ← edit mode
├──────────────┼──────────────┼────────────────┼──────────┤
│ Tech Support │ Hardware     │ Serial No      │ 2   ✎ 🗑 │
│  ↳ ⚠ 2 members will become generalists. [Confirm] [Cancel] │
└──────────────┴──────────────┴────────────────┴──────────┘
```

### Behaviour

- **One row in edit mode at a time** — clicking Edit on another row cancels unsaved edits on the current one
- **One row in delete-confirm state at a time**
- **Edit mode** expands the row to show:
  - Name input (required)
  - Description input (optional)
  - Reference fields section: 1–3 labelled text inputs, each with a `[✕]` remove button
  - `[+ Add Field]` button — disabled when 3 fields already exist
  - `[Save]` `[Cancel]` buttons
- **Delete confirmation strip** appears below the row showing member impact
- **Add Department** — appends a blank row at bottom, immediately in edit mode
- **Member count** — computed client-side from `memberships` already in the Zustand store: count how many memberships have a `departments` array that includes the department's `id`. Generalists (empty/null departments array) are not counted against any specific department.

### Save Behaviour

Calls `trpc.partner.updateDepartments` with the full updated department array (existing backend contract — no server router change needed).

Replace `window.location.reload()` with proper tRPC cache invalidation via `utils.partner.getManifest.invalidate()`.

---

## Part 2: Per-Department Reference Fields

### Department Data Model

Add `referenceFields` to each department object in the partner manifest JSONB:

```typescript
interface Department {
  id: string;           // immutable slug, generated on creation
  name: string;
  description?: string;
  referenceFields?: Array<{ label: string }>;  // 1–3 items, optional
}
```

Rules:
- Max 3 fields per department, enforced via Zod in `updateDepartments` mutation
- Label min length: 1 character
- Labels must be unique within a department
- Use label as React key (labels are unique within a department)
- A department with no `referenceFields` (or empty array) is valid — AgentView shows no reference inputs and ticket is created with `references: []`
- All defined reference fields are **mandatory** — the agent cannot submit a ticket without filling them all in

### Partner Schema Changes (`server/db/schema.ts`)

- Remove `ref1Label` (`ref_1_label`) column from `partners` table
- Remove `ref2Label` (`ref_2_label`) column from `partners` table

These are replaced by per-department `referenceFields`.

### Ticket Schema Changes (`server/db/schema.ts`)

- Remove `ref1` (`ref_1`) column from `tickets` table
- Remove `ref2` (`ref_2`) column from `tickets` table
- Add `references` JSONB column: `Array<{ label: string; value: string }>`

```typescript
references: jsonb('references').default([])
```

### Database Migration

Pre-checks before migration:
```sql
SELECT COUNT(*) FROM tickets WHERE ref_1 IS NOT NULL OR ref_2 IS NOT NULL;
SELECT COUNT(*) FROM partners WHERE ref_1_label != 'Reference 1' OR ref_2_label != 'Reference 2';
```
Confirm data is acceptable to lose (dev environment). Then run `drizzle-kit push`.

No down migration required.

### Socket Handler Changes (`server/socket/handlers.ts`)

**`TicketNewPayload` interface:**
```typescript
// Before
ref1?: string;
ref2?: string;

// After
references?: Array<{ label: string; value: string }>;
```

**Ticket creation:**
- Accept `references` array (default `[]` if not provided), store in `references` JSONB column
- Update INSERT statement: replace `ref_1`, `ref_2` params with `references` JSONB

**Ticket reopen logic:**
Currently reopens a closed ticket if `ref_1` or `ref_2` matches. Replace with JS-side exact match:

1. Fetch recent closed tickets for the partner (last 100, ordered by `created_at DESC`)
2. For each incoming reference `{ label, value }`, check if any closed ticket has a reference with the exact same `value` (string equality, not substring)
3. If a match is found, reopen that ticket

```typescript
const incomingValues = (references || []).map(r => r.value).filter(Boolean);
const match = recentClosed.find(t =>
  (t.references as Array<{label: string; value: string}> || [])
    .some(r => incomingValues.includes(r.value))
);
```

This avoids SQL LIKE substring issues. Use exact string comparison only.

### AgentView Changes (`client/src/views/AgentView.tsx`)

- Remove `ref1`, `ref2` state variables
- Remove `manifest.ref1Label`, `manifest.ref2Label` usage
- Add `references` state: `Array<{ label: string; value: string }>`
- **Initial state**: set `references` based on `manifest.departments[0]?.referenceFields` on mount (empty values, one per field)
- **On department change**: reset `references` to empty values matching the new department's `referenceFields` (or `[]` if none)
- **If department has no `referenceFields`**: no reference inputs rendered, `references` stays `[]`, ticket submits normally

```tsx
{selectedDept?.referenceFields?.map((field) => (
  <div key={field.label}>
    <label>{field.label} *</label>
    <input
      value={references.find(r => r.label === field.label)?.value || ''}
      onChange={e => updateReference(field.label, e.target.value)}
      required
    />
  </div>
))}
```

- `updateReference(label, value)` updates the matching entry in the `references` array by label
- On ticket creation: emit `references` array instead of `ref1`, `ref2`

### TypeScript Types (`client/src/types/index.ts`)

- Add `referenceFields?: Array<{ label: string }>` to `Department` interface
- Remove `ref1?: string` and `ref2?: string` from `Ticket` interface
- Add `references?: Array<{ label: string; value: string }>` to `Ticket` interface

### Ticket Display Changes

All places that display `ref1` / `ref2` on a ticket (SupportView, AdminView tickets/archive, ChatWindow if applicable) replace hardcoded fields with:

```tsx
{(ticket.references || []).map((ref) => (
  <div key={ref.label}>
    <span className="opacity-60 uppercase text-[9px] font-black tracking-widest">{ref.label}:</span>
    <span className="font-bold">{ref.value}</span>
  </div>
))}
```

### i18n Keys

New keys to add to `client/src/i18n.ts`:
- `ref_fields_label` — "Reference Fields"
- `add_ref_field` — "Add Field"
- `ref_field_placeholder` — "Field label (e.g. Invoice Number)"
- `max_ref_fields` — "Maximum 3 fields"

Keys to remove from `client/src/i18n.ts`:
- Any keys containing `ref1Label`, `ref2Label`, `reference_1`, `reference_2` (grep: `ref1\|ref2\|reference_1\|reference_2`)

---

## Files Changed

| File | Change |
|---|---|
| `client/src/components/admin/AdminDepartments.tsx` | Full rewrite — table UI, inline edit/delete, ref field config |
| `client/src/views/AgentView.tsx` | Dynamic reference fields, remove ref1/ref2 |
| `client/src/types/index.ts` | Update `Department` and `Ticket` interfaces |
| `server/db/schema.ts` | Remove ref1/ref2 from tickets; remove ref1Label/ref2Label from partners |
| `server/socket/handlers.ts` | Update ticket:new payload and reopen logic |
| `server/trpc/routers/partner.ts` | Add Zod validation for referenceFields (max 3, unique labels) |
| SupportView / AdminView ticket display files | Dynamic references loop |
| `client/src/i18n.ts` | Add ref field keys; remove ref1Label/ref2Label keys |

---

## Out of Scope

- Reference field types (number, date, select) — all plain text
- Reordering reference fields via drag-and-drop
- Migrating existing ref1/ref2 ticket data
- Making individual reference fields optional (all defined fields are required)

---

## Acceptance Criteria

- [ ] Department table renders with Name, Description, Ref Fields, Members columns
- [ ] Member count computed from Zustand memberships store
- [ ] Inline edit works: one row at a time, Save/Cancel
- [ ] Reference fields configurable per department (1–3)
- [ ] Labels must be unique within a department (validated)
- [ ] `[+ Add Field]` disabled at 3 fields
- [ ] Delete shows inline confirmation with member count
- [ ] `window.location.reload()` replaced with cache invalidation
- [ ] AgentView renders dynamic reference inputs on department select
- [ ] Switching departments resets reference values
- [ ] Department with no reference fields submits ticket with `references: []`
- [ ] All defined reference fields are required before submit
- [ ] Ticket creation emits `references` array
- [ ] `ref1`/`ref2` columns removed from tickets schema and DB
- [ ] `ref1Label`/`ref2Label` columns removed from partners schema and DB
- [ ] `Department` and `Ticket` TypeScript interfaces updated
- [ ] Ticket display shows dynamic references loop
- [ ] Reopen logic uses JS-side exact-value matching
- [ ] No TypeScript errors
- [ ] No B&W violations
