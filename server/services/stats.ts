import { Ticket, Rating } from '../types/index.js';

/** Extended ticket with DB columns not on the base Ticket interface */
interface TicketWithReopened extends Ticket {
  reopened?: boolean;
}

export function calculatePercentile(values: number[], percentile: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.ceil((percentile / 100) * sorted.length) - 1;
  return sorted[index];
}

export function computeLiveDayStats(dayTickets: TicketWithReopened[], dayRatings: Rating[], deptFilter?: string) {
  let tickets = dayTickets;
  let ratings = dayRatings;

  if (deptFilter && deptFilter !== 'all') {
    tickets = tickets.filter(t => t.dept === deptFilter);
    const tIds = new Set(tickets.map(t => t.id));
    ratings = ratings.filter(r => tIds.has(r.ticketId));
  }

  const deptCounts: Record<string, number> = {};
  const hourly = Array(24).fill(0);
  const hourlySupport: Record<string, number>[] = Array.from({ length: 24 }, () => ({}));
  let closed = 0, abandoned = 0, reopened = 0;
  let responseSum = 0, responseCount = 0;
  let durationSum = 0, durationCount = 0;
  const responseTimes: number[] = [];
  const ratingsByDept: Record<string, { sum: number; count: number }> = {};
  const deptResolved: Record<string, number> = {};
  const supportIds = new Set<string>();

  tickets.forEach(t => {
    deptCounts[t.dept] = (deptCounts[t.dept] || 0) + 1;
    const createdAt = new Date(t.createdAt);
    const hour = createdAt.getHours();
    hourly[hour]++;

    if (t.supportId) {
      hourlySupport[hour][t.supportId] = (hourlySupport[hour][t.supportId] || 0) + 1;
      supportIds.add(t.supportId);
    }

    if (t.status === 'closed') {
      closed++;
      if (!t.supportJoinedAt) abandoned++;
    }

    if (t.reopened) reopened++;

    if (t.supportJoinedAt) {
      const responseTime = new Date(t.supportJoinedAt).getTime() - createdAt.getTime();
      responseSum += responseTime;
      responseCount++;
      responseTimes.push(responseTime);
      deptResolved[t.dept] = (deptResolved[t.dept] || 0) + 1;
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

  return {
    total: tickets.length,
    deptCounts,
    closed,
    abandoned,
    reopened,
    responseSum,
    responseCount,
    p95ResponseMs: calculatePercentile(responseTimes, 95),
    durationSum,
    durationCount,
    ratingSum: ratings.reduce((s, r) => s + r.rating, 0),
    ratingCount: ratings.length,
    ratingsByDept,
    deptResolved,
    supportIds: Array.from(supportIds),
    hourly,
    hourlyStaffing: hourly.map((count, h) => {
      const supportInHour = Object.keys(hourlySupport[h]);
      const topSupportId = supportInHour.reduce((a, b) => {
        if (!a) return b;
        return (hourlySupport[h][a] || 0) > (hourlySupport[h][b] || 0) ? a : b;
      }, supportInHour[0] || null);

      return {
        hour: h,
        tickets: count,
        support: supportInHour.length,
        topSupportId,
        topSupportCount: topSupportId ? hourlySupport[h][topSupportId] : 0,
      };
    })
  };
}
