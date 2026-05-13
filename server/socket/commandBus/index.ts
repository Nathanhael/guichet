import { dispatchMessageCommand } from './messageBus.js';
import { dispatchTicketCommand } from './ticketBus.js';
import type { CommandBus, CommandBusDeps, SocketCommand } from './types.js';

export type {
  SocketCommand,
  CommandReply,
  CommandResult,
  CommandBus,
  CommandBusDeps,
  MessageAttachment,
  TicketReference,
} from './types.js';

export { applyCommandResult } from './applyCommandResult.js';

/**
 * Factory: wires the bus to its lifecycle + io deps. The returned bus is
 * stateless aside from those injected deps; safe to construct once per
 * server boot and reuse across all sockets.
 *
 * Routes commands by their `type` prefix to the message- or ticket-domain
 * dispatcher.
 */
export function createCommandBus(deps: CommandBusDeps): CommandBus {
  return {
    async dispatch(cmd: SocketCommand, callerSocketId: string) {
      if (cmd.type.startsWith('message:')) {
        return dispatchMessageCommand(
          { messageLifecycle: deps.messageLifecycle, io: deps.io },
          cmd as Extract<SocketCommand, { type: `message:${string}` }>,
          callerSocketId,
        );
      }
      return dispatchTicketCommand(
        { ticketLifecycle: deps.ticketLifecycle },
        cmd as Extract<SocketCommand, { type: `ticket:${string}` }>,
      );
    },
  };
}
