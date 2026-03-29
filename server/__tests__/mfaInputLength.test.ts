import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

describe('MFA TOTP input length consistency (#44)', () => {
  const mfaSource = fs.readFileSync(
    path.resolve(__dirname, '../trpc/routers/mfa.ts'), 'utf-8'
  );

  it('uses consistent code length validation across all procedures', () => {
    const codeSchemas = mfaSource.match(/code:\s*z\.string\(\)\.\w+\(\d+\)/g) || [];
    for (const schema of codeSchemas) {
      expect(schema).toMatch(/length\(6\)/);
    }
  });
});
