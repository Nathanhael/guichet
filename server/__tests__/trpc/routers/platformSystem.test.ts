import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const source = readFileSync(
  join(__dirname, '../../../trpc/routers/platform/system.ts'),
  'utf-8'
);

/**
 * Thin guard on the platform/system router's mail_config surface. The deeper
 * encryption contract (encrypt-on-write, decrypt-on-read, legacy plaintext
 * fallback, bootstrap upgrade) lives in
 * `__tests__/services/mailConfigEncryption.test.ts`. This file only asserts
 * the router-shape invariants that platform operators depend on: the merged
 * object is what gets persisted, the client never sees the secret, and the
 * `has*` flags reflect either form.
 */
describe('platform system — mail_config router surface', () => {
  it('getMailConfig strips secrets in BOTH forms from the response', () => {
    // Ciphertext AND legacy plaintext must all be destructured away before
    // returning — never leak a secret to the client, encrypted or otherwise.
    expect(source).toMatch(
      /const\s*\{\s*smtpPass,\s*apiKey,\s*encryptedSmtpPass,\s*encryptedApiKey,\s*\.\.\.safe\s*\}\s*=\s*raw/,
    );
  });

  it('getMailConfig hasSmtpPass checks ciphertext OR legacy plaintext', () => {
    expect(source).toMatch(
      /hasSmtpPass:\s*hasSecret\(encryptedSmtpPass\)\s*\|\|\s*hasSecret\(smtpPass\)/,
    );
  });

  it('getMailConfig hasApiKey checks ciphertext OR legacy plaintext', () => {
    expect(source).toMatch(
      /hasApiKey:\s*hasSecret\(encryptedApiKey\)\s*\|\|\s*hasSecret\(apiKey\)/,
    );
  });

  it('updateMailConfig preserves existing encrypted smtpPass when client omits it', () => {
    expect(source).toMatch(/merged\.encryptedSmtpPass\s*=\s*existing\.encryptedSmtpPass/);
  });

  it('updateMailConfig preserves existing encrypted apiKey when client omits it', () => {
    expect(source).toMatch(/merged\.encryptedApiKey\s*=\s*existing\.encryptedApiKey/);
  });

  it('updateMailConfig writes merged value (not raw input) to DB', () => {
    // The upsert must use `merged` not `input`
    expect(source).toMatch(/value: merged/);
  });
});
