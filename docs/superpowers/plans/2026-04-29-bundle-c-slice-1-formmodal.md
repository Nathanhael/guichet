# Bundle C / Slice 1 — `<FormModal>` Primitive + 5 Platform-Modal Migrations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Introduce one `<FormModal>` primitive at `client/src/components/ui/FormModal.tsx` that owns the modal scaffold, the FIELD_LABEL / INPUT Tailwind constants, and the submit lifecycle (pending → disabled, error → toast, success → `invalidate?.()` → `onClose()` → `mutation.reset()`). Add a static `FormModal.TypedConfirm` sub-component for the destructive-typed-name pattern. Migrate all five existing platform modals (`CreatePartnerModal`, `DeletePartnerModal`, `EditPartnerModal`, `EditUserProfileModal`, `InviteUserModal`) to mount through it. Net file size loss expected: ~50% per modal.

**Architecture:** FormModal accepts the tRPC mutation as a **prop object** (decision Q1; see PRD #75). The lifecycle wiring runs in `useEffect` against `mutation.isSuccess` and `mutation.error`, calling `mutation.reset()` after handling so the effect is idempotent across re-renders. Form state stays caller-owned — fields render as `children`, validation gates via an `onSubmit` callback that returns the mutation input or `null` to abort. The destructive-typed-name pattern is exposed as `FormModal.TypedConfirm` — a static sub-component the caller composes inside `children`, with the parent's `onSubmit` reading the typed value against the expected match. FormModal does NOT use `<ToastProvider>` (not wired in App today); instead it manages a local `useState<{message,type}|null>` and renders the existing `<Toast>` component, mirroring the current per-modal pattern but centralizing it once.

**Tech Stack:** React 19, TypeScript, Vitest + jsdom + @testing-library/react, Tailwind 4, existing `<Modal>` / `<Button>` / `<Toast>` primitives.

**Parent issue:** [#76](https://github.com/Nathanhael/guichet/issues/76) (PRD #75, RFC #64). Blocks: [#77](https://github.com/Nathanhael/guichet/issues/77).

---

## Pre-flight: Decisions Locked Before Coding

### D1. Mutation passed as prop object, not mutation key.
RFC Q1 resolved: caller writes `mutation={trpc.X.useMutation()}` (no callbacks). FormModal owns success/error wiring via `useEffect` on `mutation.isSuccess` / `mutation.error`, calling `mutation.reset()` after handling so the effect is idempotent. Tests pass `makeMutationMock()` (already exists in `client/src/test/helpers.tsx`) directly — zero tRPC surface in FormModal tests. Generic `<TInput>` preserves type safety on the mutation input.

### D2. Local toast state, not `<ToastProvider>`.
The newer `useToast()` context exists at `client/src/components/ui/ToastProvider.tsx` but is not wired into `App.tsx` (verified by grep — only the file itself and the barrel reference it). Wiring it app-wide is a separate refactor. FormModal mirrors the current per-modal pattern: local `useState<{message,type}|null>` plus the existing `<Toast>` component rendered alongside the Modal. Migrating to `useToast()` is a follow-up once the provider is mounted at the app root.

### D3. FIELD_LABEL / INPUT constants exported alongside FormModal.
Today they're copy-pasted in 5 files. After this slice, they live once in `FormModal.tsx` and are exported as named constants for callers that hand-roll a field outside the standard scaffold (e.g., `EditPartnerModal`'s read-only ID display row uses INPUT classes for visual parity but isn't a real input).

### D4. `onSubmit` returns `TInput | null` — null aborts.
Validation is the caller's responsibility but FormModal needs to know whether to fire. `onSubmit` is called when the submit button is clicked; if it returns `null` the mutation is not fired. The submit button's `disabled` state is computed by the caller passing `disabled` (most callers gate on field presence) plus FormModal's own `disabled = disabled || mutation.isPending`.

### D5. `dismissOnBackdrop` and `dismissOnEscape` are pass-through props.
DeletePartnerModal uses `dismissOnBackdrop={false}` today (destructive flows shouldn't dismiss accidentally). FormModal accepts these as optional props and forwards to `<Modal>`. Default matches Modal's defaults (both `true`).

### D6. Header customization: `title` + optional `subtitle` for the 80% case; `headerSlot` escape hatch for the 20%.
DeletePartnerModal renders an icon + title + subtitle in a custom layout (AlertTriangle + "Delete permanently" + body). InviteUserModal's post-success result screen also has a custom header. FormModal exposes `title` (string) and `subtitle` (string) for the standard case, plus `headerSlot` (ReactNode) that overrides both when provided. Callers passing `headerSlot` own the entire header content.

### D7. `submitVariant: 'primary' | 'danger'` (default `'primary'`).
Maps to `<Button variant>`. Danger gets the existing red destructive style. No other variants — secondary/ghost are the Cancel button which is fixed.

### D8. `mutation.reset()` after success AND after the error toast is dismissed.
Without `reset()`, `mutation.isSuccess` and `mutation.error` stay true forever, causing the effect to re-fire on every re-render. After success: reset immediately (the modal is closing anyway). After error: reset when the toast is dismissed (so the user can retry without the effect re-firing).

### D9. Per-modal test files NOT deleted in this slice.
The slice 1 issue (#76) calls this out explicitly: keep the per-modal tests for behavioral parity through the migration. They will be reviewed for redundancy in a future cleanup pass once FormModal-level coverage is confirmed adequate. The slice 1 PR ships with FormModal tests AS WELL AS the per-modal tests.

### D10. `InviteUserModal`'s post-success result screen stays bespoke.
Today, on success, InviteUserModal swaps to a different Modal layout showing "Invite resent" with a Done button. This is a multi-step wizard pattern that doesn't fit FormModal's single-mutation shape. The slice migrates the form path through FormModal; the post-success screen remains a separate `<Modal>` rendered conditionally. The `renderFooter` escape hatch is NOT used (treated as a code smell per RFC).

### D11. Behavior preservation for `EditPartnerModal`'s prop→state hydration.
EditPartnerModal hydrates form state from `partner` prop via `useEffect`. That hydration stays at the caller — FormModal does not own form state. The migration is scaffolding-only; the AI-features section, Toggle component, and prop sync logic are unchanged.

### Open question — none for this slice.
All RFC-flagged questions are resolved at the PRD level (#75); no implementation-level open items remain.

---

## File Structure

### Files to create

| Path | Responsibility |
|---|---|
| `client/src/components/ui/FormModal.tsx` | The primitive. Default export `FormModal`; static sub-component `FormModal.TypedConfirm`; named exports `FIELD_LABEL`, `INPUT`. |
| `client/src/components/ui/__tests__/FormModal.test.tsx` | Boundary tests for the primitive lifecycle. |
| `client/src/components/ui/__tests__/FormModal.TypedConfirm.test.tsx` | Boundary tests for the typed-confirm sub-component. |

### Files to modify

| Path | Change |
|---|---|
| `client/src/components/platform/CreatePartnerModal.tsx` | Replace scaffolding with `<FormModal>`; keep form state + onSubmit. |
| `client/src/components/platform/DeletePartnerModal.tsx` | Replace scaffolding with `<FormModal>`; use `<FormModal.TypedConfirm>`; pass `submitVariant="danger"`, `dismissOnBackdrop={false}`, `headerSlot` for the custom AlertTriangle header. |
| `client/src/components/platform/EditPartnerModal.tsx` | Replace scaffolding with `<FormModal>`; preserve prop→state hydration, AI-features section, Toggle. |
| `client/src/components/platform/EditUserProfileModal.tsx` | Replace scaffolding with `<FormModal>`; preserve prop→state hydration. |
| `client/src/components/platform/InviteUserModal.tsx` | Migrate the form-input path through `<FormModal>`; keep the post-success result screen as a separate conditionally-rendered `<Modal>`. |
| `CHANGELOG.md` | Unreleased entry: "Bundle C slice 1 — FormModal primitive + migrate 5 platform modals." |

### Files NOT touched in this slice

- `client/src/components/ui/Modal.tsx` — FormModal composes the existing primitive; no changes to Modal itself.
- `client/src/components/Toast.tsx` — FormModal uses the existing component as-is.
- `client/src/components/ui/ToastProvider.tsx` — not wired in App; out of scope for this slice (per D2).
- `client/src/views/PlatformView.tsx` — the orchestrator's six useState slots are NOT consolidated in this slice (per PRD scope).
- `client/src/components/platform/ManageAccessModal.tsx` — not in the 5-modal list (multi-action access panel, not a single-mutation form).
- `client/src/components/platform/__tests__/*Modal.test.tsx` — kept for parity (per D9).
- `client/src/test/helpers.tsx` — `makeMutationMock` already exists; no changes needed.

---

## Conventions

- **Test runner:** `docker compose exec client npm test -- <path/to/file.test.tsx>`. Vitest passthrough.
- **Type check:** `docker compose exec client npx tsc --noEmit -p .`
- **CI:** `powershell -File scripts/ci.ps1` (final task only)
- **Server reload:** NOT required — this slice is client-only. Vite HMR handles client edits.
- **Commit style:** `feat(ui): <description>` for new primitive code, `refactor(ui): <description>` for migrations, `test(ui): <description>` for test-only commits. One commit per task.
- **Branch:** create a feature branch off main named `feat/bundle-c-slice-1-formmodal`.

---

## Tasks

### Task 1: Scaffold FormModal type signature (no behavior yet)

**Files:**
- Create: `client/src/components/ui/FormModal.tsx`

- [ ] **Step 1: Write the type contract + empty render**

```tsx
// client/src/components/ui/FormModal.tsx
import { ReactNode, useEffect, useState } from 'react';
import Modal, { ModalHeader, ModalBody, ModalFooter } from './Modal';
import Button from './Button';
import Toast from '../Toast';

export const FIELD_LABEL = 'block text-[12px] font-medium text-[var(--color-ink-soft)] mb-1.5';
export const INPUT =
  'w-full h-9 px-3 rounded-[var(--radius-btn)] bg-[var(--color-bg-elevated)] text-[13px] text-[var(--color-ink)] border border-transparent focus:border-[var(--color-accent)] focus:outline-none placeholder:text-[var(--color-ink-muted)]';

export interface MutationLike<TInput> {
  mutate: (input: TInput) => void;
  isPending: boolean;
  isSuccess?: boolean;
  error?: { message: string } | null;
  reset?: () => void;
}

export interface FormModalProps<TInput> {
  open: boolean;
  onClose: () => void;
  title?: string;
  subtitle?: string;
  /** Overrides title+subtitle when provided. */
  headerSlot?: ReactNode;
  mutation: MutationLike<TInput>;
  /** Return the mutation input, or null to abort. */
  onSubmit: () => TInput | null;
  submitLabel: string;
  submitVariant?: 'primary' | 'danger';
  /** Called once after `mutation.isSuccess` transitions true; before onClose + reset. */
  invalidate?: () => void;
  /** Caller-owned disabled gate (in addition to mutation.isPending). */
  disabled?: boolean;
  maxWidth?: number;
  dismissOnBackdrop?: boolean;
  dismissOnEscape?: boolean;
  id?: string;
  children: ReactNode;
}

function FormModalImpl<TInput>(_props: FormModalProps<TInput>) {
  return null;
}

interface TypedConfirmProps {
  matchValue: string;
  label: string;
  onChange: (value: string) => void;
  placeholder?: string;
}

function TypedConfirm(_props: TypedConfirmProps) {
  return null;
}

const FormModal = Object.assign(FormModalImpl, { TypedConfirm });
export default FormModal;
```

- [ ] **Step 2: Type-check passes**

Run: `docker compose exec client npx tsc --noEmit -p .`
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add client/src/components/ui/FormModal.tsx
git commit -m "feat(ui): scaffold FormModal type signature + TypedConfirm placeholder"
```

---

### Task 2: Test — open/close + onSubmit returning null aborts

**Files:**
- Create: `client/src/components/ui/__tests__/FormModal.test.tsx`

- [ ] **Step 1: Write the failing tests**

```tsx
// client/src/components/ui/__tests__/FormModal.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import FormModal, { FIELD_LABEL, INPUT } from '../FormModal';
import { makeMutationMock } from '../../../test/helpers';

describe('FormModal — open / close', () => {
  it('renders nothing when open=false', () => {
    const { container } = render(
      <FormModal
        open={false}
        onClose={vi.fn()}
        title="X"
        mutation={makeMutationMock()}
        onSubmit={() => null}
        submitLabel="Save"
      >
        <input data-testid="field" />
      </FormModal>
    );
    expect(container.firstChild).toBeNull();
  });

  it('renders title + Cancel + Save when open', () => {
    render(
      <FormModal
        open={true}
        onClose={vi.fn()}
        title="My Title"
        mutation={makeMutationMock()}
        onSubmit={() => ({ x: 1 })}
        submitLabel="Save"
      >
        <input data-testid="field" />
      </FormModal>
    );
    expect(screen.getByText('My Title')).toBeInTheDocument();
    expect(screen.getByText('Cancel')).toBeInTheDocument();
    expect(screen.getByText('Save')).toBeInTheDocument();
    expect(screen.getByTestId('field')).toBeInTheDocument();
  });

  it('Cancel button calls onClose', () => {
    const onClose = vi.fn();
    render(
      <FormModal open={true} onClose={onClose} title="X" mutation={makeMutationMock()} onSubmit={() => ({})} submitLabel="Save">
        <span />
      </FormModal>
    );
    fireEvent.click(screen.getByText('Cancel'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe('FormModal — onSubmit gate', () => {
  beforeEach(() => vi.clearAllMocks());

  it('does not call mutation.mutate when onSubmit returns null', () => {
    const m = makeMutationMock();
    render(
      <FormModal open={true} onClose={vi.fn()} title="X" mutation={m} onSubmit={() => null} submitLabel="Save">
        <span />
      </FormModal>
    );
    fireEvent.click(screen.getByText('Save'));
    expect(m.mutate).not.toHaveBeenCalled();
  });

  it('calls mutation.mutate with the value when onSubmit returns non-null', () => {
    const m = makeMutationMock();
    const input = { id: 'x', name: 'y' };
    render(
      <FormModal open={true} onClose={vi.fn()} title="X" mutation={m} onSubmit={() => input} submitLabel="Save">
        <span />
      </FormModal>
    );
    fireEvent.click(screen.getByText('Save'));
    expect(m.mutate).toHaveBeenCalledTimes(1);
    expect(m.mutate).toHaveBeenCalledWith(input);
  });
});

describe('FormModal — exported constants', () => {
  it('exports FIELD_LABEL and INPUT class strings', () => {
    expect(FIELD_LABEL).toMatch(/font-medium/);
    expect(INPUT).toMatch(/h-9/);
  });
});
```

- [ ] **Step 2: Run the tests, expect failure**

Run: `docker compose exec client npm test -- ui/__tests__/FormModal.test.tsx --run`
Expected: FAIL — render returns null (Step 1's scaffold).

- [ ] **Step 3: Implement render + onSubmit gate**

Replace the body of `FormModalImpl` in `client/src/components/ui/FormModal.tsx`:

```tsx
function FormModalImpl<TInput>({
  open, onClose, title, subtitle, headerSlot, mutation, onSubmit,
  submitLabel, submitVariant = 'primary', disabled = false,
  maxWidth = 560, dismissOnBackdrop, dismissOnEscape, id, children,
}: FormModalProps<TInput>) {
  function handleSubmit() {
    const input = onSubmit();
    if (input === null) return;
    mutation.mutate(input);
  }

  const submitDisabled = disabled || mutation.isPending;

  return (
    <Modal
      open={open}
      onClose={onClose}
      id={id}
      maxWidth={maxWidth}
      dismissOnBackdrop={dismissOnBackdrop}
      dismissOnEscape={dismissOnEscape}
    >
      <ModalHeader onClose={onClose} title={!headerSlot ? title : undefined} subtitle={!headerSlot ? subtitle : undefined}>
        {headerSlot}
      </ModalHeader>
      <ModalBody>{children}</ModalBody>
      <ModalFooter>
        <Button variant="secondary" size="md" onClick={onClose}>Cancel</Button>
        <Button variant={submitVariant} size="md" disabled={submitDisabled} onClick={handleSubmit}>
          {submitLabel}
        </Button>
      </ModalFooter>
    </Modal>
  );
}
```

- [ ] **Step 4: Run the tests, expect pass**

Run: `docker compose exec client npm test -- ui/__tests__/FormModal.test.tsx --run`
Expected: PASS — all 6 cases green.

- [ ] **Step 5: Commit**

```bash
git add client/src/components/ui/FormModal.tsx client/src/components/ui/__tests__/FormModal.test.tsx
git commit -m "feat(ui): FormModal renders modal scaffold + onSubmit-null aborts mutation"
```

---

### Task 3: Test — pending disables submit; success calls invalidate + onClose + reset

**Files:**
- Modify: `client/src/components/ui/__tests__/FormModal.test.tsx`

- [ ] **Step 1: Append the lifecycle tests**

```tsx
describe('FormModal — pending state', () => {
  it('disables submit when mutation.isPending=true', () => {
    const m = makeMutationMock({ isPending: true });
    render(
      <FormModal open={true} onClose={vi.fn()} title="X" mutation={m} onSubmit={() => ({})} submitLabel="Save">
        <span />
      </FormModal>
    );
    expect(screen.getByText('Save')).toBeDisabled();
  });

  it('respects caller-passed disabled prop independently of pending', () => {
    const m = makeMutationMock({ isPending: false });
    render(
      <FormModal open={true} onClose={vi.fn()} title="X" mutation={m} onSubmit={() => ({})} submitLabel="Save" disabled>
        <span />
      </FormModal>
    );
    expect(screen.getByText('Save')).toBeDisabled();
  });
});

describe('FormModal — success lifecycle', () => {
  it('calls invalidate then onClose then mutation.reset when isSuccess transitions true', () => {
    const onClose = vi.fn();
    const invalidate = vi.fn();
    const reset = vi.fn();
    const order: string[] = [];
    invalidate.mockImplementation(() => order.push('invalidate'));
    onClose.mockImplementation(() => order.push('onClose'));
    reset.mockImplementation(() => order.push('reset'));

    const m = makeMutationMock({ isSuccess: true });
    m.reset = reset;

    render(
      <FormModal
        open={true}
        onClose={onClose}
        title="X"
        mutation={m}
        onSubmit={() => ({})}
        submitLabel="Save"
        invalidate={invalidate}
      >
        <span />
      </FormModal>
    );

    expect(order).toEqual(['invalidate', 'onClose', 'reset']);
  });

  it('does not call invalidate or onClose when isSuccess stays false', () => {
    const onClose = vi.fn();
    const invalidate = vi.fn();
    const m = makeMutationMock({ isSuccess: false });

    render(
      <FormModal open={true} onClose={onClose} title="X" mutation={m} onSubmit={() => ({})} submitLabel="Save" invalidate={invalidate}>
        <span />
      </FormModal>
    );

    expect(invalidate).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Update the helper to accept isSuccess overrides**

`makeMutationMock` already accepts `Partial<MutationMock>` overrides. Confirm by inspecting `client/src/test/helpers.tsx` — current shape supports `isPending`. We need to extend the interface to include `isSuccess`, `error`, and `reset` as optional fields. Edit the helper:

In `client/src/test/helpers.tsx`, replace the `MutationMock` interface and `makeMutationMock` function with:

```ts
interface MutationMock {
  mutate: ReturnType<typeof vi.fn>;
  isPending: boolean;
  isSuccess?: boolean;
  error?: { message: string } | null;
  reset?: ReturnType<typeof vi.fn>;
}

export function makeMutationMock(overrides: Partial<MutationMock> = {}): MutationMock {
  return {
    mutate: vi.fn(),
    isPending: false,
    isSuccess: false,
    error: null,
    reset: vi.fn(),
    ...overrides,
  };
}
```

- [ ] **Step 3: Run the tests, expect failure**

Run: `docker compose exec client npm test -- ui/__tests__/FormModal.test.tsx --run`
Expected: FAIL — pending test passes (Button already disables on `disabled` prop) but success-lifecycle tests fail (no useEffect wired yet).

- [ ] **Step 4: Implement the success-lifecycle effect**

Add inside `FormModalImpl`, before the `return`:

```tsx
useEffect(() => {
  if (mutation.isSuccess) {
    invalidate?.();
    onClose();
    mutation.reset?.();
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional: react only to the success edge
}, [mutation.isSuccess]);
```

- [ ] **Step 5: Run the tests, expect pass**

Run: `docker compose exec client npm test -- ui/__tests__/FormModal.test.tsx --run`
Expected: PASS — all lifecycle cases green.

- [ ] **Step 6: Commit**

```bash
git add client/src/components/ui/FormModal.tsx client/src/components/ui/__tests__/FormModal.test.tsx client/src/test/helpers.tsx
git commit -m "feat(ui): FormModal success lifecycle (invalidate → onClose → mutation.reset)"
```

---

### Task 4: Test — error renders Toast; toast dismissal triggers reset

**Files:**
- Modify: `client/src/components/ui/__tests__/FormModal.test.tsx`

- [ ] **Step 1: Append the error tests**

```tsx
describe('FormModal — error toast', () => {
  it('renders Toast with error message when mutation.error transitions to non-null', () => {
    const m = makeMutationMock({ error: { message: 'Boom' } });
    render(
      <FormModal open={true} onClose={vi.fn()} title="X" mutation={m} onSubmit={() => ({})} submitLabel="Save">
        <span />
      </FormModal>
    );
    expect(screen.getByText('Boom')).toBeInTheDocument();
  });

  it('calls mutation.reset when the toast is dismissed', () => {
    const reset = vi.fn();
    const m = makeMutationMock({ error: { message: 'Boom' }, reset });
    render(
      <FormModal open={true} onClose={vi.fn()} title="X" mutation={m} onSubmit={() => ({})} submitLabel="Save">
        <span />
      </FormModal>
    );
    fireEvent.click(screen.getByLabelText('Dismiss'));
    expect(reset).toHaveBeenCalledTimes(1);
  });

  it('does not render Toast when mutation.error is null', () => {
    const m = makeMutationMock({ error: null });
    render(
      <FormModal open={true} onClose={vi.fn()} title="X" mutation={m} onSubmit={() => ({})} submitLabel="Save">
        <span />
      </FormModal>
    );
    expect(screen.queryByLabelText('Dismiss')).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the tests, expect failure**

Run: `docker compose exec client npm test -- ui/__tests__/FormModal.test.tsx --run`
Expected: FAIL — no toast wired yet.

- [ ] **Step 3: Implement the error-toast state**

Add inside `FormModalImpl`, alongside the existing useEffect:

```tsx
const [toastMessage, setToastMessage] = useState<string | null>(null);

useEffect(() => {
  if (mutation.error) setToastMessage(mutation.error.message);
  else setToastMessage(null);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- react only to the error edge
}, [mutation.error?.message]);

function handleToastClose() {
  setToastMessage(null);
  mutation.reset?.();
}
```

And update the `return` to render the Toast alongside the Modal (wrap in a fragment):

```tsx
return (
  <>
    <Modal /* ...existing props... */>
      {/* ...existing children... */}
    </Modal>
    {toastMessage ? <Toast message={toastMessage} type="error" onClose={handleToastClose} /> : null}
  </>
);
```

- [ ] **Step 4: Run the tests, expect pass**

Run: `docker compose exec client npm test -- ui/__tests__/FormModal.test.tsx --run`
Expected: PASS — all 3 error-toast cases green.

- [ ] **Step 5: Commit**

```bash
git add client/src/components/ui/FormModal.tsx client/src/components/ui/__tests__/FormModal.test.tsx
git commit -m "feat(ui): FormModal error toast + dismissal triggers mutation.reset"
```

---

### Task 5: Test — submitVariant="danger" renders danger button; headerSlot overrides title

**Files:**
- Modify: `client/src/components/ui/__tests__/FormModal.test.tsx`

- [ ] **Step 1: Append the variant + header tests**

```tsx
describe('FormModal — submit variant', () => {
  it('renders the danger button styling when submitVariant="danger"', () => {
    render(
      <FormModal open={true} onClose={vi.fn()} title="X" mutation={makeMutationMock()} onSubmit={() => ({})} submitLabel="Delete" submitVariant="danger">
        <span />
      </FormModal>
    );
    const btn = screen.getByText('Delete');
    // Button variant="danger" must produce a class that includes the urgent token reference.
    // We assert against the rendered className, not against a brittle full-string match.
    expect(btn.className).toMatch(/urgent|danger|destructive/i);
  });

  it('defaults to primary styling when submitVariant is omitted', () => {
    render(
      <FormModal open={true} onClose={vi.fn()} title="X" mutation={makeMutationMock()} onSubmit={() => ({})} submitLabel="Save">
        <span />
      </FormModal>
    );
    const btn = screen.getByText('Save');
    expect(btn.className).toMatch(/accent|primary/i);
  });
});

describe('FormModal — header customization', () => {
  it('renders headerSlot in place of title+subtitle when provided', () => {
    render(
      <FormModal
        open={true}
        onClose={vi.fn()}
        title="ignored"
        subtitle="also ignored"
        headerSlot={<div data-testid="custom-header">Custom</div>}
        mutation={makeMutationMock()}
        onSubmit={() => ({})}
        submitLabel="Save"
      >
        <span />
      </FormModal>
    );
    expect(screen.getByTestId('custom-header')).toBeInTheDocument();
    expect(screen.queryByText('ignored')).not.toBeInTheDocument();
    expect(screen.queryByText('also ignored')).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the tests, expect pass**

Run: `docker compose exec client npm test -- ui/__tests__/FormModal.test.tsx --run`
Expected: PASS — variant pass-through is automatic via Button; headerSlot logic from Task 1 already conditional.

If the variant assertion fails, inspect `client/src/components/ui/Button.tsx` to learn the exact class tokens emitted for `variant="danger"` and update the regex accordingly.

- [ ] **Step 3: Commit**

```bash
git add client/src/components/ui/__tests__/FormModal.test.tsx
git commit -m "test(ui): FormModal submitVariant + headerSlot customization"
```

---

### Task 6: TypedConfirm — implementation + boundary tests

**Files:**
- Modify: `client/src/components/ui/FormModal.tsx`
- Create: `client/src/components/ui/__tests__/FormModal.TypedConfirm.test.tsx`

- [ ] **Step 1: Implement TypedConfirm**

Replace the `TypedConfirm` placeholder in `FormModal.tsx`:

```tsx
function TypedConfirm({ matchValue, label, onChange, placeholder }: TypedConfirmProps) {
  return (
    <>
      <label className={FIELD_LABEL}>{label}</label>
      <input
        type="text"
        placeholder={placeholder ?? matchValue}
        className={INPUT}
        onChange={(e) => onChange(e.target.value)}
        autoFocus
      />
    </>
  );
}
```

- [ ] **Step 2: Write the boundary tests**

```tsx
// client/src/components/ui/__tests__/FormModal.TypedConfirm.test.tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import FormModal from '../FormModal';

describe('FormModal.TypedConfirm', () => {
  it('renders a label and an input with the matchValue as placeholder by default', () => {
    render(
      <FormModal.TypedConfirm matchValue="DangerCorp" label="Display name" onChange={vi.fn()} />
    );
    expect(screen.getByText('Display name')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('DangerCorp')).toBeInTheDocument();
  });

  it('calls onChange on every keystroke', () => {
    const onChange = vi.fn();
    render(<FormModal.TypedConfirm matchValue="Acme" label="Name" onChange={onChange} />);
    const input = screen.getByPlaceholderText('Acme');
    fireEvent.change(input, { target: { value: 'Acm' } });
    fireEvent.change(input, { target: { value: 'Acme' } });
    expect(onChange).toHaveBeenCalledTimes(2);
    expect(onChange).toHaveBeenLastCalledWith('Acme');
  });

  it('honors a custom placeholder when provided', () => {
    render(
      <FormModal.TypedConfirm matchValue="Acme" label="Name" onChange={vi.fn()} placeholder="type the name" />
    );
    expect(screen.getByPlaceholderText('type the name')).toBeInTheDocument();
  });
});

describe('FormModal.TypedConfirm — composed inside FormModal', () => {
  it('parent gates onSubmit based on the typed value', () => {
    const m = { mutate: vi.fn(), isPending: false, reset: vi.fn() };
    function Wrap() {
      const [v, setV] = (require('react') as typeof import('react')).useState('');
      return (
        <FormModal
          open={true}
          onClose={vi.fn()}
          title="Delete"
          mutation={m}
          onSubmit={() => (v === 'Acme' ? 'acme-id' : null)}
          submitLabel="Delete"
          submitVariant="danger"
        >
          <FormModal.TypedConfirm matchValue="Acme" label="Name" onChange={setV} />
        </FormModal>
      );
    }
    render(<Wrap />);
    const input = screen.getByPlaceholderText('Acme');
    const btn = screen.getByText('Delete');

    fireEvent.click(btn);
    expect(m.mutate).not.toHaveBeenCalled();

    fireEvent.change(input, { target: { value: 'Wrong' } });
    fireEvent.click(btn);
    expect(m.mutate).not.toHaveBeenCalled();

    fireEvent.change(input, { target: { value: 'Acme' } });
    fireEvent.click(btn);
    expect(m.mutate).toHaveBeenCalledWith('acme-id');
  });
});
```

- [ ] **Step 3: Run the tests, expect pass**

Run: `docker compose exec client npm test -- ui/__tests__/FormModal.TypedConfirm.test.tsx --run`
Expected: PASS — TypedConfirm is a thin display + integration with onSubmit.

- [ ] **Step 4: Commit**

```bash
git add client/src/components/ui/FormModal.tsx client/src/components/ui/__tests__/FormModal.TypedConfirm.test.tsx
git commit -m "feat(ui): FormModal.TypedConfirm sub-component for destructive-typed-name pattern"
```

---

### Task 7: Migrate `CreatePartnerModal`

**Files:**
- Modify: `client/src/components/platform/CreatePartnerModal.tsx`

- [ ] **Step 1: Read the current file**

Run: `Read client/src/components/platform/CreatePartnerModal.tsx`. Note: imports include `Toast`, `Modal/Header/Body/Footer`, `Button`; local FIELD_LABEL/INPUT constants; `useState` toast slot; `useMutation` with onSuccess/onError callbacks.

- [ ] **Step 2: Rewrite using FormModal**

Replace the entire file with:

```tsx
import { useState } from 'react';
import { trpc } from '../../utils/trpc';
import { useT } from '../../i18n';
import FormModal, { FIELD_LABEL, INPUT } from '../ui/FormModal';

interface CreatePartnerModalProps {
  open: boolean;
  onClose: () => void;
}

export default function CreatePartnerModal({ open, onClose }: CreatePartnerModalProps) {
  const t = useT();
  const utils = trpc.useUtils();
  const [form, setForm] = useState({ id: '', name: '', industry: '' });

  const createPartner = trpc.platform.createPartner.useMutation();

  return (
    <FormModal
      open={open}
      onClose={() => { setForm({ id: '', name: '', industry: '' }); onClose(); }}
      title={t('create_new_partner')}
      mutation={createPartner}
      onSubmit={() => (form.id && form.name ? form : null)}
      submitLabel={t('create_new_partner')}
      invalidate={() => { utils.platform.listPartners.invalidate(); setForm({ id: '', name: '', industry: '' }); }}
      disabled={!form.id || !form.name}
      maxWidth={560}
      id="create-partner"
    >
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className={FIELD_LABEL}>{t('partner_id')}</label>
          <input
            type="text"
            placeholder={t('placeholder_partner_id')}
            className={`${INPUT} font-mono`}
            value={form.id}
            onChange={e => setForm({ ...form, id: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '') })}
          />
        </div>
        <div>
          <label className={FIELD_LABEL}>{t('display_name')}</label>
          <input
            type="text"
            placeholder={t('placeholder_partner_name')}
            className={INPUT}
            value={form.name}
            onChange={e => setForm({ ...form, name: e.target.value })}
          />
        </div>
      </div>
    </FormModal>
  );
}
```

- [ ] **Step 3: Run the existing per-modal tests, expect pass**

Run: `docker compose exec client npm test -- platform/__tests__/CreatePartnerModal.test.tsx --run`
Expected: PASS — behavior is preserved. The hoisted-mock test pattern still works because the test mocks `trpc.platform.createPartner.useMutation()` and the FormModal still receives a real mutation object.

If the test fails, the most likely cause is that the test asserts on the toast slot (it doesn't appear unconditionally now). Inspect the failure and adjust the test only if the assertion is now invalid (e.g., it asserts a div that no longer renders); otherwise fix the migration.

- [ ] **Step 4: Type-check passes**

Run: `docker compose exec client npx tsc --noEmit -p .`
Expected: No errors.

- [ ] **Step 5: Commit**

```bash
git add client/src/components/platform/CreatePartnerModal.tsx
git commit -m "refactor(ui): CreatePartnerModal mounts through FormModal"
```

---

### Task 8: Migrate `DeletePartnerModal` (TypedConfirm + danger + dismissOnBackdrop=false)

**Files:**
- Modify: `client/src/components/platform/DeletePartnerModal.tsx`

- [ ] **Step 1: Read the current file**

Run: `Read client/src/components/platform/DeletePartnerModal.tsx`. Note: custom header with AlertTriangle icon + title + replaced-text subtitle; typed-confirm input; useEffect resets `confirmation` when partner changes.

- [ ] **Step 2: Rewrite using FormModal + TypedConfirm**

Replace the entire file with:

```tsx
import { useState, useEffect } from 'react';
import { AlertTriangle } from 'lucide-react';
import { trpc } from '../../utils/trpc';
import { useT } from '../../i18n';
import FormModal from '../ui/FormModal';
import type { Partner } from './types';

interface DeletePartnerModalProps {
  partner: Partner | null;
  onClose: () => void;
}

export default function DeletePartnerModal({ partner, onClose }: DeletePartnerModalProps) {
  const t = useT();
  const utils = trpc.useUtils();
  const [confirmation, setConfirmation] = useState('');

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (partner) setConfirmation('');
  }, [partner]);

  const deletePartner = trpc.platform.deletePartner.useMutation();

  if (!partner) return null;

  const headerSlot = (
    <div className="flex items-center gap-3">
      <div className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-[var(--color-urgent-soft)] text-[var(--color-urgent)]">
        <AlertTriangle className="h-5 w-5" />
      </div>
      <div>
        <h2 className="text-[17px] font-semibold tracking-[-0.2px] text-[var(--color-ink)]">{t('delete_permanently')}</h2>
        <p className="mt-1 text-[13px] text-[var(--color-ink-soft)]">
          {t('confirm_remove_partner').replace('{name}', partner.name)}
        </p>
      </div>
    </div>
  );

  return (
    <FormModal
      open={!!partner}
      onClose={onClose}
      headerSlot={headerSlot}
      mutation={deletePartner}
      onSubmit={() => (confirmation === partner.name ? partner.id : null)}
      submitLabel={t('delete_permanently')}
      submitVariant="danger"
      invalidate={() => utils.platform.listPartners.invalidate()}
      maxWidth={440}
      dismissOnBackdrop={false}
      id="delete-partner"
    >
      <FormModal.TypedConfirm
        matchValue={partner.name}
        label={t('display_name')}
        onChange={setConfirmation}
      />
    </FormModal>
  );
}
```

- [ ] **Step 3: Run the existing per-modal tests, expect pass**

Run: `docker compose exec client npm test -- platform/__tests__/DeletePartnerModal.test.tsx --run`
Expected: PASS — typed-confirm gating preserved; danger button preserved; mutation called with the partner id only when confirmation matches.

- [ ] **Step 4: Commit**

```bash
git add client/src/components/platform/DeletePartnerModal.tsx
git commit -m "refactor(ui): DeletePartnerModal uses FormModal + TypedConfirm"
```

---

### Task 9: Migrate `EditPartnerModal` (preserve prop→state hydration + AI features)

**Files:**
- Modify: `client/src/components/platform/EditPartnerModal.tsx`

- [ ] **Step 1: Read the current file**

Run: `Read client/src/components/platform/EditPartnerModal.tsx`. Note: 189 LOC; heavy form with AI features section, Toggle component, BOOLEAN_FEATURES + IMPROVEMENT_OPTIONS constants, prop→state hydration via useEffect.

- [ ] **Step 2: Migrate the scaffolding only — keep all form/AI logic**

The scaffolding to remove:
- `import Toast`, `import Modal, { ModalHeader, ModalBody, ModalFooter }`, `import Button`
- Local FIELD_LABEL / INPUT / SECTION_LABEL constants (FIELD_LABEL and INPUT come from FormModal; SECTION_LABEL stays as it's a different concern)
- `useState<{message,type}>` toast slot + `showError` callback
- `useMutation({ onSuccess, onError })` callbacks (FormModal owns this)
- `<Toast>` rendered alongside Modal
- The `<Modal>` + `<ModalHeader>` + `<ModalBody>` + `<ModalFooter>` + Cancel/Save Buttons — replaced by `<FormModal>`

The scaffolding to keep:
- The Toggle component (private to this file)
- BOOLEAN_FEATURES, IMPROVEMENT_OPTIONS constants
- SECTION_LABEL constant
- The form state and prop→state hydration useEffect
- The toggleFeature function
- All field render logic in the modal body

Replace the imports + structure. Keep the Toggle and constants. The render becomes:

```tsx
return (
  <FormModal
    open={!!partner}
    onClose={onClose}
    title={form.name || partner.name}
    subtitle={partner.industry || undefined}
    mutation={updatePartner}
    onSubmit={() => ({ id: partner.id, data: { name: form.name, aiEnabled: form.aiEnabled, aiFeatures: form.aiFeatures } })}
    submitLabel={t('save_profile')}
    invalidate={() => utils.platform.listPartners.invalidate()}
    maxWidth={640}
    id="edit-partner"
  >
    {/* The existing ModalBody contents go here, wrapped in the same overflow div */}
    <div className="max-h-[70vh] overflow-y-auto">
      <div className="space-y-6">
        {/* ... existing form fields and AI section ... */}
      </div>
    </div>
  </FormModal>
);
```

Add `import FormModal, { FIELD_LABEL, INPUT } from '../ui/FormModal';` and remove the local FIELD_LABEL / INPUT declarations.

- [ ] **Step 3: Run the existing per-modal tests, expect pass**

Run: `docker compose exec client npm test -- platform/__tests__/EditPartnerModal.test.tsx --run`
Expected: PASS — form behavior preserved.

- [ ] **Step 4: Commit**

```bash
git add client/src/components/platform/EditPartnerModal.tsx
git commit -m "refactor(ui): EditPartnerModal mounts through FormModal (form state preserved)"
```

---

### Task 10: Migrate `EditUserProfileModal`

**Files:**
- Modify: `client/src/components/platform/EditUserProfileModal.tsx`

- [ ] **Step 1: Read the current file**

Run: `Read client/src/components/platform/EditUserProfileModal.tsx`. Note: 70 LOC; simple two-field form with prop→state hydration.

- [ ] **Step 2: Rewrite using FormModal**

Replace the entire file with:

```tsx
import { useState, useEffect } from 'react';
import { trpc } from '../../utils/trpc';
import { useT } from '../../i18n';
import FormModal, { FIELD_LABEL, INPUT } from '../ui/FormModal';
import type { GlobalUser } from './types';

interface EditUserProfileModalProps {
  user: GlobalUser | null;
  onClose: () => void;
}

export default function EditUserProfileModal({ user, onClose }: EditUserProfileModalProps) {
  const t = useT();
  const utils = trpc.useUtils();
  const [form, setForm] = useState({ name: '', email: '' });

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (user) setForm({ name: user.name, email: user.email ?? '' });
  }, [user]);

  const updateUser = trpc.platform.updateUser.useMutation();

  if (!user) return null;

  return (
    <FormModal
      open={!!user}
      onClose={onClose}
      title={t('edit_profile')}
      subtitle={user.name}
      mutation={updateUser}
      onSubmit={() => ({ id: user.id, data: { name: form.name, email: form.email || undefined } })}
      submitLabel={t('save_profile')}
      invalidate={() => utils.platform.listGlobalUsers.invalidate()}
      maxWidth={440}
      id="edit-user-profile"
    >
      <div className="space-y-4">
        <div>
          <label className={FIELD_LABEL}>{t('col_name')}</label>
          <input type="text" className={INPUT} value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} />
        </div>
        <div>
          <label className={FIELD_LABEL}>{t('email_label')}</label>
          <input type="email" className={INPUT} value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} />
        </div>
      </div>
    </FormModal>
  );
}
```

- [ ] **Step 3: Run the existing per-modal tests, expect pass**

Run: `docker compose exec client npm test -- platform/__tests__/EditUserProfileModal.test.tsx --run`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add client/src/components/platform/EditUserProfileModal.tsx
git commit -m "refactor(ui): EditUserProfileModal mounts through FormModal"
```

---

### Task 11: Migrate `InviteUserModal` (form path only; result screen stays bespoke)

**Files:**
- Modify: `client/src/components/platform/InviteUserModal.tsx`

- [ ] **Step 1: Read the current file**

Run: `Read client/src/components/platform/InviteUserModal.tsx`. Note: 151 LOC; form path + post-success result screen rendered as a separate `<Modal>` when `result` state is non-null. Has bespoke per-error-type message handling.

- [ ] **Step 2: Migrate the form path through FormModal; keep the result screen as a separate Modal**

The result screen is a **different modal** that conditionally replaces the form. After this migration:
- The form path (when `result === null`) renders through `<FormModal>`.
- The result path (when `result !== null`) renders the existing `<Modal>` directly — unchanged.

The bespoke error-message handling moves: today it lives in the `onError` callback of `useMutation`. After migration, FormModal owns the toast — but the per-error-type translation must happen somewhere. Two options:
- **Option A (simpler):** Move the error-type→message logic to a `useEffect` that watches `inviteUser.error` and sets a local `error` state to display below the form (today's `<p>` rendering of `error` stays).
- **Option B (defer):** Drop the per-type translation; let FormModal show the raw `err.message` via toast. May regress UX.

Pick **Option A** — preserve the per-error-type translation. The local `error` state stays; FormModal's automatic toast is suppressed by clearing `mutation.error` via a ref-based wrapper, OR — simpler — by leaving the bespoke error-state path AND letting FormModal render the toast on top of it. They show the same message; the toast is acceptable as redundant feedback.

Actual minimal change: keep the existing error state AND let FormModal render its toast on top. The toast is auto-dismissed in 4s; the inline `<p>` persists.

Replace the form-path render:

```tsx
return (
  <FormModal
    open={open}
    onClose={() => { onClose(); setError(''); }}
    title={t('invite_new_user')}
    mutation={inviteUser}
    onSubmit={() => {
      if (!form.email || !isValidEmail(form.email) || !form.name) return null;
      if (!form.partnerId && form.role !== 'platform_operator') return null;
      return {
        email: form.email, name: form.name, role: form.role, partnerId: form.partnerId,
        departments: form.dept ? [form.dept] : undefined,
      };
    }}
    submitLabel={t('invite_new_user')}
    invalidate={() => utils.platform.listGlobalUsers.invalidate()}
    disabled={!form.email || !isValidEmail(form.email) || !form.name || (!form.partnerId && form.role !== 'platform_operator')}
    maxWidth={560}
    id="invite-user"
  >
    <div className="space-y-4">
      {/* ...existing fields verbatim... */}
      {error && <p className="text-[12px] text-[var(--color-urgent)]">{error}</p>}
    </div>
  </FormModal>
);
```

The `result` path (returned earlier when `result !== null`) is left untouched.

The custom invite-success behavior — "set result, invalidate, close" — was previously orchestrated in `onSuccess`. After migration, FormModal calls `invalidate()` and `onClose()` for us. We need `setResult({...})` to also fire on success. Use the `invalidate` prop's escape: pass a function that does both invalidate + setResult. The result modal will then render the next paint because `result` is non-null.

```tsx
invalidate={() => {
  utils.platform.listGlobalUsers.invalidate();
  // We need the partner name from the current data snapshot.
  const currentPartners = utils.platform.listPartners.getData();
  const partnerName = currentPartners?.find(p => p.id === form.partnerId)?.name || form.partnerId;
  // We don't have access to the mutation's data here — use the form's intent.
  // The current onSuccess used `data.isExistingUser` which we cannot read at invalidate-time.
}}
```

This is the wrinkle: today's onSuccess reads the mutation's `data.isExistingUser`. FormModal's `invalidate` doesn't expose mutation data.

**Pick:** Add an optional `onSuccess?: (data: TOutput) => void` prop to FormModal (typed via a second generic), called BEFORE `invalidate` and `onClose`. This is the minimal extension that preserves InviteUserModal's behavior without forcing it to stay bespoke.

Update `FormModalProps`:

```tsx
export interface MutationLike<TInput, TOutput = unknown> {
  mutate: (input: TInput) => void;
  isPending: boolean;
  isSuccess?: boolean;
  data?: TOutput;
  error?: { message: string } | null;
  reset?: () => void;
}

export interface FormModalProps<TInput, TOutput = unknown> {
  // ...existing props...
  onSuccessData?: (data: TOutput) => void;
  // ...
}
```

And in the success effect:

```tsx
useEffect(() => {
  if (mutation.isSuccess) {
    if (onSuccessData && mutation.data !== undefined) onSuccessData(mutation.data);
    invalidate?.();
    onClose();
    mutation.reset?.();
  }
}, [mutation.isSuccess]);
```

Add a test for `onSuccessData` in `FormModal.test.tsx`:

```tsx
it('calls onSuccessData with mutation.data before invalidate', () => {
  const order: string[] = [];
  const onSuccessData = vi.fn(() => order.push('onSuccessData'));
  const invalidate = vi.fn(() => order.push('invalidate'));
  const onClose = vi.fn(() => order.push('onClose'));
  const m = makeMutationMock({ isSuccess: true });
  m.data = { foo: 'bar' };
  render(
    <FormModal
      open={true} onClose={onClose} title="X" mutation={m}
      onSubmit={() => ({})} submitLabel="Save"
      invalidate={invalidate} onSuccessData={onSuccessData}
    >
      <span />
    </FormModal>
  );
  expect(order).toEqual(['onSuccessData', 'invalidate', 'onClose']);
  expect(onSuccessData).toHaveBeenCalledWith({ foo: 'bar' });
});
```

Update `makeMutationMock` to accept `data` overrides (extend the interface).

InviteUserModal's `invalidate` becomes:

```tsx
onSuccessData={(data: { isExistingUser: boolean }) => {
  const currentPartners = utils.platform.listPartners.getData();
  const partnerName = currentPartners?.find(p => p.id === form.partnerId)?.name || form.partnerId;
  setResult({ isExistingUser: data.isExistingUser, partnerName });
  setForm({ email: '', name: '', role: 'support', partnerId: '', dept: '' });
}}
invalidate={() => utils.platform.listGlobalUsers.invalidate()}
```

Note: today's onSuccess also calls `onClose()`. After migration, FormModal calls `onClose` itself. The result Modal then shows because `result` is set in `onSuccessData` (which fires before `onClose`). But once `open=false`, the form Modal unmounts and the result Modal mounts. The behavior is preserved.

The bespoke error onError handler (which sets the local `error` state) stays as a hand-rolled `useEffect` on `inviteUser.error`:

```tsx
useEffect(() => {
  if (!inviteUser.error) { setError(''); return; }
  const msg = inviteUser.error.message;
  if (msg.includes('email') || msg.includes('Email') || msg.includes('invalid_string')) {
    setError(t('invalid_email_error'));
  } else if (msg.includes('CONFLICT') || msg.includes('already')) {
    setError(t('email_already_exists_error'));
  } else {
    setError(msg || t('general_error'));
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, [inviteUser.error?.message]);
```

- [ ] **Step 3: Run the existing per-modal tests, expect pass**

Run: `docker compose exec client npm test -- platform/__tests__/InviteUserModal.test.tsx --run`
Expected: PASS — form path + result-screen path preserved.

- [ ] **Step 4: Run all FormModal tests, expect pass**

Run: `docker compose exec client npm test -- ui/__tests__/FormModal --run`
Expected: PASS — including the new `onSuccessData` case.

- [ ] **Step 5: Commit**

```bash
git add client/src/components/ui/FormModal.tsx client/src/components/ui/__tests__/FormModal.test.tsx client/src/test/helpers.tsx client/src/components/platform/InviteUserModal.tsx
git commit -m "refactor(ui): InviteUserModal form path uses FormModal (result screen stays bespoke)"
```

---

### Task 12: CHANGELOG entry

**Files:**
- Modify: `CHANGELOG.md`

- [ ] **Step 1: Add the Unreleased entry**

In `CHANGELOG.md`, append a new bullet under the `### Added` of the Unreleased section (or create the section if not present):

```markdown
- **Bundle C slice 1 — `<FormModal>` primitive + 5 platform-modal migrations** (issue #76) — new `client/src/components/ui/FormModal.tsx` owns the modal scaffold, the FIELD_LABEL/INPUT Tailwind constants, and the submit lifecycle (pending disables submit; error renders a Toast; success calls `invalidate?.()` then `onClose()` then `mutation.reset()`). Static `FormModal.TypedConfirm` sub-component covers the destructive-typed-name pattern. The five platform modals (`CreatePartnerModal`, `DeletePartnerModal`, `EditPartnerModal`, `EditUserProfileModal`, `InviteUserModal`) now mount through it; per-modal scaffolding deleted. Per-modal test files retained for behavioral parity through the migration. Unblocks slice #77 (Message scaffold + lazy fragments).
```

- [ ] **Step 2: Commit**

```bash
git add CHANGELOG.md
git commit -m "docs: changelog entry for Bundle C slice 1 (FormModal primitive)"
```

---

### Task 13: Run local CI

**Files:**
- None (verification only)

- [ ] **Step 1: Run scripts/ci.ps1**

Run: `powershell -File scripts/ci.ps1`

Expected: ALL GREEN
- typecheck: ✓
- test-client: ✓ (FormModal + TypedConfirm + 5 per-modal suites pass)
- test-server: ✓ (no server changes)
- migrate: ✓ (no schema changes)
- e2e: ✓ — chat / platform Playwright specs pass unchanged. If any platform-modal E2E spec breaks, it indicates a behavioral regression in the migration; investigate before merging.

- [ ] **Step 2: Open the PR**

```bash
git push -u origin feat/bundle-c-slice-1-formmodal
gh pr create --title "feat(ui): Bundle C slice 1 — FormModal primitive + migrate 5 platform modals" --body "$(cat <<'EOF'
Closes #76 · Parent #75 · RFC #64

## Summary
- New `<FormModal>` primitive at `client/src/components/ui/FormModal.tsx` owns modal scaffold + FIELD_LABEL/INPUT constants + submit lifecycle (pending → disabled, error → toast, success → `invalidate?.()` → `onClose()` → `mutation.reset()`).
- Static `FormModal.TypedConfirm` sub-component for the destructive-typed-name pattern.
- All five platform modals migrated: CreatePartnerModal, DeletePartnerModal (TypedConfirm + danger + dismissOnBackdrop=false), EditPartnerModal, EditUserProfileModal, InviteUserModal (form path migrated; post-success result screen stays bespoke).
- Per-modal test files retained for behavioral parity through the migration.
- Two new boundary test files: `FormModal.test.tsx` (lifecycle, variants, headerSlot, onSuccessData) and `FormModal.TypedConfirm.test.tsx`.

## What this PR does NOT do
- Does not consolidate `PlatformView`'s six modal-coordination useState slots — slot drilling is the symptom, scaffolding was the disease, per PRD scope.
- Does not delete per-modal test files — kept for parity through the migration; future cleanup pass.
- Does not migrate `ManageAccessModal` or `GroupMappingsPanel` — not in the 5-modal scope (per PRD).
- Does not wire `<ToastProvider>` into App — out of scope; FormModal uses local toast state mirroring the current per-modal pattern.

## Test plan
- [x] `docker compose exec client npx tsc --noEmit -p .` — 0 errors
- [x] `docker compose exec client npm test` — all client suites pass (new FormModal + TypedConfirm + per-modal suites)
- [x] `docker compose exec server npm test` — server unchanged
- [x] Platform-modal E2E specs pass unchanged
- [x] Manual smoke: open each of the 5 modals, exercise success + error paths, confirm Toast renders + invalidate fires + modal closes

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## Self-Review Checklist (run before declaring plan complete)

**1. Spec coverage** — every issue #76 acceptance row has a task:

| Acceptance criterion | Task |
|---|---|
| `FormModal.tsx` exists; exports default + TypedConfirm + FIELD_LABEL + INPUT | Tasks 1, 6 |
| Props match RFC interface (open, onClose, title, mutation, onSubmit, submitLabel, invalidate, submitVariant, maxWidth, subtitle, disabled, children, renderFooter) | Tasks 1, 5 (note: `renderFooter` deliberately not implemented per PRD; `headerSlot` substituted, `onSuccessData` added in Task 11) |
| Lifecycle wired via useEffect on isSuccess + error; reset called after handling | Tasks 3, 4 |
| TypedConfirm renders labeled input bound to matchValue, calls onChange | Task 6 |
| FormModal.test.tsx covers full lifecycle | Tasks 2-5, 11 |
| TypedConfirm.test.tsx covers gate logic | Task 6 |
| 5 platform modals migrated | Tasks 7-11 |
| Per-modal test files NOT deleted | (D9, no task — explicitly preserved) |
| No render-only smoke tests | (Convention — all new tests are behavioral) |
| CHANGELOG entry | Task 12 |
| `scripts/ci.ps1` passes | Task 13 |
| Theme parity (.dark + monochrome + dyslexic) | (Token usage check at code review — no hex literals in FormModal) |

**2. Placeholder scan** — no "TBD", no "implement later", no "similar to Task N", no generic "add error handling" — all code shown inline.

**3. Type consistency** — `MutationLike<TInput, TOutput>`, `FormModalProps<TInput, TOutput>`, `TypedConfirmProps`, `makeMutationMock` overrides all consistent across Task 1, Task 3, Task 6, Task 11.

**4. Open scope items surfaced (not silenced):**
- `renderFooter` in the RFC was an escape hatch for wizards. PRD treated it as a code smell; this slice does not implement it. InviteUserModal's post-success result screen uses a sibling Modal instead.
- The 5 per-modal test files are NOT deleted; they're kept as a parity safety net during slice 1. Future cleanup may revisit.
- ManageAccessModal and GroupMappingsPanel are explicitly out of scope (PRD).
- `headerSlot` is added beyond the RFC's interface (which only had `subtitle`); needed for DeletePartnerModal's AlertTriangle layout. Documented in D6.
- `onSuccessData` callback is added beyond the RFC; needed for InviteUserModal's data-dependent result-screen logic. Documented in Task 11.

---

## End

Slice 1 ships: 5 platform modals lose their scaffolding; FormModal owns the lifecycle once. Slice #77 (Message scaffold + lazy fragments) can start as soon as this merges.
