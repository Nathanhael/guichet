import express, { Request, Response, NextFunction } from 'express';
import { createServer } from 'http';
import { Server, Socket } from 'socket.io';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import { toZonedTime } from 'date-fns-tz';
import { v4 as uuidv4 } from 'uuid';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import fs from 'fs';

import ticketRoutes from './routes/tickets.js';
import messageRoutes from './routes/messages.js';
import uploadRoutes from './routes/uploads.js';
import feedbackRoutes from './routes/feedback.js';
import labelRoutes from './routes/labels.js';
import cannedRoutes from './routes/canned_responses.js';
import authRoutes from './routes/auth.js';
import { processMessage } from './services/translate.js';
import { getLLMSummary, summarizeConversation } from './services/llm.js';
import { runGuards, resetRepetition } from './services/guards.js';
import { query, get, run, transaction } from './db.js';
import config from './config.js';
import logger from './utils/logger.js';
import { auth, authorize } from './middleware/auth.js';
import { Ticket, Message, User, TicketStatus, UserRole } from './types/index.js';

// PII Scanner
function containsPII(text: string): boolean {
  if (!text) return false;
  const patterns = [
    /\b[A-Z]{2}\d{2}[\s]?\d{4}[\s]?\d{4}[\s]?\d{4}[\s]?\d{2}\b/,  // IBAN
    /\b\d{4}[\s\-]?\d{4}[\s\-]?\d{4}[\s\-]?\d{4}\b/,               // credit card
    /\b\d{2}[.\-]\d{2}[.\-]\d{2}[.\-]\d{3}[.\-]\d{2}\b/,           // Belgian NRN
  ];
  return patterns.some((p) => p.test(text));
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();
export { app };

app.get('/api/health/ai', auth, async (req: Request, res: Response) => {
  try {
    const OLLAMA_HOST = config.OLLAMA_HOST || 'http://localhost:11434';
    const response = await fetch(`${OLLAMA_HOST}/api/tags`, { signal: AbortSignal.timeout(2000) });
    if (response.ok) {
      res.json({ status: 'online' });
    } else {
      res.json({ status: 'degraded' });
    }
  } catch (err) {
    res.json({ status: 'offline' });
  }
});

const httpServer = createServer(app);
export { httpServer };

const io = new Server(httpServer, {
  cors: { origin: config.CORS_ORIGIN, methods: ['GET', 'POST'] },
});
export { io };
app.set('io', io);

app.use(helmet({
  crossOriginResourcePolicy: { policy: "cross-origin" }
}));
app.use(cors({ origin: config.CORS_ORIGIN }));
app.use(express.json());

const globalLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 100,
  message: { error: 'Too many requests, please try again later.' }
});
app.use('/api', globalLimiter);

export const authLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 5,
  message: { error: 'Too many authentication attempts, please try again later.' }
});

export const llmLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  message: { error: 'Too many LLM requests, please try again later.' }
});

const onlineUsers = new Map<string, any>();

app.use((req: Request, res: Response, next: NextFunction) => {
  logger.info({ method: req.method, url: req.url }, `Incoming ${req.method} request`);
  next();
});

app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

app.use('/api/tickets', ticketRoutes);
app.use('/api/messages', messageRoutes);
app.use('/api/uploads', uploadRoutes);
app.use('/api/feedback', feedbackRoutes);
app.use('/api/labels', labelRoutes);
app.use('/api/canned-responses', cannedRoutes);
app.use('/api/auth', authLimiter, authRoutes);

app.get('/api/config', (_req: Request, res: Response) => {
  res.json({
    businessHoursStart: config.BUSINESS_HOURS_START,
    businessHoursEnd: config.BUSINESS_HOURS_END,
    uploadMaxSize: config.UPLOAD_MAX_SIZE,
    uploadAllowedTypes: config.UPLOAD_ALLOWED_TYPES,
  });
});

app.get('/api/health', async (_req: Request, res: Response) => {
  try {
    await query('SELECT 1');
    try {
      const ollamaRes = await fetch(`${config.OLLAMA_HOST}/api/version`, { signal: AbortSignal.timeout(2000) });
      if (!ollamaRes.ok) throw new Error('Ollama response not ok');
    } catch (err) {
      logger.warn('Ollama unavailable during health check');
      return res.status(503).json({ status: 'degraded', database: 'connected', llm: 'disconnected' });
    }
    res.json({ status: 'ok', database: 'connected', llm: 'connected' });
  } catch (err) {
    logger.error({ err }, 'Health check failed');
    res.status(503).json({ status: 'error', database: 'disconnected' });
  }
});

app.get('/api/ratings', async (_req: Request, res: Response) => {
  try {
    const ratings = await query('SELECT * FROM ratings ORDER BY "created_at" DESC');
    res.json(ratings);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/online/:userId', (_req: Request, res: Response) => {
  const online = onlineUsers.has(_req.params.userId);
  res.json({ online });
});

app.get('/api/users', async (_req: Request, res: Response) => {
  try {
    const users = await query('SELECT * FROM users');
    res.json(users);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

async function runDailyPurge() {
  try {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - config.GDPR_RETENTION_DAYS);
    const cutoffDate = cutoff.toISOString().slice(0, 10);

    const datesToAggregate = await query(
      `SELECT DISTINCT SUBSTRING(created_at FROM 1 FOR 10) as date 
       FROM tickets 
       WHERE created_at < $1 
         AND SUBSTRING(created_at FROM 1 FOR 10) NOT IN (SELECT date FROM daily_stats)`,
      [cutoffDate]
    ) as { date: string }[];

    for (const { date } of datesToAggregate) {
      const dayTickets = await query('SELECT * FROM tickets WHERE created_at LIKE $1', [`${date}%`]) as Ticket[];
      const ticketIds = dayTickets.map(t => t.id);
      let dayRatings: any[] = [];
      if (ticketIds.length > 0) {
        dayRatings = await query(`SELECT * FROM ratings WHERE "ticket_id" IN (${ticketIds.map((_, i) => `$${i + 1}`).join(',')})`, ticketIds) as any[];
      }

      const stats = computeLiveDayStats(dayTickets, dayRatings);

      await run(
        `INSERT INTO daily_stats 
        (date, total, closed, abandoned, "avg_response_ms", "avg_duration_ms", "avg_rating", "rating_count", "sla_resolved", "sla_compliant", "dept_counts", "ratings_by_dept", hourly) 
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
        ON CONFLICT (date) DO UPDATE SET
          total = EXCLUDED.total,
          closed = EXCLUDED.closed,
          abandoned = EXCLUDED.abandoned,
          "avg_response_ms" = EXCLUDED."avg_response_ms",
          "avg_duration_ms" = EXCLUDED."avg_duration_ms",
          "avg_rating" = EXCLUDED."avg_rating",
          "rating_count" = EXCLUDED."rating_count",
          "sla_resolved" = EXCLUDED."sla_resolved",
          "sla_compliant" = EXCLUDED."sla_compliant",
          "dept_counts" = EXCLUDED."dept_counts",
          "ratings_by_dept" = EXCLUDED."ratings_by_dept",
          hourly = EXCLUDED.hourly`,
        [
          date, stats.total, stats.closed, stats.abandoned,
          stats.responseCount > 0 ? Math.round(stats.responseSum / stats.responseCount) : 0,
          stats.durationCount > 0 ? Math.round(stats.durationSum / stats.durationCount) : 0,
          stats.ratingCount > 0 ? Math.round((stats.ratingSum / stats.ratingCount) * 10) / 10 : null,
          stats.ratingCount, stats.slaResolved, stats.slaCompliant,
          JSON.stringify(stats.deptCounts), JSON.stringify(stats.ratingsByDept), JSON.stringify(stats.hourly)
        ]
      );
    }

    await transaction(async () => {
      await run('DELETE FROM messages WHERE ticket_id IN (SELECT id FROM tickets WHERE created_at < $1)', [cutoffDate]);
      await run('DELETE FROM ratings WHERE ticket_id IN (SELECT id FROM tickets WHERE created_at < $1)', [cutoffDate]);
      await run('DELETE FROM ticket_labels WHERE ticket_id IN (SELECT id FROM tickets WHERE created_at < $1)', [cutoffDate]);
      await run('DELETE FROM tickets WHERE created_at < $1', [cutoffDate]);
    });

    logger.info(`[purge] GDPR purge complete for data older than ${cutoffDate}.`);
  } catch (err) {
    logger.error({ err }, '[purge] Error during daily purge');
  }
}

runDailyPurge();
setInterval(runDailyPurge, config.PURGE_INTERVAL_MS);

export function computeLiveDayStats(dayTickets: Ticket[], dayRatings: any[], deptFilter?: string) {
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

app.get('/api/stats', [auth, authorize(['admin', 'expert'])], async (req: Request, res: Response) => {
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
        const res = await query(`SELECT date FROM daily_stats WHERE date >= $1 AND date <= $2`, [prevStartStr, prevEndStr]) as any[];
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
    // Also write to a file we can read
    try {
       fs.appendFileSync('d:/Projects_Coding/i-pxs-support/server/error_log.txt', `[${new Date().toISOString()}] ${err.message}\n${err.stack}\n\n`);
    } catch(e) {}
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/stats/summary', [auth, authorize(['admin']), llmLimiter], async (req: Request, res: Response) => {
  try {
    const { periodType, periodValue } = req.query as any;
    if (!periodType || !periodValue) return res.status(400).json({ error: 'periodType and periodValue are required.' });
    
    const result = await getLLMSummary(periodType, periodValue);
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

function isWithinBusinessHours(): boolean {
  const now = toZonedTime(new Date(), 'Europe/Brussels');
  const currentMinutes = now.getHours() * 60 + now.getMinutes();
  const [startH, startM] = config.BUSINESS_HOURS_START.split(':').map(Number);
  const [endH, endM] = config.BUSINESS_HOURS_END.split(':').map(Number);
  return currentMinutes >= (startH * 60 + startM) && currentMinutes < (endH * 60 + endM);
}

function broadcastOnlineExperts() {
  const list = [...onlineUsers.values()].filter(u => u.role === 'expert').map(({ userId, name, status }) => ({ userId, name, status: status || 'available' }));
  io.emit('experts:online', list);
}

async function broadcastAgentStatus(agentId: string, online: boolean) {
  try {
    const openTickets = await query('SELECT id FROM tickets WHERE agent_id = $1 AND status != $2', [agentId, 'closed']) as { id: string }[];
    for (const ticket of openTickets) io.to(`ticket:${ticket.id}`).emit('agent:status', { ticketId: ticket.id, agentId, online });
  } catch (err: any) { logger.error({ err: err.message }, '[agent:status] error'); }
}

async function broadcastQueuePositions() {
  try {
    const openTickets = await query('SELECT id FROM tickets WHERE status = $1 AND expert_id IS NULL ORDER BY created_at ASC', ['open']) as { id: string }[];
    openTickets.forEach((t, index) => {
      const position = index + 1;
      io.to(`ticket:${t.id}`).emit('queue:update', { position, etaMins: position * 2 });
    });
  } catch (err: any) { logger.error({ err: err.message }, '[broadcastQueuePositions] error'); }
}

io.on('connection', (socket: Socket) => {
  console.log(`[socket] connected: ${socket.id}`);

  socket.on('socket:identify', ({ userId, role, name }: { userId: string, role: string, name: string }) => {
    socket.data.userId = userId;
    socket.data.role = role;
    socket.data.name = name;
    if (onlineUsers.has(userId)) onlineUsers.get(userId).count++; else onlineUsers.set(userId, { userId, name, role, status: 'available', count: 1 });
    if (role === 'expert' || role === 'admin') broadcastOnlineExperts();
    if (role === 'agent') broadcastAgentStatus(userId, true);
  });

  socket.on('ticket:new', async (data: any) => {
    if (!isWithinBusinessHours()) return socket.emit('hours:closed', { message: 'The expert chat is currently closed.' });
    try {
      const { agentId, agentLang, dept, cdbId, dareRef, text, mediaUrl } = data;
      if (!agentId || !agentLang || !dept) return socket.emit('error', { message: 'Missing required fields' });
      const agentUser = await get('SELECT name FROM users WHERE id = $1', [agentId]) as User;
      const ticket: Ticket = { id: uuidv4(), dept, agentId, agentName: agentUser?.name || agentId, agentLang, cdbId: cdbId || null, dareRef: dareRef || null, status: 'open', expertId: null, createdAt: new Date().toISOString(), participants: '[]' };
      await run('INSERT INTO tickets (id, dept, agent_id, agent_name, agent_lang, cdb_id, dare_ref, status, created_at, participants) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)', [ticket.id, ticket.dept, ticket.agentId, ticket.agentName, ticket.agentLang, ticket.cdbId, ticket.dareRef, ticket.status, ticket.createdAt, ticket.participants]);
      
      let message: Message | null = null;
      if (text?.trim()) {
        const guard = await runGuards(text, agentId);
        message = { id: uuidv4(), ticketId: ticket.id, senderId: agentId, senderName: agentUser?.name || agentId, senderRole: 'agent', senderLang: agentLang, originalText: text, improvedText: guard.text || text, processedText: guard.text || text, whisper: 0, system: 0, translationSkipped: 1, fallback: 0, timestamp: new Date().toISOString(), reactions: '{}' };
        await run(`INSERT INTO messages (id, ticket_id, sender_id, sender_name, sender_role, sender_lang, text, translated_text, media_url, whisper, system, created_at, reactions) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`, [message.id, message.ticketId, message.senderId, message.senderName, 'agent', agentLang, message.originalText, message.processedText, mediaUrl || null, 0, 0, message.timestamp, '{}']);
      }
      socket.join(`ticket:${ticket.id}`);
      socket.emit('ticket:created:self', { ticket: { ...ticket, participants: [], labels: [] }, message });
      io.emit('ticket:created', { ticket: { ...ticket, participants: [], labels: [] }, firstMessage: message });
      await broadcastQueuePositions();
    } catch (err: any) { logger.error({ err: err.message }, '[ticket:new] error'); }
  });

  socket.on('expert:join', async ({ ticketId, expertId, expertName, expertLang }: any) => {
    try {
      const ticket = await get('SELECT * FROM tickets WHERE id = $1', [ticketId]) as Ticket;
      if (!ticket) return;
      const participants = JSON.parse(ticket.participants || '[]');
      if (!participants.find((p: any) => p.id === expertId)) participants.push({ id: expertId, name: expertName });
      await run('UPDATE tickets SET expert_id = $1, expert_name = $2, expert_lang = $3, expert_joined_at = $4, participants = $5, status = $6 WHERE id = $7', [ticket.expertId || expertId, ticket.expertName || expertName, ticket.expertLang || expertLang, ticket.expertJoinedAt || new Date().toISOString(), JSON.stringify(participants), 'active', ticketId]);
      socket.join(`ticket:${ticketId}`);
      const messages = (await query('SELECT * FROM messages WHERE ticket_id = $1 ORDER BY created_at ASC', [ticketId]) as any[]).map(m => ({ ...m, whisper: !!m.whisper, system: !!m.system, reactions: JSON.parse(m.reactions || '{}') }));
      socket.emit('ticket:history', { ticketId, messages, labels: (await query('SELECT label_id FROM ticket_labels WHERE ticket_id = $1', [ticketId])).map((l: any) => l.labelId) });
      io.to(`ticket:${ticketId}`).emit('expert:joined', { ticketId, expertName, participants });
      await broadcastQueuePositions();
    } catch (err: any) { logger.error({ err: err.message }, '[expert:join] error'); }
  });

  socket.on('status:set', ({ status }: { status: string }) => {
    const userId = socket.data.userId;
    if (userId && onlineUsers.has(userId)) {
      onlineUsers.get(userId).status = status;
      broadcastOnlineExperts();
    }
  });

  socket.on('expert:leave', async ({ ticketId, expertId, expertName }: any) => {
    try {
      const ticket = await get('SELECT participants FROM tickets WHERE id = $1', [ticketId]) as Ticket;
      if (!ticket) return;
      let participants = JSON.parse(ticket.participants || '[]');
      participants = participants.filter((p: any) => p.id !== expertId);
      await run('UPDATE tickets SET participants = $1 WHERE id = $2', [JSON.stringify(participants), ticketId]);
      socket.leave(`ticket:${ticketId}`);
      io.to(`ticket:${ticketId}`).emit('expert:left', { ticketId, expertId, expertName, participants });
    } catch (err: any) { logger.error({ err: err.message }, '[expert:leave] error'); }
  });

  socket.on('ticket:close', async ({ ticketId, closedBy, closingNotes }: any) => {
    try {
      const now = new Date().toISOString();
      await run('UPDATE tickets SET status = $1, closed_at = $2, closed_by = $3, closing_notes = $4 WHERE id = $5', ['closed', now, closedBy || 'System', closingNotes || '', ticketId]);
      io.to(`ticket:${ticketId}`).emit('ticket:closed', { ticketId, status: 'closed', closedAt: now, closedBy: closedBy || 'System' });
      await broadcastQueuePositions();
    } catch (err: any) { logger.error({ err: err.message }, '[ticket:close] error'); }
  });

  socket.on('message:send', async ({ ticketId, senderId, text, mediaUrl, whisper }: any) => {
    try {
      if (!ticketId || !senderId || !text) return;
      const ticket = await get('SELECT * FROM tickets WHERE id = $1', [ticketId]) as Ticket;
      if (!ticket || ticket.status === 'closed') return;
      const sender = onlineUsers.get(senderId) || await get('SELECT name, role FROM users WHERE id = $1', [senderId]);
      if (!whisper) {
        const guard = await runGuards(text, senderId);
        if (!guard.ok) return socket.emit('message:blocked', { code: guard.code });
        text = guard.text;
        resetRepetition(senderId);
      }
      const recipientLang = (sender.role === 'agent') ? ticket.expertLang : ticket.agentLang;
      const { processedText, improvedText, translationSkipped, fallback } = await processMessage(text, sender.role, sender.lang, recipientLang || sender.lang);
      const messageId = uuidv4();
      const now = new Date().toISOString();
      await run(`INSERT INTO messages (id, ticket_id, sender_id, sender_name, text, translated_text, media_url, whisper, system, created_at, reactions) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`, [messageId, ticketId, senderId, sender.name, text, processedText, mediaUrl || null, whisper ? 1 : 0, 0, now, '{}']);
      io.to(`ticket:${ticketId}`).emit('message:new', { id: messageId, ticketId, senderId, senderName: sender.name, senderRole: sender.role, text: processedText, originalText: text, improvedText, mediaUrl, whisper: !!whisper, system: false, timestamp: now, reactions: {}, translationSkipped, fallback });
    } catch (err: any) { logger.error({ err: err.message }, '[message:send] error'); }
  });

  socket.on('reaction:toggle', async ({ ticketId, messageId, emoji, userId }: any) => {
    try {
      if (!ticketId || !messageId || !emoji || !userId) return;
      const message = await get('SELECT reactions FROM messages WHERE id = $1', [messageId]) as Message;
      if (!message) return;
      
      const reactions = JSON.parse(message.reactions || '{}');
      if (!reactions[emoji]) reactions[emoji] = [];
      
      const index = reactions[emoji].indexOf(userId);
      if (index > -1) {
        reactions[emoji].splice(index, 1);
        if (reactions[emoji].length === 0) delete reactions[emoji];
      } else {
        reactions[emoji].push(userId);
      }
      
      const reactionsStr = JSON.stringify(reactions);
      await run('UPDATE messages SET reactions = $1 WHERE id = $2', [reactionsStr, messageId]);
      io.to(`ticket:${ticketId}`).emit('reaction:updated', { ticketId, messageId, reactions });
    } catch (err: any) {
      logger.error({ err: err.message, messageId }, '[reaction:toggle] error');
    }
  });

  socket.on('ticket:labels:update', async ({ ticketId, labels }: { ticketId: string, labels: string[] }) => {
    try {
      if (!ticketId || !Array.isArray(labels)) return;
      await transaction(async () => {
        await run('DELETE FROM ticket_labels WHERE ticket_id = $1', [ticketId]);
        for (const labelId of labels) {
          await run('INSERT INTO ticket_labels (ticket_id, label_id) VALUES ($1, $2)', [ticketId, labelId]);
        }
      });
      io.to(`ticket:${ticketId}`).emit('ticket:labels:updated', { ticketId, labels });
    } catch (err: any) {
      logger.error({ err: err.message, ticketId }, '[ticket:labels:update] error');
    }
  });

  socket.on('disconnect', () => {
    const userId = socket.data.userId;
    if (userId && onlineUsers.has(userId)) {
      const u = onlineUsers.get(userId);
      u.count--;
      if (u.count <= 0) {
        onlineUsers.delete(userId);
        if (u.role === 'agent') broadcastAgentStatus(userId, false);
      }
    }
  });
});
