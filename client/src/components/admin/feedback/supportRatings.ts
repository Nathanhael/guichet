import { Rating } from '../../../types';

export interface SupportRatingEntry {
  total: number;
  sum: number;
  ratings: Rating[];
  depts: {
    [key: string]: {
      total: number;
      sum: number;
      count5: number;
      countLow: number;
    };
  };
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

export function aggregateSupportRatings(
  ratings: RatingInput[],
  maps: UserMaps,
): SupportRatings {
  const result: SupportRatings = {};
  for (const r of ratings) {
    const name = maps.supportNameMap[r.supportId || ''] || r.supportId || 'Unknown';
    if (!result[name]) {
      result[name] = {
        total: 0,
        sum: 0,
        ratings: [],
        depts: {
          DSC: { total: 0, sum: 0, count5: 0, countLow: 0 },
          FOT: { total: 0, sum: 0, count5: 0, countLow: 0 },
        },
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
