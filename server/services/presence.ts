import { Server } from 'socket.io';
import logger from '../utils/logger.js';

export interface OnlineUser {
  userId: string;
  name: string;
  role: string;
  status: string;
  count: number;
}

const onlineUsers = new Map<string, OnlineUser>();
let io: Server | null = null;

export function setIo(socketIo: Server) {
  io = socketIo;
}

export function getOnlineUsers() {
  return onlineUsers;
}

export function broadcastOnlineExperts() {
  if (!io) return;
  const list = [...onlineUsers.values()]
    .filter(u => u.role === 'expert')
    .map(({ userId, name, status }) => ({ 
      userId, 
      name, 
      status: status || 'available' 
    }));
  io.emit('experts:online', list);
}

export function identifyUser(userId: string, role: string, name: string) {
  if (onlineUsers.has(userId)) {
    onlineUsers.get(userId)!.count++;
  } else {
    onlineUsers.set(userId, { 
      userId, 
      name, 
      role, 
      status: 'available', 
      count: 1 
    });
  }
}

export function setUserStatus(userId: string, status: string) {
  const user = onlineUsers.get(userId);
  if (user) {
    user.status = status;
    broadcastOnlineExperts();
    logger.info({ userId, status }, 'User status updated');
    return true;
  }
  return false;
}

export function decrementUserCount(userId: string) {
  if (onlineUsers.has(userId)) {
    const u = onlineUsers.get(userId)!;
    u.count--;
    if (u.count <= 0) {
      onlineUsers.delete(userId);
      return { role: u.role, removed: true };
    }
    return { role: u.role, removed: false };
  }
  return null;
}
