import { describe, it, expect, vi, afterEach } from 'vitest';
import { getSmartTimestamp } from '../dateUtils';

describe('getSmartTimestamp', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns time only for today', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-05T14:30:00Z'));
    expect(getSmartTimestamp('2026-04-05T09:15:00Z')).toBe('09:15');
    vi.useRealTimers();
  });

  it('returns "Yest HH:mm" for yesterday', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-05T14:30:00Z'));
    expect(getSmartTimestamp('2026-04-04T16:45:00Z')).toBe('Yest 16:45');
    vi.useRealTimers();
  });

  it('returns "Day HH:mm" for 2-6 days ago', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-05T14:30:00Z'));
    expect(getSmartTimestamp('2026-04-02T10:00:00Z')).toBe('Thu 10:00');
    vi.useRealTimers();
  });

  it('returns "DD MMM" for older dates', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-05T14:30:00Z'));
    expect(getSmartTimestamp('2026-03-15T08:00:00Z')).toBe('15 Mar');
    vi.useRealTimers();
  });

  it('returns dash for undefined input', () => {
    expect(getSmartTimestamp(undefined)).toBe('—');
  });

  it('returns dash for invalid date', () => {
    expect(getSmartTimestamp('not-a-date')).toBe('—');
  });
});
