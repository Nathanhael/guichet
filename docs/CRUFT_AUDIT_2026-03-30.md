# Tessera Cruft Audit — 2026-03-30

## 1. Core Logic ("Happy Path") Verification

The primary happy path — **user login → partner selection → ticket creation → real-time chat → ticket close** — is well-supported and clearly traceable through `LoginView → auth.ts → useSocket → handlers.ts → ChatWindow`. The architecture is clean for this flow.

**However**, the happy path is increasingly obscured by secondary feature surface area. The server has **17 tRPC domain routers**, **5 Express route files**, **20+ service modules**, and **15+ AI-specific files**. The AI subsystem alone (`server/services/ai/`) contains 16 files — nearly a microservice in itself. Consider whether the AI layer should be factored into its own package or at minimum have a single barrel export to reduce cognitive load.

---

## 2. Dead Code & Obsolete Logic

### REMOVE — Dead Scripts
| File | Reason |
|------|--------|
| `server/scripts/test_chat_flow.ts` | Ad-hoc manual test script (Socket.io smoke test). Not referenced by any npm script or CI. |
| `server/scripts/test_final_logic.ts` | Ad-hoc audit log filter test. Not referenced anywhere. |
| `server/scripts/seed_acme.ts` | One-off seed script. Superseded by `seed_pg.ts` and `seed_e2e.ts`. Verify before removing. |

### INVESTIGATE — Potential Dead Code
| Item | Detail |
|------|--------|
| `react-is` (client dependency) | **Zero imports** in `client/src/`. Not imported by any first-party code. Likely a transitive peer dep that was mistakenly promoted to `dependencies`. |
| `autoprefixer` + `postcss` (client devDeps) | **No `postcss.config` file exists.** Tailwind CSS v4 uses its own Vite plugin (`@tailwindcss/vite`) and no longer requires PostCSS. These are dead weight. |
| `lint-staged` (root) | Pre-commit hook runs `npx lint-staged`, but the config is `"*.{ts,tsx}": "echo"` — a **no-op**. Either wire up a real linter or remove entirely. |

---

## 3. Dependency Audit

### 3a. REDUNDANT — Duplicate Libraries Doing the Same Thing

| Conflict | Verdict |
|----------|---------|
| **`jose` + `jsonwebtoken`** (server) | `jsonwebtoken` is used in 7+ core files (auth, session, socket, tRPC context). `jose` is used in **1 file only** (`sso.ts`). **Remove `jose`** and migrate the single SSO usage to `jsonwebtoken`, or vice versa — pick one JWT library. |
| **`uuid` + `crypto.randomUUID()`** (server) | `uuid` v4 is imported in **11 files**. Meanwhile, `db/schema.ts` already uses `crypto.randomUUID()` (native Node.js 19+). Since you target Node 22+ in Docker, **remove the `uuid` package** entirely and replace all `uuidv4()` calls with `crypto.randomUUID()`. Zero-dependency win. |
| **`express-validator` + `zod`** (server) | `express-validator` is used in only **3 files** (`validator.ts`, `auth.ts`, `tickets.ts`). All tRPC routes use Zod. **Migrate the 3 Express routes to Zod** validation and drop `express-validator` + `@types` to unify on a single validation library. |
| **`date-fns` (32 MB!) + `date-fns-tz`** (server) | `date-fns` is imported in **zero source files**. Only `date-fns-tz` is used (1 file: `businessHours.ts`). `date-fns` is a transitive dependency of `date-fns-tz` but does NOT need to be in `dependencies` directly. **Remove `date-fns` from `package.json`** — it will still be resolved as a transitive dep. Saves explicit dep bloat. |

### 3b. OVERKILL — Oversized for Actual Usage

| Package | Size | Usage | Recommendation |
|---------|------|-------|----------------|
| **`lucide-react`** | **45 MB** | Icon library. Tree-shakes at build, but bloats `node_modules` and install times. | Consider `lucide-react/icons/*` individual imports if Vite tree-shaking is insufficient, or evaluate if a lighter icon set covers your needs. Low priority since it tree-shakes. |
| **`swagger-ui-dist`** (via `swagger-ui-express`) | **12 MB** | Serves API docs UI at `/api/v1/docs/`. | Acceptable if API docs are needed. For prod, consider serving docs from a CDN or static build instead of bundling the full UI dist. |
| **`pino-pretty`** | In `dependencies` | Dev-time log formatter. | **Move to `devDependencies`**. Production should use structured JSON logs piped to an external pretty-printer. |

### 3c. PHANTOM — In `node_modules` but NOT in `package.json` (Transitive Bloat)

These large directories exist in `node_modules` but are NOT direct dependencies. They're pulled in transitively:

| Package | Size | Pulled By | Action |
|---------|------|-----------|--------|
| `lodash` (server) | 3.7 MB | Likely `swagger-jsdoc` | No action needed — not imported directly. |
| `@reduxjs` (client) | 8.3 MB | Likely a transitive of Zustand devtools or Recharts | No action needed — not imported directly. Zustand's Redux devtools middleware pulls this. |
| `es-toolkit` (client) | 8.2 MB | Transitive | Not imported directly. No action needed. |
| `@opentelemetry` (server) | 2.9 MB | Transitive | Not imported directly. No action needed. |
| `@babel` (both) | 5+ MB each | Build tools | Expected transitive. No action. |
| `bintrees` (server) | 2.3 MB | Transitive | Not imported. No action. |
| `z-schema` (server) | 2.1 MB | `swagger-jsdoc` | No action unless Swagger is removed. |

---

## 4. Prioritized Action Plan

### Priority 1 — Quick Wins (< 1 hour total)

| # | Action | Savings |
|---|--------|---------|
| 1 | Remove `react-is` from client `dependencies` | Cleaner dep list |
| 2 | Remove `autoprefixer` and `postcss` from client `devDependencies` | 2 dead deps |
| 3 | Move `pino-pretty` from server `dependencies` → `devDependencies` | Correct classification |
| 4 | Remove `date-fns` from server `dependencies` (keep `date-fns-tz` only) | -32 MB explicit dep |
| 5 | Delete `server/scripts/test_chat_flow.ts` and `server/scripts/test_final_logic.ts` | Dead code removal |
| 6 | Fix or remove `lint-staged` no-op (`"echo"` handler) | Eliminate false safety |

### Priority 2 — Medium Effort (1-3 hours each)

| # | Action | Savings |
|---|--------|---------|
| 7 | Replace all `uuid` v4 usage with `crypto.randomUUID()` (11 files) | -1 prod dependency |
| 8 | Consolidate `jose` + `jsonwebtoken` into one JWT library | -1 prod dependency, reduced API surface |
| 9 | Migrate 3 Express routes from `express-validator` → Zod | -1 prod dependency, unified validation |

### Priority 3 — Architectural Consideration (Sprint-level)

| # | Action | Rationale |
|---|--------|-----------|
| 10 | Extract AI service layer into a self-contained module with barrel export | 16 files in `services/ai/` with its own rate limiting, caching, and provider abstraction. Nearly a bounded context. |
| 11 | Evaluate Swagger in production: static docs build vs runtime serving | 12 MB `swagger-ui-dist` in prod container. |
| 12 | Audit `seed_acme.ts` — confirm if superseded by `seed_pg.ts` | Potential dead script. |

---

## 5. Summary Scorecard

| Category | Finding Count | Severity |
|----------|--------------|----------|
| Dead scripts | 2 confirmed, 1 suspect | Low |
| Unused dependencies | 4 (react-is, autoprefixer, postcss, date-fns) | Medium |
| Redundant libraries | 3 pairs (jose/jwt, uuid/crypto, express-validator/zod) | Medium |
| Misclassified deps | 1 (pino-pretty) | Low |
| No-op tooling | 1 (lint-staged echo) | Low |
| Architectural bloat | 1 area (AI subsystem) | Informational |

**Overall assessment**: The codebase is **well-structured with minimal actual dead code**. The main cruft is at the dependency layer — duplicate libraries that accumulated as features were added incrementally. Executing Priority 1 + Priority 2 would eliminate **6 unnecessary dependencies** and ~35 MB of explicit dep bloat with no feature impact.
