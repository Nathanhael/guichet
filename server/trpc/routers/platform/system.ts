import { router, platformProcedure } from '../../trpc.js';
import { db } from '../../../db.js';
import { auditLog } from '../../../db/schema.js';
import { eq, desc, sql } from 'drizzle-orm';
import { getRedisClients } from '../../../utils/redis.js';
import logger from '../../../utils/logger.js';

export const platformSystemRouter = router({
  getSystemHealth: platformProcedure.query(async () => {
    let lastPurgeAt: string | null = null;
    let gdprSuccess = false;

    try {
      const lastPurge = await db.select({ createdAt: auditLog.createdAt })
        .from(auditLog)
        .where(eq(auditLog.action, 'system.gdpr_purge'))
        .orderBy(desc(auditLog.createdAt))
        .limit(1);
      lastPurgeAt = lastPurge[0]?.createdAt || null;
      gdprSuccess = !!lastPurge[0];
    } catch (err) {
      logger.error({ err }, 'Health Check: Audit Log error');
    }

    const health = {
      postgres: false,
      redis: false,
      postgresConnections: 0,
      redisMemoryUsed: '0',
      gdprLastRun: lastPurgeAt || 'Never',
      gdprSuccess,
      gdprRecordsPurged: 0,
      gdprNextPurge: (() => {
        const next = new Date();
        next.setUTCDate(next.getUTCDate() + 1);
        next.setUTCHours(2, 0, 0, 0);
        return next.toISOString();
      })(),
    };

    try {
      const pgRes = await db.execute(sql`SELECT count(*) FROM pg_stat_activity`);
      health.postgres = true;
      health.postgresConnections = parseInt(String(pgRes.rows[0].count), 10);
    } catch (err) {
      logger.error({ err }, 'Health Check: Postgres error');
    }

    try {
      const { pubClient } = getRedisClients();
      if (pubClient) {
        await Promise.race([
          pubClient.ping(),
          new Promise((_, reject) => setTimeout(() => reject(new Error('Redis ping timeout')), 2000))
        ]);

        health.redis = true;
        const memoryInfo = await pubClient.info('memory');
        const match = memoryInfo.match(/used_memory_human:([^\r\n]+)/);
        if (match) {
          health.redisMemoryUsed = match[1];
        }
      }
    } catch (err) {
      logger.error({ err }, 'Health Check: Redis error');
    }

    return health;
  }),

});
