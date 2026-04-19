import { describe, expect, it } from 'vitest';
import { computeSlaState, type ComputeSlaInput } from './sla.js';
import type { BusinessHoursSchedule } from './businessHours.js';
import type { DepartmentSlaConfig } from './sla.js';

function buildSchedule(overrides?: Partial<BusinessHoursSchedule>): BusinessHoursSchedule {
  return {
    version: 1,
    timezone: 'Europe/Brussels',
    weekly: {
      mon: { closed: false, windows: [{ start: '09:00', end: '17:00' }] },
      tue: { closed: false, windows: [{ start: '09:00', end: '17:00' }] },
      wed: { closed: false, windows: [{ start: '09:00', end: '17:00' }] },
      thu: { closed: false, windows: [{ start: '09:00', end: '17:00' }] },
      fri: { closed: false, windows: [{ start: '09:00', end: '17:00' }] },
      sat: { closed: true, windows: [] },
      sun: { closed: true, windows: [] },
    },
    exceptions: [],
    ...overrides,
  };
}

function buildInput(overrides: Partial<ComputeSlaInput> = {}): ComputeSlaInput {
  return {
    ticketCreatedAt: new Date('2026-04-20T10:00:00+02:00').toISOString(),
    firstStaffResponseAt: null,
    sla: { enabled: true, firstResponseMinutes: 30, warnAtPercent: 75 },
    schedule: buildSchedule(),
    now: new Date('2026-04-20T10:10:00+02:00'),
    ...overrides,
  };
}

describe('computeSlaState', () => {
  it('returns disabled when SLA is off', () => {
    const state = computeSlaState(buildInput({ sla: { enabled: false, firstResponseMinutes: 30, warnAtPercent: 75 } }));
    expect(state.status).toBe('disabled');
  });

  it('returns ok when elapsed is below warn threshold', () => {
    const state = computeSlaState(buildInput());
    expect(state.status).toBe('ok');
    if (state.status === 'ok') {
      expect(state.elapsedMinutes).toBe(10);
      expect(state.remainingMinutes).toBe(20);
    }
  });

  it('returns warning at or above warnAtPercent', () => {
    const state = computeSlaState(buildInput({ now: new Date('2026-04-20T10:23:00+02:00') }));
    expect(state.status).toBe('warning');
  });

  it('returns breached once threshold exceeded', () => {
    const state = computeSlaState(buildInput({ now: new Date('2026-04-20T10:45:00+02:00') }));
    expect(state.status).toBe('breached');
    if (state.status === 'breached') {
      expect(state.overdueMinutes).toBe(15);
    }
  });

  it('returns met when firstStaffResponseAt is set', () => {
    const state = computeSlaState(buildInput({ firstStaffResponseAt: '2026-04-20T10:20:00+02:00' }));
    expect(state.status).toBe('met');
    if (state.status === 'met') {
      expect(state.respondedInMinutes).toBe(20);
    }
  });

  it('pauses elapsed counter outside business hours', () => {
    const state = computeSlaState(buildInput({
      ticketCreatedAt: '2026-04-17T16:50:00+02:00',
      now: new Date('2026-04-20T09:05:00+02:00'),
    }));
    expect(state.status).toBe('ok');
    if (state.status === 'ok') {
      expect(state.elapsedMinutes).toBe(15);
    }
  });

  it('breach fires Monday, not Friday, for overnight weekend ticket', () => {
    const state = computeSlaState(buildInput({
      ticketCreatedAt: '2026-04-17T16:55:00+02:00',
      now: new Date('2026-04-20T09:30:00+02:00'),
    }));
    expect(state.status).toBe('breached');
  });
});
