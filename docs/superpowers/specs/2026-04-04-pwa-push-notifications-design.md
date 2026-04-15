# PWA Push Notifications (Agent-Only) — Design Spec

## Overview

Add Web Push notifications for agents (end-users) so they receive OS-level alerts when support interacts with their tickets. Push only fires when no Guichet tab is focused. Support, admin, and platform operators do not receive push notifications.

## Trigger Events

| Event | Title | Body |
|---|---|---|
| Support replied | "New reply on your ticket" | First 100 chars of message |
| Status changed | "Ticket status updated" | "Your ticket is now: [status]" |
| Support joined | "Support joined your ticket" | "[Name] joined your conversation" |
| Rating request | "How was your experience?" | "Your ticket has been closed. Rate your support." |

## Opt-In

- All-or-nothing toggle via bell icon in AgentNav (existing `NotificationToggle` component extended)
- Only visible to agents (`role === 'agent'`)
- First enable triggers browser notification permission request
- Subscription stored server-side in `push_subscriptions` table

## Architecture

### Web Push Flow

1. Agent clicks bell icon → browser requests permission → generates push subscription (endpoint + keys)
2. Client sends subscription to `POST /api/v1/push/subscribe`
3. Server stores in `push_subscriptions` table
4. On trigger event, server calls `web-push` library to send notification
5. Service worker receives push, checks if any Guichet tab is focused — if not, shows OS notification
6. Agent taps notification → app opens to the specific ticket

### Notification Payload

```json
{
  "title": "New reply on your ticket",
  "body": "Hi Sarah, I've checked your router...",
  "ticketId": "tk_001",
  "type": "reply",
  "tag": "ticket-tk_001"
}
```

`tag` groups notifications per ticket — new events replace previous notification for same ticket.

## Data Model

### New Table: `push_subscriptions`

| Column | Type | Purpose |
|---|---|---|
| `id` | text PK | UUID |
| `userId` | text FK → users (cascade) | Agent who subscribed |
| `endpoint` | text | Push service URL |
| `keys` | JSONB | `{ p256dh, auth }` encryption keys |
| `createdAt` | timestamp | When subscription was created |

Index on `userId` for lookup when sending.

## Server-Side

### New Service: `server/services/pushNotification.ts`

- `subscribe(userId, subscription)` — stores push subscription
- `unsubscribe(userId, endpoint)` — removes subscription
- `sendPush(userId, payload)` — sends to all subscriptions for user. Catches 410 (expired) and deletes stale subscriptions.

### New Routes: `server/routes/push.ts`

- `POST /api/v1/push/subscribe` — body: `{ subscription }`. Auth required, agent-only.
- `POST /api/v1/push/unsubscribe` — body: `{ endpoint }`. Auth required.

### Push Triggers in Socket Handlers

Fire-and-forget calls in `server/socket/handlers.ts`:

- `message:send` → if recipient is an agent and sender is support, push "New reply"
- `ticket:close` → push "Rating request" to agent
- `support:join` → push "Support joined" to agent
- Status change events → push "Status updated" to agent

All push calls check `role === 'agent'` before sending.

### VAPID Configuration

- `VAPID_PUBLIC_KEY` — exposed to client for subscription
- `VAPID_PRIVATE_KEY` — server-only for signing push messages
- `VAPID_SUBJECT` — contact email (e.g., `mailto:admin@guichet.app`)
- Added to `server/config.ts` with Zod validation (optional — push disabled if not set)

## Client-Side

### NotificationToggle Extension

- When `user.role === 'agent'`, the bell icon also handles push subscription
- Click: if not subscribed → request permission → subscribe → POST to server
- Click again: unsubscribe → POST to server
- Visual state: filled bell (subscribed) vs outline bell (not subscribed)

### Service Worker (`client/public/sw.js`)

Add two event handlers:

```javascript
self.addEventListener('push', (event) => {
  // Check if any Guichet tab is focused — skip if so
  // Parse payload, show notification with title/body/icon/tag
});

self.addEventListener('notificationclick', (event) => {
  // Close notification
  // Open or focus Guichet tab at /ticket/{ticketId}
});
```

### Manifest

Verify `client/public/manifest.json` has no `gcm_sender_id` (not needed for standard Web Push).

## Edge Cases

- **Permission denied** — bell shows "off" state, no subscription sent, no error
- **Multiple devices** — multiple subscriptions per userId, push sent to all
- **Subscription expired** — server catches 410 response, deletes stale subscription
- **Tab focused** — service worker suppresses notification via `clients.matchAll()`
- **Offline** — push queued by push service, delivered when online
- **GDPR** — subscriptions cascade-deleted with user

## Dependencies

- `web-push` npm package (server-side) — needs to be installed if not present
- No client-side dependencies — uses native Push API and Service Worker API
