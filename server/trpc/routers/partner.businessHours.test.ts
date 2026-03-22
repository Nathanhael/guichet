import { describe, expect, it } from 'vitest';
import { validatedBusinessHoursScheduleSchema } from './partner.js';

function buildSchedule() {
  return {
    version: 1 as const,
    timezone: 'Europe/Brussels',
    weekly: {
      mon: { closed: false, windows: [{ start: '07:30', end: '12:00' }, { start: '13:00', end: '18:00' }] },
      tue: { closed: false, windows: [{ start: '07:30', end: '22:30' }] },
      wed: { closed: false, windows: [{ start: '07:30', end: '22:30' }] },
      thu: { closed: false, windows: [{ start: '07:30', end: '22:30' }] },
      fri: { closed: false, windows: [{ start: '07:30', end: '22:30' }] },
      sat: { closed: true, windows: [] },
      sun: { closed: true, windows: [] },
    },
    exceptions: [] as Array<{ id: string; date: string; closed?: boolean; windows?: Array<{ start: string; end: string }>; note?: string }>,
  };
}

describe('validatedBusinessHoursScheduleSchema', () => {
  it('accepts a valid schedule', () => {
    const result = validatedBusinessHoursScheduleSchema.safeParse(buildSchedule());
    expect(result.success).toBe(true);
  });

  it('rejects overlapping day windows', () => {
    const schedule = buildSchedule();
    schedule.weekly.mon.windows = [
      { start: '08:00', end: '12:00' },
      { start: '11:00', end: '13:00' },
    ];

    const result = validatedBusinessHoursScheduleSchema.safeParse(schedule);
    expect(result.success).toBe(false);
    expect(result.error?.issues.some((issue) => issue.message.includes('overlap'))).toBe(true);
  });

  it('rejects invalid timezones', () => {
    const schedule = buildSchedule();
    schedule.timezone = 'Mars/Olympus';

    const result = validatedBusinessHoursScheduleSchema.safeParse(schedule);
    expect(result.success).toBe(false);
    expect(result.error?.issues.some((issue) => issue.path.join('.') === 'timezone')).toBe(true);
  });

  it('rejects duplicate exception dates', () => {
    const schedule = buildSchedule();
    schedule.exceptions = [
      { id: 'a', date: '2026-12-25', closed: true },
      { id: 'b', date: '2026-12-25', closed: true },
    ];

    const result = validatedBusinessHoursScheduleSchema.safeParse(schedule);
    expect(result.success).toBe(false);
    expect(result.error?.issues.some((issue) => issue.message.includes('unique'))).toBe(true);
  });

  it('rejects closed exceptions with windows', () => {
    const schedule = buildSchedule();
    schedule.exceptions = [
      {
        id: 'a',
        date: '2026-12-25',
        closed: true,
        windows: [{ start: '09:00', end: '12:00' }],
      },
    ];

    const result = validatedBusinessHoursScheduleSchema.safeParse(schedule);
    expect(result.success).toBe(false);
    expect(result.error?.issues.some((issue) => issue.message.includes('cannot include windows'))).toBe(true);
  });
});
