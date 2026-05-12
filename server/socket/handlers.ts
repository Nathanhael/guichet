import { Server } from 'socket.io';
import logger from '../utils/logger.js';
import { Rooms } from '../utils/rooms.js';
import type { TicketLifecycle } from '../services/ticketLifecycle/index.js';
import type { MessageLifecycle } from '../services/messageLifecycle/index.js';
import { createCommandBus } from './commandBus/index.js';
import type { HandlerContext } from './handlers/types.js';
import { setupRevocationPubSub, setupJwtMiddleware, setupIdentityMiddleware, register as registerAuth } from './handlers/auth.js';
import { register as registerTicket } from './handlers/ticket.js';
import { register as registerMessage } from './handlers/message.js';
import { register as registerPresence } from './handlers/presence.js';
import { register as registerCollision } from './handlers/collision.js';
import { register as registerPreview } from './handlers/preview.js';
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

export interface RegisterSocketHandlersDeps {
  lifecycle: TicketLifecycle;
  messageLifecycle: MessageLifecycle;
}

export function registerSocketHandlers(io: Server, deps: RegisterSocketHandlersDeps) {
  ioInstance = io;
  const bus = createCommandBus({ messageLifecycle: deps.messageLifecycle, io });
  const ctx: HandlerContext = {
    io,
    socketTickets,
    viewerKeyPrefix: VIEWER_KEY_PREFIX,
    lifecycle: deps.lifecycle,
    messageLifecycle: deps.messageLifecycle,
    bus,
  };

  setupRevocationPubSub(io);
  setupJwtMiddleware(io);
  setupIdentityMiddleware(io);

  io.on('connection', (socket) => {
    registerAuth(socket, ctx);
    registerTicket(socket, ctx);
    registerMessage(socket, ctx);
    registerPresence(socket, ctx);
    registerCollision(socket, ctx);
    registerPreview(socket, ctx);
    registerRating(socket, ctx);
    registerDisconnect(socket, ctx);
  });
}
