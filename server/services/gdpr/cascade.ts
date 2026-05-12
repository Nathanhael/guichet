/**
 * Cascade step of the daily GDPR purge.
 *
 * One transaction. Captures actor IDs from purgeable tickets BEFORE the
 * DELETE — the audit-log anonymization runs on those IDs after the source
 * rows are gone (CR-02 / source-rows-already-deleted hole).
 *
 * Order matters: messages → ticket_labels → app_feedback → anonymize
 * ratings.agent_id → tickets → audit_log.actorId. Reorder this and the
 * audit anonymization stops seeing the right actor IDs (and the GDPR
 * boundary tests in gdpr.test.ts catch it).
 *
 * audit_archive is NEVER touched — it is WORM with a SHA-256 chain over
 * actor_id, so any UPDATE breaks verifyAuditChain() and self-blocks the
 * next purge run. PII retention in audit_archive is a deliberate trade-off
 * (see docs/AUDIT_RUNBOOK.md "audit_archive — Indefinite, never purged").
 */

import { and, inArray, lt, sql } from 'drizzle-orm';
import { db } from '../../db.js';
import logger from '../../utils/logger.js';
import { auditLog as auditLogTable } from '../../db/schema.js';

export async function cascadePurge(cutoffDate: string): Promise<void> {
  await db.transaction(async (tx) => {
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
      .map((r) => r.actor_id)
      .filter((id): id is string => !!id);

    // Open/pending tickets are never purged to prevent data loss.
    await tx.execute(sql`DELETE FROM messages WHERE ticket_id IN (SELECT id FROM tickets WHERE created_at < ${cutoffDate} AND status = 'closed')`);
    await tx.execute(sql`DELETE FROM ticket_labels WHERE ticket_id IN (SELECT id FROM tickets WHERE created_at < ${cutoffDate} AND status = 'closed')`);
    await tx.execute(sql`DELETE FROM app_feedback WHERE created_at < ${cutoffDate}`);
    // Ratings outlive tickets: the ticket FK is set to NULL via ON DELETE SET NULL.
    // agent_id is dropped because it ties a rating to a named customer past the
    // 30d ticket retention window. support_id is kept for coaching analytics;
    // comments (PII) are nullified on a separate schedule outside this cascade.
    await tx.execute(sql`
      UPDATE ratings SET agent_id = NULL
      WHERE ticket_id IN (SELECT id FROM tickets WHERE created_at < ${cutoffDate} AND status = 'closed')
    `);
    await tx.execute(sql`DELETE FROM tickets WHERE created_at < ${cutoffDate} AND status = 'closed'`);

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

    logger.info(
      { auditAnonymized, purgedActorCount: purgedActorIds.length, cutoffDate },
      '[purge] audit_log actorIds anonymized; audit_archive intentionally untouched (WORM)',
    );
  });
}
