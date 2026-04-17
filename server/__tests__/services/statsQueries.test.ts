import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { __schemas } from '../../services/statsQueries.js';

const source = readFileSync(
  join(__dirname, '../../services/statsQueries.ts'),
  'utf-8',
);

/**
 * Guard against silent column-rename regressions in the dashboard stats
 * pipeline. The old `as unknown as RowType[]` casts (M4) let a missing SQL
 * alias propagate as `undefined` into the UI; the schemas below now fail fast
 * on any shape drift at boot-time of the query, not at display-time.
 *
 * Two axes are covered:
 *   1. Direct Zod parse behaviour — reject malformed rows, accept stringified
 *      aggregates (pg returns COUNT / SUM / AVG as strings).
 *   2. Source-inspection — every raw SELECT routes through `parseRows` with a
 *      context label that points back at the function on failure.
 */

describe('statsQueries — row-shape validation', () => {
  const {
    historicalStatSchema,
    ratingSchema,
    ticketSentimentSchema,
    deptSentimentSchema,
    prevHistSchema,
    labelCountSchema,
    parseRows,
  } = __schemas;

  describe('historicalStatSchema', () => {
    it('accepts a well-formed row with pg numeric aliases as strings', () => {
      const row = {
        date: '2026-04-01',
        total: '12', closed: '10', abandoned: '2',
        avgResponseMs: '34000', avgDurationMs: '120000',
        avgRating: '4.3', ratingCount: '5',
        responseCount: '8', p95ResponseMs: '80000',
        reopened: '1', sentimentSum: '3.4', sentimentCount: '4',
        deptCounts: '{}', ratingsByDept: '{}', hourly: '[]',
      };
      const parsed = historicalStatSchema.parse(row);
      expect(parsed.total).toBe(12);
      expect(parsed.avgRating).toBe(4.3);
    });

    it('rejects a row missing a required column (simulates forgotten AS alias)', () => {
      const row = {
        date: '2026-04-01',
        total: 12,
        // closed intentionally omitted — old cast would have let this through
        abandoned: 2, avgResponseMs: 0, avgDurationMs: 0,
        avgRating: null, ratingCount: 0, responseCount: 0,
        p95ResponseMs: 0, reopened: 0, sentimentSum: 0, sentimentCount: 0,
        deptCounts: '{}', ratingsByDept: '{}', hourly: '[]',
      };
      expect(() => historicalStatSchema.parse(row)).toThrow();
    });

    it('accepts null for avgRating (no ratings in window)', () => {
      const row = {
        date: '2026-04-01', total: 0, closed: 0, abandoned: 0,
        avgResponseMs: 0, avgDurationMs: 0,
        avgRating: null, ratingCount: 0,
        responseCount: 0, p95ResponseMs: 0, reopened: 0,
        sentimentSum: 0, sentimentCount: 0,
        deptCounts: '{}', ratingsByDept: '{}', hourly: '[]',
      };
      expect(() => historicalStatSchema.parse(row)).not.toThrow();
    });
  });

  describe('ratingSchema', () => {
    it('requires id, ticketId, supportId (nullable), rating, createdAt', () => {
      const row = {
        id: 'r1', ticketId: 't1', supportId: null,
        rating: 5, createdAt: '2026-04-01T00:00:00Z',
      };
      const parsed = ratingSchema.parse(row);
      expect(parsed.supportId).toBeNull();
      expect(parsed.rating).toBe(5);
    });

    it('coerces a Date createdAt to ISO string', () => {
      const d = new Date('2026-04-01T00:00:00Z');
      const parsed = ratingSchema.parse({
        id: 'r1', ticketId: 't1', supportId: 'u1', rating: 4, createdAt: d,
      });
      expect(parsed.createdAt).toBe(d.toISOString());
    });

    it('rejects when supportId is missing entirely (not just null)', () => {
      const row = { id: 'r1', ticketId: 't1', rating: 3, createdAt: '2026-04-01' };
      expect(() => ratingSchema.parse(row)).toThrow();
    });
  });

  describe('ticketSentimentSchema', () => {
    it('coerces stringified AVG/COUNT to numbers', () => {
      const parsed = ticketSentimentSchema.parse({
        ticketId: 't1', sentimentAvg: '0.42', sentimentCount: '3',
      });
      expect(parsed.sentimentAvg).toBe(0.42);
      expect(parsed.sentimentCount).toBe(3);
    });

    it('allows null sentimentAvg (no sentiment-scored messages)', () => {
      expect(() => ticketSentimentSchema.parse({
        ticketId: 't1', sentimentAvg: null, sentimentCount: '0',
      })).not.toThrow();
    });

    it('rejects when ticketId is missing', () => {
      expect(() => ticketSentimentSchema.parse({
        sentimentAvg: null, sentimentCount: '0',
      })).toThrow();
    });
  });

  describe('deptSentimentSchema', () => {
    it('requires a non-null dept (tickets.dept is NOT NULL)', () => {
      expect(() => deptSentimentSchema.parse({
        dept: null, sentimentAvg: 0.5, sentimentCount: 2,
      })).toThrow();
    });
  });

  describe('prevHistSchema', () => {
    it('allows every aggregate to be null (empty previous window)', () => {
      const row = {
        total: null, avgresp: null, avgdur: null, abandoned: null, avgrat: null,
      };
      expect(() => prevHistSchema.parse(row)).not.toThrow();
    });
  });

  describe('labelCountSchema', () => {
    it('coerces count from string and requires a non-null dept', () => {
      const parsed = labelCountSchema.parse({ name: 'urgent', dept: 'sales', count: '7' });
      expect(parsed.count).toBe(7);
      expect(() => labelCountSchema.parse({ name: 'urgent', dept: null, count: '7' })).toThrow();
    });
  });

  describe('parseRows helper', () => {
    it('throws a context-tagged error on shape mismatch', () => {
      expect(() =>
        parseRows([{ bad: true }], ticketSentimentSchema, 'fetchTicketSentiment'),
      ).toThrow(/fetchTicketSentiment/);
    });

    it('treats null rows as an empty array', () => {
      expect(parseRows(null, ticketSentimentSchema, 'fetchTicketSentiment')).toEqual([]);
    });
  });
});

describe('statsQueries — every raw SELECT routes through parseRows', () => {
  const guardedFns = [
    'fetchHistoricalStats',
    'fetchRatings',
    'fetchTicketSentiment',
    'fetchDeptSentiment',
    'fetchWaitingTickets',
    'fetchPreviousPeriodStats',
    'fetchLabelSummary',
  ];

  for (const fn of guardedFns) {
    it(`${fn} uses parseRows with its own context label`, () => {
      const re = new RegExp(`parseRows\\([^;]*?['"]${fn}['"]`);
      expect(source).toMatch(re);
    });
  }

  it('no stats query uses the old `as unknown as` cast path', () => {
    // fetchLiveTickets is the one exception — it returns a shared Ticket type
    // defined in types/index.ts (20+ fields) and still uses the cast. All other
    // raw queries must be validated. Count only `return ... as unknown as` —
    // comments mentioning the historical pattern don't count.
    const casts = source.match(/return[^;]*?as unknown as/g) || [];
    expect(casts.length).toBe(1);
  });
});
