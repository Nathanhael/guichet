import { describe, it, expect, vi, beforeEach } from 'vitest';

const TEST_KEY = 'a'.repeat(64); // 32 bytes in hex

// Mock the config module to provide the encryption secret
vi.mock('../config.js', () => ({
  default: { AI_KEY_ENCRYPTION_SECRET: TEST_KEY },
}));

describe('encryption service', () => {
  beforeEach(() => {
    // Reset module cache so cached key doesn't leak between tests
    vi.resetModules();
  });

  it('should encrypt and decrypt a string back to the original', async () => {
    const { encrypt, decrypt } = await import('./encryption.js');
    const plaintext = 'sk-abc123-my-secret-api-key';
    const ciphertext = encrypt(plaintext);

    expect(ciphertext).not.toEqual(plaintext);
    expect(ciphertext).toMatch(/^[A-Za-z0-9+/=]+$/); // base64

    const decrypted = decrypt(ciphertext);
    expect(decrypted).toEqual(plaintext);
  });

  it('should produce different ciphertexts for the same plaintext (random IV)', async () => {
    const { encrypt } = await import('./encryption.js');
    const plaintext = 'sk-abc123';
    const a = encrypt(plaintext);
    const b = encrypt(plaintext);
    expect(a).not.toEqual(b);
  });

  it('should throw on decrypt with corrupted ciphertext', async () => {
    const { decrypt } = await import('./encryption.js');
    expect(() => decrypt('not-valid-base64-ciphertext!!')).toThrow();
  });

  it('should throw on decrypt with truncated data', async () => {
    const { encrypt, decrypt } = await import('./encryption.js');
    const ciphertext = encrypt('test');
    // Truncate to break auth tag
    const truncated = Buffer.from(ciphertext, 'base64').subarray(0, 10);
    expect(() => decrypt(truncated.toString('base64'))).toThrow();
  });

  it('should handle empty string encryption', async () => {
    const { encrypt, decrypt } = await import('./encryption.js');
    const ciphertext = encrypt('');
    expect(decrypt(ciphertext)).toEqual('');
  });
});
