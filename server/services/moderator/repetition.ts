// server/services/moderator/repetition.ts
import type { RedisClientType } from 'redis';
import logger from '../../utils/logger.js';

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
 * generic, one doesn't) trip equivalence checks; the cast inside the Lua
 * eval call keeps the boundary clean.
 */
export interface RedisRepetitionDeps {
  redis: RedisClientType | null;
}

const REPETITION_TTL = parseInt(process.env.REPETITION_TTL_SECS || '300', 10); // default 5 minutes

// Atomic Lua script: check stored text and increment counter in a single round-trip.
// KEYS[1] = text key, KEYS[2] = count key
// ARGV[1] = incoming text, ARGV[2] = TTL seconds
const LUA_CHECK_AND_COUNT = `
local stored = redis.call('GET', KEYS[1])
if stored == ARGV[1] then
  local count = redis.call('INCR', KEYS[2])
  redis.call('EXPIRE', KEYS[2], ARGV[2])
  return count
else
  redis.call('SET', KEYS[1], ARGV[1], 'EX', ARGV[2])
  redis.call('SET', KEYS[2], '1', 'EX', ARGV[2])
  return 1
end
`;

// In-memory fallback with size limits to prevent unbounded growth.
// Used when the redis client is null (dev / first-boot before connect /
// connect failure) or when the Lua eval throws transiently.
const MAX_FALLBACK_ENTRIES = 10000;
const fallbackStore = new Map<string, { text: string; count: number }>();

function fallbackGet(senderId: string, text: string): number {
  const entry = fallbackStore.get(senderId);
  if (entry && entry.text === text) {
    entry.count++;
    return entry.count;
  }
  if (fallbackStore.size >= MAX_FALLBACK_ENTRIES) {
    const firstKey = fallbackStore.keys().next().value;
    if (firstKey) fallbackStore.delete(firstKey);
  }
  fallbackStore.set(senderId, { text, count: 1 });
  return 1;
}

/** Test-only escape hatch — reset the in-memory fallback store. */
export function __resetFallbackStore(senderId?: string): void {
  if (senderId) {
    fallbackStore.delete(senderId);
  } else {
    fallbackStore.clear();
  }
}

export class RedisRepetition implements RepetitionPort {
  constructor(private readonly deps: RedisRepetitionDeps) {}

  async observe(input: RepetitionObservation): Promise<{ count: number }> {
    const normalized = input.text.trim().toLowerCase();
    const count = await this.observeRedis(input.senderId, normalized);
    return { count };
  }

  private async observeRedis(senderId: string, text: string): Promise<number> {
    if (!this.deps.redis) {
      return fallbackGet(senderId, text);
    }

    try {
      const key = `rep:${senderId}`;
      const countKey = `rep:count:${senderId}`;
      const result = await this.deps.redis.eval(LUA_CHECK_AND_COUNT, {
        keys: [key, countKey],
        arguments: [text, String(REPETITION_TTL)],
      });
      return typeof result === 'number' ? result : Number(result) || 1;
    } catch (err) {
      logger.error(
        { err: err instanceof Error ? err.message : String(err) },
        'Redis repetition check failed, using fallback',
      );
      return fallbackGet(senderId, text);
    }
  }
}
