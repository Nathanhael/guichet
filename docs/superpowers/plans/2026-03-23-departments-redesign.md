# Departments Redesign + Per-Department Reference Fields Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the Departments admin page as a per-record table with inline edit/delete, and replace hardcoded `ref1`/`ref2` ticket fields with per-department configurable reference fields stored as JSONB.

**Architecture:** Department objects in the partner manifest JSONB gain a `referenceFields` array. The `tickets` table drops `ref_1`/`ref_2` columns and gains a `references` JSONB column. AdminDepartments is rewritten as a table. AgentView renders dynamic inputs. Socket handler and ticket display are updated throughout.

**Tech Stack:** React 19, Tailwind CSS 4, Zustand 5, tRPC, Drizzle ORM, PostgreSQL, Socket.io

---

## File Map

| File | Action |
|---|---|
| `client/src/types/index.ts` | MODIFY — update `Department` and `Ticket` interfaces |
| `server/db/schema.ts` | MODIFY — remove ref columns, add `references` JSONB |
| `server/socket/handlers.ts` | MODIFY — update `ticket:new` payload and reopen logic |
| `server/trpc/routers/partner.ts` | MODIFY — add Zod validation for `referenceFields` |
| `client/src/components/admin/AdminDepartments.tsx` | REWRITE — table UI with inline edit/delete |
| `client/src/views/AgentView.tsx` | MODIFY — dynamic reference field inputs |
| `client/src/i18n.ts` | MODIFY — add ref field keys, remove old ref keys |
| Ticket display files (SupportView, AdminView tickets/archive) | MODIFY — dynamic references loop |

---

## Task 1: Update TypeScript Interfaces

**Files:**
- Modify: `client/src/types/index.ts`

- [ ] **Step 1: Update Department interface**

Find the `Department` interface (or type) in `client/src/types/index.ts`. Add `referenceFields`:

```typescript
export interface Department {
  id: string;
  name: string;
  description?: string;
  referenceFields?: Array<{ label: string }>;
}
```

- [ ] **Step 2: Update Ticket interface**

Find the `Ticket` interface in `client/src/types/index.ts`. Remove `ref1` and `ref2`, add `references`:

```typescript
// Remove:
ref1?: string | null;
ref2?: string | null;

// Add:
references?: Array<{ label: string; value: string }>;
```

- [ ] **Step 3: Verify no TypeScript errors from type change**

```bash
docker compose exec client npm run build 2>&1 | grep -i "error" | head -20
```

Expected: errors will appear where `ref1`/`ref2` are used — these will be fixed in later tasks. Note them for reference.

- [ ] **Step 4: Commit**

```bash
git add client/src/types/index.ts
git commit -m "chore: update Department and Ticket TypeScript interfaces for dynamic refs"
```

---

## Task 2: Update Database Schema + Migrate

**Files:**
- Modify: `server/db/schema.ts`

- [ ] **Step 1: Pre-check existing data**

```bash
docker compose exec db psql -U user -d tessera -c "SELECT COUNT(*) FROM tickets WHERE ref_1 IS NOT NULL OR ref_2 IS NOT NULL;"
docker compose exec db psql -U user -d tessera -c "SELECT COUNT(*) FROM partners WHERE ref_1_label != 'Reference 1' OR ref_2_label != 'Reference 2';"
```

Expected: 0 rows in both (dev environment). Data loss is acceptable if non-zero.

- [ ] **Step 2: Update partners table in schema**

In `server/db/schema.ts`, find the `partners` table definition. Remove:
```typescript
ref1Label: text('ref_1_label').default('Reference 1'),
ref2Label: text('ref_2_label').default('Reference 2'),
```

- [ ] **Step 3: Update tickets table in schema**

In `server/db/schema.ts`, find the `tickets` table definition. Remove:
```typescript
ref1: text('ref_1'),
ref2: text('ref_2'),
```

Add after the `dept` field:
```typescript
references: jsonb('references').default([]),
```

- [ ] **Step 4: Apply migration**

```bash
docker compose exec server npx drizzle-kit push
```

Expected: `[✓] Changes applied`

- [ ] **Step 5: Commit**

```bash
git add server/db/schema.ts
git commit -m "chore: replace ref1/ref2 columns with references JSONB on tickets table"
```

---

## Task 3: Update Socket Handler

**Files:**
- Modify: `server/socket/handlers.ts`

- [ ] **Step 1: Update TicketNewPayload interface**

Find the `TicketNewPayload` interface in `server/socket/handlers.ts`. Replace `ref1`/`ref2` with `references`:

```typescript
// Before:
ref1?: string;
ref2?: string;

// After:
references?: Array<{ label: string; value: string }>;
```

- [ ] **Step 2: Update ticket creation INSERT**

Find the `ticket:new` handler. Replace the ticket object construction and INSERT:

```typescript
// Before:
const ticket: Ticket = { ..., ref1: ref1 || null, ref2: ref2 || null, ... };
await run('INSERT INTO tickets (..., ref_1, ref_2, ...) VALUES (..., $7, $8, ...)', [..., ticket.ref1, ticket.ref2, ...]);

// After:
const ticketReferences = data.references || [];
const ticket: Ticket = { ..., references: ticketReferences, ... };
await run('INSERT INTO tickets (..., references, ...) VALUES (..., $7::jsonb, ...)', [..., JSON.stringify(ticketReferences), ...]);
```

Adjust the parameter positions ($N) to match the actual INSERT statement. Remove `ref_1` and `ref_2` from the INSERT column list and values array.

- [ ] **Step 3: Update ticket reopen logic**

Find the block that checks for existing closed tickets to reopen (references `ref_1` / `ref_2`). Replace with JS-side exact-value matching:

```typescript
const incomingValues = (data.references || [])
  .map(r => r.value)
  .filter(Boolean);

let reopened = false;
let reopenCount = 0;

if (incomingValues.length > 0) {
  // Fetch recent closed tickets for this partner
  const recentClosed = await query(
    'SELECT id, reopen_count, references FROM tickets WHERE partner_id = $1 AND status = $2 ORDER BY created_at DESC LIMIT 100',
    [partnerId, 'closed']
  ) as Array<{ id: string; reopen_count: number; references: Array<{ label: string; value: string }> }>;

  // Note: raw SQL JSONB columns may be returned as strings by the query helper.
  // If t.references is a string, parse it first:
  // const refs = typeof t.references === 'string' ? JSON.parse(t.references) : (t.references || []);
  const match = recentClosed.find(t => {
    const refs = typeof t.references === 'string'
      ? JSON.parse(t.references)
      : (t.references || []);
    return refs.some((r: { label: string; value: string }) => incomingValues.includes(r.value));
  });

  if (match) {
    reopened = true;
    reopenCount = (match.reopen_count || 0) + 1;
    await run('UPDATE tickets SET status = $1, reopen_count = $2 WHERE id = $3', ['open', reopenCount, match.id]);
    // Emit reopen event if needed (follow existing pattern)
  }
}
```

- [ ] **Step 4: Verify server compiles**

```bash
docker compose exec server npx tsc --noEmit
```

Expected: no errors (or only errors from other files not yet updated).

- [ ] **Step 5: Commit**

```bash
git add server/socket/handlers.ts
git commit -m "feat: update ticket:new handler to use references JSONB instead of ref1/ref2"
```

---

## Task 4: Add Zod Validation to Partner Router

**Files:**
- Modify: `server/trpc/routers/partner.ts`

- [ ] **Step 1: Add referenceFields validation to updateDepartments**

Find the `updateDepartments` procedure in `server/trpc/routers/partner.ts`. The input schema for each department object currently has `id`, `name`, `description`. Add `referenceFields`:

```typescript
departments: z.array(z.object({
  id: z.string().optional(),
  name: z.string().min(1),
  description: z.string().optional(),
  referenceFields: z.array(
    z.object({ label: z.string().min(1) })
  ).max(3).optional(),
}))
```

- [ ] **Step 2: Verify router compiles**

```bash
docker compose exec server npx tsc --noEmit
```

- [ ] **Step 3: Commit**

```bash
git add server/trpc/routers/partner.ts
git commit -m "feat: add Zod validation for department referenceFields (max 3)"
```

---

## Task 5: Rewrite AdminDepartments Component

> **Note:** Complete Task 8 (i18n) before this task if you want to use i18n keys in the component. The component code below uses hardcoded English strings for clarity — replace with `t('key')` calls after Task 8 adds the keys.

**Files:**
- Rewrite: `client/src/components/admin/AdminDepartments.tsx`

- [ ] **Step 1: Write the new component**

Replace the entire content of `client/src/components/admin/AdminDepartments.tsx` with:

```tsx
import { useState, Fragment } from 'react';
import { trpc } from '../../utils/trpc';
import useStore from '../../store/useStore';
import { Department } from '../../types';

type EditState = {
  name: string;
  description: string;
  referenceFields: Array<{ label: string }>;
};

export default function AdminDepartments() {
  const { memberships, activeMembershipId } = useStore();
  const activeMembership = memberships.find(m => m.id === activeMembershipId);
  const departments: Department[] = activeMembership?.manifest?.departments || [];

  const [editingId, setEditingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [editState, setEditState] = useState<EditState>({ name: '', description: '', referenceFields: [] });
  const [isAddingNew, setIsAddingNew] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  const utils = trpc.useUtils();

  const updateDeptsMutation = trpc.partner.updateDepartments.useMutation({
    onSuccess: () => {
      setIsSaving(false);
      setEditingId(null);
      setIsAddingNew(false);
      utils.partner.getManifest.invalidate();
    },
    onError: (err) => {
      setIsSaving(false);
      alert('Failed to save: ' + err.message);
    }
  });

  // Compute member count per department from Zustand memberships store
  const getMemberCount = (deptId: string) => {
    return memberships.filter(m =>
      Array.isArray(m.departments) && m.departments.includes(deptId)
    ).length;
  };

  const startEdit = (dept: Department) => {
    setDeletingId(null);
    setIsAddingNew(false);
    setEditingId(dept.id);
    setEditState({
      name: dept.name,
      description: dept.description || '',
      referenceFields: dept.referenceFields || [],
    });
  };

  const cancelEdit = () => {
    setEditingId(null);
    setIsAddingNew(false);
  };

  const startDelete = (deptId: string) => {
    setEditingId(null);
    setIsAddingNew(false);
    setDeletingId(deptId);
  };

  const startAdd = () => {
    setEditingId(null);
    setDeletingId(null);
    setIsAddingNew(true);
    setEditState({ name: '', description: '', referenceFields: [] });
  };

  const addRefField = () => {
    if (editState.referenceFields.length >= 3) return;
    setEditState(s => ({ ...s, referenceFields: [...s.referenceFields, { label: '' }] }));
  };

  const removeRefField = (i: number) => {
    setEditState(s => ({
      ...s,
      referenceFields: s.referenceFields.filter((_, idx) => idx !== i),
    }));
  };

  const updateRefLabel = (i: number, label: string) => {
    setEditState(s => ({
      ...s,
      referenceFields: s.referenceFields.map((f, idx) => idx === i ? { label } : f),
    }));
  };

  const saveDept = () => {
    if (!editState.name.trim()) return alert('Department name is required.');
    setIsSaving(true);

    let updated: Department[];
    if (isAddingNew) {
      updated = [...departments, {
        id: '',
        name: editState.name.trim(),
        description: editState.description.trim(),
        referenceFields: editState.referenceFields.filter(f => f.label.trim()),
      }];
    } else {
      updated = departments.map(d =>
        d.id === editingId
          ? { ...d, name: editState.name.trim(), description: editState.description.trim(), referenceFields: editState.referenceFields.filter(f => f.label.trim()) }
          : d
      );
    }

    updateDeptsMutation.mutate({ departments: updated.map(d => ({
      id: d.id || undefined,
      name: d.name,
      description: d.description,
      referenceFields: d.referenceFields,
    }))});
  };

  const confirmDelete = (deptId: string) => {
    const updated = departments.filter(d => d.id !== deptId);
    updateDeptsMutation.mutate({ departments: updated.map(d => ({
      id: d.id,
      name: d.name,
      description: d.description,
      referenceFields: d.referenceFields,
    }))});
    setDeletingId(null);
  };

  const EditRow = () => (
    <tr className="border-t-2 border-black dark:border-white bg-black/5 dark:bg-white/5">
      <td className="p-3">
        <input
          value={editState.name}
          onChange={e => setEditState(s => ({ ...s, name: e.target.value }))}
          placeholder="Department name *"
          className="w-full border-2 border-black dark:border-white bg-white dark:bg-black p-2 text-[11px] font-bold uppercase tracking-widest outline-none"
        />
      </td>
      <td className="p-3">
        <input
          value={editState.description}
          onChange={e => setEditState(s => ({ ...s, description: e.target.value }))}
          placeholder="Description"
          className="w-full border-2 border-black dark:border-white bg-white dark:bg-black p-2 text-[11px] font-bold uppercase tracking-widest outline-none"
        />
      </td>
      <td className="p-3">
        <div className="space-y-2">
          {editState.referenceFields.map((f, i) => (
            <div key={i} className="flex items-center gap-2">
              <input
                value={f.label}
                onChange={e => updateRefLabel(i, e.target.value)}
                placeholder="Field label"
                className="flex-1 border-2 border-black dark:border-white bg-white dark:bg-black p-2 text-[11px] font-bold uppercase tracking-widest outline-none"
              />
              <button onClick={() => removeRefField(i)} className="text-[10px] font-black uppercase px-2 py-1 border-2 border-black dark:border-white hover:invert">✕</button>
            </div>
          ))}
          {editState.referenceFields.length < 3 && (
            <button onClick={addRefField} className="text-[9px] font-black uppercase tracking-widest opacity-60 hover:opacity-100">+ Add Field</button>
          )}
          {editState.referenceFields.length >= 3 && (
            <p className="text-[9px] font-black uppercase tracking-widest opacity-40">Max 3 fields</p>
          )}
        </div>
      </td>
      <td className="p-3 text-right whitespace-nowrap">
        <button onClick={saveDept} disabled={isSaving} className="px-3 py-1.5 bg-black dark:bg-white text-white dark:text-black text-[9px] font-black uppercase tracking-widest disabled:opacity-50 mr-2">
          {isSaving ? 'Saving...' : 'Save'}
        </button>
        <button onClick={cancelEdit} className="px-3 py-1.5 border-2 border-black dark:border-white text-[9px] font-black uppercase tracking-widest hover:invert">
          Cancel
        </button>
      </td>
    </tr>
  );

  return (
    <div className="max-w-5xl">
      <div className="flex justify-between items-start mb-6">
        <div>
          <h2 className="text-lg font-black uppercase tracking-widest">Departments</h2>
          <p className="text-xs uppercase opacity-60 mt-1">Manage your organization structure</p>
        </div>
        <button
          onClick={startAdd}
          disabled={isAddingNew}
          className="px-4 py-2 bg-black dark:bg-white text-white dark:text-black text-[10px] font-black uppercase tracking-widest disabled:opacity-40"
        >
          + Add Department
        </button>
      </div>

      <table className="w-full border-2 border-black dark:border-white">
        <thead>
          <tr className="border-b-2 border-black dark:border-white">
            <th className="text-left p-3 text-[9px] font-black uppercase tracking-widest">Name</th>
            <th className="text-left p-3 text-[9px] font-black uppercase tracking-widest">Description</th>
            <th className="text-left p-3 text-[9px] font-black uppercase tracking-widest">Ref Fields</th>
            <th className="text-right p-3 text-[9px] font-black uppercase tracking-widest">Members</th>
          </tr>
        </thead>
        <tbody>
          {departments.map(dept => (
            <Fragment key={dept.id}>
              {editingId === dept.id ? (
                <EditRow />
              ) : (
                <tr className="border-t border-black/20 dark:border-white/20">
                  <td className="p-3 text-[11px] font-black uppercase tracking-widest">{dept.name}</td>
                  <td className="p-3 text-[11px] opacity-60">{dept.description || '—'}</td>
                  <td className="p-3 text-[11px] opacity-60">
                    {dept.referenceFields?.length
                      ? dept.referenceFields.map(f => f.label).join(', ')
                      : '—'}
                  </td>
                  <td className="p-3 text-right">
                    <span className="text-[11px] font-black mr-4">{getMemberCount(dept.id)}</span>
                    <button onClick={() => startEdit(dept)} className="text-[9px] font-black uppercase tracking-widest opacity-60 hover:opacity-100 mr-3">Edit</button>
                    <button onClick={() => startDelete(dept.id)} className="text-[9px] font-black uppercase tracking-widest opacity-60 hover:opacity-100">Delete</button>
                  </td>
                </tr>
              )}
              {deletingId === dept.id && (
                <tr className="border-t border-black/20 dark:border-white/20 bg-black/5 dark:bg-white/5">
                  <td colSpan={4} className="p-3">
                    <div className="flex items-center gap-4">
                      <span className="text-[10px] font-black uppercase tracking-widest">
                        ⚠ {getMemberCount(dept.id)} member{getMemberCount(dept.id) !== 1 ? 's' : ''} will become generalists.
                        Are you sure?
                      </span>
                      <button onClick={() => confirmDelete(dept.id)} className="px-3 py-1.5 bg-black dark:bg-white text-white dark:text-black text-[9px] font-black uppercase tracking-widest">
                        Confirm Delete
                      </button>
                      <button onClick={() => setDeletingId(null)} className="px-3 py-1.5 border-2 border-black dark:border-white text-[9px] font-black uppercase tracking-widest hover:invert">
                        Cancel
                      </button>
                    </div>
                  </td>
                </tr>
              )}
            </Fragment>
          ))}
          {isAddingNew && <EditRow />}
        </tbody>
      </table>

      {departments.length === 0 && !isAddingNew && (
        <p className="text-center text-[10px] font-black uppercase tracking-widest opacity-40 py-12">
          No departments yet. Add one to get started.
        </p>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Verify build**

```bash
docker compose exec client npm run build 2>&1 | grep -i "error" | head -20
```

Fix any TypeScript errors.

- [ ] **Step 3: Commit**

```bash
git add client/src/components/admin/AdminDepartments.tsx
git commit -m "feat: rewrite AdminDepartments as per-record table with inline edit/delete"
```

---

## Task 6: Update AgentView

**Files:**
- Modify: `client/src/views/AgentView.tsx`

- [ ] **Step 1: Replace ref1/ref2 state with dynamic references state**

Find `const [ref1, setRef1] = useState('')` and `const [ref2, setRef2] = useState('')`. Replace with:

```typescript
const [references, setReferences] = useState<Array<{ label: string; value: string }>>([]);
```

- [ ] **Step 2: Initialize references on mount and department change**

Replace or update the existing `useEffect` that handles department initialization. Add references reset:

```typescript
useEffect(() => {
  const selectedDept = manifest.departments.find(d => d.id === dept);
  const fields = selectedDept?.referenceFields || [];
  setReferences(fields.map(f => ({ label: f.label, value: '' })));
}, [dept, manifest.departments]);
```

- [ ] **Step 3: Add updateReference helper**

Add below the state declarations:

```typescript
const updateReference = (label: string, value: string) => {
  setReferences(prev => prev.map(r => r.label === label ? { ...r, value } : r));
};
```

- [ ] **Step 4: Update ticket creation emit**

Find the `getSocket().emit('ticket:new', {...})` call. Replace `ref1, ref2` with `references`:

```typescript
getSocket().emit('ticket:new', {
  dept,
  agentId: user.id,
  agentLang: user.lang,
  references,
  text: text.trim(),
});
```

- [ ] **Step 5: Update the form to render dynamic reference inputs**

Find where `ref1` and `ref2` inputs are rendered in the form. Replace with:

```tsx
{references.map((ref) => (
  <div key={ref.label}>
    <label className="block text-[10px] font-black uppercase tracking-widest mb-1.5">
      {ref.label} *
    </label>
    <input
      type="text"
      value={ref.value}
      onChange={e => updateReference(ref.label, e.target.value)}
      required
      className="w-full p-3 border-2 border-black dark:border-white bg-transparent outline-none font-bold text-sm"
    />
  </div>
))}
```

- [ ] **Step 6: Remove ref1/ref2 reset on ticket created**

Find the `onCreated` handler inside the socket `useEffect`. Remove `setRef1('')` and `setRef2('')`. Add:

```typescript
setReferences(prev => prev.map(r => ({ ...r, value: '' })));
```

- [ ] **Step 7: Remove manifest.ref1Label / ref2Label references**

Search for `ref1Label` and `ref2Label` in `AgentView.tsx` and remove any usage.

- [ ] **Step 8: Verify build**

```bash
docker compose exec client npm run build 2>&1 | grep -i "error" | head -20
```

- [ ] **Step 9: Commit**

```bash
git add client/src/views/AgentView.tsx
git commit -m "feat: update AgentView to use dynamic per-department reference fields"
```

---

## Task 7: Update Ticket Display

**Files:**
- Modify: Files in `client/src/` that display `ref1`/`ref2` on tickets

- [ ] **Step 1: Find all ref1/ref2 display locations**

```bash
grep -rn "ref1\|ref2\|ref_1\|ref_2" client/src --include="*.tsx" --include="*.ts"
```

Note each file and line number.

- [ ] **Step 2: Replace in each file**

For each location displaying `ticket.ref1` or `ticket.ref2`, replace with:

```tsx
{(ticket.references || []).length > 0 && (
  <div className="space-y-1">
    {(ticket.references || []).map(ref => (
      <div key={ref.label} className="flex gap-2 text-[10px]">
        <span className="font-black uppercase tracking-widest opacity-60">{ref.label}:</span>
        <span className="font-bold">{ref.value}</span>
      </div>
    ))}
  </div>
)}
```

- [ ] **Step 3: Verify build**

```bash
docker compose exec client npm run build 2>&1 | grep -i "error" | head -20
```

- [ ] **Step 4: Commit**

```bash
git add client/src
git commit -m "feat: replace ref1/ref2 display with dynamic references loop in ticket views"
```

---

## Task 8: Update i18n

**Files:**
- Modify: `client/src/i18n.ts`

- [ ] **Step 1: Remove old ref keys**

Search for keys containing `ref1`, `ref2`, `reference_1`, `reference_2` (grep: `ref1\|ref2\|reference_1\|reference_2`) in `client/src/i18n.ts`. Remove all matching entries across all language objects (nl, fr, en).

- [ ] **Step 2: Add new ref field keys**

Add to each language object (nl, fr, en):

```typescript
// English
ref_fields_label: 'Reference Fields',
add_ref_field: 'Add Field',
ref_field_placeholder: 'Field label (e.g. Invoice Number)',
max_ref_fields: 'Maximum 3 fields',

// Dutch (nl) — translate appropriately
ref_fields_label: 'Referentievelden',
add_ref_field: 'Veld toevoegen',
ref_field_placeholder: 'Veldlabel (bijv. Factuurnummer)',
max_ref_fields: 'Maximaal 3 velden',

// French (fr) — translate appropriately
ref_fields_label: 'Champs de référence',
add_ref_field: 'Ajouter un champ',
ref_field_placeholder: 'Libellé du champ (ex. Numéro de facture)',
max_ref_fields: 'Maximum 3 champs',
```

- [ ] **Step 3: Verify build**

```bash
docker compose exec client npm run build 2>&1 | tail -10
```

Expected: clean build.

- [ ] **Step 4: Commit**

```bash
git add client/src/i18n.ts
git commit -m "chore: update i18n for dynamic reference fields"
```

---

## Final Verification

- [ ] Run full client build: `docker compose exec client npm run build`
- [ ] Run client tests: `docker compose exec client npm test`
- [ ] Confirm no ref1/ref2 remain: `grep -rn "ref1\|ref2\|ref_1\|ref_2\|ref1Label\|ref2Label" client/src server --include="*.ts" --include="*.tsx"`
- [ ] Manual smoke test — Admin:
  - Navigate to Departments page
  - Add a department with 2 reference fields
  - Edit it, change a field label, save
  - Delete confirmation shows member count
- [ ] Manual smoke test — Agent:
  - Select the new department
  - Reference field inputs appear with correct labels
  - Submit ticket — verify it creates successfully
- [ ] Manual smoke test — Support:
  - Open the ticket, verify references display correctly
