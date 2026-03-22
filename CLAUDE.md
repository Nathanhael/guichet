# CLAUDE.md

Guidance for Claude Code when working with the Tessera codebase.

## Project Overview

Tessera is a real-time, multi-tenant live chat platform. All complex features (Solaris theme, glassmorphism, animations) have been deactivated to focus on a lightweight, strictly monochrome, high-performance chat core.

## Commands

### Docker (Preferred Runtime)

> **NEVER** run `npm`, `node`, or `npx` directly on the host machine. All commands must go through Docker.

```bash
docker compose up                                          # Start all services (development)
docker compose exec server npm test                        # Run server tests
docker compose exec client npm test                        # Run client tests
docker compose exec server npx drizzle-kit push            # Database push
docker compose exec server npx drizzle-kit generate        # Generate migration
docker compose exec server npx drizzle-kit studio          # Interactive database explorer
docker logs -f tessera-server-1                            # Server logs
docker logs -f tessera-client-1                            # Client logs
```

### Build & Production

```bash
docker compose exec client npm run build                   # Vite production build
docker compose exec client npm run preview                 # Preview production build locally
docker compose -f docker-compose.prod.yml up               # Production deployment
docker compose -f docker-compose.prod.yml build            # Build prod images
```

## Architecture

### Server (`server/`)

**API Layer**:
- **tRPC (Primary)**: tRPC 11 for all data fetching and mutations. Router: `server/trpc/router.ts`. Procedures in `server/trpc/routers/` organized by domain. Input validation via Zod.
- **Express Routes**: Limited to Auth (`server/routes/auth.ts`) and Logos (`server/routes/logos.ts`).

**tRPC Middleware** (`server/trpc/trpc.ts`):
- `publicProcedure` → `protectedProcedure` → `adminProcedure` / `platformProcedure`
- `roleProcedure(roles[])` for dynamic role checks (platform operators bypass all role gates)

**Services** (`server/services/`):
- `bootstrap.ts` — First-run platform operator creation from `PLATFORM_ADMIN_EMAIL` env var
- `gdpr.ts` — Daily purge and per-partner aggregation (30-day retention)
- `guards.ts` — Content moderation pipeline (length, caps, repetition, injection, swearing, threats, discrimination)
- `businessHours.ts` — Business hours enforcement and queue position broadcasting
- `presence.ts` — User online/offline tracking via Redis
- `stats.ts` — Live statistics computation for dashboard

**Socket.io** (`server/socket/handlers.ts`):
- All real-time event handlers. Uses Redis adapter for horizontal scaling.
- Identity enforced server-side via `socket.data.userId` — never trust client-supplied identity fields.
- Key events: `message:send`, `message:read`, `ticket:new`, `ticket:close`, `support:join`, `support:leave`, `typing:*`, `presence:*`, `partner:deactivated`
- All mutation events verify partner-scope authorization before proceeding.

**Middleware** (`server/middleware/`):
- `auth.ts` — JWT verification and role-based access control
- `validator.ts` — Express-validator wrapper

### Database

**PostgreSQL 18** via **Drizzle ORM** (schema: `server/db/schema.ts`, config: `server/drizzle.config.ts`).

| Table | Purpose | Key Columns |
|---|---|---|
| `users` | Global user accounts | `id`, `email`, `password`, `lang` (nl/fr/en), `isPlatformOperator` |
| `partners` | Tenant organizations | `id`, `name`, `status` (active/inactive), `authMethod` (local/sso), `departments` (JSONB), `logoUrl`, `industry` |
| `memberships` | User-Partner junction | `userId`, `partnerId`, `role`, `departments` (JSONB array of dept IDs) |
| `tickets` | Support tickets | `id`, `partnerId`, `agentId`, `status` (open/active/closed), `participants` (JSONB) |
| `messages` | Per-ticket messages | `ticketId`, `senderId`, `text`, `whisper`, `reactions` (JSONB) |
| `daily_stats` | Aggregated metrics | `date`, `partnerId` (composite PK), per-partner daily stats |
| `audit_log` | Security/audit trail | `action`, `actorId`, `partnerId`, `targetType`, `targetId`, `metadata` (JSONB) |

### Client (`client/src/`)

**Stack**: React 19, Vite 8, Tailwind CSS 4, Zustand 5.

**State**: Zustand store with slices (`auth`, `tickets`, `messages`, `ui`, `config`, `rating`) in `store/useStore.ts`. JWT expiry is checked on hydration — expired tokens are cleared automatically.

**Real-Time**: `hooks/useSocket.ts` — single global Socket.io instance. Always clean up listeners in `useEffect` return.

**Views**:
- `PlatformView` — Platform operator: partner management, global users, system health, audit log
- `AdminView` — Partner admin: team, departments, tickets, business hours, labels, canned responses
- `SupportView` — Support staff: ticket queue by department, multi-tab chat
- `AgentView` — End-user: ticket creation, chat, attachments

**Aesthetics**: Strict B&W only. No colors, gradients, shadows, animations, or transitions. Use `dark:` Tailwind prefix for dark mode (light mode is default).

## Key Conventions

- **Roles**: `agent`, `support`, `admin`, `platform_operator`
- **Multi-Tenancy**: Every query must include `partner_id` filter. No data leaks between partners.
- **Multi-Partner Users**: Users belong to multiple partners via `memberships`. One active partner at a time — switching issues a new JWT via `/switch-partner`.
- **Partner Status**: `active` | `inactive`. Inactive blocks logins, ticket creation, switching. Enforce at login, switch-partner, socket, and tRPC layers.
- **Dynamic Departments**: Never hardcode department IDs. Always read from `partner.departments` JSONB. Schema: `{ id (auto-slug), name, description? }`. IDs are immutable.
- **Department Assignment**: `memberships.departments` is a JSONB array of dept IDs. Empty/null = generalist (sees all).
- **TypeScript**: No `any` types. Zod schemas on backend, TypeScript interfaces in `client/src/types/index.ts`.
- **bcrypt**: Dev uses `bcryptjs` (pure JS). Prod Dockerfile swaps to native `bcrypt` (C++) at build time. Source always imports `bcryptjs`.
- **Auth Method**: Per-partner setting (`local` | `sso`) via `authMethodEnum` pgEnum. Local partners generate temp passwords on invite; SSO partners skip password creation. Invite mutations return `tempPassword: ''` (not `null`) because tRPC without superjson strips null values.
- **Audit Logging**: All significant actions (partner lifecycle, user management, GDPR purges) recorded in `audit_log`.
- **Platform Operator Bootstrap**: On first startup with no platform operators, auto-creates one from `PLATFORM_ADMIN_EMAIL` (and optional `PLATFORM_ADMIN_PASSWORD`) env vars. Runs before server accepts traffic. Race-safe, non-fatal.
- **Platform Operator Partner Access**: Platform operators can enter any active partner's admin view via `POST /enter-partner` without needing a membership. Socket auth bypasses membership check for operators.

## Critical Mandates

- **STRICT B&W**: Pure black (#000) and white (#FFF) only. No colors, gradients, or shadows.
- **ZERO MOTION**: No animations, transitions, or effects. Static UI.
- **DOCKER ONLY**: Never run `npm`/`node`/`npx` on the host.
- **TYPE SAFETY**: No `any` types. Zod on backend, TypeScript on frontend.
- **MULTI-TENANCY**: Every query must filter by `partner_id`.
- **DYNAMIC DEPT**: Never hardcode department IDs.
- **AUDIT LOGGING**: Log all security-relevant actions.

## Project Structure

```
tessera/
├── server/
│   ├── db/
│   │   ├── schema.ts              # Database schema (Drizzle ORM)
│   │   └── postgres.ts            # DB connection, raw query helpers
│   ├── trpc/
│   │   ├── router.ts              # Main tRPC router
│   │   ├── trpc.ts                # Procedure middleware (auth, roles)
│   │   ├── context.ts             # JWT → tRPC context
│   │   └── routers/               # Domain routers (ticket, partner, platform, etc.)
│   ├── socket/
│   │   └── handlers.ts            # Socket.io event handlers
│   ├── routes/
│   │   ├── auth.ts                # /api/auth/* (login, switch-partner, enter-partner)
│   │   └── logos.ts               # /api/v1/logos
│   ├── services/                  # Business logic (bootstrap, gdpr, guards, presence, stats)
│   ├── middleware/                 # Express middleware (auth, validator)
│   ├── utils/                     # Logger, Redis, metrics, security
│   ├── app.ts                     # Server bootstrap
│   ├── config.ts                  # Env validation via Zod
│   └── drizzle.config.ts          # Drizzle Kit config
├── client/
│   ├── src/
│   │   ├── components/            # React components
│   │   ├── views/                 # Page views (Platform, Admin, Support, Agent, Login)
│   │   ├── hooks/                 # useSocket, useStore, etc.
│   │   ├── store/
│   │   │   ├── useStore.ts        # Zustand composed store
│   │   │   └── slices/            # Auth, ticket, message, UI, config, rating slices
│   │   ├── types/index.ts         # TypeScript interfaces
│   │   └── utils/trpc.ts          # tRPC client setup
│   └── Dockerfile
├── docker-compose.yml             # Development environment
├── docker-compose.prod.yml        # Production environment
└── CLAUDE.md                      # This file
```

## Debugging

- **Server logs**: `docker logs -f tessera-server-1`
- **Client logs**: Browser DevTools → Console
- **Socket events**: Browser DevTools → Network → WS tab
- **Database**: `docker compose exec server npx drizzle-kit studio`
- **Zustand state**: Redux DevTools browser extension

# context-mode — MANDATORY routing rules

You have context-mode MCP tools available. These rules are NOT optional — they protect your context window from flooding. A single unrouted command can dump 56 KB into context and waste the entire session.

## BLOCKED commands — do NOT attempt these

### curl / wget — BLOCKED
Any Bash command containing `curl` or `wget` is intercepted and replaced with an error message. Do NOT retry.
Instead use:
- `ctx_fetch_and_index(url, source)` to fetch and index web pages
- `ctx_execute(language: "javascript", code: "const r = await fetch(...)")` to run HTTP calls in sandbox

### Inline HTTP — BLOCKED
Any Bash command containing `fetch('http`, `requests.get(`, `requests.post(`, `http.get(`, or `http.request(` is intercepted and replaced with an error message. Do NOT retry with Bash.
Instead use:
- `ctx_execute(language, code)` to run HTTP calls in sandbox — only stdout enters context

### WebFetch — BLOCKED
WebFetch calls are denied entirely. The URL is extracted and you are told to use `ctx_fetch_and_index` instead.
Instead use:
- `ctx_fetch_and_index(url, source)` then `ctx_search(queries)` to query the indexed content

## REDIRECTED tools — use sandbox equivalents

### Bash (>20 lines output)
Bash is ONLY for: `git`, `mkdir`, `rm`, `mv`, `cd`, `ls`, `npm install`, `pip install`, and other short-output commands.
For everything else, use:
- `ctx_batch_execute(commands, queries)` — run multiple commands + search in ONE call
- `ctx_execute(language: "shell", code: "...")` — run in sandbox, only stdout enters context

### Read (for analysis)
If you are reading a file to **Edit** it → Read is correct (Edit needs content in context).
If you are reading to **analyze, explore, or summarize** → use `ctx_execute_file(path, language, code)` instead. Only your printed summary enters context. The raw file content stays in the sandbox.

### Grep (large results)
Grep results can flood context. Use `ctx_execute(language: "shell", code: "grep ...")` to run searches in sandbox. Only your printed summary enters context.

## Tool selection hierarchy

1. **GATHER**: `ctx_batch_execute(commands, queries)` — Primary tool. Runs all commands, auto-indexes output, returns search results. ONE call replaces 30+ individual calls.
2. **FOLLOW-UP**: `ctx_search(queries: ["q1", "q2", ...])` — Query indexed content. Pass ALL questions as array in ONE call.
3. **PROCESSING**: `ctx_execute(language, code)` | `ctx_execute_file(path, language, code)` — Sandbox execution. Only stdout enters context.
4. **WEB**: `ctx_fetch_and_index(url, source)` then `ctx_search(queries)` — Fetch, chunk, index, query. Raw HTML never enters context.
5. **INDEX**: `ctx_index(content, source)` — Store content in FTS5 knowledge base for later search.

## Subagent routing

When spawning subagents (Agent/Task tool), the routing block is automatically injected into their prompt. Bash-type subagents are upgraded to general-purpose so they have access to MCP tools. You do NOT need to manually instruct subagents about context-mode.

## Output constraints

- Keep responses under 500 words.
- Write artifacts (code, configs, PRDs) to FILES — never return them as inline text. Return only: file path + 1-line description.
- When indexing content, use descriptive source labels so others can `ctx_search(source: "label")` later.

## ctx commands

| Command | Action |
|---------|--------|
| `ctx stats` | Call the `ctx_stats` MCP tool and display the full output verbatim |
| `ctx doctor` | Call the `ctx_doctor` MCP tool, run the returned shell command, display as checklist |
| `ctx upgrade` | Call the `ctx_upgrade` MCP tool, run the returned shell command, display as checklist |
