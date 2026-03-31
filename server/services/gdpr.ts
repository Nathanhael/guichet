import { db } from '../db.js';
import { sql, inArray, and, eq, lt, gte } from 'drizzle-orm';
import config from '../config.js';
import logger from '../utils/logger.js';
import { computeLiveDayStats } from './stats.js';
import { Ticket, Rating, Message } from '../types/index.js';
import { archiveAuditLog, archiveTickets, verifyAuditChain } from './archive.js';
import { tickets, ratings as ratingsTable, messages as messagesTable, auditLog as auditLogTable, appFeedback as appFeedbackTable, dailyStats, dailyAiUsage, aiUsageLog, archivedTickets } from '../db/schema.js';

export async function runDailyPurge() {
  // Step 0: Archive before purging (uses AUDIT_ARCHIVE_DELAY_DAYS, default 2 days)
  // This MUST run outside the try/catch so chain integrity violations propagate to the caller.
  const auditArchived = await archiveAuditLog();
  const ticketsArchived = await archiveTickets();
  if (auditArchived > 0 || ticketsArchived > 0) {
    logger.info({ auditArchived, ticketsArchived }, '[purge] Pre-purge archival complete');
  }

  // Step 0.5: Verify audit chain integrity after archival.
  // Must remain OUTSIDE the try/catch — a broken chain must abort the entire purge,
  // not be silently swallowed by the general error handler.
  const chainResult = await verifyAuditChain();
  if (!chainResult.valid) {
    logger.error({ brokenAt: chainResult.brokenAt, checked: chainResult.checked }, '[purge] AUDIT CHAIN INTEGRITY VIOLATION — hash chain is broken');
    throw new Error('GDPR purge aborted: audit chain integrity violation detected');
  } else if (chainResult.checked > 0) {
    logger.info({ checked: chainResult.checked }, '[purge] Audit chain integrity verified');
  }

  try {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - config.GDPR_RETENTION_DAYS);
    const cutoffDate = cutoff.toISOString().slice(0, 10);

    // Guard: check if there are closed tickets that haven't been archived yet.
    // The old guard relied on the archiveTickets return value being non-zero, which
    // is false on day 2+ when tickets were already archived in a prior run — causing
    // all subsequent purge runs to be silently skipped and GDPR data retained indefinitely.
    const unarchivedRows = await db.execute(sql`
      SELECT COUNT(*)::int as count FROM ${tickets}
      WHERE ${tickets.createdAt} < ${cutoff.toISOString()} AND ${tickets.status} = 'closed'
      AND NOT EXISTS (SELECT 1 FROM ${archivedTickets} WHERE ${archivedTickets.id} = ${tickets.id})
    `);
    const unarchivedCount = (unarchivedRows as unknown as { count: number }[])[0]?.count ?? 0;

    if (unarchivedCount > 0) {
      logger.warn({ unarchivedCount }, '[purge] Unarchived closed tickets exist — archiving first');
      await archiveTickets();
    }

    // Optimized: single query fetches all tickets in the retention window grouped by
    // (date, partner_id), replacing the previous O(dates × partners) nested loop.
    // We fetch all tickets + ratings + messages in 3 bulk queries, then group in-memory.
    const windowEnd = cutoffDate;
    const windowStart = '1970-01-01'; // aggregate everything older than cutoff

    const allTickets = (await db
      .select()
      .from(tickets)
      .where(and(
        gte(tickets.createdAt, windowStart),
        lt(tickets.createdAt, windowEnd),
        eq(tickets.status, 'closed'),
      ))
      .orderBy(tickets.partnerId, tickets.createdAt)
    ) as unknown as Ticket[];

    if (allTickets.length > 0) {
      const allTicketIds = allTickets.map(t => t.id);

      // Single bulk fetch for ratings and messages, keyed by ticket_id
      const allRatings = (await db.select().from(ratingsTable).where(inArray(ratingsTable.ticketId, allTicketIds))) as unknown as Rating[];
      const allMessages = (await db.select().from(messagesTable).where(inArray(messagesTable.ticketId, allTicketIds))) as unknown as Message[];

      // Group ratings and messages by ticketId for O(1) lookup
      const ratingsByTicket = new Map<string, Rating[]>();
      for (const r of allRatings) {
        const list = ratingsByTicket.get(r.ticketId) ?? [];
        list.push(r);
        ratingsByTicket.set(r.ticketId, list);
      }
      const messagesByTicket = new Map<string, Message[]>();
      for (const m of allMessages) {
        const list = messagesByTicket.get(m.ticketId) ?? [];
        list.push(m);
        messagesByTicket.set(m.ticketId, list);
      }

      // Group tickets by (date, partner_id) — single in-memory pass
      type TicketWithPartner = Ticket & { partnerId: string };
      type DayPartnerKey = string; // "YYYY-MM-DD|partnerId"
      const grouped = new Map<DayPartnerKey, { date: string; partnerId: string; tickets: TicketWithPartner[] }>();
      for (const ticket of allTickets as TicketWithPartner[]) {
        const date = new Date(ticket.createdAt).toISOString().slice(0, 10);
        const key: DayPartnerKey = `${date}|${ticket.partnerId}`;
        const entry = grouped.get(key) ?? { date, partnerId: ticket.partnerId, tickets: [] };
        entry.tickets.push(ticket);
        grouped.set(key, entry);
      }

      // Compute stats and upsert daily_stats — one INSERT per (date, partner_id) group
      for (const { date, partnerId, tickets: dayTickets } of grouped.values()) {
        const ticketIds = dayTickets.map(t => t.id);
        const dayRatings = ticketIds.flatMap(id => ratingsByTicket.get(id) ?? []);
        const dayMessages = ticketIds.flatMap(id => messagesByTicket.get(id) ?? []);

        const stats = computeLiveDayStats(dayTickets, dayRatings, 'all', dayMessages);

        const avgResponseMs = stats.responseCount > 0 ? Math.round(stats.responseSum / stats.responseCount) : 0;
        const avgDurationMs = stats.durationCount > 0 ? Math.round(stats.durationSum / stats.durationCount) : 0;
        const avgRating = stats.ratingCount > 0 ? Math.round((stats.ratingSum / stats.ratingCount) * 10) / 10 : null;

        const row = {
          date, partnerId,
          total: stats.total, closed: stats.closed, abandoned: stats.abandoned, reopened: stats.reopened,
          avgResponseMs, avgDurationMs, avgRating,
          ratingCount: stats.ratingCount, slaResolved: stats.slaResolved, slaCompliant: stats.slaCompliant,
          p95ResponseMs: stats.p95ResponseMs, sentimentSum: stats.sentimentSum, sentimentCount: stats.sentimentCount,
          deptCounts: stats.deptCounts, ratingsByDept: stats.ratingsByDept, hourly: stats.hourly,
        };

        await db.insert(dailyStats).values(row).onConflictDoUpdate({
          target: [dailyStats.date, dailyStats.partnerId],
          set: {
            total: sql`EXCLUDED.total`, closed: sql`EXCLUDED.closed`,
            abandoned: sql`EXCLUDED.abandoned`, reopened: sql`EXCLUDED.reopened`,
            avgResponseMs: sql`EXCLUDED.avg_response_ms`, avgDurationMs: sql`EXCLUDED.avg_duration_ms`,
            avgRating: sql`EXCLUDED.avg_rating`, ratingCount: sql`EXCLUDED.rating_count`,
            slaResolved: sql`EXCLUDED.sla_resolved`, slaCompliant: sql`EXCLUDED.sla_compliant`,
            p95ResponseMs: sql`EXCLUDED.p95_response_ms`, sentimentSum: sql`EXCLUDED.sentiment_sum`,
            sentimentCount: sql`EXCLUDED.sentiment_count`, deptCounts: sql`EXCLUDED.dept_counts`,
            ratingsByDept: sql`EXCLUDED.ratings_by_dept`, hourly: sql`EXCLUDED.hourly`,
          },
        });
      }
    }

    await db.transaction(async (tx) => {
      // Only delete tickets that are closed (and thus have been archived above).
      // Open/pending tickets are never purged to prevent data loss.
      await tx.execute(sql`DELETE FROM messages WHERE ticket_id IN (SELECT id FROM tickets WHERE created_at < ${cutoffDate} AND status = 'closed')`);
      await tx.execute(sql`DELETE FROM ratings WHERE ticket_id IN (SELECT id FROM tickets WHERE created_at < ${cutoffDate} AND status = 'closed')`);
      await tx.execute(sql`DELETE FROM ticket_labels WHERE ticket_id IN (SELECT id FROM tickets WHERE created_at < ${cutoffDate} AND status = 'closed')`);
      // Purge app_feedback older than retention period (GDPR compliance)
      await tx.execute(sql`DELETE FROM app_feedback WHERE created_at < ${cutoffDate}`);
      await tx.execute(sql`DELETE FROM tickets WHERE created_at < ${cutoffDate} AND status = 'closed'`);

      // CR-02 fix: Anonymize audit_log — filter NULLs from array_agg to prevent
      // the IN predicate from silently matching nothing when support_id is NULL
      const auditResult = await tx.execute(sql`
        UPDATE audit_log SET actor_id = NULL
        WHERE actor_id IN (
          SELECT DISTINCT unnest(
            array_agg(agent_id) FILTER (WHERE agent_id IS NOT NULL)
            || array_agg(support_id) FILTER (WHERE support_id IS NOT NULL)
          )
          FROM tickets WHERE created_at < ${cutoffDate} AND status = 'closed'
        ) AND created_at < ${cutoffDate}
      `);
      const auditAnonymized = (auditResult as { rowCount?: number }).rowCount ?? 0;

      // Anonymize audit_archive: same NULL-safe treatment
      const archiveResult = await tx.execute(sql`
        UPDATE audit_archive SET actor_id = NULL
        WHERE actor_id IN (
          SELECT DISTINCT unnest(
            array_agg(agent_id) FILTER (WHERE agent_id IS NOT NULL)
            || array_agg(support_id) FILTER (WHERE support_id IS NOT NULL)
          )
          FROM tickets WHERE created_at < ${cutoffDate} AND status = 'closed'
        ) AND created_at < ${cutoffDate}
      `);
      const archiveAnonymized = (archiveResult as { rowCount?: number }).rowCount ?? 0;

      logger.info({ auditAnonymized, archiveAnonymized, cutoffDate }, '[purge] Audit records anonymized (actorId set to NULL)');
    });

    // Step 3: Aggregate and purge old AI usage logs (separate retention window)
    const aiPurged = await aggregateAndPurgeAiUsage();
    if (aiPurged > 0) {
      logger.info({ aiPurged }, '[purge] AI usage log aggregate + purge complete');
    }

    // Log the successful purge in audit_log
    await db.insert(auditLogTable).values({
      action: 'system.gdpr_purge',
      actorId: null, // System action, no user associated
      targetType: 'system',
      metadata: { cutoffDate, aiUsagePurged: aiPurged, success: true }
    });

    logger.info(`[purge] GDPR purge complete for data older than ${cutoffDate}.`);
  } catch (err) {
    logger.error({ err }, '[purge] Error during daily purge');
  }
}

/**
 * Aggregate ai_usage_log rows older than AI_USAGE_RETENTION_DAYS into
 * daily_ai_usage summaries, then delete the source rows.
 * Returns the number of rows purged.
 */
export async function aggregateAndPurgeAiUsage(): Promise<number> {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - config.AI_USAGE_RETENTION_DAYS);
  const cutoffDate = cutoff.toISOString().slice(0, 10);

  // ME-04 fix: Wrap aggregate + delete in a transaction to prevent data loss on crash
  let purgedCount = 0;
  await db.transaction(async (tx) => {
    // Step 1: Aggregate into daily_ai_usage (upsert to be idempotent)
    await tx.execute(sql`
      INSERT INTO ${dailyAiUsage}
        (id, date, partner_id, action, provider, model,
         total_input_tokens, total_output_tokens, total_requests,
         success_count, error_count, avg_latency_ms)
      SELECT
        gen_random_uuid(),
        created_at::date::text,
        partner_id,
        action,
        provider,
        model,
        COALESCE(SUM(input_tokens), 0),
        COALESCE(SUM(output_tokens), 0),
        COUNT(*),
        COUNT(*) FILTER (WHERE success = true),
        COUNT(*) FILTER (WHERE success = false),
        CASE WHEN COUNT(*) FILTER (WHERE latency_ms IS NOT NULL) > 0
             THEN (SUM(latency_ms) / COUNT(*) FILTER (WHERE latency_ms IS NOT NULL))::int
             ELSE NULL END
      FROM ${aiUsageLog}
      WHERE ${aiUsageLog.createdAt} < ${cutoffDate}
      GROUP BY created_at::date::text, partner_id, action, provider, model
      ON CONFLICT (date, partner_id, action, provider, model) DO UPDATE SET
        total_input_tokens  = ${dailyAiUsage}.total_input_tokens  + EXCLUDED.total_input_tokens,
        total_output_tokens = ${dailyAiUsage}.total_output_tokens + EXCLUDED.total_output_tokens,
        total_requests      = ${dailyAiUsage}.total_requests      + EXCLUDED.total_requests,
        success_count       = ${dailyAiUsage}.success_count       + EXCLUDED.success_count,
        error_count         = ${dailyAiUsage}.error_count         + EXCLUDED.error_count,
        avg_latency_ms      = CASE
          WHEN (${dailyAiUsage}.total_requests + EXCLUDED.total_requests) > 0
          THEN ((COALESCE(${dailyAiUsage}.avg_latency_ms, 0) * ${dailyAiUsage}.total_requests
               + COALESCE(EXCLUDED.avg_latency_ms, 0) * EXCLUDED.total_requests)
               / (${dailyAiUsage}.total_requests + EXCLUDED.total_requests))::int
          ELSE NULL END
    `);

    // Step 2: Delete the now-aggregated source rows (same transaction)
    const result = await tx.execute(sql`
      DELETE FROM ${aiUsageLog} WHERE ${aiUsageLog.createdAt} < ${cutoffDate}
    `);
    purgedCount = (result as unknown as { rowCount?: number }).rowCount ?? 0;
  });

  return purgedCount;
}
