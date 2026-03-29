# AI API Key Encryption Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Encrypt partner AI API keys at rest using AES-256-GCM so they are never stored as plaintext in PostgreSQL.

**Architecture:** A new `encryption.ts` service provides `encrypt()`/`decrypt()` using a master key from an env var. The platform router encrypts on write, the AI factory decrypts on read. A one-time migration script handles existing plaintext keys.

**Tech Stack:** Node.js `crypto` (AES-256-GCM), Zod config validation, Drizzle ORM

---

## File Map

| File | Action | Responsibility |
|------|--------|---------------|
| `server/services/encryption.ts` | Create | AES-256-GCM encrypt/decrypt |
| `server/services/__tests__/encryption.test.ts` | Create | Unit tests for encryption |
| `server/config.ts` | Modify | Add `AI_KEY_ENCRYPTION_SECRET` env var |
| `server/services/ai/factory.ts` | Modify | Decrypt `encryptedApiKey` on provider creation |
| `server/trpc/routers/platform.ts` | Modify | Encrypt `apiKey` on write, redact in audit log |
| `scripts/encrypt_existing_keys.ts` | Create | One-time migration for existing plaintext keys |

---

### Task 1: Create the encryption service

**Files:**
- Create: `server/services/encryption.ts`
- Create: `server/services/__tests__/encryption.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `server/services/__tests__/encryption.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';

// We test the actual crypto functions, not mocks.
describe('encryption service', () => {
  // Set the env var before importing
  const TEST_KEY = 'a'.repeat(64); // 32 bytes in hex

  beforeEach(() => {
    vi.stubEnv('AI_KEY_ENCRYPTION_SECRET', TEST_KEY);
  });

  it('should encrypt and decrypt a string back to the original', async () => {
    const { encrypt, decrypt } = await import('../encryption.js');
    const plaintext = 'sk-abc123-my-secret-api-key';
    const ciphertext = encrypt(plaintext);

    expect(ciphertext).not.toEqual(plaintext);
    expect(ciphertext).toMatch(/^[A-Za-z0-9+/=]+$/); // base64

    const decrypted = decrypt(ciphertext);
    expect(decrypted).toEqual(plaintext);
  });

  it('should produce different ciphertexts for the same plaintext (random IV)', async () => {
    const { encrypt } = await import('../encryption.js');
    const plaintext = 'sk-abc123';
    const a = encrypt(plaintext);
    const b = encrypt(plaintext);
    expect(a).not.toEqual(b);
  });

  it('should throw on decrypt with corrupted ciphertext', async () => {
    const { decrypt } = await import('../encryption.js');
    expect(() => decrypt('not-valid-base64-ciphertext!!')).toThrow();
  });

  it('should throw on decrypt with truncated data', async () => {
    const { encrypt, decrypt } = await import('../encryption.js');
    const ciphertext = encrypt('test');
    // Truncate to break auth tag
    const truncated = Buffer.from(ciphertext, 'base64').subarray(0, 10);
    expect(() => decrypt(truncated.toString('base64'))).toThrow();
  });

  it('should handle empty string encryption', async () => {
    const { encrypt, decrypt } = await import('../encryption.js');
    const ciphertext = encrypt('');
    expect(decrypt(ciphertext)).toEqual('');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `docker compose exec server npx vitest run services/__tests__/encryption.test.ts`
Expected: FAIL — module `../encryption.js` not found.

- [ ] **Step 3: Implement the encryption service**

Create `server/services/encryption.ts`:

```typescript
import crypto from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12; // 96-bit IV recommended for GCM
const TAG_LENGTH = 16; // 128-bit auth tag

/**
 * Get the encryption key from env var, validated as 32-byte hex.
 * Throws if not set or malformed.
 */
function getKey(): Buffer {
  const hex = process.env.AI_KEY_ENCRYPTION_SECRET;
  if (!hex || hex.length !== 64 || !/^[0-9a-f]+$/i.test(hex)) {
    throw new Error(
      'AI_KEY_ENCRYPTION_SECRET must be a 64-character hex string (32 bytes). ' +
      'Generate one with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"'
    );
  }
  return Buffer.from(hex, 'hex');
}

/**
 * Encrypt a plaintext string using AES-256-GCM.
 * Returns a base64 string containing: IV (12 bytes) + ciphertext + auth tag (16 bytes).
 */
export function encrypt(plaintext: string): string {
  const key = getKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

  const encrypted = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final(),
  ]);

  const tag = cipher.getAuthTag();

  // Pack as: IV + ciphertext + tag
  const packed = Buffer.concat([iv, encrypted, tag]);
  return packed.toString('base64');
}

/**
 * Decrypt a base64 ciphertext string produced by encrypt().
 * Throws on invalid input, corrupted data, or wrong key.
 */
export function decrypt(ciphertext: string): string {
  const key = getKey();
  const packed = Buffer.from(ciphertext, 'base64');

  if (packed.length < IV_LENGTH + TAG_LENGTH) {
    throw new Error('Ciphertext too short — corrupted or invalid data');
  }

  const iv = packed.subarray(0, IV_LENGTH);
  const tag = packed.subarray(packed.length - TAG_LENGTH);
  const encrypted = packed.subarray(IV_LENGTH, packed.length - TAG_LENGTH);

  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);

  const decrypted = Buffer.concat([
    decipher.update(encrypted),
    decipher.final(),
  ]);

  return decrypted.toString('utf8');
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `docker compose exec server npx vitest run services/__tests__/encryption.test.ts`
Expected: 5/5 PASS.

- [ ] **Step 5: Commit**

```bash
git add server/services/encryption.ts server/services/__tests__/encryption.test.ts
git commit -m "feat(security): add AES-256-GCM encryption service

New encryption.ts provides encrypt() and decrypt() using a master key
from AI_KEY_ENCRYPTION_SECRET env var. Random 12-byte IV per operation.

Ref: SEC-5"
```

---

### Task 2: Add AI_KEY_ENCRYPTION_SECRET to config

**Files:**
- Modify: `server/config.ts:1-55` (schema definition)
- Modify: `server/config.ts:59-100` (parse block)

- [ ] **Step 1: Add the env var to the Zod schema**

In `server/config.ts`, add after line 42 (`AI_API_KEY: z.string().optional(),`):

```typescript
    AI_KEY_ENCRYPTION_SECRET: z.string().length(64).regex(/^[0-9a-f]+$/i, 'Must be 64-character hex string').optional(),
```

- [ ] **Step 2: Add it to the parse block**

In `server/config.ts`, add after line 87 (`AI_API_KEY: process.env.AI_API_KEY,`):

```typescript
    AI_KEY_ENCRYPTION_SECRET: process.env.AI_KEY_ENCRYPTION_SECRET,
```

- [ ] **Step 3: Run server tests to verify no regressions**

Run: `docker compose exec server npm test`
Expected: All tests pass (env var is optional, so existing tests are unaffected).

- [ ] **Step 4: Commit**

```bash
git add server/config.ts
git commit -m "feat(config): add AI_KEY_ENCRYPTION_SECRET env var

Optional 64-character hex string for AES-256-GCM encryption of
partner AI API keys. Required when partners use encrypted keys.

Ref: SEC-5"
```

---

### Task 3: Encrypt API keys on write in platform router

**Files:**
- Modify: `server/trpc/routers/platform.ts:154-188`

- [ ] **Step 1: Add encryption import**

At the top of `server/trpc/routers/platform.ts`, add:

```typescript
import { encrypt } from '../../services/encryption.js';
```

- [ ] **Step 2: Encrypt apiKey before storing**

In `server/trpc/routers/platform.ts`, find the line (around 188):
```typescript
if (input.data.aiConfig !== undefined) updateData.aiConfig = input.data.aiConfig;
```

Replace with:
```typescript
      if (input.data.aiConfig !== undefined) {
        const configToStore = { ...input.data.aiConfig } as Record<string, unknown>;
        // Encrypt the API key before storing (SEC-5)
        if (configToStore.apiKey && typeof configToStore.apiKey === 'string') {
          try {
            configToStore.encryptedApiKey = encrypt(configToStore.apiKey);
            delete configToStore.apiKey; // Never store plaintext
          } catch {
            // AI_KEY_ENCRYPTION_SECRET not set — store as-is with warning
            logger.warn('[platform] AI_KEY_ENCRYPTION_SECRET not set — API key stored unencrypted');
          }
        }
        updateData.aiConfig = configToStore;
      }
```

- [ ] **Step 3: Redact API key in audit log**

Find the audit log insert in the same mutation (around line 195-210). Find where `metadata` includes the input data. If the metadata includes the raw `input.data`, redact:

Look for the pattern where audit log records the update. Add redaction of apiKey:

```typescript
      // Redact API key from audit metadata
      const auditData = { ...input.data };
      if (auditData.aiConfig?.apiKey) {
        auditData.aiConfig = {
          ...auditData.aiConfig,
          apiKey: `****${auditData.aiConfig.apiKey.slice(-4)}`,
        };
      }
```

Use `auditData` instead of `input.data` in the audit log insert.

- [ ] **Step 4: Run server typecheck**

Run: `docker compose exec server npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 5: Commit**

```bash
git add server/trpc/routers/platform.ts
git commit -m "feat(security): encrypt AI API keys on write in platform router

API keys are encrypted via AES-256-GCM before storing in DB.
Audit log entries redact keys to last 4 chars.

Ref: SEC-5"
```

---

### Task 4: Decrypt API keys on read in AI factory

**Files:**
- Modify: `server/services/ai/factory.ts:93-118`

- [ ] **Step 1: Add decrypt import**

At the top of `server/services/ai/factory.ts`, add:

```typescript
import { decrypt } from '../encryption.js';
```

- [ ] **Step 2: Add decryption logic in getProvider**

In `server/services/ai/factory.ts`, find the per-partner override section (around line 93). After `const aiConfig = (partner.aiConfig ?? {}) as Record<string, unknown>;` (line 93), add decryption:

```typescript
      // Decrypt API key if encrypted (SEC-5)
      let apiKey = aiConfig.apiKey as string | undefined;
      if (!apiKey && aiConfig.encryptedApiKey) {
        try {
          apiKey = decrypt(aiConfig.encryptedApiKey as string);
        } catch (err) {
          logger.error({ partnerId, err: err instanceof Error ? err.message : String(err) }, '[ai] Failed to decrypt API key — AI disabled for this partner');
          apiKey = undefined;
        }
      }
```

- [ ] **Step 3: Replace all `aiConfig.apiKey` references with the local `apiKey` variable**

In the same function, replace:
- Line 99: `hashKey(aiConfig.apiKey as string | undefined)` → `hashKey(apiKey)`
- Line 114: `apiKey: aiConfig.apiKey as string | undefined,` → `apiKey,`

The updated cacheKey call:
```typescript
      const key = cacheKey(
        partner.aiProvider,
        partnerId,
        partner.aiModel ?? undefined,
        aiConfig.baseUrl as string | undefined,
        hashKey(apiKey),
      );
```

The updated buildProvider call:
```typescript
        providerCache.set(
          key,
          buildProvider(partner.aiProvider, {
            baseUrl: aiConfig.baseUrl as string | undefined,
            apiKey,
            model: partner.aiModel ?? undefined,
            deployment: aiConfig.deployment as string | undefined,
          }),
        );
```

- [ ] **Step 4: Run server typecheck**

Run: `docker compose exec server npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 5: Commit**

```bash
git add server/services/ai/factory.ts
git commit -m "feat(security): decrypt AI API keys in factory on read

Supports both legacy plaintext apiKey and new encryptedApiKey fields.
Decryption failure disables AI for that partner (fail closed).

Ref: SEC-5"
```

---

### Task 5: Strip aiConfig from listPartners response

**Files:**
- Modify: `server/trpc/routers/platform.ts:74` (already strips — verify)

- [ ] **Step 1: Verify aiConfig is already stripped**

Read `server/trpc/routers/platform.ts` around line 74. It should contain:
```typescript
return allPartners.map(({ aiConfig, aiProvider, aiModel, ...safe }) => safe);
```

This already strips `aiConfig` from the list response. Verify and confirm — no code change needed if it's correct.

- [ ] **Step 2: Check the single-partner getPartner endpoint**

Search for any `getPartner` or similar endpoint that returns a single partner with aiConfig. If found, ensure it also strips the aiConfig field or at minimum doesn't return `encryptedApiKey`.

Run: `docker compose exec server grep -n 'aiConfig' server/trpc/routers/partner.ts`

If any endpoint returns raw aiConfig to the client, add the same stripping pattern.

- [ ] **Step 3: Commit (only if changes were needed)**

```bash
git add server/trpc/routers/platform.ts server/trpc/routers/partner.ts
git commit -m "fix(security): ensure encrypted API keys never leak to client

Verify aiConfig is stripped from all partner query responses.

Ref: SEC-5"
```

---

### Task 6: Create migration script for existing plaintext keys

**Files:**
- Create: `scripts/encrypt_existing_keys.ts`

- [ ] **Step 1: Create the migration script**

Create `scripts/encrypt_existing_keys.ts`:

```typescript
/**
 * One-time migration: Encrypt all existing plaintext AI API keys.
 *
 * Usage: docker compose exec server npx tsx scripts/encrypt_existing_keys.ts
 *
 * Requires AI_KEY_ENCRYPTION_SECRET env var to be set.
 * Idempotent: skips partners that already have encryptedApiKey.
 */

import { db } from '../server/db/postgres.js';
import { partners } from '../server/db/schema.js';
import { encrypt } from '../server/services/encryption.js';
import { isNotNull } from 'drizzle-orm';

async function main() {
  if (!process.env.AI_KEY_ENCRYPTION_SECRET) {
    console.error('ERROR: AI_KEY_ENCRYPTION_SECRET env var is required.');
    console.error('Generate one with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"');
    process.exit(1);
  }

  console.log('Scanning partners for plaintext AI API keys...');

  const allPartners = await db.select({
    id: partners.id,
    name: partners.name,
    aiConfig: partners.aiConfig,
  }).from(partners).where(isNotNull(partners.aiConfig));

  let encrypted = 0;
  let skipped = 0;
  let noKey = 0;

  for (const partner of allPartners) {
    const config = (partner.aiConfig ?? {}) as Record<string, unknown>;

    // Already encrypted — skip
    if (config.encryptedApiKey) {
      skipped++;
      continue;
    }

    // No API key — skip
    if (!config.apiKey || typeof config.apiKey !== 'string') {
      noKey++;
      continue;
    }

    // Encrypt and migrate
    const encryptedKey = encrypt(config.apiKey);
    const updatedConfig = { ...config, encryptedApiKey: encryptedKey };
    delete updatedConfig.apiKey;

    await db.update(partners)
      .set({ aiConfig: updatedConfig })
      .where(isNotNull(partners.id));

    // Narrow the update to this specific partner
    const { eq } = await import('drizzle-orm');
    await db.update(partners)
      .set({ aiConfig: updatedConfig })
      .where(eq(partners.id, partner.id));

    console.log(`  Encrypted API key for partner: ${partner.name} (${partner.id})`);
    encrypted++;
  }

  console.log(`\nDone. Encrypted: ${encrypted}, Already encrypted: ${skipped}, No key: ${noKey}`);
  process.exit(0);
}

main().catch(err => {
  console.error('Migration failed:', err);
  process.exit(1);
});
```

- [ ] **Step 2: Fix the double-update bug and clean up imports**

The script above has a bug (two update calls). Replace the migration loop body with:

```typescript
    // Encrypt and migrate
    const { eq } = await import('drizzle-orm');
    const encryptedKey = encrypt(config.apiKey);
    const updatedConfig = { ...config, encryptedApiKey: encryptedKey };
    delete updatedConfig.apiKey;

    await db.update(partners)
      .set({ aiConfig: updatedConfig })
      .where(eq(partners.id, partner.id));

    console.log(`  Encrypted API key for partner: ${partner.name} (${partner.id})`);
    encrypted++;
```

Move the `eq` import to the top with the other imports.

- [ ] **Step 3: Commit**

```bash
git add scripts/encrypt_existing_keys.ts
git commit -m "feat(security): add migration script for existing plaintext AI keys

Idempotent script encrypts all plaintext apiKey values in partners table.
Run: docker compose exec server npx tsx scripts/encrypt_existing_keys.ts

Ref: SEC-5"
```

---

### Task 7: Add env var to docker-compose files and document

**Files:**
- Modify: `docker-compose.prod.yml:30-47` (add env var)
- Modify: `docker-compose.yml` (add env var for dev)

- [ ] **Step 1: Add to production compose**

In `docker-compose.prod.yml`, in the server environment section, add after `AZURE_OPENAI_DEPLOYMENT`:

```yaml
      - AI_KEY_ENCRYPTION_SECRET=${AI_KEY_ENCRYPTION_SECRET:-}
```

- [ ] **Step 2: Add to dev compose**

In `docker-compose.yml`, in the server environment section, add after the AI-related env vars. Use a deterministic dev key with a comment:

```yaml
      # Dev-only encryption key — DO NOT use in production
      - AI_KEY_ENCRYPTION_SECRET=0000000000000000000000000000000000000000000000000000000000000000
```

- [ ] **Step 3: Commit**

```bash
git add docker-compose.prod.yml docker-compose.yml
git commit -m "feat(config): add AI_KEY_ENCRYPTION_SECRET to compose files

Production reads from .env, dev uses a deterministic key.

Ref: SEC-5"
```

---

## Self-Review

- [x] **Spec coverage:** encryption.ts (Task 1), config.ts (Task 2), platform router encrypt-on-write (Task 3), factory decrypt-on-read (Task 4), client-side leak prevention (Task 5), migration script (Task 6), compose/docs (Task 7). All spec requirements covered.
- [x] **Placeholder scan:** No TBDs, TODOs, or "implement later" found.
- [x] **Type consistency:** `encrypt(plaintext: string): string` and `decrypt(ciphertext: string): string` used consistently. Field names `apiKey` (plaintext) and `encryptedApiKey` (encrypted) used consistently across tasks 3, 4, 5, 6.
