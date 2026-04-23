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
import { db } from '../db.js';
import { auditLog, auditArchive, tickets, archivedTickets, messages } from '../db/schema.js';
import { lte, asc, desc, eq, and, inArray, sql, notExists, gt } from 'drizzle-orm';
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
  const BATCH_SIZE = 1000;
  const days = archiveDelayDays ?? config.AUDIT_ARCHIVE_DELAY_DAYS;
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);
  const cutoffStr = cutoff.toISOString();

  let totalArchived = 0;

  try {
    while (true) {
      // Fetch rows to archive (oldest first for correct chain ordering; id as tiebreaker)
      const rows = await db.select()
        .from(auditLog)
        .where(lte(auditLog.createdAt, cutoffStr))
        .orderBy(asc(auditLog.createdAt), asc(auditLog.id))
        .limit(BATCH_SIZE);

      if (rows.length === 0) break;

      // Get the last chain hash and sequence from the archive (must be re-read each batch
      // since the previous batch updated it)
      const lastArchived = await db.select({ chainHash: auditArchive.chainHash, sequence: auditArchive.sequence })
        .from(auditArchive)
        .orderBy(desc(auditArchive.sequence))
        .limit(1);
      let prevHash = lastArchived[0]?.chainHash || '0'.repeat(64); // genesis hash
      let nextSequence = (lastArchived[0]?.sequence ?? -1) + 1;

      const now = new Date().toISOString();

      // Wrap insert + delete in a single transaction to prevent partial chain states
      const archivedCount = await db.transaction(async (tx) => {
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

          const inserted = await tx.insert(auditArchive).values({
            ...rowData,
            archivedAt: now,
            chainHash,
            sequence: nextSequence,
          }).onConflictDoNothing().returning({ id: auditArchive.id });

          // Only advance the hash chain when the row was actually inserted.
          // If onConflictDoNothing skipped a duplicate, returned array is empty.
          if (inserted.length > 0) {
            prevHash = chainHash;
            nextSequence++;
          }
          archivedIds.push(row.id);
        }

        // Delete archived entries from the live table (same transaction)
        if (archivedIds.length > 0) {
          await tx.delete(auditLog).where(inArray(auditLog.id, archivedIds));
        }

        return archivedIds.length;
      });

      totalArchived += archivedCount;

      if (rows.length < BATCH_SIZE) break;
    }

    logger.info({ count: totalArchived, cutoff: cutoffStr, delayDays: days }, '[archive] Audit log entries archived');
    return totalArchived;
  } catch (err) {
    logger.error({ err }, '[archive] Failed to archive audit log');
    return totalArchived;
  }
}

/**
 * Verify the integrity of the audit archive hash chain.
 * Returns { valid: boolean; brokenAt?: string } where brokenAt is the id of the
 * first entry with a mismatched hash.
 */
const VERIFY_BATCH_SIZE = 10_000;

export interface VerifyAuditChainResult {
  valid: boolean;
  /** Total rows walked across the archive (global, always full-scan). */
  checked: number;
  /** Rows belonging to `options.partnerId` walked during this run. Present only when a partner filter was passed. */
  partnerChecked?: number;
  /** First row id whose recomputed hash did not match the stored `chain_hash`. */
  brokenAt?: string;
  /** Partner id attached to the broken row (null when it was a global/system row). Only populated when `options.partnerId` is passed. */
  brokenPartnerId?: string | null;
  /** `true` when the broken row belongs to the partner filter. Only populated when `options.partnerId` is passed. */
  brokenInPartnerScope?: boolean;
  /** Sentinel set on infrastructure failures (db read timeout, etc) — distinct from an actual tamper. */
  error?: string;
}

/**
 * Verify the hash chain over audit_archive.
 *
 * The chain is global (one monotonic sequence across all tenants) so the walk
 * itself is always global — partner isolation at the row level cannot be
 * checked in isolation. When `options.partnerId` is passed, the result carries
 * extra partner-scoped counters (`partnerChecked`, `brokenInPartnerScope`) so
 * a tenant admin can see "my rows were verified and the chain was intact" or
 * "the chain broke — here's whether the break lives in my slice".
 */
export async function verifyAuditChain(options?: { partnerId?: string }): Promise<VerifyAuditChainResult> {
  try {
    let prevHash = '0'.repeat(64);
    let checked = 0;
    let partnerChecked = 0;
    let lastSequence = -1;

    while (true) {
      const rows = await db.select()
        .from(auditArchive)
        .where(gt(auditArchive.sequence, lastSequence))
        .orderBy(asc(auditArchive.sequence))
        .limit(VERIFY_BATCH_SIZE);

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
        const rowBelongsToPartner = options?.partnerId && row.partnerId === options.partnerId;
        if (rowBelongsToPartner) partnerChecked++;

        if (expected !== row.chainHash) {
          logger.warn({ id: row.id, expected, actual: row.chainHash }, '[archive] Hash chain integrity violation');
          const out: VerifyAuditChainResult = { valid: false, checked, brokenAt: row.id };
          if (options?.partnerId) {
            out.partnerChecked = partnerChecked;
            out.brokenPartnerId = row.partnerId ?? null;
            out.brokenInPartnerScope = row.partnerId === options.partnerId;
          }
          return out;
        }

        prevHash = row.chainHash;
        lastSequence = row.sequence;
      }

      if (rows.length < VERIFY_BATCH_SIZE) {
        break;
      }
    }

    logger.info({ checked, partnerId: options?.partnerId }, '[archive] Hash chain verified OK');
    const out: VerifyAuditChainResult = { valid: true, checked };
    if (options?.partnerId) out.partnerChecked = partnerChecked;
    return out;
  } catch (err) {
    logger.error({ err }, '[archive] Failed to verify audit chain (infrastructure error, not a tamper event)');
    return { valid: false, checked: 0, error: 'verification_failed' };
  }
}

// ─── Ticket Archiving ────────────────────────────────────────────────────────

/**
 * Snapshot a single ticket into archived_tickets immediately (on close/resolve).
 * Idempotent via onConflictDoNothing. Leaves the live row + messages in place —
 * the scheduled archive/GDPR job handles eventual deletion after retention.
 *
 * The read (ticket + messageCount) and write (archive insert) run in a single
 * transaction so the snapshot reflects a consistent point-in-time view. Without
 * this, a concurrent message insert between the count and the archive write
 * would produce a snapshot with the wrong messageCount.
 */
export async function snapshotTicketToArchive(ticketId: string): Promise<void> {
  await db.transaction(async (tx) => {
    const rows = await tx.select().from(tickets).where(eq(tickets.id, ticketId)).limit(1);
    const ticket = rows[0];
    if (!ticket) return;
    if (ticket.status !== 'closed') return;

    const [countRow] = await tx.select({ count: sql<number>`count(*)` })
      .from(messages)
      .where(eq(messages.ticketId, ticketId));

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
      messageCount: Number(countRow?.count ?? 0),
      references: ticket.references ?? [],
      archivedAt: new Date().toISOString(),
    }).onConflictDoNothing();
  });
}

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
        notExists(
          db.select({ id: archivedTickets.id })
            .from(archivedTickets)
            .where(eq(archivedTickets.id, tickets.id))
        ),
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

    await db.transaction(async (tx) => {
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
          references: ticket.references ?? [],
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
