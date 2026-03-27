# CLAUDE.md

Guidance for Claude Code when working with the Tessera codebase.

## Project Overview

Tessera is a real-time, multi-tenant live chat platform with a brutalist design system. CSS custom property tokens drive the entire UI (light/dark mode), self-hosted JetBrains Mono + Inter fonts, zero external CDN dependencies.

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

### Database Management

```bash
npm run db:migrate                    # Apply pending Drizzle migrations
npm run db:baseline                   # Seed migration ledger for existing DBs (one-time, interactive)
npm run db:backup                     # Dump DB to server/backups/ (gzipped, auto-prunes to 10)
npm run db:backup:docker              # Same, but from Docker 'db' container
```

**Migration path**:
- Fresh database → `npm run db:migrate`
- Existing DB with empty Drizzle ledger → `npm run db:baseline` then `db:migrate` going forward
- Before risky migrations → `npm run db:backup` first

### Build & Production

```bash
docker compose exec client npm run build                   # Vite production build
docker compose exec client npm run preview                 # Preview production build locally
docker compose -f docker-compose.prod.yml up               # Production deployment
docker compose -f docker-compose.prod.yml build            # Build prod images
```

### Demo Users

```bash
docker compose exec server npx tsx scripts/reset_demo_users.ts   # Reset all demo users to clean state
docker compose exec server npx tsx seed_pg.ts                    # Full seed (partners, users, labels)
```

All demo users use password `password123`. The reset script clears lockout, MFA, platform TOTP, password history, and re-hashes passwords. Platform step-up TOTP is controlled by `REQUIRE_PLATFORM_STEP_UP` (default `false`). When `false`, all PlatformView tabs are accessible without authenticator setup. Set to `true` in production to enforce TOTP verification before accessing platform admin.

## Architecture

### Server (`server/`)

**API Layer**:
- **tRPC (Primary)**: tRPC 11 for all data fetching and mutations. Router: `server/trpc/router.ts`. Procedures in `server/trpc/routers/` organized by domain. Input validation via Zod.
- **Express Routes**: Auth (`server/routes/auth.ts`), SSO (`server/routes/sso.ts`), Logos (`server/routes/logos.ts`), Uploads (`server/routes/uploads.ts`).

**tRPC Middleware** (`server/trpc/trpc.ts`):
- `publicProcedure` → `protectedProcedure` → `adminProcedure` / `platformProcedure`
- `roleProcedure(roles[])` for dynamic role checks (platform operators bypass all role gates)

**Services** (`server/services/`):
- `bootstrap.ts` — First-run platform operator creation from `PLATFORM_ADMIN_EMAIL` env var
- `gdpr.ts` — Daily purge and per-partner aggregation (30-day retention)
- `archive.ts` — WORM audit archive (SHA-256 hash chain) + ticket archiving with summary metadata
- `guards.ts` — Content moderation pipeline (length, caps, repetition, injection, swearing, threats, discrimination)
- `businessHours.ts` — Business hours enforcement and queue position broadcasting
- `presence.ts` — User online/offline tracking via Redis
- `stats.ts` — Live statistics computation for dashboard
- `accountLockout.ts` — 5-attempt lockout with 15-min window, email notification
- `mail.ts` / `mailTemplates.ts` — Centralized email service + B&W templates (lockout, MFA, password reset)

**Socket.io** (`server/socket/handlers.ts`):
- All real-time event handlers. Uses Redis adapter for horizontal scaling.
- Identity enforced server-side via `socket.data.userId` — never trust client-supplied identity fields.
- Key events: `message:send`, `message:read`, `message:edit`, `message:delete`, `ticket:new`, `ticket:close`, `ticket:reopen`, `ticket:transfer`, `ticket:labels:update`, `support:join`, `support:leave`, `typing:*`, `presence:*`, `partner:deactivated`, `canned:list`, `canned:create`, `canned:update`, `canned:delete`
- All mutation events verify partner-scope authorization before proceeding.
- **Token expiry**: JWT `exp` is stored at handshake and checked on every event via `requireIdentified()`. Expired tokens trigger `auth:expired` → client auto-reconnects (cookies sent automatically via `withCredentials: true`).

**Middleware** (`server/middleware/`):
- `auth.ts` — JWT verification (reads HttpOnly cookie with Bearer header fallback) and role-based access control
- `validator.ts` — Express-validator wrapper

### Database

**PostgreSQL 18** via **Drizzle ORM** (schema: `server/db/schema.ts`, config: `server/drizzle.config.ts`).

| Table | Purpose | Key Columns |
|---|---|---|
| `users` | Global user accounts | `id`, `email`, `password`, `lang` (nl/fr/en), `isPlatformOperator` |
| `partners` | Tenant organizations | `id`, `name`, `status` (active/inactive), `authMethod` (local/sso), `departments` (JSONB), `logoUrl`, `industry` |
| `memberships` | User-Partner junction | `userId`, `partnerId`, `role`, `departments` (JSONB array of dept IDs) |
| `tickets` | Support tickets | `id`, `partnerId`, `agentId`, `status` (open/pending/closed/resolved), `participants` (JSONB) |
| `messages` | Per-ticket messages | `ticketId`, `senderId`, `body`, `whisper`, `reactions` (JSONB), `editedAt`, `deletedAt` |
| `daily_stats` | Aggregated metrics | `date`, `partnerId` (composite PK), per-partner daily stats |
| `audit_log` | Security/audit trail | `action`, `actorId`, `partnerId`, `targetType`, `targetId`, `metadata` (JSONB) |
| `audit_archive` | WORM audit archive | SHA-256 `chainHash`, `archivedAt`, same fields as audit_log |
| `archived_tickets` | Ticket archive | Ticket summary + `messageCount`, `archivedAt`, no message content |
| `labels` | Ticket labels | `partnerId`, `name`, `color` |
| `ticket_labels` | Ticket↔Label junction | `ticketId`, `labelId` |
| `canned_responses` | Per-partner response templates | `partnerId`, `title`, `body`, `shortcut`, `category`, `createdBy` |

### Client (`client/src/`)

**Stack**: React 19, Vite 8, Tailwind CSS 4, Zustand 5.

**State**: Zustand store with slices (`auth`, `tickets`, `messages`, `ui`, `config`, `rating`) in `store/useStore.ts`. Session expiry is detected via the `session_expires` cookie (non-HttpOnly companion to the JWT HttpOnly cookie).

**Real-Time**: `hooks/useSocket.ts` — single global Socket.io instance. Always clean up listeners in `useEffect` return.

**Views**:
- `PlatformView` — Thin shell (tabs + modal state). Feature modules in `components/platform/` (PartnerList, UserTable, CreatePartnerModal, EditPartnerModal, DeletePartnerModal, InviteUserModal, ManageAccessModal, EditUserProfileModal). Each component owns its own tRPC hooks and cache invalidation.
- `AdminView` — Partner admin: team, departments, tickets, business hours, labels, canned responses
- `SupportView` — Support staff: ticket queue by department, multi-tab chat
- `AgentView` — End-user: ticket creation, chat, attachments

**Aesthetics**: Raw/Exposed Brutalist design. Zinc+Blue dark theme (#09090b base) and Warm Stone light theme (#fafaf9 base). JetBrains Mono for UI chrome (nav, labels, badges, buttons), Inter for content text (messages, descriptions). Minimal functional motion (150ms fade-in only). No gradients, no shadows, no border-radius. Design tokens defined as CSS custom properties in `index.css`. See `docs/superpowers/specs/2026-03-26-brutalist-redesign-design.md` for full spec.

## Key Conventions

- **Roles**: `agent`, `support`, `admin`, `platform_operator`
- **Multi-Tenancy**: Every query must include `partner_id` filter. No data leaks between partners.
- **Multi-Partner Users**: Users belong to multiple partners via `memberships`. One active partner at a time — switching issues a new JWT cookie via `/switch-partner`.
- **HttpOnly Cookie Auth**: JWTs are transported via `HttpOnly SameSite=Lax` cookies (`tessera_token`). Client uses `credentials: 'include'` on all requests. A companion `session_expires` cookie (non-HttpOnly) carries the expiry timestamp for client-side detection. Config: `COOKIE_SECURE` (default `true`), `COOKIE_DOMAIN` (optional, for subdomains).
- **Partner Status**: `active` | `inactive`. Inactive blocks logins, ticket creation, switching. Enforce at login, switch-partner, socket, and tRPC layers.
- **Dynamic Departments**: Never hardcode department IDs. Always read from `partner.departments` JSONB. Schema: `{ id (auto-slug), name, description? }`. IDs are immutable.
- **Department Assignment**: `memberships.departments` is a JSONB array of dept IDs. Empty/null = generalist (sees all).
- **TypeScript**: No `any` types. Zod schemas on backend, TypeScript interfaces in `client/src/types/index.ts`.
- **Argon2id**: Password hashing uses `argon2` (native C bindings). No bcrypt anywhere in the codebase.
- **Auth Method**: Per-partner setting (`local` | `sso`) via `authMethodEnum` pgEnum. Local partners generate temp passwords on invite; SSO partners skip password creation. Invite mutations return `tempPassword: ''` (not `null`) because tRPC without superjson strips null values.
- **Audit Logging**: All significant actions (partner lifecycle, user management, GDPR purges) recorded in `audit_log`.
- **MFA (TOTP)**: Per-user MFA via `mfaSecret`, `mfaEnabledAt`, `mfaRecoveryCodes` (SHA-256 hashed). Setup/enable/disable via `trpc.mfa.*`. Login challenge returns `{ mfaRequired: true }` and waits for TOTP code re-submission.
- **Account Lockout**: 5 failed login attempts → 15-minute lockout. State in `failedLoginAttempts` + `lockedUntil` columns. Email notification on lockout (fire-and-forget).
- **Password Policies**: Min 10 chars, upper/lower/digit/special required, common password blocking, email/name inclusion check. History check prevents reuse of last 5 passwords (Argon2id verified).
- **WORM Archive**: Tamper-evident SHA-256 hash chain for audit log. Automatic archival before GDPR purge. Chain integrity verification endpoint. Tickets archived with message count summary.
- **Cursor-Based Pagination**: Ticket list and audit archive use keyset pagination (`createdAt|id` composite cursor). Pattern: fetch `limit+1`, detect hasMore, return `{ items, nextCursor }`.
- **Platform Operator Bootstrap**: On first startup with no platform operators, auto-creates one from `PLATFORM_ADMIN_EMAIL` (and optional `PLATFORM_ADMIN_PASSWORD`) env vars. Runs before server accepts traffic. Race-safe, non-fatal.
- **Platform Operator Partner Access**: Platform operators can enter any active partner's admin view via `POST /enter-partner` without needing a membership. Socket auth bypasses membership check for operators.

## Critical Mandates

- **BRUTALIST TOKENS**: Use CSS custom property design tokens from index.css. No inline colors, no gradients, no shadows, no border-radius.
- **MINIMAL MOTION**: Only fade-in (150ms) for panels/modals. No slides, bounces, or transitions. Respect prefers-reduced-motion.
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
│   ├── services/                  # Business logic (bootstrap, gdpr, archive, guards, presence, stats, mail)
│   ├── middleware/                 # Express middleware (auth, validator)
│   ├── utils/                     # Logger, Redis, metrics, security
│   ├── app.ts                     # Server bootstrap
│   ├── config.ts                  # Env validation via Zod
│   └── drizzle.config.ts          # Drizzle Kit config
├── client/
│   ├── src/
│   │   ├── components/            # React components
│   │   │   ├── platform/          # PlatformView feature modules (self-contained)
│   │   │   │   ├── __tests__/     # Vitest tests for platform components
│   │   │   │   └── types.ts       # Shared types (Partner, GlobalUser, etc.)
│   │   │   ├── ConfirmDialog.tsx   # Reusable confirmation modal
│   │   │   └── Toast.tsx           # Auto-dismissing notification
│   │   ├── views/                 # Page views (Platform, Admin, Support, Agent, Login)
│   │   │   └── __tests__/         # Vitest tests for views
│   │   ├── hooks/                 # useSocket, useStore, etc.
│   │   ├── store/
│   │   │   ├── useStore.ts        # Zustand composed store
│   │   │   └── slices/            # Auth, ticket, message, UI, config, rating slices
│   │   ├── types/index.ts         # TypeScript interfaces
│   │   ├── test/
│   │   │   ├── setup.ts           # Vitest setup (cleanup, jest-dom)
│   │   │   └── helpers.tsx        # Test factories and mock builders
│   │   └── utils/trpc.ts          # tRPC client setup
│   └── Dockerfile
├── testing/
│   ├── nginx.conf                 # Reverse proxy config for load testing
│   ├── load/                      # k6 load test scripts (smoke.js, load.js, ws.js)
│   └── e2e/                       # Playwright E2E specs
├── playwright.config.ts           # Playwright E2E config
├── PLAN.md                        # Next sprint plan (MFA admin, notification prefs, API docs)
├── .github/workflows/ci.yml      # CI: typecheck, tests, migrations, e2e, build
├── docker-compose.yml             # Development environment
├── docker-compose.prod.yml        # Production environment
├── CHANGELOG.md                   # Project changelog
└── CLAUDE.md                      # This file
```

## CI Pipeline

GitHub Actions (`.github/workflows/ci.yml`) runs 5 parallel jobs on push/PR to `main`:

| Job | What it checks |
|-----|----------------|
| `lint-and-typecheck` | `tsc --noEmit` on both server and client |
| `test-client` | Client unit tests (Vitest + jsdom) |
| `test-server` | Server unit tests (Vitest + node) |
| `migrate-check` | Runs `db:migrate` against a fresh Postgres 18 service container |
| `e2e` | Playwright E2E tests against Postgres 18 + built client (Chromium) |

Build only proceeds if all 5 pass.

## Load Testing

k6 scripts in `testing/load/`. Run via Docker:

```bash
MSYS_NO_PATHCONV=1 docker run --rm --network=host -v "$(pwd)/testing/load:/scripts" grafana/k6 run /scripts/smoke.js
MSYS_NO_PATHCONV=1 docker run --rm --network=host -v "$(pwd)/testing/load:/scripts" grafana/k6 run /scripts/load.js
```

| Script | VUs | Duration | Tests |
|--------|-----|----------|-------|
| `smoke.js` | 1 | 30s | health, login, ticket.list |
| `load.js` | 50 | 3m | random mix of endpoints under sustained load |

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
