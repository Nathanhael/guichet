/**
 * Helper: apply a `CommandResult` to the calling socket and to the live
 * Socket.io server. Emits the caller reply (if any), then dispatches the
 * lifecycle effects via the existing `applyEffects`.
 *
 * The split — reply through `socket`, effects through `io` — mirrors
 * `socket.emit(...)` vs `io.to(rooms).emit(...)`: the caller gets a direct
 * acknowledgement, peers see broadcasts.
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
  if (result.effects.length > 0) {
    applyEffects(io, result.effects);
  }
}
