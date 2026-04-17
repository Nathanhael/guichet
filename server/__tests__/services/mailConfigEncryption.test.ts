import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

/**
 * Source-level assertions for M10 (full-review 2026-04-17): SMTP provider
 * credentials and SendGrid/Resend API keys must be stored as AES-256-GCM
 * ciphertext in `system_settings.value` JSONB, never as plaintext. The
 * encryption primitive itself (`encrypt` / `decrypt`) is already covered by
 * `encryption.test.ts` — these assertions guard the three wiring sites that
 * actually use it: mail.ts read path, platform/system.ts write + client read
 * paths, and bootstrap.ts one-shot upgrade.
 *
 * Pattern matches drizzleJournal / ssoGuestB2b / inviteCleanup.
 */
describe('mail_config credential encryption (M10)', () => {
  const mailSrc = fs.readFileSync(
    path.resolve(__dirname, '../../services/mail.ts'), 'utf-8',
  );
  const sysSrc = fs.readFileSync(
    path.resolve(__dirname, '../../trpc/routers/platform/system.ts'), 'utf-8',
  );
  const bootSrc = fs.readFileSync(
    path.resolve(__dirname, '../../services/bootstrap.ts'), 'utf-8',
  );

  describe('mail.ts: decrypt on read', () => {
    it('imports the shared decrypt helper', () => {
      expect(mailSrc).toMatch(/import\s*\{\s*decrypt\s*\}\s*from\s*['"]\.\/encryption\.js['"]/);
    });

    it('declares a StoredMailConfig internal shape with encrypted* fields', () => {
      expect(mailSrc).toMatch(/encryptedSmtpPass\?:\s*string/);
      expect(mailSrc).toMatch(/encryptedApiKey\?:\s*string/);
    });

    it('prefers encryptedSmtpPass when present', () => {
      const block = mailSrc.match(/if\s*\(\s*encryptedSmtpPass\s*\)[\s\S]*?decrypt\(encryptedSmtpPass\)/);
      expect(block).toBeTruthy();
    });

    it('prefers encryptedApiKey when present', () => {
      const block = mailSrc.match(/if\s*\(\s*encryptedApiKey\s*\)[\s\S]*?decrypt\(encryptedApiKey\)/);
      expect(block).toBeTruthy();
    });

    it('fails closed on decrypt error — returns null, does not leak plaintext or continue', () => {
      const smtpDecryptBlock = mailSrc.match(
        /decrypt\(encryptedSmtpPass\)[\s\S]*?catch[\s\S]*?return\s+null/,
      );
      expect(smtpDecryptBlock).toBeTruthy();
    });

    it('retains backward-compat plaintext fallback with a warn log', () => {
      // Legacy rows (pre-M10) still carry a plaintext smtpPass. Readers must
      // continue to work until the bootstrap upgrade or next save rewrites them,
      // but must log so ops notices the unhealthy row.
      expect(mailSrc).toMatch(/legacySmtpPass/);
      expect(mailSrc).toMatch(/logger\.warn\([^)]*stored as plaintext/);
    });
  });

  describe('platform/system.ts: encrypt on write, strip plaintext', () => {
    it('imports encrypt from the shared encryption module', () => {
      expect(sysSrc).toMatch(/import\s*\{\s*encrypt\s*\}\s*from\s*['"][^'"]*encryption\.js['"]/);
    });

    it('encrypts a newly-supplied smtpPass before store', () => {
      expect(sysSrc).toMatch(/merged\.encryptedSmtpPass\s*=\s*encrypt\(inputSmtpPass\)/);
    });

    it('encrypts a newly-supplied apiKey before store', () => {
      expect(sysSrc).toMatch(/merged\.encryptedApiKey\s*=\s*encrypt\(inputApiKey\)/);
    });

    it('preserves existing ciphertext when the client omits the value', () => {
      expect(sysSrc).toMatch(/merged\.encryptedSmtpPass\s*=\s*existing\.encryptedSmtpPass/);
      expect(sysSrc).toMatch(/merged\.encryptedApiKey\s*=\s*existing\.encryptedApiKey/);
    });

    it('lazy-upgrades legacy plaintext to ciphertext on any write', () => {
      // Required so old rows can't linger forever if nobody saves a new value.
      expect(sysSrc).toMatch(/encrypt\(existing\.smtpPass\)/);
      expect(sysSrc).toMatch(/encrypt\(existing\.apiKey\)/);
    });

    it('belt-and-braces: deletes plaintext keys before persisting', () => {
      expect(sysSrc).toMatch(/delete\s*\(?\s*merged[\s\S]*?\.smtpPass/);
      expect(sysSrc).toMatch(/delete\s*\(?\s*merged[\s\S]*?\.apiKey/);
    });

    it('getMailConfig redacts both plaintext AND ciphertext fields', () => {
      const getBlock = sysSrc.match(/getMailConfig:\s*platformProcedure[\s\S]*?\}\),/);
      expect(getBlock).toBeTruthy();
      // Destructure pattern must strip all four names from the returned object.
      expect(getBlock![0]).toMatch(/smtpPass[\s\S]*apiKey[\s\S]*encryptedSmtpPass[\s\S]*encryptedApiKey/);
    });

    it('getMailConfig has* flags consider both ciphertext and legacy plaintext', () => {
      const getBlock = sysSrc.match(/getMailConfig:\s*platformProcedure[\s\S]*?\}\),/);
      expect(getBlock![0]).toMatch(/hasSmtpPass:\s*hasSecret\(encryptedSmtpPass\)\s*\|\|\s*hasSecret\(smtpPass\)/);
      expect(getBlock![0]).toMatch(/hasApiKey:\s*hasSecret\(encryptedApiKey\)\s*\|\|\s*hasSecret\(apiKey\)/);
    });
  });

  describe('bootstrap.ts: one-shot upgrade', () => {
    it('exports upgradeMailConfigEncryption', () => {
      expect(bootSrc).toMatch(/export\s+async\s+function\s+upgradeMailConfigEncryption/);
    });

    it('skips silently when no encryption key is configured (dev safety)', () => {
      expect(bootSrc).toMatch(
        /if\s*\(\s*!config\.FIELD_ENCRYPTION_SECRET\s*&&\s*!config\.AI_KEY_ENCRYPTION_SECRET\s*\)[\s\S]*?return/,
      );
    });

    it('no-ops when row has no legacy plaintext secrets', () => {
      expect(bootSrc).toMatch(/if\s*\(\s*!legacySmtpPass\s*&&\s*!legacyApiKey\s*\)\s*return/);
    });

    it('writes an audit row on successful upgrade', () => {
      expect(bootSrc).toMatch(/action:\s*['"]system\.mail_config_encrypted_upgrade['"]/);
    });

    it('drops plaintext keys after upgrade', () => {
      expect(bootSrc).toMatch(/delete\s+upgraded\.smtpPass/);
      expect(bootSrc).toMatch(/delete\s+upgraded\.apiKey/);
    });

    it('is non-fatal — wraps the whole body in try/catch', () => {
      const fn = bootSrc.match(/export\s+async\s+function\s+upgradeMailConfigEncryption[\s\S]*?^}/m);
      expect(fn).toBeTruthy();
      expect(fn![0]).toMatch(/try\s*\{[\s\S]*?\}\s*catch[\s\S]*?logger\.error/);
    });

    it('is invoked from server/index.ts after bootstrapPlatformOperator', () => {
      const indexSrc = fs.readFileSync(
        path.resolve(__dirname, '../../index.ts'), 'utf-8',
      );
      expect(indexSrc).toMatch(/upgradeMailConfigEncryption/);
      const bootstrapIdx = indexSrc.search(/bootstrapPlatformOperator\(\)/);
      const upgradeIdx = indexSrc.search(/upgradeMailConfigEncryption\(\)/);
      expect(bootstrapIdx).toBeGreaterThan(-1);
      expect(upgradeIdx).toBeGreaterThan(bootstrapIdx);
    });
  });
});
