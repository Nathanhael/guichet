# Plan — Visibly disable destructive admin actions for guest users

**Date:** 2026-04-17
**Status:** Draft — awaiting review
**Author:** Claude (drafted with Bart)
**Parent work:** [2026-04-16-partner-sso-b2b-guest.md](./2026-04-16-partner-sso-b2b-guest.md)

## Goal

Today a guest admin sees a fully functional AdminView. They click "Save
webhook", "Remove member", or "Save departments" and the server responds
with `FORBIDDEN — This action is not available to external guest users.`
The toast lands, but the user just wasted a click. Worse: form state
they typed in is still dirty, and the failure mode teaches them nothing
about *why* the rest of the pane is for display only.

Fix: surface the constraint at the UI layer. When the current user has
`isExternal === true`, destructive controls render in a disabled state
with a hover tooltip explaining *why*, and forms don't accept keystrokes
for fields that feed those controls.

This is purely UX polish. The backend block stays the source of truth;
the visible disable is defense-in-depth plus user experience.

## Scope

### In

1. A thin client-side helper — `useIsExternalAdmin()` — that returns
   whether the current user (`trpc.user.me`) is an Azure B2B guest.
   Backed by React Query cache, so the 10+ components that call it
   share one fetch.

2. A brutalist **disabled-with-tooltip** treatment, applied uniformly.
   Two primitives:
   - `<ExternalGuestGuard>` — render-prop / children wrapper that
     takes the same tree and returns it with `aria-disabled`, a
     native `title` tooltip, and pointer-events swallowed when the
     viewer is external. Keeps styling token-based so the brutalist
     look (reduced opacity, mono italic tooltip) stays consistent.
   - `disabledIfExternal` — a tiny helper for form fields that
     returns `{ disabled, title, 'aria-disabled': true }` props.

3. Target components, mapping to the 10 destructive tRPC procedures
   already gated by `destructiveAdminProcedure`:

   | File | Controls to disable |
   |---|---|
   | `components/admin/AdminWebhooks.tsx` | Create, update, delete, rotate-secret, test buttons + form submit |
   | `components/admin/AdminTeam.tsx` | Invite (`addMemberByEmail`), invite-external, edit-member, remove-member buttons |
   | `components/admin/AdminDepartments.tsx` | Add dept, edit dept, remove dept, save-departments buttons |

4. New i18n keys in `client/src/locales/{en,fr,nl}.ts`:
   - `guest_admin_disabled_tooltip` — "Not available to external guest users. Ask an internal admin to perform this action."
   - `guest_admin_disabled_tooltip_short` — "Unavailable for guests" (for buttons where space is tight).

5. Unit tests:
   - New `components/__tests__/ExternalGuestGuard.test.tsx` — covers
     render-through for internal, disabled-render for guest, tooltip
     text, aria-disabled attribute.
   - `AdminWebhooks.test.tsx`, `AdminTeam.test.tsx`,
     `AdminDepartments.test.tsx` — extend existing tests (or add
     a describe block) that assert destructive buttons are disabled
     when `trpc.user.me` reports `isExternal=true`.

6. One new E2E spec — `testing/e2e/guest-admin-visible-disable.spec.ts`
   — seeds a B2B guest admin, loads AdminView, asserts: webhook create
   button is disabled, tooltip contains the expected key, clicking does
   nothing (no network request, no toast).

7. Runbook update (`partner-sso-b2b-guest.md`): move "Destructive
   buttons are not visibly disabled" from Known Limitations to a
   resolved bullet with a pointer to this plan.

### Out

- No server changes. `destructiveAdminProcedure` stays as-is; the UI
  disable is additive, not a replacement.
- No redesign of the destructive buttons themselves — they keep the
  brutalist solid-fill style, just pick up the `disabled:` token
  variants (reduced opacity, pointer-events-none) that already exist
  on neighbouring components.
- No change to `platform.*` panels. Guests can never reach PlatformView
  because they are never `isPlatformOperator`, so no UI gating needed
  there.
- Feedback tab, Labels, Canned Responses, KB, Alerts/SLA, Business
  Hours, Stats, Archive — guest admins keep full access (read + safe
  writes) and no visible disable is applied.
- i18n of the runbook — stays English-only, consistent with the
  previous B2B ship.

## Tasks (sequenced)

1. **Helper + primitives**
   - `client/src/hooks/useIsExternalAdmin.ts` — wraps
     `trpc.user.me.useQuery({ staleTime: Infinity })` and returns
     `{ isExternal, isLoading }`.
   - `client/src/components/ExternalGuestGuard.tsx` — renders children
     unchanged when `!isExternal`; when `isExternal`, wraps in a
     `<span>` with `aria-disabled`, `title`, `onClick` preventDefault +
     stopPropagation, and a `data-guest-disabled="true"` test hook.
     Token-based styling (opacity via existing `opacity-disabled`
     token; no new CSS).
   - `client/src/utils/guestDisable.ts` — exports
     `disabledIfExternal(isExternal: boolean)` that returns the
     `{ disabled, title, 'aria-disabled': true }` prop bag.

2. **Locales**
   - Add `guest_admin_disabled_tooltip` + `guest_admin_disabled_tooltip_short`
     to en/fr/nl with the three translations.

3. **AdminWebhooks** — swap destructive buttons to be wrapped in
   `<ExternalGuestGuard>` / use `disabledIfExternal` on the form
   submit. The "Regenerate secret" button specifically should not
   reveal the tooltip's detailed text in a way that hints at secret
   rotation being possible — the short tooltip is preferred here.

4. **AdminTeam** — same treatment on invite / remove / edit buttons,
   plus disable the inline role/department edit controls in each row.

5. **AdminDepartments** — same on the add/edit/delete controls and on
   the save-all button for bulk department edits.

6. **Tests**
   - `ExternalGuestGuard.test.tsx` — render + interaction assertions.
   - Existing component tests: add one `it('is disabled for external
     guests')` per destructive button in each of the three admins.
     Use the existing tRPC mocks; override `user.me.useQuery` to
     return `isExternal: true`.
   - E2E spec as described in In/6.

7. **Docs + CHANGELOG**
   - Update runbook §"Known limitations".
   - Add CHANGELOG entry under Unreleased.

## Verification

Definition of done:

- `scripts/ci.ps1` green (typecheck + server + client + migrate + build
  + e2e). E2E flake budget: retry once, treat two consecutive passes
  as green.
- Manual: log in as the seeded B2B-guest admin fixture. Navigate to
  AdminView → Webhooks, Team, Departments. Every destructive control
  shows the disabled style + tooltip on hover. Clicking them produces
  no network request (verify in devtools). Navigate to other tabs —
  everything reachable to a guest admin works unchanged.
- Accessibility: buttons pass `aria-disabled` check; keyboard `Enter`
  on a disabled guard does not trigger the underlying handler.

## Risks / Open questions

- **False sense of security.** Visible-disable makes the backend block
  look like the only layer. A UI-only disable would be a regression
  — `destructiveAdminProcedure` must stay in place. Mitigation: call
  this out in the plan (see also the existing unit test
  `destructiveAdminProcedure.test.ts`).

- **Selective exemptions.** If a future partner requests "our guests
  are trusted — let them manage webhooks", we should expose a
  per-partner flag rather than weaken the global rule. Out of scope
  here; noted as future follow-up.

- **Shared components.** `AdminWebhooks` uses the same button styles
  as `AdminAlerts`, `AdminLabels`, etc. Don't accidentally propagate
  the disable to components that were explicitly left open to guests
  per the parent plan.

## Definition of done

- All Scope-In items shipped.
- `scripts/ci.ps1` green.
- Manual verification matrix above passes.
- CHANGELOG updated under Unreleased.
- Runbook Known-Limitations entry for "Destructive buttons are not
  visibly disabled" moved to a resolved bullet.
