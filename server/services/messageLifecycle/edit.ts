/**
 * Implementation of `lifecycle.edit()`. Updates a message's text under
 * own-message authorization and the configured edit-window. Runs the same
 * sync + Redis content-guard pipeline as `send`.
 *
 * Pre-flight rejections:
 *  - cross-tenant ticket → TICKET_NOT_FOUND
 *  - non-owner non-staff actor → NOT_OWN_MESSAGE
 *  - system message → CANNOT_MUTATE_SYSTEM
 *  - deleted tombstone → CANNOT_MUTATE_DELETED
 *  - older than `MAX_EDIT_WINDOW_MS` → EDIT_WINDOW_EXPIRED
 *  - sync content guard rejection → GUARD_REJECTED
 *  - repetition guard rejection → GUARD_REJECTED
 *  - repetition guard infra error → fail-open, message proceeds
 */
import { and, eq } from 'drizzle-orm';

import { MAX_EDIT_WINDOW_MS } from '../../constants.js';
import { messages, tickets } from '../../db/schema.js';
import { runSyncGuards } from '../guards.js';
import logger from '../../utils/logger.js';
import { Rooms } from '../../utils/rooms.js';

import type {
  EditArgs,
  EditOk,
  MessageLifecycleDeps,
  MessageLifecycleResult,
} from './types.js';
import type { RepetitionGuardPort } from './ports.js';

export interface EditDeps {
  db: MessageLifecycleDeps['db'];
  repetitionGuard: RepetitionGuardPort;
}

export async function runEdit(
  deps: EditDeps,
  args: EditArgs,
): Promise<MessageLifecycleResult<EditOk>> {
  // Tenant scope: verify the ticket exists in the actor's partner.
  const [ticket] = await deps.db
    .select({ id: tickets.id })
    .from(tickets)
    .where(and(eq(tickets.id, args.ticketId), eq(tickets.partnerId, args.partnerId)));
  if (!ticket) return { ok: false, code: 'TICKET_NOT_FOUND' };

  const [msg] = await deps.db
    .select({
      senderId: messages.senderId,
      system: messages.system,
      deletedAt: messages.deletedAt,
      createdAt: messages.createdAt,
    })
    .from(messages)
    .where(and(eq(messages.id, args.messageId), eq(messages.ticketId, args.ticketId)));
  if (!msg) return { ok: false, code: 'MESSAGE_NOT_FOUND' };
  if (msg.system) return { ok: false, code: 'CANNOT_MUTATE_SYSTEM' };
  if (msg.deletedAt) return { ok: false, code: 'CANNOT_MUTATE_DELETED' };
  if (msg.senderId !== args.actor.userId) {
    return { ok: false, code: 'NOT_OWN_MESSAGE' };
  }
  const ageMs = Date.now() - new Date(msg.createdAt).getTime();
  if (ageMs > MAX_EDIT_WINDOW_MS) {
    return { ok: false, code: 'EDIT_WINDOW_EXPIRED' };
  }

  // Sync guards always run (fail-closed — no try/catch bypass).
  const syncResult = runSyncGuards(args.newText);
  if (!syncResult.ok) {
    return { ok: false, code: 'GUARD_REJECTED' };
  }
  const guardedText = syncResult.text;

  // Redis-backed repetition guard via port — fail-open on infra error.
  try {
    const repResult = await deps.repetitionGuard.check({
      senderId: args.actor.userId,
      text: guardedText,
    });
    if (!repResult.ok) {
      return { ok: false, code: 'GUARD_REJECTED' };
    }
  } catch (err) {
    logger.error(
      { err: err instanceof Error ? err.message : String(err) },
      '[messageLifecycle.edit] repetition guard threw — failing open',
    );
  }

  const editedAt = new Date().toISOString();
  await deps.db
    .update(messages)
    .set({ text: guardedText, editedAt })
    .where(eq(messages.id, args.messageId));

  return {
    ok: true,
    data: { messageId: args.messageId, text: guardedText, editedAt },
    effects: [
      {
        type: 'emit',
        rooms: [Rooms.ticket(args.ticketId)],
        event: 'message:edited',
        payload: {
          ticketId: args.ticketId,
          messageId: args.messageId,
          text: guardedText,
          editedAt,
        },
      },
      { type: 'notifyPreviewers', ticketId: args.ticketId },
    ],
  };
}
