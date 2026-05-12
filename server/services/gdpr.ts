/**
 * Daily GDPR purge orchestrator.
 *
 * Sequence: archive-and-verify (throws on chain break) → daily-stats
 * aggregate (read-only, returns filesToDelete) → cascade (transactional
 * delete + audit anonymization) → satellite cleanups (storage delete,
 * orphan reaper, AI usage aggregate, comment nullification,
 * agent_status_log sweep) → audit_log success row.
 *
 * The chain-verify gate runs OUTSIDE the swallowing try/catch — a broken
 * chain must propagate so observability code can branch on
 * `instanceof PurgeAbortedError` / `reason.kind`. Satellite-step failures
 * are logged and swallowed; they never abort the purge.
 *
 * Public API:
 *   - runDailyPurge — the daily orchestrator (called by app.ts scheduler)
 *   - aggregateAndPurgeAiUsage — exported for test_gdpr_purge.ts
 *   - PurgeAbortedError, PurgeAbortReason — structured abort signal
 */

import { sql, lt } from 'drizzle-orm';
import { db } from '../db.js';
import config from '../config.js';
import logger from '../utils/logger.js';
import { getStorage } from './storage.js';
import { auditLog as auditLogTable, agentStatusLog } from '../db/schema.js';

import { archiveAndVerify } from './gdpr/archiveStep.js';
import { aggregateAndPurgeAiUsage } from './gdpr/aiUsage.js';
import { aggregateDailyStats } from './gdpr/dailyStatsAggregate.js';
import { cascadePurge } from './gdpr/cascade.js';

export { PurgeAbortedError, type PurgeAbortReason } from './gdpr/errors.js';
export { aggregateAndPurgeAiUsage } from './gdpr/aiUsage.js';

export async function runDailyPurge() {
  // Archive-before-purge + chain verify. MUST run outside the try/catch
  // below — a broken chain must abort the purge, not be silently swallowed.
  // Throws PurgeAbortedError on chain failure (kind = chain_broken or
  // chain_infra_error).
  await archiveAndVerify();

  try {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - config.GDPR_RETENTION_DAYS);
    const cutoffDate = cutoff.toISOString().slice(0, 10);

    // Read-only step: groups tickets into daily_stats and returns the list
    // of /uploads/* files to delete AFTER the cascade transaction commits.
    const { filesToDelete } = await aggregateDailyStats(cutoffDate);

    // Cascade: messages → ticket_labels → app_feedback → ratings.agent_id
    // nullify → tickets → audit_log.actorId nullify. Single transaction.
    await cascadePurge(cutoffDate);

    // Delete uploaded files only after the DB transaction committed — a
    // pre-commit delete would orphan storage if the transaction rolled back.
    if (filesToDelete.length > 0) {
      const storage = getStorage();
      for (const filename of filesToDelete) {
        await storage.delete(filename).catch(() => {});
      }
      logger.info({ filesDeleted: filesToDelete.length }, '[purge] Cleaned up uploaded files from purged messages');
    }

    // Sweep abandoned uploads — blobs that were uploaded via /api/v1/uploads
    // but never attached to a message (user closed compose without sending).
    // The message-driven cleanup above wouldn't reach them; this is the
    // schema-less reaper. Default grace = 24h so an in-progress compose
    // session never gets its draft attachment yanked from underneath it.
    try {
      const { reapOrphanUploads } = await import('./orphanReaper.js');
      await reapOrphanUploads();
    } catch (err) {
      logger.error({ err }, '[purge] Orphan upload reaper failed (non-fatal)');
    }

    // Aggregate + purge old AI usage logs (separate retention window).
    const aiPurged = await aggregateAndPurgeAiUsage();
    if (aiPurged > 0) {
      logger.info({ aiPurged }, '[purge] AI usage log aggregate + purge complete');
    }

    // Nullify rating comments past the comment-retention window. Score +
    // support_id stay for long-term analytics; comments are PII.
    try {
      const commentCutoff = new Date(Date.now() - config.RATINGS_COMMENT_RETENTION_DAYS * 86400000).toISOString();
      const commentResult = await db.execute(sql`
        UPDATE ratings SET comment = NULL
        WHERE comment IS NOT NULL AND created_at < ${commentCutoff}
      `);
      const commentsAnonymized = (commentResult as { rowCount?: number } | undefined)?.rowCount ?? 0;
      if (commentsAnonymized > 0) {
        logger.info({ commentsAnonymized, cutoff: commentCutoff }, '[purge] Rating comments nullified past retention window');
      }
    } catch (err) {
      logger.error({ err }, '[purge] Failed to nullify rating comments');
    }

    // Purge agent status log entries older than 30 days.
    const statusCutoff = new Date(Date.now() - 30 * 86400000).toISOString();
    await db
      .delete(agentStatusLog)
      .where(lt(agentStatusLog.startedAt, statusCutoff));
    logger.info({ cutoff: statusCutoff }, '[gdpr] Purged old agent_status_log entries');

    // Success audit row.
    await db.insert(auditLogTable).values({
      action: 'system.gdpr_purge',
      actorId: null,
      targetType: 'system',
      metadata: { cutoffDate, aiUsagePurged: aiPurged, success: true },
    });

    logger.info(`[purge] GDPR purge complete for data older than ${cutoffDate}.`);
  } catch (err) {
    logger.error({ err }, '[purge] Error during daily purge');
  }
}
