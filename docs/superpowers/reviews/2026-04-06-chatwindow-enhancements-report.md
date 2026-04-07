# ChatWindow Enhancements — Final Report

**Date:** 2026-04-07
**Tracks delivered:** 8 (0, A, B, C, D, E, F, G)
**Commits:** 13 (9 feature + 2 fix + 1 missed-staging + 1 docs)

---

## What Was Delivered

| Track | Feature | Files Created | Files Modified | DB Migration |
|-------|---------|--------------|----------------|-------------|
| **0** | ChatWindow decomposition | 4 (ChatHeader, MessageList, ComposeArea, index) | 1 (ChatWindow) | None |
| **F** | WhatsApp delivery checkmarks | 1 (DeliveryStatus) | 4 (MessageBubble, types, mapper, i18n) | None |
| **B** | Unread divider + jump-to-bottom FAB | 0 | 4 (ChatWindow, MessageList, i18n×3) | None |
| **G** | Label colors + inline picker | 2 (labelColors util, LabelPicker) | 4 (ChatHeader, AdminLabels, barrel, i18n) | None |
| **A** | Reply/quote inline block | 2 (QuoteBlock, migration) | 8 (schema, handlers, mapper, types, MessageBubble, ChatWindow, MessageList, ComposeArea) | `reply_to_id` column |
| **C** | Markdown rendering | 1 (markdown util) | 3 (MessageBubble, index.css, package.json) | None |
| **D** | Link preview / OG unfurling | 2 (linkPreview service, LinkPreviewCard) | 5 (schema, handlers, mapper, useSocket, messageSlice) | `link_previews` column |
| **E** | Multi-file upload | 1 (AttachmentGrid) | 6 (schema, uploads route, handlers, mapper, ComposeArea, MessageBubble) | `attachments` column |

## Architecture After

```
client/src/components/
  ChatWindow.tsx          (362 lines — thin shell)
  MessageBubble.tsx       (enhanced: replies, markdown, previews, attachments, checkmarks)
  chat/
    index.ts              (barrel)
    ChatHeader.tsx         (364 — header, labels, picker, transfer, summary)
    MessageList.tsx        (131 — scroll, messages, divider, FAB)
    ComposeArea.tsx        (488 — input, multi-upload, reply banner, AI)
    DeliveryStatus.tsx     (checkmarks)
    QuoteBlock.tsx         (reply quote block)
    LinkPreviewCard.tsx    (OG preview card)
    AttachmentGrid.tsx     (image grid + file cards)
    LabelPicker.tsx        (inline label dropdown)

client/src/utils/
    labelColors.ts         (shared color mapping)
    markdown.ts            (marked + DOMPurify pipeline)

server/services/
    linkPreview.ts         (OG unfurling + SSRF protection)
```

## Code Review Findings

Full review at: `docs/superpowers/reviews/2026-04-06-chatwindow-enhancements-review.md`

### Critical — FIXED (`9f5b456`)

1. ~~**SSRF bypass in link previews**~~ — **FIXED.** `isSafeUrl()` now resolves both A+AAAA DNS records, normalizes `::ffff:` mapped IPv4, rejects unresolvable hostnames, uses `net.isIP()` for literal detection.

### Important — FIXED (`9f5b456`)

2. ~~**N+1 query in reply snippets**~~ — **FIXED.** New `resolveReplySnippetsBatch()` fetches all reply snippets in one `WHERE id IN (...)` query.
3. ~~**`shadow-xl` on transfer dropdown**~~ — **FIXED.** Removed from ChatHeader.

### Important — FIXED (`329607b`)

4. ~~**Optimistic message missing `replyTo`**~~ — **FIXED.** `replyToId`/`replyTo` now included in optimistic message in ComposeArea.
5. ~~**Borderline motion**~~ — **FIXED.** Removed `transition-colors` from LinkPreviewCard and MessageList load-older button.

### Minor — FIXED (`329607b`)

6. ~~QuoteBlock Space key~~ — **FIXED.** Added Space key alongside Enter for accessibility.
7. ~~LabelPicker MAX_LABELS~~ — **FIXED.** Client-side enforcement at 50, disabled state on excess.
8. ~~Label badges font-mono~~ — **FIXED.** Added `font-mono` to ChatHeader label badges.

## Advice

### What to do next (priority order)

1. ~~**Fix the SSRF bypass**~~ — **DONE** (`9f5b456`)
2. ~~**Fix the N+1 reply query**~~ — **DONE** (`9f5b456`)
3. ~~**Remove `shadow-xl`**~~ — **DONE** (`9f5b456`)
4. ~~**Fix optimistic reply**~~ — **DONE** (`329607b`)
5. ~~**Remove `transition-colors`**~~ — **DONE** (`329607b`)
6. ~~**Fix QuoteBlock/LabelPicker/font-mono**~~ — **DONE** (`329607b`)
7. **Manual smoke test all 7 features** — Before shipping, test each feature end-to-end in the browser. The subagents typechecked but couldn't visually verify.
8. **Run the full CI pipeline** — `powershell -File scripts/ci.ps1` (note: typecheck, audit, migrate steps have pre-existing failures unrelated to our work)

### What NOT to do

- Don't add more features to MessageBubble without extracting it first — it's getting heavy.

### Future considerations — ALL DONE

- ~~**MessageBubble decomposition**~~ — **DONE.** Extracted `MessageContent.tsx` (113 lines) handling quote block, text/markdown, attachments, link previews. MessageBubble reduced from 371 to 303 lines.
- ~~**Redis cache for link previews**~~ — **DONE** (`5cc5527`). `og:` prefixed cache with 24h TTL in `linkPreview.ts`. Best-effort, graceful on Redis unavailability.
- ~~**E2E tests**~~ — **DONE** (`a9c76e8`). 7 Playwright tests in `testing/e2e/chat-enhancements.spec.ts`: delivery checkmarks, markdown, reply/quote, FAB, label picker, date separators, multi-file upload.
- ~~**Date separators**~~ — **DONE** (`0f848bd`). Today/Yesterday/formatted-date dividers in MessageList. i18n for en/nl/fr.

### Remaining future work

- **E2E test execution** — The 7 new E2E tests are written but need a running seeded app to execute. Run: `npx playwright test testing/e2e/chat-enhancements.spec.ts`
- **Link preview Redis cache warming** — Currently only caches on first fetch. Could pre-warm for frequently shared URLs.
- **MessageBubble further decomposition** — Still 303 lines. Reactions section (~40 lines) and action bar (~30 lines) could become sub-components if the file grows again.
