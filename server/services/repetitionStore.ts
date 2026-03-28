import { createClient } from 'redis';
import logger from '../utils/logger.js';

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

export async function getRepetitionCount(redisClient: ReturnType<typeof createClient> | null, senderId: string, text: string): Promise<number> {
  if (!redisClient) {
    // Fallback to in-memory (dev/test)
    return fallbackGet(senderId, text);
  }

  try {
    const key = `rep:${senderId}`;
    const countKey = `rep:count:${senderId}`;

    const result = await redisClient.eval(LUA_CHECK_AND_COUNT, {
      keys: [key, countKey],
      arguments: [text, String(REPETITION_TTL)],
    });

    return typeof result === 'number' ? result : Number(result) || 1;
  } catch (err) {
    logger.error({ err: err instanceof Error ? err.message : String(err) }, 'Redis repetition check failed, using fallback');
    return fallbackGet(senderId, text);
  }
}

// In-memory fallback with size limits to prevent unbounded growth
const MAX_FALLBACK_ENTRIES = 10000;
const fallbackStore = new Map<string, { text: string; count: number }>();

function fallbackGet(senderId: string, text: string): number {
  const entry = fallbackStore.get(senderId);
  if (entry && entry.text === text) {
    entry.count++;
    return entry.count;
  }
  // Evict oldest entries if store is too large
  if (fallbackStore.size >= MAX_FALLBACK_ENTRIES) {
    const firstKey = fallbackStore.keys().next().value;
    if (firstKey) fallbackStore.delete(firstKey);
  }
  fallbackStore.set(senderId, { text, count: 1 });
  return 1;
}

export function resetFallbackStore(senderId?: string): void {
  if (senderId) {
    fallbackStore.delete(senderId);
  } else {
    fallbackStore.clear();
  }
}
