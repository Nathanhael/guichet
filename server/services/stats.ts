import config from '../config.js';
import { Ticket, Rating } from '../types/index.js';

export function computeLiveDayStats(dayTickets: Ticket[], dayRatings: Rating[], deptFilter?: string) {
  let tickets = dayTickets;
  let ratings = dayRatings;
  if (deptFilter && deptFilter !== 'all') {
    tickets = tickets.filter(t => t.dept === deptFilter);
    const tIds = new Set(tickets.map(t => t.id));
    ratings = ratings.filter(r => tIds.has(r.ticketId));
  }

  const deptCounts: Record<string, number> = {};
  const hourly = Array(24).fill(0);
  const hourlyExperts: Record<string, number>[] = Array.from({ length: 24 }, () => ({}));
  const hourlySla = Array.from({ length: 24 }, () => ({ resolved: 0, compliant: 0 }));
  let closed = 0, abandoned = 0;
  let responseSum = 0, responseCount = 0;
  let durationSum = 0, durationCount = 0;
  const ratingsByDept: Record<string, { sum: number; count: number }> = {};
  const deptResolved: Record<string, number> = {};
  const deptCompliant: Record<string, number> = {};
  const expertIds = new Set<string>();

  tickets.forEach(t => {
    deptCounts[t.dept] = (deptCounts[t.dept] || 0) + 1;
    const createdAt = new Date(t.createdAt);
    const hour = createdAt.getHours();
    hourly[hour]++;

    if (t.expertId) {
      hourlyExperts[hour][t.expertId] = (hourlyExperts[hour][t.expertId] || 0) + 1;
      expertIds.add(t.expertId);
    }

    if (t.status === 'closed') {
      closed++;
      if (!t.expertJoinedAt) abandoned++;
    }

    if (t.expertJoinedAt) {
      const responseTime = new Date(t.expertJoinedAt).getTime() - createdAt.getTime();
      responseSum += responseTime;
      responseCount++;
      deptResolved[t.dept] = (deptResolved[t.dept] || 0) + 1;

      const isCompliant = responseTime <= config.SLA_THRESHOLD_MS;
      if (isCompliant) deptCompliant[t.dept] = (deptCompliant[t.dept] || 0) + 1;

      hourlySla[hour].resolved++;
      if (isCompliant) hourlySla[hour].compliant++;
    }

    if (t.status === 'closed' && t.closedAt) {
      durationSum += new Date(t.closedAt).getTime() - createdAt.getTime();
      durationCount++;
    }
  });

  ratings.forEach(r => {
    const ticket = tickets.find(t => t.id === r.ticketId);
    const d = ticket ? ticket.dept : 'Unknown';
    if (!ratingsByDept[d]) ratingsByDept[d] = { sum: 0, count: 0 };
    ratingsByDept[d].sum += r.rating;
    ratingsByDept[d].count++;
  });

  const resolved = tickets.filter(t => t.expertJoinedAt);
  const compliant = resolved.filter(t => (new Date(t.expertJoinedAt!).getTime() - new Date(t.createdAt).getTime()) <= config.SLA_THRESHOLD_MS).length;

  return {
    total: tickets.length,
    deptCounts,
    closed,
    abandoned,
    responseSum,
    responseCount,
    durationSum,
    durationCount,
    ratingSum: ratings.reduce((s, r) => s + r.rating, 0),
    ratingCount: ratings.length,
    ratingsByDept,
    slaResolved: resolved.length,
    slaCompliant: compliant,
    deptResolved,
    deptCompliant,
    expertIds: Array.from(expertIds),
    hourly,
    hourlyStaffing: hourly.map((count, h) => {
      const expertsInHour = Object.keys(hourlyExperts[h]);
      const topExpertId = expertsInHour.reduce((a, b) => {
        if (!a) return b;
        return (hourlyExperts[h][a] || 0) > (hourlyExperts[h][b] || 0) ? a : b;
      }, expertsInHour[0] || null);

      return {
        hour: h,
        tickets: count,
        experts: expertsInHour.length,
        topExpertId,
        topExpertCount: topExpertId ? hourlyExperts[h][topExpertId] : 0,
        slaResolved: hourlySla[h].resolved,
        slaCompliant: hourlySla[h].compliant
      };
    })
  };
}
