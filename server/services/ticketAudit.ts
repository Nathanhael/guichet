/**
 * Ticket lifecycle audit emitters. Every function is fire-and-forget: failures
 * are logged but never thrown, so a broken audit writer can't block the user-
 * facing action (ticket create, close, transfer, etc).
 *
 * All rows share `targetType='ticket'` + `targetId=ticketId` so the ticket
 * audit drawer (TicketAuditDrawer) can surface them without needing to fall
 * back to the metadata.ticketId path.
 */

import { db } from '../db.js';
import { auditLog } from '../db/schema.js';
import logger from '../utils/logger.js';
import { ticketAuditEventsTotal } from '../utils/metrics.js';

interface BaseArgs {
  ticketId: string;
  partnerId: string;
  actorId: string | null;
}

async function writeTicketAudit(
  action: string,
  args: BaseArgs,
  metadata: Record<string, unknown>,
) {
  // Increment the Prometheus counter first. Even if the DB write fails below,
  // the metric reflects the fact that the lifecycle transition happened — the
  // grafana graph should match user-observable reality, not the audit-log
  // success rate. A separate error counter would be needed if we wanted to
  // alert on audit-write failures; for now the logger.error is sufficient.
  ticketAuditEventsTotal.inc({ action });
  try {
    await db.insert(auditLog).values({
      action,
      actorId: args.actorId,
      partnerId: args.partnerId,
      targetType: 'ticket',
      targetId: args.ticketId,
      metadata,
    });
  } catch (err) {
    logger.error({ err, action, ticketId: args.ticketId }, '[ticketAudit] write failed');
  }
}

export function auditTicketCreated(
  args: BaseArgs & { dept: string; reopened: boolean; reopenCount: number },
) {
  const action = args.reopened ? 'ticket.reopened' : 'ticket.created';
  void writeTicketAudit(action, args, {
    dept: args.dept,
    reopenCount: args.reopenCount,
  });
}

export function auditTicketClosed(
  args: BaseArgs & { closedBy: string; hadSupport: boolean },
) {
  void writeTicketAudit('ticket.closed', args, {
    closedBy: args.closedBy,
    hadSupport: args.hadSupport,
  });
}

export function auditTicketAssigned(
  args: BaseArgs & { supportId: string; supportName: string },
) {
  void writeTicketAudit('ticket.assigned', args, {
    supportId: args.supportId,
    supportName: args.supportName,
  });
}

export function auditTicketTransferred(
  args: BaseArgs & {
    toDepartmentId: string | null;
    toDepartmentName: string | null;
    fromSupportId: string | null;
    note?: string;
  },
) {
  void writeTicketAudit('ticket.transferred', args, {
    toDepartmentId: args.toDepartmentId,
    toDepartmentName: args.toDepartmentName,
    fromSupportId: args.fromSupportId,
    hasNote: !!args.note,
  });
}

export function auditTicketReturnedToQueue(
  args: BaseArgs & { fromSupportId: string | null },
) {
  void writeTicketAudit('ticket.returned_to_queue', args, {
    fromSupportId: args.fromSupportId,
  });
}
