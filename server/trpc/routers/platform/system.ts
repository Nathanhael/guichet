import { router, platformProcedure } from '../../trpc.js';
import { db } from '../../../db.js';
import { auditLog, slaBreaches, systemSettings } from '../../../db/schema.js';
import { eq, desc, sql, gte } from 'drizzle-orm';
import { getRedisClients } from '../../../utils/redis.js';
import { LAST_VERIFY_KEY } from '../../../services/chainVerifySchedule.js';
import logger from '../../../utils/logger.js';

const SLA_BURST_THRESHOLD = 5; // breaches per hour
const CHAIN_STALENESS_MS = 25 * 60 * 60 * 1000;

interface ChainVerifyRecord {
  ranAt?: string;
  valid?: boolean;
  error?: string | null;
}

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
      // Audit-chain integrity flags — read from system_settings JSONB written by
      // chainVerifySchedule. Drives top-level alert chips on the Health page.
      chainBroken: false,
      chainStale: false,
      chainLastRanAt: null as string | null,
      // SLA breach burst — counts breaches written in the last hour across all
      // partners. Threshold-based so a single late ticket doesn't fire.
      slaBreachBurst: 0,
      slaBreachBurstThreshold: SLA_BURST_THRESHOLD,
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

    try {
      const rows = await db
        .select({ value: systemSettings.value })
        .from(systemSettings)
        .where(eq(systemSettings.key, LAST_VERIFY_KEY))
        .limit(1);
      const record = rows[0]?.value as ChainVerifyRecord | null | undefined;
      if (record?.ranAt) {
        health.chainLastRanAt = record.ranAt;
        health.chainBroken = record.valid === false && !record.error;
        health.chainStale = Date.now() - new Date(record.ranAt).getTime() > CHAIN_STALENESS_MS;
      } else {
        // No verify ever → treat as stale so the operator schedules one.
        health.chainStale = true;
      }
    } catch (err) {
      logger.error({ err }, 'Health Check: chain-verify read error');
    }

    try {
      const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
      const burst = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(slaBreaches)
        .where(gte(slaBreaches.breachedAt, oneHourAgo));
      health.slaBreachBurst = Number(burst[0]?.count ?? 0);
    } catch (err) {
      logger.error({ err }, 'Health Check: sla-breach burst read error');
    }

    return health;
  }),
});
