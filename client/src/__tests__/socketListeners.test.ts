import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

describe('socket listener deduplication', () => {
  it('listenersAttached is at module scope, not inside the hook', () => {
    const source = readFileSync(join(__dirname, '../hooks/useSocket.ts'), 'utf-8');
    // listenersAttached should be declared BEFORE the export function/hook
    const hookStart = source.search(/export\s+(default\s+)?function|export\s+const\s+use/);
    const listenersDeclared = source.indexOf('listenersAttached');
    expect(listenersDeclared).toBeGreaterThan(-1);
    expect(hookStart).toBeGreaterThan(-1);
    expect(listenersDeclared).toBeLessThan(hookStart);
  });
});
