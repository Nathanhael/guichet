# CLAUDE.md

Guidance for Claude Code when working with the Tessera codebase.

## Project Overview

Tessera is a real-time, multi-tenant live chat platform with a brutalist design system. CSS custom property tokens drive the entire UI (light/dark mode), self-hosted JetBrains Mono + Inter fonts, zero external CDN dependencies.

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
docker logs -f tessera-server-1                            # Server logs
docker logs -f tessera-client-1                            # Client logs
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

### Demo Users

```bash
docker compose exec server npx tsx seed.ts                       # Full demo seed (truncate + reseed everything)
```

All demo users use password `password123`. The seed script truncates all tables and creates 2 partners, ~20 users, ~50 tickets with messages, labels, ratings, canned responses, KB articles, 30 days of stats, agent status data, archived tickets, feedback, alerts, and webhooks. Platform step-up TOTP is controlled by `REQUIRE_PLATFORM_STEP_UP` (default `false`). When `false`, all PlatformView tabs are accessible without authenticator setup. Set to `true` in production to enforce TOTP verification before accessing platform admin.

## Architecture

### Server (`server/`)

**API Layer**:
- **tRPC (Primary)**: tRPC 11 for all data fetching and mutations. Router: `server/trpc/router.ts`. 19 domain routers in `server/trpc/routers/`: `ai`, `alerts`, `cannedResponse`, `feedback`, `kb`, `label`, `message`, `mfa`, `partner`, `platform`, `platformSecurity`, `presence`, `rating`, `savedView`, `stats`, `status`, `ticket`, `user`, `webhook`. Input validation via Zod.
- **Express Routes**: Auth (`server/routes/auth.ts`), SSO (`server/routes/sso.ts`), Logos (`server/routes/logos.ts`), Uploads (`server/routes/uploads.ts`), Tickets (`server/routes/tickets.ts`), Push (`server/routes/push.ts`).
- **API Docs**: Swagger UI at `/api/v1/docs/` (REST), tRPC reference at `/api/v1/trpc-reference` (98 procedures).

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
- `accountLockout.ts` — 5-attempt lockout with 15-min window, email notification
- `mail.ts` / `mailTemplates.ts` — Centralized email service + B&W templates (lockout, MFA, password reset)
- `authSession.ts` — Auth session management and token lifecycle
- `platformStepUp.ts` — Platform TOTP step-up authentication
- `roles.ts` — Role hierarchy and permission checks
- `sessionRevocation.ts` — Session revocation on password/security changes (also revokes refresh tokens)
- `refreshToken.ts` — Rotating refresh token lifecycle (create, rotate, revoke family, reuse detection)
- `repetitionStore.ts` — Message repetition detection for guards
- `sla.ts` — SLA enforcement with per-department config and alerting
- `webhookDispatch.ts` — Webhook event dispatch to partner-configured endpoints
- `encryption.ts` — Field-level encryption utilities
- `pushNotification.ts` — Web push notification dispatch (VAPID-based)
- `systemMessage.ts` — System/whisper message insertion (used by transfers, auto-actions)
- `messageQueries.ts` / `partnerQueries.ts` / `ticketQueries.ts` / `userQueries.ts` — Data-access query helpers (shared by tRPC routers and services)

**AI Service Layer** (`server/services/ai/`):
- `factory.ts` — Provider factory (Ollama, Azure OpenAI, OpenAI-compatible)
- `ollama.ts` / `azure-openai.ts` / `openai-compatible.ts` — Provider implementations with streaming
- `config.ts` / `types.ts` — AI configuration and shared types
- `prompts.ts` — Prompt templates for improvement, summarization, translation, sentiment
- `sentiment.ts` — Fire-and-forget sentiment scoring for tickets
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
- `handlers.ts` — All real-time event handlers. Uses Redis adapter for horizontal scaling.
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
| `users` | Global user accounts | `id`, `email`, `password`, `lang` (nl/fr/en), `isPlatformOperator` |
| `partners` | Tenant organizations | `id`, `name`, `status` (active/inactive), `authMethod` (local/sso), `departments` (JSONB), `logoUrl`, `industry` |
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
| `topic_alerts` | SLA/topic alert rules | `partnerId`, `type`, `threshold`, `recipients` |
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
| `daily_agent_status` | Daily time-in-status rollup | `date`, `userId`, `partnerId`, `availableSeconds`, `breakSeconds`, `lunchSeconds`, `meetingSeconds`, `trainingSeconds` |
| `push_subscriptions` | Web push notification subscriptions | `userId`, `partnerId`, `endpoint`, `keys` (JSONB) |

### Client (`client/src/`)

**Stack**: React 19, Vite 8, Tailwind CSS 4, Zustand 5.

**State**: Zustand store with slices (`auth`, `tickets`, `messages`, `ui`, `config`, `rating`) in `store/useStore.ts`. Session expiry is detected via the `session_expires` cookie (non-HttpOnly companion to the JWT HttpOnly cookie).

**Real-Time**: `hooks/useSocket.ts` — single global Socket.io instance. Always clean up listeners in `useEffect` return.

**Token Refresh**: `hooks/useTokenRefresh.ts` — proactive access token refresh via `POST /api/v1/auth/refresh`. Timer-based with visibility change detection for tab sleep/resume.

**Views**:
- `PlatformView` — Thin shell (tabs + modal state). Feature modules in `components/platform/`. Each component owns its own tRPC hooks and cache invalidation.
- `AdminView` — Partner admin: team, departments, tickets, business hours, labels, canned responses, knowledge base, webhooks, alerts, feedback, stats, archive
- `SupportView` — Support staff: ticket queue by department, multi-tab chat, AI copilot sidebar
- `AgentView` — End-user: ticket creation, chat, attachments
- `LoginView` — Auth flow: login, password reset, MFA challenge, partner selection

**Component Directories**:
- `components/platform/` — PlatformView feature modules (PartnerList, UserTable, CreatePartnerModal, DeletePartnerModal, EditPartnerModal, EditUserProfileModal, InviteUserModal, ManageAccessModal, GroupMappingsPanel)
- `components/admin/` — AdminView panels: AdminAlerts, AdminArchive, AdminBusinessHours, AdminCannedResponses, AdminDepartments, AdminFeedback, AdminKnowledgeBase, AdminLabels, AdminSatisfaction, AdminStats, AdminTeam, AdminTickets, AdminWebhooks, AgentStatusStats, DashboardHelpers, ErrorBox, PlatformAuditLog, PlatformArchiveViewer, PlatformSecurityOps, PlatformSystemHealth, PlatformSystemSettings
- `components/agent/` — AgentNav, AgentTicketSidebar, TicketForm
- `components/support/` — AiCopilotSidebar, ChatTabBar, CustomerInfoPanel, QueueSidebar, SavedViewPicker, SupportNav
- `utils/` — `statusColors.ts` (getStatusColors, getStatusI18nKey for consistent status dot rendering)
- Shared: AccessibilityMenu, BionicText, BusinessHoursGuard, CannedResponsePicker, ChatWindow, ConfirmDialog, ConnectionStatus, DarkModeToggle, ErrorBoundary, FeedbackModal, LanguageSwitcher, LegalModal, MessageBubble, NavToolbar, NeuroToggle, NotificationToggle, PartnerSwitcher, PartnerUnavailable, RatingModal, SentimentDot, SlaIndicator, StatusPicker, SystemBackground, TicketPreview, Toast, UserAvatar, UserSecurityModal

**Aesthetics**: Raw/Exposed Brutalist design. Zinc+Blue dark theme (#09090b base) and Warm Stone light theme (#fafaf9 base). JetBrains Mono for UI chrome (nav, labels, badges, buttons), Inter for content text (messages, descriptions). Minimal functional motion (150ms fade-in only). Functional layout transitions (sidebar collapse, tab switch) are permitted at ≤150ms. No decorative slides, bounces, or spring animations. No gradients, no shadows. No border-radius except avatar circles (`rounded-full` on user monogram elements). Design tokens defined as CSS custom properties in `index.css`. See `docs/BRUTALIST_DESIGN_SPEC.md` for full spec.

## Key Conventions

- **Roles**: `agent`, `support`, `admin`, `platform_operator`
- **Multi-Tenancy**: Every query must include `partner_id` filter. No data leaks between partners.
- **Multi-Partner Users**: Users belong to multiple partners via `memberships`. One active partner at a time — switching issues a new JWT cookie via `/switch-partner`.
- **Cookie-Only Auth**: JWTs are transported exclusively via `HttpOnly SameSite=Lax` cookies (`tessera_token`). No Bearer header support. Client uses `credentials: 'include'` on all requests. A companion `session_expires` cookie (non-HttpOnly) carries the expiry timestamp for client-side detection. Config: `COOKIE_SECURE` (default `true`), `COOKIE_DOMAIN` (optional, for subdomains).
- **Refresh Tokens**: Short-lived access tokens (`ACCESS_TOKEN_EXPIRY`, default 15m) paired with rotating refresh tokens (`REFRESH_TOKEN_EXPIRY`, default 7d) in `tessera_refresh` HttpOnly cookie (path-restricted to `/api/v1/auth/refresh`). `useTokenRefresh` hook auto-refreshes ~2min before expiry, handles tab sleep/resume. Family-based reuse detection: replaying a used refresh token revokes the entire token family. Session revocation also revokes all refresh tokens.
- **Partner Status**: `active` | `inactive`. Inactive blocks logins, ticket creation, switching. Enforce at login, switch-partner, socket, and tRPC layers.
- **Dynamic Departments**: Never hardcode department IDs. Always read from `partner.departments` JSONB. Schema: `{ id (auto-slug), name, description? }`. IDs are immutable.
- **Department Assignment**: `memberships.departments` is a JSONB array of dept IDs. Empty/null = generalist (sees all).
- **TypeScript**: No `any` types. Zod schemas on backend, TypeScript interfaces in `client/src/types/index.ts`.
- **Argon2id**: Password hashing uses `argon2` (native C bindings). No bcrypt anywhere in the codebase.
- **Auth Method**: Per-partner setting (`local` | `sso` | `both`) via `authMethodEnum` pgEnum. `both` enables mixed auth with per-user override. Local partners generate temp passwords on invite; SSO partners skip password creation. Invite mutations return `tempPassword: ''` (not `null`) because tRPC without superjson strips null values.
- **Audit Logging**: All significant actions (partner lifecycle, user management, GDPR purges) recorded in `audit_log`.
- **MFA (TOTP)**: Per-user MFA via `mfaSecret`, `mfaEnabledAt`, `mfaRecoveryCodes` (SHA-256 hashed). Setup/enable/disable via `trpc.mfa.*`. Login challenge returns `{ mfaRequired: true }` and waits for TOTP code re-submission.
- **Account Lockout**: 5 failed login attempts → 15-minute lockout. State in `failedLoginAttempts` + `lockedUntil` columns. Email notification on lockout (fire-and-forget).
- **Password Policies**: Min 10 chars, upper/lower/digit/special required, common password blocking, email/name inclusion check. History check prevents reuse of last 5 passwords (Argon2id verified).
- **WORM Archive**: Tamper-evident SHA-256 hash chain for audit log. Automatic archival before GDPR purge. Chain integrity verification endpoint. Tickets archived with message count summary.
- **Cursor-Based Pagination**: Ticket list and audit archive use keyset pagination (`createdAt|id` composite cursor). Pattern: fetch `limit+1`, detect hasMore, return `{ items, nextCursor }`.
- **Platform Operator Bootstrap**: On first startup with no platform operators, auto-creates one from `PLATFORM_ADMIN_EMAIL` (and optional `PLATFORM_ADMIN_PASSWORD`) env vars. Runs before server accepts traffic. Race-safe, non-fatal.
- **Platform Operator Partner Access**: Platform operators can enter any active partner's admin view via `POST /enter-partner` without needing a membership. Socket auth bypasses membership check for operators.
- **AI Provider Abstraction**: Multi-provider AI via factory pattern (`server/services/ai/`). Uses `AiContext` dependency injection (wired at boot) — all AI modules import from the barrel `index.ts`, never directly. Supports Ollama, Azure OpenAI, and OpenAI-compatible APIs. Per-partner AI config (`aiEnabled`, `aiFeatures` JSONB) controls feature availability. Features: message improvement (optional/forced modes with revert), chat summarization (Redis-cached), translation, sentiment detection (fire-and-forget), auto-summarize on close. Rate limiting and usage logging per partner.
- **Knowledge Base**: Per-partner KB articles (`kb_articles` table). CRUD via `trpc.kb.*`. Admin UI in `AdminKnowledgeBase`.
- **Webhooks**: Per-partner webhook endpoints (`webhooks` table) with event subscriptions, HMAC signing, delivery logs (`webhook_logs`). Dispatch via `webhookDispatch.ts`. Admin UI in `AdminWebhooks`.
- **Alerts & SLA**: Topic alerts with configurable thresholds (`topic_alerts` table). Per-department SLA config with `SlaIndicator` component. Admin UI in `AdminAlerts`.
- **CSAT Ratings**: Post-close ticket ratings (`ratings` table) with staff-facing analytics and date filtering. Feedback system (`app_feedback` table) for in-app user feedback.
- **Collision Detection**: `ticket:viewing` / `ticket:left` socket events track who's viewing a ticket. Viewer badges and typing indicators prevent duplicate responses.
- **PWA**: Progressive Web App with `manifest.json`, `sw.js`, and icons for mobile installation.
- **Notification Preferences**: Per-user opt-out for email types (`notification_preferences` JSONB on users). Toggle UI in security modal.
- **Agent Status Visibility**: 5 statuses (available/break/lunch/meeting/training) with distinct color tokens (`accent-green`, `accent-amber`, `accent-orange`, `accent-red`, `accent-blue`). Status persists in Redis across reconnects (Lua script preserves status on re-identify). Visible in QueueSidebar (team panel), AdminTeam (status column), SupportNav (capacity badge). Time-in-status tracked in `agent_status_log`, rolled up hourly to `daily_agent_status`. Stats via `trpc.status.*` (getTeamStatus, getAgentStats, getTeamStats). GDPR: log purged at 30 days, daily rollup retained as aggregate.
- **Push Notifications**: VAPID-based web push via `pushNotification.ts` service, `push.ts` Express route, and `push_subscriptions` table. Client subscribes via `utils/notifications.ts`. Type definitions in `server/types/web-push.d.ts`.
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
| `REQUIRE_PLATFORM_STEP_UP=false` | WARN | Logs warning |

## Critical Mandates

- **BRUTALIST TOKENS**: Use CSS custom property design tokens from index.css. No inline colors, no gradients, no shadows. No border-radius except avatar circles (`rounded-full` on user monogram elements).
- **MINIMAL MOTION**: Only fade-in (150ms) for panels/modals. Functional layout transitions (sidebar collapse, tab switch) permitted at ≤150ms. No decorative slides, bounces, or spring animations. Respect prefers-reduced-motion.
- **DOCKER ONLY**: Never run `npm`/`node`/`npx` on the host.
- **TYPE SAFETY**: No `any` types. Zod on backend, TypeScript on frontend.
- **MULTI-TENANCY**: Every query must filter by `partner_id`.
- **DYNAMIC DEPT**: Never hardcode department IDs.
- **AUDIT LOGGING**: Log all security-relevant actions.

## Project Structure

```
tessera/
├── server/
│   ├── db/
│   │   ├── schema.ts              # Database schema (Drizzle ORM) — 28 tables
│   │   └── postgres.ts            # DB connection, raw query helpers
│   ├── trpc/
│   │   ├── router.ts              # Main tRPC router (19 domain routers)
│   │   ├── trpc.ts                # Procedure middleware (auth, roles)
│   │   ├── context.ts             # JWT → tRPC context
│   │   └── routers/               # ai, alerts, cannedResponse, feedback, kb, label, message,
│   │                              # mfa, partner, platform, platformSecurity, presence,
│   │                              # rating, savedView, stats, ticket, user, webhook
│   ├── socket/
│   │   ├── handlers.ts            # Socket.io event handlers
│   │   └── partnerScope.ts        # Partner-scoped room helpers
│   ├── routes/
│   │   ├── auth.ts                # /api/auth/* (login, switch-partner, enter-partner, refresh, logout)
│   │   ├── sso.ts                 # /api/auth/sso/* (SAML/OIDC flows)
│   │   ├── logos.ts               # /api/v1/logos
│   │   ├── uploads.ts             # /api/v1/uploads (file attachments)
│   │   ├── tickets.ts             # /api/v1/tickets (REST ticket endpoints)
│   │   └── push.ts                # /api/v1/push (web push subscriptions)
│   ├── services/                  # Business logic
│   │   ├── ai/                    # AI provider abstraction (factory, providers, prompts, sentiment)
│   │   ├── bootstrap.ts           # First-run platform operator creation
│   │   ├── gdpr.ts                # GDPR purge + aggregation
│   │   ├── archive.ts             # WORM audit archive
│   │   ├── guards.ts              # Content moderation pipeline
│   │   ├── businessHours.ts       # Business hours + queue position
│   │   ├── presence.ts            # Redis-backed online/offline tracking
│   │   ├── stats.ts               # Dashboard statistics
│   │   ├── sla.ts                 # SLA enforcement + per-dept config
│   │   ├── accountLockout.ts      # 5-attempt lockout
│   │   ├── mail.ts                # Email service
│   │   ├── mailTemplates.ts       # B&W email templates
│   │   ├── authSession.ts         # Auth session management
│   │   ├── platformStepUp.ts      # Platform TOTP step-up
│   │   ├── roles.ts               # Role hierarchy/permissions
│   │   ├── sessionRevocation.ts   # Session revocation on security changes
│   │   ├── refreshToken.ts        # Rotating refresh token lifecycle
│   │   ├── repetitionStore.ts     # Message repetition detection
│   │   ├── webhookDispatch.ts     # Webhook event dispatch
│   │   ├── encryption.ts          # Field-level encryption
│   │   ├── pushNotification.ts    # Web push dispatch (VAPID)
│   │   ├── systemMessage.ts       # System/whisper message insertion
│   │   └── *Queries.ts            # Data-access helpers (message, partner, ticket, user)
│   ├── middleware/                 # Express middleware (auth, validator, metrics)
│   ├── utils/                     # Logger, Redis, metrics, security
│   ├── types/                     # TypeScript types (index.ts, web-push.d.ts)
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
│   │   └── utils/trpc.ts          # tRPC client setup
│   └── Dockerfile
├── docs/
│   ├── BREAK_GLASS_RUNBOOK.md     # Emergency operations runbook
│   ├── BRUTALIST_DESIGN_SPEC.md   # Brutalist design system token reference
│   ├── TECHNICAL.md               # Technical architecture deep-dive
│   ├── TENANT_IDENTITY_SPEC.md    # Multi-tenant identity specification
│   ├── USER_GUIDE.md              # End-user guide (roles, auth, features)
├── conductor/
│   ├── index.md                   # Conductor overview
│   ├── product.md                 # Product definition
│   ├── product-guidelines.md      # Product guidelines
│   ├── tech-stack.md              # Technology stack
│   ├── tracks.md                  # Development tracks
│   └── workflow.md                # Workflow documentation
├── testing/
│   ├── nginx.conf                 # Reverse proxy config for load testing
│   ├── load/                      # k6 load test scripts (smoke.js, load.js, refresh.js, ws.js)
│   └── e2e/                       # Playwright E2E specs
├── playwright.config.ts           # Playwright E2E config
├── CHANGELOG.md                   # Project changelog (v1.0.0, v2.0.0)
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

## Debugging

- **Server logs**: `docker logs -f tessera-server-1`
- **Client logs**: Browser DevTools → Console
- **Socket events**: Browser DevTools → Network → WS tab
- **Database**: `docker compose exec server npx drizzle-kit studio`
- **Zustand state**: Redux DevTools browser extension
- **Prometheus**: Metrics at `http://localhost:9090`
- **Grafana**: Dashboards at `http://localhost:3001`
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
