# Production TLS via Caddy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add automatic HTTPS to the production deployment via a Caddy reverse proxy with Let's Encrypt integration.

**Architecture:** A new Caddy service in `docker-compose.prod.yml` terminates TLS and proxies to the existing `server` and `client` containers on the internal Docker network. Config via a `Caddyfile` using a `DOMAIN` env var.

**Tech Stack:** Caddy 2, Docker Compose, Let's Encrypt/ZeroSSL

---

## File Map

| File | Action | Responsibility |
|------|--------|---------------|
| `Caddyfile` | Create | Caddy reverse proxy config with auto-HTTPS |
| `docker-compose.prod.yml` | Modify | Add caddy service, volumes, adjust client ports |
| `server/config.ts` | Modify | Add COOKIE_DOMAIN production warning |

---

### Task 1: Create the Caddyfile

**Files:**
- Create: `Caddyfile`

- [ ] **Step 1: Create the Caddyfile**

Create `Caddyfile` in the project root:

```caddyfile
{$DOMAIN:localhost} {
	# API traffic → server container
	handle /api/* {
		reverse_proxy server:3001
	}

	# WebSocket traffic → server container
	handle /socket.io/* {
		reverse_proxy server:3001
	}

	# Uploaded files → server container
	handle /uploads/* {
		reverse_proxy server:3001
	}

	# Prometheus metrics → server container (internal only)
	handle /metrics {
		reverse_proxy server:3001
	}

	# Everything else → client container (SPA)
	handle {
		reverse_proxy client:8080
	}
}
```

Notes:
- `{$DOMAIN:localhost}` reads the `DOMAIN` env var; defaults to `localhost` (self-signed cert) for local testing.
- Caddy automatically provisions Let's Encrypt certs when `DOMAIN` is a real hostname.
- Caddy automatically adds HSTS, HTTP→HTTPS redirect, OCSP stapling.
- `client:8080` matches the port in `client/Dockerfile.prod` (nginx-unprivileged serves on 8080).

- [ ] **Step 2: Commit**

```bash
git add Caddyfile
git commit -m "feat(infra): add Caddyfile for production TLS

Caddy reverse proxy with automatic HTTPS via Let's Encrypt.
Routes /api/*, /socket.io/*, /uploads/* to server; everything else to client.

Ref: INFRA-1"
```

---

### Task 2: Add Caddy service to production compose

**Files:**
- Modify: `docker-compose.prod.yml`

- [ ] **Step 1: Add caddy service**

In `docker-compose.prod.yml`, add the caddy service after the `client` service (before the `volumes:` section):

```yaml
  caddy:
    image: caddy:2-alpine
    restart: always
    deploy:
      resources:
        limits:
          memory: 128M
          cpus: '0.5'
        reservations:
          memory: 64M
    ports:
      - "80:80"
      - "443:443"
      - "443:443/udp"
    environment:
      - DOMAIN=${DOMAIN:-localhost}
    volumes:
      - ./Caddyfile:/etc/caddy/Caddyfile:ro
      - caddy_data:/data
      - caddy_config:/config
    depends_on:
      - server
      - client
    healthcheck:
      test: ["CMD", "caddy", "validate", "--config", "/etc/caddy/Caddyfile"]
      interval: 30s
      timeout: 10s
      retries: 3
```

- [ ] **Step 2: Remove direct port exposure from client**

In `docker-compose.prod.yml`, find the client service (around line 94-95):

```yaml
    ports:
      - "80:8080"
```

Remove the `ports` section entirely. Client is now accessed only through Caddy on the internal Docker network.

- [ ] **Step 3: Add caddy volumes**

In the `volumes:` section at the bottom, add:

```yaml
  caddy_data:
  caddy_config:
```

- [ ] **Step 4: Add FRONTEND_URL and CORS_ORIGIN env vars**

In the server environment section, ensure these use the DOMAIN variable for consistency. Update:

```yaml
      - CORS_ORIGIN=${CORS_ORIGIN:-https://${DOMAIN:-localhost}}
      - FRONTEND_URL=${FRONTEND_URL:-https://${DOMAIN:-localhost}}
```

Note: These use `${CORS_ORIGIN:-...}` so operators can still override explicitly.

- [ ] **Step 5: Commit**

```bash
git add docker-compose.prod.yml
git commit -m "feat(infra): add Caddy TLS reverse proxy to production compose

Caddy service with automatic HTTPS, HTTP/3 support, and auto cert management.
Client no longer exposes ports directly — all traffic goes through Caddy.

Ref: INFRA-1"
```

---

### Task 3: Add COOKIE_DOMAIN production warning

**Files:**
- Modify: `server/config.ts` (after the production safety checks)

- [ ] **Step 1: Read the production safety checks section**

Read `server/config.ts` starting from line 108 to find the existing production safety checks (the `if (config.NODE_ENV === 'production')` block that checks CORS_ORIGIN, FRONTEND_URL, COOKIE_SECURE, DISABLE_RATE_LIMIT).

- [ ] **Step 2: Add COOKIE_DOMAIN warning**

Find the section with the existing production warnings (REDIS_URL, REQUIRE_PLATFORM_STEP_UP). Add after those:

```typescript
  if (!config.COOKIE_DOMAIN) {
    logger.warn('⚠️  COOKIE_DOMAIN is not set. Cookies will be scoped to the exact hostname, which may cause issues with subdomains. Set COOKIE_DOMAIN to your root domain (e.g., "example.com") for production.');
  }
```

- [ ] **Step 3: Run server typecheck**

Run: `docker compose exec server npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 4: Commit**

```bash
git add server/config.ts
git commit -m "feat(config): add COOKIE_DOMAIN production warning

Warns operators when COOKIE_DOMAIN is not set in production,
which can cause cookie scoping issues with real domains.

Ref: INFRA-1"
```

---

## Self-Review

- [x] **Spec coverage:** Caddyfile (Task 1), compose changes with caddy service + volume + port removal (Task 2), COOKIE_DOMAIN warning (Task 3). All spec requirements covered.
- [x] **Placeholder scan:** No TBDs or vague instructions found.
- [x] **Type consistency:** `DOMAIN` env var name used consistently in Caddyfile and compose. Port `8080` matches `client/Dockerfile.prod` (nginx-unprivileged).
- [x] **Spec item not in plan:** README production deployment section — deferred to CLAUDE.md update, not a code task. The compose comments and Caddyfile are self-documenting.
