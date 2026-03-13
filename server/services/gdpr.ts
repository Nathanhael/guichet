import { query, run, transaction } from '../db.js';
import config from '../config.js';
import logger from '../utils/logger.js';
import { computeLiveDayStats } from './stats.js';
import { Ticket } from '../types/index.js';

export async function runDailyPurge() {
  try {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - config.GDPR_RETENTION_DAYS);
    const cutoffDate = cutoff.toISOString().slice(0, 10);

    const datesToAggregate = await query(
      `SELECT DISTINCT created_at::date::text as date
       FROM tickets
       WHERE created_at < $1
         AND created_at::date NOT IN (SELECT date FROM daily_stats)`,
      [cutoffDate]
    ) as { date: string }[];

    for (const { date } of datesToAggregate) {
      const dayTickets = await query('SELECT * FROM tickets WHERE created_at::date = $1', [date]) as Ticket[];
      const ticketIds = dayTickets.map(t => t.id);
      let dayRatings: any[] = [];
      if (ticketIds.length > 0) {
        dayRatings = await query(`SELECT * FROM ratings WHERE "ticket_id" IN (${ticketIds.map((_, i) => `$${i + 1}`).join(',')})`, ticketIds) as any[];
      }

      const stats = computeLiveDayStats(dayTickets, dayRatings);

      await run(
        `INSERT INTO daily_stats
        (date, total, closed, abandoned, "avg_response_ms", "avg_duration_ms", "avg_rating", "rating_count", "sla_resolved", "sla_compliant", "dept_counts", "ratings_by_dept", hourly)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
        ON CONFLICT (date) DO UPDATE SET
          total = EXCLUDED.total,
          closed = EXCLUDED.closed,
          abandoned = EXCLUDED.abandoned,
          "avg_response_ms" = EXCLUDED."avg_response_ms",
          "avg_duration_ms" = EXCLUDED."avg_duration_ms",
          "avg_rating" = EXCLUDED."avg_rating",
          "rating_count" = EXCLUDED."rating_count",
          "sla_resolved" = EXCLUDED."sla_resolved",
          "sla_compliant" = EXCLUDED."sla_compliant",
          "dept_counts" = EXCLUDED."dept_counts",
          "ratings_by_dept" = EXCLUDED."ratings_by_dept",
          hourly = EXCLUDED.hourly`,
        [
          date, stats.total, stats.closed, stats.abandoned,
          stats.responseCount > 0 ? Math.round(stats.responseSum / stats.responseCount) : 0,
          stats.durationCount > 0 ? Math.round(stats.durationSum / stats.durationCount) : 0,
          stats.ratingCount > 0 ? Math.round((stats.ratingSum / stats.ratingCount) * 10) / 10 : null,
          stats.ratingCount, stats.slaResolved, stats.slaCompliant,
          JSON.stringify(stats.deptCounts), JSON.stringify(stats.ratingsByDept), JSON.stringify(stats.hourly)
        ]
      );
    }

    await transaction(async () => {
      await run('DELETE FROM messages WHERE ticket_id IN (SELECT id FROM tickets WHERE created_at < $1)', [cutoffDate]);
      await run('DELETE FROM ratings WHERE ticket_id IN (SELECT id FROM tickets WHERE created_at < $1)', [cutoffDate]);
      await run('DELETE FROM ticket_labels WHERE ticket_id IN (SELECT id FROM tickets WHERE created_at < $1)', [cutoffDate]);
      await run('DELETE FROM tickets WHERE created_at < $1', [cutoffDate]);
    });

    logger.info(`[purge] GDPR purge complete for data older than ${cutoffDate}.`);
  } catch (err) {
    logger.error({ err }, '[purge] Error during daily purge');
  }
}
