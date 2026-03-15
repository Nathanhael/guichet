import express from 'express';
import { createServer } from 'http';
import { Server as SocketServer } from 'socket.io';
import jwt from 'jsonwebtoken';
import { mockUsers, mockTickets, mockMessages, mockConfig, mockMemberships } from './data.js';

const app = express();
const httpServer = createServer(app);
const io = new SocketServer(httpServer, { cors: { origin: '*' } });

app.use(express.json());

const JWT_SECRET = 'mock-secret';

// Auth
app.post('/api/v1/auth/login', (req, res) => {
  const { id, username } = req.body;
  const lookup = id || username;
  const user = Object.values(mockUsers).find(
    (u) => u.id === lookup || u.username === lookup,
  );
  if (!user) return res.status(401).json({ error: 'Invalid credentials' });

  const token = jwt.sign({ userId: user.id, role: user.role }, JWT_SECRET);
  const memberships = mockMemberships[user.id] || [];
  res.json({
    token,
    user,
    memberships,
    activePartnerId: 'mock-partner',
  });
});

// Config
app.get('/api/v1/config', (_req, res) => res.json(mockConfig));

// Health
app.get('/api/v1/health', (_req, res) => res.json({ status: 'ok' }));

// tRPC-style mock responses (batch and individual)
app.get('/api/v1/trpc/ticket.list', (_req, res) => {
  res.json({ result: { data: mockTickets } });
});

app.get('/api/v1/trpc/stats.overview', (_req, res) => {
  res.json({
    result: {
      data: { totalTickets: 42, avgResolution: 15, satisfaction: 4.2 },
    },
  });
});

app.get('/api/v1/trpc/ticket.messages', (req, res) => {
  res.json({ result: { data: mockMessages } });
});

// Catch-all tRPC GET (for batch queries)
app.get('/api/v1/trpc/:proc', (req, res) => {
  console.log(`Mock tRPC GET: ${req.params.proc}`);
  res.json({ result: { data: null } });
});

// Catch-all tRPC POST (for mutations)
app.post('/api/v1/trpc/:proc', (req, res) => {
  console.log(`Mock tRPC POST: ${req.params.proc}`);
  res.json({ result: { data: { ok: true } } });
});

// Socket.io with realistic message shapes
io.on('connection', (socket) => {
  console.log(`Mock: client connected (${socket.id})`);

  socket.on('socket:identify', (data) => {
    socket.data = data;
    socket.emit('queue:update', mockTickets);
    
    // Emit business hours status — controlled by env var or default to open
    const businessHoursOpen = process.env.MOCK_BUSINESS_HOURS !== 'closed';
    socket.emit('businessHours:status', { open: businessHoursOpen });
  });

  socket.on('ticket:new', (data) => {
    const ticket = {
      ...mockTickets[0],
      id: `mock-${Date.now()}`,
      ...data,
      status: 'open',
      created_at: new Date().toISOString(),
    };
    socket.emit('ticket:created', ticket);
    io.emit('queue:update', [ticket, ...mockTickets]);
  });

  socket.on('support:join', (data) => {
    const { ticketId } = data;
    socket.join(`ticket:${ticketId}`);
    socket.emit('support:joined', { ticketId, userId: socket.data?.userId });
  });

  socket.on('message:send', (data) => {
    const msg = {
      id: `msg-${Date.now()}`,
      ticketId: data.ticketId,
      senderId: socket.data?.userId || 'unknown',
      senderName: socket.data?.name || 'Unknown',
      senderRole: socket.data?.role || 'agent',
      originalText: data.text,
      improvedText: data.text,
      processedText: data.text,
      translationSkipped: true,
      fallback: false,
      whisper: false,
      system: false,
      reactions: '{}',
      created_at: new Date().toISOString(),
    };
    io.to(`ticket:${data.ticketId}`).emit('message:new', msg);
    socket.emit('message:new', msg);
  });

  socket.on('typing:start', (data) => {
    socket.to(`ticket:${data.ticketId}`).emit('typing:indicator', {
      userId: socket.data?.userId,
      name: socket.data?.name,
      typing: true,
    });
  });

  socket.on('typing:stop', (data) => {
    socket.to(`ticket:${data.ticketId}`).emit('typing:indicator', {
      userId: socket.data?.userId,
      name: socket.data?.name,
      typing: false,
    });
  });

  socket.on('ticket:close', (data) => {
    io.to(`ticket:${data.ticketId}`).emit('ticket:closed', { ticketId: data.ticketId });
  });

  socket.on('disconnect', () => {
    console.log(`Mock: client disconnected (${socket.id})`);
  });
});

const PORT = process.env.MOCK_PORT ? parseInt(process.env.MOCK_PORT) : 4173;
httpServer.listen(PORT, () => {
  console.log(`Mock server running on http://localhost:${PORT}`);
});
