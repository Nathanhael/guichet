# Track F: Delivery Checkmarks (WhatsApp Style) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the cryptic `R`/`D` text indicators with WhatsApp-style checkmarks (single grey = sent, double grey = delivered, double blue = read).

**Architecture:** New presentational `DeliveryStatus` component in `chat/` folder. One-line change in `MessageBubble.tsx` to swap the text for the component. No backend changes.

**Tech Stack:** React 19, TypeScript, inline SVG, CSS custom properties

**Depends on:** Track 0 (ChatWindow decomposition) — `chat/` directory must exist.

---

### Task 1: Create `DeliveryStatus.tsx` component

**Files:**
- Create: `client/src/components/chat/DeliveryStatus.tsx`

- [ ] **Step 1: Write the component**

```tsx
// client/src/components/chat/DeliveryStatus.tsx
import { useT } from '../../i18n';

interface DeliveryStatusProps {
  deliveredAt?: string | null;
  readAt?: string | null;
}

/**
 * WhatsApp-style delivery checkmarks.
 * - Single check (grey): sent
 * - Double check (grey): delivered
 * - Double check (blue): read
 *
 * SVG uses sharp angles (no curves) to match brutalist design.
 */
export default function DeliveryStatus({ deliveredAt, readAt }: DeliveryStatusProps) {
  const t = useT();

  const isRead = !!readAt;
  const isDelivered = !!deliveredAt;

  const label = isRead
    ? (t('status_read') || 'Read')
    : isDelivered
      ? (t('status_delivered') || 'Delivered')
      : (t('status_sent') || 'Sent');

  const color = isRead
    ? 'var(--color-accent-blue)'
    : 'var(--color-text-secondary)';

  const showDouble = isDelivered || isRead;

  return (
    <span title={label} aria-label={label} className="inline-flex items-center ml-1">
      <svg
        width={showDouble ? 18 : 12}
        height={14}
        viewBox={showDouble ? '0 0 18 14' : '0 0 12 14'}
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        aria-hidden="true"
      >
        {/* First check — always visible */}
        <polyline
          points={showDouble ? '1,7 4,11 10,3' : '1,7 4,11 10,3'}
          stroke={color}
          strokeWidth={1.5}
          strokeLinecap="square"
          strokeLinejoin="miter"
          fill="none"
        />
        {/* Second check — only for delivered/read */}
        {showDouble && (
          <polyline
            points="5,7 8,11 14,3"
            stroke={color}
            strokeWidth={1.5}
            strokeLinecap="square"
            strokeLinejoin="miter"
            fill="none"
          />
        )}
      </svg>
    </span>
  );
}
```

- [ ] **Step 2: Export from barrel**

Add to `client/src/components/chat/index.ts`:
```ts
export { default as DeliveryStatus } from './DeliveryStatus';
```

- [ ] **Step 3: Typecheck**

Run: `docker compose exec client npx tsc --noEmit`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add client/src/components/chat/DeliveryStatus.tsx client/src/components/chat/index.ts
git commit -m "feat(track-f): add DeliveryStatus component with WhatsApp-style checkmarks"
```

---

### Task 2: Replace R/D text in MessageBubble

**Files:**
- Modify: `client/src/components/MessageBubble.tsx`

- [ ] **Step 1: Import DeliveryStatus**

At the top of `MessageBubble.tsx`, add:
```ts
import { DeliveryStatus } from './chat';
```

- [ ] **Step 2: Find and replace the R/D indicator**

Find the existing delivery status rendering (around line 275):
```tsx
{isMine && !isDeleted && (
  <span className="text-[10px] font-bold">{message.readAt ? 'R' : 'D'}</span>
)}
```

Replace with:
```tsx
{isMine && !isDeleted && !message.system && (
  <DeliveryStatus deliveredAt={message.deliveredAt} readAt={message.readAt} />
)}
```

> **Note:** The `Message` interface has `readAt` but may not expose `deliveredAt` on the client type. Check `client/src/types/index.ts` — if `deliveredAt` is missing, add it in Task 3.

- [ ] **Step 3: Typecheck**

Run: `docker compose exec client npx tsc --noEmit`
Expected: No errors (if `deliveredAt` exists on Message type). If it fails, proceed to Task 3.

- [ ] **Step 4: Commit**

```bash
git add client/src/components/MessageBubble.tsx
git commit -m "feat(track-f): replace R/D text with DeliveryStatus checkmarks in MessageBubble"
```

---

### Task 3: Add `deliveredAt` to Message type (if missing)

**Files:**
- Modify: `client/src/types/index.ts` (only if `deliveredAt` is not in the Message interface)

- [ ] **Step 1: Check if `deliveredAt` exists**

Look at the Message interface. Current fields include `readAt` but check for `deliveredAt`:
```ts
export interface Message {
  // ...
  readAt?: string | null;
  // deliveredAt may or may not be here
}
```

If missing, add it after `readAt`:
```ts
deliveredAt?: string | null;
```

- [ ] **Step 2: Verify the server sends `deliveredAt`**

The `messages` table has `deliveredAt`. Check `server/utils/messageMapper.ts` to confirm it's included in the mapped response. If not, add it to the mapper.

- [ ] **Step 3: Typecheck**

Run: `docker compose exec client npx tsc --noEmit`
Expected: No errors

- [ ] **Step 4: Commit (if changes were needed)**

```bash
git add client/src/types/index.ts server/utils/messageMapper.ts
git commit -m "feat(track-f): add deliveredAt to Message type and mapper"
```

---

### Task 4: Add i18n keys

**Files:**
- Modify: i18n translation files (all 3 languages)

- [ ] **Step 1: Add translation keys**

| Key | EN | NL | FR |
|-----|----|----|-----|
| `status_sent` | `Sent` | `Verzonden` | `Envoyé` |
| `status_delivered` | `Delivered` | `Afgeleverd` | `Livré` |
| `status_read` | `Read` | `Gelezen` | `Lu` |

- [ ] **Step 2: Commit**

```bash
git add client/src/i18n/
git commit -m "feat(track-f): add i18n keys for delivery status tooltips"
```

---

### Task 5: Verify

- [ ] **Step 1: Manual smoke test**

1. Open a ticket chat as support
2. Send a message → see single grey ✓ (sent)
3. Have the agent's client receive it → see double grey ✓✓ (delivered) 
4. Agent reads the message → see double blue ✓✓ (read)
5. Verify whisper messages show checkmarks
6. Verify deleted messages do NOT show checkmarks
7. Verify system messages do NOT show checkmarks
8. Check old messages without `deliveredAt` → should show single ✓

- [ ] **Step 2: Run existing tests**

Run: `docker compose exec client npm test`
Expected: All pass

- [ ] **Step 3: Final commit**

```bash
git commit -m "feat(track-f): complete delivery checkmarks — WhatsApp style"
```

---

## Summary

Track F creates one new component (`DeliveryStatus.tsx`) and makes a one-line swap in `MessageBubble.tsx`. No backend changes unless `deliveredAt` is missing from the client type.
