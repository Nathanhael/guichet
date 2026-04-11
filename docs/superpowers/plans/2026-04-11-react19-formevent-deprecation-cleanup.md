# React 19 `FormEvent` Deprecation Cleanup — Implementation Plan

> **For agentic workers:** This is a small mechanical refactor. No new behavior, no spec, no architecture decisions. One commit. Use `superpowers:executing-plans` if you want, or just walk through the steps below directly. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Silence the `'FormEvent' is deprecated [6385]` TypeScript warning across all 11 client-side `<form>` submit handlers by switching from the bare `React.FormEvent` to the generic `React.FormEvent<HTMLFormElement>`.

**Why:** `@types/react@19.x` marks the **non-generic** versions of `FormEvent`, `MouseEvent`, `ChangeEvent`, etc. as `@deprecated`. The generic versions (`React.FormEvent<HTMLFormElement>`, etc.) are not deprecated and are the React team's documented replacement. The deprecation is a soft warning — runtime is unaffected, the build still passes — but the warning shows up on every Edit diagnostic in ComposeArea.tsx and pollutes future code-review feedback. Cleaning it up once removes the noise permanently.

**Why a separate commit:** This was deliberately deferred from `c9b48bc` (the smiley fix) to avoid mixing a behavior fix with a 11-file mechanical sweep. CLAUDE.md explicitly tells us "Don't add features, refactor code, or make 'improvements' beyond what was asked" — so the deprecation cleanup gets its own focused PR.

**Tech Stack:** TypeScript 5, React 19, `@types/react@19.x`, Vitest + jsdom

**Docker reminder:** All `npm`/`node`/`npx` commands MUST run via `docker compose exec client ...`. Never on the host.

---

## Background — what's actually deprecated

Per [DefinitelyTyped #68720](https://github.com/DefinitelyTyped/DefinitelyTyped/pull/68720), the non-generic forms of React's synthetic event types are now `@deprecated`:

```ts
// DEPRECATED
React.FormEvent
React.MouseEvent
React.ChangeEvent
React.KeyboardEvent
// (and friends)
```

Their generic counterparts are not deprecated and are the official replacement:

```ts
// OK
React.FormEvent<HTMLFormElement>
React.MouseEvent<HTMLButtonElement>
React.ChangeEvent<HTMLInputElement>
React.KeyboardEvent<HTMLDivElement>
```

The generic parameter is the DOM element the handler is attached to. For `<form onSubmit>` it's always `HTMLFormElement`. All 11 occurrences in this codebase are `<form>` submit handlers — there are no `MouseEvent`, `ChangeEvent`, or other deprecated event types in scope yet. Other deprecated types are out of scope for this plan.

---

## Audit table — every call site

All 11 occurrences are in `<form onSubmit>` handlers, so the replacement is uniformly `React.FormEvent<HTMLFormElement>`. No file needs more than the simple type swap.

| File | Line(s) | Function | Form element | Replacement |
|------|---------|----------|--------------|-------------|
| `client/src/components/chat/ComposeArea.tsx` | 522 | `sendMessage(e?: React.FormEvent)` | `<form onSubmit={sendMessage}>` (line 592) | `e?: React.FormEvent<HTMLFormElement>` |
| `client/src/components/admin/AdminTeam.tsx` | 403 | `handleSubmit = (e: React.FormEvent) => {…}` | `<form onSubmit={handleSubmit}>` (line 416) | `e: React.FormEvent<HTMLFormElement>` |
| `client/src/components/admin/AdminTeam.tsx` | 513 | `handleSubmit = (e: React.FormEvent) => {…}` | `<form onSubmit={handleSubmit}>` (line 568) | `e: React.FormEvent<HTMLFormElement>` |
| `client/src/components/agent/TicketForm.tsx` | 77 | `function handleSubmit(e: React.FormEvent)` | `<form onSubmit={handleSubmit}>` (line 132) | `e: React.FormEvent<HTMLFormElement>` |
| `client/src/components/FeedbackModal.tsx` | 23 | `function submit(e: React.FormEvent)` | `<form onSubmit={submit}>` (line 43) | `e: React.FormEvent<HTMLFormElement>` |
| `client/src/components/platform/GroupMappingsPanel.tsx` | 152 | `handleSubmit = (e: React.FormEvent) => {…}` | `<form onSubmit={handleSubmit}>` (line 168) | `e: React.FormEvent<HTMLFormElement>` |
| `client/src/components/platform/GroupMappingsPanel.tsx` | 285 | `handleSubmit = (e: React.FormEvent) => {…}` | `<form onSubmit={handleSubmit}>` (line 300) | `e: React.FormEvent<HTMLFormElement>` |
| `client/src/views/login/ForgotPasswordForm.tsx` | 15 | `handleForgotPassword = async (e: React.FormEvent) => {…}` | `<form onSubmit={handleForgotPassword}>` (line 55) | `e: React.FormEvent<HTMLFormElement>` |
| `client/src/views/login/LocalLoginForm.tsx` | 22 | `handleLocalLogin = async (e: React.FormEvent) => {…}` | `<form onSubmit={handleLocalLogin}>` (line 60) | `e: React.FormEvent<HTMLFormElement>` |
| `client/src/views/login/MfaChallenge.tsx` | 20 | `handleMfaVerify = async (e: React.FormEvent) => {…}` | `<form onSubmit={handleMfaVerify}>` (line 51) | `e: React.FormEvent<HTMLFormElement>` |
| `client/src/views/login/ResetPasswordForm.tsx` | 18 | `handleResetPassword = async (e: React.FormEvent) => {…}` | `<form onSubmit={handleResetPassword}>` (line 53) | `e: React.FormEvent<HTMLFormElement>` |

Total: **11 occurrences across 9 files.** Line numbers are accurate as of commit `c9b48bc` (2026-04-11). Re-grep before applying — line numbers may have shifted if the files have been touched in the interim.

---

## Step-by-step

### Task 1: Re-confirm the audit

- [ ] Run `git log --oneline -5` to confirm the working tree is on `main` and clean.
- [ ] Run `grep -rn "React.FormEvent\b" client/src --include="*.tsx" --include="*.ts" | grep -v "FormEvent<"` to list all bare-`FormEvent` usages.
- [ ] If the count is **not 11**, stop and re-audit. The list above may be stale. Update this plan, commit the plan update, then proceed.
- [ ] If the count is 11 and matches the table above, continue.

### Task 2: Apply the type swap to each file

For each row in the audit table, edit the function signature only — leave the function body, the JSX, and everything else untouched.

**Pattern (deprecated → ok):**

```ts
// Before
function handleSubmit(e: React.FormEvent) { … }
const handleSubmit = (e: React.FormEvent) => { … };
async function handleSubmit(e: React.FormEvent) { … }

// After
function handleSubmit(e: React.FormEvent<HTMLFormElement>) { … }
const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => { … };
async function handleSubmit(e: React.FormEvent<HTMLFormElement>) { … }
```

`ComposeArea.tsx:522` is the only one with an optional parameter (`e?: React.FormEvent`). Preserve the `?`:

```ts
// Before
function sendMessage(e?: React.FormEvent) { … }
// After
function sendMessage(e?: React.FormEvent<HTMLFormElement>) { … }
```

Files to edit (apply the same pattern to each):

- [ ] `client/src/components/chat/ComposeArea.tsx` — 1 occurrence (`sendMessage`, optional param)
- [ ] `client/src/components/admin/AdminTeam.tsx` — 2 occurrences (`handleSubmit` × 2, both arrow fns inside different sub-components)
- [ ] `client/src/components/agent/TicketForm.tsx` — 1 occurrence (`handleSubmit`, function declaration)
- [ ] `client/src/components/FeedbackModal.tsx` — 1 occurrence (`submit`, function declaration)
- [ ] `client/src/components/platform/GroupMappingsPanel.tsx` — 2 occurrences (`handleSubmit` × 2, both arrow fns inside different sub-components)
- [ ] `client/src/views/login/ForgotPasswordForm.tsx` — 1 occurrence (`handleForgotPassword`, async arrow)
- [ ] `client/src/views/login/LocalLoginForm.tsx` — 1 occurrence (`handleLocalLogin`, async arrow)
- [ ] `client/src/views/login/MfaChallenge.tsx` — 1 occurrence (`handleMfaVerify`, async arrow)
- [ ] `client/src/views/login/ResetPasswordForm.tsx` — 1 occurrence (`handleResetPassword`, async arrow)

**Edit hygiene reminder:** Use `Edit` (or `replace_all` only when the `old_string` is unique). For files with two occurrences (`AdminTeam.tsx`, `GroupMappingsPanel.tsx`), the two `handleSubmit` declarations are inside **different sub-components** with different surrounding context — match enough surrounding lines that the replacement is unique. Don't use `replace_all` blindly: a future file with `React.FormEvent` mentioned in a comment would also get caught.

### Task 3: Verify nothing else broke

- [ ] `docker compose exec -T client npx tsc --noEmit` — must produce **no output** (no errors, no deprecations from these files).
- [ ] `docker compose exec -T client npm test -- --run` — full client suite must pass. Expect **173/173** (or whatever the current baseline is — re-run before editing to capture the baseline if you're paranoid).
- [ ] (Optional, slow) Spot-check by running the existing E2E suite for one form: `PLAYWRIGHT_RETRIES=0 npx playwright test login` (or similar). Not strictly required because the change is purely type-level — runtime behavior is identical.

### Task 4: Re-verify the deprecation is gone

- [ ] `grep -rn "React.FormEvent\b" client/src --include="*.tsx" --include="*.ts" | grep -v "FormEvent<"` should now return **zero results**.
- [ ] (Optional) Open `client/src/components/chat/ComposeArea.tsx` in your editor — the yellow underline on `FormEvent` should be gone.

### Task 5: Commit + push

Write a focused commit message. Suggested wording:

```
chore(types): use generic React.FormEvent<HTMLFormElement> in form handlers

@types/react@19 marks the non-generic React.FormEvent (and friends) as
@deprecated. The generic version with the explicit form-element type
parameter is the documented replacement and is not deprecated. Pure
type-level change, no runtime behavior change. Sweeps all 11 <form>
submit handlers in the client tree:

  - components/chat/ComposeArea.tsx (sendMessage)
  - components/admin/AdminTeam.tsx (×2)
  - components/agent/TicketForm.tsx
  - components/FeedbackModal.tsx
  - components/platform/GroupMappingsPanel.tsx (×2)
  - views/login/ForgotPasswordForm.tsx
  - views/login/LocalLoginForm.tsx
  - views/login/MfaChallenge.tsx
  - views/login/ResetPasswordForm.tsx

Verified: tsc --noEmit clean, 173/173 client tests pass, no remaining
bare React.FormEvent usages in client/src.
```

- [ ] `git add` only the 9 edited files.
- [ ] `git commit -m "$(cat <<'EOF' … EOF\n)"` with the message above.
- [ ] `git push origin main` (only if the user has explicitly approved pushing — otherwise stop after the local commit and report).

### Task 6: Delete this plan file

- [ ] `git rm docs/superpowers/plans/2026-04-11-react19-formevent-deprecation-cleanup.md` and amend or follow-up commit. The plan is single-use; once executed it should not clutter the plans directory.

---

## Out of scope (don't do these here)

These are tempting but **not** part of this plan. Resist the urge:

- **Other deprecated React event types.** If `grep -rn "React.MouseEvent\b\|React.ChangeEvent\b\|React.KeyboardEvent\b" client/src` finds more deprecated usages, file a separate plan. Don't bundle them in. The point of this commit is "11 form handlers, one type swap" — adding more changes makes the diff harder to review and weakens the commit message's specificity.
- **Tests for the type change.** It's a pure type-level rename. There's nothing to test that `tsc --noEmit` doesn't already check.
- **Refactoring `e.preventDefault()` calls.** Don't touch the function bodies.
- **Adding `noImplicitAny` or other tsconfig tweaks.** Out of scope.
- **The line 522 area in ComposeArea.tsx.** Don't refactor `sendMessage` itself, don't move it, don't rename it. Type signature only.

---

## Estimated effort

- Audit + 11 edits: ~10 minutes
- Typecheck + tests: ~3 minutes
- Commit + push + plan cleanup: ~2 minutes

**Total: ~15 minutes for one focused commit.**

---

## Open questions / risk

- **Risk: low.** Pure type-level change. Runtime is identical. The generic `FormEvent<HTMLFormElement>` is a strict subtype of the bare `FormEvent`, so `e.preventDefault()`, `e.currentTarget`, etc. all still work — and `e.currentTarget` is now correctly typed as `HTMLFormElement` instead of `Element`, which is a small win.
- **Question:** Should this commit also do `MouseEvent`, `ChangeEvent`, etc. while we're here? — **No.** See "Out of scope" above. File separate plans if those deprecations exist elsewhere in the codebase.
- **Question:** Should the plan delete itself in Task 6, or should we keep it as historical record? — **Delete it.** The commit message captures the decision and the audit table is reproducible by re-running grep. Plans are intended for in-progress work, not history. The wiki + git log are the historical record.
