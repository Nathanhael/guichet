import { eq, and, isNull, sql, gte, lte } from 'drizzle-orm';
import { db } from '../db/postgres.js';
import { agentStatusLog, dailyAgentStatus } from '../db/schema.js';
import logger from '../utils/logger.js';

/**
 * Log a status transition. Closes the previous open row and opens a new one.
 */
export async function logTransition(userId: string, partnerId: string, newStatus: string): Promise<void> {
  const now = new Date();
  const nowIso = now.toISOString();

  try {
    // Close any open row for this user+partner
    const openRows = await db
      .select()
      .from(agentStatusLog)
      .where(and(
        eq(agentStatusLog.userId, userId),
        eq(agentStatusLog.partnerId, partnerId),
        isNull(agentStatusLog.endedAt),
      ))
      .limit(1);

    if (openRows.length > 0) {
      const openRow = openRows[0];
      const startedAt = new Date(openRow.startedAt);
      const durationSec = Math.round((now.getTime() - startedAt.getTime()) / 1000);

      await db
        .update(agentStatusLog)
        .set({ endedAt: nowIso, duration: durationSec })
        .where(eq(agentStatusLog.id, openRow.id));
    }

    // Open a new row for the new status
    await db.insert(agentStatusLog).values({
      userId,
      partnerId,
      status: newStatus,
      startedAt: nowIso,
    });
  } catch (err) {
    logger.error({ err: err instanceof Error ? err.message : String(err), userId, partnerId }, '[statusTracking] logTransition error');
  }
}

/**
 * Close any open status row for a user (called on disconnect).
 */
export async function closeOpenRow(userId: string, partnerId: string): Promise<void> {
  const now = new Date();
  const nowIso = now.toISOString();

  try {
    const openRows = await db
      .select()
      .from(agentStatusLog)
      .where(and(
        eq(agentStatusLog.userId, userId),
        eq(agentStatusLog.partnerId, partnerId),
        isNull(agentStatusLog.endedAt),
      ))
      .limit(1);

    if (openRows.length > 0) {
      const openRow = openRows[0];
      const startedAt = new Date(openRow.startedAt);
      const durationSec = Math.round((now.getTime() - startedAt.getTime()) / 1000);

      await db
        .update(agentStatusLog)
        .set({ endedAt: nowIso, duration: durationSec })
        .where(eq(agentStatusLog.id, openRow.id));
    }
  } catch (err) {
    logger.error({ err: err instanceof Error ? err.message : String(err), userId, partnerId }, '[statusTracking] closeOpenRow error');
  }
}

/**
 * Get daily time-in-status for a single agent.
 */
export async function getAgentDailyStats(userId: string, partnerId: string, fromDate: string, toDate: string) {
  try {
    return await db
      .select()
      .from(dailyAgentStatus)
      .where(and(
        eq(dailyAgentStatus.userId, userId),
        eq(dailyAgentStatus.partnerId, partnerId),
        gte(dailyAgentStatus.date, fromDate),
        lte(dailyAgentStatus.date, toDate),
      ))
      .orderBy(dailyAgentStatus.date);
  } catch (err) {
    logger.error({ err: err instanceof Error ? err.message : String(err), userId, partnerId }, '[statusTracking] getAgentDailyStats error');
    return [];
  }
}

/**
 * Get daily time-in-status for all agents in a partner.
 */
export async function getTeamDailyStats(partnerId: string, fromDate: string, toDate: string) {
  try {
    return await db
      .select()
      .from(dailyAgentStatus)
      .where(and(
        eq(dailyAgentStatus.partnerId, partnerId),
        gte(dailyAgentStatus.date, fromDate),
        lte(dailyAgentStatus.date, toDate),
      ))
      .orderBy(dailyAgentStatus.date);
  } catch (err) {
    logger.error({ err: err instanceof Error ? err.message : String(err), partnerId }, '[statusTracking] getTeamDailyStats error');
    return [];
  }
}

/**
 * Roll up agent_status_log rows into daily_agent_status for a given date.
 * Uses UPSERT for idempotency.
 */
export async function rollupDay(partnerId: string, dateStr: string): Promise<void> {
  try {
    const dayStart = `${dateStr}T00:00:00.000Z`;
    const dayEnd = `${dateStr}T23:59:59.999Z`;

    // Get all rows that overlap with this day
    const rows = await db
      .select()
      .from(agentStatusLog)
      .where(and(
        eq(agentStatusLog.partnerId, partnerId),
        lte(agentStatusLog.startedAt, dayEnd),
        gte(sql`COALESCE(${agentStatusLog.endedAt}, NOW()::text)`, dayStart),
      ));

    // Group by userId and accumulate seconds per status
    const userTotals = new Map<string, Record<string, number>>();

    for (const row of rows) {
      const start = new Date(Math.max(new Date(row.startedAt).getTime(), new Date(dayStart).getTime()));
      const end = row.endedAt
        ? new Date(Math.min(new Date(row.endedAt).getTime(), new Date(dayEnd).getTime()))
        : new Date(Math.min(Date.now(), new Date(dayEnd).getTime()));
      const seconds = Math.max(0, Math.round((end.getTime() - start.getTime()) / 1000));

      if (!userTotals.has(row.userId)) {
        userTotals.set(row.userId, { available: 0, break: 0, lunch: 0, meeting: 0, training: 0 });
      }
      const totals = userTotals.get(row.userId)!;
      if (totals[row.status] !== undefined) {
        totals[row.status] += seconds;
      }
    }

    // Upsert into daily_agent_status
    for (const [userId, totals] of userTotals) {
      await db
        .insert(dailyAgentStatus)
        .values({
          date: dateStr,
          userId,
          partnerId,
          availableSeconds: totals.available,
          breakSeconds: totals.break,
          lunchSeconds: totals.lunch,
          meetingSeconds: totals.meeting,
          trainingSeconds: totals.training,
        })
        .onConflictDoUpdate({
          target: [dailyAgentStatus.date, dailyAgentStatus.userId, dailyAgentStatus.partnerId],
          set: {
            availableSeconds: sql`EXCLUDED.available_seconds`,
            breakSeconds: sql`EXCLUDED.break_seconds`,
            lunchSeconds: sql`EXCLUDED.lunch_seconds`,
            meetingSeconds: sql`EXCLUDED.meeting_seconds`,
            trainingSeconds: sql`EXCLUDED.training_seconds`,
          },
        });
    }

    logger.info({ partnerId, date: dateStr, userCount: userTotals.size }, '[statusTracking] Daily rollup complete');
  } catch (err) {
    logger.error({ err: err instanceof Error ? err.message : String(err), partnerId, dateStr }, '[statusTracking] rollupDay error');
  }
}
