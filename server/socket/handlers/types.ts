import { Server, Socket } from 'socket.io';
import { z } from 'zod';
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

// ─── Socket Event Payload Schemas ─────────────────────────────────────────────
// Zod schemas for runtime validation of all socket event payloads.
// Each schema has a corresponding TypeScript type inferred from it.

export const ticketNewSchema = z.object({
  agentId: z.string().optional(), // Deprecated — server uses socket.data.userId instead
  agentLang: z.string().min(1).max(10),
  dept: z.string().min(1).max(100),
  references: z.array(z.object({ label: z.string().max(100), value: z.string().max(500) })).max(20).optional(),
  text: z.string().max(5000).optional(),
  mediaUrl: z.string().max(2048).optional(),
});
export type TicketNewPayload = z.infer<typeof ticketNewSchema>;

export const supportJoinSchema = z.object({
  ticketId: z.string().min(1),
  supportLang: z.string().min(1).max(10),
});
export type SupportJoinPayload = z.infer<typeof supportJoinSchema>;

export const supportLeaveSchema = z.object({
  ticketId: z.string().min(1),
  supportId: z.string().min(1),
  supportName: z.string().min(1).max(200),
});
export type SupportLeavePayload = z.infer<typeof supportLeaveSchema>;

export const ticketCloseSchema = z.object({
  ticketId: z.string().min(1),
  closedBy: z.string().max(200).optional(),
  closingNotes: z.string().max(5000).optional(),
});
export type TicketClosePayload = z.infer<typeof ticketCloseSchema>;

export const messageSendSchema = z.object({
  ticketId: z.string().min(1),
  senderId: z.string().optional(), // Ignored — server uses socket.data.userId
  text: z.string().max(5000),
  mediaUrl: z.string().max(2048).optional(),
  attachments: z.array(z.object({
    url: z.string().max(2048),
    name: z.string().max(255),
    mimeType: z.string().max(100),
    size: z.number().int().nonnegative(),
  })).max(10).optional(),
  whisper: z.boolean().optional(),
  replyToId: z.string().optional(),
  /** Client-generated ID echoed back in message:new for optimistic reconciliation */
  localId: z.string().max(100).optional(),
});
export type MessageSendPayload = z.infer<typeof messageSendSchema>;

export const ticketTransferSchema = z.object({
  ticketId: z.string().min(1),
  departmentId: z.string().min(1).optional(),
  note: z.string().max(2000).optional(),
});
export type TicketTransferPayload = z.infer<typeof ticketTransferSchema>;

export const ticketLabelsUpdateSchema = z.object({
  ticketId: z.string().min(1),
  labelId: z.string().min(1),
});
export type TicketLabelsUpdatePayload = z.infer<typeof ticketLabelsUpdateSchema>;

export const typingSchema = z.object({
  ticketId: z.string().min(1),
});
export type TypingPayload = z.infer<typeof typingSchema>;

export const statusSetSchema = z.object({
  status: z.enum(['online', 'away']),
});
export type StatusSetPayload = z.infer<typeof statusSetSchema>;

export const messageEditSchema = z.object({
  messageId: z.string().min(1),
  ticketId: z.string().min(1),
  text: z.string().min(1).max(5000),
});
export type MessageEditPayload = z.infer<typeof messageEditSchema>;

export const messageDeleteSchema = z.object({
  messageId: z.union([z.string().min(1), z.array(z.string().min(1)).min(1).max(50)]),
  ticketId: z.string().min(1),
});
export type MessageDeletePayload = z.infer<typeof messageDeleteSchema>;

export const messageDeliveredSchema = z.object({
  messageId: z.string().min(1),
  ticketId: z.string().min(1),
});
export type MessageDeliveredPayload = z.infer<typeof messageDeliveredSchema>;

export const messageReadSchema = z.object({
  ticketId: z.string().min(1),
  messageIds: z.array(z.string().min(1)).min(1).max(200),
});
export type MessageReadPayload = z.infer<typeof messageReadSchema>;

export const messageReactSchema = z.object({
  messageId: z.string().min(1),
  ticketId: z.string().min(1),
  emoji: z.string().min(1).max(10),
});
export type MessageReactPayload = z.infer<typeof messageReactSchema>;

export const ratingSubmitSchema = z.object({
  ticketId: z.string().min(1),
  rating: z.number().int().min(1).max(5),
  comment: z.string().max(2000).optional(),
});
export type RatingSubmitPayload = z.infer<typeof ratingSubmitSchema>;

export const ticketViewingSchema = z.object({
  ticketId: z.string().min(1),
});
export type TicketViewingPayload = z.infer<typeof ticketViewingSchema>;

/**
 * Validate a socket event payload against a Zod schema.
 * Emits an error event and returns null on validation failure.
 */
export function validatePayload<T>(socket: Socket, schema: z.ZodType<T>, data: unknown): T | null {
  const result = schema.safeParse(data);
  if (!result.success) {
    const firstError = result.error.issues[0];
    logger.warn(
      { socketId: socket.id, userId: socket.data.userId, error: firstError },
      '[socket] Invalid event payload',
    );
    socket.emit('error', { message: `Invalid payload: ${firstError.path.join('.')} — ${firstError.message}` });
    return null;
  }
  return result.data;
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

// ─── Socket-Level Rate Limiting ───────────────────────────────────────────────
// Per-socket sliding window counters stored on socket.data.
// Prevents a single client from flooding events (e.g., message:send spam).

interface SocketRateLimitConfig {
  /** Max events allowed in the window */
  maxEvents: number;
  /** Window duration in milliseconds */
  windowMs: number;
}

const SOCKET_RATE_LIMITS: Record<string, SocketRateLimitConfig> = {
  'message:send': { maxEvents: 10, windowMs: 5_000 },   // 10 messages per 5 seconds
  'message:edit': { maxEvents: 5, windowMs: 5_000 },     // 5 edits per 5 seconds
  'message:react': { maxEvents: 10, windowMs: 5_000 },   // 10 reactions per 5 seconds
};

/**
 * Socket-level rate limit check using a sliding window on socket.data.
 * Returns true if the event is allowed, false if rate-limited.
 * Emits an error event to the socket when rate-limited.
 */
export function checkSocketRateLimit(socket: Socket, event: string): boolean {
  const config = SOCKET_RATE_LIMITS[event];
  if (!config) return true; // No rate limit configured for this event

  const key = `_rateLimit_${event}` as const;
  const now = Date.now();

  // Initialize or get existing timestamps array
  let timestamps: number[] = (socket.data[key] as number[]) || [];

  // Remove timestamps outside the window
  const windowStart = now - config.windowMs;
  timestamps = timestamps.filter(t => t > windowStart);

  if (timestamps.length >= config.maxEvents) {
    socket.emit('error', { message: `Rate limited: too many ${event} events. Try again shortly.` });
    logger.warn(
      { socketId: socket.id, userId: socket.data.userId, event, count: timestamps.length },
      '[socket] Rate limit exceeded',
    );
    socket.data[key] = timestamps;
    return false;
  }

  timestamps.push(now);
  socket.data[key] = timestamps;
  return true;
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
