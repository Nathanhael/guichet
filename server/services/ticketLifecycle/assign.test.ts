/**
 * Behavioral tests for `lifecycle.assign()`. PGLite-backed boundary
 * checks for the assign verb — happy path (primary), secondary join via
 * COALESCE preservation, ghost-heal, NOT_AUTHORIZED, TICKET_NOT_FOUND,
 * TICKET_CLOSED, and transactional rollback.
 */
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { auditLog, messages, partners, tickets, users } from '../../db/schema.js';
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

async function seedTicket(args: {
  partnerId: string;
  agentId: string;
  ticketId?: string;
  primaryId?: string | null;
  primaryName?: string;
  status?: 'open' | 'pending' | 'closed' | 'resolved';
  participants?: Array<{ id: string; name: string }>;
}): Promise<string> {
  const ticketId = args.ticketId ?? `t_${Math.random().toString(36).slice(2, 8)}`;
  await handle.db.insert(tickets).values({
    id: ticketId,
    partnerId: args.partnerId,
    dept: 'general',
    agentId: args.agentId,
    agentName: 'Agent',
    status: args.status ?? 'open',
    supportId: args.primaryId ?? null,
    supportName: args.primaryName ?? null,
    supportJoinedAt: args.primaryId ? new Date().toISOString() : null,
    participants: args.participants ?? [{ id: args.agentId, name: 'Agent' }],
  });
  return ticketId;
}

async function seedPartnerAndUsers(args: {
  partnerId: string;
  userIds: string[];
}) {
  await handle.db.insert(partners).values({ id: args.partnerId, name: args.partnerId, status: 'active' });
  await handle.db.insert(users).values(
    args.userIds.map((id) => ({ id, email: `${id}@x.test`, name: `Name ${id}` })),
  );
}

beforeEach(async () => {
  handle = await createTestDb();
});

afterEach(async () => {
  await handle.close();
});

describe('lifecycle.assign', () => {
  it('happy path (becomes primary): support_id set, joiner added to participants, audit row, four effects', async () => {
    await seedPartnerAndUsers({ partnerId: 'p_a', userIds: ['u_agent', 'u_joiner'] });
    const ticketId = await seedTicket({ partnerId: 'p_a', agentId: 'u_agent' });

    const lifecycle = createTicketLifecycle({ db: handle.db });

    const result = await lifecycle.assign({
      ticketId,
      partnerId: 'p_a',
      actor: actor({ id: 'u_joiner', partnerId: 'p_a', name: 'Joe Joiner' }),
      supportLang: 'fr',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.becamePrimary).toBe(true);
    expect(result.data.ghostHealed).toBe(false);

    expect(result.effects).toHaveLength(4);
    expect(result.effects[0]).toMatchObject({
      type: 'emit',
      rooms: [`ticket:${ticketId}`],
      event: 'message:new',
    });
    expect(result.effects[1]).toMatchObject({
      type: 'emit',
      rooms: [`ticket:${ticketId}`, 'partner:p_a:staff'],
      event: 'support:joined',
      payload: {
        ticketId,
        supportId: 'u_joiner',
        supportName: 'Joe Joiner',
      },
    });
    expect(result.effects[2]).toEqual({ type: 'notifyPreviewers', ticketId });
    expect(result.effects[3]).toEqual({ type: 'broadcastQueue', partnerId: 'p_a' });

    const [row] = await handle.db.select().from(tickets).where(eq(tickets.id, ticketId));
    expect(row).toMatchObject({
      supportId: 'u_joiner',
      supportName: 'Joe Joiner',
      supportLang: 'fr',
      status: 'open',
    });
    expect(row.participants).toEqual([
      { id: 'u_agent', name: 'Agent' },
      { id: 'u_joiner', name: 'Joe Joiner', isExternal: false },
    ]);

    const sysMessages = await handle.db.select().from(messages).where(eq(messages.ticketId, ticketId));
    expect(sysMessages).toHaveLength(1);
    expect(sysMessages[0]).toMatchObject({ system: 1, text: 'Joe Joiner joined the conversation' });

    const auditRows = await handle.db.select().from(auditLog).where(eq(auditLog.targetId, ticketId));
    expect(auditRows).toHaveLength(1);
    expect(auditRows[0]).toMatchObject({
      action: 'ticket.assigned',
      partnerId: 'p_a',
      actorId: 'u_joiner',
      metadata: { supportId: 'u_joiner', supportName: 'Joe Joiner', ghostHealed: false, becamePrimary: true },
    });
  });

  it('secondary join (COALESCE preserves primary): support_id unchanged, secondary added to participants, becamePrimary=false', async () => {
    await seedPartnerAndUsers({ partnerId: 'p_a', userIds: ['u_agent', 'u_primary', 'u_secondary'] });
    const ticketId = await seedTicket({
      partnerId: 'p_a',
      agentId: 'u_agent',
      primaryId: 'u_primary',
      primaryName: 'Patty Primary',
      participants: [
        { id: 'u_agent', name: 'Agent' },
        { id: 'u_primary', name: 'Patty Primary' },
      ],
    });

    const lifecycle = createTicketLifecycle({ db: handle.db });

    const result = await lifecycle.assign({
      ticketId,
      partnerId: 'p_a',
      actor: actor({ id: 'u_secondary', partnerId: 'p_a', name: 'Sandy Secondary' }),
      supportLang: 'en',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.becamePrimary).toBe(false);

    const [row] = await handle.db.select().from(tickets).where(eq(tickets.id, ticketId));
    // Primary preserved by COALESCE.
    expect(row.supportId).toBe('u_primary');
    expect(row.supportName).toBe('Patty Primary');
    expect(row.participants).toEqual([
      { id: 'u_agent', name: 'Agent' },
      { id: 'u_primary', name: 'Patty Primary' },
      { id: 'u_secondary', name: 'Sandy Secondary', isExternal: false },
    ]);

    const auditRows = await handle.db.select().from(auditLog).where(eq(auditLog.targetId, ticketId));
    expect(auditRows[0].metadata).toMatchObject({ becamePrimary: false });
  });

  it('ghost-heal: previous primary cleared race-guarded, joiner becomes new primary, ghostHealed=true', async () => {
    await seedPartnerAndUsers({ partnerId: 'p_a', userIds: ['u_agent', 'u_ghost', 'u_joiner'] });
    const ticketId = await seedTicket({
      partnerId: 'p_a',
      agentId: 'u_agent',
      primaryId: 'u_ghost',
      primaryName: 'Ghost',
      participants: [
        { id: 'u_agent', name: 'Agent' },
        { id: 'u_ghost', name: 'Ghost' },
      ],
    });

    const lifecycle = createTicketLifecycle({ db: handle.db });

    const result = await lifecycle.assign({
      ticketId,
      partnerId: 'p_a',
      actor: actor({ id: 'u_joiner', partnerId: 'p_a', name: 'New Primary' }),
      supportLang: 'en',
      ghostHealPreviousSupportId: 'u_ghost',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.ghostHealed).toBe(true);
    expect(result.data.becamePrimary).toBe(true);

    const [row] = await handle.db.select().from(tickets).where(eq(tickets.id, ticketId));
    expect(row.supportId).toBe('u_joiner');
    // Ghost removed from participants by returnTicketToQueueTx, then
    // joiner appended.
    expect(row.participants).toEqual([
      { id: 'u_agent', name: 'Agent' },
      { id: 'u_joiner', name: 'New Primary', isExternal: false },
    ]);

    const auditRows = await handle.db.select().from(auditLog).where(eq(auditLog.targetId, ticketId));
    // Only one row — ghost-heal clear is folded into the assign txn so
    // there's no separate ticket.returned_to_queue row in this path.
    expect(auditRows).toHaveLength(1);
    expect(auditRows[0].metadata).toMatchObject({ ghostHealed: true, becamePrimary: true });
  });

  it('NOT_AUTHORIZED: non-support actor → no DB writes, no effects', async () => {
    await seedPartnerAndUsers({ partnerId: 'p_a', userIds: ['u_agent', 'u_some_agent'] });
    const ticketId = await seedTicket({ partnerId: 'p_a', agentId: 'u_agent' });

    const lifecycle = createTicketLifecycle({ db: handle.db });

    const result = await lifecycle.assign({
      ticketId,
      partnerId: 'p_a',
      actor: actor({ id: 'u_some_agent', partnerId: 'p_a', name: 'Just an Agent', role: 'agent', isSupport: false }),
      supportLang: 'en',
    });

    expect(result).toEqual({ ok: false, code: 'NOT_AUTHORIZED' });
    const [row] = await handle.db.select().from(tickets).where(eq(tickets.id, ticketId));
    expect(row.supportId).toBeNull();
    const auditRows = await handle.db.select().from(auditLog).where(eq(auditLog.targetId, ticketId));
    expect(auditRows).toHaveLength(0);
  });

  it('TICKET_CLOSED: closed ticket cannot be joined → NOT_FOUND-shaped rejection (TICKET_CLOSED), no DB writes', async () => {
    await seedPartnerAndUsers({ partnerId: 'p_a', userIds: ['u_agent', 'u_joiner'] });
    const ticketId = await seedTicket({
      partnerId: 'p_a',
      agentId: 'u_agent',
      status: 'closed',
    });

    const lifecycle = createTicketLifecycle({ db: handle.db });

    const result = await lifecycle.assign({
      ticketId,
      partnerId: 'p_a',
      actor: actor({ id: 'u_joiner', partnerId: 'p_a', name: 'Joiner' }),
      supportLang: 'en',
    });

    expect(result).toEqual({ ok: false, code: 'TICKET_CLOSED' });
    const auditRows = await handle.db.select().from(auditLog).where(eq(auditLog.targetId, ticketId));
    expect(auditRows).toHaveLength(0);
  });

  it('TICKET_NOT_FOUND: row in another partner → NOT_FOUND, never touches the row', async () => {
    await seedPartnerAndUsers({ partnerId: 'p_a', userIds: ['u_agent'] });
    const ticketId = await seedTicket({ partnerId: 'p_a', agentId: 'u_agent' });
    await handle.db.insert(partners).values({ id: 'p_b', name: 'Partner B', status: 'active' });
    await handle.db.insert(users).values({ id: 'u_other', email: 'o@x.test', name: 'Other' });

    const lifecycle = createTicketLifecycle({ db: handle.db });

    const result = await lifecycle.assign({
      ticketId,
      partnerId: 'p_b',
      actor: actor({ id: 'u_other', partnerId: 'p_b', name: 'Other' }),
      supportLang: 'en',
    });

    expect(result).toEqual({ ok: false, code: 'TICKET_NOT_FOUND' });
    const [row] = await handle.db.select().from(tickets).where(eq(tickets.id, ticketId));
    expect(row.supportId).toBeNull();
  });

  it('transactional rollback: bogus partnerId trips audit FK after assign — txn aborts, ticket unchanged', async () => {
    await seedPartnerAndUsers({ partnerId: 'p_a', userIds: ['u_agent', 'u_joiner'] });
    const ticketId = await seedTicket({ partnerId: 'p_a', agentId: 'u_agent' });

    const lifecycle = createTicketLifecycle({ db: handle.db });

    // partnerId 'p_a' makes preflight pass. We force the audit FK to
    // violate by using an actor whose id isn't in `users` — audit_log
    // has FK actor_id → users.id, so the insert errors INSIDE the txn,
    // rolling back the assign mutation that ran moments earlier.
    await expect(
      lifecycle.assign({
        ticketId,
        partnerId: 'p_a',
        actor: actor({ id: 'u_ghost_user', partnerId: 'p_a', name: 'Ghost User' }),
        supportLang: 'en',
      }),
    ).rejects.toThrow();

    // Mutation rolled back: support_id still null, no participant added.
    const [row] = await handle.db.select().from(tickets).where(eq(tickets.id, ticketId));
    expect(row.supportId).toBeNull();
    expect(row.participants).toEqual([{ id: 'u_agent', name: 'Agent' }]);
    const sysMessages = await handle.db.select().from(messages).where(eq(messages.ticketId, ticketId));
    expect(sysMessages).toHaveLength(0);
    const auditRows = await handle.db.select().from(auditLog).where(eq(auditLog.targetId, ticketId));
    expect(auditRows).toHaveLength(0);
  });
});
