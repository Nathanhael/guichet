import { readFileSync } from 'fs';
import { join } from 'path';
import { describe, it, expect } from 'vitest';

const SOURCE_PATH = join(__dirname, '../../services/platformStepUp.ts');
const source = readFileSync(SOURCE_PATH, 'utf-8');

describe('platformStepUp - Redis key security', () => {
  it('does NOT use raw TOTP token in Redis key', () => {
    // Raw key pattern embeds the 6-digit token directly — attacker with Redis read access
    // could enumerate recently-used tokens
    expect(source).not.toMatch(/`totp:used:\$\{userId\}:\$\{token\}`/);
  });

  it('hashes the TOTP token with SHA-256 before using as Redis key', () => {
    expect(source).toContain("createHash('sha256')");
    expect(source).toContain('.update(token)');
    expect(source).toContain(".digest('hex')");
  });
});
