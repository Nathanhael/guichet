/**
 * Behavioral tests for `lifecycle.transfer()`. Department-change branch
 * only — same-department return-to-queue uses
 * `lifecycle.returnToQueue` (covered by returnToQueue.test.ts).
 *
 * The transfer verb owns the most-complex orchestration in the
 * deepening: optional whisper note + dept update + system message +
 * `ticket.transferred` audit row, all in one txn, plus six effects
 * (whisper emit when note, system emit, ticket+partner ticket:transferred,
 * notifyPreviewers, evictSupportFromRoom, broadcastQueue).
 */
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { auditLog, messages, partners, tickets, users } from '../../db/schema.js';
import { createTestDb, type TestDbHandle } from '../../test/pglite-setup.js';
import { createTicketLifecycle, type UserActor } from './index.js';

let handle: TestDbHandle;

function actor(args: Partial<UserActor> & { userId: string; partnerId: string; name: string }): UserActor {
  return {
    kind: 'user',
    role: 'support',
    isPlatformOperator: false,
    isExternal: false,
    lang: 'en',
    ...args,
  };
}

async function seedPartnerWithDepts(args: {
  partnerId: string;
  departments: Array<{ id: string; name: string }>;
  userIds: string[];
}) {
  await handle.db.insert(partners).values({
    id: args.partnerId,
    name: args.partnerId,
    status: 'active',
    departments: args.departments,
  });
  await handle.db.insert(users).values(
    args.userIds.map((id) => ({ id, email: `${id}@x.test`, name: `Name ${id}` })),
  );
}

async function seedTicket(args: {
  partnerId: string;
  agentId: string;
  supportId?: string | null;
  ticketId?: string;
  dept?: string;
}): Promise<string> {
  const ticketId = args.ticketId ?? `t_${Math.random().toString(36).slice(2, 8)}`;
  await handle.db.insert(tickets).values({
    id: ticketId,
    partnerId: args.partnerId,
    dept: args.dept ?? 'sales',
    agentId: args.agentId,
    agentName: 'Agent',
    status: 'open',
    supportId: args.supportId ?? null,
    supportName: args.supportId ? 'Support' : null,
    supportJoinedAt: args.supportId ? new Date().toISOString() : null,
    participants: [{ id: args.agentId, name: 'Agent' }],
  });
  return ticketId;
}

beforeEach(async () => {
  handle = await createTestDb();
});

afterEach(async () => {
  await handle.close();
});

describe('lifecycle.transfer (department change)', () => {
  it('happy path with whisper note: dept changed, support cleared, two messages, audit row, six effects', async () => {
    await seedPartnerWithDepts({
      partnerId: 'p_a',
      departments: [
        { id: 'sales', name: 'Sales' },
        { id: 'billing', name: 'Billing' },
      ],
      userIds: ['u_agent', 'u_supp'],
    });
    const ticketId = await seedTicket({
      partnerId: 'p_a',
      agentId: 'u_agent',
      supportId: 'u_supp',
    });

    const lifecycle = createTicketLifecycle({ db: handle.db });

    const result = await lifecycle.transfer({
      ticketId,
      partnerId: 'p_a',
      actor: actor({ userId: 'u_supp', partnerId: 'p_a', name: 'Sam Support' }),
      toDepartmentId: 'billing',
      note: 'Customer asking about invoice — context inside.',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data).toEqual({
      fromSupportId: 'u_supp',
      toDepartmentId: 'billing',
      toDepartmentName: 'Billing',
    });

    // Six effects: whisper, system, ticket:transferred ticket-room,
    // ticket:transferred partner-room, notifyPreviewers, evictSupport,
    // broadcastQueue. Note: with whisper present that's 7 — without
    // whisper it's 6. Adjust expectation.
    expect(result.effects).toHaveLength(7);
    const eventNames = result.effects
      .filter((e) => e.type === 'emit')
      .map((e) => (e as { event: string }).event);
    expect(eventNames).toEqual(['message:new', 'message:new', 'ticket:transferred', 'ticket:transferred']);
    expect(result.effects.find((e) => e.type === 'evictSupportFromRoom')).toBeTruthy();
    expect(result.effects.find((e) => e.type === 'broadcastQueue')).toMatchObject({ partnerId: 'p_a' });

    const [row] = await handle.db.select().from(tickets).where(eq(tickets.id, ticketId));
    expect(row).toMatchObject({
      dept: 'billing',
      supportId: null,
      supportName: null,
      status: 'open',
    });

    const ticketMessages = await handle.db.select().from(messages).where(eq(messages.ticketId, ticketId));
    expect(ticketMessages).toHaveLength(2);
    const whisper = ticketMessages.find((m) => m.whisper === 1);
    expect(whisper).toMatchObject({
      whisper: 1,
      system: 0,
      senderId: 'u_supp',
      text: 'Customer asking about invoice — context inside.',
    });
    const sys = ticketMessages.find((m) => m.system === 1);
    expect(sys).toMatchObject({
      system: 1,
      whisper: 0,
      text: 'Ticket transferred to Billing by Sam Support',
    });

    const auditRows = await handle.db.select().from(auditLog).where(eq(auditLog.targetId, ticketId));
    expect(auditRows).toHaveLength(1);
    expect(auditRows[0]).toMatchObject({
      action: 'ticket.transferred',
      partnerId: 'p_a',
      actorId: 'u_supp',
      metadata: {
        toDepartmentId: 'billing',
        toDepartmentName: 'Billing',
        fromSupportId: 'u_supp',
        hasNote: true,
      },
    });
  });

  it('without note: only the system message is inserted, six effects', async () => {
    await seedPartnerWithDepts({
      partnerId: 'p_a',
      departments: [
        { id: 'sales', name: 'Sales' },
        { id: 'billing', name: 'Billing' },
      ],
      userIds: ['u_agent', 'u_supp'],
    });
    const ticketId = await seedTicket({ partnerId: 'p_a', agentId: 'u_agent', supportId: 'u_supp' });

    const lifecycle = createTicketLifecycle({ db: handle.db });

    const result = await lifecycle.transfer({
      ticketId,
      partnerId: 'p_a',
      actor: actor({ userId: 'u_supp', partnerId: 'p_a', name: 'Sam' }),
      toDepartmentId: 'billing',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.effects).toHaveLength(6);

    const ticketMessages = await handle.db.select().from(messages).where(eq(messages.ticketId, ticketId));
    expect(ticketMessages).toHaveLength(1);
    expect(ticketMessages[0]).toMatchObject({ system: 1, whisper: 0 });

    const auditRows = await handle.db.select().from(auditLog).where(eq(auditLog.targetId, ticketId));
    expect(auditRows[0].metadata).toMatchObject({ hasNote: false });
  });

  it('NOT_AUTHORIZED: non-support actor → no DB writes', async () => {
    await seedPartnerWithDepts({
      partnerId: 'p_a',
      departments: [{ id: 'sales', name: 'Sales' }, { id: 'billing', name: 'Billing' }],
      userIds: ['u_agent'],
    });
    const ticketId = await seedTicket({ partnerId: 'p_a', agentId: 'u_agent' });

    const lifecycle = createTicketLifecycle({ db: handle.db });

    const result = await lifecycle.transfer({
      ticketId,
      partnerId: 'p_a',
      actor: actor({ userId: 'u_agent', partnerId: 'p_a', name: 'Agent', role: 'agent' }),
      toDepartmentId: 'billing',
    });

    expect(result).toEqual({ ok: false, code: 'NOT_AUTHORIZED' });
    const [row] = await handle.db.select().from(tickets).where(eq(tickets.id, ticketId));
    expect(row.dept).toBe('sales');
  });

  it('DEPARTMENT_NOT_FOUND: unknown dept id → rejection, ticket untouched', async () => {
    await seedPartnerWithDepts({
      partnerId: 'p_a',
      departments: [{ id: 'sales', name: 'Sales' }],
      userIds: ['u_agent', 'u_supp'],
    });
    const ticketId = await seedTicket({ partnerId: 'p_a', agentId: 'u_agent', supportId: 'u_supp' });

    const lifecycle = createTicketLifecycle({ db: handle.db });

    const result = await lifecycle.transfer({
      ticketId,
      partnerId: 'p_a',
      actor: actor({ userId: 'u_supp', partnerId: 'p_a', name: 'Sam' }),
      toDepartmentId: 'no_such_dept',
    });

    expect(result).toEqual({ ok: false, code: 'DEPARTMENT_NOT_FOUND' });
    const [row] = await handle.db.select().from(tickets).where(eq(tickets.id, ticketId));
    expect(row.dept).toBe('sales');
    expect(row.supportId).toBe('u_supp');
    const auditRows = await handle.db.select().from(auditLog).where(eq(auditLog.targetId, ticketId));
    expect(auditRows).toHaveLength(0);
  });

  it('TICKET_NOT_FOUND: row in another partner → NOT_FOUND, never touches the row', async () => {
    await seedPartnerWithDepts({
      partnerId: 'p_a',
      departments: [{ id: 'sales', name: 'Sales' }, { id: 'billing', name: 'Billing' }],
      userIds: ['u_agent'],
    });
    const ticketId = await seedTicket({ partnerId: 'p_a', agentId: 'u_agent' });
    await seedPartnerWithDepts({
      partnerId: 'p_b',
      departments: [{ id: 'sales', name: 'Sales' }, { id: 'billing', name: 'Billing' }],
      userIds: ['u_supp_b'],
    });

    const lifecycle = createTicketLifecycle({ db: handle.db });

    const result = await lifecycle.transfer({
      ticketId,
      partnerId: 'p_b',
      actor: actor({ userId: 'u_supp_b', partnerId: 'p_b', name: 'B Support' }),
      toDepartmentId: 'billing',
    });

    expect(result).toEqual({ ok: false, code: 'TICKET_NOT_FOUND' });
    const [row] = await handle.db.select().from(tickets).where(eq(tickets.id, ticketId));
    expect(row.dept).toBe('sales');
  });

  it('transactional rollback: bogus actor.id (FK violation on audit) aborts the transfer mutation', async () => {
    await seedPartnerWithDepts({
      partnerId: 'p_a',
      departments: [{ id: 'sales', name: 'Sales' }, { id: 'billing', name: 'Billing' }],
      userIds: ['u_agent'],
    });
    const ticketId = await seedTicket({ partnerId: 'p_a', agentId: 'u_agent' });

    const lifecycle = createTicketLifecycle({ db: handle.db });

    // u_ghost_actor isn't in `users` → audit_log.actor_id FK violation.
    await expect(
      lifecycle.transfer({
        ticketId,
        partnerId: 'p_a',
        actor: actor({ userId: 'u_ghost_actor', partnerId: 'p_a', name: 'Ghost' }),
        toDepartmentId: 'billing',
        note: 'should not persist',
      }),
    ).rejects.toThrow();

    const [row] = await handle.db.select().from(tickets).where(eq(tickets.id, ticketId));
    expect(row.dept).toBe('sales');
    expect(row.supportId).toBeNull();
    const ticketMessages = await handle.db.select().from(messages).where(eq(messages.ticketId, ticketId));
    expect(ticketMessages).toHaveLength(0);
    const auditRows = await handle.db.select().from(auditLog).where(eq(auditLog.targetId, ticketId));
    expect(auditRows).toHaveLength(0);
  });
});
