import config from '../config.js';

/**
 * Throws if NODE_ENV === 'production'. Used at module-load by files that
 * must never exist in a production build (test fixtures, dev-only routes).
 *
 * Pattern: import this util at the very top of a file and call it
 * unconditionally. Production server boots fail fast on import — there is
 * no path where the file's exports are reachable at runtime in prod.
 */
export function assertNotProduction(reason?: string): void {
  if (config.NODE_ENV === 'production') {
    throw new Error(
      `Production-restricted module loaded${reason ? `: ${reason}` : ''}. ` +
        `This file must not be imported when NODE_ENV=production.`,
    );
  }
}
