/**
 * Implementation of `lifecycle.close()`. Atomically closes a ticket and
 * writes the `ticket.closed` audit row in a single transaction.
 *
 * Authorization: support / admin / platform_operator can close any
 * ticket; agents can close their own. Idempotent: re-closing returns
 * `TICKET_ALREADY_CLOSED` rather than rewriting state.
 *
 * Post-commit fire-and-forget: the legacy archive snapshot
 * (`snapshotTicketToArchive`) runs after the txn commits to keep the
 * archive view current. Failures are logged but never thrown.
 */
import { Rooms } from '../../utils/rooms.js';
import { MAX_NOTE_LENGTH } from '../../constants.js';
import { snapshotTicketToArchive } from '../archive.js';
import logger from '../../utils/logger.js';
import { writeAudit } from './audit.js';
import { closeTicketTx, readForClose } from './mutations.js';
import type {
  CloseArgs,
  CloseOk,
  Effect,
  LifecycleDb,
  Result,
} from './types.js';

export interface CloseDeps {
  db: LifecycleDb;
}

export async function runClose(
  deps: CloseDeps,
  args: CloseArgs,
): Promise<Result<CloseOk>> {
  const snapshot = await readForClose(deps.db, {
    ticketId: args.ticketId,
    partnerId: args.partnerId,
  });
  if (!snapshot) {
    return { ok: false, code: 'TICKET_NOT_FOUND' };
  }

  // Authorization: support / admin / platform_operator OR the owning agent.
  if (!args.actor.isSupport && snapshot.agentId !== args.actor.id) {
    return { ok: false, code: 'NOT_AUTHORIZED' };
  }

  if (snapshot.status === 'closed') {
    return { ok: false, code: 'TICKET_ALREADY_CLOSED' };
  }

  const closingNotes = (args.closingNotes ?? '').slice(0, MAX_NOTE_LENGTH);
  const closedBy = args.actor.name || 'System';
  let closedAt = '';

  await deps.db.transaction(async (tx) => {
    const out = await closeTicketTx(tx, {
      ticketId: args.ticketId,
      closedBy,
      closingNotes,
    });
    closedAt = out.closedAt;

    await writeAudit(tx, {
      action: 'ticket.closed',
      ticketId: args.ticketId,
      partnerId: args.partnerId,
      actor: args.actor,
      metadata: {
        closedBy,
        hadSupport: !!snapshot.supportId,
      },
    });
  });

  // Fire-and-forget archive snapshot — preserves legacy behavior of the
  // public `closeTicket` helper. Out of scope for transactional rollback.
  snapshotTicketToArchive(args.ticketId).catch((err: unknown) => {
    logger.error(
      { err, ticketId: args.ticketId },
      '[lifecycle.close] snapshotTicketToArchive failed',
    );
  });

  const effects: Effect[] = [
    {
      type: 'emit',
      rooms: [Rooms.ticket(args.ticketId)],
      event: 'ticket:closed',
      payload: {
        ticketId: args.ticketId,
        status: 'closed',
        closedAt,
        closedBy,
        supportId: snapshot.supportId ?? undefined,
        supportName: snapshot.supportName ?? undefined,
      },
    },
    { type: 'broadcastQueue', partnerId: args.partnerId },
  ];

  return {
    ok: true,
    data: {
      closedAt,
      closedBy,
      hadSupport: !!snapshot.supportId,
      supportId: snapshot.supportId,
      supportName: snapshot.supportName,
    },
    effects,
  };
}
