/**
 * Implementation of `lifecycle.assign()`. Atomically (optionally) clears
 * a ghost primary, assigns the joining support, inserts the "joined the
 * conversation" system message, and writes the `ticket.assigned` audit
 * row — all in one transaction.
 *
 * The COALESCE-based assign means a concurrent claim wins: if two
 * supports race to claim, only one becomes primary, the other becomes a
 * secondary participant. Both still get a `ticket.assigned` audit row;
 * the metadata's `becamePrimary` field distinguishes them.
 */
import { Rooms } from '../../utils/rooms.js';
import { writeAudit } from './audit.js';
import { insertSystemMessageTx, type SocketMessage } from './messages.js';
import {
  assignSupportTx,
  readForAssign,
  returnTicketToQueueTx,
} from './mutations.js';
import type {
  AssignArgs,
  AssignOk,
  Effect,
  LifecycleDb,
  Result,
} from './types.js';

export interface AssignDeps {
  db: LifecycleDb;
}

export async function runAssign(
  deps: AssignDeps,
  args: AssignArgs,
): Promise<Result<AssignOk>> {
  if (!args.actor.isSupport) {
    return { ok: false, code: 'NOT_AUTHORIZED' };
  }

  const snapshot = await readForAssign(deps.db, {
    ticketId: args.ticketId,
    partnerId: args.partnerId,
  });
  if (!snapshot) {
    return { ok: false, code: 'TICKET_NOT_FOUND' };
  }
  if (snapshot.status === 'closed') {
    return { ok: false, code: 'TICKET_CLOSED' };
  }

  let ghostHealed = false;
  let assignedSupportId: string | null = null;
  let participants: AssignOk['participants'] = [];
  let joinMessage: SocketMessage | null = null;

  await deps.db.transaction(async (tx) => {
    if (args.ghostHealPreviousSupportId) {
      // Race-guarded — if a concurrent claim landed between the caller's
      // presence check and now, the UPDATE no-ops and ghostHealed stays
      // false. We continue with the assign anyway: the COALESCE in
      // `assignSupportTx` preserves the new primary, so the joiner just
      // becomes a secondary participant. Mirrors legacy behavior.
      const cleared = await returnTicketToQueueTx(tx, {
        ticketId: args.ticketId,
        previousSupportId: args.ghostHealPreviousSupportId,
      });
      ghostHealed = cleared.ok;
    }

    const out = await assignSupportTx(tx, {
      ticketId: args.ticketId,
      supportId: args.actor.id,
      supportName: args.actor.name,
      supportLang: args.supportLang,
      supportIsExternal: args.actor.isExternal,
    });
    assignedSupportId = out.supportId;
    participants = out.participants;

    joinMessage = await insertSystemMessageTx(tx, {
      ticketId: args.ticketId,
      text: `${args.actor.name} joined the conversation`,
    });

    await writeAudit(tx, {
      action: 'ticket.assigned',
      ticketId: args.ticketId,
      partnerId: args.partnerId,
      actor: args.actor,
      metadata: {
        supportId: args.actor.id,
        supportName: args.actor.name,
        ghostHealed,
        becamePrimary: assignedSupportId === args.actor.id,
      },
    });
  });

  if (!joinMessage) {
    throw new Error('lifecycle.assign: txn committed without writing a system message');
  }

  const becamePrimary = assignedSupportId === args.actor.id;

  const effects: Effect[] = [
    {
      type: 'emit',
      rooms: [Rooms.ticket(args.ticketId)],
      event: 'message:new',
      payload: joinMessage,
    },
    {
      type: 'emit',
      rooms: [Rooms.ticket(args.ticketId), Rooms.staff(args.partnerId)],
      event: 'support:joined',
      payload: {
        ticketId: args.ticketId,
        supportId: args.actor.id,
        supportName: args.actor.name,
        participants,
      },
    },
    { type: 'notifyPreviewers', ticketId: args.ticketId },
    { type: 'broadcastQueue', partnerId: args.partnerId },
  ];

  return {
    ok: true,
    data: { participants, becamePrimary, ghostHealed },
    effects,
  };
}
