import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import { toZonedTime } from 'date-fns-tz';
import { v4 as uuidv4 } from 'uuid';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';

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
import { db, query, get, run, transaction } from './db.js';
import config from './config.js';
import logger from './utils/logger.js';
import { auth, authorize } from './middleware/auth.js';

// PII Scanner
function containsPII(text) {
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

app.get('/api/health/ai', auth, async (req, res) => {
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
  crossOriginResourcePolicy: { policy: "cross-origin" } // allow images to be loaded from same site
}));
app.use(cors({ origin: config.CORS_ORIGIN }));
app.use(express.json());

// Global Rate Limiter: 100 requests per minute
const globalLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 100,
  message: { error: 'Too many requests, please try again later.' }
});
app.use('/api', globalLimiter);

// Auth Rate Limiter: 5 requests per minute
export const authLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 5,
  message: { error: 'Too many authentication attempts, please try again later.' }
});

// LLM Rate Limiter: 10 requests per minute
export const llmLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  message: { error: 'Too many LLM requests, please try again later.' }
});

const onlineUsers = new Map();
app.use((req, res, next) => {
  logger.info({ method: req.method, url: req.url }, `Incoming ${req.method} request`);
  next();
});

app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// REST routes
app.use('/api/tickets', ticketRoutes);
app.use('/api/messages', messageRoutes);
app.use('/api/uploads', uploadRoutes);
app.use('/api/feedback', feedbackRoutes);
app.use('/api/labels', labelRoutes);
app.use('/api/canned-responses', cannedRoutes);
app.use('/api/auth', authLimiter, authRoutes);

// GET /api/config — serve basic config to client
app.get('/api/config', (_req, res) => {
  res.json({
    businessHoursStart: config.BUSINESS_HOURS_START,
    businessHoursEnd: config.BUSINESS_HOURS_END,
    uploadMaxSize: config.UPLOAD_MAX_SIZE,
    uploadAllowedTypes: config.UPLOAD_ALLOWED_TYPES,
  });
});

// GET /api/health — health check endpoint
app.get('/api/health', async (_req, res) => {
  try {
    query('SELECT 1'); // Check DB connection

    // Check Ollama fallback
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

// GET /api/ratings
app.get('/api/ratings', async (_req, res) => {
  try {
    const ratings = query('SELECT * FROM ratings ORDER BY createdAt DESC');
    res.json(ratings);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/online/:userId — check if a user is online
app.get('/api/online/:userId', (_req, res) => {
  const online = onlineUsers.has(_req.params.userId);
  res.json({ online });
});

// GET /api/users
app.get('/api/users', async (_req, res) => {
  try {
    const users = query('SELECT * FROM users');
    res.json(users);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GDPR: Daily purge of individual data older than 30 days ──
async function runDailyPurge() {
  try {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - config.GDPR_RETENTION_DAYS);
    const cutoffDate = cutoff.toISOString().slice(0, 10);

    // Find dates that have tickets older than cutoff but are NOT yet in daily_stats
    const datesToAggregate = query(
      "SELECT DISTINCT substr(createdAt, 1, 10) as date FROM tickets WHERE createdAt < ? AND substr(createdAt, 1, 10) NOT IN (SELECT date FROM daily_stats)",
      [cutoffDate]
    );

    for (const { date } of datesToAggregate) {
      const dayTickets = query("SELECT * FROM tickets WHERE createdAt LIKE ?", [`${date}%`]);
      const ticketIds = dayTickets.map(t => t.id);
      let dayRatings = [];
      if (ticketIds.length > 0) {
        dayRatings = query(`SELECT * FROM ratings WHERE ticketId IN (${ticketIds.map(() => '?').join(',')})`, ticketIds);
      }

      const stats = computeLiveDayStats(dayTickets, dayRatings);

      run(
        `INSERT OR REPLACE INTO daily_stats 
        (date, total, closed, abandoned, avgResponseMs, avgDurationMs, avgRating, ratingCount, slaResolved, slaCompliant, deptCounts, ratingsByDept, hourly) 
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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

    // Now delete individual data older than cutoff
    transaction(() => {
      // Delete from child tables first to avoid FK violations (even with CASCADE, it's cleaner)
      run("DELETE FROM messages WHERE ticketId IN (SELECT id FROM tickets WHERE createdAt < ?)", [cutoffDate]);
      run("DELETE FROM ratings WHERE ticketId IN (SELECT id FROM tickets WHERE createdAt < ?)", [cutoffDate]);
      run("DELETE FROM ticket_labels WHERE ticketId IN (SELECT id FROM tickets WHERE createdAt < ?)", [cutoffDate]);

      // Finally delete the parent tickets
      run("DELETE FROM tickets WHERE createdAt < ?", [cutoffDate]);
    });

    logger.info(`[purge] GDPR purge complete for data older than ${cutoffDate}.`);
  } catch (err) {
    logger.error({ err }, '[purge] Error during daily purge');
  }
}

// Run purge on startup and every 24 hours
runDailyPurge();
setInterval(runDailyPurge, config.PURGE_INTERVAL_MS);

// ── Helper: compute stats from live tickets for a single day ──
export function computeLiveDayStats(dayTickets, dayRatings, deptFilter) {
  let tickets = dayTickets;
  let ratings = dayRatings;
  if (deptFilter && deptFilter !== 'all') {
    tickets = tickets.filter(t => t.dept === deptFilter);
    const tIds = new Set(tickets.map(t => t.id));
    ratings = ratings.filter(r => tIds.has(r.ticketId));
  }

  const deptCounts = {};
  const hourly = Array(24).fill(0);
  const hourlyExperts = Array.from({ length: 24 }, () => ({})); // expertId -> count
  const hourlySla = Array.from({ length: 24 }, () => ({ resolved: 0, compliant: 0 }));
  let closed = 0, abandoned = 0;
  let responseSum = 0, responseCount = 0;
  let durationSum = 0, durationCount = 0;
  const ratingsByDept = {};
  const deptResolved = {};
  const deptCompliant = {};
  const expertIds = new Set();

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
      const responseTime = new Date(t.expertJoinedAt) - createdAt;
      responseSum += responseTime;
      responseCount++;
      deptResolved[t.dept] = (deptResolved[t.dept] || 0) + 1;

      const isCompliant = responseTime <= config.SLA_THRESHOLD_MS;
      if (isCompliant) deptCompliant[t.dept] = (deptCompliant[t.dept] || 0) + 1;

      // Hourly SLA tracking
      hourlySla[hour].resolved++;
      if (isCompliant) hourlySla[hour].compliant++;
    }

    if (t.status === 'closed' && t.closedAt) {
      durationSum += new Date(t.closedAt) - createdAt;
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
  const compliant = resolved.filter(t => (new Date(t.expertJoinedAt) - new Date(t.createdAt)) <= config.SLA_THRESHOLD_MS).length;

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
      const topExpertId = expertsInHour.reduce((a, b) =>
        hourlyExperts[h][a] > hourlyExperts[h][b] ? a : b,
        expertsInHour[0] || null
      );

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

// GET /api/stats — manager statistics (merges live + historical data)
app.get('/api/stats', [auth, authorize(['admin', 'expert'])], async (req, res) => {
  try {
    const { dateFrom, dateTo, dept, excludeWeekends } = req.query;
    const now = new Date();
    const today = now.toISOString().slice(0, 10);

    // Determine date range
    let rangeStart, rangeEnd;
    if (dateFrom && dateTo) {
      rangeStart = dateFrom;
      rangeEnd = dateTo;
    } else {
      const d = new Date(now);
      d.setDate(d.getDate() - 29);
      rangeStart = d.toISOString().slice(0, 10);
      rangeEnd = today;
    }

    // Build list of all days in range
    const allDays = [];
    {
      const start = new Date(rangeStart);
      const end = new Date(rangeEnd);
      for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
        const dateStr = d.toISOString().slice(0, 10);
        if (excludeWeekends === 'true') {
          // Use UTC to avoid timezone shifts during weekend check
          const checkDate = new Date(dateStr + 'T12:00:00Z');
          const day = checkDate.getUTCDay();
          if (day === 0 || day === 6) continue; // Skip Sun (0) and Sat (6)
        }
        allDays.push(dateStr);
      }
    }

    // Fetch all relevant data once
    const historicalStats = query("SELECT * FROM daily_stats WHERE date >= ? AND date <= ?", [rangeStart, rangeEnd]);

    const ticketsSql = "SELECT * FROM tickets WHERE substr(createdAt, 1, 10) >= ? AND substr(createdAt, 1, 10) <= ?";
    const allLiveTicketsRaw = query(ticketsSql, [rangeStart, rangeEnd]);
    const allLiveTickets = (excludeWeekends === 'true')
      ? allLiveTicketsRaw.filter(t => {
        const dateStr = t.createdAt.substring(0, 10);
        const checkDate = new Date(dateStr + 'T12:00:00Z');
        const day = checkDate.getUTCDay();
        return day !== 0 && day !== 6;
      })
      : allLiveTicketsRaw;

    const liveTickets = (dept && dept !== 'all') ? allLiveTickets.filter(t => t.dept === dept) : allLiveTickets;
    const liveTicketIds = liveTickets.map(t => t.id);

    let liveRatings = [];
    if (liveTicketIds.length > 0) {
      liveRatings = query(`SELECT * FROM ratings WHERE ticketId IN (${liveTicketIds.map(() => '?').join(',')})`, liveTicketIds);
    }

    // Aggregate totals
    let totalCount = 0, totalClosed = 0, totalAbandoned = 0;
    let totalDsc = 0, totalFot = 0;
    let globalDsc = 0, globalFot = 0;
    let totalResponseSum = 0, totalResponseCount = 0;
    let totalDurationSum = 0, totalDurationCount = 0;
    let totalRatingSum = 0, totalRatingCount = 0;
    let totalSlaResolved = 0, totalSlaCompliant = 0;
    const hourlyMap = Array.from({ length: 24 }, (_, h) => ({ hour: h, count: 0 }));
    const hourlyStaffingMap = {};
    const ratingsByDeptAgg = {};
    const deptResolvedAgg = {};
    const deptCompliantAgg = {};
    const expertIdsAgg = new Set();
    const perDayData = [];

    for (const date of allDays) {
      let dayData;
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
            hourly: histHourly.map(h => h * deptRatio),
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
              Object.entries(histDeptCounts).map(([d, count]) => [
                d, (hist.total > 0 ? count / hist.total : 0) * (hist.slaResolved || 0)
              ])
            ),
            deptCompliant: Object.fromEntries(
              Object.entries(histDeptCounts).map(([d, count]) => [
                d, (hist.total > 0 ? count / hist.total : 0) * (hist.slaCompliant || 0)
              ])
            ),
            hourly: histHourly,
          };
        }
      } else {
        const dayTickets = liveTickets.filter(t => t.createdAt.startsWith(date));
        const dayRatings = liveRatings.filter(r => dayTickets.some(t => t.id === r.ticketId));
        dayData = computeLiveDayStats(dayTickets, dayRatings, dept);

        const allDayTickets = allLiveTickets.filter(t => t.createdAt.startsWith(date));
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
        dayData.hourlyStaffing.forEach(item => {
          const slot = hourlyMap.find(h => h.hour === item.hour);
          if (slot) {
            slot.count += item.tickets;
            // Since we're aggregating multiple days, we'll store the values in a map for Staffing chart
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
        dayData.hourly.forEach((count, h) => {
          hourlyMap[h].count += count;
          if (!hourlyStaffingMap[h]) {
            hourlyStaffingMap[h] = { hour: h, tickets: 0, experts: 0, dayCount: 0, slaResolved: 0, slaCompliant: 0 };
          }
          hourlyStaffingMap[h].tickets += count;
          hourlyStaffingMap[h].dayCount++;
        });
      }

      // Concurrency
      if (dayData.expertIds) dayData.expertIds.forEach(id => expertIdsAgg.add(id));

      // Dept SLA
      Object.entries(dayData.deptResolved || {}).forEach(([d, count]) => {
        deptResolvedAgg[d] = (deptResolvedAgg[d] || 0) + count;
      });
      Object.entries(dayData.deptCompliant || {}).forEach(([d, count]) => {
        deptCompliantAgg[d] = (deptCompliantAgg[d] || 0) + count;
      });

      // Aggregate ratingsByDept
      Object.entries(dayData.ratingsByDept).forEach(([d, stats]) => {
        if (!ratingsByDeptAgg[d]) ratingsByDeptAgg[d] = { sum: 0, count: 0 };
        ratingsByDeptAgg[d].sum += stats.sum;
        ratingsByDeptAgg[d].count += stats.count;
      });
    }

    // Smart trend grouping
    let trendGranularity, dailyTrend;
    if (allDays.length <= 30) {
      trendGranularity = 'daily';
      dailyTrend = perDayData.map(d => ({ ...d, date: d.date.slice(5) })); // MM-DD
    } else if (allDays.length <= 90) {
      trendGranularity = 'weekly';
      const weeks = [];
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
      const months = {};
      perDayData.forEach(d => {
        const key = d.date.slice(0, 7); // YYYY-MM
        if (!months[key]) months[key] = { date: key, total: 0, dsc: 0, fot: 0 };
        months[key].total += d.total;
        months[key].dsc += d.dsc;
        months[key].fot += d.fot;
      });
      dailyTrend = Object.values(months);
    }

    // Current online / waiting context (Last 30 mins)
    const thirtyMinsAgo = new Date(now - 30 * 60 * 1000).toISOString();
    const waitingTickets = query("SELECT createdAt FROM tickets WHERE status = ? AND expertId IS NULL AND createdAt >= ?", ['open', thirtyMinsAgo]);
    let oldest = 0;
    waitingTickets.forEach(t => { oldest = Math.max(oldest, now - new Date(t.createdAt)); });

    const avgResponseMs = totalResponseCount > 0 ? totalResponseSum / totalResponseCount : 0;
    const avgDurationMs = totalDurationCount > 0 ? totalDurationSum / totalDurationCount : 0;
    const avgRating = totalRatingCount > 0 ? Math.round((totalRatingSum / totalRatingCount) * 10) / 10 : null;
    const slaHealth = totalSlaResolved > 0 ? Math.round((totalSlaCompliant / totalSlaResolved) * 100) : 100;

    const ratingsByDeptOut = {};
    Object.entries(ratingsByDeptAgg).forEach(([d, stats]) => {
      ratingsByDeptOut[d] = { avg: stats.count > 0 ? Math.round((stats.sum / stats.count) * 10) / 10 : null, count: stats.count };
    });

    // Expert performance stats (All)
    const expertMap = {};

    // 1. First Pass: Initialize experts from tickets
    allLiveTickets.forEach(t => {
      if (!t.expertName || !t.expertId) return;
      if (!expertMap[t.expertId]) {
        expertMap[t.expertId] = {
          id: t.expertId,
          name: t.expertName,
          total: 0,
          today: 0,
          trendMap: {},
          ratingSum: 0,
          ratingCount: 0,
          deptStats: {}
        };
      }
      const expert = expertMap[t.expertId];
      expert.total++;

      const d = t.dept || 'Unknown';
      if (!expert.deptStats[d]) {
        expert.deptStats[d] = { sum: 0, count: 0, tickets: 0 };
      }
      expert.deptStats[d].tickets++;

      const dateKey = t.createdAt.substring(0, 10);
      if (dateKey === today) expert.today++;

      if (!expert.trendMap[dateKey]) expert.trendMap[dateKey] = 0;
      expert.trendMap[dateKey]++;
    });

    // 2. Second Pass: Attribute ratings directly from r.expertId
    liveRatings.forEach(r => {
      if (!r.expertId) return;

      // If expert not in map (maybe handled 0 tickets in this period but got rated)
      if (!expertMap[r.expertId]) {
        const u = get('SELECT name FROM users WHERE id = ?', [r.expertId]);
        expertMap[r.expertId] = {
          id: r.expertId,
          name: u?.name || 'Unknown Expert',
          total: 0,
          today: 0,
          trendMap: {},
          ratingSum: 0,
          ratingCount: 0,
          deptStats: {}
        };
      }

      const expert = expertMap[r.expertId];
      expert.ratingSum += r.rating;
      expert.ratingCount++;

      const ticket = allLiveTickets.find(t => t.id === r.ticketId);
      const d = ticket?.dept || 'Unknown';
      if (!expert.deptStats[d]) {
        expert.deptStats[d] = { sum: 0, count: 0, tickets: 0 };
      }
      expert.deptStats[d].sum += r.rating;
      expert.deptStats[d].count++;
    });

    const expertStats = Object.values(expertMap).map(e => {
      const trend = allDays.map(date => ({
        date: date.substring(5), // MM-DD
        count: e.trendMap[date] || 0
      }));
      const avgRating = e.ratingCount > 0 ? Math.round((e.ratingSum / e.ratingCount) * 10) / 10 : null;

      const deptRatings = {};
      Object.entries(e.deptStats).forEach(([dept, s]) => {
        deptRatings[dept] = s.count > 0 ? Math.round((s.sum / s.count) * 10) / 10 : null;
      });
      const depts = Object.keys(e.deptStats).sort();

      return {
        name: e.name,
        total: e.total,
        today: e.today,
        trend,
        avgRating,
        deptRatings,
        depts
      };
    }).sort((a, b) => b.total - a.total);

    // Agent performance stats (All)
    const agentMap = {};
    allLiveTickets.forEach(t => {
      if (!agentMap[t.agentName]) agentMap[t.agentName] = { name: t.agentName, total: 0, today: 0, trendMap: {} };
      agentMap[t.agentName].total++;

      const dateKey = t.createdAt.substring(0, 10);
      if (dateKey === today) agentMap[t.agentName].today++;

      if (!agentMap[t.agentName].trendMap[dateKey]) agentMap[t.agentName].trendMap[dateKey] = 0;
      agentMap[t.agentName].trendMap[dateKey]++;
    });

    const agentStats = Object.values(agentMap).map(a => {
      const trend = allDays.map(date => ({
        date: date.substring(5), // MM-DD
        count: a.trendMap[date] || 0
      }));
      delete a.trendMap;
      return { ...a, trend };
    }).sort((a, b) => b.total - a.total);

    // Compare with previous period
    const rangeDays = allDays.length;
    const prevEnd = new Date(rangeStart);
    prevEnd.setDate(prevEnd.getDate() - 1);
    const prevStart = new Date(prevEnd);
    prevStart.setDate(prevStart.getDate() - rangeDays + 1);
    const prevStartStr = prevStart.toISOString().slice(0, 10);
    const prevEndStr = prevEnd.toISOString().slice(0, 10);

    // Simple historical comparison for brevity
    let prevHistSql = "SELECT SUM(total) as total, AVG(avgResponseMs) as avgResp, AVG(avgDurationMs) as avgDur, SUM(abandoned) as abandoned, AVG(slaResolved) as slaRes, AVG(slaCompliant) as slaComp FROM daily_stats WHERE date >= ? AND date <= ?";
    if (excludeWeekends === 'true') {
      prevHistSql += " AND strftime('%w', date) NOT IN ('0', '6')";
    }
    const prevHist = query(prevHistSql, [prevStartStr, prevEndStr]);

    const previousPeriod = {
      total: prevHist[0]?.total || 0,
      avgResponseMinutes: Math.round((prevHist[0]?.avgResp || 0) / 60000),
      avgDurationMinutes: Math.round((prevHist[0]?.avgDur || 0) / 60000),
      abandonedCount: prevHist[0]?.abandoned || 0,
      slaHealth: prevHist[0]?.slaRes > 0 ? Math.round((prevHist[0]?.slaComp / prevHist[0]?.slaRes) * 100) : 100,
    };

    const responseData = {
      todayTotal: liveTickets.filter(t => t.createdAt.startsWith(today)).length,
      todayOpen: liveTickets.filter(t => t.status !== 'closed' && t.createdAt.startsWith(today)).length,
      todayClosed: liveTickets.filter(t => t.status === 'closed' && t.createdAt.startsWith(today)).length,
      avgResponseMinutes: Math.round(avgResponseMs / 60000),
      avgDurationMinutes: Math.round(avgDurationMs / 60000),
      abandonedCount: totalAbandoned,
      total: totalCount,
      hourlyDistribution: hourlyMap.map(h => ({
        ...h,
        count: allDays.length > 0 ? Math.round((h.count / allDays.length) * 10) / 10 : 0
      })),
      hourlyStaffing: Object.values(hourlyStaffingMap).map(h => ({
        hour: h.hour,
        tickets: h.dayCount > 0 ? Math.round((h.tickets / h.dayCount) * 10) / 10 : 0,
        experts: h.dayCount > 0 ? Math.round((h.experts / h.dayCount) * 10) / 10 : 0,
        slaHealth: h.slaResolved > 0 ? Math.round((h.slaCompliant / h.slaResolved) * 100) : 100
      })).sort((a, b) => a.hour - b.hour),
      dailyTrend,
      trendGranularity,
      expertStats,
      agentStats,
      slaHealth,
      avgRating,
      totalRatings: totalRatingCount,
      ratingsByDept: ratingsByDeptOut,
      oldestWaitMinutes: Math.round(oldest / 60000),
      waitingOver3: waitingTickets.filter(t => (now - new Date(t.createdAt)) > 3 * 60 * 1000).length,
      dscCount: totalDsc,
      fotCount: totalFot,
      globalDscCount: globalDsc,
      globalFotCount: globalFot,
      resolutionRate: totalCount > 0 ? Math.round((totalClosed / totalCount) * 100) : 0,
      avgConcurrency: expertIdsAgg.size > 0 ? Math.round((totalCount / expertIdsAgg.size) * 10) / 10 : 0,
      deptSla: {
        DSC: deptResolvedAgg['DSC'] > 0 ? Math.round((deptCompliantAgg['DSC'] || 0) / deptResolvedAgg['DSC'] * 100) : 0,
        FOT: deptResolvedAgg['FOT'] > 0 ? Math.round((deptCompliantAgg['FOT'] || 0) / deptResolvedAgg['FOT'] * 100) : 0,
      },
      daySummary: await (async () => {
        // Fetch top 3 labels per department for this range
        const labelsSql = `
          SELECT l.name, t.dept, COUNT(*) as count 
          FROM ticket_labels tl 
          JOIN labels l ON tl.labelId = l.id 
          JOIN tickets t ON tl.ticketId = t.id 
          WHERE substr(t.createdAt, 1, 10) >= ? AND substr(t.createdAt, 1, 10) <= ?
          GROUP BY l.name, t.dept 
          ORDER BY t.dept, count DESC
        `;
        const labelCounts = query(labelsSql, [rangeStart, rangeEnd]);
        const summary = { DSC: [], FOT: [] };
        labelCounts.forEach(lc => {
          if (summary[lc.dept] && summary[lc.dept].length < 3) {
            summary[lc.dept].push(lc.name);
          }
        });
        return summary;
      })(),
      previousPeriod,
    };

    res.json(responseData);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/stats/summary — Fetch or generate AI summary for a period
app.get('/api/stats/summary', [auth, authorize(['admin']), llmLimiter], async (req, res) => {
  try {
    const { periodType, periodValue } = req.query;
    if (!periodType || !periodValue) {
      return res.status(400).json({ error: 'periodType (day|week|month) and periodValue (YYYY-MM-DD|YYYY-WW|YYYY-MM) are required.' });
    }
    const summary = await getLLMSummary(periodType, periodValue);
    res.json(summary);
  } catch (err) {
    logger.error({ err: err.message }, 'Failed to get LLM summary');
    res.status(500).json({ error: err.message });
  }
});

// GET /api/export
app.get('/api/export', [auth, authorize(['admin'])], async (req, res) => {
  try {
    const { status, dept, search, dateFrom, dateTo } = req.query;

    let sql = 'SELECT * FROM tickets WHERE 1=1';
    const params = [];

    if (status) {
      sql += ' AND status = ?';
      params.push(status);
    }
    if (dept && dept !== 'all') {
      sql += ' AND dept = ?';
      params.push(dept);
    }
    if (search) {
      // Escape search properly for LIKE query
      const sanitizedSearch = search.replace(/[%_]/g, '\\$&');
      const q = `%${sanitizedSearch}%`;
      sql += " AND (agentName LIKE ? OR cdbId LIKE ? OR dareRef LIKE ? OR expertName LIKE ?) ESCAPE '\\'";
      params.push(q, q, q, q);
    }
    if (dateFrom) {
      sql += ' AND createdAt >= ?';
      params.push(dateFrom);
    }
    if (dateTo) {
      const end = dateTo + 'T23:59:59';
      sql += ' AND createdAt <= ?';
      params.push(end);
    }

    sql += ' ORDER BY createdAt DESC';
    const ticketsToExport = query(sql, params).map(t => ({
      ...t,
      participants: JSON.parse(t.participants || '[]')
    }));

    // Set headers for CSV download
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="ikanbi_report.csv"');

    // Header row
    let csv = 'ID,Department,AgentName,AgentLang,ExpertName,ExpertLang,CDBID,DareRef,Status,CreatedAt,ClosedAt,DurationMinutes,Labels,Participants\n';

    // Data rows
    ticketsToExport.forEach(t => {
      const created = new Date(t.createdAt);
      const closed = t.closedAt ? new Date(t.closedAt) : null;
      let durationMinutes = '';
      if (closed) {
        durationMinutes = Math.round((closed - created) / 60000);
      }

      // Fetch labels for this ticket
      const ticketLabels = query('SELECT l.name FROM labels l JOIN ticket_labels tl ON l.id = tl.labelId WHERE tl.ticketId = ?', [t.id]);
      const labelsStr = ticketLabels.map(l => l.name).join(';');
      const participantsStr = (t.participants || []).map(p => p.name).join(';');

      const escapeCsv = (str) => {
        if (!str) return '""';
        const s = String(str);
        if (/^[=+\-@]/.test(s)) return `"'${s.replace(/"/g, '""')}"`;
        return `"${s.replace(/"/g, '""')}"`;
      };

      const row = [
        t.id,
        t.dept,
        escapeCsv(t.agentName),
        t.agentLang || '',
        escapeCsv(t.expertName),
        t.expertLang || '',
        escapeCsv(t.cdbId),
        escapeCsv(t.dareRef),
        t.status,
        created.toISOString(),
        closed ? closed.toISOString() : '',
        durationMinutes,
        escapeCsv(labelsStr),
        escapeCsv(participantsStr)
      ];

      csv += row.join(',') + '\n';
    });

    res.send(csv);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Business hours check (Europe/Brussels)
function isWithinBusinessHours() {
  const now = toZonedTime(new Date(), 'Europe/Brussels');
  const currentMinutes = now.getHours() * 60 + now.getMinutes();

  const [startH, startM] = config.BUSINESS_HOURS_START.split(':').map(Number);
  const [endH, endM] = config.BUSINESS_HOURS_END.split(':').map(Number);

  const startMinutes = startH * 60 + startM;
  const endMinutes = endH * 60 + endM;

  return currentMinutes >= startMinutes && currentMinutes < endMinutes;
}

function broadcastOnlineExperts() {
  const list = [...onlineUsers.values()]
    .filter((u) => u.role === 'expert')
    .map(({ userId, name, status }) => ({ userId, name, status: status || 'available' }));
  io.emit('experts:online', list);
}

function broadcastAgentStatus(agentId, online) {
  try {
    const openTickets = query("SELECT id FROM tickets WHERE agentId = ? AND status != ?", [agentId, 'closed']);
    for (const ticket of openTickets) {
      io.to(`ticket:${ticket.id}`).emit('agent:status', { ticketId: ticket.id, agentId, online });
    }
  } catch (err) {
    logger.error({ err: err.message }, '[agent:status] error');
  }
}

function broadcastQueuePositions() {
  try {
    const openTickets = query("SELECT id, agentId FROM tickets WHERE status = 'open' AND expertId IS NULL ORDER BY createdAt ASC");
    openTickets.forEach((t, index) => {
      const position = index + 1;
      const etaMins = position * 2;
      io.to(`ticket:${t.id}`).emit('queue:update', { position, etaMins });
    });
  } catch (err) {
    logger.error({ err: err.message }, '[broadcastQueuePositions] error');
  }
}

// Socket.io
io.on('connection', (socket) => {
  console.log(`[socket] connected: ${socket.id}`);

  socket.on('socket:identify', ({ userId, role, name }) => {
    socket.data.userId = userId;
    socket.data.role = role;
    socket.data.name = name;
    if (onlineUsers.has(userId)) {
      onlineUsers.get(userId).count++;
    } else {
      onlineUsers.set(userId, { userId, name, role, status: 'available', count: 1 });
    }
    if (role === 'expert' || role === 'admin') {
      broadcastOnlineExperts();
    }
    if (role === 'agent') {
      broadcastAgentStatus(userId, true);
    }
  });

  // ─── Ticket Management ─────────────────────────────────────────────────────

  socket.on('ticket:new', async (data) => {
    if (!isWithinBusinessHours()) {
      socket.emit('hours:closed', {
        message: 'The expert chat is currently closed. Available Monday through Sunday between 07:30 and 22:30.',
      });
      return;
    }

    try {
      const { agentId, agentLang, dept, cdbId, dareRef, text, mediaUrl } = data;

      if (!agentId || !agentLang || !dept) {
        return socket.emit('error', { message: 'Missing required fields for ticket' });
      }

      const agentUser = get('SELECT name FROM users WHERE id = ?', [agentId]);
      const agentName = agentUser?.name || agentId;

      const ticket = {
        id: uuidv4(),
        dept,
        agentId,
        agentName,
        agentLang,
        cdbId: cdbId || null,
        dareRef: dareRef || null,
        status: 'open',
        expertId: null,
        expertName: null,
        expertLang: null,
        expertJoinedAt: null,
        createdAt: new Date().toISOString(),
        closedAt: null,
        participants: '[]'
      };

      run(
        'INSERT INTO tickets (id, dept, agentId, agentName, agentLang, cdbId, dareRef, status, createdAt, participants) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [ticket.id, ticket.dept, ticket.agentId, ticket.agentName, ticket.agentLang, ticket.cdbId, ticket.dareRef, ticket.status, ticket.createdAt, ticket.participants]
      );

      let message = null;
      if (text && text.trim()) {
        const messageId = uuidv4();
        const now = new Date().toISOString();
        
        // For the very first message in a ticket, we don't run guards/translation yet 
        // to keep ticket creation snappy, or we can run them. 
        // Let's run guards at least for the first message.
        const guard = await runGuards(text, agentId);
        const safeText = guard.ok ? guard.text : text;

        message = {
          id: messageId,
          ticketId: ticket.id,
          senderId: agentId,
          senderName: agentName,
          senderRole: 'agent',
          senderLang: agentLang,
          originalText: text,
          improvedText: safeText,
          processedText: safeText,
          mediaUrl: mediaUrl || null,
          whisper: 0,
          system: 0,
          translationSkipped: 1,
          fallback: 0,
          timestamp: now,
          reactions: '{}'
        };

        run(
          `INSERT INTO messages 
          (id, ticketId, senderId, senderName, senderRole, senderLang, originalText, improvedText, processedText, text, translatedText, mediaUrl, whisper, system, translationSkipped, fallback, timestamp, reactions) 
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            message.id, message.ticketId, message.senderId, message.senderName, message.senderRole, message.senderLang,
            message.originalText, message.improvedText, message.processedText, message.originalText, message.processedText, message.mediaUrl, 
            message.whisper, message.system, message.translationSkipped, message.fallback, message.timestamp, message.reactions
          ]
        );
      }

      socket.join(`ticket:${ticket.id}`);
      const ticketToEmit = { ...ticket, participants: [], labels: [] };
      const messageToEmit = message ? { ...message, whisper: false, system: false, reactions: {} } : null;

      socket.emit('ticket:created:self', { ticket: ticketToEmit, message: messageToEmit });
      io.emit('ticket:created', { ticket: ticketToEmit, firstMessage: messageToEmit });

      broadcastQueuePositions();
      logger.info(`[ticket] created ${ticket.id} by ${agentId}`);
    } catch (err) {
      logger.error({ err: err.message }, '[ticket:new] error');
      socket.emit('error', { message: 'Failed to create ticket' });
    }
  });

  // ─── Expert Interaction ───────────────────────────────────────────────────

  socket.on('expert:join', async ({ ticketId, expertId, expertName, expertLang }) => {
    try {
      const ticket = get('SELECT * FROM tickets WHERE id = ?', [ticketId]);
      if (!ticket) return;

      const now = new Date().toISOString();
      const updatedExpertId = ticket.expertId || expertId;
      const updatedExpertName = ticket.expertName || expertName;
      const updatedExpertLang = ticket.expertLang || expertLang;
      const updatedExpertJoinedAt = ticket.expertJoinedAt || now;

      const participants = JSON.parse(ticket.participants || '[]');
      if (!participants.find((p) => p.id === expertId)) {
        participants.push({ id: expertId, name: expertName });
      }

      run(
        'UPDATE tickets SET expertId = ?, expertName = ?, expertLang = ?, expertJoinedAt = ?, participants = ?, status = ? WHERE id = ?',
        [updatedExpertId, updatedExpertName, updatedExpertLang, updatedExpertJoinedAt, JSON.stringify(participants), 'active', ticketId]
      );

      socket.join(`ticket:${ticketId}`);

      const isAgentSocket = socket.data.role === 'agent';
      const messagesResult = query('SELECT * FROM messages WHERE ticketId = ? ORDER BY timestamp ASC', [ticketId]);
      const messages = messagesResult
        .filter(m => !isAgentSocket || !m.whisper)
        .map(m => ({ 
          ...m, 
          whisper: !!m.whisper, 
          system: !!m.system, 
          fallback: !!m.fallback,
          translationSkipped: !!m.translationSkipped,
          reactions: JSON.parse(m.reactions || '{}') 
        }));

      const labels = query('SELECT labelId FROM ticket_labels WHERE ticketId = ?', [ticketId]).map(l => l.labelId);

      socket.emit('ticket:history', { ticketId, messages, labels });
      io.to(`ticket:${ticketId}`).emit('expert:joined', { ticketId, expertName, participants });

      io.emit('ticket:updated', {
        ticketId,
        status: 'active',
        expertName: updatedExpertName,
        participants,
        labels
      });

      broadcastQueuePositions();
      logger.info(`[ticket] expert ${expertName} joined ${ticketId}`);
    } catch (err) {
      logger.error({ err: err.message }, '[expert:join] error');
    }
  });

  // ─── Chat Flow & AI Pipeline ──────────────────────────────────────────────

  socket.on('message:send', async ({ ticketId, senderId, senderLang, text, mediaUrl, whisper }) => {
    try {
      if (!ticketId || !senderId || !text) {
        return socket.emit('error', { message: 'Missing required fields for message' });
      }
      const ticket = get('SELECT * FROM tickets WHERE id = ?', [ticketId]);
      if (!ticket || ticket.status === 'closed') return;

      const senderUser = onlineUsers.get(senderId) || get('SELECT name, role FROM users WHERE id = ?', [senderId]);
      const senderRole = senderUser?.role || 'agent';
      const senderName = senderUser?.name || senderId;

      // ── Step 1: Guards ──────────────────────────────────────────────────────
      if (!whisper) {
        const guard = await runGuards(text, senderId);
        if (!guard.ok) {
          socket.emit('message:blocked', {
            code:    guard.code,
            // Translation will happen on frontend via useT() or similar if we send the code
          });
          return;
        }
        text = guard.text; // Use sanitized text (e.g. CAPS fix)
        resetRepetition(senderId);
      }

      let result = { 
        processedText: text, 
        improvedText: text, 
        translationSkipped: true, 
        fallback: false 
      };

      if (!whisper) {
        const recipientLang = senderRole === 'agent' ? (ticket.expertLang || 'nl') : ticket.agentLang;
        result = await processMessage(text, senderRole, senderLang, recipientLang);
        
        // PII Scanning on AI output
        if (!result.fallback && containsPII(result.processedText)) {
          logger.warn({ ticketId, senderId }, 'PII detected in processed text, blocking');
          result.processedText = 'guard_pii_blocked'; // Key for i18n
          result.fallback = true; // Mark as compromised
        }
      }

      const message = {
        id: uuidv4(),
        ticketId,
        senderId,
        senderName,
        senderRole,
        senderLang,
        originalText: text,
        improvedText: result.improvedText,
        processedText: result.processedText,
        mediaUrl: mediaUrl || null,
        whisper: whisper ? 1 : 0,
        system: 0,
        translationSkipped: result.translationSkipped ? 1 : 0,
        fallback: result.fallback ? 1 : 0,
        timestamp: new Date().toISOString(),
        reactions: '{}'
      };

      run(
        `INSERT INTO messages 
        (id, ticketId, senderId, senderName, senderRole, senderLang, originalText, improvedText, processedText, text, translatedText, mediaUrl, whisper, system, translationSkipped, fallback, timestamp, reactions) 
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          message.id, message.ticketId, message.senderId, message.senderName, message.senderRole, message.senderLang,
          message.originalText, message.improvedText, message.processedText, message.originalText, message.processedText, message.mediaUrl, 
          message.whisper, message.system, message.translationSkipped, message.fallback, message.timestamp, message.reactions
        ]
      );

      const messageToEmit = { 
        ...message, 
        whisper: !!message.whisper, 
        system: false, 
        fallback: !!message.fallback,
        translationSkipped: !!message.translationSkipped,
        reactions: {} 
      };

      if (whisper) {
        const roomSockets = await io.in(`ticket:${ticketId}`).fetchSockets();
        for (const s of roomSockets) {
          if (s.data.role !== 'agent') {
            s.emit('message:new', { message: messageToEmit });
          }
        }
      } else {
        io.to(`ticket:${ticketId}`).emit('message:new', { message: messageToEmit });
      }
    } catch (err) {
      logger.error({ err: err.message }, '[message:send] error');
    }
  });

  socket.on('message:delivered', async ({ ticketId, messageId }) => {
    try {
      const now = new Date().toISOString();
      run('UPDATE messages SET deliveredAt = ? WHERE id = ? AND deliveredAt IS NULL', [now, messageId]);
      io.to(`ticket:${ticketId}`).emit('message:status', { ticketId, messageId, status: 'delivered', timestamp: now });
    } catch (err) {
      logger.error({ err: err.message }, '[message:delivered] error');
    }
  });

  socket.on('message:read', async ({ ticketId, messageIds }) => {
    try {
      const now = new Date().toISOString();
      for (const id of messageIds) {
        run('UPDATE messages SET readAt = ? WHERE id = ? AND readAt IS NULL', [now, id]);
        io.to(`ticket:${ticketId}`).emit('message:status', { ticketId, messageId: id, status: 'read', timestamp: now });
      }
    } catch (err) {
      logger.error({ err: err.message }, '[message:read] error');
    }
  });

  socket.on('status:set', ({ status }) => {
    const u = onlineUsers.get(socket.data.userId);
    if (u) {
      u.status = status;
      broadcastOnlineExperts();
    }
  });

  socket.on('typing:start', ({ ticketId, senderName }) => {
    socket.to(`ticket:${ticketId}`).emit('typing:update', { ticketId, senderName, typing: true });
  });

  socket.on('typing:stop', ({ ticketId, senderName }) => {
    socket.to(`ticket:${ticketId}`).emit('typing:update', { ticketId, senderName, typing: false });
  });

  socket.on('expert:leave', async ({ ticketId, expertId, expertName }) => {
    try {
      const ticket = get('SELECT * FROM tickets WHERE id = ?', [ticketId]);
      if (!ticket) return;

      let participants = JSON.parse(ticket.participants || '[]');
      participants = participants.filter((p) => p.id !== expertId);

      let updatedExpertId = ticket.expertId;
      let updatedExpertName = ticket.expertName;
      let updatedExpertLang = ticket.expertLang;
      let updatedExpertJoinedAt = ticket.expertJoinedAt;

      if (ticket.expertId === expertId) {
        updatedExpertId = null;
        updatedExpertName = null;
        updatedExpertLang = null;
        updatedExpertJoinedAt = null;
      }

      run(
        'UPDATE tickets SET expertId = ?, expertName = ?, expertLang = ?, expertJoinedAt = ?, participants = ? WHERE id = ?',
        [updatedExpertId, updatedExpertName, updatedExpertLang, updatedExpertJoinedAt, JSON.stringify(participants), ticketId]
      );

      socket.leave(`ticket:${ticketId}`);
      io.to(`ticket:${ticketId}`).emit('expert:left', { ticketId, expertName, participants });

      io.emit('ticket:updated', {
        ticketId,
        participants,
        expertId: updatedExpertId,
        expertName: updatedExpertName,
        expertJoinedAt: updatedExpertJoinedAt
      });
      logger.info(`[ticket] expert ${expertName} left ${ticketId}`);
    } catch (err) {
      logger.error({ err: err.message }, '[expert:leave] error');
    }
  });

  socket.on('ticket:close', async ({ ticketId, closingNotes, closedBy }) => {
    try {
      const now = new Date().toISOString();
      const ticket = get('SELECT expertId, expertName FROM tickets WHERE id = ?', [ticketId]);

      run(
        'UPDATE tickets SET status = ?, closedAt = ?, closingNotes = ?, closedBy = ? WHERE id = ?',
        ['closed', now, closingNotes || null, closedBy || null, ticketId]
      );

      io.to(`ticket:${ticketId}`).emit('ticket:closed', {
        ticketId,
        expertId: ticket?.expertId,
        expertName: ticket?.expertName
      });
      io.emit('ticket:updated', { ticketId, status: 'closed' });

      broadcastQueuePositions();
      logger.info(`[ticket] closed ${ticketId}`);
    } catch (err) {
      logger.error({ err: err.message }, '[ticket:close] error');
    }

    // Trigger AI summary in background
    summarizeConversation(ticketId).catch(err => logger.error({ err: err.message }, 'Background summary failed'));
  });

  socket.on('rating:submit', async ({ ticketId, agentId, expertId, rating, comment }) => {
    try {
      const ticket = get('SELECT status FROM tickets WHERE id = ?', [ticketId]);
      if (!ticket || ticket.status !== 'closed') return;

      const existing = get('SELECT id FROM ratings WHERE ticketId = ? AND agentId = ?', [ticketId, agentId]);
      if (existing) return;

      run(
        'INSERT INTO ratings (id, ticketId, agentId, expertId, rating, comment, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [uuidv4(), ticketId, agentId, expertId, rating, comment || null, new Date().toISOString()]
      );
      socket.emit('rating:saved', { ticketId });
      logger.info(`[rating] ${agentId} rated ticket ${ticketId}: ${rating}/5`);
    } catch (err) {
      logger.error({ err: err.message }, '[rating:submit] error');
    }
  });

  socket.on('ticket:labels:update', async ({ ticketId, labels }) => {
    try {
      transaction(() => {
        run('DELETE FROM ticket_labels WHERE ticketId = ?', [ticketId]);
        if (labels && labels.length > 0) {
          const stmt = db.prepare('INSERT INTO ticket_labels (ticketId, labelId) VALUES (?, ?)');
          for (const labelId of labels) {
            stmt.run(ticketId, labelId);
          }
        }
      });
      io.to(`ticket:${ticketId}`).emit('ticket:labels:updated', { ticketId, labels: labels || [] });
      io.emit('ticket:updated', { ticketId, labels: labels || [] });
      logger.info(`[ticket] labels updated for ${ticketId}: ${(labels || []).join(', ')}`);
    } catch (err) {
      logger.error({ err: err.message }, '[ticket:labels:update] error');
    }
  });

  socket.on('reaction:toggle', async ({ ticketId, messageId, emoji, userId }) => {
    try {
      const message = get('SELECT reactions FROM messages WHERE id = ?', [messageId]);
      if (!message) return;

      const reactions = JSON.parse(message.reactions || '{}');
      if (!reactions[emoji]) reactions[emoji] = [];
      const idx = reactions[emoji].indexOf(userId);
      if (idx >= 0) {
        reactions[emoji].splice(idx, 1);
        if (reactions[emoji].length === 0) delete reactions[emoji];
      } else {
        reactions[emoji].push(userId);
      }

      run('UPDATE messages SET reactions = ? WHERE id = ?', [JSON.stringify(reactions), messageId]);
      io.to(`ticket:${ticketId}`).emit('reaction:updated', { ticketId, messageId, reactions });
    } catch (err) {
      logger.error({ err: err.message }, '[reaction:toggle] error');
    }
  });

  socket.on('disconnect', () => {
    const userId = socket.data.userId;
    if (!userId) return;
    const u = onlineUsers.get(userId);
    if (u) {
      u.count--;
      if (u.count <= 0) onlineUsers.delete(userId);
    }
    if (socket.data.role === 'expert' || socket.data.role === 'admin') {
      broadcastOnlineExperts();
    }
    if (socket.data.role === 'agent' && (!u || u.count <= 0)) {
      broadcastAgentStatus(userId, false);
    }
  });
});
