import { createClient } from 'redis';
import logger from '../utils/logger.js';

const REPETITION_TTL = 300; // 5 minutes

export async function getRepetitionCount(redisClient: ReturnType<typeof createClient> | null, senderId: string, text: string): Promise<number> {
  if (!redisClient) {
    // Fallback to in-memory (dev/test)
    return fallbackGet(senderId, text);
  }
  
  try {
    const key = `rep:${senderId}`;
    const countKey = `rep:count:${senderId}`;
    
    const storedText = await redisClient.get(key);
    
    if (storedText === text) {
      const count = await redisClient.incr(countKey);
      await redisClient.expire(countKey, REPETITION_TTL);
      return count;
    }
    
    // New text or no previous text, reset
    await redisClient.set(key, text, { EX: REPETITION_TTL });
    await redisClient.set(countKey, '1', { EX: REPETITION_TTL });
    return 1;
  } catch (err) {
    logger.error({ err: err instanceof Error ? err.message : String(err) }, 'Redis repetition check failed, using fallback');
    return fallbackGet(senderId, text);
  }
}

// In-memory fallback
const fallbackStore = new Map<string, { text: string; count: number }>();

function fallbackGet(senderId: string, text: string): number {
  const entry = fallbackStore.get(senderId);
  if (entry && entry.text === text) {
    entry.count++;
    return entry.count;
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
