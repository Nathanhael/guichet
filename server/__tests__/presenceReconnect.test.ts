import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

describe('Presence reconnect includes status (#25)', () => {
  // The identify Lua script lives in `services/availability/adapters/redisLiveState.ts`
  // since the availability deepening (issue #88) absorbed the legacy
  // `services/presence.ts` into the RedisLiveState adapter.
  const presenceSource = fs.readFileSync(
    path.resolve(__dirname, '../services/availability/adapters/redisLiveState.ts'),
    'utf-8'
  );

  it('seeds status from last_status (falls back to online) on first identify', () => {
    // Issue #88 changed the contract: the script no longer hard-codes
    // status='online'. On first-ever identify (hash missing) it seeds
    // status from the persisted last_status key, defaulting to 'online'.
    // On reconnect (hash still alive) status is preserved by NOT being
    // written. Asserts both halves of that contract.
    const luaStart = presenceSource.indexOf('local exists = redis.call');
    const luaEnd = presenceSource.indexOf('return exists', luaStart);
    const luaBlock = presenceSource.slice(luaStart, luaEnd);

    // First-identify branch: status field is HSET, seeded from last_status with 'online' default.
    expect(luaBlock).toMatch(/redis\.call\(\s*['"]GET['"]\s*,\s*lastStatusKey\s*\)\s*or\s*['"]online['"]/);
    expect(luaBlock).toMatch(/['"]status['"]\s*,\s*seedStatus/);

    // Reconnect branch: status field is NOT in the second HSET (would clobber a manually-set 'away').
    const elseStart = luaBlock.indexOf('else');
    const elseBlock = luaBlock.slice(elseStart);
    expect(elseBlock).not.toMatch(/['"]status['"]\s*,/);
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
