import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

describe('Bearer token removal (#41)', () => {
  const authSource = fs.readFileSync(
    path.resolve(__dirname, '../middleware/auth.ts'), 'utf-8'
  );
  const contextSource = fs.readFileSync(
    path.resolve(__dirname, '../trpc/context.ts'), 'utf-8'
  );

  it('does not accept Bearer tokens in middleware', () => {
    expect(authSource).not.toMatch(/startsWith\('Bearer '\)/);
  });

  it('does not accept Bearer tokens in tRPC context', () => {
    expect(contextSource).not.toMatch(/startsWith\('Bearer '\)/);
  });

  it('reads token from cookie only in middleware', () => {
    expect(authSource).toMatch(/req\.cookies\?\.tessera_token/);
  });

  it('reads token from cookie only in tRPC context', () => {
    expect(contextSource).toMatch(/req\.cookies\?\.tessera_token/);
  });
});
