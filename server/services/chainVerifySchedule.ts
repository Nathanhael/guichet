/**
 * Shared chain-verify runner used by both the platform audit mutation
 * (operator-triggered) and the daily scheduler (system-triggered).
 *
 * Keeps the persisted record shape identical across both paths so the
 * Platform System Health tile and verify-history panel don't have to
 * branch on caller identity.
 */

import { db } from '../db.js';
import { auditLog, systemSettings } from '../db/schema.js';
import { eq } from 'drizzle-orm';
import logger from '../utils/logger.js';
import { auditChainVerifyFailures } from '../utils/metrics.js';
import { broadcastWebhook } from './webhookDispatch.js';
import { verifyAuditChain } from './archive.js';

export const LAST_VERIFY_KEY = 'audit_chain_last_verify';
export const VERIFY_HISTORY_KEY = 'audit_chain_verify_history';
const VERIFY_HISTORY_MAX = 50;

// Synthetic actor written to ranBy when the daily scheduler runs the verify.
// Keeping a stable, recognisable id (rather than null) lets operators filter
// audit rows by `actorId=system-scheduler` to see which failures came from
// automation vs manual runs.
export const SCHEDULER_ACTOR_ID = 'system-scheduler';
export const SCHEDULER_ACTOR_NAME = 'Daily scheduler';

export interface RunnerActor {
  id: string;
  name: string | null;
}

export interface ChainVerifyRecord {
  ranAt: string;
  ranBy: string;
  ranByName: string | null;
  valid: boolean;
  checked: number;
  brokenAt: string | null;
  error: string | null;
}

/**
 * Execute a chain verify and persist the outcome. Writes go to the same
 * system_settings keys as the manual operator path, so UIs showing "last
 * verified" pick up scheduler runs automatically.
 *
 * On failure, mirrors the manual path's side-effects: a metric increment,
 * an audit row (system.chain_broken_detected or system.chain_verify_error),
 * and — for critical tampers only — a cross-tenant webhook broadcast.
 */
export async function runChainVerify(actor: RunnerActor): Promise<ChainVerifyRecord> {
  const result = await verifyAuditChain();
  const record: ChainVerifyRecord = {
    ranAt: new Date().toISOString(),
    ranBy: actor.id,
    ranByName: actor.name,
    valid: result.valid,
    checked: result.checked,
    brokenAt: result.brokenAt ?? null,
    error: result.error ?? null,
  };

  // Persist latest run + rolling history. Read-modify-write on history is
  // fine: the manual path is rate-limited and the scheduler runs at most
  // once per day, so contention is effectively zero.
  await db
    .insert(systemSettings)
    .values({ key: LAST_VERIFY_KEY, value: record })
    .onConflictDoUpdate({
      target: systemSettings.key,
      set: { value: record, updatedAt: new Date().toISOString() },
    });

  const historyRows = await db
    .select({ value: systemSettings.value })
    .from(systemSettings)
    .where(eq(systemSettings.key, VERIFY_HISTORY_KEY))
    .limit(1);
  const existingHistory = Array.isArray(historyRows[0]?.value) ? (historyRows[0]!.value as unknown[]) : [];
  const nextHistory = [record, ...existingHistory].slice(0, VERIFY_HISTORY_MAX);
  await db
    .insert(systemSettings)
    .values({ key: VERIFY_HISTORY_KEY, value: nextHistory })
    .onConflictDoUpdate({
      target: systemSettings.key,
      set: { value: nextHistory, updatedAt: new Date().toISOString() },
    });

  if (!result.valid) {
    const severity: 'warn' | 'critical' = result.error ? 'warn' : 'critical';
    auditChainVerifyFailures.inc({ severity });
    await db.insert(auditLog).values({
      action: result.error ? 'system.chain_verify_error' : 'system.chain_broken_detected',
      actorId: actor.id,
      targetType: 'system',
      targetId: result.brokenAt ?? null,
      metadata: {
        checked: result.checked,
        brokenAt: result.brokenAt ?? null,
        error: result.error ?? null,
        severity,
        scheduled: actor.id === SCHEDULER_ACTOR_ID,
      },
    });
    if (severity === 'critical') {
      broadcastWebhook('audit.chain_broken', {
        checked: result.checked,
        brokenAt: result.brokenAt ?? null,
        ranAt: record.ranAt,
        ranBy: record.ranBy,
        ranByName: record.ranByName,
      });
    }
  }

  return record;
}

/**
 * Called from app.ts at boot. Runs the verify once on startup (catch-up)
 * and then every 24h ± 2h jitter. The jitter spreads scheduler runs across
 * the cluster so multiple replicas don't dog-pile the archive read.
 *
 * Unhandled failures are logged but never thrown — a broken scheduler tick
 * must not crash the server.
 */
export function scheduleDailyChainVerify(): () => void {
  const DAY_MS = 24 * 60 * 60 * 1000;
  const JITTER_MS = 2 * 60 * 60 * 1000;

  let cancelled = false;
  let nextTimer: ReturnType<typeof setTimeout> | null = null;

  async function tick() {
    if (cancelled) return;
    try {
      const record = await runChainVerify({ id: SCHEDULER_ACTOR_ID, name: SCHEDULER_ACTOR_NAME });
      logger.info(
        { valid: record.valid, checked: record.checked, brokenAt: record.brokenAt, error: record.error },
        '[chain-verify] scheduled run complete',
      );
    } catch (err) {
      logger.error({ err: err instanceof Error ? err.message : String(err) }, '[chain-verify] scheduled run failed');
    } finally {
      if (!cancelled) {
        const jitter = Math.floor(Math.random() * 2 * JITTER_MS) - JITTER_MS;
        nextTimer = setTimeout(tick, Math.max(60_000, DAY_MS + jitter));
      }
    }
  }

  // Startup delay: 10–40 min so a fleet rollout doesn't stampede the archive.
  const startupDelay = 10 * 60 * 1000 + Math.floor(Math.random() * 30 * 60 * 1000);
  nextTimer = setTimeout(tick, startupDelay);
  logger.info({ startupDelayMin: Math.round(startupDelay / 60000) }, '[chain-verify] Daily scheduler armed');

  return () => {
    cancelled = true;
    if (nextTimer) clearTimeout(nextTimer);
  };
}
