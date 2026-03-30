/**
 * AI Auto-Summarize on Close
 *
 * Generates an AI summary when a ticket is closed and stores it in closing_notes
 * (only if closing_notes is empty). Runs as fire-and-forget — never throws.
 */

import { runAiAction } from './runAction.js';
import { verifyTicketOwnership, fetchTicketMessages } from './ticketMessages.js';
import { formatMessagesForAi } from './messageFormatter.js';
import { eq, and, sql } from 'drizzle-orm';
import type { Server } from 'socket.io';
import { getAiContext } from './context.js';

/**
 * Auto-summarize a ticket conversation on close.
 *
 * - Verifies ticket belongs to the partner
 * - Fetches and formats all messages
 * - Calls runAiAction (feature gate + rate limit + prompt + AI call + logging)
 * - Updates closing_notes only if currently empty
 * - Emits `ticket:summary:generated` to the ticket room
 *
 * This function is fully try/catch wrapped and will never throw.
 */
export async function autoSummarizeOnClose(
  partnerId: string,
  userId: string,
  ticketId: string,
  io: Server,
): Promise<void> {
  const { db, logger, schema } = getAiContext();
  const { tickets } = schema as any;

  try {
    // 1. Verify ticket belongs to this partner (prevent cross-tenant data leak)
    const ticket = await verifyTicketOwnership(ticketId, partnerId);
    if (!ticket) {
      logger.warn({ ticketId, partnerId }, '[autoSummarize] Ticket not found or wrong partner, skipping');
      return;
    }

    // 2. Fetch messages
    const userMessages = await fetchTicketMessages(ticketId);
    if (userMessages.length === 0) {
      logger.debug({ ticketId }, '[autoSummarize] No messages to summarize');
      return;
    }

    // 3. Format and run AI action (gate + limit + prompt + call + log)
    const formatted = formatMessagesForAi(userMessages);
    const result = await runAiAction({
      partnerId,
      userId,
      feature: 'autoSummarizeOnClose',
      action: 'summarize',
      vars: { messages: formatted },
      temperature: 0.3,
      maxTokens: 512,
    });

    const summary = result.content.trim();

    // 4. Atomically update closing_notes only if currently empty
    await db
      .update(tickets)
      .set({ closingNotes: summary })
      .where(
        and(
          eq(tickets.id, ticketId),
          sql`(closing_notes IS NULL OR TRIM(closing_notes) = '')`,
        ),
      );

    // 5. Emit to the ticket room
    io.to(`ticket:${ticketId}`).emit('ticket:summary:generated', { ticketId, summary });

    logger.info({ ticketId, partnerId }, '[autoSummarize] Summary generated successfully');
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    logger.error({ err: errorMessage, ticketId, partnerId }, '[autoSummarize] Failed to generate summary');
    // Never throw — this is fire-and-forget
  }
}
