// server/services/availability/availability.test.ts
import { describe, expect, it, beforeEach } from 'vitest';
import { Availability } from './index.js';
import {
  FixedClock,
  MemoryLiveState,
  MemoryTransitionLog,
  RecordingBroadcast,
} from './test-stubs.js';

const PARTNER_A = 'p-acme';
const ALICE = 'u-alice';
const BOB = 'u-bob';

describe('Availability', () => {
  let live: MemoryLiveState;
  let log: MemoryTransitionLog;
  let broadcast: RecordingBroadcast;
  let clock: FixedClock;
  let availability: Availability;

  beforeEach(() => {
    live = new MemoryLiveState();
    log = new MemoryTransitionLog();
    broadcast = new RecordingBroadcast();
    clock = new FixedClock(new Date('2026-05-01T10:00:00Z'));
    availability = new Availability({ live, log, broadcast, clock });
  });

  describe('socket.attach', () => {
    it('opens PG row + upserts Redis identity + broadcasts support roster on first attach', async () => {
      await availability.socket.attach({
        userId: ALICE, partnerId: PARTNER_A, socketId: 'sock-1',
        role: 'support', name: 'Alice',
      });

      expect(log.rows).toHaveLength(1);
      expect(log.rows[0]).toMatchObject({ userId: ALICE, status: 'online', endedAt: null });

      expect(await availability.isOnline(ALICE, PARTNER_A)).toBe(true);
      expect(await availability.advanced.getStatus(ALICE, PARTNER_A)).toBe('online');

      const supportEvents = broadcast.events.filter((e) => e.type === 'supportOnline');
      expect(supportEvents).toHaveLength(1);
      expect(supportEvents[0].payload).toEqual([
        { userId: ALICE, name: 'Alice', status: 'online' },
      ]);
    });

    it('preserves status on reconnect (away → reconnect → still away)', async () => {
      await availability.socket.attach({
        userId: ALICE, partnerId: PARTNER_A, socketId: 'sock-1',
        role: 'support', name: 'Alice',
      });
      await availability.setStatus(ALICE, PARTNER_A, 'away');
      await availability.socket.detach({ userId: ALICE, partnerId: PARTNER_A, socketId: 'sock-1' });

      // Reconnect.
      clock.advance(60_000);
      await availability.socket.attach({
        userId: ALICE, partnerId: PARTNER_A, socketId: 'sock-2',
        role: 'support', name: 'Alice',
      });

      expect(await availability.advanced.getStatus(ALICE, PARTNER_A)).toBe('away');
    });

    it('clears offlineAt on attach', async () => {
      await availability.socket.attach({
        userId: ALICE, partnerId: PARTNER_A, socketId: 'sock-1',
        role: 'support', name: 'Alice',
      });
      await availability.socket.detach({ userId: ALICE, partnerId: PARTNER_A, socketId: 'sock-1' });
      expect(await availability.advanced.offlineSince(ALICE, PARTNER_A)).not.toBeNull();

      await availability.socket.attach({
        userId: ALICE, partnerId: PARTNER_A, socketId: 'sock-2',
        role: 'support', name: 'Alice',
      });
      expect(await availability.advanced.offlineSince(ALICE, PARTNER_A)).toBeNull();
    });
  });

  describe('socket.detach', () => {
    it('does NOT mark offline when other sockets remain', async () => {
      await availability.socket.attach({
        userId: ALICE, partnerId: PARTNER_A, socketId: 'sock-1',
        role: 'support', name: 'Alice',
      });
      await availability.socket.attach({
        userId: ALICE, partnerId: PARTNER_A, socketId: 'sock-2',
        role: 'support', name: 'Alice',
      });

      const broadcastsBeforeDetach = broadcast.events.length;
      await availability.socket.detach({ userId: ALICE, partnerId: PARTNER_A, socketId: 'sock-1' });

      expect(await availability.isOnline(ALICE, PARTNER_A)).toBe(true);
      expect(await availability.advanced.offlineSince(ALICE, PARTNER_A)).toBeNull();
      // No new broadcast — partial drop is invisible.
      expect(broadcast.events.length).toBe(broadcastsBeforeDetach);
    });

    it('marks offline + closes PG row + broadcasts when last socket leaves', async () => {
      await availability.socket.attach({
        userId: ALICE, partnerId: PARTNER_A, socketId: 'sock-1',
        role: 'support', name: 'Alice',
      });
      const beforeDetach = broadcast.events.length;

      clock.advance(120_000);
      await availability.socket.detach({ userId: ALICE, partnerId: PARTNER_A, socketId: 'sock-1' });

      expect(await availability.isOnline(ALICE, PARTNER_A)).toBe(false);
      expect(await availability.advanced.offlineSince(ALICE, PARTNER_A)).toEqual(
        new Date('2026-05-01T10:02:00Z'),
      );

      // PG row closed with duration.
      expect(log.rows[0].endedAt).toEqual(new Date('2026-05-01T10:02:00Z'));
      expect(log.rows[0].duration).toBe(120);

      // New broadcast emitted (empty roster).
      const broadcastsAfter = broadcast.events.slice(beforeDetach);
      expect(broadcastsAfter.some((e) => e.type === 'supportOnline')).toBe(true);
    });
  });

  describe('setStatus', () => {
    it('opens new PG row + writes Redis + broadcasts on transition', async () => {
      await availability.socket.attach({
        userId: ALICE, partnerId: PARTNER_A, socketId: 'sock-1',
        role: 'support', name: 'Alice',
      });
      const beforeBroadcasts = broadcast.events.length;
      const beforeRows = log.rows.length;

      clock.advance(60_000);
      await availability.setStatus(ALICE, PARTNER_A, 'away');

      expect(await availability.advanced.getStatus(ALICE, PARTNER_A)).toBe('away');

      // Previous row closed, new row opened.
      const newRows = log.rows.slice(beforeRows);
      expect(newRows.length).toBe(1);
      expect(newRows[0]).toMatchObject({ status: 'away', endedAt: null });

      // Broadcast fired with the new status.
      const newBroadcasts = broadcast.events.slice(beforeBroadcasts);
      const supportEvent = newBroadcasts.find((e) => e.type === 'supportOnline');
      expect(supportEvent).toBeTruthy();
      expect(supportEvent!.payload).toEqual([
        { userId: ALICE, name: 'Alice', status: 'away' },
      ]);
    });

    it('is a no-op when user has not identified (no Redis hash)', async () => {
      const beforeRows = log.rows.length;
      const beforeBroadcasts = broadcast.events.length;

      await availability.setStatus(ALICE, PARTNER_A, 'away');

      expect(log.rows.length).toBe(beforeRows);
      expect(broadcast.events.length).toBe(beforeBroadcasts);
    });

    it('rolls back PG row when Redis writeStatus throws', async () => {
      await availability.socket.attach({
        userId: ALICE, partnerId: PARTNER_A, socketId: 'sock-1',
        role: 'support', name: 'Alice',
      });

      // Replace writeStatus with a throwing version for one call.
      const originalWriteStatus = live.writeStatus.bind(live);
      let firstCall = true;
      live.writeStatus = async (...a) => {
        if (firstCall) {
          firstCall = false;
          throw new Error('redis offline');
        }
        return originalWriteStatus(...a);
      };

      const beforeBroadcasts = broadcast.events.length;
      await expect(
        availability.setStatus(ALICE, PARTNER_A, 'away'),
      ).rejects.toThrow('redis offline');

      // The PG log should reflect the rollback: the latest open row's status
      // is the previous one ('online'), not the failed 'away'.
      const openRow = log.rows.find((r) => r.userId === ALICE && r.endedAt === null);
      expect(openRow?.status).toBe('online');

      // No broadcast was emitted on the failed path.
      expect(broadcast.events.length).toBe(beforeBroadcasts);
    });
  });

  describe('onlineSupport', () => {
    it('filters out platform operators and agents', async () => {
      await availability.socket.attach({
        userId: ALICE, partnerId: PARTNER_A, socketId: 's1',
        role: 'support', name: 'Alice',
      });
      await availability.socket.attach({
        userId: BOB, partnerId: PARTNER_A, socketId: 's2',
        role: 'support', name: 'Bob', isPlatformOperator: true,
      });
      await availability.socket.attach({
        userId: 'u-charlie', partnerId: PARTNER_A, socketId: 's3',
        role: 'agent', name: 'Charlie',
      });

      const roster = await availability.onlineSupport(PARTNER_A);
      expect(roster).toEqual([
        { userId: ALICE, name: 'Alice', status: 'online' },
      ]);
    });
  });

  describe('flushOnBoot', () => {
    it('clears all live state but does not touch the PG log', async () => {
      await availability.socket.attach({
        userId: ALICE, partnerId: PARTNER_A, socketId: 'sock-1',
        role: 'support', name: 'Alice',
      });
      const rowsBeforeFlush = log.rows.length;

      await availability.flushOnBoot();

      expect(await availability.isOnline(ALICE, PARTNER_A)).toBe(false);
      expect(await availability.advanced.getStatus(ALICE, PARTNER_A)).toBeNull();
      expect(log.rows.length).toBe(rowsBeforeFlush);
    });
  });

  describe('isOnline', () => {
    it('returns false for never-identified user', async () => {
      expect(await availability.isOnline('u-never', PARTNER_A)).toBe(false);
    });

    it('returns true exactly when at least one socket is attached', async () => {
      await availability.socket.attach({
        userId: ALICE, partnerId: PARTNER_A, socketId: 's1',
        role: 'support', name: 'Alice',
      });
      expect(await availability.isOnline(ALICE, PARTNER_A)).toBe(true);

      await availability.socket.detach({ userId: ALICE, partnerId: PARTNER_A, socketId: 's1' });
      expect(await availability.isOnline(ALICE, PARTNER_A)).toBe(false);
    });
  });
});
