# CLAUDE.md

Guidance for Claude Code when working with the Guichet codebase.

## Project Overview

Guichet is a real-time, multi-tenant live chat platform with a soft-product design system (calm, polished, dense; three-panel workspace). CSS custom property tokens drive the entire UI (light/dark mode), self-hosted Inter + JetBrains Mono + Lexend fonts, zero external CDN dependencies.

## Commands

### Docker (Preferred Runtime)

> **NEVER** run `npm`, `node`, or `npx` directly on the host machine. All commands must go through Docker.

```bash
docker compose up                                          # Start all services (db, server, client, redis, lb, prometheus, grafana)
docker compose exec server npm test                        # Run server tests
docker compose exec client npm test                        # Run client tests
docker compose exec server npx drizzle-kit push            # Database push
docker compose exec server npx drizzle-kit generate        # Generate migration
docker compose exec server npx drizzle-kit studio          # Interactive database explorer
docker logs -f guichet-server-1                            # Server logs
docker logs -f guichet-client-1                            # Client logs
```

### Database Management

```bash
npm run db:migrate                    # Apply pending Drizzle migrations
npm run db:baseline                   # Seed migration ledger for existing DBs (one-time, interactive)
npm run db:backup                     # Dump DB to server/backups/ (gzipped, auto-prunes to 10)
npm run db:backup:docker              # Same, but from Docker 'db' container
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

### Seed Script

```bash
docker compose exec server npx tsx seed.ts                       # Truncate all tables (clean slate)
```

The seed script truncates all tables. The platform operator is auto-created by the bootstrap service on server startup from `PLATFORM_ADMIN_EMAIL` env var. All production logins go through Azure SSO (see `server/routes/sso.ts`). The only way to mint a JWT without SSO is the break-glass CLI (`server/scripts/break_glass.ts`) — see `docs/BREAK_GLASS_RUNBOOK.md`.

## Architecture

### Server (`server/`)

**API Layer**:
- **tRPC (Primary)**: tRPC 11 for all data fetching and mutations. Router: `server/trpc/router.ts`. 17 domain routers in `server/trpc/routers/`: `ai`, `alerts`, `cannedResponse`, `feedback`, `kb`, `label`, `message`, `partner`, `platform`, `presence`, `rating`, `savedView`, `stats`, `status`, `ticket`, `user`, `webhook`. Input validation via Zod.
- **Express Routes**: Auth (`server/routes/auth/` — dev-login + session only), SSO (`server/routes/sso.ts`), Uploads (`server/routes/uploads.ts`), Tickets (`server/routes/tickets.ts`).
- **API Docs**: Swagger UI at `/api/v1/docs/` (REST), tRPC reference at `/api/v1/trpc-reference`.

**tRPC Middleware** (`server/trpc/trpc.ts`):
- `publicProcedure` → `protectedProcedure` → `adminProcedure` / `platformProcedure`
- `roleProcedure(roles[])` for dynamic role checks (platform operators bypass all role gates)

**Services** (`server/services/`):
- `bootstrap.ts` — First-run platform operator creation from `PLATFORM_ADMIN_EMAIL` env var
- `gdpr.ts` — Daily purge and per-partner aggregation (30-day retention)
- `archive.ts` — WORM audit archive (SHA-256 hash chain) + ticket archiving with summary metadata
- `guards.ts` — Content moderation pipeline (length, caps, repetition, injection, swearing, threats, discrimination)
- `businessHours.ts` — Business hours enforcement and queue position broadcasting
- `presence.ts` — User online/offline tracking via Redis, status persistence across reconnects
- `statusTracking.ts` — Agent status transition logging, daily rollup aggregation, time-in-status queries
- `transferService.ts` — Department-based ticket transfer (findPartnerDepartments, transferTicketToDepartment)
- `stats.ts` — Live statistics computation for dashboard (Recharts)
- `authSession.ts` — Auth session management and token lifecycle
- `roles.ts` — Role hierarchy and permission checks
- `sessionRevocation.ts` — Session revocation on security changes (also revokes refresh tokens)
- `refreshToken.ts` — Rotating refresh token lifecycle (create, rotate, revoke family, reuse detection)
- `repetitionStore.ts` — Message repetition detection for guards
- `webhookDispatch.ts` — Webhook event dispatch to partner-configured endpoints
- `encryption.ts` — Field-level encryption utilities
- `systemMessage.ts` — System/whisper message insertion (used by transfers, auto-actions)
- `linkPreview.ts` — URL metadata extraction for link preview cards
- `ticketAudit.ts` — Ticket lifecycle audit emitter (created / assigned / transferred / closed / reopened). Writes `ticket.*` actions into `audit_log`; partner audit router and platform audit view filter them out by default to keep security-relevant rows uncluttered.
- `chainVerifySchedule.ts` — Scheduled daily WORM chain-integrity verification. Results persist to the chain-verify history table for CSV compliance-attestation export (UI in `PlatformSystemHealth`).
- `ticketReclaim.ts` — Crash-recovery path for tickets left mid-assign; behavioral coverage in `ticketReclaim` test.
- `messageQueries.ts` / `partnerQueries.ts` / `ticketQueries.ts` / `userQueries.ts` — Data-access query helpers (shared by tRPC routers and services)

**AI Service Layer** (`server/services/ai/`):
- `factory.ts` — Provider factory (Ollama, Azure OpenAI, OpenAI-compatible)
- `ollama.ts` / `azure-openai.ts` / `openai-compatible.ts` — Provider implementations with streaming
- `config.ts` / `types.ts` — AI configuration and shared types
- `prompts.ts` — Prompt templates for improvement, summarization, translation
- `autoSummarize.ts` — Auto-summarize on ticket close
- `runAction.ts` — Unified action runner with error handling
- `rateLimit.ts` — Per-partner AI rate limiting
- `usage.ts` — AI usage tracking and logging
- `summaryCache.ts` — Redis-backed summary caching
- `messageFormatter.ts` — Message formatting for AI context
- `ticketMessages.ts` — Ticket message retrieval for AI operations
- `context.ts` — AiContext dependency injection (replaces direct imports; wired at boot)
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
- `handlers/types.ts` — Shared types and guards (`requireIdentified`, `requirePartnerScope`)
- `partnerScope.ts` — Partner-scoped room helpers and authorization guards for socket events.
- Identity enforced server-side via `socket.data.userId` — never trust client-supplied identity fields.
- Key events: `socket:identify`, `message:send`, `message:read`, `message:edit`, `message:delete`, `message:delivered`, `ticket:new`, `ticket:close`, `ticket:transfer`, `ticket:labels:update`, `ticket:viewing`, `ticket:left`, `support:join`, `support:leave`, `typing:start`, `typing:stop`, `status:set`, `rating:submit`
- All mutation events verify partner-scope authorization before proceeding.
- **Token expiry**: JWT `exp` is stored at handshake and checked on every event via `requireIdentified()`. Expired tokens trigger `auth:expired` → client auto-reconnects (cookies sent automatically via `withCredentials: true`).

**Middleware** (`server/middleware/`):
- `auth.ts` — JWT verification (reads HttpOnly cookie only, no Bearer header) and role-based access control
- `validator.ts` — Express-validator wrapper
- `metrics.ts` — Prometheus metrics collection (request duration, status codes)

### Database

**PostgreSQL 18** via **Drizzle ORM** (schema: `server/db/schema.ts`, config: `server/drizzle.config.ts`).

| Table | Purpose | Key Columns |
|---|---|---|
| `users` | Global user accounts | `id`, `email`, `externalId` (Azure OID), `lang` (nl/fr/en), `isPlatformOperator` |
| `partners` | Tenant organizations | `id`, `name`, `status` (active/inactive), `departments` (JSONB), `industry` |
| `memberships` | User-Partner junction | `userId`, `partnerId`, `role`, `departments` (JSONB array of dept IDs) |
| `tickets` | Support tickets | `id`, `partnerId`, `agentId`, `status` (open/pending/closed/resolved), `participants` (JSONB) |
| `messages` | Per-ticket messages | `ticketId`, `senderId`, `body`, `whisper`, `reactions` (JSONB), `editedAt`, `deletedAt` |
| `daily_stats` | Aggregated metrics | `date`, `partnerId` (composite PK), per-partner daily stats |
| `audit_log` | Security/audit trail | `action`, `actorId`, `partnerId`, `targetType`, `targetId`, `metadata` (JSONB) |
| `audit_archive` | WORM audit archive | SHA-256 `chainHash`, `archivedAt`, same fields as audit_log |
| `archived_tickets` | Ticket archive | Ticket summary + `messageCount`, `archivedAt`, no message content |
| `labels` | Ticket labels | `partnerId`, `name`, `color` |
| `ticket_labels` | Ticket↔Label junction | `ticketId`, `labelId` |
| `canned_responses` | Per-partner response templates | `partnerId`, `title`, `body`, `shortcut`, `category`, `createdBy` |
| `ratings` | Ticket CSAT ratings | `ticketId`, `rating`, `comment` |
| `app_feedback` | In-app user feedback | `userId`, `partnerId`, `type`, `body` |
| `system_settings` | Global system configuration | `key`, `value` (singleton KV store) |
| `topic_alerts` | Topic alert rules (incident clustering) | `partnerId`, `type`, `threshold`, `recipients` |
| `partner_group_mappings` | SSO group→role mappings | `partnerId`, `ssoGroup`, `role`, `departments` |
| `kb_articles` | Knowledge base articles | `partnerId`, `title`, `body`, `category`, `createdBy` |
| `webhooks` | Partner webhook configs | `partnerId`, `url`, `events`, `secret`, `active` |
| `webhook_logs` | Webhook delivery logs | `webhookId`, `event`, `status`, `responseCode` |
| `ai_prompt_templates` | Custom AI prompt templates | `partnerId`, `action`, `template` |
| `ai_usage_log` | AI provider usage tracking | `partnerId`, `action`, `provider`, `tokens`, `cost` |
| `daily_ai_usage` | Aggregated AI usage (rolled up from ai_usage_log) | `date`, `partnerId`, `action`, `provider`, `model`, `totalRequests` |
| `refresh_tokens` | Rotating refresh tokens | `userId`, `tokenHash` (SHA-256), `family`, `expiresAt`, `revokedAt` |
| `saved_views` | Per-user saved ticket filter views | `userId`, `partnerId`, `name`, `filters` (JSONB) |
| `agent_status_log` | Agent status transitions | `userId`, `partnerId`, `status`, `startedAt`, `endedAt`, `duration` |
| `daily_agent_status` | Daily time-in-status rollup | `date`, `userId`, `partnerId`, `onlineSeconds`, `awaySeconds` |

### Client (`client/src/`)

**Stack**: React 19, Vite 8, Tailwind CSS 4, Zustand 5.

**State**: Zustand store with slices (`auth`, `tickets`, `messages`, `ui`, `config`, `rating`) in `store/useStore.ts`. Session expiry is detected via the `session_expires` cookie (non-HttpOnly companion to the JWT HttpOnly cookie).

**Real-Time**: `hooks/useSocket.ts` — single global Socket.io instance. Always clean up listeners in `useEffect` return.

**Token Refresh**: `hooks/useTokenRefresh.ts` — proactive access token refresh via `POST /api/v1/auth/refresh`. Timer-based with visibility change detection for tab sleep/resume.

**Navbar**: All 4 views share a unified navbar pattern. Left side: `GUICHET | ROLE_BADGE | PARTNER_NAME` (text only, no logos). Right side: view-specific items + `SettingsPopover` (gear icon, preference toggles) + `UserMenu` (avatar initials, identity/actions dropdown). `SettingsPopover` accepts boolean props to control which items appear per view.

**Views**:
- `PlatformView` — Thin shell (tabs + modal state). Feature modules in `components/platform/`. Each component owns its own tRPC hooks and cache invalidation.
- `AdminView` — Partner admin: team, departments, tickets, business hours, labels, canned responses, knowledge base, webhooks, alerts, feedback, stats, archive
- `SupportView` — Support staff: ticket queue by department, multi-tab chat, AI copilot sidebar
- `AgentView` — End-user: ticket creation, chat, attachments
- `LoginView` — Auth flow: Azure SSO button (primary) + dev-login picker (non-prod only) + partner selection

**Component Directories**:
- `components/platform/` — PlatformView feature modules (PartnerList, UserTable, CreatePartnerModal, DeletePartnerModal, EditPartnerModal, EditUserProfileModal, InviteUserModal, ManageAccessModal, GroupMappingsPanel)
- `components/admin/` — AdminView panels: AdminAlerts, AdminArchive, AdminBusinessHours, AdminCannedResponses, AdminDepartments, AdminFeedback, AdminKnowledgeBase, AdminLabels, AdminSatisfaction, AdminStats, AdminTeam, AdminTickets, AdminWebhooks, AgentStatusStats, DashboardHelpers, ErrorBox, PlatformAuditLog, PlatformArchiveViewer, PlatformSystemHealth
- `components/agent/` — AgentNav, AgentTicketSidebar, TicketForm
- `components/support/` — AiCopilotSidebar, ChatTabBar, CustomerInfoPanel, QueueSidebar, SavedViewPicker, SupportNav
- `components/chat/` — Decomposed chat sub-components: ChatHeader, ComposeArea, MessageList, MessageContent, AttachmentGrid, DeliveryStatus, FormatToolbar, LabelPicker, LinkPreviewCard, QuoteBlock, SearchBar
- `utils/` — `statusColors.ts`, `dateUtils.ts`, `markdown.ts`, `fileUtils.ts`, `exportDashboard.ts`, `labelColors.ts`, `highlightText.tsx`, `businessHours.ts`, `notifications.ts`, `notificationSound.ts`, `roles.ts`, `trpc.ts`
- Shared: AccessibilityMenu, BionicText, BusinessHoursGuard, CannedResponsePicker, ChatWindow, ConfirmDialog, ConnectionStatus, DarkModeToggle, ErrorBoundary, FeedbackModal, LanguageSwitcher, LegalModal, MessageBubble, NeuroToggle, PartnerSwitcher, PartnerUnavailable, RatingModal, SettingsPopover, StatusPicker, SystemBackground, TicketPreview, Toast, UserAvatar, UserMenu

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
- **SSO-Only Auth**: All production logins go through Azure SSO. The `users` table has no password, MFA, lockout, or step-up columns. Non-prod only: `/api/v1/auth/dev-login` mints JWTs by `userId` for the demo picker and Playwright suite (route returns 404 when `NODE_ENV=production`). Emergency access uses the break-glass CLI (`server/scripts/break_glass.ts`) which mints a short-lived JWT for a platform operator and audits `auth.break_glass`.
- **Azure B2B Guest Support**: Partner employees can be invited into our Azure tenant as B2B guests and log into Guichet via the existing SSO flow. The callback detects guests via the `acct === 1` or `idp` claim and stamps `users.isExternal = true`. Guests are strictly single-partner: if Azure groups resolve to more than one partner the login is rejected with `sso_error=guest_multi_partner_mapping` (audited). Destructive admin mutations (webhook CRUD + secret rotation + test, partner-member add/update/remove/invite, partner department edits) use `destructiveAdminProcedure` which throws FORBIDDEN when `isExternal=true`. UI surfaces a GUEST badge in `UserMenu`, `AdminTeam`, and `SidebarFooter` team panel. Full runbook at `docs/superpowers/specs/partner-sso-b2b-guest.md`.
- **Audit Logging**: All significant actions (partner lifecycle, user management, GDPR purges, break-glass JWT mints) recorded in `audit_log`.
- **WORM Archive**: Tamper-evident SHA-256 hash chain for audit log. Automatic archival before GDPR purge. Chain integrity verification endpoint. Tickets archived with message count summary.
- **Audit Observability**: Multi-axis filtering (targetType / targetId / actor / date / partner) in platform + partner audit views; metadata drawer with diff + severity + deep-linkable URL params; cross-partner activity rollup (`trpc.platform.getCrossPartnerActivity`); ticket-scoped audit drawer via `services/ticketAudit.ts`; chain-verify UI with server-persisted history + CSV export; chain-broken webhook side-channel. Alert rules: `AuditChainTamperDetected`, `AuditChainVerifyServiceError`, `AuditChainStaleness`, `TicketAuditEmitterSilenced` (self-arming), `GdprPurgeMissing`, `GdprPurgeChainAborted`. Metrics: `guichet_audit_chain_verify_runs_total`, `guichet_audit_chain_broken_total`, `guichet_ticket_audit_events_total`, `guichet_gdpr_purge_runs_total`, `guichet_gdpr_rows_purged_total`. Runbook: `docs/AUDIT_RUNBOOK.md`.
- **Cursor-Based Pagination**: Ticket list and audit archive use keyset pagination (`createdAt|id` composite cursor). Pattern: fetch `limit+1`, detect hasMore, return `{ items, nextCursor }`.
- **Platform Operator Bootstrap**: On first startup with no platform operators, auto-creates one from `PLATFORM_ADMIN_EMAIL` env var. Runs before server accepts traffic. Race-safe, non-fatal. Subsequent logins for that operator go through SSO.
- **Platform Operator Partner Access**: Platform operators can enter any active partner's admin view via `POST /enter-partner` without needing a membership. Socket auth bypasses membership check for operators.
- **AI Provider Abstraction**: Multi-provider AI via factory pattern (`server/services/ai/`). Uses `AiContext` dependency injection (wired at boot) — all AI modules import from the barrel `index.ts`, never directly. Supports Ollama, Azure OpenAI, and OpenAI-compatible APIs. Per-partner AI config (`aiEnabled`, `aiFeatures` JSONB) controls feature availability. Features: message improvement (optional/forced modes with revert), chat summarization (Redis-cached), translation, auto-summarize on close. Rate limiting and usage logging per partner.
- **Knowledge Base**: Per-partner KB articles (`kb_articles` table). CRUD via `trpc.kb.*`. Admin UI in `AdminKnowledgeBase`.
- **Webhooks**: Per-partner webhook endpoints (`webhooks` table) with event subscriptions, HMAC signing, delivery logs (`webhook_logs`). Dispatch via `webhookDispatch.ts`. Admin UI in `AdminWebhooks`.
- **Topic Alerts**: Topic alerts with configurable thresholds (`topic_alerts` table) for incident detection via conversation clustering. Admin UI in `AdminAlerts`.
- **SLA**: Per-department first-response SLA (`sla_breaches` table + `tickets.first_staff_response_at`). Config in `AdminDepartments` (toggle + threshold minutes + warn%). Breach worker sweeps every `SLA_SWEEP_INTERVAL_MS` (default 60000, set to 0 to disable). `SlaIndicator` badge in ChatHeader; red left-border in QueueSidebar. Business-hours-aware counter. Metrics: `guichet_sla_breaches_total`, `guichet_sla_sweep_runs_total`, `guichet_sla_first_response_minutes`. Alert rules: `SlaBreachRateHigh`, `SlaWorkerDown`, `SlaResolutionLag`.
- **CSAT Ratings**: Post-close ticket ratings (`ratings` table) with staff-facing analytics and date filtering. Feedback system (`app_feedback` table) for in-app user feedback.
- **Collision Detection**: `ticket:viewing` / `ticket:left` socket events track who's viewing a ticket. Viewer badges and typing indicators prevent duplicate responses.
- **Notification Preferences**: Per-user opt-out for email types (`notification_preferences` JSONB on users).
- **Agent Status Visibility**: 2 statuses (online/away) with color tokens (`accent-green` for online, `accent-amber` for away). Auto-away after 5 minutes idle (via `useIdleStatus` hook), auto-online on activity. Status persists in Redis across reconnects (Lua script preserves status on re-identify). Visible in QueueSidebar (team panel), AdminTeam (status column), SupportNav (capacity badge). Time-in-status tracked in `agent_status_log`, rolled up hourly to `daily_agent_status` (`onlineSeconds`, `awaySeconds`). Stats via `trpc.status.*` (getTeamStatus, getAgentStats, getTeamStats). GDPR: log purged at 30 days, daily rollup retained as aggregate.
- **Field-Level Encryption**: `services/encryption.ts` provides AES-GCM helpers keyed off `FIELD_ENCRYPTION_SECRET`. Used for SMTP / mail-provider credentials in `partners.mail_config` JSONB — DB dumps don't leak credentials. Read-through + write-through in the service layer; schema stays opaque JSONB.
- **Invite Flow**: Admins can invite `admin` / `support` / `agent` roles (not `platform_operator` — host-provisioning only). Pending invites surfaced in `AdminTeam` > Pending Invites tab with Revoke action (`platform.revokePendingInvite`). 30-day claim window with scheduled abandoned-invite purge. Removing an external (B2B guest) user from a partner revokes their sessions + refresh-token family immediately. SSO-provisioned — no invite email.
- **Department Transfer**: Tickets transfer between department queues (not individual agents). Socket event `ticket:transfer` accepts `{ ticketId, departmentId?, note? }`. Optional whisper note for context handoff. Clears support assignment, re-opens ticket, removes all support sockets from room. Service layer: `transferService.ts` + `insertWhisperMessage` in `systemMessage.ts`.

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
- **COMPOSE FROM PRIMITIVES**: Build new UI from `components/ui/` (`<Button>`, `<Card>`, `<Pill>`, `<Modal>`, `<Avatar>`, `<Toast>`) — don't hand-roll styling. (Primitives land in phase 2 of the redesign; until then, redefined `@utility` classes in `index.css` hold the line.)
- **MOTION**: Use documented keyframes only (`fade-in`, `v2p-slide-in`, `v2p-pop`, `v2p-pulse`, `v2p-dot`). Theme transitions at 200ms on `bg`/`color`/`border-color`. No decorative slides, bounces, or spring animations. Always respect `prefers-reduced-motion`.
- **THEME PARITY**: Every new component must render correctly in both `.dark` and default. Monochrome + dyslexic modes inherit for free when you use tokens.
- **DOCKER ONLY**: Never run `npm`/`node`/`npx` on the host.
- **TYPE SAFETY**: No `any` types. Zod on backend, TypeScript on frontend.
- **MULTI-TENANCY**: Every query must filter by `partner_id`.
- **DYNAMIC DEPT**: Never hardcode department IDs.
- **AUDIT LOGGING**: Log all security-relevant actions.
- **TESTING**: No render-only smoke tests. Every test must assert real behavior (interactions, validation, state changes, error handling, security boundaries). If a component test only checks that text appears after mocking everything, delete it — E2E covers that. Server tests should focus on security boundaries, data integrity, and multi-tenant isolation. New features get E2E specs before component unit tests.

## Project Structure

```
guichet/
├── server/
│   ├── db/
│   │   ├── schema.ts              # Database schema (Drizzle ORM) — 27 tables
│   │   └── postgres.ts            # DB connection, raw query helpers
│   ├── trpc/
│   │   ├── router.ts              # Main tRPC router (17 domain routers)
│   │   ├── trpc.ts                # Procedure middleware (auth, roles)
│   │   ├── context.ts             # JWT → tRPC context
│   │   └── routers/               # ai, alerts, cannedResponse, feedback, kb, label, message,
│   │       │                      # partner/, platform/, presence, rating, savedView,
│   │       │                      # stats, status, ticket, user, webhook
│   │       ├── partner/           # Split: config, members + barrel index
│   │       └── platform/          # Split: partners, users, audit, sso, system + barrel index
│   ├── socket/
│   │   ├── handlers.ts            # Orchestrator — registers domain handler modules
│   │   ├── handlers/              # Domain handler modules (auth, message, ticket, presence, collision, rating, disconnect, types)
│   │   └── partnerScope.ts        # Partner-scoped room helpers
│   ├── routes/
│   │   ├── auth/                  # /api/auth/* — SSO-only; local-auth removed
│   │   │   ├── index.ts           # Barrel mounting sub-routers
│   │   │   ├── rateLimit.ts       # Redis-backed rate limiters + shared helpers
│   │   │   ├── devLogin.ts        # /dev-login (non-prod only)
│   │   │   └── session.ts         # /refresh, /logout, /switch-partner, /enter-partner
│   │   ├── sso.ts                 # /api/auth/sso/* (SAML/OIDC flows)
│   │   ├── uploads.ts             # /api/v1/uploads (file attachments)
│   │   ├── tickets.ts             # /api/v1/tickets (REST ticket endpoints)
│   ├── services/                  # Business logic
│   │   ├── ai/                    # AI provider abstraction (factory, providers, prompts)
│   │   ├── bootstrap.ts           # First-run platform operator creation
│   │   ├── gdpr.ts                # GDPR purge + aggregation
│   │   ├── archive.ts             # WORM audit archive
│   │   ├── guards.ts              # Content moderation pipeline
│   │   ├── businessHours.ts       # Business hours + queue position
│   │   ├── presence.ts            # Redis-backed online/offline tracking
│   │   ├── stats.ts               # Dashboard statistics
│   │   ├── authSession.ts         # Auth session management
│   │   ├── roles.ts               # Role hierarchy/permissions
│   │   ├── sessionRevocation.ts   # Session revocation on security changes
│   │   ├── refreshToken.ts        # Rotating refresh token lifecycle
│   │   ├── repetitionStore.ts     # Message repetition detection
│   │   ├── webhookDispatch.ts     # Webhook event dispatch
│   │   ├── encryption.ts          # Field-level encryption
│   │   ├── systemMessage.ts       # System/whisper message insertion
│   │   ├── linkPreview.ts         # URL metadata extraction for link previews
│   │   └── *Queries.ts            # Data-access helpers (message, partner, ticket, user)
│   ├── scripts/                   # backup.sh, baseline_drizzle.ts, break_glass.ts (emergency JWT mint)
│   ├── middleware/                 # Express middleware (auth, validator, metrics)
│   ├── utils/                     # Logger, Redis, metrics, security
│   ├── types/                     # TypeScript types (index.ts)
│   ├── docs/openapi.ts            # Swagger/OpenAPI spec generation
│   ├── app.ts                     # Server bootstrap
│   ├── config.ts                  # Env validation via Zod
│   ├── constants.ts               # Shared constants
│   ├── db.ts                      # DB connection shorthand
│   └── drizzle.config.ts          # Drizzle Kit config
├── client/
│   ├── src/
│   │   ├── components/
│   │   │   ├── platform/          # PlatformView feature modules (self-contained)
│   │   │   ├── admin/             # AdminView panels (21 components)
│   │   │   ├── agent/             # AgentView components (AgentNav, TicketForm, sidebar)
│   │   │   ├── support/           # SupportView components (queue, chat tabs, AI copilot)
│   │   │   ├── chat/              # Decomposed chat sub-components (ChatHeader, ComposeArea, MessageList, etc.)
│   │   │   └── *.tsx              # Shared: ChatWindow, MessageBubble, ConfirmDialog, Toast, etc.
│   │   ├── views/                 # PlatformView, AdminView, SupportView, AgentView, LoginView
│   │   │   └── __tests__/         # Vitest tests for views
│   │   ├── hooks/                 # useBusinessHours, useIdleStatus, useKeyboardShortcuts, usePartner, useSocket, useTheme, useTokenRefresh, useTranslation
│   │   ├── store/
│   │   │   ├── useStore.ts        # Zustand composed store
│   │   │   └── slices/            # Auth, ticket, message, UI, config, rating slices
│   │   ├── types/index.ts         # TypeScript interfaces
│   │   ├── test/
│   │   │   ├── setup.ts           # Vitest setup (cleanup, jest-dom)
│   │   │   └── helpers.tsx        # Test factories and mock builders
│   │   └── utils/                 # trpc.ts, dateUtils.ts, markdown.ts, fileUtils.ts, statusColors.ts, etc.
│   └── Dockerfile
├── docs/
│   ├── AUDIT_RUNBOOK.md           # Audit chain / GDPR purge / ticket emitter oncall runbook
│   ├── BREAK_GLASS_RUNBOOK.md     # Emergency operations runbook
│   ├── SOFT_PRODUCT_DESIGN_SPEC.md # Soft-product design system token reference + mandates
│   ├── TECHNICAL.md               # Technical architecture deep-dive
│   ├── TENANT_IDENTITY_SPEC.md    # Multi-tenant identity specification
│   ├── USER_GUIDE.md              # End-user guide (roles, auth, features)
│   └── superpowers/               # Plans, specs, and reviews from development sessions
├── testing/
│   ├── nginx.conf                 # Reverse proxy config for load testing
│   ├── load/                      # k6 load test scripts (smoke.js, load.js, refresh.js, ws.js, ws-500.js, debug.js)
│   └── e2e/                       # Playwright E2E specs
├── playwright.config.ts           # Playwright E2E config
├── CHANGELOG.md                   # Project changelog (v1.0.0 → v4.1.0)
├── SECURITY.md                    # Security policy and vulnerability reporting
├── scripts/ci.ps1                 # Local CI: typecheck, tests, migrations, e2e
├── docker-compose.yml             # Dev: db, server, client, redis, lb, prometheus, grafana
├── docker-compose.prod.yml        # Production environment
├── README.md                      # Project readme
├── GEMINI.md                      # Gemini CLI instructions
└── CLAUDE.md                      # This file
```

## Local CI

Run `scripts/ci.ps1` to check everything before pushing:

```powershell
powershell -File scripts/ci.ps1                # Run all 5 steps
powershell -File scripts/ci.ps1 -Skip e2e      # Skip slow E2E tests
```

| Step | What it checks |
|------|----------------|
| `typecheck` | `tsc --noEmit` on both server and client |
| `test-client` | Client unit tests (Vitest + jsdom) |
| `test-server` | Server unit tests (Vitest + node) |
| `migrate` | Runs `db:migrate` against the Docker Postgres |
| `e2e` | Playwright E2E tests (builds client first) |

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
- **Prometheus**: Metrics at `http://localhost:9090`
- **Grafana**: Dashboards at `http://localhost:3000`
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
