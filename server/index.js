import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import { toZonedTime } from 'date-fns-tz';
import { v4 as uuidv4 } from 'uuid';

import ticketRoutes from './routes/tickets.js';
import messageRoutes from './routes/messages.js';
import uploadRoutes from './routes/uploads.js';
import feedbackRoutes from './routes/feedback.js';
import labelRoutes from './routes/labels.js';
import { translate } from './services/translate.js';
import { readDb, writeDb } from './db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();
const httpServer = createServer(app);

const io = new Server(httpServer, {
  cors: { origin: 'http://localhost:5173', methods: ['GET', 'POST'] },
});

app.use(cors({ origin: 'http://localhost:5173' }));
app.use(express.json());
const onlineUsers = new Map();
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// REST routes
app.use('/api/tickets', ticketRoutes);
app.use('/api/messages', messageRoutes);
app.use('/api/uploads', uploadRoutes);
app.use('/api/feedback', feedbackRoutes);
app.use('/api/labels', labelRoutes);

// GET /api/ratings
app.get('/api/ratings', async (_req, res) => {
  try {
    const db = await readDb();
    res.json(db.ratings || []);
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
    const db = await readDb();
    res.json(db.users);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GDPR: Daily purge of individual data older than 30 days ──
async function runDailyPurge() {
  try {
    const db = await readDb();
    if (!db.dailyStats) db.dailyStats = [];
    const now = new Date();
    const cutoff = new Date(now);
    cutoff.setDate(cutoff.getDate() - 30);
    const cutoffDate = cutoff.toISOString().slice(0, 10);

    // Find tickets older than 30 days
    const oldTickets = (db.tickets || []).filter(t => t.createdAt.slice(0, 10) < cutoffDate);
    if (oldTickets.length === 0) {
      console.log('[purge] No tickets older than 30 days to purge.');
      return;
    }

    // Group by date
    const byDate = {};
    oldTickets.forEach(t => {
      const date = t.createdAt.slice(0, 10);
      if (!byDate[date]) byDate[date] = [];
      byDate[date].push(t);
    });

    const existingDates = new Set(db.dailyStats.map(s => s.date));
    let purgedCount = 0;

    for (const [date, dayTickets] of Object.entries(byDate)) {
      if (existingDates.has(date)) {
        // Already aggregated, just delete individual data
      } else {
        // Compute aggregates
        const deptCounts = {};
        const hourly = Array(24).fill(0);
        let closed = 0, abandoned = 0;
        let responseSum = 0, responseCount = 0;
        let durationSum = 0, durationCount = 0;
        const ratingsByDept = {};

        dayTickets.forEach(t => {
          // Dept counts
          deptCounts[t.dept] = (deptCounts[t.dept] || 0) + 1;
          // Hourly
          hourly[new Date(t.createdAt).getHours()]++;
          // Closed / abandoned
          if (t.status === 'closed') {
            closed++;
            if (!t.expertJoinedAt) abandoned++;
          }
          // Response time
          if (t.expertJoinedAt) {
            responseSum += new Date(t.expertJoinedAt) - new Date(t.createdAt);
            responseCount++;
          }
          // Duration
          if (t.status === 'closed' && t.closedAt) {
            durationSum += new Date(t.closedAt) - new Date(t.createdAt);
            durationCount++;
          }
        });

        // Ratings for this day's tickets
        const ticketIds = new Set(dayTickets.map(t => t.id));
        const dayRatings = (db.ratings || []).filter(r => ticketIds.has(r.ticketId));
        let ratingSum = 0, ratingCount = 0;
        dayRatings.forEach(r => {
          ratingSum += r.rating;
          ratingCount++;
          // Find ticket dept
          const ticket = dayTickets.find(t => t.id === r.ticketId);
          const dept = ticket?.dept || 'Unknown';
          if (!ratingsByDept[dept]) ratingsByDept[dept] = { sum: 0, count: 0 };
          ratingsByDept[dept].sum += r.rating;
          ratingsByDept[dept].count++;
        });

        // SLA compliance for this day
        const resolvedDay = dayTickets.filter(t => t.expertJoinedAt);
        const compliantDay = resolvedDay.filter(t => (new Date(t.expertJoinedAt) - new Date(t.createdAt)) <= 180000).length;
        const slaHealthDay = resolvedDay.length > 0 ? Math.round((compliantDay / resolvedDay.length) * 100) : 100;

        db.dailyStats.push({
          date,
          dept: deptCounts,
          total: dayTickets.length,
          closed,
          abandoned,
          avgResponseMs: responseCount > 0 ? Math.round(responseSum / responseCount) : 0,
          avgDurationMs: durationCount > 0 ? Math.round(durationSum / durationCount) : 0,
          avgRating: ratingCount > 0 ? Math.round((ratingSum / ratingCount) * 10) / 10 : null,
          ratingCount,
          ratingsByDept,
          slaHealth: slaHealthDay,
          slaResolved: resolvedDay.length,
          slaCompliant: compliantDay,
          hourly,
        });
      }

      // Delete individual tickets, messages, and ratings for this day
      const ticketIds = new Set(dayTickets.map(t => t.id));
      db.tickets = (db.tickets || []).filter(t => !ticketIds.has(t.id));
      db.messages = (db.messages || []).filter(m => !ticketIds.has(m.ticketId));
      db.ratings = (db.ratings || []).filter(r => !ticketIds.has(r.ticketId));
      purgedCount += dayTickets.length;
    }

    // Sort dailyStats by date
    db.dailyStats.sort((a, b) => a.date.localeCompare(b.date));
    await writeDb(db);
    console.log(`[purge] GDPR purge complete: ${purgedCount} tickets aggregated and removed across ${Object.keys(byDate).length} days.`);
  } catch (err) {
    console.error('[purge] Error during daily purge:', err.message);
  }
}

// Run purge on startup and every 24 hours
runDailyPurge();
setInterval(runDailyPurge, 24 * 60 * 60 * 1000);

// ── Helper: compute stats from live tickets for a single day ──
function computeLiveDayStats(dayTickets, dayRatings, dept) {
  let tickets = dayTickets;
  let ratings = dayRatings;
  if (dept && dept !== 'all') {
    tickets = tickets.filter(t => t.dept === dept);
    const tIds = new Set(tickets.map(t => t.id));
    ratings = ratings.filter(r => tIds.has(r.ticketId));
  }

  const deptCounts = {};
  const hourly = Array(24).fill(0);
  let closed = 0, abandoned = 0;
  let responseSum = 0, responseCount = 0;
  let durationSum = 0, durationCount = 0;
  const ratingsByDept = {};

  tickets.forEach(t => {
    deptCounts[t.dept] = (deptCounts[t.dept] || 0) + 1;
    hourly[new Date(t.createdAt).getHours()]++;
    if (t.status === 'closed') {
      closed++;
      if (!t.expertJoinedAt) abandoned++;
    }
    if (t.expertJoinedAt) {
      responseSum += new Date(t.expertJoinedAt) - new Date(t.createdAt);
      responseCount++;
    }
    if (t.status === 'closed' && t.closedAt) {
      durationSum += new Date(t.closedAt) - new Date(t.createdAt);
      durationCount++;
    }
  });

  ratings.forEach(r => {
    const ticket = tickets.find(t => t.id === r.ticketId);
    const d = ticket?.dept || 'Unknown';
    if (!ratingsByDept[d]) ratingsByDept[d] = { sum: 0, count: 0 };
    ratingsByDept[d].sum += r.rating;
    ratingsByDept[d].count++;
  });

  const resolved = tickets.filter(t => t.expertJoinedAt);
  const compliant = resolved.filter(t => (new Date(t.expertJoinedAt) - new Date(t.createdAt)) <= 180000).length;

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
    hourly,
  };
}

// GET /api/stats — manager statistics (merges live + historical data)
app.get('/api/stats', async (req, res) => {
  try {
    const db = await readDb();
    const { dateFrom, dateTo, dept } = req.query;
    const now = new Date();
    const today = now.toISOString().slice(0, 10);
    const historicalStats = db.dailyStats || [];

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
        allDays.push(d.toISOString().slice(0, 10));
      }
    }

    // 30-day boundary
    const cutoff = new Date(now);
    cutoff.setDate(cutoff.getDate() - 30);
    const cutoffDate = cutoff.toISOString().slice(0, 10);

    // Filter live tickets/ratings based on dept
    let liveTickets = db.tickets || [];
    let liveRatings = db.ratings || [];
    if (dept && dept !== 'all') {
      liveTickets = liveTickets.filter(t => t.dept === dept);
      const deptTicketIds = new Set(liveTickets.map(t => t.id));
      liveRatings = liveRatings.filter(r => deptTicketIds.has(r.ticketId));
    }

    // Aggregate totals across the range
    let totalCount = 0, totalClosed = 0, totalAbandoned = 0;
    let totalResponseSum = 0, totalResponseCount = 0;
    let totalDurationSum = 0, totalDurationCount = 0;
    let totalRatingSum = 0, totalRatingCount = 0;
    let totalDsc = 0, totalFot = 0;
    let totalSlaResolved = 0, totalSlaCompliant = 0;
    const hourlyMap = Array.from({ length: 24 }, (_, h) => ({ hour: h, count: 0 }));
    const ratingsByDeptAgg = {};

    // Per-day data for trend
    const perDay = [];

    for (const date of allDays) {
      let dayData;

      if (date < cutoffDate) {
        // Use historical data
        const hist = historicalStats.find(s => s.date === date);
        if (!hist) {
          perDay.push({ date, total: 0, dsc: 0, fot: 0 });
          continue;
        }
        // Apply dept filter to historical
        if (dept && dept !== 'all') {
          const deptTotal = hist.dept[dept] || 0;
          const deptRating = hist.ratingsByDept?.[dept];
          dayData = {
            total: deptTotal,
            deptCounts: { [dept]: deptTotal },
            closed: Math.round(hist.closed * (deptTotal / (hist.total || 1))),
            abandoned: Math.round(hist.abandoned * (deptTotal / (hist.total || 1))),
            responseSum: hist.avgResponseMs * Math.round((hist.total > 0 ? deptTotal / hist.total : 0) * (hist.slaResolved || 0)),
            responseCount: Math.round((hist.total > 0 ? deptTotal / hist.total : 0) * (hist.slaResolved || 0)),
            durationSum: hist.avgDurationMs * Math.round(hist.closed * (deptTotal / (hist.total || 1))),
            durationCount: Math.round(hist.closed * (deptTotal / (hist.total || 1))),
            ratingSum: deptRating ? deptRating.sum : 0,
            ratingCount: deptRating ? deptRating.count : 0,
            ratingsByDept: deptRating ? { [dept]: deptRating } : {},
            slaResolved: Math.round((hist.total > 0 ? deptTotal / hist.total : 0) * (hist.slaResolved || 0)),
            slaCompliant: Math.round((hist.total > 0 ? deptTotal / hist.total : 0) * (hist.slaCompliant || 0)),
            hourly: hist.hourly.map(h => Math.round(h * (deptTotal / (hist.total || 1)))),
          };
        } else {
          dayData = {
            total: hist.total,
            deptCounts: hist.dept || {},
            closed: hist.closed,
            abandoned: hist.abandoned,
            responseSum: hist.avgResponseMs * (hist.slaResolved || 0),
            responseCount: hist.slaResolved || 0,
            durationSum: hist.avgDurationMs * hist.closed,
            durationCount: hist.closed,
            ratingSum: hist.avgRating ? hist.avgRating * hist.ratingCount : 0,
            ratingCount: hist.ratingCount,
            ratingsByDept: hist.ratingsByDept || {},
            slaResolved: hist.slaResolved || 0,
            slaCompliant: hist.slaCompliant || 0,
            hourly: hist.hourly,
          };
        }
      } else {
        // Use live data
        const dayTickets = (db.tickets || []).filter(t => t.createdAt.startsWith(date));
        const dayRatings = (db.ratings || []).filter(r => r.createdAt && r.createdAt.startsWith(date));
        dayData = computeLiveDayStats(dayTickets, dayRatings, dept);
      }

      totalCount += dayData.total;
      totalClosed += dayData.closed;
      totalAbandoned += dayData.abandoned;
      totalResponseSum += dayData.responseSum;
      totalResponseCount += dayData.responseCount;
      totalDurationSum += dayData.durationSum;
      totalDurationCount += dayData.durationCount;
      totalRatingSum += dayData.ratingSum;
      totalRatingCount += dayData.ratingCount;
      totalDsc += (dayData.deptCounts['DSC'] || 0);
      totalFot += (dayData.deptCounts['FOT'] || 0);
      totalSlaResolved += dayData.slaResolved;
      totalSlaCompliant += dayData.slaCompliant;
      dayData.hourly.forEach((c, i) => { hourlyMap[i].count += c; });

      // Merge ratingsByDept
      for (const [d, v] of Object.entries(dayData.ratingsByDept)) {
        if (!ratingsByDeptAgg[d]) ratingsByDeptAgg[d] = { sum: 0, count: 0 };
        ratingsByDeptAgg[d].sum += v.sum;
        ratingsByDeptAgg[d].count += v.count;
      }

      perDay.push({
        date,
        total: dayData.total,
        dsc: dayData.deptCounts['DSC'] || 0,
        fot: dayData.deptCounts['FOT'] || 0,
      });
    }

    // Smart trend grouping
    let trendGranularity, dailyTrend;
    if (allDays.length <= 30) {
      trendGranularity = 'daily';
      dailyTrend = perDay.map(d => ({ ...d, date: d.date.slice(5) })); // MM-DD
    } else if (allDays.length <= 90) {
      trendGranularity = 'weekly';
      const weeks = [];
      for (let i = 0; i < perDay.length; i += 7) {
        const chunk = perDay.slice(i, i + 7);
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
      perDay.forEach(d => {
        const key = d.date.slice(0, 7); // YYYY-MM
        if (!months[key]) months[key] = { date: key, total: 0, dsc: 0, fot: 0 };
        months[key].total += d.total;
        months[key].dsc += d.dsc;
        months[key].fot += d.fot;
      });
      dailyTrend = Object.values(months);
    }

    // Expert stats (from live tickets only, filtered by date range)
    let filteredTickets = liveTickets;
    if (dateFrom) filteredTickets = filteredTickets.filter(t => t.createdAt >= dateFrom);
    if (dateTo) {
      const toStr = dateTo.includes('T') ? dateTo : `${dateTo}T23:59:59`;
      filteredTickets = filteredTickets.filter(t => t.createdAt <= toStr);
    }

    const expertMap = {};
    filteredTickets.forEach((t) => {
      if (!t.expertName) return;
      if (!expertMap[t.expertName]) expertMap[t.expertName] = { name: t.expertName, total: 0, today: 0 };
      expertMap[t.expertName].total++;
      if (t.createdAt.startsWith(today)) expertMap[t.expertName].today++;
    });
    const expertStats = Object.values(expertMap).sort((a, b) => b.total - a.total).slice(0, 8);

    // Agent stats (filtered by date range, with total + today)
    const agentMap = {};
    filteredTickets.forEach((t) => {
      const name = t.agentName || t.agentId;
      if (!agentMap[name]) agentMap[name] = { name, total: 0, today: 0 };
      agentMap[name].total++;
      if (t.createdAt.startsWith(today)) agentMap[name].today++;
    });
    const agentStats = Object.values(agentMap).sort((a, b) => b.total - a.total).slice(0, 8);

    // Queue health
    let queueTickets = db.tickets.filter((t) => t.status !== 'closed' && !t.expertJoinedAt);
    if (dept && dept !== 'all') queueTickets = queueTickets.filter(t => t.dept === dept);
    const oldest = queueTickets.reduce((min, t) => {
      const age = now - new Date(t.createdAt);
      return age > min ? age : min;
    }, 0);
    const waitingOver3 = queueTickets.filter((t) => (now - new Date(t.createdAt)) > 180000).length;

    // KPIs
    const avgResponseMs = totalResponseCount > 0 ? totalResponseSum / totalResponseCount : 0;
    const avgDurationMs = totalDurationCount > 0 ? totalDurationSum / totalDurationCount : 0;
    const slaHealth = totalSlaResolved > 0 ? Math.round((totalSlaCompliant / totalSlaResolved) * 100) : 100;
    const avgRating = totalRatingCount > 0 ? Math.round((totalRatingSum / totalRatingCount) * 10) / 10 : null;

    // Ratings by dept (formatted with avg)
    const ratingsByDeptOut = {};
    for (const [d, v] of Object.entries(ratingsByDeptAgg)) {
      ratingsByDeptOut[d] = { avg: v.count > 0 ? Math.round((v.sum / v.count) * 10) / 10 : null, count: v.count };
    }

    // ── Previous period comparison ──
    const rangeDays = allDays.length;
    const prevEnd = new Date(rangeStart);
    prevEnd.setDate(prevEnd.getDate() - 1);
    const prevStart = new Date(prevEnd);
    prevStart.setDate(prevStart.getDate() - rangeDays + 1);
    const prevStartStr = prevStart.toISOString().slice(0, 10);
    const prevEndStr = prevEnd.toISOString().slice(0, 10);

    let prevTotal = 0, prevResponseSum = 0, prevResponseCount = 0;
    let prevDurationSum = 0, prevDurationCount = 0;
    let prevAbandoned = 0, prevSlaResolved = 0, prevSlaCompliant = 0;
    let prevRatingSum = 0, prevRatingCount = 0;

    // Iterate previous period days
    {
      const pStart = new Date(prevStartStr);
      const pEnd = new Date(prevEndStr);
      for (let d = new Date(pStart); d <= pEnd; d.setDate(d.getDate() + 1)) {
        const dateStr = d.toISOString().slice(0, 10);
        if (dateStr < cutoffDate) {
          const hist = historicalStats.find(s => s.date === dateStr);
          if (!hist) continue;
          if (dept && dept !== 'all') {
            const deptTotal = hist.dept[dept] || 0;
            const ratio = hist.total > 0 ? deptTotal / hist.total : 0;
            prevTotal += deptTotal;
            prevAbandoned += Math.round(hist.abandoned * ratio);
            prevResponseSum += hist.avgResponseMs * Math.round(ratio * (hist.slaResolved || 0));
            prevResponseCount += Math.round(ratio * (hist.slaResolved || 0));
            prevDurationSum += hist.avgDurationMs * Math.round(hist.closed * ratio);
            prevDurationCount += Math.round(hist.closed * ratio);
            prevSlaResolved += Math.round(ratio * (hist.slaResolved || 0));
            prevSlaCompliant += Math.round(ratio * (hist.slaCompliant || 0));
            const dr = hist.ratingsByDept?.[dept];
            if (dr) { prevRatingSum += dr.sum; prevRatingCount += dr.count; }
          } else {
            prevTotal += hist.total;
            prevAbandoned += hist.abandoned;
            prevResponseSum += hist.avgResponseMs * (hist.slaResolved || 0);
            prevResponseCount += hist.slaResolved || 0;
            prevDurationSum += hist.avgDurationMs * hist.closed;
            prevDurationCount += hist.closed;
            prevSlaResolved += hist.slaResolved || 0;
            prevSlaCompliant += hist.slaCompliant || 0;
            if (hist.avgRating) { prevRatingSum += hist.avgRating * hist.ratingCount; prevRatingCount += hist.ratingCount; }
          }
        } else {
          const dayTickets = (db.tickets || []).filter(t => t.createdAt.startsWith(dateStr));
          const dayRatings = (db.ratings || []).filter(r => r.createdAt && r.createdAt.startsWith(dateStr));
          const ds = computeLiveDayStats(dayTickets, dayRatings, dept);
          prevTotal += ds.total;
          prevAbandoned += ds.abandoned;
          prevResponseSum += ds.responseSum;
          prevResponseCount += ds.responseCount;
          prevDurationSum += ds.durationSum;
          prevDurationCount += ds.durationCount;
          prevRatingSum += ds.ratingSum;
          prevRatingCount += ds.ratingCount;
          prevSlaResolved += ds.slaResolved;
          prevSlaCompliant += ds.slaCompliant;
        }
      }
    }

    const previousPeriod = {
      total: prevTotal,
      avgResponseMinutes: prevResponseCount > 0 ? Math.round((prevResponseSum / prevResponseCount) / 60000) : 0,
      avgDurationMinutes: prevDurationCount > 0 ? Math.round((prevDurationSum / prevDurationCount) / 60000) : 0,
      abandonedCount: prevAbandoned,
      slaHealth: prevSlaResolved > 0 ? Math.round((prevSlaCompliant / prevSlaResolved) * 100) : 100,
      avgRating: prevRatingCount > 0 ? Math.round((prevRatingSum / prevRatingCount) * 10) / 10 : null,
    };

    const todayTickets = filteredTickets.filter((t) => t.createdAt.startsWith(today));

    res.json({
      todayTotal: todayTickets.length,
      todayOpen: todayTickets.filter((t) => t.status !== 'closed').length,
      todayClosed: todayTickets.filter((t) => t.status === 'closed').length,
      avgResponseMinutes: Math.round(avgResponseMs / 60000),
      avgDurationMinutes: Math.round(avgDurationMs / 60000),
      abandonedCount: totalAbandoned,
      dscCount: totalDsc,
      fotCount: totalFot,
      total: totalCount,
      hourlyDistribution: hourlyMap,
      dailyTrend,
      trendGranularity,
      expertStats,
      agentStats,
      oldestWaitMinutes: Math.round(oldest / 60000),
      waitingOver3,
      slaHealth,
      avgRating,
      totalRatings: totalRatingCount,
      ratingsByDept: ratingsByDeptOut,
      previousPeriod,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
// GET /api/export
app.get('/api/export', async (req, res) => {
  try {
    const db = await readDb();
    const { status, dept, search, dateFrom, dateTo } = req.query;

    let ticketsToExport = db.tickets;

    if (status) ticketsToExport = ticketsToExport.filter((t) => t.status === status);
    if (dept && dept !== 'all') ticketsToExport = ticketsToExport.filter((t) => t.dept === dept);
    if (search) {
      const q = search.toLowerCase();
      ticketsToExport = ticketsToExport.filter((t) =>
        t.agentName?.toLowerCase().includes(q) ||
        t.cdbId?.toLowerCase().includes(q) ||
        t.dareRef?.toLowerCase().includes(q) ||
        t.expertName?.toLowerCase().includes(q)
      );
    }
    if (dateFrom) ticketsToExport = ticketsToExport.filter((t) => t.createdAt >= dateFrom);
    if (dateTo) {
      // Add end of day if only YYYY-MM-DD is provided
      const toDate = dateTo.includes('T') ? dateTo : `${dateTo}T23:59:59`;
      ticketsToExport = ticketsToExport.filter((t) => t.createdAt <= toDate);
    }

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

      const labels = (t.labels || []).join(';');
      const participants = (t.participants || []).map(p => p.name).join(';');

      // Escape commas in strings and build row
      const row = [
        t.id,
        t.dept,
        `"${t.agentName || ''}"`,
        t.agentLang || '',
        `"${t.expertName || ''}"`,
        t.expertLang || '',
        `"${t.cdbId || ''}"`,
        `"${t.dareRef || ''}"`,
        t.status,
        created.toISOString(),
        closed ? closed.toISOString() : '',
        durationMinutes,
        `"${labels}"`,
        `"${participants}"`
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
  const minutes = now.getHours() * 60 + now.getMinutes();
  return minutes >= 450 && minutes < 1350; // 07:30–22:30
}

// Track online users: userId -> { userId, name, role, count, status }
// (moved up)

function broadcastOnlineExperts() {
  const list = [...onlineUsers.values()]
    .filter((u) => u.role === 'expert')
    .map(({ userId, name, status }) => ({ userId, name, status: status || 'available' }));
  io.emit('experts:online', list);
}

async function broadcastAgentStatus(agentId, online) {
  try {
    const db = await readDb();
    const openTickets = db.tickets.filter((t) => t.agentId === agentId && t.status !== 'closed');
    for (const ticket of openTickets) {
      io.to(`ticket:${ticket.id}`).emit('agent:status', { ticketId: ticket.id, agentId, online });
    }
  } catch (err) {
    console.error('[agent:status] error:', err.message);
  }
}

// Socket.io
io.on('connection', (socket) => {
  console.log(`[socket] connected: ${socket.id}`);

  // Client identifies itself after connect
  socket.on('socket:identify', ({ userId, role, name }) => {
    socket.data.userId = userId;
    socket.data.role = role;
    socket.data.name = name;
    if (onlineUsers.has(userId)) {
      onlineUsers.get(userId).count++;
    } else {
      onlineUsers.set(userId, { userId, name, role, status: 'available', count: 1 });
    }
    if (role === 'expert' || role === 'manager') {
      broadcastOnlineExperts();
    }
    if (role === 'agent') {
      broadcastAgentStatus(userId, true);
    }
  });

  // ticket:new — agent creates a ticket
  socket.on('ticket:new', async ({ dept, agentId, agentLang, cdbId, dareRef, text, mediaUrl }) => {
    if (!isWithinBusinessHours()) {
      socket.emit('hours:closed', {
        message:
          'The expert chat is currently closed. Available Monday through Sunday between 07:30 and 22:30.',
      });
      return;
    }

    try {
      const db = await readDb();

      const agentUser = db.users.find((u) => u.id === agentId);
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
      };

      db.tickets.push(ticket);

      let message = null;
      if (text && text.trim()) {
        message = {
          id: uuidv4(),
          ticketId: ticket.id,
          senderId: agentId,
          senderName: agentName,
          senderLang: agentLang,
          text,
          translatedText: null,
          mediaUrl: mediaUrl || null,
          createdAt: new Date().toISOString(),
        };
        db.messages.push(message);
      }

      await writeDb(db);

      socket.join(`ticket:${ticket.id}`);

      // Confirm to agent
      socket.emit('ticket:created:self', { ticket, message });

      // Broadcast to all experts/managers
      io.emit('ticket:created', { ticket, firstMessage: message });

      console.log(`[ticket] created ${ticket.id} by ${agentId}`);
    } catch (err) {
      console.error('[ticket:new] error:', err.message);
      socket.emit('error', { message: 'Failed to create ticket' });
    }
  });

  // expert:join — expert joins a ticket room
  socket.on('expert:join', async ({ ticketId, expertId, expertName, expertLang }) => {
    try {
      const db = await readDb();
      const ticket = db.tickets.find((t) => t.id === ticketId);
      if (!ticket) return;

      // Track first expert for backwards compat / stats
      ticket.expertId = ticket.expertId || expertId;
      ticket.expertName = ticket.expertName || expertName;
      ticket.expertLang = ticket.expertLang || expertLang;
      ticket.expertJoinedAt = ticket.expertJoinedAt || new Date().toISOString();

      // Maintain participants list
      if (!ticket.participants) ticket.participants = [];
      if (!ticket.participants.find((p) => p.id === expertId)) {
        ticket.participants.push({ id: expertId, name: expertName });
      }

      await writeDb(db);

      socket.join(`ticket:${ticketId}`);

      // Load existing messages — filter whispers for agents
      const isAgentSocket = socket.data.role === 'agent';
      const messages = db.messages.filter(
        (m) => m.ticketId === ticketId && (!isAgentSocket || !m.whisper)
      );
      socket.emit('ticket:history', { ticketId, messages });

      // Notify everyone in the room
      io.to(`ticket:${ticketId}`).emit('expert:joined', { ticketId, expertName, participants: ticket.participants });

      // Broadcast to all (for queue/sidebar updates)
      io.emit('ticket:updated', {
        ticketId,
        status: 'active',
        expertName: ticket.expertName,
        participants: ticket.participants
      });

      console.log(`[ticket] expert ${expertName} joined ${ticketId}`);
    } catch (err) {
      console.error('[expert:join] error:', err.message);
    }
  });

  // message:send — send a message in a ticket
  socket.on('message:send', async ({ ticketId, senderId, senderLang, text, mediaUrl, whisper }) => {
    try {
      const db = await readDb();
      const ticket = db.tickets.find((t) => t.id === ticketId);
      if (!ticket || ticket.status === 'closed') return;

      let translatedText = null;

      if (whisper) {
        // Whisper: expert-to-expert, no translation needed
        translatedText = text;
      } else {
        // Determine receiver language for translation
        const isAgent = ticket.agentId === senderId;
        const receiverLang = isAgent ? ticket.expertLang || 'nl' : ticket.agentLang;
        try {
          translatedText = await translate(text, senderLang, receiverLang);
        } catch (translateErr) {
          console.error('[translate] error:', translateErr.message);
          translatedText = text;
        }
      }

      const senderUser = db.users.find((u) => u.id === senderId);
      const message = {
        id: uuidv4(),
        ticketId,
        senderId,
        senderName: senderUser?.name || senderId,
        senderLang,
        text,
        translatedText,
        mediaUrl: mediaUrl || null,
        whisper: whisper || false,
        createdAt: new Date().toISOString(),
      };

      db.messages.push(message);
      await writeDb(db);

      if (whisper) {
        // Only deliver to non-agent sockets in the room
        const roomSockets = await io.in(`ticket:${ticketId}`).fetchSockets();
        for (const s of roomSockets) {
          if (s.data.role !== 'agent') {
            s.emit('message:new', { message });
          }
        }
        console.log(`[whisper] ${senderId} → ticket ${ticketId}`);
      } else {
        io.to(`ticket:${ticketId}`).emit('message:new', { message });
        console.log(`[message] ${senderId} → ticket ${ticketId}`);
      }
    } catch (err) {
      console.error('[message:send] error:', err.message);
    }
  });

  // typing indicators
  // status:set — expert updates their availability status
  socket.on('status:set', ({ status }) => {
    const allowed = ['available', 'break', 'lunch', 'meeting'];
    if (!allowed.includes(status)) return;
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

  // expert:leave — expert/manager leaves a ticket without closing it
  socket.on('expert:leave', async ({ ticketId, expertId, expertName }) => {
    try {
      const db = await readDb();
      const ticket = db.tickets.find((t) => t.id === ticketId);
      if (!ticket) return;

      // Remove from participants
      if (ticket.participants) {
        ticket.participants = ticket.participants.filter((p) => p.id !== expertId);
      }

      // If this was the primary expert, clear those fields so someone else can take over
      if (ticket.expertId === expertId) {
        ticket.expertId = null;
        ticket.expertName = null;
        ticket.expertLang = null;
        ticket.expertJoinedAt = null;
      }

      await writeDb(db);

      // Leave the socket room
      socket.leave(`ticket:${ticketId}`);

      // Notify remaining participants
      io.to(`ticket:${ticketId}`).emit('expert:left', { ticketId, expertName, participants: ticket.participants || [] });

      // Broadcast updated ticket to all
      io.emit('ticket:updated', {
        ticketId,
        participants: ticket.participants || [],
        expertId: ticket.expertId,
        expertName: ticket.expertName,
        expertJoinedAt: ticket.expertJoinedAt
      });

      console.log(`[ticket] expert ${expertName} left ${ticketId}`);
    } catch (err) {
      console.error('[expert:leave] error:', err.message);
    }
  });

  // ticket:close — close a ticket
  socket.on('ticket:close', async ({ ticketId }) => {
    try {
      const db = await readDb();
      const ticket = db.tickets.find((t) => t.id === ticketId);
      if (!ticket) return;

      ticket.status = 'closed';
      ticket.closedAt = new Date().toISOString();
      await writeDb(db);

      io.to(`ticket:${ticketId}`).emit('ticket:closed', { ticketId });

      // Notify all clients so queue updates
      io.emit('ticket:updated', { ticketId, status: 'closed' });

      console.log(`[ticket] closed ${ticketId}`);
    } catch (err) {
      console.error('[ticket:close] error:', err.message);
    }
  });

  // rating:submit — agent rates a closed ticket
  socket.on('rating:submit', async ({ ticketId, agentId, expertId, rating, comment }) => {
    try {
      const db = await readDb();
      const ticket = db.tickets.find((t) => t.id === ticketId);
      if (!ticket || ticket.status !== 'closed') return;
      if (!db.ratings) db.ratings = [];
      if (db.ratings.find((r) => r.ticketId === ticketId && r.agentId === agentId)) return;

      const entry = {
        id: uuidv4(),
        ticketId,
        agentId,
        expertId,
        rating,
        comment: comment || null,
        createdAt: new Date().toISOString(),
      };
      db.ratings.push(entry);
      await writeDb(db);
      socket.emit('rating:saved', { ticketId });
      console.log(`[rating] ${agentId} rated ticket ${ticketId}: ${rating}/5`);
    } catch (err) {
      console.error('[rating:submit] error:', err.message);
    }
  });

  // ticket:labels:update — expert updates labels on a ticket
  socket.on('ticket:labels:update', async ({ ticketId, labels }) => {
    try {
      const db = await readDb();
      const ticket = db.tickets.find((t) => t.id === ticketId);
      if (!ticket) return;

      ticket.labels = labels || [];
      await writeDb(db);

      io.to(`ticket:${ticketId}`).emit('ticket:labels:updated', { ticketId, labels: ticket.labels });
      io.emit('ticket:updated', { ticketId, labels: ticket.labels }); // Broadcast to manager/experts in queue

      console.log(`[ticket] labels updated for ${ticketId}: ${ticket.labels.join(', ')}`);
    } catch (err) {
      console.error('[ticket:labels:update] error:', err.message);
    }
  });

  // reaction:toggle — toggle a reaction on a message
  socket.on('reaction:toggle', async ({ ticketId, messageId, emoji, userId }) => {
    try {
      const db = await readDb();
      const message = db.messages.find((m) => m.id === messageId && m.ticketId === ticketId);
      if (!message) return;

      if (!message.reactions) message.reactions = {};
      if (!message.reactions[emoji]) message.reactions[emoji] = [];

      const idx = message.reactions[emoji].indexOf(userId);
      if (idx >= 0) {
        message.reactions[emoji].splice(idx, 1);
        if (message.reactions[emoji].length === 0) delete message.reactions[emoji];
      } else {
        message.reactions[emoji].push(userId);
      }

      await writeDb(db);
      io.to(`ticket:${ticketId}`).emit('reaction:updated', {
        ticketId,
        messageId,
        reactions: message.reactions,
      });
    } catch (err) {
      console.error('[reaction:toggle] error:', err.message);
    }
  });

  socket.on('disconnect', () => {
    console.log(`[socket] disconnected: ${socket.id}`);
    const userId = socket.data.userId;
    const role = socket.data.role;
    if (!userId) return;

    const u = onlineUsers.get(userId);
    if (u) {
      u.count--;
      if (u.count <= 0) onlineUsers.delete(userId);
    }

    if (role === 'expert' || role === 'manager') {
      broadcastOnlineExperts();
    }
    if (role === 'agent' && (!u || u.count <= 0)) {
      broadcastAgentStatus(userId, false);
    }
  });
});

const PORT = process.env.PORT || 3001;
httpServer.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
