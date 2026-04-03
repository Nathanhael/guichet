import { Server } from 'socket.io';
import { getRedisClients } from '../utils/redis.js';
import logger from '../utils/logger.js';
import type { UserRole } from '../types/index.js';
import { canUseSupportWorkflows } from './roles.js';

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
      if (data && data.userId && canUseSupportWorkflows(data.role as UserRole, data.isPlatformOperator === '1')) {
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

export async function identifyUser(userId: string, role: string, name: string, partnerId: string, isPlatformOperator = false) {
  const { pubClient } = getRedisClients();
  if (!pubClient) return;

  const key = hashKey(partnerId, userId);
  const sKey = setKey(partnerId);
  try {
    // Atomic Lua script: check existence, set fields, manage count, refresh TTL,
    // and update partner set — all in one Redis round-trip (no TOCTOU gap).
    const luaScript = `
      local key = KEYS[1]
      local sKey = KEYS[2]
      local userId = ARGV[1]
      local name = ARGV[2]
      local role = ARGV[3]
      local partnerId = ARGV[4]
      local isPlatformOp = ARGV[5]
      local ttl = tonumber(ARGV[6])

      local exists = redis.call('EXISTS', key)
      if exists == 0 then
        redis.call('HSET', key,
          'userId', userId,
          'name', name,
          'role', role,
          'partnerId', partnerId,
          'isPlatformOperator', isPlatformOp,
          'status', 'available',
          'statusChangedAt', ARGV[7],
          'count', '1')
      else
        -- Preserve existing status and statusChangedAt on reconnect
        redis.call('HSET', key,
          'userId', userId,
          'name', name,
          'role', role,
          'partnerId', partnerId,
          'isPlatformOperator', isPlatformOp)
        redis.call('HINCRBY', key, 'count', 1)
      end
      redis.call('EXPIRE', key, ttl)
      redis.call('SADD', sKey, userId)
      redis.call('EXPIRE', sKey, ttl)
      return exists
    `;

    await pubClient.eval(luaScript, {
      keys: [key, sKey],
      arguments: [
        userId,
        name,
        role,
        partnerId,
        isPlatformOperator ? '1' : '0',
        String(TTL_SECONDS),
        new Date().toISOString(),
      ],
    });

    if (canUseSupportWorkflows(role as UserRole, isPlatformOperator)) {
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
      await pubClient.hSet(key, 'statusChangedAt', new Date().toISOString());
      await broadcastOnlineSupport(partnerId);
      logger.info({ userId, status }, 'User status updated in Redis');
      return true;
    }
  } catch (err) {
    logger.error({ err, userId }, 'Failed to update user status in Redis');
  }
  return false;
}

export async function getUserStatus(userId: string, partnerId: string): Promise<string | null> {
  const { pubClient } = getRedisClients();
  if (!pubClient) return null;

  const key = hashKey(partnerId, userId);
  try {
    return await pubClient.hGet(key, 'status') || null;
  } catch (err) {
    logger.error({ err, userId }, 'Failed to get user status from Redis');
    return null;
  }
}

export async function decrementUserCount(userId: string, partnerId: string) {
  const { pubClient } = getRedisClients();
  if (!pubClient) return null;

  const key = hashKey(partnerId, userId);
  const sKey = setKey(partnerId);
  try {
    // Atomic Lua: decrement count, read fields, and conditionally clean up in one round-trip.
    // Returns: [removed (0/1), role, partnerId, isPlatformOperator] or nil if key missing.
    const luaScript = `
      local key = KEYS[1]
      local sKey = KEYS[2]
      local userId = ARGV[1]

      if redis.call('EXISTS', key) == 0 then
        return nil
      end

      local newCount = redis.call('HINCRBY', key, 'count', -1)
      local role = redis.call('HGET', key, 'role') or ''
      local pid = redis.call('HGET', key, 'partnerId') or ''
      local isPlatOp = redis.call('HGET', key, 'isPlatformOperator') or '0'

      if newCount <= 0 then
        redis.call('DEL', key)
        redis.call('SREM', sKey, userId)
        return {1, role, pid, isPlatOp}
      end
      return {0, role, pid, isPlatOp}
    `;

    const result = await pubClient.eval(luaScript, {
      keys: [key, sKey],
      arguments: [userId],
    }) as [number, string, string, string] | null;

    if (!result) return null;

    const [removed, role, pid, isPlatOp] = result;
    if (removed) {
      if (canUseSupportWorkflows(role as UserRole, isPlatOp === '1')) {
        await broadcastOnlineSupport(partnerId);
      }
      return { role, partnerId: pid, removed: true };
    }
    return { role, partnerId: pid, removed: false };
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
    const partnerSetKeys: string[] = [];
    let scanCursor: string | number = 0;
    do {
      const result = await pubClient.scan(String(scanCursor), { MATCH: `${SET_PREFIX}*`, COUNT: 100 });
      scanCursor = result.cursor;
      partnerSetKeys.push(...result.keys);
    } while (Number(scanCursor) !== 0);

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
