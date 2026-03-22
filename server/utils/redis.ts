import { createClient, RedisClientType } from 'redis';
import config from '../config.js';
import logger from './logger.js';

type RedisClient = RedisClientType;

let pubClient: RedisClient | null = null;
let subClient: RedisClient | null = null;

export async function initRedis() {
  if (!config.REDIS_URL) return { pubClient: null, subClient: null };

  if (!pubClient) {
    pubClient = createClient({
      url: config.REDIS_URL,
      socket: {
        reconnectStrategy(retries: number) {
          const delay = Math.min(retries * 50, 3000);
          logger.info({ retries, delay }, 'Redis reconnecting');
          return delay;
        },
      },
    }) as RedisClient;
    subClient = pubClient.duplicate() as RedisClient;

    pubClient.on('error', (err: Error) => logger.error({ err }, 'Redis Pub Client Error'));
    subClient.on('error', (err: Error) => logger.error({ err }, 'Redis Sub Client Error'));

    try {
      await Promise.all([pubClient.connect(), subClient.connect()]);
      logger.info('Redis clients connected');
    } catch (err) {
      logger.warn({ err }, 'Failed to connect to Redis.');
      pubClient = null;
      subClient = null;
    }
  }

  return { pubClient, subClient };
}

export function getRedisClients() {
  return { pubClient, subClient };
}
