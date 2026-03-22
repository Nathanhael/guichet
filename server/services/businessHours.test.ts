import { describe, expect, it } from 'vitest';
import {
  getBusinessHoursStatus,
  type BusinessHoursSchedule,
} from './businessHours.js';

function buildSchedule(overrides?: Partial<BusinessHoursSchedule>): BusinessHoursSchedule {
  return {
    version: 1,
    timezone: 'Europe/Brussels',
    weekly: {
      mon: { closed: false, windows: [{ start: '07:30', end: '22:30' }] },
      tue: { closed: false, windows: [{ start: '07:30', end: '22:30' }] },
      wed: { closed: false, windows: [{ start: '07:30', end: '22:30' }] },
      thu: { closed: false, windows: [{ start: '07:30', end: '22:30' }] },
      fri: { closed: false, windows: [{ start: '07:30', end: '22:30' }] },
      sat: { closed: true, windows: [] },
      sun: { closed: true, windows: [] },
    },
    exceptions: [],
    ...overrides,
  };
}

describe('getBusinessHoursStatus', () => {
  it('reports open within a weekday window', () => {
    const status = getBusinessHoursStatus(
      { businessHoursSchedule: buildSchedule() },
      new Date('2026-03-23T10:00:00+01:00')
    );

    expect(status.isOpen).toBe(true);
    expect(status.source).toBe('weekly');
    expect(status.matchedWindow).toEqual({ start: '07:30', end: '22:30' });
    expect(status.nextCloseAt).toBeDefined();
  });

  it('reports closed outside a weekday window', () => {
    const status = getBusinessHoursStatus(
      { businessHoursSchedule: buildSchedule() },
      new Date('2026-03-23T06:00:00+01:00')
    );

    expect(status.isOpen).toBe(false);
    expect(status.nextOpenAt).toBeDefined();
    expect(status.message).toContain('closed');
  });

  it('uses exception windows over weekly defaults', () => {
    const schedule = buildSchedule({
      exceptions: [
        {
          id: 'holiday-short-day',
          date: '2026-03-23',
          windows: [{ start: '12:00', end: '14:00' }],
        },
      ],
    });

    const status = getBusinessHoursStatus(
      { businessHoursSchedule: schedule },
      new Date('2026-03-23T10:00:00+01:00')
    );

    expect(status.isOpen).toBe(false);
    expect(status.source).toBe('exception');
    expect(status.nextOpenAt).toContain('2026-03-23T12:00:00');
  });

  it('supports overnight windows', () => {
    const schedule = buildSchedule({
      weekly: {
        mon: { closed: false, windows: [{ start: '22:00', end: '06:00' }] },
        tue: { closed: true, windows: [] },
        wed: { closed: true, windows: [] },
        thu: { closed: true, windows: [] },
        fri: { closed: true, windows: [] },
        sat: { closed: true, windows: [] },
        sun: { closed: true, windows: [] },
      },
    });

    const status = getBusinessHoursStatus(
      { businessHoursSchedule: schedule },
      new Date('2026-03-23T23:30:00+01:00')
    );

    expect(status.isOpen).toBe(true);
    expect(status.matchedWindow).toEqual({ start: '22:00', end: '06:00' });
    expect(status.nextCloseAt).toContain('06:00:00');
  });
});
