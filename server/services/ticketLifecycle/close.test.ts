/**
 * Behavioral tests for `lifecycle.close()`. Authorization (support OR
 * owning agent), idempotency (TICKET_ALREADY_CLOSED), audit invariant,
 * tenant isolation, transactional rollback.
 */
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { auditLog, partners, tickets, users } from '../../db/schema.js';
import { createTestDb, type TestDbHandle } from '../../test/pglite-setup.js';
import { createTicketLifecycle, type UserActor } from './index.js';

let handle: TestDbHandle;

function actor(args: Partial<UserActor> & { id: string; partnerId: string; name: string }): UserActor {
  return {
    kind: 'user',
    role: 'support',
    isSupport: true,
    isExternal: false,
    lang: 'en',
    ...args,
  };
}

async function seed(args: {
  partnerId: string;
  agentId: string;
  supportId?: string;
  status?: 'open' | 'pending' | 'closed' | 'resolved';
  ticketId?: string;
}): Promise<string> {
  await handle.db.insert(partners).values({ id: args.partnerId, name: args.partnerId, status: 'active' });
  const usersToInsert = [{ id: args.agentId, email: `${args.agentId}@x.test`, name: `Agent ${args.agentId}` }];
  if (args.supportId) usersToInsert.push({ id: args.supportId, email: `${args.supportId}@x.test`, name: `Support ${args.supportId}` });
  await handle.db.insert(users).values(usersToInsert);
  const ticketId = args.ticketId ?? `t_${Math.random().toString(36).slice(2, 8)}`;
  await handle.db.insert(tickets).values({
    id: ticketId,
    partnerId: args.partnerId,
    dept: 'general',
    agentId: args.agentId,
    agentName: `Agent ${args.agentId}`,
    status: args.status ?? 'open',
    supportId: args.supportId ?? null,
    supportName: args.supportId ? `Support ${args.supportId}` : null,
    supportJoinedAt: args.supportId ? new Date().toISOString() : null,
    participants: [{ id: args.agentId, name: `Agent ${args.agentId}` }],
  });
  return ticketId;
}

beforeEach(async () => {
  handle = await createTestDb();
});

afterEach(async () => {
  await handle.close();
});

describe('lifecycle.close', () => {
  it('happy path (support closes): status=closed, audit row, two effects', async () => {
    const ticketId = await seed({ partnerId: 'p_a', agentId: 'u_agent', supportId: 'u_supp' });
    const lifecycle = createTicketLifecycle({ db: handle.db });

    const result = await lifecycle.close({
      ticketId,
      partnerId: 'p_a',
      actor: actor({ id: 'u_supp', partnerId: 'p_a', name: 'Sam Support' }),
      closingNotes: 'Resolved via call.',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data).toMatchObject({
      hadSupport: true,
      supportId: 'u_supp',
      supportName: 'Support u_supp',
      closedBy: 'Sam Support',
    });
    expect(result.effects).toHaveLength(2);
    expect(result.effects[0]).toMatchObject({
      type: 'emit',
      rooms: [`ticket:${ticketId}`],
      event: 'ticket:closed',
    });
    expect(result.effects[1]).toEqual({ type: 'broadcastQueue', partnerId: 'p_a' });

    const [row] = await handle.db.select().from(tickets).where(eq(tickets.id, ticketId));
    expect(row).toMatchObject({
      status: 'closed',
      closedBy: 'Sam Support',
      closingNotes: 'Resolved via call.',
    });
    expect(row.closedAt).toBeTruthy();

    const auditRows = await handle.db.select().from(auditLog).where(eq(auditLog.targetId, ticketId));
    expect(auditRows).toHaveLength(1);
    expect(auditRows[0]).toMatchObject({
      action: 'ticket.closed',
      partnerId: 'p_a',
      actorId: 'u_supp',
      metadata: { closedBy: 'Sam Support', hadSupport: true },
    });
  });

  it('agent can close their own ticket', async () => {
    const ticketId = await seed({ partnerId: 'p_a', agentId: 'u_agent' });
    const lifecycle = createTicketLifecycle({ db: handle.db });

    const result = await lifecycle.close({
      ticketId,
      partnerId: 'p_a',
      actor: actor({ id: 'u_agent', partnerId: 'p_a', name: 'Agent', role: 'agent', isSupport: false }),
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.hadSupport).toBe(false);

    const [row] = await handle.db.select().from(tickets).where(eq(tickets.id, ticketId));
    expect(row.status).toBe('closed');
  });

  it('NOT_AUTHORIZED: a different agent cannot close another agent\'s ticket', async () => {
    const ticketId = await seed({ partnerId: 'p_a', agentId: 'u_agent' });
    await handle.db.insert(users).values({ id: 'u_other_agent', email: 'o@x.test', name: 'Other' });
    const lifecycle = createTicketLifecycle({ db: handle.db });

    const result = await lifecycle.close({
      ticketId,
      partnerId: 'p_a',
      actor: actor({ id: 'u_other_agent', partnerId: 'p_a', name: 'Other', role: 'agent', isSupport: false }),
    });

    expect(result).toEqual({ ok: false, code: 'NOT_AUTHORIZED' });
    const [row] = await handle.db.select().from(tickets).where(eq(tickets.id, ticketId));
    expect(row.status).toBe('open');
  });

  it('TICKET_ALREADY_CLOSED: idempotent — re-close returns rejection without rewriting state', async () => {
    const ticketId = await seed({ partnerId: 'p_a', agentId: 'u_agent', supportId: 'u_supp', status: 'closed' });
    const lifecycle = createTicketLifecycle({ db: handle.db });

    const result = await lifecycle.close({
      ticketId,
      partnerId: 'p_a',
      actor: actor({ id: 'u_supp', partnerId: 'p_a', name: 'Sam' }),
    });

    expect(result).toEqual({ ok: false, code: 'TICKET_ALREADY_CLOSED' });
    const auditRows = await handle.db.select().from(auditLog).where(eq(auditLog.targetId, ticketId));
    expect(auditRows).toHaveLength(0);
  });

  it('TICKET_NOT_FOUND: row in another partner', async () => {
    const ticketId = await seed({ partnerId: 'p_a', agentId: 'u_agent' });
    await handle.db.insert(partners).values({ id: 'p_b', name: 'B', status: 'active' });
    await handle.db.insert(users).values({ id: 'u_b_supp', email: 'b@x.test', name: 'B Support' });
    const lifecycle = createTicketLifecycle({ db: handle.db });

    const result = await lifecycle.close({
      ticketId,
      partnerId: 'p_b',
      actor: actor({ id: 'u_b_supp', partnerId: 'p_b', name: 'B Support' }),
    });

    expect(result).toEqual({ ok: false, code: 'TICKET_NOT_FOUND' });
  });

  it('transactional rollback: bogus actor.id (FK on audit) aborts the close mutation', async () => {
    const ticketId = await seed({ partnerId: 'p_a', agentId: 'u_agent' });
    const lifecycle = createTicketLifecycle({ db: handle.db });

    await expect(
      lifecycle.close({
        ticketId,
        partnerId: 'p_a',
        actor: actor({ id: 'u_ghost', partnerId: 'p_a', name: 'Ghost' }),
      }),
    ).rejects.toThrow();

    const [row] = await handle.db.select().from(tickets).where(eq(tickets.id, ticketId));
    expect(row.status).toBe('open');
    expect(row.closedAt).toBeNull();
    const auditRows = await handle.db.select().from(auditLog).where(eq(auditLog.targetId, ticketId));
    expect(auditRows).toHaveLength(0);
  });
});
