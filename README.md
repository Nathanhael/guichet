# Guichet

Real-time, multi-tenant chat platform for BPO and outsourced helpdesk teams. Each partner you serve is a scoped tenant; your agents handle their customers externally and use Guichet to get second-line help from in-house support. Built for speed, security, and simplicity.

## Features

- **Real-Time Chat** — Socket.io with Redis adapter for horizontal scaling, typing indicators, presence tracking, and collision detection
- **Multi-Tenant Architecture** — Strict isolation between tenants, platform-wide SSO with multi-tenant user memberships, and seamless workspace switching
- **Soft Product Design System** — CSS custom property token UI (indigo accent, soft neutrals), Inter default with JetBrains Mono scoped to code/IDs, calm purposeful motion, full light/dark parity
- **Role-Based Access** — Four roles (agent, support, admin, platform_operator) with granular permission gates
- **SSO-Only Authentication** — Azure Entra ID for all staff; partner employees federate in via Azure B2B guest invites (see `docs/TENANT_IDENTITY_SPEC.md`). No passwords, no MFA. Emergency access via the break-glass CLI (`server/scripts/break_glass.ts`).
- **Identity Model** — Single corporate identity per user across multiple tenant organizations with scoped roles per tenant. External guests (`users.isExternal`) are enforced single-partner and blocked from destructive partner-admin mutations via the `destructive_admin` capability check resolved inline through `services/auth/capabilities.ts`.
- **Platform Cockpit** — Global operator view for tenant management, audit log, archive browser, and chain-verify history
- **AI-Powered Support** — Message improvement, translation (nl/en/fr), and voice transcription (Azure OpenAI; OpenAI-compatible providers also supported). Per-partner audit verbosity + PII redaction before prompts leave the server.
- **Security Hardening** — WORM audit archive (SHA-256 hash chain), session revocation, rotating refresh tokens with reuse detection, HttpOnly cookie auth, field-level AES-GCM encryption at rest for AI provider keys and webhook signing secrets
- **Audit Observability** — Chain-integrity verify UI with server-persisted history + CSV export for compliance attestation, multi-axis filtering (targetType / targetId / actor / date / partner), metadata drawer with diff view, cross-partner activity rollup, per-ticket audit drawer, chain-broken webhook side-channel. In-app Health-page tripwires for tamper / staleness / SLA-breach burst / GDPR purge misses. Runbook at `docs/AUDIT_RUNBOOK.md`.
- **Identity Provisioning** — Users surface automatically when an Azure SSO callback resolves them to a partner via group mappings. No passwords, no invite email. Removing a guest user from a partner revokes their sessions + refresh tokens immediately.
- **GDPR Compliance** — 30-day retention purge with automatic archival and daily stats aggregation. Aborts if the audit chain fails verification (fail-closed). Purge events recorded in `audit_log`.
- **Canned Responses** — Per-partner templates with shortcut keys and `/` picker in chat
- **Customer Satisfaction** — Auto-prompted ratings on ticket close, follow-up reminders, per-agent CSAT reporting

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 19, Vite 8, Tailwind CSS 4, Zustand 5 |
| Backend | Node.js 24 (ESM), Express 5, tRPC 11, Socket.io 4 |
| Database | PostgreSQL 18, Redis 8, Drizzle ORM |
| Observability | Pino structured logging, in-app Health page tripwires |
| Runtime | Docker & Docker Compose |

## Quick Start

```bash
# 1. Environment setup
cp .env.example .env

# 2. Start development
docker compose up

# 3. Reset database (truncates all tables, then seeds a single dev tenant + users)
docker compose exec server npx tsx seed.ts
```

Open `http://localhost:3001`. Guichet uses SSO for partner authentication. For local development, you can log in as the platform operator to configure the system.

### First-Time Production Setup

On first startup with no platform operators, Guichet auto-creates one from environment variables:

```bash
PLATFORM_ADMIN_EMAIL=admin@yourcompany.com    # Required — this user logs in via SSO
```

### Production Deployment

```bash
docker compose -f docker-compose.prod.yml up
```

## Testing

```bash
# Unit tests
docker compose exec server npm test          # Server tests (Vitest)
docker compose exec client npm test          # Client tests (Vitest + jsdom)

# TypeScript
docker compose exec server npx tsc --noEmit
docker compose exec client npx tsc --noEmit

# E2E tests (Playwright — runs on host)
npx playwright test

# Local CI (all checks)
powershell -File scripts/ci.ps1
```

## Database Management

These scripts live in `server/package.json`. Run them via Docker (or from inside `server/`):

```bash
docker compose exec server npm run db:migrate         # Apply pending migrations
docker compose exec server npm run db:baseline        # Seed Drizzle ledger on existing DB (one-time)
docker compose exec server npm run db:backup          # Backup to server/backups/ (gzipped, keeps last 10)
docker compose exec server npm run db:backup:docker   # Same, from Docker container
```

## API Documentation

- **REST** — Swagger UI at `/api/v1/docs/`
- **tRPC** — Reference at `/api/v1/trpc-reference` (19 routers)

## Architecture

```
guichet/
├── server/          # Express + tRPC + Socket.io
│   ├── db/          # Drizzle ORM schema + connection
│   ├── trpc/        # tRPC router + 19 domain routers
│   ├── socket/      # Real-time event handlers
│   ├── services/    # Business logic — auth/, ai/, availability/, dashboard/, messageLifecycle/, ticketLifecycle/, moderator/, archive, gdpr, etc.
│   └── middleware/  # Auth, validation, upload-proxy
├── client/          # React + Vite + Tailwind
│   └── src/
│       ├── components/   # ui/ primitives + per-view feature folders
│       ├── views/        # Page views (Platform, Admin, Support, Agent, Login)
│       ├── store/        # Zustand slices
│       └── hooks/        # Socket, i18n, store hooks
└── testing/         # k6 load tests + Playwright E2E
```

## License

Proprietary. All rights reserved.
