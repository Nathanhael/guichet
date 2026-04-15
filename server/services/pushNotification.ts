import webpush from 'web-push';
import { eq, and } from 'drizzle-orm';
import { db } from '../db/postgres.js';
import { pushSubscriptions } from '../db/schema.js';
import config from '../config.js';
import logger from '../utils/logger.js';

const pushEnabled = !!(config.VAPID_PUBLIC_KEY && config.VAPID_PRIVATE_KEY);

if (pushEnabled) {
  webpush.setVapidDetails(
    config.VAPID_SUBJECT || 'mailto:admin@guichet.app',
    config.VAPID_PUBLIC_KEY!,
    config.VAPID_PRIVATE_KEY!,
  );
  logger.info('[push] Web Push initialized with VAPID keys');
} else {
  logger.info('[push] Web Push disabled — VAPID keys not configured');
}

interface PushPayload {
  title: string;
  body: string;
  ticketId: string;
  type: 'reply' | 'status' | 'joined' | 'rating' | 'reclaimed';
  tag: string;
}

export async function subscribe(userId: string, subscription: { endpoint: string; keys: { p256dh: string; auth: string } }): Promise<void> {
  try {
    await db.insert(pushSubscriptions).values({
      userId,
      endpoint: subscription.endpoint,
      keys: subscription.keys,
    }).onConflictDoUpdate({
      target: [pushSubscriptions.endpoint],
      set: {
        userId,
        keys: subscription.keys,
        createdAt: new Date().toISOString(),
      },
    });
    logger.info({ userId }, '[push] Subscription stored');
  } catch (err) {
    logger.error({ err: err instanceof Error ? err.message : String(err), userId }, '[push] Failed to store subscription');
  }
}

export async function unsubscribe(userId: string, endpoint: string): Promise<void> {
  try {
    await db.delete(pushSubscriptions).where(
      and(eq(pushSubscriptions.endpoint, endpoint), eq(pushSubscriptions.userId, userId))
    );
    logger.info({ userId }, '[push] Subscription removed');
  } catch (err) {
    logger.error({ err: err instanceof Error ? err.message : String(err), userId }, '[push] Failed to remove subscription');
  }
}

export async function sendPush(userId: string, payload: PushPayload): Promise<void> {
  if (!pushEnabled) return;

  try {
    const subs = await db.select().from(pushSubscriptions).where(eq(pushSubscriptions.userId, userId));

    for (const sub of subs) {
      const pushSub = {
        endpoint: sub.endpoint,
        keys: sub.keys as { p256dh: string; auth: string },
      };

      try {
        await webpush.sendNotification(pushSub, JSON.stringify(payload));
      } catch (err: unknown) {
        const statusCode = (err as { statusCode?: number }).statusCode;
        if (statusCode === 410 || statusCode === 404) {
          await db.delete(pushSubscriptions).where(eq(pushSubscriptions.id, sub.id));
          logger.info({ userId, endpoint: sub.endpoint }, '[push] Removed expired subscription');
        } else {
          logger.error({ err: err instanceof Error ? err.message : String(err), userId }, '[push] Failed to send notification');
        }
      }
    }
  } catch (err) {
    logger.error({ err: err instanceof Error ? err.message : String(err), userId }, '[push] sendPush error');
  }
}

export function getVapidPublicKey(): string | null {
  return config.VAPID_PUBLIC_KEY || null;
}
