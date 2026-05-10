# Azure Cutover Runbook

## Purpose

Step-by-step procedure for promoting Guichet from the trial deployment in
`rg-guichet-trial` to a production Azure Container Apps environment. Use this
runbook the first time you cut over to a real prod tenant, and as a checklist
for subsequent prod re-deploys.

For the broader environment-variable reference and architecture overview see
`docs/AZURE_DEPLOYMENT.md`. For emergency platform-operator recovery see
`docs/BREAK_GLASS_RUNBOOK.md`. For audit / chain-verify operations see
`docs/AUDIT_RUNBOOK.md`.

---

## Pre-cutover checklist

Walk this list before touching any Azure resource. Any unchecked item is a
go / no-go decision, not a "fix later" item — most of these failures are
fail-closed at server boot.

### Environment variables (Container App secrets)

| Variable | Required? | Note |
|----------|-----------|------|
| `JWT_SECRET` | yes | 64+ random chars (`node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"`). HS256 signing key. |
| `DATABASE_URL` | yes | `postgresql://user:pass@host:5432/guichet?sslmode=require`. Azure Database for PostgreSQL Flexible Server. |
| `REDIS_URL` | yes | `rediss://:<password>@<host>:6380` — must be `rediss://` (TLS); port 6379 is disabled on Azure Redis Cache. |
| `FIELD_ENCRYPTION_SECRET` | yes when `AI_ENABLED=true` | 64-char hex. Server FATALs at boot if AI is on without this. Encrypts AI provider keys + webhook secrets at rest. |
| `CORS_ORIGIN` | yes | Production URL, no `localhost`. Server FATALs if `localhost` appears in prod. |
| `FRONTEND_URL` | yes | Same. |
| `COOKIE_SECURE` | yes | `true`. Server FATALs if `false` in prod. |
| `COOKIE_DOMAIN` | recommended | Root domain (e.g. `.example.com`) so subdomain switching works. |
| `PLATFORM_ADMIN_EMAIL` | yes | Auto-creates the first platform operator on first boot. Race-safe. |
| `AZURE_AD_TENANT_ID` | yes | Entra tenant id. |
| `AZURE_AD_CLIENT_ID` | yes | App registration client id. |
| `AZURE_AD_CLIENT_SECRET` | yes | App registration client secret. |
| `AZURE_AD_REDIRECT_URI` | yes | `https://<prod-domain>/api/v1/auth/azure/callback`. Must match the Entra app registration exactly (path, scheme, host, port). |
| `AZURE_STORAGE_CONNECTION_STRING` | yes | Presence enables the Azure Blob backend; without it uploads fall back to local disk inside the container (lost on revision swap). |
| `AZURE_STORAGE_CONTAINER` | recommended | Defaults to `uploads`. Created automatically if missing. |
| `DEMO_MODE` | must be unset/false | Server FATALs at boot if `true`. Trial deployments only. |
| `INTERNAL_EMAIL_DOMAINS` | optional | CSV of staff email domains. Anyone outside is `isExternal=true` (B2B guest model). |
| `AI_ENABLED` | optional | Default `false`. If you turn it on you must also set `AI_PROVIDER`, `AI_BASE_URL`, `AI_API_KEY`, `AZURE_OPENAI_DEPLOYMENT`, and the encryption key above. |

### Migration strategy

Two paths — pick one **before** you build images:

1. **Squash to single 0000 (recommended for fresh prod DB)** — collapse all
   incremental Drizzle migrations into one `0000_initial.sql`. Avoids the
   ledger-conflict risk you hit during dev when migrations get re-baselined.
   Generate a fresh squash with `drizzle-kit generate` against an empty
   schema reference, replace `server/drizzle/` contents with the single
   file + journal, and rebuild the prod image.
2. **Apply incrementally against an existing DB** — keep `server/drizzle/`
   as-is and run `node dist/db/migrate.js` once after deploy. Only safe if
   the prod DB already has a Drizzle journal (i.e. it was previously baselined).

Either way, take a backup first:
```bash
docker compose exec server npm run db:backup        # local stack
# Azure: pg_dump from a jump host or `az postgres flexible-server backup`
```

### Build readiness gates

Run these on the cutover branch before tagging a release image:

| Check | Command | Expected |
|-------|---------|----------|
| Local CI | `powershell -File scripts/ci.ps1` | All 10 steps PASS |
| Prod image build | `docker build -f server/Dockerfile.prod -t guichet-server:proof server/` | exit 0; image content ~120 MB |
| Migrator smoke | `docker run --rm guichet-server:proof node dist/db/migrate.js` | exits 1 with `[migrate] FATAL: DATABASE_URL is required` (proves the script loads cleanly) |

---

## Cutover steps

### 1. Build and push images

```powershell
$ACR  = "<your-acr-name>"
$TAG  = "v1.0.0"   # or git short SHA

az acr login --name $ACR

docker build -f server/Dockerfile.prod -t $ACR.azurecr.io/guichet-server:$TAG server/
docker build -f client/Dockerfile.prod -t $ACR.azurecr.io/guichet-client:$TAG .

docker push $ACR.azurecr.io/guichet-server:$TAG
docker push $ACR.azurecr.io/guichet-client:$TAG
```

Build context for the server image is `./server` (not the repo root). The
client build context is the repo root because `client/Dockerfile.prod`
copies `server/trpc/` and `server/types/` for tRPC type inference.

### 2. Run database migrations

For a fresh prod DB (squashed 0000 strategy):
```powershell
az containerapp exec `
  --name ca-guichet-server `
  --resource-group rg-guichet `
  --command "node dist/db/migrate.js"
```

For an existing DB with an empty Drizzle ledger, run the baseline first
**from a host that has `drizzle-kit` installed** (the prod image does not):
```bash
DATABASE_URL=<prod-url> npm run db:baseline
```
Then exec the prod migrate command above.

The migrator uses `drizzle-orm`'s `migrate()` helper (not the `drizzle-kit`
CLI) so it works inside the prod image without the ~50 MB devDep footprint.

### 3. Roll Container App revisions

```powershell
az containerapp update `
  --name ca-guichet-server `
  --resource-group rg-guichet `
  --image $ACR.azurecr.io/guichet-server:$TAG

az containerapp update `
  --name ca-guichet-client `
  --resource-group rg-guichet `
  --image $ACR.azurecr.io/guichet-client:$TAG
```

For sticky-session correctness (Socket.io handshake → WS upgrade must hit
the same instance):
- Single-revision mode is sticky inherently:
  `--configuration-active-revision-mode single`
- Multi-instance: enable ingress sticky sessions
  (`stickySessions.affinity = sticky` on the ingress config).

### 4. Boot verification

Watch Log Analytics for the following lines from `ca-guichet-server`:

| Log line | Meaning |
|----------|---------|
| `AI context initialized` | Boot reached the AI wiring step. |
| `[ai-health] AI_ENABLED=false — skipping boot health check` | AI off — expected if you haven't enabled it yet. |
| `[ai-health] provider reachable at boot` | AI on and the provider answered `isAvailable()`. **Required if you flipped `AI_ENABLED=true`.** |
| `[ai-health] provider unreachable at boot` | AI on but the provider 401'd or timed out. Stale `AI_API_KEY` is the most likely cause (rotated on the AOAI side, not synced to the CA secret). Fix the secret and roll a new revision. |
| `[storage] using Azure Blob Storage backend` | `AZURE_STORAGE_CONNECTION_STRING` was read; uploads will route to Blob. |
| `[storage:azure] container ready` | Blob container exists or was just created. |
| `bootstrap: created platform operator <email>` | First-boot only. |

Then probe HTTP:
```powershell
curl -s https://<prod-domain>/api/v1/health | jq .
# expect: { status: "ok", database: "connected", redis: "connected", storage: "connected" }
```

### 5. End-to-end smoke

| Path | Pass criteria |
|------|---------------|
| Open `https://<prod-domain>/` | Login page loads, no console errors. |
| Click "Sign in with Microsoft" | Redirects to Entra, returns to `/` with the right tenant. |
| Open the platform cockpit | Partner list loads, no 5xx in network tab. |
| Create a test partner + invite via group mapping | New user surfaces after their next SSO callback. |
| Open a ticket and send a message | Socket.io WS upgrade succeeds; message round-trips. |
| Attach a 1 MB image | Upload returns a `/uploads/<id>` URL; image renders in chat. |
| Open the platform Health page | No tripwires firing (`chainBroken`, `chainStale`, `slaBreachBurst`, `gdprPurgeMissing`). |
| Run an audit chain verify manually | Returns `verified=true` with no broken links. |

---

## Post-cutover (first 24 hours)

| Window | Check |
|--------|-------|
| t+5min | Health probe staying 200; no FATAL lines in Log Analytics. |
| t+1h | First scheduled SLA sweep ran (every minute by default — check `services/sla.ts` log lines). |
| t+12h | Chain-verify scheduled run completed; `chainBroken` tripwire still false. |
| t+24h | First GDPR purge ran; `guichet_gdpr_purge_runs_total{outcome="success"}` incremented (Pino log line, since there's no Prometheus endpoint — use Log Analytics KQL). |
| t+24h | Backup ran (per your DB backup schedule, not the app). |

---

## Rollback

The Azure Container Apps revisioning model makes rollback a one-liner per service.

```powershell
# List revisions
az containerapp revision list `
  --name ca-guichet-server `
  --resource-group rg-guichet `
  --query "[].{name:name, active:properties.active, image:properties.template.containers[0].image, created:properties.createdTime}" `
  -o table

# Reactivate the previous revision
az containerapp revision activate `
  --name ca-guichet-server `
  --resource-group rg-guichet `
  --revision <previous-revision-name>

az containerapp revision deactivate `
  --name ca-guichet-server `
  --resource-group rg-guichet `
  --revision <new-broken-revision-name>
```

Database rollback is **not** a one-liner. If a migration broke prod:

1. Restore the most recent backup (`az postgres flexible-server restore` or
   `pg_restore` from the backup you took in the pre-flight step).
2. Roll the server CA back to the prior image (which was built against the
   prior schema).
3. Investigate offline before re-attempting cutover.

---

## Known gaps before this cutover

These are tracked in repo memory / the wiki and need to be resolved or
explicitly accepted before going live:

- **Azure Blob upload + GDPR cascade-delete are untested against a real
  Azure container.** The code paths exist (`storage.ts AzureBlobStorage`
  and `gdpr.ts` cascade) but have only been smoke-tested locally. Validate
  in a staging blob container before prod cutover, not after. (Per the
  `uploads_azure_gdpr_test_pending` memory note.)
- **`Dockerfile_azure` files are byte-identical to `Dockerfile.prod`.** Pick
  one path for the prod pipeline, document which one is canonical, and
  delete or alias the other to prevent future drift.
- **Caddyfile is not used in Azure Container Apps.** It's only the docker-
  compose stack's TLS-terminating reverse proxy. Ingress + TLS cert on the
  CA itself replaces it. Don't ship Caddy with the Azure deploy.

---

## Reference: what changed in the azure-readiness pass

The session that produced this runbook landed seven commits on `main`
(`aa1984d` through `cda686b`). The shape:

- `chore(prod): azure-readiness pass on docker setup` — fixed a pre-existing
  YAML parse error in `docker-compose.prod.yml`, dropped the dead `/metrics`
  Caddy route, added log rotation, made the migrator path actually work
  inside the runtime image.
- `chore(prod): trim 76 MB from prod node_modules (227 -> 151)` — replaced
  the `drizzle-kit` CLI with the `drizzle-orm` `migrate()` helper at
  runtime; moved `pino-pretty` and `swagger-ui-express` to devDeps; pruned
  the optional pglite peer.
- `chore(prod): drop S3 storage backend and aws-sdk dep` — Azure-only
  commitment; removed `S3Storage` and the `@aws-sdk/client-s3` dep.
- `chore(docs): drop AWS_DEPLOYMENT.md` — no longer applies.
- `docs: truth-up WIP edits` — aligned 12 doc files with the current code
  reality (procedure → capability rename, AI feature list, encryption
  usage, invite flow, etc).
- `fix(prod): wire Azure Blob env vars + dedicated gates for trimmed dev
  deps` — caught a pre-existing bug where `AZURE_STORAGE_*` env vars were
  declared in the schema but never piped into the parser.
- `fix(test): repair pre-existing CI failures` — 1 unit + 3 e2e tests that
  were broken by drift from earlier refactors.

Final prod image content size: **~120 MB**. Local CI: **10/10 PASS** in
~6.5 minutes.
