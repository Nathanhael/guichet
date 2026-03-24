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

/**
 * Parse a raw JSONB value from the database into a typed SlaConfig or null.
 */
export function parseSlaConfig(raw: unknown): SlaConfig | null {
  if (!raw || typeof raw !== 'object') return null;
  const obj = raw as Record<string, unknown>;
  // If the object is empty (default `{}`), treat as unconfigured
  if (Object.keys(obj).length === 0) return null;
  return {
    defaultResponseMs: typeof obj.defaultResponseMs === 'number' ? obj.defaultResponseMs : config.SLA_THRESHOLD_MS,
    defaultResolutionMs: typeof obj.defaultResolutionMs === 'number' ? obj.defaultResolutionMs : DEFAULT_RESOLUTION_MS,
    byDepartment: (obj.byDepartment && typeof obj.byDepartment === 'object') ? obj.byDepartment as Record<string, SlaDepartmentConfig> : undefined,
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

  // Business-hours-aware: walk forward minute by minute, only counting open minutes
  let remainingMs = slaMs;
  let cursor = new Date(createdAt.getTime());
  const maxEnd = createdAt.getTime() + MAX_LOOKAHEAD_DAYS * 24 * 60 * 60 * 1000;

  while (remainingMs > 0 && cursor.getTime() < maxEnd) {
    const status = getBusinessHoursStatus(options.partnerHours, cursor);

    if (status.isOpen) {
      // Count this minute as business time
      const step = Math.min(remainingMs, ONE_MINUTE_MS);
      remainingMs -= step;
      cursor = new Date(cursor.getTime() + step);
    } else if (status.nextOpenAt) {
      // Skip ahead to the next open time
      const nextOpen = new Date(status.nextOpenAt);
      if (nextOpen.getTime() > cursor.getTime()) {
        cursor = nextOpen;
      } else {
        // Safety: advance by 1 minute to avoid infinite loop
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
