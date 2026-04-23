import { Server, Socket } from 'socket.io';
import logger from '../../utils/logger.js';
import { getRedisClients } from '../../utils/redis.js';
import { VIEWER_TTL_SECONDS } from '../../constants.js';
import { Rooms } from '../../utils/rooms.js';
import { requireIdentified, validatePayload, ticketViewingSchema, type HandlerContext } from './types.js';
import { requirePartnerScope } from '../partnerScope.js';

export async function addViewer(
  viewerKeyPrefix: string,
  socketTickets: Map<string, Set<string>>,
  ticketId: string,
  socketId: string,
  userId: string,
  userName: string,
) {
  try {
    const { pubClient } = getRedisClients();
    if (!pubClient) return;
    const key = `${viewerKeyPrefix}${ticketId}`;
    await pubClient.multi()
      .hSet(key, socketId, JSON.stringify({ userId, userName }))
      .expire(key, VIEWER_TTL_SECONDS)
      .exec();
    // Track locally for disconnect cleanup
    if (!socketTickets.has(socketId)) socketTickets.set(socketId, new Set());
    socketTickets.get(socketId)!.add(ticketId);
  } catch (err) {
    logger.error({ err: err instanceof Error ? err.message : String(err) }, '[collision] Redis addViewer error');
  }
}

export async function removeViewer(
  viewerKeyPrefix: string,
  socketTickets: Map<string, Set<string>>,
  ticketId: string,
  socketId: string,
) {
  try {
    const { pubClient } = getRedisClients();
    if (!pubClient) return;
    await pubClient.hDel(`${viewerKeyPrefix}${ticketId}`, socketId);
    socketTickets.get(socketId)?.delete(ticketId);
  } catch (err) {
    logger.error({ err: err instanceof Error ? err.message : String(err) }, '[collision] Redis removeViewer error');
  }
}

export async function removeViewerFromAll(
  viewerKeyPrefix: string,
  socketTickets: Map<string, Set<string>>,
  socketId: string,
): Promise<string[]> {
  const tickets = socketTickets.get(socketId);
  if (!tickets || tickets.size === 0) {
    socketTickets.delete(socketId);
    return [];
  }
  const affectedTickets = Array.from(tickets);
  try {
    const { pubClient } = getRedisClients();
    if (!pubClient) return affectedTickets;
    const pipeline = pubClient.multi();
    for (const ticketId of affectedTickets) {
      pipeline.hDel(`${viewerKeyPrefix}${ticketId}`, socketId);
    }
    await pipeline.exec();
  } catch (err) {
    logger.error({ err: err instanceof Error ? err.message : String(err) }, '[collision] Redis removeViewerFromAll error');
  }
  socketTickets.delete(socketId);
  return affectedTickets;
}

export async function getViewers(
  viewerKeyPrefix: string,
  ticketId: string,
): Promise<Array<{ userId: string; userName: string }>> {
  try {
    const { pubClient } = getRedisClients();
    if (!pubClient) return [];
    const entries = await pubClient.hGetAll(`${viewerKeyPrefix}${ticketId}`);
    // Deduplicate by userId (same user may have multiple sockets)
    const seen = new Map<string, { userId: string; userName: string }>();
    for (const val of Object.values(entries)) {
      try {
        const entry = JSON.parse(val) as { userId: string; userName: string };
        if (!seen.has(entry.userId)) {
          seen.set(entry.userId, entry);
        }
      } catch { /* skip malformed entries */ }
    }
    return Array.from(seen.values());
  } catch (err) {
    logger.error({ err: err instanceof Error ? err.message : String(err) }, '[collision] Redis getViewers error');
    return [];
  }
}

export async function broadcastViewers(
  viewerKeyPrefix: string,
  io: Server,
  ticketId: string,
) {
  const viewers = await getViewers(viewerKeyPrefix, ticketId);
  io.to(Rooms.ticket(ticketId)).emit('ticket:viewers', { ticketId, viewers });
}

export function register(socket: Socket, ctx: HandlerContext): void {
  // ── Collision Detection: ticket viewing ───────────────────────────────────
  socket.on('ticket:viewing', async (data: unknown) => {
    if (!requireIdentified(socket)) return;
    if (!socket.data.isSupport) return;
    const parsed = validatePayload(socket, ticketViewingSchema, data);
    if (!parsed) return;
    const { ticketId } = parsed;

    // Tenant isolation: verify ticket belongs to caller's partner
    const ticket = await requirePartnerScope(socket, ticketId);
    if (!ticket) return;

    const userId = socket.data.userId as string;
    const userName = socket.data.name as string;

    // Join the socket room if not already in it
    if (!socket.rooms.has(Rooms.ticket(ticketId))) {
      socket.join(Rooms.ticket(ticketId));
    }

    await addViewer(ctx.viewerKeyPrefix, ctx.socketTickets, ticketId, socket.id, userId, userName);
    await broadcastViewers(ctx.viewerKeyPrefix, ctx.io, ticketId);
  });

  socket.on('ticket:left', async (data: unknown) => {
    if (!requireIdentified(socket)) return;
    if (!socket.data.isSupport) return;
    const leftParsed = validatePayload(socket, ticketViewingSchema, data);
    if (!leftParsed) return;
    const { ticketId } = leftParsed;

    // Tenant isolation: verify ticket belongs to caller's partner
    const ticket = await requirePartnerScope(socket, ticketId);
    if (!ticket) return;

    await removeViewer(ctx.viewerKeyPrefix, ctx.socketTickets, ticketId, socket.id);
    await broadcastViewers(ctx.viewerKeyPrefix, ctx.io, ticketId);
  });
}
