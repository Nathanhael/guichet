import { Server, Socket } from 'socket.io';
import logger from '../../utils/logger.js';
import { isRevoked } from '../../services/sessionRevocation.js';
import { socketioEventsTotal } from '../../utils/metrics.js';

// Re-export so handler modules can reference it without importing metrics directly
export { socketioEventsTotal };

export interface HandlerContext {
  io: Server;
  socketTickets: Map<string, Set<string>>;
  viewerKeyPrefix: string;
}

export interface TicketNewPayload {
  agentId?: string; // Deprecated — server uses socket.data.userId instead
  agentLang: string;
  dept: string;
  references?: Array<{ label: string; value: string }>;
  text?: string;
  mediaUrl?: string;
}

export interface SupportJoinPayload {
  ticketId: string;
  supportLang: string;
}

export interface SupportLeavePayload {
  ticketId: string;
  supportId: string;
  supportName: string;
}

export interface TicketClosePayload {
  ticketId: string;
  closedBy?: string;
  closingNotes?: string;
}

export interface MessageSendPayload {
  ticketId: string;
  senderId: string;
  text: string;
  mediaUrl?: string;
  attachments?: Array<{ url: string; name: string; mimeType: string; size: number }>;
  whisper?: boolean;
  replyToId?: string;
  /** Client-generated ID echoed back in message:new for optimistic reconciliation */
  localId?: string;
}

export interface Participant {
  id: string;
  name: string;
}

export interface SenderInfo {
  name: string;
  role: string;
  lang: string;
}

/** Guard: check if the JWT has expired since the handshake */
export function isTokenExpired(socket: Socket): boolean {
  const exp = socket.data.tokenExp as number | undefined;
  if (!exp) return true;
  return Math.floor(Date.now() / 1000) >= exp;
}

/** Interval (ms) between periodic revocation checks on active sockets */
export const REVOCATION_CHECK_INTERVAL_MS = 60 * 1000; // 60 seconds (safety net — primary revocation is via Pub/Sub)

/** Guard: require socket to be identified before processing events */
export function requireIdentified(socket: Socket): boolean {
  if (isTokenExpired(socket)) {
    logger.info({ socketId: socket.id, userId: socket.data.userId }, '[socket] Token expired, disconnecting');
    socket.emit('auth:expired', { message: 'Token expired — please re-authenticate' });
    socket.disconnect(true);
    return false;
  }
  if (!socket.data.userId || !socket.data.partnerId) {
    socket.emit('error', { message: 'Not authenticated — call socket:identify first' });
    return false;
  }

  // Periodic revocation check — safety net fallback (runs at most once every 60s).
  // PRIMARY revocation is handled by the Redis Pub/Sub subscriber in
  // registerSocketHandlers() which disconnects revoked sockets within milliseconds.
  // This periodic check exists as a fallback in case a Pub/Sub message is missed.
  // NOTE: The check is fire-and-forget — the event that triggers it still completes
  // even if revocation is detected. The revoked socket is disconnected asynchronously,
  // so one additional event may execute.
  const now = Date.now();
  const lastCheck = (socket.data.lastRevocationCheck as number) || 0;
  if (now - lastCheck > REVOCATION_CHECK_INTERVAL_MS) {
    socket.data.lastRevocationCheck = now;
    // Fire-and-forget: check revocation asynchronously. If revoked, disconnect.
    isRevoked({
      userId: socket.data.userId as string,
      jti: socket.data.jti as string | undefined,
      iat: socket.data.iat as number | undefined,
    }).then((revoked) => {
      if (revoked) {
        logger.info({ socketId: socket.id, userId: socket.data.userId }, '[socket] Session revoked, disconnecting');
        socket.emit('auth:expired', { message: 'Session revoked — please re-authenticate' });
        socket.disconnect(true);
      }
    }).catch(() => {
      // If Redis is down, isRevoked fails closed — disconnect to be safe
      socket.emit('auth:expired', { message: 'Session verification failed — please re-authenticate' });
      socket.disconnect(true);
    });
  }

  return true;
}
