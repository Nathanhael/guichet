import crypto from 'crypto';
import { describe, expect, it } from 'vitest';
import {
  buildTotpUri,
  generateTotpSecret,
  getPlatformStepUpExpiry,
  isPlatformStepUpSatisfied,
  verifyTotpToken,
} from './platformStepUp.js';

function generateCodeForTest(secret: string, timestampMs: number): string {
  const key = secret.toUpperCase().replace(/[^A-Z2-7]/g, '');
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];

  for (const char of key) {
    value = (value << 5) | alphabet.indexOf(char);
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }

  const counter = Math.floor(timestampMs / 1000 / 30);
  const counterBuffer = Buffer.alloc(8);
  counterBuffer.writeUInt32BE(Math.floor(counter / 0x100000000), 0);
  counterBuffer.writeUInt32BE(counter >>> 0, 4);
  const hmac = crypto.createHmac('sha1', Buffer.from(bytes)).update(counterBuffer).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const code =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);
  return String(code % 1000000).padStart(6, '0');
}

describe('platform step-up', () => {
  it('generates a manual key and otpauth url', () => {
    const { secret, manualEntryKey } = generateTotpSecret();
    const uri = buildTotpUri('admin@example.com', secret);

    expect(secret).toMatch(/^[A-Z2-7]+$/);
    expect(manualEntryKey.replace(/\s+/g, '')).toBe(secret);
    expect(uri).toContain('otpauth://totp/');
    expect(uri).toContain('admin%40example.com');
  });

  it('verifies valid totp tokens', async () => {
    const timestampMs = 1_710_000_000_000;
    const { secret } = generateTotpSecret();
    const code = await generateCodeForTest(secret, timestampMs);

    expect(verifyTotpToken(secret, code, timestampMs)).toBe(true);
    expect(verifyTotpToken(secret, '000000', timestampMs)).toBe(false);
  });

  it('treats recent step-up as valid and returns an expiry', () => {
    const nowSeconds = Math.floor(Date.now() / 1000);
    const stepUpAt = nowSeconds - 30;

    expect(isPlatformStepUpSatisfied(stepUpAt, nowSeconds)).toBe(true);
    expect(getPlatformStepUpExpiry(stepUpAt)).toMatch(/Z$/);
    expect(isPlatformStepUpSatisfied(undefined, nowSeconds)).toBe(false);
  });
});
