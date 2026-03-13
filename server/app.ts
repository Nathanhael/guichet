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
import * as trpcExpress from '@trpc/server/adapters/express';
import { createContext } from './trpc/context.js';
import { appRouter } from './trpc/router.js';

import uploadRoutes from './routes/uploads.js';
import authRoutes from './routes/auth.js';
import ticketRoutes from './routes/tickets.js'; // Kept for export route support
import { query } from './db.js';
import config from './config.js';
import logger from './utils/logger.js';
import { auth, authorize } from './middleware/auth.js';
import * as presenceService from './services/presence.js';
import { setIo as setBusinessHoursIo } from './services/businessHours.js';
import { runDailyPurge } from './services/gdpr.js';
import { registerSocketHandlers } from './socket/handlers.js';

import { initRedis, getRedisClients } from './utils/redis.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();
export { app };

const httpServer = createServer(app);
export { httpServer };

const io = new Server(httpServer, {
  cors: { origin: config.CORS_ORIGIN, methods: ['GET', 'POST'] },
});

// Redis Adapter Initialization
const { pubClient, subClient } = await initRedis();
if (pubClient && subClient) {
  io.adapter(createAdapter(pubClient, subClient));
  logger.info('Socket.io Redis adapter connected');
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

app.use('/api/tickets', ticketRoutes); // Kept for export support
app.use('/api/uploads', uploadRoutes);
app.use('/api/auth', authLimiter, authRoutes);

// tRPC
app.use(
  '/api/trpc',
  trpcExpress.createExpressMiddleware({
    router: appRouter,
    createContext,
  })
);

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

// GDPR purge
runDailyPurge();
setInterval(runDailyPurge, config.PURGE_INTERVAL_MS);

// Socket.IO handlers
registerSocketHandlers(io);
