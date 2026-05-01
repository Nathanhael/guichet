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
import { auditLog, messages, partners, tickets, users } from '../../db/schema.js';
import { createTestDb, type TestDbHandle } from '../../test/pglite-setup.js';
import type { UserActor } from '../ticketLifecycle/index.js';
import { createMessageLifecycle, type MessageLifecycle } from './index.js';
import type { ModerationContext, ModerationPort, ModerationResult } from './ports.js';
import {
  blockingModerator,
  cannedModerator,
  cannedTranslation,
  inMemoryLinkPreview,
  passingModerator,
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

function buildLifecycle(opts: {
  moderation?: ModerationPort,
} = {}): MessageLifecycle {
  return createMessageLifecycle({
    db: handle.db,
    ports: {
      linkPreview: inMemoryLinkPreview(),
      aiTranslation: cannedTranslation(),
      moderation: opts.moderation ?? passingModerator(),
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

  it('rejects with GUARD_REJECTED when moderator blocks the edit', async () => {
    const blockingLifecycle = buildLifecycle({
      moderation: blockingModerator('guard_too_short'),
    });

    const result = await blockingLifecycle.edit({
      ticketId: TICKET_A, partnerId: PARTNER_A, messageId: MESSAGE_A,
      actor: aliceActor, newText: '   ',
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('GUARD_REJECTED');

    // Original message text is unchanged.
    const [row] = await handle.db
      .select({ text: messages.text }).from(messages).where(eq(messages.id, MESSAGE_A));
    expect(row.text).toBe('hello');
  });

  it('writes message.guard_blocked audit row on edit block (scope=message:edit)', async () => {
    const blockingLifecycle = buildLifecycle({
      moderation: cannedModerator({
        decision: 'block',
        blockingCode: 'guard_threat',
        original: 'i will hurt you',
        sanitized: 'i will hurt you',
        triggered: ['guard_threat'],
      }),
    });

    const result = await blockingLifecycle.edit({
      ticketId: TICKET_A, partnerId: PARTNER_A, messageId: MESSAGE_A,
      actor: aliceActor, newText: 'i will hurt you',
    });
    expect(result.ok).toBe(false);

    const auditRows = await handle.db.select().from(auditLog)
      .where(eq(auditLog.action, 'message.guard_blocked'));
    expect(auditRows).toHaveLength(1);
    const metadata = auditRows[0].metadata as Record<string, unknown>;
    expect(metadata.scope).toBe('message:edit');
    expect(metadata.original).toBe('i will hurt you');
    expect(metadata.blockingCode).toBe('guard_threat');
    expect(auditRows[0].targetId).toBe(TICKET_A);
  });

  it('passes scope=message:edit to the moderator', async () => {
    let capturedCtx: ModerationContext | null = null;
    const captureModeration: ModerationPort = {
      async moderate(text, ctx): Promise<ModerationResult> {
        capturedCtx = ctx;
        return { decision: 'pass', blockingCode: null, original: text, sanitized: text, triggered: [] };
      },
    };
    const captureLifecycle = buildLifecycle({ moderation: captureModeration });

    await captureLifecycle.edit({
      ticketId: TICKET_A, partnerId: PARTNER_A, messageId: MESSAGE_A,
      actor: aliceActor, newText: 'updated text',
    });

    expect(capturedCtx).not.toBeNull();
    expect(capturedCtx!.scope).toBe('message:edit');
    expect(capturedCtx!.senderId).toBe(USER_A);
    expect(capturedCtx!.partnerId).toBe(PARTNER_A);
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

