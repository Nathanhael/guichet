/**
 * Behavioral tests for `lifecycle.edit()`. Runs against a real PGLite via
 * `server/test/pglite-setup.ts`.
 *
 * Boundary contract:
 *   1. Tenant isolation — actor from partner A cannot edit a message in
 *      partner B's ticket; returns `TICKET_NOT_FOUND` with no DB writes.
 *   2. Authorization — non-owner (and non-staff) actors cannot edit
 *      another user's message; system messages and deleted tombstones are
 *      not editable.
 *   3. Edit window — messages older than `MAX_EDIT_WINDOW_MS` reject with
 *      `EDIT_WINDOW_EXPIRED`.
 *   4. Guard pipeline — sync guards (length cap, etc.) fail-closed; the
 *      Redis-backed repetition guard fails open via the port.
 *   5. Happy path — returns `{ ok: true, effects }` with the
 *      `message:edited` emit + `notifyPreviewers` and persists the new
 *      text + editedAt timestamp.
 */
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { MAX_EDIT_WINDOW_MS } from '../../constants.js';
import { messages, partners, tickets, users } from '../../db/schema.js';
import { createTestDb, type TestDbHandle } from '../../test/pglite-setup.js';
import type { UserActor } from '../ticketLifecycle/index.js';
import { createMessageLifecycle, type MessageLifecycle } from './index.js';
import {
  alwaysBlockGuard,
  alwaysOkGuard,
  cannedTranslation,
  inMemoryLinkPreview,
  recordingStorage,
  throwingGuard,
} from './test/stubs.js';

const PARTNER_A = 'partner-a';
const USER_A = 'user-a';
const TICKET_A = 'ticket-a';
const MESSAGE_A = 'message-a';

let handle: TestDbHandle;
let lifecycle: MessageLifecycle;

const aliceActor: UserActor = {
  kind: 'user',
  userId: USER_A,
  name: 'Alice',
  role: 'agent',
  isPlatformOperator: false,
  isExternal: false,
  lang: 'en',
  partnerId: PARTNER_A,
};

async function seedBaseline(opts: { messageCreatedAt?: string } = {}): Promise<void> {
  await handle.db.insert(partners).values({ id: PARTNER_A, name: 'A', status: 'active' });
  await handle.db.insert(users).values({ id: USER_A, email: 'a@x.test', name: 'Alice' });
  await handle.db.insert(tickets).values({
    id: TICKET_A,
    partnerId: PARTNER_A,
    dept: 'general',
    agentId: USER_A,
    agentName: 'Alice',
    status: 'open',
  });
  await handle.db.insert(messages).values({
    id: MESSAGE_A,
    ticketId: TICKET_A,
    senderId: USER_A,
    senderName: 'Alice',
    senderRole: 'agent',
    senderLang: 'en',
    text: 'hello',
    reactions: {},
    ...(opts.messageCreatedAt ? { createdAt: opts.messageCreatedAt } : {}),
  });
}

function buildLifecycle(opts: { repetitionGuard?: ReturnType<typeof alwaysOkGuard> } = {}): MessageLifecycle {
  return createMessageLifecycle({
    db: handle.db,
    ports: {
      linkPreview: inMemoryLinkPreview(),
      aiTranslation: cannedTranslation(),
      repetitionGuard: opts.repetitionGuard ?? alwaysOkGuard(),
    },
    storage: recordingStorage().storage,
  });
}

beforeEach(async () => {
  handle = await createTestDb();
  await seedBaseline();
  lifecycle = buildLifecycle();
});

afterEach(async () => {
  await handle.close();
});

describe('messageLifecycle.edit', () => {
  it('updates the message text and returns the editedAt timestamp', async () => {
    const result = await lifecycle.edit({
      ticketId: TICKET_A,
      partnerId: PARTNER_A,
      messageId: MESSAGE_A,
      actor: aliceActor,
      newText: 'updated text',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.data.messageId).toBe(MESSAGE_A);
    expect(result.data.text).toBe('updated text');
    expect(result.data.editedAt).toBeTruthy();

    expect(result.effects).toContainEqual(
      expect.objectContaining({
        type: 'emit',
        event: 'message:edited',
      }),
    );
    expect(result.effects).toContainEqual({
      type: 'notifyPreviewers',
      ticketId: TICKET_A,
    });

    const [row] = await handle.db
      .select({ text: messages.text, editedAt: messages.editedAt })
      .from(messages)
      .where(eq(messages.id, MESSAGE_A));
    expect(row.text).toBe('updated text');
    expect(row.editedAt).toBeTruthy();
  });

  it('rejects with TICKET_NOT_FOUND when actor is in a different partner', async () => {
    const PARTNER_B = 'partner-b';
    const USER_B = 'user-b';
    await handle.db.insert(partners).values({ id: PARTNER_B, name: 'B', status: 'active' });
    await handle.db.insert(users).values({ id: USER_B, email: 'b@x.test', name: 'Bob' });
    const bobActor: UserActor = {
      kind: 'user', userId: USER_B, name: 'Bob', role: 'agent',
      isPlatformOperator: false, isExternal: false, lang: 'en', partnerId: PARTNER_B,
    };

    const result = await lifecycle.edit({
      ticketId: TICKET_A, partnerId: PARTNER_B, messageId: MESSAGE_A,
      actor: bobActor, newText: 'leak',
    });

    expect(result).toEqual({ ok: false, code: 'TICKET_NOT_FOUND' });

    const [row] = await handle.db
      .select({ text: messages.text }).from(messages).where(eq(messages.id, MESSAGE_A));
    expect(row.text).toBe('hello');
  });

  it('rejects with NOT_OWN_MESSAGE when a non-owner non-staff edits', async () => {
    const USER_C = 'user-c';
    await handle.db.insert(users).values({ id: USER_C, email: 'c@x.test', name: 'Carol' });
    const carolActor: UserActor = {
      kind: 'user', userId: USER_C, name: 'Carol', role: 'agent',
      isPlatformOperator: false, isExternal: false, lang: 'en', partnerId: PARTNER_A,
    };

    const result = await lifecycle.edit({
      ticketId: TICKET_A, partnerId: PARTNER_A, messageId: MESSAGE_A,
      actor: carolActor, newText: 'not mine',
    });

    expect(result).toEqual({ ok: false, code: 'NOT_OWN_MESSAGE' });
  });

  it('rejects with CANNOT_MUTATE_SYSTEM for a system message', async () => {
    const SYS_MSG = 'sys-msg';
    await handle.db.insert(messages).values({
      id: SYS_MSG, ticketId: TICKET_A, senderId: '__system__',
      senderName: 'System', senderRole: 'admin', senderLang: 'en',
      text: 'X joined', system: 1, reactions: {},
    });

    const result = await lifecycle.edit({
      ticketId: TICKET_A, partnerId: PARTNER_A, messageId: SYS_MSG,
      actor: aliceActor, newText: 'edit attempt',
    });

    expect(result).toEqual({ ok: false, code: 'CANNOT_MUTATE_SYSTEM' });
  });

  it('rejects with EDIT_WINDOW_EXPIRED when message is older than MAX_EDIT_WINDOW_MS', async () => {
    const OLD_MSG = 'old-msg';
    const oldCreatedAt = new Date(Date.now() - MAX_EDIT_WINDOW_MS - 60_000).toISOString();
    await handle.db.insert(messages).values({
      id: OLD_MSG, ticketId: TICKET_A, senderId: USER_A,
      senderName: 'Alice', senderRole: 'agent', senderLang: 'en',
      text: 'old', reactions: {}, createdAt: oldCreatedAt,
    });

    const result = await lifecycle.edit({
      ticketId: TICKET_A, partnerId: PARTNER_A, messageId: OLD_MSG,
      actor: aliceActor, newText: 'too late',
    });

    expect(result).toEqual({ ok: false, code: 'EDIT_WINDOW_EXPIRED' });
  });

  it('rejects with GUARD_REJECTED when sync guards reject the new text (empty)', async () => {
    const result = await lifecycle.edit({
      ticketId: TICKET_A, partnerId: PARTNER_A, messageId: MESSAGE_A,
      actor: aliceActor, newText: '   ',
    });

    expect(result).toEqual({ ok: false, code: 'GUARD_REJECTED' });

    const [row] = await handle.db
      .select({ text: messages.text }).from(messages).where(eq(messages.id, MESSAGE_A));
    expect(row.text).toBe('hello');
  });

  it('rejects with GUARD_REJECTED when repetition guard blocks the edit', async () => {
    const blockingLifecycle = buildLifecycle({ repetitionGuard: alwaysBlockGuard() });

    const result = await blockingLifecycle.edit({
      ticketId: TICKET_A, partnerId: PARTNER_A, messageId: MESSAGE_A,
      actor: aliceActor, newText: 'spam spam spam',
    });

    expect(result).toEqual({ ok: false, code: 'GUARD_REJECTED' });
  });

  it('proceeds when repetition guard throws (fail-open)', async () => {
    const flakyLifecycle = buildLifecycle({ repetitionGuard: throwingGuard() });

    const result = await flakyLifecycle.edit({
      ticketId: TICKET_A, partnerId: PARTNER_A, messageId: MESSAGE_A,
      actor: aliceActor, newText: 'updated under redis outage',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.text).toBe('updated under redis outage');
  });

  it('rejects with CANNOT_MUTATE_DELETED for a soft-deleted tombstone', async () => {
    const DEL_MSG = 'del-msg';
    await handle.db.insert(messages).values({
      id: DEL_MSG, ticketId: TICKET_A, senderId: USER_A,
      senderName: 'Alice', senderRole: 'agent', senderLang: 'en',
      text: '', deletedAt: new Date().toISOString(), reactions: {},
    });

    const result = await lifecycle.edit({
      ticketId: TICKET_A, partnerId: PARTNER_A, messageId: DEL_MSG,
      actor: aliceActor, newText: 'edit attempt',
    });

    expect(result).toEqual({ ok: false, code: 'CANNOT_MUTATE_DELETED' });
  });
});

