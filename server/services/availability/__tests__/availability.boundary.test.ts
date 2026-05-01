// server/services/availability/__tests__/availability.boundary.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { Availability } from '../availability.js';
import { MemoryLiveState } from '../adapters/memoryLiveState.js';
import { MemoryTransitionLog } from '../adapters/memoryTransitionLog.js';
import { RecordingBroadcast } from '../adapters/recordingBroadcast.js';

describe('Availability — boundary contract', () => {
  let live: MemoryLiveState;
  let log: MemoryTransitionLog;
  let bc: RecordingBroadcast;
  let now: Date;
  let av: Availability;

  beforeEach(() => {
    live = new MemoryLiveState();
    log = new MemoryTransitionLog();
    bc = new RecordingBroadcast();
    now = new Date('2026-04-29T12:00:00.000Z');
    av = new Availability({ live, log, broadcast: bc, clock: { now: () => now } });
  });

  async function attachAsSupport(userId: string, partnerId: string, socketId = 's-1') {
    await av.socket.attach({ userId, partnerId, socketId, role: 'support', name: 'Test User' });
  }

  it('setStatus writes Redis hash, opens new PG row, broadcasts roster', async () => {
    await attachAsSupport('u1', 'p1');
    bc.reset();
    const result = await av.setStatus('u1', 'p1', 'away');
    expect(result.applied).toBe(true);
    expect(await live.readStatus('p1', 'u1')).toBe('away');
    const open = log.rows.find(r => r.userId === 'u1' && r.endedAt === null);
    expect(open?.status).toBe('away');
    const ev = bc.events.at(-1);
    expect(ev?.kind).toBe('support:online');
  });

  it('setStatus rolls back PG row when Redis fails', async () => {
    await attachAsSupport('u1', 'p1');
    const rowsBefore = structuredClone(log.rows);
    live.failNextWrite = true;
    await expect(av.setStatus('u1', 'p1', 'away')).rejects.toThrow();
    expect(log.rows).toEqual(rowsBefore); // PG state unchanged
    expect(await live.readStatus('p1', 'u1')).toBe('online'); // Redis unchanged
  });

  it('socket.attach preserves status on reconnect (away -> reconnect -> still away)', async () => {
    await attachAsSupport('u1', 'p1', 's-1');
    await av.setStatus('u1', 'p1', 'away');
    await av.socket.detach({ userId: 'u1', partnerId: 'p1', socketId: 's-1' });
    await attachAsSupport('u1', 'p1', 's-2'); // reconnect
    expect(await live.readStatus('p1', 'u1')).toBe('away');
  });

  it('socket.detach only marks offline when last socket leaves', async () => {
    await attachAsSupport('u1', 'p1', 's-1');
    await attachAsSupport('u1', 'p1', 's-2');
    expect(await av.advanced.offlineSince('u1', 'p1')).toBeNull();
    await av.socket.detach({ userId: 'u1', partnerId: 'p1', socketId: 's-1' });
    expect(await av.advanced.offlineSince('u1', 'p1')).toBeNull();
    await av.socket.detach({ userId: 'u1', partnerId: 'p1', socketId: 's-2' });
    expect(await av.advanced.offlineSince('u1', 'p1')).toEqual(now);
  });

  it('socket.detach writes offlineSince only on full-offline transition', async () => {
    await attachAsSupport('u1', 'p1', 's-1');
    await attachAsSupport('u1', 'p1', 's-2');
    await av.socket.detach({ userId: 'u1', partnerId: 'p1', socketId: 's-1' });
    expect(await live.readOfflineAt('p1', 'u1')).toBeNull();
    await av.socket.detach({ userId: 'u1', partnerId: 'p1', socketId: 's-2' });
    expect(await live.readOfflineAt('p1', 'u1')).toEqual(now);
  });

  it('isOnline reflects multi-socket SCARD>0 invariant', async () => {
    expect(await av.isOnline('u1', 'p1')).toBe(false);
    await attachAsSupport('u1', 'p1', 's-1');
    expect(await av.isOnline('u1', 'p1')).toBe(true);
    await attachAsSupport('u1', 'p1', 's-2');
    await av.socket.detach({ userId: 'u1', partnerId: 'p1', socketId: 's-1' });
    expect(await av.isOnline('u1', 'p1')).toBe(true);
    await av.socket.detach({ userId: 'u1', partnerId: 'p1', socketId: 's-2' });
    expect(await av.isOnline('u1', 'p1')).toBe(false);
  });

  it('flushOnBoot clears live state without touching transition log', async () => {
    await attachAsSupport('u1', 'p1');
    await av.setStatus('u1', 'p1', 'away');
    const rowsBefore = log.rows.length;
    await av.flushOnBoot();
    expect(await live.readStatus('p1', 'u1')).toBeNull();
    expect(log.rows.length).toBe(rowsBefore);
  });

  it('setStatus is a no-op when user has no live-state hash (never identified)', async () => {
    const result = await av.setStatus('ghost', 'p1', 'away');
    expect(result.applied).toBe(false);
    expect(log.rows.length).toBe(0);
    expect(bc.events.length).toBe(0);
  });

  it('advanced.offlineSince returns null while online; offlineAt when fully offline', async () => {
    await attachAsSupport('u1', 'p1', 's-1');
    expect(await av.advanced.offlineSince('u1', 'p1')).toBeNull();
    await av.socket.detach({ userId: 'u1', partnerId: 'p1', socketId: 's-1' });
    expect(await av.advanced.offlineSince('u1', 'p1')).toEqual(now);
  });

  it('onlineSupport excludes platform operators', async () => {
    await av.socket.attach({ userId: 'op', partnerId: 'p1', socketId: 's-1', role: 'support', name: 'Op', isPlatformOperator: true });
    await av.socket.attach({ userId: 'u1', partnerId: 'p1', socketId: 's-2', role: 'support', name: 'Real' });
    const roster = await av.onlineSupport('p1');
    expect(roster.map(r => r.userId)).toEqual(['u1']);
  });

  it('admin attach triggers support:online broadcast but admin is not in the roster', async () => {
    bc.reset();
    await av.socket.attach({ userId: 'admin-1', partnerId: 'p1', socketId: 's-1', role: 'admin', name: 'The Admin' });
    // Eligibility: admin attach triggered the broadcast.
    expect(bc.events.some(e => e.kind === 'support:online')).toBe(true);
    // Content: admin is NOT in the roster.
    const roster = await av.onlineSupport('p1');
    expect(roster.find(u => u.userId === 'admin-1')).toBeUndefined();
  });

  it('socket.attach broadcasts support:online when role can use support workflows', async () => {
    bc.reset();
    await attachAsSupport('u1', 'p1');
    expect(bc.events.some(e => e.kind === 'support:online')).toBe(true);
  });

  it('socket.attach broadcasts agents:online when role is agent', async () => {
    bc.reset();
    await av.socket.attach({ userId: 'a1', partnerId: 'p1', socketId: 's-1', role: 'agent', name: 'Agent' });
    expect(bc.events.some(e => e.kind === 'agents:online')).toBe(true);
  });

  it('socket.attach opens a transition-log row on first connect (not on reconnect)', async () => {
    await attachAsSupport('u1', 'p1', 's-1');
    expect(log.rows.filter(r => r.userId === 'u1' && r.endedAt === null)).toHaveLength(1);
    await attachAsSupport('u1', 'p1', 's-2'); // second connect, same user, still online
    expect(log.rows.filter(r => r.userId === 'u1' && r.endedAt === null)).toHaveLength(1); // still 1, no new row
  });

  it('socket.detach closes the transition-log row on last disconnect', async () => {
    await attachAsSupport('u1', 'p1', 's-1');
    await av.socket.detach({ userId: 'u1', partnerId: 'p1', socketId: 's-1' });
    const last = log.rows[log.rows.length - 1];
    expect(last.endedAt).toEqual(now);
  });
});
