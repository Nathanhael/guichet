// server/services/availability/adapters/drizzleTransitionLog.ts
import { eq, and, isNull, sql, gte, lte } from 'drizzle-orm';
import type { TransitionLogPort } from '../ports.js';
import type { AgentStatus, DailyStats } from '../types.js';

interface Deps {
  db: typeof import('../../../db/postgres.js').db;
  schema: {
    agentStatusLog: typeof import('../../../db/schema.js').agentStatusLog;
    dailyAgentStatus: typeof import('../../../db/schema.js').dailyAgentStatus;
  };
  logger: { error: (obj: unknown, msg?: string) => void; info: (obj: unknown, msg?: string) => void };
}

export class DrizzleTransitionLog implements TransitionLogPort {
  constructor(private deps: Deps) {}

  async closeOpenRow(input: { userId: string; partnerId: string; endedAt: Date }) {
    const { db, schema } = this.deps;
    const open = await db
      .select()
      .from(schema.agentStatusLog)
      .where(and(
        eq(schema.agentStatusLog.userId, input.userId),
        eq(schema.agentStatusLog.partnerId, input.partnerId),
        isNull(schema.agentStatusLog.endedAt),
      ))
      .limit(1);
    if (open.length === 0) return;
    const row = open[0];
    const startedAt = new Date(row.startedAt);
    const duration = Math.round((input.endedAt.getTime() - startedAt.getTime()) / 1000);
    await db
      .update(schema.agentStatusLog)
      .set({ endedAt: input.endedAt.toISOString(), duration })
      .where(eq(schema.agentStatusLog.id, row.id));
  }

  async openRow(input: { userId: string; partnerId: string; status: AgentStatus; startedAt: Date }) {
    const { db, schema } = this.deps;
    await db.insert(schema.agentStatusLog).values({
      userId: input.userId,
      partnerId: input.partnerId,
      status: input.status,
      startedAt: input.startedAt.toISOString(),
    });
  }

  async closeAndOpen(input: { userId: string; partnerId: string; nextStatus: AgentStatus; at: Date }) {
    const { db, schema } = this.deps;
    await db.transaction(async tx => {
      const open = await tx
        .select()
        .from(schema.agentStatusLog)
        .where(and(
          eq(schema.agentStatusLog.userId, input.userId),
          eq(schema.agentStatusLog.partnerId, input.partnerId),
          isNull(schema.agentStatusLog.endedAt),
        ))
        .limit(1);
      if (open.length > 0) {
        const row = open[0];
        const startedAt = new Date(row.startedAt);
        const duration = Math.round((input.at.getTime() - startedAt.getTime()) / 1000);
        await tx.update(schema.agentStatusLog)
          .set({ endedAt: input.at.toISOString(), duration })
          .where(eq(schema.agentStatusLog.id, row.id));
      }
      await tx.insert(schema.agentStatusLog).values({
        userId: input.userId,
        partnerId: input.partnerId,
        status: input.nextStatus,
        startedAt: input.at.toISOString(),
      });
    });
  }

  async rollbackTransition(input: { userId: string; partnerId: string; at: Date }) {
    const { db, schema } = this.deps;
    const atIso = input.at.toISOString();
    await db.transaction(async tx => {
      // Drop the open row inserted at `at`.
      await tx.delete(schema.agentStatusLog).where(and(
        eq(schema.agentStatusLog.userId, input.userId),
        eq(schema.agentStatusLog.partnerId, input.partnerId),
        eq(schema.agentStatusLog.startedAt, atIso),
        isNull(schema.agentStatusLog.endedAt),
      ));
      // Reopen the prior row whose endedAt === at.
      await tx.update(schema.agentStatusLog)
        .set({ endedAt: null, duration: null })
        .where(and(
          eq(schema.agentStatusLog.userId, input.userId),
          eq(schema.agentStatusLog.partnerId, input.partnerId),
          eq(schema.agentStatusLog.endedAt, atIso),
        ));
    });
  }

  async rollupDay(partnerId: string, dateStr: string) {
    const { db, schema, logger } = this.deps;
    const dayStart = `${dateStr}T00:00:00.000Z`;
    const dayEnd = `${dateStr}T23:59:59.999Z`;

    const rows = await db.select().from(schema.agentStatusLog).where(and(
      eq(schema.agentStatusLog.partnerId, partnerId),
      lte(schema.agentStatusLog.startedAt, dayEnd),
      gte(sql`COALESCE(${schema.agentStatusLog.endedAt}, NOW()::text)`, dayStart),
    ));

    const userTotals = new Map<string, Record<string, number>>();
    for (const row of rows) {
      const start = new Date(Math.max(new Date(row.startedAt).getTime(), new Date(dayStart).getTime()));
      const end = row.endedAt
        ? new Date(Math.min(new Date(row.endedAt).getTime(), new Date(dayEnd).getTime()))
        : new Date(Math.min(Date.now(), new Date(dayEnd).getTime()));
      const seconds = Math.max(0, Math.round((end.getTime() - start.getTime()) / 1000));
      if (!userTotals.has(row.userId)) userTotals.set(row.userId, { online: 0, away: 0 });
      const t = userTotals.get(row.userId)!;
      if (t[row.status] !== undefined) t[row.status] += seconds;
    }

    let rowsWritten = 0;
    for (const [userId, totals] of userTotals) {
      await db.insert(schema.dailyAgentStatus).values({
        date: dateStr, userId, partnerId,
        onlineSeconds: totals.online, awaySeconds: totals.away,
      }).onConflictDoUpdate({
        target: [schema.dailyAgentStatus.date, schema.dailyAgentStatus.userId, schema.dailyAgentStatus.partnerId],
        set: { onlineSeconds: sql`EXCLUDED.online_seconds`, awaySeconds: sql`EXCLUDED.away_seconds` },
      });
      rowsWritten++;
    }
    logger.info({ partnerId, dateStr, rowsWritten }, '[availability] rollupDay complete');
    return { rowsWritten };
  }

  async agentDaily(userId: string, partnerId: string, fromDate: string, toDate: string): Promise<DailyStats[]> {
    const { db, schema } = this.deps;
    const rows = await db.select().from(schema.dailyAgentStatus).where(and(
      eq(schema.dailyAgentStatus.userId, userId),
      eq(schema.dailyAgentStatus.partnerId, partnerId),
      gte(schema.dailyAgentStatus.date, fromDate),
      lte(schema.dailyAgentStatus.date, toDate),
    )).orderBy(schema.dailyAgentStatus.date);
    return rows.map(r => ({
      date: r.date, userId: r.userId, partnerId: r.partnerId,
      onlineSeconds: r.onlineSeconds, awaySeconds: r.awaySeconds,
    }));
  }

  async teamDaily(partnerId: string, fromDate: string, toDate: string): Promise<DailyStats[]> {
    const { db, schema } = this.deps;
    const rows = await db.select().from(schema.dailyAgentStatus).where(and(
      eq(schema.dailyAgentStatus.partnerId, partnerId),
      gte(schema.dailyAgentStatus.date, fromDate),
      lte(schema.dailyAgentStatus.date, toDate),
    )).orderBy(schema.dailyAgentStatus.date);
    return rows.map(r => ({
      date: r.date, userId: r.userId, partnerId: r.partnerId,
      onlineSeconds: r.onlineSeconds, awaySeconds: r.awaySeconds,
    }));
  }
}
