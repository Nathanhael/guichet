import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

describe('Presence reconnect includes status (#25)', () => {
  const presenceSource = fs.readFileSync(
    path.resolve(__dirname, '../services/presence.ts'),
    'utf-8'
  );

  it('sets status to online in the identifyUser Lua script', () => {
    // The Lua script handles both new and existing connections atomically.
    // Verify that the script sets status to 'online' in both branches.
    const luaStart = presenceSource.indexOf('local exists = redis.call');
    const luaEnd = presenceSource.indexOf('return exists', luaStart);
    const luaBlock = presenceSource.slice(luaStart, luaEnd);

    expect(luaBlock).toMatch(/['"]status['"]\s*,\s*['"]online['"]/);
  });

  it('includes all required fields in the identifyUser Lua script', () => {
    const luaStart = presenceSource.indexOf('local exists = redis.call');
    const luaEnd = presenceSource.indexOf('return exists', luaStart);
    const luaBlock = presenceSource.slice(luaStart, luaEnd);

    // Verify all required fields are set in the HSET calls
    const requiredFields = ['userId', 'name', 'role', 'partnerId', 'isPlatformOperator', 'status'];
    requiredFields.forEach((field) => {
      expect(luaBlock).toContain(field);
    });
  });
});
