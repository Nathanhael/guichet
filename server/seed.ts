/**
 * Comprehensive demo seed for Tessera.
 *
 * TRUNCATES all tables then seeds:
 *   2 partners, ~20 users, ~50 tickets with messages, labels, ratings,
 *   canned responses, KB articles, 30 days of stats, agent status data,
 *   archived tickets, feedback, alerts, webhooks, and audit log entries.
 *
 * Usage: docker compose exec server npx tsx seed.ts
 * All demo users use password: password123
 */
import { db } from './db.js';
import {
  users, partners, memberships, labels, tickets, messages, ticketLabels,
  ratings, appFeedback, cannedResponses, kbArticles, dailyStats,
  auditLog, auditArchive, archivedTickets, topicAlerts,
  refreshTokens, savedViews, systemSettings, webhooks, webhookLogs,
  partnerGroupMappings, aiUsageLog, dailyAiUsage, aiPromptTemplates,
  agentStatusLog, dailyAgentStatus,
} from './db/schema.js';
import { sql } from 'drizzle-orm';
import { hashPassword } from './utils/passwords.js';
import crypto from 'crypto';

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

const PASSWORD = 'password123';
const NOW = new Date().toISOString();

/** Return ISO timestamp N days (+ optional hours/mins) in the past. */
function ago(days: number, hours = 0, mins = 0): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  d.setHours(d.getHours() - hours, d.getMinutes() - mins);
  return d.toISOString();
}

/** Return YYYY-MM-DD string for N days ago. */
function dateAgo(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().split('T')[0];
}

function uid(): string { return crypto.randomUUID(); }

/** Random int in [min, max]. */
function randInt(min: number, max: number): number {
  return min + Math.floor(Math.random() * (max - min + 1));
}

/** Random float in [min, max], fixed to 2 decimals. */
function randFloat(min: number, max: number): number {
  return parseFloat((min + Math.random() * (max - min)).toFixed(2));
}

/** Pick a random element from an array. */
function pick<T>(arr: T[]): T { return arr[Math.floor(Math.random() * arr.length)]; }

// ─────────────────────────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────────────────────────

async function main() {
  console.log('╔══════════════════════════════════════════════════╗');
  console.log('║   Tessera Comprehensive Demo Seed                ║');
  console.log('╚══════════════════════════════════════════════════╝\n');

  // ── 1. TRUNCATE ALL TABLES ─────────────────────────────────────────────────
  console.log('① Truncating all tables...');
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
  console.log('   All tables truncated\n');

  // ── 2. PARTNERS ────────────────────────────────────────────────────────────
  console.log('② Creating partners...');

  await db.insert(partners).values({
    id: 'wavelink',
    name: 'WaveLink Telecom',
    industry: 'Telecommunications',
    departments: [
      { id: 'network-ops', name: 'Network Operations', description: 'Network infrastructure and outages' },
      { id: 'customer-care', name: 'Customer Care', description: 'General customer support' },
      { id: 'billing', name: 'Billing', description: 'Invoicing, payments, and account management' },
      { id: 'technical-support', name: 'Technical Support', description: 'Device and software troubleshooting' },
    ],
    businessHoursSchedule: [
      { day: 0, start: '00:00', end: '23:59' },
      { day: 1, start: '00:00', end: '23:59' },
      { day: 2, start: '00:00', end: '23:59' },
      { day: 3, start: '00:00', end: '23:59' },
      { day: 4, start: '00:00', end: '23:59' },
      { day: 5, start: '00:00', end: '23:59' },
      { day: 6, start: '00:00', end: '23:59' },
    ],
    businessHoursStart: '00:00',
    businessHoursEnd: '23:59',
    businessHoursTimezone: 'Europe/Brussels',
    slaConfig: { responseMins: 30, resolutionMins: 240 },
    status: 'active',
    authMethod: 'sso',
    createdAt: ago(90),
    updatedAt: NOW,
  });
  console.log('   WaveLink Telecom');

  await db.insert(partners).values({
    id: 'greenleaf',
    name: 'GreenLeaf Insurance',
    industry: 'Insurance',
    departments: [
      { id: 'claims', name: 'Claims', description: 'Insurance claims processing' },
      { id: 'policy-support', name: 'Policy Support', description: 'Policy questions and renewals' },
      { id: 'commercial', name: 'Commercial', description: 'New policies and commercial inquiries' },
    ],
    businessHoursSchedule: [
      { day: 0, start: '00:00', end: '23:59' },
      { day: 1, start: '00:00', end: '23:59' },
      { day: 2, start: '00:00', end: '23:59' },
      { day: 3, start: '00:00', end: '23:59' },
      { day: 4, start: '00:00', end: '23:59' },
      { day: 5, start: '00:00', end: '23:59' },
      { day: 6, start: '00:00', end: '23:59' },
    ],
    businessHoursStart: '00:00',
    businessHoursEnd: '23:59',
    businessHoursTimezone: 'Europe/Brussels',
    slaConfig: { responseMins: 60, resolutionMins: 480 },
    status: 'active',
    authMethod: 'sso',
    createdAt: ago(60),
    updatedAt: NOW,
  });
  console.log('   GreenLeaf Insurance\n');

  // ── 3. USERS ───────────────────────────────────────────────────────────────
  console.log('③ Creating users...');
  const hashed = await hashPassword(PASSWORD);

  interface DemoUser {
    id: string; name: string; email: string;
    role: 'agent' | 'support' | 'admin';
    partnerId: string; departments: string[];
    lang: string; isPlatformOperator?: boolean;
  }

  const demoUsers: DemoUser[] = [
    // ── Platform Operator ──
    { id: 'platform_bart', name: 'Bart Claessens',     email: 'bart@tessera.demo',        role: 'admin',   partnerId: 'wavelink',  departments: [],                  lang: 'nl', isPlatformOperator: true },

    // ── WaveLink Telecom ──
    // Admin
    { id: 'admin_katrien',  name: 'Katrien Verhoeven', email: 'katrien@wavelink.demo',    role: 'admin',   partnerId: 'wavelink',  departments: [],                  lang: 'nl' },
    // Support
    { id: 'support_jan',    name: 'Jan Willems',       email: 'jan@wavelink.demo',        role: 'support', partnerId: 'wavelink',  departments: ['network-ops'],     lang: 'nl' },
    { id: 'support_amelie', name: 'Amelie Rousseau',   email: 'amelie@wavelink.demo',     role: 'support', partnerId: 'wavelink',  departments: ['customer-care'],   lang: 'fr' },
    { id: 'support_thomas', name: 'Thomas Bakker',     email: 'thomas@wavelink.demo',     role: 'support', partnerId: 'wavelink',  departments: [],                  lang: 'en' },
    // Agents
    { id: 'agent_sarah',    name: 'Sarah Verhoeven',   email: 'sarah@wavelink.demo',      role: 'agent',   partnerId: 'wavelink',  departments: ['network-ops'],     lang: 'nl' },
    { id: 'agent_noah',     name: 'Noah De Bruyne',    email: 'noah@wavelink.demo',       role: 'agent',   partnerId: 'wavelink',  departments: ['customer-care'],   lang: 'nl' },
    { id: 'agent_chloe',    name: 'Chloe Fontaine',    email: 'chloe@wavelink.demo',      role: 'agent',   partnerId: 'wavelink',  departments: ['billing'],         lang: 'fr' },
    { id: 'agent_tom',      name: 'Tom Williams',      email: 'tom@wavelink.demo',        role: 'agent',   partnerId: 'wavelink',  departments: ['technical-support'], lang: 'en' },

    // ── GreenLeaf Insurance ──
    // Admin
    { id: 'admin_dirk',     name: 'Dirk De Smedt',    email: 'dirk@greenleaf.demo',      role: 'admin',   partnerId: 'greenleaf', departments: [],                  lang: 'nl' },
    // Support
    { id: 'support_sophie', name: 'Sophie Laurent',    email: 'sophie@greenleaf.demo',    role: 'support', partnerId: 'greenleaf', departments: ['claims'],          lang: 'fr' },
    { id: 'support_piet',   name: 'Piet Van Damme',    email: 'piet@greenleaf.demo',      role: 'support', partnerId: 'greenleaf', departments: ['policy-support'],  lang: 'nl' },
    { id: 'support_nora',   name: 'Nora Peeters',      email: 'nora@greenleaf.demo',      role: 'support', partnerId: 'greenleaf', departments: [],                  lang: 'nl' },
    // Agents
    { id: 'agent_lisa',     name: 'Lisa Janssens',     email: 'lisa@greenleaf.demo',      role: 'agent',   partnerId: 'greenleaf', departments: ['claims'],          lang: 'nl' },
    { id: 'agent_karim',    name: 'Karim Benali',      email: 'karim@greenleaf.demo',     role: 'agent',   partnerId: 'greenleaf', departments: ['policy-support'],  lang: 'fr' },
    { id: 'agent_emma',     name: 'Emma Claes',        email: 'emma@greenleaf.demo',      role: 'agent',   partnerId: 'greenleaf', departments: ['commercial'],      lang: 'nl' },
    { id: 'agent_alex',     name: 'Alex Johnson',      email: 'alex@greenleaf.demo',      role: 'agent',   partnerId: 'greenleaf', departments: ['claims'],          lang: 'en' },
  ];

  for (const u of demoUsers) {
    await db.insert(users).values({
      id: u.id, name: u.name, email: u.email, lang: u.lang,
      password: hashed,
      isPlatformOperator: u.isPlatformOperator ?? false,
      createdAt: ago(30), updatedAt: NOW,
    });
    await db.insert(memberships).values({
      id: `mem_${u.id}`, userId: u.id, partnerId: u.partnerId,
      role: u.role, departments: u.departments, createdAt: ago(30),
    });
    console.log(`   ${u.role.padEnd(8)} ${u.name} (${u.email})`);
  }

  // Dual-membership: Thomas Bakker also support at GreenLeaf (generalist)
  await db.insert(memberships).values({
    id: 'mem_support_thomas_gl', userId: 'support_thomas', partnerId: 'greenleaf',
    role: 'support', departments: [], createdAt: ago(20),
  });
  console.log('   dual    Thomas Bakker also at GreenLeaf (generalist)');

  // Dual-membership: Nora Peeters also support at WaveLink (customer-care)
  await db.insert(memberships).values({
    id: 'mem_support_nora_wl', userId: 'support_nora', partnerId: 'wavelink',
    role: 'support', departments: ['customer-care'], createdAt: ago(20),
  });
  console.log('   dual    Nora Peeters also at WaveLink (customer-care)');

  // Platform operator gets GreenLeaf access too
  await db.insert(memberships).values({
    id: 'mem_platform_bart_gl', userId: 'platform_bart', partnerId: 'greenleaf',
    role: 'admin', departments: [], createdAt: ago(30),
  });
  console.log('   dual    Bart Claessens also at GreenLeaf (admin)\n');

  // ── 4. LABELS ──────────────────────────────────────────────────────────────
  console.log('④ Creating labels...');

  const allLabels = [
    // WaveLink
    { id: 'lbl_wl_vip',            partnerId: 'wavelink',   name: 'VIP',              color: '#ca8a04' },
    { id: 'lbl_wl_urgent',         partnerId: 'wavelink',   name: 'Urgent',           color: '#dc2626' },
    { id: 'lbl_wl_billing_issue',  partnerId: 'wavelink',   name: 'Billing Issue',    color: '#2563eb' },
    { id: 'lbl_wl_network_outage', partnerId: 'wavelink',   name: 'Network Outage',   color: '#ea580c' },
    { id: 'lbl_wl_follow_up',      partnerId: 'wavelink',   name: 'Follow-up',        color: '#0891b2' },
    { id: 'lbl_wl_new_customer',   partnerId: 'wavelink',   name: 'New Customer',     color: '#16a34a' },
    { id: 'lbl_wl_hardware',       partnerId: 'wavelink',   name: 'Hardware',         color: '#7c3aed' },
    { id: 'lbl_wl_escalated',      partnerId: 'wavelink',   name: 'Escalated',        color: '#be123c' },
    // GreenLeaf
    { id: 'lbl_gl_vip',            partnerId: 'greenleaf',  name: 'VIP',              color: '#ca8a04' },
    { id: 'lbl_gl_urgent',         partnerId: 'greenleaf',  name: 'Urgent',           color: '#dc2626' },
    { id: 'lbl_gl_claim_pending',  partnerId: 'greenleaf',  name: 'Claim Pending',    color: '#ea580c' },
    { id: 'lbl_gl_policy_renewal', partnerId: 'greenleaf',  name: 'Policy Renewal',   color: '#2563eb' },
    { id: 'lbl_gl_fraud_alert',    partnerId: 'greenleaf',  name: 'Fraud Alert',      color: '#be123c' },
    { id: 'lbl_gl_follow_up',      partnerId: 'greenleaf',  name: 'Follow-up',        color: '#0891b2' },
    { id: 'lbl_gl_commercial',     partnerId: 'greenleaf',  name: 'Commercial',       color: '#16a34a' },
    { id: 'lbl_gl_escalated',      partnerId: 'greenleaf',  name: 'Escalated',        color: '#7c3aed' },
  ];

  for (const l of allLabels) {
    await db.insert(labels).values(l);
  }
  console.log(`   ${allLabels.length} labels created (8 WaveLink + 8 GreenLeaf)\n`);

  // ── 5. CANNED RESPONSES ────────────────────────────────────────────────────
  console.log('⑤ Creating canned responses...');

  const cannedData = [
    // WaveLink
    { partnerId: 'wavelink',  title: 'Greeting',                 shortcut: '/hi',       body: 'Hello! Thank you for contacting WaveLink support. How can I help you today?', createdBy: 'support_jan' },
    { partnerId: 'wavelink',  title: 'Troubleshoot Restart',     shortcut: '/restart',  body: 'Please try restarting your router by unplugging it for 30 seconds, then plugging it back in. Wait 2-3 minutes for all lights to stabilize before testing your connection.', createdBy: 'support_jan' },
    { partnerId: 'wavelink',  title: 'Escalation Notice',        shortcut: '/esc',      body: 'I am escalating this to our senior technical team. They will follow up within 24 hours. Your reference number has been noted.', createdBy: 'support_amelie' },
    { partnerId: 'wavelink',  title: 'Closing',                  shortcut: '/close',    body: 'Is there anything else I can help you with? If not, I will close this ticket. You can always reopen it if the issue returns.', createdBy: 'support_jan' },
    { partnerId: 'wavelink',  title: 'Speed Test Request',       shortcut: '/speed',    body: 'Could you please run a speed test at speedtest.net and share the results? Make sure you are connected via ethernet cable for the most accurate reading.', createdBy: 'support_thomas' },
    { partnerId: 'wavelink',  title: 'Outage Acknowledged',      shortcut: '/outage',   body: 'We are aware of the service disruption in your area. Our network team is actively working on restoring connectivity. We will update you as soon as we have more information.', createdBy: 'support_jan' },
    // GreenLeaf
    { partnerId: 'greenleaf', title: 'Greeting',                 shortcut: '/hi',       body: 'Welcome to GreenLeaf Insurance support. How can I assist you today?', createdBy: 'support_sophie' },
    { partnerId: 'greenleaf', title: 'Claim Documents Needed',   shortcut: '/docs',     body: 'To process your claim, we will need the following documents: police report (if applicable), photographs of damage, repair estimates, and your signed declaration form.', createdBy: 'support_sophie' },
    { partnerId: 'greenleaf', title: 'Policy Check',             shortcut: '/policy',   body: 'Let me pull up your policy details. Could you confirm your policy number? It starts with GL- followed by the product type.', createdBy: 'support_piet' },
    { partnerId: 'greenleaf', title: 'Closing',                  shortcut: '/close',    body: 'Thank you for choosing GreenLeaf Insurance. Is there anything else I can help you with today?', createdBy: 'support_nora' },
    { partnerId: 'greenleaf', title: 'Escalation to Specialist', shortcut: '/esc',      body: 'I am forwarding this to our claims specialist who will review your case in detail. You will receive a response within 2 business days.', createdBy: 'support_sophie' },
  ];

  for (const c of cannedData) {
    await db.insert(cannedResponses).values({
      id: uid(), partnerId: c.partnerId, title: c.title, shortcut: c.shortcut,
      body: c.body, createdBy: c.createdBy,
      createdAt: ago(20), updatedAt: NOW,
    });
  }
  console.log(`   ${cannedData.length} canned responses (6 WaveLink + 5 GreenLeaf)\n`);

  // ── 6. KB ARTICLES ─────────────────────────────────────────────────────────
  console.log('⑥ Creating knowledge base articles...');

  const kbData = [
    // WaveLink
    {
      partnerId: 'wavelink', title: 'Router Setup Guide', dept: 'technical-support',
      slug: 'router-setup-guide', tags: ['router', 'setup', 'installation'],
      body: '## Router Setup Guide\n\n1. Connect the power cable to the router and plug it in\n2. Connect the WAN cable from the wall outlet to the blue WAN port\n3. Wait 2-3 minutes for the router to boot\n4. Connect your device to the WiFi network printed on the sticker under the router\n5. Open a browser and navigate to 192.168.1.1 to complete setup\n\nDefault credentials are on the sticker. Change the WiFi password during first setup.',
      createdBy: 'admin_katrien',
    },
    {
      partnerId: 'wavelink', title: 'Speed Test Troubleshooting', dept: 'network-ops',
      slug: 'speed-test-troubleshooting', tags: ['speed', 'troubleshooting', 'bandwidth'],
      body: '## When Speeds Are Slow\n\n### Quick checks\n- Use an ethernet cable for accurate results\n- Close background applications and streaming\n- Test at different times of day\n\n### If speeds remain low\n1. Restart your router (unplug 30s)\n2. Check the line status lights — Internet LED should be solid green\n3. Run a trace route: `tracert wavelink.be`\n4. Contact support with your speed test results\n\n**Expected speeds**: Fiber 300-900 Mbps down, DSL 30-100 Mbps down.',
      createdBy: 'admin_katrien',
    },
    {
      partnerId: 'wavelink', title: 'WiFi Coverage Tips', dept: 'technical-support',
      slug: 'wifi-coverage-tips', tags: ['wifi', 'coverage', 'mesh'],
      body: '## Improving WiFi Signal\n\n### Router placement\n- Central location in your home\n- Elevated position (shelf or wall mount)\n- Away from microwaves, baby monitors, and thick walls\n\n### For large homes\n- Consider a WaveLink Mesh kit (available for EUR 4.99/mo rental)\n- Each mesh node covers approximately 80m2\n- Place nodes within line of sight of each other\n\n### Channel optimization\n- Access router settings at 192.168.1.1\n- Navigate to WiFi > Advanced > Channel\n- Use Auto or try channels 1, 6, or 11 for 2.4GHz',
      createdBy: 'admin_katrien',
    },
    // GreenLeaf
    {
      partnerId: 'greenleaf', title: 'How to File a Claim', dept: 'claims',
      slug: 'how-to-file-a-claim', tags: ['claim', 'filing', 'process'],
      body: '## Filing an Insurance Claim\n\n### Step 1: Report the incident\nContact us within 48 hours via chat, phone, or the online portal.\n\n### Step 2: Document the damage\n- Take clear photographs of all damage\n- Note the date, time, and circumstances\n- Keep damaged items until the adjuster visits\n\n### Step 3: Submit documents\n- Police report (for theft, vandalism, or accidents)\n- Repair estimates from certified contractors\n- Signed declaration form (available in your portal)\n\n### Step 4: Adjuster visit\nFor claims exceeding EUR 2,000, an adjuster will visit within 5 business days.\n\n### Step 5: Decision\nTypically within 10 business days of a complete file.',
      createdBy: 'admin_dirk',
    },
    {
      partnerId: 'greenleaf', title: 'Understanding Your Policy', dept: 'policy-support',
      slug: 'understanding-your-policy', tags: ['policy', 'coverage', 'terms'],
      body: '## Common Policy Terms\n\n**Premium**: The amount you pay monthly or annually for coverage.\n\n**Deductible (franchise)**: The amount you pay out of pocket before insurance covers the rest. Standard: EUR 250 for home, EUR 500 for auto.\n\n**Coverage limit**: Maximum amount the insurer will pay per incident.\n\n**Exclusions**: Events not covered (e.g., intentional damage, war, nuclear events).\n\n## Your GreenLeaf Policy Number\nFormat: `GL-[PRODUCT]-[NUMBER]`\n- GL-HOME: Home insurance\n- GL-AUTO: Car insurance\n- GL-LIFE: Life insurance\n- GL-TRAV: Travel insurance',
      createdBy: 'admin_dirk',
    },
    {
      partnerId: 'greenleaf', title: 'What to Do After a Car Accident', dept: 'claims',
      slug: 'after-car-accident', tags: ['accident', 'car', 'auto', 'emergency'],
      body: '## Immediate Steps After a Car Accident\n\n1. **Ensure safety** — Check for injuries, move to a safe location if possible\n2. **Call emergency services** if anyone is injured (112)\n3. **Exchange information** — Names, insurance details, license plates\n4. **Fill in the accident declaration form** (keep one in your glove box)\n5. **Take photographs** — Damage to all vehicles, road conditions, traffic signs\n6. **Contact GreenLeaf** within 48 hours via chat or phone\n\n### Do NOT\n- Admit fault at the scene\n- Leave the scene before exchanging information\n- Delay reporting to your insurer',
      createdBy: 'admin_dirk',
    },
  ];

  for (const kb of kbData) {
    await db.insert(kbArticles).values({
      id: uid(), partnerId: kb.partnerId, title: kb.title, dept: kb.dept,
      slug: kb.slug, tags: kb.tags, body: kb.body, createdBy: kb.createdBy,
      published: true, createdAt: ago(15), updatedAt: NOW,
    });
  }
  console.log(`   ${kbData.length} KB articles (3 WaveLink + 3 GreenLeaf)\n`);

  // ── 7. TICKETS + MESSAGES ──────────────────────────────────────────────────
  console.log('⑦ Creating tickets with conversations...');

  interface TicketMsg {
    senderId: string; senderName: string; senderRole: string;
    senderLang: string; text: string; daysAgo: number; hoursAgo?: number;
    whisper?: boolean; system?: boolean;
  }

  interface TicketDef {
    id: string; partnerId: string; dept: string;
    agent: { id: string; name: string; lang: string };
    support?: { id: string; name: string; lang: string };
    status: 'open' | 'pending' | 'closed' | 'resolved';
    labels?: string[]; createdDaysAgo: number;
    closedDaysAgo?: number;
    messages: TicketMsg[];
    refs?: Array<{ label: string; value: string }>;
  }

  async function createTicket(t: TicketDef) {
    const participants: Array<{ id: string; name: string; role?: string; lang?: string }> = [
      { id: t.agent.id, name: t.agent.name, role: 'agent', lang: t.agent.lang },
    ];
    if (t.support) {
      participants.push({ id: t.support.id, name: t.support.name, role: 'support', lang: t.support.lang });
    }

    await db.insert(tickets).values({
      id: t.id, partnerId: t.partnerId, dept: t.dept,
      agentId: t.agent.id, agentName: t.agent.name, agentLang: t.agent.lang,
      references: t.refs ?? [],
      status: t.status,
      supportId: t.support?.id ?? null, supportName: t.support?.name ?? null,
      supportLang: t.support?.lang ?? null,
      supportJoinedAt: t.support ? ago(t.createdDaysAgo, 0, -10) : null,
      participants,
      createdAt: ago(t.createdDaysAgo), updatedAt: NOW,
      closedAt: t.closedDaysAgo != null ? ago(t.closedDaysAgo) : null,
    });

    for (let i = 0; i < t.messages.length; i++) {
      const m = t.messages[i];
      await db.insert(messages).values({
        id: `${t.id}_msg${i + 1}`, ticketId: t.id,
        senderId: m.senderId, senderName: m.senderName,
        senderRole: m.senderRole, senderLang: m.senderLang,
        text: m.text,
        whisper: m.whisper ? 1 : 0,
        system: m.system ? 1 : 0,
        createdAt: ago(m.daysAgo, m.hoursAgo ?? 0),
        deliveredAt: ago(m.daysAgo, m.hoursAgo ?? 0),
        readAt: ago(m.daysAgo, m.hoursAgo ?? 0),
      });
    }

    if (t.labels?.length) {
      for (const lbl of t.labels) {
        await db.insert(ticketLabels).values({ ticketId: t.id, labelId: lbl });
      }
    }
    console.log(`   ${t.id} [${t.status.padEnd(8)}] ${t.dept}`);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // WAVELINK TICKETS (~25)
  // ═══════════════════════════════════════════════════════════════════════════

  // ── WL-01: Open — Internet dropping (active conversation)
  await createTicket({
    id: 'wl_tk_01', partnerId: 'wavelink', dept: 'network-ops',
    agent: { id: 'agent_sarah', name: 'Sarah Verhoeven', lang: 'nl' },
    support: { id: 'support_jan', name: 'Jan Willems', lang: 'nl' },
    status: 'open', labels: ['lbl_wl_network_outage', 'lbl_wl_urgent'], createdDaysAgo: 1,
    refs: [{ label: 'Account', value: 'WL-2024-88741' }],
    messages: [
      { senderId: 'agent_sarah', senderName: 'Sarah Verhoeven', senderRole: 'agent', senderLang: 'nl', text: 'Hallo, mijn internet valt om de 10 minuten weg sinds gisterenavond. Ik heb al geprobeerd de router te herstarten maar dat helpt niet.', daysAgo: 1 },
      { senderId: 'support_jan', senderName: 'Jan Willems', senderRole: 'support', senderLang: 'nl', text: 'Goedendag Sarah, vervelend om te horen. Ik check even je lijnstatus. Gaat het om WiFi of ook bedraad?', daysAgo: 1, hoursAgo: -1 },
      { senderId: 'agent_sarah', senderName: 'Sarah Verhoeven', senderRole: 'agent', senderLang: 'nl', text: 'Zowel WiFi als ethernet via kabel. Alles valt tegelijk weg.', daysAgo: 1, hoursAgo: -2 },
      { senderId: 'support_jan', senderName: 'Jan Willems', senderRole: 'support', senderLang: 'nl', text: 'Ik zie inderdaad instabiliteit op je lijn. Er lijkt een probleem te zijn aan de wijkcentrale. Ik open een prioriteitsticket bij het netwerk-team.', daysAgo: 0, hoursAgo: 6 },
    ],
  });

  // ── WL-02: Open — Billing dispute (unassigned)
  await createTicket({
    id: 'wl_tk_02', partnerId: 'wavelink', dept: 'billing',
    agent: { id: 'agent_chloe', name: 'Chloe Fontaine', lang: 'fr' },
    status: 'open', labels: ['lbl_wl_billing_issue'], createdDaysAgo: 0,
    refs: [{ label: 'Facture', value: 'INV-2026-03-4412' }],
    messages: [
      { senderId: 'agent_chloe', senderName: 'Chloe Fontaine', senderRole: 'agent', senderLang: 'fr', text: 'Bonjour, je viens de consulter ma facture de mars et le montant de 49,99 EUR apparait deux fois. Pouvez-vous verifier?', daysAgo: 0, hoursAgo: 2 },
    ],
  });

  // ── WL-03: Open — Corporate plan upgrade (VIP)
  await createTicket({
    id: 'wl_tk_03', partnerId: 'wavelink', dept: 'customer-care',
    agent: { id: 'agent_noah', name: 'Noah De Bruyne', lang: 'nl' },
    support: { id: 'support_thomas', name: 'Thomas Bakker', lang: 'en' },
    status: 'open', labels: ['lbl_wl_vip', 'lbl_wl_billing_issue'], createdDaysAgo: 0,
    refs: [{ label: 'Company', value: 'NovaTech Industries' }, { label: 'Contract', value: 'CORP-2025-1100' }],
    messages: [
      { senderId: 'agent_noah', senderName: 'Noah De Bruyne', senderRole: 'agent', senderLang: 'nl', text: 'We are expanding to 50 offices and need to upgrade our corporate plan. Can we get a volume discount for the additional 30 locations?', daysAgo: 0, hoursAgo: 4 },
      { senderId: 'support_thomas', senderName: 'Thomas Bakker', senderRole: 'support', senderLang: 'en', text: 'Hi Noah, great to hear about the expansion! For 50+ locations you qualify for our Enterprise tier with a 20% volume discount and dedicated account manager. Let me prepare a formal quote.', daysAgo: 0, hoursAgo: 3 },
    ],
  });

  // ── WL-04: Open — WiFi dead spots
  await createTicket({
    id: 'wl_tk_04', partnerId: 'wavelink', dept: 'technical-support',
    agent: { id: 'agent_tom', name: 'Tom Williams', lang: 'en' },
    status: 'open', labels: ['lbl_wl_hardware'], createdDaysAgo: 0,
    messages: [
      { senderId: 'agent_tom', senderName: 'Tom Williams', senderRole: 'agent', senderLang: 'en', text: 'My WiFi signal is very weak in the upstairs bedrooms. The router is in the living room downstairs. Is there a mesh system I can add?', daysAgo: 0, hoursAgo: 1 },
    ],
  });

  // ── WL-05: Open — New customer setup
  await createTicket({
    id: 'wl_tk_05', partnerId: 'wavelink', dept: 'customer-care',
    agent: { id: 'agent_sarah', name: 'Sarah Verhoeven', lang: 'nl' },
    support: { id: 'support_amelie', name: 'Amelie Rousseau', lang: 'fr' },
    status: 'open', labels: ['lbl_wl_new_customer'], createdDaysAgo: 2,
    messages: [
      { senderId: 'agent_sarah', senderName: 'Sarah Verhoeven', senderRole: 'agent', senderLang: 'nl', text: 'Ik ben net overgestapt naar WaveLink. Wanneer wordt mijn glasvezel geactiveerd?', daysAgo: 2 },
      { senderId: 'support_amelie', senderName: 'Amelie Rousseau', senderRole: 'support', senderLang: 'fr', text: 'Welkom bij WaveLink, Sarah! Ik check even de activatiestatus. Heb je al een installatiedatum ontvangen per email?', daysAgo: 2, hoursAgo: -1 },
      { senderId: 'agent_sarah', senderName: 'Sarah Verhoeven', senderRole: 'agent', senderLang: 'nl', text: 'Nee, ik heb alleen een bevestiging van mijn bestelling gekregen, maar geen datum.', daysAgo: 2, hoursAgo: -2 },
    ],
  });

  // ── WL-06: Open — Slow speeds after outage
  await createTicket({
    id: 'wl_tk_06', partnerId: 'wavelink', dept: 'network-ops',
    agent: { id: 'agent_noah', name: 'Noah De Bruyne', lang: 'nl' },
    support: { id: 'support_jan', name: 'Jan Willems', lang: 'nl' },
    status: 'open', labels: ['lbl_wl_network_outage', 'lbl_wl_follow_up'], createdDaysAgo: 3,
    messages: [
      { senderId: 'agent_noah', senderName: 'Noah De Bruyne', senderRole: 'agent', senderLang: 'nl', text: 'Sinds de storing van vorige week zijn mijn snelheden nog steeds maar de helft van wat ze moeten zijn. Download is 45 Mbps in plaats van 100.', daysAgo: 3 },
      { senderId: 'support_jan', senderName: 'Jan Willems', senderRole: 'support', senderLang: 'nl', text: 'Ik kijk even naar je lijnmetingen. Kan je een speedtest doen via speedtest.net en het resultaat hier delen?', daysAgo: 3, hoursAgo: -1 },
      { senderId: 'agent_noah', senderName: 'Noah De Bruyne', senderRole: 'agent', senderLang: 'nl', text: 'Download: 47.3 Mbps, Upload: 8.2 Mbps. Normaal haal ik 100/20.', daysAgo: 3, hoursAgo: -2 },
      { senderId: 'support_jan', senderName: 'Jan Willems', senderRole: 'support', senderLang: 'nl', text: 'Bedankt. Ik zie dat er nog steeds een capaciteitsprobleem is op je aansluitpunt. Ik heb het doorgegeven aan het infrastructuurteam voor prioriteitsbehandeling.', daysAgo: 2 },
      { senderId: 'support_jan', senderName: 'Jan Willems', senderRole: 'support', senderLang: 'nl', text: 'Interne opmerking: Wijkcentrale Berchem heeft nog steeds verminderde capaciteit na de storing van 28/03. Infra-ticket #NW-4821 is aangemaakt.', daysAgo: 2, whisper: true },
    ],
  });

  // ── WL-07: Open — Phone line issue
  await createTicket({
    id: 'wl_tk_07', partnerId: 'wavelink', dept: 'technical-support',
    agent: { id: 'agent_chloe', name: 'Chloe Fontaine', lang: 'fr' },
    status: 'open', labels: [], createdDaysAgo: 1,
    messages: [
      { senderId: 'agent_chloe', senderName: 'Chloe Fontaine', senderRole: 'agent', senderLang: 'fr', text: 'Mon telephone fixe ne fonctionne plus depuis ce matin. Internet fonctionne normalement par contre.', daysAgo: 1, hoursAgo: 3 },
    ],
  });

  // ── WL-08: Open — Email setup question
  await createTicket({
    id: 'wl_tk_08', partnerId: 'wavelink', dept: 'customer-care',
    agent: { id: 'agent_tom', name: 'Tom Williams', lang: 'en' },
    support: { id: 'support_amelie', name: 'Amelie Rousseau', lang: 'fr' },
    status: 'open', labels: ['lbl_wl_new_customer'], createdDaysAgo: 1,
    messages: [
      { senderId: 'agent_tom', senderName: 'Tom Williams', senderRole: 'agent', senderLang: 'en', text: 'I just got my WaveLink account. How do I set up my @wavelink.be email address?', daysAgo: 1 },
      { senderId: 'support_amelie', senderName: 'Amelie Rousseau', senderRole: 'support', senderLang: 'fr', text: 'Welcome Tom! You can set up your WaveLink email at mail.wavelink.be. Log in with your customer number and the temporary password from your welcome letter.', daysAgo: 1, hoursAgo: -1 },
      { senderId: 'agent_tom', senderName: 'Tom Williams', senderRole: 'agent', senderLang: 'en', text: 'Thanks! I found the welcome letter. All set up now.', daysAgo: 0 },
    ],
  });

  // ── WL-09: Pending — Router replacement
  await createTicket({
    id: 'wl_tk_09', partnerId: 'wavelink', dept: 'technical-support',
    agent: { id: 'agent_sarah', name: 'Sarah Verhoeven', lang: 'nl' },
    support: { id: 'support_thomas', name: 'Thomas Bakker', lang: 'en' },
    status: 'pending', labels: ['lbl_wl_hardware'], createdDaysAgo: 4,
    messages: [
      { senderId: 'agent_sarah', senderName: 'Sarah Verhoeven', senderRole: 'agent', senderLang: 'nl', text: 'Mijn router maakt een hoog piepgeluid en wordt heel warm. Ik denk dat hij kapot is.', daysAgo: 4 },
      { senderId: 'support_thomas', senderName: 'Thomas Bakker', senderRole: 'support', senderLang: 'en', text: 'That does sound like a hardware issue. I am ordering a replacement router for you. It should arrive within 2 business days via bpost.', daysAgo: 4, hoursAgo: -2 },
      { senderId: 'support_thomas', senderName: 'Thomas Bakker', senderRole: 'support', senderLang: 'en', text: 'Replacement shipped, tracking: BP-2026-44821. Awaiting delivery confirmation.', daysAgo: 3, whisper: true },
    ],
  });

  // ── WL-10: Pending — Payment plan request
  await createTicket({
    id: 'wl_tk_10', partnerId: 'wavelink', dept: 'billing',
    agent: { id: 'agent_noah', name: 'Noah De Bruyne', lang: 'nl' },
    support: { id: 'support_thomas', name: 'Thomas Bakker', lang: 'en' },
    status: 'pending', labels: ['lbl_wl_billing_issue'], createdDaysAgo: 6,
    messages: [
      { senderId: 'agent_noah', senderName: 'Noah De Bruyne', senderRole: 'agent', senderLang: 'nl', text: 'Ik heb een achterstallige factuur van 289 EUR. Is het mogelijk om dit in 3 termijnen te betalen?', daysAgo: 6 },
      { senderId: 'support_thomas', senderName: 'Thomas Bakker', senderRole: 'support', senderLang: 'en', text: 'I can set up a payment plan for you. Let me check with our billing department if 3 installments is possible for this amount.', daysAgo: 6, hoursAgo: -3 },
      { senderId: 'support_thomas', senderName: 'Thomas Bakker', senderRole: 'support', senderLang: 'en', text: 'Good news: billing has approved a 3-month plan. I am sending the agreement to your email for signature.', daysAgo: 5 },
    ],
  });

  // ── WL-11: Pending — Service upgrade waiting on technician
  await createTicket({
    id: 'wl_tk_11', partnerId: 'wavelink', dept: 'network-ops',
    agent: { id: 'agent_chloe', name: 'Chloe Fontaine', lang: 'fr' },
    support: { id: 'support_jan', name: 'Jan Willems', lang: 'nl' },
    status: 'pending', labels: ['lbl_wl_follow_up'], createdDaysAgo: 8,
    messages: [
      { senderId: 'agent_chloe', senderName: 'Chloe Fontaine', senderRole: 'agent', senderLang: 'fr', text: 'Je souhaite passer de DSL a la fibre. Quand est-ce qu un technicien peut venir?', daysAgo: 8 },
      { senderId: 'support_jan', senderName: 'Jan Willems', senderRole: 'support', senderLang: 'nl', text: 'Bonjour Chloe, la fibre est disponible dans votre rue. Je programme une visite technique. Les creneaux disponibles sont lundi ou mercredi prochains.', daysAgo: 8, hoursAgo: -2 },
      { senderId: 'agent_chloe', senderName: 'Chloe Fontaine', senderRole: 'agent', senderLang: 'fr', text: 'Mercredi matin serait parfait.', daysAgo: 7 },
      { senderId: 'support_jan', senderName: 'Jan Willems', senderRole: 'support', senderLang: 'nl', text: 'Confirme pour mercredi entre 9h et 12h. Vous recevrez un SMS de confirmation la veille.', daysAgo: 7, hoursAgo: -1 },
    ],
  });

  // ── WL-12: Pending — Waiting on customer response
  await createTicket({
    id: 'wl_tk_12', partnerId: 'wavelink', dept: 'customer-care',
    agent: { id: 'agent_tom', name: 'Tom Williams', lang: 'en' },
    support: { id: 'support_amelie', name: 'Amelie Rousseau', lang: 'fr' },
    status: 'pending', labels: [], createdDaysAgo: 5,
    messages: [
      { senderId: 'agent_tom', senderName: 'Tom Williams', senderRole: 'agent', senderLang: 'en', text: 'I want to cancel my TV subscription but keep internet. How much will the new price be?', daysAgo: 5 },
      { senderId: 'support_amelie', senderName: 'Amelie Rousseau', senderRole: 'support', senderLang: 'fr', text: 'If you drop the TV package, your monthly rate goes from EUR 79.99 to EUR 49.99 for internet only. The change takes effect at the next billing cycle. Should I process this?', daysAgo: 5, hoursAgo: -2 },
    ],
  });

  // ── WL-13: Resolved — Parental controls setup
  await createTicket({
    id: 'wl_tk_13', partnerId: 'wavelink', dept: 'customer-care',
    agent: { id: 'agent_noah', name: 'Noah De Bruyne', lang: 'nl' },
    support: { id: 'support_amelie', name: 'Amelie Rousseau', lang: 'fr' },
    status: 'resolved', labels: [], createdDaysAgo: 10, closedDaysAgo: 9,
    messages: [
      { senderId: 'agent_noah', senderName: 'Noah De Bruyne', senderRole: 'agent', senderLang: 'nl', text: 'Ik wil ouderlijk toezicht instellen op de router. Mijn kinderen blijven te lang op YouTube.', daysAgo: 10 },
      { senderId: 'support_amelie', senderName: 'Amelie Rousseau', senderRole: 'support', senderLang: 'fr', text: 'Dat kan! Ga naar 192.168.1.1, log in met de gegevens op de sticker onder je router, en navigeer naar Beveiliging > Ouderlijk toezicht.', daysAgo: 10, hoursAgo: -1 },
      { senderId: 'agent_noah', senderName: 'Noah De Bruyne', senderRole: 'agent', senderLang: 'nl', text: 'Gevonden! Kan ik per apparaat een tijdschema instellen?', daysAgo: 10, hoursAgo: -2 },
      { senderId: 'support_amelie', senderName: 'Amelie Rousseau', senderRole: 'support', senderLang: 'fr', text: 'Precies! Maak een profiel "Kids" aan zodat je alle apparaten tegelijk kunt beheren.', daysAgo: 9 },
      { senderId: 'agent_noah', senderName: 'Noah De Bruyne', senderRole: 'agent', senderLang: 'nl', text: 'Perfect, alles staat ingesteld. Bedankt voor de snelle hulp!', daysAgo: 9, hoursAgo: -1 },
    ],
  });

  // ── WL-14: Resolved — DNS configuration
  await createTicket({
    id: 'wl_tk_14', partnerId: 'wavelink', dept: 'technical-support',
    agent: { id: 'agent_tom', name: 'Tom Williams', lang: 'en' },
    support: { id: 'support_jan', name: 'Jan Willems', lang: 'nl' },
    status: 'resolved', labels: [], createdDaysAgo: 12, closedDaysAgo: 12,
    messages: [
      { senderId: 'agent_tom', senderName: 'Tom Williams', senderRole: 'agent', senderLang: 'en', text: 'Some websites are not loading but others work fine. I think it might be a DNS issue.', daysAgo: 12 },
      { senderId: 'support_jan', senderName: 'Jan Willems', senderRole: 'support', senderLang: 'nl', text: 'That sounds like a DNS resolution issue. Try changing your DNS to 1.1.1.1 (Cloudflare) or 8.8.8.8 (Google). You can do this in your router settings under Network > DNS.', daysAgo: 12, hoursAgo: -1 },
      { senderId: 'agent_tom', senderName: 'Tom Williams', senderRole: 'agent', senderLang: 'en', text: 'Changed to 1.1.1.1 and everything works now. Thanks for the quick fix!', daysAgo: 12, hoursAgo: -2 },
    ],
  });

  // ── WL-15: Resolved — Invoice explanation
  await createTicket({
    id: 'wl_tk_15', partnerId: 'wavelink', dept: 'billing',
    agent: { id: 'agent_sarah', name: 'Sarah Verhoeven', lang: 'nl' },
    support: { id: 'support_thomas', name: 'Thomas Bakker', lang: 'en' },
    status: 'resolved', labels: ['lbl_wl_billing_issue'], createdDaysAgo: 14, closedDaysAgo: 13,
    messages: [
      { senderId: 'agent_sarah', senderName: 'Sarah Verhoeven', senderRole: 'agent', senderLang: 'nl', text: 'Er staan kosten op mijn factuur voor "apparaathuur" maar ik heb mijn eigen router gekocht. Klopt dit?', daysAgo: 14 },
      { senderId: 'support_thomas', senderName: 'Thomas Bakker', senderRole: 'support', senderLang: 'en', text: 'I can see the equipment rental charge. If you are using your own router, this should not apply. Let me remove it and issue a credit for the past 3 months.', daysAgo: 14, hoursAgo: -2 },
      { senderId: 'agent_sarah', senderName: 'Sarah Verhoeven', senderRole: 'agent', senderLang: 'nl', text: 'Geweldig, bedankt! Ik gebruik al sinds het begin mijn eigen router.', daysAgo: 13 },
      { senderId: 'support_thomas', senderName: 'Thomas Bakker', senderRole: 'support', senderLang: 'en', text: 'Done! A credit of EUR 14.97 (3 x EUR 4.99) has been applied. It will appear on your next invoice.', daysAgo: 13, hoursAgo: -1 },
    ],
  });

  // ── WL-16: Resolved — 5G coverage question
  await createTicket({
    id: 'wl_tk_16', partnerId: 'wavelink', dept: 'customer-care',
    agent: { id: 'agent_chloe', name: 'Chloe Fontaine', lang: 'fr' },
    support: { id: 'support_amelie', name: 'Amelie Rousseau', lang: 'fr' },
    status: 'resolved', labels: [], createdDaysAgo: 15, closedDaysAgo: 14,
    messages: [
      { senderId: 'agent_chloe', senderName: 'Chloe Fontaine', senderRole: 'agent', senderLang: 'fr', text: 'Quand la 5G sera-t-elle disponible a Namur? Mon contrat se termine bientot.', daysAgo: 15 },
      { senderId: 'support_amelie', senderName: 'Amelie Rousseau', senderRole: 'support', senderLang: 'fr', text: 'Namur-centre est prevu pour le T3 2026 dans notre feuille de route 5G. Je vous enverrai une notification des que c est active.', daysAgo: 15, hoursAgo: -2 },
      { senderId: 'agent_chloe', senderName: 'Chloe Fontaine', senderRole: 'agent', senderLang: 'fr', text: 'Super, je vais renouveler. Merci!', daysAgo: 14 },
    ],
  });

  // ── WL-17: Resolved — Port forwarding
  await createTicket({
    id: 'wl_tk_17', partnerId: 'wavelink', dept: 'technical-support',
    agent: { id: 'agent_noah', name: 'Noah De Bruyne', lang: 'nl' },
    support: { id: 'support_jan', name: 'Jan Willems', lang: 'nl' },
    status: 'resolved', labels: [], createdDaysAgo: 18, closedDaysAgo: 17,
    messages: [
      { senderId: 'agent_noah', senderName: 'Noah De Bruyne', senderRole: 'agent', senderLang: 'nl', text: 'Ik moet port forwarding instellen voor mijn NAS op poort 5000. Hoe doe ik dat?', daysAgo: 18 },
      { senderId: 'support_jan', senderName: 'Jan Willems', senderRole: 'support', senderLang: 'nl', text: 'Ga naar 192.168.1.1 > Geavanceerd > Port Forwarding. Voeg een regel toe: extern poort 5000, intern IP van je NAS, intern poort 5000, protocol TCP.', daysAgo: 18, hoursAgo: -1 },
      { senderId: 'agent_noah', senderName: 'Noah De Bruyne', senderRole: 'agent', senderLang: 'nl', text: 'Werkt perfect, ik kan nu van buitenaf bij mijn bestanden. Bedankt!', daysAgo: 17 },
    ],
  });

  // ── WL-18: Resolved — Contract renewal
  await createTicket({
    id: 'wl_tk_18', partnerId: 'wavelink', dept: 'customer-care',
    agent: { id: 'agent_sarah', name: 'Sarah Verhoeven', lang: 'nl' },
    support: { id: 'support_amelie', name: 'Amelie Rousseau', lang: 'fr' },
    status: 'resolved', labels: ['lbl_wl_follow_up'], createdDaysAgo: 20, closedDaysAgo: 19,
    messages: [
      { senderId: 'agent_sarah', senderName: 'Sarah Verhoeven', senderRole: 'agent', senderLang: 'nl', text: 'Mijn contract loopt af volgende maand. Welke promoties zijn er voor bestaande klanten?', daysAgo: 20 },
      { senderId: 'support_amelie', senderName: 'Amelie Rousseau', senderRole: 'support', senderLang: 'fr', text: 'Als trouwe klant bieden we je een upgrade naar ons Fiber Plus pakket voor dezelfde prijs als je huidige abonnement. Dat is 300 Mbps in plaats van 100.', daysAgo: 20, hoursAgo: -2 },
      { senderId: 'agent_sarah', senderName: 'Sarah Verhoeven', senderRole: 'agent', senderLang: 'nl', text: 'Dat klinkt goed! Ik wil graag verlengen met Fiber Plus.', daysAgo: 19 },
      { senderId: 'support_amelie', senderName: 'Amelie Rousseau', senderRole: 'support', senderLang: 'fr', text: 'Geregeld! Je nieuwe contract start op de eerste van volgende maand. De snelheidsupgrade wordt automatisch geactiveerd.', daysAgo: 19, hoursAgo: -1 },
    ],
  });

  // ── WL-19: Closed — Firmware update broke WiFi
  await createTicket({
    id: 'wl_tk_19', partnerId: 'wavelink', dept: 'network-ops',
    agent: { id: 'agent_chloe', name: 'Chloe Fontaine', lang: 'fr' },
    support: { id: 'support_jan', name: 'Jan Willems', lang: 'nl' },
    status: 'closed', labels: ['lbl_wl_escalated'], createdDaysAgo: 7, closedDaysAgo: 6,
    messages: [
      { senderId: 'agent_chloe', senderName: 'Chloe Fontaine', senderRole: 'agent', senderLang: 'fr', text: 'Depuis la mise a jour automatique du routeur hier soir, plus aucune connexion. Le voyant Internet clignote orange.', daysAgo: 7 },
      { senderId: 'support_jan', senderName: 'Jan Willems', senderRole: 'support', senderLang: 'nl', text: 'Bonjour Chloe, the firmware update caused a config reset on your unit. I am pushing a corrected config remotely now. Can you power-cycle the router in 2 minutes?', daysAgo: 7, hoursAgo: -1 },
      { senderId: 'agent_chloe', senderName: 'Chloe Fontaine', senderRole: 'agent', senderLang: 'fr', text: 'C est fait! Le voyant est redevenu vert, tout fonctionne. Merci!', daysAgo: 6 },
      { senderId: 'support_jan', senderName: 'Jan Willems', senderRole: 'support', senderLang: 'nl', text: 'Parfait! I have also flagged this firmware version for review so it does not happen to others. Closing ticket.', daysAgo: 6 },
    ],
  });

  // ── WL-20: Closed — Static IP request
  await createTicket({
    id: 'wl_tk_20', partnerId: 'wavelink', dept: 'network-ops',
    agent: { id: 'agent_tom', name: 'Tom Williams', lang: 'en' },
    support: { id: 'support_jan', name: 'Jan Willems', lang: 'nl' },
    status: 'closed', labels: [], createdDaysAgo: 9, closedDaysAgo: 8,
    messages: [
      { senderId: 'agent_tom', senderName: 'Tom Williams', senderRole: 'agent', senderLang: 'en', text: 'I need a static IP address for my home server. Is this available on my current plan?', daysAgo: 9 },
      { senderId: 'support_jan', senderName: 'Jan Willems', senderRole: 'support', senderLang: 'nl', text: 'Static IP is available as an add-on for EUR 5/month. I can activate it right now if you want.', daysAgo: 9, hoursAgo: -1 },
      { senderId: 'agent_tom', senderName: 'Tom Williams', senderRole: 'agent', senderLang: 'en', text: 'Yes please, activate it.', daysAgo: 8 },
      { senderId: 'support_jan', senderName: 'Jan Willems', senderRole: 'support', senderLang: 'nl', text: 'Done! Your static IP is 81.245.72.194. It will be active after the next router reboot. The EUR 5/month charge starts on your next billing cycle.', daysAgo: 8, hoursAgo: -1 },
    ],
  });

  // ── WL-21: Closed — Outage notification
  await createTicket({
    id: 'wl_tk_21', partnerId: 'wavelink', dept: 'network-ops',
    agent: { id: 'agent_sarah', name: 'Sarah Verhoeven', lang: 'nl' },
    support: { id: 'support_jan', name: 'Jan Willems', lang: 'nl' },
    status: 'closed', labels: ['lbl_wl_network_outage'], createdDaysAgo: 16, closedDaysAgo: 15,
    messages: [
      { senderId: 'agent_sarah', senderName: 'Sarah Verhoeven', senderRole: 'agent', senderLang: 'nl', text: 'Er is geen internet in heel onze straat. Meerdere buren hebben hetzelfde probleem.', daysAgo: 16 },
      { senderId: 'support_jan', senderName: 'Jan Willems', senderRole: 'support', senderLang: 'nl', text: 'Er is een bekende storing in uw regio door een kabelbeschadiging. Onze technici zijn ter plaatse. Verwachte hersteltijd: 4 uur.', daysAgo: 16, hoursAgo: -1 },
      { senderId: 'support_jan', senderName: 'Jan Willems', senderRole: 'support', senderLang: 'nl', text: 'De storing is verholpen. Alles zou weer normaal moeten werken.', daysAgo: 15 },
      { senderId: 'agent_sarah', senderName: 'Sarah Verhoeven', senderRole: 'agent', senderLang: 'nl', text: 'Bevestigd, alles werkt weer. Bedankt voor de snelle communicatie.', daysAgo: 15, hoursAgo: -1 },
    ],
  });

  // ── WL-22: Closed — Plan downgrade
  await createTicket({
    id: 'wl_tk_22', partnerId: 'wavelink', dept: 'billing',
    agent: { id: 'agent_noah', name: 'Noah De Bruyne', lang: 'nl' },
    support: { id: 'support_thomas', name: 'Thomas Bakker', lang: 'en' },
    status: 'closed', labels: ['lbl_wl_billing_issue'], createdDaysAgo: 22, closedDaysAgo: 21,
    messages: [
      { senderId: 'agent_noah', senderName: 'Noah De Bruyne', senderRole: 'agent', senderLang: 'nl', text: 'Ik wil downgraden van het 300 Mbps naar het 100 Mbps pakket. De kinderen zijn het huis uit en we hebben die snelheid niet meer nodig.', daysAgo: 22 },
      { senderId: 'support_thomas', senderName: 'Thomas Bakker', senderRole: 'support', senderLang: 'en', text: 'I understand. The downgrade from Fiber 300 to Fiber 100 saves you EUR 15/month. I can process this effective next billing cycle. Want me to proceed?', daysAgo: 22, hoursAgo: -2 },
      { senderId: 'agent_noah', senderName: 'Noah De Bruyne', senderRole: 'agent', senderLang: 'nl', text: 'Ja graag, verwerk het maar.', daysAgo: 21 },
      { senderId: 'support_thomas', senderName: 'Thomas Bakker', senderRole: 'support', senderLang: 'en', text: 'Done! Your plan changes to Fiber 100 from April 1st. You will see the reduced amount on your April invoice.', daysAgo: 21, hoursAgo: -1 },
    ],
  });

  // ── WL-23: Closed — Installation scheduling
  await createTicket({
    id: 'wl_tk_23', partnerId: 'wavelink', dept: 'network-ops',
    agent: { id: 'agent_tom', name: 'Tom Williams', lang: 'en' },
    support: { id: 'support_jan', name: 'Jan Willems', lang: 'nl' },
    status: 'closed', labels: ['lbl_wl_new_customer'], createdDaysAgo: 25, closedDaysAgo: 20,
    messages: [
      { senderId: 'agent_tom', senderName: 'Tom Williams', senderRole: 'agent', senderLang: 'en', text: 'I signed up for fiber last week. When can a technician come for the installation?', daysAgo: 25 },
      { senderId: 'support_jan', senderName: 'Jan Willems', senderRole: 'support', senderLang: 'nl', text: 'I see your order. The earliest available slot is next Thursday between 9:00 and 12:00. Does that work?', daysAgo: 25, hoursAgo: -2 },
      { senderId: 'agent_tom', senderName: 'Tom Williams', senderRole: 'agent', senderLang: 'en', text: 'Thursday works perfectly.', daysAgo: 24 },
      { senderId: 'support_jan', senderName: 'Jan Willems', senderRole: 'support', senderLang: 'nl', text: 'Booked! You will receive a confirmation SMS. The technician will call 30 minutes before arrival.', daysAgo: 24, hoursAgo: -1 },
      { senderId: 'agent_tom', senderName: 'Tom Williams', senderRole: 'agent', senderLang: 'en', text: 'Installation went smoothly. Everything is working great. Thanks!', daysAgo: 20 },
    ],
  });

  // ── WL-24: Closed — WiFi password reset
  await createTicket({
    id: 'wl_tk_24', partnerId: 'wavelink', dept: 'technical-support',
    agent: { id: 'agent_sarah', name: 'Sarah Verhoeven', lang: 'nl' },
    support: { id: 'support_thomas', name: 'Thomas Bakker', lang: 'en' },
    status: 'closed', labels: [], createdDaysAgo: 28, closedDaysAgo: 28,
    messages: [
      { senderId: 'agent_sarah', senderName: 'Sarah Verhoeven', senderRole: 'agent', senderLang: 'nl', text: 'Ik ben mijn WiFi wachtwoord vergeten en de sticker onder de router is onleesbaar. Hoe kan ik het opnieuw instellen?', daysAgo: 28 },
      { senderId: 'support_thomas', senderName: 'Thomas Bakker', senderRole: 'support', senderLang: 'en', text: 'Connect via ethernet cable, go to 192.168.1.1, and log in with admin/admin (factory default). Then go to WiFi Settings and set a new password.', daysAgo: 28, hoursAgo: -1 },
      { senderId: 'agent_sarah', senderName: 'Sarah Verhoeven', senderRole: 'agent', senderLang: 'nl', text: 'Gelukt, nieuw wachtwoord ingesteld. Bedankt!', daysAgo: 28, hoursAgo: -2 },
    ],
  });

  // ── WL-25: Closed — Moving address
  await createTicket({
    id: 'wl_tk_25', partnerId: 'wavelink', dept: 'customer-care',
    agent: { id: 'agent_chloe', name: 'Chloe Fontaine', lang: 'fr' },
    support: { id: 'support_amelie', name: 'Amelie Rousseau', lang: 'fr' },
    status: 'closed', labels: [], createdDaysAgo: 26, closedDaysAgo: 22,
    messages: [
      { senderId: 'agent_chloe', senderName: 'Chloe Fontaine', senderRole: 'agent', senderLang: 'fr', text: 'Je demenage le mois prochain a Liege. Comment transferer mon abonnement?', daysAgo: 26 },
      { senderId: 'support_amelie', senderName: 'Amelie Rousseau', senderRole: 'support', senderLang: 'fr', text: 'Pas de probleme! Je vais verifier la disponibilite a votre nouvelle adresse. Quel est le code postal?', daysAgo: 26, hoursAgo: -1 },
      { senderId: 'agent_chloe', senderName: 'Chloe Fontaine', senderRole: 'agent', senderLang: 'fr', text: '4000, centre de Liege.', daysAgo: 25 },
      { senderId: 'support_amelie', senderName: 'Amelie Rousseau', senderRole: 'support', senderLang: 'fr', text: 'La fibre est disponible a cette adresse. Je planifie le transfert et une installation au nouveau domicile. Vous recevrez un email avec les details.', daysAgo: 25, hoursAgo: -1 },
      { senderId: 'agent_chloe', senderName: 'Chloe Fontaine', senderRole: 'agent', senderLang: 'fr', text: 'L installation au nouveau domicile s est bien passee. Merci pour le suivi!', daysAgo: 22 },
    ],
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // GREENLEAF TICKETS (~25)
  // ═══════════════════════════════════════════════════════════════════════════

  // ── GL-01: Open — Car accident claim (urgent)
  await createTicket({
    id: 'gl_tk_01', partnerId: 'greenleaf', dept: 'claims',
    agent: { id: 'agent_lisa', name: 'Lisa Janssens', lang: 'nl' },
    support: { id: 'support_sophie', name: 'Sophie Laurent', lang: 'fr' },
    status: 'open', labels: ['lbl_gl_urgent', 'lbl_gl_claim_pending'], createdDaysAgo: 1,
    refs: [{ label: 'Policy', value: 'GL-AUTO-22145' }, { label: 'Claim', value: 'CLM-2026-4412' }],
    messages: [
      { senderId: 'agent_lisa', senderName: 'Lisa Janssens', senderRole: 'agent', senderLang: 'nl', text: 'Ik heb gisteren een verkeersongeval gehad op de E40. Geen gewonden, maar de voorkant van mijn auto is zwaar beschadigd. Ik heb het Europees aanrijdingsformulier ingevuld.', daysAgo: 1 },
      { senderId: 'support_sophie', senderName: 'Sophie Laurent', senderRole: 'support', senderLang: 'fr', text: 'Dat is vervelend, Lisa. Goed dat er geen gewonden zijn. Kunt u het aanrijdingsformulier en fotos van de schade uploaden? Dan starten we de claim.', daysAgo: 1, hoursAgo: -1 },
      { senderId: 'agent_lisa', senderName: 'Lisa Janssens', senderRole: 'agent', senderLang: 'nl', text: 'Ik heb 5 fotos genomen en het formulier gescand. Ik upload ze nu.', daysAgo: 1, hoursAgo: -2 },
      { senderId: 'support_sophie', senderName: 'Sophie Laurent', senderRole: 'support', senderLang: 'fr', text: 'Documenten ontvangen. Uw claim CLM-2026-4412 is aangemaakt. Een expert neemt binnen 3 werkdagen contact op voor de schatting.', daysAgo: 0, hoursAgo: 6 },
    ],
  });

  // ── GL-02: Open — Water damage claim
  await createTicket({
    id: 'gl_tk_02', partnerId: 'greenleaf', dept: 'claims',
    agent: { id: 'agent_lisa', name: 'Lisa Janssens', lang: 'nl' },
    support: { id: 'support_nora', name: 'Nora Peeters', lang: 'nl' },
    status: 'open', labels: ['lbl_gl_claim_pending'], createdDaysAgo: 2,
    refs: [{ label: 'Policy', value: 'GL-HOME-44821' }],
    messages: [
      { senderId: 'agent_lisa', senderName: 'Lisa Janssens', senderRole: 'agent', senderLang: 'nl', text: 'Afgelopen nacht is er een leiding gesprongen in mijn badkamer. Waterschade aan de vloer en muur van de aangrenzende kamer.', daysAgo: 2 },
      { senderId: 'support_nora', senderName: 'Nora Peeters', senderRole: 'support', senderLang: 'nl', text: 'Uw polis GL-HOME-44821 dekt waterschade. Kunt u fotos uploaden en een ruwe schatting van de schade geven?', daysAgo: 2, hoursAgo: -2 },
      { senderId: 'agent_lisa', senderName: 'Lisa Janssens', senderRole: 'agent', senderLang: 'nl', text: 'De loodgieter schat de reparatie op 1.800 EUR voor de leiding en 2.200 EUR voor vloer en muur.', daysAgo: 1, hoursAgo: 6 },
      { senderId: 'support_nora', senderName: 'Nora Peeters', senderRole: 'support', senderLang: 'nl', text: 'Bedankt. Gezien het bedrag boven 2.000 EUR ligt, stuur ik een expert langs binnen 3 werkdagen.', daysAgo: 1 },
    ],
  });

  // ── GL-03: Open — Travel insurance inquiry
  await createTicket({
    id: 'gl_tk_03', partnerId: 'greenleaf', dept: 'commercial',
    agent: { id: 'agent_emma', name: 'Emma Claes', lang: 'nl' },
    status: 'open', labels: ['lbl_gl_commercial'], createdDaysAgo: 0,
    messages: [
      { senderId: 'agent_emma', senderName: 'Emma Claes', senderRole: 'agent', senderLang: 'nl', text: 'Ik ga in mei op reis naar Japan. Welke reisverzekering raden jullie aan? Ik wil zeker medische dekking en annulering.', daysAgo: 0, hoursAgo: 3 },
    ],
  });

  // ── GL-04: Open — Claim rejected, requesting review (escalated)
  await createTicket({
    id: 'gl_tk_04', partnerId: 'greenleaf', dept: 'claims',
    agent: { id: 'agent_karim', name: 'Karim Benali', lang: 'fr' },
    support: { id: 'support_sophie', name: 'Sophie Laurent', lang: 'fr' },
    status: 'open', labels: ['lbl_gl_escalated', 'lbl_gl_urgent'], createdDaysAgo: 3,
    refs: [{ label: 'Claim', value: 'CLM-2026-3891' }],
    messages: [
      { senderId: 'agent_karim', senderName: 'Karim Benali', senderRole: 'agent', senderLang: 'fr', text: 'Ma reclamation CLM-2026-3891 pour degats des eaux a ete refusee. La raison indiquee est "entretien insuffisant" mais je fais regulierement entretenir ma toiture. Je conteste cette decision.', daysAgo: 3 },
      { senderId: 'support_sophie', senderName: 'Sophie Laurent', senderRole: 'support', senderLang: 'fr', text: 'Je comprends votre frustration, Karim. Pouvez-vous fournir les factures d entretien de votre toiture des 2 dernieres annees? Nous rouvrirons le dossier pour revision.', daysAgo: 3, hoursAgo: -2 },
      { senderId: 'agent_karim', senderName: 'Karim Benali', senderRole: 'agent', senderLang: 'fr', text: 'Oui, j ai les factures de mon couvreur pour 2024 et 2025. Je les scanne et vous les envoie.', daysAgo: 2 },
      { senderId: 'support_sophie', senderName: 'Sophie Laurent', senderRole: 'support', senderLang: 'fr', text: 'Note interne: Client fournit preuves d entretien regulier. Escalade vers le responsable sinistres pour revision de la decision de refus.', daysAgo: 2, whisper: true },
      { senderId: 'support_sophie', senderName: 'Sophie Laurent', senderRole: 'support', senderLang: 'fr', text: 'Merci, Karim. J ai transmis votre dossier avec les factures au responsable sinistres. Vous recevrez une reponse sous 5 jours ouvrables.', daysAgo: 2, hoursAgo: -1 },
    ],
  });

  // ── GL-05: Open — New property coverage
  await createTicket({
    id: 'gl_tk_05', partnerId: 'greenleaf', dept: 'policy-support',
    agent: { id: 'agent_emma', name: 'Emma Claes', lang: 'nl' },
    support: { id: 'support_piet', name: 'Piet Van Damme', lang: 'nl' },
    status: 'open', labels: ['lbl_gl_policy_renewal'], createdDaysAgo: 1,
    messages: [
      { senderId: 'agent_emma', senderName: 'Emma Claes', senderRole: 'agent', senderLang: 'nl', text: 'Ik heb net een tweede eigendom gekocht als investering. Kan ik dit toevoegen aan mijn bestaande polis of heb ik een aparte polis nodig?', daysAgo: 1 },
      { senderId: 'support_piet', senderName: 'Piet Van Damme', senderRole: 'support', senderLang: 'nl', text: 'Gefeliciteerd met de aankoop! Voor een tweede eigendom is een aparte polis nodig. Ik maak een offerte op. Wat is het type woning en de geschatte waarde?', daysAgo: 1, hoursAgo: -2 },
      { senderId: 'agent_emma', senderName: 'Emma Claes', senderRole: 'agent', senderLang: 'nl', text: 'Het is een appartement in Gent, geschatte waarde 285.000 EUR.', daysAgo: 0 },
    ],
  });

  // ── GL-06: Open — Theft claim
  await createTicket({
    id: 'gl_tk_06', partnerId: 'greenleaf', dept: 'claims',
    agent: { id: 'agent_alex', name: 'Alex Johnson', lang: 'en' },
    support: { id: 'support_sophie', name: 'Sophie Laurent', lang: 'fr' },
    status: 'open', labels: ['lbl_gl_claim_pending'], createdDaysAgo: 2,
    refs: [{ label: 'Policy', value: 'GL-HOME-51234' }],
    messages: [
      { senderId: 'agent_alex', senderName: 'Alex Johnson', senderRole: 'agent', senderLang: 'en', text: 'My bicycle was stolen from the garage yesterday. I have a police report filed. How do I proceed with a claim?', daysAgo: 2 },
      { senderId: 'support_sophie', senderName: 'Sophie Laurent', senderRole: 'support', senderLang: 'fr', text: 'Sorry to hear that, Alex. Please upload the police report and proof of purchase for the bicycle. Your home insurance covers theft up to EUR 3,000.', daysAgo: 2, hoursAgo: -2 },
      { senderId: 'agent_alex', senderName: 'Alex Johnson', senderRole: 'agent', senderLang: 'en', text: 'The bike was worth EUR 2,800. I have the receipt from the store and the police report number is PV-2026-11847.', daysAgo: 1 },
    ],
  });

  // ── GL-07: Open — Premium increase question
  await createTicket({
    id: 'gl_tk_07', partnerId: 'greenleaf', dept: 'policy-support',
    agent: { id: 'agent_karim', name: 'Karim Benali', lang: 'fr' },
    support: { id: 'support_piet', name: 'Piet Van Damme', lang: 'nl' },
    status: 'open', labels: [], createdDaysAgo: 1,
    messages: [
      { senderId: 'agent_karim', senderName: 'Karim Benali', senderRole: 'agent', senderLang: 'fr', text: 'Ma prime a augmente de 12% cette annee sans aucun sinistre. Pouvez-vous m expliquer pourquoi?', daysAgo: 1 },
      { senderId: 'support_piet', senderName: 'Piet Van Damme', senderRole: 'support', senderLang: 'nl', text: 'Je comprends votre question. L augmentation est liee a l indexation annuelle des couts de reconstruction et a la hausse des tarifs des reparations. Je vais examiner votre dossier pour voir si nous pouvons optimiser votre couverture.', daysAgo: 1, hoursAgo: -2 },
    ],
  });

  // ── GL-08: Open — Life insurance question
  await createTicket({
    id: 'gl_tk_08', partnerId: 'greenleaf', dept: 'commercial',
    agent: { id: 'agent_lisa', name: 'Lisa Janssens', lang: 'nl' },
    status: 'open', labels: ['lbl_gl_commercial'], createdDaysAgo: 0,
    messages: [
      { senderId: 'agent_lisa', senderName: 'Lisa Janssens', senderRole: 'agent', senderLang: 'nl', text: 'Ik ben geinteresseerd in een levensverzekering. Ik ben 35, niet-roker, en wil graag een dekking van 200.000 EUR. Wat zijn de opties?', daysAgo: 0, hoursAgo: 1 },
    ],
  });

  // ── GL-09: Pending — Home renovation coverage update
  await createTicket({
    id: 'gl_tk_09', partnerId: 'greenleaf', dept: 'policy-support',
    agent: { id: 'agent_emma', name: 'Emma Claes', lang: 'nl' },
    support: { id: 'support_piet', name: 'Piet Van Damme', lang: 'nl' },
    status: 'pending', labels: ['lbl_gl_policy_renewal'], createdDaysAgo: 5,
    messages: [
      { senderId: 'agent_emma', senderName: 'Emma Claes', senderRole: 'agent', senderLang: 'nl', text: 'We hebben een grote renovatie laten doen. De waarde van ons huis is gestegen met circa 80.000 EUR. Moet ik mijn polis aanpassen?', daysAgo: 5 },
      { senderId: 'support_piet', senderName: 'Piet Van Damme', senderRole: 'support', senderLang: 'nl', text: 'Absoluut, het is belangrijk om uw polis aan te passen om onderverzekering te voorkomen. Kunt u een kopie van de facturen of een recent taxatierapport sturen?', daysAgo: 5, hoursAgo: -2 },
      { senderId: 'agent_emma', senderName: 'Emma Claes', senderRole: 'agent', senderLang: 'nl', text: 'Ik heb de facturen van de aannemer. De totale verbouwing was 82.500 EUR. Ik scan ze in en stuur ze door.', daysAgo: 4 },
    ],
  });

  // ── GL-10: Pending — Waiting for police report
  await createTicket({
    id: 'gl_tk_10', partnerId: 'greenleaf', dept: 'claims',
    agent: { id: 'agent_alex', name: 'Alex Johnson', lang: 'en' },
    support: { id: 'support_nora', name: 'Nora Peeters', lang: 'nl' },
    status: 'pending', labels: ['lbl_gl_claim_pending', 'lbl_gl_follow_up'], createdDaysAgo: 8,
    refs: [{ label: 'Claim', value: 'CLM-2026-4001' }],
    messages: [
      { senderId: 'agent_alex', senderName: 'Alex Johnson', senderRole: 'agent', senderLang: 'en', text: 'Someone broke into my garden shed and took several power tools. I filed a police report but do not have the written copy yet.', daysAgo: 8 },
      { senderId: 'support_nora', senderName: 'Nora Peeters', senderRole: 'support', senderLang: 'nl', text: 'We need the official police report to proceed with the claim. Do you have the report reference number? Usually the written copy arrives within 5 business days.', daysAgo: 8, hoursAgo: -2 },
      { senderId: 'agent_alex', senderName: 'Alex Johnson', senderRole: 'agent', senderLang: 'en', text: 'The reference is PV-2026-09234. I will send the full document as soon as I receive it.', daysAgo: 7 },
      { senderId: 'support_nora', senderName: 'Nora Peeters', senderRole: 'support', senderLang: 'nl', text: 'Noted. I have created claim CLM-2026-4001 in pending status. We will process it as soon as we receive the police report.', daysAgo: 7, hoursAgo: -1 },
    ],
  });

  // ── GL-11: Pending — Adjuster visit scheduled
  await createTicket({
    id: 'gl_tk_11', partnerId: 'greenleaf', dept: 'claims',
    agent: { id: 'agent_karim', name: 'Karim Benali', lang: 'fr' },
    support: { id: 'support_sophie', name: 'Sophie Laurent', lang: 'fr' },
    status: 'pending', labels: ['lbl_gl_claim_pending'], createdDaysAgo: 6,
    refs: [{ label: 'Claim', value: 'CLM-2026-4102' }],
    messages: [
      { senderId: 'agent_karim', senderName: 'Karim Benali', senderRole: 'agent', senderLang: 'fr', text: 'Un arbre est tombe sur mon toit pendant la tempete de la semaine derniere. Les degats semblent importants.', daysAgo: 6 },
      { senderId: 'support_sophie', senderName: 'Sophie Laurent', senderRole: 'support', senderLang: 'fr', text: 'Les degats de tempete sont couverts par votre polis. J envoie un expert pour evaluation. Avez-vous pu faire une bache temporaire sur le toit?', daysAgo: 6, hoursAgo: -1 },
      { senderId: 'agent_karim', senderName: 'Karim Benali', senderRole: 'agent', senderLang: 'fr', text: 'Oui, un voisin m a aide a poser une bache. J ai garde la facture de la bache (45 EUR).', daysAgo: 5 },
      { senderId: 'support_sophie', senderName: 'Sophie Laurent', senderRole: 'support', senderLang: 'fr', text: 'Parfait, les mesures conservatoires sont remboursables. L expert passera mardi prochain entre 10h et 12h.', daysAgo: 5, hoursAgo: -2 },
    ],
  });

  // ── GL-12: Pending — Policy change request
  await createTicket({
    id: 'gl_tk_12', partnerId: 'greenleaf', dept: 'policy-support',
    agent: { id: 'agent_lisa', name: 'Lisa Janssens', lang: 'nl' },
    support: { id: 'support_piet', name: 'Piet Van Damme', lang: 'nl' },
    status: 'pending', labels: ['lbl_gl_follow_up'], createdDaysAgo: 4,
    messages: [
      { senderId: 'agent_lisa', senderName: 'Lisa Janssens', senderRole: 'agent', senderLang: 'nl', text: 'Ik wil mijn franchise verlagen van 500 EUR naar 250 EUR. Hoeveel kost dat extra per maand?', daysAgo: 4 },
      { senderId: 'support_piet', senderName: 'Piet Van Damme', senderRole: 'support', senderLang: 'nl', text: 'Een verlaging van de franchise naar 250 EUR betekent een meerprijs van ongeveer 8 EUR per maand. Ik maak een formele offerte op en stuur die naar u door.', daysAgo: 4, hoursAgo: -2 },
    ],
  });

  // ── GL-13: Resolved — E-bike coverage
  await createTicket({
    id: 'gl_tk_13', partnerId: 'greenleaf', dept: 'policy-support',
    agent: { id: 'agent_karim', name: 'Karim Benali', lang: 'fr' },
    support: { id: 'support_nora', name: 'Nora Peeters', lang: 'nl' },
    status: 'resolved', labels: [], createdDaysAgo: 10, closedDaysAgo: 9,
    messages: [
      { senderId: 'agent_karim', senderName: 'Karim Benali', senderRole: 'agent', senderLang: 'fr', text: 'Je viens d acheter un velo electrique a 3.500 EUR. Est-ce couvert par mon assurance habitation?', daysAgo: 10 },
      { senderId: 'support_nora', senderName: 'Nora Peeters', senderRole: 'support', senderLang: 'nl', text: 'Les velos electriques jusqu a 3.000 EUR sont couverts automatiquement. Pour un velo a 3.500 EUR, je recommande notre extension mobilite douce a 4,90 EUR/mois.', daysAgo: 10, hoursAgo: -3 },
      { senderId: 'agent_karim', senderName: 'Karim Benali', senderRole: 'agent', senderLang: 'fr', text: 'Parfait, je prends l extension. Comment l activer?', daysAgo: 9 },
      { senderId: 'support_nora', senderName: 'Nora Peeters', senderRole: 'support', senderLang: 'nl', text: 'C est active! L extension est ajoutee a votre police avec effet immediat. Confirmation par email.', daysAgo: 9, hoursAgo: -2 },
    ],
  });

  // ── GL-14: Resolved — Adding new driver
  await createTicket({
    id: 'gl_tk_14', partnerId: 'greenleaf', dept: 'policy-support',
    agent: { id: 'agent_lisa', name: 'Lisa Janssens', lang: 'nl' },
    support: { id: 'support_piet', name: 'Piet Van Damme', lang: 'nl' },
    status: 'resolved', labels: ['lbl_gl_policy_renewal'], createdDaysAgo: 12, closedDaysAgo: 11,
    messages: [
      { senderId: 'agent_lisa', senderName: 'Lisa Janssens', senderRole: 'agent', senderLang: 'nl', text: 'Mijn zoon heeft net zijn rijbewijs gehaald. Ik wil hem als bestuurder toevoegen aan onze autopolis.', daysAgo: 12 },
      { senderId: 'support_piet', senderName: 'Piet Van Damme', senderRole: 'support', senderLang: 'nl', text: 'Gefeliciteerd! Om hem toe te voegen heb ik nodig: volledige naam, geboortedatum, en rijbewijsnummer. Er is een meerprijs voor jonge bestuurders onder 26.', daysAgo: 12, hoursAgo: -2 },
      { senderId: 'agent_lisa', senderName: 'Lisa Janssens', senderRole: 'agent', senderLang: 'nl', text: 'Jef Janssens, 14/03/2004, rijbewijs B-2026-44182. Hoeveel extra per maand?', daysAgo: 11 },
      { senderId: 'support_piet', senderName: 'Piet Van Damme', senderRole: 'support', senderLang: 'nl', text: 'De meerprijs is 35 EUR/maand voor een bestuurder van 22 jaar. Jef is toegevoegd als tweede bestuurder vanaf vandaag. Het nieuwe polisoverzicht is verstuurd per email.', daysAgo: 11, hoursAgo: -1 },
    ],
  });

  // ── GL-15: Resolved — Glass damage claim
  await createTicket({
    id: 'gl_tk_15', partnerId: 'greenleaf', dept: 'claims',
    agent: { id: 'agent_emma', name: 'Emma Claes', lang: 'nl' },
    support: { id: 'support_sophie', name: 'Sophie Laurent', lang: 'fr' },
    status: 'resolved', labels: ['lbl_gl_claim_pending'], createdDaysAgo: 14, closedDaysAgo: 10,
    refs: [{ label: 'Claim', value: 'CLM-2026-3750' }],
    messages: [
      { senderId: 'agent_emma', senderName: 'Emma Claes', senderRole: 'agent', senderLang: 'nl', text: 'Een bal van de buren heeft mijn dubbel glas geraakt. De ruit is gebarsten. Wat dek ik en hoe snel kan dit hersteld worden?', daysAgo: 14 },
      { senderId: 'support_sophie', senderName: 'Sophie Laurent', senderRole: 'support', senderLang: 'fr', text: 'Glasbraak is gedekt zonder franchise als u de glasoptie heeft. Ik check uw polis. Kunt u ondertussen een foto sturen?', daysAgo: 14, hoursAgo: -2 },
      { senderId: 'agent_emma', senderName: 'Emma Claes', senderRole: 'agent', senderLang: 'nl', text: 'Foto opgestuurd. Het is een raam van 120x80 cm.', daysAgo: 13 },
      { senderId: 'support_sophie', senderName: 'Sophie Laurent', senderRole: 'support', senderLang: 'fr', text: 'U heeft de glasoptie. Ik stuur een partnerbedrijf voor vervanging. Zij nemen rechtstreeks contact op. Uw eigen aandeel is 0 EUR.', daysAgo: 13, hoursAgo: -1 },
      { senderId: 'agent_emma', senderName: 'Emma Claes', senderRole: 'agent', senderLang: 'nl', text: 'Het raam is vandaag vervangen. Heel vlotte afhandeling, bedankt!', daysAgo: 10 },
    ],
  });

  // ── GL-16: Resolved — Certificate of insurance
  await createTicket({
    id: 'gl_tk_16', partnerId: 'greenleaf', dept: 'policy-support',
    agent: { id: 'agent_alex', name: 'Alex Johnson', lang: 'en' },
    support: { id: 'support_nora', name: 'Nora Peeters', lang: 'nl' },
    status: 'resolved', labels: [], createdDaysAgo: 15, closedDaysAgo: 14,
    messages: [
      { senderId: 'agent_alex', senderName: 'Alex Johnson', senderRole: 'agent', senderLang: 'en', text: 'I need a certificate of insurance for my landlord. Can you send one?', daysAgo: 15 },
      { senderId: 'support_nora', senderName: 'Nora Peeters', senderRole: 'support', senderLang: 'nl', text: 'Of course! I have generated the certificate and sent it to your email. It contains your policy number, coverage details, and validity dates.', daysAgo: 15, hoursAgo: -1 },
      { senderId: 'agent_alex', senderName: 'Alex Johnson', senderRole: 'agent', senderLang: 'en', text: 'Received it, thank you for the quick turnaround!', daysAgo: 14 },
    ],
  });

  // ── GL-17: Resolved — Payment method change
  await createTicket({
    id: 'gl_tk_17', partnerId: 'greenleaf', dept: 'policy-support',
    agent: { id: 'agent_karim', name: 'Karim Benali', lang: 'fr' },
    support: { id: 'support_piet', name: 'Piet Van Damme', lang: 'nl' },
    status: 'resolved', labels: [], createdDaysAgo: 18, closedDaysAgo: 17,
    messages: [
      { senderId: 'agent_karim', senderName: 'Karim Benali', senderRole: 'agent', senderLang: 'fr', text: 'Je souhaite passer du paiement annuel au paiement mensuel. Est-ce possible?', daysAgo: 18 },
      { senderId: 'support_piet', senderName: 'Piet Van Damme', senderRole: 'support', senderLang: 'nl', text: 'Oui, c est possible. Le paiement mensuel entraine un supplement de 3%. Je modifie votre mode de paiement a partir du prochain echeance.', daysAgo: 18, hoursAgo: -2 },
      { senderId: 'agent_karim', senderName: 'Karim Benali', senderRole: 'agent', senderLang: 'fr', text: 'D accord, le supplement est acceptable. Merci de faire le changement.', daysAgo: 17 },
      { senderId: 'support_piet', senderName: 'Piet Van Damme', senderRole: 'support', senderLang: 'nl', text: 'C est fait! Votre prochaine mensualite sera debitee le 1er du mois prochain. Confirmation envoyee par email.', daysAgo: 17, hoursAgo: -1 },
    ],
  });

  // ── GL-18: Resolved — Roadside assistance clarification
  await createTicket({
    id: 'gl_tk_18', partnerId: 'greenleaf', dept: 'claims',
    agent: { id: 'agent_emma', name: 'Emma Claes', lang: 'nl' },
    support: { id: 'support_nora', name: 'Nora Peeters', lang: 'nl' },
    status: 'resolved', labels: [], createdDaysAgo: 20, closedDaysAgo: 20,
    messages: [
      { senderId: 'agent_emma', senderName: 'Emma Claes', senderRole: 'agent', senderLang: 'nl', text: 'Mijn auto is vannacht niet gestart. Dekt mijn polis pechverhelping?', daysAgo: 20 },
      { senderId: 'support_nora', senderName: 'Nora Peeters', senderRole: 'support', senderLang: 'nl', text: 'Uw autopolis GL-AUTO-32100 bevat pechverhelping in Belgie. Bel 0800-GREENLEAF (0800-47336) en vermeld uw polisnummer. Een depanneur komt binnen het uur.', daysAgo: 20, hoursAgo: -1 },
      { senderId: 'agent_emma', senderName: 'Emma Claes', senderRole: 'agent', senderLang: 'nl', text: 'Bedankt! De depanneur is al langs geweest, het was de accu. Alles opgelost.', daysAgo: 20, hoursAgo: -3 },
    ],
  });

  // ── GL-19: Closed — Windshield replacement
  await createTicket({
    id: 'gl_tk_19', partnerId: 'greenleaf', dept: 'claims',
    agent: { id: 'agent_lisa', name: 'Lisa Janssens', lang: 'nl' },
    support: { id: 'support_sophie', name: 'Sophie Laurent', lang: 'fr' },
    status: 'closed', labels: ['lbl_gl_claim_pending'], createdDaysAgo: 7, closedDaysAgo: 5,
    refs: [{ label: 'Claim', value: 'CLM-2026-4200' }],
    messages: [
      { senderId: 'agent_lisa', senderName: 'Lisa Janssens', senderRole: 'agent', senderLang: 'nl', text: 'Er is een steen tegen mijn voorruit gevlogen op de autosnelweg. Er zit een grote barst in.', daysAgo: 7 },
      { senderId: 'support_sophie', senderName: 'Sophie Laurent', senderRole: 'support', senderLang: 'fr', text: 'Glasschade aan de auto valt onder uw omniumdekking. Ik verwijs u door naar Carglass, onze partnergarage. Zij plannen een afspraak rechtstreeks met u.', daysAgo: 7, hoursAgo: -2 },
      { senderId: 'agent_lisa', senderName: 'Lisa Janssens', senderRole: 'agent', senderLang: 'nl', text: 'Carglass heeft de voorruit vervangen. Heel vlot verlopen.', daysAgo: 5 },
      { senderId: 'support_sophie', senderName: 'Sophie Laurent', senderRole: 'support', senderLang: 'fr', text: 'Fijn om te horen! De factuur is rechtstreeks bij ons ingediend. U hoeft niets meer te doen.', daysAgo: 5, hoursAgo: -1 },
    ],
  });

  // ── GL-20: Closed — Home insurance new contract
  await createTicket({
    id: 'gl_tk_20', partnerId: 'greenleaf', dept: 'commercial',
    agent: { id: 'agent_alex', name: 'Alex Johnson', lang: 'en' },
    support: { id: 'support_nora', name: 'Nora Peeters', lang: 'nl' },
    status: 'closed', labels: ['lbl_gl_commercial'], createdDaysAgo: 12, closedDaysAgo: 9,
    messages: [
      { senderId: 'agent_alex', senderName: 'Alex Johnson', senderRole: 'agent', senderLang: 'en', text: 'I just bought an apartment and need home insurance. What do you offer?', daysAgo: 12 },
      { senderId: 'support_nora', senderName: 'Nora Peeters', senderRole: 'support', senderLang: 'nl', text: 'Congratulations! Our standard home insurance covers fire, water damage, storms, theft, and liability. For an apartment, the starting rate is around EUR 15/month. Can you share the address and estimated value?', daysAgo: 12, hoursAgo: -2 },
      { senderId: 'agent_alex', senderName: 'Alex Johnson', senderRole: 'agent', senderLang: 'en', text: 'It is in Brussels, value around EUR 220,000. I would like the theft and glass coverage options too.', daysAgo: 11 },
      { senderId: 'support_nora', senderName: 'Nora Peeters', senderRole: 'support', senderLang: 'nl', text: 'With theft and glass options: EUR 22.50/month. I have sent the policy documents to your email for digital signature.', daysAgo: 11, hoursAgo: -1 },
      { senderId: 'agent_alex', senderName: 'Alex Johnson', senderRole: 'agent', senderLang: 'en', text: 'Signed and returned! Thanks for the smooth process.', daysAgo: 9 },
    ],
  });

  // ── GL-21: Closed — Pet insurance inquiry
  await createTicket({
    id: 'gl_tk_21', partnerId: 'greenleaf', dept: 'commercial',
    agent: { id: 'agent_emma', name: 'Emma Claes', lang: 'nl' },
    support: { id: 'support_piet', name: 'Piet Van Damme', lang: 'nl' },
    status: 'closed', labels: ['lbl_gl_commercial'], createdDaysAgo: 16, closedDaysAgo: 15,
    messages: [
      { senderId: 'agent_emma', senderName: 'Emma Claes', senderRole: 'agent', senderLang: 'nl', text: 'Bieden jullie ook een verzekering aan voor huisdieren? Ik heb een labrador van 3 jaar.', daysAgo: 16 },
      { senderId: 'support_piet', senderName: 'Piet Van Damme', senderRole: 'support', senderLang: 'nl', text: 'Jazeker! Onze huisdierenverzekering dekt dierenartskosten, operaties en aansprakelijkheid. Voor een labrador van 3 jaar is de premie circa 25 EUR/maand. Zal ik een offerte opmaken?', daysAgo: 16, hoursAgo: -2 },
      { senderId: 'agent_emma', senderName: 'Emma Claes', senderRole: 'agent', senderLang: 'nl', text: 'Ja graag! Stuur de offerte maar door.', daysAgo: 15 },
      { senderId: 'support_piet', senderName: 'Piet Van Damme', senderRole: 'support', senderLang: 'nl', text: 'De offerte is verstuurd naar uw emailadres. Als u vragen heeft, laat het gerust weten!', daysAgo: 15, hoursAgo: -1 },
    ],
  });

  // ── GL-22: Closed — Cancelled policy refund
  await createTicket({
    id: 'gl_tk_22', partnerId: 'greenleaf', dept: 'policy-support',
    agent: { id: 'agent_karim', name: 'Karim Benali', lang: 'fr' },
    support: { id: 'support_nora', name: 'Nora Peeters', lang: 'nl' },
    status: 'closed', labels: [], createdDaysAgo: 22, closedDaysAgo: 20,
    messages: [
      { senderId: 'agent_karim', senderName: 'Karim Benali', senderRole: 'agent', senderLang: 'fr', text: 'J ai vendu ma voiture le mois dernier et j ai annule ma police auto. Quand recevrai-je le remboursement au prorata?', daysAgo: 22 },
      { senderId: 'support_nora', senderName: 'Nora Peeters', senderRole: 'support', senderLang: 'nl', text: 'Le remboursement au prorata est calcule automatiquement. Le montant de 145,80 EUR sera vire sur votre compte dans les 10 jours ouvrables.', daysAgo: 22, hoursAgo: -2 },
      { senderId: 'agent_karim', senderName: 'Karim Benali', senderRole: 'agent', senderLang: 'fr', text: 'Merci, j ai bien recu le virement. Dossier clos pour moi.', daysAgo: 20 },
    ],
  });

  // ── GL-23: Closed — Fire extinguisher discount
  await createTicket({
    id: 'gl_tk_23', partnerId: 'greenleaf', dept: 'policy-support',
    agent: { id: 'agent_lisa', name: 'Lisa Janssens', lang: 'nl' },
    support: { id: 'support_piet', name: 'Piet Van Damme', lang: 'nl' },
    status: 'closed', labels: [], createdDaysAgo: 25, closedDaysAgo: 24,
    messages: [
      { senderId: 'agent_lisa', senderName: 'Lisa Janssens', senderRole: 'agent', senderLang: 'nl', text: 'Ik heb gehoord dat je korting krijgt op de brandverzekering als je brandblussers en rookmelders hebt. Klopt dat?', daysAgo: 25 },
      { senderId: 'support_piet', senderName: 'Piet Van Damme', senderRole: 'support', senderLang: 'nl', text: 'Klopt! Met gecertificeerde rookmelders op elke verdieping en een brandblusser krijgt u 5% korting op de brandpremie. Stuur een foto of factuur als bewijs.', daysAgo: 25, hoursAgo: -2 },
      { senderId: 'agent_lisa', senderName: 'Lisa Janssens', senderRole: 'agent', senderLang: 'nl', text: 'Ik heb de facturen van de rookmelders en brandblusser opgestuurd.', daysAgo: 24 },
      { senderId: 'support_piet', senderName: 'Piet Van Damme', senderRole: 'support', senderLang: 'nl', text: 'Bewijs ontvangen en goedgekeurd. De 5% korting is toegepast vanaf uw volgende premie. Dat bespaart u circa 12 EUR per jaar.', daysAgo: 24, hoursAgo: -1 },
    ],
  });

  // ── GL-24: Closed — Hail damage
  await createTicket({
    id: 'gl_tk_24', partnerId: 'greenleaf', dept: 'claims',
    agent: { id: 'agent_emma', name: 'Emma Claes', lang: 'nl' },
    support: { id: 'support_sophie', name: 'Sophie Laurent', lang: 'fr' },
    status: 'closed', labels: ['lbl_gl_claim_pending'], createdDaysAgo: 24, closedDaysAgo: 18,
    refs: [{ label: 'Claim', value: 'CLM-2026-3500' }],
    messages: [
      { senderId: 'agent_emma', senderName: 'Emma Claes', senderRole: 'agent', senderLang: 'nl', text: 'Na de hagelbui van gisteren heeft mijn auto overal deuken. De carrossier schat de schade op 3.200 EUR.', daysAgo: 24 },
      { senderId: 'support_sophie', senderName: 'Sophie Laurent', senderRole: 'support', senderLang: 'fr', text: 'Hagelschade valt onder uw omnium. Stuur de offerte van de carrossier en foto s door. Franchise is 250 EUR.', daysAgo: 24, hoursAgo: -2 },
      { senderId: 'agent_emma', senderName: 'Emma Claes', senderRole: 'agent', senderLang: 'nl', text: 'Documenten zijn doorgestuurd. De carrossier kan volgende week beginnen.', daysAgo: 23 },
      { senderId: 'support_sophie', senderName: 'Sophie Laurent', senderRole: 'support', senderLang: 'fr', text: 'Claim goedgekeurd. Wij betalen 2.950 EUR (3.200 minus 250 franchise) rechtstreeks aan de carrossier.', daysAgo: 22 },
      { senderId: 'agent_emma', senderName: 'Emma Claes', senderRole: 'agent', senderLang: 'nl', text: 'Auto is hersteld, ziet er weer als nieuw uit. Bedankt voor de snelle afhandeling!', daysAgo: 18 },
    ],
  });

  // ── GL-25: Closed — Old policy question
  await createTicket({
    id: 'gl_tk_25', partnerId: 'greenleaf', dept: 'policy-support',
    agent: { id: 'agent_alex', name: 'Alex Johnson', lang: 'en' },
    support: { id: 'support_nora', name: 'Nora Peeters', lang: 'nl' },
    status: 'closed', labels: [], createdDaysAgo: 28, closedDaysAgo: 27,
    messages: [
      { senderId: 'agent_alex', senderName: 'Alex Johnson', senderRole: 'agent', senderLang: 'en', text: 'Can I get a copy of my insurance certificate for my mortgage application?', daysAgo: 28 },
      { senderId: 'support_nora', senderName: 'Nora Peeters', senderRole: 'support', senderLang: 'nl', text: 'Absolutely! I have generated a certificate in both Dutch and English and sent it to your registered email.', daysAgo: 28, hoursAgo: -1 },
      { senderId: 'agent_alex', senderName: 'Alex Johnson', senderRole: 'agent', senderLang: 'en', text: 'Received, thanks! The bank has everything they need now.', daysAgo: 27 },
    ],
  });

  console.log(`   50 tickets created\n`);

  // ── 8. RATINGS ─────────────────────────────────────────────────────────────
  console.log('⑧ Creating ratings...');

  // Collect all closed/resolved tickets for ratings
  const ratedTickets = [
    // WaveLink resolved/closed
    { ticketId: 'wl_tk_13', partnerId: 'wavelink',  agentId: 'agent_noah',   supportId: 'support_amelie', rating: 5, comment: 'Heel vlotte uitleg, alles meteen duidelijk!' },
    { ticketId: 'wl_tk_14', partnerId: 'wavelink',  agentId: 'agent_tom',    supportId: 'support_jan',    rating: 5, comment: 'Quick DNS fix, saved me hours of frustration.' },
    { ticketId: 'wl_tk_15', partnerId: 'wavelink',  agentId: 'agent_sarah',  supportId: 'support_thomas', rating: 5, comment: 'Kreeg zelfs geld terug voor 3 maanden! Geweldig.' },
    { ticketId: 'wl_tk_16', partnerId: 'wavelink',  agentId: 'agent_chloe',  supportId: 'support_amelie', rating: 4, comment: null },
    { ticketId: 'wl_tk_17', partnerId: 'wavelink',  agentId: 'agent_noah',   supportId: 'support_jan',    rating: 5, comment: null },
    { ticketId: 'wl_tk_18', partnerId: 'wavelink',  agentId: 'agent_sarah',  supportId: 'support_amelie', rating: 4, comment: 'Goed aanbod voor bestaande klanten.' },
    { ticketId: 'wl_tk_19', partnerId: 'wavelink',  agentId: 'agent_chloe',  supportId: 'support_jan',    rating: 3, comment: 'Le probleme a ete resolu mais il n aurait jamais du arriver.' },
    { ticketId: 'wl_tk_20', partnerId: 'wavelink',  agentId: 'agent_tom',    supportId: 'support_jan',    rating: 5, comment: 'Static IP activated within minutes.' },
    { ticketId: 'wl_tk_21', partnerId: 'wavelink',  agentId: 'agent_sarah',  supportId: 'support_jan',    rating: 4, comment: 'Goede communicatie tijdens de storing.' },
    { ticketId: 'wl_tk_22', partnerId: 'wavelink',  agentId: 'agent_noah',   supportId: 'support_thomas', rating: 4, comment: null },
    { ticketId: 'wl_tk_23', partnerId: 'wavelink',  agentId: 'agent_tom',    supportId: 'support_jan',    rating: 5, comment: 'Smooth installation process.' },
    { ticketId: 'wl_tk_24', partnerId: 'wavelink',  agentId: 'agent_sarah',  supportId: 'support_thomas', rating: 4, comment: null },
    { ticketId: 'wl_tk_25', partnerId: 'wavelink',  agentId: 'agent_chloe',  supportId: 'support_amelie', rating: 5, comment: 'Transfert parfaitement organise!' },
    // GreenLeaf resolved/closed
    { ticketId: 'gl_tk_13', partnerId: 'greenleaf', agentId: 'agent_karim',  supportId: 'support_nora',   rating: 5, comment: 'Activation immediate, tres professionnel.' },
    { ticketId: 'gl_tk_14', partnerId: 'greenleaf', agentId: 'agent_lisa',   supportId: 'support_piet',   rating: 4, comment: 'Duidelijke uitleg over de meerprijs.' },
    { ticketId: 'gl_tk_15', partnerId: 'greenleaf', agentId: 'agent_emma',   supportId: 'support_sophie', rating: 5, comment: 'Vlotte afhandeling van de glasbraak!' },
    { ticketId: 'gl_tk_16', partnerId: 'greenleaf', agentId: 'agent_alex',   supportId: 'support_nora',   rating: 5, comment: 'Quick certificate, exactly what I needed.' },
    { ticketId: 'gl_tk_17', partnerId: 'greenleaf', agentId: 'agent_karim',  supportId: 'support_piet',   rating: 4, comment: null },
    { ticketId: 'gl_tk_18', partnerId: 'greenleaf', agentId: 'agent_emma',   supportId: 'support_nora',   rating: 5, comment: 'Depanneur was er binnen het halfuur.' },
    { ticketId: 'gl_tk_19', partnerId: 'greenleaf', agentId: 'agent_lisa',   supportId: 'support_sophie', rating: 5, comment: null },
    { ticketId: 'gl_tk_20', partnerId: 'greenleaf', agentId: 'agent_alex',   supportId: 'support_nora',   rating: 5, comment: 'Incredibly smooth process from start to finish.' },
    { ticketId: 'gl_tk_21', partnerId: 'greenleaf', agentId: 'agent_emma',   supportId: 'support_piet',   rating: 4, comment: null },
    { ticketId: 'gl_tk_22', partnerId: 'greenleaf', agentId: 'agent_karim',  supportId: 'support_nora',   rating: 4, comment: 'Remboursement recu rapidement.' },
    { ticketId: 'gl_tk_23', partnerId: 'greenleaf', agentId: 'agent_lisa',   supportId: 'support_piet',   rating: 5, comment: 'Leuk dat er een korting is voor preventie!' },
    { ticketId: 'gl_tk_24', partnerId: 'greenleaf', agentId: 'agent_emma',   supportId: 'support_sophie', rating: 4, comment: 'Snelle goedkeuring maar de franchise vond ik hoog.' },
    { ticketId: 'gl_tk_25', partnerId: 'greenleaf', agentId: 'agent_alex',   supportId: 'support_nora',   rating: 5, comment: 'Fast and bilingual service!' },
  ];

  for (const r of ratedTickets) {
    await db.insert(ratings).values({
      id: uid(), partnerId: r.partnerId, ticketId: r.ticketId,
      agentId: r.agentId, supportId: r.supportId,
      rating: r.rating, comment: r.comment,
      createdAt: ago(randInt(1, 25)),
    });
  }
  console.log(`   ${ratedTickets.length} ratings created\n`);

  // ── 9. DAILY STATS (30 days per partner) ───────────────────────────────────
  console.log('⑨ Creating daily stats (30 days)...');

  for (const pId of ['wavelink', 'greenleaf'] as const) {
    for (let d = 29; d >= 0; d--) {
      const dt = new Date();
      dt.setDate(dt.getDate() - d);
      const dateStr = dt.toISOString().split('T')[0];
      const isWeekend = dt.getDay() === 0 || dt.getDay() === 6;
      const base = pId === 'wavelink'
        ? (isWeekend ? 3 : 12)
        : (isWeekend ? 2 : 8);

      const total = base + randInt(0, 5);
      const closed = Math.min(total, Math.floor(base * 0.7) + randInt(0, 3));

      const depts = pId === 'wavelink'
        ? { 'network-ops': Math.ceil(total * 0.35), 'customer-care': Math.ceil(total * 0.30), 'billing': Math.ceil(total * 0.20), 'technical-support': Math.ceil(total * 0.15) }
        : { 'claims': Math.ceil(total * 0.40), 'policy-support': Math.ceil(total * 0.35), 'commercial': Math.ceil(total * 0.25) };

      await db.insert(dailyStats).values({
        date: dateStr, partnerId: pId,
        total, closed,
        abandoned: randInt(0, 2),
        avgResponseMs: randInt(300000, 1800000),
        avgDurationMs: randInt(600000, 3600000),
        avgRating: randFloat(3.5, 4.8),
        ratingCount: randInt(2, 8),
        slaResolved: Math.max(0, closed - randInt(0, 2)),
        slaCompliant: Math.max(0, closed - randInt(0, 3)),
        p95ResponseMs: randInt(900000, 3600000),
        reopened: randInt(0, 2),
        sentimentSum: randFloat(closed * 0.5, closed * 0.9),
        sentimentCount: closed,
        deptCounts: depts,
      });
    }
  }
  console.log('   60 days of stats (30 per partner)\n');

  // ── 10. AGENT STATUS LOG + DAILY AGENT STATUS (7 days) ─────────────────────
  console.log('⑩ Creating agent status data (7 days)...');

  const supportUsers = [
    { id: 'support_jan',    partnerId: 'wavelink' },
    { id: 'support_amelie', partnerId: 'wavelink' },
    { id: 'support_thomas', partnerId: 'wavelink' },
    { id: 'support_sophie', partnerId: 'greenleaf' },
    { id: 'support_piet',   partnerId: 'greenleaf' },
    { id: 'support_nora',   partnerId: 'greenleaf' },
  ];

  for (const su of supportUsers) {
    for (let d = 6; d >= 0; d--) {
      const dayDate = new Date();
      dayDate.setDate(dayDate.getDate() - d);
      const dayStr = dayDate.toISOString().split('T')[0];

      // Vary times per day
      const availSec = randInt(21600, 28800);  // 6-8 hours online
      const awaySec = randInt(3600, 10800);    // 1-3 hours away

      // Daily rollup
      await db.insert(dailyAgentStatus).values({
        id: uid(),
        date: dayStr,
        userId: su.id,
        partnerId: su.partnerId,
        onlineSeconds: availSec,
        awaySeconds: awaySec,
        createdAt: NOW,
      });

      // Individual status log entries for the day
      const baseTime = new Date(dayDate);
      baseTime.setHours(8, 0, 0, 0);

      const statusEntries: Array<{ status: string; durationSec: number }> = [
        { status: 'online', durationSec: Math.floor(availSec * 0.6) },
        { status: 'away', durationSec: awaySec },
        { status: 'online', durationSec: Math.floor(availSec * 0.4) },
      ];

      let cursor = baseTime.getTime();
      for (const entry of statusEntries) {
        const start = new Date(cursor);
        const end = new Date(cursor + entry.durationSec * 1000);
        await db.insert(agentStatusLog).values({
          id: uid(),
          userId: su.id,
          partnerId: su.partnerId,
          status: entry.status,
          startedAt: start.toISOString(),
          endedAt: end.toISOString(),
          duration: entry.durationSec,
        });
        cursor = end.getTime();
      }
    }
  }
  console.log(`   ${supportUsers.length} agents x 7 days of status data\n`);

  // ── 11. ARCHIVED TICKETS ───────────────────────────────────────────────────
  console.log('⑪ Creating archived tickets...');

  const archivedData = [
    // WaveLink archived
    { id: 'arch_wl_01', partnerId: 'wavelink',  dept: 'network-ops',       agentId: 'agent_sarah',  supportId: 'support_jan',    status: 'closed', createdDaysAgo: 45, closedDaysAgo: 44, msgCount: 6 },
    { id: 'arch_wl_02', partnerId: 'wavelink',  dept: 'billing',           agentId: 'agent_noah',   supportId: 'support_thomas', status: 'closed', createdDaysAgo: 48, closedDaysAgo: 46, msgCount: 4 },
    { id: 'arch_wl_03', partnerId: 'wavelink',  dept: 'customer-care',     agentId: 'agent_chloe',  supportId: 'support_amelie', status: 'closed', createdDaysAgo: 50, closedDaysAgo: 49, msgCount: 5 },
    { id: 'arch_wl_04', partnerId: 'wavelink',  dept: 'technical-support', agentId: 'agent_tom',    supportId: 'support_jan',    status: 'resolved', createdDaysAgo: 55, closedDaysAgo: 54, msgCount: 3 },
    { id: 'arch_wl_05', partnerId: 'wavelink',  dept: 'network-ops',       agentId: 'agent_sarah',  supportId: 'support_thomas', status: 'closed', createdDaysAgo: 60, closedDaysAgo: 58, msgCount: 8 },
    { id: 'arch_wl_06', partnerId: 'wavelink',  dept: 'billing',           agentId: 'agent_chloe',  supportId: 'support_amelie', status: 'closed', createdDaysAgo: 65, closedDaysAgo: 64, msgCount: 4 },
    // GreenLeaf archived
    { id: 'arch_gl_01', partnerId: 'greenleaf', dept: 'claims',            agentId: 'agent_lisa',   supportId: 'support_sophie', status: 'closed', createdDaysAgo: 40, closedDaysAgo: 35, msgCount: 7 },
    { id: 'arch_gl_02', partnerId: 'greenleaf', dept: 'policy-support',    agentId: 'agent_karim',  supportId: 'support_piet',   status: 'closed', createdDaysAgo: 42, closedDaysAgo: 41, msgCount: 4 },
    { id: 'arch_gl_03', partnerId: 'greenleaf', dept: 'claims',            agentId: 'agent_emma',   supportId: 'support_nora',   status: 'resolved', createdDaysAgo: 50, closedDaysAgo: 47, msgCount: 6 },
    { id: 'arch_gl_04', partnerId: 'greenleaf', dept: 'commercial',        agentId: 'agent_alex',   supportId: 'support_nora',   status: 'closed', createdDaysAgo: 55, closedDaysAgo: 53, msgCount: 5 },
    { id: 'arch_gl_05', partnerId: 'greenleaf', dept: 'policy-support',    agentId: 'agent_lisa',   supportId: 'support_piet',   status: 'closed', createdDaysAgo: 58, closedDaysAgo: 57, msgCount: 3 },
    { id: 'arch_gl_06', partnerId: 'greenleaf', dept: 'claims',            agentId: 'agent_karim',  supportId: 'support_sophie', status: 'closed', createdDaysAgo: 62, closedDaysAgo: 60, msgCount: 9 },
  ];

  for (const a of archivedData) {
    await db.insert(archivedTickets).values({
      id: a.id, partnerId: a.partnerId, dept: a.dept,
      agentId: a.agentId, supportId: a.supportId,
      status: a.status,
      createdAt: ago(a.createdDaysAgo),
      closedAt: ago(a.closedDaysAgo),
      messageCount: a.msgCount,
      archivedAt: ago(a.closedDaysAgo - 1),
    });
  }
  console.log(`   ${archivedData.length} archived tickets\n`);

  // ── 12. APP FEEDBACK ───────────────────────────────────────────────────────
  console.log('⑫ Creating app feedback...');

  const feedbackData = [
    { userId: 'support_jan',    partnerId: 'wavelink',  userName: 'Jan Willems',      role: 'support', text: 'The AI copilot suggestions are really accurate for network troubleshooting. Saves me a lot of time looking up procedures.' },
    { userId: 'admin_katrien',  partnerId: 'wavelink',  userName: 'Katrien Verhoeven', role: 'admin',   text: 'Would love to see department-level SLA dashboards with trend lines. Current stats view is good but needs more granularity.' },
    { userId: 'support_nora',   partnerId: 'greenleaf', userName: 'Nora Peeters',     role: 'support', text: 'Multilingual support works great. I can help French-speaking clients even though I primarily work in Dutch.' },
    { userId: 'agent_tom',      partnerId: 'wavelink',  userName: 'Tom Williams',     role: 'agent',   text: 'The chat interface is clean and fast. Would be nice to have file drag-and-drop for attachments though.' },
    { userId: 'support_sophie', partnerId: 'greenleaf', userName: 'Sophie Laurent',   role: 'support', text: 'Les reponses pre-enregistrees sont tres utiles mais il en faudrait plus pour les reclamations sinistres.' },
    { userId: 'admin_dirk',     partnerId: 'greenleaf', userName: 'Dirk De Smedt',   role: 'admin',   text: 'Het archiefsysteem werkt goed. De WORM-keten geeft vertrouwen voor compliance.' },
    { userId: 'agent_sarah',    partnerId: 'wavelink',  userName: 'Sarah Verhoeven',  role: 'agent',   text: 'Soms duurt het even voor een medewerker mijn ticket oppakt. Een wachtrijpositie zou fijn zijn.' },
    { userId: 'support_thomas', partnerId: 'wavelink',  userName: 'Thomas Bakker',    role: 'support', text: 'Working across two partners is seamless with the partner switcher. Great for our shared support model.' },
  ];

  for (const f of feedbackData) {
    await db.insert(appFeedback).values({
      id: uid(), userId: f.userId, partnerId: f.partnerId,
      userName: f.userName, role: f.role, text: f.text,
      createdAt: ago(randInt(1, 20)),
    });
  }
  console.log(`   ${feedbackData.length} feedback entries\n`);

  // ── 13. TOPIC ALERTS ───────────────────────────────────────────────────────
  console.log('⑬ Creating topic alerts...');

  const alertData = [
    { partnerId: 'wavelink',  dept: 'network-ops',    topic: 'Outage spike',      summary: 'Multiple outage reports in Antwerp region — possible infrastructure issue', severity: 'high' as const, ticketCount: 12 },
    { partnerId: 'wavelink',  dept: 'billing',         topic: 'Double billing',    summary: 'Recurring double billing reports after March billing run',                  severity: 'medium' as const, ticketCount: 5 },
    { partnerId: 'greenleaf', dept: 'claims',           topic: 'Storm damage',      summary: 'Spike in storm damage claims following severe weather event on 28/03',      severity: 'high' as const, ticketCount: 18 },
    { partnerId: 'greenleaf', dept: 'policy-support',   topic: 'Premium complaints', summary: 'Increased inquiries about premium increases this renewal cycle',          severity: 'medium' as const, ticketCount: 8 },
  ];

  for (const a of alertData) {
    await db.insert(topicAlerts).values({
      id: uid(), partnerId: a.partnerId, dept: a.dept,
      topic: a.topic, summary: a.summary,
      severity: a.severity, ticketCount: a.ticketCount,
      status: 'active', createdAt: ago(randInt(1, 5)),
    });
  }
  console.log(`   ${alertData.length} topic alerts\n`);

  // ── 14. WEBHOOKS ───────────────────────────────────────────────────────────
  console.log('⑭ Creating webhooks...');

  const webhookData = [
    { partnerId: 'wavelink',  url: 'https://hooks.wavelink.demo/ticket-created',  events: ['ticket.created'],          description: 'Notify CRM on new tickets', createdBy: 'admin_katrien' },
    { partnerId: 'wavelink',  url: 'https://hooks.wavelink.demo/ticket-closed',   events: ['ticket.closed'],           description: 'Trigger satisfaction survey', createdBy: 'admin_katrien' },
    { partnerId: 'greenleaf', url: 'https://hooks.greenleaf.demo/claims-webhook', events: ['ticket.created', 'ticket.closed'], description: 'Claims system integration', createdBy: 'admin_dirk' },
  ];

  for (const w of webhookData) {
    await db.insert(webhooks).values({
      id: uid(), partnerId: w.partnerId, url: w.url,
      secret: crypto.randomBytes(32).toString('hex'),
      events: w.events, description: w.description,
      active: true, createdBy: w.createdBy,
      createdAt: ago(15), updatedAt: NOW,
    });
  }
  console.log(`   ${webhookData.length} webhooks\n`);

  // ── 15. AUDIT LOG ──────────────────────────────────────────────────────────
  console.log('⑮ Creating audit log entries...');

  const auditEntries = [
    { action: 'partner.created',    actorId: 'platform_bart', partnerId: 'wavelink',  targetType: 'partner',     targetId: 'wavelink',       metadata: { name: 'WaveLink Telecom' },                                  daysAgo: 90 },
    { action: 'partner.created',    actorId: 'platform_bart', partnerId: 'greenleaf', targetType: 'partner',     targetId: 'greenleaf',      metadata: { name: 'GreenLeaf Insurance' },                               daysAgo: 60 },
    { action: 'user.invited',       actorId: 'admin_katrien', partnerId: 'wavelink',  targetType: 'user',        targetId: 'support_jan',    metadata: { role: 'support', email: 'jan@wavelink.demo' },               daysAgo: 30 },
    { action: 'user.invited',       actorId: 'admin_katrien', partnerId: 'wavelink',  targetType: 'user',        targetId: 'support_amelie', metadata: { role: 'support', email: 'amelie@wavelink.demo' },            daysAgo: 30 },
    { action: 'user.invited',       actorId: 'admin_katrien', partnerId: 'wavelink',  targetType: 'user',        targetId: 'support_thomas', metadata: { role: 'support', email: 'thomas@wavelink.demo' },            daysAgo: 30 },
    { action: 'user.invited',       actorId: 'admin_dirk',   partnerId: 'greenleaf', targetType: 'user',        targetId: 'support_sophie', metadata: { role: 'support', email: 'sophie@greenleaf.demo' },           daysAgo: 30 },
    { action: 'user.invited',       actorId: 'admin_dirk',   partnerId: 'greenleaf', targetType: 'user',        targetId: 'support_piet',   metadata: { role: 'support', email: 'piet@greenleaf.demo' },             daysAgo: 30 },
    { action: 'user.invited',       actorId: 'admin_dirk',   partnerId: 'greenleaf', targetType: 'user',        targetId: 'support_nora',   metadata: { role: 'support', email: 'nora@greenleaf.demo' },             daysAgo: 30 },
    { action: 'partner.settings',   actorId: 'admin_katrien', partnerId: 'wavelink',  targetType: 'partner',     targetId: 'wavelink',       metadata: { field: 'businessHours', value: '08:00-18:00' },              daysAgo: 25 },
    { action: 'partner.settings',   actorId: 'admin_dirk',   partnerId: 'greenleaf', targetType: 'partner',     targetId: 'greenleaf',      metadata: { field: 'businessHours', value: '09:00-17:00' },              daysAgo: 25 },
    { action: 'partner.settings',   actorId: 'admin_katrien', partnerId: 'wavelink',  targetType: 'partner',     targetId: 'wavelink',       metadata: { field: 'slaConfig', value: { responseMins: 30 } },           daysAgo: 22 },
    { action: 'label.created',      actorId: 'admin_katrien', partnerId: 'wavelink',  targetType: 'label',       targetId: 'lbl_wl_vip',     metadata: { name: 'VIP' },                                               daysAgo: 20 },
    { action: 'label.created',      actorId: 'admin_dirk',   partnerId: 'greenleaf', targetType: 'label',       targetId: 'lbl_gl_vip',     metadata: { name: 'VIP' },                                               daysAgo: 20 },
    { action: 'kb.created',         actorId: 'admin_katrien', partnerId: 'wavelink',  targetType: 'kb_article',  targetId: null,             metadata: { title: 'Router Setup Guide' },                                daysAgo: 15 },
    { action: 'kb.created',         actorId: 'admin_dirk',   partnerId: 'greenleaf', targetType: 'kb_article',  targetId: null,             metadata: { title: 'How to File a Claim' },                               daysAgo: 15 },
    { action: 'webhook.created',    actorId: 'admin_katrien', partnerId: 'wavelink',  targetType: 'webhook',     targetId: null,             metadata: { url: 'https://hooks.wavelink.demo/ticket-created' },         daysAgo: 15 },
    { action: 'user.role_changed',  actorId: 'admin_katrien', partnerId: 'wavelink',  targetType: 'membership',  targetId: 'support_thomas', metadata: { from: 'agent', to: 'support' },                              daysAgo: 12 },
    { action: 'user.departments',   actorId: 'admin_dirk',   partnerId: 'greenleaf', targetType: 'membership',  targetId: 'support_nora',   metadata: { departments: [], note: 'Set to generalist' },                daysAgo: 10 },
    { action: 'partner.sso_config', actorId: 'platform_bart', partnerId: 'greenleaf', targetType: 'partner',     targetId: 'greenleaf',      metadata: { authMethod: 'sso' },                                         daysAgo: 8 },
    { action: 'gdpr.purge',         actorId: null,            partnerId: 'wavelink',  targetType: 'system',      targetId: null,             metadata: { ticketsPurged: 12, messagesPurged: 47, olderThan: '30d' },   daysAgo: 5 },
    { action: 'gdpr.purge',         actorId: null,            partnerId: 'greenleaf', targetType: 'system',      targetId: null,             metadata: { ticketsPurged: 8, messagesPurged: 31, olderThan: '30d' },    daysAgo: 5 },
    { action: 'user.login',         actorId: 'platform_bart', partnerId: 'wavelink',  targetType: 'session',     targetId: 'platform_bart',  metadata: { ip: '10.0.0.1' },                                            daysAgo: 1 },
    { action: 'user.login',         actorId: 'admin_katrien', partnerId: 'wavelink',  targetType: 'session',     targetId: 'admin_katrien',  metadata: { ip: '10.0.0.2' },                                            daysAgo: 1 },
    { action: 'user.login',         actorId: 'admin_dirk',   partnerId: 'greenleaf', targetType: 'session',     targetId: 'admin_dirk',     metadata: { ip: '10.0.0.3' },                                            daysAgo: 1 },
    { action: 'user.login',         actorId: 'support_jan',  partnerId: 'wavelink',  targetType: 'session',     targetId: 'support_jan',    metadata: { ip: '10.0.0.4' },                                            daysAgo: 0 },
  ];

  for (const a of auditEntries) {
    await db.insert(auditLog).values({
      id: uid(), action: a.action, actorId: a.actorId, partnerId: a.partnerId,
      targetType: a.targetType, targetId: a.targetId, metadata: a.metadata,
      createdAt: ago(a.daysAgo),
    });
  }
  console.log(`   ${auditEntries.length} audit log entries\n`);

  // ── SUMMARY ────────────────────────────────────────────────────────────────
  console.log('╔══════════════════════════════════════════════════╗');
  console.log('║          Seed Complete!                          ║');
  console.log('╚══════════════════════════════════════════════════╝');
  console.log();
  console.log('Partners:    2 (WaveLink Telecom, GreenLeaf Insurance)');
  console.log('Users:      17 (+ 3 dual-memberships = 20 memberships)');
  console.log('Labels:     16 (8 per partner)');
  console.log('Tickets:    50 (25 per partner)');
  console.log('Messages:  ~200 realistic chat messages');
  console.log('Ratings:    26 on closed/resolved tickets');
  console.log('Canned:     11 responses');
  console.log('KB:          6 articles');
  console.log('Stats:      60 days (30 per partner)');
  console.log('Status:     42 days of agent status data');
  console.log('Archived:   12 archived tickets');
  console.log('Feedback:    8 entries');
  console.log('Alerts:      4 topic alerts');
  console.log('Webhooks:    3');
  console.log('Audit:      25 entries');
  console.log();
  console.log('All users -> password: password123');
  console.log();
  console.log('Key logins:');
  console.log('  Platform:  bart@tessera.demo');
  console.log('  Admin WL:  katrien@wavelink.demo');
  console.log('  Admin GL:  dirk@greenleaf.demo');
  console.log('  Support:   jan@wavelink.demo / amelie@wavelink.demo');
  console.log('             sophie@greenleaf.demo / nora@greenleaf.demo');
  console.log('  Agents:    sarah@wavelink.demo / noah@wavelink.demo');
  console.log('             lisa@greenleaf.demo / karim@greenleaf.demo');

  process.exit(0);
}

main().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
