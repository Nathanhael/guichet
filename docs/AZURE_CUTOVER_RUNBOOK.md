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
| `AI_ENABLED` | optional | Default `false`. If you turn it on you must also set `AI_PROVIDER`, `AI_BASE_URL`, `AI_API_KEY`, `AZURE_OPENAI_DEPLOYMENT`, and the encryption key above. |

### AOAI quota requests (T-7 days, parallel to image builds)

**Region target: `francecentral`.** Trial put AOAI in `swedencentral`
because that was the only EU region with gpt-5-family quota at the time;
9 of 10 trial resources are already in `francecentral`. User base is
Belgium + Morocco — France Central is the dichtbijste EU DC for both
(MA latency to FR ~25-35ms vs ~60-70ms to Sweden). Consolidating to
one region also cuts the cross-region hop on every AI call (~20-30ms
overhead today).

Quota allocations on the trial sub do NOT carry over to the prod sub —
each AOAI resource starts with restrictive defaults. Request these the
moment the prod sub is provisioned so approval (5-7 days for mini-tier)
lands before launch:

- [ ] Create new AOAI resource `oai-guichet-prod-brk` (or similar) in
      `francecentral`. Same Cognitive Services account type as trial,
      but in the prod sub + region.
- [ ] `gpt-4o` — `Standard` 50K TPM in `francecentral`. Current production
      model per A/B sweep 2026-05-10 (`runAction.ts` top-of-file). Backup
      capacity for hard-fail-safe.
- [ ] `gpt-4o` — `GlobalStandard` 200K TPM. Real-traffic capacity. Often
      easier to get than Standard in the same volume.
- [ ] `gpt-4.1-mini` — `Standard` AND `GlobalStandard` 50K TPM each in
      `francecentral`. **Why**: 4.1-mini is the non-reasoning successor
      to deprecated `gpt-4o-mini` and projects to ~6× cheaper than gpt-4o
      at comparable quality. Trial sub had Batch quota only (unusable for
      live chat); prod sub typically opens Standard. Migrate when approved
      + verified via 20-case A/B against gpt-4o (matches the 2026-05-10
      methodology).
- [ ] `whisper` — `Standard` 15 RPM in `francecentral`. Trial defaulted to
      ~1 RPM which throttled voice transcription under realistic load
      (memory `azure_openai_deployment.md`, ~5000 tickets/month → 1.7 RPM
      sustained, peak <15). **Verify** `whisper` model is available in
      `francecentral` at quota-request time — Azure does roll Whisper to
      new regions but it lags GPT models by months. Fallback: keep Whisper
      in `swedencentral` only (a single cross-region hop for STT is
      acceptable, voice is async UX).
- [ ] Skip GPT-5 family entirely. A/B verdict 2026-05-10: reasoning_tokens
      dominate billing, no cost-quality advantage over gpt-4o for transform
      tasks. Re-evaluate only if OpenAI ships a new non-reasoning mini.
- [ ] Update Container App env vars at cutover time:
      `AI_BASE_URL=https://oai-guichet-prod-brk.openai.azure.com/`,
      `AZURE_OPENAI_DEPLOYMENT=gpt-4o`, plus `AI_API_KEY` secret rotated
      to the new resource's key.

Request via Azure portal: Cognitive Services → resource → Quotas →
Request Increase. Justification text: "Production launch of multi-tenant
live chat support platform serving Belgium + Morocco user base; per-call
cost modelling and quality A/B results in `runAction.ts` top-of-file;
expected steady-state load ~30k chats/month; deploying in `francecentral`
to consolidate with rest of stack and minimize EU-MA round-trip latency."

### Client → Static Web Apps Free migration (T-7 days, requires custom domain)

Trial deployment runs the client as a Container App (`ca-guichet-client`)
which costs ~€12/month for a process whose only job is to serve the Vite
SPA bundle + reverse-proxy `/api/`, `/uploads/`, `/socket.io/` to the
server via nginx (`client/nginx.conf`). Static Web Apps Free tier hosts
the same bundle from a global CDN at €0/month with managed TLS.

**Why deferred from trial:** SWA Free tier does NOT support routing
to an external Container App backend — that requires SWA Standard
(~€8/month, eats most of the savings). Without it, the browser would
need to make cross-origin calls to the server domain — meaning the
JWT auth cookie must flip from `SameSite=Lax` to `SameSite=None;
Secure` and CORS must allowlist the SWA origin. That cookie change
is the kind of subtle thing that works in trial and surfaces a rare
auth bug in prod under load. Don't take that risk while pre-prod.

**The clean prod approach: custom domain + same-site cookies.** When
you have a real domain (`example.com`):

- SWA at `app.example.com` (or `www.`) — serves the static SPA
- Container App at `api.example.com` — serves the API
- Both share the registrable domain `example.com` → the auth cookie
  with `Domain=.example.com; SameSite=Lax` works for both transparently
- No cross-origin cookie complications, no server-side `SameSite=None`
  flip, no CORS surface widening

Steps when prod sub is provisioned and custom domain is registered:

- [ ] Create SWA: `az staticwebapp create -n swa-guichet-client -g <prod-rg> -l westeurope --sku Free --source https://github.com/Nathanhael/guichet --branch main --app-location "client" --output-location "dist" --token <gh-pat>`
- [ ] Add custom domain `app.example.com` to SWA + DNS CNAME
- [ ] Add custom domain `api.example.com` to Container App + DNS CNAME
- [ ] Update server `COOKIE_DOMAIN=.example.com` env var
- [ ] Update server `CORS_ORIGIN=https://app.example.com`
- [ ] Update `FRONTEND_URL=https://app.example.com`
- [ ] Verify dev-login + Azure SSO + ticket flow work via SWA URL
- [ ] Cleanup: delete `ca-guichet-client` Container App + `guichet-client` ACR repo
- [ ] Saving: ~€12/month (~€144/year)

The auto-generated GitHub Actions workflow at `.github/workflows/azure-static-web-apps-*.yml`
will build from `client/` and deploy on every push to `main`. Build
needs `server/trpc/router` types in scope (already in `client/tsconfig.json`
include array — works because the GH Actions checkout includes the whole
repo); no special handling required.

Monitor approval via:

```powershell
az cognitiveservices usage list -l <region> `
  --query "[?contains(name.value, 'gpt-4o') || contains(name.value, 'gpt-4.1-mini')].{model:name.value, used:currentValue, limit:limit}" -o table
```

### Migration strategy

Two paths — pick one **before** you build images:

1. **Squash to single 0000 (recommended for fresh prod DB)** — collapse all
   incremental Drizzle migrations into one `0000_initial.sql`. Avoids the
   ledger-conflict risk you hit during dev when migrations get re-baselined.
   The procedure has been verified — see "Squash procedure" below for the
   exact commands and the equivalence check that's been done.
2. **Apply incrementally against an existing DB** — keep `server/drizzle/`
   as-is and run `node dist/db/migrate.js` once after deploy. Only safe if
   the prod DB already has a Drizzle journal (i.e. it was previously baselined).

#### Squash procedure (verified 2026-05-10)

The `server/drizzle-prod-squash.config.ts` file is committed to the repo
specifically for this; it points `drizzle-kit` at a separate output
directory (`server/drizzle-prod-squash/`, gitignored) so the dev journal
in `server/drizzle/` stays untouched.

```bash
# 1. Generate the squash from the live schema.ts
docker compose exec server npx drizzle-kit generate \
  --config drizzle-prod-squash.config.ts --name initial
# → server/drizzle-prod-squash/0000_initial.sql + meta/

# 2. (Optional but recommended) verify equivalence with the incremental ledger
docker compose exec db psql -U user -d postgres \
  -c "DROP DATABASE IF EXISTS squash_a;" \
  -c "DROP DATABASE IF EXISTS squash_b;" \
  -c "CREATE DATABASE squash_a;" \
  -c "CREATE DATABASE squash_b;"

# Apply the 18 incremental migrations to squash_a
docker compose exec -e DATABASE_URL=postgres://user:password@db:5432/squash_a \
  server npx drizzle-kit migrate

# Apply the single squash to squash_b
docker compose exec -e DATABASE_URL=postgres://user:password@db:5432/squash_b \
  server npx drizzle-kit migrate --config drizzle-prod-squash.config.ts

# Diff the resulting schemas
docker compose exec db pg_dump -U user --schema-only --schema=public squash_a > .schema-a.sql
docker compose exec db pg_dump -U user --schema-only --schema=public squash_b > .schema-b.sql
diff -u .schema-a.sql .schema-b.sql
```

Expected diff (last verified 2026-05-10): **only column ordering** in 7
tables that grew columns over the incremental history (`ai_usage_log`,
`archived_tickets`, `canned_responses`, `daily_agent_status`, `messages`,
`partners`, `tickets`). No structural differences — same columns, same
types, same constraints, same indexes. Drizzle queries always use named
columns so the ordering difference is functionally invisible.

#### Cutover-time replacement

When you're ready to ship the squash:

```bash
# Move dev incrementals out of the way
mv server/drizzle server/drizzle.dev-incrementals.bak

# Promote the squash to be the canonical migration folder
mv server/drizzle-prod-squash server/drizzle

# Build the prod image — Dockerfile.prod COPYs server/drizzle into runtime
docker build -f server/Dockerfile.prod -t <acr>.azurecr.io/guichet-server:<tag> server/
```

After the prod cutover succeeds, decide whether to re-baseline dev (apply
the same squash to dev DB and reset its ledger) or keep dev on the
incremental history. The prod image only ever sees the squash; dev's
choice is independent.

Take a database backup before either path:
```bash
docker compose exec server npm run db:backup        # local stack
# Azure: pg_dump from a jump host or `az postgres flexible-server backup`
```

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

- **Caddyfile is not used in Azure Container Apps.** It's only the docker-
  compose stack's TLS-terminating reverse proxy. Ingress + TLS cert on the
  CA itself replaces it. Don't ship Caddy with the Azure deploy.

(Previously listed: *Azure Blob upload + GDPR cascade-delete untested
against a real container.* Resolved 2026-05-10 — the `getStorage()`
refactor of `server/scripts/test_gdpr_purge.ts` ran the full upload →
30 d cascade against `stguichettrialbrk` / `uploads-gdpr-test`, 17/17
passing, with `az storage blob list` confirming the container empty
post-purge. See `[[learnings/guichet-prod-readiness-sweep-2026-05-10]]`.)

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
