import crypto from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12; // 96-bit IV recommended for GCM
const TAG_LENGTH = 16; // 128-bit auth tag

/**
 * Get the encryption key from env var, validated as 32-byte hex.
 * Cached after first call — env var does not change at runtime.
 * Throws if not set or malformed.
 */
let _cachedKey: Buffer | null = null;

function getKey(): Buffer {
  if (_cachedKey) return _cachedKey;
  const hex = process.env.AI_KEY_ENCRYPTION_SECRET;
  if (!hex || hex.length !== 64 || !/^[0-9a-f]+$/i.test(hex)) {
    throw new Error(
      'AI_KEY_ENCRYPTION_SECRET must be a 64-character hex string (32 bytes). ' +
      'Generate one with: openssl rand -hex 32'
    );
  }
  _cachedKey = Buffer.from(hex, 'hex');
  return _cachedKey;
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
