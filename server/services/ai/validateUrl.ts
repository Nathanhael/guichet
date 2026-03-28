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

  const ipv4Match = hostname.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (ipv4Match) {
    const [, a, b] = ipv4Match.map(Number);
    const isPrivate =
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 169 && b === 254);

    if (isPrivate) {
      throw new Error(`AI base URL must not point to a private or reserved address: ${hostname}`);
    }
  }
}
