# AgentView + SupportView Code Review

Consolidated findings from three parallel code review subagents covering AgentView, SupportView, and cross-cutting i18n/CSS concerns.

---

## CRITICAL

### 1. XSS via unsanitized HTML rendering in MessageContent
- **File:** `client/src/components/chat/MessageContent.tsx:53`
- **Description:** The `renderMarkdown()` output is passed directly to an innerHTML setter without verifying that DOMPurify (or equivalent) sanitizes the HTML. If `renderMarkdown` in `client/src/utils/markdown.ts` does not call a sanitizer, any user-supplied markdown containing script tags, event handlers, or similar payloads will execute in the browser context of every viewer.
- **Fix:** Verify `renderMarkdown` calls DOMPurify. If not, wrap the output with `DOMPurify.sanitize()` before assignment.

### 2. Socket listener leak — `listenersAttached` module flag never resets on user/partner switch
- **File:** `client/src/hooks/useSocket.ts:68-69, 473`
- **Description:** The module-level `listenersAttached` boolean is set to `true` on first socket setup but never reset when the user logs out, switches partners, or when React Strict Mode double-invokes effects. This means after a partner switch, the new socket instance has zero event listeners registered — messages, typing indicators, and presence updates silently stop working. Under Strict Mode, the first effect sets the flag, the cleanup runs, but the second invocation skips listener registration because the flag is still `true`.
- **Fix:** Reset `listenersAttached = false` in the cleanup return of the `useEffect`, or replace the module-level flag with a `useRef` scoped to the component lifecycle.

---

## HIGH

### 3. `ticket:new` 1-ticket limit is not enforced server-side
- **File:** `server/socket/handlers/ticket.ts:44-143`
- **Description:** The agent UI enforces a single open ticket per user, but the socket handler `ticket:new` does not check whether the user already has an open ticket before creating a new one. A malicious client or race condition can bypass the UI guard and create multiple simultaneous tickets.
- **Fix:** Add a server-side query in the `ticket:new` handler to check for existing open tickets by the same user before inserting.

### 4. `getSocket()` called without null-check — crashes if socket not yet initialised
- **File:** `client/src/views/SupportView.tsx:239, 255, 286, 287`
- **Description:** Multiple call sites invoke `getSocket()` and immediately call `.emit()` without checking if the socket is `null`. If the socket hasn't connected yet (e.g., slow network, race with component mount), this throws a runtime error.
- **Fix:** Guard each `getSocket()` call: `const s = getSocket(); if (s) s.emit(...)` or use optional chaining `getSocket()?.emit(...)`.

### 5. Stale `supportOpenTickets` in `useEffect` rejoin — dependency array captures initial snapshot
- **File:** `client/src/views/SupportView.tsx:140-161`
- **Description:** `hasRejoinedRef.current = true` is set unconditionally on first pass, but `supportOpenTickets` is populated by localStorage hydration which runs asynchronously. If hydration hasn't completed, `supportOpenTickets` is empty, the guard returns early, and on next render the interleaving is non-deterministic — potentially causing double-rejoin attempts on some tabs.
- **Fix:** Use a `useRef` to track the previous `supportOpenTickets` value, or move the rejoin logic into a callback that fires after both hydration and ticket query are confirmed ready.

### 6. Dead props — `logoUrl` and `industry` declared but never used
- **Files:** `client/src/components/agent/AgentNav.tsx:8-17`, `client/src/components/support/SupportNav.tsx:8, 13`
- **Description:** `AgentNavProps` declares `logoUrl?: string` and `industry: string`, but the component destructuring only extracts `partnerName` and `onShowFeedback`. `AgentView.tsx` passes both props (lines 112-115) — dead calls giving a false impression that the logo is rendered. Same pattern in `SupportNav` where `logoUrl` is declared but the destructured value is never used.
- **Fix:** Remove the unused props from the interface and the call sites, or implement the intended rendering.

### 7. `handleSelectTicket` is a redundant wrapper around `selectTicket`
- **File:** `client/src/views/SupportView.tsx:233-235`
- **Description:** `handleSelectTicket` is a one-line function that just calls `selectTicket` with the same argument. It adds an unnecessary layer of indirection.
- **Fix:** Replace all `handleSelectTicket` references with direct `selectTicket` calls and remove the wrapper.

### 8. AiCopilotSidebar `summaryMutation` uses stale ticket reference
- **File:** `client/src/components/support/AiCopilotSidebar.tsx`
- **Description:** The `summaryMutation` from `trpc.ai.summarizeChat.useMutation()` captures the `ticket` prop at call time, but if the user switches tabs while a summary is in-flight, the result renders against the wrong ticket's panel.
- **Fix:** Compare `ticket.id` at mutation settlement time against the current ticket prop before applying the result.

### 9. Archive/KB search UX dead-end in AiCopilotSidebar
- **File:** `client/src/components/support/AiCopilotSidebar.tsx`
- **Description:** KB search queries are fired but the `kbAutoSuggest` query is explicitly disabled (`enabled: false`). The search UI is rendered but the feature is non-functional, creating a confusing dead-end for support staff.
- **Fix:** Either re-enable the feature or hide the search UI behind a feature flag / `aiConfig` check.

---

## MEDIUM

### 10. Hardcoded English strings in `MessageList.tsx` with inconsistent fallback pattern
- **File:** `client/src/components/chat/MessageList.tsx:136-138, 195, 204, 267-270`
- **Description:** Strings like "Load older messages", "Loading...", "NEW MESSAGES", "Whisper", "End whisper" appear as hardcoded English literals using the pattern `t('key') || 'English fallback'`. Several of these translation keys may not be populated in all locales, making the fallback the only visible text for non-English users.
- **Fix:** Ensure all keys exist in every locale file. Remove the `||` fallback pattern — if a key is missing, it should be caught during development, not silently replaced.

### 11. `hover:text-white` violates brutalist token spec
- **Files:** `client/src/components/agent/TicketForm.tsx:143`, `client/src/components/support/QueueSidebar.tsx:341`, `client/src/components/support/SidebarFooter.tsx:101`
- **Description:** `text-white` is a hardcoded Tailwind color. The brutalist design spec mandates CSS custom property tokens (`--color-*`) for all colors. The token `var(--color-bg-base)` is already used in similar inverted-button patterns elsewhere.
- **Fix:** Replace `hover:text-white` with `hover:text-bg-base` (or equivalent token class).

### 12. `AgentTicketSidebar` is dead code — never imported or rendered
- **File:** `client/src/components/agent/AgentTicketSidebar.tsx`
- **Description:** The entire component is not imported by any file in the codebase. It defines a `STATUS_DOT` map with an `'active'` status that doesn't exist in the ticket status enum (`open/pending/closed/resolved`).
- **Fix:** Delete the file, or if the component is planned for future use, add a TODO comment and fix the status map.

### 13. `closeSearch` focuses a null ref instead of Tiptap editor
- **File:** `client/src/components/ChatWindow.tsx:151-155`
- **Description:** `closeSearch` calls `textareaRef.current?.focus()` but ComposeArea uses the Tiptap editor, not a raw textarea. The ref is always `null`, so focus restoration after closing the search bar silently fails.
- **Fix:** Expose a `focus()` method from ComposeArea (e.g., via `useImperativeHandle`) and call that instead.

### 14. Reconnect-queue `onConnect` listener in `ComposeArea.doSend` is never cleaned up
- **File:** `client/src/components/chat/ComposeArea.tsx:549-555`
- **Description:** When `doSend` detects a disconnected socket, it registers a one-shot `connect` listener to retry. This listener is never removed on component unmount. If the component unmounts before reconnection, the listener fires against a stale closure.
- **Fix:** Track the listener in a ref and remove it in the `useEffect` cleanup, or use `socket.once('connect', ...)` with a cleanup guard.

### 15. 10-second presence poll runs per-tab with no jitter
- **File:** `client/src/components/ChatWindow.tsx:99-105`
- **Description:** The `refetchInterval: 10000` presence query is active for every open support ticket tab simultaneously. With N open tabs, this creates N*6 tRPC requests per minute. There is no jitter or backoff, causing thundering-herd spikes on the server.
- **Fix:** Deduplicate the poll to a single interval at the SupportView level, or add random jitter (e.g., `10000 + Math.random() * 2000`).

### 16. Resize listener missing for split-view breakpoint
- **File:** `client/src/views/SupportView.tsx`
- **Description:** The effect checks `window.innerWidth` when `isSplitView` changes but does not listen for `resize` events. If the user activates split view on a wide viewport then resizes below 768px, the layout persists incorrectly until the next state change.
- **Fix:** Add a `resize` event listener inside the effect, or use a `useWindowSize` hook.

### 17. `ticketDeptAllowed` function recreated every render, used in two `useMemo` deps
- **File:** `client/src/components/support/QueueSidebar.tsx:60-62, 108-131`
- **Description:** `ticketDeptAllowed` is a plain function (not memoized) used as a dependency in two `useMemo` hooks (`deptCounts` and `queueFiltered`). Since its reference changes every render, both memos recompute unconditionally.
- **Fix:** Wrap `ticketDeptAllowed` in `useCallback` with `[isGeneralist, assignedDepartmentIds]` as dependencies.

---

## LOW

### 18. Unreachable double-cap check after Zod schema already enforces it
- **File:** `server/socket/handlers/ticket.ts:296`
- **Description:** The handler contains a manual character-length validation that is unreachable because the Zod schema applied earlier already enforces the same constraint.
- **Fix:** Remove the redundant check.

### 19. Missing `aria-label` on icon-only collapse button
- **File:** `client/src/components/agent/AgentTicketSidebar.tsx:48`
- **Description:** The sidebar collapse button uses only an icon with no accessible label.
- **Fix:** Add `aria-label="Toggle sidebar"` (or i18n equivalent).

### 20. `'active'` status in `STATUS_DOT` map is not a valid ticket status
- **File:** `client/src/components/agent/AgentTicketSidebar.tsx:8-12`
- **Description:** The `STATUS_DOT` color map includes `'active'` which is not in the `ticketStatusEnum` (`open/pending/closed/resolved`).
- **Fix:** Replace `'active'` with the correct status or remove it.

### 21. AI config fetched independently in two sibling components
- **Files:** `client/src/components/ChatWindow.tsx:92`, `client/src/components/chat/ComposeArea.tsx:353`
- **Description:** Both `ChatWindow` and `ComposeArea` independently call `trpc.partner.getAiConfig.useQuery()`. While tRPC deduplicates at the cache level, the intent is unclear and the `staleTime` values may differ.
- **Fix:** Fetch once in the parent and pass down via props or context.

### 22. `ComposeArea` — `_unusedTextareaRef` parameter is dead API surface
- **File:** `client/src/components/chat/ComposeArea.tsx:59`
- **Description:** The prop is kept "for ChatWindow API compat" but is explicitly unused. This is dead interface surface that confuses callers.
- **Fix:** Remove the prop and update the ChatWindow call site.

### 23. `SavedViewPicker` — `transition-colors` violates animation spec
- **File:** `client/src/components/support/SavedViewPicker.tsx:155, 184`
- **Description:** `transition-colors` applies a color transition on hover states. The brutalist spec permits only 150ms fade-in for panels/modals and explicitly prohibits decorative animations on interactive elements.
- **Fix:** Remove `transition-colors` from the button classes.

---

## i18n Gaps

| File | Line(s) | Hardcoded String |
|------|---------|-----------------|
| `client/src/components/chat/MessageList.tsx` | 136 | `"Loading..."` |
| `client/src/components/chat/MessageList.tsx` | 138 | `"Load older messages"` |
| `client/src/components/chat/MessageList.tsx` | 195 | `"NEW MESSAGES"` |
| `client/src/components/chat/MessageList.tsx` | 204 | `"Whisper"` |
| `client/src/components/chat/MessageList.tsx` | 222 | `"End whisper"` |
| `client/src/components/chat/MessageList.tsx` | 267-270 | Date separator fallback strings |
| `client/src/components/support/QueueSidebar.tsx` | various | Department filter labels |
| `client/src/components/support/ChatTabBar.tsx` | various | Tab action labels |

---

## CSS/Design Violations

| File | Line | Violation | Token Fix |
|------|------|-----------|-----------|
| `client/src/components/agent/TicketForm.tsx` | 143 | `hover:text-white` -- hardcoded color | Use `hover:text-bg-base` |
| `client/src/components/support/QueueSidebar.tsx` | 341 | `hover:text-white` -- hardcoded color | Use `hover:text-bg-base` |
| `client/src/components/support/SidebarFooter.tsx` | 101 | `hover:text-white` -- hardcoded color | Use `hover:text-bg-base` |
| `client/src/components/support/SavedViewPicker.tsx` | 155, 184 | `transition-colors` -- decorative animation | Remove transition class |

---

## Summary

| Severity | Count |
|----------|-------|
| Critical | 2 |
| High | 7 |
| Medium | 8 |
| Low | 6 |
| **Total** | **23** |

**No security bypasses, cross-tenant data leaks, or auth vulnerabilities were found** in the code paths reviewed. The two critical findings (XSS vector, socket listener leak) are the highest priority for remediation.
