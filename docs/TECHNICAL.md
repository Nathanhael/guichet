# Technical Documentation: Tessera (Clean Slate)

This document provides an overview of the core architecture for the simplified, high-performance Tessera platform.

---

## 1. Enterprise Schema (PostgreSQL)

The database has been overhauled for type safety and performance:
- **Native JSONB**: All structured data (`departments`, `participants`, `reactions`, `memberships.departments`) uses native JSONB for efficient nested querying.
- **PG Enums**: Enforced data integrity for `user_role`, `ticket_status`, and `severity`.
- **Unique Constraints**: Enforced unique `(user_id, partner_id)` combinations in the `memberships` table to prevent data duplication.
- **Audit Diffs**: The `audit_log` table captures granular state changes (`from -> to`) for configuration and identity updates.
- **Azure Identity Prep**: Added `email` and `external_id` columns to support OIDC integration.
- **System Configuration**: Added `system_settings` table to store global infrastructure parameters (like mail provider credentials) manageable via the Platform UI.
- **AI & Analytics Tables**: `ai_prompt_templates` (per-partner prompt customization), `ai_usage_log` (provider usage tracking with token counts and latency), `ratings` (ticket CSAT), `app_feedback` (in-app user feedback).
- **Integration Tables**: `kb_articles` (per-partner knowledge base), `webhooks` + `webhook_logs` (event dispatch with HMAC signing and delivery tracking), `topic_alerts` (SLA/alert rules with configurable thresholds), `partner_group_mappings` (SSO group→role/department mapping).
- **User Personalization**: `saved_views` (per-user saved ticket filter configurations per partner).

---

## 2. Dynamic Organizational Structure

Tessera is 100% data-driven. Hardcoded constants for departments have been removed.
- **Manifest-Driven**: Departments use an immutable `id`, display `name`, and optional `description`. The `SupportView` generates filters based on the `departments` JSONB array in the `partners` table.
- **Multi-Department Assignments**: Users are assigned an array of department IDs (`memberships.departments`), serving as visibility filters. Generalists (`[]` or `null`) see all departments.
- **Workspace Switching**: Users with memberships in multiple partners are presented with a "Choose Workspace" screen upon login to establish tenant context.

---

## 3. Real-Time Engine (Socket.io & Redis)

- **Identity Security**: Server-side socket identity (`socket.data.userId`) is the source of truth for all events, preventing client-side forgery.
- **Horizontal Scaling**: Uses the Redis adapter to sync events across server instances.
- **Distributed Presence**: Online status and user performance metrics tracked via Redis Hashes.
- **Real-Time Revocation**: Integrated a "Kill Switch" that uses Redis/Socket.io to instantly disconnect active sessions when a user is deactivated or deleted.
- **Collision Detection**: `ticket:viewing` / `ticket:left` socket events track which support staff are viewing a ticket simultaneously. Viewer state maintained server-side, cleaned up on disconnect. Prevents duplicate responses.
- **Token Expiry**: JWT `exp` is stored at handshake and checked on every event via `requireIdentified()`. Expired tokens trigger `auth:expired` → client auto-reconnects.

---

## 4. Optimized Data Strategy

- **Batch Retrieval**: Replaced N+1 query patterns with batch fetching (e.g., ticket labels are retrieved in a single `IN` query and mapped in-memory).
- **Multi-Tenant GDPR**: Daily data aggregation and purges are partner-aware, using composite keys to prevent cross-tenant stat collisions.
- **Real-Time Health**: System health monitoring pings Postgres and Redis directly, retrieving live metrics like active connections and memory usage.

---

## 5. Hybrid Identity Model

- **OIDC (Azure Managed)**: Users invited via email are linked to their corporate Azure account upon first SSO login. No local password management is required.
- **Local (Password Access)**: Supports external partners/consultants via email/password authentication using `Argon2id` password hashing.
- **Pre-Provisioning**: Operators define authorization (roles/partners) before the user ever arrives, ensuring a zero-trust "Day One" experience.
- **Secure Recovery**: Implemented a token-based password reset flow for local users using SHA-256 hashed tokens and a 1-hour strict expiry.
- **Platform Operator Bootstrap**: On first startup, the server checks for existing platform operators. If none exist and `PLATFORM_ADMIN_EMAIL` is set, it auto-creates (or promotes) the initial operator. Supports both local auth (with `PLATFORM_ADMIN_PASSWORD`) and SSO (password omitted). Race-safe for multi-replica deployments.
- **Implicit Partner Access**: Platform operators can enter any active partner's admin view without an explicit membership, via a dedicated `/enter-partner` endpoint that issues a partner-scoped JWT with admin role.
- **Flexible Auth**: Partners support `authMethod` of `'local'`, `'sso'`, or `'both'`. When `'both'`, the login page shows both email/password and SSO options. Per-user `auth_method` column allows overriding the partner default (e.g., SSO partner with one local break-glass account).
- **SSO Group Mapping**: `partner_group_mappings` table automatically maps SSO group memberships to tenant roles and departments during login.
- **Tenant Mapping**: The current platform treats `partners` as tenants and `memberships` as the authorization link from internal users to one or more tenants. See `docs/TENANT_IDENTITY_SPEC.md`.

---

## 6. Security Hardening

- **Multi-Factor Authentication (MFA)**: Per-user TOTP setup/enable/disable via tRPC. Login challenge returns `{ mfaRequired: true }` and waits for TOTP code or recovery code. 8 SHA-256 hashed recovery codes generated on enable.
- **Account Lockout**: 5 failed login attempts triggers 15-minute lockout. State tracked in `failedLoginAttempts` + `lockedUntil` columns. Email notification on lockout.
- **Advanced Password Policies**: Min 10 chars, max 128 chars, upper/lower/digit/special required, common password blocking (~160 entries), email/name inclusion check. Last 5 passwords checked for reuse (Argon2id verified).
- **Platform Step-Up**: Time-limited TOTP elevation for platform operators. Configurable via `REQUIRE_PLATFORM_STEP_UP` flag.
- **WORM Audit Archive**: Tamper-evident SHA-256 hash chain for audit log. Automatic archival before GDPR purge. Chain integrity verification endpoint. Ticket archiving with message count summary.
- **JWT Algorithm Pinning**: All `jwt.verify()` calls specify `{ algorithms: ['HS256'] }` to prevent algorithm confusion attacks.
- **CSP Headers**: Helmet configured with Content Security Policy for XSS mitigation.
- **Rate Limiting**: Express rate limits on auth endpoints. Per-email forgot-password throttle (3 requests per 15 minutes).

---

## 7. Communication & Activity

- **Dynamic Mail Service**: A centralized `MailService` that retrieves provider settings (SMTP, Resend, SendGrid) from the database at runtime, allowing for hot-swapping email providers without redeploys.
- **Centralized Mail Templates**: B&W branded HTML templates for lockout, MFA enabled, MFA disabled by admin, password reset, invite, and reminder emails. XSS-safe escaping via `escapeHtml()`.
- **Canned Responses**: Per-partner response templates with title, body, shortcut key, and category. CRUD management for admins, `/` picker in chat for support agents.
- **User Activity Lifecycle**: The system tracks `last_active_at` for all users across both Local and SSO login paths, providing real-time visibility into platform adoption.
- **Notification Preferences**: Per-user opt-out for email notification types (account lockout, MFA changes, password changes). Opt-out model — everything on by default.

---

## 8. AI Service Layer

- **Provider Abstraction**: `server/services/ai/` implements a factory pattern supporting Ollama (local/free), Azure OpenAI, and any OpenAI-compatible API (LM Studio, Groq, Together AI). Switch with one env var (`AI_PROVIDER`). All AI modules use `AiContext` dependency injection (wired at boot) and import via the barrel `index.ts` — never directly.
- **Per-Tenant Configuration**: Each partner has `aiEnabled` flag and `aiFeatures` JSONB controlling which AI capabilities are active (message improvement, summarization, translation, sentiment, auto-summarize on close). Platform admins toggle features in the Edit Partner modal.
- **Message Improvement**: Role-aware rewriting — agents get clarity-focused rewrites, support gets actionable step-by-step rewrites. Optional or forced modes with revert-to-original.
- **Chat Summarization**: On-demand summaries via `ai.summarizeChat`, cached in Redis. AI Copilot Sidebar in SupportView for quick context.
- **Translation**: Per-message translation between nl/en/fr via `ai.translateMessage`. Auto-detects source language.
- **Sentiment Detection**: Fire-and-forget scoring (-1.0 to 1.0) on every message. Aggregated in QueueSidebar (colored dots) and AdminStats (sentiment trends).
- **Auto-Summarize on Close**: When tickets close, AI generates a summary stored in closing notes. Feeds into the GDPR-safe archive.
- **Rate Limiting**: Per-partner Redis counters (requests/min, requests/day). Configurable via partner AI config.
- **Usage Logging**: Every AI call logged to `ai_usage_log` with provider, model, token counts, latency, and success/failure.

---

## 9. Knowledge Base, Webhooks & SLA

- **Knowledge Base**: Per-partner `kb_articles` table with title, body, category. Full CRUD via `trpc.kb.*` router. Admin UI in `AdminKnowledgeBase` component.
- **Webhooks**: Partners configure webhook endpoints (`webhooks` table) with event subscriptions and HMAC signing secrets. `webhookDispatch.ts` delivers events with retry logic. Delivery history in `webhook_logs`. Admin UI in `AdminWebhooks`.
- **SLA System**: Per-department response and resolution time targets stored in partner config. `sla.ts` service calculates `slaResponseDueAt` / `slaResolutionDueAt` on ticket creation (respecting business hours). `SlaIndicator` component shows countdown (green/yellow/red). `topic_alerts` table defines breach alert rules. `AdminAlerts` UI for configuration.
- **CSAT Ratings**: Post-close ticket ratings (`ratings` table) with auto-prompt. Staff satisfaction dashboard with per-agent breakdown and date filtering. In-app feedback via `app_feedback` table and `FeedbackModal`.

---

## 10. Frontend Architecture (React)

- **Enterprise UI Patterns**: Long lists, such as the `PlatformAuditLog`, implement robust UX paradigms including sticky pagination bars and debounced searching (e.g., waiting 500ms before triggering a backend query) to reduce server load and improve client-side performance.
- **Self-Contained Feature Modules**: `PlatformView` is a thin shell (tabs + modal state). Each feature lives in `components/platform/` and owns its own tRPC hooks, mutations, and cache invalidation — no prop-drilling of refetch functions.
- **Component Organization**: `components/admin/` (20 components — stats, satisfaction, team, departments, tickets, business hours, labels, canned responses, knowledge base, webhooks, alerts, feedback, archive, platform ops), `components/agent/` (3 — nav, sidebar, ticket form), `components/support/` (6 — queue, chat tabs, customer info, AI copilot, saved view picker, nav). Shared components at root level (ChatWindow, MessageBubble, Toast, ConfirmDialog, AccessibilityMenu, NeuroToggle, BionicText, etc.).
- **Reusable UI Primitives**: Custom `ConfirmDialog` and `Toast` components replace all native `alert()`/`confirm()` calls for consistent UX.
- **Data Visualization**: Recharts for dashboard charts (AdminStats, sentiment trends, SLA compliance).
- **Full i18n**: All UI strings use `useT()` with translations in English, French, and Dutch (`i18n.ts`). Business hours, admin views, and platform views are fully translated.
- **State Synchronization**: Strict single-page-app behaviors using Zustand for global state and tRPC for seamless query invalidation and refetching.
- **PWA**: Progressive Web App with `manifest.json`, service worker (`sw.js` with build-hash cache busting), and icons. Installable on Android/iOS. Network-first strategy for API calls.
- **Test Coverage**: Vitest + React Testing Library covering platform components, auth middleware, socket handlers, account lockout, message mapping, and security utilities. Tests mock tRPC at the hook level using `vi.hoisted()` for clean isolation.
