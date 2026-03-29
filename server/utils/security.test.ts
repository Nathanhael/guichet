import { describe, expect, it } from 'vitest';
import { isValidMediaUrl, sanitizeForPrompt, escapeLikePattern } from './security.js';

describe('isValidMediaUrl', () => {
  it('allows null/undefined/empty string', () => {
    expect(isValidMediaUrl(null)).toBe(true);
    expect(isValidMediaUrl(undefined)).toBe(true);
    expect(isValidMediaUrl('')).toBe(true);
  });

  it('allows relative /uploads/ paths with safe extensions', () => {
    expect(isValidMediaUrl('/uploads/abc123.png')).toBe(true);
    expect(isValidMediaUrl('/uploads/file.jpg')).toBe(true);
    expect(isValidMediaUrl('/uploads/photo.jpeg')).toBe(true);
    expect(isValidMediaUrl('/uploads/image.webp')).toBe(true);
    expect(isValidMediaUrl('/uploads/anim.gif')).toBe(true);
  });

  it('blocks /uploads/ paths with non-image extensions', () => {
    expect(isValidMediaUrl('/uploads/script.js')).toBe(false);
    expect(isValidMediaUrl('/uploads/page.html')).toBe(false);
    expect(isValidMediaUrl('/uploads/evil.svg')).toBe(false);
  });

  it('blocks path traversal in /uploads/ paths', () => {
    expect(isValidMediaUrl('/uploads/../etc/passwd')).toBe(false);
    expect(isValidMediaUrl('/uploads/../../secret.txt')).toBe(false);
  });

  it('blocks all external http/https URLs (H-5: tracking pixel prevention)', () => {
    expect(isValidMediaUrl('https://example.com/photo.png')).toBe(false);
    expect(isValidMediaUrl('https://cdn.test.com/img.jpg')).toBe(false);
    expect(isValidMediaUrl('http://example.com/photo.png')).toBe(false);
    expect(isValidMediaUrl('https://evil.com/track.png')).toBe(false);
  });

  it('blocks protocol-relative URLs', () => {
    expect(isValidMediaUrl('//example.com/photo.png')).toBe(false);
  });

  it('blocks non-http protocols', () => {
    expect(isValidMediaUrl('javascript:alert(1)')).toBe(false);
    expect(isValidMediaUrl('ftp://example.com/file.png')).toBe(false);
    expect(isValidMediaUrl('data:image/png;base64,abc')).toBe(false);
    expect(isValidMediaUrl('file:///etc/passwd')).toBe(false);
  });

  it('blocks malformed URLs and non-upload relative paths', () => {
    expect(isValidMediaUrl('not-a-url')).toBe(false);
    expect(isValidMediaUrl('://missing-protocol')).toBe(false);
    expect(isValidMediaUrl('/other/path.png')).toBe(false);
  });
});

describe('sanitizeForPrompt', () => {
  it('returns empty string for null/undefined', () => {
    expect(sanitizeForPrompt(null)).toBe('');
    expect(sanitizeForPrompt(undefined)).toBe('');
    expect(sanitizeForPrompt('')).toBe('');
  });

  it('escapes HTML/XML angle brackets', () => {
    expect(sanitizeForPrompt('<script>alert(1)</script>')).toBe('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(sanitizeForPrompt('<system>override</system>')).toBe('&lt;system&gt;override&lt;/system&gt;');
  });

  it('removes control characters', () => {
    expect(sanitizeForPrompt('hello\x00world')).toBe('helloworld');
    expect(sanitizeForPrompt('test\x07string')).toBe('teststring');
    expect(sanitizeForPrompt('good\x7Fchar')).toBe('goodchar');
  });

  it('preserves normal text', () => {
    expect(sanitizeForPrompt('Hello, how are you?')).toBe('Hello, how are you?');
    expect(sanitizeForPrompt('Price: $100 (50% off)')).toBe('Price: $100 (50% off)');
  });

  it('preserves newlines and tabs', () => {
    expect(sanitizeForPrompt('line1\nline2')).toBe('line1\nline2');
    expect(sanitizeForPrompt('col1\tcol2')).toBe('col1\tcol2');
  });
});

describe('escapeLikePattern', () => {
  it('escapes percent wildcard', () => {
    expect(escapeLikePattern('100%')).toBe('100\\%');
  });

  it('escapes underscore wildcard', () => {
    expect(escapeLikePattern('user_name')).toBe('user\\_name');
  });

  it('escapes backslash', () => {
    expect(escapeLikePattern('path\\to')).toBe('path\\\\to');
  });

  it('escapes all wildcards in combination', () => {
    expect(escapeLikePattern('%_test\\val%')).toBe('\\%\\_test\\\\val\\%');
  });

  it('returns normal text unchanged', () => {
    expect(escapeLikePattern('hello world')).toBe('hello world');
    expect(escapeLikePattern('')).toBe('');
  });
});
