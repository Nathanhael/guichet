import { dispatchMessageCommand } from './messageBus.js';
import type { CommandBus, CommandBusDeps, SocketCommand } from './types.js';

export type {
  SocketCommand,
  CommandReply,
  CommandResult,
  CommandBus,
  CommandBusDeps,
  MessageAttachment,
} from './types.js';

export { applyCommandResult } from './applyCommandResult.js';

/**
 * Factory: wires the bus to its lifecycle + io deps. The returned bus is
 * stateless aside from those injected deps; safe to construct once per
 * server boot and reuse across all sockets.
 *
 * Today the bus handles message-domain commands only. Ticket-domain
 * commands (`ticket:new` / `:close` / `:transfer` / `:labels:update`) are
 * planned for the follow-up PR.
 */
export function createCommandBus(deps: CommandBusDeps): CommandBus {
  return {
    async dispatch(cmd: SocketCommand, callerSocketId: string) {
      return dispatchMessageCommand(deps, cmd, callerSocketId);
    },
  };
}
