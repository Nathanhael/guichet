import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

describe('Auth state uses sessionStorage (#24)', () => {
  const authSliceSource = fs.readFileSync(
    path.resolve(__dirname, '../store/slices/authSlice.ts'), 'utf-8'
  );

  it('uses sessionStorage instead of localStorage for user data', () => {
    const userStorageCalls = authSliceSource.match(/localStorage\.(setItem|getItem|removeItem)\(['"]user['"]/g) || [];
    const membershipStorageCalls = authSliceSource.match(/localStorage\.(setItem|getItem|removeItem)\(['"]memberships['"]/g) || [];
    expect(userStorageCalls.length).toBe(0);
    expect(membershipStorageCalls.length).toBe(0);
  });

  it('uses sessionStorage for sensitive state', () => {
    expect(authSliceSource).toMatch(/sessionStorage/);
  });
});
