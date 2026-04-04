import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../config.js', () => ({
  default: {
    SLA_THRESHOLD_MS: 180_000, // 3 minutes default
  },
}));

const getBusinessHoursStatusMock = vi.fn();

vi.mock('./businessHours.js', () => ({
  getBusinessHoursStatus: (...args: unknown[]) => getBusinessHoursStatusMock(...args),
}));

import { parseSlaConfig, getEffectiveSla, calculateSlaDueDate } from './sla.js';
import type { SlaConfig } from './sla.js';

// ── parseSlaConfig ──────────────────────────────────────────────────────────

describe('parseSlaConfig', () => {
  it('returns null for null input', () => {
    expect(parseSlaConfig(null)).toBeNull();
  });

  it('returns null for undefined input', () => {
    expect(parseSlaConfig(undefined)).toBeNull();
  });

  it('returns null for non-object input', () => {
    expect(parseSlaConfig('hello')).toBeNull();
    expect(parseSlaConfig(42)).toBeNull();
    expect(parseSlaConfig(true)).toBeNull();
  });

  it('returns null for empty object (unconfigured)', () => {
    expect(parseSlaConfig({})).toBeNull();
  });

  it('parses valid config with explicit values', () => {
    const raw = {
      defaultResponseMs: 300_000,
      defaultResolutionMs: 3_600_000,
      businessHoursOnly: true,
    };
    const result = parseSlaConfig(raw);
    expect(result).toEqual({
      defaultResponseMs: 300_000,
      defaultResolutionMs: 3_600_000,
      byDepartment: undefined,
      businessHoursOnly: true,
    });
  });

  it('falls back to config defaults when fields are missing', () => {
    const raw = { businessHoursOnly: false };
    const result = parseSlaConfig(raw);
    expect(result).not.toBeNull();
    // defaultResponseMs falls back to config.SLA_THRESHOLD_MS = 180_000
    expect(result!.defaultResponseMs).toBe(180_000);
    // defaultResolutionMs falls back to 24h
    expect(result!.defaultResolutionMs).toBe(24 * 60 * 60 * 1000);
    expect(result!.businessHoursOnly).toBe(false);
  });

  it('defaults businessHoursOnly to false when not a boolean', () => {
    const raw = { defaultResponseMs: 120_000 };
    const result = parseSlaConfig(raw);
    expect(result!.businessHoursOnly).toBe(false);
  });

  it('clamps responseMs below minimum (1 minute) to minimum', () => {
    const raw = { defaultResponseMs: 100 }; // well below 60_000
    const result = parseSlaConfig(raw);
    expect(result!.defaultResponseMs).toBe(60_000);
  });

  it('clamps responseMs above maximum (30 days) to maximum', () => {
    const thirtyOneDays = 31 * 24 * 60 * 60 * 1000;
    const raw = { defaultResponseMs: thirtyOneDays };
    const result = parseSlaConfig(raw);
    expect(result!.defaultResponseMs).toBe(30 * 24 * 60 * 60 * 1000);
  });

  it('clamps resolutionMs below minimum to minimum', () => {
    const raw = { defaultResolutionMs: 10 };
    const result = parseSlaConfig(raw);
    expect(result!.defaultResolutionMs).toBe(60_000);
  });

  it('parses byDepartment config', () => {
    const raw = {
      defaultResponseMs: 180_000,
      byDepartment: {
        billing: { responseMs: 120_000, resolutionMs: 7_200_000 },
        sales: { responseMs: 300_000, resolutionMs: 14_400_000 },
      },
    };
    const result = parseSlaConfig(raw);
    expect(result!.byDepartment).toEqual({
      billing: { responseMs: 120_000, resolutionMs: 7_200_000 },
      sales: { responseMs: 300_000, resolutionMs: 14_400_000 },
    });
  });

  it('clamps department config values', () => {
    const raw = {
      defaultResponseMs: 180_000,
      byDepartment: {
        billing: { responseMs: 10, resolutionMs: 999_999_999_999 },
      },
    };
    const result = parseSlaConfig(raw);
    expect(result!.byDepartment!.billing.responseMs).toBe(60_000);
    expect(result!.byDepartment!.billing.resolutionMs).toBe(30 * 24 * 60 * 60 * 1000);
  });

  it('ignores invalid department entries (missing fields)', () => {
    const raw = {
      defaultResponseMs: 180_000,
      byDepartment: {
        billing: { responseMs: 120_000 }, // missing resolutionMs
        sales: 'invalid',
        support: { responseMs: 300_000, resolutionMs: 600_000 },
      },
    };
    const result = parseSlaConfig(raw);
    // billing and sales are ignored, only support is valid
    expect(result!.byDepartment).toEqual({
      support: { responseMs: 300_000, resolutionMs: 600_000 },
    });
  });

  it('returns undefined byDepartment when all entries are invalid', () => {
    const raw = {
      defaultResponseMs: 180_000,
      byDepartment: {
        billing: { responseMs: 'bad' },
        sales: null,
      },
    };
    const result = parseSlaConfig(raw);
    expect(result!.byDepartment).toBeUndefined();
  });

  it('returns undefined byDepartment for non-object byDepartment', () => {
    const raw = {
      defaultResponseMs: 180_000,
      byDepartment: 'not-an-object',
    };
    const result = parseSlaConfig(raw);
    expect(result!.byDepartment).toBeUndefined();
  });
});

// ── getEffectiveSla ─────────────────────────────────────────────────────────

describe('getEffectiveSla', () => {
  it('returns global defaults when slaConfig is null', () => {
    const result = getEffectiveSla(null);
    expect(result).toEqual({
      responseMs: 180_000,           // config.SLA_THRESHOLD_MS
      resolutionMs: 24 * 60 * 60 * 1000, // 24h
    });
  });

  it('returns partner defaults when no department specified', () => {
    const cfg: SlaConfig = {
      defaultResponseMs: 300_000,
      defaultResolutionMs: 7_200_000,
      businessHoursOnly: false,
    };
    const result = getEffectiveSla(cfg);
    expect(result).toEqual({
      responseMs: 300_000,
      resolutionMs: 7_200_000,
    });
  });

  it('returns partner defaults when department has no override', () => {
    const cfg: SlaConfig = {
      defaultResponseMs: 300_000,
      defaultResolutionMs: 7_200_000,
      businessHoursOnly: false,
      byDepartment: {
        billing: { responseMs: 120_000, resolutionMs: 3_600_000 },
      },
    };
    const result = getEffectiveSla(cfg, 'sales');
    expect(result).toEqual({
      responseMs: 300_000,
      resolutionMs: 7_200_000,
    });
  });

  it('returns department-specific config when available', () => {
    const cfg: SlaConfig = {
      defaultResponseMs: 300_000,
      defaultResolutionMs: 7_200_000,
      businessHoursOnly: false,
      byDepartment: {
        billing: { responseMs: 120_000, resolutionMs: 3_600_000 },
      },
    };
    const result = getEffectiveSla(cfg, 'billing');
    expect(result).toEqual({
      responseMs: 120_000,
      resolutionMs: 3_600_000,
    });
  });

  it('returns partner defaults when department is undefined', () => {
    const cfg: SlaConfig = {
      defaultResponseMs: 300_000,
      defaultResolutionMs: 7_200_000,
      businessHoursOnly: false,
      byDepartment: {
        billing: { responseMs: 120_000, resolutionMs: 3_600_000 },
      },
    };
    const result = getEffectiveSla(cfg, undefined);
    expect(result).toEqual({
      responseMs: 300_000,
      resolutionMs: 7_200_000,
    });
  });

  it('returns partner defaults when department is empty string', () => {
    const cfg: SlaConfig = {
      defaultResponseMs: 300_000,
      defaultResolutionMs: 7_200_000,
      businessHoursOnly: false,
      byDepartment: {
        billing: { responseMs: 120_000, resolutionMs: 3_600_000 },
      },
    };
    const result = getEffectiveSla(cfg, '');
    expect(result).toEqual({
      responseMs: 300_000,
      resolutionMs: 7_200_000,
    });
  });

  it('returns partner defaults when byDepartment is undefined', () => {
    const cfg: SlaConfig = {
      defaultResponseMs: 500_000,
      defaultResolutionMs: 10_000_000,
      businessHoursOnly: true,
    };
    const result = getEffectiveSla(cfg, 'billing');
    expect(result).toEqual({
      responseMs: 500_000,
      resolutionMs: 10_000_000,
    });
  });
});

// ── calculateSlaDueDate ─────────────────────────────────────────────────────

describe('calculateSlaDueDate', () => {
  const baseDate = new Date('2025-01-15T10:00:00.000Z');

  beforeEach(() => {
    getBusinessHoursStatusMock.mockReset();
  });

  describe('calendar-time mode (no business hours)', () => {
    it('adds slaMs to createdAt in simple mode', () => {
      const result = calculateSlaDueDate(baseDate, 180_000);
      expect(result.getTime()).toBe(baseDate.getTime() + 180_000);
    });

    it('adds slaMs when businessHoursOnly is false', () => {
      const result = calculateSlaDueDate(baseDate, 300_000, {
        businessHoursOnly: false,
      });
      expect(result.getTime()).toBe(baseDate.getTime() + 300_000);
    });

    it('adds slaMs when partnerHours is undefined', () => {
      const result = calculateSlaDueDate(baseDate, 300_000, {
        businessHoursOnly: true,
        partnerHours: undefined,
      });
      expect(result.getTime()).toBe(baseDate.getTime() + 300_000);
    });

    it('adds slaMs when options is undefined', () => {
      const result = calculateSlaDueDate(baseDate, 600_000);
      expect(result.getTime()).toBe(baseDate.getTime() + 600_000);
    });

    it('handles zero slaMs', () => {
      const result = calculateSlaDueDate(baseDate, 0);
      expect(result.getTime()).toBe(baseDate.getTime());
    });
  });

  describe('business-hours-aware mode', () => {
    const partnerHours = {
      businessHoursStart: '09:00',
      businessHoursEnd: '17:00',
      businessHoursTimezone: 'UTC',
    };

    it('consumes SLA within a single open window', () => {
      // Window is open, closes at 17:00 (7h of available time)
      // SLA is 3 minutes — fits within this window
      getBusinessHoursStatusMock.mockReturnValue({
        isOpen: true,
        nextCloseAt: '2025-01-15T17:00:00.000Z',
        timezone: 'UTC',
        source: 'weekly' as const,
        evaluatedAt: baseDate.toISOString(),
      });

      const result = calculateSlaDueDate(baseDate, 180_000, {
        businessHoursOnly: true,
        partnerHours,
      });

      // Should be baseDate + 3 minutes
      expect(result.getTime()).toBe(baseDate.getTime() + 180_000);
      expect(getBusinessHoursStatusMock).toHaveBeenCalled();
    });

    it('spans across a closed window into the next open window', () => {
      const slaMs = 3_600_000; // 1 hour
      // First call: open, but only 30 minutes until close
      // Second call: closed, next open at 09:00 next day
      // Third call: open again with plenty of time
      let callCount = 0;
      getBusinessHoursStatusMock.mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          return {
            isOpen: true,
            nextCloseAt: '2025-01-15T10:30:00.000Z', // 30 min available
            timezone: 'UTC',
            source: 'weekly' as const,
            evaluatedAt: baseDate.toISOString(),
          };
        }
        if (callCount === 2) {
          return {
            isOpen: false,
            nextOpenAt: '2025-01-16T09:00:00.000Z',
            timezone: 'UTC',
            source: 'weekly' as const,
            evaluatedAt: '2025-01-15T10:30:00.000Z',
          };
        }
        // Third+ call: open with plenty of time
        return {
          isOpen: true,
          nextCloseAt: '2025-01-16T17:00:00.000Z',
          timezone: 'UTC',
          source: 'weekly' as const,
          evaluatedAt: '2025-01-16T09:00:00.000Z',
        };
      });

      const result = calculateSlaDueDate(baseDate, slaMs, {
        businessHoursOnly: true,
        partnerHours,
      });

      // 30 min consumed in first window, 30 min remaining consumed starting 09:00 next day
      const expectedTime = new Date('2025-01-16T09:30:00.000Z').getTime();
      expect(result.getTime()).toBe(expectedTime);
    });

    it('falls back to calendar time when open with no nextCloseAt', () => {
      getBusinessHoursStatusMock.mockReturnValue({
        isOpen: true,
        nextCloseAt: undefined,
        timezone: 'UTC',
        source: 'default' as const,
        evaluatedAt: baseDate.toISOString(),
      });

      const result = calculateSlaDueDate(baseDate, 180_000, {
        businessHoursOnly: true,
        partnerHours,
      });

      expect(result.getTime()).toBe(baseDate.getTime() + 180_000);
    });

    it('falls back to calendar time when closed with no nextOpenAt', () => {
      getBusinessHoursStatusMock.mockReturnValue({
        isOpen: false,
        nextOpenAt: undefined,
        timezone: 'UTC',
        source: 'weekly' as const,
        evaluatedAt: baseDate.toISOString(),
      });

      const result = calculateSlaDueDate(baseDate, 180_000, {
        businessHoursOnly: true,
        partnerHours,
      });

      // Falls back: cursor + remainingMs
      expect(result.getTime()).toBe(baseDate.getTime() + 180_000);
    });

    it('advances by 1 minute when nextCloseAt is in the past (edge case)', () => {
      let callCount = 0;
      getBusinessHoursStatusMock.mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          // Edge case: nextCloseAt is before cursor
          return {
            isOpen: true,
            nextCloseAt: '2025-01-15T09:00:00.000Z', // before baseDate 10:00
            timezone: 'UTC',
            source: 'weekly' as const,
            evaluatedAt: baseDate.toISOString(),
          };
        }
        // After advancing 1 minute, return a normal open window
        return {
          isOpen: true,
          nextCloseAt: '2025-01-15T17:00:00.000Z',
          timezone: 'UTC',
          source: 'weekly' as const,
          evaluatedAt: baseDate.toISOString(),
        };
      });

      const result = calculateSlaDueDate(baseDate, 180_000, {
        businessHoursOnly: true,
        partnerHours,
      });

      // First iteration advances cursor by 1 min, second consumes the SLA
      const expected = new Date(baseDate.getTime() + 60_000 + 180_000);
      expect(result.getTime()).toBe(expected.getTime());
    });

    it('advances by 1 minute when closed and nextOpenAt is in the past', () => {
      let callCount = 0;
      getBusinessHoursStatusMock.mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          return {
            isOpen: false,
            nextOpenAt: '2025-01-15T09:00:00.000Z', // in the past
            timezone: 'UTC',
            source: 'weekly' as const,
            evaluatedAt: baseDate.toISOString(),
          };
        }
        return {
          isOpen: true,
          nextCloseAt: '2025-01-15T17:00:00.000Z',
          timezone: 'UTC',
          source: 'weekly' as const,
          evaluatedAt: baseDate.toISOString(),
        };
      });

      const result = calculateSlaDueDate(baseDate, 180_000, {
        businessHoursOnly: true,
        partnerHours,
      });

      // Advances 1 min past the stale nextOpenAt, then consumes SLA
      const expected = new Date(baseDate.getTime() + 60_000 + 180_000);
      expect(result.getTime()).toBe(expected.getTime());
    });

    it('respects MAX_LOOKAHEAD_DAYS safety limit', () => {
      // Always closed, no nextOpenAt and no fallback — cursor eventually exceeds max
      getBusinessHoursStatusMock.mockReturnValue({
        isOpen: false,
        nextOpenAt: undefined,
        timezone: 'UTC',
        source: 'weekly' as const,
        evaluatedAt: baseDate.toISOString(),
      });

      const hugeSlaDuration = 60 * 24 * 60 * 60 * 1000; // 60 days worth of ms
      const result = calculateSlaDueDate(baseDate, hugeSlaDuration, {
        businessHoursOnly: true,
        partnerHours,
      });

      // Falls back to calendar time since no nextOpenAt is found
      // cursor + remainingMs on first iteration
      expect(result.getTime()).toBe(baseDate.getTime() + hugeSlaDuration);
    });

    it('jumps directly to nextOpenAt when closed', () => {
      let callCount = 0;
      getBusinessHoursStatusMock.mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          return {
            isOpen: false,
            nextOpenAt: '2025-01-16T09:00:00.000Z',
            timezone: 'UTC',
            source: 'weekly' as const,
            evaluatedAt: baseDate.toISOString(),
          };
        }
        return {
          isOpen: true,
          nextCloseAt: '2025-01-16T17:00:00.000Z',
          timezone: 'UTC',
          source: 'weekly' as const,
          evaluatedAt: '2025-01-16T09:00:00.000Z',
        };
      });

      const result = calculateSlaDueDate(baseDate, 180_000, {
        businessHoursOnly: true,
        partnerHours,
      });

      // Jumps to 09:00 next day, then adds 3 minutes
      const expected = new Date('2025-01-16T09:03:00.000Z');
      expect(result.getTime()).toBe(expected.getTime());
    });

    it('consumes SLA across exactly equal available window', () => {
      // Available time exactly equals the SLA
      getBusinessHoursStatusMock.mockReturnValue({
        isOpen: true,
        nextCloseAt: '2025-01-15T10:03:00.000Z', // exactly 3 minutes
        timezone: 'UTC',
        source: 'weekly' as const,
        evaluatedAt: baseDate.toISOString(),
      });

      const result = calculateSlaDueDate(baseDate, 180_000, {
        businessHoursOnly: true,
        partnerHours,
      });

      // SLA fits exactly — due at close time
      expect(result.getTime()).toBe(new Date('2025-01-15T10:03:00.000Z').getTime());
    });
  });
});
