import config from '../config.js';
import type { BusinessHoursSchedule } from './businessHours.js';
import { getBusinessHoursStatus } from './businessHours.js';

export interface SlaDepartmentConfig {
  responseMs: number;
  resolutionMs: number;
}

export interface SlaConfig {
  defaultResponseMs: number;      // default: from SLA_THRESHOLD_MS env var
  defaultResolutionMs: number;    // default: 24 hours
  byDepartment?: Record<string, SlaDepartmentConfig>;
  businessHoursOnly: boolean;     // default: false
}

const DEFAULT_RESOLUTION_MS = 24 * 60 * 60 * 1000; // 24 hours
const ONE_MINUTE_MS = 60_000;
const MAX_LOOKAHEAD_DAYS = 30; // safety limit
const MIN_SLA_MS = 60_000; // 1 minute
const MAX_SLA_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

function validateDeptConfig(raw: unknown): Record<string, SlaDepartmentConfig> | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const result: Record<string, SlaDepartmentConfig> = {};
  for (const [key, val] of Object.entries(raw as Record<string, unknown>)) {
    if (val && typeof val === 'object') {
      const v = val as Record<string, unknown>;
      if (typeof v.responseMs === 'number' && typeof v.resolutionMs === 'number') {
        const clampSla = (n: number) => Math.min(Math.max(n, MIN_SLA_MS), MAX_SLA_MS);
        result[key] = { responseMs: clampSla(v.responseMs), resolutionMs: clampSla(v.resolutionMs) };
      }
    }
  }
  return Object.keys(result).length > 0 ? result : undefined;
}

/**
 * Parse a raw JSONB value from the database into a typed SlaConfig or null.
 */
export function parseSlaConfig(raw: unknown): SlaConfig | null {
  if (!raw || typeof raw !== 'object') return null;
  const obj = raw as Record<string, unknown>;
  // If the object is empty (default `{}`), treat as unconfigured
  if (Object.keys(obj).length === 0) return null;
  const clamp = (v: number) => Math.min(Math.max(v, MIN_SLA_MS), MAX_SLA_MS);
  const defaultResponseMs = clamp(typeof obj.defaultResponseMs === 'number' ? obj.defaultResponseMs : config.SLA_THRESHOLD_MS);
  const defaultResolutionMs = clamp(typeof obj.defaultResolutionMs === 'number' ? obj.defaultResolutionMs : DEFAULT_RESOLUTION_MS);
  return {
    defaultResponseMs,
    defaultResolutionMs,
    byDepartment: validateDeptConfig(obj.byDepartment),
    businessHoursOnly: typeof obj.businessHoursOnly === 'boolean' ? obj.businessHoursOnly : false,
  };
}

/**
 * Return the effective SLA thresholds for a given department.
 * Falls back to partner defaults, then to global config defaults.
 */
export function getEffectiveSla(
  slaConfig: SlaConfig | null,
  department?: string,
): { responseMs: number; resolutionMs: number } {
  if (!slaConfig) {
    return {
      responseMs: config.SLA_THRESHOLD_MS,
      resolutionMs: DEFAULT_RESOLUTION_MS,
    };
  }

  // Check department-specific overrides
  if (department && slaConfig.byDepartment?.[department]) {
    const deptSla = slaConfig.byDepartment[department];
    return {
      responseMs: deptSla.responseMs,
      resolutionMs: deptSla.resolutionMs,
    };
  }

  return {
    responseMs: slaConfig.defaultResponseMs,
    resolutionMs: slaConfig.defaultResolutionMs,
  };
}

/**
 * Calculate the SLA due date.
 *
 * If businessHoursOnly is false (or no partner hours provided), simply adds slaMs to createdAt.
 * If businessHoursOnly is true, walks forward through time counting only business-hours minutes
 * until the full SLA duration has been "consumed." Checks in 1-minute increments.
 */
export function calculateSlaDueDate(
  createdAt: Date,
  slaMs: number,
  options?: {
    businessHoursOnly?: boolean;
    partnerHours?: {
      businessHoursSchedule?: BusinessHoursSchedule | null;
      businessHoursStart?: string | null;
      businessHoursEnd?: string | null;
      businessHoursTimezone?: string | null;
    };
  },
): Date {
  // Simple calendar-time mode (default)
  if (!options?.businessHoursOnly || !options?.partnerHours) {
    return new Date(createdAt.getTime() + slaMs);
  }

  // Business-hours-aware: jump through open/closed windows instead of walking minute-by-minute
  let remainingMs = slaMs;
  let cursor = new Date(createdAt.getTime());
  const maxEnd = createdAt.getTime() + MAX_LOOKAHEAD_DAYS * 24 * 60 * 60 * 1000;

  while (remainingMs > 0 && cursor.getTime() < maxEnd) {
    const status = getBusinessHoursStatus(options.partnerHours, cursor);

    if (status.isOpen) {
      if (status.nextCloseAt) {
        // Calculate time until this window closes
        const closeTime = new Date(status.nextCloseAt).getTime();
        const availableMs = closeTime - cursor.getTime();
        if (availableMs <= 0) {
          // Edge case: nextCloseAt is in the past, advance by 1 minute
          cursor = new Date(cursor.getTime() + ONE_MINUTE_MS);
          continue;
        }
        if (remainingMs <= availableMs) {
          // SLA fits within this window
          cursor = new Date(cursor.getTime() + remainingMs);
          remainingMs = 0;
        } else {
          // Consume the rest of this window and continue
          remainingMs -= availableMs;
          cursor = new Date(closeTime);
        }
      } else {
        // No close time — consume all remaining
        cursor = new Date(cursor.getTime() + remainingMs);
        remainingMs = 0;
      }
    } else if (status.nextOpenAt) {
      const nextOpen = new Date(status.nextOpenAt);
      if (nextOpen.getTime() > cursor.getTime()) {
        cursor = nextOpen;
      } else {
        cursor = new Date(cursor.getTime() + ONE_MINUTE_MS);
      }
    } else {
      // No next open time found — fall back to calendar time
      cursor = new Date(cursor.getTime() + remainingMs);
      remainingMs = 0;
    }
  }

  return cursor;
}
