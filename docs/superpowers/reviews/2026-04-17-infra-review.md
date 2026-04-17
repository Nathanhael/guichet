# Infrastructure & Config Review — 2026-04-17

**Scope**: Migrations, env config, Docker, deps, CI, observability, secrets, deployment
**Reviewer**: Claude (agent)
**Prior review**: `docs/superpowers/reviews/code-review-full.md` (2026-04-09, 188 commits ago)

---

## Summary

Infrastructure is largely sound: the Docker setup is solid, production hardening checks are comprehensive, backup/rotation scripts are genuinely usable, and the deployment docs are current. One high-severity structural defect stands out: the Drizzle migration journal is stale at idx=2 while 10 SQL files exist, meaning `npm run db:migrate` (the documented production path) leaves 7 migrations unapplied on a fresh database. This is masked by CI using `drizzle-kit push --force` instead of `drizzle-kit migrate`. Three additional issues round out the HIGH/MEDIUM tier.

---

## Findings

### HIGH: Drizzle journal stale — 7 migrations orphaned from `db:migrate`

**File**: `server/drizzle/meta/_journal.json`

The journal contains exactly 3 entries (idx 0–2): `0000_gifted_thunderbolts`, `0001_status_simplification`, `0002_sso_only_default`. The drizzle directory contains 10 SQL files: 0000 through 0009, plus two files with the same `0006_` prefix. `drizzle-kit migrate` reads the journal to know which migrations to apply. On a fresh database, `npm run db:migrate` stops after 0002 and never applies:

- `0003_message_search_vector` — tsvector FTS column + GIN index + trigger
- `0004_remove_sla` — drops SLA columns from partners/tickets/daily_stats
- `0005_users_is_external` — `users.is_external` required for the B2B guest feature
- `0006_messages_sender_is_external` — `messages.sender_is_external`
- `0006_ratings_outlive_tickets` — drops cascading FKs, restructures ratings for GDPR survival
- `0007_partner_auth_method` — adds auth_method enum + column
- `0008_drop_auth_method` — drops auth_method column and enum
- `0009_drop_users_auth_method` — drops `users.auth_method`

A deployment following the AWS/Azure docs that runs `npm run db:migrate` on a fresh database will get a partially migrated schema missing `users.is_external`, `messages.sender_is_external`, FTS support, and correct ratings FK constraints.

**Recommendation**: Add all missing migrations to `_journal.json`. Resolve the dual `0006_*` naming (one must be renumbered, e.g., `0006b` → `0007` with subsequent files shifted). Validate by running `drizzle-kit migrate` on a fresh DB and confirming schema matches `schema.ts`.

---

### HIGH: CI uses `drizzle-kit push --force` — diverges from production path and masks journal staleness

**File**: `scripts/ci.ps1`, line 47

```powershell
Run-Step "migrate" @("docker compose exec server npx drizzle-kit push --force")
```

`push` introspects the live DB schema and applies diffs directly without reading or writing the journal. It is a development tool, not the production migration path. CI always succeeds with a fully-migrated schema, hiding that `drizzle-kit migrate` (what prod runs) would produce an incomplete schema. This divergence is what allowed the journal to fall 7 migrations behind undetected.

**Recommendation**: Change the CI migrate step to `drizzle-kit migrate` (matching production). This immediately surfaces the journal staleness and prevents future drift.

---

### HIGH: Global HTTP rate limiters are in-memory only — not multi-instance safe

**File**: `server/app.ts`, lines 135–158

Four `express-rate-limit` instances (`globalLimiter` 100/min, `authLimiter` 5/min, `uploadLimiter` 10/min, `trpcLimiter` 200/min) use the default in-memory store. In a horizontally-scaled deployment (documented in both AWS and Azure deployment guides), each instance maintains its own counter. With 2 instances an attacker gets 2× the allowed attempts. The Redis-backed limiter in `routes/auth/rateLimit.ts` covers only IP-level auth endpoints (login, reset-password, refresh) — not the `authLimiter` applied to the full auth router.

The `authLimiter` at 5 req/min is the most exposure: with 2 ECS tasks the effective limit is 10 login attempts per minute.

**Recommendation**: At minimum, wire `authLimiter` to a Redis store (`rate-limit-redis` package) using the existing `getRedisClients()` connection. Account lockout (DB-level, 5 attempts, 15-min window) backstops brute-force on login, but the in-memory HTTP limiter is still insufficient for a distributed deployment.

---

### MEDIUM: Prometheus cannot scrape `/metrics` from within Docker — coherence gap

**File**: `monitoring/prometheus.yml`, `server/app.ts` lines 360–377

The metrics endpoint guards access with:
- `METRICS_TOKEN` set: require matching `x-metrics-token` header, OR be localhost (`127.0.0.1` / `::1`)
- `METRICS_TOKEN` not set: require localhost

Prometheus connects as `server:3001` from the Docker bridge network. `req.socket.remoteAddress` is a Docker bridge IP (e.g., `172.18.0.x`), never `127.0.0.1`. The `isLocal` check always returns false for Prometheus. Result:

- `METRICS_TOKEN` not configured → Prometheus gets 403 (metrics silently broken)
- `METRICS_TOKEN` configured → Prometheus still gets 403 because `prometheus.yml` has no `authorization:` stanza

The `.env.example` lists `METRICS_TOKEN=` as optional with no value, and the current `prometheus.yml` has no `authorization:` section, so in any standard setup Prometheus collects nothing.

**Recommendation**: Add an authorization stanza to `monitoring/prometheus.yml`:
```yaml
authorization:
  credentials: "${METRICS_TOKEN}"
```
and configure `METRICS_TOKEN` in both dev and prod compose environments. Alternatively, remove the token requirement within the Docker network by detecting Docker bridge subnets, but the token approach is cleaner.

---

### MEDIUM: `FIELD_ENCRYPTION_SECRET` absent from prod compose — webhook encryption silently missing

**File**: `docker-compose.prod.yml`, line 52

The prod compose passes only `AI_KEY_ENCRYPTION_SECRET=${AI_KEY_ENCRYPTION_SECRET:-}` (silent empty default). `FIELD_ENCRYPTION_SECRET` is not wired at all. The `encrypt()` / `decrypt()` functions in `server/services/encryption.ts` accept either variable (`config.FIELD_ENCRYPTION_SECRET || config.AI_KEY_ENCRYPTION_SECRET`), but webhook secrets use this encryption path regardless of `AI_ENABLED`. A deployment that sets `FIELD_ENCRYPTION_SECRET` (not `AI_KEY_ENCRYPTION_SECRET`) will have the variable silently absent from the container, causing webhook secret encryption to throw at runtime with "not set" error. Additionally, `AI_KEY_ENCRYPTION_SECRET` uses `:-` (silent empty fallback) instead of `:?` (fail-fast), so a missing key passes compose validation.

**Recommendation**: Add `FIELD_ENCRYPTION_SECRET=${FIELD_ENCRYPTION_SECRET:-}` to prod compose. Change both to `:?` or add a production hardening FATAL check: if both `FIELD_ENCRYPTION_SECRET` and `AI_KEY_ENCRYPTION_SECRET` are empty, exit with an error (currently the FATAL check only triggers when `AI_ENABLED=true`).

---

### MEDIUM: SMTP credentials stored as plaintext JSONB — inconsistent with AI key encryption

**File**: `server/services/mail.ts`, `server/trpc/routers/platform/system.ts`

Mail config (`smtpPass`, `apiKey`) is stored in `system_settings.value` as plaintext JSONB. AI API keys (`partners.ai_config.encryptedApiKey`) are AES-256-GCM encrypted at rest via `services/encryption.ts`. A database compromise or access to a DB dump exposes SMTP credentials directly. The API response correctly strips `smtpPass`/`apiKey`, but at-rest exposure is unaddressed.

**Recommendation**: Apply `encrypt()` / `decrypt()` from `services/encryption.ts` to `smtpPass` and `apiKey` before writing to `system_settings`. Add a migration script analogous to `scripts/encrypt_webhook_secrets.ts` to encrypt existing plaintext values.

---

### MEDIUM: VAPID example keys in `.env.example` are real-looking key material

**File**: `.env.example`, lines 115–116

```
# VAPID_PUBLIC_KEY=REDACTED_VAPID_PUBLIC
# VAPID_PRIVATE_KEY=REDACTED_VAPID_PRIVATE
```

Both values are correctly-formatted VAPID key pairs (P-256 public key, 32-byte private key). If these were generated for documentation purposes, the private key is now public. Any deployment inadvertently copying these would share push subscription authority with anyone who has seen the repo. They are commented out, reducing immediate risk, but the private key should not appear in committed files.

**Recommendation**: Replace with obvious placeholder strings (`REPLACE_WITH_GENERATED_VAPID_KEY`). If these keys were ever used in production, rotate them (`npx web-push generate-vapid-keys`).

---

### LOW: Two migration files share `0006_` prefix — collision if added to journal

**Files**: `server/drizzle/0006_messages_sender_is_external.sql`, `server/drizzle/0006_ratings_outlive_tickets.sql`

Both begin with `0006_`. Drizzle keys migration entries by `idx` (integer), so both cannot coexist at idx=6 in the journal. The `push --force` workflow avoids the conflict today by ignoring the journal, but fixing the journal (Finding 1) requires resolving this naming collision.

**Recommendation**: Renumber one as `0007_*` (shifting 0007–0009 to 0008–0010). Document clearly in the commit. Resolve before addressing Finding 1.

---

### LOW: Every HTTP request logged at INFO — log flood in production

**File**: `server/app.ts`, line 163

```ts
logger.info({ method: req.method, path: req.path }, `Incoming ${req.method} request`);
```

This fires on every request before metricsMiddleware. In production with concurrent users, WebSocket polling, and health checks (30s interval × multiple replicas), this generates thousands of INFO log lines per minute. Prometheus already captures method/route/status/duration more efficiently via `httpRequestDuration` and `httpRequestsTotal`.

**Recommendation**: Remove the middleware entirely (Prometheus covers it) or change to `logger.debug(...)` so it's gated by `LOG_LEVEL=debug`.

---

## Strengths observed

- Production hardening in `config.ts` is thorough: 10 checks covering DEMO_MODE, COOKIE_SECURE, CORS/FRONTEND_URL localhost detection, encryption key requirement, and REQUIRE_PLATFORM_STEP_UP warning.
- Multi-stage Dockerfiles (`server/Dockerfile.prod`, `client/Dockerfile.prod`) are correct: non-root user, `npm ci --omit=dev`, `apk upgrade --no-cache` for OS CVE patching on each build.
- `server/scripts/backup.sh` is correct: `set -euo pipefail`, handles both Docker and direct modes, prunes correctly to 10 most recent.
- `server/scripts/rotate_encryption_key.ts` is genuinely usable in an incident: idempotent, round-trip verification before DB write, clear next-steps output.
- `server/scripts/baseline_drizzle.ts` has a safe no-op guard if the ledger already has entries.
- Break-glass runbook is a real procedure with preconditions, allowed actions, required follow-up, and B2B guest revocation path.
- Socket-level rate limiting (`checkSocketRateLimit` in `handlers/types.ts`) uses sliding window counters on `socket.data` for `message:send`, `message:edit`, `message:react`.
- Health endpoint (`/api/v1/health`) checks PostgreSQL, Redis, and storage with 3s timeout; returns structured degraded status — healthcheck-ready.
- Grafana dashboards and datasources are provisioned as config files in `monitoring/grafana/provisioning/` — survive container recreation.
- Dev compose uses `:?` syntax for `JWT_SECRET`, `AI_KEY_ENCRYPTION_SECRET`, and `GRAFANA_ADMIN_PASSWORD` — fails fast on missing secrets.
- AWS and Azure deployment docs are current and accurate, including Redis TLS requirement, WebSocket sticky session config, and IAM policy for S3.
- No secrets found in logger output — email addresses are masked (`maskEmail`), API keys are decrypted only in-memory and never logged.

---

## Areas not reviewed / time-boxed

- Full schema drift check: `schema.ts` vs complete migration state — requires spinning up a fresh DB
- Individual Grafana dashboard panel queries
- `testing/e2e/` Playwright spec coverage — deferred to test-quality agent
- Client `Dockerfile` (dev) uses `npm install --legacy-peer-deps` — peer dep conflicts worth a follow-up
- `npm audit` output — no sandbox tool available to run it; no known critical CVEs observed in `package.json` dep versions
