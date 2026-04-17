# Deploy Readiness — M8 (Prometheus scraping) + M9 (encryption secret wiring)

**Date**: 2026-04-17
**Branch**: `fix/deploy-readiness-m8-m9`
**Scope**: Two medium findings bundled because both are compose/env wiring, both gate a real prod deploy.
**Status**: Proposed

---

## Why bundle

Both are deploy-blockers with trivial code footprint. Separating them into two PRs doubles review overhead for no benefit. Both touch `docker-compose*.yml`, both surface in `.env.example`, both verified by the same smoke path (bring up stack, check `/metrics`, check server starts).

---

## M9 — `FIELD_ENCRYPTION_SECRET` wiring

### Current state

| Place | Value |
|---|---|
| [server/config.ts:58-59](../../../server/config.ts) | Accepts either `FIELD_ENCRYPTION_SECRET` or `AI_KEY_ENCRYPTION_SECRET`, 64-hex, optional |
| [server/services/encryption.ts:17](../../../server/services/encryption.ts) | `FIELD_ENCRYPTION_SECRET \|\| AI_KEY_ENCRYPTION_SECRET` |
| [server/config.ts:160-163](../../../server/config.ts) | FATAL if AI enabled + no secret; WARN if AI disabled + no secret |
| [docker-compose.prod.yml:52](../../../docker-compose.prod.yml) | `AI_KEY_ENCRYPTION_SECRET=${AI_KEY_ENCRYPTION_SECRET:-}` (silent empty default) |
| [docker-compose.prod.yml](../../../docker-compose.prod.yml) | `FIELD_ENCRYPTION_SECRET` — **not wired at all** |
| [.env.example:75](../../../.env.example) | `AI_KEY_ENCRYPTION_SECRET=CHANGE_ME...`; no `FIELD_ENCRYPTION_SECRET` entry |

### Problem

1. Prod compose uses `:-` → missing var becomes empty string → Zod treats as missing → boot passes with WARN (if AI off) or FATAL (if AI on). WARN path means webhook secrets and other field-encrypted data silently use fallback or fail at write time.
2. `FIELD_ENCRYPTION_SECRET` (the canonical name in config) isn't wired through compose at all. Users setting only the "new" name get nothing.

### Fix

1. `docker-compose.prod.yml` — wire `FIELD_ENCRYPTION_SECRET=${FIELD_ENCRYPTION_SECRET:?...must be set}`. Use `:?` sigil so compose errors out instead of silently defaulting. Keep `AI_KEY_ENCRYPTION_SECRET` as `:-` (legacy passthrough).
2. `docker-compose.yml` — same wiring for dev so local testing matches prod semantics (but keep `:-` not `:?` since dev tolerates absence).
3. `.env.example` — replace line 75 with:
   ```
   FIELD_ENCRYPTION_SECRET=CHANGE_ME_GENERATE_WITH_COMMAND_ABOVE
   # AI_KEY_ENCRYPTION_SECRET= (legacy name, FIELD_ENCRYPTION_SECRET preferred)
   ```

### Test

- Source-inspection test: read `docker-compose.prod.yml`, assert both env entries present with `:?` (prod) / `:-` (dev) sigils.
- Boot test: already covered by existing `config.test.ts` prod-hardening checks (FATAL path).

### Rollback

Revert the compose edits. No runtime data touched.

---

## M8 — Prometheus can't scrape `/metrics`

### Current state

| Place | Behavior |
|---|---|
| [server/app.ts:399-416](../../../server/app.ts) | `/metrics` accepts `X-Metrics-Token` header; localhost bypass; `403` otherwise |
| [monitoring/prometheus.yml:6-9](../../../monitoring/prometheus.yml) | Targets `server:3001/metrics` with no auth header |
| [docker-compose.yml:100](../../../docker-compose.yml) | Prometheus in same bridge — sees server from Docker IP, NOT `127.0.0.1` |
| [.env.example:111](../../../.env.example) | `# METRICS_TOKEN=` (commented placeholder, no generation hint) |
| [docker-compose.yml server service](../../../docker-compose.yml) | `METRICS_TOKEN` **not passed to server container** |

### Problem

Prometheus → `server:3001/metrics` → server checks token → `X-Metrics-Token` absent → not localhost → **403**. All scrapes fail silently. Grafana dashboards render empty. Has been broken since `/metrics` was auth-gated.

### Fix

Prometheus scrape_configs natively support `authorization: { type: Bearer, credentials_file: ... }`. It does not support arbitrary custom headers. Two choices:

**Option A (recommended)**: server accepts `Authorization: Bearer <token>` in addition to `X-Metrics-Token`. Prometheus uses native Bearer auth via a mounted credentials file.

**Option B**: Templated Prometheus config with envsubst entrypoint. More infrastructure, no gain.

Going with A.

### Changes

1. [server/app.ts:399-416](../../../server/app.ts) — extend `/metrics` handler:
   ```ts
   const bearer = typeof req.headers.authorization === 'string'
     && req.headers.authorization.startsWith('Bearer ')
     ? req.headers.authorization.slice(7) : undefined;
   const token = req.headers['x-metrics-token'] ?? bearer;
   ```
   Rest of the flow stays identical. Backward-compatible.
2. [monitoring/prometheus.yml](../../../monitoring/prometheus.yml) — add:
   ```yaml
       authorization:
         type: Bearer
         credentials_file: /etc/prometheus/metrics_token
   ```
3. [docker-compose.yml prometheus service](../../../docker-compose.yml) — mount token file:
   ```yaml
   volumes:
     - ./monitoring/prometheus.yml:/etc/prometheus/prometheus.yml
     - ./monitoring/metrics_token:/etc/prometheus/metrics_token:ro
     - prometheus_data:/prometheus
   ```
4. [docker-compose.yml server service](../../../docker-compose.yml) — pass `METRICS_TOKEN=${METRICS_TOKEN:-}` env.
5. [docker-compose.prod.yml server service](../../../docker-compose.prod.yml) — same env wiring (prod Prometheus is user's responsibility, but server must accept the token).
6. [.env.example:111](../../../.env.example) — replace with:
   ```
   # METRICS_TOKEN — shared secret between server /metrics and Prometheus scrape config
   # Generate with: node -e "console.log(require('crypto').randomBytes(24).toString('hex'))"
   # Also write value to monitoring/metrics_token (newline-free) for Prometheus to read
   METRICS_TOKEN=CHANGE_ME_GENERATE_WITH_COMMAND_ABOVE
   ```
7. Add `monitoring/metrics_token` to `.gitignore` (the file holds the real secret).
8. Add `monitoring/metrics_token.example` as a placeholder template committed to git.

### Test

- Unit test on `/metrics` handler: 4 cases
  1. `X-Metrics-Token: <valid>` from non-localhost → 200
  2. `Authorization: Bearer <valid>` from non-localhost → 200 (new)
  3. No auth from non-localhost → 403
  4. No auth from localhost (`127.0.0.1`) → 200 (bypass preserved)
- Manual verification: `docker compose up`, wait 30s, `curl -sf http://localhost:9090/api/v1/targets | jq .data.activeTargets[0].health` → `"up"`.

### Rollback

Revert server handler + compose + prometheus.yml. No data migration.

---

## Shared work

| # | Action |
|---|---|
| 1 | Branch `fix/deploy-readiness-m8-m9` off current main |
| 2 | M9 compose + .env.example edits |
| 3 | M8 server handler edit + unit test |
| 4 | M8 Prometheus config + compose + gitignore + example token file |
| 5 | Run `npm test` (expect +5 tests passing, 0 regressions) |
| 6 | Run `npx tsc --noEmit` |
| 7 | Bring up dev stack, hit `http://localhost:9090/api/v1/targets`, confirm `up` |
| 8 | Commit with conventional message; merge with `--no-ff` `merge: deploy-readiness-m8-m9` |

---

## Risk assessment

| Risk | Mitigation |
|---|---|
| Existing Prometheus deploys using no auth break | Server still accepts `X-Metrics-Token`; Bearer is additive. No existing path regressed. |
| `:?` sigil breaks existing `.env` files that use `AI_KEY_ENCRYPTION_SECRET` only | Only `FIELD_ENCRYPTION_SECRET` gets `:?`. `AI_KEY_ENCRYPTION_SECRET` stays `:-`. Config.ts still accepts either. |
| Token file leaks via git | Added to `.gitignore`; `.example` file committed. Same pattern as existing `.env` handling. |

---

## Out of scope

- Prod Prometheus service in `docker-compose.prod.yml` — prod observability stack is documented as external (AWS CloudWatch, Azure Monitor, hosted Prometheus). Not adding to prod compose.
- Rotating `FIELD_ENCRYPTION_SECRET` for existing encrypted data — key rotation is a separate concern, handled by existing `scripts/rotate_encryption_key.ts` (if it exists) or a future plan.
- M10 (SMTP creds plaintext) — noted in review but out of scope for deploy-readiness; separate plan later.

---

## Verification checklist before merge

- [ ] All 554+ server tests pass
- [ ] `tsc --noEmit` clean on server
- [ ] `docker compose up -d` boots clean (no FATAL)
- [ ] `curl http://localhost:9090/api/v1/targets` shows `guichet-server` as `up`
- [ ] Grafana dashboard renders non-empty data for `http_request_duration_seconds` after 1 min
- [ ] `.env.example` diff is clean (no stray secrets committed)
