# Drizzle ORM Migration for Socket Handlers — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate all 44 raw SQL calls in `server/socket/handlers.ts` to type-safe Drizzle ORM queries in 4 focused service modules, eliminating all `query`/`get`/`run`/`transaction` usage from handlers.

**Architecture:** Extract DB queries into `partnerQueries.ts`, `userQueries.ts`, `messageQueries.ts`, `ticketQueries.ts` in `server/services/`. Each module uses Drizzle ORM exclusively, has typed returns, and is unit-tested with mocked Drizzle. Handlers.ts becomes a thin orchestration layer.

**Tech Stack:** TypeScript, Drizzle ORM, PostgreSQL, Socket.io, Vitest

**Docker mandate:** All commands run via `docker compose exec server ...` — never on host.

---

## File Structure

| File | Responsibility | Action |
|------|---------------|--------|
| `server/services/partnerQueries.ts` | Partner config lookups (business hours, SLA, status) | **Create** |
| `server/services/partnerQueries.test.ts` | Unit tests with mocked Drizzle | **Create** |
| `server/services/userQueries.ts` | User identity and membership lookups | **Create** |
| `server/services/userQueries.test.ts` | Unit tests with mocked Drizzle | **Create** |
| `server/services/messageQueries.ts` | Message CRUD (insert, edit, delete, delivered, read, history) | **Create** |
| `server/services/messageQueries.test.ts` | Unit tests with mocked Drizzle | **Create** |
| `server/services/ticketQueries.ts` | Ticket CRUD, labels, participants, transfers | **Create** |
| `server/services/ticketQueries.test.ts` | Unit tests with mocked Drizzle | **Create** |
| `server/socket/handlers.ts` | Replace raw SQL with query module calls | **Modify** |

---

### Task 1: Create `partnerQueries.ts` + tests

**Files:**
- Create: `server/services/partnerQueries.ts`
- Create: `server/services/partnerQueries.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// server/services/partnerQueries.test.ts
import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('../db/postgres.js', () => {
  const selectResult = {
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockResolvedValue([]),
  };
  return {
    db: {
      select: vi.fn().mockReturnValue(selectResult),
    },
  };
});

import { findPartnerConfig } from './partnerQueries.js';
import { db } from '../db/postgres.js';

describe('partnerQueries', () => {
  beforeEach(() => vi.clearAllMocks());

  describe('findPartnerConfig', () => {
    it('returns partner config when found', async () => {
      const mockPartner = {
        status: 'active',
        businessHoursSchedule: null,
        businessHoursStart: '09:00',
        businessHoursEnd: '17:00',
        businessHoursTimezone: 'Europe/Brussels',
        slaConfig: null,
      };
      const selectResult = { from: vi.fn().mockReturnThis(), where: vi.fn().mockResolvedValue([mockPartner]) };
      vi.mocked(db.select).mockReturnValue(selectResult as never);

      const result = await findPartnerConfig('p1');
      expect(result).toEqual(mockPartner);
    });

    it('returns undefined when partner not found', async () => {
      const selectResult = { from: vi.fn().mockReturnThis(), where: vi.fn().mockResolvedValue([]) };
      vi.mocked(db.select).mockReturnValue(selectResult as never);

      const result = await findPartnerConfig('missing');
      expect(result).toBeUndefined();
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
docker compose exec server npx vitest run services/partnerQueries.test.ts
```

Expected: FAIL — `Cannot find module './partnerQueries.js'`

- [ ] **Step 3: Implement partnerQueries**

```typescript
// server/services/partnerQueries.ts
import { eq } from 'drizzle-orm';
import { db } from '../db/postgres.js';
import { partners } from '../db/schema.js';

/**
 * Fetches partner configuration for business hours, SLA, and status checks.
 * Used by: socket:identify, ticket:new
 */
export async function findPartnerConfig(partnerId: string) {
  const rows = await db
    .select({
      status: partners.status,
      businessHoursSchedule: partners.businessHoursSchedule,
      businessHoursStart: partners.businessHoursStart,
      businessHoursEnd: partners.businessHoursEnd,
      businessHoursTimezone: partners.businessHoursTimezone,
      slaConfig: partners.slaConfig,
    })
    .from(partners)
    .where(eq(partners.id, partnerId));
  return rows[0];
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
docker compose exec server npx vitest run services/partnerQueries.test.ts
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
docker compose exec server sh -c "cd /app && git add services/partnerQueries.ts services/partnerQueries.test.ts && git commit -m 'feat: add partnerQueries Drizzle module with tests'"
```

---

### Task 2: Create `userQueries.ts` + tests

**Files:**
- Create: `server/services/userQueries.ts`
- Create: `server/services/userQueries.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// server/services/userQueries.test.ts
import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('../db/postgres.js', () => {
  const chainable = {
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockResolvedValue([]),
    innerJoin: vi.fn().mockReturnThis(),
  };
  return {
    db: {
      select: vi.fn().mockReturnValue(chainable),
    },
  };
});

import { findUserById, findMembership, findSenderInfo, findUserName, findTargetSupport } from './userQueries.js';
import { db } from '../db/postgres.js';

describe('userQueries', () => {
  beforeEach(() => vi.clearAllMocks());

  describe('findUserById', () => {
    it('returns user when found', async () => {
      const mockUser = { name: 'Alice', isPlatformOperator: false };
      const chain = { from: vi.fn().mockReturnThis(), where: vi.fn().mockResolvedValue([mockUser]) };
      vi.mocked(db.select).mockReturnValue(chain as never);

      const result = await findUserById('u1');
      expect(result).toEqual(mockUser);
    });

    it('returns undefined when not found', async () => {
      const chain = { from: vi.fn().mockReturnThis(), where: vi.fn().mockResolvedValue([]) };
      vi.mocked(db.select).mockReturnValue(chain as never);

      const result = await findUserById('missing');
      expect(result).toBeUndefined();
    });
  });

  describe('findMembership', () => {
    it('returns membership role when found', async () => {
      const chain = { from: vi.fn().mockReturnThis(), where: vi.fn().mockResolvedValue([{ role: 'admin' }]) };
      vi.mocked(db.select).mockReturnValue(chain as never);

      const result = await findMembership('u1', 'p1');
      expect(result).toEqual({ role: 'admin' });
    });
  });

  describe('findSenderInfo', () => {
    it('returns joined user+membership info', async () => {
      const mock = { name: 'Bob', role: 'support', lang: 'en' };
      const chain = { from: vi.fn().mockReturnThis(), innerJoin: vi.fn().mockReturnThis(), where: vi.fn().mockResolvedValue([mock]) };
      vi.mocked(db.select).mockReturnValue(chain as never);

      const result = await findSenderInfo('u1', 'p1');
      expect(result).toEqual(mock);
    });
  });

  describe('findUserName', () => {
    it('returns user name', async () => {
      const chain = { from: vi.fn().mockReturnThis(), where: vi.fn().mockResolvedValue([{ name: 'Carol' }]) };
      vi.mocked(db.select).mockReturnValue(chain as never);

      const result = await findUserName('u1');
      expect(result).toEqual({ name: 'Carol' });
    });
  });

  describe('findTargetSupport', () => {
    it('returns joined user name for transfer target', async () => {
      const mock = { name: 'Dave' };
      const chain = { from: vi.fn().mockReturnThis(), innerJoin: vi.fn().mockReturnThis(), where: vi.fn().mockResolvedValue([mock]) };
      vi.mocked(db.select).mockReturnValue(chain as never);

      const result = await findTargetSupport('u1', 'p1');
      expect(result).toEqual(mock);
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
docker compose exec server npx vitest run services/userQueries.test.ts
```

Expected: FAIL — `Cannot find module './userQueries.js'`

- [ ] **Step 3: Implement userQueries**

```typescript
// server/services/userQueries.ts
import { eq, and } from 'drizzle-orm';
import { db } from '../db/postgres.js';
import { users, memberships } from '../db/schema.js';

/**
 * Fetches user name and platform operator flag.
 * Used by: socket:identify
 */
export async function findUserById(userId: string) {
  const rows = await db
    .select({ name: users.name, isPlatformOperator: users.isPlatformOperator })
    .from(users)
    .where(eq(users.id, userId));
  return rows[0];
}

/**
 * Fetches membership role for a user in a specific partner.
 * Used by: socket:identify
 */
export async function findMembership(userId: string, partnerId: string) {
  const rows = await db
    .select({ role: memberships.role })
    .from(memberships)
    .where(and(eq(memberships.userId, userId), eq(memberships.partnerId, partnerId)));
  return rows[0];
}

/**
 * Fetches sender display info (name, role, lang) by JOINing users + memberships.
 * Used by: message:send
 */
export async function findSenderInfo(userId: string, partnerId: string) {
  const rows = await db
    .select({ name: users.name, role: memberships.role, lang: users.lang })
    .from(users)
    .innerJoin(memberships, and(eq(memberships.userId, users.id), eq(memberships.partnerId, partnerId)))
    .where(eq(users.id, userId));
  return rows[0];
}

/**
 * Fetches just the user's name.
 * Used by: ticket:new (agent name lookup)
 */
export async function findUserName(userId: string) {
  const rows = await db
    .select({ name: users.name })
    .from(users)
    .where(eq(users.id, userId));
  return rows[0];
}

/**
 * Fetches target support user name for ticket transfer validation.
 * Verifies user exists and has membership in the partner.
 * Used by: ticket:transfer
 */
export async function findTargetSupport(userId: string, partnerId: string) {
  const rows = await db
    .select({ name: users.name })
    .from(users)
    .innerJoin(memberships, and(eq(memberships.userId, users.id), eq(memberships.partnerId, partnerId)))
    .where(eq(users.id, userId));
  return rows[0];
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
docker compose exec server npx vitest run services/userQueries.test.ts
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
docker compose exec server sh -c "cd /app && git add services/userQueries.ts services/userQueries.test.ts && git commit -m 'feat: add userQueries Drizzle module with tests'"
```

---

### Task 3: Create `messageQueries.ts` + tests

**Files:**
- Create: `server/services/messageQueries.ts`
- Create: `server/services/messageQueries.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// server/services/messageQueries.test.ts
import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('../db/postgres.js', () => {
  const chainable = {
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockResolvedValue([]),
    orderBy: vi.fn().mockReturnThis(),
    set: vi.fn().mockReturnThis(),
    values: vi.fn().mockResolvedValue(undefined),
  };
  return {
    db: {
      select: vi.fn().mockReturnValue(chainable),
      insert: vi.fn().mockReturnValue(chainable),
      update: vi.fn().mockReturnValue(chainable),
    },
  };
});

vi.mock('uuid', () => ({ v4: vi.fn(() => 'mock-uuid') }));

import {
  insertMessage,
  findTicketMessages,
  findTicketLabelIds,
  findMessageForEdit,
  findMessageForDelete,
  updateMessageText,
  softDeleteMessage,
  markDelivered,
  markRead,
} from './messageQueries.js';
import { db } from '../db/postgres.js';

describe('messageQueries', () => {
  beforeEach(() => vi.clearAllMocks());

  describe('insertMessage', () => {
    it('returns a socket-ready message object', async () => {
      const insertChain = { values: vi.fn().mockResolvedValue(undefined) };
      vi.mocked(db.insert).mockReturnValue(insertChain as never);

      const result = await insertMessage({
        ticketId: 't1',
        senderId: 'u1',
        senderName: 'Alice',
        senderRole: 'agent',
        senderLang: 'en',
        text: 'Hello',
      });

      expect(result).toMatchObject({
        ticketId: 't1',
        senderId: 'u1',
        senderName: 'Alice',
        text: 'Hello',
        whisper: false,
        system: false,
      });
      expect(result.id).toBeDefined();
      expect(result.timestamp).toBe(result.createdAt);
    });
  });

  describe('findTicketMessages', () => {
    it('returns ordered messages', async () => {
      const msgs = [{ id: 'm1' }, { id: 'm2' }];
      const chain = { from: vi.fn().mockReturnThis(), where: vi.fn().mockReturnThis(), orderBy: vi.fn().mockResolvedValue(msgs) };
      vi.mocked(db.select).mockReturnValue(chain as never);

      const result = await findTicketMessages('t1');
      expect(result).toEqual(msgs);
    });
  });

  describe('findTicketLabelIds', () => {
    it('returns label IDs array', async () => {
      const rows = [{ labelId: 'l1' }, { labelId: 'l2' }];
      const chain = { from: vi.fn().mockReturnThis(), where: vi.fn().mockResolvedValue(rows) };
      vi.mocked(db.select).mockReturnValue(chain as never);

      const result = await findTicketLabelIds('t1');
      expect(result).toEqual(['l1', 'l2']);
    });
  });

  describe('findMessageForEdit', () => {
    it('returns message metadata', async () => {
      const msg = { senderId: 'u1', createdAt: '2026-01-01', system: 0, deletedAt: null };
      const chain = { from: vi.fn().mockReturnThis(), where: vi.fn().mockResolvedValue([msg]) };
      vi.mocked(db.select).mockReturnValue(chain as never);

      const result = await findMessageForEdit('m1', 't1');
      expect(result).toEqual(msg);
    });
  });

  describe('findMessageForDelete', () => {
    it('returns message metadata for delete auth', async () => {
      const msg = { senderId: 'u1', system: 0, deletedAt: null };
      const chain = { from: vi.fn().mockReturnThis(), where: vi.fn().mockResolvedValue([msg]) };
      vi.mocked(db.select).mockReturnValue(chain as never);

      const result = await findMessageForDelete('m1', 't1');
      expect(result).toEqual(msg);
    });
  });

  describe('updateMessageText', () => {
    it('calls db.update with text and editedAt', async () => {
      const chain = { set: vi.fn().mockReturnThis(), where: vi.fn().mockResolvedValue(undefined) };
      vi.mocked(db.update).mockReturnValue(chain as never);

      await updateMessageText('m1', 'new text');
      expect(db.update).toHaveBeenCalled();
    });
  });

  describe('softDeleteMessage', () => {
    it('sets deletedAt and clears text', async () => {
      const chain = { set: vi.fn().mockReturnThis(), where: vi.fn().mockResolvedValue(undefined) };
      vi.mocked(db.update).mockReturnValue(chain as never);

      await softDeleteMessage('m1');
      expect(db.update).toHaveBeenCalled();
    });
  });

  describe('markDelivered', () => {
    it('updates deliveredAt where null', async () => {
      const chain = { set: vi.fn().mockReturnThis(), where: vi.fn().mockResolvedValue(undefined) };
      vi.mocked(db.update).mockReturnValue(chain as never);

      await markDelivered('m1', 't1');
      expect(db.update).toHaveBeenCalled();
    });
  });

  describe('markRead', () => {
    it('batch updates readAt for multiple message IDs', async () => {
      const chain = { set: vi.fn().mockReturnThis(), where: vi.fn().mockResolvedValue(undefined) };
      vi.mocked(db.update).mockReturnValue(chain as never);

      await markRead(['m1', 'm2'], 't1');
      expect(db.update).toHaveBeenCalled();
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
docker compose exec server npx vitest run services/messageQueries.test.ts
```

Expected: FAIL — `Cannot find module './messageQueries.js'`

- [ ] **Step 3: Implement messageQueries**

```typescript
// server/services/messageQueries.ts
import { eq, and, asc, isNull, inArray, sql } from 'drizzle-orm';
import { v4 as uuidv4 } from 'uuid';
import { db } from '../db/postgres.js';
import { messages, ticketLabels } from '../db/schema.js';

export interface InsertMessageData {
  ticketId: string;
  senderId: string;
  senderName: string;
  senderRole: string;
  senderLang: string;
  text: string;
  mediaUrl?: string | null;
  whisper?: boolean;
  system?: boolean;
}

/**
 * Inserts a chat message and returns a socket-ready message object.
 * Used by: message:send, ticket:new
 */
export async function insertMessage(data: InsertMessageData) {
  const id = uuidv4();
  const now = new Date().toISOString();

  await db.insert(messages).values({
    id,
    ticketId: data.ticketId,
    senderId: data.senderId,
    senderName: data.senderName,
    senderRole: data.senderRole,
    senderLang: data.senderLang,
    text: data.text,
    mediaUrl: data.mediaUrl || null,
    whisper: data.whisper ? 1 : 0,
    system: data.system ? 1 : 0,
    createdAt: now,
    reactions: {},
  });

  return {
    id,
    ticketId: data.ticketId,
    senderId: data.senderId,
    senderName: data.senderName,
    senderRole: data.senderRole,
    senderLang: data.senderLang,
    text: data.text,
    originalText: data.text,
    mediaUrl: data.mediaUrl || undefined,
    whisper: !!data.whisper,
    system: !!data.system,
    timestamp: now,
    createdAt: now,
    reactions: {},
  };
}

/**
 * Fetches all messages for a ticket, ordered by creation time.
 * Used by: support:join (ticket history)
 */
export async function findTicketMessages(ticketId: string) {
  return db
    .select()
    .from(messages)
    .where(eq(messages.ticketId, ticketId))
    .orderBy(asc(messages.createdAt));
}

/**
 * Fetches label IDs attached to a ticket.
 * Used by: support:join (ticket history)
 */
export async function findTicketLabelIds(ticketId: string): Promise<string[]> {
  const rows = await db
    .select({ labelId: ticketLabels.labelId })
    .from(ticketLabels)
    .where(eq(ticketLabels.ticketId, ticketId));
  return rows.map((r) => r.labelId);
}

/**
 * Fetches message metadata for edit authorization.
 * Used by: message:edit
 */
export async function findMessageForEdit(messageId: string, ticketId: string) {
  const rows = await db
    .select({
      senderId: messages.senderId,
      createdAt: messages.createdAt,
      system: messages.system,
      deletedAt: messages.deletedAt,
    })
    .from(messages)
    .where(and(eq(messages.id, messageId), eq(messages.ticketId, ticketId)));
  return rows[0];
}

/**
 * Fetches message metadata for delete authorization.
 * Used by: message:delete
 */
export async function findMessageForDelete(messageId: string, ticketId: string) {
  const rows = await db
    .select({
      senderId: messages.senderId,
      system: messages.system,
      deletedAt: messages.deletedAt,
    })
    .from(messages)
    .where(and(eq(messages.id, messageId), eq(messages.ticketId, ticketId)));
  return rows[0];
}

/**
 * Updates message text and sets editedAt timestamp.
 * Used by: message:edit
 */
export async function updateMessageText(messageId: string, newText: string) {
  const now = new Date().toISOString();
  await db
    .update(messages)
    .set({ text: newText, editedAt: now })
    .where(eq(messages.id, messageId));
  return now;
}

/**
 * Soft-deletes a message (sets deletedAt, clears text).
 * Used by: message:delete
 */
export async function softDeleteMessage(messageId: string) {
  const now = new Date().toISOString();
  await db
    .update(messages)
    .set({ deletedAt: now, text: '' })
    .where(eq(messages.id, messageId));
  return now;
}

/**
 * Marks a single message as delivered.
 * Used by: message:delivered
 */
export async function markDelivered(messageId: string, ticketId: string) {
  const now = new Date().toISOString();
  await db
    .update(messages)
    .set({ deliveredAt: now })
    .where(and(eq(messages.id, messageId), eq(messages.ticketId, ticketId), isNull(messages.deliveredAt)));
  return now;
}

/**
 * Batch marks messages as read.
 * Used by: message:read
 */
export async function markRead(messageIds: string[], ticketId: string) {
  const now = new Date().toISOString();
  await db
    .update(messages)
    .set({ readAt: now })
    .where(and(eq(messages.ticketId, ticketId), inArray(messages.id, messageIds), isNull(messages.readAt)));
  return now;
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
docker compose exec server npx vitest run services/messageQueries.test.ts
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
docker compose exec server sh -c "cd /app && git add services/messageQueries.ts services/messageQueries.test.ts && git commit -m 'feat: add messageQueries Drizzle module with tests'"
```

---

### Task 4: Create `ticketQueries.ts` + tests

This is the largest module (~18 functions). Some use PostgreSQL JSONB operators via Drizzle's `sql` tag.

**Files:**
- Create: `server/services/ticketQueries.ts`
- Create: `server/services/ticketQueries.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// server/services/ticketQueries.test.ts
import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('../db/postgres.js', () => {
  const chainable = {
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockResolvedValue([]),
    orderBy: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue([]),
    set: vi.fn().mockReturnThis(),
    values: vi.fn().mockResolvedValue(undefined),
  };
  return {
    db: {
      select: vi.fn().mockReturnValue(chainable),
      insert: vi.fn().mockReturnValue(chainable),
      update: vi.fn().mockReturnValue(chainable),
      delete: vi.fn().mockReturnValue(chainable),
      transaction: vi.fn().mockImplementation(async (cb) => cb({
        delete: vi.fn().mockReturnValue(chainable),
        insert: vi.fn().mockReturnValue(chainable),
      })),
      execute: vi.fn().mockResolvedValue({ rows: [] }),
    },
  };
});

import {
  findTicketPartner,
  findTicketForJoin,
  findTicketForClose,
  findTicketOwner,
  findTicketParticipants,
  findRecentClosedTickets,
  findActiveTicketsForAgent,
  findActiveTicketsForSupport,
  createTicket,
  closeTicket,
  updateTicketSla,
  returnTicketToQueue,
  replaceTicketLabels,
  findPartnerLabels,
} from './ticketQueries.js';
import { db } from '../db/postgres.js';

describe('ticketQueries', () => {
  beforeEach(() => vi.clearAllMocks());

  describe('findTicketPartner', () => {
    it('returns partnerId when found', async () => {
      const chain = { from: vi.fn().mockReturnThis(), where: vi.fn().mockResolvedValue([{ partnerId: 'p1' }]) };
      vi.mocked(db.select).mockReturnValue(chain as never);
      const result = await findTicketPartner('t1');
      expect(result).toEqual({ partnerId: 'p1' });
    });

    it('returns undefined when not found', async () => {
      const chain = { from: vi.fn().mockReturnThis(), where: vi.fn().mockResolvedValue([]) };
      vi.mocked(db.select).mockReturnValue(chain as never);
      const result = await findTicketPartner('missing');
      expect(result).toBeUndefined();
    });
  });

  describe('findTicketForJoin', () => {
    it('returns full ticket row for support:join', async () => {
      const mockTicket = { id: 't1', partnerId: 'p1', supportId: null, supportName: null, supportLang: null, supportJoinedAt: null, status: 'open', participants: [] };
      const chain = { from: vi.fn().mockReturnThis(), where: vi.fn().mockResolvedValue([mockTicket]) };
      vi.mocked(db.select).mockReturnValue(chain as never);
      const result = await findTicketForJoin('t1');
      expect(result?.id).toBe('t1');
    });
  });

  describe('findTicketForClose', () => {
    it('returns status and partnerId', async () => {
      const chain = { from: vi.fn().mockReturnThis(), where: vi.fn().mockResolvedValue([{ status: 'open', partnerId: 'p1' }]) };
      vi.mocked(db.select).mockReturnValue(chain as never);
      const result = await findTicketForClose('t1');
      expect(result?.status).toBe('open');
    });
  });

  describe('findTicketOwner', () => {
    it('returns partner, agent, support IDs', async () => {
      const chain = { from: vi.fn().mockReturnThis(), where: vi.fn().mockResolvedValue([{ partnerId: 'p1', agentId: 'a1', supportId: 's1' }]) };
      vi.mocked(db.select).mockReturnValue(chain as never);
      const result = await findTicketOwner('t1');
      expect(result?.agentId).toBe('a1');
    });
  });

  describe('findRecentClosedTickets', () => {
    it('returns closed tickets with reopen data', async () => {
      const rows = [{ id: 't1', reopenCount: 0, references: [] }];
      const chain = { from: vi.fn().mockReturnThis(), where: vi.fn().mockReturnThis(), orderBy: vi.fn().mockReturnThis(), limit: vi.fn().mockResolvedValue(rows) };
      vi.mocked(db.select).mockReturnValue(chain as never);
      const result = await findRecentClosedTickets('p1', 100);
      expect(result).toHaveLength(1);
    });
  });

  describe('findActiveTicketsForAgent', () => {
    it('returns open ticket IDs for agent', async () => {
      const chain = { from: vi.fn().mockReturnThis(), where: vi.fn().mockResolvedValue([{ id: 't1' }]) };
      vi.mocked(db.select).mockReturnValue(chain as never);
      const result = await findActiveTicketsForAgent('u1', 'p1');
      expect(result).toEqual([{ id: 't1' }]);
    });
  });

  describe('createTicket', () => {
    it('inserts a ticket', async () => {
      const insertChain = { values: vi.fn().mockResolvedValue(undefined) };
      vi.mocked(db.insert).mockReturnValue(insertChain as never);
      await createTicket({
        id: 't1', partnerId: 'p1', dept: 'sales', agentId: 'a1',
        agentName: 'Alice', agentLang: 'en', references: [],
        status: 'open', createdAt: '2026-01-01', participants: '[]',
        reopened: false, reopenCount: 0,
      });
      expect(db.insert).toHaveBeenCalled();
    });
  });

  describe('closeTicket', () => {
    it('sets status to closed with timestamp', async () => {
      const chain = { set: vi.fn().mockReturnThis(), where: vi.fn().mockResolvedValue(undefined) };
      vi.mocked(db.update).mockReturnValue(chain as never);
      await closeTicket('t1', 'Bob', 'resolved now');
      expect(db.update).toHaveBeenCalled();
    });
  });

  describe('replaceTicketLabels', () => {
    it('replaces labels in a transaction', async () => {
      await replaceTicketLabels('t1', ['l1', 'l2']);
      expect(db.transaction).toHaveBeenCalled();
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
docker compose exec server npx vitest run services/ticketQueries.test.ts
```

Expected: FAIL — `Cannot find module './ticketQueries.js'`

- [ ] **Step 3: Implement ticketQueries**

```typescript
// server/services/ticketQueries.ts
import { eq, and, ne, desc, sql, inArray } from 'drizzle-orm';
import { db } from '../db/postgres.js';
import { tickets, ticketLabels, labels } from '../db/schema.js';

// ── SELECT queries ──────────────────────────────────────────────────────────

/**
 * Fetches just the partnerId for a ticket (used for tenant isolation checks).
 * Used by: message:delivered, message:read, message:edit, message:delete,
 *          ticket:labels:update, ticket:viewing
 */
export async function findTicketPartner(ticketId: string) {
  const rows = await db
    .select({ partnerId: tickets.partnerId })
    .from(tickets)
    .where(eq(tickets.id, ticketId));
  return rows[0];
}

/**
 * Fetches full ticket info needed for support:join.
 */
export async function findTicketForJoin(ticketId: string) {
  const rows = await db
    .select({
      id: tickets.id,
      partnerId: tickets.partnerId,
      supportId: tickets.supportId,
      supportName: tickets.supportName,
      supportLang: tickets.supportLang,
      supportJoinedAt: tickets.supportJoinedAt,
      status: tickets.status,
      participants: tickets.participants,
    })
    .from(tickets)
    .where(eq(tickets.id, ticketId));
  return rows[0];
}

/**
 * Fetches ticket status and partner for close authorization.
 * Used by: ticket:close
 */
export async function findTicketForClose(ticketId: string) {
  const rows = await db
    .select({ status: tickets.status, partnerId: tickets.partnerId })
    .from(tickets)
    .where(eq(tickets.id, ticketId));
  return rows[0];
}

/**
 * Fetches ticket owner info for rating authorization.
 * Used by: rating:submit
 */
export async function findTicketOwner(ticketId: string) {
  const rows = await db
    .select({ partnerId: tickets.partnerId, agentId: tickets.agentId, supportId: tickets.supportId })
    .from(tickets)
    .where(eq(tickets.id, ticketId));
  return rows[0];
}

/**
 * Fetches ticket participants and partnerId.
 * Used by: support:leave
 */
export async function findTicketParticipants(ticketId: string) {
  const rows = await db
    .select({ partnerId: tickets.partnerId, participants: tickets.participants })
    .from(tickets)
    .where(eq(tickets.id, ticketId));
  return rows[0];
}

/**
 * Fetches ticket status and partner for message:send authorization.
 * Used by: message:send
 */
export async function findTicketForMessage(ticketId: string) {
  const rows = await db
    .select({ status: tickets.status, partnerId: tickets.partnerId })
    .from(tickets)
    .where(eq(tickets.id, ticketId));
  return rows[0];
}

/**
 * Fetches recently closed tickets for reopen detection.
 * Used by: ticket:new
 */
export async function findRecentClosedTickets(partnerId: string, limit: number) {
  return db
    .select({ id: tickets.id, reopenCount: tickets.reopenCount, references: tickets.references })
    .from(tickets)
    .where(and(eq(tickets.partnerId, partnerId), eq(tickets.status, 'closed')))
    .orderBy(desc(tickets.createdAt))
    .limit(limit);
}

/**
 * Fetches active (non-closed) ticket IDs for an agent. Used during reconnect.
 * Used by: socket:identify
 */
export async function findActiveTicketsForAgent(userId: string, partnerId: string) {
  return db
    .select({ id: tickets.id })
    .from(tickets)
    .where(and(eq(tickets.agentId, userId), eq(tickets.partnerId, partnerId), ne(tickets.status, 'closed')));
}

/**
 * Fetches active ticket IDs for a support user (by supportId or JSONB participant).
 * Uses raw SQL for JSONB @> containment operator.
 * Used by: socket:identify
 */
export async function findActiveTicketsForSupport(userId: string, partnerId: string) {
  return db
    .select({ id: tickets.id })
    .from(tickets)
    .where(
      and(
        eq(tickets.partnerId, partnerId),
        ne(tickets.status, 'closed'),
        sql`(${tickets.supportId} = ${userId} OR ${tickets.participants}::jsonb @> ${JSON.stringify([{ id: userId }])}::jsonb)`,
      ),
    );
}

/**
 * Fetches ticket info for transfer authorization.
 * Used by: ticket:transfer
 */
export async function findTicketForTransfer(ticketId: string) {
  const rows = await db
    .select({
      id: tickets.id,
      partnerId: tickets.partnerId,
      supportId: tickets.supportId,
      supportName: tickets.supportName,
      participants: tickets.participants,
    })
    .from(tickets)
    .where(eq(tickets.id, ticketId));
  return rows[0];
}

/**
 * Fetches all labels belonging to a partner. Used for label validation.
 * Used by: ticket:labels:update
 */
export async function findPartnerLabels(partnerId: string, labelIds: string[]) {
  return db
    .select({ id: labels.id })
    .from(labels)
    .where(and(eq(labels.partnerId, partnerId), inArray(labels.id, labelIds)));
}

// ── INSERT / UPDATE queries ─────────────────────────────────────────────────

export interface CreateTicketData {
  id: string;
  partnerId: string;
  dept: string;
  agentId: string;
  agentName: string;
  agentLang: string;
  references: Array<{ label: string; value: string }>;
  status: string;
  createdAt: string;
  participants: string;
  reopened: boolean;
  reopenCount: number;
}

/**
 * Inserts a new ticket.
 * Used by: ticket:new
 */
export async function createTicket(data: CreateTicketData) {
  await db.insert(tickets).values({
    id: data.id,
    partnerId: data.partnerId,
    dept: data.dept,
    agentId: data.agentId,
    agentName: data.agentName,
    agentLang: data.agentLang,
    references: data.references,
    status: data.status as 'open',
    createdAt: data.createdAt,
    participants: JSON.parse(data.participants),
    reopened: data.reopened,
    reopenCount: data.reopenCount,
  });
}

/**
 * Assigns support to a ticket using COALESCE for idempotency + JSONB participant update.
 * Uses raw SQL for the complex JSONB conditional append.
 * Used by: support:join
 */
export async function assignSupport(
  ticketId: string,
  supportId: string,
  supportName: string,
  supportLang: string,
) {
  const participantJson = JSON.stringify({ id: supportId, name: supportName });
  await db.execute(sql`UPDATE tickets SET
    support_id = COALESCE(support_id, ${supportId}),
    support_name = COALESCE(support_name, ${supportName}),
    support_lang = COALESCE(support_lang, ${supportLang}),
    support_joined_at = COALESCE(support_joined_at, ${new Date().toISOString()}),
    participants = CASE
      WHEN NOT (COALESCE(participants, '[]')::jsonb @> ${`[${participantJson}]`}::jsonb)
      THEN (COALESCE(participants, '[]')::jsonb || ${participantJson}::jsonb)::text
      ELSE participants
    END,
    status = 'open'
  WHERE id = ${ticketId}`);
}

/**
 * Reads back updated participants after assignment.
 * Used by: support:join
 */
export async function findUpdatedParticipants(ticketId: string) {
  const rows = await db
    .select({ participants: tickets.participants })
    .from(tickets)
    .where(eq(tickets.id, ticketId));
  return rows[0]?.participants;
}

/**
 * Updates ticket participants JSONB.
 * Used by: support:leave
 */
export async function updateParticipants(ticketId: string, participants: Array<{ id: string; name: string }>) {
  await db
    .update(tickets)
    .set({ participants })
    .where(eq(tickets.id, ticketId));
}

/**
 * Closes a ticket with timestamp, closer name, and notes.
 * Used by: ticket:close
 */
export async function closeTicket(ticketId: string, closedBy: string, closingNotes: string) {
  const now = new Date().toISOString();
  await db
    .update(tickets)
    .set({ status: 'closed', closedAt: now, closedBy, closingNotes })
    .where(eq(tickets.id, ticketId));
  return now;
}

/**
 * Updates SLA due dates on a ticket.
 * Used by: ticket:new
 */
export async function updateTicketSla(ticketId: string, slaResponseDueAt: string, slaResolutionDueAt: string) {
  await db
    .update(tickets)
    .set({ slaResponseDueAt, slaResolutionDueAt })
    .where(eq(tickets.id, ticketId));
}

/**
 * Transfers ticket to a new support agent using JSONB participant manipulation.
 * Uses raw SQL for the complex JSONB filter + append.
 * Used by: ticket:transfer (to specific agent)
 */
export async function transferTicket(
  ticketId: string,
  targetSupportId: string,
  targetName: string,
  senderId: string,
) {
  const newParticipantJson = JSON.stringify({ id: targetSupportId, name: targetName });
  await db.execute(sql`UPDATE tickets SET
    support_id = ${targetSupportId},
    support_name = ${targetName},
    participants = (
      SELECT COALESCE(jsonb_agg(elem), '[]'::jsonb) || ${newParticipantJson}::jsonb
      FROM jsonb_array_elements(COALESCE(participants, '[]')::jsonb) AS elem
      WHERE elem->>'id' != ${senderId} AND elem->>'id' != ${targetSupportId}
    )::text
  WHERE id = ${ticketId}`);
}

/**
 * Returns ticket to queue — unassigns support.
 * Used by: ticket:transfer (no target)
 */
export async function returnTicketToQueue(ticketId: string) {
  await db
    .update(tickets)
    .set({ supportId: null, supportName: null, status: 'open' })
    .where(eq(tickets.id, ticketId));
}

/**
 * Atomically replaces all labels on a ticket.
 * Used by: ticket:labels:update
 */
export async function replaceTicketLabels(ticketId: string, labelIds: string[]) {
  await db.transaction(async (tx) => {
    await tx.delete(ticketLabels).where(eq(ticketLabels.ticketId, ticketId));
    if (labelIds.length > 0) {
      await tx.insert(ticketLabels).values(
        labelIds.map((labelId) => ({ ticketId, labelId })),
      );
    }
  });
}

/**
 * Inserts a rating (ON CONFLICT DO NOTHING for idempotency).
 * Uses raw SQL for the ON CONFLICT clause.
 * Used by: rating:submit
 */
export async function insertRating(data: {
  id: string;
  ticketId: string;
  agentId: string;
  supportId: string;
  partnerId: string;
  rating: number;
  comment: string | null;
}) {
  await db.execute(sql`INSERT INTO ratings (id, ticket_id, agent_id, support_id, partner_id, rating, comment)
    VALUES (${data.id}, ${data.ticketId}, ${data.agentId}, ${data.supportId}, ${data.partnerId}, ${data.rating}, ${data.comment})
    ON CONFLICT (ticket_id) DO NOTHING`);
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
docker compose exec server npx vitest run services/ticketQueries.test.ts
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
docker compose exec server sh -c "cd /app && git add services/ticketQueries.ts services/ticketQueries.test.ts && git commit -m 'feat: add ticketQueries Drizzle module with tests'"
```

---

### Task 5: Wire `partnerQueries` + `userQueries` into handlers.ts

Replace raw SQL calls that use partner and user lookups.

**Files:**
- Modify: `server/socket/handlers.ts`

- [ ] **Step 1: Add imports**

Add to the import block:

```typescript
import { findPartnerConfig } from '../services/partnerQueries.js';
import { findUserById, findMembership, findSenderInfo, findUserName, findTargetSupport } from '../services/userQueries.js';
```

- [ ] **Step 2: Replace socket:identify user lookup (line ~327)**

Before:
```typescript
const userRow = await get('SELECT name, is_platform_operator FROM users WHERE id = $1', [userId]) as { name: string; isPlatformOperator: boolean } | undefined;
```

After:
```typescript
const userRow = await findUserById(userId);
```

- [ ] **Step 3: Replace socket:identify membership lookup (line ~336)**

Before:
```typescript
const membership = await get('SELECT role FROM memberships WHERE user_id = $1 AND partner_id = $2', [userId, partnerId]) as { role: string } | undefined;
```

After:
```typescript
const membership = await findMembership(userId, partnerId);
```

- [ ] **Step 4: Replace ticket:new partner config (line ~398)**

Before:
```typescript
const partnerRow = partnerId ? await get('SELECT status, business_hours_schedule, business_hours_start, business_hours_end, business_hours_timezone, sla_config FROM partners WHERE id = $1', [partnerId]) as { status: string; business_hours_schedule: unknown; business_hours_start: string | null; business_hours_end: string | null; business_hours_timezone: string | null; sla_config: unknown } | undefined : null;
```

After:
```typescript
const partnerRow = partnerId ? await findPartnerConfig(partnerId) : null;
```

- [ ] **Step 5: Replace ticket:new agent name lookup (line ~445)**

Before:
```typescript
const agentUser = (await get('SELECT name FROM users WHERE id = $1', [agentId])) as unknown as User;
```

After:
```typescript
const agentUser = await findUserName(agentId);
```

- [ ] **Step 6: Replace message:send sender info JOIN (line ~682)**

Before:
```typescript
let sender = (await get('SELECT u.name, m.role, u.lang FROM users u JOIN memberships m ON u.id = m.user_id WHERE u.id = $1 AND m.partner_id = $2', [senderId, ticket.partner_id])) as unknown as SenderInfo;
```

After:
```typescript
let sender = await findSenderInfo(senderId, ticket.partnerId) as SenderInfo | undefined;
```

**Note:** The raw SQL returned `ticket.partner_id` (snake_case from raw query). Since `findTicketForMessage` (wired in Task 7) returns `partnerId` (camelCase from Drizzle), update `ticket.partner_id` to `ticket.partnerId` in this and surrounding code. If ticket:new hasn't been wired yet, use the Drizzle result property name.

- [ ] **Step 7: Replace ticket:transfer target user lookup (line ~908)**

Before:
```typescript
const targetUser = await get('SELECT u.name FROM users u JOIN memberships m ON u.id = m.user_id WHERE u.id = $1 AND m.partner_id = $2', [targetSupportId, callerPartnerId]) as { name: string } | undefined;
```

After:
```typescript
const targetUser = await findTargetSupport(targetSupportId, callerPartnerId);
```

- [ ] **Step 8: Run all server tests**

```bash
docker compose exec server npm test
```

Expected: All tests pass.

- [ ] **Step 9: Commit**

```bash
docker compose exec server sh -c "cd /app && git add socket/handlers.ts && git commit -m 'refactor: wire partnerQueries + userQueries into socket handlers'"
```

---

### Task 6: Wire `messageQueries` into handlers.ts

Replace raw SQL calls for message operations.

**Files:**
- Modify: `server/socket/handlers.ts`

- [ ] **Step 1: Add import**

```typescript
import {
  insertMessage,
  findTicketMessages,
  findTicketLabelIds,
  findMessageForEdit,
  findMessageForDelete,
  updateMessageText,
  softDeleteMessage,
  markDelivered,
  markRead,
} from '../services/messageQueries.js';
```

- [ ] **Step 2: Replace ticket:new message insert (line ~471)**

Before:
```typescript
await run(`INSERT INTO messages (id, ticket_id, sender_id, sender_name, sender_role, sender_lang, text, media_url, whisper, system, created_at, reactions) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`, [message.id, message.ticketId, message.senderId, message.senderName, message.senderRole, message.senderLang, message.originalText, mediaUrl || null, 0, 0, message.timestamp, '{}']);
```

After — restructure to use `insertMessage`. The current code constructs a `message` object manually then inserts. Replace with:
```typescript
const msg = await insertMessage({
  ticketId: ticket.id,
  senderId: agentId,
  senderName: agentUser?.name || agentId,
  senderRole: 'agent',
  senderLang: agentLang,
  text: text,
  mediaUrl: mediaUrl,
});
message = msg;
```

Adjust the local `message` variable type and the subsequent code that uses `message.id`, `message.ticketId`, etc. to work with the returned object.

- [ ] **Step 3: Replace support:join message history (line ~542)**

Before:
```typescript
const messages = (await query('SELECT * FROM messages WHERE ticket_id = $1 ORDER BY created_at ASC', [ticketId]) as unknown as Parameters<typeof mapMessageRow>[0][]).map(mapMessageRow);
socket.emit('ticket:history', { ticketId, messages, labels: (await query('SELECT label_id FROM ticket_labels WHERE ticket_id = $1', [ticketId]) as unknown as TicketLabelRow[]).map((l) => l.labelId) });
```

After:
```typescript
const msgs = (await findTicketMessages(ticketId)).map(mapMessageRow);
const labelIds = await findTicketLabelIds(ticketId);
socket.emit('ticket:history', { ticketId, messages: msgs, labels: labelIds });
```

**Note:** `findTicketMessages` returns Drizzle rows with camelCase keys. Verify that `mapMessageRow` handles this correctly — it may need adjustment if it expects snake_case. Read `server/utils/messageMapper.ts` to check.

- [ ] **Step 4: Replace message:send insert (line ~730)**

Before:
```typescript
await run(`INSERT INTO messages ...`, [messageId, ticketId, senderId, sender.name, sender.role, sender.lang, guardedText, mediaUrl || null, isWhisper ? 1 : 0, 0, now, '{}']);
const msgPayload = { id: messageId, ticketId, senderId, senderName: sender.name, ... };
```

After:
```typescript
const msgPayload = await insertMessage({
  ticketId,
  senderId,
  senderName: sender.name,
  senderRole: sender.role,
  senderLang: sender.lang,
  text: guardedText,
  mediaUrl,
  whisper: isWhisper,
});
```

Remove the manual `messageId`, `now`, and `msgPayload` construction — `insertMessage` handles all of it.

- [ ] **Step 5: Replace message:delivered (line ~778)**

Before:
```typescript
const now = new Date().toISOString();
await run('UPDATE messages SET delivered_at = $1 WHERE id = $2 AND ticket_id = $3 AND delivered_at IS NULL', [now, messageId, ticketId]);
io.to(Rooms.ticket(ticketId)).emit('message:status', { messageId, ticketId, status: 'delivered', timestamp: now });
```

After:
```typescript
const now = await markDelivered(messageId, ticketId);
io.to(Rooms.ticket(ticketId)).emit('message:status', { messageId, ticketId, status: 'delivered', timestamp: now });
```

- [ ] **Step 6: Replace message:read (lines ~796-798)**

Before:
```typescript
const placeholders = limitedIds.map((_, i) => `$${i + 3}`).join(',');
await run(`UPDATE messages SET read_at = $1 WHERE ticket_id = $2 AND id IN (${placeholders}) AND read_at IS NULL`, [now, ticketId, ...limitedIds]);
```

After:
```typescript
const now = await markRead(limitedIds, ticketId);
```

- [ ] **Step 7: Replace message:edit lookups and update (lines ~822, 853)**

Before:
```typescript
const msg = await get('SELECT sender_id, created_at, system, deleted_at FROM messages WHERE id = $1 AND ticket_id = $2', [messageId, ticketId]) as { sender_id: string; created_at: string; system: number; deleted_at: string | null } | undefined;
...
await run('UPDATE messages SET text = $1, edited_at = $2 WHERE id = $3', [guardedText, now, messageId]);
```

After:
```typescript
const msg = await findMessageForEdit(messageId, ticketId);
if (!msg) return;
if (msg.senderId !== senderId) return socket.emit('error', { message: 'Can only edit your own messages' });
if (msg.system) return socket.emit('error', { message: 'Cannot edit system messages' });
if (msg.deletedAt) return socket.emit('error', { message: 'Cannot edit deleted messages' });
...
const now = await updateMessageText(messageId, guardedText);
```

**Note:** Property names change from snake_case (`msg.sender_id`, `msg.created_at`) to camelCase (`msg.senderId`, `msg.createdAt`) since Drizzle returns camelCase.

- [ ] **Step 8: Replace message:delete lookups and update (lines ~870, 882)**

Before:
```typescript
const msg = await get('SELECT sender_id, system, deleted_at FROM messages WHERE id = $1 AND ticket_id = $2', [messageId, ticketId]) as { sender_id: string; system: number; deleted_at: string | null } | undefined;
...
await run('UPDATE messages SET deleted_at = $1, text = $2 WHERE id = $3', [now, '', messageId]);
```

After:
```typescript
const msg = await findMessageForDelete(messageId, ticketId);
if (!msg) return;
if (!socket.data.isSupport && msg.senderId !== senderId) {
  return socket.emit('error', { message: 'Can only delete your own messages' });
}
if (msg.system) return socket.emit('error', { message: 'Cannot delete system messages' });
if (msg.deletedAt) return;
const now = await softDeleteMessage(messageId);
```

- [ ] **Step 9: Run all server tests**

```bash
docker compose exec server npm test
```

Expected: All tests pass.

- [ ] **Step 10: Commit**

```bash
docker compose exec server sh -c "cd /app && git add socket/handlers.ts && git commit -m 'refactor: wire messageQueries into socket handlers'"
```

---

### Task 7: Wire `ticketQueries` into handlers.ts

Replace all remaining raw SQL calls for ticket operations.

**Files:**
- Modify: `server/socket/handlers.ts`

- [ ] **Step 1: Add import**

```typescript
import {
  findTicketPartner,
  findTicketForJoin,
  findTicketForClose,
  findTicketOwner,
  findTicketParticipants,
  findTicketForMessage,
  findRecentClosedTickets,
  findActiveTicketsForAgent,
  findActiveTicketsForSupport,
  createTicket,
  assignSupport,
  findUpdatedParticipants,
  updateParticipants,
  closeTicket,
  updateTicketSla,
  transferTicket,
  returnTicketToQueue,
  replaceTicketLabels,
  findPartnerLabels,
  findTicketForTransfer,
  insertRating,
} from '../services/ticketQueries.js';
```

- [ ] **Step 2: Replace socket:identify active ticket queries (lines ~379, 381)**

Before:
```typescript
activeTickets = await query("SELECT id FROM tickets WHERE agent_id = $1 AND partner_id = $2 AND status != 'closed'", [userId, partnerId]) as { id: string }[];
...
activeTickets = await query("SELECT id FROM tickets WHERE (support_id = $1 OR participants::jsonb @> $3::jsonb) AND partner_id = $2 AND status != 'closed'", [userId, partnerId, JSON.stringify([{ id: userId }])]) as { id: string }[];
```

After:
```typescript
activeTickets = await findActiveTicketsForAgent(userId, partnerId);
...
activeTickets = await findActiveTicketsForSupport(userId, partnerId);
```

- [ ] **Step 3: Replace ticket:new queries (lines ~431, 447, 471, 484)**

Replace `recentClosed` query:
```typescript
const recentClosed = await findRecentClosedTickets(partnerId, RECENT_CLOSED_TICKETS_LIMIT);
```

Replace ticket INSERT:
```typescript
await createTicket({
  id: ticket.id, partnerId, dept: ticket.dept, agentId: ticket.agentId,
  agentName: ticket.agentName, agentLang: ticket.agentLang,
  references, status: ticket.status, createdAt: ticket.createdAt,
  participants: ticket.participants, reopened, reopenCount,
});
```

Replace SLA UPDATE:
```typescript
await updateTicketSla(ticket.id, slaResponseDueAt, slaResolutionDueAt);
```

- [ ] **Step 4: Replace support:join queries (lines ~510, 525, 539)**

```typescript
const ticket = await findTicketForJoin(ticketId);
...
await assignSupport(ticketId, supportId, supportName, supportLang);
...
const updatedParticipants = await findUpdatedParticipants(ticketId);
const participants = updatedParticipants || [];
```

- [ ] **Step 5: Replace support:leave queries (lines ~568, 584)**

```typescript
const ticket = await findTicketParticipants(ticketId);
...
await updateParticipants(ticketId, participants);
```

Update property access from `ticket.partner_id` to `ticket.partnerId`.

- [ ] **Step 6: Replace ticket:close queries (lines ~604, 619)**

```typescript
const ticket = await findTicketForClose(ticketId);
...
const now = await closeTicket(ticketId, senderName || 'System', sanitizedNotes);
```

Update `ticket.partner_id` to `ticket.partnerId`.

- [ ] **Step 7: Replace rating:submit queries (lines ~642, 656)**

```typescript
const ticket = await findTicketOwner(ticketId);
...
await insertRating({ id, ticketId, agentId, supportId, partnerId: socket.data.partnerId, rating: intRating, comment: safeComment });
```

Update `ticket.partner_id` to `ticket.partnerId`, `ticket.agent_id` to `ticket.agentId`, `ticket.support_id` to `ticket.supportId`.

- [ ] **Step 8: Replace message:send ticket lookup (line ~673)**

```typescript
const ticket = await findTicketForMessage(ticketId);
```

Update `ticket.partner_id` to `ticket.partnerId`.

- [ ] **Step 9: Replace tenant isolation checks in message:delivered, message:read, message:edit, message:delete, ticket:viewing (lines ~773, 788, 818, 867, 1006)**

Each follows the same pattern. Replace:
```typescript
const ticket = await get('SELECT partner_id FROM tickets WHERE id = $1', [ticketId]) as { partner_id: string } | undefined;
if (!ticket || ticket.partner_id !== socket.data.partnerId) return;
```

With:
```typescript
const ticket = await findTicketPartner(ticketId);
if (!ticket || ticket.partnerId !== socket.data.partnerId) return;
```

- [ ] **Step 10: Replace ticket:transfer queries (line ~902, 913, 934)**

```typescript
const ticket = await findTicketForTransfer(ticketId);
...
await transferTicket(ticketId, targetSupportId, targetUser.name, senderId);
...
await returnTicketToQueue(ticketId);
```

Update `ticket.partner_id` to `ticket.partnerId`.

- [ ] **Step 11: Replace ticket:labels:update queries (lines ~965, 975, 986-990)**

```typescript
const ticket = await findTicketPartner(ticketId);
...
const partnerLabels = await findPartnerLabels(ticket.partnerId, labels);
...
await replaceTicketLabels(ticketId, labels);
```

- [ ] **Step 12: Run all server tests**

```bash
docker compose exec server npm test
```

Expected: All tests pass.

- [ ] **Step 13: Commit**

```bash
docker compose exec server sh -c "cd /app && git add socket/handlers.ts && git commit -m 'refactor: wire ticketQueries into socket handlers'"
```

---

### Task 8: Remove raw DB imports + final cleanup

**Files:**
- Modify: `server/socket/handlers.ts`

- [ ] **Step 1: Remove raw DB imports**

Remove from the import block:
```typescript
import { query, get, run, transaction } from '../db.js';
```

If the file imports from `'../db.js'`, remove that import entirely. If other named exports are used from that module, keep only those.

- [ ] **Step 2: Verify no raw SQL references remain**

```bash
docker compose exec server sh -c "grep -n 'await get\b\|await run\b\|await query\b\|await transaction\b' socket/handlers.ts || echo 'ALL CLEAN'"
```

Expected: `ALL CLEAN`

- [ ] **Step 3: Verify no snake_case property access on query results**

```bash
docker compose exec server sh -c "grep -n 'partner_id\|agent_id\|support_id\|sender_id\|created_at\|deleted_at\|delivered_at\|read_at\|edited_at\|closed_at\|ticket_id\|label_id\|reopen_count\|media_url' socket/handlers.ts | grep -v '//' | grep -v 'sql\`' || echo 'ALL CLEAN'"
```

Expected: `ALL CLEAN` — all property accesses should be camelCase now.

- [ ] **Step 4: Run full server test suite**

```bash
docker compose exec server npm test
```

Expected: All tests pass.

- [ ] **Step 5: Run full client test suite**

```bash
docker compose exec client npm test
```

Expected: All tests pass.

- [ ] **Step 6: Commit**

```bash
docker compose exec server sh -c "cd /app && git add socket/handlers.ts && git commit -m 'refactor: remove all raw SQL imports from socket handlers — Drizzle migration complete'"
```

---

### Task 9: Verify `mapMessageRow` compatibility

The `mapMessageRow` utility in `server/utils/messageMapper.ts` already accepts both camelCase (Drizzle) and snake_case (raw SQL) via its dual-property `MessageRow` interface. No code changes should be needed — this task is verification only.

**Files:**
- Modify (if needed): `server/utils/messageMapper.ts`
- Modify (if needed): `server/socket/handlers.ts`

- [ ] **Step 1: Read `messageMapper.ts`**

Check whether `mapMessageRow` expects snake_case input. If it does property mappings like `row.sender_id → senderId`, it will break with Drizzle's camelCase output.

- [ ] **Step 2: Fix or bypass**

**Option A:** If `mapMessageRow` does snake→camel mapping, either:
- Update it to be a passthrough for already-camelCase Drizzle rows, OR
- Skip calling it when the data comes from Drizzle (since it's already camelCase)

**Option B:** If `mapMessageRow` does other transformations (type coercion, boolean conversion for whisper/system integer→boolean, reactions JSON parsing), keep it but update property access to camelCase.

- [ ] **Step 3: Run all server tests**

```bash
docker compose exec server npm test
```

- [ ] **Step 4: Run client tests**

```bash
docker compose exec client npm test
```

- [ ] **Step 5: Commit (if changes were needed)**

```bash
docker compose exec server sh -c "cd /app && git add utils/messageMapper.ts socket/handlers.ts && git commit -m 'fix: update mapMessageRow for Drizzle camelCase output'"
```
