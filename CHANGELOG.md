# Changelog

All notable changes to Guichet are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Removed
- **User-management UI + tRPC mutations — Azure-only model** — Org reality: a platform admin opens an Azure ticket for every user provisioning + role + offboarding action, so duplicate Guichet-side controls were misleading at best (manual changes silently overwritten by SSO sync) and dangerous at worst (B2B guest could be promoted to platform_operator via the Manage Access dropdown, bypassing the destructiveAdminProcedure gate). Frontend (commit f21f7ef): deleted `InviteUserModal.tsx`, `PendingInvitesTab.tsx`, `ManageAccessModal.tsx` (modal added no info beyond the Access Scope column already shown in the user table). PlatformView dropped its "invites" tab + state; UserTable dropped "Invite New User" + "Delete Account" + "Manage Access" buttons; AdminTeam dropped "Invite B2B Guest" + per-row department-edit dropdown + per-row remove-member button + the InviteExternalUserModal subcomponent — both panels are now read-only rosters with an "Azure-managed" banner. Backend (commit 6c4be3c): deleted `platform.{inviteUser, updateMembership, removeMembership, revokePendingInvite, listPendingGuestInvites, deleteUser}` and `partner.{inviteExternalUser, updateMember, removeMember}`. Kept: `user.revokeSessions` (security incident response, complementary to Azure-disable, not redundant — Azure-disable doesn't kill in-flight JWTs/refresh tokens immediately), `platform.listGlobalUsers` + `partner.{listMembers, listAdmins, memberStats}` (read-only roster). Dropped 7 dead test files and 2 E2E specs (invite-audit-flow, guest-admin-visible-disable). Net: ~2,450 lines deleted across the two commits. Note: this also rolled back two short-lived guards added earlier in the same session (isNull(deletedAt) filter in routes/sso.ts and a soft-deleted CONFLICT throw in platform.inviteUser) — they hardened a Delete-Account flow that no longer exists.
- **PlatformView "Edit Profile" — dead code path** — `EditUserProfileModal.tsx` + its test, the `Edit Profile` button + `onEditProfile` prop in `UserTable`, the `editingUserProfile` state + modal mount in `PlatformView`, the `platform.updateUser` tRPC mutation in `server/trpc/routers/platform/users.ts`, the `user.profile_updated` audit-action filter entry in `server/trpc/routers/platform/audit.ts`, the `updateUser` row in `server/docs/trpc-reference.md`, and the `edit_profile` i18n key in en/nl/fr. The modal let an operator edit `name` + `email` on a global user, but [routes/sso.ts:385](server/routes/sso.ts:385) unconditionally overwrites both fields from Azure claims on every SSO login (no `nameLocked` flag exists, only `langLocked`), so edits never survived a login. The legitimate pre-claim use cases are already covered: typo'd email → revoke pending invite (`PendingInvitesTab`) + re-invite; typo'd name → harmless (SSO fixes on first login); stale unclaimed user → auto-purges via the 7-day claim window. Email-edit post-claim was actively dangerous (could orphan SSO `externalId` matching). Historical `user.profile_updated` rows in `audit_log` remain queryable via the "all actions" filter; only the dedicated dropdown entry is gone.
- **Prometheus / Grafana / Alertmanager monitoring stack** — the three compose services, the `monitoring/` directory (prometheus.yml, alerts.yml, alertmanager.yml, grafana provisioning + dashboard), `server/utils/metrics.ts`, `server/middleware/metrics.ts`, the authenticated `/metrics` route in `app.ts`, the `prom-client` npm dep, the `METRICS_TOKEN` env var, and every `*Total.inc()` / `.observe()` / `startTimer()` call across 11 server source files (sla, gdpr, webhookDispatch, chainVerifySchedule, ticketLifecycle/audit, moderator/policy, socket/handlers + 5 sub-handlers, trpc/routers/support). The `__tests__/routes/metricsAuth.test.ts` boundary suite is gone with the route. 11 test files dropped their `vi.mock('.../utils/metrics.js')` blocks plus the dead `*IncMock` assertions on the metrics that no longer exist. Unrelated AlertmanagerWebhookURL env wiring also dropped.

### Added
- **In-app Health-page tripwires** — `trpc.platform.getSystemHealth` (consumed by `PlatformSystemHealth`) now returns three new flags on top of the existing pg/redis/gdpr fields: `chainBroken` (from `system_settings.audit_chain_verify_history`), `chainStale` (>25h since last verify), and `slaBreachBurst` (count of `sla_breaches` rows in the last hour, threshold ≥5). The Health page renders these as critical/warning banners, dismissable per-session. Polling cadence: 5 min when the tab is visible, paused in background, refetch on window focus. Critical chain-tamper events also emit `audit:chain:broken` from `chainVerifySchedule.runChainVerify` to the new `platform:operators` socket room (joined automatically by every platform-operator socket on identify), so the banner lights up instantly without waiting for the next poll.
- **Bundle D slice 3 — CI skip-guard + wiki decision page** (issue #83, RFC #82) — closes the bundle. New `scripts/check-e2e-skip-guard.ps1` walks every `testing/e2e/*.spec.ts`, finds each `test.skip(...)` call (multi-line aware via paren-depth walking), and fails CI if any span doesn't contain `process.env`. Wired into `scripts/ci.ps1` as a new step `e2e-skip-guard` after `tenant-isolation-guard`. Allowed: `test.skip(!process.env.X, ...)` env-flag opt-ins. Banned: every other `test.skip(...)` form (use `throw new Error(...)` for fixture/login pre-conditions, `test.fixme(...)` for known-broken tests pending follow-up). Wiki updates: new decision page at `wiki/decisions/guichet-e2e-fixture-pattern.md`, pattern page at `wiki/patterns/e2e-skip-as-silent-failure.md` updated to call out the resolution and the three legitimate remaining env-flag opt-ins.
- **Bundle D slice 2 — migrate remaining 24 specs to ticketFixture / hard-error-on-login-fail** (issue #83, RFC #82) — applies the slice 1 fixture API end-to-end. **Skip count: 30 → 3** (all 3 remaining are legitimate env-flag opt-ins: `E2E_CHAT_DEMO`, `E2E_INCLUDE_QUEUE_LANG_AWARENESS`, `E2E_INCLUDE_SLA_LIFECYCLE`). 24 specs migrated across 3 groups: Group A (15 single-page login-only); Group B (6 ticket-fixture-needed); Group C (3 multi-user). Some tests required `test.fixme()` for multi-context fragility that needs deeper rewrite (~12 fixmes total — flagged for slice 3 follow-up). Demo-login predicate failures now surface as hard errors per the wiki pattern at `wiki/patterns/e2e-skip-as-silent-failure.md` ("a skip is not a pass"). Slice 3 lands the CI grep guard so future PRs can't reintroduce the predicate-skip pattern.
- **Bundle D slice 1 — testFixtures router + Playwright ticketFixture + status-and-transfer migration** (issue #83, RFC #82) — new `server/trpc/routers/testFixtures.ts` exposes `createTicket`, `cleanup`, and `resetAgentStatus` procedures behind three production-safety layers: module-load `assertNotProduction()` (panics on import in prod via the new `server/utils/assertNotProduction.ts`), conditional mount in `server/trpc/router.ts` (top-level await + dynamic import — testFixtures key absent on prod tRPC client), per-procedure `fixtureProcedure` recheck (`NOT_FOUND` in prod, defense-in-depth). Auth: extends `protectedProcedure`, anon callers get UNAUTHORIZED. Cross-tenant by design — allowlisted in `server/scripts/check-trpc-tenant-isolation.mjs`. New Playwright `test.extend` helper at `testing/e2e/helpers/fixtures.ts` exposes a `ticketFixture` slot with auto-cleanup in `afterEach` (forgetting cleanup is impossible by construction). Audit: fixture-emitted rows use `audit.test_fixture.*` action labels; platform `getAuditLog`/`exportAuditLog` filter them by default with `includeFixtures: true` opt-in; partner audit log + cross-partner activity always filter. **`testing/e2e/status-and-transfer.spec.ts` migrated end-to-end** as proof — 19 fixture-state predicate skips eliminated; 11/11 tests pass deterministically (verified across two consecutive runs). Boundary suite: `testFixtures.boundary.test.ts` (3 tests — file panics on import in prod), `testFixtures.auth.test.ts` (4 tests — every procedure rejects unauth + DB-untouched assertion), `assertNotProduction.test.ts` (4 tests). Slice 2 will migrate the remaining 25 spec files; slice 3 adds the CI grep guard.
- **Bundle A slice 1 — `services/auth/` foundation** (issue #66) — new consolidated auth module exposing a canonical `Actor`, a 7-capability authorization vocabulary (`tenant_admin`, `platform_admin`, `support_like`, `use_support_workflows`, `manage_tenant`, `export_tickets`, `destructive_admin`), and `socketActor` / `trpcActor` / `actorFactory` builders. JWT payload now carries an `isExternal` claim populated at all 5 mint sites (SSO, dev-login, refresh, switch-partner, enter-partner); tokens missing the claim deserialize to `false` for the rollout window. Express auth middleware and Socket.io `setupJwtMiddleware` read the claim onto `req.user.isExternal` / `socket.data.isExternal`. New boundary suite (`capabilities.test.ts`, `actor.test.ts`, `jwt.test.ts`, `session.boundary.test.ts`). No production socket-handler or tRPC-router callsite changed in this slice — those migrate in slices #68–#71.
- **Bundle A slice 2 — `users.isExternal` flip revocation** (issue #67) — new `flipIsExternal(userId, nextValue)` helper in `services/auth/` writes the new flag value + an `auth.session_revoked` audit row in one transaction, then fires the Redis-backed session-and-refresh-token revocation cascade. No-op when the value is unchanged. The two SSO write sites (invite-claim path and existing-user re-attestation path in `routes/sso.ts`) now call the helper instead of inlining `db.update(users).set({ isExternal })`. Closes the staleness window between Azure re-attestation and JWT rotation; unblocks slice #71's deletion of the per-call `blockExternalUsers` middleware.
- **Bundle A slice 3 — `blockExternalUsers` reads JWT claim, drops per-call DB lookup** (issue #71) — middleware now reads `ctx.user.isExternal` directly from the JWT-stamped claim (slice #66) instead of round-tripping to `users.isExternal` on every destructive admin mutation and every internal-admin read. Safe because slice #67 makes every flag flip atomically revoke the user's sessions + refresh-token families, so no pre-flip token can use a stale claim to evade the gate. Drops `db`, `users`, and `eq` imports from `server/trpc/trpc.ts`. Behavior unchanged: `destructiveAdminProcedure`, `internalAdminReadProcedure`, `partnerInternalAdminReadProcedure`, and `webhook.ts`'s `gatedPartnerAdminNoGuests` continue to throw FORBIDDEN for guests + bypass for platform operators. Per-call latency on every gated admin request drops by one DB round-trip.
- **Bundle A actor shim drop** — socket handlers now consume the canonical `socketActor` from `services/auth/actor.ts` directly (returns `UserActor | null` with self-validating identity + partner-scope checks) instead of the lifecycle's non-null wrapper that was held over from slice #66. Deletes `server/services/ticketLifecycle/actor.ts`; `services/ticketLifecycle/index.ts` and `services/messageLifecycle/index.ts` now re-export `socketActor` / `systemActor` / `isUserActor` from the canonical surface (deep paths so the lifecycle barrel doesn't transitively evaluate `flipIsExternal`'s production wiring, which would force every lifecycle-importing test to mock `db`). All 9 socket-handler callsites in `handlers/message.ts`, `handlers/presence.ts`, `handlers/ticket.ts` add an `if (!actor) return;` guard. `services/ticketLifecycle/reclaim.ts` imports `SYSTEM_ACTOR` directly from `services/auth/types.ts`. One source of truth for actor construction across both transports.
- **Bundle A slice 3 — message socket handlers consume `socketActor()`** (issue #68) — every `message:*` handler in `server/socket/handlers/message.ts` (loadMore / send / delivered / read / edit / delete / react) now pulls identity through `socketActor(socket)` exclusively; zero direct reads of `socket.data.{userId,partnerId,role}` remain in the file. Redundant `senderId` / `partnerId` null guards drop (the actor's non-null contract subsumes them), and lifecycle calls pass `partnerId: actor.partnerId` instead of a separately-extracted variable. New actor-aware `requireActorTicketScope` / `requireActorTicketScopeWith` helpers in `server/socket/partnerScope.ts` replace the socket-coupled `requirePartnerScope*` calls — same DB tenant-isolation check, same `'Not authorized'` UX, same warn log, but parameterised on `UserActor` so socket coupling moves out of the handler tier. (Slices #69 and #70 will migrate `ticket.ts` and `presence/collision/rating/disconnect.ts` to the same pattern, after which the legacy socket-coupled helpers can be removed.) Test mock socket factories in `socket/handlers/message.test.ts` and `__integration__/isolation.test.ts` now default `data.identified=true` to mirror what `socket:identify` sets in production — required by the canonical `socketActor`'s identity gate.
- **Bundle A slice 7 — fold session/auth modules into `services/auth/`** (issue #72) — `server/services/{authSession,refreshToken,sessionRevocation}.ts` and their test files (`authSession.test.ts`, `sessionRevocation.test.ts`, `refreshToken.test.ts`, `refreshTokenRotation.test.ts`) moved into `server/services/auth/`. Internal imports updated; production callers (`routes/sso.ts`, `routes/auth/{session,devLogin}.ts`, `app.ts`, `middleware/auth.ts`, `trpc/context.ts`, `trpc/routers/{user,platform/users,partner/members}.ts`) now import session/auth APIs from the `services/auth/` barrel. `socket/handlers/{types,auth}.ts` use a deep import (`services/auth/sessionRevocation.js`) for `isRevoked` / `REVOCATION_CHANNEL` to keep the auth barrel — which transitively evaluates `flipIsExternal`'s `db` wiring — out of socket-handler test mock surfaces. `ticketLifecycle/types.ts` drops its Actor-type re-export shim; the lifecycle barrel and `audit.ts` now import `Actor` / `UserActor` / `SystemActor` straight from `services/auth/types.js`. After this slice, `services/auth/` is the only home for identity, capabilities, session lifecycle, refresh-token rotation, and the Redis-backed revocation cascade — no flat auth-related files remain at `services/` root.
- **Bundle A slice 6 — tRPC actor migration + `blockExternalUsers` deletion** (issue #71) — every previously-gated tRPC handler resolves the B2B-guest gate inline via `trpcActor(ctx, { capability: 'destructive_admin' })` from `services/auth/`. Migrated callsites: `webhook.create/update/regenerateSecret/delete/test`, `partner.audit.getAuditLog/getForTicket`, `partner.members.listAdmins/inviteExternalUser/updateMember/removeMember`, `partner.config.updateDepartments/updateDepartmentSla`. The `blockExternalUsers` middleware and its three procedure-factory wrappers (`destructiveAdminProcedure`, `internalAdminReadProcedure`, `partnerInternalAdminReadProcedure`) plus `webhook.ts`'s inline `gatedPartnerAdminNoGuests` composition are deleted; the rule lives once in `services/auth/capabilities.ts:RULES.destructive_admin`. Behavior unchanged — same FORBIDDEN-for-guests, same operator-bypass — but the manual `partnerId` BAD_REQUEST guards in handler bodies disappear because each callsite now uses `partnerAdminProcedure` which already narrows partnerId, and `trpcActor` re-asserts it. New behavioral test `webhook.guestGating.test.ts` pins the runtime FORBIDDEN behavior across `create`/`delete`/`regenerateSecret` for three caller shapes (internal admin, platform operator, B2B guest).
- **Bundle C slice 3 — cleanup; MessageBubble deleted; bundle-size guardrail confirms lazy split** (issue #78) — `<Message>` now owns the chat-message render path inline (`client/src/components/MessageBubble.tsx` deleted; the 380-LOC body absorbed). The second MessageBubble consumer (`TicketPreview.tsx`) migrated to `<Message>` as part of the deletion. `chat/index.ts` barrel pruned: `AttachmentGrid`, `DeliveryStatus`, `QuoteBlock`, `LinkPreviewCard`, and `MessageContent` are no longer exported — they're private internals reachable only through `<Message>`. New `Message.kind.test.tsx` (5 tests — system pill, i18n: prefix resolution, whisper bubble class precedence over isMine, whisper label/ghost icon on group-start). 28 chat tests now pass (was 23). **Bundle-size guardrail**: production build emits AttachmentGrid (2.47 kB), QuoteBlock (0.86 kB), LinkPreviewCard (1.39 kB) as standalone chunks loaded via `dynamicImports`; chat route chunk shrank 46.60 kB → 44.60 kB end-to-end across Bundle C. Closes Bundle C (PRD #75, RFC #64).
- **Bundle C slice 2 — `<Message>` scaffold + React.lazy fragment boundary** (issue #77) — new `client/src/components/chat/Message.tsx` exposes the public chat-message API per RFC #64; thin wrapper around `MessageBubble` for the slice (slice #78 inlines the body). `MessageContent.tsx` lazy-loads `AttachmentGrid`, `QuoteBlock`, and `LinkPreviewCard` via `React.lazy` with stable-height Suspense fallbacks (`min-h-[80px]` for grid + link preview, `min-h-[44px]` for quote). Plain-text messages — the dominant case in any support session — pay zero parse cost for the three fragments. `MessageList.tsx` renders `<Message>` instead of `<MessageBubble>` directly. New test factories: `makeMessage`, `makeMessageWithAttachment`, `makeMessageWithQuote`, `makeMessageWithLinkPreview`, `makeDeletedMessage`. New tracked tests: `Message.test.tsx` (12 cases — text, deleted, search highlight, reply, suppressActions, group spacing, ticketId fallback), `Message.lazy.test.tsx` (5 cases — verify-can-fail probe + four lazy-fragment paths). 23 chat tests now pass (was 6); 532 client tests total. Unblocks slice #78 (cleanup + bundle-size guardrail).
- **Bundle C slice 1 — `<FormModal>` primitive + 5 platform-modal migrations** (issue #76) — new `client/src/components/ui/FormModal.tsx` owns the modal scaffold, the FIELD_LABEL/INPUT Tailwind constants, and the submit lifecycle (pending disables submit; error renders a Toast; success calls `onSuccessData?.(data)` then `invalidate?.()` then `onClose()` then `mutation.reset()`). Mutation passed as a prop object (not a key) so tests stay tRPC-free and type safety on the input is preserved through generics. Static `FormModal.TypedConfirm` sub-component covers the destructive-typed-name pattern. The five platform modals (`CreatePartnerModal`, `DeletePartnerModal`, `EditPartnerModal`, `EditUserProfileModal`, `InviteUserModal`) now mount through it; per-modal scaffolding deleted (~50% LOC reduction per file). DeletePartnerModal uses `headerSlot` for the AlertTriangle layout + `submitVariant="danger"` + `dismissOnBackdrop={false}`. InviteUserModal's post-success result screen stays bespoke (multi-step wizard pattern doesn't fit FormModal). New boundary suite: `FormModal.test.tsx` (lifecycle, variants, headerSlot, onSuccessData ordering — 18 tests), `FormModal.TypedConfirm.test.tsx` (4 tests). Per-modal test files retained as parity safety net through the migration. Unblocks slice #77 (Message scaffold + lazy fragments).
- **Bundle A slices 4 + 5 — remaining socket handlers consume `socketActor()` + capability vocabulary closes silent role-check drift** (issues #69 + #70) — `ticket.ts` (new/close/transfer/labels:update), `presence.ts` (support:join/rejoin/leave + status:set + typing), `collision.ts` (ticket:viewing/left), `rating.ts` (rating:submit), and `preview.ts` (ticket:preview:join) now consume identity through `socketActor(socket)` exclusively; zero direct `socket.data.{userId,partnerId,role}` reads remain in any production handler body. **`LABEL_ROLES` array deleted** — the legacy `socket.data.role`-string compare against `'platform_operator'` (a value never set on the role field) silently rejected platform operators; the new `can(actor, 'use_support_workflows')` capability check honours the `isPlatformOperator` flag correctly. Same capability replaces the legacy `socket.data.isSupport` denormalized flag for `support:join`, `support:rejoin`, `support:leave`, `ticket:transfer`, `ticket:viewing`, `ticket:left`, and `ticket:preview:join` role gates — single source of truth between socket and tRPC paths. **Helper cleanup**: legacy `requirePartnerScope` / `requirePartnerScopeWith` deleted (their last consumer was `preview.ts`); only the actor-aware `requireActorTicketScope` / `requireActorTicketScopeWith` siblings remain, and `socket/partnerScope.test.ts` pivots to test those. **`disconnect.ts` keeps direct `socket.data.userId` / `partnerId` reads** with an explanatory comment — calling `socketActor` on a disconnecting socket would emit pointless `'error'` events back to a client that's already gone, and we just need the IDs for presence cleanup that silently no-ops when either is absent. New behavioral test `socket/handlers/ticket.test.ts` pins the `ticket:labels:update` capability gate (agent rejected, support/admin allowed, platform operator allowed via the operator bypass that the legacy array silently denied).

### Changed
- **`services/ticketLifecycle/` Actor migration** — `types.ts` and `actor.ts` re-export the canonical `Actor` shape from `services/auth`. `UserActor.id` renamed to `userId`, `isSupport` cached field dropped (callers use `isSupportLike(actor.role)`), `isPlatformOperator` added. `services/messageLifecycle/` consumers and a single socket-handler read of `actor.isSupport` updated to the new shape.
- **Code-review pass batches 9–12 (2026-04-23 → 24)** — four incremental cleanups, no behavioral change; 702 server + 255 client tests green throughout.
  - **Batch 9 — perf** (`fc285c3`) — hot-path RTT shaves across tRPC query paths; unlocked index on stats range queries.
  - **Batch 10 — error sanitization + dead code** (`01308f7`) — tRPC errors scrubbed of internal details (messages, stack traces) before leaving the server; dead exports removed across routers.
  - **Batch 11 — a11y + i18n** (`66e8597`) — `Toast` gains `aria-live`/`aria-atomic`; `ChatHeader` popovers now restore focus to trigger on `Escape` (label picker, transfer menu); `QueueTicketRow` SLA severity no longer color-only (icon + aria-label for color-blind users); 26+ new keys for i18n coverage in `AdminWebhooks`, `FormatToolbar`, `AdminCannedResponses`, `AdminKnowledgeBase`, `AdminTeam`; en/nl/fr synced with 12 pre-existing locale gaps filled.
  - **Batch 12 — type drift** (`b82205a`) — dropped four `as unknown as` lies via root-cause fixes: schema `participants.$type<>()` now includes `isExternal?` so tRPC infers what the client declared; `useSocket()` return type is `Socket | null` instead of a lying `Socket`; client `Ticket.status` widened to include `'resolved'` (already in DB enum); `reopened`/`reopenCount` widened to allow null (nullable in DB). New `getParticipants()` helper in socket handlers centralizes Drizzle JSONB narrowing.

### Added
- **Admin dashboard redesign — 5-zone calm morning check** (2026-04-25) — replaces the 11-widget legacy dashboard with five focused zones answering one question: "what needs me today, and are we hitting our SLA?". Zones: **Z1 Action list** (SLA breaches / abandoned / untreated feedback / pending invites; "All clear today" green-tick when empty), **Z2 Scorecard** (SLA % / CSAT / Volume cards with green/amber/red banding via shared `slaColor` util; trend arrows vs previous period; p95 surfaces in tooltip), **Z3 Staffing fit** (28-day hour×day-of-week heatmap + today-vs-typical strip; warm-up state below 7 days), **Z4 Trends** (3 Recharts lines with auto-granularity: daily ≤14d / weekly ≤90d / monthly >90d), **Z5 Breakdown tables** (sortable staff + dept tables; null values sink to the bottom). New `dashboard.*` tRPC router with 7 procedures (`getActionList`, `getScorecard`, `getDeptBreakdown`, `getStaffBreakdown`, `getStaffingHeatmap`, `getTrends`, `getOnboardingState`); each procedure delegates to a pure deep service in `server/services/dashboard/` (fixture-testable, partner-isolation defense-in-depth) plus a thin Drizzle query layer. **URL-persisted filters** (`useDashboardFilters` hook): preset buttons, dept select, exclude-weekends, and custom date range round-trip through `?preset=&dept=&weekends=&from=&to=`; bookmarkable, reload-safe, popstate-aware. **No polling** — refresh on tab focus, manual refresh button, and on filter change. **Onboarding mode** for brand-new partners (zero closed tickets AND zero non-admin staff): replaces the dashboard with a 4-step checklist (Departments → Team → Business Hours → SLA); auto-hides on first ticket or first teammate. **CSV export** composes already-fetched zone payloads client-side (no extra round trip; new `dashboardExport.ts` util). **AgentStatusStats** moved from the dashboard bottom into the AdminTeam tab as a sub-section. **Removed**: the legacy `AdminStats.tsx` (1100+ lines) and `utils/exportDashboard.ts`; `stats.getGlobalStats` retained for non-dashboard callers. 134 new tests across pure services, procedures, components, and the DashboardView wiring.
- **Audit-trail observability (9 feature batches, 2026-04-18)** — WORM audit log went from "rows in a table" to a first-class operations surface.
  - **Platform chain-integrity verify UI** (`PlatformSystemHealth`) — operator-triggered verify run, server-persisted history table, CSV export for compliance attestation, rate-limited 1 run per 5 min per operator, auto-scheduled daily.
  - **Multi-axis audit filtering** — `targetType` dropdown, `targetId` search, date range, actor, partner. Deep-linkable via URL params.
  - **Metadata drawer** on every audit row — full JSON, severity highlight, previous/next navigation, filter-links into sibling rows (same actor, same target, same action). Diff view for before/after metadata on mutation rows.
  - **Cross-partner activity panel** (`PlatformAuditLog`) — top-N partners by event volume in the selected window. Click a row to scope the audit log. First-line signal for "which tenant is unusually noisy?" Aggregate-only (`partnerId`, `partnerName`, `totalEvents`, `lastEventAt`); 50-partner cap.
  - **Partner-scoped audit log** (`AdminAudit`) + per-admin verify-chain UI (partner admins can verify their slice without platform access).
  - **Ticket audit drawer** — every ticket row exposes its lifecycle events (created / assigned / transferred / closed / reopened) via `services/ticketAudit.ts`. Writes `ticket.*` actions into `audit_log`; partner-router filters them out by default, platform view excludes `ticket.*` unless opted in.
  - **Staleness banner** in the audit log when the last successful chain-verify is >24h old.
  - **JSON + CSV export** of the filtered audit view.
  - **Chain-broken webhook** — side-channel notification to partner-configured URL, independent of Prometheus/Alertmanager.
- **GDPR purge observability** — new metrics `guichet_gdpr_purge_runs_total{outcome}` (`success`/`chain_aborted`/`error`) and `guichet_gdpr_rows_purged_total{scope}`. `chain_aborted` increments before the purge throws, so missing-run alerts don't double-fire on top of chain-integrity alerts. Grafana dashboard extended with purge-runs and rows-purged panels.
- **Audit alerting** (`monitoring/alerts.yml`) — `AuditChainTamperDetected` (immediate page on any broken chain), `AuditChainVerifyServiceError` (verify service itself errored on DB/Redis), `AuditChainStaleness` (no successful verify in 48h), `TicketAuditEmitterSilenced` (self-arming — fires on 30m of zero events after 1h+ of prior activity), `GdprPurgeMissing` (no purge run in 48h), `GdprPurgeChainAborted` (purge aborted because chain verify failed).
- **`docs/AUDIT_RUNBOOK.md`** — single doc covering "chain is broken, what do I do", "purge didn't run", "verify is slow", "how do I hand a compliance auditor a CSV". Keeps oncall from having to re-derive responses.
- **Invite flow hardening** — `admin` role is now invitable (previously `support`/`agent` only; admin required DB-level promotion). New **pending-invite worklist** tab in `AdminTeam` with email, role, inviting user, claim-by window. **Revoke action** on each pending row (admin + platform operator) marks the invite claimed + audits; revoked rows stay visible 7 days. **Guest offboarding** — removing an external user from a partner now immediately revokes their sessions and refresh-token family instead of leaving a ghost session.
- **Show admins toggle** in `AdminTeam` Team table — admins were filtered out of the default team view; toggle surfaces them without making them always-visible.
- **Partner SSO via Azure B2B guests** — partner employees can now log into Guichet using their own identity (Microsoft, Google, their home Azure tenant, etc.) via Azure B2B guest federation in our tenant. New `users.isExternal` column set from the Azure `acct=1` / `idp` claim at SSO callback. Strict single-partner rule: a guest whose Azure groups resolve to more than one partner is rejected with `sso_error=guest_multi_partner_mapping` and an audit entry (`sso.guest_multi_partner_rejected`, minimal metadata with partnerIds + groupCount). Internal-staff multi-tenant auto-migrate behavior unchanged. Full runbook at `docs/superpowers/specs/partner-sso-b2b-guest.md`.
- **`destructiveAdminProcedure` tRPC middleware** — blocks external guests (`users.isExternal=true`) from 10 mutations that touch secrets, grant/revoke access, or mutate tenant structure: webhook `create/update/regenerateSecret/delete/test`, partner.members `addMemberByEmail/inviteExternalUser/updateMember/removeMember`, and partner.config `updateDepartments`. Platform operators bypass (never external by definition). Read procedures stay open to guest admins. DB lookup per call (JWT does not carry the flag; thread-through deferred).
- **GUEST badge (brutalist, amber)** — rendered next to display names in `UserMenu` (own identity), `AdminTeam` (team rows), `SidebarFooter` (support team panel), and per-message in `MessageBubble`. `ChatHeader` decorates guest participant avatars with an amber ring and appends `(GUEST)` to the hover tooltip. Built from tokens (`accent-amber` outline + mono uppercase), no radius, no shadow. `trpc.user.me` added as the canonical current-user query; `trpc.status.getTeamStatus` batch-enriches with `isExternal` for team-panel rendering. `MessageBubble` is server-authoritative via migration 0006 — `messages.sender_is_external` is denormalized at insert time (sourced from `findSenderInfo` / `findUserName`) and flows through `mapMessageRow` + the client `Message.senderIsExternal`, so guest senders flag correctly even in historical / closed-ticket reviews. `ChatHeader` still resolves participant isExternal from the presence store (offline participants don't get the ring) — threading through `tickets.participants` JSON is deferred.
- **PartnerSwitcher in AgentNav + SupportNav** — mid-session tenant switching for agents and support staff, not just admins. New optional `confirmBeforeSwitch` prop shows a native confirm dialog ("Switch tenant? Open chats and unsaved drafts will be lost.") before mutating the active membership. AdminView behavior unchanged (no confirm).
- **SupportView Tier-1 keyboard shortcuts** — `Ctrl+Enter` (close ticket), `Alt+T` (transfer), `Alt+W` (close chat tab), `Ctrl+/` (toggle whisper), `Esc` (exit focus mode), and `?` (open command palette as help). `Alt+T`/`Alt+W` chosen over `Ctrl+T`/`Ctrl+W` to avoid browser tab conflicts. All bindings go through the existing `useKeyboardShortcuts` hook and `ChatWindowHandle` ref so they stay in sync with the palette's shortcut-hint column.
- **Clickable `Ctrl+K` nav badge** — the decorative `<kbd>` in `SupportNav` is now a button that dispatches a `support:open-palette` window event; `SupportView` listens for it and opens the palette.
- **SupportView Tier-2 keyboard shortcuts** — `Ctrl+1..9` (jump to chat tab N), `Ctrl+F` (message search), `Ctrl+L` / `Alt+L` (label picker), `Ctrl+J` / `Alt+J` (canned responses), `Ctrl+Shift+A` (toggle AI copilot sidebar), `Ctrl+.` (open status picker). Cross-component openings use `window` CustomEvents (`support:open-label-picker`, `support:open-canned-picker`, `support:open-search`, `support:open-status-picker`) to avoid prop-drilling. Palette gains `jump-to-tab-1..3`, `search-messages`, `open-label-picker`, `open-canned`, and `open-status-picker` commands with matching shortcut hints; existing `toggle-sidebar-right` gets a `Ctrl+Shift+A` hint. en/nl/fr locales updated.
- **SupportView Tier-3 keyboard shortcuts** — `Alt+ArrowUp` / `Alt+ArrowDown` cycle through open tabs that have an unread indicator (wrap-around; no-op when nothing is unread), and `Ctrl+Shift+F` toggles focus mode (complements `Esc`, which only exits). Palette `toggle-focus` hint updated to `Ctrl+Shift+F`.
- **Visible-disable for guest admins on destructive controls** — destructive buttons in `AdminTeam`, `AdminDepartments`, and `AdminWebhooks` now render `disabled` + `aria-disabled="true"` + hover tooltip ("Not available to external guest users. Ask an internal admin to perform this action.") when the viewer has `users.isExternal=true`. Stops the wasted-click / confusing-toast behaviour where guests could still trigger mutations that the server would then reject with FORBIDDEN. New `useIsExternalAdmin` hook (reads the store — matches `ChatHeader`/`UserMenu`), `ExternalGuestGuard` wrapper component, and `disabledIfExternal` prop-bag util. Backend `destructiveAdminProcedure` is unchanged and remains the source of truth — the UI disable is additive. New seed fixture `admin_guest` (Gina Guest, `gina@external.test`) drives the E2E spec.

### Security
- **tRPC tenant-isolation hardening (2026-04-24, 5 slices)** — single source of truth for partner-scoped access checks. New `services/membership.ts` (`assertMembership`, `loadTicketForUser`); `message.list` and `sla.getTicketState` ported off bespoke load-then-check; **platform operators no longer bypass the tenant check** on these REST/tRPC paths — they must enter the target partner via `POST /enter-partner`, matching the socket-layer behavior. `presence.getOnlineStatus` drops its `partnerId` input field and switches to `partnerScopedProcedure` (input shrinks to `{ userId }`). `ticket.list` drops the operator branch + `partnerId` input — single code path for all in-tenant roles. **CI guard** `server/scripts/check-trpc-tenant-isolation.mjs` fails the build if any router outside `support.ts` + `platform/**` accepts a client-supplied `partnerId` in its Zod input schema; wired into `scripts/ci.ps1`. New integration test `tenantIsolation.test.ts` pins the invariant. Plan + PRD: `docs/superpowers/plans/2026-04-24-trpc-tenant-isolation-hardening.md`.
- **Review remediation sweep (2026-04-17, 20 fixes)** — end-to-end pass through an H/M/L-tagged code review in a single evening window. Highlights: `/dev-login` gated at **route-mount time** instead of inside the handler (removes the surface area entirely in prod); soft-delete on `messages.deletedAt` now cascades to attachment blob deletion (GDPR retention was silently drifting); ticket archive snapshot now runs in a single transaction (closes a mid-archive message-miss race); `authLimiter` Redis-backed via `rate-limit-redis` so replicas share a counter; **SMTP + mail-provider credentials encrypted at rest** via `FIELD_ENCRYPTION_SECRET` AES-GCM field-level encryption (M10); SSO invite claim-by-email window bounded to 30 days with a scheduled purge for abandoned invites; per-user rate limit on `linkPreview.fetchForCompose` (SSRF amplifier hardening); raw-SQL row shapes in `server/services/stats.ts` now Zod-validated at the SQL boundary instead of cast (M4); `linkPreview` Redis cache keys now `sha256`-hashed to bound key length (L2); admin `isExternal` flag re-fetched from server on view mount (was reading from stale cached login response — L1); `FIELD_ENCRYPTION_SECRET` wired into compose env + Prometheus scrape config added; drizzle migration journal rebuilt to track all 11 migrations.
- **Global `Escape` shortcut now respects modal stack** — guard at handler top skips when `[role=dialog]` is present. Prevented accidental double-actions (close modal + run shortcut).
- **S3 `CreateBucket` error handling hardened** — only `BucketAlreadyOwnedByYou` is treated as benign; every other error surfaces at boot instead of being swallowed (M6).

### Removed
- **Local authentication subsystem (follow-up commit, 2026-04-18)** — the prior removal dropped columns; `0a3ee29` rips the remaining server routes, client forms, and ambient types. Only three JWT-minting paths remain: Azure SSO (production), `/api/v1/auth/dev-login` (404s in prod), `server/scripts/break_glass.ts` (host-side emergency). Paired doc sweep (`2a1c6e6` + `cd74b3e`) removes local-auth references from README, TECHNICAL.md, TENANT_IDENTITY_SPEC.md, BREAK_GLASS_RUNBOOK.md, USER_GUIDE.md, specs, plans.

### Tests
- **Admin dashboard E2E trio** (2026-04-25) — three Playwright specs cover the redesigned dashboard end-to-end. `dashboard-filters.spec.ts` exercises the URL-persisted filter mechanics (preset click writes `?preset=`, reload restores, default 7d strips the param, weekends checkbox round-trips). `dashboard-onboarding.spec.ts` mocks `dashboard.getOnboardingState` via `page.route` to flip `isNewPartner` and asserts the 4-step checklist replaces the zones (`data-mode="onboarding"` on root). `dashboard-actions.spec.ts` mocks the action-list to inject one row per category, then asserts each row is a real `<a>` to the spec §5 drill-down destination (SLA breach / abandoned → ticket, feedback → AdminFeedback, invite → AdminTeam pending-invites tab); also pins the Z2 scorecard card hrefs.
- **E2E fixture isolation extended to `view-modes.spec.ts`** — added `support_vm` fixture, removed a global SQL wipe that was masking cross-spec contention. Every mutating spec now owns its fixture; read-only specs get their own read target. Related: `chat-flow` on `agent_flow`/`support_flow`, `support-flow.ensureAgentTicket` now fails loudly on seed miss (caught two latent races), `loginAsDemo` clears stale `active_partner` localStorage keys so prior-spec partner selection can't bleed into a fresh run.
- **Refresh-token behavioral coverage** — server-side tests lock in rotation + reuse detection (replay of a used refresh token revokes the whole family).
- **Audit tenant isolation tests** — partner A's admin cannot list partner B's invites; partner audit router returns `wasExternal` correctly after `isExternal` flips; `revokePendingInvite` guards (already-claimed → CONFLICT, wrong-partner → FORBIDDEN, already-revoked → idempotent).
- **Cross-partner revoke E2E** — platform operator revokes a partner-A invite from the Pending Invites tab end-to-end.
- **Ticket-reclaim crash-recovery source inspection test** (M5).
- 9 new Vitest cases covering the Tier-1 hotkey bindings and the SupportNav button wiring.
- 11 new Vitest cases covering the Tier-2 key bindings (digit bounds, dual-modifier bindings for L/J, no-Shift guard for Ctrl+A).
- New `testing/e2e/support-shortcuts.spec.ts` verifies Ctrl+K opens the palette, Tier-1 hints are visible, Ctrl+Enter surfaces the close-ticket confirmation, and Tier-2 palette hints render (Ctrl+., Ctrl+Shift+A).
- New `client/src/components/__tests__/ExternalGuestGuard.test.tsx` (7 cases) covers render-through for internal viewers, aria-disabled + tooltip + click/keyboard swallow for guests, short-vs-full tooltip variants, and className passthrough.
- New `testing/e2e/guest-admin-visible-disable.spec.ts` seeds the `admin_guest` fixture, loads AdminView Team + Departments tabs, and asserts destructive controls are `disabled` + `data-guest-disabled="true"` + tooltip-ed for guests but enabled for internal admin Emma (sanity check).

### Removed
- **Local authentication subsystem** — Azure SSO is now the sole production login path. Removed: `users.password`, `users.mfa_secret`, `users.mfa_enabled_at`, `users.mfa_recovery_codes`, `users.platform_totp_secret`, `users.platform_totp_enabled_at`, `users.reset_password_token`, `users.reset_password_expires`, `users.password_changed_at`, `users.password_history`, `users.failed_login_attempts`, `users.locked_until` (migration `0013_drop_local_auth.sql`). Removed services: `accountLockout`, `platformStepUp`, `mail`, `mailTemplates`, `utils/passwords`. Removed tRPC routers: `mfa`, `platformSecurity`. Removed Express routes: `/login`, `/login-local`, `/forgot-password`, `/reset-password`. Removed client: `UserSecurityModal`, `LocalLoginForm`, `ForgotPasswordForm`, `ResetPasswordForm`, `MfaChallenge`, `PlatformSecurityOps`, `PlatformSystemSettings`, UserMenu account-security button, PlatformView security tab, UserTable MFA/LOCKED badges + unlock action. `argon2` dependency removed. `REQUIRE_PLATFORM_STEP_UP` config flag removed.
- **`partners.auth_method` column + `auth_method` enum** — partners are SSO-only (SSO config lives in env) so the per-partner method is dead data. Platform operators still use local auth, gated by `users.is_platform_operator` — not by any partner flag. Migration `0008_drop_auth_method.sql` drops the column and the enum. Invite flows simplified: all invited users are provisioned without passwords (SSO-only), `renderInviteNew` email template removed (unused). Per-partner UI pickers (`CreatePartnerModal`, `EditPartnerModal`, `InviteUserModal`, `AdminTeam` invite) and the `authMethod !== 'sso'` gate in `platform.addGroupMapping` are gone.
- **`users.auth_method` column** — the per-user override was only written inside the partner `'both'` branches that got deleted with the partner-level drop; no runtime read path remained. Orphaned legacy data. Migration `0009_drop_users_auth_method.sql` drops the column. Operators running manual backups should `npm run db:backup` first — column values are silently discarded on migrate.

### Added
- **Break-glass CLI** — `server/scripts/break_glass.ts` mints a short-lived JWT (1–60m, default 15m) for any platform operator when SSO is unavailable. Writes an `auth.break_glass` audit row with `{ actorId, ttlMinutes, exp }`. Invoked via `docker compose exec server npx tsx server/scripts/break_glass.ts <email> [ttlMinutes]`. Documented in `docs/BREAK_GLASS_RUNBOOK.md`.

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
- **SSO callback hash exchange wired in client** — `LoginView` was looking for `#sso_callback=` and calling `/api/v1/auth/me` (which doesn't exist), but the server callback at `routes/sso.ts:627` redirects with `#sso_token=<opaque>` for the client to redeem via `GET /api/v1/auth/sso/exchange?token=<opaque>`. The mismatch left users stuck on the login page after a successful Microsoft sign-in. Fix: `client/src/views/LoginView.tsx` now extracts the opaque token from `window.location.hash`, calls the exchange endpoint with `credentials: 'include'`, and hands the returned `{ user, memberships }` payload to `handleLoginSuccess`. Surfaces `t('login_failed')` on exchange failure.
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
