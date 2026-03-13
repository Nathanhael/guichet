import { Router, Request, Response } from 'express';
import rateLimit from 'express-rate-limit';
import { auth, authorize } from '../middleware/auth.js';
import { query, get } from '../db.js';
import { computeLiveDayStats } from '../services/stats.js';
import { getLLMSummary } from '../services/llm.js';
import config from '../config.js';
import logger from '../utils/logger.js';
import { Ticket, User } from '../types/index.js';

const llmLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  message: { error: 'Too many LLM requests, please try again later.' }
});

const router = Router();

router.get('/', [auth, authorize(['admin', 'expert'])], async (req: Request, res: Response) => {
  try {
    const { dateFrom, dateTo, dept, excludeWeekends } = req.query as any;
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
        if (excludeWeekends === 'true') {
          const checkDate = new Date(dateStr + 'T12:00:00Z');
          const day = checkDate.getUTCDay();
          if (day === 0 || day === 6) continue;
        }
        allDays.push(dateStr);
      }
    }

    const historicalStats = await query('SELECT * FROM daily_stats WHERE date >= $1 AND date <= $2', [rangeStart, rangeEnd]) as any[];
    const ticketsSql = `SELECT * FROM tickets WHERE SUBSTRING(created_at FROM 1 FOR 10) >= $1 AND SUBSTRING(created_at FROM 1 FOR 10) <= $2`;
    const allLiveTicketsRaw = await query(ticketsSql, [rangeStart, rangeEnd]) as Ticket[];
    const allLiveTickets = (excludeWeekends === 'true')
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

    let liveRatings: any[] = [];
    if (liveTicketIds.length > 0) {
      liveRatings = await query(`SELECT * FROM ratings WHERE "ticket_id" IN (${liveTicketIds.map((_, i) => `$${i + 1}`).join(',')})`, liveTicketIds) as any[];
    }

    let totalCount = 0, totalClosed = 0, totalAbandoned = 0;
    let totalDsc = 0, totalFot = 0;
    let globalDsc = 0, globalFot = 0;
    let totalResponseSum = 0, totalResponseCount = 0;
    let totalDurationSum = 0, totalDurationCount = 0;
    let totalRatingSum = 0, totalRatingCount = 0;
    let totalSlaResolved = 0, totalSlaCompliant = 0;
    const hourlyMap = Array.from({ length: 24 }, (_, h) => ({ hour: h, count: 0 }));
    const hourlyStaffingMap: Record<number, any> = {};
    const ratingsByDeptAgg: Record<string, any> = {};
    const deptResolvedAgg: Record<string, any> = {};
    const deptCompliantAgg: Record<string, any> = {};
    const expertIdsAgg = new Set<string>();
    const perDayData: any[] = [];

    for (const date of allDays) {
      let dayData: any;
      const hist = historicalStats.find(s => s.date === date);

      if (hist) {
        const histDeptCounts = JSON.parse(hist.deptCounts || '{}');
        globalDsc += histDeptCounts['DSC'] || 0;
        globalFot += histDeptCounts['FOT'] || 0;
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
            responseSum: hist.avgResponseMs * (deptRatio * (hist.slaResolved || 0)),
            responseCount: deptRatio * (hist.slaResolved || 0),
            durationSum: hist.avgDurationMs * (hist.closed * deptRatio),
            durationCount: hist.closed * deptRatio,
            ratingSum: deptRating ? deptRating.sum : 0,
            ratingCount: deptRating ? deptRating.count : 0,
            ratingsByDept: deptRating ? { [dept]: deptRating } : {},
            slaResolved: deptRatio * (hist.slaResolved || 0),
            slaCompliant: deptRatio * (hist.slaCompliant || 0),
            deptResolved: { [dept]: deptRatio * (hist.slaResolved || 0) },
            deptCompliant: { [dept]: deptRatio * (hist.slaCompliant || 0) },
            hourly: histHourly.map((h: number) => h * deptRatio),
          };
        } else {
          dayData = {
            total: hist.total,
            deptCounts: histDeptCounts,
            closed: hist.closed,
            abandoned: hist.abandoned,
            responseSum: hist.avgResponseMs * (hist.slaResolved || 0),
            responseCount: hist.slaResolved || 0,
            durationSum: hist.avgDurationMs * hist.closed,
            durationCount: hist.closed,
            ratingSum: hist.avgRating ? hist.avgRating * hist.ratingCount : 0,
            ratingCount: hist.ratingCount,
            ratingsByDept: histRatingsByDept,
            slaResolved: hist.slaResolved || 0,
            slaCompliant: hist.slaCompliant || 0,
            deptResolved: Object.fromEntries(
              Object.entries(histDeptCounts).map(([d, count]: [string, any]) => [
                d, (hist.total > 0 ? count / hist.total : 0) * (hist.slaResolved || 0)
              ])
            ),
            deptCompliant: Object.fromEntries(
              Object.entries(histDeptCounts).map(([d, count]: [string, any]) => [
                d, (hist.total > 0 ? count / hist.total : 0) * (hist.slaCompliant || 0)
              ])
            ),
            hourly: histHourly,
          };
        }
      } else {
        const dayTickets = liveTickets.filter(t => t.createdAt && t.createdAt.startsWith(date));
        const dayRatings = liveRatings.filter(r => dayTickets.some(t => t.id === r.ticketId));
        dayData = computeLiveDayStats(dayTickets, dayRatings, dept);

        const allDayTickets = allLiveTickets.filter(t => t.createdAt && t.createdAt.startsWith(date));
        globalDsc += allDayTickets.filter(t => t.dept === 'DSC').length;
        globalFot += allDayTickets.filter(t => t.dept === 'FOT').length;
      }

      perDayData.push({
        date,
        total: dayData.total,
        dsc: dayData.deptCounts['DSC'] || 0,
        fot: dayData.deptCounts['FOT'] || 0
      });
      totalCount += dayData.total;
      totalDsc += dayData.deptCounts['DSC'] || 0;
      totalFot += dayData.deptCounts['FOT'] || 0;
      totalClosed += dayData.closed;
      totalAbandoned += dayData.abandoned;
      totalResponseSum += dayData.responseSum;
      totalResponseCount += dayData.responseCount;
      totalDurationSum += dayData.durationSum;
      totalDurationCount += dayData.durationCount;
      totalRatingSum += dayData.ratingSum;
      totalRatingCount += dayData.ratingCount;
      totalSlaResolved += dayData.slaResolved;
      totalSlaCompliant += dayData.slaCompliant;

      if (dayData.hourlyStaffing) {
        dayData.hourlyStaffing.forEach((item: any) => {
          const slot = hourlyMap.find(h => h.hour === item.hour);
          if (slot) {
            slot.count += item.tickets;
            if (!hourlyStaffingMap[item.hour]) {
              hourlyStaffingMap[item.hour] = { hour: item.hour, tickets: 0, experts: 0, dayCount: 0, slaResolved: 0, slaCompliant: 0 };
            }
            hourlyStaffingMap[item.hour].tickets += item.tickets;
            hourlyStaffingMap[item.hour].experts += item.experts;
            hourlyStaffingMap[item.hour].slaResolved += (item.slaResolved || 0);
            hourlyStaffingMap[item.hour].slaCompliant += (item.slaCompliant || 0);
            hourlyStaffingMap[item.hour].dayCount++;
          }
        });
      } else {
        dayData.hourly.forEach((count: number, h: number) => {
          hourlyMap[h].count += count;
          if (!hourlyStaffingMap[h]) {
            hourlyStaffingMap[h] = { hour: h, tickets: 0, experts: 0, dayCount: 0, slaResolved: 0, slaCompliant: 0 };
          }
          hourlyStaffingMap[h].tickets += count;
          hourlyStaffingMap[h].dayCount++;
        });
      }

      if (dayData.expertIds) dayData.expertIds.forEach((id: string) => expertIdsAgg.add(id));

      Object.entries(dayData.deptResolved || {}).forEach(([d, count]: [string, any]) => {
        deptResolvedAgg[d] = (deptResolvedAgg[d] || 0) + count;
      });
      Object.entries(dayData.deptCompliant || {}).forEach(([d, count]: [string, any]) => {
        deptCompliantAgg[d] = (deptCompliantAgg[d] || 0) + count;
      });

      Object.entries(dayData.ratingsByDept).forEach(([d, stats]: [string, any]) => {
        if (!ratingsByDeptAgg[d]) ratingsByDeptAgg[d] = { sum: 0, count: 0 };
        ratingsByDeptAgg[d].sum += stats.sum;
        ratingsByDeptAgg[d].count += stats.count;
      });
    }

    let trendGranularity: string, dailyTrend: any[];
    if (allDays.length <= 30) {
      trendGranularity = 'daily';
      dailyTrend = perDayData.map(d => ({ ...d, date: d.date.slice(5) }));
    } else if (allDays.length <= 90) {
      trendGranularity = 'weekly';
      const weeks: any[] = [];
      for (let i = 0; i < perDayData.length; i += 7) {
        const chunk = perDayData.slice(i, i + 7);
        weeks.push({
          date: `W${weeks.length + 1}`,
          total: chunk.reduce((s, d) => s + d.total, 0),
          dsc: chunk.reduce((s, d) => s + d.dsc, 0),
          fot: chunk.reduce((s, d) => s + d.fot, 0),
        });
      }
      dailyTrend = weeks;
    } else {
      trendGranularity = 'monthly';
      const months: Record<string, any> = {};
      perDayData.forEach(d => {
        const key = d.date.slice(0, 7);
        if (!months[key]) months[key] = { date: key, total: 0, dsc: 0, fot: 0 };
        months[key].total += d.total;
        months[key].dsc += d.dsc;
        months[key].fot += d.fot;
      });
      dailyTrend = Object.values(months);
    }

    const thirtyMinsAgo = new Date(now.getTime() - 30 * 60 * 1000).toISOString();
    const waitingTickets = await query('SELECT created_at FROM tickets WHERE status = $1 AND expert_id IS NULL AND created_at >= $2', ['open', thirtyMinsAgo]) as { createdAt: string }[];
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

    const ratingsByDeptOut: Record<string, any> = {};
    Object.entries(ratingsByDeptAgg).forEach(([d, stats]) => {
      ratingsByDeptOut[d] = { avg: stats.count > 0 ? Math.round((stats.sum / stats.count) * 10) / 10 : null, count: stats.count };
    });

    const expertMap: Record<string, any> = {};
    allLiveTickets.forEach(t => {
      if (!t.expertName || !t.expertId) return;
      if (!expertMap[t.expertId]) {
        expertMap[t.expertId] = { id: t.expertId, name: t.expertName, total: 0, today: 0, trendMap: {}, ratingSum: 0, ratingCount: 0, deptStats: {} };
      }
      const expert = expertMap[t.expertId];
      expert.total++;
      const d = t.dept || 'Unknown';
      if (!expert.deptStats[d]) expert.deptStats[d] = { sum: 0, count: 0, tickets: 0 };
      expert.deptStats[d].tickets++;
      const dateKey = t.createdAt ? t.createdAt.substring(0, 10) : '';
      if (dateKey === today) expert.today++;
      if (!expert.trendMap[dateKey]) expert.trendMap[dateKey] = 0;
      expert.trendMap[dateKey]++;
    });

    for (const r of liveRatings) {
      if (!r.expertId) continue;
      if (!expertMap[r.expertId]) {
        const u = await get('SELECT name FROM users WHERE id = $1', [r.expertId]) as User;
        expertMap[r.expertId] = { id: r.expertId, name: u?.name || 'Unknown Expert', total: 0, today: 0, trendMap: {}, ratingSum: 0, ratingCount: 0, deptStats: {} };
      }
      const expert = expertMap[r.expertId];
      expert.ratingSum += r.rating;
      expert.ratingCount++;
      const ticket = allLiveTickets.find(t => t.id === r.ticketId);
      const d = ticket?.dept || 'Unknown';
      if (!expert.deptStats[d]) expert.deptStats[d] = { sum: 0, count: 0, tickets: 0 };
      expert.deptStats[d].sum += r.rating;
      expert.deptStats[d].count++;
    }

    const expertStats = await Promise.all(Object.values(expertMap).map(async (e: any) => {
      const trend = allDays.map(date => ({ date: date.substring(5), count: e.trendMap[date] || 0 }));
      const avgRating = e.ratingCount > 0 ? Math.round((e.ratingSum / e.ratingCount) * 10) / 10 : null;
      const deptRatings: Record<string, any> = {};
      Object.entries(e.deptStats).forEach(([dept, s]: [string, any]) => {
        deptRatings[dept] = s.count > 0 ? Math.round((s.sum / s.count) * 10) / 10 : null;
      });
      return { name: e.name, total: e.total, today: e.today, trend, avgRating, deptRatings, depts: Object.keys(e.deptStats).sort() };
    }));
    expertStats.sort((a, b) => b.total - a.total);

    const agentMap: Record<string, any> = {};
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
      delete a.trendMap;
      return { ...a, trend };
    }).sort((a, b) => b.total - a.total);

    const rangeDays = allDays.length;
    const prevEnd = new Date(rangeStart);
    prevEnd.setDate(prevEnd.getDate() - 1);
    const prevStart = new Date(prevEnd);
    prevStart.setDate(prevStart.getDate() - rangeDays + 1);
    const prevStartStr = prevStart.toISOString().slice(0, 10);
    const prevEndStr = prevEnd.toISOString().slice(0, 10);

    let prevHistSql = `SELECT SUM(total) as total, AVG(avg_response_ms) as avgresp, AVG(avg_duration_ms) as avgdur, SUM(abandoned) as abandoned, AVG(sla_resolved) as slares, AVG(sla_compliant) as slacomp
                       FROM daily_stats
                       WHERE date >= $1 AND date <= $2`;
    if (excludeWeekends === 'true') {
        const _res = await query(`SELECT date FROM daily_stats WHERE date >= $1 AND date <= $2`, [prevStartStr, prevEndStr]) as any[];
        prevHistSql += " AND EXTRACT(DOW FROM date::date) NOT IN (0, 6)";
    }
    const prevHist = await query(prevHistSql, [prevStartStr, prevEndStr]) as any[];

    const previousPeriod = {
      total: prevHist[0]?.total || 0,
      avgResponseMinutes: Math.round((prevHist[0]?.avgresp || 0) / 60000),
      avgDurationMinutes: Math.round((prevHist[0]?.avgdur || 0) / 60000),
      abandonedCount: prevHist[0]?.abandoned || 0,
      slaHealth: prevHist[0]?.slares > 0 ? Math.round((prevHist[0]?.slacomp / prevHist[0]?.slares) * 100) : 100,
    };

    const responseData = {
      todayTotal: liveTickets.filter(t => t.createdAt && t.createdAt.startsWith(today)).length,
      todayOpen: liveTickets.filter(t => t.status !== 'closed' && t.createdAt && t.createdAt.startsWith(today)).length,
      todayClosed: liveTickets.filter(t => t.status === 'closed' && t.createdAt && t.createdAt.startsWith(today)).length,
      avgResponseMinutes: Math.round(avgResponseMs / 60000),
      avgDurationMinutes: Math.round(avgDurationMs / 60000),
      abandonedCount: totalAbandoned,
      total: totalCount,
      hourlyDistribution: hourlyMap.map(h => ({ ...h, count: allDays.length > 0 ? Math.round((h.count / allDays.length) * 10) / 10 : 0 })),
      hourlyStaffing: Object.values(hourlyStaffingMap).map(h => ({
        hour: h.hour,
        tickets: h.dayCount > 0 ? Math.round((h.tickets / h.dayCount) * 10) / 10 : 0,
        experts: h.dayCount > 0 ? Math.round((h.experts / h.dayCount) * 10) / 10 : 0,
        slaHealth: h.slaResolved > 0 ? Math.round((h.slaCompliant / h.slaResolved) * 100) : 100
      })).sort((a, b) => a.hour - b.hour),
      dailyTrend, trendGranularity, expertStats, agentStats, slaHealth, avgRating, totalRatings: totalRatingCount, ratingsByDept: ratingsByDeptOut, oldestWaitMinutes: Math.round(oldest / 60000),
      waitingOver3: waitingTickets.filter(t => t.createdAt && (now.getTime() - new Date(t.createdAt).getTime()) > 3 * 60 * 1000).length,
      dscCount: totalDsc, fotCount: totalFot, globalDscCount: globalDsc, globalFotCount: globalFot, resolutionRate: totalCount > 0 ? Math.round((totalClosed / totalCount) * 100) : 0,
      avgConcurrency: expertIdsAgg.size > 0 ? Math.round((totalCount / expertIdsAgg.size) * 10) / 10 : 0,
      deptSla: {
        DSC: deptResolvedAgg['DSC'] > 0 ? Math.round((deptCompliantAgg['DSC'] || 0) / deptResolvedAgg['DSC'] * 100) : 0,
        FOT: deptResolvedAgg['FOT'] > 0 ? Math.round((deptCompliantAgg['FOT'] || 0) / deptResolvedAgg['FOT'] * 100) : 0,
      },
      daySummary: await (async () => {
        const labelsSql = `SELECT l.name, t.dept, COUNT(*) as count
                           FROM ticket_labels tl
                           JOIN labels l ON tl.label_id = l.id
                           JOIN tickets t ON tl.ticket_id = t.id
                           WHERE SUBSTRING(t.created_at FROM 1 FOR 10) >= $1 AND SUBSTRING(t.created_at FROM 1 FOR 10) <= $2
                           GROUP BY l.name, t.dept
                           ORDER BY t.dept, count DESC`;
        const labelCounts = await query(labelsSql, [rangeStart, rangeEnd]) as any[];
        const summary: any = { DSC: [], FOT: [] };
        labelCounts.forEach(lc => { if (summary[lc.dept] && summary[lc.dept].length < 3) summary[lc.dept].push(lc.name); });
        return summary;
      })(),
      previousPeriod,
    };

    res.json(responseData);
  } catch (err: any) {
    logger.error({ err: err.message, stack: err.stack }, 'FATAL ERROR in /api/stats');
    res.status(500).json({ error: err.message });
  }
});

router.get('/summary', [auth, authorize(['admin']), llmLimiter], async (req: Request, res: Response) => {
  try {
    const { periodType, periodValue } = req.query as any;
    if (!periodType || !periodValue) return res.status(400).json({ error: 'periodType and periodValue are required.' });

    const result = await getLLMSummary(periodType, periodValue);
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
