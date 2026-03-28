import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

describe('SSO error sanitization', () => {
  it('does not pass raw sso_error query param to setError', () => {
    const source = readFileSync(join(__dirname, '../views/LoginView.tsx'), 'utf-8');
    expect(source).not.toMatch(/setError\(decodeURIComponent/);
  });

  it('uses a whitelist for known SSO error codes', () => {
    const source = readFileSync(join(__dirname, '../views/LoginView.tsx'), 'utf-8');
    expect(source).toMatch(/ssoErrorMessages|SSO_ERROR_MAP|ssoErrors/i);
  });
});
