/**
 * Webhook dispatch service — fire-and-forget HMAC-signed webhook delivery.
 *
 * Usage:
 *   import { fireWebhooks } from './services/webhookDispatch.js';
 *   fireWebhooks(partnerId, 'ticket.created', { ticketId, agentName, ... });
 *
 * Each matching webhook gets an HTTP POST with:
 *   - JSON body: { event, data, timestamp }
 *   - Header X-Guichet-Signature: HMAC-SHA256 of the body using the webhook's secret
 *   - Header X-Guichet-Event: the event name
 *
 * Delivery is logged to `webhook_logs` for debugging.
 */

import { createHmac } from 'crypto';
import dns from 'dns';
import { db } from '../db.js';
import { webhooks, webhookLogs } from '../db/schema.js';
import { eq, and } from 'drizzle-orm';
import logger from '../utils/logger.js';
import { decrypt } from './encryption.js';

/**
 * Check whether an IP address falls in private, reserved, or loopback ranges.
 */
function isPrivateOrReservedAddress(address: string): boolean {
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
 * Kept for backwards compatibility (used in webhook URL validation on save).
 */
export async function isPrivateOrReservedIP(hostname: string): Promise<boolean> {
  const { address } = await dns.promises.lookup(hostname);
  return isPrivateOrReservedAddress(address);
}

interface ValidatedUrl {
  /** The resolved IP address to use in the fetch call */
  resolvedIp: string;
  /** The original hostname for the Host header */
  originalHostname: string;
}

/**
 * Validate a webhook URL: scheme check + SSRF private IP block.
 * Returns the resolved IP so the caller can fetch against it directly,
 * preventing DNS rebinding TOCTOU attacks.
 */
export async function validateWebhookUrl(url: string): Promise<ValidatedUrl> {
  const parsed = new URL(url);

  // Reject non-https in production (allow http in development)
  if (parsed.protocol !== 'https:') {
    if (parsed.protocol !== 'http:' || process.env.NODE_ENV !== 'development') {
      throw new Error('Webhook URL must use HTTPS');
    }
  }

  const { address } = await dns.promises.lookup(parsed.hostname);
  if (isPrivateOrReservedAddress(address)) {
    throw new Error('Webhook URL must not resolve to a private or reserved IP address');
  }

  return { resolvedIp: address, originalHostname: parsed.hostname };
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
  // Fired when verifyAuditChain detects a hash mismatch. Global signal, not
  // tenant-specific, but fanned out to every active partner webhook that
  // subscribes so compliance contacts are paged via the channels they already
  // configured (PagerDuty, Slack, etc). Payload carries brokenAt + severity.
  | 'audit.chain_broken'
  | '*';

function signPayload(body: string, encryptedSecret: string): string {
  const secret = decrypt(encryptedSecret);
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
 *
 * IMPORTANT: Delivery is at-most-once. Transient failures (5xx, network timeout)
 * are logged but not retried. Partners should implement idempotent receivers
 * and monitor webhook_logs for missed deliveries.
 */
export function fireWebhooks(partnerId: string, event: WebhookEvent, data: Record<string, unknown>) {
  // Intentionally not awaited — caller should not block on webhook delivery
  dispatchAll(partnerId, event, data).catch((err) => {
    logger.error({ err, partnerId, event }, 'Webhook dispatch top-level error');
  });
}

/**
 * Fire a cross-tenant (global) webhook event. Fans out to every active
 * webhook across all partners that subscribes to the event. Used for
 * infrastructure-level signals like `audit.chain_broken` — compliance is
 * partner-agnostic and each tenant's ops contact should be paged through
 * their own configured channel.
 *
 * Non-blocking; individual dispatch failures are logged and swallowed.
 */
export function broadcastWebhook(event: WebhookEvent, data: Record<string, unknown>) {
  dispatchAllPartners(event, data).catch((err) => {
    logger.error({ err, event }, 'Webhook broadcast top-level error');
  });
}

async function dispatchAllPartners(event: WebhookEvent, data: Record<string, unknown>) {
  const hooks = await db
    .select()
    .from(webhooks)
    .where(eq(webhooks.active, true));

  const matching = hooks.filter((h) => {
    const events = (h.events as string[]) || [];
    return events.includes(event) || events.includes('*');
  });

  if (matching.length === 0) return;
  await Promise.allSettled(matching.map((hook) => deliverOne(hook, event, data)));
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

  const logId = crypto.randomUUID();
  const start = Date.now();

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000); // 10s timeout

  try {
    // SSRF protection: validate URL and resolve DNS once, then fetch against the resolved IP
    // to prevent DNS rebinding TOCTOU attacks.
    const { resolvedIp, originalHostname } = await validateWebhookUrl(hook.url);

    // Replace hostname with resolved IP to prevent DNS rebinding
    const resolvedUrl = new URL(hook.url);
    resolvedUrl.hostname = resolvedIp;

    const res = await fetch(resolvedUrl.toString(), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Host': originalHostname,
        'X-Guichet-Signature': signature,
        'X-Guichet-Event': event,
        'User-Agent': 'Guichet-Webhook/1.0',
      },
      body,
      signal: controller.signal,
      redirect: 'error',
    });

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
    }).catch((logErr) => {
      // don't throw if logging itself fails, but surface so silent webhook_log
      // data loss (e.g. table outage) isn't invisible
      logger.error({ err: logErr instanceof Error ? logErr.message : String(logErr), webhookId: hook.id }, '[webhook] failed to insert webhook_log');
    });

    logger.error(
      { webhookId: hook.id, url: hook.url, err: errorMsg, durationMs },
      'Webhook delivery failed',
    );
  } finally {
    clearTimeout(timeout);
  }
}
