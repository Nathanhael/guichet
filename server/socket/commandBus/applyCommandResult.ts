/**
 * Helper: apply a `CommandResult` to the calling socket and to the live
 * Socket.io server.
 *
 * Sequence:
 *   1. Emit reply to caller (if any and not silent)
 *   2. Apply `callerJoins` — caller socket joins these rooms
 *   3. Dispatch effects via the existing `applyEffects`
 *   4. Apply `callerLeaves` — caller socket leaves these rooms
 *
 * Joins happen before effects so a `ticket:new` ack lands the caller in
 * the ticket room before downstream broadcasts fire. Leaves happen after
 * effects so a `ticket:transfer` (same-dept) re-broadcast can still reach
 * the support socket before it leaves the room.
 */

import type { Server, Socket } from 'socket.io';
import { applyEffects } from '../../services/ticketLifecycle/index.js';
import type { CommandResult } from './types.js';

export function applyCommandResult(socket: Socket, io: Server, result: CommandResult): void {
  const reply = result.reply;
  if (reply && !reply.silent) {
    if (reply.payload === undefined) {
      socket.emit(reply.event);
    } else {
      socket.emit(reply.event, reply.payload);
    }
  }

  if (result.callerJoins) {
    for (const room of result.callerJoins) socket.join(room);
  }

  if (result.effects.length > 0) {
    applyEffects(io, result.effects);
  }

  if (result.callerLeaves) {
    for (const room of result.callerLeaves) socket.leave(room);
  }
}
