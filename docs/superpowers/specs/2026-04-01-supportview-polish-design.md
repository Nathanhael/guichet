# SupportView Polish Fixes — Design Spec

**Date:** 2026-04-01
**Scope:** 5 surgical fixes to the SupportView layout

## Fix 1: Missing i18n Keys

**Problem:** `waiting_for_expert` and `search_messages` keys don't exist in any locale file. The i18n system returns the raw key string, and CSS `uppercase` renders them as `WAITING_FOR_EXPERT` / `SEARCH_MESSAGES`.

**Fix:** Add missing keys to all 3 locale files:

| Key | en | nl | fr |
|-----|----|----|-----|
| `waiting_for_expert` | Waiting for expert | Wachten op expert | En attente d'un expert |
| `search_messages` | Search messages... | Zoek berichten... | Rechercher des messages... |

Note: `preview_mode` already exists in all locales ("Preview Mode" / "Voorbeeld" / "Mode apercu"). The screenshot showing `PREVIEW_MODE` with underscores suggests either a locale loading issue or the key isn't matching at runtime — verify during implementation.

**Files:** `client/src/locales/en.ts`, `nl.ts`, `fr.ts`

## Fix 2: SavedViewPicker Dropdown Clipped by Sidebar Overflow

**Problem:** The `<aside>` uses `overflow-hidden` for the collapse animation (w-80 → w-0). This clips the absolutely-positioned SavedViewPicker dropdown.

**Fix:** Render the dropdown via `ReactDOM.createPortal(dropdown, document.body)`. Use a `useRef` on the toggle button + `getBoundingClientRect()` to position the portal dropdown. Add a click-outside listener to close it (already partially handled by `isOpen` state).

**Files:** `client/src/components/support/SavedViewPicker.tsx`

## Fix 3: Message Bubble Contrast in Preview

**Problem:** Message bubbles in TicketPreview are barely visible against the dark base background.

**Root cause:** Bubble backgrounds use `--color-bg-elevated` (received) and `--color-own-msg-bg` (sent), defined in `index.css`. These tokens may have insufficient contrast against `--color-bg-base` in dark mode.

**Fix:** Check the dark-mode values of `--color-bg-elevated` and `--color-own-msg-bg` in `index.css`. If contrast ratio is below WCAG AA (4.5:1 for text), bump the surface lightness. This is a token-level fix, not a component-level fix. Scope to investigation — if the tokens look correct, the issue may be theme-specific and out of scope.

**Files:** `client/src/index.css` (investigate only, change if needed)

## Fix 4: JOIN Button Prominence

**Problem:** In the TicketPreview join bar, the status text (`text-sm font-bold uppercase tracking-widest`) visually dominates the JOIN CTA (`text-[10px]`).

**Fix:**
- JOIN button: increase to `text-xs px-8 py-3` for a larger click target and visual weight
- Status text: reduce to `text-xs tracking-wide` and add `text-text-muted` to make it secondary
- Optionally add a pulsing dot or icon before status text to indicate "waiting" state

**Files:** `client/src/components/TicketPreview.tsx`

## Fix 5: SavedViewPicker Label Clipping

**Problem:** The "SAVED VIEWS" header text clips at the sidebar boundary.

**Fix:** Resolved by Fix 2. Once the dropdown renders via portal, it's unconstrained by the sidebar's overflow.

## Out of Scope

- Adding a dedicated "Saved Views" tab to the sidebar
- Restructuring the SupportView grid layout
- MessageBubble component redesign (only token-level contrast check)
- ChatTabBar layout changes
