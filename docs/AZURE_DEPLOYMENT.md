# Azure (Identity) Env Vars

Azure is used **for Entra SSO only**. There is no other Azure footprint — Postgres, Redis, uploads, AI provider, app runtime all stay off Azure for the pilot. If that ever changes, this doc grows back; for now it is a thin env-var reference.

The full SSO setup walkthrough (app registration, security groups, partner mapping, Docker IPv6 quirk) lives in [`SSO_SETUP_RUNBOOK.md`](SSO_SETUP_RUNBOOK.md).

## Required env vars

| Variable | Example | Notes |
|----------|---------|-------|
| `AZURE_AD_TENANT_ID` | `xxxx-xxxx-xxxx-xxxx` | Entra tenant id |
| `AZURE_AD_CLIENT_ID` | `xxxx-xxxx-xxxx-xxxx` | App registration client id |
| `AZURE_AD_CLIENT_SECRET` | `secret...` | App registration client secret — rotate before expiry |
| `AZURE_AD_REDIRECT_URI` | `https://<pilot-host>/api/v1/auth/azure/callback` | Must match the Entra app registration exactly |

Companion vars required at any non-localhost deployment (enforced by `config.ts` when `NODE_ENV=production`):

| Variable | Notes |
|----------|-------|
| `FRONTEND_URL` | Pilot URL, no `localhost`. Server FATALs at boot if `localhost`. |
| `CORS_ORIGIN` | Same. |
| `COOKIE_SECURE` | `true`. Server FATALs at boot if `false`. |
| `COOKIE_DOMAIN` | Set if using subdomains so cookie sticks across `/switch-partner`. |
