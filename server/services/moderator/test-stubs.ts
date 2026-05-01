// server/services/moderator/test-stubs.ts
import type {
  GuardCode,
  ModerationPort,
  ModerationResult,
} from './index.js';
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

// ─── ModerationPort stubs (consumed by lifecycle tests) ──────────────────

/** Always passes. The default for happy-path lifecycle tests. */
export function passingModerator(): ModerationPort {
  return {
    async moderate(text): Promise<ModerationResult> {
      return {
        decision: 'pass',
        blockingCode: null,
        original: text,
        sanitized: text.trim(),
        triggered: [],
      };
    },
  };
}

/** Always blocks with the given code. Triggered echoes the blocking code. */
export function blockingModerator(blockingCode: GuardCode = 'guard_offensive'): ModerationPort {
  return {
    async moderate(text): Promise<ModerationResult> {
      return {
        decision: 'block',
        blockingCode,
        original: text,
        sanitized: text,
        triggered: [blockingCode],
      };
    },
  };
}

/** Returns a fully canned ModerationResult — caller controls every field. */
export function cannedModerator(result: Partial<ModerationResult>): ModerationPort {
  return {
    async moderate(text): Promise<ModerationResult> {
      return {
        decision: result.decision ?? 'pass',
        blockingCode: result.blockingCode ?? null,
        original: result.original ?? text,
        sanitized: result.sanitized ?? text,
        triggered: result.triggered ?? [],
      };
    },
  };
}
