import { query, run, transaction } from '../db.js';
import { sql } from 'drizzle-orm';
import config from '../config.js';
import logger from '../utils/logger.js';
import { computeLiveDayStats } from './stats.js';
import { Ticket, Rating, Message } from '../types/index.js';
import { archiveAuditLog, archiveTickets } from './archive.js';

export async function runDailyPurge() {
  try {
    // Step 0: Archive before purging
    const auditArchived = await archiveAuditLog();
    const ticketsArchived = await archiveTickets();
    if (auditArchived > 0 || ticketsArchived > 0) {
      logger.info({ auditArchived, ticketsArchived }, '[purge] Pre-purge archival complete');
    }

    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - config.GDPR_RETENTION_DAYS);
    const cutoffDate = cutoff.toISOString().slice(0, 10);

    const datesToAggregate = await query(
      `SELECT DISTINCT t.created_at::date::text as date
       FROM tickets t
       LEFT JOIN daily_stats ds ON ds.date = t.created_at::date AND ds.partner_id = t.partner_id
       WHERE t.created_at < $1
         AND ds.date IS NULL`,
      [cutoffDate]
    ) as { date: string }[];

    if (Array.isArray(datesToAggregate)) {
      for (const { date } of datesToAggregate) {
        // Find all partners that had activity on this date
        // Note: query() auto-converts snake_case to camelCase, so partner_id → partnerId
        const partnerIds = (await query('SELECT DISTINCT partner_id FROM tickets WHERE created_at::date = $1', [date])) as { partnerId: string }[];

        for (const { partnerId } of partnerIds) {
          const dayTickets = (await query('SELECT * FROM tickets WHERE created_at::date = $1 AND partner_id = $2', [date, partnerId])) as unknown as Ticket[];
          const ticketIds = dayTickets.map(t => t.id);
          
          let dayRatings: Rating[] = [];
          if (ticketIds.length > 0) {
            dayRatings = (await query(`SELECT * FROM ratings WHERE "ticket_id" IN (${ticketIds.map((_, i) => `$${i + 1}`).join(',')})`, ticketIds)) as unknown as Rating[];
          }
          
          let dayMessages: Message[] = [];
          if (ticketIds.length > 0) {
            dayMessages = (await query(`SELECT * FROM messages WHERE "ticket_id" IN (${ticketIds.map((_, i) => `$${i + 1}`).join(',')})`, ticketIds)) as unknown as Message[];
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
      await tx.execute(sql`DELETE FROM messages WHERE ticket_id IN (SELECT id FROM tickets WHERE created_at < ${cutoffDate})`);
      await tx.execute(sql`DELETE FROM ratings WHERE ticket_id IN (SELECT id FROM tickets WHERE created_at < ${cutoffDate})`);
      await tx.execute(sql`DELETE FROM ticket_labels WHERE ticket_id IN (SELECT id FROM tickets WHERE created_at < ${cutoffDate})`);
      await tx.execute(sql`DELETE FROM tickets WHERE created_at < ${cutoffDate}`);
    });

    // Log the successful purge in audit_log
    const { auditLog: auditLogTable } = await import('../db/schema.js');
    const { db: drizzleDb } = await import('../db.js');
    await drizzleDb.insert(auditLogTable).values({
      action: 'system.gdpr_purge',
      actorId: null, // System action, no user associated
      targetType: 'system',
      metadata: { cutoffDate, success: true }
    });

    logger.info(`[purge] GDPR purge complete for data older than ${cutoffDate}.`);
  } catch (err) {
    logger.error({ err }, '[purge] Error during daily purge');
  }
}
