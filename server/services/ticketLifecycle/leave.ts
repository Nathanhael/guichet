/**
 * Implementation of `lifecycle.leave()`. Removes a participant from a
 * ticket's roster, optionally clears the support assignment when the
 * leaver was the primary (or the stored primary turned out to be a
 * ghost), inserts the "left the conversation" system message, and writes
 * the `ticket.left` audit row — all atomically.
 *
 * The `ticket.left` audit row closes the silent gap that existed when the
 * support:leave handler hand-rolled this orchestration (the audit was
 * never written for a leave that didn't trigger a queue return, even
 * though the leave is just as security-relevant).
 */
import { Rooms } from '../../utils/rooms.js';
import { writeAudit } from './audit.js';
import { insertSystemMessageTx } from './messages.js';
import {
  readParticipants,
  returnTicketToQueueTx,
  writeParticipantsTx,
} from './mutations.js';
import type {
  Effect,
  LeaveArgs,
  LeaveOk,
  LifecycleDb,
  Participant,
  Result,
} from './types.js';

export interface LeaveDeps {
  db: LifecycleDb;
}

export async function runLeave(
  deps: LeaveDeps,
  args: LeaveArgs,
): Promise<Result<LeaveOk>> {
  // Pre-flight read — outside the txn. Cheap: a single-row select. We need
  // it to:
  //   1. Confirm the ticket exists in the actor's tenant (NOT_FOUND on a
  //      mismatch, not a separate cross-tenant code, so we don't leak
  //      existence to a wrong-partner caller).
  //   2. Confirm the actor is in `participants`. NOT_A_PARTICIPANT is
  //      returned without any DB writes — same shape as the legacy
  //      handler's early return.
  const snapshot = await readParticipants(deps.db, {
    ticketId: args.ticketId,
    partnerId: args.partnerId,
  });
  if (!snapshot) {
    return { ok: false, code: 'TICKET_NOT_FOUND' };
  }
  const isParticipant = snapshot.participants.some((p) => p.id === args.actor.userId);
  if (!isParticipant) {
    return { ok: false, code: 'NOT_A_PARTICIPANT' };
  }

  const remaining: Participant[] = snapshot.participants.filter(
    (p) => p.id !== args.actor.userId,
  );

  let queueReturned = false;
  let leaveMessage: import('./messages.js').SocketMessage | null = null;

  await deps.db.transaction(async (tx) => {
    // Always: roster update.
    await writeParticipantsTx(tx, {
      ticketId: args.ticketId,
      participants: remaining,
    });

    // Conditionally: clear support assignment. Race-guarded by
    // `previousSupportId` — if a concurrent claim won between the caller's
    // read and now, the UPDATE no-ops and queueReturned stays false.
    if (args.clearPrimary && args.previousSupportId) {
      const cleared = await returnTicketToQueueTx(tx, {
        ticketId: args.ticketId,
        previousSupportId: args.previousSupportId,
      });
      queueReturned = cleared.ok;
    }

    // Always: system message — emit payload is the full SocketMessage so
    // existing chat clients render the "left the conversation" line
    // identically to other system messages (no protocol drift).
    leaveMessage = await insertSystemMessageTx(tx, {
      ticketId: args.ticketId,
      text: `${args.actor.name} left the conversation`,
    });

    // Always: audit row. Closes the silent gap — every leave is recorded,
    // not only the leaves that triggered a queue return.
    await writeAudit(tx, {
      action: 'ticket.left',
      ticketId: args.ticketId,
      partnerId: args.partnerId,
      actor: args.actor,
      metadata: {
        wasPrimary: args.clearPrimary,
        queueReturned,
        remainingParticipants: remaining.length,
      },
    });
  });

  // After-commit assertion — `leaveMessage` is assigned inside the txn
  // closure on every successful run; the only way it stays null is if the
  // txn threw, in which case `db.transaction(...)` rejected and we never
  // get here.
  if (!leaveMessage) {
    throw new Error('lifecycle.leave: txn committed without writing a system message');
  }

  const effects: Effect[] = [
    {
      type: 'emit',
      rooms: [Rooms.ticket(args.ticketId)],
      event: 'message:new',
      payload: leaveMessage,
    },
    {
      // Ticket + staff fan-out for queue/header updates. Chained `.to(a).to(b)`
      // semantics preserved by `applyEffects` so a support agent sitting in
      // both rooms only receives the event once.
      type: 'emit',
      rooms: [Rooms.ticket(args.ticketId), Rooms.staff(args.partnerId)],
      event: 'support:left',
      payload: {
        ticketId: args.ticketId,
        supportId: args.actor.userId,
        supportName: args.actor.name,
        participants: remaining,
        queueReturned,
      },
    },
    {
      type: 'notifyPreviewers',
      ticketId: args.ticketId,
    },
  ];

  return {
    ok: true,
    data: { participants: remaining, queueReturned },
    effects,
  };
}
