/**
 * Implementation of `lifecycle.delete()`. Soft-deletes a message and
 * fire-and-forgets blob cleanup AFTER the DB update commits — a storage
 * outage must not orphan the DB row.
 *
 * Pre-flight rejections:
 *  - cross-tenant ticket → TICKET_NOT_FOUND
 *  - non-staff non-owner actor → NOT_OWN_MESSAGE
 *  - system message → CANNOT_MUTATE_SYSTEM
 *  - already-deleted (idempotent) → silent ok with no broadcast/storage
 */
import { and, eq } from 'drizzle-orm';

import { messages, tickets } from '../../db/schema.js';
import logger from '../../utils/logger.js';
import { Rooms } from '../../utils/rooms.js';
import { isSupportLike } from '../roles.js';

import type {
  DeleteArgs,
  DeleteOk,
  MessageLifecycleDeps,
  MessageLifecycleResult,
  MessageLifecycleStorage,
} from './types.js';

export interface DeleteDeps {
  db: MessageLifecycleDeps['db'];
  storage: MessageLifecycleStorage;
}

export async function runDelete(
  deps: DeleteDeps,
  args: DeleteArgs,
): Promise<MessageLifecycleResult<DeleteOk>> {
  // Tenant scope: verify the ticket exists in the actor's partner.
  const [ticket] = await deps.db
    .select({ id: tickets.id })
    .from(tickets)
    .where(and(eq(tickets.id, args.ticketId), eq(tickets.partnerId, args.partnerId)));
  if (!ticket) return { ok: false, code: 'TICKET_NOT_FOUND' };

  const [existing] = await deps.db
    .select({
      senderId: messages.senderId,
      system: messages.system,
      deletedAt: messages.deletedAt,
      mediaUrl: messages.mediaUrl,
      attachments: messages.attachments,
    })
    .from(messages)
    .where(and(eq(messages.id, args.messageId), eq(messages.ticketId, args.ticketId)));
  if (!existing) return { ok: false, code: 'MESSAGE_NOT_FOUND' };
  if (existing.system) return { ok: false, code: 'CANNOT_MUTATE_SYSTEM' };
  // Already deleted: idempotent silent ok with no effects.
  if (existing.deletedAt) {
    return { ok: true, data: { messageId: args.messageId, deletedAt: existing.deletedAt }, effects: [] };
  }
  // Authz: staff or own message.
  if (!isSupportLike(args.actor.role) && existing.senderId !== args.actor.userId) {
    return { ok: false, code: 'NOT_OWN_MESSAGE' };
  }

  const filesToDelete: string[] = [];
  if (existing?.mediaUrl?.startsWith('/uploads/')) {
    filesToDelete.push(existing.mediaUrl.replace(/^\/uploads\//, ''));
  }
  const attachments = (existing?.attachments ?? []) as Array<{ url?: string }>;
  for (const att of attachments) {
    if (att?.url?.startsWith('/uploads/')) {
      filesToDelete.push(att.url.replace(/^\/uploads\//, ''));
    }
  }

  const deletedAt = new Date().toISOString();
  await deps.db
    .update(messages)
    .set({ deletedAt, text: '', mediaUrl: null, attachments: null })
    .where(eq(messages.id, args.messageId));

  // Fire-and-forget blob cleanup AFTER the DB update commits.
  for (const filename of filesToDelete) {
    deps.storage.delete(filename).catch((err: unknown) => {
      logger.warn(
        { messageId: args.messageId, filename, err: err instanceof Error ? err.message : String(err) },
        '[messageLifecycle.delete] storage.delete failed',
      );
    });
  }

  return {
    ok: true,
    data: { messageId: args.messageId, deletedAt },
    effects: [
      {
        type: 'emit',
        rooms: [Rooms.ticket(args.ticketId)],
        event: 'message:deleted',
        payload: { ticketId: args.ticketId, messageId: args.messageId, deletedAt },
      },
      { type: 'notifyPreviewers', ticketId: args.ticketId },
    ],
  };
}
