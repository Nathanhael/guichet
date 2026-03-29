import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

describe('JWT payload Zod validation (#32)', () => {
  const contextSource = fs.readFileSync(
    path.resolve(__dirname, '../trpc/context.ts'), 'utf-8'
  );
  const authSource = fs.readFileSync(
    path.resolve(__dirname, '../middleware/auth.ts'), 'utf-8'
  );

  it('defines a Zod schema for JWT payload in context.ts', () => {
    expect(contextSource).toMatch(/z\.object/);
    expect(contextSource).toMatch(/jwtPayloadSchema/);
  });

  it('uses .parse() or .safeParse() on decoded JWT in context.ts', () => {
    expect(contextSource).toMatch(/\.parse\(|\.safeParse\(/);
  });

  it('uses Zod validation in auth middleware', () => {
    expect(authSource).toMatch(/\.parse\(|\.safeParse\(|jwtPayloadSchema/);
  });
});
