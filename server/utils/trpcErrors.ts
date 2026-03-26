import { TRPCError } from '@trpc/server';
import logger from './logger.js';

/**
 * Shared error factories for tRPC routers.
 * Eliminates duplicated TRPCError instantiation across routers.
 */

export function notFound(resource: string): TRPCError {
  return new TRPCError({ code: 'NOT_FOUND', message: `${resource} not found` });
}

export function forbidden(reason: string): TRPCError {
  return new TRPCError({ code: 'FORBIDDEN', message: reason });
}

export function conflict(message: string): TRPCError {
  return new TRPCError({ code: 'CONFLICT', message });
}

/**
 * Wraps unknown errors into TRPCError with logging.
 * Re-throws TRPCErrors as-is, wraps everything else as INTERNAL_SERVER_ERROR.
 */
export function wrapError(err: unknown, context: string): never {
  if (err instanceof TRPCError) throw err;
  const detail = err instanceof Error ? err.message : String(err);
  logger.error({ err: detail }, `tRPC: ${context}`);
  // Return generic message to client; internal detail stays in server logs only
  throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'An internal error occurred' });
}
