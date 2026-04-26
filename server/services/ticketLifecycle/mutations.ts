/**
 * Private: ticket-row mutations executed INSIDE the lifecycle transaction.
 * In PR 6 the corresponding public helpers in `services/ticketQueries.ts`
 * (`returnTicketToQueue` etc.) are deleted; until then they continue to
 * exist for the call sites that haven't been migrated yet. The lifecycle
 * uses these private versions so the surrounding txn semantics are honored.
 *
 * Read-side helpers (`findTicketForJoin/Close/Transfer/Participants/...`)
 * stay shared in `ticketQueries.ts` because `partnerScope` guards depend on
 * them. Only the *mutation* slice is being absorbed.
 */
import { sql } from 'drizzle-orm';

interface ReturnToQueueResult {
  /** False = race lost; the ticket is now owned by someone else. */
  ok: boolean;
}

/**
 * Atomically clear the support assignment, re-open the ticket, and bump
 * `queue_entered_at` so the ticket re-enters the queue at the tail rather
 * than retaining a stale head-of-queue position. Guarded by the previous
 * `support_id` so a concurrent claim wins the race.
 *
 * Also strips the outgoing support out of the `participants` JSONB array
 * so a stale `support:rejoin` from that user can't re-enter after reclaim.
 */
export async function returnTicketToQueueTx(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  tx: any,
  args: { ticketId: string; previousSupportId: string },
): Promise<ReturnToQueueResult> {
  const res = await tx.execute(sql`UPDATE tickets SET
    support_id = NULL,
    support_name = NULL,
    support_joined_at = NULL,
    status = 'open',
    queue_entered_at = NOW(),
    participants = (
      SELECT COALESCE(jsonb_agg(elem), '[]'::jsonb)
      FROM jsonb_array_elements(COALESCE(participants, '[]')::jsonb) AS elem
      WHERE elem->>'id' != ${args.previousSupportId}
    )
  WHERE id = ${args.ticketId} AND support_id = ${args.previousSupportId}`);
  // node-postgres exposes `rowCount`; PGLite exposes `affectedRows`. Drizzle
  // forwards both shapes through unchanged, so we read whichever the
  // substrate provides. A null/undefined on both means the substrate didn't
  // tell us — treat as zero (safer than assuming success).
  const r = res as { rowCount?: number | null; affectedRows?: number | null };
  const rowCount = r.rowCount ?? r.affectedRows ?? 0;
  return { ok: rowCount > 0 };
}
