import express, { Request, Response, NextFunction } from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { createClient } from 'redis';
import { createAdapter } from '@socket.io/redis-adapter';

import ticketRoutes from './routes/tickets.js';
import messageRoutes from './routes/messages.js';
import uploadRoutes from './routes/uploads.js';
import feedbackRoutes from './routes/feedback.js';
import labelRoutes from './routes/labels.js';
import cannedRoutes from './routes/canned_responses.js';
import authRoutes from './routes/auth.js';
import statsRoutes from './routes/stats.js';
import { query } from './db.js';
import config from './config.js';
import logger from './utils/logger.js';
import { auth, authorize } from './middleware/auth.js';
import * as presenceService from './services/presence.js';
import { setIo as setBusinessHoursIo } from './services/businessHours.js';
import { runDailyPurge } from './services/gdpr.js';
import { registerSocketHandlers } from './socket/handlers.js';

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

// Redis Adapter Initialization
if (config.REDIS_URL) {
  const pubClient = createClient({ url: config.REDIS_URL });
  const subClient = pubClient.duplicate();

  pubClient.on('error', (err) => logger.error({ err }, 'Redis Pub Client Error'));
  subClient.on('error', (err) => logger.error({ err }, 'Redis Sub Client Error'));

  try {
    await Promise.all([pubClient.connect(), subClient.connect()]);
    io.adapter(createAdapter(pubClient, subClient));
    logger.info('Socket.io Redis adapter connected');
  } catch (err) {
    logger.warn({ err }, 'Failed to connect to Redis. Falling back to in-memory adapter.');
  }
}

export { io };
app.set('io', io);
presenceService.setIo(io);
setBusinessHoursIo(io);

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
app.use('/api/stats', statsRoutes);

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

app.get('/api/ratings', [auth, authorize(['admin', 'expert'])], async (_req: Request, res: Response) => {
  try {
    const ratings = await query('SELECT * FROM ratings ORDER BY "created_at" DESC');
    res.json(ratings);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/online/:userId', [auth], (_req: Request, res: Response) => {
  const online = presenceService.getOnlineUsers().has(_req.params.userId);
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

app.post('/api/presence/status', [auth, authorize(['admin', 'expert'])], (req: Request, res: Response) => {
  const { userId, status } = req.body;
  if (!userId || !status) return res.status(400).json({ error: 'userId and status are required' });
  const updated = presenceService.setUserStatus(userId, status);
  if (updated) {
    res.json({ success: true, userId, status });
  } else {
    res.status(404).json({ error: 'User not online' });
  }
});

// GDPR purge
runDailyPurge();
setInterval(runDailyPurge, config.PURGE_INTERVAL_MS);

// Socket.IO handlers
registerSocketHandlers(io);
