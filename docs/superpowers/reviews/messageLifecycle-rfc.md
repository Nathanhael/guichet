## Problem

Every time we change how a chat message is created, edited, deleted, or reacted to, we have to reason across a 498-line socket handler (`server/socket/handlers/message.ts`) that hand-orchestrates the same prologue (partner-scope guard, sender denorm, role check), the same epilogue (broadcast, `notifyPreviewers`, `invalidateSummary`), and a per-verb middle. The hot path — `message:send` — is a ~200-line block that runs content guards, inserts the row, stamps SLA first-response, resolves a reply snippet, races an AI translation prewarm against a 250ms budget, fans out the broadcast (with whisper-only edge case), kicks off link unfurling, and invalidates the AI summary cache, all inline.

That orchestration reaches directly into `getRedisClients()`, `unfurlLinks()`, and `runAiAction()` from the handler, which means there's no point at which boundary tests can deterministically exercise the hot path without standing up Redis, an HTTP server for OG fetches, and an AI provider. Today's `server/socket/handlers/message.test.ts` either mocks those modules with `vi.mock` (brittle) or skips the hot-path interactions entirely. Bugs hide in the seams between shallow services (`messageQueries`, `guards`, `linkPreview`, `ai/runAction`), not inside any one of them.

This pairs naturally with the precedent: `services/ticketLifecycle/` (PR sequence concluded by [#44](https://github.com/Nathanhael/guichet/pull/44)) absorbed `transferService`, `ticketAudit`, `systemMessage`, and the lifecycle-mutation slice of `ticketQueries.ts` behind a single deep module, and unlocked PGLite-based boundary tests for transactional rollback. We follow the same shape for messages, with **one consequential difference**: there is no audit invariant for messages, and therefore no `db.transaction(...)` wrapper. The lifecycle module's value here is the orchestration consolidation, the `Result`/`Effect` pattern, and the deterministic port-based boundary tests — not multi-write atomicity.

## Proposed Interface

A new `server/services/messageLifecycle/` deep module that mirrors `ticketLifecycle`'s shape: factory + `Actor` (reused) + `Result<Ok | MessageLifecycleError>` + `Effect[]` + `applyEffects` (reused, extended).

**Public surface:**

```ts
export interface MessageLifecycle {
  send(args: SendArgs):     Promise<Result<SendOk,   MessageLifecycleError>>;
  edit(args: EditArgs):     Promise<Result<EditOk,   MessageLifecycleError>>;
  delete(args: DeleteArgs): Promise<Result<DeleteOk, MessageLifecycleError>>;
  react(args: ReactArgs):   Promise<Result<ReactOk,  MessageLifecycleError>>;
}

export function createMessageLifecycle(deps: MessageLifecycleDeps): MessageLifecycle;
```

`delivered` and `read` are intentionally **out of scope** — they are pure idempotent timestamp updates with no authz, no guards, no domain logic. Including them would be mimicry of ticketLifecycle's verb count without earning value. They stay as direct `markDelivered` / `markRead` calls in the handler.

**Three explicit ports** for cross-boundary deps (production adapters wrap today's services; test adapters return canned data deterministically):

```ts
export interface LinkPreviewPort {
  unfurl(text: string): Promise<LinkPreview[]>;
}

export interface AiTranslationPort {
  translate(args: {
    partnerId: string; userId: string;
    text: string; targetLang: 'nl' | 'fr' | 'en'; budgetMs: number;
  }): Promise<string | null>;  // null on timeout/disabled/error
  invalidateSummary(ticketId: string): Promise<void>;
}

export interface RepetitionGuardPort {
  check(args: { senderId: string; text: string }):
    Promise<{ ok: true } | { ok: false; code: 'repetition' | 'flood' }>;
  // MUST fail-open on infra error (returns ok:true and logs)
}
```

`storage` is **not** a new port — `getStorage()` already returns a stubbable interface; reuse it. Adding a fourth port would be parallel-pattern noise.

**`Effect` union extended in place** (`server/services/ticketLifecycle/types.ts`) with message-specific variants. `applyEffects` gets new switch arms in the same file. Acknowledged ownership smell: `ticketLifecycle/` will own message-named effect variants. Acceptable cost; if a third lifecycle ever lands, promote shared bits to `services/lifecycle/` then.

```ts
// added to existing Effect union
| { type: 'whisperEmit'; ticketId: string; event: string; payload: unknown }
| { type: 'invalidateSummary'; ticketId: string }
| { type: 'unfurlLinks'; ticketId: string; messageId: string; text: string }
| { type: 'slaResolved'; ticketId: string; partnerId: string; respondedInMinutes: number }
```

`MessageLifecycleError` is a **separate** union (codes don't overlap with ticket — exhaustive switch should stay domain-scoped).

**`HandlerContext` change**: add `messageLifecycle: MessageLifecycle` as a flat sibling to the existing `lifecycle: TicketLifecycle`. No rename, no namespace promotion. YAGNI today.

**Handler call site after refactor (example: `message:send`)**:

```ts
socket.on('message:send', async (data) => {
  if (!requireIdentified(socket)) return;
  const parsed = validatePayload(socket, messageSendSchema, data);
  if (!parsed) return;
  if (!checkSocketRateLimit(socket, 'message:send')) return;
  socketioEventsTotal.inc({ event: 'message:send' });

  const result = await ctx.messageLifecycle.send({
    ticketId: parsed.ticketId, partnerId: socket.data.partnerId,
    actor: socketActor(socket),
    text: parsed.text, mediaUrl: parsed.mediaUrl, attachments: parsed.attachments,
    whisper: parsed.whisper, replyToId: parsed.replyToId, localId: parsed.localId,
  });

  if (!result.ok) {
    switch (result.code) {
      case 'GUARD_REJECTED':
        socket.emit('message:rejected', { ticketId: parsed.ticketId, localId: parsed.localId, code: result.code });
        socket.emit('error', { message: 'Message blocked' });
        return;
      case 'INVALID_MEDIA_URL':
        return socket.emit('error', { message: 'Invalid media URL' });
      case 'TICKET_NOT_FOUND':
      case 'TICKET_CLOSED':
        return;
      default: return;
    }
  }
  applyEffects(ctx.io, result.effects);
});
```

**Complexity hidden** by the module:

- Sender denormalization with platform-operator membership fallback
- Sync + Redis repetition guard pipeline (sync fail-closed; Redis fail-open)
- 250ms AI translation prewarm race + viewer-language scan + per-partner `aiFeatures` lookup
- Whisper authorization clamp (silent — preserves today's behavior)
- SLA first-staff-response stamp + conditional `slaResolved` effect
- Whisper-only fan-out via local-node socket iteration
- Edit window (15 min) + own-message authz
- Soft-delete blob cleanup via existing `getStorage()`
- Reaction toggle JSONB math with empty-array cleanup

## Dependency Strategy

| Dependency | Category | Strategy |
|---|---|---|
| Postgres | local-substitutable | PGLite via existing `server/test/pglite-setup.ts` (`createTestDb()`) |
| Redis (repetition guard) | true-external (per behavior) | `RepetitionGuardPort` — prod: Redis adapter wrapping `guardRepetition`; test: `alwaysOkGuard` / `alwaysBlockGuard` |
| Redis (summary cache) | true-external | `AiTranslationPort.invalidateSummary` — prod: Redis; test: `Set<string>` accumulator |
| AI provider (translations) | remote-but-owned + true-external mix | `AiTranslationPort.translate` — prod: wraps `runAiAction` via existing `AiContext`; test: canned `Map<key, translation>` |
| HTTP OG metadata | true-external | `LinkPreviewPort` — prod: wraps `unfurlLinks`; test: in-memory map, default returns `[]` |
| Storage (uploads) | local-substitutable | Existing `getStorage()` interface; no new port |
| Socket.io | n/a | `Effect` DSL; lifecycle module never imports |

**No `db.transaction(...)` is opened** by the lifecycle. Single-statement writes are atomic by definition; SLA stamp runs sequentially in a try/catch (preserves today's non-fatal-on-failure behavior). This is an intentional divergence from ticketLifecycle and gets called out in the module header.

## Testing Strategy

**Substrate**: PGLite via `createTestDb()` from `server/test/pglite-setup.ts` (already proven by ticketLifecycle). Port stubs in `server/services/messageLifecycle/test/stubs.ts`. Seed helpers inline per test file (matches the ticketLifecycle test file precedent — extracting them is adjacent cleanup, deferred).

**New boundary tests** (target ~25–30 across 4 verbs):

- **Tenant isolation** (each verb): actor from partner A cannot mutate a message in partner B's ticket → `{ ok: false, code: 'TICKET_NOT_FOUND' }`
- **Authorization rejection** per verb: own-message for `edit`/`delete`; system-message ban for `edit`/`delete`/`react`; whisper-clamp warn for non-support `send` (returns `ok:true` with `isWhisper:false`)
- **Guard pipeline**: sync guard rejection codes (length, caps, injection); Redis fail-open path with port stub
- **Edit window expiry**: message older than `MAX_EDIT_WINDOW_MS` returns `EDIT_WINDOW_EXPIRED`
- **Soft-delete blob cleanup**: `delete` on a message with `mediaUrl` + `attachments` calls `storage.delete` for each `/uploads/...` path
- **Reaction toggle math**: add then remove returns to baseline; toggling last user out clears the emoji key
- **Effect ordering**: `send` effect array is `[emit, slaResolved?, notifyPreviewers, invalidateSummary, unfurlLinks]` in order
- **Whisper fan-out**: `send` with `whisper:true` from a support actor returns `whisperEmit` effect (not `emit`)
- **Translation prewarm**: canned `AiTranslationPort.translate` → broadcast payload carries `translations`; canned to return `null` (timeout) → broadcast still goes out
- **Repetition fail-open**: `RepetitionGuardPort.check` throwing → message proceeds (sync guards already passed)

**Old tests to delete in PR 4** (cleanup):

- `server/socket/handlers/message.test.ts` slices that mock `messageQueries` + `guards` for `:send`/`:edit`/`:delete`/`:react` — replaced by lifecycle boundary tests
- `server/services/messageQueries.test.ts` slices testing the absorbed mutations: `insertMessage`, `updateMessageText`, `updateMessageReactions`, `softDeleteMessage`, `updateMessageLinkPreviews` — those functions get deleted from `messageQueries.ts`
- Read-helper tests stay (`findTicketMessagesPaginated`, `resolveReplySnippet*`, `resolveUserAvatarsBatch`)

**Test environment needs**: PGLite already wired in `server/test/pglite-setup.ts`. No new infra, no Docker dependency for `npm test`.

## Implementation Recommendations

**Module ownership**:
- **Owns**: orchestration of all 4 message-mutation verbs, sender denormalization, content-guard pipeline composition, whisper authorization, SLA first-response stamping, effect-array generation, port-mediated calls to AI / link-preview / repetition-guard
- **Hides**: which queries are issued, how the AI prewarm is raced, how whisper fan-out targets sockets, how soft-delete cleans up blobs, the exact guard code returned (caller sees `GUARD_REJECTED`)
- **Exposes**: 4 verbs + `MessageLifecycle` interface + `MessageLifecycleError` type + `createMessageLifecycle` factory; `Actor`, `Result`, `Effect`, `applyEffects` re-exported from `ticketLifecycle`

**What stays out (explicit non-goals)**:
- `delivered` and `read` verbs (pure idempotent timestamps; staying as direct query calls in the handler)
- Read-side helpers (`findMessageForEdit/Delete/React`, `findTicketMessagesPaginated`, `findTicketLabelIds`, `resolveReplySnippet*`, `resolveUserAvatarsBatch`) — stay in `messageQueries.ts`, consumed by the lifecycle and by tRPC routers
- `ticket:new`'s first-message insert — stays in `ticketLifecycle.create` via private `insertAgentMessageTx`. The pre-existing first-message guard bypass is tracked as a separate task.
- Per-message audit log writes (no audit invariant for messages — explicit decision; we are NOT adding one in this refactor)
- `db.transaction(...)` wrappers (single-statement writes are atomic; nothing to wrap)
- Wire protocol changes (dual `error` + `message:rejected` emit preserved for backwards compat)
- `HandlerContext` namespace promotion (flat `ctx.messageLifecycle` sibling)

**Caller migration**:
- `socket/handlers/message.ts` shrinks from 498 lines to ~150 (only the four mutation verbs migrate; `delivered`/`read`/`loadMore` stay)
- No tRPC router changes (no current message-mutation tRPC endpoint exists)
- A future `trpc.message.*` mutation surface can reuse the lifecycle by building a `trpcActor(ctx)` — same pattern as ticketLifecycle's planned but unbuilt tRPC reuse

**Behavior-neutral refactor** (strict preservation):
- Sender denorm + platform-operator fallback move inside, identical logic
- Guard order preserved (sync fail-closed → Redis fail-open)
- Effect emission order matches today (`emit` → `slaResolved`? → `notifyPreviewers` → `invalidateSummary` → `unfurlLinks`)
- 250ms prewarm budget preserved
- Whisper fan-out via local-node iteration preserved
- Wire protocol preserved

**PR sequence (4 PRs, no feature flag)**:

| PR | Scope | Risk |
|----|-------|------|
| 1 | Scaffolding (types, factory, 3 ports + adapters, `Effect` union extension, `HandlerContext` wiring) + `react` verb + migrate `message:react` handler | low |
| 2 | `edit` + `delete` verbs + migrate handlers (paired — similar own-message authz shape; `delete` exercises `getStorage()`) | medium |
| 3 | `send` verb + migrate handler (200 → ~15 lines). All 3 ports exercised. Most-trafficked event ships last on a known-good base. | high |
| 4 | Delete absorbed mutations from `messageQueries.ts` (`insertMessage`, `updateMessageText`, `updateMessageReactions`, `softDeleteMessage`, `updateMessageLinkPreviews`); verify `ticket:new` decoupled (uses ticketLifecycle's private `insertAgentMessageTx`, unaffected) | low |

Each PR independently revertable. PGLite spike skipped — already proven by ticketLifecycle.

**Related**:
- Architectural precedent: [#24](https://github.com/Nathanhael/guichet/issues/24) (ticketLifecycle deepening RFC) and the PRD at `docs/superpowers/specs/2026-04-26-deepen-ticketLifecycle-prd.md`
- Sibling task: first-message content-guard bypass in `ticketLifecycle.create` (spawned separately)
