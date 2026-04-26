/**
 * Implementation of `lifecycle.returnToQueue()`. Atomically clears the
 * support assignment, optionally inserts a caller-supplied system message,
 * and writes the `ticket.returned_to_queue` audit row.
 *
 * Used by transfer-same-department and ghost-heal in support:join. Those
 * call sites migrate in PR 3 and PR 4 respectively; PR 2 ships the verb
 * (with full test coverage) so the next PRs can call it without re-doing
 * the orchestration.
 */
import { Rooms } from '../../utils/rooms.js';
import { writeAudit } from './audit.js';
import { insertSystemMessageTx, type SocketMessage } from './messages.js';
import { returnTicketToQueueTx } from './mutations.js';
import type {
  Effect,
  LifecycleDb,
  ReturnToQueueArgs,
  ReturnToQueueOk,
  Result,
} from './types.js';

export interface ReturnToQueueDeps {
  db: LifecycleDb;
}

export async function runReturnToQueue(
  deps: ReturnToQueueDeps,
  args: ReturnToQueueArgs,
): Promise<Result<ReturnToQueueOk>> {
  let raceLost = false;
  let systemMessage: SocketMessage | null = null;

  try {
    await deps.db.transaction(async (tx) => {
      const cleared = await returnTicketToQueueTx(tx, {
        ticketId: args.ticketId,
        previousSupportId: args.previousSupportId,
      });
      if (!cleared.ok) {
        raceLost = true;
        throw new Error('__lifecycle_race_lost__');
      }

      if (args.systemMessageText) {
        systemMessage = await insertSystemMessageTx(tx, {
          ticketId: args.ticketId,
          text: args.systemMessageText,
        });
      }

      await writeAudit(tx, {
        action: 'ticket.returned_to_queue',
        ticketId: args.ticketId,
        partnerId: args.partnerId,
        actor: args.actor,
        metadata: {
          fromSupportId: args.previousSupportId,
        },
      });
    });
  } catch (err) {
    if (raceLost) {
      return { ok: false, code: 'TICKET_ALREADY_REASSIGNED' };
    }
    throw err;
  }

  // Effects: the system-message emit is conditional on a message body, so
  // empty-text callers (ghost-heal) don't fan out a no-op `message:new`.
  const effects: Effect[] = [];
  if (systemMessage) {
    effects.push({
      type: 'emit',
      rooms: [Rooms.ticket(args.ticketId)],
      event: 'message:new',
      payload: systemMessage,
    });
    effects.push({ type: 'notifyPreviewers', ticketId: args.ticketId });
  }

  return {
    ok: true,
    data: { ticketId: args.ticketId },
    effects,
  };
}
