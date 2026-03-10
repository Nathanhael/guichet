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

```bash
docker-compose up                                    # Start all services
docker exec i-pxs-support-server-1 node <file>.js   # Run a script in server container
docker logs -f i-pxs-support-server-1                # Tail server logs
```

### Testing

```bash
cd server && npm test           # Backend tests (vitest, single run)
cd server && npm run test:watch # Backend tests (watch mode)
cd client && npm test           # Frontend tests (vitest, single run)
cd client && npm run test:watch # Frontend tests (watch mode)
```

Via Docker:
```bash
docker-compose exec server npm test
docker-compose exec client npm test
```

Vitest supports filtering: `npx vitest run auth` runs only files matching "auth".

### Build

```bash
cd client && npm run build    # Vite production build
cd client && npm run preview  # Preview production build
```

## Architecture

### Backend (server/)

**Entry**: `index.js` → `app.js`. The app.js file is large — it contains Express setup, all Socket.io event handlers, stats/export endpoints, and the GDPR purge scheduler.

**Database**: SQLite via `better-sqlite3` with WAL mode. Use the helpers from `db.js`:
- `query(sql, params)` — returns all rows
- `get(sql, params)` — returns one row
- `run(sql, params)` — execute INSERT/UPDATE/DELETE
- `transaction(fn)` — wraps in atomic transaction

Schema is in `db/schema.sql` and auto-applied on startup. Tables are indexed on common query columns.

**Auth**: JWT tokens via `middleware/auth.js`. Two middleware functions:
- `auth` — verifies Bearer token, attaches `req.user = { userId, role }`
- `authorize(['agent', 'expert', 'admin'])` — checks role

**Config**: All env vars centralized in `config.js` with defaults. Key: `OLLAMA_HOST`, `JWT_SECRET`, `BUSINESS_HOURS_*`, `SLA_THRESHOLD_MS`, `GDPR_RETENTION_DAYS`.

**Rate limiting**: Three tiers applied in app.js — global (100/min), auth (5/min), LLM (10/min).

### Frontend (client/)

**Routing**: `App.jsx` reads `user.role` from Zustand and renders `AgentView`, `ExpertView`, or `AdminView`.

**State**: Single Zustand store in `store/useStore.js`. Key slices:
- `user`, `token` — auth state (token persisted to localStorage)
- `tickets[]`, `messages{}` — tickets array and messages keyed by ticketId
- `connectionStatus` — socket connection state
- `onlineExperts[]`, `typingUsers{}` — real-time presence

**Socket**: `hooks/useSocket.js` manages the Socket.io connection with auto-reconnect (infinite retries, 1-5s backoff). Re-identifies user on every reconnect. All socket event listeners are registered here and update the Zustand store.

**Admin dashboard**: `components/admin/` is modular — `Stats/`, `Performance/`, `Archive/`, `Feedback/`, `Labels/`, `shared/`. The orchestrator is `AdminView.jsx`.

### Real-time Flow

1. Client emits socket event (e.g., `message:send`)
2. Server handler in `app.js` processes it (translates via Ollama if needed)
3. Server broadcasts to room (e.g., `message:new`)
4. `useSocket.js` listener updates Zustand store
5. React components re-render

### Translation

`services/translate.js` calls Ollama REST API. Cache key is `${fromLang}:${toLang}:${text}` stored in `translations_cache` table. Same-language messages skip translation. Ollama failures degrade gracefully (original text shown).

### Key Conventions

- Roles are `agent`, `expert`, `admin` (not "manager")
- Departments: `DSC` (Billing & Sales), `FOT` (Technical)
- Business hours enforced both server-side (socket middleware) and client-side
- Uploads validated by magic bytes (`file-type` package), not just MIME
- CSV exports escape formula-injection characters (`=`, `+`, `-`, `@`)
- GDPR: individual data purged after 30 days, aggregated into `daily_stats` first
- Vite proxies `/api` and `/uploads` to server (configured in `vite.config.js`)
