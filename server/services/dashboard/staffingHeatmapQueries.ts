/**
 * Dashboard Z3 — Staffing heatmap query layer.
 *
 * Pulls 28 days of `daily_stats.hourly` rows for the partner plus the
 * matching `daily_agent_status` rows for the staff-count overlay (Z3b).
 * The deep service folds them into the dow×hour matrix; this layer is
 * the raw fetch + JSONB → number[] coercion.
 *
 * `daily_stats.hourly` is a JSONB column populated by the live-day rollup
 * and the GDPR purge as a 24-element array. We coerce defensively here
 * because legacy rows may have stored an object map.
 */

import { and, eq, gte, lte } from 'drizzle-orm';
import { db } from '../../db.js';
import { dailyAgentStatus, dailyStats } from '../../db/schema.js';
import type {
  AgentStatusRow,
  DailyStatsRow,
} from './staffingHeatmap.js';

export interface StaffingHeatmapData {
  dailyStats: DailyStatsRow[];
  agentStatus: AgentStatusRow[];
}

function coerceHourly(value: unknown): number[] {
  const out = Array.from({ length: 24 }, () => 0);
  if (Array.isArray(value)) {
    for (let i = 0; i < 24; i++) {
      const n = Number(value[i]);
      if (Number.isFinite(n)) out[i] = n;
    }
    return out;
  }
  if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      const idx = Number(k);
      if (Number.isInteger(idx) && idx >= 0 && idx < 24) {
        const n = Number(v);
        if (Number.isFinite(n)) out[idx] = n;
      }
    }
  }
  return out;
}

export async function fetchStaffingHeatmapData(
  partnerId: string,
  from: Date,
  to: Date,
): Promise<StaffingHeatmapData> {
  const fromDate = from.toISOString().slice(0, 10);
  const toDate = to.toISOString().slice(0, 10);

  const [statsRows, agentRows] = await Promise.all([
    db
      .select({ date: dailyStats.date, hourly: dailyStats.hourly })
      .from(dailyStats)
      .where(
        and(
          eq(dailyStats.partnerId, partnerId),
          gte(dailyStats.date, fromDate),
          lte(dailyStats.date, toDate),
        ),
      ),
    db
      .select({
        date: dailyAgentStatus.date,
        userId: dailyAgentStatus.userId,
        onlineSeconds: dailyAgentStatus.onlineSeconds,
      })
      .from(dailyAgentStatus)
      .where(
        and(
          eq(dailyAgentStatus.partnerId, partnerId),
          gte(dailyAgentStatus.date, fromDate),
          lte(dailyAgentStatus.date, toDate),
        ),
      ),
  ]);

  return {
    dailyStats: statsRows.map((r) => ({
      date: r.date,
      hourly: coerceHourly(r.hourly),
    })),
    agentStatus: agentRows.map((r) => ({
      date: r.date,
      userId: r.userId,
      onlineSeconds: r.onlineSeconds,
    })),
  };
}
