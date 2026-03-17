import { toZonedTime } from 'date-fns-tz';
import { Server } from 'socket.io';
import config from '../config.js';
import { query } from '../db.js';
import logger from '../utils/logger.js';

let io: Server | null = null;

export function setIo(socketIo: Server) {
  io = socketIo;
}

export function isWithinBusinessHours(partner?: {
  businessHoursStart?: string | null;
  businessHoursEnd?: string | null;
  businessHoursTimezone?: string | null;
}): boolean {
  // If hours are not explicitly defined, the department is "Open" by default
  if (!partner?.businessHoursStart || !partner?.businessHoursEnd) {
    return true;
  }

  const timezone = partner?.businessHoursTimezone ?? 'Europe/Brussels';
  const now = toZonedTime(new Date(), timezone);
  const currentMinutes = now.getHours() * 60 + now.getMinutes();
  const [startH, startM] = partner.businessHoursStart.split(':').map(Number);
  const [endH, endM] = partner.businessHoursEnd.split(':').map(Number);
  return currentMinutes >= (startH * 60 + startM) && currentMinutes < (endH * 60 + endM);
}

export async function broadcastAgentStatus(agentId: string, online: boolean) {
  try {
    const openTickets = await query('SELECT id FROM tickets WHERE agent_id = $1 AND status != $2', [agentId, 'closed']) as { id: string }[];
    for (const ticket of openTickets) io!.to(`ticket:${ticket.id}`).emit('agent:status', { ticketId: ticket.id, agentId, online });
  } catch (err: unknown) { logger.error({ err: err instanceof Error ? err.message : String(err) }, '[agent:status] error'); }
}

export async function broadcastQueuePositions() {
  try {
    const openTickets = await query('SELECT id FROM tickets WHERE status = $1 AND support_id IS NULL ORDER BY created_at ASC', ['open']) as { id: string }[];
    openTickets.forEach((t, index) => {
      const position = index + 1;
      io!.to(`ticket:${t.id}`).emit('queue:update', { position, etaMins: position * 2 });
    });
  } catch (err: unknown) { logger.error({ err: err instanceof Error ? err.message : String(err) }, '[broadcastQueuePositions] error'); }
}
