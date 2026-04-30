// server/services/moderator/repetition.ts
import type { createClient } from 'redis';
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

export interface RedisRepetitionDeps {
  redis: ReturnType<typeof createClient> | null;
}

export class RedisRepetition implements RepetitionPort {
  constructor(private readonly deps: RedisRepetitionDeps) {}

  async observe(input: RepetitionObservation): Promise<{ count: number }> {
    const normalized = input.text.trim().toLowerCase();
    const count = await getRepetitionCount(
      this.deps.redis,
      input.senderId,
      normalized,
    );
    return { count };
  }
}
