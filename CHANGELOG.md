# Changelog

All notable changes to Tessera are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

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
