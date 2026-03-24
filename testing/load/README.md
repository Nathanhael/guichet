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
| `ws.js` | 25 | 90s | WebSocket (Socket.io) connection stress |
| `load-500.js` | 500 | 5.5m | HTTP load — validate 500 concurrent users |
| `ws-500.js` | 500 | 5m | WebSocket — 500 concurrent connections |

### WebSocket test

The `ws.js` script connects via raw Engine.IO/Socket.io frames, identifies with a JWT, then exercises ticket room join/typing/leave events.

```bash
# Via Docker (recommended)
MSYS_NO_PATHCONV=1 docker run --rm --network=host \
  -v "$(pwd)/testing/load:/scripts" grafana/k6 run /scripts/ws.js

# Native
k6 run testing/load/ws.js
```
