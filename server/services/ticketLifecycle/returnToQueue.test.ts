/**
 * Behavioral tests for `lifecycle.returnToQueue()`. Same shape as
 * `reclaim.test.ts` and `leave.test.ts` — PGLite-backed boundary checks
 * for the priority-ordered properties.
 */
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { auditLog, messages, partners, tickets, users } from '../../db/schema.js';
import { createTestDb, type TestDbHandle } from '../../test/pglite-setup.js';
import { createTicketLifecycle, systemActor, type UserActor } from './index.js';

let handle: TestDbHandle;

function userActor(args: { id: string; partnerId: string; name: string }): UserActor {
  return {
    kind: 'user',
    role: 'support',
    isSupport: true,
    isExternal: false,
    lang: 'en',
    ...args,
  };
}

async function seedReadyTicket(args: {
  partnerId: string;
  agentId: string;
  supportId: string;
  ticketId?: string;
}): Promise<string> {
  await handle.db.insert(partners).values({ id: args.partnerId, name: args.partnerId, status: 'active' });
  await handle.db.insert(users).values([
    { id: args.agentId, email: `${args.agentId}@x.test`, name: 'Agent' },
    { id: args.supportId, email: `${args.supportId}@x.test`, name: 'Support' },
  ]);
  const ticketId = args.ticketId ?? `t_${Math.random().toString(36).slice(2, 8)}`;
  await handle.db.insert(tickets).values({
    id: ticketId,
    partnerId: args.partnerId,
    dept: 'general',
    agentId: args.agentId,
    agentName: 'Agent',
    status: 'open',
    supportId: args.supportId,
    supportName: 'Support',
    supportJoinedAt: new Date().toISOString(),
    participants: [
      { id: args.agentId, name: 'Agent' },
      { id: args.supportId, name: 'Support' },
    ],
  });
  return ticketId;
}

beforeEach(async () => {
  handle = await createTestDb();
});

afterEach(async () => {
  await handle.close();
});

describe('lifecycle.returnToQueue', () => {
  it('happy path with system message: clears support, inserts message, writes audit, emits message:new + notifyPreviewers', async () => {
    const ticketId = await seedReadyTicket({ partnerId: 'p_a', agentId: 'u_agent', supportId: 'u_supp' });
    const lifecycle = createTicketLifecycle({ db: handle.db });

    const result = await lifecycle.returnToQueue({
      ticketId,
      partnerId: 'p_a',
      actor: userActor({ id: 'u_supp', partnerId: 'p_a', name: 'Support' }),
      previousSupportId: 'u_supp',
      systemMessageText: 'Support returned ticket to queue',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.effects).toHaveLength(2);
    expect(result.effects[0]).toMatchObject({
      type: 'emit',
      rooms: [`ticket:${ticketId}`],
      event: 'message:new',
    });
    expect(result.effects[1]).toEqual({ type: 'notifyPreviewers', ticketId });

    const [row] = await handle.db.select().from(tickets).where(eq(tickets.id, ticketId));
    expect(row.supportId).toBeNull();
    expect(row.status).toBe('open');

    const sysMessages = await handle.db.select().from(messages).where(eq(messages.ticketId, ticketId));
    expect(sysMessages).toHaveLength(1);
    expect(sysMessages[0]).toMatchObject({ system: 1, text: 'Support returned ticket to queue' });

    const auditRows = await handle.db.select().from(auditLog).where(eq(auditLog.targetId, ticketId));
    expect(auditRows).toHaveLength(1);
    expect(auditRows[0]).toMatchObject({
      action: 'ticket.returned_to_queue',
      partnerId: 'p_a',
      actorId: 'u_supp',
      metadata: { fromSupportId: 'u_supp' },
    });
  });

  it('silent return (ghost-heal pattern): omitting systemMessageText writes no message and emits no message:new effect', async () => {
    const ticketId = await seedReadyTicket({ partnerId: 'p_a', agentId: 'u_agent', supportId: 'u_supp' });
    const lifecycle = createTicketLifecycle({ db: handle.db });

    const result = await lifecycle.returnToQueue({
      ticketId,
      partnerId: 'p_a',
      actor: systemActor,
      previousSupportId: 'u_supp',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.effects).toEqual([]);

    const sysMessages = await handle.db.select().from(messages).where(eq(messages.ticketId, ticketId));
    expect(sysMessages).toHaveLength(0);

    // Audit row still written — silent to chat, but never silent to the WORM log.
    const auditRows = await handle.db.select().from(auditLog).where(eq(auditLog.targetId, ticketId));
    expect(auditRows).toHaveLength(1);
    expect(auditRows[0]).toMatchObject({ action: 'ticket.returned_to_queue', actorId: null });
  });

  it('race lost: previousSupportId no longer matches → TICKET_ALREADY_REASSIGNED, no DB writes', async () => {
    const ticketId = await seedReadyTicket({ partnerId: 'p_a', agentId: 'u_agent', supportId: 'u_supp' });
    await handle.db.insert(users).values({ id: 'u_other', email: 'o@x.test', name: 'Other' });
    await handle.db.update(tickets).set({ supportId: 'u_other' }).where(eq(tickets.id, ticketId));
    const lifecycle = createTicketLifecycle({ db: handle.db });

    const result = await lifecycle.returnToQueue({
      ticketId,
      partnerId: 'p_a',
      actor: userActor({ id: 'u_supp', partnerId: 'p_a', name: 'Support' }),
      previousSupportId: 'u_supp',
      systemMessageText: 'Support returned ticket to queue',
    });

    expect(result).toEqual({ ok: false, code: 'TICKET_ALREADY_REASSIGNED' });
    const sysMessages = await handle.db.select().from(messages).where(eq(messages.ticketId, ticketId));
    expect(sysMessages).toHaveLength(0);
    const auditRows = await handle.db.select().from(auditLog).where(eq(auditLog.targetId, ticketId));
    expect(auditRows).toHaveLength(0);
    const [row] = await handle.db.select().from(tickets).where(eq(tickets.id, ticketId));
    expect(row.supportId).toBe('u_other');
  });

  it('transactional rollback: bogus partnerId on args trips audit FK after the row clear — whole txn aborts', async () => {
    const ticketId = await seedReadyTicket({ partnerId: 'p_a', agentId: 'u_agent', supportId: 'u_supp' });
    const lifecycle = createTicketLifecycle({ db: handle.db });

    await expect(
      lifecycle.returnToQueue({
        ticketId,
        partnerId: 'p_does_not_exist',
        actor: systemActor,
        previousSupportId: 'u_supp',
        systemMessageText: 'whoops',
      }),
    ).rejects.toThrow();

    // Mutation rolled back — the support assignment survives.
    const [row] = await handle.db.select().from(tickets).where(eq(tickets.id, ticketId));
    expect(row.supportId).toBe('u_supp');
    const sysMessages = await handle.db.select().from(messages).where(eq(messages.ticketId, ticketId));
    expect(sysMessages).toHaveLength(0);
    const auditRows = await handle.db.select().from(auditLog).where(eq(auditLog.targetId, ticketId));
    expect(auditRows).toHaveLength(0);
  });
});
