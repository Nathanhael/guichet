import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

describe('listUserMemberships partner status filter', () => {
  it('filters by partner status active at the query layer', () => {
    const source = readFileSync(join(__dirname, '../../services/authSession.ts'), 'utf-8');
    // Extract only the listUserMemberships function body
    const fnMatch = source.match(/export async function listUserMemberships[\s\S]*?^}/m);
    expect(fnMatch, 'listUserMemberships function not found').toBeTruthy();
    const fnBody = fnMatch![0];
    // Must contain eq(partners.status, 'active') in the WHERE clause — not just a JS .filter()
    expect(fnBody).toMatch(/eq\s*\(\s*partners\.status\s*,\s*['"]active['"]\s*\)/);
  });
});
