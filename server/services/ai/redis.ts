/**
 * Shared Redis client for the AI service layer.
 * Used by rate limiter, summary cache, and any future AI caching needs.
 *
 * HI-08 NOTE: This creates a THIRD independent Redis connection, separate from:
 *   1. server/utils/redis.ts — main app Redis (pubClient + subClient for Socket.io adapter)
 *   2. Socket.io Redis adapter — uses pubClient/subClient from utils/redis.ts
 * All three connect to the same Redis instance. Consider consolidating into a single
 * connection factory with namespace prefixing to reduce connection count and simplify monitoring.
 */
import { createClient } from 'redis';
import config from '../../config.js';
import logger from '../../utils/logger.js';

let redis: ReturnType<typeof createClient> | null = null;

export async function getAiRedis() {
  if (!redis) {
    redis = createClient({ url: config.REDIS_URL });
    redis.on('error', (err) => logger.error({ err: err.message }, 'AI Redis error'));
    await redis.connect();
  }
  return redis;
}
