import { Rating } from '../../../types';

export interface DeptBreakdown {
  total: number;
  sum: number;
  count5: number;
  countLow: number;
}

export interface SupportRatingEntry {
  total: number;
  sum: number;
  ratings: Rating[];
  depts: Record<string, DeptBreakdown>;
}

export type SupportRatings = Record<string, SupportRatingEntry>;

export interface RatingInput {
  id: string;
  ticketId: string;
  agentId: string;
  supportId: string | null;
  rating: number;
  comment: string | null;
  createdAt: string;
}

export interface UserInput {
  id: string;
  name: string;
  email: string;
  roles: string[] | null;
  dept?: string;
}

export interface UserMaps {
  agentDeptMap: Record<string, string>;
  supportNameMap: Record<string, string>;
}

export function buildUserMaps(users: UserInput[]): UserMaps {
  const agentDeptMap: Record<string, string> = {};
  const supportNameMap: Record<string, string> = {};
  for (const u of users) {
    const roles = u.roles || [];
    if (roles.includes('agent')) agentDeptMap[u.id] = u.dept || 'N/A';
    if (roles.includes('support') || roles.includes('admin')) supportNameMap[u.id] = u.name;
  }
  return { agentDeptMap, supportNameMap };
}

function emptyDeptMap(deptIds: string[]): Record<string, DeptBreakdown> {
  const depts: Record<string, DeptBreakdown> = {};
  for (const id of deptIds) {
    depts[id] = { total: 0, sum: 0, count5: 0, countLow: 0 };
  }
  return depts;
}

/**
 * Aggregate ratings by support staff, breaking down per partner department.
 * `deptIds` comes from the active partner's manifest — no hardcoded DSC/FOT.
 */
export function aggregateSupportRatings(
  ratings: RatingInput[],
  maps: UserMaps,
  deptIds: string[],
): SupportRatings {
  const result: SupportRatings = {};
  for (const r of ratings) {
    const name = maps.supportNameMap[r.supportId || ''] || r.supportId || 'Unknown';
    if (!result[name]) {
      result[name] = {
        total: 0,
        sum: 0,
        ratings: [],
        depts: emptyDeptMap(deptIds),
      };
    }
    result[name].total++;
    result[name].sum += r.rating;
    result[name].ratings.push(r as Rating);

    const dept = maps.agentDeptMap[r.agentId];
    if (dept && result[name].depts[dept]) {
      const d = result[name].depts[dept];
      d.total++;
      d.sum += r.rating;
      if (r.rating === 5) d.count5++;
      if (r.rating <= 2) d.countLow++;
    }
  }
  return result;
}
