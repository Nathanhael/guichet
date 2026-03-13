import { createClient } from 'redis';
import config from '../config.js';
import logger from './logger.js';

let pubClient: any = null;
let subClient: any = null;

export async function initRedis() {
  if (!config.REDIS_URL) return { pubClient: null, subClient: null };

  if (!pubClient) {
    pubClient = createClient({ url: config.REDIS_URL });
    subClient = pubClient.duplicate();

    pubClient.on('error', (err: any) => logger.error({ err }, 'Redis Pub Client Error'));
    subClient.on('error', (err: any) => logger.error({ err }, 'Redis Sub Client Error'));

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
