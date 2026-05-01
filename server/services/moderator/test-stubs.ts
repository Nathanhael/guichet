// server/services/moderator/test-stubs.ts
import type { RepetitionPort, RepetitionObservation } from './repetition.js';

/**
 * In-memory repetition counter. Mirrors RedisRepetition semantics:
 * count resets to 1 if text differs from the last observation by senderId,
 * increments otherwise. partnerId is accepted but ignored (matches today's
 * senderId-only keying).
 */
export class MemoryRepetition implements RepetitionPort {
  private readonly store = new Map<string, { text: string; count: number }>();

  async observe(input: RepetitionObservation): Promise<{ count: number }> {
    const normalized = input.text.trim().toLowerCase();
    const prev = this.store.get(input.senderId);
    if (prev && prev.text === normalized) {
      prev.count += 1;
      return { count: prev.count };
    }
    this.store.set(input.senderId, { text: normalized, count: 1 });
    return { count: 1 };
  }

  reset(senderId?: string): void {
    if (senderId) this.store.delete(senderId);
    else this.store.clear();
  }
}

/** Throws on every observe call — used to test the fail-open path. */
export class ThrowingRepetition implements RepetitionPort {
  async observe(): Promise<never> {
    throw new Error('redis offline (test stub)');
  }
}
