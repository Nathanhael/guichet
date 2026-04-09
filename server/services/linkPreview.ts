// server/services/linkPreview.ts — Server-side OG unfurling for link previews
import { resolve4, resolve6 } from 'dns/promises';
import { isIP } from 'net';
import logger from '../utils/logger.js';
import { getRedisClients } from '../utils/redis.js';

export interface LinkPreview {
  url: string;
  title?: string;
  description?: string;
  image?: string;
  siteName?: string;
}

const URL_REGEX = /https?:\/\/[^\s<>"')\]]+/gi;
const MAX_URLS = 3;
const FETCH_TIMEOUT_MS = 2000;
const MAX_HTML_BYTES = 50 * 1024; // 50 KB

const CACHE_PREFIX = 'og:';
const CACHE_TTL_SECONDS = 86400; // 24 hours

async function getCachedPreview(url: string): Promise<LinkPreview | null> {
  try {
    const { pubClient } = getRedisClients();
    if (!pubClient) return null;
    const cached = await pubClient.get(`${CACHE_PREFIX}${url}`);
    if (cached) return JSON.parse(cached) as LinkPreview;
    return null;
  } catch {
    return null; // cache miss on error
  }
}

async function setCachedPreview(url: string, preview: LinkPreview): Promise<void> {
  try {
    const { pubClient } = getRedisClients();
    if (!pubClient) return;
    await pubClient.set(`${CACHE_PREFIX}${url}`, JSON.stringify(preview), { EX: CACHE_TTL_SECONDS });
  } catch {
    // fire-and-forget, cache write failure is not critical
  }
}

/**
 * Normalize an IP address to a canonical IPv4 form for SSRF checking.
 * Handles IPv6-mapped IPv4 (::ffff:127.0.0.1), IPv6-mapped decimal,
 * and plain IPv4/IPv6 addresses.
 */
function normalizeIp(ip: string): string {
  // Strip IPv6-mapped IPv4 prefix: ::ffff:10.0.0.1 → 10.0.0.1
  const mapped = ip.match(/^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/i);
  if (mapped) return mapped[1];
  return ip;
}

/**
 * Check if a (normalized) IP address falls in a private/reserved range.
 */
function isPrivateIp(raw: string): boolean {
  const ip = normalizeIp(raw);

  // IPv4 private/reserved ranges
  if (/^127\./.test(ip)) return true;           // loopback
  if (/^10\./.test(ip)) return true;            // RFC1918
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(ip)) return true; // RFC1918
  if (/^192\.168\./.test(ip)) return true;      // RFC1918
  if (/^169\.254\./.test(ip)) return true;      // link-local
  if (/^0\./.test(ip)) return true;             // "this" network

  // IPv6 private/reserved ranges
  if (/^::1$/i.test(ip)) return true;           // loopback
  if (/^fe80:/i.test(ip)) return true;          // link-local
  if (/^fc00:/i.test(ip)) return true;          // unique local
  if (/^fd[0-9a-f]{2}:/i.test(ip)) return true; // unique local

  return false;
}

/**
 * Extract up to MAX_URLS HTTP/HTTPS URLs from text.
 */
export function extractUrls(text: string): string[] {
  const matches = text.match(URL_REGEX);
  if (!matches) return [];
  const unique = [...new Set(matches)];
  return unique.slice(0, MAX_URLS);
}

/**
 * SSRF protection: reject private IPs, localhost, and non-HTTP protocols.
 * Resolves both A (IPv4) and AAAA (IPv6) DNS records to catch dual-stack hosts.
 * Normalizes IPv6-mapped IPv4 addresses to prevent bypass via ::ffff: prefix.
 */
export async function isSafeUrl(url: string): Promise<boolean> {
  try {
    const parsed = new URL(url);

    // Only allow http/https
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;

    const hostname = parsed.hostname.toLowerCase();

    // Reject localhost variants
    if (hostname === 'localhost' || hostname === '::1' || hostname === '[::1]') return false;

    // If hostname is an IP literal, check directly
    if (isIP(hostname)) {
      if (isPrivateIp(hostname)) return false;
      return true;
    }

    // DNS resolution: resolve both A (IPv4) and AAAA (IPv6) records
    const allAddresses: string[] = [];
    try {
      const v4 = await resolve4(hostname);
      allAddresses.push(...v4);
    } catch { /* no A records — ok */ }

    try {
      const v6 = await resolve6(hostname);
      allAddresses.push(...v6);
    } catch { /* no AAAA records — ok */ }

    // If DNS resolves to nothing, reject (unresolvable hostname)
    if (allAddresses.length === 0) return false;

    // Check ALL resolved addresses — reject if ANY is private
    for (const addr of allAddresses) {
      if (isPrivateIp(addr)) return false;
    }

    return true;
  } catch {
    return false;
  }
}

/**
 * Parse Open Graph tags from partial HTML using regex.
 * Falls back to <title> tag if og:title is missing.
 */
export function parseOgTags(html: string): Omit<LinkPreview, 'url'> {
  const getMetaContent = (property: string): string | undefined => {
    // Match both property="" and name="" attributes
    const regex = new RegExp(
      `<meta[^>]*(?:property|name)=["']${property}["'][^>]*content=["']([^"']*?)["']|<meta[^>]*content=["']([^"']*?)["'][^>]*(?:property|name)=["']${property}["']`,
      'i'
    );
    const match = html.match(regex);
    return match ? (match[1] || match[2] || undefined) : undefined;
  };

  let title = getMetaContent('og:title');
  const description = getMetaContent('og:description');
  const image = getMetaContent('og:image');
  const siteName = getMetaContent('og:site_name');

  // Fallback to <title> tag
  if (!title) {
    const titleMatch = html.match(/<title[^>]*>([^<]*)<\/title>/i);
    if (titleMatch) title = titleMatch[1]?.trim();
  }

  return {
    title: title ? title.slice(0, 120) : undefined,
    description: description ? description.slice(0, 200) : undefined,
    image: (image && image.startsWith('https://')) ? image : undefined,
    siteName: siteName || undefined,
  };
}

/**
 * Fetch Open Graph data from a URL.
 * - 2s timeout
 * - Reads only first 50KB
 * - Returns null on any failure
 */
export async function fetchOgData(url: string): Promise<LinkPreview | null> {
  try {
    // Check Redis cache first
    const cached = await getCachedPreview(url);
    if (cached) return cached;

    const safe = await isSafeUrl(url);
    if (!safe) return null;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

    try {
      const response = await fetch(url, {
        signal: controller.signal,
        headers: {
          'Accept': 'text/html',
          'User-Agent': 'TesseraBot/1.0 (+link-preview)',
        },
        redirect: 'error', // SSRF: prevent redirects to internal IPs (mirrors webhookDispatch.ts)
      });

      clearTimeout(timeout);

      if (!response.ok || !response.body) return null;

      const contentType = response.headers.get('content-type') || '';
      if (!contentType.includes('text/html') && !contentType.includes('text/xhtml')) return null;

      // Read only first MAX_HTML_BYTES
      const reader = response.body.getReader();
      const chunks: Uint8Array[] = [];
      let totalBytes = 0;

      while (totalBytes < MAX_HTML_BYTES) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        totalBytes += value.length;
      }

      // Cancel the rest
      reader.cancel().catch(() => {});

      const decoder = new TextDecoder('utf-8', { fatal: false });
      const html = decoder.decode(Buffer.concat(chunks).subarray(0, MAX_HTML_BYTES));

      const tags = parseOgTags(html);
      if (!tags.title && !tags.description) return null;

      const result: LinkPreview = { url, ...tags };

      // Cache the result for future requests
      await setCachedPreview(url, result);

      return result;
    } catch {
      clearTimeout(timeout);
      return null;
    }
  } catch {
    return null;
  }
}

/**
 * Extract URLs from text, fetch OG data in parallel, return successful previews.
 */
export async function unfurlLinks(text: string): Promise<LinkPreview[]> {
  const urls = extractUrls(text);
  if (urls.length === 0) return [];

  const results = await Promise.allSettled(urls.map(fetchOgData));
  const previews: LinkPreview[] = [];

  for (const result of results) {
    if (result.status === 'fulfilled' && result.value) {
      previews.push(result.value);
    }
  }

  logger.debug({ count: previews.length, urls: urls.length }, '[linkPreview] unfurled');
  return previews;
}
