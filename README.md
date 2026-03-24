# Tessera (Clean Slate)

Tessera is a high-performance, real-time multi-tenant customer support platform. This version has been stripped of all "bloat" features to provide a distraction-free, high-contrast monochrome chat experience. 

**Note**: Advanced AI and branding features are currently deactivated and will be added back one by one in future iterations.

## 🌟 Core Features (Active)

- **Real-Time Scaling**: Powered by Socket.io with Redis horizontal scaling, server-side identity enforcement, presence tracking, and typing indicators.
- **Strict Monochrome Standard**: A "scorched earth" visual overhaul. Zero animations, zero motions, zero glassmorphism. Just high-contrast black and white for maximum performance and readability.
- **Hybrid Identity Model**: Centralized identity plane with support for **Azure SSO (OIDC)** and **Local (Password)** access. Local credentials use **Argon2id**. Supports pre-provisioning for a zero-trust employee onboarding experience.
- **Adaptive Workspace Switching**: Native support for users with memberships in multiple partners. Includes a "Choose Workspace" screen and live partner switcher.
- **Enterprise-Ready Schema**: Optimized with native PostgreSQL JSONB, Enums, and strict Unique Membership constraints.
- **Advanced Audit Logging**: System-wide traceability with granular **from -> to** state diffs, target lifecycle searching, and professional CSV export for compliance.
- **Platform Cockpit**: Global oversight for Platform Operators to manage tenants, correct global user profiles, and monitor system-wide health (Postgres/Redis/GDPR).
- **Partner Administration**: Local management for Partner Admins to configure departments and manage their specific team of agents and specialists.

## 🛠️ Tech Stack

- **Frontend**: React 19.2, Vite 8, Tailwind CSS 4, Zustand 5 (State).
- **Backend**: Node.js 24 (ESM), Express 5, tRPC 11 (Type-safe API), Socket.io 4.8 (Real-time).
- **Database**:
  - **PostgreSQL 18**: Primary relational storage with JSONB and Enums.
  - **Redis 8**: Presence tracking and Socket.io horizontal scaling.
  - **Drizzle ORM**: TypeScript-first schema management.
- **Observability**: Prometheus (Metrics), Grafana (Visualization), Pino (Structured logging).
- **Runtime**: Docker & Docker Compose.

## 🚀 Quick Start

1. **Environment Setup**:
   ```bash
   cp .env.example .env
   ```

2. **Docker Development**:
   ```bash
   docker-compose up
   ```

3. **Production Deployment**:
   ```bash
   docker compose -f docker-compose.prod.yml up
   ```

## 🔒 Default Users (Demo)

| Role | User | ID |
| :--- | :--- | :--- |
| **Platform Admin** | Platform Admin | `platform_admin` |

*Password: `password123`*

### First-Time Production Setup

On first startup with no platform operators in the database, Tessera auto-creates one from environment variables:

```bash
PLATFORM_ADMIN_EMAIL=admin@yourcompany.com    # Required for bootstrap
PLATFORM_ADMIN_PASSWORD=changeme123            # Optional — omit for SSO deployments
```

After the first operator is created, they can invite additional users and operators via the PlatformView UI.

See [Tenant Identity Spec](/D:/Projects_Coding/tessera/docs/TENANT_IDENTITY_SPEC.md) for the current internal-user/tenant model.

## 🚨 Project Mandates

- **STRICT B&W**: No colors, gradients, or shadows. Use solid black and white only.
- **NO MOTION**: No animations, transitions, or special effects. The UI must be perfectly static.
- **DYNAMIC DEPT**: Never hardcode department IDs. Read from the partner manifest.
- **DOCKER ONLY**: Always execute commands inside containers.

## 🔒 Security & Compliance (Active)

- **Multi-Factor Authentication (MFA)**: TOTP-based per-user MFA with authenticator app QR setup, 8 SHA-256 recovery codes, and admin force-disable.
- **Advanced Password Policies**: Min 10 chars, upper/lower/digit/special required, common password blocking, email/name inclusion check, last-5 password reuse prevention (Argon2id).
- **Account Lockout**: 5 failed login attempts triggers 15-minute lockout with email notification and audit trail.
- **Session Revocation**: JTI-based token blacklisting via Redis with per-user "revoke all" for platform operators.
- **Platform Step-Up Security**: Time-limited TOTP elevation (15 min window) for sensitive platform operations.
- **Centralized Email Templates**: B&W branded templates for lockout, MFA, password reset, and invite notifications.
- **WORM Audit Archive**: Tamper-evident SHA-256 hash chain with automatic archival before GDPR purge and chain integrity verification.
- **Cursor-Based Pagination**: Keyset pagination (createdAt|id composite) for audit logs, ticket archives, and ticket lists.
- **Ticket Archiving**: Closed tickets archived with summary metadata before GDPR purge deletes originals.
- **Canned Responses**: Per-partner response templates with shortcut keys for support agents.
- **Notification Preferences**: Per-user opt-out for email types (lockout, MFA, password changes).

## 🚀 Future Roadmap

- **Real-Time System Alerts**: Configurable alerts for platform admins (e.g., database high usage, Redis memory).
- **AI Intelligence Hub**: Sentiment analysis, topic clustering, and automated conversation summaries (currently deactivated).
- **Predictive Staffing**: Forecasting support coverage needs based on volume velocity.

## 🧪 Testing

```bash
# Unit tests
docker compose exec server npm test          # Server (Vitest)
docker compose exec client npm test          # Client (Vitest + jsdom)

# E2E tests
npm run test:e2e                             # Playwright

# Load tests (requires k6 or Docker)
docker run --rm --network=host -v "$(pwd)/testing/load:/scripts" grafana/k6 run /scripts/smoke.js
docker run --rm --network=host -v "$(pwd)/testing/load:/scripts" grafana/k6 run /scripts/load.js
```

## 🗄️ Database Management

```bash
npm run db:migrate              # Apply pending migrations (normal use)
npm run db:baseline             # Seed Drizzle ledger on existing DB (one-time adoption fix)
npm run db:backup               # Backup to server/backups/ (gzipped, keeps last 10)
npm run db:backup:docker        # Same, from Docker container
```
