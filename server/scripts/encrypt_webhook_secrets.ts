/**
 * Webhook Secret Encryption Migration Script
 *
 * One-time migration to encrypt existing plaintext webhook secrets at rest.
 * Uses the FIELD_ENCRYPTION_SECRET / AI_KEY_ENCRYPTION_SECRET from config.
 *
 * Usage (from Docker):
 *   docker compose exec server npx tsx scripts/encrypt_webhook_secrets.ts
 *
 * The script:
 *   1. Reads all webhook rows
 *   2. Detects whether each secret is already encrypted (base64 with valid GCM structure)
 *   3. Encrypts plaintext secrets using the configured encryption key
 *   4. Verifies the round-trip (decrypt must match original)
 *   5. Updates the row
 *
 * Safe to re-run: skips rows that are already encrypted.
 */

import { db } from '../db.js';
import { webhooks } from '../db/schema.js';
import { encrypt, decrypt } from '../services/encryption.js';
import { eq } from 'drizzle-orm';

function isAlreadyEncrypted(secret: string): boolean {
  try {
    // Try to decrypt — if it succeeds, it's already encrypted
    decrypt(secret);
    return true;
  } catch {
    return false;
  }
}

async function main() {
  console.log('Webhook Secret Encryption Migration');
  console.log('====================================\n');

  const rows = await db.select({ id: webhooks.id, secret: webhooks.secret }).from(webhooks);

  if (rows.length === 0) {
    console.log('No webhooks found. Nothing to do.');
    process.exit(0);
  }

  console.log(`Found ${rows.length} webhook(s). Checking encryption status...\n`);

  let encrypted = 0;
  let skipped = 0;
  let errors = 0;

  for (const row of rows) {
    // Check if already encrypted
    if (isAlreadyEncrypted(row.secret)) {
      console.log(`  SKIP ${row.id} — already encrypted`);
      skipped++;
      continue;
    }

    // Encrypt the plaintext secret
    try {
      const ciphertext = encrypt(row.secret);

      // Verify round-trip
      const verified = decrypt(ciphertext);
      if (verified !== row.secret) {
        console.error(`  FAIL ${row.id} — round-trip verification failed`);
        errors++;
        continue;
      }

      // Update in DB
      await db.update(webhooks).set({ secret: ciphertext }).where(eq(webhooks.id, row.id));

      console.log(`  OK   ${row.id} — encrypted`);
      encrypted++;
    } catch (err) {
      console.error(`  FAIL ${row.id} — ${err instanceof Error ? err.message : err}`);
      errors++;
    }
  }

  console.log(`\nDone. Encrypted: ${encrypted}, Skipped: ${skipped}, Errors: ${errors}`);

  if (errors > 0) {
    console.error('\nWARNING: Some rows failed. Check the errors above.');
    process.exit(1);
  }

  process.exit(0);
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
