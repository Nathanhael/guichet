import { Socket } from 'socket.io';
import logger from '../../utils/logger.js';
import * as presenceService from '../../services/presence.js';
import * as statusTracking from '../../services/statusTracking.js';
import { broadcastAgentStatus } from '../../services/businessHours.js';
import { socketioConnectionsActive } from '../../utils/metrics.js';
import { removeViewerFromAll, broadcastViewers } from './collision.js';
import { type HandlerContext } from './types.js';

export function register(socket: Socket, ctx: HandlerContext): void {
  socket.on('disconnect', async () => {
    socketioConnectionsActive.dec();
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
        const result = await presenceService.decrementUserCount(userId, partnerId, socket.id);
        if (result && result.removed) {
          if (result.role === 'agent') {
            broadcastAgentStatus(userId, false);
            presenceService.broadcastOnlineAgents(partnerId);
          }
          // Close status tracking row when user fully disconnects (all roles)
          await statusTracking.closeOpenRow(userId, partnerId);
        }
      } catch (err) {
        // M-06: Don't let presence errors crash the disconnect handler
        logger.error({ err: err instanceof Error ? err.message : String(err), userId }, '[socket] Presence decrement error on disconnect');
      }
    }
  });
}
