# Track D: Link Previews (Server-Side OG Unfurling) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Automatically fetch Open Graph metadata for URLs in chat messages and display rich preview cards below the message text.

**Architecture:** New `linkPreviews` JSONB column on `messages`, new server-side unfurling service with SSRF protection, async fire-and-forget after message save, new `message:linkPreview` socket event, new `LinkPreviewCard` client component.

**Tech Stack:** React 19, TypeScript, Drizzle ORM, Node.js `fetch` (built-in), Socket.io, Tailwind CSS

**Depends on:** Track 0 (ChatWindow decomposition)

---

### Task 1: Database migration — add `linkPreviews` column

**Files:**
- Modify: `server/db/schema.ts`

- [ ] **Step 1: Add the column**

In `server/db/schema.ts`, find the `messages` table. Add after `deletedAt`:

```ts
linkPreviews: jsonb('link_previews').$type<Array<{
  url: string;
  title?: string;
  description?: string;
  image?: string;
  siteName?: string;
}>>(),
```

- [ ] **Step 2: Generate and apply migration**

```bash
docker compose exec server npx drizzle-kit generate
docker compose exec server npx drizzle-kit push
```

- [ ] **Step 3: Commit**

```bash
git add server/db/schema.ts server/drizzle/
git commit -m "feat(track-d): add linkPreviews JSONB column to messages table"
```

---

### Task 2: Create link preview service with SSRF protection

**Files:**
- Create: `server/services/linkPreview.ts`

- [ ] **Step 1: Write the service**

```ts
// server/services/linkPreview.ts
import { lookup } from 'dns/promises';
import logger from '../utils/logger.js';

export interface LinkPreview {
  url: string;
  title?: string;
  description?: string;
  image?: string;
  siteName?: string;
}

const URL_REGEX = /https?:\/\/[^\s<>"{}|\\^`[\]]+/gi;
const MAX_URLS = 3;
const FETCH_TIMEOUT_MS = 2000;
const MAX_BODY_BYTES = 50 * 1024; // 50KB
const MAX_REDIRECTS = 2;

/**
 * Extract up to MAX_URLS URLs from message text.
 */
export function extractUrls(text: string): string[] {
  const matches = text.match(URL_REGEX);
  if (!matches) return [];
  return [...new Set(matches)].slice(0, MAX_URLS);
}

/**
 * SSRF protection: reject private/loopback IPs.
 */
async function isSafeUrl(urlStr: string): Promise<boolean> {
  try {
    const url = new URL(urlStr);
    if (!['http:', 'https:'].includes(url.protocol)) return false;

    // Reject IP literals in private ranges
    const host = url.hostname;
    if (/^(127\.|10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.|169\.254\.|0\.|::1|fe80:)/i.test(host)) {
      return false;
    }
    if (host === 'localhost') return false;

    // DNS resolution check — reject if hostname resolves to private IP
    try {
      const { address } = await lookup(host);
      if (/^(127\.|10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.|169\.254\.|0\.)/.test(address)) {
        return false;
      }
    } catch {
      return false; // DNS failure = reject
    }

    return true;
  } catch {
    return false;
  }
}

/**
 * Parse OG meta tags from partial HTML.
 */
function parseOgTags(html: string): Partial<LinkPreview> {
  const result: Partial<LinkPreview> = {};

  const getContent = (property: string): string | undefined => {
    const regex = new RegExp(`<meta[^>]+property=["']og:${property}["'][^>]+content=["']([^"']*)["']`, 'i');
    const altRegex = new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]+property=["']og:${property}["']`, 'i');
    const match = html.match(regex) || html.match(altRegex);
    return match?.[1]?.trim();
  };

  const title = getContent('title');
  const description = getContent('description');
  const image = getContent('image');
  const siteName = getContent('site_name');

  if (title) result.title = title.slice(0, 120);
  if (description) result.description = description.slice(0, 200);
  if (image) result.image = image;
  if (siteName) result.siteName = siteName.slice(0, 60);

  // Fallback: <title> tag if no og:title
  if (!result.title) {
    const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
    if (titleMatch) result.title = titleMatch[1].trim().slice(0, 120);
  }

  return result;
}

/**
 * Fetch OG data for a single URL. Returns null on failure.
 */
async function fetchOgData(urlStr: string): Promise<LinkPreview | null> {
  try {
    if (!await isSafeUrl(urlStr)) return null;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

    try {
      const response = await fetch(urlStr, {
        signal: controller.signal,
        headers: { 'Accept': 'text/html', 'User-Agent': 'Tessera-LinkPreview/1.0' },
        redirect: 'follow',
      });

      clearTimeout(timeout);

      if (!response.ok) return null;
      const contentType = response.headers.get('content-type') || '';
      if (!contentType.includes('text/html')) return null;

      // Read only first 50KB
      const reader = response.body?.getReader();
      if (!reader) return null;

      let body = '';
      let bytesRead = 0;
      const decoder = new TextDecoder();

      while (bytesRead < MAX_BODY_BYTES) {
        const { done, value } = await reader.read();
        if (done) break;
        body += decoder.decode(value, { stream: true });
        bytesRead += value.length;
      }
      reader.cancel();

      const ogData = parseOgTags(body);
      if (!ogData.title && !ogData.description) return null;

      return { url: urlStr, ...ogData };
    } catch {
      clearTimeout(timeout);
      return null;
    }
  } catch (err) {
    logger.debug({ err, url: urlStr }, '[linkPreview] fetch failed');
    return null;
  }
}

/**
 * Unfurl all URLs in a message text. Returns preview data array.
 */
export async function unfurlLinks(text: string): Promise<LinkPreview[]> {
  const urls = extractUrls(text);
  if (urls.length === 0) return [];

  const results = await Promise.allSettled(urls.map(fetchOgData));
  return results
    .filter((r): r is PromiseFulfilledResult<LinkPreview | null> => r.status === 'fulfilled')
    .map((r) => r.value)
    .filter((v): v is LinkPreview => v !== null);
}
```

- [ ] **Step 2: Typecheck**

Run: `docker compose exec server npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add server/services/linkPreview.ts
git commit -m "feat(track-d): add link preview service with SSRF protection and OG parsing"
```

---

### Task 3: Wire unfurling into message:send socket handler

**Files:**
- Modify: `server/socket/handlers.ts`
- Modify: `server/utils/messageMapper.ts`

- [ ] **Step 1: Import the service**

In `handlers.ts`:
```ts
import { unfurlLinks } from '../services/linkPreview.js';
```

- [ ] **Step 2: Add async unfurl after message save**

In the `message:send` handler, after the message is saved and broadcast, add:

```ts
// Fire-and-forget: unfurl links asynchronously
if (savedMessage.text) {
  unfurlLinks(savedMessage.text).then(async (previews) => {
    if (previews.length === 0) return;
    try {
      await db
        .update(messages)
        .set({ linkPreviews: previews })
        .where(eq(messages.id, savedMessage.id));

      io.to(Rooms.ticket(ticketId)).emit('message:linkPreview', {
        ticketId,
        messageId: savedMessage.id,
        linkPreviews: previews,
      });
    } catch (err) {
      logger.error({ err }, '[linkPreview] failed to save previews');
    }
  }).catch((err) => {
    logger.debug({ err }, '[linkPreview] unfurl failed');
  });
}
```

> **Key:** This is fire-and-forget. The message is already saved and broadcast. The link preview arrives as a separate event moments later.

- [ ] **Step 3: Include linkPreviews in messageMapper**

In `server/utils/messageMapper.ts`, add to the mapped output:
```ts
linkPreviews: row.linkPreviews || null,
```

- [ ] **Step 4: Typecheck**

Run: `docker compose exec server npx tsc --noEmit`
Expected: No errors

- [ ] **Step 5: Commit**

```bash
git add server/socket/handlers.ts server/utils/messageMapper.ts
git commit -m "feat(track-d): wire async link unfurling into message:send handler"
```

---

### Task 4: Client — handle message:linkPreview event

**Files:**
- Modify: `client/src/types/index.ts`
- Modify: `client/src/hooks/useSocket.ts`
- Modify: `client/src/store/slices/messageSlice.ts`

- [ ] **Step 1: Add linkPreviews to Message type**

In `client/src/types/index.ts`, add to Message interface:

```ts
export interface Message {
  // ... existing fields
  linkPreviews?: Array<{
    url: string;
    title?: string;
    description?: string;
    image?: string;
    siteName?: string;
  }> | null;
}
```

- [ ] **Step 2: Add store action to update message link previews**

In `client/src/store/slices/messageSlice.ts`, add an action:

```ts
updateMessagePreviews: (ticketId: string, messageId: string, linkPreviews: Message['linkPreviews']) => {
  set((state) => {
    const msgs = state.messages[ticketId];
    if (!msgs) return state;
    return {
      messages: {
        ...state.messages,
        [ticketId]: msgs.map((m) =>
          m.id === messageId ? { ...m, linkPreviews } : m
        ),
      },
    };
  });
},
```

Add `updateMessagePreviews` to the `MessageSlice` interface.

- [ ] **Step 3: Add socket listener**

In `client/src/hooks/useSocket.ts`, add a handler for the new event:

```ts
const handleLinkPreview = ({ ticketId, messageId, linkPreviews }: {
  ticketId: string;
  messageId: string;
  linkPreviews: Message['linkPreviews'];
}) => {
  useStore.getState().updateMessagePreviews(ticketId, messageId, linkPreviews);
};

// In the listener registration:
s.on('message:linkPreview', handleLinkPreview);

// In cleanup:
s.off('message:linkPreview', handleLinkPreview);
```

- [ ] **Step 4: Typecheck**

Run: `docker compose exec client npx tsc --noEmit`
Expected: No errors

- [ ] **Step 5: Commit**

```bash
git add client/src/types/index.ts client/src/store/slices/messageSlice.ts client/src/hooks/useSocket.ts
git commit -m "feat(track-d): handle message:linkPreview event on client"
```

---

### Task 5: Create LinkPreviewCard component

**Files:**
- Create: `client/src/components/chat/LinkPreviewCard.tsx`

- [ ] **Step 1: Write the component**

```tsx
// client/src/components/chat/LinkPreviewCard.tsx
import { Link2 } from 'lucide-react';

interface LinkPreviewCardProps {
  url: string;
  title?: string;
  description?: string;
  image?: string;
  siteName?: string;
}

export default function LinkPreviewCard({ url, title, description, image, siteName }: LinkPreviewCardProps) {
  if (!title && !description) return null;

  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className="flex gap-3 bg-bg-elevated border border-border p-2 mt-1.5 hover:bg-bg-surface transition-colors duration-150 no-underline"
    >
      {/* Image or fallback icon */}
      <div className="w-[60px] h-[60px] shrink-0 bg-bg-surface border border-border flex items-center justify-center overflow-hidden">
        {image ? (
          <img
            src={image}
            alt=""
            className="w-full h-full object-cover"
            onError={(e) => {
              // Replace broken image with icon
              (e.target as HTMLImageElement).style.display = 'none';
              (e.target as HTMLImageElement).parentElement!.classList.add('flex', 'items-center', 'justify-center');
            }}
          />
        ) : (
          <Link2 size={20} className="text-text-secondary" />
        )}
      </div>

      {/* Text content */}
      <div className="flex flex-col justify-center min-w-0 flex-1">
        {siteName && (
          <span className="font-mono text-[8px] uppercase tracking-widest text-text-secondary truncate">
            {siteName}
          </span>
        )}
        {title && (
          <span className="font-bold text-[12px] text-text-primary truncate">
            {title}
          </span>
        )}
        {description && (
          <span className="text-[11px] text-text-secondary line-clamp-2">
            {description}
          </span>
        )}
      </div>
    </a>
  );
}
```

- [ ] **Step 2: Export from barrel**

Add to `client/src/components/chat/index.ts`:
```ts
export { default as LinkPreviewCard } from './LinkPreviewCard';
```

- [ ] **Step 3: Commit**

```bash
git add client/src/components/chat/LinkPreviewCard.tsx client/src/components/chat/index.ts
git commit -m "feat(track-d): add LinkPreviewCard component"
```

---

### Task 6: Render link previews in MessageBubble

**Files:**
- Modify: `client/src/components/MessageBubble.tsx`

- [ ] **Step 1: Import LinkPreviewCard**

```ts
import { LinkPreviewCard } from './chat';
```

- [ ] **Step 2: Render previews below message text**

After the message text rendering (and after QuoteBlock if Track A is also applied), add:

```tsx
{/* Link previews */}
{!isDeleted && message.linkPreviews && message.linkPreviews.length > 0 && (
  <div className="flex flex-col gap-1">
    {message.linkPreviews.map((preview) => (
      <LinkPreviewCard key={preview.url} {...preview} />
    ))}
  </div>
)}
```

- [ ] **Step 3: Typecheck**

Run: `docker compose exec client npx tsc --noEmit`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add client/src/components/MessageBubble.tsx
git commit -m "feat(track-d): render link preview cards in MessageBubble"
```

---

### Task 7: Verify

- [ ] **Step 1: Manual smoke test**

1. Send a message containing `https://github.com` → after a moment, a preview card appears below the text
2. Send a message with 3+ URLs → only first 3 get previews
3. Send a message with a private IP URL (`http://192.168.1.1`) → no preview (SSRF blocked)
4. Send a message with no URLs → no preview card
5. Send a URL that returns a non-HTML response → no preview card
6. Verify preview card shows: site name, title, description (2-line clamp), image thumbnail
7. Click the preview card → opens URL in new tab

- [ ] **Step 2: Run tests**

Run: `docker compose exec client npm test && docker compose exec server npm test`
Expected: All pass

- [ ] **Step 3: Final commit**

```bash
git add -A
git commit -m "feat(track-d): complete link previews with server-side OG unfurling"
```

---

## Summary

Track D delivers end-to-end link previews:
1. **Database:** `linkPreviews` JSONB column
2. **Server:** `linkPreview.ts` service with SSRF protection, async unfurl after save, `message:linkPreview` socket event
3. **Client:** `LinkPreviewCard` component, Zustand store update, socket listener, MessageBubble integration
