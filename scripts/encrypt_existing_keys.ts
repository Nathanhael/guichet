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
import { eq, isNotNull } from 'drizzle-orm';

async function main() {
  if (!process.env.AI_KEY_ENCRYPTION_SECRET) {
    console.error('ERROR: AI_KEY_ENCRYPTION_SECRET env var is required.');
    console.error('Generate one with: openssl rand -hex 32');
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
