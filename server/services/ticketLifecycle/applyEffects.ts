/**
 * Transport-side effect dispatcher. Lives in the lifecycle module so call
 * sites don't reinvent fanout logic per handler. The lifecycle module
 * itself never imports `socket.io`; the dispatcher is the one place that
 * does.
 */
import type { Server } from 'socket.io';
import logger from '../../utils/logger.js';
import { Rooms } from '../../utils/rooms.js';
import { broadcastQueuePositions } from '../businessHours.js';
import { invalidateSummary as invalidateAiSummary } from '../ai/summaryCache.js';
import { unfurlLinks } from '../linkPreview.js';
import { updateMessageLinkPreviews } from '../messageQueries.js';
import type { Effect } from './types.js';

/**
 * Dispatches the post-commit effect array. Errors during dispatch are
 * logged but never thrown — the lifecycle event has already committed; a
 * failed broadcast must not appear to the caller as a lifecycle failure.
 *
 * Call this AFTER the lifecycle returns `{ ok: true, effects }`. Calling
 * it on `{ ok: false }` is a programming error (no effects exist).
 */
export function applyEffects(io: Server, effects: Effect[]): void {
  for (const effect of effects) {
    try {
      switch (effect.type) {
        case 'emit': {
          if (effect.rooms.length === 0) break;
          // Chain `.to(room)` so socket.io de-duplicates by socket id —
          // emitting once per room would double-deliver to anyone in
          // multiple rooms (very common: support agents sit in both the
          // ticket room and the staff room).
          let target = io.to(effect.rooms[0]);
          for (let i = 1; i < effect.rooms.length; i++) {
            target = target.to(effect.rooms[i]);
          }
          target.emit(effect.event, effect.payload);
          break;
        }
        case 'notifyPreviewers':
          io.to(Rooms.ticketPreview(effect.ticketId)).emit('ticket:preview:invalidate', {
            ticketId: effect.ticketId,
          });
          break;
        case 'broadcastQueue':
          // Fire-and-forget — the queue rebroadcast is a best-effort
          // post-commit nicety. We swallow the promise here so a slow
          // broadcast can't extend the latency of the original event;
          // the broadcastQueuePositions helper logs its own errors.
          void broadcastQueuePositions(effect.partnerId);
          break;
        case 'evictSupportFromRoom': {
          // Force every support / admin / platform_operator socket out of
          // the ticket room. After a department transfer, the prior
          // support staff should not keep receiving the ticket's
          // message:new / typing events — the new department's queue
          // owns it now.
          const room = Rooms.ticket(effect.ticketId);
          void io.in(room).fetchSockets().then((sockets) => {
            for (const s of sockets) {
              if (s.data.isSupport) s.leave(room);
            }
          }).catch((err: unknown) => {
            logger.error(
              { err: err instanceof Error ? err.message : String(err), ticketId: effect.ticketId },
              '[lifecycle] evictSupportFromRoom failed',
            );
          });
          break;
        }
        case 'whisperEmit': {
          // Local-node iteration: fetchSockets() returns RemoteSocket stubs
          // whose .data.isSupport is not reliably set across the Redis
          // adapter. Walk the local sockets map directly. Same pattern as
          // the legacy `message:send` whisper fan-out (CR-01).
          const room = Rooms.ticket(effect.ticketId);
          for (const peer of io.sockets.sockets.values()) {
            if (!peer.rooms.has(room)) continue;
            if (peer.data.isSupport) peer.emit(effect.event, effect.payload);
          }
          break;
        }
        case 'slaResolved':
          io.to(Rooms.ticket(effect.ticketId)).emit('sla:resolved', {
            ticketId: effect.ticketId,
            partnerId: effect.partnerId,
            respondedInMinutes: effect.respondedInMinutes,
          });
          break;
        case 'invalidateSummary':
          // Fire-and-forget — the AI summary cache bust is a best-effort
          // post-commit nicety; the helper logs its own errors.
          void invalidateAiSummary(effect.ticketId).catch(() => {});
          break;
        case 'unfurlLinks': {
          // Background: extract OG metadata, persist on the message row,
          // then emit `message:linkPreview` to the ticket room. Failure
          // here must not impact the original send — it's logged and
          // dropped.
          const ticketRoom = Rooms.ticket(effect.ticketId);
          const messageId = effect.messageId;
          const ticketId = effect.ticketId;
          void unfurlLinks(effect.text).then(async (previews) => {
            if (previews.length === 0) return;
            await updateMessageLinkPreviews(messageId, previews);
            io.to(ticketRoom).emit('message:linkPreview', {
              ticketId,
              messageId,
              linkPreviews: previews,
            });
          }).catch((err: unknown) => {
            logger.error(
              { err: err instanceof Error ? err.message : String(err), ticketId, messageId },
              '[lifecycle] unfurlLinks failed',
            );
          });
          break;
        }
        default: {
          // Exhaustiveness check — TypeScript will complain when a new
          // Effect variant is added without a handler.
          const _exhaustive: never = effect;
          logger.warn({ effect: _exhaustive }, '[lifecycle] unknown effect type');
        }
      }
    } catch (err) {
      logger.error(
        { err: err instanceof Error ? err.message : String(err), effect },
        '[lifecycle] effect dispatch failed',
      );
    }
  }
}
