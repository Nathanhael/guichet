// server/services/availability/adapters/socketIoBroadcast.ts
import type { Server } from 'socket.io';
import type { BroadcastPort } from '../ports.js';
import type { AgentStatus } from '../types.js';

interface Deps {
  io: Server;
  logger: { debug: (obj: unknown, msg?: string) => void };
}

export class SocketIoBroadcast implements BroadcastPort {
  constructor(private deps: Deps) {}

  supportOnline(partnerId: string, roster: { userId: string; name: string; status: AgentStatus }[]) {
    this.deps.io.to(`partner:${partnerId}`).emit('support:online', roster);
    this.deps.logger.debug({ partnerId, count: roster.length }, '[availability] supportOnline broadcast');
  }

  agentsOnline(partnerId: string, ids: string[]) {
    this.deps.io.to(`partner:${partnerId}:staff`).emit('agents:online', ids);
    this.deps.logger.debug({ partnerId, count: ids.length }, '[availability] agentsOnline broadcast');
  }
}
