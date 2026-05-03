import { Socket } from 'socket.io';
import logger from '../../utils/logger.js';
import { getAvailability } from '../../services/availability/index.js';
import { broadcastAgentStatus } from '../../services/businessHours.js';
import { removeViewerFromAll, broadcastViewers } from './collision.js';
import { type HandlerContext } from './types.js';

export function register(socket: Socket, ctx: HandlerContext): void {
  socket.on('disconnect', async () => {
    // Slice #70: disconnect cleanup intentionally reads `socket.data.*` directly
    // instead of going through `socketActor(socket)`. The canonical actor
    // builder emits an `error` event on missing identity, which is pointless
    // here — the socket has already gone. We just need userId/partnerId to
    // look up presence state, and skip cleanup if either is absent (e.g. the
    // socket disconnected before completing `socket:identify`).
    const userId = socket.data.userId;
    const partnerId = socket.data.partnerId;
    const userName = socket.data.name;

    // Clear typing indicators for all ticket rooms this socket was in
    if (userId && userName) {
      for (const room of socket.rooms) {
        if (room.startsWith('ticket:')) {
          const ticketId = room.replace('ticket:', '');
          socket.to(room).emit('typing:update', { ticketId, senderName: userName, typing: false });
        }
      }
    }

    // Clear viewer tracking for this socket and broadcast updates
    const affectedTickets = await removeViewerFromAll(ctx.viewerKeyPrefix, ctx.socketTickets, socket.id);
    for (const ticketId of affectedTickets) {
      await broadcastViewers(ctx.viewerKeyPrefix, ctx.io, ticketId);
    }

    if (userId && partnerId) {
      try {
        const result = await getAvailability().socket.detach({ userId, partnerId, socketId: socket.id });
        if (result.fullyOffline && result.role === 'agent') {
          broadcastAgentStatus(userId, false);
          // socket.detach broadcasts the updated agents:online roster; broadcastAgentStatus
          // is a separate businessHours signal for this specific user going offline — keep it.
        }
        // Note: closeOpenRow on full-offline is now handled inside availability.socket.detach
        // (added in slice 3 — opens row on first attach, closes on last detach).
      } catch (err) {
        // M-06: Don't let presence errors crash the disconnect handler
        logger.error({ err: err instanceof Error ? err.message : String(err), userId }, '[socket] availability.detach error on disconnect');
      }
    }
  });
}
