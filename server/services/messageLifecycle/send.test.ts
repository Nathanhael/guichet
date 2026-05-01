/**
 * Behavioral tests for `lifecycle.send()`. The most-trafficked verb in the
 * system; covers the full content-guard + sender-denorm + insert + SLA
 * stamp + reply snippet + AI prewarm + effect-array assembly pipeline.
 *
 * Boundary contract:
 *   1. Tenant isolation — actor in different partner → TICKET_NOT_FOUND.
 *   2. Closed ticket — TICKET_CLOSED.
 *   3. Sync guards (length cap empty/etc.) → GUARD_REJECTED, no insert.
 *   4. Repetition guard via port — block → GUARD_REJECTED; throw → fail-open.
 *   5. Whisper authz — non-support actor with whisper:true → silent clamp
 *      to public broadcast (preserves legacy); support actor with
 *      whisper:true → whisperEmit effect (not emit).
 *   6. Empty message (no text/mediaUrl/attachments) → EMPTY_MESSAGE.
 *   7. Invalid mediaUrl → INVALID_MEDIA_URL.
 *   8. Happy path — INSERT, return ok with effects array containing
 *      emit/whisperEmit, notifyPreviewers, invalidateSummary, unfurlLinks
 *      in documented order; SLA stamp produces conditional slaResolved.
 */
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { auditLog, messages, partners, slaBreaches, tickets, users } from '../../db/schema.js';
import { createTestDb, type TestDbHandle } from '../../test/pglite-setup.js';
import type { UserActor } from '../ticketLifecycle/index.js';
import { createMessageLifecycle, type MessageLifecycle } from './index.js';
import type { ModerationPort } from './ports.js';
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
const USER_SUPPORT = 'user-support';
const TICKET_A = 'ticket-a';

let handle: TestDbHandle;
let lifecycle: MessageLifecycle;

const aliceActor: UserActor = {
  kind: 'user', userId: USER_A, name: 'Alice', role: 'agent',
  isPlatformOperator: false, isExternal: false, lang: 'en', partnerId: PARTNER_A,
};

const supportActor: UserActor = {
  kind: 'user', userId: USER_SUPPORT, name: 'Sam', role: 'support',
  isPlatformOperator: false, isExternal: false, lang: 'en', partnerId: PARTNER_A,
};

async function seedBaseline(): Promise<void> {
  await handle.db.insert(partners).values({ id: PARTNER_A, name: 'A', status: 'active' });
  await handle.db.insert(users).values([
    { id: USER_A, email: 'a@x.test', name: 'Alice', lang: 'en' },
    { id: USER_SUPPORT, email: 's@x.test', name: 'Sam', lang: 'en' },
  ]);
  await handle.db.insert(tickets).values({
    id: TICKET_A, partnerId: PARTNER_A, dept: 'general',
    agentId: USER_A, agentName: 'Alice', agentLang: 'en', status: 'open',
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

describe('messageLifecycle.send', () => {
  it('inserts a message + returns broadcast + notifyPreviewers + invalidateSummary effects', async () => {
    const result = await lifecycle.send({
      ticketId: TICKET_A,
      partnerId: PARTNER_A,
      actor: aliceActor,
      text: 'hello world',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.message.id).toBeTruthy();
    expect(result.data.message.text).toBe('hello world');

    expect(result.effects).toContainEqual(
      expect.objectContaining({ type: 'emit', event: 'message:new' }),
    );
    expect(result.effects).toContainEqual({ type: 'notifyPreviewers', ticketId: TICKET_A });
    expect(result.effects).toContainEqual({ type: 'invalidateSummary', ticketId: TICKET_A });

    const rows = await handle.db.select().from(messages).where(eq(messages.ticketId, TICKET_A));
    expect(rows).toHaveLength(1);
    expect(rows[0].text).toBe('hello world');
    expect(rows[0].senderId).toBe(USER_A);
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

    const result = await lifecycle.send({
      ticketId: TICKET_A, partnerId: PARTNER_B, actor: bobActor, text: 'leak',
    });

    expect(result).toEqual({ ok: false, code: 'TICKET_NOT_FOUND' });
    const rows = await handle.db.select().from(messages).where(eq(messages.ticketId, TICKET_A));
    expect(rows).toHaveLength(0);
  });

  it('rejects with TICKET_CLOSED when ticket status=closed', async () => {
    await handle.db.update(tickets).set({ status: 'closed' }).where(eq(tickets.id, TICKET_A));

    const result = await lifecycle.send({
      ticketId: TICKET_A, partnerId: PARTNER_A, actor: aliceActor, text: 'too late',
    });

    expect(result).toEqual({ ok: false, code: 'TICKET_CLOSED' });
  });

  it('rejects with EMPTY_MESSAGE when no text/mediaUrl/attachments', async () => {
    const result = await lifecycle.send({
      ticketId: TICKET_A, partnerId: PARTNER_A, actor: aliceActor,
    });

    expect(result).toEqual({ ok: false, code: 'EMPTY_MESSAGE' });
  });

  it('rejects with GUARD_REJECTED when moderator blocks on a sync guard', async () => {
    const blockingLifecycle = buildLifecycle({
      moderation: blockingModerator('guard_too_long'),
    });

    const result = await blockingLifecycle.send({
      ticketId: TICKET_A, partnerId: PARTNER_A, actor: aliceActor, text: 'oversized text',
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('GUARD_REJECTED');
    const rows = await handle.db.select().from(messages).where(eq(messages.ticketId, TICKET_A));
    expect(rows).toHaveLength(0);
  });

  it('rejects with GUARD_REJECTED when moderator blocks on repetition', async () => {
    const blockingLifecycle = buildLifecycle({
      moderation: blockingModerator('guard_repetition'),
    });

    const result = await blockingLifecycle.send({
      ticketId: TICKET_A, partnerId: PARTNER_A, actor: aliceActor, text: 'spam',
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('GUARD_REJECTED');
  });

  it('support actor with whisper:true returns whisperEmit effect (not emit)', async () => {
    const result = await lifecycle.send({
      ticketId: TICKET_A, partnerId: PARTNER_A, actor: supportActor,
      text: 'staff note', whisper: true,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.isWhisper).toBe(true);

    expect(result.effects).toContainEqual(
      expect.objectContaining({ type: 'whisperEmit', event: 'message:new' }),
    );
    expect(result.effects).not.toContainEqual(
      expect.objectContaining({ type: 'emit', event: 'message:new' }),
    );
  });

  it('non-support actor with whisper:true silently clamps to public broadcast', async () => {
    const result = await lifecycle.send({
      ticketId: TICKET_A, partnerId: PARTNER_A, actor: aliceActor,
      text: 'oops not staff', whisper: true,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.isWhisper).toBe(false);

    expect(result.effects).toContainEqual(
      expect.objectContaining({ type: 'emit', event: 'message:new' }),
    );
    expect(result.effects).not.toContainEqual(
      expect.objectContaining({ type: 'whisperEmit' }),
    );
  });

  it('emits slaResolved effect when staff first response resolves an unresolved breach', async () => {
    await handle.db.insert(slaBreaches).values({
      id: 'breach-1', ticketId: TICKET_A, partnerId: PARTNER_A, dept: 'general',
      thresholdMinutes: 30,
    });

    const result = await lifecycle.send({
      ticketId: TICKET_A, partnerId: PARTNER_A, actor: supportActor, text: 'on it',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.effects).toContainEqual(expect.objectContaining({
      type: 'slaResolved',
      ticketId: TICKET_A,
      partnerId: PARTNER_A,
    }));

    const [breach] = await handle.db.select().from(slaBreaches).where(eq(slaBreaches.id, 'breach-1'));
    expect(breach.resolvedAt).toBeTruthy();
    expect(breach.resolvedReason).toBe('first_response');
  });

  it('does NOT emit slaResolved when sender is non-staff (agent)', async () => {
    await handle.db.insert(slaBreaches).values({
      id: 'breach-2', ticketId: TICKET_A, partnerId: PARTNER_A, dept: 'general',
      thresholdMinutes: 30,
    });

    const result = await lifecycle.send({
      ticketId: TICKET_A, partnerId: PARTNER_A, actor: aliceActor, text: 'agent reply',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.effects.find(e => e.type === 'slaResolved')).toBeUndefined();
  });

  it('filters attachments to /uploads/ URLs and caps at 5', async () => {
    const result = await lifecycle.send({
      ticketId: TICKET_A, partnerId: PARTNER_A, actor: aliceActor,
      text: 'see files',
      attachments: [
        { url: '/uploads/a.pdf', name: 'a', mimeType: 'application/pdf', size: 1 },
        { url: 'https://evil.com/b.exe', name: 'b', mimeType: 'application/octet-stream', size: 1 },
        { url: '/uploads/c.png', name: 'c', mimeType: 'image/png', size: 1 },
        { url: '/uploads/d.png', name: 'd', mimeType: 'image/png', size: 1 },
        { url: '/uploads/e.png', name: 'e', mimeType: 'image/png', size: 1 },
        { url: '/uploads/f.png', name: 'f', mimeType: 'image/png', size: 1 },
        { url: '/uploads/g.png', name: 'g', mimeType: 'image/png', size: 1 },
      ],
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.message.attachments).toHaveLength(5);
    expect(result.data.message.attachments?.every(a => a.url.startsWith('/uploads/'))).toBe(true);
  });

  it('emits unfurlLinks effect when text contains a URL', async () => {
    const result = await lifecycle.send({
      ticketId: TICKET_A, partnerId: PARTNER_A, actor: aliceActor,
      text: 'check out https://example.com please',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.effects).toContainEqual(expect.objectContaining({
      type: 'unfurlLinks',
      ticketId: TICKET_A,
      text: 'check out https://example.com please',
    }));
  });

  it('does NOT emit unfurlLinks for whisper messages', async () => {
    const result = await lifecycle.send({
      ticketId: TICKET_A, partnerId: PARTNER_A, actor: supportActor,
      text: 'staff note with https://example.com', whisper: true,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.effects.find(e => e.type === 'unfurlLinks')).toBeUndefined();
  });

  it('returns effects in documented order: broadcast → slaResolved → notifyPreviewers → invalidateSummary → unfurlLinks', async () => {
    await handle.db.insert(slaBreaches).values({
      id: 'breach-order', ticketId: TICKET_A, partnerId: PARTNER_A, dept: 'general',
      thresholdMinutes: 30,
    });

    const result = await lifecycle.send({
      ticketId: TICKET_A, partnerId: PARTNER_A, actor: supportActor,
      text: 'reply with link https://example.com',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const types = result.effects.map(e => e.type);
    expect(types).toEqual([
      'emit',
      'slaResolved',
      'notifyPreviewers',
      'invalidateSummary',
      'unfurlLinks',
    ]);
  });

  it('attaches a replyTo snippet when replyToId references an existing message', async () => {
    const REPLIED_ID = 'replied-msg';
    await handle.db.insert(messages).values({
      id: REPLIED_ID, ticketId: TICKET_A, senderId: USER_SUPPORT,
      senderName: 'Sam', senderRole: 'support', senderLang: 'en',
      text: 'a longer original message that should be truncated to 100 chars in the snippet '
        + 'because the snippet helper slices it for inline quote blocks',
      reactions: {},
    });

    const result = await lifecycle.send({
      ticketId: TICKET_A, partnerId: PARTNER_A, actor: aliceActor,
      text: 'replying', replyToId: REPLIED_ID,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.message.replyTo).toBeTruthy();
    expect(result.data.message.replyTo?.id).toBe(REPLIED_ID);
    expect(result.data.message.replyTo?.senderName).toBe('Sam');
    expect(result.data.message.replyTo?.text.length).toBeLessThanOrEqual(100);
  });

  it('attaches translations from prewarm when partner has translation feature enabled', async () => {
    await handle.db.update(partners)
      .set({ aiFeatures: { translation: true, queueLangAwareness: true } })
      .where(eq(partners.id, PARTNER_A));

    const translatingLifecycle = createMessageLifecycle({
      db: handle.db,
      ports: {
        linkPreview: inMemoryLinkPreview(),
        aiTranslation: cannedTranslation({ 'hello|fr': 'bonjour', 'hello|nl': 'hallo' }),
        moderation: passingModerator(),
      },
      storage: recordingStorage().storage,
    });

    const result = await translatingLifecycle.send({
      ticketId: TICKET_A, partnerId: PARTNER_A, actor: aliceActor,
      text: 'hello', viewerLangs: new Set(['fr', 'nl', 'en']),
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.message.translations).toEqual({ fr: 'bonjour', nl: 'hallo' });
  });

  it('does NOT attach translations when partner aiFeatures.translation is disabled', async () => {
    const translatingLifecycle = createMessageLifecycle({
      db: handle.db,
      ports: {
        linkPreview: inMemoryLinkPreview(),
        aiTranslation: cannedTranslation({ 'hello|fr': 'bonjour' }),
        moderation: passingModerator(),
      },
      storage: recordingStorage().storage,
    });

    const result = await translatingLifecycle.send({
      ticketId: TICKET_A, partnerId: PARTNER_A, actor: aliceActor,
      text: 'hello', viewerLangs: new Set(['fr']),
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.message.translations).toBeUndefined();
  });

  it('rejects with INVALID_MEDIA_URL when mediaUrl fails validation', async () => {
    const result = await lifecycle.send({
      ticketId: TICKET_A, partnerId: PARTNER_A, actor: aliceActor,
      text: 'see this', mediaUrl: 'javascript:alert(1)',
    });

    expect(result).toEqual({ ok: false, code: 'INVALID_MEDIA_URL' });
  });

  it('writes message.guard_blocked audit row on block with original + triggered', async () => {
    const blockingLifecycle = buildLifecycle({
      moderation: cannedModerator({
        decision: 'block',
        blockingCode: 'guard_offensive',
        original: 'FUCK YOU MORON',
        sanitized: 'Fuck you moron',
        triggered: ['guard_all_caps_notice', 'guard_offensive'],
      }),
    });

    const result = await blockingLifecycle.send({
      ticketId: TICKET_A, partnerId: PARTNER_A,
      actor: aliceActor, text: 'FUCK YOU MORON',
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('GUARD_REJECTED');

    const auditRows = await handle.db.select().from(auditLog)
      .where(eq(auditLog.action, 'message.guard_blocked'));
    expect(auditRows).toHaveLength(1);
    const row = auditRows[0];
    expect(row.actorId).toBe(USER_A);
    expect(row.partnerId).toBe(PARTNER_A);
    expect(row.targetType).toBe('ticket');
    expect(row.targetId).toBe(TICKET_A);
    const metadata = row.metadata as Record<string, unknown>;
    expect(metadata.scope).toBe('message:send');
    expect(metadata.original).toBe('FUCK YOU MORON');
    expect(metadata.sanitized).toBe('Fuck you moron');
    expect(metadata.triggered).toEqual(['guard_all_caps_notice', 'guard_offensive']);
    expect(metadata.blockingCode).toBe('guard_offensive');
  });

  it('does not write audit row when moderator passes', async () => {
    const result = await lifecycle.send({
      ticketId: TICKET_A, partnerId: PARTNER_A, actor: aliceActor, text: 'hello world',
    });
    expect(result.ok).toBe(true);
    const auditRows = await handle.db.select().from(auditLog)
      .where(eq(auditLog.action, 'message.guard_blocked'));
    expect(auditRows).toHaveLength(0);
  });
});

void supportActor;
