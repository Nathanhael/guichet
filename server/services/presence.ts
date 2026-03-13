import { Server } from 'socket.io';
import { pubClient } from '../app.js';
import logger from '../utils/logger.js';

export interface OnlineUser {
  userId: string;
  name: string;
  role: string;
  status: string;
  partnerId: string;
  count: number;
}

let io: Server | null = null;

const REDIS_PREFIX = 'presence:';

export function setIo(socketIo: Server) {
  io = socketIo;
}

export async function broadcastOnlineExperts(partnerId: string) {
  if (!io || !pubClient) return;
  
  try {
    const keys = await pubClient.keys(`${REDIS_PREFIX}*`);
    const list: any[] = [];
    
    for (const key of keys) {
      const data = await pubClient.hGetAll(key);
      if (data && data.partnerId === partnerId && (data.role === 'support' || data.role === 'expert' || data.role === 'admin')) {
        list.push({
          userId: data.userId,
          name: data.name,
          status: data.status || 'available'
        });
      }
    }
    
    // Broadcast to partner-specific room
    io.to(`partner:${partnerId}`).emit('experts:online', list);
  } catch (err) {
    logger.error({ err }, 'Failed to broadcast online experts from Redis');
  }
}

export async function identifyUser(userId: string, role: string, name: string, partnerId: string) {
  if (!pubClient) return;
  
  const key = `${REDIS_PREFIX}${userId}`;
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
        count: '1'
      });
      // Set expiration to 24h just in case of cleanup failure
      await pubClient.expire(key, 86400);
    }
    
    if (role === 'support' || role === 'expert' || role === 'admin') {
      await broadcastOnlineExperts(partnerId);
    }
  } catch (err) {
    logger.error({ err, userId }, 'Failed to identify user in Redis');
  }
}

export async function setUserStatus(userId: string, status: string) {
  if (!pubClient) return false;
  
  const key = `${REDIS_PREFIX}${userId}`;
  try {
    const user = await pubClient.hGetAll(key);
    if (user && user.userId) {
      await pubClient.hSet(key, 'status', status);
      await broadcastOnlineExperts(user.partnerId);
      logger.info({ userId, status }, 'User status updated in Redis');
      return true;
    }
  } catch (err) {
    logger.error({ err, userId }, 'Failed to update user status in Redis');
  }
  return false;
}

export async function decrementUserCount(userId: string) {
  if (!pubClient) return null;
  
  const key = `${REDIS_PREFIX}${userId}`;
  try {
    const user = await pubClient.hGetAll(key);
    if (!user || !user.userId) return null;
    
    const newCount = await pubClient.hIncrBy(key, 'count', -1);
    if (newCount <= 0) {
      await pubClient.del(key);
      if (user.role === 'support' || user.role === 'expert' || user.role === 'admin') {
        await broadcastOnlineExperts(user.partnerId);
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
  if (!pubClient) return [];
  const keys = await pubClient.keys(`${REDIS_PREFIX}*`);
  const list: OnlineUser[] = [];
  for (const key of keys) {
    const data = await pubClient.hGetAll(key);
    if (data && data.partnerId === partnerId) {
      list.push({
        userId: data.userId,
        name: data.name,
        role: data.role,
        status: data.status,
        partnerId: data.partnerId,
        count: parseInt(data.count)
      });
    }
  }
  return list;
}
