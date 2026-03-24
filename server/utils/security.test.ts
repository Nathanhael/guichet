import { describe, expect, it } from 'vitest';
import { isValidMediaUrl, sanitizeForPrompt } from './security.js';

describe('isValidMediaUrl', () => {
  it('allows null/undefined/empty string', () => {
    expect(isValidMediaUrl(null)).toBe(true);
    expect(isValidMediaUrl(undefined)).toBe(true);
    expect(isValidMediaUrl('')).toBe(true);
  });

  it('allows relative /uploads/ paths', () => {
    expect(isValidMediaUrl('/uploads/abc123.png')).toBe(true);
    expect(isValidMediaUrl('/uploads/file.jpg')).toBe(true);
  });

  it('blocks path traversal in /uploads/ paths', () => {
    expect(isValidMediaUrl('/uploads/../etc/passwd')).toBe(false);
    expect(isValidMediaUrl('/uploads/../../secret.txt')).toBe(false);
  });

  it('allows https image URLs with safe extensions', () => {
    expect(isValidMediaUrl('https://example.com/photo.png')).toBe(true);
    expect(isValidMediaUrl('https://cdn.test.com/img.jpg')).toBe(true);
    expect(isValidMediaUrl('https://example.com/pic.jpeg')).toBe(true);
    expect(isValidMediaUrl('https://example.com/file.webp')).toBe(true);
    expect(isValidMediaUrl('https://example.com/anim.gif')).toBe(true);
  });

  it('allows http image URLs', () => {
    expect(isValidMediaUrl('http://example.com/photo.png')).toBe(true);
  });

  it('blocks SVG files (XSS risk)', () => {
    expect(isValidMediaUrl('https://example.com/evil.svg')).toBe(false);
  });

  it('blocks non-image extensions', () => {
    expect(isValidMediaUrl('https://example.com/script.js')).toBe(false);
    expect(isValidMediaUrl('https://example.com/page.html')).toBe(false);
    expect(isValidMediaUrl('https://example.com/doc.pdf')).toBe(false);
  });

  it('blocks non-http protocols', () => {
    expect(isValidMediaUrl('javascript:alert(1)')).toBe(false);
    expect(isValidMediaUrl('ftp://example.com/file.png')).toBe(false);
    expect(isValidMediaUrl('data:image/png;base64,abc')).toBe(false);
    expect(isValidMediaUrl('file:///etc/passwd')).toBe(false);
  });

  it('blocks malformed URLs', () => {
    expect(isValidMediaUrl('not-a-url')).toBe(false);
    expect(isValidMediaUrl('://missing-protocol')).toBe(false);
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
