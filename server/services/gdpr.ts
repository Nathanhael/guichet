/**
 * Daily GDPR purge orchestrator.
 *
 * Sequence: archive-and-verify (throws on chain break) → cascade
 * (transactional delete + audit anonymization) → satellite cleanups
 * (storage delete, orphan reaper, AI usage aggregate, comment nullification,
 * agent_status_log sweep, invite purge) → audit_log success row.
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

import { db } from '../db.js';
import { sql, inArray, and, eq, lt, gte } from 'drizzle-orm';
import config from '../config.js';
import logger from '../utils/logger.js';
import { getStorage } from './storage.js';
import { computeLiveDayStats } from './stats.js';
import { Ticket, Rating, Message } from '../types/index.js';
import { archiveTickets } from './archive.js';
import {
  tickets,
  ratings as ratingsTable,
  messages as messagesTable,
  auditLog as auditLogTable,
  dailyStats,
  archivedTickets,
  agentStatusLog,
} from '../db/schema.js';

import { archiveAndVerify } from './gdpr/archiveStep.js';
import { aggregateAndPurgeAiUsage } from './gdpr/aiUsage.js';

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

    // Guard: check if there are closed tickets that haven't been archived yet.
    // The old guard relied on the archiveTickets return value being non-zero, which
    // is false on day 2+ when tickets were already archived in a prior run — causing
    // all subsequent purge runs to be silently skipped and GDPR data retained indefinitely.
    const unarchivedRows = await db.execute(sql`
      SELECT COUNT(*)::int as count FROM ${tickets}
      WHERE ${tickets.createdAt} < ${cutoff.toISOString()} AND ${tickets.status} = 'closed'
      AND NOT EXISTS (SELECT 1 FROM ${archivedTickets} WHERE ${archivedTickets.id} = ${tickets.id})
    `);
    const unarchivedCount = (unarchivedRows.rows as unknown as { count: number }[])[0]?.count ?? 0;

    if (unarchivedCount > 0) {
      logger.warn({ unarchivedCount }, '[purge] Unarchived closed tickets exist — archiving first');
      await archiveTickets();
    }

    // Optimized: single query fetches all tickets in the retention window grouped by
    // (date, partner_id), replacing the previous O(dates × partners) nested loop.
    // We fetch all tickets + ratings + messages in 3 bulk queries, then group in-memory.
    const windowEnd = cutoffDate;
    const windowStart = '1970-01-01'; // aggregate everything older than cutoff

    const filesToDelete: string[] = [];

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

        const stats = computeLiveDayStats(dayTickets, dayRatings, 'all');

        const avgResponseMs = stats.responseCount > 0 ? Math.round(stats.responseSum / stats.responseCount) : 0;
        const avgDurationMs = stats.durationCount > 0 ? Math.round(stats.durationSum / stats.durationCount) : 0;
        const avgRating = stats.ratingCount > 0 ? Math.round((stats.ratingSum / stats.ratingCount) * 10) / 10 : null;

        const row = {
          date, partnerId,
          total: stats.total, closed: stats.closed, abandoned: stats.abandoned, reopened: stats.reopened,
          avgResponseMs, avgDurationMs, avgRating,
          ratingCount: stats.ratingCount,
          p95ResponseMs: stats.p95ResponseMs,
          deptCounts: stats.deptCounts, ratingsByDept: stats.ratingsByDept, hourly: stats.hourly,
        };

        await db.insert(dailyStats).values(row).onConflictDoUpdate({
          target: [dailyStats.date, dailyStats.partnerId],
          set: {
            total: sql`EXCLUDED.total`, closed: sql`EXCLUDED.closed`,
            abandoned: sql`EXCLUDED.abandoned`, reopened: sql`EXCLUDED.reopened`,
            avgResponseMs: sql`EXCLUDED.avg_response_ms`, avgDurationMs: sql`EXCLUDED.avg_duration_ms`,
            avgRating: sql`EXCLUDED.avg_rating`, ratingCount: sql`EXCLUDED.rating_count`,
            p95ResponseMs: sql`EXCLUDED.p95_response_ms`,
            deptCounts: sql`EXCLUDED.dept_counts`,
            ratingsByDept: sql`EXCLUDED.ratings_by_dept`, hourly: sql`EXCLUDED.hourly`,
          },
        });
      }

      // Collect filenames to delete AFTER the DB transaction commits.
      // Deleting before commit risks orphaning data if the transaction fails.
      for (const msg of allMessages) {
        if (msg.mediaUrl && msg.mediaUrl.startsWith('/uploads/')) {
          filesToDelete.push(msg.mediaUrl.replace(/^\/uploads\//, ''));
        }
        const rawAtt = (msg as unknown as Record<string, unknown>).attachments;
        const attachments: Array<{ url: string }> = Array.isArray(rawAtt)
          ? rawAtt
          : typeof rawAtt === 'string' ? (() => { try { return JSON.parse(rawAtt); } catch { return []; } })() : [];
        for (const att of attachments) {
          if (att.url?.startsWith('/uploads/')) {
            filesToDelete.push(att.url.replace(/^\/uploads\//, ''));
          }
        }
      }
    }

    await db.transaction(async (tx) => {
      // Capture actor IDs from purgeable tickets BEFORE the DELETE — otherwise
      // the post-delete subqueries return ∅ and the audit_log UPDATE silently
      // no-ops. (CR-02 only fixed the NULL-array case; the source-rows-already-
      // deleted case was the actual hole found by gdpr.test integration test.)
      const actorIdsResult = await tx.execute(sql`
        SELECT DISTINCT actor_id FROM (
          SELECT agent_id AS actor_id FROM tickets
            WHERE created_at < ${cutoffDate} AND status = 'closed' AND agent_id IS NOT NULL
          UNION
          SELECT support_id AS actor_id FROM tickets
            WHERE created_at < ${cutoffDate} AND status = 'closed' AND support_id IS NOT NULL
        ) ids
      `);
      const purgedActorIds = ((actorIdsResult.rows as unknown as { actor_id: string | null }[]) ?? [])
        .map(r => r.actor_id)
        .filter((id): id is string => !!id);

      // Only delete tickets that are closed (and thus have been archived above).
      // Open/pending tickets are never purged to prevent data loss.
      await tx.execute(sql`DELETE FROM messages WHERE ticket_id IN (SELECT id FROM tickets WHERE created_at < ${cutoffDate} AND status = 'closed')`);
      // Ratings outlive tickets: the ticket FK is set to NULL via ON DELETE SET NULL so
      // score + support_id stay for long-term trend analysis. Comments (PII) are
      // nullified on a separate schedule below.
      await tx.execute(sql`DELETE FROM ticket_labels WHERE ticket_id IN (SELECT id FROM tickets WHERE created_at < ${cutoffDate} AND status = 'closed')`);
      // Purge app_feedback older than retention period (GDPR compliance)
      await tx.execute(sql`DELETE FROM app_feedback WHERE created_at < ${cutoffDate}`);
      // Anonymize the customer (agent) link on ratings whose ticket is about
      // to be purged. support_id is kept forever for coaching / team analytics;
      // agent_id is dropped since it ties a rating to a named customer past
      // the 30d ticket retention window.
      await tx.execute(sql`
        UPDATE ratings SET agent_id = NULL
        WHERE ticket_id IN (SELECT id FROM tickets WHERE created_at < ${cutoffDate} AND status = 'closed')
      `);
      await tx.execute(sql`DELETE FROM tickets WHERE created_at < ${cutoffDate} AND status = 'closed'`);

      // Anonymize audit_log using captured actor IDs. audit_archive is NOT touched —
      // it is WORM with a SHA-256 chain over actor_id, so any UPDATE breaks
      // verifyAuditChain() and self-blocks the next purge run. PII retention in
      // audit_archive is a deliberate trade-off (see docs/AUDIT_RUNBOOK.md
      // "audit_archive — Indefinite, never purged"). Long-term resolution is
      // tracked in wiki decisions/guichet-audit-archive-redaction-design.
      let auditAnonymized = 0;
      if (purgedActorIds.length > 0) {
        const auditResult = await tx.update(auditLogTable)
          .set({ actorId: null })
          .where(and(
            inArray(auditLogTable.actorId, purgedActorIds),
            lt(auditLogTable.createdAt, cutoffDate),
          ));
        auditAnonymized = (auditResult as unknown as { rowCount?: number }).rowCount ?? 0;
      }

      logger.info({ auditAnonymized, purgedActorCount: purgedActorIds.length, cutoffDate }, '[purge] audit_log actorIds anonymized; audit_archive intentionally untouched (WORM)');
    });

    // Delete uploaded files only after DB transaction committed successfully.
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

    // Step 3: Aggregate and purge old AI usage logs (separate retention window)
    const aiPurged = await aggregateAndPurgeAiUsage();
    if (aiPurged > 0) {
      logger.info({ aiPurged }, '[purge] AI usage log aggregate + purge complete');
    }

    // Step 3.5: Nullify rating comments past the comment-retention window.
    // The score + support_id remain for long-term analytics; comments are PII.
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

    // Purge agent status log entries older than 30 days
    const statusCutoff = new Date(Date.now() - 30 * 86400000).toISOString();
    await db
      .delete(agentStatusLog)
      .where(lt(agentStatusLog.startedAt, statusCutoff));
    logger.info({ cutoff: statusCutoff }, '[gdpr] Purged old agent_status_log entries');

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
