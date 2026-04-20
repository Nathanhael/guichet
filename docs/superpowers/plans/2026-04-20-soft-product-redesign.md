# Soft Product Redesign — Plan

**Goal:** migrate the Guichet UI from the brutalist design system to the "Soft Product" direction defined in [`docs/SOFT_PRODUCT_DESIGN_SPEC.md`](../../SOFT_PRODUCT_DESIGN_SPEC.md). Source of truth for the target look is the prototype at `D:/Projects_Coding/design_handoff_chat_redesign/`.

**Scope:** all views (Support, Admin, Platform, Agent, Login). Global token layer → components cascade.

**Decisions made with user (2026-04-20):**

- Accent: **indigo** (fixed for v1). Per-user / per-partner accent picker deferred to a follow-up.
- Bubble shape: **tailed** (default, not exposed as a user preference).
- Avatar shape: **round** (default, not exposed as a user preference).
- No Tweaks panel — prototype-only.
- Keep accessibility modes (dark, dyslexic, monochrome, reduced-motion). Re-derive them on the new tokens.
- Keep JetBrains Mono but scope it strictly to code blocks / inline code / ticket IDs. Inter everywhere else.
- Delete `docs/BRUTALIST_DESIGN_SPEC.md`; replace with `docs/SOFT_PRODUCT_DESIGN_SPEC.md`.
- Flip the brutalist mandates section in `CLAUDE.md` to soft-product mandates.
- Phase by layer. Each phase = own commit. Check in with user before advancing.
- Future: add ESLint rule banning hex literals in `client/src/**/*.tsx` once migration settles.

## Phasing

### Phase 1 — Foundation (tokens, fonts, docs)

**Intent:** swap the design system's spine. No component code changes yet — just the variables they read. Some components will look broken at the end of this phase, that's expected.

**Files:**
- `client/src/index.css` — replace palette, add radii / shadow tokens, retire brutalist `@utility` blocks, add keyframes (`v2p-slide-in`, `v2p-fade`, `v2p-pop`, `v2p-pulse`, `v2p-dot`), re-derive `.monochrome-mode` + `.dyslexic-mode` against new palette.
- `docs/SOFT_PRODUCT_DESIGN_SPEC.md` — written (this plan step).
- `docs/BRUTALIST_DESIGN_SPEC.md` — delete.
- `CLAUDE.md` — update: replace `### Aesthetics` block in client section, replace `## Critical Mandates` brutalist bullets, update spec doc path reference.

**Exit check:** `docker compose exec client npm run build` succeeds; screen loads (even if styling is regressed); `npm run test-client` still passes.

### Phase 2 — Shared primitives

**Intent:** build the reusable vocabulary every other phase consumes. No in-place component edits yet — introduce primitives alongside existing code, then migrate in later phases.

**Files (new):** `client/src/components/ui/`
- `Button.tsx` — primary / secondary / danger variants, size prop, icon slot.
- `Card.tsx` — surface panel with shadow + radius.
- `Pill.tsx` — tone prop (`accent` / `urgent` / `ok` / `muted` / `whisper`), removable variant.
- `Modal.tsx` — scrim + card + animated enter, composable header/body/footer.
- `Avatar.tsx` — size + shape (`round` default) + initials from name + color hash.
- `Toast.tsx` + `ToastProvider.tsx` — stacked bottom-right, auto-dismiss, tone dot.
- `SectionLabel.tsx` — uppercase section header helper.
- `index.ts` — barrel.

**Exit check:** Typecheck + client tests pass. Primitives not yet consumed.

### Phase 3 — Chat workspace (Support view)

**Intent:** the central user journey. Port queue, chat thread, context panel, SLA banner, compose, modals to primitives + new tokens.

**Files (expected — order):**
1. `client/src/components/chat/ChatHeader.tsx` — avatar + name + status + SLA + labels + action buttons (Transfer/Resolve/context toggle).
2. `client/src/components/chat/MessageBubble.tsx` — tailed shape; self vs other; whisper variant.
3. `client/src/components/chat/MessageList.tsx` — date pill, slide-in on new, typing indicator integration.
4. `client/src/components/chat/ComposeArea.tsx` + `FormatToolbar.tsx` — boxed compose, whisper mode swaps border + bg + header strip.
5. `client/src/components/chat/ChatWindow.tsx` — shell layout / paddings.
6. `client/src/components/chat/LabelPicker.tsx` — popover styling.
7. `client/src/components/chat/QuoteBlock.tsx` / `LinkPreviewCard.tsx` / `AttachmentGrid.tsx` / `DeliveryStatus.tsx` — restyle against tokens.
8. `client/src/components/support/QueueSidebar.tsx` — tabs (count chip), SLA-risk + pulse-on-unread rows, active/hover states.
9. `client/src/components/support/CustomerInfoPanel.tsx` — section headers (uppercase), rows, assignments, labels, recent tickets.
10. `client/src/components/ConfirmDialog.tsx` — migrate to `<Modal>`. Resolve / Transfer confirm flows.
11. `client/src/components/Toast.tsx` — migrate to primitive.

**Exit check:** Manual verify in browser (dev server): queue → pick ticket → send message → whisper → transfer → resolve → toast. Light + dark + monochrome + dyslexic all render.

### Phase 4 — Navigation chrome

**Files:**
- `client/src/components/support/SupportNav.tsx`
- `client/src/components/agent/AgentNav.tsx`
- Top-level shell for `AdminView` / `PlatformView` tab rails
- `client/src/components/UserMenu.tsx` — avatar styling
- `client/src/components/SettingsPopover.tsx` — radii + shadow
- `client/src/components/PartnerSwitcher.tsx` — pill + menu

**Exit check:** Top bar + tabs match spec across all four views.

### Phase 5 — Admin panels (bulk)

**Files:** `client/src/components/admin/*.tsx` — AdminAlerts, AdminArchive, AdminBusinessHours, AdminCannedResponses, AdminDepartments, AdminFeedback, AdminKnowledgeBase, AdminLabels, AdminSatisfaction, AdminStats, AdminTeam, AdminTickets, AdminWebhooks, AgentStatusStats, PlatformAuditLog, PlatformArchiveViewer, PlatformSystemHealth, etc.

Mostly tabular/listy panels — swap buttons, inputs, cards, pills to primitives. Expect mechanical but wide.

**Exit check:** Every admin tab renders; no inline colors remain.

### Phase 6 — Platform / Agent / Login views

**Files:**
- `client/src/components/platform/*.tsx` — PartnerList, UserTable, CreatePartnerModal, EditPartnerModal, DeletePartnerModal, GroupMappingsPanel, InviteUserModal, ManageAccessModal, EditUserProfileModal.
- `client/src/components/agent/*.tsx` — AgentTicketSidebar, TicketForm.
- `client/src/views/LoginView.tsx` — SSO button + dev-login picker.

**Exit check:** All four views exhibit consistent soft-product styling.

### Phase 7 — Accessibility polish

**Intent:** verify monochrome and dyslexic modes render correctly against new tokens. Adjust `index.css` variable overrides if any contrast/legibility issues surface.

**Files:** `client/src/index.css` (mode overrides only), plus any component tweak discovered.

**Exit check:** All four modes (default, dark, monochrome, dyslexic) look intentional in the chat workspace. Manual walkthrough.

### Phase 8 — Cleanup

**Intent:** remove anything the brutalist era left behind.

**Files:**
- `client/src/index.css` — remove any unused utilities, mono-overused classes (`.mono-label`, `.badge`, `.section-header`, etc. if not replaced).
- Delete unused brutalist-era inline styling patterns in components the earlier phases didn't touch.
- Delete `docs/BRUTALIST_DESIGN_SPEC.md` (confirmed in phase 1 but double-check).
- Scan for remaining `text-transform: uppercase` / `font-mono` + `uppercase` combos that were brutalist chrome.

**Exit check:** Repo-wide grep for `brutalist` returns only this plan doc + CHANGELOG + tests if any. `docker compose exec client npm run build` clean. E2E (`powershell scripts/ci.ps1 -Skip e2e` for dev loop; full pass once) green.

## Keeping future features on-spec

Covered in [`SOFT_PRODUCT_DESIGN_SPEC.md` § Mandates](../../SOFT_PRODUCT_DESIGN_SPEC.md#mandates-for-new-features). Summary:

1. Tokens only — no hex literals in components.
2. Compose from `components/ui/` primitives — don't hand-roll.
3. Inter for prose; JetBrains Mono only for code / IDs / inline code.
4. Motion whitelist — use documented keyframes only; respect `prefers-reduced-motion`.
5. Theme parity — test dark + default; monochrome + dyslexic should inherit for free.
6. Follow-up (post-migration): add ESLint rule banning hex in `client/src/**/*.tsx`.

## Risks

- **Cascade of mismatched chrome** between phases. Mitigation: phase order is bottom-up (tokens → primitives → workspace → periphery). Each phase is shippable on its own — nothing user-facing is broken by landing phase N without N+1.
- **Component test fallout.** Render-only tests that snapshot DOM may churn. Tests that assert behavior should be stable. Fix tests per phase as encountered.
- **Brutalist-style assumptions embedded deep in custom components** (e.g. uppercase labels assumed by tests). Grep + replace in the phase that touches the component.
- **Admin panels are long-tail and under-used.** Risk of missed stragglers. Phase 8 catches them.

## Out of scope

- Per-user / per-partner accent picker — future enhancement.
- Additional accent palette entries (teal / violet / amber / rose / etc.) — future.
- High-contrast mode, text-scale multiplier — future.
- Any behavioral/UX change beyond styling. If you notice a UX improvement opportunity, flag it for a separate task.
- Backend schema, routing, tRPC — no server changes.

## Check-in cadence

At the end of each phase, summarize for the user:
- What shipped
- Screenshots / preview evidence where visible
- Any deviations from the spec + why
- Anything deferred

Then wait for "go phase N+1" before proceeding.
