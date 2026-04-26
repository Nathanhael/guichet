/**
 * Implementation of `lifecycle.reclaim()`. Wraps the mutation, the system
 * message, and the audit row in a single Postgres transaction. Returns a
 * `Result` plus the post-commit effect array — the caller dispatches via
 * `applyEffects(io, effects)`.
 */
import { Rooms } from '../../utils/rooms.js';
import { writeAudit } from './audit.js';
import { insertSystemMessageTx } from './messages.js';
import { returnTicketToQueueTx } from './mutations.js';
import { systemActor } from './actor.js';
import type {
  Effect,
  LifecycleDb,
  ReclaimArgs,
  ReclaimOk,
  Result,
} from './types.js';

export interface ReclaimDeps {
  db: LifecycleDb;
  /** Pulled from the ticket; required to write the partner-scoped audit row. */
  partnerId: string;
}

export async function runReclaim(
  deps: ReclaimDeps,
  args: ReclaimArgs,
): Promise<Result<ReclaimOk>> {
  // The whole event runs in one transaction: mutation, system message, audit.
  // If any step fails, the ticket row stays unchanged and no system message
  // appears in chat. That property does not exist in the pre-deepening code
  // path (audit was fire-and-forget) and is exercised by the rollback test.
  let raceLost = false;
  try {
    await deps.db.transaction(async (tx) => {
      const mutated = await returnTicketToQueueTx(tx, {
        ticketId: args.ticketId,
        previousSupportId: args.previousSupportId,
      });
      if (!mutated.ok) {
        raceLost = true;
        // Abort the transaction without writing audit / system message.
        // Rejection is communicated via the outer flag, not by throwing,
        // so test failures don't produce noisy stack traces for an
        // expected race outcome.
        throw new Error('__lifecycle_race_lost__');
      }

      await insertSystemMessageTx(tx, {
        ticketId: args.ticketId,
        text: `Auto-released — ${args.previousSupportName ?? 'support agent'} unavailable`,
      });

      await writeAudit(tx, {
        action: 'ticket.reclaimed',
        ticketId: args.ticketId,
        partnerId: deps.partnerId,
        actor: systemActor,
        metadata: {
          previousSupportId: args.previousSupportId,
          previousSupportName: args.previousSupportName,
        },
      });
    });
  } catch (err) {
    if (raceLost) {
      return { ok: false, code: 'TICKET_ALREADY_REASSIGNED' };
    }
    throw err;
  }

  const effects: Effect[] = [
    {
      type: 'emit',
      rooms: [Rooms.staff(deps.partnerId)],
      event: 'ticket:reclaimed',
      payload: {
        ticketId: args.ticketId,
        previousSupportId: args.previousSupportId,
        previousSupportName: args.previousSupportName,
      },
    },
  ];

  return {
    ok: true,
    data: {
      ticketId: args.ticketId,
      partnerId: deps.partnerId,
      previousSupportId: args.previousSupportId,
      previousSupportName: args.previousSupportName,
    },
    effects,
  };
}
