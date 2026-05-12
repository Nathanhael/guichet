/**
 * Behavioral tests for `lifecycle.create()`. The lifecycle's largest
 * preflight surface — role gate, partner status, business hours,
 * dup-ticket limit, media-url validation, reopen detection — plus the
 * shared transactional invariants.
 */
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { auditLog, messages, partners, tickets, users } from '../../db/schema.js';
import { createTestDb, type TestDbHandle } from '../../test/pglite-setup.js';
import { Moderator } from '../moderator/index.js';
import {
  blockingModerator,
  cannedModerator,
  MemoryRepetition,
} from '../moderator/test-stubs.js';
import { createTicketLifecycle, type TicketLifecycle, type UserActor } from './index.js';

/**
 * Builds a real Moderator backed by MemoryRepetition. Used in tests that
 * exercise actual guard behavior (the `GUARD_REJECTED` length test, the D9
 * repetition test). Tests that don't care about moderation rely on the
 * factory's default `passingModerator()` and call `createTicketLifecycle({ db })`.
 */
function lifecycleWithRealModerator(): TicketLifecycle {
  return createTicketLifecycle({
    db: handle.db,
    ports: { moderation: new Moderator({ repetition: new MemoryRepetition() }) },
  });
}

let handle: TestDbHandle;

function agentActor(args: { userId: string; partnerId: string; name: string }): UserActor {
  return {
    kind: 'user',
    role: 'agent',
    isPlatformOperator: false,
    lang: 'en',
    ...args,
  };
}

async function seedPartner(args: {
  partnerId: string;
  status?: 'active' | 'inactive';
  /** Always-open business hours unless overridden. */
  businessHoursSchedule?: unknown;
}) {
  // Always-open schedule by default — every day 00:00–23:59.
  const open = { closed: false, windows: [{ start: '00:00', end: '23:59' }] };
  const defaultSchedule = {
    version: 1,
    timezone: 'UTC',
    weekly: {
      mon: open, tue: open, wed: open, thu: open, fri: open, sat: open, sun: open,
    },
    exceptions: [],
  };
  await handle.db.insert(partners).values({
    id: args.partnerId,
    name: args.partnerId,
    status: args.status ?? 'active',
    businessHoursSchedule: args.businessHoursSchedule ?? defaultSchedule,
  });
}

beforeEach(async () => {
  handle = await createTestDb();
});

afterEach(async () => {
  await handle.close();
});

describe('lifecycle.create', () => {
  it('happy path with first message: ticket inserted, message inserted, audit row, two effects', async () => {
    await seedPartner({ partnerId: 'p_a' });
    await handle.db.insert(users).values({ id: 'u_agent', email: 'a@x.test', name: 'Agent' });
    const lifecycle = createTicketLifecycle({ db: handle.db });

    const result = await lifecycle.create({
      partnerId: 'p_a',
      actor: agentActor({ userId: 'u_agent', partnerId: 'p_a', name: 'Agent' }),
      dept: 'sales',
      agentLang: 'en',
      text: 'Hi, I have a question.',
      references: [{ label: 'Order', value: 'ORD-1' }],
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.ticket).toMatchObject({
      partnerId: 'p_a',
      dept: 'sales',
      agentId: 'u_agent',
      agentName: 'Agent',
      status: 'open',
      reopened: false,
      reopenCount: 0,
    });
    expect(result.data.firstMessage).toMatchObject({
      senderId: 'u_agent',
      text: 'Hi, I have a question.',
      system: false,
    });

    expect(result.effects).toHaveLength(2);
    expect(result.effects[0]).toMatchObject({
      type: 'emit',
      rooms: ['partner:p_a:staff'],
      event: 'ticket:created',
    });
    expect(result.effects[1]).toEqual({ type: 'broadcastQueue', partnerId: 'p_a' });

    const ticketRows = await handle.db.select().from(tickets).where(eq(tickets.partnerId, 'p_a'));
    expect(ticketRows).toHaveLength(1);
    expect(ticketRows[0]).toMatchObject({
      dept: 'sales',
      agentId: 'u_agent',
      status: 'open',
      reopened: false,
    });

    const ticketMessages = await handle.db.select().from(messages).where(eq(messages.ticketId, ticketRows[0].id));
    expect(ticketMessages).toHaveLength(1);
    expect(ticketMessages[0]).toMatchObject({ system: 0, whisper: 0, text: 'Hi, I have a question.' });

    const auditRows = await handle.db.select().from(auditLog).where(eq(auditLog.targetId, ticketRows[0].id));
    expect(auditRows).toHaveLength(1);
    expect(auditRows[0]).toMatchObject({
      action: 'ticket.created',
      partnerId: 'p_a',
      actorId: 'u_agent',
      metadata: { dept: 'sales', reopenCount: 0 },
    });
  });

  it('GUARD_REJECTED: first-message text trips a sync content guard → no ticket created', async () => {
    await seedPartner({ partnerId: 'p_a' });
    await handle.db.insert(users).values({ id: 'u_agent', email: 'a@x.test', name: 'Agent' });
    const lifecycle = lifecycleWithRealModerator();

    // 2500 chars trips guardLength (cap = 2000).
    const longText = 'a'.repeat(2500);

    const result = await lifecycle.create({
      partnerId: 'p_a',
      actor: agentActor({ userId: 'u_agent', partnerId: 'p_a', name: 'Agent' }),
      dept: 'sales',
      agentLang: 'en',
      text: longText,
    });

    expect(result).toEqual({ ok: false, code: 'GUARD_REJECTED' });

    const ticketRows = await handle.db.select().from(tickets);
    expect(ticketRows).toHaveLength(0);
    const messageRows = await handle.db.select().from(messages);
    expect(messageRows).toHaveLength(0);
    // The audit row for ticket.guard_blocked IS expected (slice 4 closes the
    // audit gap). The legacy assertion that "no audit rows exist" is replaced
    // by the dedicated audit-row test below.
    const blockRows = await handle.db.select().from(auditLog).where(eq(auditLog.action, 'ticket.guard_blocked'));
    expect(blockRows).toHaveLength(1);
  });

  it('writes ticket.guard_blocked audit row on guard-block with original + triggered', async () => {
    await seedPartner({ partnerId: 'p_a' });
    await handle.db.insert(users).values({ id: 'u_agent', email: 'a@x.test', name: 'Agent' });
    const lifecycle = createTicketLifecycle({
      db: handle.db,
      ports: {
        moderation: cannedModerator({
          decision: 'block',
          blockingCode: 'guard_offensive',
          original: 'FUCK YOU MORON',
          sanitized: 'Fuck you moron',
          triggered: ['guard_all_caps_notice', 'guard_offensive'],
        }),
      },
    });

    const result = await lifecycle.create({
      partnerId: 'p_a',
      actor: agentActor({ userId: 'u_agent', partnerId: 'p_a', name: 'Agent' }),
      dept: 'sales',
      agentLang: 'en',
      text: 'FUCK YOU MORON',
    });

    expect(result).toEqual({ ok: false, code: 'GUARD_REJECTED' });

    const auditRows = await handle.db.select().from(auditLog).where(eq(auditLog.action, 'ticket.guard_blocked'));
    expect(auditRows).toHaveLength(1);
    expect(auditRows[0].targetId).toBeNull();
    expect(auditRows[0].actorId).toBe('u_agent');
    expect(auditRows[0].partnerId).toBe('p_a');
    const metadata = auditRows[0].metadata as Record<string, unknown>;
    expect(metadata.scope).toBe('ticket:create');
    expect(metadata.original).toBe('FUCK YOU MORON');
    expect(metadata.triggered).toEqual(['guard_all_caps_notice', 'guard_offensive']);
    expect(metadata.blockingCode).toBe('guard_offensive');
    expect(metadata.dept).toBe('sales');
  });

  it('D9: blocks 3rd identical first-message text via repetition (scope=ticket:create runs all guards)', async () => {
    await seedPartner({ partnerId: 'p_a' });
    await handle.db.insert(users).values({ id: 'u_agent', email: 'a@x.test', name: 'Agent' });
    // Use a real Moderator + MemoryRepetition so the repetition counter
    // increments across the three create calls.
    const lifecycle = lifecycleWithRealModerator();
    const text = 'identical issue description';

    const r1 = await lifecycle.create({
      partnerId: 'p_a',
      actor: agentActor({ userId: 'u_agent', partnerId: 'p_a', name: 'Agent' }),
      dept: 'sales',
      agentLang: 'en',
      text,
    });
    expect(r1.ok).toBe(true);
    if (!r1.ok) return;
    // Close the ticket so the 1-ticket-per-agent guard doesn't intercept.
    await handle.db.update(tickets).set({ status: 'closed' }).where(eq(tickets.id, r1.data.ticket.id));

    const r2 = await lifecycle.create({
      partnerId: 'p_a',
      actor: agentActor({ userId: 'u_agent', partnerId: 'p_a', name: 'Agent' }),
      dept: 'sales',
      agentLang: 'en',
      text,
    });
    expect(r2.ok).toBe(true);
    if (!r2.ok) return;
    await handle.db.update(tickets).set({ status: 'closed' }).where(eq(tickets.id, r2.data.ticket.id));

    const r3 = await lifecycle.create({
      partnerId: 'p_a',
      actor: agentActor({ userId: 'u_agent', partnerId: 'p_a', name: 'Agent' }),
      dept: 'sales',
      agentLang: 'en',
      text,
    });

    expect(r3).toEqual({ ok: false, code: 'GUARD_REJECTED' });
    const blockRows = await handle.db.select().from(auditLog).where(eq(auditLog.action, 'ticket.guard_blocked'));
    expect(blockRows).toHaveLength(1);
    expect((blockRows[0].metadata as Record<string, unknown>).blockingCode).toBe('guard_repetition');
  });

  it('does NOT call moderator when text is omitted', async () => {
    await seedPartner({ partnerId: 'p_a' });
    await handle.db.insert(users).values({ id: 'u_agent', email: 'a@x.test', name: 'Agent' });
    // Even a blocking moderator must not see this call — text is undefined.
    const lifecycle = createTicketLifecycle({
      db: handle.db,
      ports: { moderation: blockingModerator('guard_offensive') },
    });

    const result = await lifecycle.create({
      partnerId: 'p_a',
      actor: agentActor({ userId: 'u_agent', partnerId: 'p_a', name: 'Agent' }),
      dept: 'sales',
      agentLang: 'en',
      // text intentionally omitted
    });

    expect(result.ok).toBe(true);
  });

  it('first-message guards SKIP when no text is provided (omit-text path stays open)', async () => {
    await seedPartner({ partnerId: 'p_a' });
    await handle.db.insert(users).values({ id: 'u_agent', email: 'a@x.test', name: 'Agent' });
    const lifecycle = createTicketLifecycle({ db: handle.db });

    const result = await lifecycle.create({
      partnerId: 'p_a',
      actor: agentActor({ userId: 'u_agent', partnerId: 'p_a', name: 'Agent' }),
      dept: 'sales',
      agentLang: 'en',
      // text intentionally omitted — caller may create a ticket without an
      // initial message and post one separately. Guards must not fire.
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.firstMessage).toBeNull();
  });

  it('reopen detection: matching reference value on a closed ticket → ticket.reopened, reopenCount=1', async () => {
    await seedPartner({ partnerId: 'p_a' });
    await handle.db.insert(users).values({ id: 'u_agent', email: 'a@x.test', name: 'Agent' });
    // Pre-existing closed ticket with a matching reference.
    await handle.db.insert(tickets).values({
      id: 'old_t',
      partnerId: 'p_a',
      dept: 'sales',
      agentId: 'u_agent',
      agentName: 'Agent',
      status: 'closed',
      closedAt: new Date(Date.now() - 60_000).toISOString(),
      references: [{ label: 'Order', value: 'ORD-42' }],
      reopenCount: 0,
    });

    const lifecycle = createTicketLifecycle({ db: handle.db });
    const result = await lifecycle.create({
      partnerId: 'p_a',
      actor: agentActor({ userId: 'u_agent', partnerId: 'p_a', name: 'Agent' }),
      dept: 'sales',
      agentLang: 'en',
      references: [{ label: 'Order', value: 'ORD-42' }],
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.ticket).toMatchObject({ reopened: true, reopenCount: 1 });

    const auditRows = await handle.db
      .select()
      .from(auditLog)
      .where(eq(auditLog.action, 'ticket.reopened'));
    expect(auditRows).toHaveLength(1);
    expect(auditRows[0].metadata).toMatchObject({ reopenCount: 1 });
  });

  it('NOT_AUTHORIZED: non-agent actor → no DB writes', async () => {
    await seedPartner({ partnerId: 'p_a' });
    await handle.db.insert(users).values({ id: 'u_supp', email: 's@x.test', name: 'Supp' });
    const lifecycle = createTicketLifecycle({ db: handle.db });

    const supportActorRow: UserActor = {
      kind: 'user', userId: 'u_supp', partnerId: 'p_a', name: 'Supp',
      role: 'support', isPlatformOperator: false, lang: 'en',
    };
    const result = await lifecycle.create({
      partnerId: 'p_a',
      actor: supportActorRow,
      dept: 'sales',
      agentLang: 'en',
    });

    expect(result).toEqual({ ok: false, code: 'NOT_AUTHORIZED' });
    const ticketRows = await handle.db.select().from(tickets);
    expect(ticketRows).toHaveLength(0);
  });

  it('PARTNER_NOT_ACTIVE: partner status=inactive → rejection', async () => {
    await seedPartner({ partnerId: 'p_a', status: 'inactive' });
    await handle.db.insert(users).values({ id: 'u_agent', email: 'a@x.test', name: 'Agent' });
    const lifecycle = createTicketLifecycle({ db: handle.db });

    const result = await lifecycle.create({
      partnerId: 'p_a',
      actor: agentActor({ userId: 'u_agent', partnerId: 'p_a', name: 'Agent' }),
      dept: 'sales',
      agentLang: 'en',
    });

    expect(result).toEqual({ ok: false, code: 'PARTNER_NOT_ACTIVE' });
    const ticketRows = await handle.db.select().from(tickets);
    expect(ticketRows).toHaveLength(0);
  });

  it('BUSINESS_HOURS_CLOSED: schedule with no open windows → rejection', async () => {
    const closed = { closed: true, windows: [] };
    await seedPartner({
      partnerId: 'p_a',
      businessHoursSchedule: {
        version: 1,
        timezone: 'UTC',
        weekly: { mon: closed, tue: closed, wed: closed, thu: closed, fri: closed, sat: closed, sun: closed },
        exceptions: [],
      },
    });
    await handle.db.insert(users).values({ id: 'u_agent', email: 'a@x.test', name: 'Agent' });
    const lifecycle = createTicketLifecycle({ db: handle.db });

    const result = await lifecycle.create({
      partnerId: 'p_a',
      actor: agentActor({ userId: 'u_agent', partnerId: 'p_a', name: 'Agent' }),
      dept: 'sales',
      agentLang: 'en',
    });

    expect(result).toEqual({ ok: false, code: 'BUSINESS_HOURS_CLOSED' });
    const ticketRows = await handle.db.select().from(tickets);
    expect(ticketRows).toHaveLength(0);
  });

  it('DUPLICATE_TICKET: agent already has an open ticket → rejection', async () => {
    await seedPartner({ partnerId: 'p_a' });
    await handle.db.insert(users).values({ id: 'u_agent', email: 'a@x.test', name: 'Agent' });
    await handle.db.insert(tickets).values({
      id: 'existing_t',
      partnerId: 'p_a',
      dept: 'sales',
      agentId: 'u_agent',
      agentName: 'Agent',
      status: 'open',
    });
    const lifecycle = createTicketLifecycle({ db: handle.db });

    const result = await lifecycle.create({
      partnerId: 'p_a',
      actor: agentActor({ userId: 'u_agent', partnerId: 'p_a', name: 'Agent' }),
      dept: 'sales',
      agentLang: 'en',
    });

    expect(result).toEqual({ ok: false, code: 'DUPLICATE_TICKET' });
    const ticketRows = await handle.db.select().from(tickets);
    expect(ticketRows).toHaveLength(1);
    expect(ticketRows[0].id).toBe('existing_t');
  });

  it('INVALID_MEDIA_URL: rejected media url → rejection', async () => {
    await seedPartner({ partnerId: 'p_a' });
    await handle.db.insert(users).values({ id: 'u_agent', email: 'a@x.test', name: 'Agent' });
    const lifecycle = createTicketLifecycle({ db: handle.db });

    const result = await lifecycle.create({
      partnerId: 'p_a',
      actor: agentActor({ userId: 'u_agent', partnerId: 'p_a', name: 'Agent' }),
      dept: 'sales',
      agentLang: 'en',
      mediaUrl: 'javascript:alert(1)',
    });

    expect(result).toEqual({ ok: false, code: 'INVALID_MEDIA_URL' });
  });

  it('transactional rollback: bogus actor.id trips audit FK after the insert — txn aborts, no ticket persists', async () => {
    await seedPartner({ partnerId: 'p_a' });
    await handle.db.insert(users).values({ id: 'u_real_agent', email: 'a@x.test', name: 'Real Agent' });
    const lifecycle = createTicketLifecycle({ db: handle.db });

    // Run preflights with an actor whose id is not in `users` — preflights
    // (role check, partner check, biz hours, dup ticket) all pass because
    // they don't touch users. The audit_log FK fires inside the txn, after
    // the ticket has been inserted, and aborts everything.
    await expect(
      lifecycle.create({
        partnerId: 'p_a',
        actor: agentActor({ userId: 'u_ghost_agent', partnerId: 'p_a', name: 'Ghost' }),
        dept: 'sales',
        agentLang: 'en',
        text: 'should not persist',
      }),
    ).rejects.toThrow();

    const ticketRows = await handle.db.select().from(tickets);
    expect(ticketRows).toHaveLength(0);
    const messageRows = await handle.db.select().from(messages);
    expect(messageRows).toHaveLength(0);
    const auditRows = await handle.db.select().from(auditLog);
    expect(auditRows).toHaveLength(0);
  });
});
