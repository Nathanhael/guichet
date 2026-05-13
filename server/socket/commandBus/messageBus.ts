/**
 * Message-domain dispatch for the SocketCommandBus.
 *
 * Absorbs the scope check + viewer-language collection + lifecycle call
 * + error-code → caller-event mapping that used to live in
 * `socket/handlers/message.ts`. Returns a `CommandResult` describing what
 * the handler should reply with and which effects to dispatch.
 *
 * The bus does NOT touch the socket. It returns data; the handler
 * (via `applyCommandResult`) decides what to send back.
 */

import type { Server } from 'socket.io';
import { Rooms } from '../../utils/rooms.js';
import { findTicketPartner } from '../../services/ticketQueries.js';
import { findTicketForMessage } from '../../services/ticketQueries.js';
import type { CommandResult, SocketCommand } from './types.js';
import type { MessageLifecycle } from '../../services/messageLifecycle/index.js';

const NOT_AUTHORIZED: CommandResult = {
  reply: { event: 'error', payload: { message: 'Not authorized' } },
  effects: [],
};

const SILENT_NOOP: CommandResult = { reply: { silent: true }, effects: [] };

/** Cross-tenant guard. Returns the partnerId match outcome. */
async function checkPartnerScope(
  partnerId: string,
  ticketId: string,
): Promise<'authorized' | 'unauthorized'> {
  const ticket = await findTicketPartner(ticketId);
  if (!ticket || ticket.partnerId !== partnerId) return 'unauthorized';
  return 'authorized';
}

/**
 * Collect viewer languages from sockets in the ticket room. Used by the
 * AI translation prewarm path in `message:send`. The caller socket is
 * excluded so the sender's own lang doesn't end up in the prewarm set.
 */
function collectViewerLangs(
  io: Server,
  ticketId: string,
  excludeSocketId: string,
): Set<string> {
  const room = Rooms.ticket(ticketId);
  const langs = new Set<string>();
  for (const peer of io.sockets.sockets.values()) {
    if (peer.id === excludeSocketId) continue;
    if (!peer.rooms.has(room)) continue;
    const lg = (peer.data.lang as string) || '';
    if (lg) langs.add(lg);
  }
  return langs;
}

export async function dispatchMessageCommand(
  deps: { messageLifecycle: MessageLifecycle; io: Server },
  cmd: SocketCommand,
  callerSocketId: string,
): Promise<CommandResult> {
  switch (cmd.type) {
    case 'message:send':
      return dispatchSend(deps, cmd, callerSocketId);
    case 'message:edit':
      return dispatchEdit(deps, cmd);
    case 'message:delete':
      return dispatchDelete(deps, cmd);
    case 'message:react':
      return dispatchReact(deps, cmd);
  }
}

async function dispatchSend(
  deps: { messageLifecycle: MessageLifecycle; io: Server },
  cmd: Extract<SocketCommand, { type: 'message:send' }>,
  callerSocketId: string,
): Promise<CommandResult> {
  // Scope: the lifecycle returns TICKET_NOT_FOUND for cross-tenant access,
  // but legacy UX expects the "Not authorized" error event. Pre-check
  // partner scope here so the caller sees the right message.
  const ticket = await findTicketForMessage(cmd.ticketId);
  if (!ticket || ticket.partnerId !== cmd.partnerId) return NOT_AUTHORIZED;
  if (ticket.status === 'closed') return SILENT_NOOP;

  const viewerLangs = collectViewerLangs(deps.io, cmd.ticketId, callerSocketId);

  const result = await deps.messageLifecycle.send({
    ticketId: cmd.ticketId,
    partnerId: cmd.partnerId,
    actor: cmd.actor,
    text: cmd.text,
    mediaUrl: cmd.mediaUrl,
    attachments: cmd.attachments,
    whisper: cmd.whisper,
    replyToId: cmd.replyToId ?? null,
    localId: cmd.localId,
    viewerLangs,
    improvedFromUsageLogId: cmd.improvedFromUsageLogId,
  });

  if (!result.ok) {
    switch (result.code) {
      case 'GUARD_REJECTED':
        return {
          reply: {
            event: 'message:rejected',
            payload: { ticketId: cmd.ticketId, localId: cmd.localId, code: 'GUARD_REJECTED' },
          },
          effects: [],
        };
      case 'INVALID_MEDIA_URL':
        return {
          reply: { event: 'error', payload: { message: 'Invalid media URL' } },
          effects: [],
        };
      case 'EMPTY_MESSAGE':
      case 'TICKET_NOT_FOUND':
      case 'TICKET_CLOSED':
        return SILENT_NOOP;
      default:
        return SILENT_NOOP;
    }
  }

  return { effects: result.effects };
}

async function dispatchEdit(
  deps: { messageLifecycle: MessageLifecycle },
  cmd: Extract<SocketCommand, { type: 'message:edit' }>,
): Promise<CommandResult> {
  const scope = await checkPartnerScope(cmd.partnerId, cmd.ticketId);
  if (scope === 'unauthorized') return NOT_AUTHORIZED;

  const result = await deps.messageLifecycle.edit({
    ticketId: cmd.ticketId,
    partnerId: cmd.partnerId,
    messageId: cmd.messageId,
    actor: cmd.actor,
    newText: cmd.newText,
  });

  if (!result.ok) {
    switch (result.code) {
      case 'NOT_OWN_MESSAGE':
        return { reply: { event: 'error', payload: { message: 'Can only edit your own messages' } }, effects: [] };
      case 'CANNOT_MUTATE_SYSTEM':
        return { reply: { event: 'error', payload: { message: 'Cannot edit system messages' } }, effects: [] };
      case 'CANNOT_MUTATE_DELETED':
        return { reply: { event: 'error', payload: { message: 'Cannot edit deleted messages' } }, effects: [] };
      case 'EDIT_WINDOW_EXPIRED':
        return { reply: { event: 'error', payload: { message: 'Edit window has expired (15 min)' } }, effects: [] };
      case 'GUARD_REJECTED':
        return { reply: { event: 'error', payload: { message: 'Edit blocked: GUARD_REJECTED' } }, effects: [] };
      case 'TICKET_NOT_FOUND':
      case 'MESSAGE_NOT_FOUND':
        return SILENT_NOOP;
      default:
        return SILENT_NOOP;
    }
  }

  return { effects: result.effects };
}

async function dispatchDelete(
  deps: { messageLifecycle: MessageLifecycle },
  cmd: Extract<SocketCommand, { type: 'message:delete' }>,
): Promise<CommandResult> {
  const scope = await checkPartnerScope(cmd.partnerId, cmd.ticketId);
  if (scope === 'unauthorized') return NOT_AUTHORIZED;

  const result = await deps.messageLifecycle.delete({
    ticketId: cmd.ticketId,
    partnerId: cmd.partnerId,
    messageId: cmd.messageId,
    actor: cmd.actor,
  });

  if (!result.ok) {
    switch (result.code) {
      case 'NOT_OWN_MESSAGE':
        return { reply: { event: 'error', payload: { message: 'Can only delete your own messages' } }, effects: [] };
      case 'CANNOT_MUTATE_SYSTEM':
        return { reply: { event: 'error', payload: { message: 'Cannot delete system messages' } }, effects: [] };
      case 'TICKET_NOT_FOUND':
      case 'MESSAGE_NOT_FOUND':
        return SILENT_NOOP;
      default:
        return SILENT_NOOP;
    }
  }

  return { effects: result.effects };
}

async function dispatchReact(
  deps: { messageLifecycle: MessageLifecycle },
  cmd: Extract<SocketCommand, { type: 'message:react' }>,
): Promise<CommandResult> {
  const scope = await checkPartnerScope(cmd.partnerId, cmd.ticketId);
  if (scope === 'unauthorized') return NOT_AUTHORIZED;

  const result = await deps.messageLifecycle.react({
    ticketId: cmd.ticketId,
    partnerId: cmd.partnerId,
    messageId: cmd.messageId,
    actor: cmd.actor,
    emoji: cmd.emoji,
  });

  if (!result.ok) {
    switch (result.code) {
      case 'INVALID_REACTION':
        return { reply: { event: 'error', payload: { message: 'Invalid reaction emoji' } }, effects: [] };
      case 'CANNOT_MUTATE_SYSTEM':
        return { reply: { event: 'error', payload: { message: 'Cannot react to system messages' } }, effects: [] };
      case 'CANNOT_MUTATE_DELETED':
        return { reply: { event: 'error', payload: { message: 'Cannot react to deleted messages' } }, effects: [] };
      case 'TICKET_NOT_FOUND':
      case 'MESSAGE_NOT_FOUND':
        return SILENT_NOOP;
      default:
        return SILENT_NOOP;
    }
  }

  return { effects: result.effects };
}
