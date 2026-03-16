import { describe, it, expect } from 'vitest';
import { sanitizeForPrompt, isValidMediaUrl } from '../utils/security.js';

describe('Security Utilities', () => {
  describe('sanitizeForPrompt', () => {
    it('should escape < and > characters', () => {
      const input = 'Hello <tag> and "quotes"';
      const result = sanitizeForPrompt(input);
      expect(result).toBe('Hello &lt;tag&gt; and "quotes"');
    });

    it('should remove control characters', () => {
      const input = 'Line 1\x00Line 2\x1F';
      const result = sanitizeForPrompt(input);
      expect(result).toBe('Line 1Line 2');
    });

    it('should return empty string for null/undefined', () => {
      expect(sanitizeForPrompt(null)).toBe('');
      expect(sanitizeForPrompt(undefined)).toBe('');
    });
  });

  describe('isValidMediaUrl', () => {
    it('should allow valid internal uploads', () => {
      expect(isValidMediaUrl('/uploads/image.png')).toBe(true);
      expect(isValidMediaUrl('/uploads/nested/file.jpg')).toBe(true);
    });

    it('should reject path traversal in internal uploads', () => {
      expect(isValidMediaUrl('/uploads/../../etc/passwd')).toBe(false);
    });

    it('should allow valid external images (https)', () => {
      expect(isValidMediaUrl('https://example.com/logo.svg')).toBe(true);
      expect(isValidMediaUrl('http://images.cdn/photo.jpg')).toBe(true);
    });

    it('should reject invalid protocols', () => {
      expect(isValidMediaUrl('javascript:alert(1)')).toBe(false);
      expect(isValidMediaUrl('data:image/png;base64,xxxx')).toBe(false);
      expect(isValidMediaUrl('ftp://server/file.png')).toBe(false);
    });

    it('should reject non-image extensions', () => {
      expect(isValidMediaUrl('https://example.com/malicious.exe')).toBe(false);
      expect(isValidMediaUrl('https://example.com/script.js')).toBe(false);
    });

    it('should handle malformed URLs gracefully', () => {
      expect(isValidMediaUrl('not-a-url')).toBe(false);
    });
  });
});
