# Accessibility Popover — Dyslexic Font, Bionic Reading, Focus Mode

**Date:** 2026-03-27
**Status:** Approved

## Summary

Add an accessibility popover to the NavToolbar that groups four a11y toggles: Dyslexic Font (Lexend), Bionic Reading, Monochrome, and Focus Mode. Expand bionic reading beyond messages to KB articles and canned responses. Implement focus mode to hide sidebars in chat views. Persist preferences server-side so they follow users across devices.

## Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Toggle location | Accessibility popover in NavToolbar | Clean toolbar (1 icon), groups all a11y features, scalable |
| Bionic reading scope | Messages + KB articles + canned responses | Cover all sustained reading surfaces |
| Dyslexic font scope | Content text only (Inter → Lexend) | JetBrains Mono stays for UI chrome; short labels don't benefit from Lexend |
| Toggle independence | All toggles independent | Dyslexic font and bionic reading solve different problems; let users combine freely |
| Focus mode behavior | Hide sidebars in chat views | Dimming still shows clutter; hiding maximizes the conversation |
| Persistence | Server-side JSONB + localStorage fallback | Prefs follow users across devices; localStorage for instant hydration before API response |

## Components

### 1. AccessibilityMenu (`client/src/components/AccessibilityMenu.tsx`)

New component. Renders in NavToolbar's `{children}` slot, positioned between DarkModeToggle and NotificationToggle.

**Trigger button:** Accessibility icon (human figure SVG, same size as DarkModeToggle icons: `w-3.5 h-3.5`). Brutalist style: `px-2 py-1 border border-border text-text-muted hover:text-text-primary`. Active indicator: accent-blue border when any a11y feature is enabled.

**Popover panel:** Positioned absolutely below the trigger. `border border-border bg-bg-surface`. No backdrop overlay. Dismiss on click-outside or re-click trigger.

**Panel header:** `ACCESSIBILITY` label in `text-[9px] font-bold uppercase tracking-widest opacity-60` (matches existing section header pattern from UserSecurityModal).

**Toggle rows (4):**

| Row | Label | Sublabel | Store field |
|-----|-------|----------|-------------|
| 1 | Dyslexic Font | Lexend typeface for content | `dyslexicMode` |
| 2 | Bionic Reading | Bold word beginnings | `bionicReading` |
| 3 | Monochrome | Grayscale mode | `monochromeMode` |
| 4 | Focus Mode | Hide sidebars | `focusMode` |

**Toggle switch design:** Rectangular (no border-radius). `w-8 h-4`. Inactive: `border border-border bg-transparent`, knob `w-3 h-3 bg-text-muted` left-aligned. Active: `border border-accent-blue bg-accent-blue/20`, knob `bg-accent-blue` right-aligned. Transition: none (brutalist — instant state change).

### 2. CSS Changes (`client/src/index.css`)

```css
/* Dyslexic mode — swap content font only */
:where(.dyslexic-mode, .dyslexic-mode *) {
  --font-sans: 'Lexend', ui-sans-serif, system-ui, sans-serif;
}

/* Focus mode — hide sidebars in chat views */
.focus-mode .queue-sidebar,
.focus-mode .customer-info-panel,
.focus-mode .agent-ticket-sidebar,
.focus-mode .ai-copilot-sidebar {
  display: none;
}
```

Sidebar components need the corresponding CSS class names added (e.g., `queue-sidebar` on QueueSidebar's root div).

### 3. Zustand Store Changes (`client/src/store/slices/uiSlice.ts`)

Wire up the four TODO stub toggle functions following the `toggleDarkMode` pattern:

**`toggleDyslexicMode()`:**
- Flip `dyslexicMode` state
- Toggle `.dyslexic-mode` class on `document.documentElement`
- Persist to `localStorage.setItem('dyslexicMode', ...)`
- Fire `trpc.user.updateAccessibilityPrefs.mutate()` (fire-and-forget)

**`toggleBionicReading()`:**
- Flip `bionicReading` state
- Persist to `localStorage.setItem('bionicReading', ...)`
- Fire tRPC mutation (fire-and-forget)

**`toggleFocusMode()`:**
- Flip `focusMode` state
- Toggle `.focus-mode` class on `document.documentElement`
- Persist to `localStorage.setItem('focusMode', ...)`
- Fire tRPC mutation (fire-and-forget)

**`toggleMonochromeMode()`:** Already partially implemented. Add tRPC mutation call.

**`hydrateAccessibilityPrefs(prefs)`:**
- New action called on login/app init
- Applies server-side prefs, sets all states + classList + localStorage in one pass
- Server prefs win over localStorage when they differ (server is source of truth)

### 4. BionicText Expansion

Wrap body text in `BionicText` in these additional components (only when `bionicReading` is true in store):

| Component | Where |
|-----------|-------|
| `AdminKnowledgeBase.tsx` | Article body in preview/display (not edit textarea) |
| `AdminCannedResponses.tsx` | Response body in expanded row preview |
| `ChatWindow.tsx` | Already done via `MessageBubble` — no change |

Conditional rendering pattern:
```tsx
{bionicReading ? <BionicText text={body} /> : <span>{body}</span>}
```

### 5. Focus Mode — Sidebar Classes

Add identifying CSS classes to sidebar root elements:

| Component | Class to add |
|-----------|-------------|
| `QueueSidebar.tsx` | `queue-sidebar` |
| `CustomerInfoPanel.tsx` | `customer-info-panel` |
| `AgentTicketSidebar.tsx` | `agent-ticket-sidebar` |
| `AiCopilotSidebar.tsx` | `ai-copilot-sidebar` |

Parent flex containers in SupportView and AgentView must not collapse when children are hidden — the chat area should expand to fill. Use `flex-1` on the chat container (likely already the case).

### 6. Database — Server-Side Persistence

**New column on `users` table:**
```typescript
accessibilityPrefs: jsonb('accessibility_prefs').default({}).notNull()
```

**Schema shape:**
```typescript
interface AccessibilityPrefs {
  dyslexicMode?: boolean
  bionicReading?: boolean
  monochromeMode?: boolean
  focusMode?: boolean
}
```

All fields optional — missing means `false` (default off).

**Drizzle migration:** Add column with `default({})`. Non-breaking — existing rows get empty object.

### 7. tRPC — User Router Addition

**New procedure in `server/trpc/routers/user.ts`:**

`updateAccessibilityPrefs` — Protected procedure (any authenticated user).
- Input: `z.object({ dyslexicMode: z.boolean().optional(), bionicReading: z.boolean().optional(), monochromeMode: z.boolean().optional(), focusMode: z.boolean().optional() })`
- Updates `accessibility_prefs` JSONB on the current user's row (merge, not replace)
- Returns `{ success: true }`

**Existing `me` or login response:** Include `accessibilityPrefs` in the user object returned on login so the client can hydrate on startup.

### 8. Hydration Flow

1. **Instant (localStorage):** On app mount, read localStorage keys and apply classes immediately (no flash of unstyled content)
2. **Authoritative (server):** On login/`me` response, call `hydrateAccessibilityPrefs()` with server values — overwrites localStorage if they differ
3. **Updates (fire-and-forget):** Each toggle fires a tRPC mutation. If it fails, localStorage still has the value — next login will re-sync from server

## Out of Scope

- Bionic reading for admin panels, platform view, or sidebar text (only messages, KB articles, canned responses)
- Dyslexic font for JetBrains Mono UI chrome (stays monospace)
- Keyboard shortcuts for toggles (possible future enhancement)
- Per-partner a11y defaults (all user-level)

## Testing

- **Unit tests:** AccessibilityMenu toggle interactions, store toggle functions, hydration logic
- **Visual verification:** Dyslexic mode + bionic reading combined, focus mode sidebar hiding, dark + dyslexic mode together
- **Persistence round-trip:** Toggle → reload → verify state restored from localStorage; toggle → logout → login on fresh browser → verify from server
