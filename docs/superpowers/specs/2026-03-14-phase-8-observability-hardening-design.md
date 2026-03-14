# Phase 8: Platform Observability & Hardening — Design Spec

## Goal

Add enterprise-grade stability and monitoring to Tessera: E2E testing with Playwright, Prometheus/Grafana observability, and a mobile PWA for field agents.

## Architecture

Sequential implementation: E2E Tests → Observability → PWA. E2E tests come first to provide a safety net for subsequent infrastructure changes. Each pillar is independently shippable.

## Tech Stack

- **E2E Testing**: Playwright, Express (mock server)
- **Observability**: prom-client, Prometheus, Grafana
- **PWA**: Service worker, Web App Manifest, Vite PWA tooling

---

## 1. Playwright E2E Testing

### Directory Structure

```
e2e/
├── playwright.config.ts       # Two projects: docker, mock
├── global-setup.ts            # Seeds test users/partners in Docker DB
├── fixtures/
│   └── auth.fixture.ts        # JWT token storage, login helpers
├── mock-server/
│   ├── index.ts               # Minimal Express with canned responses
│   └── data.ts                # Static test data
└── tests/
    ├── auth.spec.ts            # Login flows (agent/support/admin)
    ├── ticket-lifecycle.spec.ts # Create → join → resolve
    ├── live-chat.spec.ts       # Real-time messaging via Socket.io
    ├── admin-dashboard.spec.ts # Stats/charts render
    └── multi-tenant.spec.ts    # Partner isolation
```

### Configuration

`playwright.config.ts` defines two projects:

1. **docker** — runs against `http://localhost:5173` (full Docker stack). Used for integration confidence. Slower (~30s).
2. **mock** — runs against a local Express mock server. Used for fast feedback (~5s).

### Test Infrastructure

- `global-setup.ts` connects to the Docker PostgreSQL and seeds test users (one per role) and two test partners for isolation tests.
- `auth.fixture.ts` provides a Playwright fixture that logs in and stores the JWT token in browser storage, avoiding repeated login flows.
- Mock server serves canned JSON responses for tRPC and REST endpoints, plus a Socket.io server that emits realistic message shapes (`originalText`, `improvedText`, `processedText`, `translationSkipped`, `fallback` flags) and typing indicator events.
- `global-setup.ts` includes a teardown step that deletes all seeded test data after the suite completes, preventing flaky runs from leftover data.

### Test Suites

**auth.spec.ts**
- Login as agent → lands on AgentView
- Login as support → lands on SupportView
- Login as admin → lands on AdminView
- Invalid credentials → error message shown
- Expired token → redirected to login

**ticket-lifecycle.spec.ts**
- Agent creates ticket with department, ref1, and description
- Ticket appears in support queue
- Support joins ticket → status becomes active
- Messages exchanged between agent and support
- Support closes ticket → status becomes closed
- Agent sees rating modal

**live-chat.spec.ts**
- Agent sends message → support receives it in real-time
- Support sends message → agent receives it
- Typing indicator shows and hides
- AI-improved text displays correctly (improved vs original toggle)

**admin-dashboard.spec.ts**
- Admin navigates to dashboard
- Stats cards render with data
- Charts render (Recharts)
- AI insights panel loads

**multi-tenant.spec.ts**
- Agent from Partner A creates ticket
- Support from Partner A sees the ticket
- Support from Partner B does NOT see Partner A's ticket
- Admin from Partner A sees only Partner A's stats

### Package Dependencies

- `@playwright/test` (dev dependency, root level)

---

## 2. Observability (Prometheus + Grafana)

### Server-Side Metrics

**New files:**

- `server/middleware/metrics.ts` — Express middleware that records HTTP request metrics.
- `server/utils/metrics.ts` — Central metric definitions.

**Metrics:**

| Metric Name | Type | Labels | Description |
|-------------|------|--------|-------------|
| `http_request_duration_seconds` | Histogram | `method`, `route`, `status` | Request latency |
| `http_requests_total` | Counter | `method`, `route`, `status` | Total request count |
| `socketio_connections_active` | Gauge | — | Current WebSocket connections |
| `socketio_events_total` | Counter | `event` | Socket events processed |
| `tickets_active_total` | Gauge | `partner_id` | Open/active tickets |
| `ai_pipeline_duration_seconds` | Histogram | `type` (`improve`, `translate`) | Ollama call latency |
| `ai_pipeline_errors_total` | Counter | `type` | Ollama failures |
| `ticket_queue_depth` | Gauge | `partner_id` | Tickets awaiting support |

**`/metrics` endpoint**: Exposed on the existing Express server at `/metrics`. In development, this is accessible on the host via port 3001 — acceptable for local use. In production, the `/metrics` path should be restricted via a middleware that checks the request source (e.g., allow only Docker internal network IPs or use a shared secret header). For now, this is a dev-only feature and the production compose file does not include Prometheus/Grafana.

### Socket.io Instrumentation

In `server/socket/handlers.ts`:
- Increment `socketio_connections_active` on `connection`, decrement on `disconnect`.
- Increment `socketio_events_total` on each registered event handler.

### AI Pipeline Instrumentation

In `server/services/translate.ts`:
- Wrap `callOllamaWithRetry` with histogram timing for `ai_pipeline_duration_seconds`.
- Increment `ai_pipeline_errors_total` in the catch block.

### Docker Services (docker-compose.yml only)

```yaml
prometheus:
  image: prom/prometheus:latest
  volumes:
    - ./monitoring/prometheus.yml:/etc/prometheus/prometheus.yml
    - prometheus_data:/prometheus
  ports:
    - "9090:9090"

grafana:
  image: grafana/grafana:latest
  volumes:
    - ./monitoring/grafana/provisioning:/etc/grafana/provisioning
    - ./monitoring/grafana/dashboards:/var/lib/grafana/dashboards
    - grafana_data:/var/lib/grafana
  ports:
    - "3000:3000"
  environment:
    - GF_SECURITY_ADMIN_PASSWORD=${GRAFANA_ADMIN_PASSWORD:-admin}

volumes:
  prometheus_data:
  grafana_data:
```

> **Note**: `prometheus_data` and `grafana_data` must be added to the top-level `volumes:` key in `docker-compose.yml` alongside the existing `postgres_data`.

### Monitoring Config Files

```
monitoring/
├── prometheus.yml                          # Scrape server:3001/metrics every 15s
└── grafana/
    ├── provisioning/
    │   ├── datasources/prometheus.yml      # Auto-register Prometheus datasource
    │   └── dashboards/dashboard.yml        # Auto-load dashboard JSON
    └── dashboards/
        └── tessera.json                    # Pre-built dashboard
```

### Grafana Dashboard Panels

- Request rate (req/s)
- Latency P50 / P95 / P99
- Error rate (5xx responses)
- Active Socket.io connections
- Ticket queue depth
- AI pipeline latency (improve vs translate)
- AI pipeline error rate

### Package Dependencies

- `prom-client` (server dependency)

---

## 3. Mobile PWA — Agent Lite

### New Files

| File | Purpose |
|------|---------|
| `client/src/views/AgentLiteView.tsx` | Mobile-optimized agent view |
| `client/public/manifest.json` | PWA manifest |
| `client/src/sw.ts` | Service worker |
| `client/public/icons/icon-192.png` | App icon 192x192 |
| `client/public/icons/icon-512.png` | App icon 512x512 |
| `client/public/icons/icon-512-maskable.png` | Maskable icon for Android adaptive icons |

### AgentLiteView

A stripped-down version of AgentView for field technicians:

- **Ticket list**: Simple list of open tickets with status badges
- **Ticket creation**: Department selector, ref1 field, description textarea, submit button
- **Chat**: Full-height chat window with bottom-anchored input
- **Header**: Minimal — partner name, back button, sign out
- **No animations**: No Framer Motion (performance on low-end devices)
- **Touch-optimized**: Large tap targets (min 44x44px), pull-to-refresh

### Routing

In `App.tsx`:
- Detect `agent` role + `?lite=1` URL param → lazy-load `AgentLiteView`
- Without `?lite=1`, always load full `AgentView` regardless of viewport
- On first mobile visit (detected once at load via `navigator.userAgentData?.mobile` or `matchMedia` as fallback), show a one-time prompt: "Switch to mobile view?" that sets `?lite=1`
- Manual toggle: agents can add/remove `?lite=1` URL param at any time

### PWA Manifest (`client/public/manifest.json`)

```json
{
  "name": "Tessera Agent",
  "short_name": "Tessera",
  "display": "standalone",
  "start_url": "/?lite=1",
  "theme_color": "<brand-primary>",
  "background_color": "#ffffff",
  "icons": [
    { "src": "/icons/icon-192.png", "sizes": "192x192", "type": "image/png" },
    { "src": "/icons/icon-512.png", "sizes": "512x512", "type": "image/png" },
    { "src": "/icons/icon-512-maskable.png", "sizes": "512x512", "type": "image/png", "purpose": "maskable" }
  ]
}
```

### Service Worker Strategy

| Resource | Strategy | Rationale |
|----------|----------|-----------|
| Static assets (JS, CSS, icons) | Cache-first | Rarely change, fast load |
| API calls (`/api/*`) | Network-first, cache fallback | Show cached ticket list when offline |
| Socket.io | No caching | Real-time only, show reconnecting banner |

**Offline behavior:**
- Ticket list shows cached data with "offline" indicator
- New messages queued in IndexedDB, sent when connection restores. If the server rejects a queued message (e.g., ticket was closed while offline), the message is marked as "failed" with a user-visible error and retry/discard options.
- Ticket creation disabled offline (requires server-side validation)

### HTML Changes (`client/index.html`)

- Add `<link rel="manifest" href="/manifest.json">`
- Add `<meta name="theme-color" content="<brand-primary>">`

### Service Worker Lifecycle

- On new deployment, Vite's content-hashed filenames ensure cache busting for static assets.
- Service worker uses `skipWaiting()` + `clients.claim()` to activate immediately on update.
- Old caches are cleaned up in the `activate` event by deleting cache keys that don't match the current version.

---

## Implementation Order

1. **Playwright E2E Tests** — safety net first
2. **Prometheus + Grafana Observability** — see what's happening
3. **Agent Lite PWA** — standalone client work

## Dependencies

- Playwright: no server changes required
- Observability: `prom-client` npm package, Docker services
- PWA: client-only (manifest, service worker, new view)

## Non-Goals

- No Kubernetes manifests (Docker Compose only)
- No log aggregation (ELK/Datadog) — future work
- No distributed tracing (OpenTelemetry) — future work
- No mobile views for support/admin roles
- No API versioning (deferred — no external consumers yet)
