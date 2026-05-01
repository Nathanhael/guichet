// server/services/availability/instance.ts
import type { Availability } from './index.js';

let instance: Availability | null = null;

export function setAvailability(a: Availability): void {
  instance = a;
}

export function getAvailability(): Availability {
  if (!instance) {
    throw new Error(
      'Availability not initialized. setAvailability() must run before any availability-dependent path.',
    );
  }
  return instance;
}

/** Test-only: reset between suites. */
export function __resetAvailability(): void {
  instance = null;
}
