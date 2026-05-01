// server/services/availability/context.ts
import type { Availability } from './availability.js';

let instance: Availability | null = null;

/** Initialize the singleton. Called once from app.ts after DB, Redis, and Socket.io are ready. */
export function initAvailability(av: Availability): void {
  instance = av;
}

/** Get the singleton. Throws if not initialized. */
export function getAvailability(): Availability {
  if (!instance) throw new Error('Availability not initialized. Call initAvailability() first.');
  return instance;
}

/** Test-only: reset for unit tests that mount their own instance. */
export function __resetAvailabilityForTests(): void {
  instance = null;
}
