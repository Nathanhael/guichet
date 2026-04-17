# Changelog

All notable changes to Guichet are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Added
- **Partner SSO via Azure B2B guests** — partner employees can now log into Guichet using their own identity (Microsoft, Google, their home Azure tenant, etc.) via Azure B2B guest federation in our tenant. New `users.isExternal` column set from the Azure `acct=1` / `idp` claim at SSO callback. Strict single-partner rule: a guest whose Azure groups resolve to more than one partner is rejected with `sso_error=guest_multi_partner_mapping` and an audit entry (`sso.guest_multi_partner_rejected`, minimal metadata with partnerIds + groupCount). Internal-staff multi-tenant auto-migrate behavior unchanged. Full runbook at `docs/superpowers/specs/partner-sso-b2b-guest.md`.
- **`destructiveAdminProcedure` tRPC middleware** — blocks external guests (`users.isExternal=true`) from 10 mutations that touch secrets, grant/revoke access, or mutate tenant structure: webhook `create/update/regenerateSecret/delete/test`, partner.members `addMemberByEmail/inviteExternalUser/updateMember/removeMember`, and partner.config `updateDepartments`. Platform operators bypass (never external by definition). Read procedures stay open to guest admins. DB lookup per call (JWT does not carry the flag; thread-through deferred).
- **GUEST badge (brutalist, amber)** — rendered next to display names in `UserMenu` (own identity), `AdminTeam` (team rows), `SidebarFooter` (support team panel), and per-message in `MessageBubble`. `ChatHeader` decorates guest participant avatars with an amber ring and appends `(GUEST)` to the hover tooltip. Built from tokens (`accent-amber` outline + mono uppercase), no radius, no shadow. `trpc.user.me` added as the canonical current-user query; `trpc.status.getTeamStatus` batch-enriches with `isExternal` for team-panel rendering. `MessageBubble` is server-authoritative via migration 0006 — `messages.sender_is_external` is denormalized at insert time (sourced from `findSenderInfo` / `findUserName`) and flows through `mapMessageRow` + the client `Message.senderIsExternal`, so guest senders flag correctly even in historical / closed-ticket reviews. `ChatHeader` still resolves participant isExternal from the presence store (offline participants don't get the ring) — threading through `tickets.participants` JSON is deferred.
- **PartnerSwitcher in AgentNav + SupportNav** — mid-session tenant switching for agents and support staff, not just admins. New optional `confirmBeforeSwitch` prop shows a native confirm dialog ("Switch tenant? Open chats and unsaved drafts will be lost.") before mutating the active membership. AdminView behavior unchanged (no confirm).
- **SupportView Tier-1 keyboard shortcuts** — `Ctrl+Enter` (close ticket), `Alt+T` (transfer), `Alt+W` (close chat tab), `Ctrl+/` (toggle whisper), `Esc` (exit focus mode), and `?` (open command palette as help). `Alt+T`/`Alt+W` chosen over `Ctrl+T`/`Ctrl+W` to avoid browser tab conflicts. All bindings go through the existing `useKeyboardShortcuts` hook and `ChatWindowHandle` ref so they stay in sync with the palette's shortcut-hint column.
- **Clickable `Ctrl+K` nav badge** — the decorative `<kbd>` in `SupportNav` is now a button that dispatches a `support:open-palette` window event; `SupportView` listens for it and opens the palette.
- **SupportView Tier-2 keyboard shortcuts** — `Ctrl+1..9` (jump to chat tab N), `Ctrl+F` (message search), `Ctrl+L` / `Alt+L` (label picker), `Ctrl+J` / `Alt+J` (canned responses), `Ctrl+Shift+A` (toggle AI copilot sidebar), `Ctrl+.` (open status picker). Cross-component openings use `window` CustomEvents (`support:open-label-picker`, `support:open-canned-picker`, `support:open-search`, `support:open-status-picker`) to avoid prop-drilling. Palette gains `jump-to-tab-1..3`, `search-messages`, `open-label-picker`, `open-canned`, and `open-status-picker` commands with matching shortcut hints; existing `toggle-sidebar-right` gets a `Ctrl+Shift+A` hint. en/nl/fr locales updated.
- **SupportView Tier-3 keyboard shortcuts** — `Alt+ArrowUp` / `Alt+ArrowDown` cycle through open tabs that have an unread indicator (wrap-around; no-op when nothing is unread), and `Ctrl+Shift+F` toggles focus mode (complements `Esc`, which only exits). Palette `toggle-focus` hint updated to `Ctrl+Shift+F`.
- **Visible-disable for guest admins on destructive controls** — destructive buttons in `AdminTeam`, `AdminDepartments`, and `AdminWebhooks` now render `disabled` + `aria-disabled="true"` + hover tooltip ("Not available to external guest users. Ask an internal admin to perform this action.") when the viewer has `users.isExternal=true`. Stops the wasted-click / confusing-toast behaviour where guests could still trigger mutations that the server would then reject with FORBIDDEN. New `useIsExternalAdmin` hook (reads the store — matches `ChatHeader`/`UserMenu`), `ExternalGuestGuard` wrapper component, and `disabledIfExternal` prop-bag util. Backend `destructiveAdminProcedure` is unchanged and remains the source of truth — the UI disable is additive. New seed fixture `admin_guest` (Gina Guest, `gina@external.test`) drives the E2E spec.

### Tests
- 9 new Vitest cases covering the Tier-1 hotkey bindings and the SupportNav button wiring.
- 11 new Vitest cases covering the Tier-2 key bindings (digit bounds, dual-modifier bindings for L/J, no-Shift guard for Ctrl+A).
- New `testing/e2e/support-shortcuts.spec.ts` verifies Ctrl+K opens the palette, Tier-1 hints are visible, Ctrl+Enter surfaces the close-ticket confirmation, and Tier-2 palette hints render (Ctrl+., Ctrl+Shift+A).
- New `client/src/components/__tests__/ExternalGuestGuard.test.tsx` (7 cases) covers render-through for internal viewers, aria-disabled + tooltip + click/keyboard swallow for guests, short-vs-full tooltip variants, and className passthrough.
- New `testing/e2e/guest-admin-visible-disable.spec.ts` seeds the `admin_guest` fixture, loads AdminView Team + Departments tabs, and asserts destructive controls are `disabled` + `data-guest-disabled="true"` + tooltip-ed for guests but enabled for internal admin Emma (sanity check).

### Removed
- **`partners.auth_method` column + `auth_method` enum** — partners are SSO-only (SSO config lives in env) so the per-partner method is dead data. Platform operators still use local auth, gated by `users.is_platform_operator` — not by any partner flag. Migration `0007_drop_auth_method.sql` drops the column and the enum. The `users.auth_method` text column is kept for legacy rows but is no longer written by any invite flow. Invite flows simplified: all invited users are provisioned without passwords (SSO-only), `renderInviteNew` email template removed (unused). Per-partner UI pickers (`CreatePartnerModal`, `EditPartnerModal`, `InviteUserModal`, `AdminTeam` invite) and the `authMethod !== 'sso'` gate in `platform.addGroupMapping` are gone.

## [4.2.0] - 2026-04-15

### Added
- **SSO-driven locale sync** — UI language is now derived from the Azure Entra `preferredLanguage` claim on every SSO login. Users can still override via the Settings popover; a manual pick silently sets `users.lang_locked = true` so subsequent SSO logins preserve the user's choice. "SYNCED FROM SSO" badge appears in the `LanguageSwitcher` while the lock is off. Backend: new service `server/services/localeSync.ts` with 20 unit tests, BCP 47 → `nl`/`fr`/`en` mapper, per-partner claim-name overrides via `partners.sso_attribute_map` (JSONB, default-null). New tRPC procedures `user.getLocaleInfo` + `user.setLocale`. Audit actions `user.locale.sso_sync` (claim overwrote lang) and `user.locale.changed` (manual pick). Design spec at `docs/superpowers/specs/2026-04-15-sso-locale-sync-design.md`.
- **Guichet rebrand** — full sweep renaming Tessera → Guichet across code, config, docs, cookie names (`guichet_token`, `guichet_refresh`), Docker compose project, Postgres DB name, Grafana dashboard, git remote. Paired rename in the cross-project wiki (42 files moved via `git mv`, history preserved).
- **E2E QA fixtures** — new `support_qa` (DSC+FOT+TEC) and `agent_qa` (no tickets) users in `server/seed.ts`, intentionally kept free of pre-seeded tickets so specs can create their own without tripping the server's 1-ticket-per-agent guard. `QueueTicketRow` now stamps `data-ticket-row` + `data-ticket-variant={"mine"|"queue"|"other"}` on its `<li>` as a stable E2E selector contract.

### Security
- **drizzle-orm SQL injection** ([GHSA-gpj5-g38j-94v9](https://github.com/advisories/GHSA-gpj5-g38j-94v9), CVSS 7.5, HIGH) — bumped 0.45.1 → 0.45.2. SQL identifiers were not escaped correctly in certain query builder paths.
- **nodemailer SMTP command injection** ([GHSA-vvjj-xcjg-gr5g](https://github.com/advisories/GHSA-vvjj-xcjg-gr5g), MODERATE) — bumped 8.0.4 → 8.0.5. CRLF injection via the transport `name` option's `EHLO`/`HELO` exchange.
- **Vite dev server** ([GHSA-v2wj-q39q-566r](https://github.com/advisories/GHSA-v2wj-q39q-566r), [GHSA-p9ff-h696-f583](https://github.com/advisories/GHSA-p9ff-h696-f583), [GHSA-4w7w-66w2-5vf9](https://github.com/advisories/GHSA-4w7w-66w2-5vf9), HIGH) — bumped 8.0.1 → 8.0.8. Three advisories: path traversal in `.map` handling, `server.fs.deny` bypass via query parameters, arbitrary file read via WebSocket.
- All three fixes are patch-level bumps within the existing caret ranges — only `package-lock.json` changed, not `package.json`.
- **Remaining moderate findings accepted** — 4 moderate advisories traced to `drizzle-kit` → `@esbuild-kit/esm-loader` → bundled `esbuild <=0.24.2` ([GHSA-67mh-4wv8-2f99](https://github.com/advisories/GHSA-67mh-4wv8-2f99)) are documented as accepted risk in `SECURITY.md`. `@esbuild-kit/*` is deprecated, the latest stable `drizzle-kit` (0.31.10) still depends on it, and the advisory requires esbuild's dev server to be running — `drizzle-kit` only ever invokes esbuild's bundler API via its CLI, so the attack surface is inert in Guichet's usage.

### Fixed
- **Rolldown production build panic** — `client/src/constants.ts` previously held `LANG_LABEL` with `\u{1F1E7}\u{1F1EA}` flag codepoints. Rolldown's `hash_placeholder.rs:56` slices chunk source by byte offset without char-boundary checks and panicked mid-codepoint on the regional-indicator bytes. Replaced the flag labels with plain `NL`/`FR`/`EN`; removed the unused `LANG_FLAG` constant. `npm run build` now succeeds.
- **Seed: 1-ticket-per-agent rule and FK violations** — `server/seed.ts` inserted two tickets per agent (violating the server-enforced rule at `socket/handlers/ticket.ts:98`) and referenced `agent_walkup_*` user IDs that were never inserted (FK crash mid-seed). Fix: added 4 new agent rows so each of the 6 fixture tickets has a distinct `agentId`. Seed now succeeds end-to-end.

### Tests
- **E2E suite restoration round 2 — 60 → 94 passing, 0 failed.** A later seed cleanup (between the 2026-04-10 round-1 restoration and this release) removed the `expert_alex`, `expert_piet`, `support_jan`, `support_thomas`, `admin_dirk`, `agent_jan`, `e2e-agent-a`, and `e2e-support-a` fixtures that round 1 had added, without touching the specs that hardcoded them. Every affected test either silently skipped under `test.skip(!loginOk, ...)` (drift invisible to CI green) or false-positive passed against the login page (no login-success guard in `agent-view.spec.ts` / `admin-view.spec.ts`). Swept across 9 specs — `ai-features`, `status-and-transfer`, `view-modes`, `collision-detection`, `support-view`, `chat-flow`, `chat-demo`, `push-and-idle`, `agent-view`, `admin-view` — mapping defunct IDs to current seed users (`agent_julie`, `support_lucas`/`support_sophie`, `admin_emma`, `support_qa`/`agent_qa`). Plus UI-relocation drift: `NotificationToggle` and `ViewModeDropdown` moved into `SettingsPopover`/`ChatTabBar` so specs now open the gear popover or open a ticket first. Captured in `wiki/learnings/guichet-e2e-suite-restoration-round2.md` and `wiki/patterns/e2e-skip-as-silent-failure.md` (cross-project anti-pattern).
- Final local CI (`scripts/ci.ps1 -Skip audit`): 6/6 steps pass; 94 E2E passed / 33 skipped (all conditional — env-gated demos, feature flags, state-dependent fan-outs) / 0 failed.

### Migration notes
- **Locale sync first-run caveat** — on the first SSO login after this release, users whose `users.lang` was set manually in a prior session will have it overwritten by the claim (`lang_locked` defaults to `false` on all existing rows). One-click recovery: the user re-picks in the Settings popover, which locks the choice permanently.
- **Cookie rename** — `tessera_token` / `tessera_refresh` → `guichet_token` / `guichet_refresh`. All active sessions are invalidated; users must re-login.
- **Postgres DB name** — config now points at `guichet`. Recreate the database or run `ALTER DATABASE tessera RENAME TO guichet;` before `docker compose up`.
- **Docker client container restart required after `npm ci`** — Vite's HMR chunk cache can serve stale dynamic-import manifests after a package-lock update, which surfaces in E2E as `TypeError: Failed to fetch dynamically imported module: AdminView.tsx`. Always `docker compose restart client` after updating the client container's dependencies.

## [4.1.0] - 2026-04-11

### Added
- **Tiptap WYSIWYG compose editor** — `<textarea>` replaced with a `@tiptap/react` editor that renders bold/italic/strikethrough/code/blockquote/bullet list inline as you type. Markdown input rules preserved (typing `**bold**` still auto-converts). Serialized via `tiptap-markdown` so the on-disk format is unchanged. New `useComposeEditor` hook centralizes Tiptap setup. New `useComposeEditor.ts`, reworked `FormatToolbar.tsx` + `ComposeArea.tsx`, `.ProseMirror` styles in `index.css`. Plan at `docs/superpowers/plans/compose-wysiwyg-tiptap-migration.md`.
- **Strikethrough formatting** — 6th format toolbar button (`~~text~~`), already supported by the existing markdown sanitizer's `del` tag.
- **Drag & drop file upload** — compose box accepts dragged files; drop overlay shows during active drag; pipes into the same `addFiles()` pipeline as the file input and paste.
- **Drafts auto-save** — 400ms-debounced `sessionStorage` per `(user, ticket, mode)` tuple. Whisper drafts stay separate from regular drafts. Cleared on successful send.
- **Character counter** — appears past 3500 chars, muted → amber at 4500 → red at 5000 (server Zod cap).
- **Reconnect queue for compose** — sending during a transient socket disconnect no longer hard-rejects. The emit is queued and fires when the socket reconnects; only after 10s does a hard error surface. Clients pick up normal HMR reload blips silently.
- **Confirmation dialog on ticket close** — reused `ConfirmDialog` with existing i18n keys. Prevents accidental closes from both agent and support side.
- **Agent-side ticket close** — ticket owners can now close their own tickets. Post-close the agent transitions to the new-ticket form; rating modal overlays if support had joined.
- **Whisper run separators** — consecutive whispers are bracketed by dashed purple rules labelled `Whisper` / `End whisper` in `MessageList`, read as an aside from the main conversation.
- **`Ghost` icon as whisper visual vocabulary** — used on the compose toggle, whisper bubble label, and matches across all three places. Replaces the indirect `EyeOff` and `Lock` icons from earlier iterations.
- **i18n keys** — `whisper_run_start`, `whisper_run_end`, `whisper_placeholder`, `drop_files_to_attach`, `reconnecting_queue`, `reconnect_failed`, `queued`, `archived`, `toggle_team_panel`, `team_offline`, `view_archive`, `view_queue`.
- **Docs** — four mockup files under `docs/mockups/` (`chat-header-labels.html`, `queue-sidebar-archive.html`, `whisper-bubble.html`, `compose-area.html`) covering design iterations behind the user-facing changes.

### Changed
- **Queue sidebar redesign** — dropped the redundant `QUEUE`/`ARCHIVE` h2; dept filter chips now render 3-char dept codes (`DSC`/`FOT`/`TEC`) with `flex-wrap` instead of horizontal scroll; archive demoted from an equal-weight tab to a compact accent-blue outline toggle button in the footer (`[Archive]`); sidebar footer shows honest team state (green/amber/offline instead of always-green `0 / 0`); added expand/collapse chevron; mode title doubles as the current-mode indicator.
- **Whisper visual overhaul** — label renamed `internal_note` → `whisper_label` → `Whisper` (the old key was missing from `en.ts`, leaking `INTERNAL_NOTE` raw). Sender name now shown on whispers (previous render actively hid it, so you couldn't tell Lucas from Sophie). Whisper body text uses JetBrains Mono 12px in `text-secondary` — matches the brutalist chrome/content typography split. Lock icon next to label, then switched to Ghost for consistency with the compose toggle.
- **Whisper typing privacy** — when composing a whisper, the typing indicator is routed only to staff sockets in the ticket room, never the ticket's agent. `typingSchema` gains `whisper: boolean`; `broadcastTyping` iterates `ctx.io.sockets.sockets` locally and filters agents out. Dropped `fetchSockets()` because RemoteSocket.data.role isn't reliably set across the Redis adapter.
- **`ChatHeader` unified label slot** — dropped the detached `+ LABEL` button; format toolbar uses Lucide icons; chips cap at 3 + `+N` overflow; dept prefix stripped from visible chip text (kept in popover). Variant B from the label-redesign mockup.
- **Live presence avatars in ChatHeader** — support participants render as live `UserAvatar`s from the `onlineSupportUsers` store with synced status dots. Self status dot suppressed (already shown in `StatusPicker`). Generalist dept access: empty `memberships.departments` now means "sees all" instead of "sees nothing".
- **Compose area visual rework** — format toolbar and compose row unified inside a single bordered container; Lucide icons for format buttons; clean placeholder (`Type a message…`); `Ctrl+V paste · ⏎ send` kbd hint rail; whisper mode gets a purple banner, purple border around the whole box, purple send button labelled `Whisper`, and a mono body via `.compose-whisper .ProseMirror`. Send button redesigned to `[Send ⏎]` / `[Whisper ⏎]`.
- **`UserMenu` shows full name** — top-right button is now an auto-width `LUCAS SUPPORT` label (accent-blue mono uppercase) instead of a 32×32 `LS` initials square. Applies to every view via the shared `UserMenu` component.
- **`AgentView` close transition** — when the active ticket is closed (by agent or support), the ticket row is filtered out of `agentTicket` and the view drops to `TicketForm`. Leave button removed (was a dead affordance given the 1-ticket limit).
- **Minimal seed** — replaced the `--wipe/--e2e/--full` flag matrix and full faker demo dataset with a single minimal seed: one partner (`acme`), 6 named users, 6 hand-written tickets. Easier to reason about locally.
- **`SidebarFooter` + `QueueSidebar`** — missing `queued` / `archived` / `toggle_team_panel` i18n keys added (the old `t('in_queue') || 'in queue'` fallback never fired because `useT` returns the key itself on miss).
- **Client bundle code-split** — Vite `manualChunks` now isolates Tiptap+ProseMirror+markdown-it (`vendor-editor`), `marked`+DOMPurify (`vendor-markdown`), `@trpc`+`@tanstack/react-query` (`vendor-trpc`) and `socket.io-client` (`vendor-socket`). `ComposeArea` is lazy-loaded via `React.lazy` + `Suspense` in `ChatWindow`. Initial `vendor.js` drops from **883 KB → 345 KB** (gzip 289 → 113 KB); the editor stack (~462 KB) is fetched only when a chat actually opens, so `LoginView`, `PlatformView`, and admin tabs without chat never download it. Vite no longer warns about chunks over 500 KB.
- **`QueueTicketRow` warms the lazy editor chunk on hover** — `onMouseEnter` and `onFocus` fire `import('../chat/ComposeArea')` so the `vendor-editor` chunk is in the browser's module cache by the time the user actually clicks. Module resolution dedupes repeated calls so it's a no-op after the first hover. Cuts ~50–100 ms off perceived first-chat-open latency without delaying initial paint.

### Fixed
- **`user.role` permanently undefined** — server login response omits the top-level `role` field (role lives on `memberships[]`), so every client check `state.user?.role === 'agent'` was silently wrong. Broke the rating modal, `useIdleStatus` auto-away, notification filtering, message-delete permissions, and several socket handlers. Root-fixed by deriving `user.role` from the active membership in `authSlice` on every mutation + initial hydration from `sessionStorage`. Learning at `[[learnings/guichet-user-role-login-response-gap]]`.
- **Presence counter drift** — two overlapping bugs. First, `presenceService.setIo(io)` was exported but never called from the server bootstrap, so `broadcastOnlineSupport` silently short-circuited (no `io`) and support clients always saw `OFFLINE`. Second, the presence hash's `count` field was `HINCRBY`'d on every `socket:identify` (HMR, reconnects, tab focus), but decrements only fired on clean disconnects — counts drifted upward monotonically and 24h TTLs held ghosts for a full day. Fix: wire `setPresenceIo(io)` in `server/app.ts` next to `setBusinessHoursIo(io)`; replace the scalar `count` with a Redis set of socket IDs (`presence:{partnerId}:{userId}:sockets`). `SADD` is idempotent, `SCARD > 0` means online, atomic cleanup via Lua. Learning at `[[learnings/guichet-presence-drift-set-based]]`.
- **Postgres 18 alpine PGDATA trap** — `postgres:18-alpine` moved the default `PGDATA` to `/var/lib/postgresql/18/docker` (from `/var/lib/postgresql/data`). Our volume mount at `/var/lib/postgresql/data` was silently unused — every `docker compose down` + `up` wiped the database via the writable layer. Pin `PGDATA=/var/lib/postgresql/data/pgdata` explicitly in both `docker-compose.yml` and `docker-compose.prod.yml`. Decision at `[[decisions/guichet-postgres18-pgdata]]`.
- **Archive dept re-click clears ticket list** — clicking `DSC → FOT → DSC` wiped the list and never repopulated. Root cause: two `useEffect`s in `QueueSidebar` declared in the wrong order. The populate effect ran before the reset effect, so React Query's cached data filled the list, then the reset effect clobbered it to `[]`. Fix: swap declaration order so wipe runs first.
- **`ticket:new` silent early returns** — the handler had 7 silent early returns (validation, role, partner inactive, business hours, etc.) with no log output. Added `logger.warn` on every rejection path + a `logger.debug` on the accepted path so future regressions leave a trail.
- **Socket `supportJoinSchema` required `supportLang`** — non-empty string rejection silently dropped joins when `user.lang` was null. Made the field optional+nullable with an `'en'` fallback transform.
- **`ticketQueries.assignSupport` JSONB CASE** — the participants CASE expression mixed `text` and `jsonb` types, hitting Postgres' `CASE types text and jsonb cannot be matched` runtime error. All branches now use `'[]'::jsonb`.
- **Rating modal never popped after ticket close** — scoped on `state.user.role === 'agent'` which was always undefined (see above). Fixed by scoping on `ticket.agentId === state.user.id` (stricter, ownership-based). Support staff never match since they can't own the ticket.
- **Agent stranding after close** — when the agent closed their own ticket, they stayed on a read-only `ChatWindow` view with no way back to the new-ticket form. Render-branch check added on `activeTicket.status !== 'closed'`. Also removed the `Leave` button and the dead `Return to chat` fallback.
- **`ComposeArea` Tiptap view race** — the placeholder `useEffect` touched `editor.view.dom` synchronously, but `editor.view` is a Proxy (`@tiptap/core` `Editor.ts:320-348`) that throws on `.dom` access until the underlying `EditorView` mounts. Optional chaining doesn't help because the Proxy is always truthy. Latent on `main` — the gap between `useEditor()` returning the instance and `EditorContent` committing its ref was usually narrow enough to mask the throw. With `ComposeArea` now lazy-loaded under a Suspense boundary the gap widened to 50–200 ms and the bug surfaced consistently as `[tiptap error]: The editor view is not available`, caught by `ErrorBoundary` and rendered as "Component failed to load". Wrapped the access in a try-catch and re-run the effect on Tiptap's `'create'` event so the placeholder lands as soon as the view exists.
- **`ComposeArea` programmatic-content effect Tiptap view race** — `editor.commands.setContent(text, ...)` in the draft-hydrate / AI-revert / canned-pick effect ultimately calls `view.dispatch`, which trips the same `editor.view` Proxy throw if the view isn't mounted yet. Currently masked because `text` is usually empty on first mount and the `getEditorMarkdown(editor) === text` short-circuit fires before `setContent` runs — but a draft-hydrated first mount inside the same lazy-load race window would crash into `ErrorBoundary`. Proactively wrapped in a try-catch that resets the programmatic-update guard flag and bails; the next real `text` change retries once the view is up. Detection notes and audit table at `[[learnings/guichet-tiptap-view-proxy-throw]]` in the cross-project wiki.
- **Single-emoji messages silently dropped + stranded as ghost bubbles** — `guardLength` blocked anything with `text.trim().length < 3` UTF-16 code units. A single emoji like `😀` is encoded as a surrogate pair (length 2), so every emoji-only message hit `guard_too_short` and was rejected by the server. The server emitted a generic `error` event the client only logged, leaving the optimistic compose bubble stranded forever — clicking "delete" on it then targeted a `pending-…` id the server didn't recognize, which the user perceived as "the message seems deleted but the smiley is still there". Two-layer fix: (1) `guardLength` now only blocks empty/whitespace and oversized text — single emojis, grapheme clusters (`👨‍👩‍👧`), and single-letter messages (`k`, `ok`) all pass; (2) the server now also emits a structured `message:rejected` event (`{ ticketId, localId, code }`) alongside the legacy `error` emit. The client's `useSocket` handler removes the matching optimistic bubble via a new `removeMessage` slice action and publishes a transient `lastRejection` signal to the message slice. `ComposeArea` consumes the signal and surfaces a localized toast (`guard_too_long`, `guard_offensive`, etc.) for the active ticket. Future legitimate guard rejections (caps, swearing, repetition limit, threats, discrimination, injection) now also clean up cleanly instead of leaving ghost bubbles.

### Security
- **Whisper typing indicator stays staff-only** — agents (customers) never see "Lucas is typing…" for a private note. The socket broadcast is filtered server-side by iterating local `ctx.io.sockets.sockets` and dropping peers whose `data.role === 'agent'`.

### Tests
- Server suite at **466 / 466**. Client suite at **172 / 172**. Three stale tests fixed as part of the feature work:
  - `SidebarFooter.test.tsx` updated to match the renamed `queued` i18n key.
  - `UserMenu.test.tsx` updated to match the full-name button (was checking for `AR` initials).
  - `socket/__tests__/auth.test.ts` + `__tests__/isolation.test.ts` updated to match the new `auth:expired` event (was `error`) and the new `identifyUser(…, socketId)` / `decrementUserCount(…, socketId)` signatures.
- **`chat-enhancements.spec.ts` `openFirstTicket` helper** — dropped the fixed 500 ms `waitForTimeout` (the queue is hydrated via WebSocket so the right gate is the first row becoming visible, which `waitFor` already enforces). Added a 150 ms post-wait settle so Playwright's click doesn't race a queue re-render. Raised the `.ProseMirror` visible timeout from 15 s to 25 s to absorb the cold-cache `vendor-editor` chunk fetch on the first chat open in a fresh browser context. Suite is now deterministic — full E2E sweep passes 51/51 with `retries: 0`.

## [4.0.0] - 2026-04-05

### Added
- **`SettingsPopover` component** — Gear icon button opening a labeled-rows popover for user preferences (language, dark mode, view mode, accessibility, bionic text, notifications)
- **`UserMenu` component** — Avatar button (user initials) opening a dropdown with identity header (name + email), account security, feedback (agent only), and sign out
- **SSO-primary login screen** — SSO button is the primary action; "Platform administrator login" link reveals the local email/password form
- **User email in auth response** — `buildAuthResponse` now includes email for display in avatar dropdown

### Changed
- **Navbar consistency** — All 4 views (Platform, Admin, Support, Agent) now follow a unified pattern: `GUICHET | ROLE_BADGE | PARTNER_NAME` on the left, `SettingsPopover + UserMenu` on the right. Partner logos removed from navbar (always text).
- **Status simplification** — 5 agent statuses (available/break/lunch/meeting/training) reduced to 2 (`online`/`away`). Auto-away triggers after 5 minutes of inactivity, auto-restores to online on activity.
- **SSO-only auth for partners** — Local login, forgot-password, reset-password, MFA, and account lockout are now restricted to platform operators only. Partner users authenticate exclusively via SSO.
- **`UserSecurityModal`** — Now conditional: platform operators see password change + MFA setup; partner users see notification preferences only. MFA query only fires for platform operators.
- **`BusinessHoursGuard`** — Replaced all hardcoded `dark:`/`bg-black`/`border-black` classes with CSS custom property design tokens. Navbar unified to match standard pattern.
- **Partner `authMethod` default** — Changed from `'local'` to `'sso'` for new partners. Existing `local`/`both` partners migrated to `sso`.
- **`useIdleStatus` hook** — Simplified: emits `'away'` on idle (was `'break'`), always restores to `'online'` (removed unused `previousStatusRef`).
- **`AgentStatusStats` chart** — Simplified from 5 bar/line series to 2 (`Online`/`Away`).

### Removed
- **`NavToolbar` component** — Replaced by `SettingsPopover` + `UserMenu`
- **"My Stats" panel** — Removed collapsible agent stats panel from SupportView
- **3 old status color tokens** from status context — `accent-orange` (lunch), `accent-red` (meeting), `accent-blue` (training) no longer used for status dots

### Database
- **Migration `0001_status_simplification`** — `daily_agent_status`: drops 5 columns (`available_seconds`, `break_seconds`, `lunch_seconds`, `meeting_seconds`, `training_seconds`), adds 2 (`online_seconds`, `away_seconds`). Data migrated: available→online, all others summed→away.
- **Migration `0002_sso_only_default`** — `partners.auth_method` default changed to `'sso'`. Existing `local`/`both` partners updated to `sso`.

### New Files
- `client/src/components/SettingsPopover.tsx`
- `client/src/components/__tests__/SettingsPopover.test.tsx`
- `client/src/components/UserMenu.tsx`
- `client/src/components/__tests__/UserMenu.test.tsx`
- `server/drizzle/0001_status_simplification.sql`
- `server/drizzle/0002_sso_only_default.sql`
- `docs/superpowers/specs/2026-04-04-toolbar-status-auth-design.md`
- `docs/superpowers/plans/2026-04-04-navbar-status-simplification.md`
- `docs/superpowers/plans/2026-04-05-sso-only-auth.md`

## [3.0.0] - 2026-04-04

### Added
- **Auto-status on idle** — support/admin users auto-set to Break after 5 minutes of inactivity, restores previous status on activity
- **PWA push notifications for agents** — Web Push alerts for ticket replies, status changes, support joining, and rating requests (background-only, bell icon opt-in)
- **`useIdleStatus` hook** with configurable timeout and activity detection (mouse, keyboard, touch, scroll, visibility)
- **Push notification service** with VAPID authentication and automatic cleanup of expired subscriptions
- **`push_subscriptions` database table** for Web Push subscription storage
- **Department-based ticket transfer** — Transfer tickets to departments instead of individual agents, with optional whisper notes for context handoff
- **Agent status visibility** — 5 statuses (Available, Break, Lunch, Meeting, Training) with distinct CSS color tokens per state
- **Status persistence** — Agent status survives socket reconnects via Redis; `identifyUser` Lua script preserves existing status instead of resetting to Available
- **Time-in-status tracking** — `agent_status_log` table records granular status transitions; hourly rollup job aggregates into `daily_agent_status`
- **Real-time team status panel** — QueueSidebar shows online agents with colored status dots, updated live
- **Team Status column** — AdminTeam table includes real-time agent status with colored indicators
- **Team Capacity badge** — SupportNav displays available/total agent count as a live badge
- **Live team capacity widget** — Admin dashboard widget shows utilization bar, auto-refreshes every 15 seconds
- **Agent self-view stats panel** — "My Stats" collapsible panel in SupportView with time-in-status breakdown
- **Historical availability trend** — Line chart in My Stats panel when date range spans 2+ days
- **Split View** — 2–4 chat panels side-by-side with auto-layout (2 = equal columns, 3 = primary+secondary, 4 = 2×2 grid)
- **Preview Pane** — Read-only ticket triage view with metadata summary card, last 3 messages, and Join button
- **ViewModeDropdown** — Unified layout mode switcher (Normal, Split, Preview, Focus) replacing the standalone Focus toggle
- **Compact ChatWindow mode** — Minimal header for split view panels
- **Sidebar overlay** — Hamburger toggle shows/hides sidebar in split view mode
- **Mobile transfer button** — Removed `hidden sm:block` restriction so transfer is accessible on small screens
- **Comprehensive demo seed** (`seed.ts`) — 2 partners, 20 users, 50 tickets, 200 messages, ratings, stats, KB articles
- **`accent-amber` and `accent-orange` CSS design tokens** — Used for status dot colors
- **`statusColors.ts`** — Shared utility for consistent status rendering across components
- **28 Playwright E2E tests** — Covering agent status, ticket transfer, and view modes

### Changed
- Ticket transfer targets departments, not individual agents
- `StatusPicker` emits `status:set` event (was `support:status`) to match server handler
- `identifyUser` Lua script preserves existing Redis status on reconnect (was resetting to Available)
- Queue sidebar filters out both `closed` and `resolved` tickets (was filtering `closed` only)
- `ticket.list` tRPC endpoint accepts `resolved` status and status arrays
- GDPR purge includes `agent_status_log` entries (30-day retention)
- Drizzle migration regenerated as single baseline
- Business hours set to 24/7 for demo/test purposes

### Fixed
- CommandPalette test mock type mismatch (`vi.fn()` vs `() => void`)
- Unused `afterEach` import in useKeyboardShortcuts test
- Client tsconfig missing server/types include for web-push declarations
- GDPR test mock returning wrong shape (`[]` instead of `{ rows: [] }`)
- Recharts Tooltip formatter type error in `AgentStatusStats`
- Resolved tickets appearing in the active support queue

### Database
- New table: `agent_status_log` — granular per-agent status transition records
- New table: `daily_agent_status` — pre-aggregated daily time-in-status rollup
- New table: `push_subscriptions` — Web Push subscription endpoints per user

### New Files
- `server/services/pushNotification.ts`
- `server/routes/push.ts`
- `server/types/web-push.d.ts`
- `client/src/hooks/useIdleStatus.ts`
- `server/services/statusTracking.ts`
- `server/services/transferService.ts`
- `server/trpc/routers/status.ts`
- `client/src/components/support/ViewModeDropdown.tsx`
- `client/src/components/support/SplitChatLayout.tsx`
- `client/src/components/support/TicketPreviewCard.tsx`
- `client/src/components/admin/AgentStatusStats.tsx`
- `client/src/utils/statusColors.ts`
- `server/seed.ts`
- `testing/e2e/status-and-transfer.spec.ts`
- `testing/e2e/view-modes.spec.ts`

## [2.1.0] - 2026-03-31

### Added
- **AiContext dependency injection** — All AI modules use centralized DI (wired at boot) via barrel imports; `ai/redis.ts` removed in favor of shared `pubClient`
- **AI API key encryption** — AES-256-GCM encryption for AI API keys at rest (`AI_KEY_ENCRYPTION_SECRET` env var, fatal in production when AI is enabled)
- **Cursor-paginated messages** — `message.list` tRPC endpoint with "load older messages" UI
- **Centralized tenant guard** — `requirePartnerScope` / `requirePartnerScopeWith` for consistent multi-tenant query scoping
- **Graceful shutdown** — SIGTERM/SIGINT handler with clean exit path and TaskRunner mutex for background jobs
- **Instant socket revocation** — Redis Pub/Sub-based session revocation for deactivated users
- **Caddy TLS** — Production compose includes Caddy reverse proxy with automatic TLS
- **Azure AD locale extraction** — SSO login extracts locale claim for user language preference
- **Saved views** — Per-user saved ticket filter views (`saved_views` table, `savedView` tRPC router, `SavedViewPicker` component)

### Security
- Revoke refresh tokens before creating new one in `/enter-partner`
- Require authentication on `/api/v1/config` endpoint
- Prevent SSRF via webhook redirect following
- `AI_KEY_ENCRYPTION_SECRET` fatal when AI is enabled in production
- `DEMO_MODE` added to Zod config with production guard
- Handle platform operators and revoke tokens on no-membership rejection

### Performance
- Split i18n into per-locale dynamic imports
- Lazy-load `AdminStats` and `AdminSatisfaction`
- Consolidate SupportView store subscriptions with `useShallow`
- Replace unbounded `IN` clause with JOIN queries in stats
- Add DB indexes: `audit_log(created_at)`, `messages(ticket_id, created_at)`, `tickets.participants` GIN
- Hoist `getAiConfig` query from `MessageBubble` to `ChatWindow`
- Eliminate redundant DB query in `ticket.list` for support users

### Fixed
- Presence: replace TOCTOU-prone `hSetNX`/`decrementUserCount` with atomic Lua scripts
- Socket: make identify handler set `socket.data` atomically; replace module-level `listenersAttached` with `useRef`
- Auth: return `revocationFailed` flag on logout token revocation failure
- Messages: add `createdAt` fallback in sort to prevent NaN ordering
- Client: log `trpcVanilla` mutation errors instead of silently swallowing
- i18n: make `tBrowser` English-only and add missing `'en'` key

### Refactored
- Migrate CSV export query and `insertRating` to Drizzle query builder
- Extract `ticketQueries` Drizzle module with tests
- Cruft audit: prune 6 redundant deps, remove dead code, delete 33 historical markdown files

## [2.0.0] - 2026-03-27

### Design System
- **Brutalist redesign** — Complete UI overhaul with CSS custom property design tokens, self-hosted JetBrains Mono + Inter fonts, and light/dark mode via `.dark` class toggle
- New utility classes: `btn-primary`, `btn-secondary`, `btn-danger`, `input-field`, `surface-card`, `surface-panel`, `bubble-sent`, `bubble-received`, `bubble-whisper`, `badge`, `mono-label`, `mono-id`, `mono-timestamp`, `section-header`
- WCAG 2.1 AA compliant focus-visible states on all interactive elements
- `prefers-reduced-motion` support for both animations and transitions
- Self-hosted fonts (zero external CDN dependencies)
- ErrorBoundary restyled with design tokens

### Security
- **HttpOnly cookie authentication** — JWT tokens now transported via `HttpOnly SameSite=Lax Secure` cookies instead of `Authorization: Bearer` headers. Eliminates XSS token theft vector. Client no longer stores tokens in localStorage.
- `COOKIE_SECURE` defaults to `true` (set `false` for local dev without HTTPS)
- `COOKIE_DOMAIN` config for subdomain cookie sharing
- Companion `session_expires` cookie for client-side expiry detection without exposing JWT
- **PostgreSQL audit_log immutability triggers** — BEFORE UPDATE raises unconditionally, BEFORE DELETE requires prior archival

### Added
- MFA admin management: platform operators can see MFA status badges and force-disable MFA for any user
- Account unlock: platform operators can unlock locked-out users from the user table
- Email notifications for admin-initiated MFA disable and account unlock
- `REQUIRE_PLATFORM_STEP_UP` config flag (default `false`) to control platform TOTP step-up enforcement
- API documentation: Swagger UI at `/api/v1/docs/` for REST endpoints (auth, uploads, logos, health)
- tRPC reference documentation at `/api/v1/trpc-reference` (68 procedures across 13 routers)
- OpenAPI annotations on all Express route handlers
- Notification preferences: per-user opt-out for email types (account lockout, MFA changes, password changes)
- Notification toggle UI in security modal with B&W toggle switches
- DB migration 0009: `notification_preferences` JSONB column on users table
- Database backup script (`npm run db:backup`) with auto-pruning
- Database baseline script for adopting Drizzle on existing DBs
- Socket.io token expiry detection — expired JWTs are caught and clients auto-reconnect
- CI: server unit tests now run in pipeline
- CI: migration validation against a fresh Postgres in every build
- **Advanced password policies** — min 10 chars, upper/lower/digit/special, common password blocking, email/name inclusion check
- **Password history** — prevents reuse of last 5 passwords (Argon2id verified)
- **Account lockout** — 5 failed attempts triggers 15-minute lockout with audit trail
- **MFA (TOTP)** — per-user setup/enable/disable via tRPC, 8 SHA-256 recovery codes, authenticator app QR URI
- **Centralized email templates** — B&W design system with brand context, XSS-safe escaping
- **Cursor-based pagination** — audit log uses keyset pagination (createdAt|id) instead of offset
- **WebSocket k6 load test** — Socket.io connection stress testing (25 VUs, Engine.IO framing)
- **Playwright E2E scaffold** — password reset flow spec with config
- **MFA settings UI** — global shield button opens modal for enable/disable/recovery code management
- **Account lockout email** — users receive email notification when account is temporarily locked
- **MFA enabled email** — confirmation email sent when two-factor authentication is activated
- **Per-email forgot-password throttle** — max 3 reset requests per email per 15 minutes
- **MFA login challenge UI** — LoginView shows TOTP code input when MFA is required, supports recovery codes
- **WORM audit archive** — tamper-evident SHA-256 hash chain, automatic archival before GDPR purge, chain integrity verification endpoint
- **Ticket archiving** — closed tickets archived with summary metadata (message count) before GDPR purge deletes originals
- **Archive API endpoints** — `getArchivedAuditLog`, `getArchivedTickets` (cursor-based), `verifyAuditChain`, `runArchive` (manual trigger)
- **Self-service password change** — authenticated users can change their own password with strength validation, history check, and session revocation
- **Archive viewer UI** — PlatformView "Archive" tab with audit log browser, ticket browser, chain verification, and manual archive trigger
- CI: Playwright E2E job with Postgres service container, browser install, and failure artifact upload
- **Canned responses** — per-partner response templates with shortcut keys, category grouping, and `/` picker in chat
- **Message edit/delete** — support agents can edit or soft-delete their own messages (admins can delete any)
- **Ticket transfer** — support agents can transfer tickets to another online support user
- **Ticket search** — full-text search across message content from the queue sidebar
- **Customer info panel** — sidebar showing agent details, past tickets, and reference fields
- DB migration 0010: `canned_responses` table with `title`, `body`, `shortcut`, `category`, `created_by`
- DB migration 0011: `edited_at` and `deleted_at` columns on messages table

### Changed
- Ticket list pagination migrated from offset-based to cursor-based keyset pagination (AdminArchive, QueueSidebar)
- Build job now depends on all four CI checks (typecheck, client tests, server tests, migrations)
- Invite/reminder/test emails now use centralized `mailTemplates.ts` instead of inline HTML
- Login endpoints enforce lockout + MFA verification before granting tokens
- Password reset validates strength, checks history, resets lockout counter

## [1.0.0] - 2026-03-23

### Added
- **Multi-tenant architecture** — strict partner isolation, per-partner config (JSONB)
- **Real-time chat** — Socket.io with Redis adapter for horizontal scaling
- **Role-based access control** — agent, support, admin, platform_operator
- **Authentication** — local (Argon2id) + Azure Entra ID SSO with group-based auto-membership
- **Platform cockpit** — global operator view: tenant management, user provisioning, audit log
- **Platform step-up security** — time-limited elevation for sensitive operations (15 min window)
- **Session revocation** — JTI-based token blacklisting via Redis
- **Business hours** — per-partner schedules with queue position broadcasting
- **Audit logging** — granular state diffs, CSV export, partner-scoped lifecycle tracking
- **GDPR compliance** — 30-day retention purge, daily stats aggregation
- **Content guards** — length, caps lock, repetition, injection, swearing, threats, discrimination
- **Observability** — Pino structured logging, Prometheus metrics, Grafana dashboards
- **Multi-partner support** — users belong to multiple partners via memberships, workspace switcher
- **Bionic reading mode** — language-aware fixation for accessibility
- **Dark mode** — full Tailwind dark: support
- **Docker Compose** — development and production configurations
- **E2E testing** — Playwright with server-side seeding
