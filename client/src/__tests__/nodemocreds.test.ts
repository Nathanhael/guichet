import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

describe('demo credentials not in client bundle', () => {
  it('LoginView does not contain hardcoded demo password', () => {
    const source = readFileSync(
      join(__dirname, '../views/LoginView.tsx'),
      'utf-8'
    );
    expect(source).not.toContain('cGFzc3dvcmQxMjM'); // base64 of password123
    expect(source).not.toContain('DEMO_PASSWORD');
    expect(source).not.toContain("password123");
  });

  it('LoginView does not contain hardcoded demo user list', () => {
    const source = readFileSync(
      join(__dirname, '../views/LoginView.tsx'),
      'utf-8'
    );
    expect(source).not.toContain('HARDCODED_DEMO_USERS');
  });
});
