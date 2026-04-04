# PWA Push Notifications (Agent-Only) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Web Push notifications for agents so they receive OS-level alerts when support interacts with their tickets (reply, status change, join, close/rating).

**Architecture:** VAPID-authenticated Web Push via `web-push` npm package. Subscriptions stored in DB. Push fired from socket handlers (fire-and-forget). Service worker shows notifications only when no Tessera tab is focused. Tap navigates to the ticket.

**Tech Stack:** Web Push API, Service Workers, web-push (npm), Express, Drizzle ORM, PostgreSQL

**Spec:** `docs/superpowers/specs/2026-04-04-pwa-push-notifications-design.md`

---

### Task 1: Install web-push and add VAPID config

**Files:**
- Modify: `server/package.json`
- Modify: `server/config.ts`

- [ ] **Step 1: Install web-push**

```bash
docker compose exec server npm install web-push
```

No `@types/web-push` needed — `web-push` includes its own types.

- [ ] **Step 2: Add VAPID env vars to config.ts**

In `server/config.ts`, find the Zod schema (search for `z.object`). Add these optional fields:

```typescript
  VAPID_PUBLIC_KEY: z.string().optional(),
  VAPID_PRIVATE_KEY: z.string().optional(),
  VAPID_SUBJECT: z.string().optional().default('mailto:admin@tessera.app'),
```

- [ ] **Step 3: Generate VAPID keys**

Run once to generate keys:

```bash
docker compose exec server npx web-push generate-vapid-keys
```

Copy the output and add to `.env`:

```
VAPID_PUBLIC_KEY=<generated public key>
VAPID_PRIVATE_KEY=<generated private key>
VAPID_SUBJECT=mailto:admin@tessera.app
```

- [ ] **Step 4: Expose VAPID public key to client**

In `server/config.ts`, the public key needs to reach the client. Add a simple endpoint. But first, check if there's already a `/config` or `/health` endpoint that returns public config. If so, add `vapidPublicKey` there.

Otherwise, we'll create a dedicated endpoint in Task 5.

- [ ] **Step 5: Commit**

```bash
git add server/package.json server/package-lock.json server/config.ts
git commit -m "feat(server): install web-push and add VAPID config

Adds VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT env vars.
All optional — push notifications disabled when not configured.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Add push_subscriptions DB table

**Files:**
- Modify: `server/db/schema.ts`

- [ ] **Step 1: Add the table**

In `server/db/schema.ts`, add before the agent status tracking section:

```typescript
// ─── Push Subscriptions ─────────────────────────────────────────────────────

/**
 * Web Push subscription endpoints for agent notifications.
 * Each row = one device/browser subscription for a user.
 */
export const pushSubscriptions = pgTable('push_subscriptions', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  endpoint: text('endpoint').notNull(),
  keys: jsonb('keys').notNull(), // { p256dh: string, auth: string }
  createdAt: timestamp('created_at', { mode: 'string' }).notNull().defaultNow(),
}, (table) => ({
  userIdx: index('idx_push_subscriptions_user').on(table.userId),
  endpointIdx: uniqueIndex('idx_push_subscriptions_endpoint').on(table.endpoint),
}));
```

- [ ] **Step 2: Push schema to database**

```bash
docker compose exec server npx drizzle-kit push
```

- [ ] **Step 3: Commit**

```bash
git add server/db/schema.ts
git commit -m "feat(db): add push_subscriptions table for Web Push

Stores push subscription endpoints per user with cascade delete.
Unique index on endpoint to prevent duplicates.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Create push notification service

**Files:**
- Create: `server/services/pushNotification.ts`

- [ ] **Step 1: Create the service**

Create `server/services/pushNotification.ts`:

```typescript
import webpush from 'web-push';
import { eq } from 'drizzle-orm';
import { db } from '../db/postgres.js';
import { pushSubscriptions } from '../db/schema.js';
import config from '../config.js';
import logger from '../utils/logger.js';

// Initialize VAPID — push is disabled if keys aren't configured
const pushEnabled = !!(config.VAPID_PUBLIC_KEY && config.VAPID_PRIVATE_KEY);

if (pushEnabled) {
  webpush.setVapidDetails(
    config.VAPID_SUBJECT || 'mailto:admin@tessera.app',
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
  type: 'reply' | 'status' | 'joined' | 'rating';
  tag: string;
}

/**
 * Store a push subscription for a user.
 */
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

/**
 * Remove a push subscription by endpoint.
 */
export async function unsubscribe(userId: string, endpoint: string): Promise<void> {
  try {
    await db.delete(pushSubscriptions).where(eq(pushSubscriptions.endpoint, endpoint));
    logger.info({ userId }, '[push] Subscription removed');
  } catch (err) {
    logger.error({ err: err instanceof Error ? err.message : String(err), userId }, '[push] Failed to remove subscription');
  }
}

/**
 * Send a push notification to all subscriptions for a user.
 * Fire-and-forget — never throws.
 */
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
          // Subscription expired — clean up
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

/**
 * Get the VAPID public key for client-side subscription.
 */
export function getVapidPublicKey(): string | null {
  return config.VAPID_PUBLIC_KEY || null;
}
```

- [ ] **Step 2: Commit**

```bash
git add server/services/pushNotification.ts
git commit -m "feat(server): create push notification service

Subscribe, unsubscribe, sendPush with VAPID auth.
Auto-cleans expired subscriptions (410/404).
Graceful no-op when VAPID keys not configured.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Create push routes

**Files:**
- Create: `server/routes/push.ts`
- Modify: `server/app.ts`

- [ ] **Step 1: Create push routes**

Create `server/routes/push.ts`:

```typescript
import { Router } from 'express';
import { subscribe, unsubscribe, getVapidPublicKey } from '../services/pushNotification.js';

const router = Router();

/**
 * GET /api/v1/push/vapid-key
 * Returns the VAPID public key for client-side subscription.
 */
router.get('/vapid-key', (req, res) => {
  const key = getVapidPublicKey();
  if (!key) {
    return res.status(503).json({ error: 'Push notifications not configured' });
  }
  res.json({ vapidPublicKey: key });
});

/**
 * POST /api/v1/push/subscribe
 * Stores a push subscription for the authenticated agent.
 */
router.post('/subscribe', async (req, res) => {
  const user = (req as unknown as { user?: { id: string; role: string } }).user;
  if (!user) return res.status(401).json({ error: 'Not authenticated' });
  if (user.role !== 'agent') return res.status(403).json({ error: 'Push notifications are for agents only' });

  const { subscription } = req.body;
  if (!subscription?.endpoint || !subscription?.keys?.p256dh || !subscription?.keys?.auth) {
    return res.status(400).json({ error: 'Invalid subscription object' });
  }

  await subscribe(user.id, subscription);
  res.json({ success: true });
});

/**
 * POST /api/v1/push/unsubscribe
 * Removes a push subscription.
 */
router.post('/unsubscribe', async (req, res) => {
  const user = (req as unknown as { user?: { id: string } }).user;
  if (!user) return res.status(401).json({ error: 'Not authenticated' });

  const { endpoint } = req.body;
  if (!endpoint) return res.status(400).json({ error: 'Endpoint required' });

  await unsubscribe(user.id, endpoint);
  res.json({ success: true });
});

export default router;
```

- [ ] **Step 2: Register routes in app.ts**

In `server/app.ts`, add the import:

```typescript
import pushRoutes from './routes/push.js';
```

Find where other routes are registered (search for `v1Router.use`). Add:

```typescript
v1Router.use('/push', authMiddleware, pushRoutes);
```

The `/vapid-key` endpoint should be accessible without auth for the client to fetch the key before subscribing. To handle this, either:
- Make the GET route public (add it before the auth middleware)
- Or use a separate registration: `v1Router.get('/push/vapid-key', pushVapidKeyRoute)`

Simplest: register the vapid-key route without auth, and the subscribe/unsubscribe with auth:

```typescript
v1Router.get('/push/vapid-key', (req, res) => {
  const key = getVapidPublicKey();
  if (!key) return res.status(503).json({ error: 'Push not configured' });
  res.json({ vapidPublicKey: key });
});
v1Router.use('/push', authMiddleware, pushRoutes);
```

Import `getVapidPublicKey` in app.ts:
```typescript
import { getVapidPublicKey } from './services/pushNotification.js';
```

- [ ] **Step 3: Commit**

```bash
git add server/routes/push.ts server/app.ts
git commit -m "feat(server): add push subscription routes

GET /push/vapid-key (public), POST /push/subscribe and
/push/unsubscribe (auth + agent-only).

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Add push triggers to socket handlers

**Files:**
- Modify: `server/socket/handlers.ts`

- [ ] **Step 1: Import sendPush**

Add at the top with other service imports:

```typescript
import { sendPush } from '../services/pushNotification.js';
```

- [ ] **Step 2: Add push on message:send (support reply to agent)**

Find the `message:send` handler (around line 714). After the message is inserted and emitted to the room, add a push notification to the agent if the sender is support:

```typescript
// Push notification to agent when support replies
if (socket.data.isSupport && ticket.agentId) {
  sendPush(ticket.agentId, {
    title: 'New reply on your ticket',
    body: (typeof msgText === 'string' ? msgText : '').slice(0, 100),
    ticketId: ticket.id,
    type: 'reply',
    tag: `ticket-${ticket.id}`,
  });
}
```

Find the right location — after `io.to(Rooms.ticket(ticketId)).emit('message:new', msg)` is called. The `ticket` object should be available from the handler context — check how the handler accesses the ticket data (it may query the DB for the ticket to get `agentId`). If `agentId` isn't available directly, query it:

```typescript
const ticketRow = await findTicketById(ticketId);
if (socket.data.isSupport && ticketRow?.agentId) {
  sendPush(ticketRow.agentId, { ... });
}
```

Use the existing `findTicketById` or equivalent query function if available.

- [ ] **Step 3: Add push on support:join**

Find the `support:join` handler (around line 531). After the support agent joins the ticket room, push to the agent:

```typescript
// Push notification to agent when support joins
if (ticket.agentId) {
  sendPush(ticket.agentId, {
    title: 'Support joined your ticket',
    body: `${socket.data.name} joined your conversation`,
    ticketId: ticket.id,
    type: 'joined',
    tag: `ticket-${ticket.id}`,
  });
}
```

- [ ] **Step 4: Add push on ticket:close (rating request)**

Find the `ticket:close` handler (around line 627). After the ticket is closed and the `ticket:closed` event is emitted, push a rating request to the agent:

```typescript
// Push rating request to agent
if (ticket.agentId) {
  sendPush(ticket.agentId, {
    title: 'How was your experience?',
    body: 'Your ticket has been closed. Rate your support.',
    ticketId: ticket.id,
    type: 'rating',
    tag: `ticket-${ticket.id}`,
  });
}
```

- [ ] **Step 5: Add push on ticket status change**

Find where ticket status changes are emitted (search for `ticket:status` or status update events). If status changes happen via tRPC rather than socket, find the relevant tRPC mutation. Add:

```typescript
// Push status change to agent
if (ticket.agentId && newStatus !== 'closed') { // closed is handled by rating push
  sendPush(ticket.agentId, {
    title: 'Ticket status updated',
    body: `Your ticket is now: ${newStatus}`,
    ticketId: ticket.id,
    type: 'status',
    tag: `ticket-${ticket.id}`,
  });
}
```

- [ ] **Step 6: Commit**

```bash
git add server/socket/handlers.ts
git commit -m "feat(server): add push notification triggers in socket handlers

Fires push on: support reply to agent, support join, ticket close
(rating request), ticket status change. All fire-and-forget.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: Update service worker with push and notificationclick handlers

**Files:**
- Modify: `client/public/sw.js`

- [ ] **Step 1: Add push event handler**

At the end of `sw.js`, add:

```javascript
// ─── Push Notifications ─────────────────────────────────────────────────────

self.addEventListener('push', (event) => {
  if (!event.data) return;

  const payload = event.data.json();

  // Check if any Tessera tab is focused — suppress if so
  const promiseChain = self.clients.matchAll({ type: 'window', includeUncontrolled: true })
    .then((clients) => {
      const focused = clients.some((client) => client.focused);
      if (focused) return; // App is in foreground — skip notification

      return self.registration.showNotification(payload.title, {
        body: payload.body,
        icon: '/icons/icon-192x192.png',
        badge: '/icons/icon-72x72.png',
        tag: payload.tag || 'tessera',
        data: {
          ticketId: payload.ticketId,
          type: payload.type,
        },
        renotify: true,
      });
    });

  event.waitUntil(promiseChain);
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  const { ticketId } = event.notification.data || {};
  const targetUrl = ticketId ? `/?ticket=${ticketId}` : '/';

  const promiseChain = self.clients.matchAll({ type: 'window', includeUncontrolled: true })
    .then((clients) => {
      // Focus existing Tessera tab if open
      for (const client of clients) {
        if (client.url.includes(self.location.origin)) {
          client.focus();
          client.postMessage({ type: 'NAVIGATE_TICKET', ticketId });
          return;
        }
      }
      // No tab open — open new one
      return self.clients.openWindow(targetUrl);
    });

  event.waitUntil(promiseChain);
});
```

- [ ] **Step 2: Commit**

```bash
git add client/public/sw.js
git commit -m "feat(client): add push and notificationclick handlers to service worker

Shows OS notification only when no Tessera tab is focused.
Tap navigates to the ticket via postMessage or openWindow.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: Add i18n keys

**Files:**
- Modify: `client/src/locales/en.ts`
- Modify: `client/src/locales/fr.ts`
- Modify: `client/src/locales/nl.ts`

- [ ] **Step 1: Add keys**

en.ts:
```typescript
    push_enable: 'Enable push notifications',
    push_disable: 'Disable push notifications',
    push_not_supported: 'Push notifications not supported in this browser',
    push_permission_denied: 'Notification permission denied',
```

fr.ts:
```typescript
    push_enable: 'Activer les notifications push',
    push_disable: 'Désactiver les notifications push',
    push_not_supported: 'Notifications push non supportées dans ce navigateur',
    push_permission_denied: 'Permission de notification refusée',
```

nl.ts:
```typescript
    push_enable: 'Pushmeldingen inschakelen',
    push_disable: 'Pushmeldingen uitschakelen',
    push_not_supported: 'Pushmeldingen worden niet ondersteund in deze browser',
    push_permission_denied: 'Toestemming voor meldingen geweigerd',
```

- [ ] **Step 2: Commit**

```bash
git add client/src/locales/en.ts client/src/locales/fr.ts client/src/locales/nl.ts
git commit -m "feat(i18n): add push notification translation keys

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

### Task 8: Extend NotificationToggle for push subscriptions

**Files:**
- Modify: `client/src/components/NotificationToggle.tsx`

- [ ] **Step 1: Read the current component**

Read `client/src/components/NotificationToggle.tsx` to understand the current bell icon toggle.

- [ ] **Step 2: Add push subscription logic for agents**

The component currently toggles a boolean store flag. Extend it so that when the user is an agent, clicking the bell also handles the Web Push subscription:

```typescript
// At the top, add:
import useStore from '../store/useStore';
import { useT } from '../i18n';

// Inside the component, add:
const user = useStore((s) => s.user);
const t = useT();
const isAgent = user?.role === 'agent';

// Add state for push subscription:
const [pushSubscribed, setPushSubscribed] = useState(false);
const [pushLoading, setPushLoading] = useState(false);

// Check existing subscription on mount:
useEffect(() => {
  if (!isAgent || !('serviceWorker' in navigator) || !('PushManager' in window)) return;
  navigator.serviceWorker.ready.then((reg) => {
    reg.pushManager.getSubscription().then((sub) => {
      setPushSubscribed(!!sub);
    });
  });
}, [isAgent]);

// Handle push toggle:
async function togglePush() {
  if (pushLoading) return;
  setPushLoading(true);

  try {
    const reg = await navigator.serviceWorker.ready;

    if (pushSubscribed) {
      // Unsubscribe
      const sub = await reg.pushManager.getSubscription();
      if (sub) {
        await fetch('/api/v1/push/unsubscribe', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ endpoint: sub.endpoint }),
        });
        await sub.unsubscribe();
      }
      setPushSubscribed(false);
    } else {
      // Subscribe
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') {
        setPushLoading(false);
        return;
      }

      // Fetch VAPID key
      const keyRes = await fetch('/api/v1/push/vapid-key', { credentials: 'include' });
      if (!keyRes.ok) { setPushLoading(false); return; }
      const { vapidPublicKey } = await keyRes.json();

      // Convert VAPID key
      const applicationServerKey = urlBase64ToUint8Array(vapidPublicKey);

      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey,
      });

      // Send to server
      await fetch('/api/v1/push/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          subscription: {
            endpoint: sub.endpoint,
            keys: {
              p256dh: btoa(String.fromCharCode(...new Uint8Array(sub.getKey('p256dh')!))),
              auth: btoa(String.fromCharCode(...new Uint8Array(sub.getKey('auth')!))),
            },
          },
        }),
      });
      setPushSubscribed(true);
    }
  } catch (err) {
    console.error('[push] Toggle error:', err);
  } finally {
    setPushLoading(false);
  }
}

// Helper function (add outside component or at top of file):
function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  const arr = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; ++i) arr[i] = raw.charCodeAt(i);
  return arr;
}
```

For agents, the click handler should call `togglePush()` instead of (or in addition to) the existing toggle. The bell icon visual state should reflect `pushSubscribed` for agents.

Update the button's `onClick`, `aria-label`, and icon fill based on whether `isAgent && pushSubscribed`:

```tsx
<button
  onClick={isAgent ? togglePush : existingToggle}
  aria-label={isAgent
    ? (pushSubscribed ? t('push_disable') : t('push_enable'))
    : existingLabel}
  title={isAgent
    ? (pushSubscribed ? t('push_disable') : t('push_enable'))
    : existingTitle}
  // ... rest of button
>
```

Adapt this to the existing component structure — read the file to see how the bell icon and toggle work.

- [ ] **Step 3: Commit**

```bash
git add client/src/components/NotificationToggle.tsx
git commit -m "feat(client): extend NotificationToggle with Web Push for agents

Agents clicking the bell subscribe/unsubscribe from push notifications.
Handles permission request, VAPID key fetch, subscription lifecycle.
Non-agents keep existing toggle behavior.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

### Task 9: Handle notification click navigation in AgentView

**Files:**
- Modify: `client/src/views/AgentView.tsx`

- [ ] **Step 1: Listen for service worker postMessage**

When the service worker sends `{ type: 'NAVIGATE_TICKET', ticketId }` on notification click, the app should navigate to that ticket.

In AgentView, add a `useEffect` to listen for service worker messages:

```typescript
useEffect(() => {
  function handleSwMessage(event: MessageEvent) {
    if (event.data?.type === 'NAVIGATE_TICKET' && event.data.ticketId) {
      // Set the active ticket to the one from the notification
      // Use existing store action or navigation logic
      const ticketId = event.data.ticketId;
      // Find ticket in store or fetch it, then set as active
      setActiveTicket(ticketId); // adapt to actual function name
    }
  }
  navigator.serviceWorker?.addEventListener('message', handleSwMessage);
  return () => navigator.serviceWorker?.removeEventListener('message', handleSwMessage);
}, []);
```

Also handle the URL query param `?ticket=` for when the app opens fresh:

```typescript
useEffect(() => {
  const params = new URLSearchParams(window.location.search);
  const ticketId = params.get('ticket');
  if (ticketId) {
    setActiveTicket(ticketId);
    // Clean URL
    window.history.replaceState({}, '', window.location.pathname);
  }
}, []);
```

Adapt to the actual AgentView patterns — read the file to see how tickets are opened.

- [ ] **Step 2: Commit**

```bash
git add client/src/views/AgentView.tsx
git commit -m "feat(client): handle notification click navigation in AgentView

Listens for service worker postMessage and URL ?ticket= param
to navigate directly to the ticket that triggered the notification.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

### Task 10: Type check and test

**Files:**
- No new files

- [ ] **Step 1: Run TypeScript type check on server**

```bash
docker compose exec server npx tsc --noEmit
```

- [ ] **Step 2: Run TypeScript type check on client**

```bash
docker compose exec client npx tsc --noEmit
```

- [ ] **Step 3: Run server tests**

```bash
docker compose exec server npm test
```

- [ ] **Step 4: Run client tests**

```bash
docker compose exec client npm test
```

- [ ] **Step 5: Commit any fixes**

```bash
git add -A
git commit -m "fix: resolve type errors from push notification implementation

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

### Task 11: Manual smoke test

- [ ] **Step 1: Verify VAPID key endpoint**

Open browser: `http://localhost:3001/api/v1/push/vapid-key`
Expected: `{ "vapidPublicKey": "..." }` or `503` if keys not set.

- [ ] **Step 2: Test bell icon as agent**

1. Log in as an agent (e.g., `agent_sarah` / `password123`)
2. Find the bell icon in AgentNav
3. Click it — browser should request notification permission
4. Grant permission
5. Verify bell icon changes to "subscribed" state

- [ ] **Step 3: Test push notification**

1. As agent, have a ticket open
2. In another browser, log in as support and reply to the agent's ticket
3. Switch to the agent tab — if focused, no notification should appear
4. Minimize the agent tab, then send another reply from support
5. Verify: OS notification appears with "New reply on your ticket"

- [ ] **Step 4: Test notification click**

1. Receive a push notification
2. Click it
3. Verify: Tessera app opens/focuses and navigates to the ticket

- [ ] **Step 5: Test unsubscribe**

1. Click bell icon again to unsubscribe
2. Send another reply from support
3. Verify: no notification appears

- [ ] **Step 6: Verify non-agent users don't see push**

1. Log in as support or admin
2. Verify: bell icon exists but does NOT trigger push subscription (just toggles in-app notifications)

- [ ] **Step 7: Final commit if fixes needed**

```bash
git add -A
git commit -m "fix: address smoke test findings for push notifications

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```
