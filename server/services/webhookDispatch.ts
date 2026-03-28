/**
 * Webhook dispatch service — fire-and-forget HMAC-signed webhook delivery.
 *
 * Usage:
 *   import { fireWebhooks } from './services/webhookDispatch.js';
 *   fireWebhooks(partnerId, 'ticket.created', { ticketId, agentName, ... });
 *
 * Each matching webhook gets an HTTP POST with:
 *   - JSON body: { event, data, timestamp }
 *   - Header X-Tessera-Signature: HMAC-SHA256 of the body using the webhook's secret
 *   - Header X-Tessera-Event: the event name
 *
 * Delivery is logged to `webhook_logs` for debugging.
 */

import { createHmac } from 'crypto';
import dns from 'dns';
import { v4 as uuidv4 } from 'uuid';
import { db } from '../db.js';
import { webhooks, webhookLogs } from '../db/schema.js';
import { eq, and } from 'drizzle-orm';
import logger from '../utils/logger.js';

/**
 * Check whether a resolved IP address falls in private, reserved, or loopback ranges.
 */
export async function isPrivateOrReservedIP(hostname: string): Promise<boolean> {
  const { address } = await dns.promises.lookup(hostname);

  // IPv6 loopback
  if (address === '::1') return true;

  const parts = address.split('.').map(Number);
  if (parts.length !== 4) return false;

  // Loopback 127.0.0.0/8
  if (parts[0] === 127) return true;
  // RFC-1918: 10.0.0.0/8
  if (parts[0] === 10) return true;
  // RFC-1918: 172.16.0.0/12
  if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;
  // RFC-1918: 192.168.0.0/16
  if (parts[0] === 192 && parts[1] === 168) return true;
  // Link-local 169.254.0.0/16 (includes metadata endpoint 169.254.169.254)
  if (parts[0] === 169 && parts[1] === 254) return true;
  // 0.0.0.0
  if (parts.every((p) => p === 0)) return true;

  return false;
}

/**
 * Validate a webhook URL: scheme check + SSRF private IP block.
 */
export async function validateWebhookUrl(url: string): Promise<void> {
  const parsed = new URL(url);

  // Reject non-https in production (allow http in development)
  if (parsed.protocol !== 'https:') {
    if (parsed.protocol !== 'http:' || process.env.NODE_ENV !== 'development') {
      throw new Error('Webhook URL must use HTTPS');
    }
  }

  const isPrivate = await isPrivateOrReservedIP(parsed.hostname);
  if (isPrivate) {
    throw new Error('Webhook URL must not resolve to a private or reserved IP address');
  }
}

/** All supported webhook event types */
export type WebhookEvent =
  | 'ticket.created'
  | 'ticket.closed'
  | 'ticket.assigned'
  | 'ticket.reopened'
  | 'message.created'
  | 'rating.submitted'
  | 'user.created'
  | 'user.deleted'
  | '*';

function signPayload(body: string, secret: string): string {
  return createHmac('sha256', secret).update(body).digest('hex');
}

/**
 * Fire a test event to a single specific webhook. Non-blocking (fire-and-forget).
 * Used by the webhook test procedure to avoid dispatching to all partner webhooks.
 */
export function deliverWebhookTest(
  hook: typeof webhooks.$inferSelect,
  event: WebhookEvent,
  data: Record<string, unknown>,
) {
  deliverOne(hook, event, data).catch((err) => {
    logger.error({ err, webhookId: hook.id, event }, 'Webhook test delivery error');
  });
}

/**
 * Fire webhooks for a partner + event. Non-blocking (fire-and-forget).
 * Each matching webhook is dispatched in parallel; failures are logged but never throw.
 */
export function fireWebhooks(partnerId: string, event: WebhookEvent, data: Record<string, unknown>) {
  // Intentionally not awaited — caller should not block on webhook delivery
  dispatchAll(partnerId, event, data).catch((err) => {
    logger.error({ err, partnerId, event }, 'Webhook dispatch top-level error');
  });
}

async function dispatchAll(partnerId: string, event: WebhookEvent, data: Record<string, unknown>) {
  // Fetch active webhooks for this partner that subscribe to this event
  const hooks = await db
    .select()
    .from(webhooks)
    .where(and(eq(webhooks.partnerId, partnerId), eq(webhooks.active, true)));

  const matching = hooks.filter((h) => {
    const events = (h.events as string[]) || [];
    return events.includes(event) || events.includes('*');
  });

  if (matching.length === 0) return;

  const promises = matching.map((hook) => deliverOne(hook, event, data));
  await Promise.allSettled(promises);
}

async function deliverOne(
  hook: typeof webhooks.$inferSelect,
  event: WebhookEvent,
  data: Record<string, unknown>,
) {
  const timestamp = new Date().toISOString();
  const body = JSON.stringify({ event, data, timestamp });
  const signature = signPayload(body, hook.secret);

  const logId = uuidv4();
  const start = Date.now();

  try {
    // SSRF protection: validate URL before making the request
    await validateWebhookUrl(hook.url);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000); // 10s timeout

    const res = await fetch(hook.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Tessera-Signature': signature,
        'X-Tessera-Event': event,
        'User-Agent': 'Tessera-Webhook/1.0',
      },
      body,
      signal: controller.signal,
    });

    clearTimeout(timeout);

    const responseBody = await res.text().catch(() => '');
    const durationMs = Date.now() - start;

    await db.insert(webhookLogs).values({
      id: logId,
      webhookId: hook.id,
      event,
      payload: data,
      statusCode: res.status,
      responseBody: responseBody.slice(0, 2000), // cap logged response
      durationMs,
      createdAt: timestamp,
    });

    if (!res.ok) {
      logger.warn(
        { webhookId: hook.id, url: hook.url, status: res.status, durationMs },
        'Webhook delivery returned non-2xx',
      );
    }
  } catch (err: unknown) {
    const durationMs = Date.now() - start;
    const errorMsg = err instanceof Error ? err.message : String(err);

    await db.insert(webhookLogs).values({
      id: logId,
      webhookId: hook.id,
      event,
      payload: data,
      error: errorMsg,
      durationMs,
      createdAt: timestamp,
    }).catch(() => {}); // don't throw if logging itself fails

    logger.error(
      { webhookId: hook.id, url: hook.url, err: errorMsg, durationMs },
      'Webhook delivery failed',
    );
  }
}
