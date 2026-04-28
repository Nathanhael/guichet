/**
 * Implementation of `lifecycle.transfer()`. Department-change branch
 * only — same-department return-to-queue uses `lifecycle.returnToQueue`
 * directly so there's no second transfer verb to maintain.
 *
 * Atomic txn: optional whisper note → dept update + support clear +
 * status='open' + queue_entered_at bump → system announcement message
 * → ticket.transferred audit row. The whisper, system message, mutation,
 * and audit row all fail together if any step fails.
 *
 * Effects: whisper message:new (when note present), system message:new,
 * ticket:transferred dual-room broadcast (ticket-room + partner-room),
 * notifyPreviewers, evictSupportFromRoom (so prior support sockets stop
 * receiving traffic for this ticket), broadcastQueue (both old and new
 * department queues need refreshing).
 */
import { Rooms } from '../../utils/rooms.js';
import { isSupportLike } from '../roles.js';
import { writeAudit } from './audit.js';
import {
  insertSystemMessageTx,
  insertWhisperMessageTx,
  type SocketMessage,
} from './messages.js';
import {
  readForTransfer,
  readPartnerDepartments,
  transferTicketToDepartmentTx,
} from './mutations.js';
import type {
  Effect,
  LifecycleDb,
  Result,
  TransferArgs,
  TransferOk,
} from './types.js';

export interface TransferDeps {
  db: LifecycleDb;
}

export async function runTransfer(
  deps: TransferDeps,
  args: TransferArgs,
): Promise<Result<TransferOk>> {
  if (!isSupportLike(args.actor.role)) {
    return { ok: false, code: 'NOT_AUTHORIZED' };
  }

  const snapshot = await readForTransfer(deps.db, {
    ticketId: args.ticketId,
    partnerId: args.partnerId,
  });
  if (!snapshot) {
    return { ok: false, code: 'TICKET_NOT_FOUND' };
  }

  const departments = await readPartnerDepartments(deps.db, { partnerId: args.partnerId });
  const targetDept = departments.find((d) => d.id === args.toDepartmentId);
  if (!targetDept) {
    return { ok: false, code: 'DEPARTMENT_NOT_FOUND' };
  }

  const trimmedNote = args.note?.trim();
  const fromSupportId = snapshot.supportId;
  let whisperMessage: SocketMessage | null = null;
  let systemMessage: SocketMessage | null = null;

  await deps.db.transaction(async (tx) => {
    if (trimmedNote) {
      whisperMessage = await insertWhisperMessageTx(tx, {
        ticketId: args.ticketId,
        senderId: args.actor.userId,
        senderName: args.actor.name,
        senderRole: args.actor.role,
        senderLang: args.actor.lang,
        senderIsExternal: args.actor.isExternal,
        text: trimmedNote,
      });
    }

    await transferTicketToDepartmentTx(tx, {
      ticketId: args.ticketId,
      toDepartmentId: args.toDepartmentId,
    });

    systemMessage = await insertSystemMessageTx(tx, {
      ticketId: args.ticketId,
      text: `Ticket transferred to ${targetDept.name} by ${args.actor.name}`,
    });

    await writeAudit(tx, {
      action: 'ticket.transferred',
      ticketId: args.ticketId,
      partnerId: args.partnerId,
      actor: args.actor,
      metadata: {
        toDepartmentId: args.toDepartmentId,
        toDepartmentName: targetDept.name,
        fromSupportId,
        hasNote: !!trimmedNote,
      },
    });
  });

  if (!systemMessage) {
    throw new Error('lifecycle.transfer: txn committed without writing a system message');
  }

  const transferPayload = {
    ticketId: args.ticketId,
    fromId: args.actor.userId,
    fromName: args.actor.name,
    toDepartment: args.toDepartmentId,
    toDepartmentName: targetDept.name,
  };

  const effects: Effect[] = [];
  if (whisperMessage) {
    effects.push({
      type: 'emit',
      rooms: [Rooms.ticket(args.ticketId)],
      event: 'message:new',
      payload: whisperMessage,
    });
  }
  effects.push(
    {
      type: 'emit',
      rooms: [Rooms.ticket(args.ticketId)],
      event: 'message:new',
      payload: systemMessage,
    },
    {
      type: 'emit',
      rooms: [Rooms.ticket(args.ticketId)],
      event: 'ticket:transferred',
      payload: transferPayload,
    },
    {
      type: 'emit',
      rooms: [Rooms.partner(args.partnerId)],
      event: 'ticket:transferred',
      payload: transferPayload,
    },
    { type: 'notifyPreviewers', ticketId: args.ticketId },
    { type: 'evictSupportFromRoom', ticketId: args.ticketId },
    { type: 'broadcastQueue', partnerId: args.partnerId },
  );

  return {
    ok: true,
    data: {
      fromSupportId,
      toDepartmentId: args.toDepartmentId,
      toDepartmentName: targetDept.name,
    },
    effects,
  };
}
