/**
 * Tessera Database Seed Script
 * 
 * Models a Single-SSO / Multi-Tenant environment where:
 *   - Users belong to a single corporate identity (one SSO domain: tessera.io)
 *   - Users are granted access to multiple tenants (partners) via memberships
 * 
 * Usage:
 *   - npx tsx seed.ts --wipe    (Clean all tables)
 *   - npx tsx seed.ts --e2e     (Quick test data for Playwright)
 *   - npx tsx seed.ts --full    (Massive, realistic dataset for development/demo)
 */
import { db } from './db.js';
import * as schema from './db/schema.js';
import { sql } from 'drizzle-orm';
import { hashPassword } from './utils/passwords.js';
import { faker } from '@faker-js/faker';
import crypto from 'crypto';

// ─────────────────────────────────────────────────────────────────────────────
// Constants & Configuration
// ─────────────────────────────────────────────────────────────────────────────

const DEFAULT_PASSWORD = 'password123';
const DEPARTMENTS = [
  { 
    id: 'DSC', 
    name: 'Dispatch', 
    description: 'Handles incoming ticket routing and initial triage', 
    referenceFields: [{ label: 'Carrier ID' }, { label: 'Route Code' }] 
  },
  { 
    id: 'FOT', 
    name: 'Front Office', 
    description: 'Primary customer-facing support and live engagement', 
    referenceFields: [{ label: 'Customer Level' }] 
  },
  { 
    id: 'TEC', 
    name: 'Technical Support', 
    description: 'Deep-dive technical troubleshooting and bug investigation', 
    referenceFields: [{ label: 'System Version' }, { label: 'Jira ID' }] 
  },
  { 
    id: 'BIL', 
    name: 'Billing', 
    description: 'Processes invoices, payments, and subscription inquiries', 
    referenceFields: [{ label: 'Invoice Number' }] 
  },
  { 
    id: 'GEN', 
    name: 'General Inquiry', 
    description: 'Non-technical questions and corporate information', 
    referenceFields: [] 
  }
];

const INDUSTRIES = ['Technology', 'Finance', 'Healthcare', 'Education', 'Telecommunications', 'Retail'];
const LANGUAGES = ['en', 'nl', 'fr', 'de'];

const LABEL_COLORS = ['blue', 'indigo', 'purple', 'emerald', 'teal', 'cyan', 'sky', 'amber', 'orange', 'rose', 'pink', 'slate'];

// ─────────────────────────────────────────────────────────────────────────────
// Core Logic
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
  await db.execute(sql`
    DROP TRIGGER IF EXISTS trg_messages_search_vector ON messages
  `);
  await db.execute(sql`
    CREATE TRIGGER trg_messages_search_vector
      BEFORE INSERT OR UPDATE OF text ON messages
      FOR EACH ROW
      EXECUTE FUNCTION messages_search_vector_update()
  `);
}

async function seedFull() {
  console.log('🚀 Starting FULLWEIGHT seed (2 Partners, All Tables)...');
  const hash = await hashPassword(DEFAULT_PASSWORD);

  const businessHoursSchedule = {
    version: 1,
    timezone: 'Europe/Brussels',
    weekly: {
      mon: { closed: false, windows: [{ start: '08:00', end: '18:00' }] },
      tue: { closed: false, windows: [{ start: '08:00', end: '18:00' }] },
      wed: { closed: false, windows: [{ start: '08:00', end: '18:00' }] },
      thu: { closed: false, windows: [{ start: '08:00', end: '18:00' }] },
      fri: { closed: false, windows: [{ start: '08:00', end: '17:00' }] },
      sat: { closed: true, windows: [] },
      sun: { closed: true, windows: [] },
    },
    exceptions: [],
  };
  const businessHoursSchedule247 = {
    version: 1,
    timezone: 'UTC',
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

  // ── 1. Partners ──────────────────────────────────────────────────────────
  console.log('   - Creating 2 Partners (SSO)...');
  const PARTNER_A = 'nexus-telecom';
  const PARTNER_B = 'aurora-health';

  await db.insert(schema.partners).values({
    id: PARTNER_A,
    name: 'Nexus Telecom',
    industry: 'Telecommunications',
    departments: DEPARTMENTS,
    businessHoursStart: '08:00',
    businessHoursEnd: '18:00',
    businessHoursTimezone: 'Europe/Brussels',
    businessHoursSchedule,
    status: 'active',
    authMethod: 'sso',
    aiEnabled: true,
    aiProvider: 'ollama',
    aiModel: 'llama3.2',
    aiFeatures: { improve: true, summarize: true, translate: true, sentiment: true },
    slaConfig: { DSC: { response: 30, resolution: 240 }, FOT: { response: 15, resolution: 120 }, TEC: { response: 60, resolution: 480 } },
  });
  await db.insert(schema.partners).values({
    id: PARTNER_B,
    name: 'Aurora Health',
    industry: 'Healthcare',
    departments: DEPARTMENTS,
    businessHoursStart: '00:00',
    businessHoursEnd: '23:59',
    businessHoursTimezone: 'UTC',
    businessHoursSchedule: businessHoursSchedule247,
    status: 'active',
    authMethod: 'sso',
    aiEnabled: true,
    aiProvider: 'ollama',
    aiModel: 'llama3.2',
    aiFeatures: { improve: true, summarize: true, translate: true, sentiment: true },
    slaConfig: { DSC: { response: 20, resolution: 180 }, FOT: { response: 10, resolution: 90 } },
  });
  const partnerIds = [PARTNER_A, PARTNER_B];

  // ── 2. Labels ────────────────────────────────────────────────────────────
  console.log('   - Creating Labels...');
  const labelIdsByPartner: Record<string, string[]> = {};
  const labelNames = ['Urgent', 'Bug', 'Feature Request', 'Billing', 'Question', 'Security', 'Feedback', 'Onboarding'];
  for (const pId of partnerIds) {
    labelIdsByPartner[pId] = [];
    for (let i = 0; i < labelNames.length; i++) {
      const lid = `label_${pId}_${i}`;
      labelIdsByPartner[pId].push(lid);
      await db.insert(schema.labels).values({
        id: lid, partnerId: pId, name: labelNames[i], color: LABEL_COLORS[i % LABEL_COLORS.length],
      });
    }
  }

  // ── 3. Users & Memberships ───────────────────────────────────────────────
  console.log('   - Creating Users (local passwords for dev)...');

  // Platform operator
  await db.insert(schema.users).values({
    id: 'platform_bart', name: 'Bart Operator', email: 'bart@tessera.io',
    password: hash, isPlatformOperator: true, lang: 'en', accessibilityPrefs: {},
  });

  // Named users with deterministic IDs for easy dev login
  const namedUsers = [
    // Nexus Telecom team
    { id: 'user_emma',     name: 'Emma Van Damme',   email: 'emma@nexus-telecom.be',   lang: 'nl', role: 'admin'   as const, partner: PARTNER_A, depts: ['DSC','FOT','TEC','BIL','GEN'] },
    { id: 'user_lucas',    name: 'Lucas De Smedt',   email: 'lucas@nexus-telecom.be',  lang: 'nl', role: 'support' as const, partner: PARTNER_A, depts: ['DSC','FOT'] },
    { id: 'user_sophie',   name: 'Sophie Maes',      email: 'sophie@nexus-telecom.be', lang: 'fr', role: 'support' as const, partner: PARTNER_A, depts: ['TEC','BIL'] },
    { id: 'user_thomas',   name: 'Thomas Willems',   email: 'thomas@nexus-telecom.be', lang: 'nl', role: 'support' as const, partner: PARTNER_A, depts: ['FOT','GEN'] },
    { id: 'user_julie',    name: 'Julie Peeters',    email: 'julie@nexus-telecom.be',  lang: 'nl', role: 'agent'   as const, partner: PARTNER_A, depts: [] },
    { id: 'user_kevin',    name: 'Kevin Janssens',   email: 'kevin@nexus-telecom.be',  lang: 'nl', role: 'agent'   as const, partner: PARTNER_A, depts: [] },
    { id: 'user_marie',    name: 'Marie Dubois',     email: 'marie@nexus-telecom.be',  lang: 'fr', role: 'agent'   as const, partner: PARTNER_A, depts: [] },
    { id: 'user_pieter',   name: 'Pieter Claes',     email: 'pieter@nexus-telecom.be', lang: 'nl', role: 'agent'   as const, partner: PARTNER_A, depts: [] },
    // Aurora Health team
    { id: 'user_lisa',     name: 'Lisa Hartman',     email: 'lisa@aurora-health.com',   lang: 'en', role: 'admin'   as const, partner: PARTNER_B, depts: ['DSC','FOT','TEC','BIL','GEN'] },
    { id: 'user_james',    name: 'James Cooper',     email: 'james@aurora-health.com',  lang: 'en', role: 'support' as const, partner: PARTNER_B, depts: ['DSC','FOT'] },
    { id: 'user_anna',     name: 'Anna Bergström',   email: 'anna@aurora-health.com',   lang: 'en', role: 'support' as const, partner: PARTNER_B, depts: ['TEC'] },
    { id: 'user_david',    name: 'David Chen',       email: 'david@aurora-health.com',  lang: 'en', role: 'support' as const, partner: PARTNER_B, depts: ['BIL','GEN'] },
    { id: 'user_nina',     name: 'Nina Volkov',      email: 'nina@aurora-health.com',   lang: 'en', role: 'agent'   as const, partner: PARTNER_B, depts: [] },
    { id: 'user_omar',     name: 'Omar Hassan',      email: 'omar@aurora-health.com',   lang: 'en', role: 'agent'   as const, partner: PARTNER_B, depts: [] },
    { id: 'user_yuki',     name: 'Yuki Tanaka',      email: 'yuki@aurora-health.com',   lang: 'en', role: 'agent'   as const, partner: PARTNER_B, depts: [] },
    { id: 'user_carlos',   name: 'Carlos Mendez',    email: 'carlos@aurora-health.com', lang: 'en', role: 'agent'   as const, partner: PARTNER_B, depts: [] },
    // Cross-partner users (belong to both)
    { id: 'user_sarah',    name: 'Sarah Mitchell',   email: 'sarah@tessera.io',         lang: 'en', role: 'support' as const, partner: PARTNER_A, depts: ['DSC','FOT'] },
    { id: 'user_ben',      name: 'Ben Vermeulen',    email: 'ben@tessera.io',           lang: 'nl', role: 'admin'   as const, partner: PARTNER_A, depts: ['DSC','FOT','TEC','BIL','GEN'] },
  ];

  const allUsers: { id: string; name: string; email: string; role: string; partner: string }[] = [];

  for (const u of namedUsers) {
    await db.insert(schema.users).values({
      id: u.id, name: u.name, email: u.email, lang: u.lang as any,
      password: hash, isPlatformOperator: false, accessibilityPrefs: {},
    }).onConflictDoNothing();
    allUsers.push({ id: u.id, name: u.name, email: u.email, role: u.role, partner: u.partner });

    await db.insert(schema.memberships).values({
      id: `mem_${u.id}_${u.partner}`,
      userId: u.id, partnerId: u.partner, role: u.role, departments: u.depts, source: 'sso',
    });
  }

  // Cross-partner memberships for Sarah & Ben in Aurora Health
  await db.insert(schema.memberships).values({
    id: `mem_user_sarah_${PARTNER_B}`,
    userId: 'user_sarah', partnerId: PARTNER_B, role: 'support', departments: ['DSC'], source: 'sso',
  });
  await db.insert(schema.memberships).values({
    id: `mem_user_ben_${PARTNER_B}`,
    userId: 'user_ben', partnerId: PARTNER_B, role: 'admin', departments: ['DSC','FOT','TEC','BIL','GEN'], source: 'sso',
  });

  // ── 4. Partner Group Mappings (SSO) ──────────────────────────────────────
  console.log('   - Creating SSO Group Mappings...');
  const ssoMappings = [
    { partner: PARTNER_A, groupId: 'aad-nexus-admins',    groupName: 'Nexus Admins',         role: 'admin'   as const, depts: ['DSC','FOT','TEC','BIL','GEN'] },
    { partner: PARTNER_A, groupId: 'aad-nexus-support',   groupName: 'Nexus Support Staff',  role: 'support' as const, depts: ['DSC','FOT'] },
    { partner: PARTNER_A, groupId: 'aad-nexus-tech',      groupName: 'Nexus Tech Support',   role: 'support' as const, depts: ['TEC'] },
    { partner: PARTNER_A, groupId: 'aad-nexus-customers', groupName: 'Nexus Customers',      role: 'agent'   as const, depts: [] },
    { partner: PARTNER_B, groupId: 'aad-aurora-admins',   groupName: 'Aurora Admins',        role: 'admin'   as const, depts: ['DSC','FOT','TEC','BIL','GEN'] },
    { partner: PARTNER_B, groupId: 'aad-aurora-nurses',   groupName: 'Aurora Nursing Staff', role: 'support' as const, depts: ['FOT','GEN'] },
    { partner: PARTNER_B, groupId: 'aad-aurora-it',       groupName: 'Aurora IT Support',    role: 'support' as const, depts: ['TEC'] },
    { partner: PARTNER_B, groupId: 'aad-aurora-patients', groupName: 'Aurora Patients',      role: 'agent'   as const, depts: [] },
  ];
  for (const m of ssoMappings) {
    await db.insert(schema.partnerGroupMappings).values({
      id: crypto.randomUUID(), partnerId: m.partner, azureGroupId: m.groupId,
      azureGroupName: m.groupName, defaultRole: m.role, defaultDepartments: m.depts,
    });
  }

  // ── 5. System Settings ───────────────────────────────────────────────────
  console.log('   - Creating System Settings...');
  await db.insert(schema.systemSettings).values({ key: 'platform_name', value: JSON.stringify('Tessera') });
  await db.insert(schema.systemSettings).values({ key: 'max_file_size_mb', value: JSON.stringify(10) });
  await db.insert(schema.systemSettings).values({ key: 'session_timeout_minutes', value: JSON.stringify(30) });
  await db.insert(schema.systemSettings).values({ key: 'maintenance_mode', value: JSON.stringify(false) });

  // ── 6. Knowledge Base ────────────────────────────────────────────────────
  console.log('   - Creating Knowledge Base Articles...');
  const kbData: { partner: string; articles: { title: string; body: string; dept: string | null; tags: string[]; slug: string }[] }[] = [
    { partner: PARTNER_A, articles: [
      { title: 'How to Reset Your Router', body: 'Unplug your router for 30 seconds, then plug it back in. Wait 2 minutes for the connection to restore. If the issue persists, check the WAN light — it should be solid green. Contact support if the light is amber or off.', dept: 'TEC', tags: ['router','reset','connectivity'], slug: 'reset-router' },
      { title: 'Understanding Your Bill', body: 'Your monthly bill includes: base plan charges, data overage (if applicable), device installments, and taxes. Log in to MyNexus portal to view itemized charges. Disputes must be filed within 60 days of the billing date.', dept: 'BIL', tags: ['billing','charges','invoice'], slug: 'understanding-bill' },
      { title: 'SIM Card Activation', body: 'Insert your new SIM card with the device powered off. Power on and wait for network registration (1-3 minutes). If prompted, enter the PIN from your welcome letter. For eSIM activation, scan the QR code from the Nexus app.', dept: 'FOT', tags: ['sim','activation','esim'], slug: 'sim-activation' },
      { title: '5G Coverage Map FAQ', body: 'Our 5G network covers major Belgian cities: Brussels, Antwerp, Ghent, Bruges, and Liège. Rural areas use 4G+ fallback. Check real-time coverage at nexus-telecom.be/coverage. Indoor coverage may vary depending on building materials.', dept: 'GEN', tags: ['5g','coverage','network'], slug: '5g-coverage-faq' },
      { title: 'Roaming Charges Explained', body: 'EU roaming is included at no extra cost (Fair Use Policy applies). Outside the EU, data is charged at €0.05/MB. Enable travel mode in the Nexus app to set daily spending caps. Wi-Fi calling works abroad at domestic rates.', dept: 'BIL', tags: ['roaming','eu','charges'], slug: 'roaming-charges' },
      { title: 'Troubleshooting Slow Internet', body: 'Step 1: Run a speed test at speedtest.nexus-telecom.be. Step 2: Restart your modem and router. Step 3: Check for firmware updates in the admin panel (192.168.1.1). Step 4: If speeds are below 50% of plan, contact tech support with your speed test results.', dept: 'TEC', tags: ['speed','internet','troubleshooting'], slug: 'slow-internet' },
    ]},
    { partner: PARTNER_B, articles: [
      { title: 'Patient Portal Login Guide', body: 'Visit portal.aurora-health.com and click "First Time Login". Enter your patient ID (found on your registration letter) and date of birth. Set up 2FA via SMS or authenticator app. Contact the helpdesk if you cannot locate your patient ID.', dept: 'FOT', tags: ['portal','login','patient'], slug: 'portal-login' },
      { title: 'Appointment Scheduling', body: 'Use the Aurora Health app or patient portal to book appointments. Same-day appointments are available for urgent care. Specialist referrals require a GP consultation first. Cancel or reschedule at least 24 hours in advance to avoid a €25 no-show fee.', dept: 'GEN', tags: ['appointment','scheduling','booking'], slug: 'appointment-scheduling' },
      { title: 'Insurance & Billing FAQ', body: 'Aurora Health accepts all major Belgian mutualités. Third-party billing is handled automatically for conventional agreements. For non-conventional treatments, you will receive an invoice within 14 days. Upload your attestation via the patient portal for reimbursement tracking.', dept: 'BIL', tags: ['insurance','billing','mutualité'], slug: 'insurance-billing' },
      { title: 'Lab Results: How to Read Them', body: 'Lab results are available in your patient portal within 48 hours. Values outside the reference range are highlighted in red. Your doctor will add comments for abnormal results. Do not self-diagnose — always discuss results with your physician.', dept: 'FOT', tags: ['lab','results','tests'], slug: 'lab-results' },
      { title: 'Prescription Refill Process', body: 'Request refills through the patient portal or call your GP office. Chronic medication refills can be automated (ask your doctor). Pharmacy pickup is ready within 24 hours. eScript is sent directly to your preferred pharmacy if configured in your profile.', dept: 'GEN', tags: ['prescription','refill','medication'], slug: 'prescription-refill' },
      { title: 'IT System Access for Staff', body: 'New staff: your IT credentials are emailed on day 1. Access the EHR system via Citrix at ehr.aurora-health.internal. VPN is required for remote access — install the Aurora VPN client from the IT self-service portal. Report access issues to IT Support immediately.', dept: 'TEC', tags: ['it','access','staff','ehr'], slug: 'it-system-access' },
    ]},
  ];
  for (const { partner, articles } of kbData) {
    for (const a of articles) {
      await db.insert(schema.kbArticles).values({
        id: crypto.randomUUID(), partnerId: partner, title: a.title, body: a.body,
        dept: a.dept, tags: a.tags, slug: a.slug, published: true,
      });
    }
  }

  // ── 7. Canned Responses ──────────────────────────────────────────────────
  console.log('   - Creating Canned Responses...');
  const cannedData = [
    { title: 'Greeting',         body: 'Hello! Thank you for contacting support. How can I help you today?', shortcut: '/greet', dept: null },
    { title: 'Closing',          body: 'Thank you for reaching out. If you have further questions, don\'t hesitate to contact us again. Have a great day!', shortcut: '/close', dept: null },
    { title: 'Escalation',       body: 'I\'m escalating this to our specialist team. They will follow up within 2 hours.', shortcut: '/escalate', dept: null },
    { title: 'Billing Hold',     body: 'I\'ve placed your account on a billing hold while we investigate. No charges will be applied.', shortcut: '/billhold', dept: 'BIL' },
    { title: 'Ticket Received',  body: 'We\'ve received your request and assigned ticket #{id}. You\'ll receive updates here.', shortcut: '/received', dept: null },
    { title: 'Need More Info',   body: 'Could you please provide more details? Specifically: [what information is needed]. This will help us resolve your issue faster.', shortcut: '/moreinfo', dept: null },
    { title: 'Password Reset',   body: 'I\'ve initiated a password reset. Please check your email for the reset link. It expires in 30 minutes.', shortcut: '/pwreset', dept: null },
    { title: 'Known Issue',      body: 'This is a known issue that our engineering team is actively working on. We expect a fix by [ETA]. We\'ll notify you when it\'s resolved.', shortcut: '/known', dept: 'TEC' },
  ];
  for (const pId of partnerIds) {
    for (const c of cannedData) {
      await db.insert(schema.cannedResponses).values({
        id: crypto.randomUUID(), partnerId: pId, dept: c.dept, title: c.title,
        body: c.body, shortcut: c.shortcut,
      });
    }
  }

  // ── 8. Webhooks & Logs ───────────────────────────────────────────────────
  console.log('   - Creating Webhooks & Delivery Logs...');
  const webhookIds: Record<string, string[]> = {};
  const whData = [
    { url: 'https://hooks.slack.com/services/T00/B00/nexus', events: ['ticket.created','ticket.closed','ticket.transfer'], desc: 'Slack #support-alerts channel' },
    { url: 'https://api.servicenow.com/webhook/tessera',     events: ['ticket.created','ticket.closed'],                  desc: 'ServiceNow ITSM sync' },
  ];
  for (const pId of partnerIds) {
    webhookIds[pId] = [];
    for (const w of whData) {
      const wid = crypto.randomUUID();
      webhookIds[pId].push(wid);
      await db.insert(schema.webhooks).values({
        id: wid, partnerId: pId, url: w.url, secret: crypto.randomBytes(32).toString('hex'),
        events: w.events, description: w.desc, active: true,
      });
    }
    // Webhook delivery logs (last 30 days of deliveries)
    for (const wid of webhookIds[pId]) {
      for (let i = 0; i < 15; i++) {
        const success = Math.random() > 0.1;
        await db.insert(schema.webhookLogs).values({
          id: crypto.randomUUID(), webhookId: wid,
          event: faker.helpers.arrayElement(['ticket.created', 'ticket.closed']),
          payload: { ticketId: faker.string.uuid(), partnerId: pId },
          statusCode: success ? 200 : faker.helpers.arrayElement([500, 502, 408]),
          responseBody: success ? '{"ok":true}' : null,
          error: success ? null : 'Connection timeout',
          durationMs: faker.number.int({ min: 50, max: success ? 300 : 5000 }),
          createdAt: faker.date.recent({ days: 30 }).toISOString(),
        });
      }
    }
  }

  // ── 9. Tickets, Messages, Labels, Ratings ────────────────────────────────
  console.log('   - Creating Tickets & Messages...');
  const allMemberships = await db.select().from(schema.memberships);
  const agentMembers = allMemberships.filter(m => m.role === 'agent');
  const supportMembers = allMemberships.filter(m => m.role === 'support' || m.role === 'admin');

  // Realistic conversation starters per industry
  const nexusTopics = [
    { subject: 'Internet keeps disconnecting', msgs: ['My internet drops every 30 minutes since yesterday.','Have you tried restarting your modem?','Yes, three times already. Same issue.','I can see line errors on your connection. Let me schedule a technician visit.','When would be available?','Tomorrow between 10-12?','Perfect, I\'ll book that. Ticket stays open until resolved.'] },
    { subject: 'Overcharged on last bill', msgs: ['I was charged €89 instead of the usual €49.','Let me check your account... I see a roaming charge from your trip to the UK.','But I had the EU roaming package!','The UK is no longer in the EU for telecom purposes. I\'ll apply a one-time courtesy credit of €40.','Thank you, that\'s fair.'] },
    { subject: 'Cannot activate eSIM', msgs: ['The QR code for my eSIM won\'t scan.','Which device are you using?','iPhone 15 Pro, latest iOS.','Please try going to Settings > Cellular > Add eSIM > Enter Details Manually. I\'ll send the activation code via SMS.','Got it, it\'s working now! Thanks.'] },
    { subject: 'Upgrade to 5G plan', msgs: ['I want to upgrade from 4G to 5G. What are the options?','We have 5G Start (€39/mo, 50GB) and 5G Pro (€59/mo, unlimited).','Is 5G available in Mechelen?','Yes, Mechelen has full 5G coverage since Q3 2025.','I\'ll go with 5G Pro please.','Done! Your plan switches at the next billing cycle. You\'ll receive a confirmation email.'] },
    { subject: 'Business fiber installation', msgs: ['We need fiber installed at our new office in the Antwerp port area.','I can schedule a site survey. What\'s the address?','Kaai 47, Building C, 2030 Antwerpen.','Site survey scheduled for next Tuesday. Our business team will contact you with a quote within 48 hours.'] },
    { subject: 'SIM swap request', msgs: ['I lost my phone and need a new SIM card.','I\'ll need to verify your identity. Can you confirm your date of birth and the last 4 digits of your IBAN?','15/03/1990 and 4521.','Verified. I\'m blocking your old SIM now and sending a replacement to your registered address. It should arrive within 2 business days.','Can I get it faster? I need my phone for work.','I can arrange pickup at the Nexus store in Ghent city center tomorrow morning.','That works, thanks!'] },
  ];
  const auroraTopics = [
    { subject: 'Cannot access patient portal', msgs: ['I can\'t log in to the patient portal. It says my account is locked.','I\'ll unlock it for you. Can you verify your patient ID?','P-2024-88431.','Account unlocked. Please try logging in again and reset your password.','Working now, thank you!'] },
    { subject: 'Lab results not showing', msgs: ['My blood test was 3 days ago but results aren\'t in the portal.','Let me check with the lab... The results are pending pathologist review for one marker.','Which marker?','The thyroid panel. It should be released within 24 hours. Your GP will add notes.','OK, I\'ll wait. Thanks for checking.'] },
    { subject: 'Appointment rescheduling', msgs: ['I need to reschedule my cardiology appointment from March 15 to the following week.','Dr. Van Hoeck has availability on March 20 at 10:30 or March 22 at 14:00.','March 20 at 10:30 works.','Rescheduled! You\'ll receive an updated confirmation via email and SMS.'] },
    { subject: 'Insurance claim rejected', msgs: ['My insurance claim for the MRI was rejected. Reference: CLM-2026-4412.','Let me review... The rejection code indicates a missing prior authorization.','My GP sent the referral two weeks before!','I can see the referral but the authorization form wasn\'t filed. I\'ll escalate to our billing team to resubmit with proper documentation.','How long will this take?','Typically 5-7 business days for reprocessing. I\'ll keep this ticket open and update you.'] },
    { subject: 'Prescription refill urgent', msgs: ['I\'m out of my blood pressure medication and can\'t get a GP appointment until next week.','What medication are you taking?','Amlodipine 10mg, prescribed by Dr. Cooper.','I can see your active prescription. I\'ll arrange an emergency refill sent to your pharmacy (Apotheek Centraal). It should be ready in 2 hours.','Lifesaver, thank you!'] },
    { subject: 'VPN access not working', msgs: ['I can\'t connect to the hospital VPN from home. Getting error 812.','Error 812 usually means your certificate has expired. When did you last renew your VPN certificate?','I don\'t think I ever have.','Certificates expire annually. I\'ll generate a new one. Please download the updated profile from the IT self-service portal in 10 minutes.','Will do. Does this also fix the EHR timeout issues I\'ve been having?','Possibly — the expired cert can cause session drops. Let me know after you update.'] },
  ];

  const ticketIds: string[] = [];
  let ticketCount = 0;

  for (const pId of partnerIds) {
    const topics = pId === PARTNER_A ? nexusTopics : auroraTopics;
    const pAgents = agentMembers.filter(m => m.partnerId === pId);
    const pSupport = supportMembers.filter(m => m.partnerId === pId);

    // Create multiple rounds of each topic with different statuses
    for (let round = 0; round < 5; round++) {
      for (const topic of topics) {
        if (pAgents.length === 0) continue;
        const agent = faker.helpers.arrayElement(pAgents);
        const agentUser = namedUsers.find(u => u.id === agent.userId)!;
        const support = pSupport.length > 0 ? faker.helpers.arrayElement(pSupport) : null;
        const supportUser = support ? namedUsers.find(u => u.id === support.userId)! : null;

        const tid = crypto.randomUUID();
        ticketIds.push(tid);
        const daysAgo = faker.number.int({ min: 1, max: 60 });
        const createdAt = new Date(Date.now() - daysAgo * 86400000);
        const statuses: Array<'open' | 'pending' | 'closed' | 'resolved'> = ['open', 'pending', 'closed', 'resolved'];
        const status = round < 2 ? 'open' : round < 3 ? 'pending' : faker.helpers.arrayElement(statuses);
        const closedAt = (status === 'closed' || status === 'resolved')
          ? new Date(createdAt.getTime() + faker.number.int({ min: 3600000, max: 172800000 }))
          : null;

        await db.insert(schema.tickets).values({
          id: tid, partnerId: pId,
          dept: faker.helpers.arrayElement(DEPARTMENTS).id,
          agentId: agent.userId, agentName: agentUser.name, agentLang: agentUser.lang,
          supportId: support && (status !== 'open' || round > 0) ? support.userId : null,
          supportName: support && (status !== 'open' || round > 0) ? supportUser!.name : null,
          supportLang: support && (status !== 'open' || round > 0) ? supportUser!.lang : null,
          supportJoinedAt: support && (status !== 'open' || round > 0) ? new Date(createdAt.getTime() + 120000).toISOString() : null,
          status,
          createdAt: createdAt.toISOString(),
          updatedAt: (closedAt || createdAt).toISOString(),
          closedAt: closedAt?.toISOString() ?? null,
          closedBy: closedAt && supportUser ? supportUser.id : null,
          closingNotes: closedAt ? 'Issue resolved per conversation.' : null,
          references: [
            { label: 'Ticket Ref', value: `TK-${String(++ticketCount).padStart(5, '0')}` },
          ],
          participants: [
            { id: agent.userId, name: agentUser.name, role: 'agent', lang: agentUser.lang },
            ...(support && (status !== 'open' || round > 0) ? [{ id: support.userId, name: supportUser!.name, role: 'support', lang: supportUser!.lang }] : []),
          ],
          reopened: round === 4 && status === 'open',
          reopenCount: round === 4 && status === 'open' ? 1 : 0,
          slaBreached: Math.random() < 0.1,
        });

        // Messages
        for (let j = 0; j < topic.msgs.length; j++) {
          const isAgent = j % 2 === 0;
          const senderId = isAgent ? agent.userId : (support?.userId ?? agent.userId);
          const senderUser = isAgent ? agentUser : (supportUser ?? agentUser);
          await db.insert(schema.messages).values({
            id: crypto.randomUUID(), ticketId: tid, senderId, senderName: senderUser.name,
            senderRole: isAgent ? 'agent' : 'support', senderLang: senderUser.lang,
            text: topic.msgs[j],
            createdAt: new Date(createdAt.getTime() + j * 1800000).toISOString(),
            deliveredAt: new Date(createdAt.getTime() + j * 1800000 + 1000).toISOString(),
            readAt: j < topic.msgs.length - 1 ? new Date(createdAt.getTime() + (j + 1) * 1800000).toISOString() : null,
            sentiment: faker.helpers.arrayElement([null, null, 0.2, 0.5, 0.7, 0.9, -0.3, -0.6]),
          });
        }

        // Ticket labels (random 0-2)
        const randomLabels = faker.helpers.arrayElements(labelIdsByPartner[pId], { min: 0, max: 2 });
        for (const lid of randomLabels) {
          await db.insert(schema.ticketLabels).values({ ticketId: tid, labelId: lid }).onConflictDoNothing();
        }

        // Ratings for closed/resolved tickets (70% chance)
        if ((status === 'closed' || status === 'resolved') && Math.random() < 0.7) {
          await db.insert(schema.ratings).values({
            id: crypto.randomUUID(), partnerId: pId, ticketId: tid,
            agentId: agent.userId,
            supportId: support?.userId ?? null,
            rating: faker.helpers.weightedArrayElement([
              { value: 5, weight: 40 }, { value: 4, weight: 30 }, { value: 3, weight: 15 },
              { value: 2, weight: 10 }, { value: 1, weight: 5 },
            ]),
            comment: faker.helpers.arrayElement([
              'Very helpful, quick resolution!', 'Good service, thank you.',
              'Took a while but got resolved.', 'Could be faster.',
              'Excellent support experience.', null, null,
            ]),
            createdAt: closedAt ? new Date(closedAt.getTime() + 3600000).toISOString() : new Date().toISOString(),
          });
        }
      }
    }
  }

  // ── 10. App Feedback ─────────────────────────────────────────────────────
  console.log('   - Creating App Feedback...');
  const feedbackTexts = [
    'Love the dark mode! Very easy on the eyes.', 'Would be great to have keyboard shortcuts for common actions.',
    'The search function could be faster.', 'Really appreciate the multi-language support.',
    'Can you add an option to export chat transcripts?', 'The notification sounds are too loud.',
    'Great product overall, saves us a lot of time.', 'The mobile experience needs improvement.',
    'Would love to see analytics dashboards.', 'The canned responses feature is incredibly useful!',
    'Sometimes the real-time updates lag behind.', 'The UI is clean and professional, well done.',
  ];
  for (let i = 0; i < feedbackTexts.length; i++) {
    const mem = faker.helpers.arrayElement(allMemberships);
    const user = namedUsers.find(u => u.id === mem.userId);
    if (!user) continue;
    await db.insert(schema.appFeedback).values({
      id: crypto.randomUUID(), userId: user.id, partnerId: mem.partnerId,
      userName: user.name, role: mem.role, text: feedbackTexts[i],
      treated: i < 4 ? 1 : 0,
      createdAt: faker.date.recent({ days: 30 }).toISOString(),
    });
  }

  // ── 11. Topic Alerts ─────────────────────────────────────────────────────
  console.log('   - Creating Topic Alerts...');
  const alerts = [
    { partner: PARTNER_A, dept: 'TEC', topic: 'Router firmware crash', summary: 'Multiple reports of Nexus-X200 routers crashing after firmware v3.2.1 update', severity: 'high' as const, count: 12, status: 'active' as const },
    { partner: PARTNER_A, dept: 'BIL', topic: 'Double billing glitch', summary: 'Several customers report being charged twice for March subscription', severity: 'critical' as const, count: 8, status: 'active' as const },
    { partner: PARTNER_A, dept: 'FOT', topic: '5G handover drops', summary: 'Users in Brussels report call drops when transitioning between 4G and 5G', severity: 'medium' as const, count: 5, status: 'acknowledged' as const },
    { partner: PARTNER_B, dept: 'FOT', topic: 'Portal login failures', summary: 'Spike in patient portal login errors after SSO migration', severity: 'high' as const, count: 15, status: 'active' as const },
    { partner: PARTNER_B, dept: 'TEC', topic: 'EHR slow response', summary: 'Electronic health record system response times above 5 seconds during peak hours', severity: 'medium' as const, count: 7, status: 'acknowledged' as const },
    { partner: PARTNER_B, dept: 'BIL', topic: 'Insurance claim sync', summary: 'Claims submitted via portal not syncing with insurance provider API', severity: 'high' as const, count: 4, status: 'active' as const },
  ];
  for (const a of alerts) {
    await db.insert(schema.topicAlerts).values({
      id: crypto.randomUUID(), partnerId: a.partner, dept: a.dept, topic: a.topic,
      summary: a.summary, severity: a.severity, ticketCount: a.count, status: a.status,
      createdAt: faker.date.recent({ days: 7 }).toISOString(),
    });
  }

  // ── 12. Daily Stats (last 30 days) ──────────────────────────────────────
  console.log('   - Creating Daily Stats (30 days)...');
  for (const pId of partnerIds) {
    for (let d = 0; d < 30; d++) {
      const date = new Date(Date.now() - d * 86400000);
      const dateStr = date.toISOString().slice(0, 10);
      const total = faker.number.int({ min: 8, max: 35 });
      const closed = faker.number.int({ min: 4, max: total });
      await db.insert(schema.dailyStats).values({
        date: dateStr, partnerId: pId, total, closed,
        abandoned: faker.number.int({ min: 0, max: 3 }),
        avgResponseMs: faker.number.int({ min: 30000, max: 300000 }),
        avgDurationMs: faker.number.int({ min: 600000, max: 3600000 }),
        avgRating: faker.number.float({ min: 3.0, max: 5.0, fractionDigits: 2 }),
        ratingCount: faker.number.int({ min: 2, max: closed }),
        slaResolved: faker.number.int({ min: Math.floor(closed * 0.7), max: closed }),
        slaCompliant: faker.number.int({ min: Math.floor(closed * 0.6), max: closed }),
        p95ResponseMs: faker.number.int({ min: 120000, max: 600000 }),
        reopened: faker.number.int({ min: 0, max: 2 }),
        sentimentSum: faker.number.float({ min: total * 0.2, max: total * 0.8, fractionDigits: 1 }),
        sentimentCount: faker.number.int({ min: Math.floor(total * 0.5), max: total }),
        deptCounts: { DSC: faker.number.int({ min: 2, max: 8 }), FOT: faker.number.int({ min: 3, max: 10 }), TEC: faker.number.int({ min: 1, max: 6 }), BIL: faker.number.int({ min: 1, max: 4 }), GEN: faker.number.int({ min: 0, max: 3 }) },
        ratingsByDept: { DSC: faker.number.float({ min: 3, max: 5, fractionDigits: 1 }), FOT: faker.number.float({ min: 3, max: 5, fractionDigits: 1 }), TEC: faker.number.float({ min: 3, max: 5, fractionDigits: 1 }) },
        hourly: Object.fromEntries(Array.from({ length: 24 }, (_, h) => [h, h >= 8 && h <= 18 ? faker.number.int({ min: 0, max: 5 }) : 0])),
      });
    }
  }

  // ── 13. Audit Log ────────────────────────────────────────────────────────
  console.log('   - Creating Audit Log entries...');
  const auditActions = [
    { action: 'partner.create',     targetType: 'partner', metadata: { name: 'Nexus Telecom' } },
    { action: 'partner.create',     targetType: 'partner', metadata: { name: 'Aurora Health' } },
    { action: 'user.create',        targetType: 'user',    metadata: { email: 'emma@nexus-telecom.be', role: 'admin' } },
    { action: 'user.create',        targetType: 'user',    metadata: { email: 'lisa@aurora-health.com', role: 'admin' } },
    { action: 'user.login',         targetType: 'user',    metadata: { method: 'sso' } },
    { action: 'user.login',         targetType: 'user',    metadata: { method: 'local' } },
    { action: 'user.password_change', targetType: 'user',  metadata: {} },
    { action: 'membership.create',  targetType: 'membership', metadata: { role: 'support' } },
    { action: 'ticket.close',       targetType: 'ticket',  metadata: { reason: 'resolved' } },
    { action: 'ticket.transfer',    targetType: 'ticket',  metadata: { fromDept: 'FOT', toDept: 'TEC' } },
    { action: 'settings.update',    targetType: 'system',  metadata: { key: 'platform_name' } },
    { action: 'partner.deactivate', targetType: 'partner', metadata: { reason: 'Contract ended' } },
    { action: 'gdpr.purge',         targetType: 'system',  metadata: { ticketsPurged: 42, daysOld: 30 } },
    { action: 'user.mfa_enable',    targetType: 'user',    metadata: { method: 'totp' } },
    { action: 'webhook.create',     targetType: 'webhook', metadata: { url: 'https://hooks.slack.com/...' } },
  ];
  for (let i = 0; i < 40; i++) {
    const entry = faker.helpers.arrayElement(auditActions);
    const pId = faker.helpers.arrayElement(partnerIds);
    const actor = faker.helpers.arrayElement([...namedUsers.filter(u => u.partner === pId), { id: 'platform_bart', name: 'Bart Operator' }]);
    await db.insert(schema.auditLog).values({
      id: crypto.randomUUID(), action: entry.action, actorId: actor.id,
      partnerId: pId, targetType: entry.targetType,
      targetId: crypto.randomUUID(), metadata: entry.metadata,
      createdAt: faker.date.recent({ days: 30 }).toISOString(),
    });
  }

  // ── 14. Saved Views ──────────────────────────────────────────────────────
  console.log('   - Creating Saved Views...');
  const viewDefs = [
    { name: 'My Open Tickets',     filters: { status: ['open'], assignedToMe: true } },
    { name: 'Urgent & Unassigned', filters: { status: ['open'], labels: ['Urgent'], unassigned: true } },
    { name: 'Closed This Week',    filters: { status: ['closed','resolved'], dateRange: 'this_week' } },
    { name: 'Tech Support Queue',  filters: { dept: 'TEC', status: ['open','pending'] } },
    { name: 'Billing Issues',      filters: { dept: 'BIL', status: ['open','pending'] } },
    { name: 'SLA Breached',        filters: { slaBreached: true, status: ['open','pending'] } },
  ];
  for (const mem of supportMembers.slice(0, 8)) {
    const views = faker.helpers.arrayElements(viewDefs, { min: 1, max: 3 });
    for (let i = 0; i < views.length; i++) {
      await db.insert(schema.savedViews).values({
        id: crypto.randomUUID(), partnerId: mem.partnerId, userId: mem.userId,
        name: views[i].name, filters: views[i].filters, isDefault: i === 0,
      });
    }
  }

  // ── 15. Agent Status Log & Daily Rollup ──────────────────────────────────
  console.log('   - Creating Agent Status Logs...');
  for (const mem of supportMembers) {
    // Last 7 days of status transitions
    for (let d = 0; d < 7; d++) {
      const dayStart = new Date(Date.now() - d * 86400000);
      dayStart.setHours(8, 0, 0, 0);
      let currentTime = dayStart.getTime();
      let onlineSec = 0, awaySec = 0;

      // 3-5 status transitions per day
      const transitions = faker.number.int({ min: 3, max: 5 });
      for (let t = 0; t < transitions; t++) {
        const status = t % 2 === 0 ? 'online' : 'away';
        const durationMin = faker.number.int({ min: 30, max: 180 });
        const startedAt = new Date(currentTime);
        const endedAt = new Date(currentTime + durationMin * 60000);
        if (status === 'online') onlineSec += durationMin * 60;
        else awaySec += durationMin * 60;
        await db.insert(schema.agentStatusLog).values({
          id: crypto.randomUUID(), userId: mem.userId, partnerId: mem.partnerId,
          status, startedAt: startedAt.toISOString(), endedAt: endedAt.toISOString(),
          duration: durationMin * 60,
        });
        currentTime = endedAt.getTime();
      }

      // Daily rollup
      const dateStr = dayStart.toISOString().slice(0, 10);
      await db.insert(schema.dailyAgentStatus).values({
        id: crypto.randomUUID(), date: dateStr, userId: mem.userId,
        partnerId: mem.partnerId, onlineSeconds: onlineSec, awaySeconds: awaySec,
      });
    }
  }

  // ── 16. AI Prompt Templates ──────────────────────────────────────────────
  console.log('   - Creating AI Prompt Templates...');
  const aiActions = [
    { action: 'improve',   template: 'Improve the following customer support message for clarity and professionalism. Keep the tone friendly but concise:\n\n{message}' },
    { action: 'summarize', template: 'Summarize the following support conversation in 2-3 bullet points. Focus on the issue, actions taken, and resolution status:\n\n{messages}' },
    { action: 'translate', template: 'Translate the following support message to {targetLang}. Maintain the professional tone and any technical terms:\n\n{message}' },
    { action: 'sentiment', template: 'Analyze the sentiment of this customer message. Return a score from -1 (very negative) to 1 (very positive) and a one-word label (angry, frustrated, neutral, satisfied, happy):\n\n{message}' },
    { action: 'classify',  template: 'Classify this support ticket into one of these departments: {departments}. Return only the department ID and a confidence score:\n\n{message}' },
  ];
  for (const pId of partnerIds) {
    for (const t of aiActions) {
      await db.insert(schema.aiPromptTemplates).values({
        id: crypto.randomUUID(), partnerId: pId, action: t.action,
        template: t.template, model: null,
      });
    }
  }

  // ── 17. AI Usage Log & Daily Rollup ──────────────────────────────────────
  console.log('   - Creating AI Usage Logs...');
  for (const pId of partnerIds) {
    // Granular logs (last 7 days)
    for (let i = 0; i < 50; i++) {
      const action = faker.helpers.arrayElement(['improve', 'summarize', 'translate', 'sentiment']);
      const success = Math.random() > 0.05;
      const user = faker.helpers.arrayElement(namedUsers.filter(u => u.partner === pId && u.role !== 'agent'));
      await db.insert(schema.aiUsageLog).values({
        id: crypto.randomUUID(), partnerId: pId, userId: user?.id ?? null,
        action, provider: 'ollama', model: 'llama3.2',
        inputTokens: faker.number.int({ min: 100, max: 2000 }),
        outputTokens: faker.number.int({ min: 50, max: 500 }),
        latencyMs: faker.number.int({ min: 200, max: 3000 }),
        success, errorMessage: success ? null : 'Model timeout',
        createdAt: faker.date.recent({ days: 7 }).toISOString(),
      });
    }

    // Daily rollup (last 30 days)
    for (let d = 0; d < 30; d++) {
      const dateStr = new Date(Date.now() - d * 86400000).toISOString().slice(0, 10);
      for (const action of ['improve', 'summarize', 'translate', 'sentiment']) {
        const totalReq = faker.number.int({ min: 5, max: 30 });
        const errorCount = faker.number.int({ min: 0, max: 2 });
        await db.insert(schema.dailyAiUsage).values({
          id: crypto.randomUUID(), date: dateStr, partnerId: pId,
          action, provider: 'ollama', model: 'llama3.2',
          totalInputTokens: faker.number.int({ min: 5000, max: 40000 }),
          totalOutputTokens: faker.number.int({ min: 2000, max: 15000 }),
          totalRequests: totalReq, successCount: totalReq - errorCount, errorCount,
          avgLatencyMs: faker.number.int({ min: 300, max: 1500 }),
        });
      }
    }
  }

  console.log(`✅ FULLWEIGHT seed complete. ${ticketIds.length} tickets across 2 partners.`);
}

async function seedE2E() {
  console.log('🧪 Seeding E2E data (Playwright Baseline)...');
  const hash = await hashPassword(DEFAULT_PASSWORD);

  const businessHoursSchedule = {
    version: 1,
    timezone: 'UTC',
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

  // Partners
  const pIds = ['test-partner-a', 'test-partner-b', 'tessera-main'];
  for (const id of pIds) {
    await db.insert(schema.partners).values({
      id,
      name: id.replace('-', ' ').toUpperCase(),
      industry: 'Technology',
      departments: DEPARTMENTS,
      businessHoursStart: '00:00',
      businessHoursEnd: '23:59',
      businessHoursSchedule,
    }).onConflictDoNothing();

    // Add labels to E2E partners
    const labelNames = ['Urgent', 'Bug', 'Feature', 'Question'];
    for (let i = 0; i < labelNames.length; i++) {
      await db.insert(schema.labels).values({
        id: `label_${id}_${labelNames[i].toLowerCase()}`,
        partnerId: id,
        name: labelNames[i],
        color: LABEL_COLORS[i % LABEL_COLORS.length],
      }).onConflictDoNothing();
    }
  }

  // THE Platform Admin (Bart)
  await db.insert(schema.users).values({
    id: 'platform_bart',
    name: 'Bart Operator',
    email: 'bart@tessera.io',
    password: hash,
    isPlatformOperator: true,
    accessibilityPrefs: {},
  }).onConflictDoNothing();

  // Note: Bart no longer needs explicit memberships in seedE2E.
  // Global access is handled implicitly by the auth service.

  // Alice is a regular user (Admin in test-partner-a) used for reset-pw tests
  await db.insert(schema.users).values({
    id: 'alice_platform',
    name: 'Alice Admin',
    email: 'alice@acme.com',
    password: hash,
    isPlatformOperator: false, // No longer platform admin
    accessibilityPrefs: {},
  }).onConflictDoNothing();

  await db.insert(schema.memberships).values({
    id: 'mem_alice_platform_test-partner-a',
    userId: 'alice_platform',
    partnerId: 'test-partner-a',
    role: 'admin',
    departments: ['DSC', 'FOT'],
  }).onConflictDoNothing();

  // Test Users
  const testUsers = [
    { id: 'e2e-agent-a', name: 'E2E Agent A', role: 'agent', partnerId: 'test-partner-a', lang: 'en' },
    { id: 'e2e-support-a', name: 'E2E Support A', role: 'support', partnerId: 'test-partner-a', lang: 'en' },
    { id: 'e2e-admin-a', name: 'E2E Admin A', role: 'admin', partnerId: 'test-partner-a', lang: 'en' },
    { id: 'agent_jan', name: 'Agent Jan', role: 'agent', partnerId: 'tessera-main', lang: 'nl' },
  ];

  for (const u of testUsers) {
    await db.insert(schema.users).values({
      id: u.id,
      name: u.name,
      lang: u.lang as any,
      password: hash,
      accessibilityPrefs: {},
    }).onConflictDoNothing();

    await db.insert(schema.memberships).values({
      id: `mem_${u.id}`,
      userId: u.id,
      partnerId: u.partnerId,
      role: u.role as any,
      departments: ['DSC', 'FOT'],
    }).onConflictDoNothing();
  }
  
  console.log('✅ E2E data seeded.');
}

async function main() {
  const args = process.argv.slice(2);
  const isFull = args.includes('--full');
  const isE2E = args.includes('--e2e');
  const isWipe = args.includes('--wipe') || isFull || isE2E;

  console.log('╔══════════════════════════════════════════════════╗');
  console.log('║   Tessera Database Seed Utility                  ║');
  console.log('╚══════════════════════════════════════════════════╝\n');

  try {
    if (!isWipe && !isFull && !isE2E) {
      console.log('No action specified. Use --wipe, --e2e, or --full.\n');
      process.exit(0);
    }
    if (isWipe) await wipeDatabase();
    if (isFull) await seedFull();
    else if (isE2E) await seedE2E();
    console.log('\n✨ Database operations finished successfully.');
  } catch (err) {
    console.error('\n❌ Fatal error during seeding:', err);
    process.exit(1);
  }
  process.exit(0);
}

main();
