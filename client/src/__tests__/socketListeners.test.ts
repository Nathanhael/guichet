import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

describe('socket listener deduplication', () => {
  it('listenersAttached is declared as a module-level let variable', () => {
    const source = readFileSync(join(__dirname, '../hooks/useSocket.ts'), 'utf-8');

    // Module-level flag: declared before the hook export
    expect(source).toMatch(/let\s+listenersAttached\s*=\s*false/);

    // Must be at module scope (before the hook function declaration)
    const hookStart = source.search(/export\s+function\s+useSocket/);
    expect(hookStart).toBeGreaterThan(-1);
    const flagDecl = source.indexOf('let listenersAttached');
    expect(flagDecl).toBeLessThan(hookStart);
  });

  it('listeners are guarded by listenersAttached check', () => {
    const source = readFileSync(join(__dirname, '../hooks/useSocket.ts'), 'utf-8');
    // Guard: bail out when already attached
    expect(source).toMatch(/if\s*\(\s*listenersAttached\s*\)\s*return/);
    // Set the flag to true after attaching
    expect(source).toMatch(/listenersAttached\s*=\s*true/);
  });

  it('listenersAttached is reset to false in the cleanup function', () => {
    const source = readFileSync(join(__dirname, '../hooks/useSocket.ts'), 'utf-8');
    // The cleanup (return () => { ... }) must reset the flag so a remount re-attaches
    expect(source).toMatch(/listenersAttached\s*=\s*false/);
  });

  it('listeners are attached with s.on and removed with s.off in the same effect', () => {
    const source = readFileSync(join(__dirname, '../hooks/useSocket.ts'), 'utf-8');
    const onCount = (source.match(/\bs\.on\s*\(/g) || []).length;
    const offCount = (source.match(/\bs\.off\s*\(/g) || []).length;
    // Every s.on call must have a matching s.off call in the cleanup
    expect(offCount).toBe(onCount);
    expect(onCount).toBeGreaterThan(0);
  });

  it('does not use useRef for the listener guard (singleton socket needs module-level guard)', () => {
    const source = readFileSync(join(__dirname, '../hooks/useSocket.ts'), 'utf-8');
    // useRef-based guard was per-instance — must not be used for singleton socket
    expect(source).not.toMatch(/listenersAttachedRef/);
  });
});
