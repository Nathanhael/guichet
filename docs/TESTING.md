# Testing Guide

Conventions for writing, locating, and running tests in the Guichet codebase.

---

## Layout

Tests live in three places, by purpose:

| Location | Purpose | Example |
|---|---|---|
| Co-located with source | Unit tests for a single module | `server/services/archive.ts` + `server/services/archive.test.ts` |
| `server/__integration__/` | Cross-cutting integration tests that span multiple modules | `server/__integration__/isolation.test.ts` (multi-tenant boundary across tRPC + sockets + DB) |
| `testing/e2e/` | Playwright end-to-end tests against the live stack | `testing/e2e/agent-flow.spec.ts` |

Test infra:

| Path | Purpose |
|---|---|
| `server/vitest.config.ts` | Vitest config for server (node env, JWT secret, DB URL) |
| `client/vite.config.ts` | Vite config — vitest section configures jsdom + setup file |
| `client/src/test/setup.ts` | Per-test setup (cleanup, jest-dom) |
| `client/src/test/helpers.tsx` | Test factories and mock builders |
| `playwright.config.ts` | Playwright config (testDir, baseURL, retries) |
| `scripts/ci.ps1` | Local CI runner (typecheck, server tests, client tests, migrate, e2e) |

---

## Naming

- **Unit tests**: `<source>.test.ts` next to `<source>.ts`. For TSX sources, use `.test.tsx`.
- **Integration tests**: `<scenario>.test.ts` inside `server/__integration__/`. Name by what's being tested across modules (`isolation`, `tenantIsolation`, etc.), not by a single source file.
- **E2E tests**: `<feature>.spec.ts` inside `testing/e2e/`. Use `.spec.ts` (not `.test.ts`) — Playwright's default discovery pattern.
- **Sub-aspect splits**: when one source file has multiple tightly-scoped test concerns, append a dotted suffix:
  - `server/services/membership.test.ts` — module-level behavior
  - `server/services/membership.atomic.test.ts` — atomicity / race-condition coverage

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

# E2E (Playwright)
npm run test:e2e

# Local CI (everything)
powershell -File scripts/ci.ps1
powershell -File scripts/ci.ps1 -Skip e2e   # skip slow E2E
```

---

## What we test

Tests in this repo encode three things, and only these three:

1. **Security invariants** — multi-tenant isolation, RBAC, audit chain integrity, refresh-token rotation, B2B guest restrictions, encryption boundaries.
2. **Service-layer correctness** — business logic that fails silently if broken (audit hash chain, GDPR purge ordering, archive batching, transfer flow, SLA math, AI provider routing).
3. **End-to-end wiring** — the assembled stack works: socket → tRPC → DB → auth round-trip per major user flow (agent, support, admin, platform).

## What we don't test

By design, the following are **not** in the test suite:

- **Render-only component smokes** (e.g. "Avatar renders an image"). They mock everything, assert text appears, and break on UI churn without catching real bugs. E2E covers actual rendering.
- **Utility helpers with no logic** (e.g. date format wrappers). Changes break the test → you update the test → no learning, no protection.
- **Source-string regression pins** (`readFileSync` + regex over source code). These belong in ESLint rules, not Vitest. If you see a tactical pin, file a ticket to convert it; don't add new ones.

---

## Adding a new test

```
Is the test exercising one source file end-to-end?
├─ YES → co-locate: <source>.test.ts next to <source>.ts
└─ NO → does it span multiple modules / runtime layers?
        ├─ YES, but at unit-mock level → server/__integration__/<scenario>.test.ts
        └─ YES, against the live stack (browser + server + DB) → testing/e2e/<feature>.spec.ts
```

**Decision examples:**

- Testing `services/encryption.ts` round-trip → `server/services/encryption.test.ts` (co-located).
- Testing that a tRPC mutation in one router can't read another partner's data → `server/__integration__/isolation.test.ts` (spans tRPC + DB + auth context).
- Testing the agent ticket-creation flow from form submit through chat opening → `testing/e2e/agent-flow.spec.ts`.

---

## Test quality bar

Every test must assert **real behavior** — interactions, validation, state changes, error handling, security boundaries. If a test only checks that text appears after mocking everything, delete it: E2E covers that ground.

Server tests should focus on:
- Security boundaries (auth, RBAC, multi-tenant isolation)
- Data integrity (atomicity, idempotency, FK constraints)
- Correctness of pure business logic

E2E tests should cover:
- Critical user paths per role (agent, support, admin, platform)
- Cross-module flows (transfer, audit, GDPR purge, refresh-token rotation)

New features ship with E2E specs **before** component unit tests.

---

## CI

There is no remote CI for this repo. The single source of truth is `scripts/ci.ps1`, run locally before push. It executes:

| Step | What it checks |
|---|---|
| `typecheck` | `tsc --noEmit` on server and client |
| `test-client` | Client unit tests (Vitest + jsdom) |
| `test-server` | Server unit tests (Vitest + node) |
| `migrate` | Drizzle migrations against the Docker Postgres |
| `e2e` | Playwright E2E tests (builds client first) |

Push only when `scripts/ci.ps1` is green.
