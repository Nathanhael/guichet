/**
 * Shared Redis client for the AI service layer.
 * Used by rate limiter, summary cache, and any future AI caching needs.
 * Avoids creating multiple Redis connections.
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
