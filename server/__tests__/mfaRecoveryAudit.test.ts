import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

describe('MFA recovery code regeneration audit (#30)', () => {
  const mfaSource = fs.readFileSync(
    path.resolve(__dirname, '../trpc/routers/mfa.ts'),
    'utf-8'
  );

  it('logs audit entry on recovery code regeneration', () => {
    const regenBlock = mfaSource.slice(
      mfaSource.indexOf('regenerateRecoveryCodes'),
      mfaSource.lastIndexOf('recoveryCodes: plain')
    );
    expect(regenBlock).toMatch(/auditLog/);
    expect(regenBlock).toMatch(/mfa_recovery_codes_regenerated/);
  });
});
