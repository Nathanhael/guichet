/**
 * Encryption Key Rotation Script
 *
 * Re-encrypts all encrypted fields in the database using a new encryption key.
 * Currently handles: partners.ai_config.encryptedApiKey
 *
 * Usage (from Docker):
 *   docker compose exec server npx tsx scripts/rotate_encryption_key.ts <old-key-hex> <new-key-hex>
 *
 * Keys are 64-character hex strings (256-bit). Generate with:
 *   openssl rand -hex 32
 *
 * The script:
 *   1. Decrypts each value with the OLD key
 *   2. Re-encrypts with the NEW key
 *   3. Updates the row in a transaction
 *   4. Verifies the new ciphertext decrypts correctly
 *
 * Safe to re-run: skips rows that already decrypt with the new key.
 */

import crypto from 'crypto';
import { db } from '../db.js';
import { partners } from '../db/schema.js';
import { isNotNull, sql } from 'drizzle-orm';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;
const TAG_LENGTH = 16;

function encryptWith(plaintext: string, key: Buffer): string {
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, encrypted, tag]).toString('base64');
}

function decryptWith(ciphertext: string, key: Buffer): string {
  const packed = Buffer.from(ciphertext, 'base64');
  if (packed.length < IV_LENGTH + TAG_LENGTH) {
    throw new Error('Ciphertext too short');
  }
  const iv = packed.subarray(0, IV_LENGTH);
  const tag = packed.subarray(packed.length - TAG_LENGTH);
  const encrypted = packed.subarray(IV_LENGTH, packed.length - TAG_LENGTH);
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8');
}

function parseKeyArg(hex: string, label: string): Buffer {
  if (!/^[0-9a-f]{64}$/i.test(hex)) {
    console.error(`ERROR: ${label} must be a 64-character hex string (got ${hex.length} chars)`);
    process.exit(1);
  }
  return Buffer.from(hex, 'hex');
}

async function main() {
  const [,, oldKeyHex, newKeyHex] = process.argv;

  if (!oldKeyHex || !newKeyHex) {
    console.error('Usage: npx tsx scripts/rotate_encryption_key.ts <old-key-hex> <new-key-hex>');
    console.error('Generate a new key with: openssl rand -hex 32');
    process.exit(1);
  }

  if (oldKeyHex === newKeyHex) {
    console.error('ERROR: Old and new keys are identical');
    process.exit(1);
  }

  const oldKey = parseKeyArg(oldKeyHex, 'Old key');
  const newKey = parseKeyArg(newKeyHex, 'New key');

  // Find all partners with AI config that may contain encrypted keys
  const rows = await db
    .select({ id: partners.id, name: partners.name, aiConfig: partners.aiConfig })
    .from(partners)
    .where(isNotNull(partners.aiConfig));

  let rotated = 0;
  let skipped = 0;
  let errors = 0;

  for (const row of rows) {
    const config = row.aiConfig as Record<string, unknown> | null;
    if (!config?.encryptedApiKey) {
      skipped++;
      continue;
    }

    const ciphertext = config.encryptedApiKey as string;

    // Check if it already decrypts with the new key (idempotent re-run)
    try {
      decryptWith(ciphertext, newKey);
      console.log(`  SKIP ${row.name} (${row.id}) — already using new key`);
      skipped++;
      continue;
    } catch {
      // Expected — needs rotation
    }

    // Decrypt with old key
    let plaintext: string;
    try {
      plaintext = decryptWith(ciphertext, oldKey);
    } catch (err) {
      console.error(`  FAIL ${row.name} (${row.id}) — cannot decrypt with old key: ${err instanceof Error ? err.message : err}`);
      errors++;
      continue;
    }

    // Re-encrypt with new key
    const newCiphertext = encryptWith(plaintext, newKey);

    // Verify round-trip
    const verified = decryptWith(newCiphertext, newKey);
    if (verified !== plaintext) {
      console.error(`  FAIL ${row.name} (${row.id}) — round-trip verification failed`);
      errors++;
      continue;
    }

    // Update in DB
    const updatedConfig = { ...config, encryptedApiKey: newCiphertext };
    await db.execute(
      sql`UPDATE partners SET ai_config = ${JSON.stringify(updatedConfig)}::jsonb WHERE id = ${row.id}`
    );

    console.log(`  OK   ${row.name} (${row.id}) — rotated`);
    rotated++;
  }

  console.log(`\nDone. Rotated: ${rotated}, Skipped: ${skipped}, Errors: ${errors}`);

  if (errors > 0) {
    console.error('\nWARNING: Some rows failed. Do NOT update FIELD_ENCRYPTION_SECRET until all rows are rotated.');
    process.exit(1);
  }

  if (rotated > 0) {
    console.log('\nNext steps:');
    console.log('  1. Update FIELD_ENCRYPTION_SECRET in your .env / secrets to the new key');
    console.log('  2. Restart the server');
    console.log('  3. Verify AI features still work for affected partners');
  }

  process.exit(0);
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
