import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

describe('auth:expired handler prevents reconnect loop (#31)', () => {
  const socketSource = fs.readFileSync(
    path.resolve(__dirname, '../hooks/useSocket.ts'), 'utf-8'
  );

  it('calls logout on auth:expired instead of reconnecting', () => {
    const handler = socketSource.slice(
      socketSource.indexOf('handleAuthExpired'),
      socketSource.indexOf('// Attach all listeners')
    );
    expect(handler).toMatch(/logout/);
    expect(handler).not.toMatch(/s\.disconnect\(\)[\s\S]{0,20}s\.connect\(\)/);
  });
});
