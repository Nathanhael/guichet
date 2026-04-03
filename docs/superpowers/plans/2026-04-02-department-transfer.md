# Department-Based Ticket Transfer — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace agent-to-agent ticket transfer with department-based transfer so tickets move between department queues instead of between individual support agents.

**Architecture:** The transfer menu lists partner departments (excluding the ticket's current dept). On transfer, the server updates the ticket's `dept` field, clears `support_id`/`support_name`, removes all support sockets from the ticket room, and broadcasts queue updates to both old and new departments. An optional whisper note provides context handoff.

**Tech Stack:** React 19, Zustand, Socket.io, Drizzle ORM, PostgreSQL, Vitest

**Spec:** `docs/superpowers/specs/2026-04-02-department-transfer-design.md`

---

### Task 1: Add translation keys for department transfer

**Files:**
- Modify: `client/src/locales/en.ts`
- Modify: `client/src/locales/fr.ts`
- Modify: `client/src/locales/nl.ts`

- [ ] **Step 1: Add new keys and remove obsolete key in en.ts**

Replace the four keys we added earlier with the updated set:

```typescript
// After close_ticket_body line:
    transfer: 'Transfer',
    transfer_to_department: 'Transfer to department',
    transfer_note_placeholder: 'Add context for the next agent...',
    return_to_queue: 'Return to queue',
    ticket_transferred_to: 'Ticket transferred to',
```

Remove `transfer_to` and `no_other_support_online` — they are no longer used.

- [ ] **Step 2: Add new keys and remove obsolete key in fr.ts**

```typescript
    transfer: 'Transf\u00e9rer',
    transfer_to_department: 'Transf\u00e9rer au d\u00e9partement',
    transfer_note_placeholder: 'Ajouter du contexte pour le prochain agent...',
    return_to_queue: 'Remettre en file d\'attente',
    ticket_transferred_to: 'Ticket transf\u00e9r\u00e9 vers',
```

Remove `transfer_to` and `no_other_support_online`.

- [ ] **Step 3: Add new keys and remove obsolete key in nl.ts**

```typescript
    transfer: 'Overdragen',
    transfer_to_department: 'Overdragen naar afdeling',
    transfer_note_placeholder: 'Voeg context toe voor de volgende agent...',
    return_to_queue: 'Terug naar wachtrij',
    ticket_transferred_to: 'Ticket overgedragen naar',
```

Remove `transfer_to` and `no_other_support_online`.

- [ ] **Step 4: Commit**

```bash
git add client/src/locales/en.ts client/src/locales/fr.ts client/src/locales/nl.ts
git commit -m "feat(i18n): update transfer translation keys for department-based transfer"
```

---

### Task 2: Rewrite server transfer handler for department-based transfer

**Files:**
- Modify: `server/socket/handlers.ts`

- [ ] **Step 1: Rewrite the `ticket:transfer` handler**

Find the `socket.on('ticket:transfer', ...)` handler (starts around line 922). Replace the entire handler with department-based logic.

Old signature: `{ ticketId, targetSupportId?: string }`
New signature: `{ ticketId, departmentId?: string, note?: string }`

When `departmentId` is provided:
1. Validate department exists in partner's `departments` JSONB
2. If `note` is provided, insert it as a whisper message first
3. Update ticket: set `dept = departmentId`, clear `supportId`/`supportName`, set `status = 'open'`
4. Insert system message: `"Ticket transferred to [Department Name] by [Agent Name]"`
5. Remove ALL support sockets from ticket room (not just sender)
6. Broadcast `ticket:transferred` with `{ ticketId, fromId, fromName, toDepartment, toDepartmentName }`
7. Broadcast queue positions for both old and new departments

When `departmentId` is NOT provided (return to queue — unchanged):
1. Call existing `returnTicketToQueue(ticketId)`
2. Insert system message
3. Broadcast as before

Replace the handler:

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
      const partner = await db.query.partners.findFirst({
        where: eq(partners.id, callerPartnerId),
        columns: { departments: true },
      });
      const depts = (partner?.departments as Array<{ id: string; name: string }>) || [];
      const targetDept = depts.find(d => d.id === departmentId);
      if (!targetDept) return socket.emit('error', { message: 'Department not found' });

      // Optional whisper note for context handoff
      if (note?.trim()) {
        const whisperMsg = await insertWhisperMessage(ticketId, senderId, senderName, note.trim());
        io.to(Rooms.ticket(ticketId)).emit('message:new', whisperMsg);
      }

      // Update ticket: new department, clear support assignment, re-open
      const oldDept = ticket.dept;
      await db
        .update(tickets)
        .set({ dept: departmentId, supportId: null, supportName: null, status: 'open' })
        .where(eq(tickets.id, ticketId));

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

- [ ] **Step 2: Add `insertWhisperMessage` helper (if not already present)**

Check if `insertWhisperMessage` exists. If not, add it near `insertSystemMessage`. It should insert a message with `whisper: true` and the sender's identity:

```typescript
async function insertWhisperMessage(ticketId: string, senderId: string, senderName: string, text: string) {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  await db.insert(messages).values({
    id,
    ticketId,
    senderId,
    senderName,
    body: text,
    whisper: true,
    createdAt: now,
  });
  return {
    id,
    ticketId,
    senderId,
    senderName,
    text,
    whisper: true,
    system: false,
    timestamp: now,
  };
}
```

Adapt field names to match the existing `insertSystemMessage` pattern — use the same column names (`body` vs `text`, etc.) that codebase already uses.

- [ ] **Step 3: Remove the now-unused `transferTicket` function**

The `transferTicket` function (around lines 277–293) that sets `support_id` to a target agent is no longer called. Remove it.

Also remove `findTargetSupport` if it was only used by the old transfer path.

- [ ] **Step 4: Add `partners` import to the handler file if not present**

The new handler queries `db.query.partners`. Ensure `partners` is imported from the schema:

```typescript
import { tickets, messages, partners } from '../db/schema';
```

- [ ] **Step 5: Commit**

```bash
git add server/socket/handlers.ts
git commit -m "feat(server): rewrite ticket:transfer for department-based transfer

Replaces agent-to-agent transfer with department transfer.
Validates target dept exists in partner config, clears support
assignment, removes all support sockets, broadcasts queue updates.
Adds optional whisper note for context handoff."
```

---

### Task 3: Rewrite client transfer menu for department selection

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

### Task 4: Clean up unused code and verify

**Files:**
- Modify: `client/src/locales/en.ts`
- Modify: `client/src/locales/fr.ts`
- Modify: `client/src/locales/nl.ts`

- [ ] **Step 1: Remove obsolete translation keys from en.ts**

Remove these two keys (no longer referenced anywhere):
```typescript
    transfer_to: 'Transfer to',
    no_other_support_online: 'No other support online',
```

- [ ] **Step 2: Remove obsolete translation keys from fr.ts**

Remove:
```typescript
    transfer_to: 'Transf\u00e9rer \u00e0',
    no_other_support_online: 'Aucun autre support en ligne',
```

- [ ] **Step 3: Remove obsolete translation keys from nl.ts**

Remove:
```typescript
    transfer_to: 'Overdragen aan',
    no_other_support_online: 'Geen andere support online',
```

- [ ] **Step 4: Run TypeScript type check**

```bash
docker compose exec client npx tsc --noEmit
docker compose exec server npx tsc --noEmit
```

Expected: no errors. If there are errors, fix them (likely unused imports or changed event payload types).

- [ ] **Step 5: Run client tests**

```bash
docker compose exec client npm test
```

Expected: all existing tests pass. If any tests reference `targetSupportId` or `transferTargets`, update them to use `departmentId` and `transferDepartments`.

- [ ] **Step 6: Run server tests**

```bash
docker compose exec server npm test
```

Expected: all existing tests pass. If any tests reference the old `transferTicket(ticketId, targetSupportId, ...)` signature, update them.

- [ ] **Step 7: Commit**

```bash
git add client/src/locales/en.ts client/src/locales/fr.ts client/src/locales/nl.ts
git commit -m "chore: remove obsolete transfer translation keys

Removes transfer_to and no_other_support_online — replaced by
transfer_to_department in department-based transfer."
```

---

### Task 5: Manual smoke test

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
7. Verify: chat closes, system message appears for the agent, ticket re-appears in the new department's queue

- [ ] **Step 3: Test return to queue**

1. Open another ticket
2. Click "Transfer" → "Return to queue"
3. Verify: ticket is unassigned, appears in same department queue

- [ ] **Step 4: Test edge case — single department partner**

1. If a partner has only one department, transfer menu should show "Return to queue" but no department options (current dept is filtered out, nothing left)

- [ ] **Step 5: Final commit if any fixes were needed**

```bash
git add -A
git commit -m "fix: address smoke test findings for department transfer"
```
