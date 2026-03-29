# Deferred Fixes: AI Key Encryption & Production TLS

**Date:** 2026-03-30
**Status:** Approved
**Source:** ARCHITECTURE_REVIEW.md — SEC-5 (AI API key encryption), INFRA-1 (production TLS)

---

## SEC-5: AI API Key Encryption at Rest

### Problem

Partner-specific AI API keys are stored as plaintext in the `partners.aiConfig` JSONB column. Any query reading the full partner row (admin endpoints, audit logs) exposes the key.

### Design

**Encryption scheme:** AES-256-GCM via Node's built-in `crypto` module.
- 12-byte random IV per encryption operation
- 16-byte auth tag for tamper detection
- Stored as: `base64(IV + ciphertext + authTag)` — a single opaque string
- Field rename: `aiConfig.apiKey` becomes `aiConfig.encryptedApiKey` to make the encryption boundary explicit at the type level

**Master key:** `AI_KEY_ENCRYPTION_SECRET` environment variable.
- 32-byte hex string (64 hex characters)
- Added to `server/config.ts` Zod schema as `z.string().length(64).regex(/^[0-9a-f]+$/i).optional()`
- Required when any partner has `aiEnabled: true` in production; optional in dev (falls back to a deterministic dev key with a console warning)
- No key versioning or rotation automation — if compromised, operator sets new key and runs a one-time re-encryption migration script

**New file:** `server/services/encryption.ts`
- `encrypt(plaintext: string): string` — returns base64-encoded IV+ciphertext+tag
- `decrypt(ciphertext: string): string` — parses base64, extracts IV/tag, decrypts
- Throws on invalid input, corrupted data, or wrong key
- Single responsibility, no dependencies beyond `crypto` and `config`

**Integration points:**

| File | Change |
|------|--------|
| `server/services/encryption.ts` | New — encrypt/decrypt functions |
| `server/services/ai/factory.ts` | Decrypt `encryptedApiKey` when building provider instances. Cache key uses hash of encrypted value (not plaintext). |
| `server/services/ai/config.ts` | Update `PartnerAiConfig` type: `apiKey` → `encryptedApiKey` |
| `server/trpc/routers/platform.ts` | Encrypt `apiKey` on write in `updatePartner`. Input still accepts plaintext `apiKey`; encryption happens server-side. |
| `server/trpc/routers/platform.ts` | Audit log: redact API key to last 4 chars (`****abcd`) instead of storing full key |
| `server/trpc/routers/ai.ts` | Any read endpoints that return aiConfig must NOT return the encrypted key to the client. Return `hasApiKey: boolean` instead. |
| `server/config.ts` | Add `AI_KEY_ENCRYPTION_SECRET` to Zod schema |
| `scripts/encrypt_existing_keys.ts` | New — one-time migration script to encrypt all existing plaintext keys |

**Migration path:**
1. Set `AI_KEY_ENCRYPTION_SECRET` env var
2. Run `docker compose exec server npx tsx scripts/encrypt_existing_keys.ts`
3. Script reads all partners with `aiConfig.apiKey`, encrypts each, writes back as `aiConfig.encryptedApiKey`, removes plaintext `apiKey`
4. Script is idempotent — skips partners that already have `encryptedApiKey`

**Error handling:**
- If `AI_KEY_ENCRYPTION_SECRET` is not set and a partner's AI config has an encrypted key, the factory logs an error and disables AI for that partner (fail closed)
- Decryption failure (wrong key, corrupted data) logs error with partner ID, returns `null` from factory (AI disabled for that partner, not a server crash)

---

## INFRA-1: Production TLS via Caddy

### Problem

`docker-compose.prod.yml` exposes the application on port 80 with no HTTPS. An operator who deploys with the stock compose file serves everything over plaintext.

### Design

**Reverse proxy:** Caddy 2 — automatic HTTPS via Let's Encrypt/ZeroSSL, HTTP→HTTPS redirect, HSTS, OCSP stapling, all with zero manual cert management.

**New file:** `Caddyfile` (project root)

```
{$DOMAIN:localhost} {
    # API and WebSocket traffic → server container
    handle /api/* {
        reverse_proxy server:3001
    }
    handle /socket.io/* {
        reverse_proxy server:3001
    }
    # Upload files → server container
    handle /uploads/* {
        reverse_proxy server:3001
    }
    # Everything else → client container (SPA)
    handle {
        reverse_proxy client:80
    }
}
```

**docker-compose.prod.yml changes:**

| Change | Detail |
|--------|--------|
| Add `caddy` service | Image: `caddy:2-alpine`. Ports: `80:80`, `443:443`, `443:443/udp` (HTTP/3). Volumes: `caddy_data` (certs), `caddy_config`. Environment: `DOMAIN` (required). |
| Remove client port exposure | Client no longer needs `ports: "80:80"` — Caddy proxies to it on the internal Docker network. |
| Add `caddy_data` and `caddy_config` volumes | Persistent cert storage across container restarts. |
| Add health check to caddy | `caddy healthcheck --url http://localhost:80` |

**Environment variables:**
- `DOMAIN` — the public hostname (e.g., `chat.example.com`). Caddy uses this for Let's Encrypt cert issuance.
- When `DOMAIN=localhost`, Caddy serves with a self-signed cert (useful for local testing of the prod compose).

**Config.ts update:**
- Add production warning when `COOKIE_DOMAIN` is not set and `NODE_ENV=production` — operators need this for proper cookie scoping with a real domain.

**Documentation:**
- Add a "Production Deployment" section to README.md with:
  1. Set required env vars: `DOMAIN`, `CORS_ORIGIN`, `FRONTEND_URL`, `COOKIE_DOMAIN`, `AI_KEY_ENCRYPTION_SECRET`
  2. `docker compose -f docker-compose.prod.yml up -d`
  3. Caddy auto-provisions TLS cert (requires ports 80/443 reachable from internet)
  4. Verify: `curl -I https://$DOMAIN/api/v1/health`

---

## Out of Scope

- Key rotation automation (YAGNI — manual migration script suffices)
- Client-side encryption (keys never reach the browser)
- mTLS between containers (Docker network is trusted)
- Wildcard certs / multi-domain (single domain per deployment)
- Custom CA support (Caddy handles this if needed via config)
