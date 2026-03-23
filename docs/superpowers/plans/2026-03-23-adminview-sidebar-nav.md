# AdminView Sidebar Nav + Canned Responses Removal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the horizontal tab navigation in AdminView with a persistent grouped sidebar, and remove Canned Responses entirely from the codebase.

**Architecture:** Modify `AdminView.tsx` directly — `NavButton` is local and not shared. The sidebar replaces the horizontal nav row; the top bar stays unchanged. Canned responses are removed at all layers: DB schema, tRPC router, Zustand store, TypeScript types, i18n, and the component itself.

**Tech Stack:** React 19, Tailwind CSS 4, Zustand 5, tRPC, Drizzle ORM, PostgreSQL

---

## File Map

| File | Action |
|---|---|
| `client/src/components/admin/AdminCannedResponses.tsx` | DELETE |
| `server/trpc/routers/cannedResponse.ts` | DELETE |
| `server/trpc/router.ts` | MODIFY — deregister cannedResponse router |
| `server/db/schema.ts` | MODIFY — remove cannedResponses table + cannedResponseId from messages |
| `client/src/store/slices/configSlice.ts` | MODIFY — remove cannedResponses state |
| `client/src/types/index.ts` | MODIFY — remove CannedResponse type |
| `client/src/i18n.ts` | MODIFY — remove canned response keys |
| `client/src/views/AdminView.tsx` | MODIFY — remove canned tab, implement sidebar |

---

## Task 1: Remove Canned Responses from Database Schema

**Files:**
- Modify: `server/db/schema.ts`

- [ ] **Step 1: Pre-check existing data**

```bash
docker compose exec db psql -U user -d tessera -c "SELECT COUNT(*) FROM messages WHERE canned_response_id IS NOT NULL;"
docker compose exec db psql -U user -d tessera -c "SELECT COUNT(*) FROM canned_responses;"
```

Expected: both return 0 (dev environment). If non-zero, note it and proceed anyway (data loss is acceptable).

- [ ] **Step 2: Remove cannedResponses table from schema**

In `server/db/schema.ts`, find and delete the entire `export const cannedResponses = pgTable(...)` block (around line 179).

- [ ] **Step 3: Remove cannedResponseId from messages table**

In `server/db/schema.ts`, find the `messages` table and remove the `cannedResponseId` line:
```typescript
// Remove this line:
cannedResponseId: text('canned_response_id'),
```

- [ ] **Step 4: Apply schema changes**

```bash
docker compose exec server npx drizzle-kit push
```

Expected output: `[✓] Changes applied` — drops `canned_responses` table and `canned_response_id` column from `messages`.

- [ ] **Step 5: Commit**

```bash
git add server/db/schema.ts
git commit -m "chore: remove canned_responses table and cannedResponseId from schema"
```

---

## Task 2: Remove Canned Responses from Server

**Files:**
- Delete: `server/trpc/routers/cannedResponse.ts`
- Modify: `server/trpc/router.ts`

- [ ] **Step 1: Delete the router file**

```bash
rm server/trpc/routers/cannedResponse.ts
```

- [ ] **Step 2: Deregister from router.ts**

Open `server/trpc/router.ts`. Find and remove:
- The import line for `cannedResponseRouter` (grep: `cannedResponse`)
- The `cannedResponse: cannedResponseRouter` entry in the router object

- [ ] **Step 3: Verify server still compiles**

```bash
docker compose exec server npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add server/trpc/router.ts
git rm server/trpc/routers/cannedResponse.ts
git commit -m "chore: remove cannedResponse tRPC router"
```

---

## Task 3: Remove Canned Responses from Client

**Files:**
- Delete: `client/src/components/admin/AdminCannedResponses.tsx`
- Modify: `client/src/store/slices/configSlice.ts`
- Modify: `client/src/types/index.ts`
- Modify: `client/src/i18n.ts`

- [ ] **Step 1: Delete the component**

```bash
git rm client/src/components/admin/AdminCannedResponses.tsx
```

- [ ] **Step 2: Remove from configSlice**

Open `client/src/store/slices/configSlice.ts`. Remove:
- `cannedResponses: CannedResponse[]` from the state interface
- `cannedResponses: []` from the initial state
- `setCannedResponses: (responses) => set({ cannedResponses: responses })` action
- Any import of `CannedResponse` type

- [ ] **Step 3: Remove CannedResponse type**

Open `client/src/types/index.ts`. Find and remove the `CannedResponse` interface/type definition.

- [ ] **Step 4: Remove i18n keys**

Open `client/src/i18n.ts`. Search for any keys containing `canned` (grep: `canned`). Remove all matching entries across all language objects (nl, fr, en).

- [ ] **Step 5: Verify client still compiles**

```bash
docker compose exec client npm run build 2>&1 | tail -20
```

Expected: no TypeScript errors. Fix any remaining references if found.

- [ ] **Step 6: Commit**

```bash
git add client/src/store/slices/configSlice.ts client/src/types/index.ts client/src/i18n.ts
git rm client/src/components/admin/AdminCannedResponses.tsx
git commit -m "chore: remove CannedResponse type, store state, i18n keys, and component"
```

---

## Task 4: Implement Sidebar in AdminView

**Files:**
- Modify: `client/src/views/AdminView.tsx`

- [ ] **Step 1: Remove canned tab and import**

Open `client/src/views/AdminView.tsx`:
- Remove `'canned'` from the `AdminTab` type union
- Remove `import AdminCannedResponses from '../components/admin/AdminCannedResponses'`
- Remove the `{view === 'canned' && <AdminCannedResponses />}` render block

- [ ] **Step 2: Update NavButton to vertical style**

Replace the existing `NavButton` component definition inside `AdminView` with:

```tsx
const NavButton = ({ id, label, icon }: { id: AdminTab; label: string; icon: React.ReactNode }) => (
  <button
    onClick={() => setView(id)}
    className={`w-full flex items-center gap-2.5 px-4 py-2.5 text-[10px] font-black uppercase tracking-widest text-left ${
      view === id
        ? 'bg-black dark:bg-white text-white dark:text-black'
        : 'hover:bg-black/5 dark:hover:bg-white/5'
    }`}
  >
    {icon}
    {label}
  </button>
);
```

- [ ] **Step 3: Add group label helper**

Add this helper just below `NavButton`:

```tsx
const NavGroup = ({ label }: { label: string }) => (
  <div className="px-4 pt-6 pb-2 text-[9px] font-black uppercase tracking-widest opacity-40 select-none">
    {label}
  </div>
);
```

- [ ] **Step 4: Replace horizontal nav with sidebar layout**

Find the current layout structure (the div containing the horizontal nav buttons and the content area below). Replace the entire layout below the top bar with:

```tsx
<div className="flex flex-row flex-1 overflow-hidden">
  {/* Sidebar */}
  <nav className="w-52 flex-shrink-0 border-r-2 border-black dark:border-white overflow-y-auto">
    <NavGroup label="Overview" />
    <NavButton id="dashboard" label={t('dashboard') || 'Dashboard'} icon={<svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M16 8v8m-4-5v5m-4-2v2m-2 4h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>} />
    <NavButton id="alerts" label={t('alerts') || 'Alerts'} icon={<Flame className="h-4 w-4" />} />

    <NavGroup label="Operations" />
    <NavButton id="tickets" label={t('active_tickets')} icon={<svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M17 8h2a2 2 0 012 2v6a2 2 0 01-2 2h-2v4l-4-4H9a1.994 1.994 0 01-1.414-.586m0 0L11 14h4a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2v4l.586-.586z" /></svg>} />
    <NavButton id="archive" label={t('archive')} icon={<svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8m-9 4h4" /></svg>} />
    <NavButton id="feedback" label={t('feedback')} icon={<svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.951.69h4.914c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.175 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.382-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z" /></svg>} />

    <NavGroup label="Team" />
    <NavButton id="team" label={t('team') || 'Team'} icon={<Users className="h-4 w-4" />} />
    <NavButton id="departments" label={t('departments') || 'Departments'} icon={<Building2 className="h-4 w-4" />} />

    <NavGroup label="Configuration" />
    <NavButton id="business_hours" label={t('business_hours') || 'Business Hours'} icon={<svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>} />
    <NavButton id="labels" label={t('labels')} icon={<svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z" /></svg>} />
  </nav>

  {/* Content */}
  <main className="flex-1 overflow-y-auto p-6">
    {view === 'dashboard' && <AdminStats />}
    {view === 'alerts' && <AdminAlerts />}
    {view === 'tickets' && <AdminTickets />}
    {view === 'archive' && <AdminArchive />}
    {view === 'feedback' && <AdminFeedback />}
    {view === 'team' && <AdminTeam />}
    {view === 'departments' && <AdminDepartments />}
    {view === 'business_hours' && <AdminBusinessHours />}
    {view === 'labels' && <AdminLabels />}
  </main>
</div>
```

Note: The outer container wrapping the top bar and this sidebar+content area must be `flex flex-col h-screen` (or `min-h-screen`). Adjust the existing outer wrapper as needed.

- [ ] **Step 5: Verify build passes**

```bash
docker compose exec client npm run build 2>&1 | tail -20
```

Expected: clean build, no TypeScript errors.

- [ ] **Step 6: Manual smoke test**

Open the app in the browser. Log in as an admin user. Verify:
- Sidebar is visible on the left with 4 groups and 9 items
- Active item is highlighted (black bg)
- Clicking each item renders the correct component
- Top bar is unchanged
- No canned responses tab

- [ ] **Step 7: Commit**

```bash
git add client/src/views/AdminView.tsx
git commit -m "feat: replace horizontal tabs with persistent sidebar nav in AdminView"
```

---

## Final Verification

- [ ] Run full client build: `docker compose exec client npm run build`
- [ ] Run client tests: `docker compose exec client npm test`
- [ ] Confirm no references to `canned` remain: `grep -r "canned\|CannedResponse" client/src server/trpc --include="*.ts" --include="*.tsx"`
- [ ] Expected: zero results
