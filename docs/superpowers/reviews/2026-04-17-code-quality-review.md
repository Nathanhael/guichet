# Code Quality Review — 2026-04-17

**Scope**: Architecture, code smells, test quality, TypeScript rigor, client performance
**Reviewer**: Claude (agent, claude-sonnet-4-6)
**Prior review**: `docs/superpowers/reviews/code-review-full.md` (2026-04-09, 188 commits ago)

## Summary

The codebase is in good shape. New features (Tiptap WYSIWYG, multi-backend storage, crash recovery, archive-on-close) are architecturally coherent and well-documented. The `StorageBackend` interface is a clean abstraction. The Tiptap view-Proxy race is handled correctly with try-catch and a ref guard. Two HIGH-confidence bugs were found: attachment blobs are orphaned in cloud storage on soft-delete, and the on-close archive snapshot issues two non-atomic queries making message count unreliable. Several MEDIUM findings relate to type-cast escape hatches and missing tests on new services.

---

## Findings

### HIGH: Soft-delete orphans attachment blobs in cloud storage

**File**: `server/services/messageQueries.ts:223–229` / `server/socket/handlers/message.ts:340`

**Detail**: `softDeleteMessage()` sets `mediaUrl = null` and `text = ''` in the database but never calls `storage.delete(filename)`. Blobs uploaded to S3 or Azure Blob Storage remain indefinitely after a user or staff member deletes a message. The only call site for `storage.delete()` in the entire codebase is `server/services/gdpr.ts:222` during the scheduled GDPR purge — which runs on the retention window (30 days), not on delete.

**Evidence**:
```ts
// messageQueries.ts:223–229
export async function softDeleteMessage(messageId: string) {
  const now = new Date().toISOString();
  await db.update(messages)
    .set({ deletedAt: now, text: '', mediaUrl: null }) // ← blob not deleted
    .where(eq(messages.id, messageId));
  return now;
}
```

**Recommendation**: Before nulling `mediaUrl`, extract the filename segment, then fire-and-forget `getStorage().delete(filename).catch(err => logger.warn(...))` after the DB update. If messages can have multiple attachments via the `attachments` JSONB column, extract and delete those too.

---

### HIGH: `snapshotTicketToArchive` message count is non-atomic

**File**: `server/services/archive.ts:187–211`

**Detail**: The on-close snapshot issues two unguarded sequential DB queries — one `SELECT` on `tickets`, one `COUNT(*)` on `messages` — with no surrounding transaction. Any message that arrives in the window between the two queries is silently excluded from `messageCount`. Since this is called fire-and-forget from `ticketQueries.ts:282` on ticket close, the race is realistic under normal load. The batch `archiveTickets()` function (line 256) already wraps its work in a transaction; the snapshot path does not.

**Recommendation**: Wrap all three operations (select ticket, count messages, insert archive row) in `db.transaction()`.

---

### MEDIUM: `AdminArchive` casts `listMembers` against a non-existent `{ items }` shape

**File**: `client/src/components/admin/AdminArchive.tsx:28–31`

**Detail**: The `supportMembers` memo tries two shapes: `membersData.items` first, then a flat-array fallback. `listMembers` (confirmed in `server/trpc/routers/partner/members.ts:83`) returns a flat array — there is no `items` wrapper. The `.items` branch is permanently dead code. If `listMembers` is ever paginated and gains an `items` wrapper, the tRPC inferred type will catch it at compile time — but this cast bypasses that safety net.

**Evidence**:
```ts
const rows = (membersData as { items?: Array<...> } | undefined)?.items  // dead branch
  ?? (membersData as Array<...> | undefined)
  ?? [];
```

**Recommendation**: Remove the cast entirely. `membersData` is already typed by tRPC inference — use `membersData ?? []`. The server-side `role: 'support'` filter also makes the `.filter(m => m.role === 'support')` on line 31 redundant.

---

### MEDIUM: `statsQueries.ts` raw SQL results have no runtime validation

**File**: `server/services/statsQueries.ts:62,67,78,91,99,104,113,124`

**Detail**: All 8 query functions cast `db.execute(...).rows` to typed interfaces via `as unknown as`. Column names are aliased in the SQL string (e.g. `avg_response_ms AS "avgResponseMs"`) and must exactly match interface field names. A migration that renames a column will compile cleanly but silently serve `undefined`/`NaN` to the analytics dashboard. This is the most likely place for silent data corruption.

**Recommendation**: Add a Zod parse (`.parse()`, not `.safeParse()`) on the result of at least `fetchHistoricalStats`, which drives the main dashboard chart. Alternatively, migrate these to Drizzle's typed query builder.

---

### MEDIUM: `ticketReclaim.ts` has zero test coverage

**File**: `server/services/ticketReclaim.ts` (no `ticketReclaim.test.ts` exists)

**Detail**: The new crash-recovery reclaim service has no tests. It manages ticket state transitions, emits `ticket:reclaimed` socket events, and dispatches push notifications — all behavior with clear success/failure boundaries. Analogous services (`transferService.test.ts`, `systemMessage.test.ts`) show the pattern is well-established in this codebase.

**Recommendation**: Add `server/services/ticketReclaim.test.ts` covering: (a) offline agent tickets are reclaimed, (b) online/away agent tickets are not reclaimed, (c) the atomic `WHERE supportId = ?` guard prevents double-reclaim, (d) `ticket:reclaimed` socket event reaches the correct room.

---

### MEDIUM: S3 bucket creation failure is silently swallowed

**File**: `server/services/storage.ts:181–183`

**Detail**: If `HeadBucketCommand` throws (bucket doesn't exist) and the subsequent `CreateBucketCommand` also fails (wrong region, IAM permissions, name conflict), the error is swallowed by `.catch(() => {})`. The server then logs `"[storage:s3] bucket ready"` unconditionally and returns the client. Every subsequent upload fails with a confusing SDK error rather than a clear startup failure.

**Evidence**:
```ts
} catch {
  await s3.send(new CreateBucketCommand({ Bucket: bucket })).catch(() => {}); // swallowed
}
logger.info({ bucket }, '[storage:s3] bucket ready'); // logs even on failure
```

**Recommendation**: Remove `.catch(() => {})` and let the error propagate. `_init()` returning a rejected promise will cause uploads to fail with a meaningful message. Add a `logger.error` before rethrowing so the root cause appears at startup.

---

### MEDIUM: `useKeyboardShortcuts` Escape handler fires through open modals

**File**: `client/src/hooks/useKeyboardShortcuts.ts:195–198`

**Detail**: The global `window` `keydown` listener calls `onExitFocus()` on bare Escape without checking `e.defaultPrevented` or whether a modal/focus-trap is currently open. When a user presses Escape to close a dialog (transfer modal, label picker, canned picker), the SupportView focus-exit handler fires simultaneously. No `e.preventDefault()` is called, so child components cannot block it.

**Recommendation**: Check `if (e.defaultPrevented) return;` before `onExitFocus()`, and ensure modal Escape handlers call `e.preventDefault()`. Alternatively, accept an `isModalOpen` boolean prop and skip the handler when true.

---

### LOW: `@ts-ignore` on nodemailer import

**File**: `server/services/mail.ts:1`

**Detail**: `// @ts-ignore nodemailer types may not be installed` suppresses types for the entire nodemailer API surface. `@types/nodemailer` is a published, actively-maintained package.

**Recommendation**: `npm install --save-dev @types/nodemailer` (inside Docker) and remove the `@ts-ignore`.

---

### LOW: Stale `TODO` comment in `LoginView`

**File**: `client/src/views/LoginView.tsx:250`

**Detail**: `// TODO: Replace /api/v1/auth/sso/login with the correct universal SSO endpoint when available` — the SSO endpoint is wired and in production. No date, no issue reference.

**Recommendation**: Remove the comment.

---

## Strengths observed

- **Storage abstraction quality**: `StorageBackend` interface is clean. All three backends implement the same `upload/delete/read/getUrl/healthy` contract. Lazy-init with a promise lock prevents double-init races under concurrent first requests.
- **Tiptap race handling**: `isProgrammaticUpdateRef` guard + try-catch on `view.dispatch` + `queueMicrotask` reset is a well-reasoned solution to a real upstream quirk. In-code explanation is thorough and references the wiki learning page.
- **Emoji XSS safety**: `EmojiSuggestion` renders emoji as button text content, not `innerHTML`. The compose picker inserts via `editor.chain().insertContent(emoji)` — all safe paths.
- **Rebrand completeness**: No stale "tessera" strings found in any `.ts`/`.tsx` file. Only appears in CHANGELOG and a historical plan doc — correct.
- **Bare `useStore()` discipline**: The automated test in `client/src/__tests__/useStoreSelectors.test.ts` enforces no bare `useStore()` calls across all source files. No violations in new code.
- **Reclaim atomicity**: The conditional `WHERE supportId = ticket.supportId` in `ticketReclaim.ts:65` correctly prevents clobbering a concurrent reassignment. Solid defensive pattern.
- **Archive batch correctness**: `archiveAuditLog` re-reads `lastArchived` at the top of each 1000-row batch (not once before the loop), ensuring hash chain consistency even if the process restarts mid-run.
- **Markdown rendering**: `renderMarkdown` in `utils/markdown.ts` pipes through DOMPurify with an explicit allowlist before `dangerouslySetInnerHTML`. XSS surface is correctly locked down.

## Areas not reviewed / time-boxed

- E2E Playwright specs for new features (Tiptap compose, crash recovery, keyboard shortcuts) — suite not executed
- Tiptap production bundle size impact — no build output available in this session
- `AgentStatusStats.tsx:127` — internal chart `as unknown as Record<string,number>` cast is low-risk but untidy; not escalated
- `useIdleStatus` + `useKeyboardShortcuts` interaction under focus-mode edge cases
