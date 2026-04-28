/**
 * Behavioral tests for `lifecycle.react()`. Runs against a real PGLite via
 * `server/test/pglite-setup.ts` so toggle-math + JSONB persistence are
 * verified against real SQL semantics.
 *
 * Boundary contract:
 *   1. Tenant isolation — actor from partner A cannot react to a message in
 *      partner B's ticket; returns the cross-tenant rejection code with no
 *      DB writes and no effects.
 *   2. Authorization — system messages and deleted tombstones are not
 *      reactable; non-allowed emojis are rejected.
 *   3. Toggle math — adding then removing a user returns to baseline; the
 *      emoji key is removed entirely when the last user toggles off.
 *   4. Happy path — returns `{ ok: true, effects }` with the `reaction:updated`
 *      emit effect and the persisted reactions map.
 */
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { messages, partners, tickets, users } from '../../db/schema.js';
import { createTestDb, type TestDbHandle } from '../../test/pglite-setup.js';
import type { UserActor } from '../ticketLifecycle/index.js';
import { createMessageLifecycle, type MessageLifecycle } from './index.js';
import {
  alwaysOkGuard,
  cannedTranslation,
  inMemoryLinkPreview,
  recordingStorage,
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

async function seedBaseline(): Promise<void> {
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
  });
}

beforeEach(async () => {
  handle = await createTestDb();
  await seedBaseline();
  lifecycle = createMessageLifecycle({
    db: handle.db,
    ports: {
      linkPreview: inMemoryLinkPreview(),
      aiTranslation: cannedTranslation(),
      repetitionGuard: alwaysOkGuard(),
    },
    storage: recordingStorage().storage,
  });
});

afterEach(async () => {
  await handle.close();
});

describe('messageLifecycle.react', () => {
  it('adds a user reaction to a message and returns a broadcast effect', async () => {
    const result = await lifecycle.react({
      ticketId: TICKET_A,
      partnerId: PARTNER_A,
      messageId: MESSAGE_A,
      actor: aliceActor,
      emoji: '👍',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.data.reactions).toEqual({ '👍': [USER_A] });
    expect(result.effects).toContainEqual(
      expect.objectContaining({
        type: 'emit',
        event: 'reaction:updated',
      }),
    );

    const [row] = await handle.db
      .select({ reactions: messages.reactions })
      .from(messages)
      .where(eq(messages.id, MESSAGE_A));
    expect(row.reactions).toEqual({ '👍': [USER_A] });
  });

  it('rejects with TICKET_NOT_FOUND when actor is in a different partner', async () => {
    const PARTNER_B = 'partner-b';
    const USER_B = 'user-b';
    await handle.db.insert(partners).values({ id: PARTNER_B, name: 'B', status: 'active' });
    await handle.db.insert(users).values({ id: USER_B, email: 'b@x.test', name: 'Bob' });

    const bobActor: UserActor = {
      kind: 'user',
      userId: USER_B,
      name: 'Bob',
      role: 'agent',
      isPlatformOperator: false,
      isExternal: false,
      lang: 'en',
      partnerId: PARTNER_B,
    };

    const result = await lifecycle.react({
      ticketId: TICKET_A,
      partnerId: PARTNER_B,
      messageId: MESSAGE_A,
      actor: bobActor,
      emoji: '👍',
    });

    expect(result).toEqual({ ok: false, code: 'TICKET_NOT_FOUND' });

    // No mutation: message reactions remain empty.
    const [row] = await handle.db
      .select({ reactions: messages.reactions })
      .from(messages)
      .where(eq(messages.id, MESSAGE_A));
    expect(row.reactions).toEqual({});
  });

  it('rejects with INVALID_REACTION when emoji is not in the allowed set', async () => {
    const result = await lifecycle.react({
      ticketId: TICKET_A,
      partnerId: PARTNER_A,
      messageId: MESSAGE_A,
      actor: aliceActor,
      emoji: '💩',
    });

    expect(result).toEqual({ ok: false, code: 'INVALID_REACTION' });

    const [row] = await handle.db
      .select({ reactions: messages.reactions })
      .from(messages)
      .where(eq(messages.id, MESSAGE_A));
    expect(row.reactions).toEqual({});
  });

  it('rejects with CANNOT_MUTATE_SYSTEM for a system message', async () => {
    const SYS_MSG = 'sys-msg';
    await handle.db.insert(messages).values({
      id: SYS_MSG,
      ticketId: TICKET_A,
      senderId: '__system__',
      senderName: 'System',
      senderRole: 'admin',
      senderLang: 'en',
      text: 'X joined',
      system: 1,
      reactions: {},
    });

    const result = await lifecycle.react({
      ticketId: TICKET_A,
      partnerId: PARTNER_A,
      messageId: SYS_MSG,
      actor: aliceActor,
      emoji: '👍',
    });

    expect(result).toEqual({ ok: false, code: 'CANNOT_MUTATE_SYSTEM' });
  });

  it('returns a notifyPreviewers effect on a successful toggle (legacy parity)', async () => {
    const result = await lifecycle.react({
      ticketId: TICKET_A,
      partnerId: PARTNER_A,
      messageId: MESSAGE_A,
      actor: aliceActor,
      emoji: '👍',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.effects).toContainEqual({
      type: 'notifyPreviewers',
      ticketId: TICKET_A,
    });
  });

  it('toggling the same user twice removes the reaction and clears the emoji key', async () => {
    await lifecycle.react({
      ticketId: TICKET_A,
      partnerId: PARTNER_A,
      messageId: MESSAGE_A,
      actor: aliceActor,
      emoji: '👍',
    });

    const result = await lifecycle.react({
      ticketId: TICKET_A,
      partnerId: PARTNER_A,
      messageId: MESSAGE_A,
      actor: aliceActor,
      emoji: '👍',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.reactions).toEqual({});

    const [row] = await handle.db
      .select({ reactions: messages.reactions })
      .from(messages)
      .where(eq(messages.id, MESSAGE_A));
    expect(row.reactions).toEqual({});
  });

  it('preserves other users\' reactions when one user toggles off', async () => {
    const USER_B = 'user-b';
    await handle.db.insert(users).values({ id: USER_B, email: 'b@x.test', name: 'Bob' });
    const bobActor: UserActor = {
      kind: 'user',
      userId: USER_B,
      name: 'Bob',
      role: 'agent',
      isPlatformOperator: false,
      isExternal: false,
      lang: 'en',
      partnerId: PARTNER_A,
    };

    await lifecycle.react({ ticketId: TICKET_A, partnerId: PARTNER_A, messageId: MESSAGE_A, actor: aliceActor, emoji: '👍' });
    await lifecycle.react({ ticketId: TICKET_A, partnerId: PARTNER_A, messageId: MESSAGE_A, actor: bobActor, emoji: '👍' });
    const result = await lifecycle.react({ ticketId: TICKET_A, partnerId: PARTNER_A, messageId: MESSAGE_A, actor: aliceActor, emoji: '👍' });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.reactions).toEqual({ '👍': [USER_B] });
  });

  it('rejects with CANNOT_MUTATE_DELETED for a soft-deleted tombstone', async () => {
    const DEL_MSG = 'del-msg';
    await handle.db.insert(messages).values({
      id: DEL_MSG,
      ticketId: TICKET_A,
      senderId: USER_A,
      senderName: 'Alice',
      senderRole: 'agent',
      senderLang: 'en',
      text: '',
      deletedAt: new Date().toISOString(),
      reactions: {},
    });

    const result = await lifecycle.react({
      ticketId: TICKET_A,
      partnerId: PARTNER_A,
      messageId: DEL_MSG,
      actor: aliceActor,
      emoji: '👍',
    });

    expect(result).toEqual({ ok: false, code: 'CANNOT_MUTATE_DELETED' });
  });
});
