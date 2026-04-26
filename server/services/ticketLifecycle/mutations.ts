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

interface PartnerDepartment {
  id: string;
  name: string;
  description?: string;
}

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
 * Read the lifecycle slice for `lifecycle.close`'s preflight: existence,
 * tenant, status, and the support assignment (used to decide
 * `hadSupport` in the audit metadata + the ticket:closed payload).
 */
export async function readForClose(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  exec: any,
  args: { ticketId: string; partnerId: string },
): Promise<{ status: string; agentId: string; supportId: string | null; supportName: string | null } | null> {
  const res = await exec.execute(sql`SELECT status, agent_id, support_id, support_name FROM tickets
    WHERE id = ${args.ticketId} AND partner_id = ${args.partnerId}`);
  const rows = (res.rows ?? res) as Array<{ status: string; agent_id: string; support_id: string | null; support_name: string | null }>;
  if (!rows[0]) return null;
  return {
    status: rows[0].status,
    agentId: rows[0].agent_id,
    supportId: rows[0].support_id,
    supportName: rows[0].support_name,
  };
}

/**
 * Atomically close a ticket. Sets status='closed' + closed_at +
 * closed_by + closing_notes. Returns the closed_at timestamp so the
 * orchestrator can include it in the post-commit emit.
 */
export async function closeTicketTx(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  tx: any,
  args: { ticketId: string; closedBy: string; closingNotes: string },
): Promise<{ closedAt: string }> {
  const closedAt = new Date().toISOString();
  await tx.execute(sql`UPDATE tickets SET
    status = 'closed',
    closed_at = ${closedAt},
    closed_by = ${args.closedBy},
    closing_notes = ${args.closingNotes}
  WHERE id = ${args.ticketId}`);
  return { closedAt };
}

/**
 * Read the partner row needed by `lifecycle.create`'s preflight:
 * status (must be 'active') + business hours schedule. Returns null
 * when the partner doesn't exist.
 */
export async function readPartnerForCreate(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  exec: any,
  args: { partnerId: string },
): Promise<{ status: string; businessHoursSchedule: unknown } | null> {
  const res = await exec.execute(sql`SELECT status, business_hours_schedule FROM partners WHERE id = ${args.partnerId}`);
  const rows = (res.rows ?? res) as Array<{ status: string; business_hours_schedule: unknown }>;
  if (!rows[0]) return null;
  return {
    status: rows[0].status,
    businessHoursSchedule: rows[0].business_hours_schedule,
  };
}

/**
 * Read the agent's open / pending tickets — the dup-ticket check.
 * Returns up to one row (we only care whether there's *any* match).
 */
export async function readActiveTicketForAgent(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  exec: any,
  args: { agentId: string; partnerId: string },
): Promise<{ id: string } | null> {
  const res = await exec.execute(sql`SELECT id FROM tickets
    WHERE agent_id = ${args.agentId}
      AND partner_id = ${args.partnerId}
      AND status != 'closed'
    LIMIT 1`);
  const rows = (res.rows ?? res) as Array<{ id: string }>;
  return rows[0] ?? null;
}

/**
 * Read recently-closed tickets in the partner — the reopen-detection
 * data source. Caller iterates and matches references in JS to keep
 * the SQL simple.
 */
export async function readRecentClosedTickets(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  exec: any,
  args: { partnerId: string; limit: number },
): Promise<Array<{ references: unknown; reopenCount: number | null }>> {
  const res = await exec.execute(sql`SELECT "references", reopen_count FROM tickets
    WHERE partner_id = ${args.partnerId} AND status = 'closed'
    ORDER BY closed_at DESC NULLS LAST
    LIMIT ${args.limit}`);
  const rows = (res.rows ?? res) as Array<{ references: unknown; reopen_count: number | null }>;
  return rows.map((r) => ({ references: r.references, reopenCount: r.reopen_count }));
}

/**
 * Insert the ticket row inside a txn. Mirrors the production-side
 * `services/ticketQueries.createTicket` helper but runs through the
 * supplied `tx` so the audit row + first message land atomically.
 */
export async function createTicketTx(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  tx: any,
  args: {
    id: string;
    partnerId: string;
    dept: string;
    agentId: string;
    agentName: string;
    agentLang: string;
    references: Array<{ label: string; value: string }>;
    createdAt: string;
    reopened: boolean;
    reopenCount: number;
  },
): Promise<void> {
  await tx.execute(sql`INSERT INTO tickets (
    id, partner_id, dept, agent_id, agent_name, agent_lang,
    "references", status, participants, reopened, reopen_count,
    created_at, updated_at, queue_entered_at
  ) VALUES (
    ${args.id}, ${args.partnerId}, ${args.dept}, ${args.agentId},
    ${args.agentName}, ${args.agentLang},
    ${JSON.stringify(args.references)}::jsonb,
    'open',
    '[]'::jsonb,
    ${args.reopened},
    ${args.reopenCount},
    ${args.createdAt}, ${args.createdAt}, ${args.createdAt}
  )`);
}

/**
 * Read the partner's `departments` JSONB. Used by `lifecycle.transfer`'s
 * preflight to validate the target department id and resolve its name
 * for the system message + audit metadata. Returns an empty array if
 * the partner row doesn't exist.
 */
export async function readPartnerDepartments(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  exec: any,
  args: { partnerId: string },
): Promise<PartnerDepartment[]> {
  const res = await exec.execute(sql`SELECT departments FROM partners WHERE id = ${args.partnerId}`);
  const rows = (res.rows ?? res) as Array<{ departments: PartnerDepartment[] | null }>;
  if (!rows[0]) return [];
  return rows[0].departments ?? [];
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
 * Read the lifecycle slice for `lifecycle.transfer`'s preflight: the
 * ticket's tenant + current support assignment (used to record
 * `fromSupportId` in the audit metadata). Returns null when the row
 * doesn't exist in the supplied tenant.
 */
export async function readForTransfer(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  exec: any,
  args: { ticketId: string; partnerId: string },
): Promise<{ supportId: string | null; status: string } | null> {
  const res = await exec.execute(sql`SELECT support_id, status FROM tickets
    WHERE id = ${args.ticketId} AND partner_id = ${args.partnerId}`);
  const rows = (res.rows ?? res) as Array<{ support_id: string | null; status: string }>;
  if (!rows[0]) return null;
  return { supportId: rows[0].support_id, status: rows[0].status };
}

/**
 * Atomically transfer a ticket to a different department. Clears the
 * support assignment, sets `status='open'`, bumps `queue_entered_at` so
 * the ticket joins the new queue at NOW() instead of jumping ahead,
 * and updates `dept`. Always succeeds — there's no race guard because
 * a transfer is the most recent intent and should win.
 */
export async function transferTicketToDepartmentTx(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  tx: any,
  args: { ticketId: string; toDepartmentId: string },
): Promise<void> {
  await tx.execute(sql`UPDATE tickets SET
    dept = ${args.toDepartmentId},
    support_id = NULL,
    support_name = NULL,
    support_lang = NULL,
    support_joined_at = NULL,
    status = 'open',
    queue_entered_at = NOW()
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
