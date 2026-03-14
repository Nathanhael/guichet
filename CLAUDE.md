# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Tessera is a real-time, multi-tenant live chat platform. Agents create tickets, support specialists handle them with live translation, and admins monitor qualitative AI insights. Five roles: `agent`, `support`, `manager`, `admin`, `platform_operator`. All code uses ES modules (`"type": "module"`).

## Commands

### Development

```bash
npm run dev              # Start both client and server concurrently
npm run install:all      # Install client + server dependencies
```

Separately:
```bash
cd server && npm run dev   # Express on port 3001 (node --watch)
cd client && npm run dev   # Vite on port 5173
```

### Docker (preferred runtime)

> [!IMPORTANT]
> **NEVER** run `npm`, `node`, or `npx` directly on the host machine — it causes `node_modules` sync issues with the container. All commands must go through Docker.

```bash
docker-compose up                                          # Start all services (development)
docker-compose -f docker-compose.prod.yml up --build      # Production build
docker-compose exec server npm test                        # Run server tests in container
docker-compose exec client npm test                        # Run client tests in container
docker logs -f tessera-server-1                     # Tail server logs
```

> [!TIP]
> Use `docker-compose exec` over `docker exec` when possible for cleaner environment variable inheritance.

### Testing

```bash
cd server && npm test           # Backend tests (vitest, single run)
cd server && npm run test:watch # Backend tests (watch mode)
cd client && npm test           # Frontend tests (vitest, single run)
cd client && npm run test:watch # Frontend tests (watch mode)
```

Vitest supports filtering: `npx vitest run auth` runs only files matching "auth".

### Build

```bash
cd client && npm run build    # Vite production build
cd client && npm run preview  # Preview production build
```

> [!IMPORTANT]
> Always run `npm run build` after major UI or dependency changes to verify the manual chunk splitting produces no warnings.

## Architecture

For detailed diagrams and AI translation pipeline docs, see **[ARCHITECTURE.md](./ARCHITECTURE.md)** and **[CONTRIBUTING.md](./CONTRIBUTING.md)** (Solaris design system rules).

### Server (`server/`)

**Entry point**: `app.ts` — mounts all routes, initializes Socket.io, starts GDPR purge cycle and queue broadcasting.

**API Layer**: 
- **tRPC (Primary)**: The application uses **tRPC** for almost all data fetching and mutations. 
  - Root router: `server/trpc/router.ts`
  - Domain routers: `server/trpc/routers/*.ts`
- **Express Routes (Legacy/Specific)**: 
  - `auth.ts` — JWT login (bcrypt passwords, 24h tokens)
  - `tickets.ts` — CSV export
  - `uploads.ts` — Multer-based file uploads

**Services** (`server/services/`):
- `translate.ts` — Two-stage Ollama pipeline: Improve text → Translate if langs differ. Results cached in `translations_cache` (SHA256 key). Gracefully degrades if Ollama is down (`fallback: true`).
- `llm.ts` — Generates sentiment/topic summaries per period (day/week/month), cached in `llm_summaries` table.
- `businessHours.ts` — Brussels timezone check (configurable range, default 07:30–22:30). Enforced server-side on ticket creation.
- `gdpr.ts` — Daily purge: aggregates records older than 30 days into `daily_stats`, then deletes in a Drizzle transaction.
- `stats.ts` — Stats computation logic used by the `stats` tRPC router.

**Socket** (`server/socket/handlers.ts`):
Registers all real-time event handlers. Tickets use rooms named `ticket:{ticketId}`.

Key events: `socket:identify`, `ticket:new`, `support:join`, `support:leave`, `ticket:close`, `message:send`, `status:set`, `reaction:toggle`, `ticket:labels:update`.

**Message pipeline** (integrated in `message.send` tRPC mutation):
1. Guards (8-tier: length → ALL CAPS → repetition → injection → swearing → threats → discrimination → async Ollama topic check)
2. Improve (role-specific Ollama prompt)
3. Translate (if sender/recipient langs differ)
4. Broadcast with `originalText`, `improvedText`, `processedText`, and `translationSkipped`/`fallback` flags.

**Middleware** (`server/middleware/`):
- `auth.ts` — JWT extraction + verification; `authorize(role)` for role-gating.
- Rate limiting: 100 req/min globally, 5 auth attempts/min.
- Uploads: magic-byte validated via `file-type` package (not just MIME).

### Database

PostgreSQL via **Drizzle ORM** (config: `server/drizzle.config.ts`). Core tables:

| Table | Purpose |
|---|---|
| `users` | Accounts with role, dept (DSC/FOT), lang (nl/fr/en) |
| `tickets` | Status: open → active → closed; stores participants JSON array |
| `messages` | Per-ticket messages with `whisper` (private), `system` (auto-generated), `reactions` JSON |
| `ratings` | 1–5 star ratings per closed ticket |
| `ticket_labels` / `labels` | Junction + label definitions |
| `translations_cache` | SHA256-keyed translation cache |
| `llm_summaries` | Period-keyed AI summaries (e.g. `day:2025-03-13`) |
| `daily_stats` | GDPR-compliant aggregates after purge |
| `canned_responses` | Shortcut → text templates |

### Client (`client/src/`)

**Entry**: `App.tsx` — lazy-loads `AgentView`, `SupportView`, `AdminView` by role. Fetches `/api/config` on mount. Global connection banner (disconnected/reconnecting).

**State**: Zustand store (`store/useStore.ts`) — single source of truth for auth, tickets, messages (normalized by ticketId), presence, UI settings. Persists to localStorage: token, darkMode, dyslexicMode, bionicReading, selectedLang.

**Real-time**: `hooks/useSocket.ts` — single Socket.io instance, registers all listeners (ticket events, messages, presence, typing, reactions, queue position, business hours).

**Client-side patterns**:
- Optimistic message updates (`pending: true`) replaced when server confirms.
- Socket auto-reconnects with exponential backoff (1–5s).
- `client/src/types/index.ts` is the canonical type source.

**Code splitting** (`vite.config.ts` manual chunks):
- `vendor-charts` (Recharts + D3), `vendor-ui-icons` (Lucide), `vendor-ui-anim` (Framer Motion), `vendor` (other deps).

**Primary views** (`client/src/views/`):
- **AgentView**: Ticket creation and requester chat.
- **SupportView**: Queue management and resolution (Zen Mode).
- **AdminView**: Operational and AI Dashboards, and AI Persona configuration.
- **PlatformView**: Global partner and membership management (Operator only).

### Key Conventions

- **Roles**: `agent`, `support`, `manager`, `admin`, `platform_operator`.
- **Multi-Tenancy**: All data must be scoped by `partner_id`. Never leak cross-partner data.
- **Transversal**: Users can have multiple `memberships`. Use `usePartner()` hook for active context.
- **Aesthetics**: Solaris design system — glassmorphism, dynamic CSS variables (`--brand-primary`).
- **AI Pipeline**: Tenant-aware (checks `ai_enabled`). 
  - **Asymmetric**: Different improvement strategies for `agent` vs `support`.
  - **Actionable**: Structured support replies (`[STEPS]`, `[CUSTOMER_SCRIPT]`).
  - **Sentiment**: Every non-whisper message is asynchronously scored via Ollama (`llm.ts`).
- **Scaling**: Redis-based Presence and Socket.io adapter. Avoid in-memory state for enterprise scalability.
- **TypeScript**: 100% type safety. Avoid `any`. Maintain interfaces in `client/src/types/index.ts`.
- **Ollama**: `http://host.docker.internal:11434`, model-agnostic (per-partner config).
