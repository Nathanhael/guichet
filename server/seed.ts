/**
 * Guichet Database Seed Script — Minimal
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

// ─────────────────────────────────────────────────────────────────────────────
// Configuration
// ─────────────────────────────────────────────────────────────────────────────

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
      { label: 'Error Code', optional: true },
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
  /**
   * Stamp `users.isExternal = true` on insert — simulates an Azure B2B guest
   * who signed in via SSO. Used by the guest-admin-visible-disable E2E spec
   * (testing/e2e/guest-admin-visible-disable.spec.ts).
   */
  isExternal?: boolean;
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

// One open/pending ticket per agent — matches server-side enforcement in
// `server/socket/handlers/ticket.ts` (guard rejects `ticket:new` when the agent
// already has a non-closed ticket). Seed bypasses the socket path via direct
// DB insert, so the constraint is enforced here by construction: each `agentId`
// below appears in at most one TICKETS entry.
const TICKETS: SeedTicket[] = [
  // Assigned (pending) — one per support user, distinct agents.
  {
    id: 'ticket_dsc_julie',
    dept: 'DSC',
    agentId: 'agent_julie',
    agentName: 'Julie Agent',
    supportId: 'support_lucas',
    supportName: 'Lucas Support',
    firstMessage: 'I cannot reach the dispatcher for route 17 — the carrier portal keeps timing out.',
  },
  {
    id: 'ticket_fot_kevin',
    dept: 'FOT',
    agentId: 'agent_kevin',
    agentName: 'Kevin Agent',
    supportId: 'support_lucas',
    supportName: 'Lucas Support',
    firstMessage: 'New VIP customer onboarding kit is missing the welcome letter template.',
  },
  {
    id: 'ticket_tec_thomas',
    dept: 'TEC',
    agentId: 'agent_thomas',
    agentName: 'Thomas Agent',
    supportId: 'support_sophie',
    supportName: 'Sophie Support',
    firstMessage: 'Production API is returning 500 on POST /ingest since the deploy this morning.',
  },
  // Unassigned (open queue) — distinct agents still, no supportId.
  {
    id: 'ticket_queue_dsc_1',
    dept: 'DSC',
    agentId: 'agent_marc',
    agentName: 'Marc Agent',
    supportId: null,
    supportName: null,
    firstMessage: 'Carrier ID 4421 stuck in triage for 20 minutes — please route.',
  },
  {
    id: 'ticket_queue_fot_1',
    dept: 'FOT',
    agentId: 'agent_sarah',
    agentName: 'Sarah Agent',
    supportId: null,
    supportName: null,
    firstMessage: 'Customer is asking about upgrade paths — needs a rep to call back.',
  },
  {
    id: 'ticket_queue_tec_1',
    dept: 'TEC',
    agentId: 'agent_marie',
    agentName: 'Marie Agent',
    supportId: null,
    supportName: null,
    firstMessage: 'Webhook signatures fail verification intermittently — roughly 1 in 20 deliveries.',
  },
];

const PARTNER_USERS: SeedUser[] = [
  { id: 'admin_emma',     name: 'Emma Admin',     email: 'emma@acme.test',    lang: 'en', role: 'admin',   departments: [] },
  { id: 'support_lucas',  name: 'Lucas Support',  email: 'lucas@acme.test',   lang: 'en', role: 'support', departments: ['DSC', 'FOT'] },
  { id: 'support_sophie', name: 'Sophie Support', email: 'sophie@acme.test',  lang: 'en', role: 'support', departments: ['TEC'] },
  { id: 'agent_julie',    name: 'Julie Agent',    email: 'julie@acme.test',   lang: 'en', role: 'agent',   departments: [] },
  { id: 'agent_kevin',    name: 'Kevin Agent',    email: 'kevin@acme.test',   lang: 'en', role: 'agent',   departments: [] },
  { id: 'agent_thomas',   name: 'Thomas Agent',   email: 'thomas@acme.test',  lang: 'en', role: 'agent',   departments: [] },
  { id: 'agent_marc',     name: 'Marc Agent',     email: 'marc@acme.test',    lang: 'en', role: 'agent',   departments: [] },
  { id: 'agent_sarah',    name: 'Sarah Agent',    email: 'sarah@acme.test',   lang: 'en', role: 'agent',   departments: [] },
  { id: 'agent_marie',    name: 'Marie Agent',    email: 'marie@acme.test',   lang: 'en', role: 'agent',   departments: [] },
  // QA fixtures — intentionally kept free of pre-seeded tickets so E2E tests
  // (see testing/e2e/chat-enhancements.spec.ts) can log in as them without
  // colliding with the 1-ticket-per-agent guard or the queue-variant layout
  // of demo users. Do not attach tickets or departments here without updating
  // that spec.
  { id: 'support_qa',     name: 'QA Support',     email: 'support_qa@acme.test', lang: 'en', role: 'support', departments: ['DSC', 'FOT', 'TEC'] },
  { id: 'agent_qa',       name: 'QA Agent',       email: 'agent_qa@acme.test',   lang: 'en', role: 'agent',   departments: [] },
  // Second QA fixture pair dedicated to chat-flow.spec.ts. Isolated from
  // agent_qa/support_qa (used by chat-enhancements) so parallel workers
  // don't race on ticket open/close for the same agent row.
  { id: 'support_flow',   name: 'Flow Support',   email: 'support_flow@acme.test', lang: 'en', role: 'support', departments: ['DSC', 'FOT', 'TEC'] },
  { id: 'agent_flow',     name: 'Flow Agent',     email: 'agent_flow@acme.test',   lang: 'en', role: 'agent',   departments: [] },
  // Dedicated to view-modes.spec.ts. Its `releaseAllSupportClaims()` cleanup
  // is now scoped to this user, so parallel specs that claim tickets as
  // lucas/sophie/qa no longer lose their support_id mid-test.
  { id: 'support_vm',     name: 'ViewModes Support', email: 'support_vm@acme.test', lang: 'en', role: 'support', departments: ['DSC', 'FOT', 'TEC'] },
  // Azure B2B guest admin fixture — same admin permissions as Emma, but
  // `users.isExternal = true` trips `destructiveAdminProcedure` and the UI
  // visible-disable treatment. Used by guest-admin-visible-disable.spec.ts.
  { id: 'admin_guest',    name: 'Gina Guest',     email: 'gina@external.test',   lang: 'en', role: 'admin',   departments: [], isExternal: true },
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
      daily_agent_status, agent_status_log,
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
    status: 'active',
  });

  // Platform operator
  await db.insert(schema.users).values({
    id: 'platform_bart',
    name: 'Bart Operator',
    email: 'bart@guichet.io',
    lang: 'en',
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
      isPlatformOperator: false,
      isExternal: u.isExternal ?? false,
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
  console.log('  Partner: ' + PARTNER_ID + ' (auth: SSO / dev-login)');
  console.log('');
  console.log('  Platform operator:');
  console.log('    - bart@guichet.io             (platform_bart)');
  console.log('  Admin:');
  console.log('    - emma@acme.test              (admin_emma)');
  console.log('  Support:');
  console.log('    - lucas@acme.test             (support_lucas, depts: DSC, FOT)');
  console.log('    - sophie@acme.test            (support_sophie, depts: TEC)');
  console.log('  Agents (each has 1 open/pending ticket):');
  console.log('    - julie@acme.test             (agent_julie,  DSC pending)');
  console.log('    - kevin@acme.test             (agent_kevin,  FOT pending)');
  console.log('    - thomas@acme.test            (agent_thomas, TEC pending)');
  console.log('    - marc@acme.test              (agent_marc,   DSC queue)');
  console.log('    - sarah@acme.test             (agent_sarah,  FOT queue)');
  console.log('    - marie@acme.test             (agent_marie,  TEC queue)');
  console.log('  QA fixtures (no tickets — reserved for E2E):');
  console.log('    - support_qa@acme.test        (support_qa, depts: DSC, FOT, TEC)');
  console.log('    - agent_qa@acme.test          (agent_qa,  no tickets)');
  console.log('    - support_flow@acme.test      (support_flow, depts: DSC, FOT, TEC)');
  console.log('    - agent_flow@acme.test        (agent_flow, no tickets)');
  console.log('    - support_vm@acme.test        (support_vm, depts: DSC, FOT, TEC)');
}

async function main() {
  console.log('╔══════════════════════════════════════════════════╗');
  console.log('║   Guichet Database Seed Utility (minimal)        ║');
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
