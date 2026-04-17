import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

describe('dev-login route mount gating', () => {
  const indexSource = readFileSync(
    join(__dirname, '../../routes/auth/index.ts'),
    'utf-8',
  );
  const handlerSource = readFileSync(
    join(__dirname, '../../routes/auth/devLogin.ts'),
    'utf-8',
  );

  it('registerDevLoginRoutes is gated by NODE_ENV !== production at mount time', () => {
    expect(indexSource).toMatch(
      /if\s*\(\s*config\.NODE_ENV\s*!==\s*['"]production['"]\s*\)\s*\{\s*registerDevLoginRoutes\(router\);?\s*\}/,
    );
  });

  it('handler keeps the in-handler NODE_ENV 404 as defense in depth', () => {
    expect(handlerSource).toMatch(
      /config\.NODE_ENV\s*===\s*['"]production['"][\s\S]{0,120}status\(404\)/,
    );
  });
});
