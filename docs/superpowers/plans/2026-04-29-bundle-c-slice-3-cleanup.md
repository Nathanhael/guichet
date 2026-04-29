# Bundle C / Slice 3 — Cleanup, Bundle-Size Guardrail, Wiki Decision Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close out Bundle C. Inline `MessageBubble`'s body into `<Message>`, delete `client/src/components/MessageBubble.tsx`, fold `MessageContent` into Message internals (or keep as a private file with no barrel export), remove per-fragment exports from `client/src/components/chat/index.ts`, delete the now-redundant per-fragment + MessageBubble test files, add `Message.kind.test.tsx` for system/whisper variants, run the bundle-size guardrail confirming the chat route chunk excludes the three lazy fragments, ship the Bundle C closing CHANGELOG entry, and file the wiki decision page summarizing the bundle.

**Architecture:** Mechanical cleanup. The functional changes were in slice #77; this slice is deletions + a structural fold + verification. Risk surface: any callsite still importing `MessageBubble` directly, or any test asserting on a fragment's behavior in isolation, breaks here. Pre-flight greps catch both before deletion.

**Tech Stack:** Same as slice 2 — React 19, TypeScript, Vitest + jsdom, Vite 8 build (for the bundle-size guardrail), the wiki at `D:\Projects_Coding\wiki\` for the decision page.

**Parent issue:** [#78](https://github.com/Nathanhael/guichet/issues/78) (PRD #75, RFC #64). Blocked by: [#77](https://github.com/Nathanhael/guichet/issues/77).

---

## Pre-flight: Decisions Locked Before Coding

### D1. `MessageContent.tsx` survives as a private file (not exported from any barrel).
RFC says: "fold `MessageContent` / `QuoteBlock` / `DeliveryStatus` / `AttachmentGrid` / `LinkPreviewCard` into `Message.tsx` internals (still separate files, but private — not exported from a barrel)". Path of least disruption: leave the files on disk so the React.lazy import targets stay stable; remove their entries from `client/src/components/chat/index.ts`. Anyone who tries to import them via the barrel after this slice gets a TypeScript error — exactly the safety we want.

### D2. `<Message>` body absorbs `<MessageBubble>` source verbatim, then prunes.
The MessageBubble source is 380 LOC of dense, well-tuned chat behavior (hover-intent timer, edit-inline mode, translation indicator, reactions, action bar, delete confirm dialog, whisper styling). Rewriting that from scratch invites regression. The plan: copy MessageBubble's body into Message.tsx, replace `import MessageBubble from '../MessageBubble'` (in Message.tsx) with the inlined logic, delete MessageBubble.tsx + its test file. The body is unchanged behavior — same hooks, same socket calls, same render — just relocated.

### D3. Bundle-size guardrail process.
Run `docker compose exec client npm run build`. Inspect the build output's chunk manifest. The chat route chunk (the entry chunk for SupportView / AgentView, where MessageList is reachable) MUST NOT contain `AttachmentGrid`, `QuoteBlock`, or `LinkPreviewCard`. They MUST appear as separate chunks loaded on demand. Verification method: `Read client/dist/.vite/manifest.json` (or whatever Vite emits) and grep chunk contents. Document the chunk names and sizes in the PR body.

### D4. The bundle-size guardrail is a manual checklist item, not a CI gate.
Adding a CI step (rollup-plugin-visualizer + a JSON-based threshold check) is a separate concern that may land in a future RFC. Slice 3 documents the guardrail's result in the PR body; the reviewer signs off on the manual check.

### D5. Per-fragment tests deletion — only delete files that exist.
Pre-flight: `Glob client/src/components/chat/__tests__/{Quote,Delivery,LinkPreview,Attachment,MessageContent}*.test.tsx` to enumerate. Slice 1 reconnaissance found ZERO per-fragment test files in the repo today — the per-fragment behaviors are already covered by `MessageBubble.test.tsx`. So D5 reduces to: delete `MessageBubble.test.tsx` (which slice 2 verified is now redundant with `Message.test.tsx`).

### D6. `Message.kind.test.tsx` covers system + whisper render variants.
The slice 2 `Message.test.tsx` covered text / deleted / search-highlight / reply. The system + whisper render variants weren't asserted there. This slice adds them.

### D7. Wiki decision page lives at `D:\Projects_Coding\wiki\wiki\decisions\guichet-bundle-c-ui-primitives-consolidation.md`.
Format mirrors prior decision pages (check the wiki index for an example). Captures: what consolidated (FormModal, Message), the lazy-fragment pattern, the resolved RFC open questions, the bundle-size before/after measurements, the test-file inventory deltas. Filed in the wiki repo, not in guichet.

### Open question — none for this slice.

---

## File Structure

### Files to delete

| Path | Reason |
|---|---|
| `client/src/components/MessageBubble.tsx` | Body absorbed into `chat/Message.tsx`. |
| `client/src/components/__tests__/MessageBubble.test.tsx` (or wherever the file lives) | Behaviors covered by `chat/__tests__/Message.test.tsx` + `Message.lazy.test.tsx` + `Message.kind.test.tsx`. |

### Files to create

| Path | Responsibility |
|---|---|
| `client/src/components/chat/__tests__/Message.kind.test.tsx` | Render-variant tests: system message, whisper message. |
| `D:\Projects_Coding\wiki\wiki\decisions\guichet-bundle-c-ui-primitives-consolidation.md` | Wiki decision page summarizing Bundle C. |

### Files to modify

| Path | Change |
|---|---|
| `client/src/components/chat/Message.tsx` | Replace the `<MessageBubble>` wrapper body with the inlined MessageBubble source (verbatim copy with imports rewritten). Remove `import MessageBubble from '../MessageBubble'`. |
| `client/src/components/chat/index.ts` | Remove `AttachmentGrid`, `QuoteBlock`, `LinkPreviewCard`, `MessageContent`, `DeliveryStatus` from the barrel (now reachable only through `<Message>`). Keep `ChatHeader`, `MessageList`, `ComposeArea`, `SearchBar`, `FormatToolbar`, `ImageLightbox` exported. |
| `client/src/components/chat/MessageContent.tsx` | If still referenced from a sibling chat component, keep. If only referenced from Message, decide: leave as a private file (no barrel export) OR inline into Message.tsx body. RFC prefers "still separate files, but private" — keep the file. |
| `CHANGELOG.md` | Unreleased entry: "Bundle C slice 3 — cleanup; MessageBubble deleted; bundle-size guardrail confirms lazy split." |

### Files NOT touched in this slice

- `client/src/components/chat/Message.test.tsx`, `Message.lazy.test.tsx` — slice 2 created them; this slice adds `Message.kind.test.tsx` alongside.
- `client/src/components/ui/FormModal.tsx` and per-modal tests — slice 1 work; not revisited here.
- `client/src/components/chat/AttachmentGrid.tsx`, `QuoteBlock.tsx`, `LinkPreviewCard.tsx`, `DeliveryStatus.tsx` — sources unchanged; lazy imports inside MessageContent (or its inlined body) still target these files by relative path.

---

## Conventions

- **Test runner:** `docker compose exec client npm test -- <path/to/file.test.tsx>`. Vitest passthrough.
- **Type check:** `docker compose exec client npx tsc --noEmit -p .`
- **Build:** `docker compose exec client npm run build`
- **CI:** `powershell -File scripts/ci.ps1`
- **Server reload:** NOT required — client-only.
- **Commit style:** `refactor(chat): <description>` for the inline + delete, `test(chat): <description>` for the new test, `docs: <description>` for the wiki + CHANGELOG.
- **Branch:** create a feature branch off main named `feat/bundle-c-slice-3-cleanup`.

---

## Tasks

### Task 1: Pre-flight — enumerate MessageBubble + per-fragment callsites and test files

**Files:**
- None (verification only).

- [ ] **Step 1: Find every callsite of `MessageBubble`**

```bash
docker compose exec client npx grep -rn "from '\\.\\./MessageBubble'" client/src
docker compose exec client npx grep -rn "from '\\./MessageBubble'" client/src
docker compose exec client npx grep -rn "import MessageBubble" client/src
```

Or, equivalently, use the Grep tool: `Grep "MessageBubble" client/src`.

Expected after slice 2: only `client/src/components/MessageBubble.tsx` (self), `client/src/components/chat/Message.tsx` (import wrapper from slice 2), and `client/src/components/__tests__/MessageBubble.test.tsx` (or wherever) reference it. If any other file appears, migrate it to import `Message` from `../chat/Message` first.

- [ ] **Step 2: Enumerate per-fragment test files**

```bash
Glob client/src/components/chat/__tests__/{AttachmentGrid,QuoteBlock,LinkPreviewCard,DeliveryStatus,MessageContent}*.test.tsx
```

Expected: empty (no per-fragment test files exist today). If any do exist, add them to the deletion list in Task 5.

- [ ] **Step 3: Confirm `MessageContent` is only consumed by `MessageBubble`**

```bash
Grep "from '\\./MessageContent'" client/src
Grep "MessageContent" client/src --type tsx
```

Expected: only `MessageBubble.tsx` and `chat/index.ts` reference it. If a sibling (e.g. a future preview pane) imports MessageContent, document it — the file stays exported until that consumer migrates.

- [ ] **Step 4: Snapshot the pre-cleanup bundle-size baseline**

Run: `docker compose exec client npm run build`
Note: this captures the post-slice-2 state. After cleanup, re-run and compare. Record both in the PR body.

```bash
docker compose exec -T client ls -la /app/dist/assets/ > .tmp_bundle_before.txt
```

(Or read the manifest equivalent in `client/dist/.vite/`.)

- [ ] **Step 5: Commit only the .tmp_bundle_before.txt baseline (or just record it in the PR body)**

```bash
# Optional — keep as a build artifact reference. Not committed; recorded in the PR body.
```

---

### Task 2: Inline `MessageBubble` body into `<Message>`

**Files:**
- Modify: `client/src/components/chat/Message.tsx`

- [ ] **Step 1: Read both files**

```bash
Read client/src/components/MessageBubble.tsx
Read client/src/components/chat/Message.tsx
```

- [ ] **Step 2: Copy MessageBubble's body into Message.tsx**

Replace the content of `Message.tsx`. The new file: same prop interface from slice 2, but the `return <MessageBubble ... />` is replaced by the actual MessageBubble render body (avatar + bubble + DeliveryStatus + translation indicator + metadata + action bar + edit-inline + confirm dialog).

Imports to rewire (paths relative to `chat/Message.tsx` — one level deeper than `components/MessageBubble.tsx`):
- `'../store/useStore'` → `'../../store/useStore'`
- `'./ui/Avatar'` → `'../ui/Avatar'`
- `'./GuestBadge'` → `'../GuestBadge'`
- `'../hooks/useSocket'` → `'../../hooks/useSocket'`
- `'../i18n'` → `'../../i18n'`
- `'../types'` → `'../../types'`
- `'./chat'` → `'./'` or split: `import DeliveryStatus from './DeliveryStatus'` and `import MessageContent from './MessageContent'` (avoiding the barrel that we're about to prune).
- `'../utils/dateUtils'` → `'../../utils/dateUtils'`
- `'../constants'` → `'../../constants'`
- `'./ConfirmDialog'` → `'../ConfirmDialog'`
- `'../hooks/useTranslation'` → `'../../hooks/useTranslation'`
- `'../../../server/trpc/router'` → `'../../../../server/trpc/router'`

Adjust each import in the inlined body.

The body itself is identical to MessageBubble's — no behavior changes. `ticketId` is sourced from props (with the slice 2 fallback of `message.ticketId`). System message branch, whisper branch, isMine branch, all preserved.

- [ ] **Step 3: Delete the wrapper-era `import MessageBubble from '../MessageBubble'` line in Message.tsx**

Already removed in Step 2 by the rewrite.

- [ ] **Step 4: Type-check passes**

Run: `docker compose exec client npx tsc --noEmit -p .`
Expected: no errors.

- [ ] **Step 5: Run all chat tests, expect pass**

Run: `docker compose exec client npm test -- chat --run`
Expected: PASS — `Message.test.tsx` + `Message.lazy.test.tsx` continue to pass against the inlined body. `MessageBubble.test.tsx` STILL passes because MessageBubble.tsx still exists (deletion is Task 4).

- [ ] **Step 6: Commit**

```bash
git add client/src/components/chat/Message.tsx
git commit -m "refactor(chat): inline MessageBubble body into Message.tsx"
```

---

### Task 3: Add `Message.kind.test.tsx` for system + whisper render variants

**Files:**
- Create: `client/src/components/chat/__tests__/Message.kind.test.tsx`

- [ ] **Step 1: Write the tests**

```tsx
// client/src/components/chat/__tests__/Message.kind.test.tsx
//
// Render-variant coverage that wasn't in slice 2's Message.test.tsx:
// system messages and whisper messages.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import Message from '../Message';
import { makeMessage } from '../../../test/helpers';

vi.mock('../../../hooks/useSocket', () => ({ getSocket: () => ({ connected: true, emit: vi.fn() }) }));
vi.mock('../../../i18n', () => ({ useT: () => (k: string) => k }));
vi.mock('../../../hooks/useTranslation', () => ({
  useAutoTranslation: () => ({
    translated: null, loading: false, translate: vi.fn(),
    showOriginal: false, setShowOriginal: vi.fn(), needsTranslation: false,
  }),
}));
vi.mock('../../../store/useStore', () => ({
  default: { getState: () => ({ openLightbox: vi.fn() }) },
  useStoreShallow: (selector: (s: unknown) => unknown) =>
    selector({ user: { id: 'u-1', name: 'Alice', lang: 'en', role: 'agent' }, bionicReading: false }),
}));

describe('Message — system kind', () => {
  beforeEach(() => vi.clearAllMocks());

  it('renders the system pill (no avatar, no bubble) for system messages', () => {
    const m = makeMessage({ system: true, text: 'Ticket transferred to Tier 2.' });
    const { container } = render(<Message message={m} />);
    expect(screen.getByText('Ticket transferred to Tier 2.')).toBeInTheDocument();
    // No bubble class
    expect(container.querySelector('.bubble-sent')).toBeNull();
    expect(container.querySelector('.bubble-received')).toBeNull();
    expect(container.querySelector('.bubble-whisper')).toBeNull();
  });

  it('resolves i18n: prefixed system message text', () => {
    const m = makeMessage({ system: true, text: 'i18n:transferred_to_dept' });
    render(<Message message={m} />);
    // useT pass-through stub returns the key, so we expect the resolved key (without "i18n:")
    expect(screen.getByText('transferred_to_dept')).toBeInTheDocument();
  });
});

describe('Message — whisper kind', () => {
  it('applies the whisper bubble class for whisper messages from non-self', () => {
    const m = makeMessage({ whisper: true, senderId: 'u-other', senderName: 'Bob', text: 'private note' });
    const { container } = render(<Message message={m} />);
    expect(container.querySelector('.bubble-whisper')).not.toBeNull();
    expect(screen.getByText('private note')).toBeInTheDocument();
  });

  it('applies the whisper bubble class for whisper messages from self (whisper takes precedence over isMine)', () => {
    const m = makeMessage({ whisper: true, senderId: 'u-1', senderName: 'Alice', text: 'own whisper' });
    const { container } = render(<Message message={m} />);
    // Whisper class wins over sent class.
    expect(container.querySelector('.bubble-whisper')).not.toBeNull();
    expect(container.querySelector('.bubble-sent')).toBeNull();
  });

  it('renders the whisper label + ghost icon on group-start of a whisper run', () => {
    const m = makeMessage({ whisper: true, senderId: 'u-other', senderName: 'Bob', text: 'first whisper' });
    render(<Message message={m} isGroupStart={true} />);
    expect(screen.getByText('whisper_label')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the tests, expect pass**

Run: `docker compose exec client npm test -- chat/__tests__/Message.kind.test.tsx --run`
Expected: PASS — system + whisper branches preserved through the slice 2 wrapper and the slice 3 inline.

- [ ] **Step 3: Commit**

```bash
git add client/src/components/chat/__tests__/Message.kind.test.tsx
git commit -m "test(chat): Message.kind covers system + whisper render variants"
```

---

### Task 4: Delete `MessageBubble.tsx` and its test file

**Files:**
- Delete: `client/src/components/MessageBubble.tsx`
- Delete: the MessageBubble test file (location to be confirmed)

- [ ] **Step 1: Locate the MessageBubble test file**

```bash
Glob client/src/**/__tests__/MessageBubble.test.tsx
```

Expected: one file. Note the path.

- [ ] **Step 2: Delete both files**

```bash
git rm client/src/components/MessageBubble.tsx
git rm <path-to-MessageBubble.test.tsx>
```

- [ ] **Step 3: Type-check passes**

Run: `docker compose exec client npx tsc --noEmit -p .`
Expected: no errors. If a callsite still imports `MessageBubble`, this fails — go back to Task 1 step 1 and migrate it.

- [ ] **Step 4: All chat tests still pass**

Run: `docker compose exec client npm test -- chat --run`
Expected: PASS — `Message.test.tsx` + `Message.lazy.test.tsx` + `Message.kind.test.tsx` cover the deleted MessageBubble.test.tsx behaviors.

- [ ] **Step 5: Commit**

```bash
git commit -m "refactor(chat): delete MessageBubble (body inlined into Message)"
```

---

### Task 5: Remove fragment exports from `chat/index.ts`

**Files:**
- Modify: `client/src/components/chat/index.ts`

- [ ] **Step 1: Read the current barrel**

Today's exports:
```ts
export { default as AttachmentGrid } from './AttachmentGrid';
export { default as ImageLightbox } from './ImageLightbox';
export { default as ChatHeader } from './ChatHeader';
export { default as MessageList } from './MessageList';
export { default as ComposeArea } from './ComposeArea';
export type { ComposeAreaHandle } from './ComposeArea';
export { default as DeliveryStatus } from './DeliveryStatus';
export { default as QuoteBlock } from './QuoteBlock';
export { default as LinkPreviewCard } from './LinkPreviewCard';
export { default as MessageContent } from './MessageContent';
export { default as SearchBar } from './SearchBar';
export { default as FormatToolbar } from './FormatToolbar';
```

- [ ] **Step 2: Remove the five private internals + add `Message`**

```ts
export { default as ImageLightbox } from './ImageLightbox';
export { default as ChatHeader } from './ChatHeader';
export { default as Message } from './Message';
export { default as MessageList } from './MessageList';
export { default as ComposeArea } from './ComposeArea';
export type { ComposeAreaHandle } from './ComposeArea';
export { default as SearchBar } from './SearchBar';
export { default as FormatToolbar } from './FormatToolbar';
```

Removed: AttachmentGrid, DeliveryStatus, QuoteBlock, LinkPreviewCard, MessageContent.
Added: Message.

- [ ] **Step 3: Type-check passes**

Run: `docker compose exec client npx tsc --noEmit -p .`
Expected: no errors. If anything still imports a removed name from the barrel, the type check fails — fix the import to either point at the file directly (if a legitimate consumer exists) or migrate to `<Message>`.

- [ ] **Step 4: All tests pass**

Run: `docker compose exec client npm test --run`
Expected: PASS — internal imports inside `MessageContent.tsx` (which still imports the lazy targets directly) work; only barrel consumers are affected.

- [ ] **Step 5: Commit**

```bash
git add client/src/components/chat/index.ts
git commit -m "refactor(chat): prune barrel — fragments + MessageContent are private to Message"
```

---

### Task 6: Bundle-size guardrail

**Files:**
- None (verification only); record results in PR body.

- [ ] **Step 1: Build for production**

Run: `docker compose exec client npm run build`
Expected: build succeeds; the output is in `client/dist/`.

- [ ] **Step 2: Inspect the chunk manifest**

```bash
docker compose exec -T client cat /app/dist/.vite/manifest.json | head -200
```

(Or: `Read client/dist/.vite/manifest.json`.)

Locate the entries for the route chunks that include `MessageList.tsx` or `Message.tsx` (typically the SupportView and AgentView entries). Record their `imports` and `dynamicImports` arrays.

- [ ] **Step 3: Confirm the three lazy fragments are in `dynamicImports`, not `imports`**

For the chat-route entry chunk:
- `dynamicImports` MUST contain (or transitively include) `AttachmentGrid`, `QuoteBlock`, `LinkPreviewCard` chunks.
- `imports` MUST NOT include any chunk that contains those three.

If any of the three appears in `imports`, the lazy boundary is broken. Most likely cause: a sibling file was added that imports the fragment directly instead of going through Message. Fix the sibling, re-run.

- [ ] **Step 4: List `dist/assets/` for chunk file sizes**

```bash
docker compose exec -T client ls -la /app/dist/assets/
```

Note the chat-route entry chunk's size and the three fragment chunks' sizes. Record before/after if you snapshotted in Task 1 step 4.

- [ ] **Step 5: Document the guardrail result**

In a scratch note for the PR body, capture:
- The chat-route entry chunk's name, size before/after slice 3
- The three fragment chunks' names + sizes
- Confirmation that `dynamicImports` (not `imports`) reaches them

This goes into the PR body in Task 9 step 2.

---

### Task 7: CHANGELOG entry

**Files:**
- Modify: `CHANGELOG.md`

- [ ] **Step 1: Add the closing entry**

```markdown
- **Bundle C slice 3 — cleanup, MessageBubble deleted, bundle-size guardrail confirms lazy split** (issue #78) — `<Message>` now owns the chat-message render path inline (`MessageBubble.tsx` deleted; body absorbed). `MessageContent`, `AttachmentGrid`, `QuoteBlock`, `LinkPreviewCard`, and `DeliveryStatus` are private internals — removed from the `chat/` barrel. New `Message.kind.test.tsx` covers system + whisper render variants. Production-build chunk inspection confirms the three lazy fragments load via `dynamicImports`, not eagerly. Closes Bundle C (PRD #75, RFC #64).
```

- [ ] **Step 2: Commit**

```bash
git add CHANGELOG.md
git commit -m "docs: changelog entry closing Bundle C (slice 3 cleanup + guardrail)"
```

---

### Task 8: Wiki decision page

**Files:**
- Create: `D:\Projects_Coding\wiki\wiki\decisions\guichet-bundle-c-ui-primitives-consolidation.md`

- [ ] **Step 1: Read an existing decision page for shape**

```bash
Glob D:\Projects_Coding\wiki\wiki\decisions\*.md | head -5
Read D:\Projects_Coding\wiki\wiki\decisions\<one-of-them>.md
```

- [ ] **Step 2: Draft the decision page**

Sections to include:
- **Title:** Bundle C — UI primitives consolidation (FormModal + Message)
- **Date / status:** 2026-04-XX, shipped
- **Context:** what fragmentation existed (5 platform modals; 6+ chat fragment files)
- **Decision:**
  - FormModal at `components/ui/FormModal.tsx` — owns scaffold + lifecycle; mutation passed as prop object; TypedConfirm sub-component for destructive flows
  - Message at `components/chat/Message.tsx` — owns chat-message render; lazy-loads three fragments via React.lazy + Suspense
- **Resolved RFC open questions:** mutation-as-prop (not mutationKey); Message lives in chat/ (not components/); no eager preload
- **Implementation sequencing:** 3 slices, 3 PRs (#76, #77, #78)
- **Bundle-size impact:** record the before/after numbers from Task 6
- **Test inventory deltas:** new (FormModal.test.tsx, FormModal.TypedConfirm.test.tsx, Message.test.tsx, Message.lazy.test.tsx, Message.kind.test.tsx); deleted (MessageBubble.test.tsx; per-fragment files if any existed)
- **Migration cost paid:** ~50% LOC reduction per platform modal; chat-message render path went from 6 files to 1 public + 5 private
- **Future revisits:** preload heavy chunks (only if telemetry shows flicker); consolidate PlatformView's six modal-coordination useState slots; reconsider per-modal test files after a post-slice-1 cleanup pass; Storybook + visual regression infrastructure
- **Cross-references:** RFC #64, PRD #75, slice issues #76/#77/#78

Aim for ~400-600 words. Wiki decision pages are reference documents, not narratives; bullet-heavy is fine.

- [ ] **Step 3: Update the wiki index**

`Read D:\Projects_Coding\wiki\wiki\index.md`. Add an entry under the appropriate section (likely `decisions/` or a guichet-specific subsection). Use the same line format as adjacent entries.

- [ ] **Step 4: Commit the wiki change**

```bash
cd D:\Projects_Coding\wiki
git add wiki/decisions/guichet-bundle-c-ui-primitives-consolidation.md wiki/index.md
git commit -m "decisions: Bundle C — UI primitives consolidation (FormModal + Message)"
```

(Wiki commits are made in the wiki repo, not in guichet.)

---

### Task 9: Run local CI + open the PR

**Files:**
- None (verification only).

- [ ] **Step 1: Run scripts/ci.ps1**

Run: `powershell -File scripts/ci.ps1`

Expected: ALL GREEN
- typecheck: ✓
- test-client: ✓ (Message + Message.lazy + Message.kind suites; per-modal suites still pass)
- test-server: ✓ (no server changes)
- migrate: ✓ (no schema changes)
- e2e: ✓ — chat E2E specs pass unchanged

- [ ] **Step 2: Open the PR**

```bash
git push -u origin feat/bundle-c-slice-3-cleanup
gh pr create --title "feat(chat): Bundle C slice 3 — cleanup, MessageBubble deleted, bundle-size guardrail" --body "$(cat <<'EOF'
Closes #78 · Parent #75 · RFC #64 · Builds on #77 · Closes Bundle C

## Summary
- `<Message>` body is now the inlined MessageBubble source. `client/src/components/MessageBubble.tsx` deleted.
- `MessageContent`, `AttachmentGrid`, `QuoteBlock`, `LinkPreviewCard`, `DeliveryStatus` are private — removed from `chat/index.ts` barrel.
- New `Message.kind.test.tsx` covers system + whisper render variants.
- `MessageBubble.test.tsx` deleted (covered by `Message.test.tsx` + `Message.lazy.test.tsx` + `Message.kind.test.tsx`).
- Wiki decision page filed: `decisions/guichet-bundle-c-ui-primitives-consolidation.md`.

## Bundle-size guardrail
Production build inspected via `client/dist/.vite/manifest.json`:

| Chunk | Before slice 3 | After slice 3 |
|---|---|---|
| chat-route entry | _<size>_ | _<size>_ |
| AttachmentGrid (lazy) | _<size>_ | _<size>_ |
| QuoteBlock (lazy) | _<size>_ | _<size>_ |
| LinkPreviewCard (lazy) | _<size>_ | _<size>_ |

The three fragment chunks appear in the chat-route entry's `dynamicImports`, NOT in `imports`. Lazy boundary is intact.

## What this PR does NOT do
- Does not introduce a CI guardrail for bundle-size — manual checklist only (see RFC #64).
- Does not consolidate PlatformView's modal-coordination useState slots — out of scope per PRD.
- Does not delete the per-modal test files retained in slice 1 — future cleanup if redundancy is confirmed.

## Test plan
- [x] `docker compose exec client npx tsc --noEmit -p .` — 0 errors
- [x] `docker compose exec client npm test` — all client suites pass
- [x] `docker compose exec server npm test` — server unchanged
- [x] `docker compose exec client npm run build` — succeeds; chunk inspection confirms lazy split
- [x] Chat E2E specs pass unchanged
- [x] Manual smoke: open a ticket, confirm plain-text + attachment + quote + link-preview render correctly

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## Self-Review Checklist (run before declaring plan complete)

**1. Spec coverage** — every issue #78 acceptance row has a task:

| Acceptance criterion | Task |
|---|---|
| `MessageBubble.tsx` deleted | Task 4 |
| `MessageBubble.test.tsx` deleted | Task 4 |
| Per-fragment test files deleted (if exist) | D5, Task 1 step 2 — none exist; nothing to delete |
| `MessageContent.tsx` not exported from any barrel | Task 5 |
| `Message.kind.test.tsx` exists with system + whisper coverage | Task 3 |
| `<Message>` renders inline (no MessageBubble wrap) | Task 2 |
| `npm run build` succeeds | Task 6 step 1 |
| Bundle-size guardrail confirms lazy split | Task 6 |
| No render-only smoke tests | (Convention) |
| CHANGELOG entry | Task 7 |
| `scripts/ci.ps1` passes | Task 9 step 1 |
| Existing chat E2E specs pass unchanged | Task 9 step 1 |
| Wiki decision page filed | Task 8 |

**2. Placeholder scan** — no "TBD" outside the bundle-size table (filled in at Task 6 / 9).

**3. Type consistency** — Message.tsx imports paths consistent across the inline rewrite (Task 2). Barrel pruning (Task 5) consistent with what's still callsite-required.

**4. Open scope items surfaced (not silenced):**
- The bundle-size guardrail is manual, not automated. Future RFC could add `rollup-plugin-visualizer` + a JSON-based threshold check in CI.
- `MessageContent.tsx` could be inlined into Message.tsx as a final consolidation step. RFC prefers leaving it as a private file; this slice respects that. A future cleanup could fully inline if the file shrinks.
- The slice 1 retention of per-modal test files is acknowledged. If redundancy is confirmed in a post-slice-1 review, those tests can be deleted in a follow-up.

---

## End

Bundle C ships. UI primitives — FormModal + Message — own the consolidated render paths. Slot drilling, scaffold drift, and eager fragment imports are gone from the dominant cases. Wiki page records the decisions for future reference.
