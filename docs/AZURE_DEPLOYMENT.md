# Azure Deployment Guide

Pre-deployment checklist and configuration for running Guichet on Azure.

## Environment Variables

**Required** (server exits without these in production):

| Variable | Example | Notes |
|----------|---------|-------|
| `NODE_ENV` | `production` | Enables all production hardening checks |
| `JWT_SECRET` | 64+ char random string | HS256 signing key |
| `DATABASE_URL` | `postgresql://user:pass@host:5432/guichet?sslmode=require` | Azure Database for PostgreSQL |
| `REDIS_URL` | `rediss://:password@host:6380` | **Must use `rediss://` (TLS)** for Azure Redis Cache |
| `CORS_ORIGIN` | `https://guichet.example.com` | Must not contain `localhost` |
| `FRONTEND_URL` | `https://guichet.example.com` | Must not contain `localhost` |
| `COOKIE_SECURE` | `true` | Mandatory in production |
| `COOKIE_DOMAIN` | `.example.com` | Set if using subdomains |
| `PLATFORM_ADMIN_EMAIL` | `admin@example.com` | Auto-creates platform operator on first boot |
| `FIELD_ENCRYPTION_SECRET` | 64-char hex string | **Required** when `AI_ENABLED=true` (server FATALs at boot otherwise). Encrypts AI keys + webhook secrets at rest. |
| `DEMO_MODE` | `false` | **Must be `false` (or unset) in production** — server FATALs at boot if true. Trial / demo deployments only. |
| `ACCESS_TOKEN_EXPIRY` | `15m` | JWT access-token lifetime (default `15m`). |
| `REFRESH_TOKEN_EXPIRY` | `7d` | Refresh-token lifetime (default `7d`). The `guichet_refresh` HttpOnly cookie is path-restricted to `/api/v1/auth/refresh` — make sure ingress / WAF rules don't strip cookies on that path. |

**Azure SSO** (Guichet is SSO-only in production — without these, no one can log in):

| Variable | Example | Notes |
|----------|---------|-------|
| `AZURE_AD_TENANT_ID` | `xxxx-xxxx-xxxx-xxxx` | Entra tenant id |
| `AZURE_AD_CLIENT_ID` | `xxxx-xxxx-xxxx-xxxx` | App registration client id |
| `AZURE_AD_CLIENT_SECRET` | `secret...` | App registration client secret |
| `AZURE_AD_REDIRECT_URI` | `https://guichet.example.com/api/v1/auth/azure/callback` | Must match the Entra app registration |

See `docs/SSO_SETUP_RUNBOOK.md` for the full SSO setup walkthrough.

**Azure Storage** (omit for local disk fallback):

| Variable | Example | Notes |
|----------|---------|-------|
| `AZURE_STORAGE_CONNECTION_STRING` | `DefaultEndpointsProtocol=https;...` | Presence enables Azure Blob backend |
| `AZURE_STORAGE_CONTAINER` | `uploads` | Created automatically if missing |

**Optional**:

| Variable | Default | Notes |
|----------|---------|-------|
| `AI_ENABLED` | `false` | Enable AI features. Requires provider config (`AI_PROVIDER`, `AZURE_OPENAI_*` or compatible) **and** `FIELD_ENCRYPTION_SECRET` — server FATALs at boot if AI is on without the encryption key. |

## WebSocket: Sticky Sessions

Socket.io requires the same client to reach the same server instance across the HTTP handshake → WS upgrade sequence. Without sticky sessions, the upgrade fails.

### Azure Container Apps
```
az containerapp update --name guichet-server \
  --resource-group rg-guichet \
  --set-env-vars ... \
  --configuration-active-revision-mode single
```
Container Apps with a single revision inherently route to one instance. For multi-instance scaling, use **session affinity**:
```json
{
  "ingress": {
    "stickySessions": {
      "affinity": "sticky"
    }
  }
}
```

### Azure App Service
Enable **ARR affinity** in the Azure Portal:
- App Service → Configuration → General Settings → ARR affinity: **On**

This sets the `ARRAffinity` cookie automatically.

## Redis TLS

Azure Redis Cache requires TLS. Use `rediss://` (double-s) in `REDIS_URL`:

```
REDIS_URL=rediss://:your-access-key@your-cache.redis.cache.windows.net:6380
```

The `ioredis` client used by Guichet auto-negotiates TLS when the protocol is `rediss://`.

**Do not** use the non-TLS port (6379) on Azure — it's disabled by default.

## Health Probes

Configure Azure liveness/readiness probes to hit:

```
GET /api/v1/health
```

Returns `200 { status: "ok", database: "connected", redis: "connected", storage: "connected" }` when healthy, `503 { status: "degraded", ... }` when any service is down.

**Recommended probe config:**
- Liveness: `/api/v1/health`, period 30s, failure threshold 3
- Readiness: `/api/v1/health`, period 10s, failure threshold 1

## File Uploads

Guichet uses a storage backend abstraction. When `AZURE_STORAGE_CONNECTION_STRING` is set, uploads go to Azure Blob Storage. Otherwise, they use local disk (dev/Docker only).

- Container is created as **private** — blobs are not publicly accessible
- All file access goes through the auth-gated `/uploads` proxy (`server/middleware/uploadProxy.ts`)
- GDPR purge has a cascade-delete code path against Azure Blob, but it is currently **untested against a real Azure container** — verify in staging before relying on it for compliance.
- Global memory guard caps concurrent upload buffering at 100MB

## Database

Azure Database for PostgreSQL (Flexible Server) with `?sslmode=require`:

```
DATABASE_URL=postgresql://guichet:password@guichet-db.postgres.database.azure.com:5432/guichet?sslmode=require
```

Run migrations on first deploy:

```bash
# Local Docker stack
docker compose exec server npm run db:migrate

# Azure Container Apps — exec inside the running server CA
az containerapp exec \
  --name ca-guichet-server \
  --resource-group rg-guichet \
  --command "npm run db:migrate"
```

The runtime image ships `drizzle/` (migration SQL + journal) and `drizzle-kit`
in `dependencies` (not devDependencies), so `npm run db:migrate` works inside
the prod container without any extra build step.

For zero-downtime cutovers, run the migration **before** rolling new server
revisions when migrations only add nullable columns / new tables. For
breaking schema changes, expand → migrate → contract across two releases.

## Container Registry

Push production images to Azure Container Registry:

```bash
az acr login --name guichetregistry
docker compose -f docker-compose.prod.yml build
docker tag guichet-server guichetregistry.azurecr.io/guichet-server:latest
docker tag guichet-client guichetregistry.azurecr.io/guichet-client:latest
docker push guichetregistry.azurecr.io/guichet-server:latest
docker push guichetregistry.azurecr.io/guichet-client:latest
```

## Monitoring

Guichet does **not** ship a Prometheus metrics endpoint. Operations signal comes from:
- Structured JSON logs (Pino) on stdout — Azure Container Apps automatically ingests these into Log Analytics.
- The `/api/v1/health` probe (Postgres + Redis + storage).
- The in-app **Health page** in PlatformView (chain-broken / chain-stale / SLA breach burst / GDPR purge missing or failed). See `docs/AUDIT_RUNBOOK.md`.

For deeper APM, attach `@azure/monitor-opentelemetry` to the runtime — it is not bundled.
