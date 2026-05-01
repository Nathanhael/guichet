// server/services/moderator/repetition.ts
import type { RedisClientType } from 'redis';
import { getRepetitionCount } from '../repetitionStore.js';

export interface RepetitionObservation {
  senderId: string;
  partnerId: string;
  text: string;
}

export interface RepetitionPort {
  /**
   * Record an observation of `text` from `senderId` and return the
   * count of consecutive identical observations within the TTL window.
   * MAY throw on infra error — the Moderator catches and fails open.
   */
  observe(input: RepetitionObservation): Promise<{ count: number }>;
}

/**
 * Redis dep type matches `utils/redis.ts`'s `RedisClient` alias. The two
 * `RedisClientType` declarations the SDK exposes (one carries the modules
 * generic, one doesn't) trip equivalence checks; the cast in `observe`
 * mirrors the pattern in `messageLifecycle/adapters/redisRepetitionAdapter`.
 */
export interface RedisRepetitionDeps {
  redis: RedisClientType | null;
}

export class RedisRepetition implements RepetitionPort {
  constructor(private readonly deps: RedisRepetitionDeps) {}

  async observe(input: RepetitionObservation): Promise<{ count: number }> {
    const normalized = input.text.trim().toLowerCase();
    const count = await getRepetitionCount(
      this.deps.redis as Parameters<typeof getRepetitionCount>[0],
      input.senderId,
      normalized,
    );
    return { count };
  }
}
