/**
 * SSRF defense for user-supplied URLs.
 *
 * Used for any URL stored on a record that the server may later fetch
 * (e.g. AI provider baseUrl). The check rejects URLs that resolve to
 * private, reserved, loopback, or link-local IPs, plus non-HTTPS schemes
 * outside development. Returns the resolved IP so callers can fetch
 * against it directly to defeat DNS rebinding TOCTOU attacks.
 *
 * `linkPreview.ts` keeps its own narrower `isSafeUrl` for the OG-fetch
 * path (boolean return, different policy on cached hostnames).
 */

import dns from 'dns';

export function isPrivateOrReservedAddress(address: string): boolean {
  if (address === '::1') return true;

  const parts = address.split('.').map(Number);
  if (parts.length !== 4) return false;

  if (parts[0] === 127) return true; // loopback
  if (parts[0] === 10) return true; // RFC-1918 10/8
  if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true; // 172.16/12
  if (parts[0] === 192 && parts[1] === 168) return true; // 192.168/16
  if (parts[0] === 169 && parts[1] === 254) return true; // link-local + IMDS
  if (parts.every((p) => p === 0)) return true; // 0.0.0.0

  return false;
}

export interface ValidatedUrl {
  resolvedIp: string;
  originalHostname: string;
}

export async function validateExternalUrl(url: string): Promise<ValidatedUrl> {
  const parsed = new URL(url);

  if (parsed.protocol !== 'https:') {
    if (parsed.protocol !== 'http:' || process.env.NODE_ENV !== 'development') {
      throw new Error('URL must use HTTPS');
    }
  }

  const { address } = await dns.promises.lookup(parsed.hostname);
  if (isPrivateOrReservedAddress(address)) {
    throw new Error('URL must not resolve to a private or reserved IP address');
  }

  return { resolvedIp: address, originalHostname: parsed.hostname };
}
