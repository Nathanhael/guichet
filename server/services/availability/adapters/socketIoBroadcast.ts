// server/services/availability/adapters/socketIoBroadcast.ts
import type { Server } from 'socket.io';
import logger from '../../../utils/logger.js';
import type { SupportEntry } from '../index.js';
import type { BroadcastPort } from '../ports.js';

export class SocketIoBroadcast implements BroadcastPort {
  constructor(private readonly io: Server) {}

  supportOnline(partnerId: string, roster: SupportEntry[]): void {
    try {
      this.io.to(`partner:${partnerId}`).emit('support:online', roster);
      logger.debug(
        { partnerId, count: roster.length, users: roster.map((u) => `${u.userId}:${u.status}`) },
        '[availability] supportOnline broadcast',
      );
    } catch (err) {
      logger.error({ err, partnerId }, '[availability/SocketIoBroadcast] supportOnline failed');
    }
  }

  agentsOnline(partnerId: string, ids: string[]): void {
    try {
      this.io.to(`partner:${partnerId}:staff`).emit('agents:online', ids);
      logger.debug({ partnerId, count: ids.length }, '[availability] agentsOnline broadcast');
    } catch (err) {
      logger.error({ err, partnerId }, '[availability/SocketIoBroadcast] agentsOnline failed');
    }
  }
}
