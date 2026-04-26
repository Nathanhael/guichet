/**
 * Transport-side effect dispatcher. Lives in the lifecycle module so call
 * sites don't reinvent fanout logic per handler. The lifecycle module
 * itself never imports `socket.io`; the dispatcher is the one place that
 * does.
 */
import type { Server } from 'socket.io';
import logger from '../../utils/logger.js';
import { Rooms } from '../../utils/rooms.js';
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
