// Adapter-level integration tests for RedisLiveState. Runs against the test
// Redis container (compose stack), exercises Lua scripts + key layout end-to-end.
// Slower than the boundary suite (which uses MemoryLiveState) — guards the
// I/O surface that boundary tests can't cover. See issue #109.
import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { createClient } from 'redis';
import type { RedisClientType } from 'redis';
import { RedisLiveState } from '../adapters/redisLiveState.js';

const REDIS_URL = process.env.REDIS_URL ?? 'redis://redis:6379';

const NOOP_LOGGER = { error: () => {}, debug: () => {} };

describe('RedisLiveState adapter (real Redis)', () => {
  let client: RedisClientType;
  let live: RedisLiveState;

  beforeAll(async () => {
    client = createClient({ url: REDIS_URL });
    await client.connect();
  });

  afterAll(async () => {
    await client.quit();
  });

  beforeEach(async () => {
    live = new RedisLiveState({ redis: client, logger: NOOP_LOGGER });
    await live.flushAll();
  });

  describe('attach/detach socket SCARD transitions', () => {
    it('attachSocket increments SCARD; detachSocket decrements', async () => {
      await live.upsertIdentity({
        partnerId: 'p1', userId: 'u1', role: 'support', name: 'Alice', isPlatformOperator: false,
      });
      expect((await live.attachSocket('p1', 'u1', 's1')).socketCount).toBe(1);
      expect((await live.attachSocket('p1', 'u1', 's2')).socketCount).toBe(2);
      expect(await live.socketCount('p1', 'u1')).toBe(2);
      expect((await live.detachSocket('p1', 'u1', 's1')).socketCount).toBe(1);
    });

    it('full disconnect (last socket leaves) drops hash + sockets set + partner-set membership', async () => {
      await live.upsertIdentity({
        partnerId: 'p1', userId: 'u1', role: 'support', name: 'Alice', isPlatformOperator: false,
      });
      await live.attachSocket('p1', 'u1', 's1');

      const onlineBefore = await live.listOnline('p1');
      expect(onlineBefore).toHaveLength(1);

      const { socketCount } = await live.detachSocket('p1', 'u1', 's1');
      expect(socketCount).toBe(0);

      // Hash dropped
      expect(await live.readStatus('p1', 'u1')).toBeNull();
      // Per-partner set membership dropped (listOnline reflects this)
      const onlineAfter = await live.listOnline('p1');
      expect(onlineAfter).toHaveLength(0);
      // Sockets set is also gone (SCARD reads 0 — set is empty/missing)
      expect(await live.socketCount('p1', 'u1')).toBe(0);
    });

    it('detachSocket on never-attached user returns 0 without throwing', async () => {
      const result = await live.detachSocket('p1', 'ghost', 's1');
      expect(result.socketCount).toBe(0);
    });
  });

  describe('upsertIdentity Lua: status preservation across full disconnect', () => {
    it('reads last_status to seed status on next first-attach (the contract presence.ts lacked)', async () => {
      // Initial connect, set status to away
      await live.upsertIdentity({
        partnerId: 'p1', userId: 'u1', role: 'support', name: 'Alice', isPlatformOperator: false,
      });
      await live.attachSocket('p1', 'u1', 's1');
      await live.writeStatus('p1', 'u1', 'away');

      // Full disconnect — last_status persists, hash drops
      await live.detachSocket('p1', 'u1', 's1');
      expect(await live.readStatus('p1', 'u1')).toBeNull(); // hash gone
      // last_status key persists at TTL — verify by direct GET
      const lastStatus = await client.get(`presence:last_status:p1:u1`);
      expect(lastStatus).toBe('away');

      // Reconnect — upsertIdentity reads last_status, seeds the hash with 'away'
      await live.upsertIdentity({
        partnerId: 'p1', userId: 'u1', role: 'support', name: 'Alice', isPlatformOperator: false,
      });
      expect(await live.readStatus('p1', 'u1')).toBe('away');
    });

    it('first-ever identify (no last_status) seeds status="online"', async () => {
      await live.upsertIdentity({
        partnerId: 'p1', userId: 'u1', role: 'support', name: 'Alice', isPlatformOperator: false,
      });
      expect(await live.readStatus('p1', 'u1')).toBe('online');
    });

    it('reconnect mid-session (hash still alive) does NOT reset status to online', async () => {
      await live.upsertIdentity({
        partnerId: 'p1', userId: 'u1', role: 'support', name: 'Alice', isPlatformOperator: false,
      });
      await live.attachSocket('p1', 'u1', 's1');
      await live.writeStatus('p1', 'u1', 'away');

      // upsertIdentity again WITHOUT the user fully disconnecting (e.g. tab refresh,
      // socket reconnect on the same client). Hash exists — Lua's else branch
      // updates metadata only, status field untouched.
      await live.upsertIdentity({
        partnerId: 'p1', userId: 'u1', role: 'support', name: 'Alice', isPlatformOperator: false,
      });
      expect(await live.readStatus('p1', 'u1')).toBe('away');
    });
  });

  describe('writeStatus mirrors to last_status', () => {
    it('writeStatus updates hash status AND last_status with TTL', async () => {
      await live.upsertIdentity({
        partnerId: 'p1', userId: 'u1', role: 'support', name: 'Alice', isPlatformOperator: false,
      });
      const written = await live.writeStatus('p1', 'u1', 'away');
      expect(written).toBe(true);
      expect(await live.readStatus('p1', 'u1')).toBe('away');
      // Direct read of last_status key
      const lastStatus = await client.get(`presence:last_status:p1:u1`);
      expect(lastStatus).toBe('away');
      // TTL set (in seconds, > 0 means EX was applied)
      const ttl = await client.ttl(`presence:last_status:p1:u1`);
      expect(ttl).toBeGreaterThan(0);
    });

    it('writeStatus returns false for never-identified user (no hash)', async () => {
      const written = await live.writeStatus('p1', 'ghost', 'away');
      expect(written).toBe(false);
    });
  });

  describe('flushAll', () => {
    it('clears presence:*, partner:presence:*, presence:last_status:* prefixes', async () => {
      // Set up state across all three prefixes
      await live.upsertIdentity({
        partnerId: 'p1', userId: 'u1', role: 'support', name: 'Alice', isPlatformOperator: false,
      });
      await live.attachSocket('p1', 'u1', 's1');
      await live.writeStatus('p1', 'u1', 'away'); // populates last_status

      // Verify all three exist before flush
      expect(await client.exists(`presence:p1:u1`)).toBe(1);
      expect(await client.exists(`partner:presence:p1`)).toBe(1);
      expect(await client.exists(`presence:last_status:p1:u1`)).toBe(1);

      const { deleted } = await live.flushAll();
      expect(deleted).toBeGreaterThanOrEqual(3);

      // Verify all three are gone
      expect(await client.exists(`presence:p1:u1`)).toBe(0);
      expect(await client.exists(`partner:presence:p1`)).toBe(0);
      expect(await client.exists(`presence:last_status:p1:u1`)).toBe(0);
    });

    it('returns { deleted: 0 } when no state exists', async () => {
      const { deleted } = await live.flushAll();
      expect(deleted).toBe(0);
    });
  });

  describe('listOnline', () => {
    it('returns all online users for a partner with hash metadata', async () => {
      await live.upsertIdentity({
        partnerId: 'p1', userId: 'u1', role: 'support', name: 'Alice', isPlatformOperator: false,
      });
      await live.attachSocket('p1', 'u1', 's1');
      await live.upsertIdentity({
        partnerId: 'p1', userId: 'op', role: 'support', name: 'Op', isPlatformOperator: true,
      });
      await live.attachSocket('p1', 'op', 's2');

      const online = await live.listOnline('p1');
      expect(online).toHaveLength(2);
      const alice = online.find(u => u.userId === 'u1');
      expect(alice).toMatchObject({ name: 'Alice', role: 'support', status: 'online', isPlatformOperator: false });
      const op = online.find(u => u.userId === 'op');
      expect(op).toMatchObject({ name: 'Op', role: 'support', status: 'online', isPlatformOperator: true });
    });

    it('returns empty array for a partner with no online users', async () => {
      const online = await live.listOnline('empty-partner');
      expect(online).toEqual([]);
    });
  });
});
