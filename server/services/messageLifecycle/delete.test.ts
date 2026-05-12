/**
 * Behavioral tests for `lifecycle.delete()`. Runs against a real PGLite via
 * `server/test/pglite-setup.ts`.
 *
 * Boundary contract:
 *   1. Tenant isolation — actor from partner A cannot delete a message in
 *      partner B's ticket; returns `TICKET_NOT_FOUND` with no DB writes.
 *   2. Authorization — staff and message owner may delete; everyone else
 *      → NOT_OWN_MESSAGE. System messages are not deletable.
 *   3. Idempotent re-delete — re-deleting a tombstone is a silent no-op
 *      (no second broadcast, no second storage cleanup).
 *   4. Soft-delete — clears text/mediaUrl/attachments and sets deletedAt.
 *   5. Storage cleanup — fire-and-forget delete on every /uploads/... path
 *      from mediaUrl and attachments, AFTER the DB update commits.
 *   6. Happy path — returns `{ ok: true, effects }` with `message:deleted`
 *      emit + notifyPreviewers.
 */
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { messages, partners, tickets, users } from '../../db/schema.js';
import { createTestDb, type TestDbHandle } from '../../test/pglite-setup.js';
import type { UserActor } from '../ticketLifecycle/index.js';
import { createMessageLifecycle, type MessageLifecycle } from './index.js';
import {
  cannedTranslation,
  inMemoryLinkPreview,
  passingModerator,
  recordingStorage,
  type RecordingStorageHandle,
} from './test/stubs.js';

const PARTNER_A = 'partner-a';
const USER_A = 'user-a';
const USER_SUPPORT = 'user-support';
const TICKET_A = 'ticket-a';
const MESSAGE_A = 'message-a';
const MESSAGE_WITH_BLOBS = 'message-blobs';

let handle: TestDbHandle;
let lifecycle: MessageLifecycle;
let storage: RecordingStorageHandle;

const aliceActor: UserActor = {
  kind: 'user', userId: USER_A, name: 'Alice', role: 'agent',
  isPlatformOperator: false, lang: 'en', partnerId: PARTNER_A,
};

const supportActor: UserActor = {
  kind: 'user', userId: USER_SUPPORT, name: 'Sam', role: 'support',
  isPlatformOperator: false, lang: 'en', partnerId: PARTNER_A,
};

async function seedBaseline(): Promise<void> {
  await handle.db.insert(partners).values({ id: PARTNER_A, name: 'A', status: 'active' });
  await handle.db.insert(users).values([
    { id: USER_A, email: 'a@x.test', name: 'Alice' },
    { id: USER_SUPPORT, email: 's@x.test', name: 'Sam' },
  ]);
  await handle.db.insert(tickets).values({
    id: TICKET_A, partnerId: PARTNER_A, dept: 'general',
    agentId: USER_A, agentName: 'Alice', status: 'open',
  });
  await handle.db.insert(messages).values([
    {
      id: MESSAGE_A, ticketId: TICKET_A, senderId: USER_A,
      senderName: 'Alice', senderRole: 'agent', senderLang: 'en',
      text: 'hello', reactions: {},
    },
    {
      id: MESSAGE_WITH_BLOBS, ticketId: TICKET_A, senderId: USER_A,
      senderName: 'Alice', senderRole: 'agent', senderLang: 'en',
      text: 'with attachments', reactions: {},
      mediaUrl: '/uploads/photo.png',
      attachments: [
        { url: '/uploads/file-1.pdf', name: 'a.pdf', mimeType: 'application/pdf', size: 100 },
        { url: '/uploads/file-2.zip', name: 'b.zip', mimeType: 'application/zip', size: 200 },
      ],
    },
  ]);
}

beforeEach(async () => {
  handle = await createTestDb();
  await seedBaseline();
  storage = recordingStorage();
  lifecycle = createMessageLifecycle({
    db: handle.db,
    ports: {
      linkPreview: inMemoryLinkPreview(),
      aiTranslation: cannedTranslation(),
      moderation: passingModerator(),
    },
    storage: storage.storage,
  });
});

afterEach(async () => {
  await handle.close();
});

describe('messageLifecycle.delete', () => {
  it('soft-deletes the message, clears blobs, and emits broadcast effects', async () => {
    const result = await lifecycle.delete({
      ticketId: TICKET_A,
      partnerId: PARTNER_A,
      messageId: MESSAGE_WITH_BLOBS,
      actor: aliceActor,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.messageId).toBe(MESSAGE_WITH_BLOBS);
    expect(result.data.deletedAt).toBeTruthy();

    expect(result.effects).toContainEqual(
      expect.objectContaining({ type: 'emit', event: 'message:deleted' }),
    );
    expect(result.effects).toContainEqual({
      type: 'notifyPreviewers',
      ticketId: TICKET_A,
    });

    const [row] = await handle.db
      .select({
        text: messages.text,
        mediaUrl: messages.mediaUrl,
        attachments: messages.attachments,
        deletedAt: messages.deletedAt,
      })
      .from(messages)
      .where(eq(messages.id, MESSAGE_WITH_BLOBS));

    expect(row.deletedAt).toBeTruthy();
    expect(row.text).toBe('');
    expect(row.mediaUrl).toBeNull();
    expect(row.attachments).toBeNull();

    // Allow fire-and-forget delete to settle.
    await new Promise((r) => setTimeout(r, 30));
    expect(storage.deleted.has('photo.png')).toBe(true);
    expect(storage.deleted.has('file-1.pdf')).toBe(true);
    expect(storage.deleted.has('file-2.zip')).toBe(true);
  });

  it('rejects with TICKET_NOT_FOUND when actor is in a different partner', async () => {
    const PARTNER_B = 'partner-b';
    const USER_B = 'user-b';
    await handle.db.insert(partners).values({ id: PARTNER_B, name: 'B', status: 'active' });
    await handle.db.insert(users).values({ id: USER_B, email: 'b@x.test', name: 'Bob' });
    const bobActor: UserActor = {
      kind: 'user', userId: USER_B, name: 'Bob', role: 'agent',
      isPlatformOperator: false, lang: 'en', partnerId: PARTNER_B,
    };

    const result = await lifecycle.delete({
      ticketId: TICKET_A, partnerId: PARTNER_B, messageId: MESSAGE_A, actor: bobActor,
    });

    expect(result).toEqual({ ok: false, code: 'TICKET_NOT_FOUND' });

    const [row] = await handle.db
      .select({ deletedAt: messages.deletedAt }).from(messages).where(eq(messages.id, MESSAGE_A));
    expect(row.deletedAt).toBeNull();
  });

  it('rejects with NOT_OWN_MESSAGE when a non-owner non-staff actor tries to delete', async () => {
    const USER_C = 'user-c';
    await handle.db.insert(users).values({ id: USER_C, email: 'c@x.test', name: 'Carol' });
    const carolActor: UserActor = {
      kind: 'user', userId: USER_C, name: 'Carol', role: 'agent',
      isPlatformOperator: false, lang: 'en', partnerId: PARTNER_A,
    };

    const result = await lifecycle.delete({
      ticketId: TICKET_A, partnerId: PARTNER_A, messageId: MESSAGE_A, actor: carolActor,
    });

    expect(result).toEqual({ ok: false, code: 'NOT_OWN_MESSAGE' });
  });

  it('allows staff to delete another user\'s message', async () => {
    const result = await lifecycle.delete({
      ticketId: TICKET_A, partnerId: PARTNER_A, messageId: MESSAGE_A, actor: supportActor,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.messageId).toBe(MESSAGE_A);

    const [row] = await handle.db
      .select({ deletedAt: messages.deletedAt }).from(messages).where(eq(messages.id, MESSAGE_A));
    expect(row.deletedAt).toBeTruthy();
  });

  it('rejects with CANNOT_MUTATE_SYSTEM for a system message', async () => {
    const SYS_MSG = 'sys-msg';
    await handle.db.insert(messages).values({
      id: SYS_MSG, ticketId: TICKET_A, senderId: '__system__',
      senderName: 'System', senderRole: 'admin', senderLang: 'en',
      text: 'X joined', system: 1, reactions: {},
    });

    const result = await lifecycle.delete({
      ticketId: TICKET_A, partnerId: PARTNER_A, messageId: SYS_MSG, actor: supportActor,
    });

    expect(result).toEqual({ ok: false, code: 'CANNOT_MUTATE_SYSTEM' });
  });

  it('idempotent — re-deleting a tombstone returns ok with no broadcast effects', async () => {
    await lifecycle.delete({
      ticketId: TICKET_A, partnerId: PARTNER_A, messageId: MESSAGE_A, actor: aliceActor,
    });

    const second = await lifecycle.delete({
      ticketId: TICKET_A, partnerId: PARTNER_A, messageId: MESSAGE_A, actor: aliceActor,
    });

    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.effects).toEqual([]);
  });
});
