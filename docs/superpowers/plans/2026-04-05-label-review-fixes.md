# Label System Review Fixes — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix all 22 issues found in the label system code review — covering server validation, audit logging, naming consistency, client i18n, brutalist compliance, UX safety, and cross-component label rendering.

**Architecture:** Backend-first approach — fix the label router (validation, audit, naming, partner-scoped delete), then fix the client (AdminLabels UX/i18n/brutalist, TicketPreviewCard label resolution, locale keys). No schema changes needed — the DB is correct (`name` column), the issue is the API aliasing it to `text`.

**Tech Stack:** tRPC + Drizzle (server), React + Zustand + Tailwind (client), Zod (validation), i18n (locales)

---

## File Map

| File | Action | Responsibility |
|------|--------|---------------|
| `server/trpc/routers/label.ts` | Modify | Fix validation, audit logging, partner-scoped delete, naming |
| `client/src/types/index.ts` | Modify | Clean up `Label` interface (remove `text?` fallback) |
| `client/src/locales/en.ts` | Modify | Add label admin i18n keys |
| `client/src/locales/nl.ts` | Modify | Add label admin i18n keys (Dutch) |
| `client/src/locales/fr.ts` | Modify | Add label admin i18n keys (French) |
| `client/src/components/admin/AdminLabels.tsx` | Modify | i18n, brutalist fixes, confirm dialog, toast, per-row delete tracking, aria |
| `client/src/components/support/TicketPreviewCard.tsx` | Modify | Resolve label IDs to names via Zustand store |
| `client/src/components/admin/AdminArchive.tsx` | Modify | Fix `l.text` → `l.name` references |
| `client/src/components/ChatWindow.tsx` | Modify | Fix `info.text` → `info.name` reference |
| `client/src/components/support/CustomerInfoPanel.tsx` | Modify | Fix `label.text || label.name` → `label.name` |

---

### Task 1: Harden label router — validation, audit, partner-scoped delete

**Files:**
- Modify: `server/trpc/routers/label.ts`

The label router has several issues: non-null assertion on `partnerId` in delete, delete not partner-scoped at DB level, no audit logging, weak input validation, and the `name`→`text` aliasing that creates confusion. Fix all in one pass.

**IMPORTANT — Naming migration strategy:** The DB column is `name`. The API currently returns `text` (aliased). We will change the API to return `name` consistently. This requires updating all consumers (Tasks 3-7). The `create` input will also change from `text` to `name`.

- [ ] **Step 1: Read the current label router**

Read `server/trpc/routers/label.ts` to have it in context for editing.

- [ ] **Step 2: Add audit log import and define ALLOWED_COLORS**

```typescript
// At top of file, add auditLog import:
import { labels, ticketLabels, auditLog } from '../../db/schema.js';

// After the imports, before the emitToPartner function, add:
const ALLOWED_COLORS = ['blue', 'indigo', 'purple', 'emerald', 'teal', 'cyan', 'sky', 'amber', 'orange', 'rose', 'pink', 'slate'] as const;
```

- [ ] **Step 3: Fix `list` procedure — return `name` instead of `text`**

Change the select in `list` from:
```typescript
return await db.select({
  id: labels.id,
  text: labels.name,
  color: labels.color,
})
```
To:
```typescript
return await db.select({
  id: labels.id,
  name: labels.name,
  color: labels.color,
})
```

- [ ] **Step 4: Fix `create` procedure — validation, audit, naming**

Replace the `create` procedure's input and mutation body. Change input from `text`/`color` strings to validated fields:

```typescript
  create: adminProcedure
    .input(z.object({
      name: z.string().min(1).max(50).transform(s => s.trim()),
      color: z.enum(ALLOWED_COLORS),
    }))
    .mutation(async ({ input, ctx }) => {
      try {
        if (!ctx.user.partnerId) throw new TRPCError({ code: 'BAD_REQUEST', message: 'No active partner' });

        const id = `l_${crypto.randomUUID()}`;
        await db.insert(labels).values({
          id,
          partnerId: ctx.user.partnerId,
          name: input.name,
          color: input.color,
        });

        await db.insert(auditLog).values({
          action: 'label.created',
          actorId: ctx.user.id,
          partnerId: ctx.user.partnerId,
          targetType: 'label',
          targetId: id,
          metadata: { name: input.name, color: input.color },
        });

        emitToPartner(ctx, 'label:created', { id, name: input.name, color: input.color });

        return { id, ...input };
      } catch (err: unknown) {
        if (err instanceof Error && 'code' in err && (err as Error & { code: string }).code === '23505') {
          throw conflict('Label name already exists for this partner');
        }
        wrapError(err, 'Error creating label');
      }
    }),
```

- [ ] **Step 5: Fix `delete` procedure — partnerId guard, scoped delete, audit**

Replace the `delete` procedure. Add explicit `partnerId` check (no `!` assertion), use compound conditions on the actual delete, and add audit logging:

```typescript
  delete: adminProcedure
    .input(z.string().min(1))
    .mutation(async ({ input: id, ctx }) => {
      try {
        if (!ctx.user.partnerId) throw new TRPCError({ code: 'BAD_REQUEST', message: 'No active partner' });

        const conditions = [eq(labels.id, id), eq(labels.partnerId, ctx.user.partnerId)];

        await db.transaction(async (tx) => {
          const existing = await tx.select().from(labels).where(and(...conditions)).limit(1);
          if (existing.length === 0) {
            throw new TRPCError({ code: 'NOT_FOUND', message: 'Label not found or access denied' });
          }

          await tx.delete(ticketLabels).where(eq(ticketLabels.labelId, id));
          await tx.delete(labels).where(and(...conditions));
        });

        await db.insert(auditLog).values({
          action: 'label.deleted',
          actorId: ctx.user.id,
          partnerId: ctx.user.partnerId,
          targetType: 'label',
          targetId: id,
        });

        emitToPartner(ctx, 'label:deleted', { id });

        return { success: true };
      } catch (err: unknown) {
        wrapError(err, 'Error deleting label');
      }
    }),
```

- [ ] **Step 6: Verify the full file compiles**

Run: `docker compose exec server npx tsc --noEmit --pretty`

Expected: No errors in `label.ts`. There will be client errors from the `text`→`name` change — those are expected and fixed in subsequent tasks.

- [ ] **Step 7: Commit**

```bash
git add server/trpc/routers/label.ts
git commit -m "fix(label-router): harden validation, audit logging, partner-scoped delete, name consistency"
```

---

### Task 2: Clean up Label TypeScript type

**Files:**
- Modify: `client/src/types/index.ts:107-112`

Remove the `text?` fallback field. The API now returns `name` consistently.

- [ ] **Step 1: Read the types file**

Read `client/src/types/index.ts` around line 107.

- [ ] **Step 2: Update the Label interface**

Change:
```typescript
export interface Label {
  id: string;
  name: string;
  text?: string; // fallback
  color: string;
}
```
To:
```typescript
export interface Label {
  id: string;
  name: string;
  color: string;
}
```

- [ ] **Step 3: Commit**

```bash
git add client/src/types/index.ts
git commit -m "fix(types): remove text fallback from Label interface"
```

---

### Task 3: Add i18n keys for label admin

**Files:**
- Modify: `client/src/locales/en.ts`
- Modify: `client/src/locales/nl.ts`
- Modify: `client/src/locales/fr.ts`

- [ ] **Step 1: Read the English locale file around line 412**

Read `client/src/locales/en.ts` around line 410-415.

- [ ] **Step 2: Add English label admin keys**

After the existing `labels: 'Labels',` line, add:

```typescript
    labels_desc: 'Categorize and tag conversations',
    create_new_label: 'Create New Label',
    label_name: 'Name',
    label_color: 'Color',
    label_name_placeholder: 'e.g. Bug Report',
    add_label: 'Add',
    adding_label: 'Adding...',
    no_labels: 'No labels created yet',
    delete_label_title: 'Delete Label',
    delete_label_message: 'This will remove the label from all tickets. This action cannot be undone.',
    label_count: '{count} label(s)',
```

- [ ] **Step 3: Read and add Dutch locale keys**

Read `client/src/locales/nl.ts`, find the `labels` key or the feedback section, and add corresponding keys:

```typescript
    labels_desc: 'Categoriseer en tag gesprekken',
    create_new_label: 'Nieuw label aanmaken',
    label_name: 'Naam',
    label_color: 'Kleur',
    label_name_placeholder: 'bijv. Bug Report',
    add_label: 'Toevoegen',
    adding_label: 'Toevoegen...',
    no_labels: 'Nog geen labels aangemaakt',
    delete_label_title: 'Label verwijderen',
    delete_label_message: 'Dit verwijdert het label van alle tickets. Deze actie kan niet ongedaan worden gemaakt.',
    label_count: '{count} label(s)',
```

- [ ] **Step 4: Read and add French locale keys**

Read `client/src/locales/fr.ts`, find the `labels` key or the feedback section, and add corresponding keys:

```typescript
    labels_desc: 'Catégoriser et taguer les conversations',
    create_new_label: 'Créer un nouveau label',
    label_name: 'Nom',
    label_color: 'Couleur',
    label_name_placeholder: 'ex. Rapport de bug',
    add_label: 'Ajouter',
    adding_label: 'Ajout...',
    no_labels: 'Aucun label créé',
    delete_label_title: 'Supprimer le label',
    delete_label_message: 'Cela supprimera le label de tous les tickets. Cette action est irréversible.',
    label_count: '{count} label(s)',
```

- [ ] **Step 5: Commit**

```bash
git add client/src/locales/en.ts client/src/locales/nl.ts client/src/locales/fr.ts
git commit -m "feat(i18n): add label admin translation keys for en/nl/fr"
```

---

### Task 4: Fix AdminLabels — full rewrite

**Files:**
- Modify: `client/src/components/admin/AdminLabels.tsx`

Fix all client issues: i18n, brutalist compliance (no `rounded-full`, no scale animations, no inline colors), add ConfirmDialog for delete, add Toast for errors, track per-row delete state, add aria attributes, fix `bg-bg-elevated` typo, use `name` instead of `text`, and adapt `create` mutation input from `text`→`name`.

- [ ] **Step 1: Read the current AdminLabels component**

Read `client/src/components/admin/AdminLabels.tsx`.

- [ ] **Step 2: Rewrite the full component**

Replace the entire file content with the corrected version. Key changes:
- Import `ConfirmDialog` and `Toast`
- Use `t()` for all strings
- Change `newText`→`newName`, `input.text`→`input.name`
- Replace `rounded-full` with no border-radius (square color swatches)
- Remove `scale-110`/`scale-105` hover effects
- Replace `bg-bg-elevated` with `bg-[var(--color-bg-elevated)]`
- Replace inline `hover:bg-black/[0.02]` with `hover:bg-[var(--color-bg-elevated)]`
- Add `aria-label` and `aria-selected` on color buttons
- Track `deletingId` state for per-row disable
- Add `onError` handlers with Toast
- Add ConfirmDialog before delete

```tsx
import { useState } from 'react';
import { trpc } from '../../utils/trpc';
import { useT } from '../../i18n';
import { Plus, Trash2, RefreshCw } from 'lucide-react';
import ErrorBox from './ErrorBox';
import ConfirmDialog from '../ConfirmDialog';
import Toast from '../Toast';

const COLORS = [
  { key: 'blue', bg: 'bg-blue-500', ring: 'ring-blue-500' },
  { key: 'indigo', bg: 'bg-indigo-500', ring: 'ring-indigo-500' },
  { key: 'purple', bg: 'bg-purple-500', ring: 'ring-purple-500' },
  { key: 'emerald', bg: 'bg-emerald-500', ring: 'ring-emerald-500' },
  { key: 'teal', bg: 'bg-teal-500', ring: 'ring-teal-500' },
  { key: 'cyan', bg: 'bg-cyan-500', ring: 'ring-cyan-500' },
  { key: 'sky', bg: 'bg-sky-500', ring: 'ring-sky-500' },
  { key: 'amber', bg: 'bg-amber-500', ring: 'ring-amber-500' },
  { key: 'orange', bg: 'bg-orange-500', ring: 'ring-orange-500' },
  { key: 'rose', bg: 'bg-rose-500', ring: 'ring-rose-500' },
  { key: 'pink', bg: 'bg-pink-500', ring: 'ring-pink-500' },
  { key: 'slate', bg: 'bg-slate-500', ring: 'ring-slate-500' },
] as const;

/** Map color key to full Tailwind bg class (avoids dynamic class purge) */
const COLOR_BG_MAP: Record<string, string> = Object.fromEntries(
  COLORS.map((c) => [c.key, c.bg]),
);

export default function AdminLabels() {
  const t = useT();
  const [newName, setNewName] = useState('');
  const [newColor, setNewColor] = useState<string>('indigo');
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<{ id: string; name: string } | null>(null);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);

  const { data: labels, isLoading, error: fetchError, refetch } = trpc.label.list.useQuery();

  const createMutation = trpc.label.create.useMutation({
    onSuccess: () => {
      setNewName('');
      refetch();
    },
    onError: (err) => setToast({ message: err.message, type: 'error' }),
  });

  const deleteMutation = trpc.label.delete.useMutation({
    onSuccess: () => {
      setDeletingId(null);
      refetch();
    },
    onError: (err) => {
      setDeletingId(null);
      setToast({ message: err.message, type: 'error' });
    },
  });

  const addLabel = () => {
    if (!newName.trim()) return;
    createMutation.mutate({ name: newName, color: newColor });
  };

  const confirmDeleteLabel = (id: string, name: string) => {
    setConfirmDelete({ id, name });
  };

  const executeDelete = () => {
    if (!confirmDelete) return;
    setDeletingId(confirmDelete.id);
    deleteMutation.mutate(confirmDelete.id);
    setConfirmDelete(null);
  };

  const error = fetchError?.message || createMutation.error?.message || deleteMutation.error?.message;

  return (
    <div className="max-w-3xl">
      <div className="flex justify-between items-center mb-6">
        <div>
          <h2 className="text-lg font-bold uppercase tracking-wide">{t('labels') || 'Labels'}</h2>
          <p className="text-xs uppercase text-[var(--color-text-secondary)] mt-1">{t('labels_desc') || 'Categorize and tag conversations'}</p>
        </div>
        <button
          onClick={() => refetch()}
          className="p-2 hover:bg-[var(--color-accent-blue)] hover:text-white"
          title={t('refresh') || 'Refresh'}
        >
          <RefreshCw className={`h-4 w-4 ${isLoading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      <ErrorBox error={error} />

      {/* Create new label */}
      <div className="surface-card p-5 mb-6">
        <h3 className="font-mono text-[9px] uppercase text-[var(--color-text-muted)] tracking-wide mb-4">{t('create_new_label') || 'Create New Label'}</h3>
        <div className="flex items-end gap-4">
          <div className="flex-1">
            <label className="mono-label mb-1.5 block">{t('label_name') || 'Name'} *</label>
            <input
              type="text"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && addLabel()}
              placeholder={t('label_name_placeholder') || 'e.g. Bug Report'}
              className="input-field w-full"
              maxLength={50}
            />
          </div>
          <div>
            <label className="mono-label mb-1.5 block">{t('label_color') || 'Color'} *</label>
            <div className="flex gap-1.5 p-1.5 border border-[var(--color-border)]" role="radiogroup" aria-label={t('label_color') || 'Color'}>
              {COLORS.map((c) => (
                <button
                  key={c.key}
                  onClick={() => setNewColor(c.key)}
                  role="radio"
                  aria-checked={newColor === c.key}
                  aria-label={c.key}
                  className={`w-6 h-6 ${c.bg} ${
                    newColor === c.key
                      ? 'ring-2 ring-offset-2 ring-offset-[var(--color-bg-surface)] ' + c.ring
                      : 'opacity-50 hover:opacity-80'
                  }`}
                />
              ))}
            </div>
          </div>
          <button
            onClick={addLabel}
            disabled={!newName.trim() || createMutation.isPending}
            className="btn-primary disabled:opacity-50 shrink-0"
          >
            <Plus className="h-3.5 w-3.5" />
            {createMutation.isPending ? (t('adding_label') || 'Adding...') : (t('add_label') || 'Add')}
          </button>
        </div>
      </div>

      {/* Labels list */}
      <div className="surface-card">
        <div className="grid grid-cols-[auto_1fr_60px] border-b border-[var(--color-border)] bg-[var(--color-bg-elevated)]">
          <div className="px-4 py-3 font-mono text-[9px] uppercase text-[var(--color-text-muted)] tracking-wide w-16 text-center">{t('label_color') || 'Color'}</div>
          <div className="px-4 py-3 font-mono text-[9px] uppercase text-[var(--color-text-muted)] tracking-wide">{t('labels') || 'Label'}</div>
          <div className="px-4 py-3 font-mono text-[9px] uppercase text-[var(--color-text-muted)] tracking-wide"></div>
        </div>

        {isLoading ? (
          <div className="px-4 py-8 text-center text-sm text-[var(--color-text-muted)] font-bold uppercase tracking-wide">
            {t('loading') || 'Loading...'}
          </div>
        ) : !labels || labels.length === 0 ? (
          <div className="px-4 py-8 text-center text-sm text-[var(--color-text-muted)] font-bold uppercase tracking-wide">
            {t('no_labels') || 'No labels created yet'}
          </div>
        ) : (
          labels.map((l) => (
            <div
              key={l.id}
              className="grid grid-cols-[auto_1fr_60px] border-b border-[var(--color-border)] group hover:bg-[var(--color-bg-elevated)]"
            >
              <div className="px-4 py-3 w-16 flex items-center justify-center">
                <div className={`w-3.5 h-3.5 ${COLOR_BG_MAP[l.color] ?? 'bg-slate-500'}`} />
              </div>
              <div className="px-4 py-3 font-bold text-sm flex items-center">{l.name}</div>
              <div className="px-4 py-3 flex items-center justify-center">
                <button
                  onClick={() => confirmDeleteLabel(l.id, l.name)}
                  disabled={deletingId === l.id}
                  className="w-7 h-7 flex items-center justify-center opacity-0 group-hover:opacity-100 hover:bg-[var(--color-accent-blue)] hover:text-white disabled:opacity-50"
                  title={t('delete') || 'Delete'}
                  aria-label={`${t('delete') || 'Delete'} ${l.name}`}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          ))
        )}
      </div>

      {labels && labels.length > 0 && (
        <div className="mt-3 font-mono text-[9px] uppercase tracking-wide text-[var(--color-text-muted)] text-right">
          {labels.length} {t('labels') || 'label(s)'}
        </div>
      )}

      {confirmDelete && (
        <ConfirmDialog
          title={t('delete_label_title') || 'Delete Label'}
          message={t('delete_label_message') || 'This will remove the label from all tickets. This action cannot be undone.'}
          confirmLabel={t('delete') || 'Delete'}
          onConfirm={executeDelete}
          onCancel={() => setConfirmDelete(null)}
        />
      )}

      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
    </div>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add client/src/components/admin/AdminLabels.tsx
git commit -m "fix(AdminLabels): i18n, brutalist compliance, confirm dialog, toast, aria, naming"
```

---

### Task 5: Fix TicketPreviewCard — resolve label IDs to names

**Files:**
- Modify: `client/src/components/support/TicketPreviewCard.tsx`

The card renders raw label ID strings. Fix it to resolve IDs via the Zustand `allLabels` store, matching the pattern used in `CustomerInfoPanel` and `ChatWindow`.

- [ ] **Step 1: Read the current file**

Read `client/src/components/support/TicketPreviewCard.tsx`.

- [ ] **Step 2: Add allLabels import and resolution**

Add the Zustand store import and label lookup. Replace raw label rendering with resolved names.

Add import at top:
```typescript
import useStore from '../../store/useStore';
```

Inside the component function, before the return:
```typescript
  const allLabels = useStore((s) => s.allLabels);
```

Replace the labels rendering section (the `{ticket.labels && ...}` block, lines 43-50):
```tsx
        {/* Labels */}
        {ticket.labels && ticket.labels.length > 0 && (
          <div className="px-5 py-2 border-b border-border flex gap-1.5 flex-wrap">
            {ticket.labels.map((labelId) => {
              const info = allLabels.find((l) => l.id === labelId);
              if (!info) return null;
              return (
                <span key={labelId} className="text-[9px] font-mono font-bold uppercase bg-[var(--color-bg-elevated)] px-2 py-0.5 text-[var(--color-text-secondary)]">
                  {info.name}
                </span>
              );
            })}
          </div>
        )}
```

This also fixes the `bg-bg-elevated` typo → `bg-[var(--color-bg-elevated)]` and `text-text-secondary` → `text-[var(--color-text-secondary)]`.

- [ ] **Step 3: Commit**

```bash
git add client/src/components/support/TicketPreviewCard.tsx
git commit -m "fix(TicketPreviewCard): resolve label IDs to names via Zustand store"
```

---

### Task 6: Fix ChatWindow label rendering — `text` → `name`

**Files:**
- Modify: `client/src/components/ChatWindow.tsx`

The `ChatWindow` uses `info.text` to display labels (line 560). Change to `info.name`.

- [ ] **Step 1: Read the ChatWindow around line 555-565**

Read `client/src/components/ChatWindow.tsx` around lines 555-565.

- [ ] **Step 2: Change `info.text` to `info.name`**

Find line 560:
```tsx
                      {info.text}
```
Replace with:
```tsx
                      {info.name}
```

- [ ] **Step 3: Commit**

```bash
git add client/src/components/ChatWindow.tsx
git commit -m "fix(ChatWindow): use label.name instead of label.text"
```

---

### Task 7: Fix CustomerInfoPanel — remove `text` fallback

**Files:**
- Modify: `client/src/components/support/CustomerInfoPanel.tsx`

Line 95 uses `{label.text || label.name}`. Since `text` no longer exists on the `Label` type, simplify to `{label.name}`.

- [ ] **Step 1: Read CustomerInfoPanel around line 90-96**

Read `client/src/components/support/CustomerInfoPanel.tsx` around lines 90-96.

- [ ] **Step 2: Simplify to `label.name`**

Find line 95:
```tsx
                {label.text || label.name}
```
Replace with:
```tsx
                {label.name}
```

- [ ] **Step 3: Commit**

```bash
git add client/src/components/support/CustomerInfoPanel.tsx
git commit -m "fix(CustomerInfoPanel): use label.name directly, remove text fallback"
```

---

### Task 8: Fix AdminArchive — `l.text` → `l.name`

**Files:**
- Modify: `client/src/components/admin/AdminArchive.tsx`

The archive uses `l.text` when rendering label options (line 135) and label display. Change to `l.name`.

- [ ] **Step 1: Read AdminArchive around lines 130-195**

Read `client/src/components/admin/AdminArchive.tsx` around lines 130-195.

- [ ] **Step 2: Fix label option text**

Find line 135:
```tsx
                {allLabels.map((l) => <option key={l.id} value={l.id}>{l.text}</option>)}
```
Replace with:
```tsx
                {allLabels.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
```

- [ ] **Step 3: Check for other `l.text` or `info?.text` references in the file**

Search the file for any other `.text` references on label objects. The archive label display around line 190 likely uses `info?.text || info?.name || id` — fix those to `info?.name || id`.

- [ ] **Step 4: Commit**

```bash
git add client/src/components/admin/AdminArchive.tsx
git commit -m "fix(AdminArchive): use label.name instead of label.text"
```

---

### Task 9: Typecheck and verify

**Files:** None (verification only)

- [ ] **Step 1: Run full typecheck**

Run: `docker compose exec server npx tsc --noEmit --pretty`

Expected: 0 errors. If there are errors related to `text` property on `Label`, find and fix the remaining references.

- [ ] **Step 2: Run client typecheck**

Run: `docker compose exec client npx tsc --noEmit --pretty`

Expected: 0 errors. The `Label` interface no longer has `text?`, so any remaining `label.text` references will produce TS errors.

- [ ] **Step 3: Run server tests**

Run: `docker compose exec server npm test`

Expected: All tests pass.

- [ ] **Step 4: Run client tests**

Run: `docker compose exec client npm test`

Expected: All tests pass. If any test snapshots reference `text` on label objects, update them.

- [ ] **Step 5: Commit any test fixes if needed**

```bash
git add -A
git commit -m "fix: update tests for label name consistency"
```

---

## Revised Issue Tracker

| # | Issue | Task |
|---|-------|------|
| 1 | Non-null assertion on `partnerId` in delete | Task 1 Step 5 |
| 2 | Delete not partner-scoped at DB level | Task 1 Step 5 |
| 3 | No audit logging | Task 1 Steps 4-5 |
| 4 | Weak input validation | Task 1 Step 4 |
| 5 | No update procedure | **Deferred** — separate feature, not a bug |
| 6 | `name` vs `text` naming inconsistency | Tasks 1-8 (full stack) |
| 7 | Delete input not validated | Task 1 Step 5 |
| 8 | No delete confirmation | Task 4 Step 2 |
| 9 | Hardcoded English (i18n) | Tasks 3-4 |
| 10 | `rounded-full` on non-avatars | Task 4 Step 2 |
| 11 | Decorative scale animations | Task 4 Step 2 |
| 12 | Inline colors instead of tokens | Task 4 Step 2 |
| 13 | `bg-bg-elevated` typo | Tasks 4-5 |
| 14 | All delete buttons disabled together | Task 4 Step 2 |
| 15 | No `onError` mutation handlers | Task 4 Step 2 |
| 16 | Missing aria attributes | Task 4 Step 2 |
| 17 | `animate-spin` (kept — functional feedback) | N/A |
| 18 | TicketPreviewCard shows raw label IDs | Task 5 |
| 19 | Dual state (Zustand + tRPC) | **Kept** — AdminLabels uses tRPC for its own list, Zustand is for cross-component sharing. This is acceptable. |
| 20 | ~~Socket events not consumed~~ | **False positive** — listeners exist in useSocket.ts lines 281-287 |
| 21 | `name`/`text` inconsistency | Tasks 1-8 |
| 22 | Blacklist vs whitelist role check | **Deferred** — socket handler change, separate scope |
| 23 | No ticket status guard on label updates | **Deferred** — needs product decision |
