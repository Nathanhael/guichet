// server/services/availability/adapters/drizzleTransitionLog.ts
import { eq, and, isNull, sql, gte, lte } from 'drizzle-orm';
import type { db as _db } from '../../../db/postgres.js';
import { agentStatusLog, dailyAgentStatus } from '../../../db/schema.js';
import logger from '../../../utils/logger.js';
import type { AgentStatus, DailyStats } from '../index.js';
import type { TransitionLogPort } from '../ports.js';

export interface DrizzleTransitionLogDeps {
  db: typeof _db;
}

export class DrizzleTransitionLog implements TransitionLogPort {
  constructor(private readonly deps: DrizzleTransitionLogDeps) {}

  async openRow(input: {
    userId: string; partnerId: string; status: AgentStatus; startedAt: Date;
  }): Promise<void> {
    const startedIso = input.startedAt.toISOString();
    try {
      const openRows = await this.deps.db
        .select().from(agentStatusLog)
        .where(and(
          eq(agentStatusLog.userId, input.userId),
          eq(agentStatusLog.partnerId, input.partnerId),
          isNull(agentStatusLog.endedAt),
        ))
        .limit(1);

      if (openRows.length > 0) {
        const r = openRows[0];
        const startedAt = new Date(r.startedAt);
        const durationSec = Math.round((input.startedAt.getTime() - startedAt.getTime()) / 1000);
        await this.deps.db.update(agentStatusLog)
          .set({ endedAt: startedIso, duration: durationSec })
          .where(eq(agentStatusLog.id, r.id));
      }

      await this.deps.db.insert(agentStatusLog).values({
        userId: input.userId,
        partnerId: input.partnerId,
        status: input.status,
        startedAt: startedIso,
      });
    } catch (err) {
      logger.error(
        { err: err instanceof Error ? err.message : String(err), userId: input.userId },
        '[availability/DrizzleTransitionLog] openRow error',
      );
    }
  }

  async closeOpenRow(input: {
    userId: string; partnerId: string; endedAt: Date;
  }): Promise<void> {
    const endedIso = input.endedAt.toISOString();
    try {
      const openRows = await this.deps.db
        .select().from(agentStatusLog)
        .where(and(
          eq(agentStatusLog.userId, input.userId),
          eq(agentStatusLog.partnerId, input.partnerId),
          isNull(agentStatusLog.endedAt),
        ))
        .limit(1);
      if (openRows.length > 0) {
        const r = openRows[0];
        const startedAt = new Date(r.startedAt);
        const durationSec = Math.round((input.endedAt.getTime() - startedAt.getTime()) / 1000);
        await this.deps.db.update(agentStatusLog)
          .set({ endedAt: endedIso, duration: durationSec })
          .where(eq(agentStatusLog.id, r.id));
      }
    } catch (err) {
      logger.error(
        { err: err instanceof Error ? err.message : String(err), userId: input.userId },
        '[availability/DrizzleTransitionLog] closeOpenRow error',
      );
    }
  }

  async rollupDay(partnerId: string, dateStr: string): Promise<{ rowsWritten: number }> {
    try {
      const dayStart = `${dateStr}T00:00:00.000Z`;
      const dayEnd = `${dateStr}T23:59:59.999Z`;
      const rows = await this.deps.db.select().from(agentStatusLog).where(and(
        eq(agentStatusLog.partnerId, partnerId),
        lte(agentStatusLog.startedAt, dayEnd),
        gte(sql`COALESCE(${agentStatusLog.endedAt}, NOW()::text)`, dayStart),
      ));

      const userTotals = new Map<string, Record<string, number>>();
      for (const row of rows) {
        const start = new Date(Math.max(new Date(row.startedAt).getTime(), new Date(dayStart).getTime()));
        const end = row.endedAt
          ? new Date(Math.min(new Date(row.endedAt).getTime(), new Date(dayEnd).getTime()))
          : new Date(Math.min(Date.now(), new Date(dayEnd).getTime()));
        const seconds = Math.max(0, Math.round((end.getTime() - start.getTime()) / 1000));
        if (!userTotals.has(row.userId)) userTotals.set(row.userId, { online: 0, away: 0 });
        const totals = userTotals.get(row.userId)!;
        if (totals[row.status] !== undefined) totals[row.status] += seconds;
      }

      let rowsWritten = 0;
      for (const [userId, totals] of userTotals) {
        await this.deps.db.insert(dailyAgentStatus).values({
          date: dateStr, userId, partnerId,
          onlineSeconds: totals.online, awaySeconds: totals.away,
        }).onConflictDoUpdate({
          target: [dailyAgentStatus.date, dailyAgentStatus.userId, dailyAgentStatus.partnerId],
          set: {
            onlineSeconds: sql`EXCLUDED.online_seconds`,
            awaySeconds: sql`EXCLUDED.away_seconds`,
          },
        });
        rowsWritten++;
      }
      logger.info(
        { partnerId, date: dateStr, userCount: userTotals.size },
        '[availability] Daily rollup complete',
      );
      return { rowsWritten };
    } catch (err) {
      logger.error(
        { err: err instanceof Error ? err.message : String(err), partnerId, dateStr },
        '[availability/DrizzleTransitionLog] rollupDay error',
      );
      return { rowsWritten: 0 };
    }
  }

  async agentDaily(userId: string, partnerId: string, from: string, to: string): Promise<DailyStats[]> {
    try {
      const rows = await this.deps.db.select().from(dailyAgentStatus).where(and(
        eq(dailyAgentStatus.userId, userId),
        eq(dailyAgentStatus.partnerId, partnerId),
        gte(dailyAgentStatus.date, from),
        lte(dailyAgentStatus.date, to),
      )).orderBy(dailyAgentStatus.date);
      return rows.map((r) => ({
        date: r.date, userId: r.userId, partnerId: r.partnerId,
        onlineSeconds: r.onlineSeconds, awaySeconds: r.awaySeconds,
      }));
    } catch (err) {
      logger.error(
        { err: err instanceof Error ? err.message : String(err), userId, partnerId },
        '[availability/DrizzleTransitionLog] agentDaily error',
      );
      return [];
    }
  }

  async teamDaily(partnerId: string, from: string, to: string): Promise<DailyStats[]> {
    try {
      const rows = await this.deps.db.select().from(dailyAgentStatus).where(and(
        eq(dailyAgentStatus.partnerId, partnerId),
        gte(dailyAgentStatus.date, from),
        lte(dailyAgentStatus.date, to),
      )).orderBy(dailyAgentStatus.date);
      return rows.map((r) => ({
        date: r.date, userId: r.userId, partnerId: r.partnerId,
        onlineSeconds: r.onlineSeconds, awaySeconds: r.awaySeconds,
      }));
    } catch (err) {
      logger.error(
        { err: err instanceof Error ? err.message : String(err), partnerId },
        '[availability/DrizzleTransitionLog] teamDaily error',
      );
      return [];
    }
  }
}
