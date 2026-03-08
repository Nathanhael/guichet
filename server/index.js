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

// GET /api/stats — manager statistics
app.get('/api/stats', async (req, res) => {
  try {
    const db = await readDb();
    const { dateFrom, dateTo, dept } = req.query;
    const now = new Date();
    const today = now.toISOString().slice(0, 10);

    // Filter tickets based on global dashboard filters
    let filteredTickets = db.tickets || [];

    if (dept && dept !== 'all') {
      filteredTickets = filteredTickets.filter(t => t.dept === dept);
    }
    if (dateFrom) {
      filteredTickets = filteredTickets.filter(t => t.createdAt >= dateFrom);
    }
    if (dateTo) {
      const toStr = dateTo.includes('T') ? dateTo : `${dateTo}T23:59:59`;
      filteredTickets = filteredTickets.filter(t => t.createdAt <= toStr);
    }

    const todayTickets = filteredTickets.filter((t) => t.createdAt.startsWith(today));

    // Avg time to expert join
    const withJoin = filteredTickets.filter((t) => t.closedAt && t.expertJoinedAt);
    const avgResponseMs = withJoin.length > 0
      ? withJoin.reduce((s, t) => s + (new Date(t.expertJoinedAt) - new Date(t.createdAt)), 0) / withJoin.length
      : 0;

    // Avg chat duration (create → close)
    const closedWithDuration = filteredTickets.filter((t) => t.status === 'closed' && t.closedAt);
    const avgDurationMs = closedWithDuration.length > 0
      ? closedWithDuration.reduce((s, t) => s + (new Date(t.closedAt) - new Date(t.createdAt)), 0) / closedWithDuration.length
      : 0;

    // Abandoned = closed without expert ever joining
    const abandonedCount = filteredTickets.filter((t) => t.status === 'closed' && !t.expertJoinedAt).length;

    // Hourly distribution (filtered tickets, by creation hour)
    const hourlyMap = Array.from({ length: 24 }, (_, h) => ({ hour: h, count: 0 }));
    filteredTickets.forEach((t) => {
      const h = new Date(t.createdAt).getHours();
      hourlyMap[h].count++;
    });

    // Daily trend
    let days = [];
    if (dateFrom && dateTo) {
      // Determine days in selected range
      const start = new Date(dateFrom);
      const end = new Date(dateTo);
      for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
        days.push(d.toISOString().slice(0, 10));
      }
      // Cap at reasonable limit if range is huge? (e.g. 90 days)
      if (days.length > 90) days = days.slice(-90);
    } else {
      // Default last 30 days
      for (let i = 29; i >= 0; i--) {
        const d = new Date(now);
        d.setDate(d.getDate() - i);
        days.push(d.toISOString().slice(0, 10));
      }
    }

    const dailyTrend = days.map((date) => {
      const dayTickets = filteredTickets.filter((t) => t.createdAt.startsWith(date));
      return {
        date: date.slice(5), // MM-DD
        total: dayTickets.length,
        dsc: dayTickets.filter((t) => t.dept === 'DSC').length,
        fot: dayTickets.filter((t) => t.dept === 'FOT').length,
      };
    });

    // Expert stats
    const expertMap = {};
    filteredTickets.forEach((t) => {
      if (!t.expertName) return;
      if (!expertMap[t.expertName]) expertMap[t.expertName] = { name: t.expertName, total: 0, today: 0 };
      expertMap[t.expertName].total++;
      if (t.createdAt.startsWith(today)) expertMap[t.expertName].today++;
    });
    const expertStats = Object.values(expertMap).sort((a, b) => b.total - a.total).slice(0, 8);

    // Agent stats (today)
    const agentMap = {};
    todayTickets.forEach((t) => {
      const name = t.agentName || t.agentId;
      if (!agentMap[name]) agentMap[name] = { name, today: 0 };
      agentMap[name].today++;
    });
    const agentStats = Object.values(agentMap).sort((a, b) => b.today - a.today).slice(0, 6);

    // Queue health (independent of filters usually, but we apply dept filter if present)
    let queueTickets = db.tickets.filter((t) => t.status !== 'closed' && !t.expertJoinedAt);
    if (dept && dept !== 'all') queueTickets = queueTickets.filter(t => t.dept === dept);

    const oldest = queueTickets.reduce((min, t) => {
      const age = now - new Date(t.createdAt);
      return age > min ? age : min;
    }, 0);
    const waitingOver3 = queueTickets.filter((t) => (now - new Date(t.createdAt)) > 180000).length;

    // SLA Health: % of tickets with response time <= 3 minutes
    const resolvedTickets = filteredTickets.filter(t => t.expertJoinedAt);
    const compliantTickets = resolvedTickets.filter(t => {
      const responseTime = new Date(t.expertJoinedAt) - new Date(t.createdAt);
      return responseTime <= 180000;
    }).length;
    const slaHealth = resolvedTickets.length > 0
      ? Math.round((compliantTickets / resolvedTickets.length) * 100)
      : 100;

    // Global ratings filter
    let ratings = db.ratings || [];
    if (dept && dept !== 'all') {
      const deptTickets = db.tickets.filter(t => t.dept === dept).map(t => t.id);
      ratings = ratings.filter(r => deptTickets.includes(r.ticketId));
    }
    if (dateFrom) {
      ratings = ratings.filter(r => r.createdAt >= dateFrom);
    }
    if (dateTo) {
      const toStr = dateTo.includes('T') ? dateTo : `${dateTo}T23:59:59`;
      ratings = ratings.filter(r => r.createdAt <= toStr);
    }

    res.json({
      todayTotal: todayTickets.length,
      todayOpen: todayTickets.filter((t) => t.status !== 'closed').length,
      todayClosed: todayTickets.filter((t) => t.status === 'closed').length,
      avgResponseMinutes: Math.round(avgResponseMs / 60000),
      avgDurationMinutes: Math.round(avgDurationMs / 60000),
      abandonedCount,
      dscCount: filteredTickets.filter((t) => t.dept === 'DSC').length,
      fotCount: filteredTickets.filter((t) => t.dept === 'FOT').length,
      total: filteredTickets.length,
      hourlyDistribution: hourlyMap,
      dailyTrend,
      expertStats,
      agentStats,
      oldestWaitMinutes: Math.round(oldest / 60000),
      waitingOver3,
      slaHealth,
      avgRating: ratings.length > 0
        ? Math.round(((ratings.reduce((s, r) => s + r.rating, 0) / ratings.length) * 10)) / 10
        : null,
      totalRatings: ratings.length,
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
