import { describe, it, expect } from 'vitest';
import {
  buildStaffBreakdown,
  type RawStaffRatingRow,
  type RawStaffTicketRow,
  type StaffBreakdownInput,
} from './staffBreakdown';

const PARTNER = 'p-1';
const OTHER_PARTNER = 'p-2';
const NOW = new Date('2026-04-25T10:00:00Z');
const WINDOW_FROM = new Date('2026-04-18T00:00:00Z');

const NAMES = new Map<string, string>([
  ['u-alice', 'Alice'],
  ['u-bob', 'Bob'],
]);

function ticket(over: Partial<RawStaffTicketRow> = {}): RawStaffTicketRow {
  return {
    id: 't-1',
    partnerId: PARTNER,
    supportId: 'u-alice',
    createdAt: new Date('2026-04-22T09:00:00Z'),
    firstStaffResponseAt: new Date('2026-04-22T09:10:00Z'),
    ...over,
  };
}

function rating(over: Partial<RawStaffRatingRow> = {}): RawStaffRatingRow {
  return {
    id: 'r-1',
    partnerId: PARTNER,
    supportId: 'u-alice',
    rating: 4,
    createdAt: new Date('2026-04-22T10:00:00Z'),
    ...over,
  };
}

function input(over: Partial<StaffBreakdownInput> = {}): StaffBreakdownInput {
  return {
    partnerId: PARTNER,
    window: { from: WINDOW_FROM, to: NOW },
    tickets: [],
    ratings: [],
    staffNames: NAMES,
    ...over,
  };
}

describe('buildStaffBreakdown', () => {
  it('returns an empty array when no rows are supplied', () => {
    expect(buildStaffBreakdown(input())).toEqual([]);
  });

  it('aggregates handled / avg response / csat for a single staff member', () => {
    const out = buildStaffBreakdown(
      input({
        tickets: [
          ticket({ id: 't-1' }), // 10 min response
          ticket({
            id: 't-2',
            createdAt: new Date('2026-04-22T09:00:00Z'),
            firstStaffResponseAt: new Date('2026-04-22T09:30:00Z'),
          }), // 30 min response
        ],
        ratings: [
          rating({ id: 'r-1', rating: 4 }),
          rating({ id: 'r-2', rating: 5 }),
        ],
      }),
    );
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      id: 'u-alice',
      name: 'Alice',
      handled: 2,
      avgResponseMinutes: 20,
      csat: 4.5,
    });
  });

  it('emits one row per staff and sorts by handled descending', () => {
    const out = buildStaffBreakdown(
      input({
        tickets: [
          ticket({ id: 't-1', supportId: 'u-alice' }),
          ticket({ id: 't-2', supportId: 'u-bob' }),
          ticket({ id: 't-3', supportId: 'u-bob' }),
          ticket({ id: 't-4', supportId: 'u-bob' }),
        ],
      }),
    );
    expect(out.map((r) => r.id)).toEqual(['u-bob', 'u-alice']);
    expect(out[0].handled).toBe(3);
  });

  it('returns null csat when staff has no ratings', () => {
    const out = buildStaffBreakdown(
      input({
        tickets: [ticket({ supportId: 'u-bob' })],
      }),
    );
    expect(out[0]).toMatchObject({ id: 'u-bob', csat: null });
  });

  it('returns null avgResponseMinutes when none of the staff tickets responded', () => {
    const out = buildStaffBreakdown(
      input({
        tickets: [
          ticket({ supportId: 'u-bob', firstStaffResponseAt: null }),
        ],
      }),
    );
    expect(out[0]).toMatchObject({ id: 'u-bob', handled: 1, avgResponseMinutes: null });
  });

  it('skips tickets with no supportId (no orphan-staff bucket)', () => {
    const out = buildStaffBreakdown(
      input({
        tickets: [
          ticket({ id: 't-1', supportId: 'u-alice' }),
          ticket({ id: 't-orphan', supportId: null }),
        ],
      }),
    );
    expect(out).toHaveLength(1);
    expect(out[0].id).toBe('u-alice');
  });

  it('drops tickets outside the window', () => {
    const out = buildStaffBreakdown(
      input({
        tickets: [
          ticket({ id: 't-in', createdAt: new Date('2026-04-22T09:00:00Z') }),
          ticket({ id: 't-old', createdAt: new Date('2026-01-01T09:00:00Z') }),
        ],
      }),
    );
    expect(out[0].handled).toBe(1);
  });

  it('drops rows with mismatched partnerId (defense in depth)', () => {
    const out = buildStaffBreakdown(
      input({
        tickets: [
          ticket({ id: 't-mine', partnerId: PARTNER, supportId: 'u-alice' }),
          ticket({ id: 't-other', partnerId: OTHER_PARTNER, supportId: 'u-alice' }),
        ],
        ratings: [
          rating({ id: 'r-other', partnerId: OTHER_PARTNER, rating: 1 }),
        ],
      }),
    );
    expect(out[0].handled).toBe(1);
    expect(out[0].csat).toBeNull();
  });

  it('falls back to the staff id when the name map has no entry', () => {
    const out = buildStaffBreakdown(
      input({
        tickets: [ticket({ supportId: 'u-ghost' })],
        staffNames: new Map(),
      }),
    );
    expect(out[0]).toMatchObject({ id: 'u-ghost', name: 'u-ghost' });
  });

  it('rounds avgResponseMinutes to one decimal', () => {
    const out = buildStaffBreakdown(
      input({
        tickets: [
          ticket({
            id: 't-1',
            createdAt: new Date('2026-04-22T09:00:00Z'),
            firstStaffResponseAt: new Date('2026-04-22T09:01:00Z'), // 1 min
          }),
          ticket({
            id: 't-2',
            createdAt: new Date('2026-04-22T09:00:00Z'),
            firstStaffResponseAt: new Date('2026-04-22T09:04:00Z'), // 4 min
          }),
        ],
      }),
    );
    expect(out[0].avgResponseMinutes).toBe(2.5);
  });
});
