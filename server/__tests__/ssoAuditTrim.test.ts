import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

describe('SSO audit log trims Azure groups (#45)', () => {
  const ssoSource = fs.readFileSync(
    path.resolve(__dirname, '../routes/sso.ts'), 'utf-8'
  );

  it('logs groupCount instead of full azureGroups array', () => {
    expect(ssoSource).toMatch(/groupCount/);
  });

  it('does not store full azureGroups in audit metadata', () => {
    // Should not have metadata: { email, azureGroups }
    // but should have metadata: { email, groupCount: ... }
    expect(ssoSource).not.toMatch(/metadata:\s*\{[^}]*azureGroups\s*\}/);
  });
});
