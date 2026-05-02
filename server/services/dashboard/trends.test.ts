import { describe, it, expect } from 'vitest';
import {
  buildTrends,
  type TrendsInput,
  type TrendsDailyRow,
} from './trends';

const NOW = new Date('2026-04-25T10:00:00Z');

function row(date: string, over: Partial<TrendsDailyRow> = {}): TrendsDailyRow {
  return {
    date,
    total: 0,
    ratingSum: 0,
    ratingCount: 0,
    responseSumMs: 0,
    responseCount: 0,
    ...over,
  };
}

function input(over: Partial<TrendsInput> = {}): TrendsInput {
  return {
    rows: [],
    window: {
      from: new Date('2026-04-19T00:00:00Z'),
      to: new Date('2026-04-25T23:59:59Z'),
    },
    now: NOW,
    excludeWeekends: false,
    ...over,
  };
}

describe('buildTrends', () => {
  it('returns empty series and daily granularity on empty input', () => {
    const out = buildTrends(input());
    expect(out.granularity).toBe('daily');
    expect(out.series.volume).toEqual([]);
    expect(out.series.csat).toEqual([]);
    expect(out.series.avgResponseMinutes).toEqual([]);
  });

  it('chooses daily granularity for windows <= 14 days', () => {
    const out = buildTrends(
      input({
        window: {
          from: new Date('2026-04-12T00:00:00Z'),
          to: new Date('2026-04-25T23:59:59Z'),
        },
      }),
    );
    expect(out.granularity).toBe('daily');
  });

  it('chooses weekly granularity for windows between 15 and 90 days', () => {
    const out = buildTrends(
      input({
        window: {
          from: new Date('2026-03-26T00:00:00Z'), // 30 days
          to: new Date('2026-04-25T23:59:59Z'),
        },
      }),
    );
    expect(out.granularity).toBe('weekly');
  });

  it('chooses monthly granularity for windows > 90 days', () => {
    const out = buildTrends(
      input({
        window: {
          from: new Date('2025-12-01T00:00:00Z'),
          to: new Date('2026-04-25T23:59:59Z'),
        },
      }),
    );
    expect(out.granularity).toBe('monthly');
  });

  it('sums per-bucket volume from row.total', () => {
    const out = buildTrends(
      input({
        rows: [
          row('2026-04-19', { total: 5 }),
          row('2026-04-20', { total: 7 }),
          row('2026-04-21', { total: 3 }),
        ],
      }),
    );
    expect(out.series.volume).toEqual([
      { bucket: '2026-04-19', value: 5 },
      { bucket: '2026-04-20', value: 7 },
      { bucket: '2026-04-21', value: 3 },
    ]);
  });

  it('computes per-bucket CSAT from ratingSum / ratingCount', () => {
    const out = buildTrends(
      input({
        rows: [
          row('2026-04-19', { total: 1, ratingSum: 8, ratingCount: 2 }),
          row('2026-04-20', { total: 1, ratingSum: 0, ratingCount: 0 }),
          row('2026-04-21', { total: 1, ratingSum: 5, ratingCount: 1 }),
        ],
      }),
    );
    expect(out.series.csat).toEqual([
      { bucket: '2026-04-19', value: 4 },
      { bucket: '2026-04-20', value: null },
      { bucket: '2026-04-21', value: 5 },
    ]);
  });

  it('computes per-bucket avg response time in minutes from response sums', () => {
    const out = buildTrends(
      input({
        rows: [
          row('2026-04-19', { total: 1, responseSumMs: 600_000, responseCount: 2 }), // 10min total -> 5min avg
          row('2026-04-20', { total: 1, responseSumMs: 0, responseCount: 0 }),
        ],
      }),
    );
    expect(out.series.avgResponseMinutes).toEqual([
      { bucket: '2026-04-19', value: 5 },
      { bucket: '2026-04-20', value: null },
    ]);
  });

  it('rolls daily rows up into weekly buckets keyed on the Monday of each ISO week', () => {
    const out = buildTrends(
      input({
        window: {
          from: new Date('2026-03-26T00:00:00Z'),
          to: new Date('2026-04-25T23:59:59Z'),
        },
        rows: [
          row('2026-04-13', { total: 2 }), // Mon week-of-2026-04-13
          row('2026-04-15', { total: 5 }), // Wed same week
          row('2026-04-20', { total: 7 }), // Mon week-of-2026-04-20
        ],
      }),
    );
    expect(out.granularity).toBe('weekly');
    expect(out.series.volume).toEqual([
      { bucket: '2026-04-13', value: 7 },
      { bucket: '2026-04-20', value: 7 },
    ]);
  });

  it('rolls daily rows up into monthly buckets keyed on the first of the month', () => {
    const out = buildTrends(
      input({
        window: {
          from: new Date('2025-12-01T00:00:00Z'),
          to: new Date('2026-04-25T23:59:59Z'),
        },
        rows: [
          row('2026-01-15', { total: 5 }),
          row('2026-01-22', { total: 3 }),
          row('2026-02-10', { total: 4 }),
        ],
      }),
    );
    expect(out.granularity).toBe('monthly');
    expect(out.series.volume).toEqual([
      { bucket: '2026-01-01', value: 8 },
      { bucket: '2026-02-01', value: 4 },
    ]);
  });

  it('drops weekend rows from every series when excludeWeekends is true', () => {
    const out = buildTrends(
      input({
        excludeWeekends: true,
        rows: [
          row('2026-04-25', { total: 9 }), // Saturday
          row('2026-04-19', { total: 4 }), // Sunday
          row('2026-04-21', { total: 5 }), // Tuesday
        ],
      }),
    );
    expect(out.series.volume).toEqual([{ bucket: '2026-04-21', value: 5 }]);
  });

  it('drops rows outside the window', () => {
    const out = buildTrends(
      input({
        rows: [
          row('2026-04-21', { total: 5 }),
          row('2026-01-01', { total: 99 }),
        ],
      }),
    );
    expect(out.series.volume).toEqual([{ bucket: '2026-04-21', value: 5 }]);
  });

  it('rounds CSAT and avg response to one decimal place', () => {
    const out = buildTrends(
      input({
        rows: [
          row('2026-04-19', {
            total: 1,
            ratingSum: 7,
            ratingCount: 3, // 2.333
            responseSumMs: 100_000, // ~1.667 min
            responseCount: 1,
          }),
        ],
      }),
    );
    expect(out.series.csat[0].value).toBe(2.3);
    expect(out.series.avgResponseMinutes[0].value).toBe(1.7);
  });
});
