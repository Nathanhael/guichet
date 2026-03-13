# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

M&P Support is a real-time chat web app for telecom customer support. Agents create tickets, experts handle them with live translation (Ollama LLM), and admins monitor KPIs. Three roles: `agent`, `expert`, `admin`. All code uses ES modules (`"type": "module"`).

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
docker logs -f i-pxs-support-server-1                     # Tail server logs
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

Key events: `socket:identify`, `ticket:new`, `expert:join`, `expert:leave`, `ticket:close`, `message:send`, `status:set`, `reaction:toggle`, `ticket:labels:update`.

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

**Entry**: `App.tsx` — lazy-loads `AgentView`, `ExpertView`, `AdminView` by role. Fetches `/api/config` on mount. Global connection banner (disconnected/reconnecting).

**State**: Zustand store (`store/useStore.ts`) — single source of truth for auth, tickets, messages (normalized by ticketId), presence, UI settings. Persists to localStorage: token, darkMode, dyslexicMode, bionicReading, selectedLang.

**Real-time**: `hooks/useSocket.ts` — single Socket.io instance, registers all listeners (ticket events, messages, presence, typing, reactions, queue position, business hours).

**Client-side patterns**:
- Optimistic message updates (`pending: true`) replaced when server confirms.
- Socket auto-reconnects with exponential backoff (1–5s).
- `client/src/types/index.ts` is the canonical type source.

**Code splitting** (`vite.config.ts` manual chunks):
- `vendor-charts` (Recharts + D3), `vendor-ui-icons` (Lucide), `vendor-ui-anim` (Framer Motion), `vendor` (other deps).

**Admin views** (`components/admin/Stats/`): `StaffingDemand.tsx`, `LLMSummary.tsx`, `TopicSummary.tsx` — compose into `AdminStats.tsx`.

### Key Conventions

- **Roles**: `agent`, `expert`, `admin`. **Departments**: `DSC` (Billing & Sales), `FOT` (Technical).
- **Aesthetics**: Solaris design system — glassmorphism, vibrant gradients. Two themes: **Solaris Light** (soft, premium whitespace) and **Liquid Dark** (deep blues/purples with glass overlays). Never use plain Tailwind colors like `bg-blue-500`. Use `.glass-card` for primary containers, `.glass-panel` for sidebars/headers (always with `backdrop-blur`). Theme color tokens (defined in `index.css`): Solaris Purple `rgba(168, 85, 247, 0.4)`, Solaris Blue `rgba(59, 130, 246, 0.4)`. Use `bg-gradient-to-br` for background surfaces.
- **Fonts**: `Lexend` for dyslexic mode; `Outfit`/`Inter` for standard UI.
- **Localization**: Use the `useT` hook for all UI strings. Hardcoded strings (e.g. guard messages) are currently Dutch but the goal is full language agnosticism — avoid adding new Dutch-hardcoded strings and prefer i18n keys instead.
- **BionicText**: Wrap text-heavy components with `<BionicText />` to support bionic reading mode.
- **Safety**: Business hours enforced server-side (`server/services/businessHours.ts`) and client-side (`BusinessHoursGuard.tsx`). GDPR purge every 24h.
- **Zustand pitfall**: `messages` and `typingUsers` in `useStore.ts` are keyed by `ticketId` — never wipe them during partial updates; always use functional updates or shallow copies for nested ticket properties. Use descriptive setters (e.g., `setDyslexicMode` not `toggleMode`).
- **TypeScript**: Avoid `any` — define interfaces in `client/src/types/index.ts` (canonical type source) or at the top of the relevant file.
- **Socket room membership**: Socket.io rooms are in-memory and lost on reconnect. Agents auto-rejoin their active ticket rooms on `socket:identify` (handlers.ts). Experts explicitly re-join via `expert:join` when clicking a ticket. Any new role/feature that needs real-time events must join the relevant room.
- **pg type parsers**: `server/db/postgres.ts` sets `types.setTypeParser(1114/1184)` to return `timestamptz`/`timestamp` columns as raw strings. Raw `pool.query()` calls bypass Drizzle's `mode: 'string'` — without these parsers, Date objects are returned and `.startsWith()` calls on timestamps will crash.
- **`message:new` socket payload**: Server emits a flat `Message` object (no wrapper). Client listener is `s.on('message:new', (message: Message) => ...)` — not `({ message })`.
- **AdminStats error handling**: Always check `r.ok` before calling `setStats` — a 500 error body is truthy and will be set as stats, causing a render crash with no ErrorBoundary (blank screen).
- **Socket listeners**: Always implement a cleanup teardown in `useEffect` for any listeners registered outside `useSocket.ts`.
- **Ollama**: `http://host.docker.internal:11434`, model `gemmatranslate4b`. Always handle the offline case.
- **Config**: All env vars live in `server/config.ts` (PORT, CORS_ORIGIN, JWT_SECRET, SLA_THRESHOLD_MS, etc.).
- **Vite proxy**: `/api` and `/uploads` proxied to `localhost:3001` (configured in `vite.config.ts`).
