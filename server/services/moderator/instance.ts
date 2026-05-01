// server/services/moderator/instance.ts
import type { Moderator } from './index.js';

let instance: Moderator | null = null;

/**
 * Register the boot-time Moderator instance. Called once from `app.ts`
 * after Redis init. Matches the `initAiContext` precedent.
 */
export function setModerator(mod: Moderator): void {
  instance = mod;
}

/**
 * Get the registered Moderator. Throws if `setModerator` has not been
 * called yet (i.e. the boot sequence is broken).
 *
 * Tests do NOT use this — they construct a `Moderator` (or stub) directly
 * and pass it to lifecycle factories.
 */
export function getModerator(): Moderator {
  if (!instance) {
    throw new Error(
      'Moderator not initialized. setModerator() must run before any moderator-dependent path.',
    );
  }
  return instance;
}

/** Test-only: reset between suites to avoid cross-suite leakage. */
export function __resetModerator(): void {
  instance = null;
}
