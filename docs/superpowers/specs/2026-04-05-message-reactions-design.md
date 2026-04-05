# Message Reactions Design

**Date**: 2026-04-05
**Status**: Approved

## Overview

Add emoji reactions to messages in the ChatWindow. Fixed set of 6 quick-react emojis, socket-only architecture, available to all roles.

## Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Who can react | All roles (agent, support, admin, platform_operator) | Natural chat behavior |
| Emoji set | Fixed: `['👍', '❤️', '😂', '😮', '🎉', '✅']` | Support platform, not social media. Zero dependencies. |
| Architecture | Socket-only (`message:react` / `message:reacted`) | Matches existing message mutation pattern (edit, delete, delivered, read) |
| Closed tickets | Reactions allowed | Lightweight, non-disruptive. Precedent: labels allowed post-close. |
| Whisper messages | Reactions allowed | Quick team acknowledgment without cluttering chat |
| Deleted messages | Reactions blocked | No interaction with deleted content |
| System messages | Reactions blocked | System messages are informational, not conversational |

## Data Layer

### Schema

No changes required. The `messages` table already has:

```
reactions: jsonb('reactions').$type<Record<string, string[]>>().default({})
```

Structure: `{ "👍": ["userId1", "userId2"], "✅": ["userId3"] }`

### Shared Constant

```ts
// server/constants.ts (and/or client equivalent)
export const REACTION_EMOJIS = ['👍', '❤️', '😂', '😮', '🎉', '✅'] as const;
```

## Socket Layer

### Event: `message:react` (client -> server)

**Payload**: `{ ticketId: string, messageId: string, emoji: string }`

**Server handler logic** (in `server/socket/handlers.ts`):

1. `requireIdentified(socket)` — standard auth gate
2. `requirePartnerScope(socket, ticketId)` — tenant isolation
3. Validate `emoji` is in `REACTION_EMOJIS`
4. Fetch message, validate it belongs to `ticketId`
5. Reject if `message.deletedAt` is set
6. Reject if `message.system` is true
7. Toggle reaction:
   - Read current `reactions` JSONB
   - If `userId` in `reactions[emoji]` -> remove userId from array
   - Else -> add userId to array
   - If array becomes empty -> delete the key
8. Write updated `reactions` to DB
9. `socketioEventsTotal.inc({ event: 'message:react' })`
10. Broadcast `message:reacted` to `Rooms.ticket(ticketId)`

### Event: `message:reacted` (server -> clients)

**Payload**: `{ ticketId: string, messageId: string, reactions: Record<string, string[]> }`

Client listener calls `updateMessageReaction(ticketId, messageId, reactions)` — this store method already exists.

## Client UI

### Quick-React Bar (MessageBubble)

- Appears on hover via existing `onMouseEnter`/`onMouseLeave` + `showActions` state
- Shows all 6 emojis as small clickable buttons
- Visible on **all non-deleted, non-system** messages (not just own messages — unlike edit/delete)
- Position: separate row below the existing edit/delete action buttons, same absolute-positioned container on the opposite side of the bubble
- Click emits `socket.emit('message:react', { ticketId, messageId, emoji })`

### Reaction Pills (MessageBubble)

- Row of pills rendered below the message bubble text, before timestamp
- Each pill: `emoji + count` (e.g. `👍 3`)
- Only emojis with >= 1 reaction are shown
- Empty reactions = no pills rendered
- **Active pill** (current user reacted): highlighted with accent color
- **Inactive pill**: muted border style
- Clicking any pill toggles the current user's reaction for that emoji

### Optimistic Updates

- On click, immediately update local store before server confirms
- Server broadcast arrives and overwrites with canonical state
- If server error, the next broadcast corrects the optimistic state

### Brutalist Styling

All styling uses CSS custom property design tokens from `index.css`:

- **Pills**: `border border-border`, `font-mono text-[10px]`, `px-1.5 py-0.5`, no border-radius
- **Active pill**: `border-accent-blue text-accent-blue bg-bg-elevated`
- **Inactive pill**: `border-border text-text-muted`
- **Quick-react buttons**: same style as existing edit/delete action buttons (`p-1 hover:bg-bg-elevated`)
- No shadows, no gradients, no rounded corners

## Edge Cases

### Rate Limiting

No dedicated rate limit. Toggle nature prevents spam (clicking same emoji twice = undo). Existing socket-level rate limiting applies.

### Max Reactions

Naturally bounded: 6 distinct emojis max (fixed set). No cap on users per emoji — all ticket participants can react.

### GDPR

Reactions contain userIds in the JSONB. Already covered by existing GDPR purge on the `messages` table — reactions are part of the message row and purged together.

### Accessibility

- Quick-react buttons: `aria-label="React with thumbs up"` (per emoji)
- Reaction pills: `aria-label="thumbs up, 3 reactions, you reacted"` (dynamic)
- Quick-react bar is keyboard-focusable via tab when actions are visible

## Files to Modify

| File | Change |
|------|--------|
| `server/socket/handlers.ts` | Add `message:react` handler |
| `server/constants.ts` | Add `REACTION_EMOJIS` constant |
| `client/src/components/MessageBubble.tsx` | Add quick-react bar + reaction pills UI |
| `client/src/hooks/useSocket.ts` | Add `message:reacted` listener -> `updateMessageReaction` |
| `client/src/constants.ts` | Add `REACTION_EMOJIS` constant (mirror server) |

No new files, no new dependencies, no schema migrations.
