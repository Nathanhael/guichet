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
import { Rooms } from '../../utils/rooms.js';

import { recordGuardBlock } from './guardAudit.js';
import type {
  EditArgs,
  EditOk,
  MessageLifecycleDeps,
  MessageLifecycleResult,
} from './types.js';
import type { ModerationPort } from './ports.js';

export interface EditDeps {
  db: MessageLifecycleDeps['db'];
  moderation: ModerationPort;
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

  // Content moderation. `scope: 'message:edit'` skips repetition (re-editing
  // identical text is normal); the moderator owns that policy. On block, the
  // audit-row write captures original + every triggered guard so an incident
  // reviewer sees what the user actually typed.
  const result = await deps.moderation.moderate(args.newText, {
    senderId: args.actor.userId,
    partnerId: args.partnerId,
    scope: 'message:edit',
  });
  if (result.decision === 'block') {
    await recordGuardBlock({
      db: deps.db,
      actorId: args.actor.userId,
      partnerId: args.partnerId,
      ticketId: args.ticketId,
      scope: 'message:edit',
      original: result.original,
      sanitized: result.sanitized,
      triggered: result.triggered,
      blockingCode: result.blockingCode!,
    });
    return { ok: false, code: 'GUARD_REJECTED' };
  }
  const guardedText = result.sanitized;

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
