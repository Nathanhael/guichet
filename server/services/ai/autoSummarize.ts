/**
 * AI Auto-Summarize on Close
 *
 * Generates an AI summary when a ticket is closed and stores it in closing_notes
 * (only if closing_notes is empty). Runs as fire-and-forget — never throws.
 */

import {
  isFeatureEnabled,
  getProvider,
  getPromptTemplate,
  interpolate,
  logUsage,
  formatMessagesForAi,
  checkRateLimit,
} from './index.js';
import { db } from '../../db.js';
import { messages as messagesTable, tickets } from '../../db/schema.js';
import { eq, and, asc, isNull, sql } from 'drizzle-orm';
import type { Server } from 'socket.io';
import logger from '../../utils/logger.js';

/**
 * Auto-summarize a ticket conversation on close.
 *
 * - Checks if the feature is enabled for the partner
 * - Fetches and formats all messages
 * - Calls the AI provider with the 'summarize' prompt
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
  try {
    // 1. Feature gate
    const enabled = await isFeatureEnabled(partnerId, 'autoSummarizeOnClose');
    if (!enabled) {
      logger.debug({ partnerId, ticketId }, '[autoSummarize] Feature disabled, skipping');
      return;
    }

    // 2. Rate limit check
    const limit = await checkRateLimit(partnerId);
    if (!limit.allowed) {
      logger.warn({ partnerId, ticketId, limitHit: limit.limitHit }, '[autoSummarize] Rate limited, skipping');
      return;
    }

    // 3. Fetch messages for the ticket
    const msgs = await db
      .select({
        senderName: messagesTable.senderName,
        senderRole: messagesTable.senderRole,
        text: messagesTable.text,
      })
      .from(messagesTable)
      .where(
        and(
          eq(messagesTable.ticketId, ticketId),
          isNull(messagesTable.deletedAt),
        ),
      )
      .orderBy(asc(messagesTable.createdAt));

    // Filter out empty messages
    const userMessages = msgs.filter((m) => m.text && m.text.trim());

    if (userMessages.length === 0) {
      logger.debug({ ticketId }, '[autoSummarize] No messages to summarize');
      return;
    }

    // 4. Format messages and build prompt
    const formatted = formatMessagesForAi(userMessages);
    const template = await getPromptTemplate('summarize', partnerId);
    const prompt = interpolate(template, { messages: formatted });

    // 5. Call AI provider
    const provider = await getProvider(partnerId);
    const start = Date.now();

    const result = await provider.chat({
      model: 'default',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.3,
      maxTokens: 512,
    });

    const summary = result.content.trim();
    const latencyMs = Date.now() - start;

    // 6. Log usage
    logUsage({
      partnerId,
      userId,
      action: 'summarize',
      provider: provider.name,
      model: result.model,
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
      latencyMs,
      success: true,
    });

    // 7. Atomically update closing_notes only if currently empty
    await db
      .update(tickets)
      .set({ closingNotes: summary })
      .where(
        and(
          eq(tickets.id, ticketId),
          sql`(closing_notes IS NULL OR TRIM(closing_notes) = '')`,
        ),
      );

    // 8. Emit to the ticket room
    io.to(`ticket:${ticketId}`).emit('ticket:summary:generated', { ticketId, summary });

    logger.info({ ticketId, partnerId, latencyMs }, '[autoSummarize] Summary generated successfully');
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    logger.error({ err: errorMessage, ticketId, partnerId }, '[autoSummarize] Failed to generate summary');
    // Never throw — this is fire-and-forget
  }
}
