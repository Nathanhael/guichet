import { Socket } from 'socket.io';
import { z } from 'zod';
import logger from '../../utils/logger.js';
import { socketActor } from '../../services/ticketLifecycle/index.js';
import { applyCommandResult } from '../commandBus/index.js';
import { MAX_LABELS_PER_TICKET } from '../../constants.js';
import {
  requireIdentified,
  validatePayload,
  ticketNewSchema,
  ticketCloseSchema,
  ticketTransferSchema,
  type HandlerContext,
} from './types.js';

export function register(socket: Socket, ctx: HandlerContext): void {
  socket.on('ticket:new', async (data: unknown) => {
    if (!requireIdentified(socket)) return;
    const parsed = validatePayload(socket, ticketNewSchema, data);
    if (!parsed) {
      logger.warn({ socketId: socket.id }, '[ticket:new] payload validation failed');
      return;
    }
    try {
      const actor = socketActor(socket);
      if (!actor) {
        logger.warn({ socketId: socket.id, userId: socket.data.userId }, '[ticket:new] rejected — no partner context');
        return;
      }

      const result = await ctx.bus.dispatch(
        {
          type: 'ticket:new',
          partnerId: actor.partnerId,
          actor,
          dept: parsed.dept,
          agentLang: parsed.agentLang,
          references: parsed.references ?? [],
          text: parsed.text,
          mediaUrl: parsed.mediaUrl,
        },
        socket.id,
      );
      applyCommandResult(socket, ctx.io, result);
    } catch (err: unknown) {
      logger.error({ err: err instanceof Error ? err.message : String(err) }, '[ticket:new] error');
      socket.emit('error', { message: 'Failed to create ticket' });
    }
  });

  socket.on('ticket:close', async (data: unknown) => {
    if (!requireIdentified(socket)) return;
    const parsed = validatePayload(socket, ticketCloseSchema, data);
    if (!parsed) return;
    try {
      const actor = socketActor(socket);
      if (!actor) return;

      const result = await ctx.bus.dispatch(
        {
          type: 'ticket:close',
          partnerId: actor.partnerId,
          actor,
          ticketId: parsed.ticketId,
          closingNotes: parsed.closingNotes,
        },
        socket.id,
      );
      applyCommandResult(socket, ctx.io, result);
    } catch (err: unknown) { logger.error({ err: err instanceof Error ? err.message : String(err) }, '[ticket:close] error'); }
  });

  socket.on('ticket:transfer', async (data: unknown) => {
    if (!requireIdentified(socket)) return;
    const parsed = validatePayload(socket, ticketTransferSchema, data);
    if (!parsed) return;
    try {
      const actor = socketActor(socket);
      if (!actor) return;

      const result = await ctx.bus.dispatch(
        {
          type: 'ticket:transfer',
          partnerId: actor.partnerId,
          actor,
          ticketId: parsed.ticketId,
          departmentId: parsed.departmentId,
          note: parsed.note,
        },
        socket.id,
      );
      applyCommandResult(socket, ctx.io, result);
    } catch (err: unknown) {
      logger.error({ err: err instanceof Error ? err.message : String(err) }, '[ticket:transfer] error');
    }
  });

  socket.on('ticket:labels:update', async (data: unknown) => {
    if (!requireIdentified(socket)) return;
    const parsed = validatePayload(
      socket,
      z.object({
        ticketId: z.string().min(1),
        labels: z.array(z.string().min(1)).max(MAX_LABELS_PER_TICKET),
      }),
      data,
    );
    if (!parsed) return;
    try {
      const actor = socketActor(socket);
      if (!actor) return;

      const result = await ctx.bus.dispatch(
        {
          type: 'ticket:labels:update',
          partnerId: actor.partnerId,
          actor,
          ticketId: parsed.ticketId,
          labels: parsed.labels,
        },
        socket.id,
      );
      applyCommandResult(socket, ctx.io, result);
    } catch (err: unknown) {
      logger.error({ err: err instanceof Error ? err.message : String(err), ticketId: parsed.ticketId }, '[ticket:labels:update] error');
    }
  });
}
