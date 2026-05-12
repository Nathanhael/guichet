import { describe, it, expect } from 'vitest';
import { classifyRollupRows } from './scorecardQueries.js';
import type { DepartmentSlaConfig } from '../sla/index.js';
import type { BusinessHoursSchedule } from '../businessHours.js';

const MON_TO_FRI_9_TO_17: BusinessHoursSchedule = {
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
};

const SLA: DepartmentSlaConfig = { enabled: true, firstResponseMinutes: 30, warnAtPercent: 75 };
const slaMap = new Map<string, DepartmentSlaConfig>([['general', SLA]]);

describe('classifyRollupRows', () => {
  it('counts a within-hours response as met when business-hours minutes <= threshold', () => {
    // Monday 10:00 created, Monday 10:20 responded → 20 BH minutes, threshold 30 → met
    const result = classifyRollupRows(
      [{
        dept: 'general',
        createdAt: '2026-04-20T10:00:00+02:00',
        firstStaffResponseAt: '2026-04-20T10:20:00+02:00',
      }],
      slaMap,
      MON_TO_FRI_9_TO_17,
    );
    expect(result.ticketsMetSla).toBe(1);
    expect(result.ticketsWithResponse).toBe(1);
  });

  it('counts a within-hours response as missed when business-hours minutes > threshold', () => {
    // Monday 10:00 created, Monday 11:00 responded → 60 BH minutes, threshold 30 → missed
    const result = classifyRollupRows(
      [{
        dept: 'general',
        createdAt: '2026-04-20T10:00:00+02:00',
        firstStaffResponseAt: '2026-04-20T11:00:00+02:00',
      }],
      slaMap,
      MON_TO_FRI_9_TO_17,
    );
    expect(result.ticketsMetSla).toBe(0);
    expect(result.ticketsWithResponse).toBe(1);
  });

  it('counts a Friday-evening to Monday-morning response as met (business-hours paused)', () => {
    // Friday 16:55 created, Monday 09:05 responded.
    // Wall-clock: ~64 hours → would fail the legacy >30min check.
    // Business hours: 5 min Friday (16:55→17:00) + 5 min Monday (09:00→09:05) = 10 BH min.
    // Threshold 30 → met. This is the divergence that PR #144 set up to fix.
    const result = classifyRollupRows(
      [{
        dept: 'general',
        createdAt: '2026-04-17T16:55:00+02:00', // Friday
        firstStaffResponseAt: '2026-04-20T09:05:00+02:00', // Monday
      }],
      slaMap,
      MON_TO_FRI_9_TO_17,
    );
    expect(result.ticketsMetSla).toBe(1);
    expect(result.ticketsWithResponse).toBe(1);
  });

  it('skips clock-skewed rows (response before creation)', () => {
    const result = classifyRollupRows(
      [{
        dept: 'general',
        createdAt: '2026-04-20T10:30:00+02:00',
        firstStaffResponseAt: '2026-04-20T10:00:00+02:00',
      }],
      slaMap,
      MON_TO_FRI_9_TO_17,
    );
    expect(result.ticketsMetSla).toBe(0);
    expect(result.ticketsWithResponse).toBe(0);
  });

  it('does not count tickets without a first staff response', () => {
    const result = classifyRollupRows(
      [{
        dept: 'general',
        createdAt: '2026-04-20T10:00:00+02:00',
        firstStaffResponseAt: null,
      }],
      slaMap,
      MON_TO_FRI_9_TO_17,
    );
    expect(result.ticketsMetSla).toBe(0);
    expect(result.ticketsWithResponse).toBe(0);
    expect(result.responseMinutesList).toEqual([]);
  });

  it('uses wall-clock for the response-minutes list (p95 input)', () => {
    // 30 wall-clock minutes — the p95 input should reflect that, even when
    // business hours would say otherwise.
    const result = classifyRollupRows(
      [{
        dept: 'general',
        createdAt: '2026-04-20T10:00:00+02:00',
        firstStaffResponseAt: '2026-04-20T10:30:00+02:00',
      }],
      slaMap,
      MON_TO_FRI_9_TO_17,
    );
    expect(result.responseMinutesList).toEqual([30]);
  });

  it('disabled SLA config never counts as met', () => {
    const disabled = new Map<string, DepartmentSlaConfig>([
      ['general', { enabled: false, firstResponseMinutes: 30, warnAtPercent: 75 }],
    ]);
    const result = classifyRollupRows(
      [{
        dept: 'general',
        createdAt: '2026-04-20T10:00:00+02:00',
        firstStaffResponseAt: '2026-04-20T10:05:00+02:00',
      }],
      disabled,
      MON_TO_FRI_9_TO_17,
    );
    expect(result.ticketsMetSla).toBe(0);
    expect(result.ticketsWithResponse).toBe(1); // still counted for response metrics
  });

  it('tickets in dept with no SLA config never count as met', () => {
    const result = classifyRollupRows(
      [{
        dept: 'unmapped-dept',
        createdAt: '2026-04-20T10:00:00+02:00',
        firstStaffResponseAt: '2026-04-20T10:05:00+02:00',
      }],
      slaMap,
      MON_TO_FRI_9_TO_17,
    );
    expect(result.ticketsMetSla).toBe(0);
    expect(result.ticketsWithResponse).toBe(1);
  });
});
