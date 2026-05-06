/**
 * Repair tickets stuck in `closed` status without a `closed_at` timestamp.
 *
 * E2E specs that close tickets via socket events sometimes drop the
 * `closed_at` write — the ticket lands in the archive with a hole in the
 * Closed / Duration columns. Backfill `closed_at = updated_at` (best-effort
 * proxy: `updated_at` bumps every status transition, so it's the latest
 * touchpoint we can reliably recover).
 *
 * Idempotent: only touches rows where status='closed' AND closed_at IS NULL.
 *
 * Usage (inside server container):
 *   npx tsx scripts/cleanup_e2e_orphans.ts             # all partners
 *   npx tsx scripts/cleanup_e2e_orphans.ts --partner=acme
 */

import { and, eq, isNull, sql } from 'drizzle-orm';
import { db } from '../db.js';
import { tickets } from '../db/schema.js';

function parsePartner(): string | undefined {
  const arg = process.argv.find((a) => a.startsWith('--partner='));
  return arg?.slice('--partner='.length);
}

async function main() {
  const partner = parsePartner();
  console.log(`╔════════════════════════════════════════════════╗`);
  console.log(`║   Orphan-ticket repair — backfill closed_at    ║`);
  console.log(`╚════════════════════════════════════════════════╝\n`);
  if (partner) console.log(`Scope: partner=${partner}`);
  else console.log(`Scope: all partners`);

  const baseConditions = [
    eq(tickets.status, 'closed'),
    isNull(tickets.closedAt),
  ];
  if (partner) baseConditions.push(eq(tickets.partnerId, partner));

  const before = await db
    .select({ id: tickets.id, partnerId: tickets.partnerId, agentName: tickets.agentName })
    .from(tickets)
    .where(and(...baseConditions));

  console.log(`Found ${before.length} closed-without-close-timestamp ticket(s).`);
  if (before.length === 0) {
    console.log('Nothing to do.');
    return;
  }

  const result = await db
    .update(tickets)
    .set({ closedAt: sql`updated_at` })
    .where(and(...baseConditions))
    .returning({ id: tickets.id });

  console.log(`✅ Backfilled ${result.length} ticket(s).`);
  console.log('   Sample:', before.slice(0, 3).map((t) => `${t.partnerId}/${t.id}`).join(', '));
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('\n❌ Fatal:', err);
    process.exit(1);
  });
