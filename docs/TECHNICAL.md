# Technical Documentation: Guichet (Clean Slate)

This document provides an overview of the core architecture for the simplified, high-performance Guichet platform.

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

Guichet is 100% data-driven. Hardcoded constants for departments have been removed.
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

## 5. SSO-Only Identity Model

- **Azure Entra SSO (sole login path)**: All users — platform operators, partner admins, support, agents — authenticate through Azure OIDC. The `users` table carries no password, MFA, lockout, or step-up columns.
- **Dev-login (non-prod only)**: `/api/v1/auth/dev-login` mints JWTs by `userId` for the demo picker and Playwright suite. Returns 404 when `NODE_ENV=production`.
- **Break-glass CLI**: Emergency access when SSO is down. `server/scripts/break_glass.ts` mints a short-lived JWT (1–60m, default 15m) for a platform operator, enforces `isPlatformOperator`, and writes an `auth.break_glass` audit row. See `docs/BREAK_GLASS_RUNBOOK.md`.
- **Pre-Provisioning**: Operators define authorization (roles/partners) before the user ever arrives; the first SSO login stamps `users.external_id` from the Azure OID.
- **Platform Operator Bootstrap**: On first startup, the server checks for existing platform operators. If none exist and `PLATFORM_ADMIN_EMAIL` is set, it auto-creates (or promotes) the initial operator. Race-safe for multi-replica deployments. Subsequent logins go through SSO.
- **Implicit Partner Access**: Platform operators can enter any active partner's admin view without an explicit membership, via a dedicated `/enter-partner` endpoint that issues a partner-scoped JWT with admin role.
- **SSO Group Mapping**: `partner_group_mappings` table automatically maps SSO group memberships to tenant roles and departments during login.
- **Azure B2B Guests**: Partner employees can be invited as B2B guests in our Azure tenant and authenticate via their home IdP. The SSO callback detects them from the `acct === 1` or `idp` claim and sets `users.is_external`. Guests are enforced single-partner (fail-closed audit at login) and blocked from destructive partner-admin mutations (webhook secrets, member management, department edits) via the `destructiveAdminProcedure` tRPC middleware. A `GUEST` badge surfaces in the UI. See `docs/superpowers/specs/partner-sso-b2b-guest.md`.
- **Tenant Mapping**: The current platform treats `partners` as tenants and `memberships` as the authorization link from internal users to one or more tenants. See `docs/TENANT_IDENTITY_SPEC.md`.

---

## 6. Security Hardening

- **SSO-Only Auth**: Identity outsourced to Azure Entra. No password hashes, MFA secrets, lockout state, or step-up TOTP stored locally. Break-glass JWT mints are audited.
- **HttpOnly Cookie JWT**: Access tokens transported via `guichet_token` HttpOnly SameSite=Lax cookie. No Bearer header support.
- **Rotating Refresh Tokens**: Short-lived access tokens paired with `guichet_refresh` HttpOnly cookie (path-restricted to `/api/v1/auth/refresh`). Family-based reuse detection revokes the entire token family on replay.
- **Session Revocation**: Security-sensitive changes (partner status flip, SSO link removal, break-glass mint, guest offboarding) revoke all sessions and refresh tokens for the affected user.
- **WORM Audit Archive**: Tamper-evident SHA-256 hash chain for audit log. Automatic archival before GDPR purge. Chain integrity verification endpoint. Ticket archiving with message count summary.
- **Field-Level Encryption at Rest**: SMTP / mail-provider credentials in `partners.mail_config` JSONB are AES-GCM encrypted via `FIELD_ENCRYPTION_SECRET`. Service layer encrypts on write, decrypts on read; DB dumps remain opaque. Schema stays JSONB — only `services/encryption.ts` knows the cleartext shape.
- **Redis-Backed Rate Limiting**: `rate-limit-redis` store so replicas share counters instead of each maintaining its own bucket. Applied to `authLimiter`, `linkPreviewLimiter`, per-partner AI limiters.
- **Dev-Login Mount-Gated**: `/api/v1/auth/dev-login` is registered in `app.ts` only when `NODE_ENV !== 'production'`; the route is **absent** (not just 403) in prod builds. Removes the attack surface entirely rather than relying on a handler-level check.
- **Bounded Invite Claim Window**: SSO-provisioned invites expire after 30 days. Scheduled service purges abandoned invites; revoked invites stay visible (status REVOKED) for 7 days before purge. Guards against stale mailed-invite replay.
- **JWT Algorithm Pinning**: All `jwt.verify()` calls specify `{ algorithms: ['HS256'] }` to prevent algorithm confusion attacks.
- **CSP Headers**: Helmet configured with Content Security Policy for XSS mitigation.

---

## 6a. Audit Trail Observability

Guichet's audit log is a first-class operations surface, not a silent table. Implementation arc captured in `wiki/decisions/guichet-audit-trail-observability.md`; oncall response in `docs/AUDIT_RUNBOOK.md`.

- **Platform Chain-Integrity Verify UI** (`PlatformSystemHealth`): Operator-triggered verify run (rate-limited 1 per 5 min per operator), server-persisted history table, CSV export for compliance attestation. Auto-scheduled daily via `services/chainVerifySchedule.ts`.
- **Multi-Axis Filtering**: `targetType` dropdown, `targetId` search, date range, actor filter, partner filter. All combinable, all deep-linkable via URL params — a filtered view can be pasted into a ticket.
- **Metadata Drawer**: Click any audit row to see full JSON, severity highlight, previous/next navigation, filter-links into sibling rows (same actor, same target, same action), and a before/after diff on mutation rows.
- **Cross-Partner Activity Panel**: `trpc.platform.getCrossPartnerActivity` returns per-partner event totals + `lastEventAt` for the selected window. Top-N rollup (≤50 partners, 10 shown in UI). Click a row to scope the audit log below by `partnerId` — first-line signal for "which tenant is unusually noisy?" Aggregate-only by design; the scoped filter is where raw investigation happens.
- **Partner-Scoped Audit Log** (`AdminAudit`): Partner admins see their slice + a per-admin verify-chain UI (no platform access required).
- **Ticket Audit Drawer**: Every ticket row exposes its lifecycle events (`ticket.created` / `ticket.assigned` / `ticket.transferred` / `ticket.closed` / `ticket.reopened`) via `services/ticketAudit.ts`. The emitter writes `ticket.*` actions into `audit_log`; the partner audit router and platform audit view filter `ticket.*` out by default so security-relevant rows stay uncluttered. Co-mingling would dilute the platform view and push chain hashing past its useful throughput.
- **Chain-Broken Webhook**: Side-channel notification to partner-configured URL, independent of Prometheus/Alertmanager — compliance operators wanted a channel that didn't depend on the monitoring stack being healthy.
- **Staleness Banner** in the audit log when the last successful chain-verify is >24h old.
- **JSON + CSV Export** of the filtered audit view.

### Metrics (`server/utils/metrics.ts`)

| Metric | Labels | Meaning |
|---|---|---|
| `guichet_audit_chain_verify_runs_total` | `result` | Verify runs grouped by `valid` / `broken` / `error` |
| `guichet_audit_chain_broken_total` | — | Page-worthy counter — nonzero = tamper or infra fault |
| `guichet_ticket_audit_events_total` | `action` | Ticket lifecycle emissions; flatline = broken emitter |
| `guichet_gdpr_purge_runs_total` | `outcome` | Daily purge runs: `success` / `chain_aborted` / `error` |
| `guichet_gdpr_rows_purged_total` | `scope` | Row-level granularity (`ai_usage_log`, `invites`, …) |

GDPR purge increments `chain_aborted` **before** throwing, so a missing-run alert doesn't double-fire on top of a chain-integrity alert. A purge that attempted and bailed is still a purge attempt from the observability view.

### Alert Rules (`monitoring/alerts.yml`)

- **AuditChainTamperDetected** — immediate page on any broken chain.
- **AuditChainVerifyServiceError** — verify service errored on DB/Redis; fix before compliance run.
- **AuditChainStaleness** — no successful verify in 48h.
- **TicketAuditEmitterSilenced** — **self-arming.** Fires when 30m of zero events followed 1h+ of prior activity (via `offset 30m` lookback). Silent in idle tenants; pages only when an active emitter goes dark post-deploy.
- **GdprPurgeMissing** — no purge run in 48h; retention is slipping past the 30-day cutoff.
- **GdprPurgeChainAborted** — purge aborted because chain verify failed; pairs with the tamper alert.

### Grafana Dashboard (`monitoring/grafana/dashboards/guichet.json`)

Extended with chain-verify result panel, ticket lifecycle stacked series, GDPR purge run counts (stat by outcome), and rows-purged time series.

---

## 7. Communication & Activity

- **Canned Responses**: Per-partner response templates with title, body, shortcut key, and category. CRUD management for admins, `/` picker in chat for support agents.
- **User Activity Lifecycle**: The system tracks `last_active_at` for all users at every SSO login and dev-login, providing real-time visibility into platform adoption.
- **Notification Preferences**: Per-user opt-out for in-app/push notification categories. Opt-out model — everything on by default.

---

## 8. AI Service Layer

- **Provider Abstraction**: `server/services/ai/` implements a factory pattern supporting Ollama (local/free), Azure OpenAI, and any OpenAI-compatible API (LM Studio, Groq, Together AI). Switch with one env var (`AI_PROVIDER`). All AI modules use `AiContext` dependency injection (wired at boot) and import via the barrel `index.ts` — never directly.
- **Per-Tenant Configuration**: Each partner has `aiEnabled` flag and `aiFeatures` JSONB controlling which AI capabilities are active (message improvement, summarization, translation, auto-summarize on close). Platform admins toggle features in the Edit Partner modal.
- **Message Improvement**: Role-aware rewriting — agents get clarity-focused rewrites, support gets actionable step-by-step rewrites. Optional or forced modes with revert-to-original.
- **Chat Summarization**: On-demand summaries via `ai.summarizeChat`, cached in Redis. AI Copilot Sidebar in SupportView for quick context.
- **Translation**: Per-message translation between nl/en/fr via `ai.translateMessage`. Auto-detects source language.
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
- **Component Organization**: `components/admin/` (21 components — stats, satisfaction, team, departments, tickets, business hours, labels, canned responses, knowledge base, webhooks, alerts, feedback, archive, platform ops), `components/agent/` (3 — nav, sidebar, ticket form), `components/support/` (6 — queue, chat tabs, customer info, AI copilot, saved view picker, nav), `components/chat/` (11 — decomposed chat sub-components: ChatHeader, ComposeArea, MessageList, MessageContent, AttachmentGrid, DeliveryStatus, FormatToolbar, LabelPicker, LinkPreviewCard, QuoteBlock, SearchBar). Shared components at root level (ChatWindow, MessageBubble, Toast, ConfirmDialog, AccessibilityMenu, NeuroToggle, BionicText, etc.).
- **Reusable UI Primitives**: Custom `ConfirmDialog` and `Toast` components replace all native `alert()`/`confirm()` calls for consistent UX.
- **Data Visualization**: Recharts for dashboard charts (AdminStats, SLA compliance).
- **Full i18n**: All UI strings use `useT()` with translations in English, French, and Dutch (`i18n.ts`). Business hours, admin views, and platform views are fully translated.
- **State Synchronization**: Strict single-page-app behaviors using Zustand for global state and tRPC for seamless query invalidation and refetching.
- **Window Event Architecture**: To avoid deep prop-drilling or complex handle-passing for UI modals, the system uses a producer/consumer pattern based on `window` CustomEvents. Components like `SupportNav` or the keyboard hook dispatch events (e.g., `support:open-label-picker`), which are consumed by the component owning the modal state (`ChatHeader`).
- **Test Coverage**: Vitest + React Testing Library covering platform components, auth middleware, socket handlers, message mapping, and security utilities. Tests mock tRPC at the hook level using `vi.hoisted()` for clean isolation.
