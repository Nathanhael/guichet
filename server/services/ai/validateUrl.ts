import { resolve4 } from 'dns/promises';

/**
 * Check if an IPv4 address is in a private/reserved range.
 */
function isPrivateIp(ip: string): boolean {
  const parts = ip.split('.').map(Number);
  if (parts.length !== 4) return false;
  const [a, b] = parts;
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 169 && b === 254)
  );
}

/**
 * Validates AI provider base URLs to prevent SSRF attacks.
 * Rejects private IP ranges, loopback, link-local, and metadata endpoints.
 */
export function validateAiBaseUrl(url: string | undefined, isDev: boolean): void {
  if (!url) return;

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`Invalid AI base URL: ${url}`);
  }

  if (!isDev && parsed.protocol !== 'https:') {
    throw new Error(`HTTPS required for AI base URL in production (got ${parsed.protocol})`);
  }

  const hostname = parsed.hostname.toLowerCase();

  if (hostname === 'localhost' || hostname === '::1') {
    throw new Error(`AI base URL must not point to a private or reserved address: ${hostname}`);
  }

  // Check if hostname is a literal IP
  if (isPrivateIp(hostname)) {
    throw new Error(`AI base URL must not point to a private or reserved address: ${hostname}`);
  }
}

/**
 * Resolve a hostname and verify it doesn't point to a private IP (DNS rebinding defense).
 * Call this at connection time, not just at config time, to catch dynamic DNS changes.
 * Skipped in dev mode (local AI providers use private IPs).
 */
export async function validateResolvedAiUrl(url: string | undefined, isDev: boolean): Promise<void> {
  if (!url || isDev) return;

  let hostname: string;
  try {
    hostname = new URL(url).hostname.toLowerCase();
  } catch {
    return; // validateAiBaseUrl already catches this
  }

  // Skip if hostname is already a literal IP (already checked by validateAiBaseUrl)
  if (/^\d+\.\d+\.\d+\.\d+$/.test(hostname)) return;

  try {
    const addresses = await resolve4(hostname);
    for (const ip of addresses) {
      if (isPrivateIp(ip)) {
        throw new Error(
          `AI base URL hostname "${hostname}" resolves to private IP ${ip} — possible DNS rebinding attack`
        );
      }
    }
  } catch (err) {
    // Re-throw our own errors, ignore DNS resolution failures (network issues shouldn't block)
    if (err instanceof Error && err.message.includes('DNS rebinding')) throw err;
  }
}
