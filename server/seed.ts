/**
 * Tessera Database Seed Script — Minimal
 *
 * Wipes all tables and seeds a single tenant with a handful of users for
 * local development. No demo tickets, messages, labels, or partner fixtures.
 *
 * Usage:
 *   npx tsx seed.ts
 */
import { db } from './db.js';
import * as schema from './db/schema.js';
import { sql } from 'drizzle-orm';
import { hashPassword } from './utils/passwords.js';

// ─────────────────────────────────────────────────────────────────────────────
// Configuration
// ─────────────────────────────────────────────────────────────────────────────

const DEFAULT_PASSWORD = 'password123';

const PARTNER_ID = 'acme';

const DEPARTMENTS = [
  {
    id: 'DSC',
    name: 'Dispatch',
    description: 'Routing and initial triage',
    referenceFields: [
      { label: 'Order ID' },
    ],
  },
  {
    id: 'FOT',
    name: 'Front Office',
    description: 'Customer-facing support',
    referenceFields: [
      { label: 'Account Number' },
      { label: 'Customer Name' },
    ],
  },
  {
    id: 'TEC',
    name: 'Technical',
    description: 'Deep technical troubleshooting',
    referenceFields: [
      { label: 'Product / System' },
      { label: 'Error Code' },
    ],
  },
];

const BUSINESS_HOURS_SCHEDULE = {
  version: 1,
  timezone: 'Europe/Brussels',
  weekly: {
    mon: { closed: false, windows: [{ start: '00:00', end: '23:59' }] },
    tue: { closed: false, windows: [{ start: '00:00', end: '23:59' }] },
    wed: { closed: false, windows: [{ start: '00:00', end: '23:59' }] },
    thu: { closed: false, windows: [{ start: '00:00', end: '23:59' }] },
    fri: { closed: false, windows: [{ start: '00:00', end: '23:59' }] },
    sat: { closed: false, windows: [{ start: '00:00', end: '23:59' }] },
    sun: { closed: false, windows: [{ start: '00:00', end: '23:59' }] },
  },
  exceptions: [],
};

type SeedRole = 'admin' | 'support' | 'agent';
interface SeedUser {
  id: string;
  name: string;
  email: string;
  lang: string;
  role: SeedRole;
  departments: string[];
}

const LABELS: Array<{ dept: string; name: string; color: string }> = [
  { dept: 'DSC', name: 'Urgent',        color: 'rose' },
  { dept: 'DSC', name: 'Routing',       color: 'sky' },
  { dept: 'FOT', name: 'VIP',           color: 'amber' },
  { dept: 'FOT', name: 'Onboarding',    color: 'emerald' },
  { dept: 'TEC', name: 'Bug',           color: 'orange' },
  { dept: 'TEC', name: 'Investigation', color: 'purple' },
];

interface SeedTicket {
  id: string;
  dept: string;
  agentId: string;
  agentName: string;
  supportId: string | null;
  supportName: string | null;
  firstMessage: string;
}

const TICKETS: SeedTicket[] = [
  // Lucas — 2 tickets (DSC + FOT)
  {
    id: 'ticket_lucas_1',
    dept: 'DSC',
    agentId: 'agent_julie',
    agentName: 'Julie Agent',
    supportId: 'support_lucas',
    supportName: 'Lucas Support',
    firstMessage: 'I cannot reach the dispatcher for route 17 — the carrier portal keeps timing out.',
  },
  {
    id: 'ticket_lucas_2',
    dept: 'FOT',
    agentId: 'agent_kevin',
    agentName: 'Kevin Agent',
    supportId: 'support_lucas',
    supportName: 'Lucas Support',
    firstMessage: 'New VIP customer onboarding kit is missing the welcome letter template.',
  },
  // Unassigned queue tickets — one per agent (respects 1-ticket-per-agent limit).
  // Julie's assigned ticket (ticket_lucas_1) is above, so this unassigned one uses Kevin.
  // Kevin's assigned ticket (ticket_lucas_2) is above, so this unassigned one uses a
  // "walkup" agent pattern — no supportId, waiting in queue.
  {
    id: 'ticket_queue_dsc_1',
    dept: 'DSC',
    agentId: 'agent_walkup_1',
    agentName: 'Walkup Customer 1',
    supportId: null,
    supportName: null,
    firstMessage: 'Carrier ID 4421 stuck in triage for 20 minutes — please route.',
  },
  {
    id: 'ticket_queue_fot_1',
    dept: 'FOT',
    agentId: 'agent_walkup_2',
    agentName: 'Walkup Customer 2',
    supportId: null,
    supportName: null,
    firstMessage: 'Customer is asking about upgrade paths — needs a rep to call back.',
  },
  // Sophie — 2 tickets (TEC)
  {
    id: 'ticket_sophie_1',
    dept: 'TEC',
    agentId: 'agent_julie',
    agentName: 'Julie Agent',
    supportId: 'support_sophie',
    supportName: 'Sophie Support',
    firstMessage: 'Production API is returning 500 on POST /ingest since the deploy this morning.',
  },
  {
    id: 'ticket_sophie_2',
    dept: 'TEC',
    agentId: 'agent_kevin',
    agentName: 'Kevin Agent',
    supportId: 'support_sophie',
    supportName: 'Sophie Support',
    firstMessage: 'Webhook signatures fail verification intermittently — roughly 1 in 20 deliveries.',
  },
];

const PARTNER_USERS: SeedUser[] = [
  { id: 'admin_emma',     name: 'Emma Admin',     email: 'emma@acme.test',    lang: 'en', role: 'admin',   departments: [] },
  { id: 'support_lucas',  name: 'Lucas Support',  email: 'lucas@acme.test',   lang: 'en', role: 'support', departments: ['DSC', 'FOT'] },
  { id: 'support_sophie', name: 'Sophie Support', email: 'sophie@acme.test',  lang: 'en', role: 'support', departments: ['TEC'] },
  { id: 'agent_julie',    name: 'Julie Agent',    email: 'julie@acme.test',   lang: 'en', role: 'agent',   departments: [] },
  { id: 'agent_kevin',    name: 'Kevin Agent',    email: 'kevin@acme.test',   lang: 'en', role: 'agent',   departments: [] },
];

// ─────────────────────────────────────────────────────────────────────────────
// Core
// ─────────────────────────────────────────────────────────────────────────────

async function wipeDatabase() {
  console.log('🗑️  Truncating all tables...');
  await db.execute(sql`
    TRUNCATE TABLE
      webhook_logs, webhooks, ai_usage_log, daily_ai_usage, ai_prompt_templates,
      saved_views, refresh_tokens, ticket_labels, ratings, app_feedback,
      messages, tickets, archived_tickets, audit_archive, audit_log,
      daily_stats, topic_alerts, canned_responses, kb_articles,
      partner_group_mappings, labels, memberships, system_settings,
      daily_agent_status, agent_status_log, push_subscriptions,
      users, partners
    CASCADE
  `);
  // Ensure full-text search trigger exists (survives TRUNCATE but not drizzle-kit push on fresh DB)
  await db.execute(sql`
    CREATE OR REPLACE FUNCTION messages_search_vector_update() RETURNS trigger AS $$
    BEGIN
      NEW.search_vector := to_tsvector('simple', COALESCE(NEW.text, ''));
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql
  `);
  await db.execute(sql`DROP TRIGGER IF EXISTS trg_messages_search_vector ON messages`);
  await db.execute(sql`
    CREATE TRIGGER trg_messages_search_vector
      BEFORE INSERT OR UPDATE OF text ON messages
      FOR EACH ROW
      EXECUTE FUNCTION messages_search_vector_update()
  `);
}

async function seedMinimal() {
  console.log('🌱 Seeding minimal fixture...');
  const hash = await hashPassword(DEFAULT_PASSWORD);

  // Partner
  await db.insert(schema.partners).values({
    id: PARTNER_ID,
    name: 'Acme',
    industry: 'Technology',
    departments: DEPARTMENTS,
    businessHoursStart: '00:00',
    businessHoursEnd: '23:59',
    businessHoursTimezone: 'Europe/Brussels',
    businessHoursSchedule: BUSINESS_HOURS_SCHEDULE,
    authMethod: 'local',
    status: 'active',
  });

  // Platform operator
  await db.insert(schema.users).values({
    id: 'platform_bart',
    name: 'Bart Operator',
    email: 'bart@tessera.io',
    lang: 'en',
    password: hash,
    isPlatformOperator: true,
    accessibilityPrefs: {},
  });

  // Labels (2 per department, namespaced by dept id)
  for (const l of LABELS) {
    await db.insert(schema.labels).values({
      id: `label_${PARTNER_ID}_${l.dept}_${l.name.toLowerCase().replace(/\s+/g, '-')}`,
      partnerId: PARTNER_ID,
      name: `${l.dept}: ${l.name}`,
      color: l.color,
    });
  }

  // Partner users + memberships
  for (const u of PARTNER_USERS) {
    await db.insert(schema.users).values({
      id: u.id,
      name: u.name,
      email: u.email,
      lang: u.lang,
      password: hash,
      isPlatformOperator: false,
      accessibilityPrefs: {},
    });

    await db.insert(schema.memberships).values({
      id: `mem_${u.id}`,
      userId: u.id,
      partnerId: PARTNER_ID,
      role: u.role,
      departments: u.departments,
    });
  }

  // Tickets (assigned to support users) + first message per ticket
  const now = new Date().toISOString();
  for (const t of TICKETS) {
    await db.insert(schema.tickets).values({
      id: t.id,
      partnerId: PARTNER_ID,
      dept: t.dept,
      agentId: t.agentId,
      agentName: t.agentName,
      agentLang: 'en',
      references: [],
      status: t.supportId ? 'pending' : 'open',
      supportId: t.supportId,
      supportName: t.supportName,
      supportLang: t.supportId ? 'en' : null,
      supportJoinedAt: t.supportId ? now : null,
      createdAt: now,
      updatedAt: now,
    });

    await db.insert(schema.messages).values({
      id: `msg_${t.id}_1`,
      ticketId: t.id,
      senderId: t.agentId,
      senderName: t.agentName,
      senderRole: 'agent',
      senderLang: 'en',
      text: t.firstMessage,
      createdAt: now,
    });
  }

  console.log('✅ Seed complete.');
  console.log('');
  console.log('  Partner: ' + PARTNER_ID + ' (auth: local)');
  console.log('  Password for all users: ' + DEFAULT_PASSWORD);
  console.log('');
  console.log('  Platform operator:');
  console.log('    - bart@tessera.io             (platform_bart)');
  console.log('  Admin:');
  console.log('    - emma@acme.test              (admin_emma)');
  console.log('  Support:');
  console.log('    - lucas@acme.test             (support_lucas, depts: DSC, FOT)');
  console.log('    - sophie@acme.test            (support_sophie, depts: TEC)');
  console.log('  Agents:');
  console.log('    - julie@acme.test             (agent_julie)');
  console.log('    - kevin@acme.test             (agent_kevin)');
}

async function main() {
  console.log('╔══════════════════════════════════════════════════╗');
  console.log('║   Tessera Database Seed Utility (minimal)        ║');
  console.log('╚══════════════════════════════════════════════════╝\n');

  try {
    await wipeDatabase();
    await seedMinimal();
  } catch (err) {
    console.error('\n❌ Fatal error during seeding:', err);
    process.exit(1);
  }
  process.exit(0);
}

main();
