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

import type { Participant } from './types.js';

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

/**
 * Read the current participants snapshot for a ticket. Returns null when
 * the row doesn't exist. Cheap single-row read used by `lifecycle.leave`
 * for its preflight check (is the actor a participant?). The lifecycle
 * caches the result in-flight so the txn doesn't re-read.
 */
export async function readParticipants(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  exec: any,
  args: { ticketId: string; partnerId: string },
): Promise<{ participants: Participant[]; supportId: string | null } | null> {
  const res = await exec.execute(sql`SELECT participants, support_id
    FROM tickets
    WHERE id = ${args.ticketId} AND partner_id = ${args.partnerId}`);
  const rows = (res.rows ?? res) as Array<{ participants: Participant[] | null; support_id: string | null }>;
  if (!rows[0]) return null;
  return {
    participants: rows[0].participants ?? [],
    supportId: rows[0].support_id,
  };
}

/**
 * Read the lifecycle-relevant slice of a ticket needed by `lifecycle.assign`'s
 * preflight (status check + ghost-decision context). Returns null when the
 * row doesn't exist in the supplied tenant.
 */
export async function readForAssign(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  exec: any,
  args: { ticketId: string; partnerId: string },
): Promise<{ status: string; supportId: string | null; participants: Participant[] } | null> {
  const res = await exec.execute(sql`SELECT status, support_id, participants
    FROM tickets
    WHERE id = ${args.ticketId} AND partner_id = ${args.partnerId}`);
  const rows = (res.rows ?? res) as Array<{ status: string; support_id: string | null; participants: Participant[] | null }>;
  if (!rows[0]) return null;
  return {
    status: rows[0].status,
    supportId: rows[0].support_id,
    participants: rows[0].participants ?? [],
  };
}

/**
 * Overwrites `tickets.participants` with the supplied array. Always runs;
 * no race guard. Used by `lifecycle.leave` to drop the leaver from the
 * roster.
 */
export async function writeParticipantsTx(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  tx: any,
  args: { ticketId: string; participants: Participant[] },
): Promise<void> {
  // Encode JSONB explicitly. Drizzle's `tickets.participants` is jsonb
  // with a default, but the parameter binding through `sql` template
  // doesn't auto-cast arrays — we wrap the JSON-encoded payload in
  // `::jsonb` so PG accepts it.
  await tx.execute(sql`UPDATE tickets
    SET participants = ${JSON.stringify(args.participants)}::jsonb
    WHERE id = ${args.ticketId}`);
}

/**
 * Atomically assign a support agent to a ticket. Idempotent: COALESCE
 * preserves an existing `support_id` (a concurrent claim wins; the
 * joiner becomes a secondary), and the participants merge uses JSONB
 * containment to skip the entry on a duplicate join. Sets `status='open'`
 * unconditionally — joining a closed ticket is rejected upstream.
 *
 * Returns the post-update `support_id` and `participants` so the caller
 * can decide whether the actor became primary (used in audit metadata).
 */
export async function assignSupportTx(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  tx: any,
  args: {
    ticketId: string;
    supportId: string;
    supportName: string;
    supportLang: string;
    supportIsExternal: boolean;
  },
): Promise<{ supportId: string | null; participants: Participant[] }> {
  const participantJson = JSON.stringify({
    id: args.supportId,
    name: args.supportName,
    isExternal: args.supportIsExternal,
  });
  const res = await tx.execute(sql`UPDATE tickets SET
    support_id = COALESCE(support_id, ${args.supportId}),
    support_name = COALESCE(support_name, ${args.supportName}),
    support_lang = COALESCE(support_lang, ${args.supportLang}),
    support_joined_at = COALESCE(support_joined_at, ${new Date().toISOString()}),
    participants = CASE
      WHEN NOT (COALESCE(participants, '[]'::jsonb) @> ${`[${participantJson}]`}::jsonb)
      THEN COALESCE(participants, '[]'::jsonb) || ${participantJson}::jsonb
      ELSE participants
    END,
    status = 'open'
  WHERE id = ${args.ticketId}
  RETURNING support_id, participants`);
  const rows = (res.rows ?? res) as Array<{ support_id: string | null; participants: Participant[] | null }>;
  if (!rows[0]) {
    return { supportId: null, participants: [] };
  }
  return {
    supportId: rows[0].support_id,
    participants: rows[0].participants ?? [],
  };
}
