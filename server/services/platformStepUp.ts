import crypto from 'crypto';
import config from '../config.js';

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const TOTP_DIGITS = 6;
const TOTP_PERIOD_SECONDS = 30;
const TOTP_WINDOW = 1;
const TOTP_ISSUER = 'Tessera';

function base32Encode(buffer: Buffer): string {
  let bits = 0;
  let value = 0;
  let output = '';

  for (const byte of buffer) {
    value = (value << 8) | byte;
    bits += 8;

    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }

  if (bits > 0) {
    output += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  }

  return output;
}

function base32Decode(input: string): Buffer {
  const normalized = input.toUpperCase().replace(/[^A-Z2-7]/g, '');
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];

  for (const char of normalized) {
    const index = BASE32_ALPHABET.indexOf(char);
    if (index === -1) {
      throw new Error('Invalid base32 secret');
    }

    value = (value << 5) | index;
    bits += 5;

    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }

  return Buffer.from(bytes);
}

function formatSecret(secret: string): string {
  return secret.match(/.{1,4}/g)?.join(' ') || secret;
}

function hotp(secret: string, counter: number): string {
  const key = base32Decode(secret);
  const counterBuffer = Buffer.alloc(8);
  counterBuffer.writeUInt32BE(Math.floor(counter / 0x100000000), 0);
  counterBuffer.writeUInt32BE(counter >>> 0, 4);

  const hmac = crypto.createHmac('sha1', key).update(counterBuffer).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const code =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);

  return String(code % 10 ** TOTP_DIGITS).padStart(TOTP_DIGITS, '0');
}

export function generateTotpSecret(): { secret: string; manualEntryKey: string } {
  const secret = base32Encode(crypto.randomBytes(20));
  return {
    secret,
    manualEntryKey: formatSecret(secret),
  };
}

export function buildTotpUri(email: string, secret: string): string {
  const label = encodeURIComponent(`${TOTP_ISSUER}:${email}`);
  const issuer = encodeURIComponent(TOTP_ISSUER);
  return `otpauth://totp/${label}?secret=${secret}&issuer=${issuer}&algorithm=SHA1&digits=${TOTP_DIGITS}&period=${TOTP_PERIOD_SECONDS}`;
}

export function verifyTotpToken(secret: string, token: string, now = Date.now()): boolean {
  const normalizedToken = token.replace(/\s+/g, '');
  if (!/^\d{6}$/.test(normalizedToken)) {
    return false;
  }

  const currentCounter = Math.floor(now / 1000 / TOTP_PERIOD_SECONDS);
  for (let offset = -TOTP_WINDOW; offset <= TOTP_WINDOW; offset += 1) {
    if (hotp(secret, currentCounter + offset) === normalizedToken) {
      return true;
    }
  }

  return false;
}

export function getPlatformStepUpWindowSeconds(): number {
  return config.PLATFORM_STEP_UP_WINDOW_MINUTES * 60;
}

export function isPlatformStepUpSatisfied(platformStepUpAt?: number | null, now = Math.floor(Date.now() / 1000)): boolean {
  if (!platformStepUpAt) {
    return false;
  }

  return now - platformStepUpAt < getPlatformStepUpWindowSeconds();
}

export function getPlatformStepUpExpiry(platformStepUpAt?: number | null): string | null {
  if (!platformStepUpAt) {
    return null;
  }

  return new Date((platformStepUpAt + getPlatformStepUpWindowSeconds()) * 1000).toISOString();
}

export function getCurrentUnixTime(): number {
  return Math.floor(Date.now() / 1000);
}
