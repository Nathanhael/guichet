# AdminView Sidebar Navigation

**Date:** 2026-03-23
**Status:** Approved

---

## Overview

Replace the horizontal tab navigation in `AdminView` with a persistent vertical sidebar. Remove Canned Responses entirely from the codebase (it will return as a proper feature later).

---

## Layout

```
┌─────────────────────────────────────────────┐
│           TOP BAR (unchanged)               │
├──────────────┬──────────────────────────────┤
│   SIDEBAR    │         CONTENT              │
│   w-52       │         flex-1               │
│   h-full     │         overflow-y-auto      │
└──────────────┴──────────────────────────────┘
```

- Top bar remains exactly as-is
- Below the top bar: `flex flex-row flex-1` (takes remaining viewport height)
- Sidebar: `w-52 h-full border-r-2 border-black dark:border-white overflow-hidden flex-shrink-0`
- Content: `flex-1 overflow-y-auto`

---

## Sidebar Navigation Groups

All 9 items, with their existing icons preserved:

```
OVERVIEW
  Dashboard    — bar chart SVG (existing)
  Alerts       — Flame (lucide-react, existing)

OPERATIONS
  Tickets      — chat SVG (existing)
  Archive      — archive box SVG (existing)
  Feedback     — star SVG (existing)

TEAM
  Team         — Users (lucide-react, existing)
  Departments  — Building2 (lucide-react, existing)

CONFIGURATION
  Business Hours — clock SVG (existing)
  Labels         — tag SVG (existing)
```

No new icons needed — all icons already exist in `AdminView.tsx`.

---

## Nav Item Styles

**Active:** `bg-black dark:bg-white text-white dark:text-black`

**Inactive:** plain text, no background

**Hover (inactive only):** `hover:bg-black/5 dark:hover:bg-white/5` — static, no transition

**Group label:** `text-[9px] font-black uppercase tracking-widest opacity-40 px-4 pt-6 pb-2 select-none`

---

## NavButton Component

`NavButton` is defined locally inside `AdminView` (not shared with other views). It will be updated in-place to vertical style:
- Full width: `w-full`
- Left-aligned: `justify-start`
- Padding: `px-4 py-2.5`
- Text size and uppercase tracking unchanged

---

## Default Active Tab

`'dashboard'` — unchanged from current behaviour.

---

## Changes to `AdminView.tsx`

- Remove `'canned'` from `AdminTab` type
- Remove `AdminCannedResponses` import and render block
- Replace horizontal nav bar with vertical grouped sidebar
- Update `NavButton` to vertical style (full width, left-aligned)
- Wrap below-topbar content in `flex flex-row flex-1`

---

## Canned Responses — Full Removal

### Client
- Delete `client/src/components/admin/AdminCannedResponses.tsx`
- Remove all canned response i18n keys from `client/src/i18n.ts` (grep: `canned`)
- Remove `cannedResponses` state, type, and `setCannedResponses` action from `client/src/store/slices/configSlice.ts`
- Remove `CannedResponse` type from `client/src/types/index.ts` (if present)

### Server
- Delete `server/trpc/routers/cannedResponse.ts`
- Deregister `cannedResponse` from `server/trpc/router.ts`

### Database
- Pre-check before migration: `SELECT COUNT(*) FROM messages WHERE canned_response_id IS NOT NULL` — confirm zero rows (or acceptable to lose)
- Remove `cannedResponses` table definition from `server/db/schema.ts`
- Remove `cannedResponseId` column from `messages` table in `server/db/schema.ts`
- Run `npx drizzle-kit push` to apply schema changes (drops `canned_responses` table and `canned_response_id` column from `messages`)
- No down migration required — this is a dev environment and the table is being intentionally abandoned

---

## Aesthetics

- Strict B&W: black (#000) and white (#FFF) only
- Zero motion: no transitions, no animations
- Sidebar right border: `border-r-2 border-black dark:border-white`

---

## Out of Scope

- Collapsible sidebar
- Mobile/responsive adaptations
- Changes to `SupportView`, `PlatformView`, or `AgentView`
- Changes to the top bar

---

## Acceptance Criteria

- [ ] Sidebar renders with 4 grouped sections and 9 nav items
- [ ] Correct icons shown for all 9 items
- [ ] Active item highlighted correctly on click
- [ ] Default tab on load is `dashboard`
- [ ] Hover state is static (no transition)
- [ ] Top bar unchanged
- [ ] Content area scrolls independently
- [ ] Canned responses tab gone from nav
- [ ] `AdminCannedResponses.tsx` deleted
- [ ] `cannedResponse.ts` router deleted and deregistered
- [ ] `cannedResponses` state removed from `configSlice.ts`
- [ ] `canned_response_id` column removed from `messages` schema
- [ ] `canned_responses` table removed from schema and DB
- [ ] No TypeScript errors
- [ ] No B&W violations
