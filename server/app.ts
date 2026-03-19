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
import logoRoutes from './routes/logos.js';
import authRoutes from './routes/auth.js';
import ticketRoutes from './routes/tickets.js'; // Kept for export route support
import { query } from './db.js';
import config from './config.js';
import logger from './utils/logger.js';
import { auth, authorize } from './middleware/auth.js';
import * as presenceService from './services/presence.js';
import { setIo as setBusinessHoursIo } from './services/businessHours.js';
import { runDailyPurge } from './services/gdpr.js';
import { setIo as setTopicHeatIo, runTopicHeatCheck } from './services/topicHeat.js';
import { registerSocketHandlers } from './socket/handlers.js';
import { metricsMiddleware } from './middleware/metrics.js';
import { register } from './utils/metrics.js';

import { initRedis, getRedisClients } from './utils/redis.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();
app.set('trust proxy', 1);
export { app };

const httpServer = createServer(app);
export { httpServer };

const allowedOrigins = config.CORS_ORIGIN.split(',');

const io = new Server(httpServer, {
  cors: { 
    origin: (origin, callback) => {
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        callback(new Error('Not allowed by CORS'));
      }
    },
    methods: ['GET', 'POST'] 
  },
});

// ... (redis setup)

app.use(helmet({
  crossOriginResourcePolicy: { policy: "cross-origin" }
}));
app.use(cors({ 
  origin: (origin, callback) => {
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  }
}));
app.use(express.json());

const globalLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: (process.env.NODE_ENV === 'test' || process.env.DISABLE_RATE_LIMIT === 'true') ? 999999 : 100,
  message: { error: 'Too many requests, please try again later.' }
});
app.use('/api', globalLimiter);

export const authLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: (process.env.NODE_ENV === 'test' || process.env.DISABLE_RATE_LIMIT === 'true') ? 999999 : 5,
  message: { error: 'Too many authentication attempts, please try again later.' }
});


app.use((req: Request, res: Response, next: NextFunction) => {
  logger.info({ method: req.method, url: req.url }, `Incoming ${req.method} request`);
  next();
});

app.use(metricsMiddleware);

const rootUploadDir = path.join(__dirname, 'uploads');
app.use('/uploads', express.static(rootUploadDir));

// API v1 Routing
const v1Router = express.Router();

v1Router.use('/tickets', ticketRoutes); // Kept for export support
v1Router.use('/uploads', uploadRoutes);
v1Router.use('/logos', logoRoutes);
v1Router.use('/auth', authLimiter, authRoutes);

// tRPC v1
v1Router.use(
  '/trpc',
  trpcExpress.createExpressMiddleware({
    router: appRouter,
    createContext,
  })
);

import { partners } from './db/schema.js';
import { eq } from 'drizzle-orm';
import { db } from './db.js';

v1Router.get('/config', async (req: Request, res: Response) => {
  const partnerId = req.query.partnerId as string;
  let partnerConfig = null;

  if (partnerId) {
    const result = await db.select().from(partners).where(eq(partners.id, partnerId)).limit(1);
    if (result.length > 0) {
      partnerConfig = result[0];
    }
  }

  res.json({
    businessHoursStart: partnerConfig?.businessHoursStart ?? config.BUSINESS_HOURS_START,
    businessHoursEnd: partnerConfig?.businessHoursEnd ?? config.BUSINESS_HOURS_END,
    businessHoursTimezone: partnerConfig?.businessHoursTimezone ?? 'Europe/Brussels',
    uploadMaxSize: config.UPLOAD_MAX_SIZE,
    uploadAllowedTypes: config.UPLOAD_ALLOWED_TYPES,
  });
});

v1Router.get('/health', async (_req: Request, res: Response) => {
  try {
    await query('SELECT 1');
    try {
      const ollamaRes = await fetch(`${config.OLLAMA_HOST}/api/version`, { signal: AbortSignal.timeout(2000) });
      if (!ollamaRes.ok) throw new Error('Ollama response not ok');
    } catch (err) {
      logger.warn('Ollama unavailable during health check');
      return res.json({ status: 'degraded', database: 'connected', llm: 'disconnected' });
    }
    res.json({ status: 'ok', database: 'connected', llm: 'connected' });
  } catch (err) {
    logger.error({ err }, 'Health check failed');
    res.status(503).json({ status: 'error', database: 'disconnected' });
  }
});

// Internal E2E Seeding Endpoint
if (process.env.NODE_ENV === 'test' || process.env.DISABLE_RATE_LIMIT === 'true') {
  v1Router.post('/seed-e2e', async (_req: Request, res: Response) => {
    try {
      const { execSync } = await import('child_process');
      execSync('npx tsx scripts/seed_e2e.ts', { stdio: 'inherit' });
      res.json({ success: true });
    } catch (err) {
      logger.error({ err }, 'E2E Seed endpoint failed');
      res.status(500).json({ error: String(err) });
    }
  });
}

app.use('/api/v1', v1Router);

app.get('/metrics', async (req: Request, res: Response) => {
  const remoteIp = req.socket.remoteAddress;
  const isLocal = remoteIp === '127.0.0.1' || remoteIp === '::1' || remoteIp === '::ffff:127.0.0.1';
  const tokenHeader = req.headers['x-metrics-token'];
  
  if (config.METRICS_TOKEN && tokenHeader !== config.METRICS_TOKEN && !isLocal) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  res.set('Content-Type', register.contentType);
  res.end(await register.metrics());
});


// GDPR purge
runDailyPurge();
setInterval(runDailyPurge, config.PURGE_INTERVAL_MS);

// Socket.IO handlers
registerSocketHandlers(io);

// Topic Heat Detection
setTopicHeatIo(io);
setBusinessHoursIo(io);
setInterval(() => {
  runTopicHeatCheck().catch(err => logger.error({ err }, '[TopicHeat] Periodic check failed'));
}, 10 * 60 * 1000); // Every 10 minutes
