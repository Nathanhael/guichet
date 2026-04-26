/**
 * Private: writes the audit row for a lifecycle op INSIDE the same Postgres
 * transaction as the mutation. A failure here rolls back the whole event —
 * the audit row and the user-observable state can never disagree. This is
 * the intentional behavior change in the deepening: the old `ticketAudit.ts`
 * module's fire-and-forget `void writeTicketAudit(...)` left the door open
 * for invisible audit gaps. The lifecycle closes that door.
 */
import { auditLog } from '../../db/schema.js';
import { ticketAuditEventsTotal } from '../../utils/metrics.js';
import type { Actor } from './types.js';

type AuditAction =
  | 'ticket.reclaimed'
  | 'ticket.left'
  | 'ticket.returned_to_queue';

interface WriteAuditArgs {
  action: AuditAction;
  ticketId: string;
  partnerId: string;
  actor: Actor;
  metadata: Record<string, unknown>;
}

/**
 * Write a ticket-lifecycle audit row inside the supplied transaction. The
 * caller is expected to be inside a `db.transaction(...)` callback — passing
 * `tx` instead of `db` is what makes the write transactional.
 *
 * `actorId` is null for the system actor (boot-time sweeps); the WORM chain
 * tolerates null actors by design.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function writeAudit(tx: any, args: WriteAuditArgs): Promise<void> {
  // Increment Prometheus first so the user-observable graph reflects reality
  // even if we crash on the insert. Existing alert rules
  // (TicketAuditEmitterSilenced, AuditChainStaleness) observe this metric.
  ticketAuditEventsTotal.inc({ action: args.action });

  await tx.insert(auditLog).values({
    action: args.action,
    actorId: args.actor.kind === 'user' ? args.actor.id : null,
    partnerId: args.partnerId,
    targetType: 'ticket',
    targetId: args.ticketId,
    metadata: args.metadata,
  });
}
