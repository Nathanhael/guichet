import { Server } from 'socket.io';
import logger from '../utils/logger.js';
import { socketioConnectionsActive } from '../utils/metrics.js';
import { Rooms } from '../utils/rooms.js';
import type { HandlerContext } from './handlers/types.js';
import { setupRevocationPubSub, setupJwtMiddleware, register as registerAuth } from './handlers/auth.js';
import { register as registerTicket } from './handlers/ticket.js';
import { register as registerMessage } from './handlers/message.js';
import { register as registerPresence } from './handlers/presence.js';
import { register as registerCollision } from './handlers/collision.js';
import { register as registerRating } from './handlers/rating.js';
import { register as registerDisconnect } from './handlers/disconnect.js';

const VIEWER_KEY_PREFIX = 'ticket:viewers:';
const socketTickets = new Map<string, Set<string>>();
let ioInstance: Server | null = null;

export function broadcastPartnerDeactivation(partnerId: string) {
  if (!ioInstance) return;
  ioInstance.to(Rooms.partner(partnerId)).emit('partner:deactivated', { partnerId });
}

export function broadcastUserDeactivation(userId: string) {
  if (!ioInstance) return;
  logger.info({ userId }, '[socket] Broadcasting user deactivation kill switch');
  ioInstance.to(Rooms.user(userId)).emit('user:deactivated', { userId });
}

export function registerSocketHandlers(io: Server) {
  ioInstance = io;
  const ctx: HandlerContext = { io, socketTickets, viewerKeyPrefix: VIEWER_KEY_PREFIX };

  setupRevocationPubSub(io);
  setupJwtMiddleware(io);

  io.on('connection', (socket) => {
    socketioConnectionsActive.inc();
    registerAuth(socket, ctx);
    registerTicket(socket, ctx);
    registerMessage(socket, ctx);
    registerPresence(socket, ctx);
    registerCollision(socket, ctx);
    registerRating(socket, ctx);
    registerDisconnect(socket, ctx);
  });
}
