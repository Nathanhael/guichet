/**
 * WORM Audit Archive & Ticket Archiving Service
 *
 * - archiveAuditLog(): Moves audit entries older than threshold into audit_archive
 *   with a tamper-evident SHA-256 hash chain.
 * - archiveTickets(): Moves closed tickets older than threshold into archived_tickets
 *   before GDPR purge deletes the originals.
 *
 * Both are designed to be called from a scheduled job (cron or the existing purge).
 */

import crypto from 'crypto';
import { db, transaction } from '../db.js';
import { auditLog, auditArchive, tickets, archivedTickets, messages } from '../db/schema.js';
import { lte, asc, desc, eq, and, inArray, sql } from 'drizzle-orm';
import logger from '../utils/logger.js';
import config from '../config.js';

// ─── WORM Audit Archive ─────────────────────────────────────────────────────

/**
 * Compute the hash chain value for a new archive entry.
 * chain_hash = SHA-256( previousChainHash + JSON(rowData) )
 */
function computeChainHash(previousHash: string, rowData: Record<string, unknown>): string {
  const payload = previousHash + JSON.stringify(rowData);
  return crypto.createHash('sha256').update(payload).digest('hex');
}

/**
 * Archive audit log entries older than `archiveDelayDays` into the WORM audit_archive table.
 * Uses AUDIT_ARCHIVE_DELAY_DAYS (default 2) — decoupled from GDPR retention to minimize
 * the tamper window where audit entries are mutable in the live table.
 * The entire operation is wrapped in a transaction to prevent partial chain states on crash.
 * Returns the count of archived rows.
 */
export async function archiveAuditLog(archiveDelayDays?: number): Promise<number> {
  const days = archiveDelayDays ?? config.AUDIT_ARCHIVE_DELAY_DAYS;
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);
  const cutoffStr = cutoff.toISOString();

  try {
    // Fetch rows to archive (oldest first for correct chain ordering; id as tiebreaker)
    const rows = await db.select()
      .from(auditLog)
      .where(lte(auditLog.createdAt, cutoffStr))
      .orderBy(asc(auditLog.createdAt), asc(auditLog.id))
      .limit(1000); // batch size

    if (rows.length === 0) return 0;

    // Get the last chain hash from the archive (same order as write path)
    const lastArchived = await db.select({ chainHash: auditArchive.chainHash })
      .from(auditArchive)
      .orderBy(desc(auditArchive.archivedAt), desc(auditArchive.id))
      .limit(1);
    let prevHash = lastArchived[0]?.chainHash || '0'.repeat(64); // genesis hash

    const now = new Date().toISOString();

    // Wrap insert + delete in a single transaction to prevent partial chain states
    const archivedCount = await transaction(async (tx) => {
      const archivedIds: string[] = [];

      for (const row of rows) {
        const rowData = {
          id: row.id,
          action: row.action,
          actorId: row.actorId,
          partnerId: row.partnerId,
          targetType: row.targetType,
          targetId: row.targetId,
          metadata: row.metadata,
          createdAt: row.createdAt,
        };

        const chainHash = computeChainHash(prevHash, rowData);

        await tx.insert(auditArchive).values({
          ...rowData,
          archivedAt: now,
          chainHash,
        }).onConflictDoNothing(); // idempotent — skip if already archived

        prevHash = chainHash;
        archivedIds.push(row.id);
      }

      // Delete archived entries from the live table (same transaction)
      if (archivedIds.length > 0) {
        await tx.delete(auditLog).where(inArray(auditLog.id, archivedIds));
      }

      return archivedIds.length;
    });

    logger.info({ count: archivedCount, cutoff: cutoffStr, delayDays: days }, '[archive] Audit log entries archived');
    return archivedCount;
  } catch (err) {
    logger.error({ err }, '[archive] Failed to archive audit log');
    return 0;
  }
}

/**
 * Verify the integrity of the audit archive hash chain.
 * Returns { valid: boolean; brokenAt?: string } where brokenAt is the id of the
 * first entry with a mismatched hash.
 */
export async function verifyAuditChain(): Promise<{ valid: boolean; checked: number; brokenAt?: string }> {
  try {
    const rows = await db.select()
      .from(auditArchive)
      .orderBy(asc(auditArchive.archivedAt), asc(auditArchive.id));

    let prevHash = '0'.repeat(64);
    let checked = 0;

    for (const row of rows) {
      const rowData = {
        id: row.id,
        action: row.action,
        actorId: row.actorId,
        partnerId: row.partnerId,
        targetType: row.targetType,
        targetId: row.targetId,
        metadata: row.metadata,
        createdAt: row.createdAt,
      };

      const expected = computeChainHash(prevHash, rowData);
      checked++;

      if (expected !== row.chainHash) {
        logger.warn({ id: row.id, expected, actual: row.chainHash }, '[archive] Hash chain integrity violation');
        return { valid: false, checked, brokenAt: row.id };
      }

      prevHash = row.chainHash;
    }

    logger.info({ checked }, '[archive] Hash chain verified OK');
    return { valid: true, checked };
  } catch (err) {
    logger.error({ err }, '[archive] Failed to verify audit chain');
    return { valid: false, checked: 0 };
  }
}

// ─── Ticket Archiving ────────────────────────────────────────────────────────

/**
 * Archive closed tickets older than `retentionDays` into archived_tickets.
 * Stores summary metadata (no messages — those are purged by GDPR).
 * Returns the count of archived tickets.
 */
export async function archiveTickets(retentionDays?: number): Promise<number> {
  const days = retentionDays ?? config.GDPR_RETENTION_DAYS;
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);
  const cutoffStr = cutoff.toISOString().slice(0, 10); // date only

  try {
    // Find closed tickets older than cutoff that aren't already archived
    const rows = await db.select()
      .from(tickets)
      .where(and(
        lte(tickets.createdAt, cutoffStr),
        eq(tickets.status, 'closed'),
      ))
      .limit(1000);

    if (rows.length === 0) return 0;

    const ticketIds = rows.map(t => t.id);

    // Count messages per ticket for the summary
    const msgCounts = await db.select({
      ticketId: messages.ticketId,
      count: sql<number>`count(*)`,
    })
      .from(messages)
      .where(inArray(messages.ticketId, ticketIds))
      .groupBy(messages.ticketId);

    const msgCountMap = new Map(msgCounts.map(m => [m.ticketId, Number(m.count)]));
    const now = new Date().toISOString();

    await transaction(async (tx) => {
      for (const ticket of rows) {
        await tx.insert(archivedTickets).values({
          id: ticket.id,
          partnerId: ticket.partnerId,
          dept: ticket.dept,
          agentId: ticket.agentId ?? undefined,
          supportId: ticket.supportId ?? undefined,
          status: ticket.status ?? 'closed',
          createdAt: ticket.createdAt,
          closedAt: ticket.closedAt ?? undefined,
          closedBy: ticket.closedBy ?? undefined,
          closingNotes: ticket.closingNotes ?? undefined,
          reopenCount: ticket.reopenCount ?? 0,
          messageCount: msgCountMap.get(ticket.id) ?? 0,
          archivedAt: now,
        }).onConflictDoNothing();
      }
    });

    logger.info({ count: rows.length, cutoff: cutoffStr }, '[archive] Tickets archived');
    return rows.length;
  } catch (err) {
    logger.error({ err }, '[archive] Failed to archive tickets');
    return 0;
  }
}
