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
      // `endedAt` is `timestamp` (mode 'string'); `NOW()` is `timestamptz`.
      // Cast NOW to timestamp so COALESCE has consistent types, and cast the
      // ISO-string `dayStart` to timestamp so the comparison happens at the
      // timestamp type (text comparison would mismatch — Postgres' default
      // text repr of timestamp uses a space, not 'T', and ASCII space < 'T'
      // breaks lexical ordering for ISO 8601 strings).
      gte(sql`COALESCE(${schema.agentStatusLog.endedAt}, NOW()::timestamp)`, sql`${dayStart}::timestamp`),
    ));

    interface UserTotals {
      online: number;
      away: number;
      hourlyOnline: number[];
    }
    const userTotals = new Map<string, UserTotals>();
    const dayStartMs = new Date(dayStart).getTime();
    const dayEndMs = new Date(dayEnd).getTime();

    for (const row of rows) {
      const startMs = Math.max(new Date(row.startedAt).getTime(), dayStartMs);
      const endMs = Math.min(
        row.endedAt ? new Date(row.endedAt).getTime() : Date.now(),
        dayEndMs,
      );
      if (endMs <= startMs) continue;

      let totals = userTotals.get(row.userId);
      if (!totals) {
        totals = { online: 0, away: 0, hourlyOnline: Array.from({ length: 24 }, () => 0) };
        userTotals.set(row.userId, totals);
      }

      // Bucket the period's seconds into the hour-of-day slots it overlaps
      // (UTC). For 'online' rows, distribute into hourlyOnline; daily totals
      // are summed regardless of status.
      let cursor = startMs;
      while (cursor < endMs) {
        const cursorDate = new Date(cursor);
        const hour = cursorDate.getUTCHours();
        const hourEndMs = Date.UTC(
          cursorDate.getUTCFullYear(),
          cursorDate.getUTCMonth(),
          cursorDate.getUTCDate(),
          hour + 1,
          0,
          0,
          0,
        );
        const sliceEnd = Math.min(hourEndMs, endMs);
        const seconds = Math.round((sliceEnd - cursor) / 1000);
        if (seconds > 0 && row.status === 'online') {
          totals.hourlyOnline[hour] += seconds;
        }
        cursor = sliceEnd;
      }

      const totalSeconds = Math.max(0, Math.round((endMs - startMs) / 1000));
      if (row.status === 'online') totals.online += totalSeconds;
      else if (row.status === 'away') totals.away += totalSeconds;
    }

    let rowsWritten = 0;
    for (const [userId, totals] of userTotals) {
      await db.insert(schema.dailyAgentStatus).values({
        date: dateStr, userId, partnerId,
        onlineSeconds: totals.online,
        awaySeconds: totals.away,
        hourlyOnlineSeconds: totals.hourlyOnline,
      }).onConflictDoUpdate({
        target: [schema.dailyAgentStatus.date, schema.dailyAgentStatus.userId, schema.dailyAgentStatus.partnerId],
        set: {
          onlineSeconds: sql`EXCLUDED.online_seconds`,
          awaySeconds: sql`EXCLUDED.away_seconds`,
          hourlyOnlineSeconds: sql`EXCLUDED.hourly_online_seconds`,
        },
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
      hourlyOnlineSeconds: coerceHourlyArray(r.hourlyOnlineSeconds),
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
      hourlyOnlineSeconds: coerceHourlyArray(r.hourlyOnlineSeconds),
    }));
  }
}

/**
 * Defensive coercion of `hourly_online_seconds` JSONB. The column is `notNull`
 * with a 24-zero default, but legacy rows written before migration 0016 may
 * still surface in tests fixtures or external imports.
 */
function coerceHourlyArray(value: unknown): number[] {
  const out = Array.from({ length: 24 }, () => 0);
  if (Array.isArray(value)) {
    for (let i = 0; i < 24; i++) {
      const n = Number(value[i]);
      if (Number.isFinite(n)) out[i] = n;
    }
  }
  return out;
}
