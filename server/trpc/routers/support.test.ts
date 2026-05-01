import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { classifyImbalance } from './support.js';

// Test mode has no Redis, so the availability registry is empty. Stub
// getAvailability so getStaffingByLanguage's onlineUsers() call returns []
// (matches the pre-availability test environment where getOnlineUsersForPartner
// returned [] when pubClient was null).
vi.mock('../../services/availability/instance.js', () => ({
  getAvailability: () => ({
    advanced: { onlineUsers: async () => [] },
  }),
}));

describe('classifyImbalance', () => {
  it('returns ok when support/ticket ratio is at least 1:5', () => {
    expect(classifyImbalance({ online: 2, waiting: 10, oldestWaitMinutes: 3 })).toBe('ok');
    expect(classifyImbalance({ online: 1, waiting: 5, oldestWaitMinutes: 1 })).toBe('ok');
    expect(classifyImbalance({ online: 5, waiting: 0, oldestWaitMinutes: 0 })).toBe('ok');
  });

  it('returns critical when zero support and >=3 tickets waiting', () => {
    expect(classifyImbalance({ online: 0, waiting: 3, oldestWaitMinutes: 0 })).toBe('critical');
    expect(classifyImbalance({ online: 0, waiting: 20, oldestWaitMinutes: 12 })).toBe('critical');
  });

  it('returns critical when zero support and oldest > 5 minutes even with <3 waiting', () => {
    expect(classifyImbalance({ online: 0, waiting: 1, oldestWaitMinutes: 6 })).toBe('critical');
  });

  it('returns thin when zero support but <=2 waiting and oldest <=5 min', () => {
    expect(classifyImbalance({ online: 0, waiting: 2, oldestWaitMinutes: 4 })).toBe('thin');
    expect(classifyImbalance({ online: 0, waiting: 1, oldestWaitMinutes: 0 })).toBe('thin');
  });

  it('returns thin when support is severely outnumbered (>=1:10 ratio)', () => {
    expect(classifyImbalance({ online: 1, waiting: 10, oldestWaitMinutes: 2 })).toBe('thin');
    expect(classifyImbalance({ online: 2, waiting: 25, oldestWaitMinutes: 2 })).toBe('thin');
  });

  it('treats zero waiting as ok regardless of staffing', () => {
    expect(classifyImbalance({ online: 0, waiting: 0, oldestWaitMinutes: 0 })).toBe('ok');
  });
});

import { appRouter } from '../router.js';
import { db } from '../../db.js';
import { partners, users, memberships, tickets } from '../../db/schema.js';
import { eq } from 'drizzle-orm';
import { randomUUID } from 'crypto';

// Test callers use the createCaller({user}) pattern directly, matching
// server/trpc/routers/platform.lifecycle.audit.test.ts:74 — there is no
// createContextInner helper in this codebase.
type CallerCtx = Parameters<typeof appRouter.createCaller>[0];

describe('support.getStaffingByLanguage', () => {
  const partnerA = 'test-support-staffing-a';
  const partnerB = 'test-support-staffing-b';
  const userNlId = randomUUID();
  const userFrId = randomUUID();

  beforeAll(async () => {
    await db.insert(partners).values({
      id: partnerA,
      name: 'Partner A',
      industry: 'Test',
      departments: [{ id: 'support', name: 'Support' }],
      status: 'active',
      aiFeatures: { queueLangAwareness: true, translation: true },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    await db.insert(partners).values({
      id: partnerB,
      name: 'Partner B',
      industry: 'Test',
      departments: [{ id: 'support', name: 'Support' }],
      status: 'active',
      aiFeatures: {},
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    await db.insert(users).values([
      { id: userNlId, name: 'Nl User', email: 'nl@test', lang: 'nl' },
      { id: userFrId, name: 'Fr User', email: 'fr@test', lang: 'fr' },
    ]);
    await db.insert(memberships).values([
      { id: randomUUID(), userId: userNlId, partnerId: partnerA, role: 'support', departments: [] },
      { id: randomUUID(), userId: userFrId, partnerId: partnerA, role: 'support', departments: [] },
    ]);
    // 3 unclaimed nl tickets, 1 unclaimed fr ticket on partner A
    const now = new Date();
    const ago10 = new Date(now.getTime() - 10 * 60_000).toISOString();
    const ago1 = new Date(now.getTime() - 60_000).toISOString();
    // agentId must reference an existing user (FK constraint) — reuse the two
    // test users created above. The lang on the ticket (agentLang) is what the
    // endpoint groups by, not the agent's profile lang.
    await db.insert(tickets).values([
      { id: randomUUID(), partnerId: partnerA, agentId: userNlId, agentName: 'A1', agentLang: 'nl', dept: 'support', status: 'open', supportId: null, createdAt: ago10, updatedAt: ago10, participants: [] },
      { id: randomUUID(), partnerId: partnerA, agentId: userNlId, agentName: 'A2', agentLang: 'nl', dept: 'support', status: 'open', supportId: null, createdAt: ago1, updatedAt: ago1, participants: [] },
      { id: randomUUID(), partnerId: partnerA, agentId: userNlId, agentName: 'A3', agentLang: 'nl', dept: 'support', status: 'open', supportId: null, createdAt: ago1, updatedAt: ago1, participants: [] },
      { id: randomUUID(), partnerId: partnerA, agentId: userFrId, agentName: 'A4', agentLang: 'fr', dept: 'support', status: 'open', supportId: null, createdAt: ago1, updatedAt: ago1, participants: [] },
      // partner B has its own ticket that must NOT leak into partner A's count
      { id: randomUUID(), partnerId: partnerB, agentId: userNlId, agentName: 'B1', agentLang: 'nl', dept: 'support', status: 'open', supportId: null, createdAt: ago1, updatedAt: ago1, participants: [] },
    ]);
  });

  afterAll(async () => {
    await db.delete(tickets).where(eq(tickets.partnerId, partnerA));
    await db.delete(tickets).where(eq(tickets.partnerId, partnerB));
    await db.delete(memberships).where(eq(memberships.partnerId, partnerA));
    await db.delete(users).where(eq(users.id, userNlId));
    await db.delete(users).where(eq(users.id, userFrId));
    await db.delete(partners).where(eq(partners.id, partnerA));
    await db.delete(partners).where(eq(partners.id, partnerB));
  });

  it('returns per-language counts scoped to the calling partner', async () => {
    const caller = appRouter.createCaller({
      user: { id: userFrId, name: 'Fr User', email: 'fr@test', role: 'support', partnerId: partnerA, isPlatformOperator: false, isExternal: false, lang: 'fr' },
    } as unknown as CallerCtx);
    const rows = await caller.support.getStaffingByLanguage({ partnerId: partnerA });
    const nl = rows.find((r) => r.lang === 'nl');
    const fr = rows.find((r) => r.lang === 'fr');
    expect(nl?.unclaimedTickets).toBe(3);
    expect(fr?.unclaimedTickets).toBe(1);
    // partner B's nl ticket must NOT be counted
    expect(nl?.unclaimedTickets).not.toBe(4);
    // oldest nl wait is 10 minutes → critical (>5m with 0 online in presence for test env)
    expect(nl?.imbalanceLevel).toBe('critical');
  });

  it('rejects callers who are not a member of the partner', async () => {
    const caller = appRouter.createCaller({
      user: { id: userNlId, name: 'Nl User', email: 'nl@test', role: 'support', partnerId: partnerA, isPlatformOperator: false, isExternal: false, lang: 'nl' },
    } as unknown as CallerCtx);
    await expect(caller.support.getStaffingByLanguage({ partnerId: partnerB })).rejects.toThrow(/FORBIDDEN|not a member/i);
  });

  it('returns empty array when queueLangAwareness is off on the partner', async () => {
    // make userNl a member of B for this check
    await db.insert(memberships).values({ id: randomUUID(), userId: userNlId, partnerId: partnerB, role: 'support', departments: [] });
    const caller = appRouter.createCaller({
      user: { id: userNlId, name: 'Nl User', email: 'nl@test', role: 'support', partnerId: partnerB, isPlatformOperator: false, isExternal: false, lang: 'nl' },
    } as unknown as CallerCtx);
    const rows = await caller.support.getStaffingByLanguage({ partnerId: partnerB });
    expect(rows).toEqual([]);
    await db.delete(memberships).where(eq(memberships.userId, userNlId));
  });
});
