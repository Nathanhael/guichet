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
- **Tenant Mapping**: The current platform treats `partners` as tenants and `memberships` as the authorization link from internal users to one or more tenants. See `docs/TENANT_IDENTITY_SPEC.md`.

---

## 6. Communication & Activity

- **Dynamic Mail Service**: A centralized `MailService` that retrieves provider settings (SMTP, Resend, SendGrid) from the database at runtime, allowing for hot-swapping email providers without redeploys.
- **User Activity Lifecycle**: The system tracks `last_active_at` for all users across both Local and SSO login paths, providing real-time visibility into platform adoption.

---

## 7. Frontend Architecture (React)

- **Enterprise UI Patterns**: Long lists, such as the `PlatformAuditLog`, implement robust UX paradigms including sticky pagination bars and debounced searching (e.g., waiting 500ms before triggering a backend query) to reduce server load and improve client-side performance.
- **Self-Contained Feature Modules**: `PlatformView` is a thin shell (tabs + modal state). Each feature (PartnerList, UserTable, CreatePartnerModal, etc.) lives in `components/platform/` and owns its own tRPC hooks, mutations, and cache invalidation — no prop-drilling of refetch functions.
- **Reusable UI Primitives**: Custom `ConfirmDialog` and `Toast` components replace all native `alert()`/`confirm()` calls for consistent UX.
- **Full i18n**: All UI strings use `useT()` with translations in English, French, and Dutch (`i18n.ts`). Business hours, admin views, and platform views are fully translated.
- **State Synchronization**: Strict single-page-app behaviors using Zustand for global state and tRPC for seamless query invalidation and refetching.
- **Test Coverage**: Vitest + React Testing Library with 66 tests across 9 files covering all platform components. Tests mock tRPC at the hook level using `vi.hoisted()` for clean isolation.
