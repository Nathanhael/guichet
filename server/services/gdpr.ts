import { query, run, transaction, db } from '../db.js';
import { sql, inArray } from 'drizzle-orm';
import config from '../config.js';
import logger from '../utils/logger.js';
import { computeLiveDayStats } from './stats.js';
import { Ticket, Rating, Message } from '../types/index.js';
import { archiveAuditLog, archiveTickets, verifyAuditChain } from './archive.js';
import { ratings as ratingsTable, messages as messagesTable, auditLog as auditLogTable, appFeedback as appFeedbackTable, dailyAiUsage } from '../db/schema.js';

export async function runDailyPurge() {
  try {
    // Step 0: Archive before purging (uses AUDIT_ARCHIVE_DELAY_DAYS, default 2 days)
    const auditArchived = await archiveAuditLog();
    const ticketsArchived = await archiveTickets();
    if (auditArchived > 0 || ticketsArchived > 0) {
      logger.info({ auditArchived, ticketsArchived }, '[purge] Pre-purge archival complete');
    }

    // Step 0.5: Verify audit chain integrity after archival
    const chainResult = await verifyAuditChain();
    if (!chainResult.valid) {
      logger.error({ brokenAt: chainResult.brokenAt, checked: chainResult.checked }, '[purge] AUDIT CHAIN INTEGRITY VIOLATION — hash chain is broken');
      throw new Error('GDPR purge aborted: audit chain integrity violation detected');
    } else if (chainResult.checked > 0) {
      logger.info({ checked: chainResult.checked }, '[purge] Audit chain integrity verified');
    }

    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - config.GDPR_RETENTION_DAYS);
    const cutoffDate = cutoff.toISOString().slice(0, 10);

    // Guard: check if there are closed tickets that haven't been archived yet.
    // The old guard relied on the archiveTickets return value being non-zero, which
    // is false on day 2+ when tickets were already archived in a prior run — causing
    // all subsequent purge runs to be silently skipped and GDPR data retained indefinitely.
    const unarchivedRows = await query(
      `SELECT COUNT(*)::int as count FROM tickets t
       WHERE t.created_at < $1 AND t.status = 'closed'
       AND NOT EXISTS (SELECT 1 FROM archived_tickets a WHERE a.id = t.id)`,
      [cutoff.toISOString()]
    ) as { count: number }[];
    const unarchivedCount = unarchivedRows[0]?.count ?? 0;

    if (unarchivedCount > 0) {
      logger.warn({ unarchivedCount }, '[purge] Unarchived closed tickets exist — archiving first');
      await archiveTickets();
    }

    const datesToAggregate = await query(
      `SELECT DISTINCT t.created_at::date::text as date
       FROM tickets t
       WHERE t.created_at < $1
         AND t.status = 'closed'`,
      [cutoffDate]
    ) as { date: string }[];

    if (Array.isArray(datesToAggregate)) {
      for (const { date } of datesToAggregate) {
        // Use date range filtering instead of ::date cast to allow index use
        const nextDate = new Date(date);
        nextDate.setDate(nextDate.getDate() + 1);
        const nextDateStr = nextDate.toISOString().slice(0, 10);

        // Find all partners that had activity on this date
        // Note: query() auto-converts snake_case to camelCase, so partner_id → partnerId
        const partnerIds = (await query('SELECT DISTINCT partner_id FROM tickets WHERE created_at >= $1 AND created_at < $2', [date, nextDateStr])) as { partnerId: string }[];

        for (const { partnerId } of partnerIds) {
          // Project only needed columns instead of SELECT *
          const dayTickets = (await query(
            `SELECT id, partner_id, dept, agent_id, support_id, status, created_at, updated_at, closed_at, closing_notes, closed_by, participants, reopened, reopen_count, sla_response_due_at, sla_resolution_due_at, sla_breached, agent_name, agent_lang, support_name, support_lang, support_joined_at, "references"
             FROM tickets WHERE created_at >= $1 AND created_at < $2 AND partner_id = $3`,
            [date, nextDateStr, partnerId]
          )) as unknown as Ticket[];
          const ticketIds = dayTickets.map(t => t.id);

          let dayRatings: Rating[] = [];
          if (ticketIds.length > 0) {
            dayRatings = (await db.select().from(ratingsTable).where(inArray(ratingsTable.ticketId, ticketIds))) as unknown as Rating[];
          }

          let dayMessages: Message[] = [];
          if (ticketIds.length > 0) {
            dayMessages = (await db.select().from(messagesTable).where(inArray(messagesTable.ticketId, ticketIds))) as unknown as Message[];
          }

          const stats = computeLiveDayStats(dayTickets, dayRatings, 'all', dayMessages);

          await run(
            `INSERT INTO daily_stats
            (date, partner_id, total, closed, abandoned, reopened, "avg_response_ms", "avg_duration_ms", "avg_rating", "rating_count", "sla_resolved", "sla_compliant", "p95_response_ms", "sentiment_sum", "sentiment_count", "dept_counts", "ratings_by_dept", hourly)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)
            ON CONFLICT (date, partner_id) DO UPDATE SET
              total = EXCLUDED.total,
              closed = EXCLUDED.closed,
              abandoned = EXCLUDED.abandoned,
              reopened = EXCLUDED.reopened,
              "avg_response_ms" = EXCLUDED."avg_response_ms",
              "avg_duration_ms" = EXCLUDED."avg_duration_ms",
              "avg_rating" = EXCLUDED."avg_rating",
              "rating_count" = EXCLUDED."rating_count",
              "sla_resolved" = EXCLUDED."sla_resolved",
              "sla_compliant" = EXCLUDED."sla_compliant",
              "p95_response_ms" = EXCLUDED."p95_response_ms",
              "sentiment_sum" = EXCLUDED."sentiment_sum",
              "sentiment_count" = EXCLUDED."sentiment_count",
              "dept_counts" = EXCLUDED."dept_counts",
              "ratings_by_dept" = EXCLUDED."ratings_by_dept",
              hourly = EXCLUDED.hourly`,
            [
              date, partnerId, stats.total, stats.closed, stats.abandoned, stats.reopened,
              stats.responseCount > 0 ? Math.round(stats.responseSum / stats.responseCount) : 0,
              stats.durationCount > 0 ? Math.round(stats.durationSum / stats.durationCount) : 0,
              stats.ratingCount > 0 ? Math.round((stats.ratingSum / stats.ratingCount) * 10) / 10 : null,
              stats.ratingCount, stats.slaResolved, stats.slaCompliant,
              stats.p95ResponseMs, stats.sentimentSum, stats.sentimentCount,
              JSON.stringify(stats.deptCounts), JSON.stringify(stats.ratingsByDept), JSON.stringify(stats.hourly)
            ]
          );
        }
      }
    }

    await transaction(async (tx) => {
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
  await transaction(async () => {
    // Step 1: Aggregate into daily_ai_usage (upsert to be idempotent)
    await run(`
      INSERT INTO daily_ai_usage
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
      FROM ai_usage_log
      WHERE created_at < $1
      GROUP BY created_at::date::text, partner_id, action, provider, model
      ON CONFLICT (date, partner_id, action, provider, model) DO UPDATE SET
        total_input_tokens  = daily_ai_usage.total_input_tokens  + EXCLUDED.total_input_tokens,
        total_output_tokens = daily_ai_usage.total_output_tokens + EXCLUDED.total_output_tokens,
        total_requests      = daily_ai_usage.total_requests      + EXCLUDED.total_requests,
        success_count       = daily_ai_usage.success_count       + EXCLUDED.success_count,
        error_count         = daily_ai_usage.error_count         + EXCLUDED.error_count,
        avg_latency_ms      = CASE
          WHEN (daily_ai_usage.total_requests + EXCLUDED.total_requests) > 0
          THEN ((COALESCE(daily_ai_usage.avg_latency_ms, 0) * daily_ai_usage.total_requests
               + COALESCE(EXCLUDED.avg_latency_ms, 0) * EXCLUDED.total_requests)
               / (daily_ai_usage.total_requests + EXCLUDED.total_requests))::int
          ELSE NULL END
    `, [cutoffDate]);

    // Step 2: Delete the now-aggregated source rows (same transaction)
    const result = await run(
      `DELETE FROM ai_usage_log WHERE created_at < $1`,
      [cutoffDate]
    );
    purgedCount = result.changes ?? 0;
  });

  return purgedCount;
}
