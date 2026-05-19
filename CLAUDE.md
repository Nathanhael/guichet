# CLAUDE.md

Dual-audience document.

- **Humans**: this is the most complete architecture + conventions map of the project. Start here for orientation, then go to `docs/HANDOVER.md` for ownership context and `ls docs/` for runbooks.
- **Claude Code / other AI agents**: same content + the `context-mode — MANDATORY routing rules` section at the bottom is AI-tool guidance — humans can skim past it.

The "Critical Mandates" section uses imperative phrasing ("NEVER", "ALWAYS") because it was originally written for an AI agent. Read it as "these are the conventions; deviating breaks tests, security guards, or CI".

## Project Overview

Guichet is a real-time, multi-tenant live chat platform with a soft-product design system (calm, polished, dense; three-panel workspace). CSS custom property tokens drive the entire UI (light/dark mode), self-hosted Inter + JetBrains Mono + Lexend fonts, zero external CDN dependencies.

## Commands

### Docker (Preferred Runtime)

> **NEVER** run `npm`, `node`, or `npx` directly on the host machine. All commands must go through Docker.

```bash
docker compose up                                          # Start all services (db, server, client, redis, lb)
docker compose exec server npm test                        # Run server tests
docker compose exec client npm test                        # Run client tests
docker compose exec server npx drizzle-kit push            # Database push
docker compose exec server npx drizzle-kit generate        # Generate migration
docker compose exec server npx drizzle-kit studio          # Interactive database explorer
docker logs -f guichet-server-1                            # Server logs
docker logs -f guichet-client-1                            # Client logs
```

### Database Management

These scripts live in `server/package.json`. Run them via Docker (or from the `server/` directory):

```bash
docker compose exec server npm run db:migrate    # Apply pending Drizzle migrations
docker compose exec server npm run db:baseline   # Seed migration ledger for existing DBs (one-time, interactive)
docker compose exec server npm run db:backup     # Dump DB to server/backups/ (gzipped, auto-prunes to 10)
docker compose exec server npm run db:backup:docker  # Same, but from Docker 'db' container
```

**Migration path**:
- Fresh database → `npm run db:migrate`
- Existing DB with empty Drizzle ledger → `npm run db:baseline` then `db:migrate` going forward
- Before risky migrations → `npm run db:backup` first

### Build & Production

```bash
docker compose exec client npm run build                   # Vite production build
docker compose exec client npm run preview                 # Preview production build locally
docker compose -f docker-compose.prod.yml up               # Production deployment
docker compose -f docker-compose.prod.yml build            # Build prod images
```

### Bootstrap

The platform operator is auto-created by the bootstrap service on server startup from `PLATFORM_ADMIN_EMAIL` env var. All logins go through Azure SSO (see `server/routes/sso.ts`). The only way to mint a JWT without SSO is the break-glass CLI (`server/scripts/break_glass.ts`) — see `docs/BREAK_GLASS_RUNBOOK.md`.

## Architecture

### Server (`server/`)

**API Layer**:
- **tRPC (Primary)**: tRPC 11 for all data fetching and mutations. Router: `server/trpc/router.ts`. 17 domain routers in `server/trpc/routers/`: `ai`, `cannedResponse`, `dashboard`, `feedback`, `label`, `linkPreview`, `message`, `partner`, `platform`, `presence`, `rating`, `savedView`, `sla`, `status`, `support`, `ticket`, `user`. Input validation via Zod.
- **Express Routes**: Auth (`server/routes/auth/` — session only), SSO (`server/routes/sso.ts`), Uploads (`server/routes/uploads.ts`), Tickets (`server/routes/tickets.ts`), AI Transcribe (`server/routes/aiTranscribe.ts`).
- **API Docs**: Swagger UI at `/api/v1/docs/` (REST), tRPC reference at `/api/v1/trpc-reference`.

**tRPC Middleware** (`server/trpc/trpc.ts`):
- `publicProcedure` → `protectedProcedure` → `adminProcedure` / `platformProcedure`
- `partnerScopedProcedure` (guarantees a non-null `partnerId` from JWT) → `partnerAdminProcedure`
- `roleProcedure(roles[])` and `partnerRoleProcedure(roles[])` for dynamic role checks (platform operators bypass all role gates)

**Services** (`server/services/`):
- `bootstrap.ts` — First-run platform operator creation from `PLATFORM_ADMIN_EMAIL` env var
- `gdpr.ts` — Daily purge and per-partner aggregation (30-day retention)
- `archive.ts` — WORM audit archive (SHA-256 hash chain) + ticket archiving with summary metadata
- `businessHours.ts` — Business hours enforcement and queue position broadcasting
- `stats.ts` — Pure stat helpers (`calculatePercentile`, `computeLiveDayStats`); used by `services/dashboard/scorecardQueries.ts` and `services/gdpr/dailyStatsAggregate.ts`
- `chainVerifySchedule.ts` — Scheduled daily WORM chain-integrity verification. Results persist to the chain-verify history table for CSV compliance-attestation export (UI in `PlatformSystemHealth`).
- `ticketReclaim.ts` — Crash-recovery path for tickets left mid-assign; behavioral coverage in `server/services/ticketLifecycle/reclaim.test.ts`.
- `encryption.ts` — AES-GCM helpers (base64 ciphertext) keyed off `FIELD_ENCRYPTION_SECRET`
- `linkPreview.ts` — URL metadata extraction for link preview cards
- `roles.ts` — Role hierarchy and permission checks
- `membership.ts` — Membership creation and atomic role updates
- `localeSync.ts` — Per-user locale persistence
- `sla.ts` — SLA breach worker and per-ticket state computation
- `storage.ts` — Storage adapter (Local / AzureBlob) for uploads
- `exifStrip.ts` / `uploadOwnership.ts` — Upload security (EXIF/GPS stripping + per-message ownership lookup)
- `messageQueries.ts` / `partnerQueries.ts` / `ticketQueries.ts` / `userQueries.ts` — Data-access query helpers
- **Subdirectories** (each owns its own ports/adapters and tests):
  - `auth/` — `authSession`, `refreshToken`, `sessionRevocation`, `actor`, `jwt` helpers (barrel export via `index.ts`)
  - `ai/` — Multi-provider AI service layer (see below)
  - `availability/` — Agent online/away tracking, hour-bucketed online seconds, status transition log
  - `dashboard/` — Per-zone deep services: `scorecard` (+`slaColor`), `staffingHeatmap`, `deptBreakdown`, `staffBreakdown`, `trends`, `onboarding`. Each pairs a pure transform with a thin `*Queries.ts` Drizzle layer.
  - `messageLifecycle/` — `send` / `edit` / `delete` / `react` (with `guardAudit`, `ports`, `types`)
  - `ticketLifecycle/` — `create` / `assign` / `transfer` / `close` / `leave` / `returnToQueue` / `reclaim` / `messages` / `audit` / `applyEffects`
  - `moderator/` — Content moderation pipeline (replaces the old `guards.ts`): `policy`, `repetition`, `instance`

**AI Service Layer** (`server/services/ai/`):
- `factory.ts` — Provider factory (Azure OpenAI, OpenAI-compatible)
- `azure-openai.ts` / `openai-compatible.ts` — Provider implementations with streaming + transcription
- `config.ts` / `types.ts` — AI configuration and shared types (`AiAction = 'classify' | 'suggest' | 'improve' | 'translate' | 'match_canned' | 'transcribe'`)
- `prompts.ts` — Prompt templates per action
- `runAction.ts` — Unified action runner with error handling, audit emission, rate limiting
- `rateLimit.ts` — Per-partner AI rate limiting
- `usage.ts` — AI usage tracking and logging (writes `ai_usage_log`)
- `auditConfig.ts` / `auditVerbosity.ts` — Per-partner audit verbosity (`hash` / `metadata` / `full`)
- `piiRedaction.ts` — Strips PII before sending prompts to providers
- `promptCustomization.ts` — Per-partner prompt overrides
- `cannedTranslation.ts` — Per-canned-response translation (admin-curated)
- `bulkHistoryPrewarm.ts` — Bulk-prewarm Redis translation cache for an entire ticket history window on `support:join`. Concurrency-bounded (3) and budget-capped (8000ms); per-msg silent fail to client lazy fallback. Replaces the older msg-#1-only path.
- `translateCache.ts` / `translateGuards.ts` — Translation caching + skip rules
- `messageFormatter.ts` — Message formatting for AI context
- `context.ts` — `AiContext` dependency injection (wired at boot)
- `index.ts` — Barrel exports (enforced by lint)
- `validateUrl.ts` — AI endpoint URL validation

**Socket.io** (`server/socket/`):
- `handlers.ts` — Orchestrator that registers domain handler modules. Uses Redis adapter for horizontal scaling.
- `handlers/auth.ts` — `socket:identify` and auth/expiry handlers
- `handlers/message.ts` — `message:send`, `message:read`, `message:edit`, `message:delete`, `message:delivered`, `message:react`
- `handlers/ticket.ts` — `ticket:new`, `ticket:close`, `ticket:transfer`, `ticket:labels:update`
- `handlers/presence.ts` — `typing:start`, `typing:stop`, `status:set`, `support:join`, `support:leave`
- `handlers/collision.ts` — `ticket:viewing`, `ticket:left` (collision detection)
- `handlers/rating.ts` — `rating:submit`
- `handlers/disconnect.ts` — Cleanup on socket disconnect
- `handlers/preview.ts` — Live link-preview pushes for compose-area URLs
- `handlers/types.ts` — Shared types and guards (`requireIdentified`, `requirePartnerScope`)
- `partnerScope.ts` — Partner-scoped room helpers and authorization guards for socket events.
- Identity enforced server-side via `socket.data.userId` — never trust client-supplied identity fields.
- Key events: `socket:identify`, `message:send`, `message:read`, `message:edit`, `message:delete`, `message:delivered`, `ticket:new`, `ticket:close`, `ticket:transfer`, `ticket:labels:update`, `ticket:viewing`, `ticket:left`, `support:join`, `support:leave`, `typing:start`, `typing:stop`, `status:set`, `rating:submit`
- All mutation events verify partner-scope authorization before proceeding.
- **Token expiry**: JWT `exp` is stored at handshake and checked on every event via `requireIdentified()`. Expired tokens trigger `auth:expired` → client auto-reconnects (cookies sent automatically via `withCredentials: true`).

**Middleware** (`server/middleware/`):
- `auth.ts` — JWT verification (reads HttpOnly cookie only, no Bearer header) and role-based access control
- `validator.ts` — Express-validator wrapper
- `uploadProxy.ts` — Authenticated upload proxy (JWT gate + per-message partner-ownership lookup) for the `/uploads` path

### Database

**PostgreSQL 18** via **Drizzle ORM** (schema: `server/db/schema.ts`, config: `server/drizzle.config.ts`). 25 tables — authoritative column reference in `schema.ts`.

Core tables: `users`, `partners`, `memberships`, `tickets`, `messages`, `labels`, `ticket_labels`, `ratings`, `app_feedback`, `canned_responses`, `saved_views`, `system_settings`, `partner_group_mappings`. Audit/archive: `audit_log`, `audit_archive`, `archived_tickets`. AI: `ai_prompt_templates`, `ai_usage_log`, `daily_ai_usage`, `ai_feedback`. Auth: `refresh_tokens`. Stats: `daily_stats`, `agent_status_log`, `daily_agent_status`. SLA: `sla_breaches`.

### Client (`client/src/`)

**Stack**: React 19, Vite 8, Tailwind CSS 4, Zustand 5.

**State**: Zustand store with slices (`auth`, `tickets`, `messages`, `ui`, `config`, `rating`) in `store/useStore.ts`. Session expiry is detected via the `session_expires` cookie (non-HttpOnly companion to the JWT HttpOnly cookie).

**Real-Time**: `hooks/useSocket.ts` — single global Socket.io instance. Always clean up listeners in `useEffect` return.

**Token Refresh**: `hooks/useTokenRefresh.ts` — proactive access token refresh via `POST /api/v1/auth/refresh`. Timer-based with visibility change detection for tab sleep/resume.

**Navbar**: All 4 views share a unified navbar pattern. Left side: `GUICHET | ROLE_BADGE | PARTNER_NAME` (text only, no logos). Right side: view-specific items + a settings affordance + `UserMenuChip` (avatar initials, identity/actions dropdown — lives in `components/ui/`).

**Views**:
- `PlatformView` — Thin shell (tabs + modal state). Feature modules in `components/platform/`. Each component owns its own tRPC hooks and cache invalidation.
- `AdminView` — Partner admin: dashboard (zone redesign in `components/admin/dashboard/` — onboarding mode + Scorecard / Staffing fit / Trends / Breakdown tables), team, departments, tickets, archive, feedback, labels, canned responses, business hours. (Legacy Alerts, Stats, and Knowledge Base tabs were removed end-to-end.)
- `SupportView` — Support staff: ticket queue by department, multi-tab chat, ticket sidebar with customer info + AI tools
- `AgentView` — End-user: ticket creation, chat, attachments
- `LoginView` — Auth flow: Azure SSO button (primary) + partner selection

**Component Directories**:
- `components/ui/` — Design-system primitives: Avatar, Button, Card, FormModal, Modal, Pill, SectionLabel, SidebarNav, Toast, ToastProvider, UserMenuChip
- `components/platform/` — PlatformView feature modules: PartnerList, UserTable, CreatePartnerModal, DeletePartnerModal, EditPartnerModal, GroupMappingsPanel, PlatformSecurity
- `components/admin/` — AdminView panels: AdminAi, AdminArchive, AdminAuditLog, AdminBusinessHours, AdminCannedResponses, AdminDepartments, AdminFeedback, AdminLabels, AdminSatisfaction, AdminTeam, AdminTickets, AuditMetadataDrawer, CrossPartnerActivityPanel, DashboardHelpers, ErrorBox, MemberAuditDrawer, PlatformArchiveViewer, PlatformAuditLog, PlatformSystemHealth, TicketAuditDrawer
- `components/admin/dashboard/` — DashboardView (shell + onboarding gate), FilterBar, Scorecard, StaffingHeatmapZone, TrendsZone, DeptBreakdownTable, StaffBreakdownTable, OnboardingChecklist
- `components/agent/` — AgentChatHeader, AgentTicketContextPanel, TicketForm
- `components/support/` — AgentBadges, ArchiveTicketRow, ChatTabBar, CommandPalette, KeyboardShortcutsModal, LangBadge, QueueSidebar, QueueTicketRow, SavedViewPicker, SidebarFooter, SplitChatLayout, TicketPreviewCard, TicketSidebar, ViewModeDropdown
- `components/chat/` — Decomposed chat sub-components: AttachmentGrid, ChatHeader, ComposeArea, DeliveryStatus, EmojiSuggestion, FormatToolbar, ImageLightbox, ImproveDiffModal, LinkPreviewCard, Message, MessageContent, MessageList, QuoteBlock, SearchBar
- `utils/` — `statusColors.ts`, `dateUtils.ts`, `markdown.ts`, `fileUtils.ts`, `dashboardExport.ts`, `dashboardDateRange.ts`, `slaColor.ts`, `labelColors.ts`, `highlightText.tsx`, `businessHours.ts`, `notifications.ts`, `notificationSound.ts`, `roles.ts`, `trpc.ts`
- Shared (`components/`): BionicText, BusinessHoursGuard, CannedResponsePicker, ChatWindow, ConfirmDialog, ConnectionStatus, DarkModeToggle, ErrorBoundary, FeedbackModal, FieldError, LanguageSwitcher, LegalModal, PartnerUnavailable, RatingModal, ResizablePanel, SlaIndicator, SystemBackground, TicketPreview, TimezonePicker, Toast

**Aesthetics**: Soft Product design (calm, polished, dense). Indigo accent (`#5b5bd6` light / `#8b8cff` dark) as v1 fixed accent; future work exposes a per-user or per-partner accent picker. Inter is the default font everywhere; JetBrains Mono is scoped to code blocks, inline code, and ticket IDs only. Subtle shadows (`--shadow-soft` / `--shadow-card` / `--shadow-modal`), soft radii (14 card / 8 button / 999 pill / 12 bubble). Purposeful motion only: `fade-in` 150ms, `v2p-slide-in` 260ms (new messages, toasts), `v2p-pop` 180ms (modal cards), `v2p-pulse` 1.8s (unread badges), `v2p-dot` 1s (typing), theme transition 200ms. Respect `prefers-reduced-motion`. Tokens in `client/src/index.css`; full spec at `docs/SOFT_PRODUCT_DESIGN_SPEC.md`.

## Key Conventions

- **Roles**: `agent`, `support`, `admin`, `platform_operator`
- **Multi-Tenancy**: Every query must include `partner_id` filter. No data leaks between partners. tRPC procedures derive `partnerId` from JWT context (`partnerScopedProcedure`). Platform operators cross tenants only via `platform.*` endpoints or by calling `POST /enter-partner` to mint a JWT with the target `partnerId`. No non-platform endpoint accepts cross-tenant input — only `server/trpc/routers/support.ts` and `server/trpc/routers/platform/**` are allowlisted to take a client-supplied `partnerId`. The guard at `server/scripts/check-trpc-tenant-isolation.mjs` enforces this and runs in `scripts/ci.ps1`.
- **Multi-Partner Users**: Users belong to multiple partners via `memberships`. One active partner at a time — switching issues a new JWT cookie via `/switch-partner`.
- **Cookie-Only Auth**: JWTs are transported exclusively via `HttpOnly SameSite=Lax` cookies (`guichet_token`). No Bearer header support. Client uses `credentials: 'include'` on all requests. A companion `session_expires` cookie (non-HttpOnly) carries the expiry timestamp for client-side detection. Config: `COOKIE_SECURE` (default `true`), `COOKIE_DOMAIN` (optional, for subdomains).
- **Refresh Tokens**: Short-lived access tokens (`ACCESS_TOKEN_EXPIRY`, default 15m) paired with rotating refresh tokens (`REFRESH_TOKEN_EXPIRY`, default 7d) in `guichet_refresh` HttpOnly cookie (path-restricted to `/api/v1/auth/refresh`). `useTokenRefresh` hook auto-refreshes ~2min before expiry, handles tab sleep/resume. Family-based reuse detection: replaying a used refresh token revokes the entire token family. Session revocation also revokes all refresh tokens.
- **Partner Status**: `active` | `inactive`. Inactive blocks logins, ticket creation, switching. Enforce at login, switch-partner, socket, and tRPC layers.
- **Dynamic Departments**: Never hardcode department IDs. Always read from `partner.departments` JSONB. Schema: `{ id (auto-slug), name, description? }`. IDs are immutable.
- **Department Assignment**: `memberships.departments` is a JSONB array of dept IDs. Empty/null = generalist (sees all).
- **TypeScript**: No `any` types. Zod schemas on backend, TypeScript interfaces in `client/src/types/index.ts`.
- **SSO-Only Auth**: All logins go through Azure SSO. The `users` table has no password, MFA, lockout, or step-up columns. Emergency access uses the break-glass CLI (`server/scripts/break_glass.ts`) which mints a short-lived JWT for a platform operator and audits `auth.break_glass`.
- **Audit Logging**: All significant actions (partner lifecycle, user management, GDPR purges, break-glass JWT mints) recorded in `audit_log`.
- **WORM Archive**: Tamper-evident SHA-256 hash chain for audit log. Automatic archival before GDPR purge. Chain integrity verification endpoint. Tickets archived with message count summary.
- **Audit Observability**: Multi-axis filtering (targetType / targetId / actor / date / partner) in platform + partner audit views; metadata drawer with diff + severity + deep-linkable URL params; cross-partner activity rollup (`trpc.platform.getCrossPartnerActivity`); ticket-scoped audit drawer via `services/ticketAudit.ts`; chain-verify UI with server-persisted history + CSV export; chain-broken webhook side-channel. In-app tripwires surfaced on the Health page in PlatformView (5-min poll + socket push for instant tamper notification): `chainBroken`, `chainStale` (>25h), `slaBreachBurst` (≥5/h), GDPR purge missing/failed. Runbook: `docs/AUDIT_RUNBOOK.md`.
- **Cursor-Based Pagination**: Ticket list and audit archive use keyset pagination (`createdAt|id` composite cursor). Pattern: fetch `limit+1`, detect hasMore, return `{ items, nextCursor }`.
- **Platform Operator Bootstrap**: On first startup with no platform operators, auto-creates one from `PLATFORM_ADMIN_EMAIL` env var. Runs before server accepts traffic. Race-safe, non-fatal. Subsequent logins for that operator go through SSO.
- **Platform Operator Partner Access**: Platform operators can enter any active partner's admin view via `POST /enter-partner` without needing a membership. Socket auth bypasses membership check for operators.
- **AI Provider Abstraction**: Multi-provider AI via factory pattern (`server/services/ai/`). Uses `AiContext` dependency injection (wired at boot) — all AI modules import from the barrel `index.ts`, never directly. Supports Azure OpenAI and OpenAI-compatible APIs. Per-partner AI config (`aiEnabled`, `aiFeatures` JSONB) controls feature availability. Available `AiAction`s: `improve` (message improvement, optional/forced modes with revert), `translate` (cached, with skip rules), `transcribe` (voice dictation), `classify`, `suggest`, `match_canned`. Rate limiting and usage logging per partner; per-partner audit verbosity (`hash` / `metadata` / `full`); PII redaction before prompts leave the server.
- **SLA**: Per-department first-response SLA (`sla_breaches` table + `tickets.first_staff_response_at`). Config in `AdminDepartments` (toggle + threshold minutes + warn%). Breach worker sweeps every `SLA_SWEEP_INTERVAL_MS` (default 60000, set to 0 to disable). `SlaIndicator` badge in ChatHeader; red left-border in QueueSidebar. Business-hours-aware counter. Burst alert (≥5 breaches/h) surfaces on the platform Health page.
- **CSAT Ratings**: Post-close ticket ratings (`ratings` table) with staff-facing analytics and date filtering. Feedback system (`app_feedback` table) for in-app user feedback.
- **Collision Detection**: `ticket:viewing` / `ticket:left` socket events track who's viewing a ticket. Viewer badges and typing indicators prevent duplicate responses.
- **Agent Status Visibility**: 2 statuses (online/away) with color tokens (`accent-green` for online, `accent-amber` for away). Auto-away after 5 minutes idle (via `useIdleStatus` hook), auto-online on activity. Status persists in Redis across reconnects (Lua script preserves status on re-identify). Visible in `QueueSidebar` (team panel) and `AdminTeam` (status column). Time-in-status tracked in `agent_status_log`, rolled up hourly to `daily_agent_status` (`onlineSeconds`, `awaySeconds`, `hourlyOnlineSeconds`). Stats via `trpc.status.*` (`getTeamStatus`, `getAgentStats`, `getTeamStats`). GDPR: log purged at 30 days, daily rollup retained as aggregate.
- **Field-Level Encryption**: `services/encryption.ts` provides AES-GCM helpers (base64 ciphertext) keyed off `FIELD_ENCRYPTION_SECRET`. Used for AI provider API keys (`partners.ai_config.encryptedApiKey`) — DB dumps don't leak credentials. Re-encryption helper at `server/scripts/rotate_encryption_key.ts`.
- **Invite Flow**: Pre-provisioning is SSO-only — partner-side invite mutations were removed. New users surface automatically when an Azure SSO callback resolves them to a partner via group mappings. Removing a user from a partner revokes their sessions + refresh-token family immediately. The 7-day `INVITE_TTL_DAYS` window in `routes/sso.ts` only governs how long a pre-created invite row can be claimed by a new SSO email match.
- **Department Transfer**: Tickets transfer between department queues (not individual agents). Socket event `ticket:transfer` accepts `{ ticketId, departmentId?, note? }`. Optional whisper note for context handoff. Clears support assignment, re-opens ticket, removes all support sockets from room. Service layer: `services/ticketLifecycle/transfer.ts` + `services/ticketLifecycle/messages.ts` (whisper insert).

## Production Hardening

`config.ts` enforces safety checks when `NODE_ENV=production`. Dev is unaffected.

| Check | Level | Behavior |
|---|---|---|
| `CORS_ORIGIN` contains `localhost` | FATAL | Server exits |
| `FRONTEND_URL` contains `localhost` | FATAL | Server exits |
| `COOKIE_SECURE=false` | FATAL | Server exits |
| `DISABLE_RATE_LIMIT=true` | FATAL | Server exits |
| `REDIS_URL` without auth | WARN | Logs warning |

## Critical Mandates

- **SOFT PRODUCT TOKENS**: Use CSS custom property design tokens from `index.css`. No hex literals in components — reference `var(--color-*)`, `var(--shadow-*)`, `var(--radius-*)`. Shadows and radii are required (card 14, btn 8, pill 999, bubble 12). See `docs/SOFT_PRODUCT_DESIGN_SPEC.md`.
- **TYPOGRAPHY**: Inter is default everywhere. JetBrains Mono is **scoped** to code blocks, inline code, and ticket IDs (`#4421`). Never use mono for button chrome, labels, placeholders, badges, or timestamps in prose.
- **COMPOSE FROM PRIMITIVES**: Build new UI from `components/ui/` (`<Button>`, `<Card>`, `<Pill>`, `<Modal>`, `<FormModal>`, `<Avatar>`, `<Toast>`, `<SectionLabel>`, `<SidebarNav>`, `<UserMenuChip>`) — don't hand-roll styling.
- **MOTION**: Use documented keyframes only (`fade-in`, `v2p-slide-in`, `v2p-pop`, `v2p-pulse`, `v2p-dot`). Theme transitions at 200ms on `bg`/`color`/`border-color`. No decorative slides, bounces, or spring animations. Always respect `prefers-reduced-motion`.
- **THEME PARITY**: Every new component must render correctly in both `.dark` and default. Monochrome + dyslexic modes inherit for free when you use tokens.
- **DOCKER ONLY**: Never run `npm`/`node`/`npx` on the host.
- **TYPE SAFETY**: No `any` types. Zod on backend, TypeScript on frontend.
- **MULTI-TENANCY**: Every query must filter by `partner_id`.
- **DYNAMIC DEPT**: Never hardcode department IDs.
- **AUDIT LOGGING**: Log all security-relevant actions.
- **TESTING**: No render-only smoke tests. Every test must assert real behavior (interactions, validation, state changes, error handling, security boundaries). Server tests should focus on security boundaries, data integrity, and multi-tenant isolation.

## Project Structure

```
guichet/
├── server/           # Express + tRPC + Socket.io backend
│   ├── db/           # schema.ts (28 tables), postgres.ts
│   ├── trpc/         # router.ts + 19 domain routers + middleware
│   ├── socket/       # handlers/ (auth, message, ticket, presence, collision, rating, disconnect, preview)
│   ├── routes/       # auth/ (session, rateLimit), sso.ts, uploads.ts, tickets.ts, aiTranscribe.ts
│   ├── services/     # Business logic + auth/ ai/ availability/ dashboard/ messageLifecycle/ ticketLifecycle/ moderator/
│   ├── scripts/      # break_glass, baseline_drizzle, backup, rotate_encryption_key, backfill_agent_hourly, check-trpc-tenant-isolation
│   ├── middleware/   # auth.ts, validator.ts, uploadProxy.ts
│   └── utils/        # logger, redis, security, taskRunner, trpcErrors, rooms, messageMapper, commonPasswords, assertNotProduction
├── client/src/
│   ├── components/   # ui/ (primitives), platform/, admin/ (+ dashboard/), agent/, support/, chat/, shared
│   ├── views/        # PlatformView, AdminView, SupportView, AgentView, LoginView
│   ├── hooks/        # useSocket, useTokenRefresh, useIdleStatus, useTheme, etc.
│   ├── store/        # Zustand slices (auth, tickets, messages, ui, config, rating)
│   ├── types/        # index.ts
│   └── utils/        # trpc.ts, dateUtils, markdown, fileUtils, statusColors, etc.
├── docs/             # AUDIT_RUNBOOK, BREAK_GLASS_RUNBOOK, SOFT_PRODUCT_DESIGN_SPEC, TECHNICAL, SSO_SETUP_RUNBOOK, AZURE_DEPLOYMENT, AI_ACT_AUDIT, HANDOVER, USER_GUIDE
├── testing/          # load/ (k6 scripts), nginx.conf
└── scripts/ci.ps1    # Local CI runner
```

## Local CI

Run `scripts/ci.ps1` to check everything before pushing:

```powershell
powershell -File scripts/ci.ps1                # Run all checks
```

| Step | What it checks |
|------|----------------|
| `typecheck` | `tsc --noEmit` on both server and client |
| `tenant-isolation-guard` | `check-trpc-tenant-isolation.mjs` blocks non-allowlisted client-supplied `partnerId` |
| `lint` | `eslint` on both server and client |
| `audit` | `npm audit --audit-level=high` on both server and client |
| `test-server` | Server unit tests (Vitest + node) |
| `test-client` | Client unit tests (Vitest + jsdom) |
| `migrate` | Runs `drizzle-kit migrate` against the Docker Postgres |
| `build` | `vite build` for the client |

## Load Testing

k6 scripts in `testing/load/`. Run via Docker:

```bash
MSYS_NO_PATHCONV=1 docker run --rm -e K6_BASE_URL=http://host.docker.internal:3001 -v "$(pwd)/testing/load:/scripts" grafana/k6 run /scripts/smoke.js
MSYS_NO_PATHCONV=1 docker run --rm -e K6_BASE_URL=http://host.docker.internal:3001 -v "$(pwd)/testing/load:/scripts" grafana/k6 run /scripts/refresh.js
```

| Script | VUs | Duration | Tests |
|--------|-----|----------|-------|
| `smoke.js` | 1 | 30s | health, login, ticket.list, refresh |
| `load.js` | 50 | 3m | random mix of endpoints under sustained load |
| `refresh.js` | 5 | 30s | login once per VU, then continuous refresh token rotation |
| `ws.js` | 10 | 1m | WebSocket/Socket.io connections with Engine.IO framing |
| `ws-500.js` | 500 | — | Ramp to 500 concurrent WebSocket connections |
| `debug.js` | 1 | — | Quick single-request debugging helper |

## Debugging

- **Server logs**: `docker logs -f guichet-server-1`
- **Client logs**: Browser DevTools → Console
- **Socket events**: Browser DevTools → Network → WS tab
- **Database**: `docker compose exec server npx drizzle-kit studio`
- **Zustand state**: Redux DevTools browser extension
- **API docs**: Swagger at `/api/v1/docs/`, tRPC reference at `/api/v1/trpc-reference`

# context-mode — MANDATORY routing rules

You have context-mode MCP tools available. These rules are NOT optional — they protect your context window from flooding. A single unrouted command can dump 56 KB into context and waste the entire session.

## BLOCKED commands — do NOT attempt these

### curl / wget — BLOCKED
Any Bash command containing `curl` or `wget` is intercepted and replaced with an error message. Do NOT retry.
Instead use:
- `ctx_fetch_and_index(url, source)` to fetch and index web pages
- `ctx_execute(language: "javascript", code: "const r = await fetch(...)")` to run HTTP calls in sandbox

### Inline HTTP — BLOCKED
Any Bash command containing `fetch('http`, `requests.get(`, `requests.post(`, `http.get(`, or `http.request(` is intercepted and replaced with an error message. Do NOT retry with Bash.
Instead use:
- `ctx_execute(language, code)` to run HTTP calls in sandbox — only stdout enters context

### WebFetch — BLOCKED
WebFetch calls are denied entirely. The URL is extracted and you are told to use `ctx_fetch_and_index` instead.
Instead use:
- `ctx_fetch_and_index(url, source)` then `ctx_search(queries)` to query the indexed content

## REDIRECTED tools — use sandbox equivalents

### Bash (>20 lines output)
Bash is ONLY for: `git`, `mkdir`, `rm`, `mv`, `cd`, `ls`, `npm install`, `pip install`, and other short-output commands.
For everything else, use:
- `ctx_batch_execute(commands, queries)` — run multiple commands + search in ONE call
- `ctx_execute(language: "shell", code: "...")` — run in sandbox, only stdout enters context

### Read (for analysis)
If you are reading a file to **Edit** it → Read is correct (Edit needs content in context).
If you are reading to **analyze, explore, or summarize** → use `ctx_execute_file(path, language, code)` instead. Only your printed summary enters context. The raw file content stays in the sandbox.

### Grep (large results)
Grep results can flood context. Use `ctx_execute(language: "shell", code: "grep ...")` to run searches in sandbox. Only your printed summary enters context.

## Tool selection hierarchy

1. **GATHER**: `ctx_batch_execute(commands, queries)` — Primary tool. Runs all commands, auto-indexes output, returns search results. ONE call replaces 30+ individual calls.
2. **FOLLOW-UP**: `ctx_search(queries: ["q1", "q2", ...])` — Query indexed content. Pass ALL questions as array in ONE call.
3. **PROCESSING**: `ctx_execute(language, code)` | `ctx_execute_file(path, language, code)` — Sandbox execution. Only stdout enters context.
4. **WEB**: `ctx_fetch_and_index(url, source)` then `ctx_search(queries)` — Fetch, chunk, index, query. Raw HTML never enters context.
5. **INDEX**: `ctx_index(content, source)` — Store content in FTS5 knowledge base for later search.

## Subagent routing

When spawning subagents (Agent/Task tool), the routing block is automatically injected into their prompt. Bash-type subagents are upgraded to general-purpose so they have access to MCP tools. You do NOT need to manually instruct subagents about context-mode.

## Output constraints

- Keep responses under 500 words.
- Write artifacts (code, configs, PRDs) to FILES — never return them as inline text. Return only: file path + 1-line description.
- When indexing content, use descriptive source labels so others can `ctx_search(source: "label")` later.

## ctx commands

| Command | Action |
|---------|--------|
| `ctx stats` | Call the `ctx_stats` MCP tool and display the full output verbatim |
| `ctx doctor` | Call the `ctx_doctor` MCP tool, run the returned shell command, display as checklist |
| `ctx upgrade` | Call the `ctx_upgrade` MCP tool, run the returned shell command, display as checklist |
