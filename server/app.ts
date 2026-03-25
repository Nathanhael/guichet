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
import ssoRoutes from './routes/sso.js';
import ticketRoutes from './routes/tickets.js'; // Kept for export route support
import { query } from './db.js';
import config from './config.js';
import logger from './utils/logger.js';
import { auth, authorize } from './middleware/auth.js';
import * as presenceService from './services/presence.js';
import { setIo as setBusinessHoursIo } from './services/businessHours.js';
import { getBusinessHoursStatus } from './services/businessHours.js';
import { runDailyPurge } from './services/gdpr.js';
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
  pingTimeout: 5000,
  pingInterval: 10000,
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

// Redis setup for Socket.io and Health Checks
initRedis().then(({ pubClient, subClient }) => {
  if (pubClient && subClient) {
    io.adapter(createAdapter(pubClient, subClient));
    logger.info('Socket.io Redis adapter initialized');
  }
}).catch(err => {
  logger.error({ err }, 'Failed to initialize Redis');
});

app.use(helmet({
  crossOriginResourcePolicy: { policy: "cross-origin" },
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'"], // Swagger UI needs inline scripts
      styleSrc: ["'self'", "'unsafe-inline'"],  // Swagger UI + Tailwind
      imgSrc: ["'self'", "data:", "blob:"],
      connectSrc: ["'self'", "ws:", "wss:", ...allowedOrigins],
      fontSrc: ["'self'"],
      objectSrc: ["'none'"],
      frameAncestors: ["'none'"],
      baseUri: ["'self'"],
      formAction: ["'self'"],
    },
  },
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

const uploadLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: (process.env.NODE_ENV === 'test' || process.env.DISABLE_RATE_LIMIT === 'true') ? 999999 : 10,
  message: { error: 'Too many upload requests, please try again later.' }
});

const trpcLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: (process.env.NODE_ENV === 'test' || process.env.DISABLE_RATE_LIMIT === 'true') ? 999999 : 200,
  message: { error: 'Too many requests, please try again later.' }
});


app.use((req: Request, res: Response, next: NextFunction) => {
  logger.info({ method: req.method, url: req.url }, `Incoming ${req.method} request`);
  next();
});

app.use(metricsMiddleware);

const rootUploadDir = path.join(__dirname, 'uploads');
app.use('/uploads', express.static(rootUploadDir));

// API v1 Routing
import swaggerUi from 'swagger-ui-express';
import { openapiSpec } from './docs/openapi.js';
const v1Router = express.Router();

// API Documentation (Swagger UI)
v1Router.use('/docs', swaggerUi.serve, swaggerUi.setup(openapiSpec, {
  customCss: '.swagger-ui .topbar { display: none }',
  customSiteTitle: 'Tessera API Documentation',
}));

// Serve tRPC reference markdown as plain text
v1Router.get('/trpc-reference', (_req: Request, res: Response) => {
  res.type('text/markdown').sendFile(path.join(__dirname, 'docs', 'trpc-reference.md'));
});

v1Router.use('/tickets', ticketRoutes); // Kept for export support
v1Router.use('/uploads', uploadLimiter, uploadRoutes);
v1Router.use('/logos', uploadLimiter, logoRoutes);
v1Router.use('/auth', authLimiter, authRoutes);
v1Router.use('/auth/sso', authLimiter, ssoRoutes);

// tRPC v1
v1Router.use(
  '/trpc',
  trpcLimiter,
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
  let businessHoursStart = config.BUSINESS_HOURS_START;
  let businessHoursEnd = config.BUSINESS_HOURS_END;
  let businessHoursTimezone = 'Europe/Brussels';
  let businessHoursSchedule: unknown = null;

  if (partnerId) {
    const result = await db.select({
      businessHoursSchedule: partners.businessHoursSchedule,
      businessHoursStart: partners.businessHoursStart,
      businessHoursEnd: partners.businessHoursEnd,
      businessHoursTimezone: partners.businessHoursTimezone,
    }).from(partners).where(eq(partners.id, partnerId)).limit(1);
    if (result.length > 0) {
      businessHoursSchedule = result[0].businessHoursSchedule ?? businessHoursSchedule;
      businessHoursStart = result[0].businessHoursStart ?? businessHoursStart;
      businessHoursEnd = result[0].businessHoursEnd ?? businessHoursEnd;
      businessHoursTimezone = result[0].businessHoursTimezone ?? businessHoursTimezone;
    }
  }

  const businessHoursStatus = getBusinessHoursStatus({
    businessHoursSchedule: businessHoursSchedule as any,
    businessHoursStart,
    businessHoursEnd,
    businessHoursTimezone,
  });

  res.json({
    businessHoursStart,
    businessHoursEnd,
    businessHoursTimezone,
    businessHoursSchedule,
    businessHoursStatus,
    uploadMaxSize: config.UPLOAD_MAX_SIZE,
    uploadAllowedTypes: config.UPLOAD_ALLOWED_TYPES,
  });
});

/**
 * @openapi
 * /v1/health:
 *   get:
 *     summary: Health check
 *     tags: [System]
 *     responses:
 *       200:
 *         description: System healthy
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status: { type: string, example: ok }
 *                 database: { type: string, example: connected }
 *       503:
 *         description: Database unreachable
 */
v1Router.get('/health', async (_req: Request, res: Response) => {
  try {
    await query('SELECT 1');
    res.json({ status: 'ok', database: 'connected' });
  } catch (err) {
    logger.error({ err }, 'Health check failed');
    res.status(503).json({ status: 'error', database: 'disconnected' });
  }
});

// Internal E2E Seeding Endpoint — test environments only
if (process.env.NODE_ENV === 'test') {
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


// GDPR purge — run initial after random delay (1-60 min jitter to avoid predictable timing)
const purgeJitterMs = Math.floor(Math.random() * 60 * 60 * 1000);
setTimeout(() => {
  runDailyPurge();
  // Subsequent runs: interval ± 1h jitter
  setInterval(() => {
    const jitter = Math.floor(Math.random() * 2 * 60 * 60 * 1000) - 60 * 60 * 1000; // ±1h
    setTimeout(runDailyPurge, Math.max(0, jitter));
  }, config.PURGE_INTERVAL_MS);
}, purgeJitterMs);
logger.info({ purgeJitterMin: Math.round(purgeJitterMs / 60000) }, '[GDPR] Purge scheduled with jitter');

// Socket.IO handlers
registerSocketHandlers(io);

setBusinessHoursIo(io);

// Serve built client (production / CI / test — skipped when dist doesn't exist i.e. Docker dev)
import { existsSync } from 'fs';
const clientDist = path.resolve(__dirname, '../client/dist');
if (existsSync(clientDist)) {
  app.use(express.static(clientDist));
  // SPA fallback — must come after all API routes
  app.get('*', (_req: Request, res: Response) => {
    res.sendFile(path.join(clientDist, 'index.html'));
  });
}
