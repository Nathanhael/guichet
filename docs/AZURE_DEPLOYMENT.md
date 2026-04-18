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

**Azure Storage** (omit for local disk fallback):

| Variable | Example | Notes |
|----------|---------|-------|
| `AZURE_STORAGE_CONNECTION_STRING` | `DefaultEndpointsProtocol=https;...` | Presence enables Azure Blob backend |
| `AZURE_STORAGE_CONTAINER` | `uploads` | Created automatically if missing |

**Optional**:

| Variable | Default | Notes |
|----------|---------|-------|
| `FIELD_ENCRYPTION_SECRET` | — | 64-char hex for encrypted fields |
| `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` | — | For web push notifications |
| `AI_ENABLED` | `false` | Enable AI features (requires provider config) |

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
- All file access goes through the auth-gated `/uploads` proxy
- GDPR purge automatically deletes associated files from blob storage
- Global memory guard caps concurrent upload buffering at 100MB

## Database

Azure Database for PostgreSQL (Flexible Server) with `?sslmode=require`:

```
DATABASE_URL=postgresql://guichet:password@guichet-db.postgres.database.azure.com:5432/guichet?sslmode=require
```

Run migrations on first deploy:
```bash
docker compose exec server npm run db:migrate
```

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

The server exposes Prometheus metrics at `/metrics` (root path, not under `/api/v1/`). For Azure Monitor integration, add `@azure/monitor-opentelemetry` (not yet implemented — use Prometheus scraping or a sidecar exporter in the interim).

Structured JSON logs (Pino) are written to stdout — Azure Container Apps automatically ingests these into Log Analytics.
