# Client-Side Code Review -- 2026-03-28

## Summary

Reviewed all client-side React code: views, store, hooks, types, components, and CSS. The codebase is generally well-structured with proper HttpOnly cookie auth, ErrorBoundary coverage, and socket listener cleanup. However, several issues need attention.

---

## CRITICAL

### 1. Stale Closures in useSocket.ts (Memory/State Bug)

**File**: `client/src/hooks/useSocket.ts`, lines 54-362

The main `useEffect` uses `listenersAttached.current` as a guard so listeners attach only once. However, the handlers capture destructured store functions (`addTicket`, `updateTicket`, `addMessage`, etc.) from the first render via the component's closure. Since the effect never re-runs (the ref guard prevents it), these references become stale if the component re-renders with new store slices.

**19 direct usages** of destructured store functions inside handlers that will never refresh:
- `addTicket` (lines 87, 99)
- `updateTicket` (lines 105, 110, 189, 211, 216, 218, 233)
- `addMessage` (lines 100, 114)
- `setMessages` (line 109)
- `setBusinessHoursStatus` (lines 246, 248)
- `setTyping` (line 135)
- `setOnlineSupportUsers` (line 139)
- `addTopicAlert` (line 261)
- `setActiveTicketId` (line 101)

**Why it works today**: Zustand's `set`/`get` functions are stable references, so the destructured functions happen to be referentially stable. But this is an implementation detail of Zustand, not a guarantee. If the store composition changes, or if selectors are used instead of destructuring, this will silently break.

**Fix**: All handlers should use `useStore.getState()` consistently (as some already do on lines 62, 88, 143, etc.) instead of mixing patterns. Convert all 19 call sites to use `useStore.getState().functionName()`.

### 2. Object URL Memory Leak in ChatWindow.tsx

**File**: `client/src/components/ChatWindow.tsx`, line 330

```
setMediaPreview(URL.createObjectURL(file));
```

`URL.createObjectURL()` is called but `URL.revokeObjectURL()` is never called anywhere in the file. Each upload creates a blob URL that leaks memory until the page is fully unloaded.

**Fix**: Revoke the object URL in the `clearMedia` function and in a cleanup `useEffect`.

---

## IMPORTANT

### 3. Pervasive `as any` Type Assertions (~30 occurrences)

**Files**: Multiple admin components

| File | Lines | Usage |
|---|---|---|
| `AdminArchive.tsx` | 35, 49, 203 | `ticketsQuery.data as any` |
| `AdminDepartments.tsx` | 18, 46 | `mapDepts(raw: any[])`, `departments as any[]` |
| `AdminFeedback.tsx` | 43, 45 | `usersData as any[]`, `ratingsQuery.data as any[]` |
| `AdminTeam.tsx` | 182, 318 | `e.target.value as any` |
| `AdminTickets.tsx` | 27, 41 | `ticketsQuery.data as any` |
| `PlatformArchiveViewer.tsx` | 59, 69, 161, 213, 214, 279 | Extensive `any[]` usage |
| `PlatformSystemSettings.tsx` | 8 | `useState<any>({...})` |
| `CustomerInfoPanel.tsx` | 90, 111 | `label: any`, `t: any` |
| `QueueSidebar.tsx` | 202 | `result: any` |
| `dateUtils.ts` | 1, 7 | `safeDate(date: any)`, `formatDate(date: any)` |
| `config.ts` | 1 | `import.meta as any` |

This violates the project mandate of "No `any` types." Most of these should use proper tRPC inferred types or explicit interfaces.

**Fix**: Define interfaces for tRPC response shapes (e.g., `ArchivedTicket`, `FeedbackEntry`, `MailConfig`) and replace `as any` with proper type narrowing.

### 4. Native `alert()` Used for Error/Success Feedback (~15 occurrences)

**Files**:
- `AdminDepartments.tsx` (lines 96, 120, 126)
- `AdminTeam.tsx` (lines 22, 154, 242)
- `PlatformAuditLog.tsx` (lines 142, 169)
- `PlatformSystemSettings.tsx` (lines 22, 26, 27)
- `GroupMappingsPanel.tsx` (lines 21, 140, 233)

Native `alert()` blocks the main thread, is not styleable per the brutalist design system, and provides a poor UX. The codebase already has a `Toast` component used elsewhere.

**Fix**: Replace all `alert()` calls with the existing Toast component pattern (see `PartnerList.tsx` / `UserTable.tsx` for reference).

### 5. Stale Closure in PlatformSystemSettings.tsx useEffect

**File**: `client/src/components/admin/PlatformSystemSettings.tsx`, lines 30-34

```javascript
useEffect(() => {
    if (remoteConfig) {
      setMailConfig({ ...mailConfig, ...remoteConfig });
    }
}, [remoteConfig]); // mailConfig is missing from deps
```

`mailConfig` is read inside the effect but not in the dependency array. This means the spread will always use the initial mailConfig value, potentially overwriting user edits when `remoteConfig` refetches.

**Fix**: Use functional state update: `setMailConfig(prev => ({ ...prev, ...remoteConfig }))`.

### 6. Accessibility: Dialogs Missing `aria-modal` and Focus Trapping

**Files**: All modal components (~10 files)

All `role="dialog"` elements lack:
- `aria-modal="true"` attribute
- Focus trapping (Tab key can escape the dialog to background content)
- `aria-labelledby` pointing to the dialog title
- Escape key handling (only some modals implement it)

Affected files:
- `AdminArchive.tsx` (line 220)
- `AdminTeam.tsx` (lines 165, 257, 291)
- `CreatePartnerModal.tsx` (line 42)
- `DeletePartnerModal.tsx` (line 32)
- `EditPartnerModal.tsx` (line 87)
- `EditUserProfileModal.tsx` (line 34)
- `ManageAccessModal.tsx`
- `ConfirmDialog.tsx` (line 19)
- `InviteUserModal.tsx`

**Fix**: Add `aria-modal="true"`, `aria-labelledby`, implement focus trapping (e.g., `focus-trap-react`), and ensure Escape key closes all dialogs.

### 7. Hardcoded Demo Password in LoginView.tsx

**File**: `client/src/views/LoginView.tsx`, line 14

```javascript
const DEMO_PASSWORD = 'password123';
```

While this is intended for demo mode, it ships in the production bundle. An attacker inspecting the JS bundle can extract this constant and use it against any demo users that haven't changed their password.

**Fix**: Gate the demo panel behind an environment variable (e.g., `VITE_DEMO_MODE`). Only import/render the demo section when the flag is true, allowing tree-shaking to remove it from production builds.

### 8. Design System Violations: Hardcoded Colors in AdminStats.tsx

**File**: `client/src/components/admin/AdminStats.tsx`

10 instances of hardcoded hex colors (`#93a1a1`, `#000000`, `#666666`) in Recharts components. These do not respond to dark/light mode changes.

**Fix**: Use CSS custom properties via `var(--color-text-primary)` etc. Recharts accepts CSS variables in stroke/fill props when accessed via `getComputedStyle`.

### 9. Design System Violation: Non-Brutalist Theme in useTheme.ts

**File**: `client/src/hooks/useTheme.ts`, lines 30-37

The non-monochrome (default) theme sets:
- `--border-radius: 12px` (violates "no border-radius" mandate)
- `--glass-blur: 16px` (glassmorphism effects)
- `--accent-color: #e65649` (hardcoded, not from design tokens)

Per CLAUDE.md: "No gradients, no shadows, no border-radius." The default theme contradicts the brutalist design spec. Only `monochromeMode` enforces the spec.

**Fix**: Either make monochrome the default/only mode, or ensure the "polished" theme still respects the brutalist constraints. At minimum, document this as an intentional dual-theme system.

---

## MINOR

### 10. LoginView: No ErrorBoundary Wrapping

**File**: `client/src/App.tsx`, line 68

```javascript
if (!user) return <Suspense fallback={<LoadingFallback />}><LoginView /></Suspense>;
```

LoginView is the only view not wrapped in an `ErrorBoundary`. All other views (Platform, Admin, Agent, Support) have one.

### 11. ErrorBoundary Exposes Stack Traces

**File**: `client/src/components/ErrorBoundary.tsx`, lines 35-36

The error boundary renders the full stack trace and component stack to the user. In production, this leaks internal implementation details.

**Fix**: Conditionally show stack traces only in development (`import.meta.env.DEV`).

### 12. `border-radius: 1px` in index.css

**File**: `client/src/index.css`, lines 207, 214, 221

Three scrollbar-related styles use `border-radius: 1px`. While minimal, this technically violates the "no border-radius" mandate.

### 13. AdminStats Recharts Colors Not Dark-Mode Aware

**File**: `client/src/components/admin/AdminStats.tsx`

The hardcoded `#000000` stroke/fill for chart lines and bars will be invisible against the dark mode background (`#09090b`).

---

## What Was Done Well

- **No XSS vectors**: Zero `dangerouslySetInnerHTML` usage anywhere. All user text is rendered via React's safe JSX interpolation. MessageBubble renders `displayText` as text content, not HTML.
- **HttpOnly cookie auth**: Tokens are never stored in localStorage. Only non-sensitive data (user profile, membership info) is persisted client-side.
- **Socket listener cleanup**: The useSocket hook properly removes all 30 named listeners in the cleanup function.
- **ErrorBoundary coverage**: All major views are wrapped in ErrorBoundary.
- **Auth session expiry**: Client-side session expiry detection via companion cookie with automatic state clearing.
- **Route-based access control**: App.tsx properly gates views based on role/membership.
- **Service worker cache clearing on logout**: Prevents stale auth data on shared devices.
- **Content moderation**: Server-side guards pipeline (length, caps, repetition, injection, swearing).
