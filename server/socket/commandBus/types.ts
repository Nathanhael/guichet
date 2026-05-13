/**
 * SocketCommandBus types.
 *
 * The bus absorbs scope fetching, viewer-language topology reads, lifecycle
 * dispatch, and domain-error → socket-event mapping. Handlers shrink to
 * parse → authz → bus.dispatch → applyCommandResult.
 *
 * Effects (broadcasts) remain expressed as the existing
 * `services/ticketLifecycle/types.ts::Effect` data array — the lifecycle's
 * effect machinery is already a clean data interface, no need to invent
 * a parallel "broadcast" abstraction.
 */

import type { Server } from 'socket.io';
import type { UserActor } from '../../services/auth/index.js';
import type { MessageLifecycle } from '../../services/messageLifecycle/index.js';
import type { TicketLifecycle } from '../../services/ticketLifecycle/index.js';
import type { Effect } from '../../services/ticketLifecycle/types.js';

export interface MessageAttachment {
  url: string;
  name: string;
  mimeType: string;
  size: number;
}

export interface TicketReference {
  label: string;
  value: string;
}

/**
 * Typed commands the bus knows how to dispatch. Discriminated by `type`.
 * Each variant carries everything the lifecycle needs, plus the calling
 * actor + partner scope (so the bus can verify tenant isolation itself
 * rather than depending on a handler-side guard).
 */
export type SocketCommand =
  | {
      type: 'message:send';
      partnerId: string;
      actor: UserActor;
      ticketId: string;
      text?: string;
      mediaUrl?: string;
      attachments?: MessageAttachment[];
      whisper?: boolean;
      replyToId?: string | null;
      localId?: string;
      improvedFromUsageLogId?: string;
    }
  | {
      type: 'message:edit';
      partnerId: string;
      actor: UserActor;
      ticketId: string;
      messageId: string;
      newText: string;
    }
  | {
      type: 'message:delete';
      partnerId: string;
      actor: UserActor;
      ticketId: string;
      messageId: string;
    }
  | {
      type: 'message:react';
      partnerId: string;
      actor: UserActor;
      ticketId: string;
      messageId: string;
      emoji: string;
    }
  | {
      type: 'ticket:new';
      partnerId: string;
      actor: UserActor;
      dept: string;
      agentLang: string;
      references?: TicketReference[];
      text?: string;
      mediaUrl?: string;
    }
  | {
      type: 'ticket:close';
      partnerId: string;
      actor: UserActor;
      ticketId: string;
      closingNotes?: string;
    }
  | {
      type: 'ticket:transfer';
      partnerId: string;
      actor: UserActor;
      ticketId: string;
      departmentId?: string;
      note?: string;
    }
  | {
      type: 'ticket:labels:update';
      partnerId: string;
      actor: UserActor;
      ticketId: string;
      labels: string[];
    };

/**
 * A single event the bus tells the handler to emit back to the caller.
 * `silent: true` means the bus consumed the request without producing a
 * caller-visible response (e.g. legacy not-found short-circuit on
 * `message:send` after the scope guard already replied).
 */
export type CommandReply =
  | { silent: true }
  | { silent?: false; event: string; payload?: unknown };

export interface CommandResult {
  /** Event to emit back to the calling socket. Optional — broadcasts only. */
  reply?: CommandReply;
  /** Lifecycle effects to dispatch through `applyEffects`. */
  effects: Effect[];
  /** Rooms the calling socket should join after a successful dispatch. */
  callerJoins?: string[];
  /** Rooms the calling socket should leave after a successful dispatch. */
  callerLeaves?: string[];
}

/**
 * Dependencies the bus needs at construction time.
 *
 * - `messageLifecycle`: message-domain lifecycle (send/edit/delete/react)
 * - `ticketLifecycle`: ticket-domain lifecycle (create/close/transfer/returnToQueue)
 * - `io`: used by the message-domain dispatcher to collect viewer
 *   languages from sockets in the ticket room (AI translation prewarm on
 *   `message:send`). Ticket-domain broadcasts flow through `Effect`s
 *   handled by `applyEffects`, so they do not need `io` here. Tests
 *   provide a minimal fake.
 */
export interface CommandBusDeps {
  messageLifecycle: MessageLifecycle;
  ticketLifecycle: TicketLifecycle;
  io: Server;
}

export interface CommandBus {
  dispatch(cmd: SocketCommand, callerSocketId: string): Promise<CommandResult>;
}
