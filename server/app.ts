import express, { Request, Response, NextFunction } from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import path from 'path';
import { fileURLToPath } from 'url';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import RedisStore from 'rate-limit-redis';
import { createAdapter } from '@socket.io/redis-adapter';
import * as trpcExpress from '@trpc/server/adapters/express';
import { createContext } from './trpc/context.js';
import { appRouter } from './trpc/router.js';

import uploadRoutes from './routes/uploads.js';

import authRoutes from './routes/auth/index.js';
import ssoRoutes from './routes/sso.js';
import ticketRoutes from './routes/tickets.js'; // Kept for export route support
import { db } from './db.js';
import { sql, eq } from 'drizzle-orm';
import config from './config.js';
import logger from './utils/logger.js';
import { auth as authMiddleware, AuthRequest } from './middleware/auth.js';
import { setIo as setBusinessHoursIo, getBusinessHoursStatus, BusinessHoursSchedule } from './services/businessHours.js';
import { setIo as setPresenceIo, flushPresenceOnStartup } from './services/presence.js';
import { runDailyPurge } from './services/gdpr.js';
import { rollupDay } from './services/statusTracking.js';
import { cleanupExpiredTokens } from './services/refreshToken.js';
import { scheduleDailyChainVerify } from './services/chainVerifySchedule.js';
import { registerSocketHandlers } from './socket/handlers.js';
import { metricsMiddleware } from './middleware/metrics.js';
import { createTaskRunner } from './utils/taskRunner.js';
import { register } from './utils/metrics.js';

import { initRedis, getRedisClients } from './utils/redis.js';
import { jwtVerify } from 'jose';
import { initAiContext } from './services/ai/index.js';
import { decrypt } from './services/encryption.js';
import * as schema from './db/schema.js';

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
      // !origin (undefined) is allowed for non-browser clients (curl, server-to-server).
      // origin === "null" (literal string) comes from sandboxed iframes / file:// pages — reject in production.
      if (origin === 'null' && process.env.NODE_ENV === 'production') {
        callback(new Error('Not allowed by CORS'));
      } else if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        callback(new Error('Not allowed by CORS'));
      }
    },
    methods: ['GET', 'POST'],
    credentials: true,
  },
});

// Redis setup for Socket.io and Health Checks
initRedis().then(({ pubClient, subClient }) => {
  if (pubClient && subClient) {
    io.adapter(createAdapter(pubClient, subClient));
    logger.info('Socket.io Redis adapter initialized');
  }

  // Initialize AI service layer with shared dependencies
  initAiContext({
    db,
    redis: pubClient,
    logger,
    config,
    decrypt,
    schema: {
      partners: schema.partners,
      tickets: schema.tickets,
      messages: schema.messages,
      aiPromptTemplates: schema.aiPromptTemplates,
      aiUsageLog: schema.aiUsageLog,
    },
  });
  logger.info('AI context initialized');
}).catch(err => {
  logger.error({ err }, 'Failed to initialize Redis');
});

app.use(helmet({
  crossOriginResourcePolicy: { policy: "cross-origin" },
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'"], // Swagger UI needs inline scripts
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],  // Swagger UI + Tailwind + Google Fonts
      imgSrc: ["'self'", "data:", "blob:"],
      connectSrc: ["'self'", "ws:", "wss:", ...allowedOrigins],
      fontSrc: ["'self'", "https://fonts.gstatic.com"],
      objectSrc: ["'none'"],
      frameAncestors: ["'none'"],
      baseUri: ["'self'"],
      formAction: ["'self'"],
    },
  },
}));
app.use(cors({
  origin: (origin, callback) => {
    // !origin (undefined) is allowed for non-browser clients (curl, server-to-server).
    // origin === "null" (literal string) comes from sandboxed iframes / file:// pages — reject in production.
    if (origin === 'null' && process.env.NODE_ENV === 'production') {
      callback(new Error('Not allowed by CORS'));
    } else if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
}));
app.use(express.json());
app.use(cookieParser());

const globalLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: (process.env.NODE_ENV === 'test' || config.DISABLE_RATE_LIMIT) ? 999999 : 100,
  message: { error: 'Too many requests, please try again later.' }
});
app.use('/api', globalLimiter);

/**
 * Auth rate limiter — 5 req/min per IP across /api/v1/auth and /api/v1/auth/sso.
 *
 * Redis-backed when REDIS_URL is configured so a horizontally scaled deployment
 * (N instances) shares a single counter — otherwise each instance would enforce
 * its own 5/min window, giving an attacker 5×N attempts. Falls back to an
 * in-memory limiter at request time when the Redis client is not yet connected
 * (startup race) or has disconnected, so auth remains rate-limited during Redis
 * outages — still imperfect across instances but better than nothing, and
 * account lockout at the DB layer backstops brute force.
 */
const authLimiterBaseOpts = {
  windowMs: 60 * 1000,
  max: (process.env.NODE_ENV === 'test' || config.DISABLE_RATE_LIMIT) ? 999999 : 5,
  message: { error: 'Too many authentication attempts, please try again later.' },
  skip: (req: Request) => req.path === '/refresh',
};

const inMemoryAuthLimiter = rateLimit(authLimiterBaseOpts);

const redisBackedAuthLimiter = config.REDIS_URL
  ? rateLimit({
      ...authLimiterBaseOpts,
      store: new RedisStore({
        prefix: 'rl:auth:',
        sendCommand: (async (...args: string[]) => {
          const { pubClient } = getRedisClients();
          if (!pubClient) throw new Error('Redis client not initialized');
          return pubClient.sendCommand(args);
        }) as unknown as (...args: string[]) => Promise<string | number | string[] | number[]>,
      }),
    })
  : null;

export const authLimiter = (req: Request, res: Response, next: NextFunction): void => {
  if (redisBackedAuthLimiter) {
    const { pubClient } = getRedisClients();
    if (pubClient) {
      redisBackedAuthLimiter(req, res, next);
      return;
    }
  }
  inMemoryAuthLimiter(req, res, next);
};

const uploadLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: (process.env.NODE_ENV === 'test' || config.DISABLE_RATE_LIMIT) ? 999999 : 10,
  message: { error: 'Too many upload requests, please try again later.' }
});

const trpcLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: (process.env.NODE_ENV === 'test' || config.DISABLE_RATE_LIMIT) ? 999999 : 200,
  message: { error: 'Too many requests, please try again later.' }
});


app.use((req: Request, _res: Response, next: NextFunction) => {
  // Per-request logging at info is a flood in production — Prometheus metrics
  // already cover method/path/status/duration. Keep at debug for local tracing.
  logger.debug({ method: req.method, path: req.path }, `Incoming ${req.method} request`);
  next();
});

app.use(metricsMiddleware);

// Uploads require authentication — prevents public access to uploaded files (SEC-6).
// Files are served through the storage backend (local disk or Azure Blob Storage).
app.use('/uploads', async (req: Request, res: Response) => {
  const token = req.cookies?.guichet_token;
  if (!token) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  try {
    await jwtVerify(token, new TextEncoder().encode(config.JWT_SECRET));
  } catch {
    return res.status(401).json({ error: 'Authentication required' });
  }
  // Extract and normalize filename — reject traversal attempts
  const raw = req.path.replace(/^\//, '');
  const filePath = path.posix.normalize(raw);
  if (!filePath || filePath.startsWith('..') || filePath.includes('/../') || filePath.includes('\\') || filePath.includes('\0')) {
    return res.status(400).json({ error: 'Invalid path' });
  }
  try {
    const { getStorage } = await import('./services/storage.js');
    const storage = getStorage();
    const buffer = await storage.read(filePath);
    // Infer content type from extension
    const ext = path.extname(filePath).toLowerCase();
    const mimeMap: Record<string, string> = {
      '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
      '.webp': 'image/webp', '.gif': 'image/gif', '.pdf': 'application/pdf',
      '.txt': 'text/plain', '.csv': 'text/csv',
      '.doc': 'application/msword', '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      '.xls': 'application/vnd.ms-excel', '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    };
    res.setHeader('Content-Type', mimeMap[ext] || 'application/octet-stream');
    res.setHeader('Cache-Control', 'private, max-age=3600');
    res.send(buffer);
  } catch {
    return res.status(404).json({ error: 'File not found' });
  }
});

// API v1 Routing
const v1Router = express.Router();

// API Documentation (Swagger UI) — disabled in production to save 12 MB
if (process.env.NODE_ENV !== 'production') {
  const swaggerUi = await import('swagger-ui-express');
  const { openapiSpec } = await import('./docs/openapi.js');
  v1Router.use('/docs', swaggerUi.serve, swaggerUi.setup(openapiSpec, {
    customCss: '.swagger-ui .topbar { display: none }',
    customSiteTitle: 'Guichet API Documentation',
  }));

  // Serve tRPC reference markdown as plain text
  v1Router.get('/trpc-reference', (_req: Request, res: Response) => {
    res.type('text/markdown').sendFile(path.join(__dirname, 'docs', 'trpc-reference.md'));
  });
}

v1Router.use('/tickets', ticketRoutes); // Kept for export support
v1Router.use('/uploads', uploadLimiter, uploadRoutes);

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



v1Router.get('/config', authMiddleware, async (req: AuthRequest, res: Response) => {
  const partnerId = (req.query.partnerId as string) || req.user?.partnerId;
  if (!partnerId) {
    return res.status(400).json({ error: 'Missing partnerId' });
  }
  // Tenant isolation: non-platform users can only query their own partner
  if (!req.user?.isPlatformOperator && partnerId !== req.user?.partnerId) {
    return res.status(403).json({ error: 'Not authorized for this partner' });
  }
  let businessHoursStart: string | null = null;
  let businessHoursEnd: string | null = null;
  let businessHoursTimezone = 'Europe/Brussels';
  let businessHoursSchedule: unknown = null;

  const result = await db.select({
    businessHoursSchedule: schema.partners.businessHoursSchedule,
    businessHoursStart: schema.partners.businessHoursStart,
    businessHoursEnd: schema.partners.businessHoursEnd,
    businessHoursTimezone: schema.partners.businessHoursTimezone,
  }).from(schema.partners).where(eq(schema.partners.id, partnerId)).limit(1);
  if (result.length > 0) {
    businessHoursSchedule = result[0].businessHoursSchedule ?? businessHoursSchedule;
    businessHoursStart = result[0].businessHoursStart ?? businessHoursStart;
    businessHoursEnd = result[0].businessHoursEnd ?? businessHoursEnd;
    businessHoursTimezone = result[0].businessHoursTimezone ?? businessHoursTimezone;
  }

  const businessHoursStatus = getBusinessHoursStatus({
    businessHoursSchedule: businessHoursSchedule as BusinessHoursSchedule | null,
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
  const PROBE_TIMEOUT = 3000;
  const withTimeout = <T>(p: Promise<T>, label: string): Promise<T> =>
    Promise.race([p, new Promise<never>((_, rej) => setTimeout(() => rej(new Error(`${label} timeout`)), PROBE_TIMEOUT))]);

  const [dbResult, redisResult, storageResult] = await Promise.allSettled([
    withTimeout(db.execute(sql`SELECT 1`), 'database'),
    withTimeout((async () => {
      const { getRedisClients } = await import('./utils/redis.js');
      const { pubClient } = getRedisClients();
      if (!pubClient) throw new Error('Redis not initialized');
      await pubClient.ping();
    })(), 'redis'),
    withTimeout((async () => {
      const { getStorage } = await import('./services/storage.js');
      if (!await getStorage().healthy()) throw new Error('unhealthy');
    })(), 'storage'),
  ]);

  const checks = {
    database: dbResult.status === 'fulfilled' ? 'connected' : 'disconnected',
    redis: redisResult.status === 'fulfilled' ? 'connected' : 'disconnected',
    storage: storageResult.status === 'fulfilled' ? 'connected' : 'error',
  };
  const healthy = Object.values(checks).every(v => v === 'connected');
  res.status(healthy ? 200 : 503).json({ status: healthy ? 'ok' : 'degraded', ...checks });
});

// Internal E2E Seeding Endpoint — test environments only
if (process.env.NODE_ENV === 'test') {
  v1Router.post('/seed-e2e', async (_req: Request, res: Response) => {
    try {
      const { execSync } = await import('child_process');
      execSync('npx tsx seed.ts --e2e', { stdio: 'inherit' });
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
  // Accept either X-Metrics-Token (custom) or Authorization: Bearer (Prometheus native).
  // Prometheus scrape_configs can emit Bearer natively via credentials_file; custom
  // headers aren't supported in scrape_configs, hence the dual acceptance.
  const authHeader = req.headers.authorization;
  const bearerToken = typeof authHeader === 'string' && authHeader.startsWith('Bearer ')
    ? authHeader.slice(7)
    : undefined;
  const tokenHeader = req.headers['x-metrics-token'] ?? bearerToken;

  if (config.METRICS_TOKEN) {
    // Token is configured: require it (localhost bypass stays)
    if (tokenHeader !== config.METRICS_TOKEN && !isLocal) {
      return res.status(403).json({ error: 'Forbidden' });
    }
  } else if (!isLocal) {
    // No token configured and not localhost: fail closed
    return res.status(403).json({ error: 'Forbidden: METRICS_TOKEN not configured' });
  }

  res.set('Content-Type', register.contentType);
  res.end(await register.metrics());
});


// Flush stale presence on startup — all socket IDs from the previous process
// are dead. Users re-register via socket:identify on reconnect.
flushPresenceOnStartup().catch((err) => logger.warn({ err }, '[presence] Startup flush failed (non-fatal)'));

const gdprRunner = createTaskRunner('gdpr-purge');
const tokenCleanupRunner = createTaskRunner('token-cleanup');

// GDPR purge — startup catch-up + scheduled runs
// Check if a purge is overdue by looking at the most recent audit entry age
(async () => {
  try {
    const { pool: dbPool } = await import('./db.js');
    const result = await dbPool.query('SELECT MIN(created_at) as oldest FROM audit_log');
    const rows = result.rows as { oldest: string | null }[];
    const oldest = rows?.[0]?.oldest;
    if (oldest) {
      const ageMs = Date.now() - new Date(oldest).getTime();
      const archiveThresholdMs = config.AUDIT_ARCHIVE_DELAY_DAYS * 24 * 60 * 60 * 1000;
      if (ageMs > archiveThresholdMs) {
        logger.info({ ageHours: Math.round(ageMs / 3600000) }, '[GDPR] Overdue audit entries detected — running catch-up purge');
        await gdprRunner.run(runDailyPurge);
      }
    }
  } catch (err) {
    logger.warn({ err }, '[GDPR] Startup catch-up check failed (non-fatal)');
  }
})();

// Regular schedule: initial after random delay (1-60 min jitter), then interval ± 1h
const purgeJitterMs = Math.floor(Math.random() * 60 * 60 * 1000);
setTimeout(() => {
  gdprRunner.run(runDailyPurge);
  // Subsequent runs: interval ± 1h jitter
  setInterval(() => {
    const jitter = Math.floor(Math.random() * 2 * 60 * 60 * 1000) - 60 * 60 * 1000; // ±1h
    setTimeout(() => gdprRunner.run(runDailyPurge), Math.max(0, jitter));
  }, config.PURGE_INTERVAL_MS);
}, purgeJitterMs);
logger.info({ purgeJitterMin: Math.round(purgeJitterMs / 60000) }, '[GDPR] Purge scheduled with jitter');

// Abandoned ticket reclaim — returns tickets from offline agents to the queue
let reclaimIntervalHandle: ReturnType<typeof setInterval> | null = null;
if (config.RECLAIM_TIMEOUT_MINS > 0) {
  const reclaimRunner = createTaskRunner('ticket-reclaim');
  const RECLAIM_INTERVAL_MS = 5 * 60 * 1000; // every 5 minutes
  const reclaimTask = () => reclaimRunner.run(async () => {
    const { reclaimAbandonedTickets } = await import('./services/ticketReclaim.js');
    await reclaimAbandonedTickets(io);
  });
  setTimeout(() => {
    reclaimTask();
    reclaimIntervalHandle = setInterval(reclaimTask, RECLAIM_INTERVAL_MS);
  }, Math.floor(Math.random() * 5 * 60 * 1000)); // 0-5min startup jitter
  logger.info({ timeoutMins: config.RECLAIM_TIMEOUT_MINS }, '[ticket-reclaim] Reclaim scheduled');
}

// Refresh token cleanup — runs every 6 hours to prevent unbounded table growth (SEC-7)
const TOKEN_CLEANUP_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6 hours
setTimeout(() => {
  tokenCleanupRunner.run(async () => {
    const cleaned = await cleanupExpiredTokens();
    if (cleaned > 0) logger.info({ cleaned }, '[auth] Expired refresh tokens cleaned up');
  });
  setInterval(() => {
    tokenCleanupRunner.run(async () => {
      const cleaned = await cleanupExpiredTokens();
      if (cleaned > 0) logger.info({ cleaned }, '[auth] Expired refresh tokens cleaned up');
    });
  }, TOKEN_CLEANUP_INTERVAL_MS);
}, Math.floor(Math.random() * 30 * 60 * 1000)); // 0-30min startup jitter

// Daily audit-chain verify — system-triggered run with 10-40min startup jitter
// and 24h ± 2h interval. Complements the operator-triggered verify mutation so
// a broken chain is detected even if no operator logs in.
const stopChainVerifyScheduler = scheduleDailyChainVerify();

// Daily agent status rollup — runs every hour, rolls up yesterday's data
setInterval(async () => {
  try {
    const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
    const allPartners = await db.select({ id: schema.partners.id }).from(schema.partners);
    for (const p of allPartners) {
      await rollupDay(p.id, yesterday);
    }
    logger.info({ date: yesterday }, '[statusTracking] Hourly rollup complete');
  } catch (err) {
    logger.error({ err: err instanceof Error ? err.message : String(err) }, '[statusTracking] Rollup error');
  }
}, 60 * 60 * 1000).unref();

// Global error handler — catch unhandled Express errors, prevent stack trace leaks
app.use((err: Error, _req: Request, res: Response, _next: Function) => {
  logger.error({ err: err.message, stack: err.stack }, 'Unhandled route error');
  if (!res.headersSent) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Socket.IO handlers
registerSocketHandlers(io);

setBusinessHoursIo(io);
setPresenceIo(io);

// Graceful shutdown — drain connections on SIGTERM/SIGINT (Docker stop, Ctrl+C)
let shuttingDown = false;
async function gracefulShutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ signal }, '[shutdown] Received signal, draining connections...');

  // 0. Stop scheduled tasks
  if (reclaimIntervalHandle) clearInterval(reclaimIntervalHandle);
  stopChainVerifyScheduler();

  // 1. Stop accepting new connections
  httpServer.close(() => {
    logger.info('[shutdown] HTTP server closed');
  });

  // 2. Close all Socket.io connections
  io.close(() => {
    logger.info('[shutdown] Socket.io server closed');
  });

  // 3. Close Redis clients
  try {
    const { pubClient, subClient } = getRedisClients();
    if (pubClient) await pubClient.quit();
    if (subClient) await subClient.quit();
    logger.info('[shutdown] Redis connections closed');
  } catch (err) {
    logger.warn({ err }, '[shutdown] Redis cleanup failed (non-fatal)');
  }

  // 4. Close database pool
  try {
    const { pool } = await import('./db/postgres.js');
    await pool.end();
    logger.info('[shutdown] Database pool closed');
  } catch (err) {
    logger.warn({ err }, '[shutdown] Database cleanup failed (non-fatal)');
  }

  // 5. Clean exit (with safety timeout in case something hangs)
  const DRAIN_TIMEOUT_MS = 10_000;
  setTimeout(() => {
    logger.warn('[shutdown] Drain timeout reached, forcing exit');
    process.exit(1);
  }, DRAIN_TIMEOUT_MS).unref();

  logger.info('[shutdown] All connections drained, exiting cleanly');
  process.exit(0);
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// Serve built client (production / CI / test — skipped when dist doesn't exist i.e. Docker dev)
import { existsSync } from 'fs';
const clientDist = path.resolve(__dirname, '../client/dist');
if (existsSync(clientDist)) {
  app.use(express.static(clientDist));
  // SPA fallback — must come after all API routes (app.use avoids Express 5 path-to-regexp wildcard issue)
  app.use((_req: Request, res: Response) => {
    res.sendFile(path.join(clientDist, 'index.html'));
  });
}
