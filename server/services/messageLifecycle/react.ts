/**
 * Implementation of `lifecycle.react()`. Toggles a user's reaction on a
 * message. The toggle math + JSONB write is the only DB write — no audit
 * row, no transaction wrapper.
 *
 * Pre-flight rejections:
 *  - emoji not in `REACTION_EMOJIS` → INVALID_REACTION
 *  - message is a system message → CANNOT_MUTATE_SYSTEM
 *  - message is soft-deleted → CANNOT_MUTATE_DELETED
 *  - message not found in actor's partner ticket → MESSAGE_NOT_FOUND or TICKET_NOT_FOUND
 */
import { and, eq } from 'drizzle-orm';

import { REACTION_EMOJIS, type ReactionEmoji } from '../../constants.js';
import { messages, tickets } from '../../db/schema.js';
import { Rooms } from '../../utils/rooms.js';

import type {
  MessageLifecycleDeps,
  MessageLifecycleResult,
  ReactArgs,
  ReactOk,
} from './types.js';

export interface ReactDeps {
  db: MessageLifecycleDeps['db'];
}

export async function runReact(
  deps: ReactDeps,
  args: ReactArgs,
): Promise<MessageLifecycleResult<ReactOk>> {
  if (!REACTION_EMOJIS.includes(args.emoji as ReactionEmoji)) {
    return { ok: false, code: 'INVALID_REACTION' };
  }

  // Tenant scope: verify the ticket exists in the actor's partner.
  const [ticket] = await deps.db
    .select({ id: tickets.id })
    .from(tickets)
    .where(and(eq(tickets.id, args.ticketId), eq(tickets.partnerId, args.partnerId)));
  if (!ticket) return { ok: false, code: 'TICKET_NOT_FOUND' };

  const [msg] = await deps.db
    .select({
      reactions: messages.reactions,
      system: messages.system,
      deletedAt: messages.deletedAt,
    })
    .from(messages)
    .where(and(eq(messages.id, args.messageId), eq(messages.ticketId, args.ticketId)));
  if (!msg) return { ok: false, code: 'MESSAGE_NOT_FOUND' };
  if (msg.system) return { ok: false, code: 'CANNOT_MUTATE_SYSTEM' };
  if (msg.deletedAt) return { ok: false, code: 'CANNOT_MUTATE_DELETED' };

  const reactions: Record<string, string[]> = { ...(msg.reactions ?? {}) };
  const users = [...(reactions[args.emoji] ?? [])];
  const idx = users.indexOf(args.actor.userId);
  if (idx >= 0) {
    users.splice(idx, 1);
    if (users.length === 0) {
      delete reactions[args.emoji];
    } else {
      reactions[args.emoji] = users;
    }
  } else {
    reactions[args.emoji] = [...users, args.actor.userId];
  }

  await deps.db
    .update(messages)
    .set({ reactions })
    .where(eq(messages.id, args.messageId));

  return {
    ok: true,
    data: { messageId: args.messageId, reactions },
    effects: [
      {
        type: 'emit',
        rooms: [Rooms.ticket(args.ticketId)],
        event: 'reaction:updated',
        payload: { ticketId: args.ticketId, messageId: args.messageId, reactions },
      },
      { type: 'notifyPreviewers', ticketId: args.ticketId },
    ],
  };
}
