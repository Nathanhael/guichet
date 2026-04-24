/**
 * Behavior tests for tenant isolation after porting ID-based loaders to
 * services/membership.ts :: loadTicketForUser.
 *
 * These tests pin the invariant: no route that takes a ticketId accepts a
 * cross-tenant JWT. In particular, platform operators MUST have entered the
 * target partner (JWT partnerId = ticket.partnerId) — there is no operator
 * bypass at the helper level.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'crypto';
import { eq } from 'drizzle-orm';

import { appRouter } from '../../router.js';
import { db } from '../../../db.js';
import { partners, users, memberships, tickets } from '../../../db/schema.js';

type CallerCtx = Parameters<typeof appRouter.createCaller>[0];

const partnerA = 'test-tenant-iso-a';
const partnerB = 'test-tenant-iso-b';
const memberInAId = randomUUID();
const operatorId = randomUUID();
const ticketInBId = randomUUID();

async function seed() {
  const iso = new Date().toISOString();
  await db.insert(partners).values([
    {
      id: partnerA,
      name: 'Partner A',
      industry: 'Test',
      departments: [{ id: 'support', name: 'Support' }],
      status: 'active',
      createdAt: iso,
      updatedAt: iso,
    },
    {
      id: partnerB,
      name: 'Partner B',
      industry: 'Test',
      departments: [{ id: 'support', name: 'Support' }],
      status: 'active',
      createdAt: iso,
      updatedAt: iso,
    },
  ]);
  await db.insert(users).values([
    { id: memberInAId, name: 'Member A', email: `member-a-${memberInAId}@test`, lang: 'en' },
    { id: operatorId, name: 'Operator', email: `op-${operatorId}@test`, lang: 'en', isPlatformOperator: true },
  ]);
  await db.insert(memberships).values([
    { id: randomUUID(), userId: memberInAId, partnerId: partnerA, role: 'support', departments: [] },
  ]);
  await db.insert(tickets).values([
    {
      id: ticketInBId,
      partnerId: partnerB,
      agentId: memberInAId,
      agentName: 'Member A',
      agentLang: 'en',
      dept: 'support',
      status: 'open',
      createdAt: iso,
      updatedAt: iso,
      participants: [],
    },
  ]);
}

async function cleanup() {
  await db.delete(tickets).where(eq(tickets.id, ticketInBId));
  await db.delete(memberships).where(eq(memberships.userId, memberInAId));
  await db.delete(users).where(eq(users.id, memberInAId));
  await db.delete(users).where(eq(users.id, operatorId));
  await db.delete(partners).where(eq(partners.id, partnerA));
  await db.delete(partners).where(eq(partners.id, partnerB));
}

describe('tenant isolation — ticket-scoped routes reject cross-tenant callers', () => {
  beforeAll(seed);
  afterAll(cleanup);

  describe('message.list', () => {
    it('rejects a member of partner A requesting a ticket in partner B with FORBIDDEN', async () => {
      const caller = appRouter.createCaller({
        user: {
          id: memberInAId,
          name: 'Member A',
          email: 'member-a@test',
          role: 'support',
          partnerId: partnerA,
          isPlatformOperator: false,
          isExternal: false,
          lang: 'en',
        },
      } as unknown as CallerCtx);
      await expect(caller.message.list({ ticketId: ticketInBId })).rejects.toThrow(/FORBIDDEN|another partner|Not authorized/i);
    });

    it('rejects a platform operator whose JWT partner does not match the ticket (no bypass)', async () => {
      const caller = appRouter.createCaller({
        user: {
          id: operatorId,
          name: 'Operator',
          email: 'op@test',
          role: 'platform_operator',
          partnerId: partnerA,
          isPlatformOperator: true,
          isExternal: false,
          lang: 'en',
        },
      } as unknown as CallerCtx);
      await expect(caller.message.list({ ticketId: ticketInBId })).rejects.toThrow(/FORBIDDEN|another partner/i);
    });
  });

  describe('sla.getTicketState', () => {
    it('rejects a member of partner A requesting SLA state for a ticket in partner B with FORBIDDEN', async () => {
      const caller = appRouter.createCaller({
        user: {
          id: memberInAId,
          name: 'Member A',
          email: 'member-a@test',
          role: 'support',
          partnerId: partnerA,
          isPlatformOperator: false,
          isExternal: false,
          lang: 'en',
        },
      } as unknown as CallerCtx);
      await expect(caller.sla.getTicketState({ ticketId: ticketInBId })).rejects.toThrow(/FORBIDDEN|another partner/i);
    });

    it('rejects a platform operator whose JWT partner does not match the ticket (no bypass)', async () => {
      const caller = appRouter.createCaller({
        user: {
          id: operatorId,
          name: 'Operator',
          email: 'op@test',
          role: 'platform_operator',
          partnerId: partnerA,
          isPlatformOperator: true,
          isExternal: false,
          lang: 'en',
        },
      } as unknown as CallerCtx);
      await expect(caller.sla.getTicketState({ ticketId: ticketInBId })).rejects.toThrow(/FORBIDDEN|another partner/i);
    });
  });
});
