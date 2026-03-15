# Tessera

Tessera is a high-fidelity, real-time multi-tenant customer support platform designed for seamless communication between Agents and Support Specialists.

## 🌟 Key Features

- **Multi-Tenant Architecture**: Complete data isolation with partner-specific branding and AI rules.
- **Asymmetric AI Pipeline**: Specialized AI strategies for `agent` vs `support` roles.
- **Real-Time Scaling**: Powered by Socket.io with Redis horizontal scaling and presence tracking.
- **Neuro-Inclusive Design (Solaris)**: Adaptive UI with glassmorphism, Dyslexic mode, and Bionic Reading.
- **Actionable AI**: Automated generation of customer scripts and internal procedures.
- **End-to-End Type Safety**: Built with tRPC, Drizzle ORM, and Zod.
- **Agent Lite PWA**: Installable mobile-first view for field agents with offline support.
- **Platform Observability**: Prometheus metrics + pre-provisioned Grafana dashboards.
- **Configurable Business Hours**: Per-partner opening hours with timezone support, configurable via Admin UI.
- **E2E Testing**: Playwright test suite (Chrome + Edge) covering auth, tickets, chat, admin, and tenant isolation.

## 🛠️ Tech Stack

- **Frontend**: React 18, Vite 5, Tailwind CSS 3, Framer Motion, Zustand (State).
- **Backend**: Node.js 20 (ESM), Express, tRPC (Type-safe API), Socket.io (Real-time).
- **Database**: 
  - **PostgreSQL 16**: Primary relational storage.
  - **Redis 7**: Presence tracking and Socket.io horizontal scaling.
  - **Drizzle ORM**: TypeScript-first schema and migration management.
- **AI**: Ollama REST API (Model-agnostic, running locally).
- **Observability**: Prometheus (Metrics), Grafana (Visualization), Pino (Structured logging).
- **Testing**: Vitest (Unit/Integration), Playwright (E2E).
- **Runtime**: Docker & Docker Compose.

## 🚀 Quick Start

1. **Environment Setup**:
   Copy the example environment file and fill in your secrets (especially `JWT_SECRET`).
   ```bash
   cp .env.example .env
   ```

2. **Docker Development**:
   ```bash
   docker-compose up
   ```
   *The server will be available at http://localhost:3001 and the client at http://localhost:5173.*

3. **Install Dependencies (Host-only)**:
   *Required for IDE type-sync only. Never run npm on host for execution.*
   ```bash
   npm run install:all
   ```

## 🔒 Security & Credentials

Tessera uses environment variables for all sensitive configuration. **Never commit your `.env` file.**

- **PostgreSQL**: Default credentials for local Docker are `user` / `password`.
- **Redis**: Default local instance has no password. Required for presence and horizontal scaling.
- **JWT**: In production, you MUST set a unique `JWT_SECRET`.
- **Grafana**: Default admin credentials are `admin` / `admin` (configurable via `GRAFANA_ADMIN_PASSWORD`).
- **Prometheus**: Default local instance has no authentication.
- **E2E Tests**: Tests seed their own data using the `E2E_TEST_DB_URL`.


## 🚨 Critical Mandates (for AI Agents)

- **DOCKER ONLY**: Always execute commands inside containers (`docker compose exec ...`).
- **SOLARIS UI**: Adhere to glassmorphism standards in `client/src/index.css`.
- **LOCALIZATION**: Use the `useT` hook for all UI strings.
- **TYPE SAFETY**: Maintain 100% TypeScript coverage in `client/src/types/index.ts`.

## 🧪 Testing

```bash
# Unit tests
cd server && npm test        # Backend
cd client && npm test        # Frontend

# E2E tests (requires Docker stack running)
npm run test:e2e             # Against Docker
npm run test:e2e:mock        # Against mock server (start first: cd e2e && npm run mock:start)
```

## 📊 Observability & Monitoring

When running via Docker Compose, the monitoring stack is available:
- **Prometheus**: http://localhost:9090 (Metric collection)
- **Grafana**: http://localhost:3000 (Dashboards - default `admin`/`admin`)
- **Metrics Endpoint**: http://localhost:3001/metrics (Prometheus format)
- **Database Studio**: `cd server && npx drizzle-kit studio` (Visual DB explorer)


## 📖 Documentation

- **[TECHNICAL.md](./docs/TECHNICAL.md)**: Deep dive into the architecture and scaling.
- **[API_REFERENCE.md](./docs/API_REFERENCE.md)**: Formal list of versioned REST and tRPC endpoints.
- **[AI_PIPELINE.md](./docs/AI_PIPELINE.md)**: Details on the multi-stage AI transformation.
- **[USER_GUIDE.md](./docs/USER_GUIDE.md)**: Walkthrough of the 5 platform roles.
- **[CLAUDE.md](./CLAUDE.md)**: Specialized guidance for AI coding assistants.
