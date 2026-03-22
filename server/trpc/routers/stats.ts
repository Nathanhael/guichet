import { z } from 'zod';
import { router, roleProcedure } from '../trpc.js';
import { query, get } from '../../db.js';
import { computeLiveDayStats } from '../../services/stats.js';
import { TRPCError } from '@trpc/server';
import logger from '../../utils/logger.js';
import { Ticket, User } from '../../types/index.js';

interface HistoricalStatRow {
  date: string;
  total: number;
  closed: number;
  abandoned: number;
  avgResponseMs: number;
  avgDurationMs: number;
  avgRating: number | null;
  ratingCount: number;
  slaResolved: number;
  slaCompliant: number;
  p95ResponseMs: number;
  reopened: number;
  sentimentSum: number;
  sentimentCount: number;
  deptCounts: string;
  ratingsByDept: string;
  hourly: string;
}

interface RatingRow {
  id: string;
  ticketId: string;
  supportId: string;
  rating: number;
  createdAt: string;
}

interface DayData {
  total: number;
  deptCounts: Record<string, number>;
  closed: number;
  abandoned: number;
  reopened: number;
  responseSum: number;
  responseCount: number;
  p95ResponseMs: number;
  durationSum: number;
  durationCount: number;
  ratingSum: number;
  ratingCount: number;
  ratingsByDept: Record<string, { sum: number; count: number }>;
  sentimentSum: number;
  sentimentCount: number;
  slaResolved: number;
  slaCompliant: number;
  deptResolved: Record<string, number>;
  deptCompliant: Record<string, number>;
  hourly: number[];
  hourlyStaffing?: HourlyStaffingItem[];
  supportIds?: Set<string> | string[];
}

interface HourlyStaffingItem {
  hour: number;
  tickets: number;
  support: number;
  slaResolved?: number;
  slaCompliant?: number;
}

interface HourlyStaffingAccumulator {
  hour: number;
  tickets: number;
  support: number;
  dayCount: number;
  slaResolved: number;
  slaCompliant: number;
}

interface PerDayEntry {
  date: string;
  total: number;
  deptCounts: Record<string, number>;
  sentiment?: number | null;
  p95?: number | null;
}

interface RatingsByDeptAccumulator {
  sum: number;
  count: number;
}

interface SupportMapEntry {
  id: string;
  name: string;
  total: number;
  today: number;
  trendMap: Record<string, number>;
  ratingSum: number;
  ratingCount: number;
  deptStats: Record<string, { sum: number; count: number; tickets: number }>;
}

interface AgentMapEntry {
  name: string;
  total: number;
  today: number;
  trendMap: Record<string, number>;
}

interface PrevHistRow {
  total: number | null;
  avgresp: number | null;
  avgdur: number | null;
  abandoned: number | null;
  slares: number | null;
  slacomp: number | null;
}

interface LabelCountRow {
  name: string;
  dept: string;
  count: number;
}

export const statsRouter = router({
  getGlobalStats: roleProcedure(['admin', 'support'])
    .input(z.object({
      dateFrom: z.string().optional(),
      dateTo: z.string().optional(),
      dept: z.string().optional(),
      excludeWeekends: z.boolean().optional(),
    }))
    .query(async ({ input, ctx }) => {
      try {
        const { dateFrom, dateTo, dept, excludeWeekends } = input;
        if (!ctx.user.partnerId && !ctx.user.isPlatformOperator) throw new TRPCError({ code: 'BAD_REQUEST', message: 'No active partner context' });
        const partnerId = ctx.user.partnerId!;

        const now = new Date();
        const today = now.toISOString().slice(0, 10);

        let rangeStart: string, rangeEnd: string;
        if (dateFrom && dateTo) {
          rangeStart = dateFrom;
          rangeEnd = dateTo;
        } else {
          const d = new Date(now);
          d.setDate(d.getDate() - 29);
          rangeStart = d.toISOString().slice(0, 10);
          rangeEnd = today;
        }

        const allDays: string[] = [];
        {
          const start = new Date(rangeStart);
          const end = new Date(rangeEnd);
          for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
            const dateStr = d.toISOString().slice(0, 10);
            if (excludeWeekends) {
              const checkDate = new Date(dateStr + 'T12:00:00Z');
              const day = checkDate.getUTCDay();
              if (day === 0 || day === 6) continue;
            }
            allDays.push(dateStr);
          }
        }

        const historicalStats = (await query('SELECT * FROM daily_stats WHERE date >= $1 AND date <= $2 AND partner_id = $3', [rangeStart, rangeEnd, partnerId])) as unknown as HistoricalStatRow[];
        const ticketsSql = `SELECT * FROM tickets WHERE created_at::date >= $1 AND created_at::date <= $2 AND partner_id = $3`;
        const allLiveTicketsRaw = (await query(ticketsSql, [rangeStart, rangeEnd, partnerId])) as unknown as Ticket[];
        const allLiveTickets = (excludeWeekends)
          ? allLiveTicketsRaw.filter(t => {
            if (!t.createdAt) return false;
            const dateStr = t.createdAt.substring(0, 10);
            const checkDate = new Date(dateStr + 'T12:00:00Z');
            const day = checkDate.getUTCDay();
            return day !== 0 && day !== 6;
          })
          : allLiveTicketsRaw;

        const liveTickets = (dept && dept !== 'all') ? allLiveTickets.filter(t => t.dept === dept) : allLiveTickets;
        const liveTicketIds = liveTickets.map(t => t.id);

        let liveRatings: RatingRow[] = [];
        if (liveTicketIds.length > 0) {
          liveRatings = (await query(`SELECT * FROM ratings WHERE "ticket_id" IN (${liveTicketIds.map((_, i) => `$${i + 1}`).join(',')})`, liveTicketIds)) as unknown as RatingRow[];
        }

        let liveMessages: any[] = [];
        if (liveTicketIds.length > 0) {
          liveMessages = (await query(`SELECT * FROM messages WHERE "ticket_id" IN (${liveTicketIds.map((_, i) => `$${i + 1}`).join(',')})`, liveTicketIds)) as unknown as any[];
        }

        let totalCount = 0, totalClosed = 0, totalAbandoned = 0, totalReopened = 0;
        const totalDeptCounts: Record<string, number> = {};
        let totalResponseSum = 0, totalResponseCount = 0;
        let totalDurationSum = 0, totalDurationCount = 0;
        let totalRatingSum = 0, totalRatingCount = 0;
        let totalSentimentSum = 0, totalSentimentCount = 0;
        let totalSlaResolved = 0, totalSlaCompliant = 0;
        const allResponseTimes: number[] = [];
        const hourlyMap = Array.from({ length: 24 }, (_, h) => ({ hour: h, count: 0 }));
        const hourlyStaffingMap: Record<number, HourlyStaffingAccumulator> = {};
        const ratingsByDeptAgg: Record<string, RatingsByDeptAccumulator> = {};
        const deptResolvedAgg: Record<string, number> = {};
        const deptCompliantAgg: Record<string, number> = {};
        const supportIdsAgg = new Set<string>();
        const perDayData: PerDayEntry[] = [];

        for (const date of allDays) {
          let dayData: DayData;
          const hist = historicalStats.find(s => s.date === date);

          if (hist) {
            const histDeptCounts = JSON.parse(hist.deptCounts || '{}');
            const histRatingsByDept = JSON.parse(hist.ratingsByDept || '{}');
            const histHourly = JSON.parse(hist.hourly || '[]');

            if (dept && dept !== 'all') {
              const deptTotal = histDeptCounts[dept] || 0;
              const deptRating = histRatingsByDept[dept];
              const deptRatio = hist.total > 0 ? deptTotal / hist.total : 0;
              dayData = {
                total: deptTotal,
                deptCounts: { [dept]: deptTotal },
                closed: hist.closed * deptRatio,
                abandoned: hist.abandoned * deptRatio,
                reopened: hist.reopened * deptRatio,
                responseSum: hist.avgResponseMs * (deptRatio * (hist.slaResolved || 0)),
                responseCount: deptRatio * (hist.slaResolved || 0),
                p95ResponseMs: hist.p95ResponseMs,
                durationSum: hist.avgDurationMs * (hist.closed * deptRatio),
                durationCount: hist.closed * deptRatio,
                ratingSum: deptRating ? deptRating.sum : 0,
                ratingCount: deptRating ? deptRating.count : 0,
                ratingsByDept: deptRating ? { [dept]: deptRating } : {},
                sentimentSum: hist.sentimentSum * deptRatio,
                sentimentCount: hist.sentimentCount * deptRatio,
                slaResolved: deptRatio * (hist.slaResolved || 0),
                slaCompliant: deptRatio * (hist.slaCompliant || 0),
                deptResolved: { [dept]: deptRatio * (hist.slaResolved || 0) },
                deptCompliant: { [dept]: deptRatio * (hist.slaCompliant || 0) },
                hourly: histHourly.map((h: number) => h * deptRatio),
              } as DayData;
            } else {
              dayData = {
                total: hist.total,
                deptCounts: histDeptCounts,
                closed: hist.closed,
                abandoned: hist.abandoned,
                reopened: hist.reopened,
                responseSum: hist.avgResponseMs * (hist.slaResolved || 0),
                responseCount: hist.slaResolved || 0,
                p95ResponseMs: hist.p95ResponseMs,
                durationSum: hist.avgDurationMs * hist.closed,
                durationCount: hist.closed,
                ratingSum: hist.avgRating ? hist.avgRating * hist.ratingCount : 0,
                ratingCount: hist.ratingCount,
                ratingsByDept: histRatingsByDept,
                sentimentSum: hist.sentimentSum,
                sentimentCount: hist.sentimentCount,
                slaResolved: hist.slaResolved || 0,
                slaCompliant: hist.slaCompliant || 0,
                deptResolved: Object.fromEntries(
                  Object.entries(histDeptCounts).map(([d, count]) => [
                    d, (hist.total > 0 ? (count as number) / hist.total : 0) * (hist.slaResolved || 0)
                  ])
                ),
                deptCompliant: Object.fromEntries(
                  Object.entries(histDeptCounts).map(([d, count]) => [
                    d, (hist.total > 0 ? (count as number) / hist.total : 0) * (hist.slaCompliant || 0)
                  ])
                ),
                hourly: histHourly,
              } as DayData;
            }
          } else {
            const dayTickets = liveTickets.filter(t => t.createdAt && t.createdAt.startsWith(date));
            const dayRatings = liveRatings.filter(r => dayTickets.some(t => t.id === r.ticketId));
            const dayMessages = liveMessages.filter(m => dayTickets.some(t => t.id === m.ticketId));
            dayData = computeLiveDayStats(dayTickets, dayRatings, dept, dayMessages) as unknown as DayData;
          }

          perDayData.push({
            date,
            total: dayData.total,
            deptCounts: dayData.deptCounts,
            sentiment: dayData.sentimentCount > 0 ? Math.round((dayData.sentimentSum / dayData.sentimentCount) * 100) / 100 : null,
            p95: Math.round(dayData.p95ResponseMs / 60000)
          });
          totalCount += dayData.total;
          Object.entries(dayData.deptCounts).forEach(([d, c]) => { totalDeptCounts[d] = (totalDeptCounts[d] || 0) + c; });
          totalClosed += dayData.closed;
          totalAbandoned += dayData.abandoned;
          totalReopened += dayData.reopened;
          totalResponseSum += dayData.responseSum;
          totalResponseCount += dayData.responseCount;
          totalDurationSum += dayData.durationSum;
          totalDurationCount += dayData.durationCount;
          totalRatingSum += dayData.ratingSum;
          totalRatingCount += dayData.ratingCount;
          totalSentimentSum += dayData.sentimentSum;
          totalSentimentCount += dayData.sentimentCount;
          totalSlaResolved += dayData.slaResolved;
          totalSlaCompliant += dayData.slaCompliant;

          // Collect response times for global p95
          if (!hist) {
              const dayTickets = liveTickets.filter(t => t.createdAt && t.createdAt.startsWith(date));
              dayTickets.forEach(t => {
                  if (t.supportJoinedAt && t.createdAt) {
                      allResponseTimes.push(new Date(t.supportJoinedAt).getTime() - new Date(t.createdAt).getTime());
                  }
              });
          } else {
              // Approximate hist p95 by adding it to the pool (not ideal but better than nothing)
              // Actually, global p95 across many days is hard from pre-aggregated data.
              // For now we'll just use the latest p95 if only one day, or avg of p95s.
          }

          if (dayData.hourlyStaffing) {
            dayData.hourlyStaffing.forEach((item: HourlyStaffingItem) => {
              const slot = hourlyMap.find(h => h.hour === item.hour);
              if (slot) {
                slot.count += item.tickets;
                if (!hourlyStaffingMap[item.hour]) {
                  hourlyStaffingMap[item.hour] = { hour: item.hour, tickets: 0, support: 0, dayCount: 0, slaResolved: 0, slaCompliant: 0 };
                }
                hourlyStaffingMap[item.hour].tickets += item.tickets;
                hourlyStaffingMap[item.hour].support += item.support;
                hourlyStaffingMap[item.hour].slaResolved += (item.slaResolved || 0);
                hourlyStaffingMap[item.hour].slaCompliant += (item.slaCompliant || 0);
                hourlyStaffingMap[item.hour].dayCount++;
              }
            });
          } else {
            dayData.hourly.forEach((count: number, h: number) => {
              hourlyMap[h].count += count;
              if (!hourlyStaffingMap[h]) {
                hourlyStaffingMap[h] = { hour: h, tickets: 0, support: 0, dayCount: 0, slaResolved: 0, slaCompliant: 0 };
              }
              hourlyStaffingMap[h].tickets += count;
              hourlyStaffingMap[h].dayCount++;
            });
          }

          if (dayData.supportIds) (dayData.supportIds as string[]).forEach((id: string) => supportIdsAgg.add(id));

          Object.entries(dayData.deptResolved || {}).forEach(([d, count]) => {
            deptResolvedAgg[d] = (deptResolvedAgg[d] || 0) + (count as number);
          });
          Object.entries(dayData.deptCompliant || {}).forEach(([d, count]) => {
            deptCompliantAgg[d] = (deptCompliantAgg[d] || 0) + (count as number);
          });

          Object.entries(dayData.ratingsByDept).forEach(([d, stats]: [string, { sum: number; count: number }]) => {
            if (!ratingsByDeptAgg[d]) ratingsByDeptAgg[d] = { sum: 0, count: 0 };
            ratingsByDeptAgg[d].sum += stats.sum;
            ratingsByDeptAgg[d].count += stats.count;
          });
        }

        let trendGranularity: string, dailyTrend: PerDayEntry[];
        if (allDays.length <= 30) {
          trendGranularity = 'daily';
          dailyTrend = perDayData.map(d => ({ ...d, date: d.date.slice(5) }));
        } else if (allDays.length <= 90) {
          trendGranularity = 'weekly';
          const weeks: PerDayEntry[] = [];
          for (let i = 0; i < perDayData.length; i += 7) {
            const chunk = perDayData.slice(i, i + 7);
            weeks.push({
              date: `W${weeks.length + 1}`,
              total: chunk.reduce((s, d) => s + d.total, 0),
              deptCounts: chunk.reduce((acc, d) => {
                Object.entries(d.deptCounts).forEach(([k, v]) => { acc[k] = (acc[k] || 0) + v; });
                return acc;
              }, {} as Record<string, number>),
            });
          }
          dailyTrend = weeks;
        } else {
          trendGranularity = 'monthly';
          const months: Record<string, PerDayEntry> = {};
          perDayData.forEach(d => {
            const key = d.date.slice(0, 7);
            if (!months[key]) months[key] = { date: key, total: 0, deptCounts: {} };
            months[key].total += d.total;
            Object.entries(d.deptCounts).forEach(([k, v]) => { months[key].deptCounts[k] = (months[key].deptCounts[k] || 0) + v; });
          });
          dailyTrend = Object.values(months);
        }

        const thirtyMinsAgo = new Date(now.getTime() - 30 * 60 * 1000).toISOString();
        const waitingTickets = (await query('SELECT created_at FROM tickets WHERE status = $1 AND support_id IS NULL AND created_at >= $2 AND partner_id = $3', ['open', thirtyMinsAgo, partnerId])) as unknown as { createdAt: string }[];
        let oldest = 0;
        waitingTickets.forEach(t => {
          if (t.createdAt) {
            oldest = Math.max(oldest, now.getTime() - new Date(t.createdAt).getTime());
          }
        });

        const avgResponseMs = totalResponseCount > 0 ? totalResponseSum / totalResponseCount : 0;
        const avgDurationMs = totalDurationCount > 0 ? totalDurationSum / totalDurationCount : 0;
        const avgRating = totalRatingCount > 0 ? Math.round((totalRatingSum / totalRatingCount) * 10) / 10 : null;
        const slaHealth = totalSlaResolved > 0 ? Math.round((totalSlaCompliant / totalSlaResolved) * 100) : 100;
        
        // p95 calculation
        let globalP95 = 0;
        if (allResponseTimes.length > 0) {
            globalP95 = computeLiveDayStats([], [], 'all', []).p95ResponseMs; // Use the helper logic
            // Wait, I need a better way to call calculatePercentile.
            const { calculatePercentile } = await import('../../services/stats.js');
            globalP95 = calculatePercentile(allResponseTimes, 95);
        } else if (historicalStats.length > 0) {
            globalP95 = Math.max(...historicalStats.map(s => s.p95ResponseMs));
        }

        const ratingsByDeptOut: Record<string, { avg: number | null; count: number }> = {};
        Object.entries(ratingsByDeptAgg).forEach(([d, stats]) => {
          ratingsByDeptOut[d] = { avg: stats.count > 0 ? Math.round((stats.sum / stats.count) * 10) / 10 : null, count: stats.count };
        });

        // Sentiment by dept
        const sentimentByDept: Record<string, { sum: number; count: number }> = {};
        liveMessages.forEach(m => {
          const ticket = allLiveTickets.find(t => t.id === m.ticket_id);
          if (ticket && m.sentiment != null) {
            if (!sentimentByDept[ticket.dept]) sentimentByDept[ticket.dept] = { sum: 0, count: 0 };
            sentimentByDept[ticket.dept].sum += m.sentiment;
            sentimentByDept[ticket.dept].count++;
          }
        });
        const sentimentByDeptOut: Record<string, { avg: number | null; count: number }> = {};
        Object.entries(sentimentByDept).forEach(([d, s]) => {
          sentimentByDeptOut[d] = { avg: s.count > 0 ? Math.round((s.sum / s.count) * 100) / 100 : null, count: s.count };
        });

        const supportMap: Record<string, SupportMapEntry> = {};
        allLiveTickets.forEach(t => {
          if (!t.supportName || !t.supportId) return;
          if (!supportMap[t.supportId]) {
            supportMap[t.supportId] = { id: t.supportId, name: t.supportName, total: 0, today: 0, trendMap: {}, ratingSum: 0, ratingCount: 0, deptStats: {} };
          }
          const support = supportMap[t.supportId];
          support.total++;
          const d = t.dept || 'Unknown';
          if (!support.deptStats[d]) support.deptStats[d] = { sum: 0, count: 0, tickets: 0 };
          support.deptStats[d].tickets++;
          const dateKey = t.createdAt ? t.createdAt.substring(0, 10) : '';
          if (dateKey === today) support.today++;
          if (!support.trendMap[dateKey]) support.trendMap[dateKey] = 0;
          support.trendMap[dateKey]++;
        });

        for (const r of liveRatings) {
          if (!r.supportId) continue;
          if (!supportMap[r.supportId]) {
            const u = (await get('SELECT name FROM users WHERE id = $1', [r.supportId])) as unknown as User;
            supportMap[r.supportId] = { id: r.supportId, name: u?.name || 'Unknown Support', total: 0, today: 0, trendMap: {}, ratingSum: 0, ratingCount: 0, deptStats: {} };
          }
          const support = supportMap[r.supportId];
          support.ratingSum += r.rating;
          support.ratingCount++;
          const ticket = allLiveTickets.find(t => t.id === r.ticketId);
          const d = ticket?.dept || 'Unknown';
          if (!support.deptStats[d]) support.deptStats[d] = { sum: 0, count: 0, tickets: 0 };
          support.deptStats[d].sum += r.rating;
          support.deptStats[d].count++;
        }

        const supportStats = await Promise.all(Object.values(supportMap).map(async (e) => {
          const trend = allDays.map(date => ({ date: date.substring(5), count: e.trendMap[date] || 0 }));
          const avgRating = e.ratingCount > 0 ? Math.round((e.ratingSum / e.ratingCount) * 10) / 10 : null;
          const deptRatings: Record<string, number | null> = {};
          Object.entries(e.deptStats).forEach(([dept, s]) => {
            deptRatings[dept] = s.count > 0 ? Math.round((s.sum / s.count) * 10) / 10 : null;
          });
          return { name: e.name, total: e.total, today: e.today, trend, avgRating, deptRatings, depts: Object.keys(e.deptStats).sort() };
        }));
        supportStats.sort((a, b) => b.total - a.total);

        const agentMap: Record<string, AgentMapEntry> = {};
        allLiveTickets.forEach(t => {
          if (!agentMap[t.agentName]) agentMap[t.agentName] = { name: t.agentName, total: 0, today: 0, trendMap: {} };
          agentMap[t.agentName].total++;
          const dateKey = t.createdAt ? t.createdAt.substring(0, 10) : '';
          if (dateKey === today) agentMap[t.agentName].today++;
          if (!agentMap[t.agentName].trendMap[dateKey]) agentMap[t.agentName].trendMap[dateKey] = 0;
          agentMap[t.agentName].trendMap[dateKey]++;
        });

        const agentStats = Object.values(agentMap).map(a => {
          const trend = allDays.map(date => ({ date: date.substring(5), count: a.trendMap[date] || 0 }));
          delete (a as { trendMap?: unknown }).trendMap;
          return { ...a, trend };
        }).sort((a, b) => b.total - a.total);

        const rangeDays = allDays.length;
        const prevEnd = new Date(rangeStart);
        prevEnd.setDate(prevEnd.getDate() - 1);
        const prevStart = new Date(prevEnd);
        prevStart.setDate(prevStart.getDate() - rangeDays + 1);
        const prevStartStr = prevStart.toISOString().slice(0, 10);
        const prevEndStr = prevEnd.toISOString().slice(0, 10);

        let prevHistSql = `SELECT SUM(total) as total, AVG(avg_response_ms) as avgresp, AVG(avg_duration_ms) as avgdur, SUM(abandoned) as abandoned, AVG(sla_resolved) as slares, AVG(sla_compliant) as slacomp, AVG(avg_rating) as avgrat
                           FROM daily_stats
                           WHERE date >= $1 AND date <= $2 AND partner_id = $3`;
        if (excludeWeekends) {
            prevHistSql += " AND EXTRACT(DOW FROM date::date) NOT IN (0, 6)";
        }
        const prevHist = (await query(prevHistSql, [prevStartStr, prevEndStr, partnerId])) as unknown as (PrevHistRow & { avgrat: number | null })[];

        const prevSlares = prevHist[0]?.slares ?? 0;
        const prevSlacomp = prevHist[0]?.slacomp ?? 0;

        const previousPeriod = {
          total: prevHist[0]?.total || 0,
          avgResponseMinutes: Math.round((prevHist[0]?.avgresp || 0) / 60000),
          avgDurationMinutes: Math.round((prevHist[0]?.avgdur || 0) / 60000),
          abandonedCount: prevHist[0]?.abandoned || 0,
          slaHealth: prevSlares > 0 ? Math.round((prevSlacomp / prevSlares) * 100) : 100,
          avgRating: prevHist[0]?.avgrat ? Math.round(prevHist[0].avgrat * 10) / 10 : null,
        };

        const responseData = {
          todayTotal: liveTickets.filter(t => t.createdAt && t.createdAt.startsWith(today)).length,
          todayOpen: liveTickets.filter(t => t.status !== 'closed' && t.createdAt && t.createdAt.startsWith(today)).length,
          todayClosed: liveTickets.filter(t => t.status === 'closed' && t.createdAt && t.createdAt.startsWith(today)).length,
          avgResponseMinutes: Math.round(avgResponseMs / 60000),
          avgDurationMinutes: Math.round(avgDurationMs / 60000),
          p95ResponseMinutes: Math.round(globalP95 / 60000),
          abandonedCount: totalAbandoned,
          reopenRate: totalCount > 0 ? Math.round((totalReopened / totalCount) * 100) : 0,
          sentimentScore: totalSentimentCount > 0 ? Math.round((totalSentimentSum / totalSentimentCount) * 100) / 100 : 0,
          total: totalCount,
          hourlyDistribution: hourlyMap.map(h => ({ ...h, count: allDays.length > 0 ? Math.round((h.count / allDays.length) * 10) / 10 : 0 })),
          hourlyStaffing: Object.values(hourlyStaffingMap).map(h => ({
            hour: h.hour,
            tickets: h.dayCount > 0 ? Math.round((h.tickets / h.dayCount) * 10) / 10 : 0,
            support: h.dayCount > 0 ? Math.round((h.support / h.dayCount) * 10) / 10 : 0,
            slaHealth: h.slaResolved > 0 ? Math.round((h.slaCompliant / h.slaResolved) * 100) : 100
          })).sort((a, b) => a.hour - b.hour),
          dailyTrend, trendGranularity, supportStats, agentStats, slaHealth, avgRating, totalRatings: totalRatingCount, ratingsByDept: ratingsByDeptOut, oldestWaitMinutes: Math.round(oldest / 60000),
          waitingOver3: waitingTickets.filter(t => t.createdAt && (now.getTime() - new Date(t.createdAt).getTime()) > 3 * 60 * 1000).length,
          deptCounts: totalDeptCounts, resolutionRate: totalCount > 0 ? Math.round((totalClosed / totalCount) * 100) : 0,
          avgConcurrency: supportIdsAgg.size > 0 ? Math.round((totalCount / supportIdsAgg.size) * 10) / 10 : 0,
          deptSla: Object.fromEntries(
            Object.entries(deptResolvedAgg).map(([d, resolved]) => [
              d, resolved > 0 ? Math.round((deptCompliantAgg[d] || 0) / resolved * 100) : 0
            ])
          ),
          daySummary: await (async () => {
            const labelsSql = `SELECT l.name, t.dept, COUNT(*) as count
                               FROM ticket_labels tl
                               JOIN labels l ON tl.label_id = l.id
                               JOIN tickets t ON tl.ticket_id = t.id
                               WHERE t.created_at::date >= $1 AND t.created_at::date <= $2 AND t.partner_id = $3
                               GROUP BY l.name, t.dept
                               ORDER BY t.dept, count DESC`;
            const labelCounts = (await query(labelsSql, [rangeStart, rangeEnd, partnerId])) as unknown as LabelCountRow[];
            const summary: Record<string, string[]> = {};
            labelCounts.forEach(lc => {
              if (!summary[lc.dept]) summary[lc.dept] = [];
              if (summary[lc.dept].length < 3) summary[lc.dept].push(lc.name);
            });
            return summary;
          })(),
          cannedResponseUsage: await (async () => {
            const cannedSql = `SELECT cr.shortcut, COUNT(*) as usage_count, AVG(r.rating) as avg_rating
                               FROM messages m
                               JOIN canned_responses cr ON m.canned_response_id = cr.id
                               JOIN ratings r ON m.ticket_id = r.ticket_id
                               JOIN tickets tk ON m.ticket_id = tk.id
                               WHERE m.created_at::date >= $1 AND m.created_at::date <= $2 AND tk.partner_id = $3
                               GROUP BY cr.shortcut
                               ORDER BY usage_count DESC`;
            return await query(cannedSql, [rangeStart, rangeEnd, partnerId]);
          })(),
          previousPeriod,
        };

        return responseData;
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        const stack = err instanceof Error ? err.stack : undefined;
        logger.error({ err: message, stack }, 'tRPC: FATAL ERROR in getGlobalStats');
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message });
      }
    }),
});
