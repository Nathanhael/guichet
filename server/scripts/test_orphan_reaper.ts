/**
 * One-shot integration test for reapOrphanUploads() against whatever storage
 * backend is configured. Set AZURE_STORAGE_CONNECTION_STRING +
 * AZURE_STORAGE_CONTAINER to exercise the Azure path; otherwise hits Local.
 *
 * Seeds a partner + user + ticket + a single message that references KEEPER.
 * Uploads two blobs (KEEPER + ORPHAN) to the configured backend, runs the
 * reaper with grace=0 so both are immediately eligible, then asserts:
 *   - ORPHAN deleted (no message referencing it)
 *   - KEEPER retained (message references it)
 * Cleans up DB rows + KEEPER blob on the way out.
 *
 * Usage:
 *   docker compose exec -T -e AZURE_STORAGE_CONNECTION_STRING=... \
 *     -e AZURE_STORAGE_CONTAINER=uploads-orphan-test \
 *     server npx tsx scripts/test_orphan_reaper.ts
 */
import { eq } from 'drizzle-orm';
import { db } from '../db.js';
import {
  partners, users, memberships, tickets, messages,
} from '../db/schema.js';
import { reapOrphanUploads } from '../services/orphanReaper.js';
import { getStorage } from '../services/storage.js';

const ts = Date.now();
const PARTNER_ID = `orphan-test-${ts}`;
const USER_ID = `orphan-test-user-${ts}`;
const TICKET_ID = `orphan-test-tk-${ts}`;
const MSG_ID = `orphan-test-msg-${ts}`;
const ORPHAN = `orphan-test-${ts}-orphan.png`;
const KEEPER = `orphan-test-${ts}-keeper.png`;

// Minimal valid 1×1 PNG
const PNG = Buffer.from([
  0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A,
  0x00, 0x00, 0x00, 0x0D, 0x49, 0x48, 0x44, 0x52,
  0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
  0x08, 0x06, 0x00, 0x00, 0x00, 0x1F, 0x15, 0xC4,
  0x89, 0x00, 0x00, 0x00, 0x0D, 0x49, 0x44, 0x41,
  0x54, 0x78, 0x9C, 0x63, 0x00, 0x01, 0x00, 0x00,
  0x05, 0x00, 0x01, 0x0D, 0x0A, 0x2D, 0xB4, 0x00,
  0x00, 0x00, 0x00, 0x49, 0x45, 0x4E, 0x44, 0xAE,
  0x42, 0x60, 0x82,
]);

const results: { name: string; ok: boolean; detail?: string }[] = [];
function check(name: string, ok: boolean, detail?: string) {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
}

async function seed() {
  await db.insert(partners).values({
    id: PARTNER_ID,
    name: `Orphan Test ${ts}`,
    departments: [{ id: 'X', name: 'X' }],
  });
  await db.insert(users).values({
    id: USER_ID,
    externalId: `azure-${USER_ID}`,
    name: 'Orphan Test',
    email: `orphan-${ts}@test.local`,
  });
  await db.insert(memberships).values({
    id: `m-${USER_ID}`,
    userId: USER_ID,
    partnerId: PARTNER_ID,
    role: 'agent',
  });
  await db.insert(tickets).values({
    id: TICKET_ID,
    partnerId: PARTNER_ID,
    dept: 'X',
    agentId: USER_ID,
    agentName: 'Orphan Test',
    status: 'open',
  });
  await db.insert(messages).values({
    id: MSG_ID,
    ticketId: TICKET_ID,
    senderId: USER_ID,
    senderName: 'Orphan Test',
    senderRole: 'agent',
    text: 'keeper attached',
    mediaUrl: `/uploads/${KEEPER}`,
  });
}

async function cleanup() {
  try {
    const storage = getStorage();
    await storage.delete(KEEPER).catch(() => {});
    // ORPHAN should already be gone, but cover the FAIL path:
    await storage.delete(ORPHAN).catch(() => {});
    await db.delete(messages).where(eq(messages.id, MSG_ID));
    await db.delete(tickets).where(eq(tickets.id, TICKET_ID));
    await db.delete(memberships).where(eq(memberships.userId, USER_ID));
    await db.delete(users).where(eq(users.id, USER_ID));
    await db.delete(partners).where(eq(partners.id, PARTNER_ID));
    console.log('[cleanup] OK');
  } catch (err) {
    console.error('[cleanup] failed (manual cleanup may be needed):', err);
  }
}

async function main() {
  console.log(`[orphan-test] start partner=${PARTNER_ID}`);
  const storage = getStorage();
  try {
    await seed();
    await storage.upload(PNG, ORPHAN, 'image/png');
    await storage.upload(PNG, KEEPER, 'image/png');
    console.log(`[seed] uploaded ${ORPHAN} + ${KEEPER}`);

    // Sanity: confirm both readable before reaping
    const orphanBefore = await storage.read(ORPHAN).then(() => true).catch(() => false);
    const keeperBefore = await storage.read(KEEPER).then(() => true).catch(() => false);
    check('orphan blob exists pre-reap', orphanBefore);
    check('keeper blob exists pre-reap', keeperBefore);

    // Negative grace pushes cutoff into the future, making every existing
    // blob unambiguously past-cutoff regardless of clock skew between the
    // docker container and Azure's storage service. (graceMs=0 fails on
    // ms-level skew — Azure stamps lastModified slightly ahead of the host
    // clock, so the just-uploaded blob looks "in the future" and gets
    // misclassified as within-grace.) In production the 24h default makes
    // any plausible skew irrelevant.
    const result = await reapOrphanUploads({ graceMs: -60000 });
    console.log('[reaper] result:', JSON.stringify(result));

    const orphanGone = await storage.read(ORPHAN).then(() => false).catch(() => true);
    const keeperPresent = await storage.read(KEEPER).then(() => true).catch(() => false);
    check('orphan blob deleted by reaper', orphanGone);
    check('keeper blob retained by reaper', keeperPresent);
    check('reaper deleted >= 1', result.deleted >= 1, `deleted=${result.deleted}`);
    check('reaper referenced >= 1', result.referenced >= 1, `referenced=${result.referenced}`);
    check('reaper errors == 0', result.errors === 0, `errors=${result.errors}`);
  } finally {
    await cleanup();
  }

  const failed = results.filter((r) => !r.ok);
  console.log(`\n=== Summary: ${results.length - failed.length}/${results.length} passed ===`);
  if (failed.length > 0) {
    for (const f of failed) console.log(`  - ${f.name}${f.detail ? ' — ' + f.detail : ''}`);
    process.exit(1);
  }
  process.exit(0);
}

main().catch((err) => {
  console.error('[orphan-test] fatal:', err);
  cleanup().finally(() => process.exit(1));
});
