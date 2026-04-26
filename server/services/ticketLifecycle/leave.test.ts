/**
 * Behavioral tests for `lifecycle.leave()`. Same shape as
 * `reclaim.test.ts`: PGLite-backed boundary checks for the four
 * priority-ordered properties — transactional rollback, tenant
 * isolation, audit invariant, happy path — plus the op-specific
 * NOT_A_PARTICIPANT and "queue cleared when primary leaves" assertions.
 */
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { auditLog, messages, partners, tickets, users } from '../../db/schema.js';
import { createTestDb, type TestDbHandle } from '../../test/pglite-setup.js';
import { createTicketLifecycle, type UserActor } from './index.js';

let handle: TestDbHandle;

function actor(overrides: Partial<UserActor> & { id: string; partnerId: string; name: string }): UserActor {
  return {
    kind: 'user',
    role: 'support',
    isSupport: true,
    isExternal: false,
    lang: 'en',
    ...overrides,
  };
}

async function seed(args: {
  partnerId: string;
  agentId: string;
  primaryId: string;
  secondaryId?: string;
  ticketId?: string;
}): Promise<string> {
  await handle.db.insert(partners).values({ id: args.partnerId, name: args.partnerId, status: 'active' });
  const userRows = [
    { id: args.agentId, email: `${args.agentId}@x.test`, name: `Agent ${args.agentId}` },
    { id: args.primaryId, email: `${args.primaryId}@x.test`, name: `Primary ${args.primaryId}` },
  ];
  if (args.secondaryId) {
    userRows.push({ id: args.secondaryId, email: `${args.secondaryId}@x.test`, name: `Secondary ${args.secondaryId}` });
  }
  await handle.db.insert(users).values(userRows);

  const ticketId = args.ticketId ?? `t_${Math.random().toString(36).slice(2, 8)}`;
  const participants = [
    { id: args.agentId, name: `Agent ${args.agentId}` },
    { id: args.primaryId, name: `Primary ${args.primaryId}` },
  ];
  if (args.secondaryId) {
    participants.push({ id: args.secondaryId, name: `Secondary ${args.secondaryId}` });
  }
  await handle.db.insert(tickets).values({
    id: ticketId,
    partnerId: args.partnerId,
    dept: 'general',
    agentId: args.agentId,
    agentName: `Agent ${args.agentId}`,
    status: 'open',
    supportId: args.primaryId,
    supportName: `Primary ${args.primaryId}`,
    supportJoinedAt: new Date().toISOString(),
    participants,
  });
  return ticketId;
}

beforeEach(async () => {
  handle = await createTestDb();
});

afterEach(async () => {
  await handle.close();
});

describe('lifecycle.leave', () => {
  it('happy path (primary leaves): clears support, removes leaver from participants, system message, audit row, three effects', async () => {
    const ticketId = await seed({ partnerId: 'p_a', agentId: 'u_agent', primaryId: 'u_supp' });
    const lifecycle = createTicketLifecycle({ db: handle.db });

    const result = await lifecycle.leave({
      ticketId,
      partnerId: 'p_a',
      actor: actor({ id: 'u_supp', partnerId: 'p_a', name: 'Primary u_supp' }),
      clearPrimary: true,
      previousSupportId: 'u_supp',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.queueReturned).toBe(true);
    expect(result.data.participants).toEqual([{ id: 'u_agent', name: 'Agent u_agent' }]);

    expect(result.effects).toHaveLength(3);
    expect(result.effects[0]).toMatchObject({
      type: 'emit',
      rooms: [`ticket:${ticketId}`],
      event: 'message:new',
    });
    expect(result.effects[1]).toMatchObject({
      type: 'emit',
      rooms: [`ticket:${ticketId}`, 'partner:p_a:staff'],
      event: 'support:left',
      payload: {
        ticketId,
        supportId: 'u_supp',
        supportName: 'Primary u_supp',
        participants: [{ id: 'u_agent', name: 'Agent u_agent' }],
        queueReturned: true,
      },
    });
    expect(result.effects[2]).toEqual({ type: 'notifyPreviewers', ticketId });

    const [row] = await handle.db.select().from(tickets).where(eq(tickets.id, ticketId));
    expect(row.supportId).toBeNull();
    expect(row.status).toBe('open');
    expect(row.participants).toEqual([{ id: 'u_agent', name: 'Agent u_agent' }]);

    const sysMessages = await handle.db.select().from(messages).where(eq(messages.ticketId, ticketId));
    expect(sysMessages).toHaveLength(1);
    expect(sysMessages[0]).toMatchObject({ system: 1, text: 'Primary u_supp left the conversation' });

    const auditRows = await handle.db.select().from(auditLog).where(eq(auditLog.targetId, ticketId));
    expect(auditRows).toHaveLength(1);
    expect(auditRows[0]).toMatchObject({
      action: 'ticket.left',
      partnerId: 'p_a',
      actorId: 'u_supp',
      metadata: { wasPrimary: true, queueReturned: true, remainingParticipants: 1 },
    });
  });

  it('secondary leaves: support assignment unchanged, ticket.left audit row still written (closes silent gap)', async () => {
    const ticketId = await seed({
      partnerId: 'p_a',
      agentId: 'u_agent',
      primaryId: 'u_primary',
      secondaryId: 'u_secondary',
    });
    const lifecycle = createTicketLifecycle({ db: handle.db });

    const result = await lifecycle.leave({
      ticketId,
      partnerId: 'p_a',
      actor: actor({ id: 'u_secondary', partnerId: 'p_a', name: 'Secondary u_secondary' }),
      clearPrimary: false,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.queueReturned).toBe(false);

    // Support assignment untouched.
    const [row] = await handle.db.select().from(tickets).where(eq(tickets.id, ticketId));
    expect(row.supportId).toBe('u_primary');

    // Audit row STILL written — this is the property the deepening adds.
    const auditRows = await handle.db.select().from(auditLog).where(eq(auditLog.targetId, ticketId));
    expect(auditRows).toHaveLength(1);
    expect(auditRows[0]).toMatchObject({
      action: 'ticket.left',
      actorId: 'u_secondary',
      metadata: { wasPrimary: false, queueReturned: false, remainingParticipants: 2 },
    });
  });

  it('NOT_A_PARTICIPANT: caller not in participants → no DB writes, no effects', async () => {
    const ticketId = await seed({ partnerId: 'p_a', agentId: 'u_agent', primaryId: 'u_primary' });
    await handle.db.insert(users).values({ id: 'u_outsider', email: 'outsider@x.test', name: 'Outsider' });
    const lifecycle = createTicketLifecycle({ db: handle.db });

    const result = await lifecycle.leave({
      ticketId,
      partnerId: 'p_a',
      actor: actor({ id: 'u_outsider', partnerId: 'p_a', name: 'Outsider' }),
      clearPrimary: false,
    });

    expect(result).toEqual({ ok: false, code: 'NOT_A_PARTICIPANT' });

    const sysMessages = await handle.db.select().from(messages).where(eq(messages.ticketId, ticketId));
    expect(sysMessages).toHaveLength(0);
    const auditRows = await handle.db.select().from(auditLog).where(eq(auditLog.targetId, ticketId));
    expect(auditRows).toHaveLength(0);
    const [row] = await handle.db.select().from(tickets).where(eq(tickets.id, ticketId));
    expect(row.supportId).toBe('u_primary');
  });

  it('TICKET_NOT_FOUND: row exists in another partner → returns NOT_FOUND, never touches the row', async () => {
    const ticketId = await seed({ partnerId: 'p_a', agentId: 'u_agent', primaryId: 'u_primary' });
    await handle.db.insert(partners).values({ id: 'p_b', name: 'Partner B', status: 'active' });
    const lifecycle = createTicketLifecycle({ db: handle.db });

    const result = await lifecycle.leave({
      ticketId,
      partnerId: 'p_b',
      actor: actor({ id: 'u_primary', partnerId: 'p_b', name: 'Primary' }),
      clearPrimary: false,
    });

    expect(result).toEqual({ ok: false, code: 'TICKET_NOT_FOUND' });

    const [row] = await handle.db.select().from(tickets).where(eq(tickets.id, ticketId));
    expect(row.supportId).toBe('u_primary');
    expect(row.participants).toHaveLength(2);
  });

  it('transactional rollback: a FK violation on the audit row aborts the participants update', async () => {
    // Seed a ticket whose participant list includes an id that does NOT
    // correspond to a row in `users`. The leave preflight only consults
    // `tickets.participants` (JSONB), so a participant without a `users`
    // row is allowed in. The audit_log table has a FK actor_id → users.id,
    // so when the lifecycle goes to write the audit row inside the txn,
    // PG rejects with a constraint violation. The `db.transaction(...)`
    // wrapper aborts everything, including the participants UPDATE that
    // ran moments earlier.
    //
    // This is the strongest "audit failure rolls back mutation" assertion
    // available without monkey-patching: a real PG constraint, on the
    // actual audit insert path the lifecycle uses in production.
    await handle.db.insert(partners).values({ id: 'p_a', name: 'Partner A', status: 'active' });
    await handle.db.insert(users).values({ id: 'u_agent', email: 'a@x.test', name: 'Agent' });
    const ticketId = `t_${Math.random().toString(36).slice(2, 8)}`;
    await handle.db.insert(tickets).values({
      id: ticketId,
      partnerId: 'p_a',
      dept: 'general',
      agentId: 'u_agent',
      agentName: 'Agent',
      status: 'open',
      participants: [
        { id: 'u_agent', name: 'Agent' },
        { id: 'u_ghost_in_participants_only', name: 'Ghost' },
      ],
    });

    const lifecycle = createTicketLifecycle({ db: handle.db });

    await expect(
      lifecycle.leave({
        ticketId,
        partnerId: 'p_a',
        actor: actor({ id: 'u_ghost_in_participants_only', partnerId: 'p_a', name: 'Ghost' }),
        clearPrimary: false,
      }),
    ).rejects.toThrow();

    // Participants UPDATE must have rolled back: the original two-entry
    // list survives.
    const [row] = await handle.db.select().from(tickets).where(eq(tickets.id, ticketId));
    expect(row.participants).toEqual([
      { id: 'u_agent', name: 'Agent' },
      { id: 'u_ghost_in_participants_only', name: 'Ghost' },
    ]);
    const sysMessages = await handle.db.select().from(messages).where(eq(messages.ticketId, ticketId));
    expect(sysMessages).toHaveLength(0);
    const auditRows = await handle.db.select().from(auditLog).where(eq(auditLog.targetId, ticketId));
    expect(auditRows).toHaveLength(0);
  });
});
