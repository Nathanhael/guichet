# Department Enforcement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the implicit "generalist" concept — support users must have ≥1 department. Fix AdminTeam stat card filters. Protect manual memberships from SSO sync.

**Architecture:** Add `source` column to `memberships` (sso/manual). Enforce department requirements at backend mutation + UI modal layers. SSO sync only touches `source='sso'` memberships. AdminTeam stat cards use a dedicated `role` query param instead of text search.

**Tech Stack:** Drizzle ORM (PostgreSQL), tRPC, React/Zustand, Tailwind CSS

**Spec:** `docs/superpowers/specs/2026-04-05-department-enforcement-design.md`

---

### Task 1: Add `source` column to memberships schema

**Files:**
- Modify: `server/db/schema.ts:9-10` (add enum), `server/db/schema.ts:80-89` (add column)

- [ ] **Step 1: Add the pgEnum and column**

In `server/db/schema.ts`, after the existing enum definitions (around line 9), add:

```typescript
export const membershipSourceEnum = pgEnum('membership_source', ['sso', 'manual']);
```

Then in the `memberships` table definition (line 80-89), add the `source` column after `departments`:

```typescript
export const memberships = pgTable('memberships', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  partnerId: text('partner_id').notNull().references(() => partners.id, { onDelete: 'cascade' }),
  role: roleEnum('role').notNull(),
  departments: jsonb('departments').default([]),
  source: membershipSourceEnum('source').notNull().default('sso'),
  createdAt: timestamp('created_at', { mode: 'string' }).notNull().defaultNow(),
}, (table) => ({
  userPartnerIdx: uniqueIndex('idx_memberships_user_partner').on(table.userId, table.partnerId),
}));
```

- [ ] **Step 2: Generate and push migration**

Run:
```bash
docker compose exec server npx drizzle-kit generate
docker compose exec server npx drizzle-kit push
```

Expected: Migration generated, column added with default `'sso'` for all existing rows.

- [ ] **Step 3: Commit**

```bash
git add server/db/schema.ts
git commit -m "schema: add source column to memberships (sso/manual)"
```

---

### Task 2: Backend — `listMembers` add `role` filter and update search SQL

**Files:**
- Modify: `server/trpc/routers/partner.ts:438-502`

- [ ] **Step 1: Add `role` param and `source` to select**

In `server/trpc/routers/partner.ts`, update the `listMembers` procedure. Change the input schema (line 439-443):

```typescript
  listMembers: adminProcedure
    .input(z.object({
      limit: z.number().min(1).max(100).default(50),
      offset: z.number().min(0).default(0),
      search: z.string().optional(),
      role: z.enum(['agent', 'support', 'admin']).optional(),
    }))
```

Add the role filter after the partner filter (after line 449):

```typescript
        const filters = [eq(memberships.partnerId, partnerId)];
        if (input.role) {
          filters.push(eq(memberships.role, input.role));
        }
```

- [ ] **Step 2: Update search SQL — replace Generalist/Global/Grants with Unconfigured**

Replace the search `or()` block (lines 461-477) with:

```typescript
          filters.push(or(
            ilike(users.name, s),
            ilike(users.email, s),
            // Match the role (e.g. "agent", "support")
            sql`${memberships.role}::text ILIKE ${s}`,
            sql`${rawSearch} ILIKE CONCAT(${memberships.role}::text, 's')`,
            // Match department names
            matchesDept,
            // Match "Unconfigured" for support users with no department assignments
            sql`CASE
              WHEN ${memberships.role} = 'support' AND jsonb_array_length(${memberships.departments}) = 0
              THEN 'Unconfigured' ILIKE ${s}
              ELSE FALSE
            END`,
            // Match "Manual" for manually-created memberships
            sql`CASE
              WHEN ${memberships.source} = 'manual'
              THEN 'Manual' ILIKE ${s}
              ELSE FALSE
            END`
          )!);
```

- [ ] **Step 3: Add `source` to the select fields**

In the `db.select()` block (lines 480-491), add `source`:

```typescript
        const result = await db
          .select({
            membershipId: memberships.id,
            userId: users.id,
            name: users.name,
            email: users.email,
            role: memberships.role,
            departments: memberships.departments,
            source: memberships.source,
            createdAt: memberships.createdAt,
            externalId: users.externalId,
            lastActiveAt: users.lastActiveAt,
          })
```

- [ ] **Step 4: Commit**

```bash
git add server/trpc/routers/partner.ts
git commit -m "feat(partner): add role filter and source field to listMembers"
```

---

### Task 3: Backend — enforce department validation in mutations

**Files:**
- Modify: `server/trpc/routers/partner.ts:506-690`

- [ ] **Step 1: Update `addMemberByEmail` — set source, validate departments**

In `addMemberByEmail` (line 506), add validation after the role check (after line 518):

```typescript
        // Support role requires at least one department
        if (input.role === 'support' && (!input.departments || input.departments.length === 0)) {
          throw new TRPCError({ code: 'BAD_REQUEST', message: 'Support role requires at least one department' });
        }
```

Update the `db.insert(memberships).values` (line 536-542) to include `source`:

```typescript
        await db.insert(memberships).values({
          id: newMembershipId,
          userId: userId,
          partnerId: partnerId,
          role: input.role,
          departments: input.role === 'agent' ? [] : (input.departments || []),
          source: 'manual',
        });
```

- [ ] **Step 2: Update `inviteExternalUser` — set source, validate departments**

In `inviteExternalUser` (line 560), add validation after the role check (after line 574):

```typescript
        // Support role requires at least one department
        if (input.role === 'support' && (!input.departments || input.departments.length === 0)) {
          throw new TRPCError({ code: 'BAD_REQUEST', message: 'Support role requires at least one department' });
        }
```

Update the `tx.insert(memberships).values` (line 624-630) to include `source`:

```typescript
          await tx.insert(memberships).values({
            id: newMembershipId,
            userId: newUserId,
            partnerId: partnerId,
            role: input.role,
            departments: input.role === 'agent' ? [] : (input.departments || []),
            source: 'manual',
          });
```

- [ ] **Step 3: Update `updateMember` — validate departments for support**

In `updateMember` (line 652), after the "Membership not found" check (line 667), update the existing guard:

```typescript
        // Agents don't have department assignments — they select per ticket
        // Support requires at least one department
        const isSupport = membership[0].role === 'support';
        const depts = membership[0].role === 'agent' ? [] : (input.departments || []);

        if (isSupport && depts.length === 0) {
          throw new TRPCError({ code: 'BAD_REQUEST', message: 'Support role requires at least one department' });
        }

        await db.update(memberships)
          .set({ departments: depts })
          .where(and(eq(memberships.id, input.membershipId), eq(memberships.partnerId, partnerId)));
```

- [ ] **Step 4: Commit**

```bash
git add server/trpc/routers/partner.ts
git commit -m "feat(partner): enforce dept validation, set source on mutations"
```

---

### Task 4: Backend — enforce department validation in platform router

**Files:**
- Modify: `server/trpc/routers/platform.ts:1112-1188`

- [ ] **Step 1: Update `addGroupMapping` — validate departments for support**

In `addGroupMapping` (line 1112), after the SSO auth method check (line 1125), add:

```typescript
      // Support role requires at least one department in mapping
      if (input.defaultRole === 'support' && input.defaultDepartments.length === 0) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Support role requires at least one department in group mapping' });
      }
```

- [ ] **Step 2: Update `updateGroupMapping` — validate departments for support**

In `updateGroupMapping` (line 1157), after fetching the existing mapping (line 1166), add:

```typescript
      // Resolve effective role after update
      const effectiveRole = input.defaultRole ?? existing[0].defaultRole;
      const effectiveDepts = input.defaultDepartments ?? (existing[0].defaultDepartments as string[] || []);
      if (effectiveRole === 'support' && effectiveDepts.length === 0) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Support role requires at least one department in group mapping' });
      }
```

- [ ] **Step 3: Commit**

```bash
git add server/trpc/routers/platform.ts
git commit -m "feat(platform): enforce dept validation in group mappings"
```

---

### Task 5: Backend — ticket query empty-departments-sees-nothing

**Files:**
- Modify: `server/trpc/routers/ticket.ts:56-66`

- [ ] **Step 1: Update department isolation logic**

In `server/trpc/routers/ticket.ts`, replace the department isolation block (lines 56-66):

```typescript
        // H-6: Department isolation for support users with assigned departments
        // Empty departments = unconfigured (sees nothing). Admin and platform_operator are not restricted.
        // Departments sourced from JWT context (refreshed on token rotation, max staleness = ACCESS_TOKEN_EXPIRY).
        if (!ctx.user.isPlatformOperator && ctx.user.role === 'support') {
          const depts = ctx.user.departments;
          if (depts.length > 0) {
            conditions.push(inArray(tickets.dept, depts));
          } else {
            // No departments assigned — return nothing (unconfigured support user)
            conditions.push(sql`1 = 0`);
          }
        }
```

- [ ] **Step 2: Commit**

```bash
git add server/trpc/routers/ticket.ts
git commit -m "fix(ticket): empty departments sees nothing for support users"
```

---

### Task 6: SSO — add `source` field and protect manual memberships

**Files:**
- Modify: `server/routes/sso.ts:343-401`

- [ ] **Step 1: Set `source: 'sso'` on auto-created memberships**

In `server/routes/sso.ts`, update the membership insert (line 345-351):

```typescript
          await db.insert(memberships).values({
            id: mId,
            userId: user.id,
            partnerId: pId,
            role: target.role as any,
            departments: target.departments,
            source: 'sso',
          });
```

- [ ] **Step 2: Only sync roles for SSO-sourced memberships**

Update the role sync condition (line 362). Change:

```typescript
        } else if (existing[0].role !== target.role) {
```

To:

```typescript
        } else if (existing[0].source === 'sso' && existing[0].role !== target.role) {
```

This requires selecting `source` in the existing membership query. Update the select (line 337-341):

```typescript
        const existing = await db
          .select()
          .from(memberships)
          .where(and(eq(memberships.userId, user.id), eq(memberships.partnerId, pId)))
          .limit(1);
```

This already uses `select()` (selects all columns), so `existing[0].source` is available.

- [ ] **Step 3: Only cleanup SSO-sourced memberships**

Update the cleanup loop (lines 386-401). Change the condition (line 389):

```typescript
          if (mappedPartnerIds.includes(cm.partnerId) && !targetMemberships.has(cm.partnerId)) {
```

To:

```typescript
          if (mappedPartnerIds.includes(cm.partnerId) && !targetMemberships.has(cm.partnerId) && cm.source === 'sso') {
```

- [ ] **Step 4: Add warning for support with empty departments**

After the membership insert (after line 361), add:

```typescript
          if (target.role === 'support' && target.departments.length === 0) {
            logger.warn({ userId: user.id, partnerId: pId }, '[SSO] Support membership created with no departments — user will see empty queue');
          }
```

- [ ] **Step 5: Import `source` from schema if needed**

The `memberships` import at the top of `sso.ts` already imports the full table, so `memberships.source` is available after the schema change.

- [ ] **Step 6: Commit**

```bash
git add server/routes/sso.ts
git commit -m "feat(sso): set source field, protect manual memberships from sync"
```

---

### Task 7: Client — AdminTeam stat cards use `roleFilter` state

**Files:**
- Modify: `client/src/components/admin/AdminTeam.tsx:1-62` (state and query), `client/src/components/admin/AdminTeam.tsx:107-146` (stat cards and tags)

- [ ] **Step 1: Add `roleFilter` and `onlineOnly` state, update query**

In `AdminTeam.tsx`, after the existing state declarations (after `const [page, setPage] = useState(0);`), add:

```typescript
  const [roleFilter, setRoleFilter] = useState<'agent' | 'support' | 'admin' | ''>('');
  const [onlineOnly, setOnlineOnly] = useState(false);
```

Update the `listMembers` query to pass the role filter:

```typescript
  const { data, refetch, isLoading } = trpc.partner.listMembers.useQuery(
    {
      limit: LIMIT,
      offset: page * LIMIT,
      search: search.trim() || undefined,
      role: roleFilter || undefined,
    },
    { enabled: !!activeMembershipId }
  );
```

Add a `displayData` memo that applies the online filter client-side:

```typescript
  const displayData = useMemo(() => {
    if (!data) return [];
    if (!onlineOnly) return data;
    return data.filter(m => onlineStatusMap.has(m.userId));
  }, [data, onlineOnly, onlineStatusMap]);
```

- [ ] **Step 2: Update `handleQuickFilter` and add role filter handler**

Replace `handleQuickFilter`:

```typescript
  const handleRoleFilter = (role: '' | 'agent' | 'support' | 'admin') => {
    setRoleFilter(role);
    setOnlineOnly(false);
    setPage(0);
  };

  const handleOnlineFilter = () => {
    setOnlineOnly(!onlineOnly);
    setPage(0);
  };

  const handleTagFilter = (tag: string) => {
    if (['agent', 'support', 'admin'].includes(tag.toLowerCase())) {
      handleRoleFilter(tag.toLowerCase() as 'agent' | 'support' | 'admin');
      setSearch('');
    } else {
      // "Unconfigured" — use search
      setRoleFilter('');
      setOnlineOnly(false);
      setSearch(tag);
      setPage(0);
    }
  };
```

- [ ] **Step 3: Update stat cards**

Replace the stat cards array (lines 108-114):

```typescript
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: 'Total Members', value: stats.total, icon: Users, handler: () => handleRoleFilter(''), active: !roleFilter && !onlineOnly },
          { label: 'Support Staff', value: stats.support, icon: Shield, handler: () => handleRoleFilter('support'), active: roleFilter === 'support', color: 'text-accent-purple' },
          { label: 'Agents', value: stats.agents, icon: User, handler: () => handleRoleFilter('agent'), active: roleFilter === 'agent', color: 'text-accent-blue' },
          { label: 'Currently Online', value: stats.online, icon: Check, handler: handleOnlineFilter, active: onlineOnly, color: 'text-accent-green' },
        ].map((stat) => (
          <button
            key={stat.label}
            onClick={stat.handler}
            className={`flex flex-col p-4 bg-bg-surface border ${stat.active ? 'border-accent-blue bg-accent-blue/5' : 'border-border'} hover:border-accent-blue group transition-all text-left relative overflow-hidden`}
          >
            <div className="flex justify-between items-start mb-2 relative z-10">
              <span className="text-[9px] font-bold uppercase tracking-widest text-text-muted group-hover:text-text-primary transition-colors">{stat.label}</span>
              <stat.icon className={`h-4 w-4 ${stat.color || 'text-text-muted'} opacity-40 group-hover:opacity-100 transition-all`} />
            </div>
            <span className="text-2xl font-bold font-mono tracking-tighter relative z-10">{stat.value}</span>
            <div className="absolute bottom-0 left-0 h-0.5 w-0 group-hover:w-full bg-accent-blue transition-all duration-300" />
          </button>
        ))}
      </div>
```

- [ ] **Step 4: Update quick filter tags**

Replace the tags section:

```typescript
      {/* Quick Filter Tags */}
      <div className="flex flex-wrap gap-2 items-center px-1">
        <span className="text-[8px] font-bold uppercase tracking-widest text-text-muted">Filter:</span>
        {['Agent', 'Support', 'Admin', 'Unconfigured'].map(tag => (
          <button
            key={tag}
            onClick={() => handleTagFilter(tag)}
            className={`px-2 py-0.5 text-[8px] font-bold uppercase tracking-tighter border transition-colors ${
              (tag.toLowerCase() === roleFilter) || (tag === 'Unconfigured' && search.toLowerCase() === 'unconfigured')
                ? 'bg-accent-blue text-white border-accent-blue'
                : 'border-border text-text-secondary hover:border-text-muted'
            }`}
          >
            {tag}
          </button>
        ))}
      </div>
```

- [ ] **Step 5: Replace all `data?.` references with `displayData` in the table body**

In the table `<tbody>`, change `data?.length` to `displayData.length` and `data?.map` to `displayData.map`:

```typescript
                {displayData.length === 0 ? (
                  <tr>
                    ...
                  </tr>
                ) : displayData.map((member) => (
```

Also update the pagination footer: change `data?.length || 0` to `displayData.length`.

- [ ] **Step 6: Commit**

```bash
git add client/src/components/admin/AdminTeam.tsx
git commit -m "feat(admin): stat cards use role filter, tags use Unconfigured"
```

---

### Task 8: Client — AdminTeam MANUAL badge and inline edit enforcement

**Files:**
- Modify: `client/src/components/admin/AdminTeam.tsx:213-296` (table rows)

- [ ] **Step 1: Add MANUAL badge in role column**

In the role badge `<td>` (around line 213-221), after the role `<span>`, add:

```typescript
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-2">
                        {member.role === 'admin' ? <Shield className="h-3 w-3 text-accent-purple" /> : <User className="h-3 w-3 text-text-muted" />}
                        <span className={`px-2 py-0.5 border text-[9px] font-bold uppercase tracking-widest ${
                          member.role === 'admin' ? 'border-accent-purple text-accent-purple bg-accent-purple/5' : 'border-border bg-bg-elevated'
                        }`}>
                          {member.role}
                        </span>
                        {member.source === 'manual' && (
                          <span className="text-[7px] border border-accent-amber/30 text-accent-amber px-1 font-mono font-bold tracking-tighter">MANUAL</span>
                        )}
                      </div>
                    </td>
```

- [ ] **Step 2: Add enforcement to inline department edit**

In the inline edit save button (around line 261-267), disable save when the member is support and zero departments are selected. Replace the save button:

```typescript
                            <button
                              onClick={() => updateMemberMutation.mutate({ membershipId: member.membershipId, departments: editDepts })}
                              disabled={updateMemberMutation.isPending || (member.role === 'support' && editDepts.length === 0)}
                              className="flex-1 py-1.5 text-[9px] font-bold bg-accent-blue text-white uppercase border border-accent-blue hover:bg-accent-blue/90 disabled:opacity-50 transition-all"
                            >
                              {updateMemberMutation.isPending ? '...' : 'Save'}
                            </button>
```

After the checkbox list (after line 259), before the save/cancel buttons div, add a hint when support has zero:

```typescript
                          {member.role === 'support' && editDepts.length === 0 && (
                            <p className="text-[8px] font-bold uppercase text-accent-red tracking-widest">Support requires at least one department</p>
                          )}
```

- [ ] **Step 3: Commit**

```bash
git add client/src/components/admin/AdminTeam.tsx
git commit -m "feat(admin): MANUAL badge, inline dept edit enforcement"
```

---

### Task 9: Client — AdminTeam modals: enforce ≥1 dept for support + Select All

**Files:**
- Modify: `client/src/components/admin/AdminTeam.tsx:354-600` (AddExistingUserModal, InviteExternalUserModal)

- [ ] **Step 1: Update `AddExistingUserModal` — add Select All and enforce ≥1**

In `AddExistingUserModal` (starts at line 354), update the department section (line 408-429).

Add a "Select all / Deselect all" button and disable submit for support with no depts:

```typescript
          {role !== 'agent' && departments.length > 0 && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label className="text-[10px] font-bold uppercase tracking-widest text-text-muted">Departmental Assignments</label>
                <button
                  type="button"
                  onClick={() => setSelectedDepts(selectedDepts.length === departments.length ? [] : departments.map(d => d.id))}
                  className="text-[8px] font-bold uppercase tracking-widest text-accent-blue hover:underline"
                >
                  {selectedDepts.length === departments.length ? 'Deselect all' : 'Select all'}
                </button>
              </div>
              <div className="space-y-1.5 max-h-40 overflow-y-auto border-2 border-border p-3 bg-bg-elevated/30">
                {departments.map(d => (
                  <label key={d.id} className="flex items-center gap-3 text-xs font-bold uppercase cursor-pointer hover:text-accent-blue transition-colors py-1">
                    <input
                      type="checkbox"
                      checked={selectedDepts.includes(d.id)}
                      onChange={(e) => {
                        if (e.target.checked) setSelectedDepts([...selectedDepts, d.id]);
                        else setSelectedDepts(selectedDepts.filter(id => id !== d.id));
                      }}
                      className="w-4 h-4 accent-accent-blue"
                    />
                    {d.name}
                  </label>
                ))}
              </div>
              {role === 'support' && selectedDepts.length === 0 && (
                <p className="text-[8px] font-bold uppercase text-accent-red tracking-widest">Support requires at least one department</p>
              )}
            </div>
          )}
```

Update the submit button (line 432) to be disabled for support with no depts:

```typescript
            <button type="submit" disabled={addMutation.isPending || (role === 'support' && selectedDepts.length === 0)} className="flex-1 py-3 text-[11px] font-bold uppercase bg-accent-blue text-white hover:bg-accent-blue/90 disabled:opacity-50 transition-all">
              {addMutation.isPending ? 'Processing...' : 'Verify & Add'}
            </button>
```

- [ ] **Step 2: Update `InviteExternalUserModal` — same pattern**

In `InviteExternalUserModal` (starts at line 443), apply the same changes to its department section (line 581-598):

```typescript
          {role !== 'agent' && departments.length > 0 && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label className="text-[10px] font-bold uppercase tracking-widest text-text-muted">Assigned Departments</label>
                <button
                  type="button"
                  onClick={() => setSelectedDepts(selectedDepts.length === departments.length ? [] : departments.map(d => d.id))}
                  className="text-[8px] font-bold uppercase tracking-widest text-accent-blue hover:underline"
                >
                  {selectedDepts.length === departments.length ? 'Deselect all' : 'Select all'}
                </button>
              </div>
              <div className="grid grid-cols-2 gap-2 max-h-32 overflow-y-auto border-2 border-border p-3 bg-bg-elevated/30">
                {departments.map(d => (
                  <label key={d.id} className="flex items-center gap-3 text-[10px] font-bold uppercase cursor-pointer hover:text-accent-blue transition-colors py-1">
                    <input
                      type="checkbox"
                      checked={selectedDepts.includes(d.id)}
                      onChange={(e) => {
                        if (e.target.checked) setSelectedDepts([...selectedDepts, d.id]);
                        else setSelectedDepts(selectedDepts.filter(id => id !== d.id));
                      }}
                      className="w-4 h-4 accent-accent-blue"
                    />
                    {d.name}
                  </label>
                ))}
              </div>
              {role === 'support' && selectedDepts.length === 0 && (
                <p className="text-[8px] font-bold uppercase text-accent-red tracking-widest">Support requires at least one department</p>
              )}
            </div>
          )}
```

Update the submit button to be disabled for support with no depts. Find the submit button (around line 455) and add the disabled condition:

```typescript
            <button type="submit" disabled={inviteMutation.isPending || (role === 'support' && selectedDepts.length === 0)} className="flex-1 py-3 text-[11px] font-bold uppercase bg-accent-blue text-white hover:bg-accent-blue/90 disabled:opacity-50 transition-all">
```

- [ ] **Step 3: Commit**

```bash
git add client/src/components/admin/AdminTeam.tsx
git commit -m "feat(admin): enforce dept selection for support, add Select All"
```

---

### Task 10: Client — GroupMappingsPanel: department selection + enforcement

**Files:**
- Modify: `client/src/components/platform/GroupMappingsPanel.tsx:130-294`

- [ ] **Step 1: Update `AddMappingModal` — add department selection with Select All**

In `AddMappingModal` (line 130), add `selectedDepts` state after the existing state:

```typescript
  const [selectedDepts, setSelectedDepts] = useState<string[]>([]);
```

Get departments for the selected partner:

```typescript
  const selectedPartner = ssoPartners.find(p => p.id === partnerId);
  const partnerDepts = (selectedPartner?.departments as { id: string; name: string }[] | undefined) || [];
```

Reset departments when partner changes — add a `useEffect`:

```typescript
  // Need to import useEffect
  useEffect(() => {
    setSelectedDepts([]);
  }, [partnerId]);
```

Update `handleSubmit` to include departments:

```typescript
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    addMutation.mutate({
      partnerId,
      azureGroupId: azureGroupId.trim(),
      azureGroupName: azureGroupName.trim() || undefined,
      defaultRole,
      defaultDepartments: defaultRole === 'agent' ? [] : selectedDepts,
    });
  };
```

After the role `<select>` (after line 211), add department selection (before the buttons div):

```typescript
          {defaultRole !== 'agent' && partnerDepts.length > 0 && (
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="mono-label">{t('departments')}</label>
                <button
                  type="button"
                  onClick={() => setSelectedDepts(selectedDepts.length === partnerDepts.length ? [] : partnerDepts.map(d => d.id))}
                  className="text-[8px] font-bold uppercase tracking-widest text-[var(--color-accent-blue)] hover:underline"
                >
                  {selectedDepts.length === partnerDepts.length ? t('deselect_all') : t('select_all')}
                </button>
              </div>
              <div className="space-y-1 max-h-32 overflow-y-auto border border-[var(--color-border)] p-3">
                {partnerDepts.map(d => (
                  <label key={d.id} className="flex items-center gap-2 text-xs font-bold uppercase cursor-pointer hover:text-[var(--color-accent-blue)] py-0.5">
                    <input
                      type="checkbox"
                      checked={selectedDepts.includes(d.id)}
                      onChange={(e) => {
                        if (e.target.checked) setSelectedDepts([...selectedDepts, d.id]);
                        else setSelectedDepts(selectedDepts.filter(id => id !== d.id));
                      }}
                      className="w-3.5 h-3.5 accent-[var(--color-accent-blue)]"
                    />
                    {d.name}
                  </label>
                ))}
              </div>
              {defaultRole === 'support' && selectedDepts.length === 0 && (
                <p className="text-[8px] font-bold uppercase text-[var(--color-accent-red)] mt-1">{t('support_requires_department')}</p>
              )}
            </div>
          )}
```

Disable the submit button for support with no depts:

```typescript
            <button type="submit" disabled={addMutation.isPending || (defaultRole === 'support' && selectedDepts.length === 0)} className="btn-primary flex-1 py-3 uppercase text-[10px] tracking-widest disabled:opacity-30">
```

Update the import to include `useEffect`:

```typescript
import { useState, useEffect } from 'react';
```

Wait — the top-level component already imports `useState`. The `AddMappingModal` is a function inside the same file, so it shares the import. Just need to add `useEffect` to the existing import at line 1.

- [ ] **Step 2: Update `EditMappingModal` — add department selection with Select All**

In `EditMappingModal` (line 227), add department state. The mapping has `partnerId` — we need the partner's departments. Add to the function:

```typescript
  const { data: partnersList } = trpc.platform.listPartners.useQuery();
  const partner = partnersList?.find(p => p.id === mapping.partnerId);
  const partnerDepts = (partner?.departments as { id: string; name: string }[] | undefined) || [];
  const [selectedDepts, setSelectedDepts] = useState<string[]>((mapping.defaultDepartments as string[]) || []);
```

Update `handleSubmit`:

```typescript
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    updateMutation.mutate({
      id: mapping.id,
      azureGroupName: azureGroupName.trim() || undefined,
      defaultRole,
      defaultDepartments: defaultRole === 'agent' ? [] : selectedDepts,
    });
  };
```

After the role `<select>` (after line 280), add department selection:

```typescript
          {defaultRole !== 'agent' && partnerDepts.length > 0 && (
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="mono-label">{t('departments')}</label>
                <button
                  type="button"
                  onClick={() => setSelectedDepts(selectedDepts.length === partnerDepts.length ? [] : partnerDepts.map(d => d.id))}
                  className="text-[8px] font-bold uppercase tracking-widest text-[var(--color-accent-blue)] hover:underline"
                >
                  {selectedDepts.length === partnerDepts.length ? t('deselect_all') : t('select_all')}
                </button>
              </div>
              <div className="space-y-1 max-h-32 overflow-y-auto border border-[var(--color-border)] p-3">
                {partnerDepts.map(d => (
                  <label key={d.id} className="flex items-center gap-2 text-xs font-bold uppercase cursor-pointer hover:text-[var(--color-accent-blue)] py-0.5">
                    <input
                      type="checkbox"
                      checked={selectedDepts.includes(d.id)}
                      onChange={(e) => {
                        if (e.target.checked) setSelectedDepts([...selectedDepts, d.id]);
                        else setSelectedDepts(selectedDepts.filter(id => id !== d.id));
                      }}
                      className="w-3.5 h-3.5 accent-[var(--color-accent-blue)]"
                    />
                    {d.name}
                  </label>
                ))}
              </div>
              {defaultRole === 'support' && selectedDepts.length === 0 && (
                <p className="text-[8px] font-bold uppercase text-[var(--color-accent-red)] mt-1">{t('support_requires_department')}</p>
              )}
            </div>
          )}
```

Disable the submit button:

```typescript
            <button type="submit" disabled={updateMutation.isPending || (defaultRole === 'support' && selectedDepts.length === 0)} className="btn-primary flex-1 py-3 uppercase text-[10px] tracking-widest disabled:opacity-30">
```

- [ ] **Step 3: Commit**

```bash
git add client/src/components/platform/GroupMappingsPanel.tsx
git commit -m "feat(platform): dept selection in group mappings, enforce for support"
```

---

### Task 11: Client — QueueSidebar empty state for unconfigured support

**Files:**
- Modify: `client/src/components/support/QueueSidebar.tsx:76-81` (department logic), render section

- [ ] **Step 1: Update department logic**

In `QueueSidebar.tsx`, replace the generalist logic (lines 76-81):

```typescript
  const departments = (activeMembership.manifest?.departments || []) as { id: string; name: string }[];
  const assignedDepartmentIds = activeMembership.departments || [];
  const hasNoDepartments = assignedDepartmentIds.length === 0;
  const visibleDepartments = hasNoDepartments
    ? []
    : departments.filter((d) => assignedDepartmentIds.includes(d.id));
```

- [ ] **Step 2: Add empty state rendering**

In the return statement, wrap the entire sidebar content in a check. After the opening `<aside>` tag and just before `{/* Header: tabs + dept chips */}`, add:

```typescript
      {hasNoDepartments ? (
        <div className="flex-1 flex flex-col items-center justify-center p-6 text-center">
          <Shield className="h-8 w-8 text-text-muted opacity-30 mb-4" />
          <p className="text-sm font-bold uppercase tracking-tight mb-2">{t('no_departments_assigned')}</p>
          <p className="text-[10px] uppercase tracking-widest text-text-muted opacity-60">{t('contact_admin_departments')}</p>
        </div>
      ) : (
```

Close the ternary at the end of the sidebar content (before the closing `</aside>`):

```typescript
      )}
```

Add `Shield` to the lucide-react import at the top of the file.

- [ ] **Step 3: Add i18n keys**

The i18n keys `no_departments_assigned` and `contact_admin_departments` need to be added to the translation files. Check the existing i18n pattern and add:

- `no_departments_assigned`: "No departments assigned"
- `contact_admin_departments`: "Contact your administrator to configure department access."

Also add `support_requires_department`: "Support requires at least one department" (used in Task 10).

And `select_all` / `deselect_all` if not already present.

- [ ] **Step 4: Commit**

```bash
git add client/src/components/support/QueueSidebar.tsx
git commit -m "feat(support): show empty state for unconfigured departments"
```

---

### Task 12: Seed script update

**Files:**
- Modify: `server/seed.ts:188-194`

- [ ] **Step 1: Add `source` to seeded memberships**

In `server/seed.ts`, update the membership insert (line 188-194):

```typescript
      await db.insert(schema.memberships).values({
        id: `mem_${user.id}_${pId}`,
        userId: user.id,
        partnerId: pId,
        role: role as any,
        departments: role === 'agent' ? [] : faker.helpers.arrayElements(DEPARTMENTS.map(d => d.id), { min: 1, max: 3 }),
        source: 'sso',
      });
```

- [ ] **Step 2: Commit**

```bash
git add server/seed.ts
git commit -m "chore(seed): add source field to seeded memberships"
```

---

### Task 13: Verify — typecheck and test

- [ ] **Step 1: Run typecheck**

```bash
docker compose exec server npx tsc --noEmit
docker compose exec client npx tsc --noEmit
```

Expected: No errors.

- [ ] **Step 2: Run server tests**

```bash
docker compose exec server npm test
```

Expected: All tests pass.

- [ ] **Step 3: Run client tests**

```bash
docker compose exec client npm test
```

Expected: All tests pass.

- [ ] **Step 4: Fix any issues and commit**

If any typecheck or test failures, fix them and commit:

```bash
git commit -m "fix: resolve typecheck/test issues from department enforcement"
```
