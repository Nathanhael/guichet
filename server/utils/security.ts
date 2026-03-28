/**
 * Security utilities for validation and sanitization.
 */

/**
 * Validates if a media URL is safe to render and store.
 * Whitelists relative paths starting with /uploads/ and basic http/https images.
 */
export function isValidMediaUrl(url: string | undefined | null): boolean {
  if (!url) return true; // Empty is fine
  
  // Whitelist relative uploads
  if (url.startsWith('/uploads/')) {
    // Basic path traversal prevention check
    if (url.includes('..')) return false;
    return true;
  }

  // Whitelist standard external images
  try {
    const parsed = new URL(url);
    const safeProtocols = ['http:', 'https:'];
    if (!safeProtocols.includes(parsed.protocol)) return false;
    
    // Check for common image extensions — reject if missing or not in allowlist
    const ext = parsed.pathname.split('.').pop()?.toLowerCase();
    // SVG excluded — can contain embedded <script> tags (XSS vector)
    const safeExts = ['png', 'jpg', 'jpeg', 'webp', 'gif'];
    if (!ext || !safeExts.includes(ext)) return false;

    return true;
  } catch {
    return false;
  }
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
