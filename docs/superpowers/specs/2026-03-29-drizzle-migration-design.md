# Full Drizzle ORM Migration for Socket Handlers

## Goal

Migrate all 44 raw SQL calls in `server/socket/handlers.ts` to type-safe Drizzle ORM queries, extracted into 4 focused service modules. Handlers.ts becomes a thin orchestration layer with zero raw SQL.

## Architecture

```
socket event → handlers.ts (auth + orchestration) → *Queries.ts (Drizzle) → PostgreSQL
```

- **handlers.ts** retains: event routing, authorization checks (`socket.data.isSupport`), socket room management (`Rooms.*`), event emission, business logic orchestration (guards, SLA, sentiment, etc.)
- **Query modules** own: all database reads and writes via Drizzle ORM, typed return values, no socket/IO awareness
- Raw `query`, `get`, `run`, `transaction` imports are fully removed from handlers.ts once migration is complete

## Module Design

### `server/services/ticketQueries.ts` (~18 functions)

| Function | Op | Description | Returns |
|----------|-----|------------|---------|
| `findTicketPartner(ticketId)` | SELECT | Partner ID for authorization checks | `{ partnerId: string } \| undefined` |
| `findTicketForJoin(ticketId)` | SELECT | Ticket with support info for support:join | `{ id, partnerId, supportId, supportName, agentId, dept, status, participants, supportLang, agentLang }` |
| `findTicketForClose(ticketId)` | SELECT | Status/partner/agent for close authorization | `{ status, partnerId, agentId, reopened }` |
| `findTicketOwner(ticketId)` | SELECT | Ticket owner info for rating | `{ partnerId, agentId, supportId }` |
| `findTicketParticipants(ticketId)` | SELECT | JSONB participants array | `{ participants: Participant[] }` |
| `findRecentClosedTickets(partnerId, agentId, limit)` | SELECT | Closed tickets for reopen detection | `{ id, dept }[]` |
| `findActiveTicketsForAgent(userId, partnerId)` | SELECT | Agent's open tickets for reconnect | `{ id: string }[]` |
| `findActiveTicketsForSupport(userId, partnerId)` | SELECT | Support's open tickets (JSONB `@>`) for reconnect | `{ id: string }[]` |
| `createTicket(data)` | INSERT | Create new ticket | full ticket object |
| `assignSupport(ticketId, supportId, supportName, lang, participants)` | UPDATE | Assign support agent to ticket | `void` |
| `updateParticipants(ticketId, participants)` | UPDATE | Update JSONB participants | `void` |
| `closeTicket(ticketId, closingNotes?)` | UPDATE | Set status=closed with optional notes | `void` |
| `updateTicketSla(ticketId, responseDue, resolutionDue)` | UPDATE | Set SLA due dates | `void` |
| `transferTicket(ticketId, targetId, targetName, senderId, participants)` | UPDATE | Reassign support agent | `void` |
| `returnTicketToQueue(ticketId)` | UPDATE | Unassign support, status=open | `void` |
| `replaceTicketLabels(ticketId, labelIds)` | TX | Atomic DELETE + batch INSERT ticket_labels | `void` |
| `findPartnerLabels(partnerId)` | SELECT | All labels for a partner | `{ id: string }[]` |
| `findTicketForTransfer(ticketId)` | SELECT | Ticket info for transfer authorization | `{ partnerId, supportId, agentId, participants }` |

### `server/services/messageQueries.ts` (~12 functions)

| Function | Op | Description | Returns |
|----------|-----|------------|---------|
| `insertMessage(data: { id, ticketId, senderId, senderName, senderRole, senderLang, text, whisper?, mediaUrl?, system? })` | INSERT | Insert chat message, return socket-ready object | full message object with `timestamp`, `createdAt`, `reactions` |
| `findTicketMessages(ticketId)` | SELECT | Full message history for a ticket | `Message[]` |
| `findTicketLabelIds(ticketId)` | SELECT | Label IDs attached to a ticket | `string[]` |
| `findMessageForEdit(messageId)` | SELECT | Message sender/timestamps for edit auth | `{ senderId, createdAt, text }` |
| `findMessageForDelete(messageId)` | SELECT | Message metadata for delete auth | `{ senderId, createdAt, whisper, system }` |
| `updateMessageText(messageId, newText)` | UPDATE | Edit message text + set editedAt | `void` |
| `softDeleteMessage(messageId)` | UPDATE | Set deletedAt on message | `void` |
| `markDelivered(messageId)` | UPDATE | Set deliveredAt timestamp | `void` |
| `markRead(messageIds)` | UPDATE | Batch mark messages as read (IN clause) | `void` |
| `insertRatingMessage(ticketId, text)` | INSERT | Insert rating system message | message object |

### `server/services/userQueries.ts` (~6 functions)

| Function | Op | Description | Returns |
|----------|-----|------------|---------|
| `findUserById(userId)` | SELECT | User name + platform operator flag | `{ name, isPlatformOperator } \| undefined` |
| `findMembership(userId, partnerId)` | SELECT | Membership role for authorization | `{ role } \| undefined` |
| `findSenderInfo(userId, partnerId)` | SELECT | JOIN users+memberships for sender display | `{ name, role, lang }` |
| `findUserName(userId)` | SELECT | Just the user's name | `{ name } \| undefined` |
| `findTargetSupport(userId, partnerId)` | SELECT | JOIN for transfer target validation | `{ name, role }` |

### `server/services/partnerQueries.ts` (~3 functions)

| Function | Op | Description | Returns |
|----------|-----|------------|---------|
| `findPartnerConfig(partnerId)` | SELECT | Business hours + SLA config + status | `{ businessHours, slaConfig, status }` |
| `findPartnerBusinessHours(partnerId)` | SELECT | Just business hours schedule | `{ businessHours }` |
| `findPartnerStatus(partnerId)` | SELECT | Just partner active/inactive status | `{ status }` |

## Drizzle Patterns

### Standard CRUD

```typescript
// SELECT
const result = await db.select({ partnerId: tickets.partnerId })
  .from(tickets).where(eq(tickets.id, ticketId));
return result[0];

// INSERT
await db.insert(tickets).values({ id, partnerId, ... });

// UPDATE
await db.update(tickets).set({ status: 'closed' }).where(eq(tickets.id, ticketId));
```

### JSONB containment (`@>`)

```typescript
import { sql } from 'drizzle-orm';
db.select({ id: tickets.id }).from(tickets)
  .where(sql`${tickets.participants}::jsonb @> ${JSON.stringify([{ id: userId }])}::jsonb`);
```

### Batch IN clause

```typescript
import { inArray } from 'drizzle-orm';
db.update(messages).set({ readAt: now }).where(inArray(messages.id, messageIds));
```

### Transaction (label replacement)

```typescript
await db.transaction(async (tx) => {
  await tx.delete(ticketLabels).where(eq(ticketLabels.ticketId, ticketId));
  if (labelIds.length > 0) {
    await tx.insert(ticketLabels).values(labelIds.map(id => ({ ticketId, labelId: id })));
  }
});
```

### JOIN (sender info)

```typescript
db.select({ name: users.name, role: memberships.role, lang: users.lang })
  .from(users)
  .innerJoin(memberships, and(
    eq(memberships.userId, users.id),
    eq(memberships.partnerId, partnerId)
  ))
  .where(eq(users.id, userId));
```

## Testing Strategy

- **Unit tests with mocked Drizzle** — matches existing codebase patterns (tRPC router tests, service tests)
- Mock `db.select()`, `db.insert()`, `db.update()`, `db.delete()`, `db.transaction()`
- Verify: correct return types, error handling, function signatures
- One test file per query module
- Real SQL correctness validated by existing E2E suite

## Migration Strategy

### Phase 1: Create query modules (4 tasks)
Create each module with its tests, independently. No changes to handlers.ts yet.

1. `partnerQueries.ts` + tests (3 functions — smallest, good warmup)
2. `userQueries.ts` + tests (6 functions)
3. `messageQueries.ts` + tests (12 functions)
4. `ticketQueries.ts` + tests (18 functions — largest, most complex)

### Phase 2: Wire into handlers.ts (4 tasks)
Replace raw SQL calls with query module calls, one module at a time.

5. Wire `partnerQueries` into handlers.ts
6. Wire `userQueries` into handlers.ts
7. Wire `messageQueries` into handlers.ts
8. Wire `ticketQueries` into handlers.ts

### Phase 3: Cleanup (1 task)
9. Remove `query`, `get`, `run`, `transaction` imports from handlers.ts. Verify no raw SQL remains. Full test suite pass.

### Ordering rationale
- Smallest modules first → build confidence, establish patterns
- Create-then-wire keeps each task focused (don't mix "write new code" with "refactor old code")
- One module per wire task avoids merge conflicts in the large handlers.ts file

## Constraints

- **Docker only** — all commands via `docker compose exec server ...`
- **No `any` types** — all query functions have explicit return types
- **Existing behavior preserved** — query functions must return the same data shapes as the raw SQL (camelCase property names)
- **No raw SQL in handlers.ts** — the `query`, `get`, `run`, `transaction` imports must be fully removed by the end
- **Drizzle `sql` tag** for PostgreSQL-specific operators (JSONB) — acceptable, not a raw query
