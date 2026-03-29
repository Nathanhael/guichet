/**
 * Security utilities for validation and sanitization.
 */

/**
 * Validates if a media URL is safe to render and store.
 * H-5: Only accepts relative /uploads/ paths — all external URLs are rejected
 * to prevent tracking pixels that leak support staff IPs.
 */
export function isValidMediaUrl(url: string | undefined | null): boolean {
  if (!url) return true; // Empty is fine

  // Reject all absolute URLs (http://, https://, protocol-relative //, etc.)
  if (url.startsWith('http://') || url.startsWith('https://') || url.startsWith('//')) {
    return false;
  }

  // Only allow relative /uploads/ paths
  if (!url.startsWith('/uploads/')) return false;

  // Decode URL-encoded sequences before checking for path traversal
  let decoded: string;
  try {
    decoded = decodeURIComponent(url);
  } catch {
    return false; // Malformed encoding — reject
  }
  if (decoded.includes('..')) return false;

  // Check for allowed image extensions
  const ext = url.split('.').pop()?.toLowerCase();
  // SVG excluded — can contain embedded <script> tags (XSS vector)
  const safeExts = ['png', 'jpg', 'jpeg', 'webp', 'gif'];
  if (!ext || !safeExts.includes(ext)) return false;

  return true;
}

/**
 * Escapes SQL LIKE/ILIKE wildcard characters in user input.
 * Without this, attackers can inject `%` or `_` to craft expensive
 * wildcard queries that bypass indexes and cause DB-level DoS.
 *
 * Usage: `const q = \`%${escapeLikePattern(input)}%\`;`
 */
export function escapeLikePattern(s: string): string {
  return s.replace(/[%_\\]/g, '\\$&');
}

/**
 * Sanitizes untrusted text for inclusion in an LLM prompt.
 * Escapes characters that could be used for tag-based injection.
 */
export function sanitizeForPrompt(text: string | undefined | null): string {
  if (!text) return '';
  
  // Replace XML-like tags to prevent <tag>injection</tag>
  return text
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    // Remove common control characters that might confuse some models
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
}
