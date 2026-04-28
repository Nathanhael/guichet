// Integration test for the full flip cascade. Hits real Redis (the dev
// compose stack) so we can assert that calling the production-wired
// flipIsExternal makes a previously-issued JWT's payload read as revoked.
//
// Skips when REDIS_URL is unset (e.g., a CI env without Redis).

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { eq } from 'drizzle-orm';

import { users } from '../../db/schema.js';
import { db } from '../../db.js';
import { initRedis, getRedisClients } from '../../utils/redis.js';
import { isRevoked } from './sessionRevocation.js';
import { flipIsExternal } from './index.js';

const REDIS_AVAILABLE = !!process.env.REDIS_URL;
const skipIfNoRedis = REDIS_AVAILABLE ? it : it.skip;

const USER_ID = 'integration-flip-user';
const REVOKED_AFTER_KEY = `auth:user:revoked_after:${USER_ID}`;

describe('flipIsExternal — Redis integration', () => {
  beforeAll(async () => {
    // Bootstrap Redis clients; the test process doesn't run app.ts.
    if (REDIS_AVAILABLE) {
      await initRedis();
      const { pubClient } = getRedisClients();
      // Clear any leftover revoked-after key from prior runs so the
      // pre-flip "not revoked" assertion is deterministic.
      if (pubClient) {
        await pubClient.del(REVOKED_AFTER_KEY);
      }
    }

    try {
      await db.insert(users).values({
        id: USER_ID,
        email: 'integration-flip@x.test',
        name: 'Integration Flip',
        isExternal: false,
      });
    } catch {
      // Already exists from a prior run — fine. Reset state instead.
      await db.update(users).set({ isExternal: false }).where(eq(users.id, USER_ID));
    }
  });

  afterAll(async () => {
    await db.delete(users).where(eq(users.id, USER_ID));

    if (REDIS_AVAILABLE) {
      const { pubClient, subClient } = getRedisClients();
      if (pubClient) {
        await pubClient.del(REVOKED_AFTER_KEY);
        await pubClient.quit();
      }
      if (subClient) {
        await subClient.quit();
      }
    }
  });

  skipIfNoRedis(
    'pre-flip JWT payload is not revoked; after flipIsExternal the same payload reads as revoked',
    async () => {
      const issuedAtSeconds = Math.floor(Date.now() / 1000) - 60;
      const preFlipPayload = { userId: USER_ID, jti: 'integration-jti-pre', iat: issuedAtSeconds };

      // Pre-flip: token must look valid.
      expect(await isRevoked(preFlipPayload)).toBe(false);

      // Trigger the flip — this should persist the new value, write the
      // audit row, and fire revokeUserSessions.
      const result = await flipIsExternal(USER_ID, true);
      expect(result.flipped).toBe(true);

      // Post-flip: the same payload (with iat older than the cutoff) is now
      // revoked because revokeUserSessions wrote a `auth:user:revoked_after:`
      // key in Redis.
      expect(await isRevoked(preFlipPayload)).toBe(true);
    }
  );
});
