/**
 * Dashboard fixture seeder — additive, idempotent.
 *
 * Lays down ~35 days of closed tickets, ratings, SLA breaches, daily_stats
 * rollups, daily_agent_status rows, and app_feedback so every admin dashboard
 * zone (Z2 scorecard, Z3 staffing fit, Z4 trends, Z5 dept+staff breakdown)
 * has data to render. Also flips on per-dept SLA on the partner so the
 * scorecard's SLA card can paint green/amber/red instead of "no data".
 *
 * Safe to run on top of `npx tsx seed.ts` — uses deterministic IDs +
 * onConflictDoNothing/onConflictDoUpdate so a second run is a no-op.
 *
 * Usage (inside server container):
 *   npx tsx scripts/seed_dashboard_data.ts
 */

import { and, eq, inArray } from 'drizzle-orm';
import { db } from '../db.js';
import * as schema from '../db/schema.js';

const PARTNER_ID = 'acme';
const DAYS = 35;
const TICKETS_PER_WEEKDAY = 12;
const TICKETS_PER_WEEKEND_DAY = 4;

interface DeptCfg {
  id: string;
  name?: string;
  description?: string;
  referenceFields?: unknown;
  sla: { enabled: true; firstResponseMinutes: number };
}

const DEPT_SLA: Record<string, number> = {
  DSC: 30,
  FOT: 60,
  TEC: 120,
};

// Deterministic PRNG so repeat runs produce the same fixture data.
function mulberry32(seed: number) {
  let t = seed >>> 0;
  return () => {
    t = (t + 0x6d2b79f5) >>> 0;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(0xace1234);
const pick = <T>(arr: T[]): T => arr[Math.floor(rand() * arr.length)];
const rng = (min: number, max: number) => min + rand() * (max - min);
const rngi = (min: number, max: number) => Math.floor(rng(min, max + 1));

function dayKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function startOfUtcDay(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

async function ensureSlaConfig(): Promise<DeptCfg[]> {
  const rows = await db
    .select({ departments: schema.partners.departments })
    .from(schema.partners)
    .where(eq(schema.partners.id, PARTNER_ID))
    .limit(1);
  if (rows.length === 0) {
    throw new Error(`Partner '${PARTNER_ID}' not found — run seed.ts first.`);
  }
  const existing = (rows[0].departments as Array<DeptCfg & { sla?: DeptCfg['sla'] }> | null) ?? [];
  const merged: DeptCfg[] = existing.map((d) => ({
    ...d,
    sla: { enabled: true, firstResponseMinutes: DEPT_SLA[d.id] ?? 60 },
  }));
  await db
    .update(schema.partners)
    .set({ departments: merged, updatedAt: new Date().toISOString() })
    .where(eq(schema.partners.id, PARTNER_ID));
  return merged;
}

interface RoleUsers {
  agents: Array<{ id: string; name: string; lang: string }>;
  supports: Array<{ id: string; name: string; lang: string; departments: string[] }>;
}

async function loadUsers(): Promise<RoleUsers> {
  const rows = await db
    .select({
      id: schema.users.id,
      name: schema.users.name,
      lang: schema.users.lang,
      role: schema.memberships.role,
      departments: schema.memberships.departments,
    })
    .from(schema.memberships)
    .innerJoin(schema.users, eq(schema.users.id, schema.memberships.userId))
    .where(
      and(
        eq(schema.memberships.partnerId, PARTNER_ID),
        inArray(schema.memberships.role, ['agent', 'support']),
      ),
    );

  const agents: RoleUsers['agents'] = [];
  const supports: RoleUsers['supports'] = [];
  for (const r of rows) {
    if (r.role === 'agent') {
      agents.push({ id: r.id, name: r.name, lang: r.lang ?? 'en' });
    } else if (r.role === 'support') {
      supports.push({
        id: r.id,
        name: r.name,
        lang: r.lang ?? 'en',
        departments: ((r.departments as string[] | null) ?? []),
      });
    }
  }
  if (agents.length === 0 || supports.length === 0) {
    throw new Error('No agents or supports found for partner — run seed.ts first.');
  }
  return { agents, supports };
}

function pickSupportForDept(supports: RoleUsers['supports'], dept: string) {
  const candidates = supports.filter((s) => s.departments.includes(dept));
  return candidates.length > 0 ? pick(candidates) : pick(supports);
}

interface GeneratedTicket {
  id: string;
  partnerId: string;
  dept: string;
  agentId: string;
  agentName: string;
  agentLang: string;
  status: 'closed';
  supportId: string;
  supportName: string;
  supportLang: string;
  supportJoinedAt: string;
  firstStaffResponseAt: string;
  responseMinutes: number;
  queueEnteredAt: string;
  createdAt: string;
  updatedAt: string;
  closedAt: string;
  closedBy: string;
  closingNotes: string;
}

const CLOSING_NOTES = [
  'Resolved — issue identified and fixed.',
  'Customer confirmed working.',
  'Workaround applied; followup KB article filed.',
  'Routed to correct dept; closed here.',
  'Configuration corrected.',
  'No further action required.',
];

function generateTicketsForDay(
  day: Date,
  dayIdx: number,
  depts: DeptCfg[],
  users: RoleUsers,
): GeneratedTicket[] {
  const dow = day.getUTCDay();
  const isWeekend = dow === 0 || dow === 6;
  const target = isWeekend ? TICKETS_PER_WEEKEND_DAY : TICKETS_PER_WEEKDAY;
  const count = Math.max(1, target + rngi(-2, 2));

  const out: GeneratedTicket[] = [];
  for (let i = 0; i < count; i++) {
    const dept = pick(depts).id;
    const slaMin = DEPT_SLA[dept] ?? 60;
    const agent = pick(users.agents);
    const support = pickSupportForDept(users.supports, dept);

    // Stagger arrivals through the working day with a bell-curve skew toward 9–17h.
    const hour = Math.min(23, Math.max(0, Math.floor(rng(7, 19))));
    const minute = rngi(0, 59);
    const createdAt = new Date(day);
    createdAt.setUTCHours(hour, minute, rngi(0, 59), 0);

    // Most tickets meet SLA; a tail breach. Tilts mean above SLA so band
    // lands in green on average.
    const breach = rand() < 0.15;
    const responseMinutes = breach
      ? slaMin + rng(5, 90)
      : Math.max(1, slaMin * rng(0.1, 0.85));
    const firstStaffResponseAt = new Date(createdAt.getTime() + responseMinutes * 60_000);

    // Close 15min–6h after first response.
    const closedAt = new Date(firstStaffResponseAt.getTime() + rng(15, 360) * 60_000);

    out.push({
      id: `seed_dash_t_${dayIdx}_${i}`,
      partnerId: PARTNER_ID,
      dept,
      agentId: agent.id,
      agentName: agent.name,
      agentLang: agent.lang,
      status: 'closed',
      supportId: support.id,
      supportName: support.name,
      supportLang: support.lang,
      supportJoinedAt: createdAt.toISOString(),
      firstStaffResponseAt: firstStaffResponseAt.toISOString(),
      responseMinutes,
      queueEnteredAt: createdAt.toISOString(),
      createdAt: createdAt.toISOString(),
      updatedAt: closedAt.toISOString(),
      closedAt: closedAt.toISOString(),
      closedBy: support.id,
      closingNotes: pick(CLOSING_NOTES),
    });
  }
  return out;
}

async function insertTickets(tickets: GeneratedTicket[]): Promise<void> {
  if (tickets.length === 0) return;
  const rows = tickets.map((t) => ({
    id: t.id,
    partnerId: t.partnerId,
    dept: t.dept,
    agentId: t.agentId,
    agentName: t.agentName,
    agentLang: t.agentLang,
    status: t.status,
    supportId: t.supportId,
    supportName: t.supportName,
    supportLang: t.supportLang,
    supportJoinedAt: t.supportJoinedAt,
    firstStaffResponseAt: t.firstStaffResponseAt,
    queueEnteredAt: t.queueEnteredAt,
    createdAt: t.createdAt,
    updatedAt: t.updatedAt,
    closedAt: t.closedAt,
    closingNotes: t.closingNotes,
    closedBy: t.closedBy,
  }));
  // Chunk to keep the parameter count under Postgres' 65k limit.
  const CHUNK = 200;
  for (let i = 0; i < rows.length; i += CHUNK) {
    await db.insert(schema.tickets).values(rows.slice(i, i + CHUNK)).onConflictDoNothing();
  }
}

async function insertRatings(tickets: GeneratedTicket[]): Promise<void> {
  const ratings: Array<typeof schema.ratings.$inferInsert> = [];
  for (const t of tickets) {
    if (rand() > 0.7) continue; // ~70% of closed tickets get rated
    // Rating skews high but has variance; bad responses (breaches) skew lower.
    const breach = t.responseMinutes > (DEPT_SLA[t.dept] ?? 60);
    const r = breach
      ? pick([2, 2, 3, 3, 3, 4, 4, 5])
      : pick([3, 4, 4, 5, 5, 5, 5, 5]);
    const createdAt = new Date(new Date(t.closedAt).getTime() + rng(5, 180) * 60_000).toISOString();
    ratings.push({
      id: `seed_dash_r_${t.id}`,
      partnerId: t.partnerId,
      ticketId: t.id,
      agentId: t.agentId,
      supportId: t.supportId,
      rating: r,
      comment: r <= 2 ? 'Slow response.' : r === 5 ? 'Quick and helpful.' : null,
      dept: t.dept,
      closedAt: t.closedAt,
      createdAt,
    });
  }
  const CHUNK = 200;
  for (let i = 0; i < ratings.length; i += CHUNK) {
    await db.insert(schema.ratings).values(ratings.slice(i, i + CHUNK)).onConflictDoNothing();
  }
}

async function insertSlaBreaches(tickets: GeneratedTicket[]): Promise<void> {
  const rows: Array<typeof schema.slaBreaches.$inferInsert> = [];
  for (const t of tickets) {
    const sla = DEPT_SLA[t.dept] ?? 60;
    if (t.responseMinutes <= sla) continue;
    rows.push({
      id: `seed_dash_b_${t.id}`,
      ticketId: t.id,
      partnerId: t.partnerId,
      dept: t.dept,
      breachedAt: new Date(new Date(t.createdAt).getTime() + sla * 60_000).toISOString(),
      thresholdMinutes: sla,
      resolvedAt: t.firstStaffResponseAt,
      resolvedReason: 'first_response',
    });
  }
  const CHUNK = 200;
  for (let i = 0; i < rows.length; i += CHUNK) {
    await db.insert(schema.slaBreaches).values(rows.slice(i, i + CHUNK)).onConflictDoNothing();
  }
}

interface DayBucket {
  date: string;
  tickets: GeneratedTicket[];
  ratings: number[];
  responseMs: number[];
  abandoned: number;
  hourly: number[];
  deptCounts: Record<string, number>;
  ratingsByDept: Record<string, { sum: number; count: number }>;
}

function buildDailyBuckets(tickets: GeneratedTicket[], ratings: { ticketId: string; rating: number; dept: string }[]): DayBucket[] {
  const map = new Map<string, DayBucket>();
  for (const t of tickets) {
    const key = t.createdAt.slice(0, 10);
    let bucket = map.get(key);
    if (!bucket) {
      bucket = {
        date: key,
        tickets: [],
        ratings: [],
        responseMs: [],
        abandoned: 0,
        hourly: Array.from({ length: 24 }, () => 0),
        deptCounts: {},
        ratingsByDept: {},
      };
      map.set(key, bucket);
    }
    bucket.tickets.push(t);
    bucket.responseMs.push(t.responseMinutes * 60_000);
    const hr = new Date(t.createdAt).getUTCHours();
    bucket.hourly[hr] = (bucket.hourly[hr] ?? 0) + 1;
    bucket.deptCounts[t.dept] = (bucket.deptCounts[t.dept] ?? 0) + 1;
  }
  const ticketIndex = new Map(tickets.map((t) => [t.id, t]));
  for (const r of ratings) {
    const t = ticketIndex.get(r.ticketId);
    if (!t) continue;
    const key = t.createdAt.slice(0, 10);
    const bucket = map.get(key);
    if (!bucket) continue;
    bucket.ratings.push(r.rating);
    const dpt = bucket.ratingsByDept[r.dept] ?? { sum: 0, count: 0 };
    dpt.sum += r.rating;
    dpt.count += 1;
    bucket.ratingsByDept[r.dept] = dpt;
  }
  return [...map.values()].sort((a, b) => a.date.localeCompare(b.date));
}

function p95(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95));
  return sorted[idx];
}

async function upsertDailyStats(buckets: DayBucket[]): Promise<void> {
  for (const b of buckets) {
    const total = b.tickets.length;
    const closed = b.tickets.filter((t) => t.status === 'closed').length;
    const responseCount = b.responseMs.length;
    const avgResponseMs = responseCount > 0
      ? Math.round(b.responseMs.reduce((s, v) => s + v, 0) / responseCount)
      : 0;
    const avgDurationMs = b.tickets.length > 0
      ? Math.round(
          b.tickets.reduce(
            (s, t) => s + (new Date(t.closedAt).getTime() - new Date(t.createdAt).getTime()),
            0,
          ) / b.tickets.length,
        )
      : 0;
    const ratingCount = b.ratings.length;
    const avgRating = ratingCount > 0 ? b.ratings.reduce((s, v) => s + v, 0) / ratingCount : null;
    const ratingsByDept: Record<string, number> = {};
    for (const [dept, agg] of Object.entries(b.ratingsByDept)) {
      ratingsByDept[dept] = agg.count > 0 ? agg.sum / agg.count : 0;
    }
    await db
      .insert(schema.dailyStats)
      .values({
        date: b.date,
        partnerId: PARTNER_ID,
        total,
        closed,
        abandoned: b.abandoned,
        avgResponseMs,
        avgDurationMs,
        avgRating,
        ratingCount,
        responseCount,
        p95ResponseMs: Math.round(p95(b.responseMs)),
        reopened: 0,
        deptCounts: b.deptCounts,
        ratingsByDept,
        hourly: b.hourly,
      })
      .onConflictDoUpdate({
        target: [schema.dailyStats.date, schema.dailyStats.partnerId],
        set: {
          total,
          closed,
          abandoned: b.abandoned,
          avgResponseMs,
          avgDurationMs,
          avgRating,
          ratingCount,
          responseCount,
          p95ResponseMs: Math.round(p95(b.responseMs)),
          reopened: 0,
          deptCounts: b.deptCounts,
          ratingsByDept,
          hourly: b.hourly,
        },
      });
  }
}

async function upsertAgentDailyStatus(buckets: DayBucket[], supports: RoleUsers['supports']): Promise<void> {
  const rows: Array<typeof schema.dailyAgentStatus.$inferInsert> = [];
  for (const b of buckets) {
    const dow = new Date(`${b.date}T00:00:00Z`).getUTCDay();
    const isWeekend = dow === 0 || dow === 6;
    for (const s of supports) {
      const onlineHours = isWeekend ? rng(0, 2) : rng(6, 8.5);
      const awayHours = isWeekend ? rng(0, 0.5) : rng(0.5, 1.5);
      rows.push({
        date: b.date,
        userId: s.id,
        partnerId: PARTNER_ID,
        onlineSeconds: Math.round(onlineHours * 3600),
        awaySeconds: Math.round(awayHours * 3600),
      });
    }
  }
  const CHUNK = 200;
  for (let i = 0; i < rows.length; i += CHUNK) {
    await db.insert(schema.dailyAgentStatus).values(rows.slice(i, i + CHUNK)).onConflictDoNothing();
  }
}

const FEEDBACK_TEXTS = [
  'Could we get a dark mode toggle?',
  'Search across closed tickets is slow with my filter set.',
  'Love the new canned response shortcuts.',
  'Crash when uploading a 25MB attachment.',
  'Customer chat translation occasionally drops the last sentence.',
  'Audit drawer is great — please add CSV export.',
  'Heatmap colors are hard to read on the projector.',
  'Mobile keyboard hides the send button on iPhone.',
  'Would like keyboard shortcut to focus the search box.',
  'Notifications stop arriving after a few hours.',
  'CSAT comment field should allow more characters.',
  'Default queue tab should be remembered across sessions.',
];

async function insertAppFeedback(users: RoleUsers, days: Date[]): Promise<void> {
  const allUsers = [...users.agents, ...users.supports];
  const rows: Array<typeof schema.appFeedback.$inferInsert> = [];
  for (let i = 0; i < FEEDBACK_TEXTS.length; i++) {
    const u = pick(allUsers);
    const dayIdx = rngi(0, days.length - 1);
    const day = days[dayIdx];
    const createdAt = new Date(day);
    createdAt.setUTCHours(rngi(8, 20), rngi(0, 59), 0, 0);
    rows.push({
      id: `seed_dash_fb_${i}`,
      userId: u.id,
      partnerId: PARTNER_ID,
      userName: u.name,
      role: users.agents.find((a) => a.id === u.id) ? 'agent' : 'support',
      text: FEEDBACK_TEXTS[i],
      treated: i % 4 === 0 ? 1 : 0, // ~25% already triaged
      createdAt: createdAt.toISOString(),
    });
  }
  await db.insert(schema.appFeedback).values(rows).onConflictDoNothing();
}

async function main() {
  console.log('╔════════════════════════════════════════════════╗');
  console.log('║   Dashboard fixture seed (additive)            ║');
  console.log('╚════════════════════════════════════════════════╝\n');

  console.log('🔧 Configuring per-dept SLA on partner...');
  const depts = await ensureSlaConfig();
  console.log(`   ${depts.map((d) => `${d.id}=${d.sla.firstResponseMinutes}m`).join(' · ')}`);

  console.log('👥 Loading partner users...');
  const users = await loadUsers();
  console.log(`   agents=${users.agents.length}  supports=${users.supports.length}`);

  console.log(`📅 Generating ${DAYS} days of tickets...`);
  const today = startOfUtcDay(new Date());
  const days: Date[] = [];
  const allTickets: GeneratedTicket[] = [];
  for (let i = DAYS - 1; i >= 0; i--) {
    const day = new Date(today.getTime() - i * 86_400_000);
    days.push(day);
    const dayIdx = DAYS - 1 - i;
    const tickets = generateTicketsForDay(day, dayIdx, depts, users);
    allTickets.push(...tickets);
  }
  console.log(`   tickets=${allTickets.length}`);

  console.log('💾 Inserting tickets...');
  await insertTickets(allTickets);

  console.log('⭐ Inserting ratings...');
  // Rebuild the same rating set deterministically so the daily-stats rollup
  // sees what hits the DB.
  const ratingsForBuckets: { ticketId: string; rating: number; dept: string }[] = [];
  // Re-walk with same RNG state? PRNG already advanced — easier path: query
  // back what we just inserted via separate deterministic generator.
  await insertRatings(allTickets);
  const ratingRows = await db
    .select({ ticketId: schema.ratings.ticketId, rating: schema.ratings.rating, dept: schema.ratings.dept })
    .from(schema.ratings)
    .where(eq(schema.ratings.partnerId, PARTNER_ID));
  for (const r of ratingRows) {
    if (r.ticketId && r.dept !== null) {
      ratingsForBuckets.push({ ticketId: r.ticketId, rating: r.rating, dept: r.dept });
    }
  }
  console.log(`   ratings=${ratingRows.length}`);

  console.log('🚨 Inserting SLA breach rows...');
  await insertSlaBreaches(allTickets);

  console.log('📊 Upserting daily_stats rollups...');
  const buckets = buildDailyBuckets(allTickets, ratingsForBuckets);
  await upsertDailyStats(buckets);

  console.log('🟢 Upserting daily_agent_status rows...');
  await upsertAgentDailyStatus(buckets, users.supports);

  console.log('💬 Inserting app_feedback entries...');
  await insertAppFeedback(users, days);

  console.log('\n✅ Dashboard fixture ready. Reload the admin dashboard.');
  console.log('   Try: 7-day, 30-day presets · per-dept filter · Trends + Heatmap zones.');
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('\n❌ Fatal:', err);
    process.exit(1);
  });
