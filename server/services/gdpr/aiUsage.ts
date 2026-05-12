/**
 * AI usage aggregation step of the daily GDPR purge.
 *
 * Splits the per-call ai_usage_log rows older than AI_USAGE_RETENTION_DAYS
 * into pre-aggregated daily_ai_usage summaries (idempotent upsert), then
 * deletes the source rows in the same transaction. Pre-aggregation keeps
 * long-tail per-partner cost analytics available indefinitely without
 * paying the row-per-call storage cost.
 */

import { sql } from 'drizzle-orm';
import { db } from '../../db.js';
import config from '../../config.js';
import { dailyAiUsage, aiUsageLog } from '../../db/schema.js';

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
