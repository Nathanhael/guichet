# GEMINI.md - Project Context & Instructions (Clean Slate)

This file serves as the primary instructional context for Gemini CLI. The project is currently in a "Clean Slate" phase, prioritizing core chat functionality and a strict monochrome aesthetic.

## Project Overview
**Tessera** is a high-performance, real-time, multi-tenant customer support platform. All complex features (AI Pipeline, Topic Heat, Solaris Design System) have been **deactivated** to focus on a lightweight, strictly monochrome chat core.

### Active Features
- **Real-Time Communication**: Core chat functionality via Socket.io 4.8 with Redis 8 scaling and server-side identity enforcement.
- **Dynamic Org Structure**: Departments are 100% data-driven via Partner JSONB. Users assigned via `memberships.departments`.
- **Partner Status**: Partners can be toggled 'active' or 'inactive'. Inactive partners block auth and close open tickets.
- **Cross-Tenant Identity**: Centralized user management supporting Azure SSO (OIDC) and Local (Email/Password) access.
- **Dynamic Mail Service**: System-wide configuration (SMTP, Resend, SendGrid) manageable via Platform UI.
- **Secure Recovery**: Automated password reset flow for local users with SHA-256 hashed tokens and 1-hour expiry.
- **Advanced Audit Trail**: Global `audit_log` with granular `from -> to` state diffs, target searching, and CSV export.
- **User Lifecycle Management**: Real-time "Last Active" tracking and status monitoring (SSO Linked vs. Local Active).
- **Workspace Switching**: Smart login flow with "Choose Workspace" screen for multi-tenant users.
- **B&W Minimalist Standard**: Strictly monochrome, static UI designed for maximum readability and zero motion.
- **Platform Operator Cockpit**: Global dashboard in `PlatformView.tsx` for Partners, Global Users, System Config, and Audit Logs.
- **Partner Administration**: Local management in `AdminView.tsx` for departments, system rules, and team members.

### Tech Stack
- **Frontend**: React 19.2, Vite 8, Tailwind CSS 4, Zustand 5.
- **Backend**: Node.js 24 (ESM), Express 5, tRPC 11, Socket.io 4.8.
- **Database**: PostgreSQL 18 (Drizzle ORM) + Redis 8 (Socket.io Adapter).
- **Observability**: Prometheus, Grafana, Pino (Structured Logging).

---

## 🚨 Critical Mandates

1.  **STRICT B&W**: The theme is strictly black (#000) and white (#FFF). **NEVER** introduce colors, gradients, or shadows.
2.  **ZERO MOTION**: All animations and transitions are stripped. UI must remain perfectly static.
3.  **DYNAMIC ONLY**: Never hardcode departments. Always read from `partner.departments` JSONB.
4.  **DOCKER ONLY**: Never run npm/node commands on the host machine. All commands must go through Docker.
5.  **TYPE SAFETY**: Maintain 100% tRPC and Drizzle type safety. No `any` types.
6.  **MULTI-TENANCY**: Every database query must include a `partner_id` filter. No data leaks between tenants.

---

## Building and Running

| Task | Command |
| :--- | :--- |
| **Start Development** | `docker compose up` |
| **Run Backend Tests** | `docker compose exec server npm test` |
| **Run Frontend Tests** | `docker compose exec client npm test` |
| **Database Push** | `docker compose exec server npx drizzle-kit push` |
| **Generate Migration** | `docker compose exec server npx drizzle-kit generate` |
| **DB Explorer** | `docker compose exec server npx drizzle-kit studio` |
| **View Server Logs** | `docker logs -f tessera-server-1` |

---

## Development Conventions

- **Roles**: `agent`, `support`, `admin`, `platform_operator`.
- **Global User Management**: Handle user invites and partner mapping in `PlatformView.tsx`.
- **Hybrid Auth**: Pre-provision users via email; map to `external_id` upon Azure OIDC login.
- **Adaptive UI**: Use horizontally scrollable bars for department filters; sticky pagination for long lists.
- **Senior Branching**: Use feature branches (e.g., `feature/enterprise-sso`). Use **Git Worktrees** for roadmap items.
- **Audit Logging**: All significant actions (lifecycle, user mgmt, GDPR) MUST be recorded in `audit_log`.
- **bcrypt**: Always import `bcryptjs` in source; production uses native C++ bindings via Dockerfile swap.

---

## 🛠️ Specialized Skills

The project includes custom instructions in `.gemini/skills/`:
- `architect`: Plan complex changes and Clean Architecture review.
- `coder`: Senior TypeScript standards and TDD enforcement.
- `socket-arch`: Backend Socket.io, Redis, and message mapping logic.
- `ui-flow`: React components and Zustand store synchronization.

---

## 🚀 Future Roadmap (Phase 2)

- **MFA (Multi-Factor Authentication)**: TOTP/SMS for local users.
- **Advanced Password Policies**: Complexity and rotation enforcement.
- **Global Session Control**: Inactivity timeouts and concurrent session limits.
- **Universal SSO (OIDC)**: Provider-agnostic implementation for Okta, Google, etc.
- **WORM Immutability**: Stream logs to tamper-proof cold storage (e.g., AWS S3 Object Lock).

---

# context-mode — MANDATORY routing rules

You have context-mode MCP tools available. These rules are NOT optional — they protect your context window from flooding. A single unrouted command can dump 56 KB into context and waste the entire session.

## BLOCKED commands — do NOT attempt these

### curl / wget — BLOCKED
Any shell command containing 'curl' or 'wget' will be intercepted and blocked. Do NOT retry.
Instead use:
- 'mcp__context-mode__ctx_fetch_and_index(url, source)' to fetch and index web pages
- 'mcp__context-mode__ctx_execute(language: "javascript", code: "const r = await fetch(...)")' to run HTTP calls in sandbox

### Inline HTTP — BLOCKED
Any shell command containing "fetch('http", "requests.get(", "requests.post(", "http.get(", or "http.request(" will be intercepted and blocked. Do NOT retry with shell.
Instead use:
- 'mcp__context-mode__ctx_execute(language, code)' to run HTTP calls in sandbox — only stdout enters context

### WebFetch / web browsing — BLOCKED
Direct web fetching is blocked. Use the sandbox equivalent.
Instead use:
- 'mcp__context-mode__ctx_fetch_and_index(url, source)' then 'mcp__context-mode__ctx_search(queries)' to query the indexed content

## REDIRECTED tools — use sandbox equivalents

### Shell (>20 lines output)
Shell is ONLY for: 'git', 'mkdir', 'rm', 'mv', 'cd', 'ls', 'npm install', 'pip install', and other short-output commands.
For everything else, use:
- 'mcp__context-mode__ctx_batch_execute(commands, queries)' — run multiple commands + search in ONE call
- 'mcp__context-mode__ctx_execute(language: "shell", code: "...")' — run in sandbox, only stdout enters context

### read_file (for analysis)
If you are reading a file to **edit** it → read_file is correct (edit needs content in context).
If you are reading to **analyze, explore, or summarize** → use 'mcp__context-mode__ctx_execute_file(path, language, code)' instead. Only your printed summary enters context.

### grep / search (large results)
Search results can flood context. Use 'mcp__context-mode__ctx_execute(language: "shell", code: "grep ...")' to run searches in sandbox. Only your printed summary enters context.

## Tool selection hierarchy

1. **GATHER**: 'mcp__context-mode__ctx_batch_execute(commands, queries)' — Primary tool. Runs all commands, auto-indexes output, returns search results. ONE call replaces 30+ individual calls.
2. **FOLLOW-UP**: 'mcp__context-mode__ctx_search(queries: ["q1", "q2", ...])' — Query indexed content. Pass ALL questions as array in ONE call.
3. **PROCESSING**: 'mcp__context-mode__ctx_execute(language, code)' | 'mcp__context-mode__ctx_execute_file(path, language, code)' — Sandbox execution. Only stdout enters context.
4. **WEB**: 'mcp__context-mode__ctx_fetch_and_index(url, source)' then 'mcp__context-mode__ctx_search(queries)' — Fetch, chunk, index, query. Raw HTML never enters context.
5. **INDEX**: 'mcp__context-mode__ctx_index(content, source)' — Store content in FTS5 knowledge base for later search.

## Output constraints

- Keep responses under 500 words.
- Write artifacts (code, configs, PRDs) to FILES — never return them as inline text. Return only: file path + 1-line description.
- When indexing content, use descriptive source labels so others can 'search(source: "label")' later.

## ctx commands

| Command | Action |
|---------|--------|
| 'ctx stats' | Call the 'stats' MCP tool and display the full output verbatim |
| 'ctx doctor' | Call the 'doctor' MCP tool, run the returned shell command, display as checklist |
| 'ctx upgrade' | Call the 'upgrade' MCP tool, run the returned shell command, display as checklist |
