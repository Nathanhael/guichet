# Testing Guide

Conventions for writing, locating, and running tests in the Guichet codebase.

---

## Layout

Tests live in two places, by purpose:

| Location | Purpose | Example |
|---|---|---|
| Co-located with source | Unit tests for a single module | `server/services/archive.ts` + `server/services/archive.test.ts` |
| `server/__integration__/` | Cross-cutting integration tests that span multiple modules | `server/__integration__/isolation.test.ts` (multi-tenant boundary across tRPC + sockets + DB) |

Test infra:

| Path | Purpose |
|---|---|
| `server/vitest.config.ts` | Vitest config for server (node env, JWT secret, DB URL) |
| `client/vite.config.ts` | Vite config — vitest section configures jsdom + setup file |
| `client/src/test/setup.ts` | Per-test setup (cleanup, jest-dom) |
| `client/src/test/helpers.tsx` | Test factories and mock builders |
| `scripts/ci.ps1` | Local CI runner (typecheck, server tests, client tests, migrate, build) |

---

## Naming

- **Unit tests**: `<source>.test.ts` next to `<source>.ts`. For TSX sources, use `.test.tsx`.
- **Integration tests**: `<scenario>.test.ts` inside `server/__integration__/`. Name by what's being tested across modules (`isolation`, `tenantIsolation`, etc.), not by a single source file.
- **Sub-aspect splits**: when one source file has multiple tightly-scoped test concerns, append a dotted suffix:
  - `server/services/bootstrap.atomic.test.ts` — atomicity / race-condition coverage for `bootstrap.ts`
  - Pair the dotted-suffix file with the regular `<source>.test.ts` for module-level behavior. Only split when the second concern justifies its own setup; don't split for organisational neatness.

---

## Running tests

All commands run inside Docker. **Never run `npm` / `node` / `npx` directly on the host.**

```bash
# All tests (server + client)
docker compose exec server npm test
docker compose exec client npm test

# Watch mode (single suite)
docker compose exec server npx vitest
docker compose exec client npx vitest

# Single test file
docker compose exec server npx vitest run server/services/archive.test.ts

# Single test by name
docker compose exec server npx vitest run -t "tenant isolation"

# Local CI (everything)
powershell -File scripts/ci.ps1
```

---

## What we test

Tests in this repo encode two things, and only these two:

1. **Security invariants** — multi-tenant isolation, RBAC, audit chain integrity, refresh-token rotation, encryption boundaries.
2. **Service-layer correctness** — business logic that fails silently if broken (audit hash chain, GDPR purge ordering, archive batching, transfer flow, SLA math, AI provider routing).

## What we don't test

By design, the following are **not** in the test suite:

- **Render-only component smokes** (e.g. "Avatar renders an image"). They mock everything, assert text appears, and break on UI churn without catching real bugs.
- **Utility helpers with no logic** (e.g. date format wrappers). Changes break the test → you update the test → no learning, no protection.
- **Source-string regression pins** (`readFileSync` + regex over source code). These belong in ESLint rules, not Vitest. If you see a tactical pin, file a ticket to convert it; don't add new ones.

---

## Adding a new test

```
Is the test exercising one source file end-to-end?
├─ YES → co-locate: <source>.test.ts next to <source>.ts
└─ NO, it spans multiple modules / runtime layers → server/__integration__/<scenario>.test.ts
```

**Decision examples:**

- Testing `services/encryption.ts` round-trip → `server/services/encryption.test.ts` (co-located).
- Testing that a tRPC mutation in one router can't read another partner's data → `server/__integration__/isolation.test.ts` (spans tRPC + DB + auth context).

---

## Test quality bar

Every test must assert **real behavior** — interactions, validation, state changes, error handling, security boundaries. If a test only checks that text appears after mocking everything, delete it.

Server tests should focus on:
- Security boundaries (auth, RBAC, multi-tenant isolation)
- Data integrity (atomicity, idempotency, FK constraints)
- Correctness of pure business logic

---

## CI

There is no remote CI for this repo. The single source of truth is `scripts/ci.ps1`, run locally before push. It executes (in order):

| Step | What it checks |
|---|---|
| `typecheck` | `tsc --noEmit` on server and client |
| `tenant-isolation-guard` | `check-trpc-tenant-isolation.mjs` — blocks non-allowlisted client-supplied `partnerId` |
| `lint` | `eslint` on server and client |
| `audit` | `npm audit --audit-level=high` on server and client |
| `test-server` | Server unit tests (Vitest + node) |
| `test-client` | Client unit tests (Vitest + jsdom) |
| `migrate` | Drizzle migrations against the Docker Postgres |
| `build` | `vite build` for the client |

Push only when `scripts/ci.ps1` is green.
