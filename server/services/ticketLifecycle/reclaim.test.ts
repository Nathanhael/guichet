/**
 * Behavioral tests for `lifecycle.reclaim()`. Runs against a real PGLite via
 * `server/test/pglite-setup.ts` so the transactional rollback property is
 * actually exercised — that property has zero coverage anywhere else in the
 * codebase today and is the single highest-signal test added by the
 * deepening refactor.
 *
 * Boundary contract:
 *   1. Transactional rollback — failure during the audit insert leaves the
 *      ticket row, system message, and audit log unchanged.
 *   2. Tenant isolation — an actor (or partnerId) from partner A cannot
 *      reclaim a ticket from partner B; we encode this as the partnerId on
 *      the args being treated as authoritative for the audit row's
 *      partnerId, and a mismatched previousSupportId returning a deterministic
 *      race code rather than scanning across tenants.
 *   3. Audit invariant — every successful reclaim writes exactly one
 *      `audit_log` row with `targetType='ticket'`, `targetId=ticketId`,
 *      `action='ticket.reclaimed'`. Closes the silent gap that existed when
 *      reclaim hand-rolled its orchestration.
 *   4. Happy path — returns `{ ok: true, effects }` with the expected
 *      staff-room emit and the expected DB rows.
 *   5. Race lost — concurrent reassignment between the candidate scan and
 *      the atomic write returns `{ ok: false, code: 'TICKET_ALREADY_REASSIGNED' }`
 *      with no DB writes and no effects.
 */
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { auditLog, messages, partners, tickets, users } from '../../db/schema.js';
import { createTestDb, type TestDbHandle } from '../../test/pglite-setup.js';
import { createTicketLifecycle } from './index.js';

let handle: TestDbHandle;

async function seedTicket(args: {
  ticketId?: string;
  partnerId: string;
  agentId: string;
  supportId: string;
  supportName?: string;
}): Promise<string> {
  const ticketId = args.ticketId ?? `t_${Math.random().toString(36).slice(2, 8)}`;
  await handle.db.insert(tickets).values({
    id: ticketId,
    partnerId: args.partnerId,
    dept: 'general',
    agentId: args.agentId,
    agentName: 'Agent',
    status: 'open',
    supportId: args.supportId,
    supportName: args.supportName ?? 'Support One',
    supportJoinedAt: new Date().toISOString(),
    participants: [
      { id: args.agentId, name: 'Agent' },
      { id: args.supportId, name: args.supportName ?? 'Support One' },
    ],
  });
  return ticketId;
}

async function seedPartnerAndUsers(args: {
  partnerId: string;
  agentId: string;
  supportId: string;
}) {
  await handle.db.insert(partners).values({
    id: args.partnerId,
    name: `Partner ${args.partnerId}`,
    status: 'active',
  });
  await handle.db.insert(users).values([
    { id: args.agentId, email: `${args.agentId}@x.test`, name: 'Agent' },
    { id: args.supportId, email: `${args.supportId}@x.test`, name: 'Support One' },
  ]);
}

beforeEach(async () => {
  handle = await createTestDb();
});

afterEach(async () => {
  await handle.close();
});

describe('lifecycle.reclaim', () => {
  it('happy path: clears support assignment, inserts system message, writes audit row, returns staff-room effect', async () => {
    await seedPartnerAndUsers({ partnerId: 'p_a', agentId: 'u_agent', supportId: 'u_supp' });
    const ticketId = await seedTicket({
      partnerId: 'p_a',
      agentId: 'u_agent',
      supportId: 'u_supp',
      supportName: 'Sam Support',
    });

    const lifecycle = createTicketLifecycle({ db: handle.db });

    const result = await lifecycle.reclaim({
      ticketId,
      partnerId: 'p_a',
      previousSupportId: 'u_supp',
      previousSupportName: 'Sam Support',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.data).toEqual({
      ticketId,
      partnerId: 'p_a',
      previousSupportId: 'u_supp',
      previousSupportName: 'Sam Support',
    });
    expect(result.effects).toEqual([
      {
        type: 'emit',
        room: 'partner:p_a:staff',
        event: 'ticket:reclaimed',
        payload: {
          ticketId,
          previousSupportId: 'u_supp',
          previousSupportName: 'Sam Support',
        },
      },
    ]);

    const [row] = await handle.db.select().from(tickets).where(eq(tickets.id, ticketId));
    expect(row).toMatchObject({
      supportId: null,
      supportName: null,
      supportJoinedAt: null,
      status: 'open',
    });
    // Outgoing support stripped from participants
    expect(row.participants).toEqual([{ id: 'u_agent', name: 'Agent' }]);

    const sysMessages = await handle.db
      .select()
      .from(messages)
      .where(eq(messages.ticketId, ticketId));
    expect(sysMessages).toHaveLength(1);
    expect(sysMessages[0]).toMatchObject({
      system: 1,
      whisper: 0,
      senderId: '__system__',
      text: 'Auto-released — Sam Support unavailable',
    });

    // Audit invariant: exactly one ticket.reclaimed row.
    const auditRows = await handle.db
      .select()
      .from(auditLog)
      .where(eq(auditLog.targetId, ticketId));
    expect(auditRows).toHaveLength(1);
    expect(auditRows[0]).toMatchObject({
      action: 'ticket.reclaimed',
      targetType: 'ticket',
      targetId: ticketId,
      partnerId: 'p_a',
      // System actor → null actorId. The WORM chain tolerates null actors.
      actorId: null,
      metadata: { previousSupportId: 'u_supp', previousSupportName: 'Sam Support' },
    });
  });

  it('race lost: previousSupportId no longer matches → TICKET_ALREADY_REASSIGNED, no DB writes, no effects', async () => {
    await seedPartnerAndUsers({ partnerId: 'p_a', agentId: 'u_agent', supportId: 'u_supp' });
    const ticketId = await seedTicket({
      partnerId: 'p_a',
      agentId: 'u_agent',
      supportId: 'u_supp',
    });

    // Simulate someone else having claimed the ticket already.
    await handle.db.insert(users).values({ id: 'u_other', email: 'other@x.test', name: 'Other Support' });
    await handle.db
      .update(tickets)
      .set({ supportId: 'u_other' })
      .where(eq(tickets.id, ticketId));

    const lifecycle = createTicketLifecycle({ db: handle.db });

    const result = await lifecycle.reclaim({
      ticketId,
      partnerId: 'p_a',
      previousSupportId: 'u_supp',
      previousSupportName: 'Sam Support',
    });

    expect(result).toEqual({ ok: false, code: 'TICKET_ALREADY_REASSIGNED' });

    // No system message, no audit row.
    const sysMessages = await handle.db.select().from(messages).where(eq(messages.ticketId, ticketId));
    expect(sysMessages).toHaveLength(0);
    const auditRows = await handle.db.select().from(auditLog).where(eq(auditLog.targetId, ticketId));
    expect(auditRows).toHaveLength(0);

    // The ticket still belongs to whoever claimed it.
    const [row] = await handle.db.select().from(tickets).where(eq(tickets.id, ticketId));
    expect(row.supportId).toBe('u_other');
  });

  it('tenant isolation: reclaiming partner A\'s ticket does not touch partner B\'s ticket even when both share a supportId', async () => {
    // Pins that the atomic UPDATE\'s WHERE clause is keyed on ticket id, not
    // just support_id. Without that key, a single shared support agent
    // working both tenants could see all their tickets reclaimed
    // simultaneously when the sweep targeted just one — a cross-tenant
    // blast-radius bug. The lifecycle\'s contract is one-row-per-call.
    await seedPartnerAndUsers({ partnerId: 'p_a', agentId: 'u_agent_a', supportId: 'u_shared' });
    await handle.db.insert(partners).values({ id: 'p_b', name: 'Partner B', status: 'active' });
    await handle.db.insert(users).values({ id: 'u_agent_b', email: 'b@x.test', name: 'Agent B' });
    const ticketA = await seedTicket({
      partnerId: 'p_a',
      agentId: 'u_agent_a',
      supportId: 'u_shared',
      supportName: 'Shared Support',
    });
    const ticketB = await seedTicket({
      partnerId: 'p_b',
      agentId: 'u_agent_b',
      supportId: 'u_shared',
      supportName: 'Shared Support',
    });

    const lifecycle = createTicketLifecycle({ db: handle.db });

    const result = await lifecycle.reclaim({
      ticketId: ticketA,
      partnerId: 'p_a',
      previousSupportId: 'u_shared',
      previousSupportName: 'Shared Support',
    });
    expect(result.ok).toBe(true);

    // Partner A's ticket cleared.
    const [rowA] = await handle.db.select().from(tickets).where(eq(tickets.id, ticketA));
    expect(rowA.supportId).toBeNull();

    // Partner B's ticket UNTOUCHED — same supportId, different tenant.
    const [rowB] = await handle.db.select().from(tickets).where(eq(tickets.id, ticketB));
    expect(rowB.supportId).toBe('u_shared');
    expect(rowB.status).toBe('open');

    // Audit row scoped to partner A only.
    const auditRows = await handle.db.select().from(auditLog);
    expect(auditRows).toHaveLength(1);
    expect(auditRows[0].partnerId).toBe('p_a');
    expect(auditRows[0].targetId).toBe(ticketA);
  });

  it('transactional rollback: a thrown audit insert leaves no ticket mutation, no system message, no audit row', async () => {
    await seedPartnerAndUsers({ partnerId: 'p_a', agentId: 'u_agent', supportId: 'u_supp' });
    const ticketId = await seedTicket({
      partnerId: 'p_a',
      agentId: 'u_agent',
      supportId: 'u_supp',
    });

    // Force the audit_log insert to fail by passing a partnerId that doesn't
    // exist in `partners`. The audit_log table has a FK on partner_id, so
    // PG raises a constraint-violation error AFTER the mutation succeeds
    // and AFTER the system message is written. If the lifecycle's
    // transaction wrapper is real, the whole event rolls back atomically.
    // This is the highest-signal test in the deepening: the property
    // ("audit failure rolls back mutation") had zero coverage before.
    const lifecycle = createTicketLifecycle({ db: handle.db });

    await expect(
      lifecycle.reclaim({
        ticketId,
        partnerId: 'p_does_not_exist',
        previousSupportId: 'u_supp',
        previousSupportName: 'Sam Support',
      }),
    ).rejects.toThrow();

    // The mutation rolled back: ticket still owned by the original support.
    const [row] = await handle.db.select().from(tickets).where(eq(tickets.id, ticketId));
    expect(row.supportId).toBe('u_supp');
    expect(row.status).toBe('open');

    // No system message persisted.
    const sysMessages = await handle.db.select().from(messages).where(eq(messages.ticketId, ticketId));
    expect(sysMessages).toHaveLength(0);

    // No audit row persisted (neither for the ticket nor for the bogus partner).
    const auditRows = await handle.db.select().from(auditLog).where(eq(auditLog.targetId, ticketId));
    expect(auditRows).toHaveLength(0);
  });
});
