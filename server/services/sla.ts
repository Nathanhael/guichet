import config from '../config.js';

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
 * Calculate the due date by adding slaMs to createdAt.
 */
export function calculateSlaDueDate(createdAt: Date, slaMs: number): Date {
  return new Date(createdAt.getTime() + slaMs);
}
