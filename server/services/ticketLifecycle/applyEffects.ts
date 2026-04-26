/**
 * Transport-side effect dispatcher. Lives in the lifecycle module so call
 * sites don't reinvent fanout logic per handler. The lifecycle module
 * itself never imports `socket.io`; the dispatcher is the one place that
 * does.
 */
import type { Server } from 'socket.io';
import logger from '../../utils/logger.js';
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
        case 'emit':
          io.to(effect.room).emit(effect.event, effect.payload);
          break;
        default: {
          // Exhaustiveness check — TypeScript will complain when a new
          // Effect variant is added without a handler.
          const _exhaustive: never = effect.type;
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
