import { describe, it, expect } from 'vitest';
import {
  buildDeptBreakdown,
  type DeptBreakdownInput,
  type DeptConfig,
  type RawTicketRow,
  type RawRatingRow,
  type RawBreachRow,
} from './deptBreakdown';

const PARTNER = 'p-1';
const OTHER_PARTNER = 'p-2';
const NOW = new Date('2026-04-25T10:00:00Z');
const WINDOW_FROM = new Date('2026-04-18T00:00:00Z');

const DEPTS: DeptConfig[] = [
  {
    id: 'sales',
    name: 'Sales',
    sla: { enabled: true, firstResponseMinutes: 30 },
  },
  {
    id: 'support',
    name: 'Support',
    sla: { enabled: true, firstResponseMinutes: 60 },
  },
];

function ticket(over: Partial<RawTicketRow> = {}): RawTicketRow {
  return {
    id: 't-1',
    partnerId: PARTNER,
    dept: 'sales',
    createdAt: new Date('2026-04-22T09:00:00Z'),
    firstStaffResponseAt: new Date('2026-04-22T09:10:00Z'),
    ...over,
  };
}

function rating(over: Partial<RawRatingRow> = {}): RawRatingRow {
  return {
    id: 'r-1',
    partnerId: PARTNER,
    dept: 'sales',
    rating: 4,
    createdAt: new Date('2026-04-22T10:00:00Z'),
    ...over,
  };
}

function breach(over: Partial<RawBreachRow> = {}): RawBreachRow {
  return {
    id: 'b-1',
    partnerId: PARTNER,
    dept: 'sales',
    breachedAt: new Date('2026-04-22T09:30:00Z'),
    ...over,
  };
}

function input(over: Partial<DeptBreakdownInput> = {}): DeptBreakdownInput {
  return {
    partnerId: PARTNER,
    window: { from: WINDOW_FROM, to: NOW },
    departments: DEPTS,
    tickets: [],
    ratings: [],
    breaches: [],
    ...over,
  };
}

describe('buildDeptBreakdown', () => {
  it('returns an empty array when no rows are supplied', () => {
    expect(buildDeptBreakdown(input())).toEqual([]);
  });

  it('aggregates volume + slaPct + csat for a single dept', () => {
    const out = buildDeptBreakdown(
      input({
        tickets: [
          ticket({ id: 't-1' }), // responded in 10 min, met
          ticket({
            id: 't-2',
            firstStaffResponseAt: new Date('2026-04-22T10:00:00Z'),
            createdAt: new Date('2026-04-22T09:00:00Z'),
          }), // responded in 60 min, missed (target 30)
        ],
        ratings: [
          rating({ id: 'r-1', rating: 4 }),
          rating({ id: 'r-2', rating: 5 }),
        ],
      }),
    );
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      id: 'sales',
      name: 'Sales',
      volume: 2,
      slaPct: 50,
      csat: 4.5,
      breachCount: 0,
    });
  });

  it('emits one row per dept and sorts by volume descending', () => {
    const out = buildDeptBreakdown(
      input({
        tickets: [
          ticket({ id: 't-1', dept: 'sales' }),
          ticket({ id: 't-2', dept: 'support' }),
          ticket({ id: 't-3', dept: 'support' }),
          ticket({ id: 't-4', dept: 'support' }),
        ],
      }),
    );
    expect(out.map((r) => r.id)).toEqual(['support', 'sales']);
    expect(out[0].volume).toBe(3);
    expect(out[1].volume).toBe(1);
  });

  it('returns null csat when no ratings landed for a dept', () => {
    const out = buildDeptBreakdown(
      input({
        tickets: [ticket({ dept: 'support' })],
      }),
    );
    expect(out[0].csat).toBeNull();
  });

  it('returns null slaPct when no tickets in a dept have a response', () => {
    const out = buildDeptBreakdown(
      input({
        tickets: [
          ticket({
            dept: 'support',
            firstStaffResponseAt: null,
          }),
        ],
      }),
    );
    expect(out[0]).toMatchObject({
      id: 'support',
      slaPct: null,
      volume: 1,
    });
  });

  it('buckets tickets with an unknown dept under "Unknown"', () => {
    const out = buildDeptBreakdown(
      input({
        tickets: [
          ticket({ id: 't-1', dept: 'sales' }),
          ticket({ id: 't-orphan', dept: 'some-old-dept' }),
        ],
      }),
    );
    const unknown = out.find((r) => r.id === '__unknown__');
    expect(unknown).toMatchObject({ name: 'Unknown', volume: 1 });
  });

  it('drops tickets outside the window', () => {
    const out = buildDeptBreakdown(
      input({
        tickets: [
          ticket({ id: 't-in', createdAt: new Date('2026-04-22T09:00:00Z') }),
          ticket({ id: 't-old', createdAt: new Date('2026-01-01T09:00:00Z') }),
        ],
      }),
    );
    expect(out[0].volume).toBe(1);
  });

  it('drops rows with mismatched partnerId (defense in depth)', () => {
    const out = buildDeptBreakdown(
      input({
        tickets: [
          ticket({ id: 't-mine', partnerId: PARTNER }),
          ticket({ id: 't-other', partnerId: OTHER_PARTNER }),
        ],
        ratings: [
          rating({ id: 'r-other', partnerId: OTHER_PARTNER, rating: 1 }),
        ],
      }),
    );
    expect(out[0].volume).toBe(1);
    expect(out[0].csat).toBeNull();
  });

  it('counts breaches per dept and surfaces them on the row', () => {
    const out = buildDeptBreakdown(
      input({
        tickets: [
          ticket({ dept: 'sales' }),
          ticket({ id: 't-2', dept: 'sales' }),
        ],
        breaches: [
          breach({ id: 'b-1', dept: 'sales' }),
          breach({ id: 'b-2', dept: 'sales' }),
          breach({ id: 'b-3', dept: 'support' }),
        ],
      }),
    );
    const sales = out.find((r) => r.id === 'sales')!;
    expect(sales.breachCount).toBe(2);
  });

  it('does not count SLA met when the dept has SLA disabled', () => {
    const out = buildDeptBreakdown(
      input({
        departments: [
          { id: 'sales', name: 'Sales', sla: { enabled: false, firstResponseMinutes: 30 } },
        ],
        tickets: [ticket({ id: 't-1' })], // would be met if SLA enabled
      }),
    );
    expect(out[0].slaPct).toBeNull();
  });
});
