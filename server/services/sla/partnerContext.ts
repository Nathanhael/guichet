import { resolveSchedule, type BusinessHoursSchedule } from '../businessHours.js';
import type { DepartmentSlaConfig } from './compute.js';

interface PartnerDeptRaw {
  id: string;
  sla?: {
    enabled?: boolean;
    firstResponseMinutes?: number;
    warnAtPercent?: number;
  };
}

export interface PartnerSlaContext {
  slaMap: Map<string, DepartmentSlaConfig>;
  schedule: BusinessHoursSchedule;
}

/**
 * Turns a partner row (departments JSONB + businessHoursSchedule) into the
 * pair of values every SLA caller needs: a per-dept config map and a
 * resolved business-hours schedule. Used by both the breach sweep and the
 * dashboard scorecard so they agree on dept lookup and schedule resolution.
 */
export function extractPartnerSlaContext(partner: {
  departments?: unknown;
  businessHoursSchedule?: BusinessHoursSchedule | null;
}): PartnerSlaContext {
  const slaMap = new Map<string, DepartmentSlaConfig>();
  const depts = (partner.departments ?? []) as PartnerDeptRaw[];
  for (const dept of depts) {
    if (dept?.id && dept.sla?.firstResponseMinutes) {
      slaMap.set(dept.id, {
        enabled: dept.sla.enabled !== false,
        firstResponseMinutes: dept.sla.firstResponseMinutes,
        warnAtPercent: typeof dept.sla.warnAtPercent === 'number' ? dept.sla.warnAtPercent : 80,
      });
    }
  }
  return {
    slaMap,
    schedule: resolveSchedule({ businessHoursSchedule: partner.businessHoursSchedule }),
  };
}
