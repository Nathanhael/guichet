import { Server } from 'socket.io';
import { getRedisClients } from '../utils/redis.js';
import logger from '../utils/logger.js';

export interface OnlineUser {
  userId: string;
  name: string;
  role: string;
  status: string;
  partnerId: string;
  count: number;
}

interface SupportEntry {
  userId: string;
  name: string;
  status: string;
}

let io: Server | null = null;

const HASH_PREFIX = 'presence:';
const SET_PREFIX = 'partner:presence:';
const TTL_SECONDS = 86400;

function hashKey(partnerId: string, userId: string): string {
  return `${HASH_PREFIX}${partnerId}:${userId}`;
}

function setKey(partnerId: string): string {
  return `${SET_PREFIX}${partnerId}`;
}

export function setIo(socketIo: Server) {
  io = socketIo;
}

export async function broadcastOnlineSupport(partnerId: string) {
  const { pubClient } = getRedisClients();
  if (!io || !pubClient) return;

  try {
    const memberIds = await pubClient.sMembers(setKey(partnerId));
    if (memberIds.length === 0) {
      io.to(`partner:${partnerId}`).emit('support:online', []);
      return;
    }

    // Pipeline all hGetAll calls in one batch
    const pipeline = pubClient.multi();
    for (const uid of memberIds) {
      pipeline.hGetAll(hashKey(partnerId, uid));
    }
    const results = await pipeline.exec();

    const list: SupportEntry[] = [];
    for (const result of results) {
      const data = result as unknown as Record<string, string>;
      if (data && data.userId && (data.role === 'support' || data.role === 'admin')) {
        list.push({
          userId: data.userId,
          name: data.name,
          status: data.status || 'available',
        });
      }
    }

    io.to(`partner:${partnerId}`).emit('support:online', list);
  } catch (err) {
    logger.error({ err }, 'Failed to broadcast online support from Redis');
  }
}

export async function identifyUser(userId: string, role: string, name: string, partnerId: string) {
  const { pubClient } = getRedisClients();
  if (!pubClient) return;

  const key = hashKey(partnerId, userId);
  const sKey = setKey(partnerId);
  try {
    const exists = await pubClient.exists(key);
    if (exists) {
      await pubClient.hIncrBy(key, 'count', 1);
    } else {
      await pubClient.hSet(key, {
        userId,
        name,
        role,
        partnerId,
        status: 'available',
        count: '1',
      });
      await pubClient.expire(key, TTL_SECONDS);
    }

    // Add userId to partner set and refresh TTL
    await pubClient.sAdd(sKey, userId);
    await pubClient.expire(sKey, TTL_SECONDS);

    if (role === 'support' || role === 'admin') {
      await broadcastOnlineSupport(partnerId);
    }
  } catch (err) {
    logger.error({ err, userId }, 'Failed to identify user in Redis');
  }
}

export async function setUserStatus(userId: string, partnerId: string, status: string) {
  const { pubClient } = getRedisClients();
  if (!pubClient) return false;

  const key = hashKey(partnerId, userId);
  try {
    const user = await pubClient.hGetAll(key);
    if (user && user.userId) {
      await pubClient.hSet(key, 'status', status);
      await broadcastOnlineSupport(partnerId);
      logger.info({ userId, status }, 'User status updated in Redis');
      return true;
    }
  } catch (err) {
    logger.error({ err, userId }, 'Failed to update user status in Redis');
  }
  return false;
}

export async function decrementUserCount(userId: string, partnerId: string) {
  const { pubClient } = getRedisClients();
  if (!pubClient) return null;

  const key = hashKey(partnerId, userId);
  try {
    const user = await pubClient.hGetAll(key);
    if (!user || !user.userId) return null;

    const newCount = await pubClient.hIncrBy(key, 'count', -1);
    if (newCount <= 0) {
      await pubClient.del(key);
      await pubClient.sRem(setKey(partnerId), userId);
      if (user.role === 'support' || user.role === 'admin') {
        await broadcastOnlineSupport(partnerId);
      }
      return { role: user.role, partnerId: user.partnerId, removed: true };
    }
    return { role: user.role, partnerId: user.partnerId, removed: false };
  } catch (err) {
    logger.error({ err, userId }, 'Failed to decrement user count in Redis');
  }
  return null;
}

/**
 * Helper to get all online users for a specific partner (used by internal services)
 */
export async function getOnlineUsersForPartner(partnerId: string): Promise<OnlineUser[]> {
  const { pubClient } = getRedisClients();
  if (!pubClient) return [];

  try {
    const memberIds = await pubClient.sMembers(setKey(partnerId));
    if (memberIds.length === 0) return [];

    // Pipeline all hGetAll calls in one batch
    const pipeline = pubClient.multi();
    for (const uid of memberIds) {
      pipeline.hGetAll(hashKey(partnerId, uid));
    }
    const results = await pipeline.exec();

    const list: OnlineUser[] = [];
    for (const result of results) {
      const data = result as unknown as Record<string, string>;
      if (data && data.userId) {
        list.push({
          userId: data.userId,
          name: data.name,
          role: data.role,
          status: data.status,
          partnerId: data.partnerId,
          count: parseInt(data.count, 10),
        });
      }
    }
    return list;
  } catch (err) {
    logger.error({ err, partnerId }, 'Failed to get online users for partner');
    return [];
  }
}

/**
 * Cleanup stale presence Set entries whose hashes have expired.
 * Safe to call periodically — uses KEYS on the small partner:presence:* namespace only.
 */
export async function cleanupStalePresence() {
  const { pubClient } = getRedisClients();
  if (!pubClient) return;

  try {
    const partnerSetKeys = await pubClient.keys(`${SET_PREFIX}*`);
    let totalRemoved = 0;
    let totalChecked = 0;

    for (const pSetKey of partnerSetKeys) {
      const partnerId = pSetKey.slice(SET_PREFIX.length);
      const memberIds = await pubClient.sMembers(pSetKey);
      totalChecked += memberIds.length;

      if (memberIds.length === 0) continue;

      // Pipeline existence checks
      const pipeline = pubClient.multi();
      for (const uid of memberIds) {
        pipeline.exists(hashKey(partnerId, uid));
      }
      const results = await pipeline.exec();

      const staleIds: string[] = [];
      for (let i = 0; i < memberIds.length; i++) {
        if ((results[i] as unknown as number) === 0) {
          staleIds.push(memberIds[i]);
        }
      }

      if (staleIds.length > 0) {
        await pubClient.sRem(pSetKey, staleIds);
        totalRemoved += staleIds.length;
      }
    }

    logger.info(
      { totalChecked, totalRemoved, partnerSets: partnerSetKeys.length },
      'Presence stale cleanup completed'
    );
  } catch (err) {
    logger.error({ err }, 'Failed to cleanup stale presence entries');
  }
}
