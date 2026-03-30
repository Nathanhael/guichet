import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

describe('socket listener deduplication', () => {
  it('listenersAttachedRef is declared as a useRef inside the hook body', () => {
    const source = readFileSync(join(__dirname, '../hooks/useSocket.ts'), 'utf-8');

    // useRef must be imported
    expect(source).toMatch(/import\s+\{[^}]*\buseRef\b[^}]*\}\s+from\s+['"]react['"]/);

    // listenersAttachedRef must be declared with useRef inside the hook
    expect(source).toMatch(/const\s+listenersAttachedRef\s*=\s*useRef\s*\(/);
  });

  it('listenersAttachedRef is initialised to false', () => {
    const source = readFileSync(join(__dirname, '../hooks/useSocket.ts'), 'utf-8');
    expect(source).toMatch(/const\s+listenersAttachedRef\s*=\s*useRef\s*\(\s*false\s*\)/);
  });

  it('listeners are guarded by listenersAttachedRef.current check', () => {
    const source = readFileSync(join(__dirname, '../hooks/useSocket.ts'), 'utf-8');
    // Guard: bail out when already attached
    expect(source).toMatch(/if\s*\(\s*listenersAttachedRef\.current\s*\)\s*return/);
    // Set the flag to true after attaching
    expect(source).toMatch(/listenersAttachedRef\.current\s*=\s*true/);
  });

  it('listenersAttachedRef.current is reset to false in the cleanup function', () => {
    const source = readFileSync(join(__dirname, '../hooks/useSocket.ts'), 'utf-8');
    // The cleanup (return () => { ... }) must reset the ref so a remount re-attaches
    expect(source).toMatch(/listenersAttachedRef\.current\s*=\s*false/);
  });

  it('listeners are attached with s.on and removed with s.off in the same effect', () => {
    const source = readFileSync(join(__dirname, '../hooks/useSocket.ts'), 'utf-8');
    const onCount = (source.match(/\bs\.on\s*\(/g) || []).length;
    const offCount = (source.match(/\bs\.off\s*\(/g) || []).length;
    // Every s.on call must have a matching s.off call in the cleanup
    expect(offCount).toBe(onCount);
    expect(onCount).toBeGreaterThan(0);
  });

  it('listenersAttachedRef is NOT declared at module scope', () => {
    const source = readFileSync(join(__dirname, '../hooks/useSocket.ts'), 'utf-8');
    const hookStart = source.search(/export\s+(default\s+)?function|export\s+const\s+use/);
    expect(hookStart).toBeGreaterThan(-1);

    // Any occurrence of listenersAttachedRef must be AFTER the hook export declaration
    const firstOccurrence = source.indexOf('listenersAttachedRef');
    expect(firstOccurrence).toBeGreaterThan(hookStart);
  });
});
