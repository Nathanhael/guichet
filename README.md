# Tessera

Real-time, multi-tenant live chat platform for customer support teams. Built for speed, security, and simplicity.

## Features

- **Real-Time Chat** — Socket.io with Redis adapter for horizontal scaling, typing indicators, presence tracking, and collision detection
- **Multi-Tenant Architecture** — Strict partner isolation, per-partner config, dynamic departments, and workspace switching
- **Brutalist Design System** — Raw token-based UI (Zinc + accent colors), JetBrains Mono typography, and minimal functional motion
- **Role-Based Access** — Four roles (agent, support, admin, platform_operator) with granular permission gates
- **Hybrid Authentication** — Local (Argon2id) + Azure Entra ID SSO per partner, with flexible per-user auth method override
- **Platform Cockpit** — Global operator view for tenant management, user provisioning, audit log, and archive browser
- **AI-Powered Support** — Message improvement, chat summarization, translation (nl/en/fr), sentiment detection, and auto-summarize on close (Ollama / Azure OpenAI)
- **Security Hardening** — MFA (TOTP), account lockout, password policies, WORM audit archive (SHA-256 hash chain), session revocation, HttpOnly cookie auth
- **SLA Management** — Per-tenant/department SLA targets with real-time countdown, breach alerts, and business hours support
- **GDPR Compliance** — 30-day retention purge with automatic archival, daily stats aggregation, and notification preferences
- **Canned Responses** — Per-partner templates with shortcut keys and `/` picker in chat
- **Customer Satisfaction** — Auto-prompted ratings on ticket close, follow-up reminders, per-agent CSAT reporting
- **PWA Ready** — Installable on mobile with offline support and push notifications

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 19, Vite 8, Tailwind CSS 4, Zustand 5 |
| Backend | Node.js 24 (ESM), Express 5, tRPC 11, Socket.io 4 |
| Database | PostgreSQL 18, Redis 8, Drizzle ORM |
| Observability | Prometheus, Grafana, Pino structured logging |
| Runtime | Docker & Docker Compose |

## Quick Start

```bash
# 1. Environment setup
cp .env.example .env

# 2. Start development
docker compose up

# 3. Seed demo data
docker compose exec server npx tsx seed.ts
```

Open `http://localhost:3001`. When `DEMO_MODE=true` (dev default), a demo login panel lets you explore all roles. Demo mode is blocked in production (`NODE_ENV=production`).

### First-Time Production Setup

On first startup with no platform operators, Tessera auto-creates one from environment variables:

```bash
PLATFORM_ADMIN_EMAIL=admin@yourcompany.com    # Required
PLATFORM_ADMIN_PASSWORD=changeme123            # Optional — omit for SSO-only
```

### Production Deployment

```bash
docker compose -f docker-compose.prod.yml up
```

## Demo Users

All demo users use password `password123`. Use the demo panel on the login page to quick-login as any role.

| Role | Users |
|------|-------|
| Platform Operator | Bart Operator |
| Admin | Dirk De Smedt |
| Support | Alex Johnson, Piet Van Damme, Sophie Laurent |
| Agent | Jan Peeters, Karim Benali, Lisa Janssens, Marie Dubois, Tom Williams |

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

```bash
npm run db:migrate              # Apply pending migrations
npm run db:baseline             # Seed Drizzle ledger on existing DB (one-time)
npm run db:backup               # Backup to server/backups/ (gzipped, keeps last 10)
npm run db:backup:docker        # Same, from Docker container
```

## API Documentation

- **REST** — Swagger UI at `/api/v1/docs/`
- **tRPC** — Reference at `/api/v1/trpc-reference` (18 routers)

## Architecture

```
tessera/
├── server/          # Express + tRPC + Socket.io
│   ├── db/          # Drizzle ORM schema + connection
│   ├── trpc/        # tRPC router + domain routers
│   ├── socket/      # Real-time event handlers
│   ├── services/    # Business logic (AI, GDPR, archive, guards, mail)
│   └── middleware/   # Auth, validation
├── client/          # React + Vite + Tailwind
│   └── src/
│       ├── components/   # UI components by domain
│       ├── views/        # Page views (Platform, Admin, Support, Agent, Login)
│       ├── store/        # Zustand slices
│       └── hooks/        # Socket, i18n, store hooks
└── testing/         # k6 load tests + Playwright E2E
```

## License

Proprietary. All rights reserved.
