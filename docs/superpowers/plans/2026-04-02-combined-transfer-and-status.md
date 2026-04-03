# Department Transfer + Agent Status Visibility — Combined Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** (1) Replace agent-to-agent ticket transfer with department-based transfer. (2) Make agent statuses visible to team leads in real-time with time-in-status tracking.

**Architecture:** Department transfer rewrites the `ticket:transfer` socket handler to target departments instead of agents, with optional whisper notes. Status visibility extends the existing Redis presence system, adds `agent_status_log` + `daily_agent_status` DB tables, wires `status:set` to the 5 new status values, and adds team status panels in QueueSidebar, AdminTeam, AdminStats, and SupportNav.

**Tech Stack:** React 19, Zustand 5, Recharts, Socket.io, tRPC 11, Drizzle ORM, PostgreSQL, Redis, Vitest

**Specs:**
- `docs/superpowers/specs/2026-04-02-department-transfer-design.md`
- `docs/superpowers/specs/2026-04-02-agent-status-visibility-design.md`

---

## Phase A: Department-Based Ticket Transfer

---

### Task 1: Add all new translation keys (transfer + status)

**Files:**
- Modify: `client/src/locales/en.ts`
- Modify: `client/src/locales/fr.ts`
- Modify: `client/src/locales/nl.ts`

- [ ] **Step 1: Add new keys and remove obsolete keys in en.ts**

Add after the `close_ticket_body` line:

```typescript
    transfer: 'Transfer',
    transfer_to_department: 'Transfer to department',
    transfer_note_placeholder: 'Add context for the next agent...',
    return_to_queue: 'Return to queue',
    ticket_transferred_to: 'Ticket transferred to',
```

Remove `transfer_to` and `no_other_support_online` — they are no longer used.

Add after the existing `status_training` key:

```typescript
    status_offline: 'Offline',
    team_capacity: 'Team Capacity',
    team_status: 'Team Status',
    time_in_status: 'Time in Status',
    available_label: 'Available',
    online_team: 'Online Team',
```

- [ ] **Step 2: Add new keys and remove obsolete keys in fr.ts**

Add transfer keys:

```typescript
    transfer: 'Transférer',
    transfer_to_department: 'Transférer au département',
    transfer_note_placeholder: 'Ajouter du contexte pour le prochain agent...',
    return_to_queue: 'Remettre en file d\'attente',
    ticket_transferred_to: 'Ticket transféré vers',
```

Remove `transfer_to` and `no_other_support_online`.

Add status keys:

```typescript
    status_offline: 'Hors ligne',
    team_capacity: 'Capacité de l\'équipe',
    team_status: 'Statut de l\'équipe',
    time_in_status: 'Temps par statut',
    available_label: 'Disponible',
    online_team: 'Équipe en ligne',
```

- [ ] **Step 3: Add new keys and remove obsolete keys in nl.ts**

Add transfer keys:

```typescript
    transfer: 'Overdragen',
    transfer_to_department: 'Overdragen naar afdeling',
    transfer_note_placeholder: 'Voeg context toe voor de volgende agent...',
    return_to_queue: 'Terug naar wachtrij',
    ticket_transferred_to: 'Ticket overgedragen naar',
```

Remove `transfer_to` and `no_other_support_online`.

Add status keys:

```typescript
    status_offline: 'Offline',
    team_capacity: 'Teamcapaciteit',
    team_status: 'Teamstatus',
    time_in_status: 'Tijd per status',
    available_label: 'Beschikbaar',
    online_team: 'Online team',
```

- [ ] **Step 4: Commit**

```bash
git add client/src/locales/en.ts client/src/locales/fr.ts client/src/locales/nl.ts
git commit -m "feat(i18n): add translation keys for department transfer and agent status visibility

Adds transfer_to_department, return_to_queue, ticket_transferred_to,
status_offline, team_capacity, team_status, time_in_status, online_team.
Removes obsolete transfer_to and no_other_support_online."
```

---

### Task 2: Add service functions for department transfer

**Files:**
- Create: `server/services/transferService.ts`
- Modify: `server/services/systemMessage.ts`

The handlers.ts file delegates to service-layer functions — it never calls `db` directly. We need to create the service functions first.

- [ ] **Step 1: Add `insertWhisperMessage` to systemMessage.ts**

In `server/services/systemMessage.ts`, add after the existing `insertSystemMessage`:

```typescript
/**
 * Inserts a whisper message (visible only to support staff) into a ticket.
 * Used for context handoff during department transfers.
 */
export async function insertWhisperMessage(
  ticketId: string,
  senderId: string,
  senderName: string,
  senderRole: string,
  senderLang: string,
  text: string,
) {
  return insertMessage({
    ticketId,
    senderId,
    senderName,
    senderRole,
    senderLang,
    text,
    whisper: true,
  });
}
```

- [ ] **Step 2: Create transferService.ts**

Create `server/services/transferService.ts`:

```typescript
import { eq } from 'drizzle-orm';
import { db } from '../db/postgres.js';
import { partners, tickets } from '../db/schema.js';

export interface PartnerDepartment {
  id: string;
  name: string;
  description?: string;
}

/**
 * Fetches the departments JSONB array for a partner.
 */
export async function findPartnerDepartments(partnerId: string): Promise<PartnerDepartment[]> {
  const rows = await db
    .select({ departments: partners.departments })
    .from(partners)
    .where(eq(partners.id, partnerId))
    .limit(1);

  if (!rows.length) return [];
  return (rows[0].departments as PartnerDepartment[]) || [];
}

/**
 * Transfers a ticket to a new department.
 * Clears support assignment and re-opens the ticket.
 */
export async function transferTicketToDepartment(ticketId: string, departmentId: string): Promise<void> {
  await db
    .update(tickets)
    .set({
      dept: departmentId,
      supportId: null,
      supportName: null,
      status: 'open',
    })
    .where(eq(tickets.id, ticketId));
}
```

- [ ] **Step 3: Commit**

```bash
git add server/services/transferService.ts server/services/systemMessage.ts
git commit -m "feat(server): add transfer service and whisper message helper

findPartnerDepartments queries partner dept config.
transferTicketToDepartment clears assignment and re-opens ticket.
insertWhisperMessage delegates to insertMessage with whisper flag."
```

---

### Task 3: Rewrite server transfer handler

**Files:**
- Modify: `server/socket/handlers.ts`

- [ ] **Step 1: Update imports at the top of handlers.ts**

Add the new service imports:

```typescript
import { findPartnerDepartments, transferTicketToDepartment } from '../services/transferService.js';
import { insertWhisperMessage } from '../services/systemMessage.js';
```

Remove `transferTicket` from the `ticketQueries.js` import (line 22).
Remove `findTargetSupport` from the `userQueries.js` import (line 37).

- [ ] **Step 2: Rewrite the `ticket:transfer` handler**

Find the `socket.on('ticket:transfer', ...)` handler (starts around line 922). Replace the entire handler:

Old signature: `{ ticketId, targetSupportId?: string }`
New signature: `{ ticketId, departmentId?: string, note?: string }`

```typescript
socket.on('ticket:transfer', async ({ ticketId, departmentId, note }: { ticketId: string; departmentId?: string; note?: string }) => {
  if (!requireIdentified(socket)) return;
  socketioEventsTotal.inc({ event: 'ticket:transfer' });
  try {
    const senderId = socket.data.userId;
    const senderName = socket.data.name;
    const callerPartnerId = socket.data.partnerId;

    if (!socket.data.isSupport) {
      return socket.emit('error', { message: 'Only support staff can transfer tickets' });
    }

    const ticket = await requirePartnerScopeWith(socket, ticketId, findTicketForTransfer);
    if (!ticket) return;

    if (departmentId) {
      // Transfer to a different department
      const depts = await findPartnerDepartments(callerPartnerId);
      const targetDept = depts.find(d => d.id === departmentId);
      if (!targetDept) return socket.emit('error', { message: 'Department not found' });

      // Optional whisper note for context handoff
      if (note?.trim()) {
        const senderInfo = await findSenderInfo(senderId, callerPartnerId);
        const whisperMsg = await insertWhisperMessage(
          ticketId, senderId, senderName,
          senderInfo?.role || 'support', senderInfo?.lang || 'en',
          note.trim(),
        );
        io.to(Rooms.ticket(ticketId)).emit('message:new', whisperMsg);
      }

      // Update ticket: new department, clear support assignment, re-open
      await transferTicketToDepartment(ticketId, departmentId);

      // System message
      const sysText = `Ticket transferred to ${targetDept.name} by ${senderName}`;
      const sysMsg = await insertSystemMessage(ticketId, sysText);
      io.to(Rooms.ticket(ticketId)).emit('message:new', sysMsg);
      io.to(Rooms.ticket(ticketId)).emit('ticket:transferred', {
        ticketId,
        fromId: senderId,
        fromName: senderName,
        toDepartment: departmentId,
        toDepartmentName: targetDept.name,
      });

      // Remove ALL support sockets from ticket room
      const ticketRoom = Rooms.ticket(ticketId);
      const socketsInRoom = await io.in(ticketRoom).fetchSockets();
      for (const s of socketsInRoom) {
        if (s.data.isSupport) s.leave(ticketRoom);
      }

      // Broadcast queue positions for both departments
      await broadcastQueuePositions(callerPartnerId);
    } else {
      // Return to queue — same department, unassign support
      await returnTicketToQueue(ticketId);

      const sysText = `${senderName} returned ticket to queue`;
      const sysMsg = await insertSystemMessage(ticketId, sysText);
      io.to(Rooms.ticket(ticketId)).emit('message:new', sysMsg);
      io.to(Rooms.ticket(ticketId)).emit('ticket:transferred', {
        ticketId,
        fromId: senderId,
        fromName: senderName,
        toId: null,
        toName: null,
      });

      // Remove sender from ticket room
      socket.leave(Rooms.ticket(ticketId));

      await broadcastQueuePositions(callerPartnerId);
    }
  } catch (err: unknown) {
    logger.error({ err: err instanceof Error ? err.message : String(err) }, '[ticket:transfer] error');
  }
});
```

- [ ] **Step 3: Commit**

```bash
git add server/socket/handlers.ts
git commit -m "feat(server): rewrite ticket:transfer for department-based transfer

Replaces agent-to-agent transfer with department transfer.
Uses service-layer functions (findPartnerDepartments,
transferTicketToDepartment, insertWhisperMessage).
Removes unused transferTicket and findTargetSupport imports."
```

---

### Task 4: Rewrite client transfer menu for department selection

**Files:**
- Modify: `client/src/components/ChatWindow.tsx`

- [ ] **Step 1: Add `usePartner` import and hook call**

At the top of ChatWindow.tsx, import `usePartner`:

```typescript
import { usePartner } from '../hooks/usePartner';
```

Inside the component, call the hook to get departments:

```typescript
const { manifest } = usePartner();
```

- [ ] **Step 2: Add transfer note state**

Near the existing `showTransferMenu` state (line 57), add:

```typescript
const [transferNote, setTransferNote] = useState('');
```

- [ ] **Step 3: Rewrite the `transferTicket` function**

Replace the existing function (lines 479–483):

Old:
```typescript
function transferTicket(targetSupportId?: string) {
  getSocket().emit('ticket:transfer', { ticketId: ticket!.id, targetSupportId: targetSupportId || undefined });
  setShowTransferMenu(false);
  if (onClose) onClose();
}
```

New:
```typescript
function transferTicket(departmentId?: string) {
  getSocket().emit('ticket:transfer', {
    ticketId: ticket!.id,
    departmentId: departmentId || undefined,
    note: transferNote.trim() || undefined,
  });
  setShowTransferMenu(false);
  setTransferNote('');
  if (onClose) onClose();
}
```

- [ ] **Step 4: Remove `transferTargets` line**

Delete this line (around line 486):
```typescript
const transferTargets = (onlineSupportUsers || []).filter(s => s.userId !== user?.id);
```

It is no longer used.

- [ ] **Step 5: Compute available departments**

Add a filtered department list (place near where `transferTargets` was):

```typescript
const transferDepartments = (manifest?.departments || []).filter(
  (d: { id: string; name: string }) => d.id !== ticket?.dept
);
```

This excludes the ticket's current department from the list.

- [ ] **Step 6: Rewrite the transfer menu JSX**

Replace the entire transfer menu block (lines 598–635) with department-based UI:

```tsx
<div className="relative">
  <button
    onClick={() => setShowTransferMenu(!showTransferMenu)}
    aria-label={t('transfer') || 'Transfer'}
    title={t('transfer') || 'Transfer'}
    className={`text-xs font-bold bg-bg-elevated text-text-primary hover:bg-bg-elevated border border-border-heavy hidden sm:block ${focusMode ? 'px-2.5 py-1.5' : 'px-4 py-2'}`}
  >
    {t('transfer') || 'Transfer'}
  </button>
  {showTransferMenu && (
    <div className="absolute right-0 top-full mt-1 bg-bg-surface border-2 border-border-heavy min-w-[220px] z-50 overflow-hidden">
      <button
        onClick={() => transferTicket()}
        className="w-full text-left px-4 py-2.5 text-xs font-bold hover:bg-bg-elevated border-b border-border"
      >
        {t('return_to_queue') || 'Return to queue'}
      </button>
      {transferDepartments.length > 0 && (
        <>
          <div className="px-3 py-1.5">
            <span className="text-[9px] font-mono font-bold uppercase tracking-widest text-text-primary opacity-40">
              {t('transfer_to_department') || 'Transfer to department'}
            </span>
          </div>
          <div className="px-3 pb-2">
            <input
              type="text"
              value={transferNote}
              onChange={(e) => setTransferNote(e.target.value)}
              placeholder={t('transfer_note_placeholder') || 'Add context for the next agent...'}
              className="w-full text-[11px] bg-bg-elevated border border-border px-2 py-1.5 text-text-primary placeholder:text-text-muted placeholder:opacity-40"
            />
          </div>
        </>
      )}
      {transferDepartments.map((d: { id: string; name: string }) => (
        <button
          key={d.id}
          onClick={() => transferTicket(d.id)}
          className="w-full text-left px-4 py-2 text-xs font-mono font-bold hover:bg-bg-elevated"
        >
          {d.name}
        </button>
      ))}
    </div>
  )}
</div>
```

- [ ] **Step 7: Remove `onlineSupportUsers` from store selector if unused elsewhere in file**

Check if `onlineSupportUsers` is used anywhere else in ChatWindow.tsx. If it was only used for `transferTargets`, remove it from the `useStoreShallow` selector to avoid pulling unnecessary state.

- [ ] **Step 8: Commit**

```bash
git add client/src/components/ChatWindow.tsx
git commit -m "feat(client): rewrite transfer menu for department-based transfer

Shows partner departments instead of online agents. Adds optional
transfer note input for context handoff. Uses font-mono for department
names per brutalist design spec."
```

---

### Task 5: Type check and test department transfer

**Files:**
- No new files

- [ ] **Step 1: Run TypeScript type check**

```bash
docker compose exec client npx tsc --noEmit
docker compose exec server npx tsc --noEmit
```

Expected: no errors. If there are errors, fix them (likely unused imports or changed event payload types).

- [ ] **Step 2: Run client tests**

```bash
docker compose exec client npm test
```

Expected: all existing tests pass. If any tests reference `targetSupportId` or `transferTargets`, update them to use `departmentId` and `transferDepartments`.

- [ ] **Step 3: Run server tests**

```bash
docker compose exec server npm test
```

Expected: all existing tests pass. If any tests reference the old `transferTicket(ticketId, targetSupportId, ...)` signature, update them.

- [ ] **Step 4: Commit any fixes**

```bash
git add -A
git commit -m "fix: resolve type errors and test failures from department transfer changes"
```

---

## Phase B: Agent Status Visibility

---

### Task 6: Update status values in socket handler and presence service

**Files:**
- Modify: `server/socket/handlers.ts`
- Modify: `server/services/presence.ts`
- Modify: `server/trpc/routers/presence.ts`
- Modify: `client/src/components/StatusPicker.tsx`

The existing `status:set` handler (line 605) only accepts `['available', 'busy', 'away']`. The StatusPicker emits `support:status` but the server listens for `status:set`. We need to align both sides on the same event name and the 5 new status values.

- [ ] **Step 1: Update VALID_STATUSES in handlers.ts**

In `server/socket/handlers.ts`, find the `status:set` handler at line 605. Replace the handler:

```typescript
socket.on('status:set', async ({ status }: { status: string }) => {
  if (!requireIdentified(socket)) return;
  const VALID_STATUSES = ['available', 'break', 'lunch', 'meeting', 'training'] as const;
  if (!VALID_STATUSES.includes(status as typeof VALID_STATUSES[number])) return;
  const userId = socket.data.userId;
  const partnerId = socket.data.partnerId;
  if (userId && partnerId) {
    await presenceService.setUserStatus(userId, partnerId, status);
  }
});
```

- [ ] **Step 2: Update StatusPicker to emit `status:set` instead of `support:status`**

In `client/src/components/StatusPicker.tsx`, the `handleChange` function (line 40) emits `support:status`. Change it to `status:set` to match the server handler:

```typescript
function handleChange(newStatus: string) {
  setValue(newStatus);
  setOpen(false);

  if (user) {
    getSocket().emit('status:set', { status: newStatus });
  }
}
```

Remove the `userId` field from the payload — the server uses `socket.data.userId`.

- [ ] **Step 3: Update tRPC presence router status enum**

In `server/trpc/routers/presence.ts`, line 26, update the z.enum to match:

```typescript
status: z.enum(['available', 'break', 'lunch', 'meeting', 'training']),
```

- [ ] **Step 4: Add `statusChangedAt` to Redis presence hash**

In `server/services/presence.ts`, update `setUserStatus` (line 141) to also store the timestamp:

```typescript
export async function setUserStatus(userId: string, partnerId: string, status: string) {
  const { pubClient } = getRedisClients();
  if (!pubClient) return false;

  const key = hashKey(partnerId, userId);
  try {
    const user = await pubClient.hGetAll(key);
    if (user && user.userId) {
      await pubClient.hSet(key, 'status', status);
      await pubClient.hSet(key, 'statusChangedAt', new Date().toISOString());
      await broadcastOnlineSupport(partnerId);
      logger.info({ userId, status }, 'User status updated in Redis');
      return true;
    }
  } catch (err) {
    logger.error({ err, userId }, 'Failed to update user status in Redis');
  }
  return false;
}
```

- [ ] **Step 5: Commit**

```bash
git add server/socket/handlers.ts server/services/presence.ts server/trpc/routers/presence.ts client/src/components/StatusPicker.tsx
git commit -m "feat: align status values and event names across server and client

Updates VALID_STATUSES to available/break/lunch/meeting/training.
StatusPicker now emits status:set (matching server handler).
Adds statusChangedAt to Redis presence hash."
```

---

### Task 7: Fix `identifyUser` Lua script to preserve status on reconnect

**Files:**
- Modify: `server/services/presence.ts`
- Modify: `server/socket/handlers.ts`
- Modify: `client/src/components/StatusPicker.tsx`

- [ ] **Step 1: Fix the Lua script in `identifyUser` to preserve status on reconnect**

In `server/services/presence.ts`, find the `identifyUser` function (line 76). The Lua script currently resets `status` to `'available'` in BOTH the `exists == 0` (new user) AND `else` (reconnect) branches. Fix the `else` branch to preserve the existing status:

Replace the entire Lua script:

```lua
      local key = KEYS[1]
      local sKey = KEYS[2]
      local userId = ARGV[1]
      local name = ARGV[2]
      local role = ARGV[3]
      local partnerId = ARGV[4]
      local isPlatformOp = ARGV[5]
      local ttl = tonumber(ARGV[6])

      local exists = redis.call('EXISTS', key)
      if exists == 0 then
        redis.call('HSET', key,
          'userId', userId,
          'name', name,
          'role', role,
          'partnerId', partnerId,
          'isPlatformOperator', isPlatformOp,
          'status', 'available',
          'statusChangedAt', ARGV[7],
          'count', '1')
      else
        -- Preserve existing status and statusChangedAt on reconnect
        redis.call('HSET', key,
          'userId', userId,
          'name', name,
          'role', role,
          'partnerId', partnerId,
          'isPlatformOperator', isPlatformOp)
        redis.call('HINCRBY', key, 'count', 1)
      end
      redis.call('EXPIRE', key, ttl)
      redis.call('SADD', sKey, userId)
      redis.call('EXPIRE', sKey, ttl)
      return exists
```

And update the `arguments` array in the `pubClient.eval()` call to include the 7th argument:

```typescript
    await pubClient.eval(luaScript, {
      keys: [key, sKey],
      arguments: [
        userId,
        name,
        role,
        partnerId,
        isPlatformOperator ? '1' : '0',
        String(TTL_SECONDS),
        new Date().toISOString(),
      ],
    });
```

The key change: the `else` branch (reconnect) no longer sets `'status', 'available'` — it preserves whatever status the user had before reconnecting.

- [ ] **Step 2: Add `getUserStatus` helper to presence.ts**

In `server/services/presence.ts`, add after `setUserStatus`:

```typescript
export async function getUserStatus(userId: string, partnerId: string): Promise<string | null> {
  const { pubClient } = getRedisClients();
  if (!pubClient) return null;

  const key = hashKey(partnerId, userId);
  try {
    return await pubClient.hGet(key, 'status') || null;
  } catch (err) {
    logger.error({ err, userId }, 'Failed to get user status from Redis');
    return null;
  }
}
```

- [ ] **Step 3: Restore persisted status on reconnect in socket:identify**

In `server/socket/handlers.ts`, in the `socket:identify` handler (around line 352), after `identifyUser` is called and `broadcastOnlineSupport` fires, read the user's persisted status from Redis and emit it back.

Find the section after `identifyUser` completes (around line 430). Add before the ticket room rejoin:

```typescript
// Restore persisted status to client
const persistedStatus = await presenceService.getUserStatus(userId, partnerId);
if (persistedStatus && persistedStatus !== 'available') {
  socket.emit('status:restored', { status: persistedStatus });
}
```

- [ ] **Step 4: Handle `status:restored` in StatusPicker**

In `client/src/components/StatusPicker.tsx`, add a `useEffect` to listen for the restore event:

```typescript
useEffect(() => {
  const socket = getSocket();
  function onStatusRestored({ status }: { status: string }) {
    const valid = STATUSES.find((s) => s.key === status);
    if (valid) setValue(status);
  }
  socket.on('status:restored', onStatusRestored);
  return () => { socket.off('status:restored', onStatusRestored); };
}, []);
```

Add this after the existing `useEffect` for outside clicks.

- [ ] **Step 5: Commit**

```bash
git add server/services/presence.ts server/socket/handlers.ts client/src/components/StatusPicker.tsx
git commit -m "feat: persist status across reconnects

Stores statusChangedAt in Redis on identify. Restores persisted
status to client via status:restored event on reconnect."
```

---

### Task 8: Add DB tables for status tracking

**Files:**
- Modify: `server/db/schema.ts`

- [ ] **Step 1: Add `agentStatusLog` table**

In `server/db/schema.ts`, add before the `savedViews` table (around line 443):

```typescript
// ─── Agent Status Tracking ──────────────────────────────────────────────────

/**
 * Granular status transition log.
 * Each row = one status period (startedAt → endedAt).
 * endedAt is null for the agent's current status.
 */
export const agentStatusLog = pgTable('agent_status_log', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  partnerId: text('partner_id').notNull().references(() => partners.id, { onDelete: 'cascade' }),
  status: text('status').notNull(),
  startedAt: timestamp('started_at', { mode: 'string' }).notNull().defaultNow(),
  endedAt: timestamp('ended_at', { mode: 'string' }),
  duration: integer('duration'),
}, (table) => ({
  userPartnerIdx: index('idx_agent_status_log_user_partner').on(table.userId, table.partnerId),
  partnerStartedIdx: index('idx_agent_status_log_partner_started').on(table.partnerId, table.startedAt),
  openRowIdx: index('idx_agent_status_log_open').on(table.userId, table.partnerId).where(sql`ended_at IS NULL`),
}));
```

- [ ] **Step 2: Add `dailyAgentStatus` table**

Add directly after `agentStatusLog`:

```typescript
/**
 * Daily rollup of agent time-in-status.
 * One row per user × partner × day.
 * Aggregated from agent_status_log for fast dashboard queries.
 */
export const dailyAgentStatus = pgTable('daily_agent_status', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  date: text('date').notNull(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  partnerId: text('partner_id').notNull().references(() => partners.id, { onDelete: 'cascade' }),
  availableSeconds: integer('available_seconds').notNull().default(0),
  breakSeconds: integer('break_seconds').notNull().default(0),
  lunchSeconds: integer('lunch_seconds').notNull().default(0),
  meetingSeconds: integer('meeting_seconds').notNull().default(0),
  trainingSeconds: integer('training_seconds').notNull().default(0),
  createdAt: timestamp('created_at', { mode: 'string' }).notNull().defaultNow(),
}, (table) => ({
  partnerDateIdx: index('idx_daily_agent_status_partner_date').on(table.partnerId, table.date),
  uniqueDayKey: uniqueIndex('idx_daily_agent_status_unique').on(table.date, table.userId, table.partnerId),
}));
```

- [ ] **Step 3: Push schema to database**

```bash
docker compose exec server npx drizzle-kit push
```

Expected: two new tables created, no errors.

- [ ] **Step 4: Commit**

```bash
git add server/db/schema.ts
git commit -m "feat(db): add agent_status_log and daily_agent_status tables

agent_status_log tracks granular status transitions per agent.
daily_agent_status stores pre-aggregated daily time-in-status rollups."
```

---

### Task 9: Create status tracking service

**Files:**
- Create: `server/services/statusTracking.ts`

- [ ] **Step 1: Create the service file**

Create `server/services/statusTracking.ts`:

```typescript
import { eq, and, isNull, sql, gte, lte } from 'drizzle-orm';
import { db } from '../db/postgres.js';
import { agentStatusLog, dailyAgentStatus } from '../db/schema.js';
import logger from '../utils/logger.js';

/**
 * Log a status transition. Closes the previous open row and opens a new one.
 */
export async function logTransition(userId: string, partnerId: string, newStatus: string): Promise<void> {
  const now = new Date();
  const nowIso = now.toISOString();

  try {
    // Close any open row for this user+partner
    const openRows = await db
      .select()
      .from(agentStatusLog)
      .where(and(
        eq(agentStatusLog.userId, userId),
        eq(agentStatusLog.partnerId, partnerId),
        isNull(agentStatusLog.endedAt),
      ))
      .limit(1);

    if (openRows.length > 0) {
      const openRow = openRows[0];
      const startedAt = new Date(openRow.startedAt);
      const durationSec = Math.round((now.getTime() - startedAt.getTime()) / 1000);

      await db
        .update(agentStatusLog)
        .set({ endedAt: nowIso, duration: durationSec })
        .where(eq(agentStatusLog.id, openRow.id));
    }

    // Open a new row for the new status
    await db.insert(agentStatusLog).values({
      userId,
      partnerId,
      status: newStatus,
      startedAt: nowIso,
    });
  } catch (err) {
    logger.error({ err: err instanceof Error ? err.message : String(err), userId, partnerId }, '[statusTracking] logTransition error');
  }
}

/**
 * Close any open status row for a user (called on disconnect).
 */
export async function closeOpenRow(userId: string, partnerId: string): Promise<void> {
  const now = new Date();
  const nowIso = now.toISOString();

  try {
    const openRows = await db
      .select()
      .from(agentStatusLog)
      .where(and(
        eq(agentStatusLog.userId, userId),
        eq(agentStatusLog.partnerId, partnerId),
        isNull(agentStatusLog.endedAt),
      ))
      .limit(1);

    if (openRows.length > 0) {
      const openRow = openRows[0];
      const startedAt = new Date(openRow.startedAt);
      const durationSec = Math.round((now.getTime() - startedAt.getTime()) / 1000);

      await db
        .update(agentStatusLog)
        .set({ endedAt: nowIso, duration: durationSec })
        .where(eq(agentStatusLog.id, openRow.id));
    }
  } catch (err) {
    logger.error({ err: err instanceof Error ? err.message : String(err), userId, partnerId }, '[statusTracking] closeOpenRow error');
  }
}

/**
 * Get daily time-in-status for a single agent.
 */
export async function getAgentDailyStats(userId: string, partnerId: string, fromDate: string, toDate: string) {
  try {
    return await db
      .select()
      .from(dailyAgentStatus)
      .where(and(
        eq(dailyAgentStatus.userId, userId),
        eq(dailyAgentStatus.partnerId, partnerId),
        gte(dailyAgentStatus.date, fromDate),
        lte(dailyAgentStatus.date, toDate),
      ))
      .orderBy(dailyAgentStatus.date);
  } catch (err) {
    logger.error({ err: err instanceof Error ? err.message : String(err), userId, partnerId }, '[statusTracking] getAgentDailyStats error');
    return [];
  }
}

/**
 * Get daily time-in-status for all agents in a partner.
 */
export async function getTeamDailyStats(partnerId: string, fromDate: string, toDate: string) {
  try {
    return await db
      .select()
      .from(dailyAgentStatus)
      .where(and(
        eq(dailyAgentStatus.partnerId, partnerId),
        gte(dailyAgentStatus.date, fromDate),
        lte(dailyAgentStatus.date, toDate),
      ))
      .orderBy(dailyAgentStatus.date);
  } catch (err) {
    logger.error({ err: err instanceof Error ? err.message : String(err), partnerId }, '[statusTracking] getTeamDailyStats error');
    return [];
  }
}

/**
 * Roll up agent_status_log rows into daily_agent_status for a given date.
 * Uses UPSERT for idempotency.
 */
export async function rollupDay(partnerId: string, dateStr: string): Promise<void> {
  try {
    const dayStart = `${dateStr}T00:00:00.000Z`;
    const dayEnd = `${dateStr}T23:59:59.999Z`;

    // Get all rows that overlap with this day
    const rows = await db
      .select()
      .from(agentStatusLog)
      .where(and(
        eq(agentStatusLog.partnerId, partnerId),
        lte(agentStatusLog.startedAt, dayEnd),
        gte(sql`COALESCE(${agentStatusLog.endedAt}, NOW()::text)`, dayStart),
      ));

    // Group by userId and accumulate seconds per status
    const userTotals = new Map<string, Record<string, number>>();

    for (const row of rows) {
      const start = new Date(Math.max(new Date(row.startedAt).getTime(), new Date(dayStart).getTime()));
      const end = row.endedAt
        ? new Date(Math.min(new Date(row.endedAt).getTime(), new Date(dayEnd).getTime()))
        : new Date(Math.min(Date.now(), new Date(dayEnd).getTime()));
      const seconds = Math.max(0, Math.round((end.getTime() - start.getTime()) / 1000));

      if (!userTotals.has(row.userId)) {
        userTotals.set(row.userId, { available: 0, break: 0, lunch: 0, meeting: 0, training: 0 });
      }
      const totals = userTotals.get(row.userId)!;
      if (totals[row.status] !== undefined) {
        totals[row.status] += seconds;
      }
    }

    // Upsert into daily_agent_status
    for (const [userId, totals] of userTotals) {
      await db
        .insert(dailyAgentStatus)
        .values({
          date: dateStr,
          userId,
          partnerId,
          availableSeconds: totals.available,
          breakSeconds: totals.break,
          lunchSeconds: totals.lunch,
          meetingSeconds: totals.meeting,
          trainingSeconds: totals.training,
        })
        .onConflictDoUpdate({
          target: [dailyAgentStatus.date, dailyAgentStatus.userId, dailyAgentStatus.partnerId],
          set: {
            availableSeconds: sql`EXCLUDED.available_seconds`,
            breakSeconds: sql`EXCLUDED.break_seconds`,
            lunchSeconds: sql`EXCLUDED.lunch_seconds`,
            meetingSeconds: sql`EXCLUDED.meeting_seconds`,
            trainingSeconds: sql`EXCLUDED.training_seconds`,
          },
        });
    }

    logger.info({ partnerId, date: dateStr, userCount: userTotals.size }, '[statusTracking] Daily rollup complete');
  } catch (err) {
    logger.error({ err: err instanceof Error ? err.message : String(err), partnerId, dateStr }, '[statusTracking] rollupDay error');
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add server/services/statusTracking.ts
git commit -m "feat(server): add statusTracking service

Handles status transition logging, open row closure on disconnect,
daily rollup aggregation, and agent/team stats queries."
```

---

### Task 10: Wire status tracking into socket handlers

**Files:**
- Modify: `server/socket/handlers.ts`

- [ ] **Step 1: Import statusTracking at the top of handlers.ts**

Add with the other service imports:

```typescript
import * as statusTracking from '../services/statusTracking.js';
```

- [ ] **Step 2: Add status transition logging to `status:set` handler**

Find the `status:set` handler (updated in Task 5). After the `setUserStatus` call, add the transition log:

```typescript
socket.on('status:set', async ({ status }: { status: string }) => {
  if (!requireIdentified(socket)) return;
  const VALID_STATUSES = ['available', 'break', 'lunch', 'meeting', 'training'] as const;
  if (!VALID_STATUSES.includes(status as typeof VALID_STATUSES[number])) return;
  const userId = socket.data.userId;
  const partnerId = socket.data.partnerId;
  if (userId && partnerId) {
    await presenceService.setUserStatus(userId, partnerId, status);
    await statusTracking.logTransition(userId, partnerId, status);
  }
});
```

- [ ] **Step 3: Open initial status row on `socket:identify`**

In the `socket:identify` handler, after `identifyUser` completes and the user is confirmed as support (around line 430, near the `isSupport` check), add:

```typescript
if (isSupport) {
  const persistedStatus = await presenceService.getUserStatus(userId, partnerId);
  await statusTracking.logTransition(userId, partnerId, persistedStatus || 'available');
}
```

This opens a log row when the agent first connects (or reconnects).

- [ ] **Step 4: Close status row on disconnect**

In the `disconnect` handler (line 1035), after `decrementUserCount` succeeds and `result.removed` is true, close the status log row. **Important:** `closeOpenRow` must fire for ALL removed users, not just agents — status tracking applies to support, admin, and agent roles alike.

Find the section around line 1059. Add `closeOpenRow` OUTSIDE the `role === 'agent'` check:

```typescript
if (userId && partnerId) {
  try {
    const result = await presenceService.decrementUserCount(userId, partnerId);
    if (result && result.removed) {
      if (result.role === 'agent') {
        broadcastAgentStatus(userId, false);
      }
      // Close status tracking row when user fully disconnects (all roles)
      await statusTracking.closeOpenRow(userId, partnerId);
    }
  } catch (err) {
    logger.error({ err: err instanceof Error ? err.message : String(err), userId }, '[socket] Presence decrement error on disconnect');
  }
}
```

Note: `closeOpenRow` is at the same level as the `if (result.role === 'agent')` block — NOT nested inside it.

- [ ] **Step 5: Commit**

```bash
git add server/socket/handlers.ts
git commit -m "feat(server): wire status tracking into socket lifecycle

Logs status transitions on status:set, opens initial row on
socket:identify, closes row on disconnect when user fully leaves."
```

---

### Task 11: Add tRPC status router for stats queries

**Files:**
- Create: `server/trpc/routers/status.ts`
- Modify: `server/trpc/router.ts`

- [ ] **Step 1: Create the status router**

Create `server/trpc/routers/status.ts`:

```typescript
import { z } from 'zod';
import { router, protectedProcedure } from '../trpc.js';
import { TRPCError } from '@trpc/server';
import * as statusTracking from '../../services/statusTracking.js';
import * as presenceService from '../../services/presence.js';

export const statusRouter = router({
  /** Get current online statuses for all support staff in the caller's partner */
  getTeamStatus: protectedProcedure
    .query(async ({ ctx }) => {
      const partnerId = ctx.user.partnerId;
      if (!partnerId) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'No partner context' });
      }
      const onlineUsers = await presenceService.getOnlineUsersForPartner(partnerId);
      return onlineUsers.map((u) => ({
        userId: u.userId,
        name: u.name,
        role: u.role,
        status: u.status,
      }));
    }),

  /** Get daily time-in-status for a single agent (self or admin) */
  getAgentStats: protectedProcedure
    .input(z.object({
      userId: z.string(),
      fromDate: z.string(),
      toDate: z.string(),
    }))
    .query(async ({ input, ctx }) => {
      const partnerId = ctx.user.partnerId;
      if (!partnerId) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'No partner context' });
      }
      // Self or admin/platform operator
      const isSelf = ctx.user.id === input.userId;
      const isAdmin = ctx.user.role === 'admin' || ctx.user.isPlatformOperator;
      if (!isSelf && !isAdmin) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Not authorized' });
      }
      return statusTracking.getAgentDailyStats(input.userId, partnerId, input.fromDate, input.toDate);
    }),

  /** Get daily time-in-status for all agents in partner (admin only) */
  getTeamStats: protectedProcedure
    .input(z.object({
      fromDate: z.string(),
      toDate: z.string(),
    }))
    .query(async ({ input, ctx }) => {
      const partnerId = ctx.user.partnerId;
      if (!partnerId) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'No partner context' });
      }
      if (ctx.user.role !== 'admin' && !ctx.user.isPlatformOperator) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Admin access required' });
      }
      return statusTracking.getTeamDailyStats(partnerId, input.fromDate, input.toDate);
    }),
});
```

- [ ] **Step 2: Register the router in router.ts**

In `server/trpc/router.ts`, add the import:

```typescript
import { statusRouter } from './routers/status.js';
```

Add to the `appRouter` object:

```typescript
status: statusRouter,
```

- [ ] **Step 3: Commit**

```bash
git add server/trpc/routers/status.ts server/trpc/router.ts
git commit -m "feat(trpc): add status router for team status and time-in-status stats

getTeamStatus returns current online statuses (all roles).
getAgentStats returns daily time-in-status for self or admin.
getTeamStats returns team-wide daily time-in-status (admin only)."
```

---

### Task 12: Update OnlineSupport type and add status color utility

**Files:**
- Modify: `client/src/types/index.ts`
- Create: `client/src/utils/statusColors.ts`

- [ ] **Step 1: Update OnlineSupport interface**

In `client/src/types/index.ts`, find the `OnlineSupport` interface (line 174). Replace:

```typescript
export interface OnlineSupport {
  userId: string;
  name: string;
  status: 'available' | 'break' | 'lunch' | 'meeting' | 'training';
  role?: string;
}
```

- [ ] **Step 2: Create status color utility**

Create `client/src/utils/statusColors.ts`:

```typescript
const STATUS_COLORS: Record<string, { dot: string; text: string }> = {
  available: { dot: 'bg-accent-green', text: 'text-accent-green' },
  break: { dot: 'bg-accent-amber', text: 'text-accent-amber' },
  lunch: { dot: 'bg-accent-orange', text: 'text-accent-orange' },
  meeting: { dot: 'bg-accent-red', text: 'text-accent-red' },
  training: { dot: 'bg-accent-blue', text: 'text-accent-blue' },
};

const OFFLINE_COLORS = { dot: 'bg-text-muted', text: 'text-text-muted' };

export function getStatusColors(status: string | undefined): { dot: string; text: string } {
  if (!status) return OFFLINE_COLORS;
  return STATUS_COLORS[status] || OFFLINE_COLORS;
}

export function getStatusI18nKey(status: string): string {
  const map: Record<string, string> = {
    available: 'status_available',
    break: 'status_break',
    lunch: 'status_lunch',
    meeting: 'status_meeting',
    training: 'status_training',
  };
  return map[status] || 'status_offline';
}
```

- [ ] **Step 3: Commit**

```bash
git add client/src/types/index.ts client/src/utils/statusColors.ts
git commit -m "feat(client): add typed status union and status color utility

Replaces string type with union on OnlineSupport. Shared
getStatusColors and getStatusI18nKey utilities for consistent rendering."
```

---

### Task 13: Add team status panel to QueueSidebar

**Files:**
- Modify: `client/src/components/support/QueueSidebar.tsx`

- [ ] **Step 1: Add imports**

At the top of `QueueSidebar.tsx`, add:

```typescript
import { OnlineSupport } from '../../types';
import { getStatusColors, getStatusI18nKey } from '../../utils/statusColors';
```

- [ ] **Step 2: Add onlineSupportUsers from store**

In the component, add after the existing store selectors (around line 36):

```typescript
const onlineSupportUsers = useStore((s) => s.onlineSupportUsers) as OnlineSupport[];
const user = useStore((s) => s.user);
```

- [ ] **Step 3: Compute team capacity**

Add after the store selectors:

```typescript
const availableCount = onlineSupportUsers.filter((u) => u.status === 'available').length;
const totalOnline = onlineSupportUsers.length;
```

- [ ] **Step 4: Add team status panel JSX**

At the bottom of the sidebar, before the closing `</div>` of the main container, add the team panel:

```tsx
{/* Online team status */}
{onlineSupportUsers.length > 0 && (
  <div className="border-t border-border px-3 py-3">
    <div className="text-[9px] font-mono font-bold uppercase tracking-widest text-text-muted mb-2">
      {t('online_team')}
    </div>
    <div className="flex flex-col gap-1.5">
      {onlineSupportUsers.map((agent) => {
        const colors = getStatusColors(agent.status);
        return (
          <div key={agent.userId} className="flex items-center gap-2 px-1 py-0.5">
            <div className="w-6 h-6 rounded-full bg-bg-elevated flex items-center justify-center text-[9px] font-bold text-text-primary shrink-0">
              {agent.name.split(' ').map((n) => n[0]).join('').slice(0, 2).toUpperCase()}
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-[11px] font-semibold text-text-primary truncate">{agent.name}</div>
            </div>
            <div className="flex items-center gap-1.5 shrink-0">
              <span className={`w-2 h-2 rounded-full ${colors.dot}`} />
              <span className={`text-[9px] font-bold uppercase ${colors.text}`}>
                {t(getStatusI18nKey(agent.status))}
              </span>
            </div>
          </div>
        );
      })}
    </div>
    <div className="flex justify-between mt-2 pt-2 border-t border-border">
      <span className="text-[9px] font-mono font-bold uppercase text-text-muted">{t('team_capacity')}</span>
      <span className="text-[11px] font-bold text-accent-green">{availableCount} / {totalOnline}</span>
    </div>
  </div>
)}
```

- [ ] **Step 5: Commit**

```bash
git add client/src/components/support/QueueSidebar.tsx
git commit -m "feat(client): add online team status panel to QueueSidebar

Shows colored status dots and labels for each online agent.
Displays team capacity count (available/total) at the bottom."
```

---

### Task 14: Add real-time status column to AdminTeam

**Files:**
- Modify: `client/src/components/admin/AdminTeam.tsx`

- [ ] **Step 1: Add imports**

At the top of `AdminTeam.tsx`, add:

```typescript
import useStore from '../../store/useStore';
import { getStatusColors, getStatusI18nKey } from '../../utils/statusColors';
import { OnlineSupport } from '../../types';
```

- [ ] **Step 2: Add onlineSupportUsers from store**

Inside the component, add:

```typescript
const onlineSupportUsers = useStore((s) => s.onlineSupportUsers) as OnlineSupport[];
```

- [ ] **Step 3: Create a lookup map for online statuses**

Add after the store selector:

```typescript
const onlineStatusMap = new Map(onlineSupportUsers.map((u) => [u.userId, u.status]));
```

- [ ] **Step 4: Add status column header**

Find the table `<thead>` row. Add a new `<th>` after the existing "Status" or "Role" column:

```tsx
<th className="text-left px-3 py-2 text-[9px] font-mono font-bold uppercase tracking-widest text-text-muted">
  {t('team_status')}
</th>
```

- [ ] **Step 5: Add status column cell**

In the table `<tbody>`, in each member row, add a corresponding `<td>`:

```tsx
<td className="px-3 py-2">
  {(() => {
    const onlineStatus = onlineStatusMap.get(member.userId);
    const colors = getStatusColors(onlineStatus);
    const label = onlineStatus ? t(getStatusI18nKey(onlineStatus)) : t('status_offline');
    return (
      <span className="inline-flex items-center gap-1.5">
        <span className={`w-1.5 h-1.5 rounded-full ${colors.dot}`} />
        <span className={`text-[9px] font-bold uppercase ${colors.text}`}>{label}</span>
      </span>
    );
  })()}
</td>
```

- [ ] **Step 6: Commit**

```bash
git add client/src/components/admin/AdminTeam.tsx
git commit -m "feat(client): add real-time status column to AdminTeam table

Shows colored dot + status label for online agents, 'Offline' for
disconnected members. Updates in real-time via support:online socket event."
```

---

### Task 15: Add time-in-status stats component

**Files:**
- Create: `client/src/components/admin/AgentStatusStats.tsx`
- Modify: `client/src/components/admin/AdminStats.tsx`

- [ ] **Step 1: Create AgentStatusStats component**

Create `client/src/components/admin/AgentStatusStats.tsx`:

```tsx
import { useState } from 'react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { useT } from '../../i18n';
import { trpc } from '../../utils/trpc';

function formatSeconds(s: number): string {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

interface DailyStatusRow {
  date: string;
  userId: string;
  availableSeconds: number;
  breakSeconds: number;
  lunchSeconds: number;
  meetingSeconds: number;
  trainingSeconds: number;
}

interface AgentStatusStatsProps {
  /** If set, show stats for only this user (self-view) */
  userId?: string;
}

export default function AgentStatusStats({ userId }: AgentStatusStatsProps) {
  const t = useT();
  const today = new Date().toISOString().slice(0, 10);
  const [fromDate, setFromDate] = useState(today);
  const [toDate, setToDate] = useState(today);

  const { data: teamStats } = userId
    ? trpc.status.getAgentStats.useQuery({ userId, fromDate, toDate })
    : trpc.status.getTeamStats.useQuery({ fromDate, toDate });

  const chartData = ((teamStats || []) as DailyStatusRow[]).map((row) => ({
    name: row.userId.slice(0, 8),
    date: row.date,
    Available: row.availableSeconds,
    Break: row.breakSeconds,
    Lunch: row.lunchSeconds,
    Meeting: row.meetingSeconds,
    Training: row.trainingSeconds,
  }));

  return (
    <div className="border border-border bg-bg-surface p-4">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-xs font-mono font-bold uppercase tracking-widest text-text-primary">
          {t('time_in_status')}
        </h3>
        <div className="flex items-center gap-2">
          <input
            type="date"
            value={fromDate}
            onChange={(e) => setFromDate(e.target.value)}
            className="text-[11px] font-mono bg-bg-elevated border border-border px-2 py-1 text-text-primary"
          />
          <span className="text-text-muted text-[11px]">→</span>
          <input
            type="date"
            value={toDate}
            onChange={(e) => setToDate(e.target.value)}
            className="text-[11px] font-mono bg-bg-elevated border border-border px-2 py-1 text-text-primary"
          />
        </div>
      </div>

      {chartData.length === 0 ? (
        <div className="text-text-muted text-xs text-center py-8">{t('no_data') || 'No data for selected period'}</div>
      ) : (
        <ResponsiveContainer width="100%" height={240}>
          <BarChart data={chartData} layout="horizontal">
            <XAxis dataKey="date" tick={{ fontSize: 10, fontFamily: 'JetBrains Mono' }} />
            <YAxis
              tickFormatter={(v: number) => formatSeconds(v)}
              tick={{ fontSize: 10, fontFamily: 'JetBrains Mono' }}
            />
            <Tooltip
              formatter={(value: number) => formatSeconds(value)}
              contentStyle={{
                backgroundColor: 'var(--color-bg-surface)',
                border: '1px solid var(--color-border-heavy)',
                fontFamily: 'JetBrains Mono',
                fontSize: 11,
              }}
            />
            <Legend wrapperStyle={{ fontFamily: 'JetBrains Mono', fontSize: 10 }} />
            <Bar dataKey="Available" stackId="a" fill="var(--color-accent-green)" />
            <Bar dataKey="Break" stackId="a" fill="var(--color-accent-amber)" />
            <Bar dataKey="Lunch" stackId="a" fill="var(--color-accent-orange)" />
            <Bar dataKey="Meeting" stackId="a" fill="var(--color-accent-red)" />
            <Bar dataKey="Training" stackId="a" fill="var(--color-accent-blue)" />
          </BarChart>
        </ResponsiveContainer>
      )}

      {/* Legend with time totals */}
      {chartData.length > 0 && (
        <div className="flex gap-4 flex-wrap mt-3 pt-3 border-t border-border">
          {(['Available', 'Break', 'Lunch', 'Meeting', 'Training'] as const).map((key) => {
            const total = chartData.reduce((sum: number, row: Record<string, number>) => sum + (row[key] || 0), 0);
            const colorMap: Record<string, string> = {
              Available: 'bg-accent-green',
              Break: 'bg-accent-amber',
              Lunch: 'bg-accent-orange',
              Meeting: 'bg-accent-red',
              Training: 'bg-accent-blue',
            };
            return (
              <div key={key} className="flex items-center gap-1.5">
                <span className={`w-2 h-2 ${colorMap[key]}`} />
                <span className="text-[9px] font-mono text-text-muted">{key} {formatSeconds(total)}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Add AgentStatusStats to AdminStats**

In `client/src/components/admin/AdminStats.tsx`, import the new component:

```typescript
import AgentStatusStats from './AgentStatusStats';
```

Add it at the end of the stats panels, before the closing container div:

```tsx
<AgentStatusStats />
```

No props needed — the tRPC endpoints get `partnerId` from the server-side JWT context, matching the existing pattern in AdminStats (which also has no `partnerId` prop).

- [ ] **Step 3: Commit**

```bash
git add client/src/components/admin/AgentStatusStats.tsx client/src/components/admin/AdminStats.tsx
git commit -m "feat(client): add AgentStatusStats component with stacked bar chart

Shows time-in-status breakdown per agent per day using Recharts.
Date range picker, status color legend with totals. Integrated into AdminStats."
```

---

### Task 16: Add capacity badge to SupportNav

**Files:**
- Modify: `client/src/components/support/SupportNav.tsx`

- [ ] **Step 1: Add imports**

Add at the top:

```typescript
import { OnlineSupport } from '../../types';
```

- [ ] **Step 2: Add capacity display**

Inside the component, add the store selector:

```typescript
const onlineSupportUsers = useStore((s) => s.onlineSupportUsers) as OnlineSupport[];
const availableCount = onlineSupportUsers.filter((u) => u.status === 'available').length;
const totalOnline = onlineSupportUsers.length;
```

Find where `<StatusPicker />` is rendered. Add the capacity badge right after it:

```tsx
{totalOnline > 0 && (
  <div className="flex items-center gap-2 px-2">
    <span className="text-[9px] font-mono font-bold uppercase text-text-muted">{t('team_capacity')}</span>
    <span className="bg-bg-elevated border border-border px-2 py-0.5 text-[11px] font-bold text-accent-green">
      {availableCount} / {totalOnline}
    </span>
  </div>
)}
```

- [ ] **Step 3: Commit**

```bash
git add client/src/components/support/SupportNav.tsx
git commit -m "feat(client): add team capacity badge to SupportNav

Shows 'X / Y' available count next to StatusPicker in the support navbar."
```

---

## Phase C: Infrastructure & Hardening

---

### Task 17: Add daily rollup scheduling

**Files:**
- Modify: `server/app.ts`

- [ ] **Step 1: Find the existing cron/interval setup pattern**

In `server/app.ts`, look for existing `setInterval` or cron calls (GDPR purge, daily stats). Follow the same pattern.

- [ ] **Step 2: Add the rollup interval**

Import the rollup function. `app.ts` already has `import { db } from './db.js'` and `import * as schema from './db/schema.js'`. Add:

```typescript
import { rollupDay } from './services/statusTracking.js';
```

Add near the existing scheduled tasks:

```typescript
// Daily agent status rollup — runs every hour, rolls up yesterday's data
setInterval(async () => {
  try {
    const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
    const allPartners = await db.select({ id: schema.partners.id }).from(schema.partners);
    for (const p of allPartners) {
      await rollupDay(p.id, yesterday);
    }
    logger.info({ date: yesterday }, '[statusTracking] Hourly rollup complete');
  } catch (err) {
    logger.error({ err: err instanceof Error ? err.message : String(err) }, '[statusTracking] Rollup error');
  }
}, 60 * 60 * 1000).unref();
```

- [ ] **Step 3: Commit**

```bash
git add server/app.ts
git commit -m "feat(server): add hourly rollup for daily agent status aggregation

Runs every hour, aggregates yesterday's agent_status_log into
daily_agent_status for all partners. Uses .unref() to avoid
keeping the process alive."
```

---

### Task 18: Add GDPR purge integration

**Files:**
- Modify: `server/services/gdpr.ts`

- [ ] **Step 1: Add import**

At the top of `gdpr.ts`, add:

```typescript
import { agentStatusLog } from '../db/schema.js';
import { lt } from 'drizzle-orm';
```

- [ ] **Step 2: Add purge for agent_status_log**

Find the existing purge logic (where audit_log or other tables are purged by date). Add alongside them:

```typescript
// Purge agent status log entries older than 30 days
const statusCutoff = new Date(Date.now() - 30 * 86400000).toISOString();
const deletedStatusRows = await db
  .delete(agentStatusLog)
  .where(lt(agentStatusLog.startedAt, statusCutoff));
logger.info({ cutoff: statusCutoff }, '[gdpr] Purged old agent_status_log entries');
```

Note: `daily_agent_status` is kept as anonymizable aggregate — do NOT purge it in the standard 30-day sweep. On user deletion (if there's a user deletion flow), anonymize by setting `userId` to null.

- [ ] **Step 3: Commit**

```bash
git add server/services/gdpr.ts
git commit -m "feat(gdpr): purge agent_status_log entries after 30 days

Follows existing GDPR retention policy. daily_agent_status retained
as aggregate data (anonymized on user deletion)."
```

---

### Task 19: Type check and test everything

**Files:**
- No new files

- [ ] **Step 1: Run TypeScript type check on server**

```bash
docker compose exec server npx tsc --noEmit
```

Expected: no errors. Fix any type mismatches in new service or router files.

- [ ] **Step 2: Run TypeScript type check on client**

```bash
docker compose exec client npx tsc --noEmit
```

Expected: no errors. Fix any issues from OnlineSupport type changes — check all consumers of `onlineSupportUsers` for string vs union type issues.

- [ ] **Step 3: Run server tests**

```bash
docker compose exec server npm test
```

Expected: all existing tests pass. Fix any failures related to status enum changes (old tests may reference 'busy'/'away' statuses) or transfer signature changes.

- [ ] **Step 4: Run client tests**

```bash
docker compose exec client npm test
```

Expected: all existing tests pass. Fix any failures related to the OnlineSupport type change or transfer menu changes.

- [ ] **Step 5: Commit any fixes**

```bash
git add -A
git commit -m "fix: resolve type errors and test failures from transfer and status changes"
```

---

### Task 20: Manual smoke test

- [ ] **Step 1: Start all services**

```bash
docker compose up
```

- [ ] **Step 2: Test department transfer**

1. Log in as a support agent
2. Open an active ticket
3. Click "Transfer" button
4. Verify dropdown shows "Return to queue" + department list (excluding current dept)
5. Type an optional note in the input field
6. Select a department
7. Verify: chat closes, system message appears, ticket re-appears in the new department's queue

- [ ] **Step 3: Test return to queue**

1. Open another ticket
2. Click "Transfer" → "Return to queue"
3. Verify: ticket is unassigned, appears in same department queue

- [ ] **Step 4: Test single department partner**

1. If a partner has only one department, transfer menu should show "Return to queue" but no department options

- [ ] **Step 5: Test StatusPicker persistence**

1. Log in as a support agent
2. Set status to "Meeting" via the StatusPicker dropdown
3. Refresh the page
4. Verify: StatusPicker shows "Meeting" (not "Available")

- [ ] **Step 6: Test QueueSidebar team panel**

1. Log in as a second support user in another browser
2. Set different statuses on each user
3. Verify: both users see the "Online Team" panel at the bottom of QueueSidebar with correct colored dots and status labels
4. Verify: "Team Capacity" shows correct "X / Y" count

- [ ] **Step 7: Test AdminTeam status column**

1. Log in as an admin
2. Navigate to Team management
3. Verify: online agents show colored status dot + label
4. Verify: offline members show grey "Offline" label

- [ ] **Step 8: Test SupportNav capacity badge**

1. As a support user, verify the capacity badge appears next to StatusPicker
2. Change another agent's status and verify the count updates in real-time

- [ ] **Step 9: Test AdminStats time-in-status chart**

1. As an admin, navigate to Stats
2. Verify the "Time in Status" section appears with date pickers
3. Wait for the hourly rollup or manually trigger it
4. Verify stacked bar chart renders with correct colors

- [ ] **Step 10: Test disconnect behavior**

1. Close one agent's browser tab
2. Verify: their status disappears from the QueueSidebar team panel
3. Verify: AdminTeam shows them as "Offline"
4. Verify: capacity count updates

- [ ] **Step 11: Final commit if any fixes were needed**

```bash
git add -A
git commit -m "fix: address smoke test findings for transfer and status visibility"
```
