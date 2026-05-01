// Adapter-level integration tests for DrizzleTransitionLog. Runs against the
// test PG container via the live `db` connection. Verifies SQL semantics +
// transactional behavior + rollup math that boundary tests (memory adapter)
// can't cover. See issue #109.
import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { eq, inArray } from 'drizzle-orm';
import { db } from '../../../db.js';
import { agentStatusLog, dailyAgentStatus, partners, users } from '../../../db/schema.js';
import { DrizzleTransitionLog } from '../adapters/drizzleTransitionLog.js';

const NOOP_LOGGER = { error: () => {}, info: () => {} };
const PARTNER = 'adapter-test-partner';
const USER = 'adapter-test-user';
const USER_AGENT_1 = 'agent-1';
const USER_AGENT_2 = 'agent-2';
const TEST_USERS = [USER, USER_AGENT_1, USER_AGENT_2];

describe('DrizzleTransitionLog adapter (real PG)', () => {
  let log: DrizzleTransitionLog;

  beforeAll(async () => {
    // Seed the FK targets once per suite.
    await db.insert(partners).values({
      id: PARTNER,
      name: 'Adapter Test Partner',
      industry: 'Test',
      departments: [{ id: 'support', name: 'Support' }],
      status: 'active',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }).onConflictDoNothing();
    for (const userId of TEST_USERS) {
      await db.insert(users).values({
        id: userId,
        email: `${userId}@adapter-test.local`,
        name: userId,
        lang: 'en',
      }).onConflictDoNothing();
    }
  });

  afterAll(async () => {
    await db.delete(agentStatusLog).where(eq(agentStatusLog.partnerId, PARTNER));
    await db.delete(dailyAgentStatus).where(eq(dailyAgentStatus.partnerId, PARTNER));
    await db.delete(users).where(inArray(users.id, TEST_USERS));
    await db.delete(partners).where(eq(partners.id, PARTNER));
  });

  beforeEach(async () => {
    log = new DrizzleTransitionLog({
      db,
      schema: { agentStatusLog, dailyAgentStatus },
      logger: NOOP_LOGGER,
    });
    // Clean test partner state — scoped delete so we don't nuke other tests'
    // data running in parallel against the same DB.
    await db.delete(agentStatusLog).where(eq(agentStatusLog.partnerId, PARTNER));
    await db.delete(dailyAgentStatus).where(eq(dailyAgentStatus.partnerId, PARTNER));
  });

  describe('closeAndOpen — transactional close+open', () => {
    it('closes the prior open row and inserts a new one in one transaction', async () => {
      const t1 = new Date('2026-04-29T10:00:00Z');
      const t2 = new Date('2026-04-29T11:00:00Z');

      await log.openRow({ userId: USER, partnerId: PARTNER, status: 'online', startedAt: t1 });
      await log.closeAndOpen({ userId: USER, partnerId: PARTNER, nextStatus: 'away', at: t2 });

      const rows = await db.select().from(agentStatusLog).where(eq(agentStatusLog.partnerId, PARTNER));
      expect(rows).toHaveLength(2);

      const closed = rows.find(r => r.endedAt !== null);
      const open = rows.find(r => r.endedAt === null);
      expect(closed?.status).toBe('online');
      expect(closed?.duration).toBe(3600); // 1 hour in seconds
      expect(open?.status).toBe('away');
    });

    it('closeAndOpen with no prior open row inserts the new one anyway', async () => {
      const t = new Date('2026-04-29T10:00:00Z');
      await log.closeAndOpen({ userId: USER, partnerId: PARTNER, nextStatus: 'away', at: t });

      const rows = await db.select().from(agentStatusLog).where(eq(agentStatusLog.partnerId, PARTNER));
      expect(rows).toHaveLength(1);
      expect(rows[0].status).toBe('away');
      expect(rows[0].endedAt).toBeNull();
    });
  });

  describe('rollbackTransition — undo a closeAndOpen', () => {
    it('deletes the new open row + reopens the prior closed row', async () => {
      const t1 = new Date('2026-04-29T10:00:00Z');
      const t2 = new Date('2026-04-29T11:00:00Z');

      await log.openRow({ userId: USER, partnerId: PARTNER, status: 'online', startedAt: t1 });
      await log.closeAndOpen({ userId: USER, partnerId: PARTNER, nextStatus: 'away', at: t2 });
      await log.rollbackTransition({ userId: USER, partnerId: PARTNER, at: t2 });

      const rows = await db.select().from(agentStatusLog).where(eq(agentStatusLog.partnerId, PARTNER));
      expect(rows).toHaveLength(1);
      expect(rows[0].status).toBe('online');
      expect(rows[0].endedAt).toBeNull();
      expect(rows[0].duration).toBeNull();
    });

    it('rollback when there is no prior closed row at `at` is a no-op on the missing row', async () => {
      const t = new Date('2026-04-29T10:00:00Z');
      // closeAndOpen with no prior row: only inserts new row.
      await log.closeAndOpen({ userId: USER, partnerId: PARTNER, nextStatus: 'away', at: t });
      await log.rollbackTransition({ userId: USER, partnerId: PARTNER, at: t });

      const rows = await db.select().from(agentStatusLog).where(eq(agentStatusLog.partnerId, PARTNER));
      expect(rows).toHaveLength(0);
    });
  });

  describe('rollupDay — daily aggregation', () => {
    it('aggregates online + away seconds across status transitions within the day', async () => {
      const dayStart = new Date('2026-04-29T00:00:00Z');
      const dayMid = new Date('2026-04-29T12:00:00Z');
      const dayEnd = new Date('2026-04-29T23:00:00Z');

      await log.openRow({ userId: USER, partnerId: PARTNER, status: 'online', startedAt: dayStart });
      await log.closeAndOpen({ userId: USER, partnerId: PARTNER, nextStatus: 'away', at: dayMid });
      await log.closeOpenRow({ userId: USER, partnerId: PARTNER, endedAt: dayEnd });

      const result = await log.rollupDay(PARTNER, '2026-04-29');
      expect(result.rowsWritten).toBeGreaterThan(0);

      const daily = await log.agentDaily(USER, PARTNER, '2026-04-29', '2026-04-29');
      expect(daily).toHaveLength(1);
      expect(daily[0].onlineSeconds).toBe(12 * 3600); // 00:00 → 12:00
      expect(daily[0].awaySeconds).toBe(11 * 3600);   // 12:00 → 23:00
    });

    it('is idempotent — running rollupDay twice produces the same result', async () => {
      const dayStart = new Date('2026-04-29T00:00:00Z');
      const dayEnd = new Date('2026-04-29T08:00:00Z');

      await log.openRow({ userId: USER, partnerId: PARTNER, status: 'online', startedAt: dayStart });
      await log.closeOpenRow({ userId: USER, partnerId: PARTNER, endedAt: dayEnd });

      await log.rollupDay(PARTNER, '2026-04-29');
      const first = await log.agentDaily(USER, PARTNER, '2026-04-29', '2026-04-29');
      await log.rollupDay(PARTNER, '2026-04-29');
      const second = await log.agentDaily(USER, PARTNER, '2026-04-29', '2026-04-29');

      expect(second).toEqual(first);
      expect(second[0].onlineSeconds).toBe(8 * 3600);
    });

    it('clips rows that span the day boundary to within the day', async () => {
      // Status row from 23:00 yesterday to 02:00 today — only the 0-2 portion
      // (today's 2 hours) should count toward today's rollup.
      const yesterday23 = new Date('2026-04-28T23:00:00Z');
      const today02 = new Date('2026-04-29T02:00:00Z');

      await log.openRow({ userId: USER, partnerId: PARTNER, status: 'online', startedAt: yesterday23 });
      await log.closeOpenRow({ userId: USER, partnerId: PARTNER, endedAt: today02 });

      await log.rollupDay(PARTNER, '2026-04-29');
      const daily = await log.agentDaily(USER, PARTNER, '2026-04-29', '2026-04-29');
      expect(daily).toHaveLength(1);
      expect(daily[0].onlineSeconds).toBe(2 * 3600); // 00:00 → 02:00 only
    });
  });

  describe('agentDaily / teamDaily — read shape', () => {
    it('agentDaily returns rows matching DailyStats interface', async () => {
      const dayStart = new Date('2026-04-29T00:00:00Z');
      const dayEnd = new Date('2026-04-29T01:00:00Z');
      await log.openRow({ userId: USER, partnerId: PARTNER, status: 'online', startedAt: dayStart });
      await log.closeOpenRow({ userId: USER, partnerId: PARTNER, endedAt: dayEnd });
      await log.rollupDay(PARTNER, '2026-04-29');

      const daily = await log.agentDaily(USER, PARTNER, '2026-04-29', '2026-04-29');
      expect(daily[0]).toEqual({
        date: '2026-04-29',
        userId: USER,
        partnerId: PARTNER,
        onlineSeconds: 3600,
        awaySeconds: 0,
      });
    });

    it('teamDaily returns rows for every agent in the partner', async () => {
      const dayStart = new Date('2026-04-29T00:00:00Z');
      const dayEnd = new Date('2026-04-29T01:00:00Z');

      await log.openRow({ userId: 'agent-1', partnerId: PARTNER, status: 'online', startedAt: dayStart });
      await log.closeOpenRow({ userId: 'agent-1', partnerId: PARTNER, endedAt: dayEnd });
      await log.openRow({ userId: 'agent-2', partnerId: PARTNER, status: 'online', startedAt: dayStart });
      await log.closeOpenRow({ userId: 'agent-2', partnerId: PARTNER, endedAt: dayEnd });

      await log.rollupDay(PARTNER, '2026-04-29');

      const team = await log.teamDaily(PARTNER, '2026-04-29', '2026-04-29');
      expect(team).toHaveLength(2);
      expect(team.map(r => r.userId).sort()).toEqual(['agent-1', 'agent-2']);
    });

    it('agentDaily returns empty array for a date range with no rollup', async () => {
      const daily = await log.agentDaily(USER, PARTNER, '2026-01-01', '2026-01-31');
      expect(daily).toEqual([]);
    });
  });
});
