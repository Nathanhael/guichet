# Enable Canned Responses — Design Spec

**Date:** 2026-04-08
**Status:** Approved
**Scope:** Re-enable existing canned response feature (approach B — re-enable + harden)

## Background

Canned responses were fully built (DB, tRPC CRUD, admin UI, picker component) but disabled as a batch with KB and webhooks via `featureGate('cannedResponse')` in `constants.ts`. The feature is complete — this spec covers re-enabling and re-wiring the compose area.

## Changes

### 1. Remove Feature Gate

**File:** `server/constants.ts`

Remove `'cannedResponse'` from the `DISABLED_FEATURES` array. This unblocks:
- `trpc.cannedResponse.list` (support/admin — used by picker)
- `trpc.cannedResponse.create/update/delete` (admin — used by `AdminCannedResponses`)

### 2. Re-wire ComposeArea

**File:** `client/src/components/chat/ComposeArea.tsx`

**New state:**
```ts
const [showCannedPicker, setShowCannedPicker] = useState(false);
```

**Three restoration sites (currently marked `DISABLED_FEATURE`):**

#### Site A — Render picker (~line 528)
Render `<CannedResponsePicker>` inside the `relative flex-1` div, above the textarea:

```tsx
{isSupport && showCannedPicker && (
  <CannedResponsePicker
    inputText={text}
    dept={ticket.dept}
    onSelect={(body) => {
      setText(body);
      setShowCannedPicker(false);
      textareaRef.current?.focus();
    }}
    onClose={() => setShowCannedPicker(false)}
  />
)}
```

Guard: only renders when `isSupport` is true (prop already available).

#### Site B — onChange trigger (~line 536)
Detect `/` at cursor position 0 to open picker, clear when no longer prefixed:

```ts
const val = e.target.value;
setText(val);
if (val.startsWith('/')) {
  setShowCannedPicker(true);
} else if (showCannedPicker) {
  setShowCannedPicker(false);
}
```

#### Site C — onKeyDown guard (~line 541)
When picker is open, prevent Enter from sending the message (let picker handle selection):

```ts
if (showCannedPicker && ['Enter', 'ArrowUp', 'ArrowDown'].includes(e.key)) {
  return; // picker handles these keys
}
if (showCannedPicker && e.key === 'Escape') {
  e.preventDefault();
  setShowCannedPicker(false);
  return;
}
```

### 3. Hardening Checks

| Check | Location | Status |
|-------|----------|--------|
| Support-only guard | ComposeArea render site | Enforced via `isSupport &&` condition |
| Click-outside close | CannedResponsePicker | Verify — add `mousedown` listener if missing |
| Closed ticket guard | ComposeArea | Already enforced — compose area disabled when `isClosed` |
| Empty state | CannedResponsePicker | Already handled — returns `null` when no responses |
| Keyboard nav | CannedResponsePicker | Already implemented — ↑↓ Enter Escape |

### 4. Files NOT Changed

- `CannedResponsePicker.tsx` — complete, no edits needed (unless click-outside is missing)
- `AdminCannedResponses.tsx` — unblocked by gate removal, no edits
- `server/trpc/routers/cannedResponse.ts` — unblocked by gate removal, no edits
- `server/db/schema.ts` — `canned_responses` table exists
- `server/socket/handlers.ts` — not involved (tRPC-only)
- i18n keys — already exist

## Files Touched

1. `server/constants.ts` — remove `'cannedResponse'` from disabled list
2. `client/src/components/chat/ComposeArea.tsx` — add state, restore 3 wiring points

## Out of Scope

- Compose toolbar button (alternate trigger) — add later if `/` discoverability is a problem
- Category grouping in picker — add later if response count per partner exceeds ~50
- Component refactoring — picker is ~120 lines and self-contained
- New i18n keys — already exist

## Testing

- Verify `/` trigger opens picker for support role
- Verify picker does NOT appear for agent role
- Verify Enter selects a response and replaces textarea text
- Verify Escape closes picker
- Verify `AdminCannedResponses` CRUD works (create, edit, delete)
- Verify department-scoped filtering (ticket's dept responses + global)
- Verify `{{agentName}}`/`{{supportName}}` variable expansion
