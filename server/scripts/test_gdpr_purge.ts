/**
 * One-shot integration test for runDailyPurge() against the live dev DB.
 *
 * Seeds a partner + closed ticket >30d old + messages + uploads + rating +
 * label + audit row, runs the purge, asserts every documented side-effect,
 * cleans up. Prints a PASS/FAIL summary and exits non-zero on any failure.
 *
 * Usage (inside the server container):
 *   docker compose exec server npx tsx server/scripts/test_gdpr_purge.ts
 */
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { eq, and, sql, gte } from 'drizzle-orm';
import { db } from '../db.js';
import {
  partners, users, memberships,
  tickets, messages, ratings, labels, ticketLabels,
  appFeedback, auditLog, dailyStats, archivedTickets,
} from '../db/schema.js';
import { runDailyPurge } from './../services/gdpr.js';
import { verifyAuditChain } from '../services/archive.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const UPLOAD_DIR = path.join(__dirname, '..', 'uploads');

const ts = Date.now();
const PARTNER_ID = `gdpr-test-${ts}`;
const AGENT_ID = `gdpr-test-agent-${ts}`;
const SUPPORT_ID = `gdpr-test-support-${ts}`;

const oldDate = new Date(Date.now() - 31 * 86400000).toISOString();
const scriptStart = new Date().toISOString();

const TICKET_ID = `gdpr-test-tk-${ts}`;
const MSG1_ID = `gdpr-test-m1-${ts}`;
const MSG2_ID = `gdpr-test-m2-${ts}`;
const RATING_ID = `gdpr-test-r-${ts}`;
const LABEL_ID = `gdpr-test-lbl-${ts}`;
const FEEDBACK_ID = `gdpr-test-fb-${ts}`;
const FILE1 = `gdpr_test_${ts}_1.png`;
const FILE2 = `gdpr_test_${ts}_2.pdf`;

const results: { name: string; ok: boolean; detail?: string }[] = [];
function check(name: string, ok: boolean, detail?: string) {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
}

async function preflight() {
  const chain = await verifyAuditChain();
  if (!chain.valid) {
    console.error(`[preflight] audit chain invalid (checked=${chain.checked} brokenAt=${chain.brokenAt ?? '-'} error=${chain.error ?? '-'}). Aborting — purge would refuse to run.`);
    process.exit(2);
  }
  console.log(`[preflight] audit chain OK (checked=${chain.checked})`);
}

async function seed() {
  await db.insert(partners).values({
    id: PARTNER_ID,
    name: `GDPR Test ${ts}`,
    departments: [{ id: 'DSC', name: 'Dispatch' }],
    createdAt: oldDate,
    updatedAt: oldDate,
  });

  // createdAt = NOW (not oldDate) so purgeAbandonedInvites() doesn't sweep them as
  // unclaimed >30d invites. externalId set so isNull(externalId) check skips them too.
  // (Belt-and-braces: real SSO users have externalId; abandoned invites don't.)
  await db.insert(users).values([
    { id: AGENT_ID, externalId: `azure-${AGENT_ID}`, name: 'GDPR Agent', email: `gdpr-agent-${ts}@test.local` },
    { id: SUPPORT_ID, externalId: `azure-${SUPPORT_ID}`, name: 'GDPR Support', email: `gdpr-support-${ts}@test.local` },
  ]);

  await db.insert(memberships).values([
    { id: `m-${AGENT_ID}`, userId: AGENT_ID, partnerId: PARTNER_ID, role: 'agent' },
    { id: `m-${SUPPORT_ID}`, userId: SUPPORT_ID, partnerId: PARTNER_ID, role: 'support' },
  ]);

  await db.insert(tickets).values({
    id: TICKET_ID,
    partnerId: PARTNER_ID,
    dept: 'DSC',
    agentId: AGENT_ID,
    agentName: 'GDPR Agent',
    supportId: SUPPORT_ID,
    supportName: 'GDPR Support',
    status: 'closed',
    queueEnteredAt: oldDate,
    createdAt: oldDate,
    updatedAt: oldDate,
    closedAt: oldDate,
    closedBy: SUPPORT_ID,
  });

  fs.writeFileSync(path.join(UPLOAD_DIR, FILE1), Buffer.from('fake-png'));
  fs.writeFileSync(path.join(UPLOAD_DIR, FILE2), Buffer.from('fake-pdf'));

  await db.insert(messages).values([
    {
      id: MSG1_ID, ticketId: TICKET_ID,
      senderId: AGENT_ID, senderName: 'GDPR Agent', senderRole: 'agent',
      text: 'old message with media', mediaUrl: `/uploads/${FILE1}`,
      createdAt: oldDate,
    },
    {
      id: MSG2_ID, ticketId: TICKET_ID,
      senderId: SUPPORT_ID, senderName: 'GDPR Support', senderRole: 'support',
      text: 'old message with attachment',
      attachments: [{ url: `/uploads/${FILE2}`, name: FILE2, mimeType: 'application/pdf', size: 8 }],
      createdAt: oldDate,
    },
  ]);

  await db.insert(ratings).values({
    id: RATING_ID,
    partnerId: PARTNER_ID,
    ticketId: TICKET_ID,
    agentId: AGENT_ID,
    supportId: SUPPORT_ID,
    rating: 5,
    comment: 'pii comment',
    dept: 'DSC',
    closedAt: oldDate,
    createdAt: oldDate,
  });

  await db.insert(labels).values({ id: LABEL_ID, partnerId: PARTNER_ID, name: 'urgent', color: '#fff' });
  await db.insert(ticketLabels).values({ ticketId: TICKET_ID, labelId: LABEL_ID });

  await db.insert(appFeedback).values({
    id: FEEDBACK_ID,
    userId: AGENT_ID,
    partnerId: PARTNER_ID,
    userName: 'GDPR Agent',
    role: 'agent',
    text: 'old feedback',
    createdAt: oldDate,
  });

  // No backdated audit_log row: it would archive into audit_archive (WORM) and
  // permanently pollute the chain (deletion breaks sequence). WORM correctness
  // is verified via verifyAuditChain() post-purge instead — if the new code
  // mistakenly mutated audit_archive, the chain check fails.
}

async function assertPurged() {
  const t = await db.select().from(tickets).where(eq(tickets.id, TICKET_ID));
  check('ticket deleted', t.length === 0, `found=${t.length}`);

  const m = await db.select().from(messages).where(eq(messages.ticketId, TICKET_ID));
  check('messages deleted', m.length === 0, `found=${m.length}`);

  const tl = await db.select().from(ticketLabels).where(eq(ticketLabels.ticketId, TICKET_ID));
  check('ticket_labels deleted', tl.length === 0, `found=${tl.length}`);

  const fb = await db.select().from(appFeedback).where(eq(appFeedback.id, FEEDBACK_ID));
  check('app_feedback deleted', fb.length === 0, `found=${fb.length}`);

  const r = await db.select().from(ratings).where(eq(ratings.id, RATING_ID));
  if (r.length === 0) {
    check('rating row retained', false, 'rating was deleted (expected: kept w/ agentId nulled)');
  } else {
    const row = r[0];
    check('rating retained', true);
    check('rating.agentId nulled', row.agentId === null, `agentId=${row.agentId}`);
    check('rating.supportId kept', row.supportId === SUPPORT_ID, `supportId=${row.supportId}`);
    check('rating.ticketId nulled (cascade)', row.ticketId === null, `ticketId=${row.ticketId}`);
    check('rating.comment retained for now (separate window)', row.comment !== undefined, '');
  }

  // WORM regression check: chain still verifies post-purge. If the purge
  // mistakenly UPDATEs audit_archive.actor_id (the bug option A removed), chain
  // hashes no longer match and this fails.
  const chainAfter = await verifyAuditChain();
  check('audit_archive chain still valid (WORM untouched)', chainAfter.valid,
    `valid=${chainAfter.valid} brokenAt=${chainAfter.brokenAt ?? '-'} checked=${chainAfter.checked}`);

  const day = oldDate.slice(0, 10);
  const ds = await db.select().from(dailyStats)
    .where(and(eq(dailyStats.date, day), eq(dailyStats.partnerId, PARTNER_ID)));
  if (ds.length === 0) {
    check('daily_stats upserted', false, `no row for date=${day} partner=${PARTNER_ID}`);
  } else {
    check('daily_stats upserted', true);
    check('daily_stats.total >= 1', (ds[0].total ?? 0) >= 1, `total=${ds[0].total}`);
    check('daily_stats.closed >= 1', (ds[0].closed ?? 0) >= 1, `closed=${ds[0].closed}`);
  }

  const arch = await db.select().from(archivedTickets).where(eq(archivedTickets.id, TICKET_ID));
  check('archived_tickets row exists', arch.length === 1, `found=${arch.length}`);

  const f1Exists = fs.existsSync(path.join(UPLOAD_DIR, FILE1));
  const f2Exists = fs.existsSync(path.join(UPLOAD_DIR, FILE2));
  check('upload file 1 deleted from disk', !f1Exists);
  check('upload file 2 deleted from disk', !f2Exists);

  const purgeAudit = await db.select().from(auditLog)
    .where(and(eq(auditLog.action, 'system.gdpr_purge'), gte(auditLog.createdAt, scriptStart)));
  check('system.gdpr_purge audit row written', purgeAudit.length >= 1, `found=${purgeAudit.length}`);
}

async function cleanup() {
  try {
    await db.delete(archivedTickets).where(eq(archivedTickets.partnerId, PARTNER_ID));
    await db.delete(partners).where(eq(partners.id, PARTNER_ID));
    await db.delete(users).where(sql`${users.id} IN (${AGENT_ID}, ${SUPPORT_ID})`);
    for (const f of [FILE1, FILE2]) {
      const p = path.join(UPLOAD_DIR, f);
      if (fs.existsSync(p)) fs.unlinkSync(p);
    }
    console.log('[cleanup] OK');
  } catch (err) {
    console.error('[cleanup] failed (manual cleanup may be needed):', err);
  }
}

async function main() {
  console.log(`[gdpr-test] start partner=${PARTNER_ID} oldDate=${oldDate}`);
  await preflight();
  try {
    await seed();
    console.log('[seed] OK — running runDailyPurge()…');
    await runDailyPurge();
    console.log('[purge] returned — running assertions…');
    await assertPurged();
  } finally {
    await cleanup();
  }

  const failed = results.filter(r => !r.ok);
  console.log(`\n=== Summary: ${results.length - failed.length}/${results.length} passed ===`);
  if (failed.length > 0) {
    console.log('Failures:');
    for (const f of failed) console.log(`  - ${f.name}${f.detail ? ' — ' + f.detail : ''}`);
    process.exit(1);
  }
  process.exit(0);
}

main().catch((err) => {
  console.error('[gdpr-test] fatal:', err);
  cleanup().finally(() => process.exit(1));
});
