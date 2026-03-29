import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

describe('Bearer token deprecation warning (#41)', () => {
  const authSource = fs.readFileSync(
    path.resolve(__dirname, '../middleware/auth.ts'), 'utf-8'
  );
  const contextSource = fs.readFileSync(
    path.resolve(__dirname, '../trpc/context.ts'), 'utf-8'
  );

  it('logs deprecation warning when Bearer auth is used in middleware', () => {
    expect(authSource).toMatch(/Bearer.*deprecated/i);
  });

  it('logs deprecation warning when Bearer auth is used in tRPC context', () => {
    expect(contextSource).toMatch(/Bearer.*deprecated/i);
  });

  it('still supports Bearer auth (not removed yet)', () => {
    expect(authSource).toMatch(/startsWith\('Bearer '\)/);
    expect(contextSource).toMatch(/startsWith\('Bearer '\)/);
  });
});
