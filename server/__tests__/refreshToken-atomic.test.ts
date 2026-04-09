import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const src = readFileSync(
  resolve(__dirname, '../services/refreshToken.ts'),
  'utf-8',
);

// Isolate the rotateRefreshToken function body for targeted assertions
const rotateMatch = src.match(/export async function rotateRefreshToken[\s\S]*?^}/m);
const rotateFnBody = rotateMatch ? rotateMatch[0] : '';

describe('rotateRefreshToken atomicity contract', () => {
  it('uses a raw sql UPDATE...RETURNING to atomically claim the token', () => {
    // The atomic claim must use db.execute(sql`UPDATE ... RETURNING ...`)
    expect(rotateFnBody).toContain('db.execute(sql`');
    expect(rotateFnBody).toContain('UPDATE refresh_tokens');
    expect(rotateFnBody).toContain('RETURNING');
  });

  it('sets revoked_at in the UPDATE (not in a separate step)', () => {
    expect(rotateFnBody).toContain('SET revoked_at = NOW()');
  });

  it('filters on revoked_at IS NULL in the UPDATE', () => {
    expect(rotateFnBody).toContain('AND revoked_at IS NULL');
  });

  it('inserts the new token via db.insert after the atomic claim', () => {
    expect(rotateFnBody).toContain('db.insert(refreshTokens)');
  });

  it('does not use a transaction() block', () => {
    // The new design replaces the tx with a single atomic UPDATE, no transaction needed
    expect(rotateFnBody).not.toContain('db.transaction(');
  });
});
