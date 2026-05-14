import { describe, it, expect } from 'vitest';
import { resolveDateRange } from '../dashboardDateRange';
import type { DashboardFilters } from '../../hooks/useDashboardFilters';

const NOW = new Date('2026-04-25T14:30:00Z');

function filters(over: Partial<DashboardFilters>): DashboardFilters {
  return {
    preset: '7d',
    excludeWeekends: false,
    dateFrom: undefined,
    dateTo: undefined,
    dept: undefined,
    ...over,
  };
}

describe('resolveDateRange', () => {
  it('today preset returns the same date for from + to', () => {
    expect(resolveDateRange(filters({ preset: 'today' }), NOW)).toEqual({
      dateFrom: '2026-04-25',
      dateTo: '2026-04-25',
    });
  });

  it('7d preset spans 7 days inclusive (today minus 6)', () => {
    expect(resolveDateRange(filters({ preset: '7d' }), NOW)).toEqual({
      dateFrom: '2026-04-19',
      dateTo: '2026-04-25',
    });
  });

  it('14d preset spans 14 days inclusive', () => {
    expect(resolveDateRange(filters({ preset: '14d' }), NOW)).toEqual({
      dateFrom: '2026-04-12',
      dateTo: '2026-04-25',
    });
  });

  it('30d preset spans 30 days inclusive', () => {
    expect(resolveDateRange(filters({ preset: '30d' }), NOW)).toEqual({
      dateFrom: '2026-03-27',
      dateTo: '2026-04-25',
    });
  });

  it('custom preset returns the stored dates as-is', () => {
    expect(
      resolveDateRange(
        filters({ preset: 'custom', dateFrom: '2026-01-01', dateTo: '2026-02-15' }),
        NOW,
      ),
    ).toEqual({ dateFrom: '2026-01-01', dateTo: '2026-02-15' });
  });

  it('falls back to today when custom is missing one or both dates', () => {
    expect(resolveDateRange(filters({ preset: 'custom' }), NOW)).toEqual({
      dateFrom: '2026-04-25',
      dateTo: '2026-04-25',
    });
  });

  it('crosses month boundaries correctly', () => {
    const earlyMay = new Date('2026-05-02T10:00:00Z');
    expect(resolveDateRange(filters({ preset: '7d' }), earlyMay)).toEqual({
      dateFrom: '2026-04-26',
      dateTo: '2026-05-02',
    });
  });
});
