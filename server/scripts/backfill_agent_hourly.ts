/**
 * Backfill `daily_agent_status.hourly_online_seconds` from `agent_status_log`.
 *
 * Required after migration 0016 added the column. Existing daily rollup rows
 * carry the column's default `[0]*24`, which would make every hour appear
 * uncovered in the dashboard staffing-fit zone. This script re-runs
 * `rollupDay()` for every partner across the requested window so the new
 * hourly array gets populated from the existing transition log.
 *
 * Usage (inside server container):
 *   npx tsx scripts/backfill_agent_hourly.ts            # default 35 days
 *   npx tsx scripts/backfill_agent_hourly.ts --days=90  # custom window
 *
 * Idempotent: rollupDay uses ON CONFLICT DO UPDATE keyed on
 * (date, userId, partnerId) so re-running just refreshes rows.
 */

import { db } from '../db.js';
import { agentStatusLog, dailyAgentStatus, partners } from '../db/schema.js';
import { DrizzleTransitionLog } from '../services/availability/adapters/drizzleTransitionLog.js';

function parseDays(): number {
  const arg = process.argv.find((a) => a.startsWith('--days='));
  if (!arg) return 35;
  const n = Number(arg.slice('--days='.length));
  if (!Number.isFinite(n) || n <= 0 || n > 365) {
    throw new Error(`Invalid --days value: ${arg}. Must be 1-365.`);
  }
  return Math.floor(n);
}

function dayKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

async function main() {
  const days = parseDays();
  console.log(`╔════════════════════════════════════════════════╗`);
  console.log(`║   Backfill hourly_online_seconds (${String(days).padStart(3, ' ')}d window)  ║`);
  console.log(`╚════════════════════════════════════════════════╝\n`);

  const log = new DrizzleTransitionLog({
    db,
    schema: { agentStatusLog, dailyAgentStatus },
    logger: { error: () => {}, info: () => {} },
  });

  const partnerRows = await db.select({ id: partners.id }).from(partners);
  console.log(`👥 Partners: ${partnerRows.length}`);

  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);

  let totalRows = 0;
  for (const p of partnerRows) {
    let perPartner = 0;
    for (let i = days - 1; i >= 0; i--) {
      const day = new Date(today.getTime() - i * 86_400_000);
      const dateStr = dayKey(day);
      const { rowsWritten } = await log.rollupDay(p.id, dateStr);
      perPartner += rowsWritten;
    }
    console.log(`   ${p.id}: ${perPartner} rollup rows`);
    totalRows += perPartner;
  }

  console.log(`\n✅ Backfill complete. ${totalRows} (partner × user × day) rows touched across ${partnerRows.length} partners.`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('\n❌ Fatal:', err);
    process.exit(1);
  });
