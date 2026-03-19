# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Tessera is a real-time, multi-tenant live chat platform (Clean Slate). All complex features (Solaris theme, glassmorphism, animations) have been deactivated to focus on a lightweight, strictly monochrome, high-performance chat core.

## Commands

### Docker (Preferred Runtime)

> [!IMPORTANT]
> **NEVER** run `npm`, `node`, or `npx` directly on the host machine. All commands must go through Docker.

```bash
docker compose up                                          # Start all services (development)
docker compose exec server npm test                        # Run server tests in container
docker compose exec client npm test                        # Run client tests in container
docker compose exec server npx drizzle-kit push            # Database push
```

### Build

```bash
docker compose exec client npm run build    # Vite production build
docker compose exec client npm run preview  # Preview production build
```

### Production

```bash
docker compose -f docker-compose.prod.yml up    # Production deployment
docker compose -f docker-compose.prod.yml build  # Build prod images
```

## Architecture

### Server (`server/`)

**API Layer**:
- **tRPC (Primary)**: The application uses **tRPC 11.13.4** for almost all data fetching and mutations.
- **Express Routes**: Limited to legacy Auth and File Uploads.

**Services** (`server/services/`):
- `translate.ts` — Ollama pipeline for text improvement and translation.
- `llm.ts` — Generates sentiment/topic summaries.
- `topicHeat.ts` — Background worker for incident detection.
- `gdpr.ts` — Daily purge and aggregation (30-day retention).

**Socket** (`server/socket/handlers.ts`):
Registers all real-time event handlers. Uses Redis adapter for scaling. Includes `partner:deactivated` event for real-time partner lifecycle notifications.

### Database

**PostgreSQL 18** via **Drizzle ORM 0.45.1** (config: `server/drizzle.config.ts`). Core tables:

| Table | Purpose |
|---|---|
| `users` | Accounts with lang (nl/fr/en), `isPlatformOperator` flag, Azure `externalId` |
| `memberships` | Junction table: links users to partners with role and departments (JSONB array) |
| `tickets` | Status: open → active → closed; stores participants JSON array |
| `messages` | Per-ticket messages with `whisper` (private), `reactions` JSON |
| `partners` | Tenant config with `departments` JSONB, `status` (active/inactive), AI settings |
| `audit_log` | Platform event tracking: action, actor, partner, target, metadata |

### Client (`client/src/`)

**Stack**: **React 19.2**, **Vite 8**, **Tailwind CSS 4**, **Zustand 5**.

**State**: Zustand store (`store/useStore.ts`) — single source of truth for auth, tickets, messages, and UI settings.

**Real-time**: `hooks/useSocket.ts` — single Socket.io instance.

**Aesthetics**: Strict B&W Minimalist. Zero motion, zero color, zero transitions. Solid black/white surfaces only.

**Views**:
- `PlatformView` — Platform operator: partner management (active/inactive), global users, system health, audit log.
- `AdminView` — Partner admin: dashboard, team management, departments, tickets, business hours, AI, labels, canned responses.
- `SupportView` — Support staff: ticket queue filtered by assigned departments, multi-tab chat.
- `AgentView` — End-user: ticket creation, chat.

**Guards**: `PartnerUnavailable` component handles deleted/inactive partners across all views.

### Key Conventions

- **Roles**: `agent`, `support`, `manager`, `admin`, `platform_operator`.
- **Multi-Tenancy**: All data must be scoped by `partner_id`. Every query must include a `partner_id` filter.
- **Multi-Partner Users**: Users can belong to multiple partners via the `memberships` table. Each membership has a role and department assignments. Users can only be logged into one partner at a time — switching issues a new JWT via `/switch-partner`.
- **Partner Status**: Partners have `status: 'active' | 'inactive'`. Inactive partners block logins, ticket creation, and partner switching. Enforce at login, switch-partner, socket, and tRPC middleware layers.
- **Dynamic Departments**: Never hardcode departments. Always read from `manifest.departments` in the partner data. Department schema: `{ id (auto-slug, immutable), name, description? }`. Department IDs are generated once at creation and never change, even if the name is updated.
- **Department Assignment**: `memberships.departments` is a JSONB array of department IDs. Empty/null means generalist (sees all departments). SupportView sidebar chips are filtered to show only assigned departments.
- **TypeScript**: 100% type safety. Maintain interfaces in `client/src/types/index.ts`.
- **Docker**: Always use `docker compose exec` for development tasks.
- **bcrypt**: Dev uses `bcryptjs` (pure JS, fast builds). Prod `Dockerfile.prod` swaps to native `bcrypt` (C++) for performance at scale (500+ users). Source imports `bcryptjs` — prod Dockerfile rewrites imports at build time.
- **Audit Logging**: All significant platform actions (partner lifecycle, user management, GDPR purges) are recorded in the `audit_log` table.

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
