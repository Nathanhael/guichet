# Load Testing

Uses [k6](https://k6.io/) for HTTP and WebSocket load testing.

## Install k6

```bash
# macOS
brew install k6

# Windows (winget)
winget install k6

# Docker (no install)
docker run --rm -i grafana/k6 run - <smoke.js
```

## Run

```bash
# Smoke test (1 user, 30s) — verify nothing breaks
k6 run testing/load/smoke.js

# Load test (50 users ramping up over 2 min)
k6 run testing/load/load.js

# Target a specific host
K6_BASE_URL=https://staging.example.com k6 run testing/load/smoke.js
```

## Scripts

| Script | VUs | Duration | Purpose |
|--------|-----|----------|---------|
| `smoke.js` | 1 | 30s | Sanity check — does the app respond? |
| `load.js` | 50 | 3m | Sustained load — find bottlenecks |
| `refresh.js` | 5 | 30s | Login once per VU, then continuous refresh-token rotation |
| `ws.js` | up to 25 | 90s (staged) | WebSocket (Socket.io) connection stress |
| `ws-500.js` | up to 500 | ~5m (staged) | WebSocket — ramp to 500 concurrent connections |
| `sla-sweep.js` | low | varies | Drive SLA breach worker under load |
| `debug.js` | 1 | one-shot | Single-request debugging helper |

> **⚠️ Login subsystem migration pending.** The `load.js`, `ws.js`, `ws-500.js`, and `refresh.js` scripts currently call `POST /api/v1/auth/login-local` with `alice@acme.com` / `password123`. The local-auth subsystem was removed (Guichet is SSO-only) and these scripts will 404 against any current build. They need to be ported to `/api/v1/auth/dev-login` (which mints a JWT by `userId` in non-prod). Until that port lands, expect the login step to fail and the rest of the script to short-circuit.
>
> **Seed data**: scripts assume `alice@acme.com` exists at `partnerId: 'acme-corp'`. The current `seed.ts` produces this user unconditionally (no `--e2e` flag). Run `docker compose exec server npx tsx seed.ts` before using these scripts. `smoke.js` works with any seed.

### WebSocket test

The `ws.js` script connects via raw Engine.IO/Socket.io frames, identifies with a JWT, then exercises ticket room join/typing/leave events.

```bash
# Via Docker (recommended)
MSYS_NO_PATHCONV=1 docker run --rm --network=host \
  -v "$(pwd)/testing/load:/scripts" grafana/k6 run /scripts/ws.js

# Native
k6 run testing/load/ws.js
```
