/**
 * Full database reset + demo seed for live demonstrations.
 *
 * - TRUNCATES all 25 tables (CASCADE)
 * - Seeds 2 partners, 12 users, labels, canned responses, KB articles
 * - Creates tickets in various states with realistic message threads
 * - Creates ratings, feedback, daily stats
 *
 * Usage: docker compose exec server npx tsx scripts/demo_seed.ts
 * All demo users use password: password123
 */
import { db } from '../db.js';
import {
  users, partners, memberships, labels, tickets, messages, ticketLabels,
  ratings, appFeedback, cannedResponses, kbArticles, dailyStats,
  auditLog, auditArchive, archivedTickets, topicAlerts,
  refreshTokens, savedViews, systemSettings, webhooks, webhookLogs,
  partnerGroupMappings, aiUsageLog, dailyAiUsage, aiPromptTemplates,
} from '../db/schema.js';
import { sql } from 'drizzle-orm';
import { hashPassword } from '../utils/passwords.js';
import crypto from 'crypto';

const PASSWORD = 'password123';
const NOW = new Date().toISOString();

function ago(days: number, hours = 0, mins = 0): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  d.setHours(d.getHours() - hours, d.getMinutes() - mins);
  return d.toISOString();
}

function uid(): string { return crypto.randomUUID(); }

async function main() {
  console.log('╔══════════════════════════════════════╗');
  console.log('║   Tessera Demo Seed — Full Reset     ║');
  console.log('╚══════════════════════════════════════╝\n');

  // ── 1. TRUNCATE ALL TABLES ─────────────────────────────────────────────────
  console.log('① Truncating all tables...');
  await db.execute(sql`
    TRUNCATE TABLE
      webhook_logs, webhooks, ai_usage_log, daily_ai_usage, ai_prompt_templates,
      saved_views, refresh_tokens, ticket_labels, ratings, app_feedback,
      messages, tickets, archived_tickets, audit_archive, audit_log,
      daily_stats, topic_alerts, canned_responses, kb_articles,
      partner_group_mappings, labels, memberships, system_settings, users, partners
    CASCADE
  `);
  console.log('   ✓ All tables truncated\n');

  // ── 2. PARTNERS ────────────────────────────────────────────────────────────
  console.log('② Creating partners...');

  await db.insert(partners).values({
    id: 'wavelink',
    name: 'WaveLink Telecom',
    industry: 'Telecommunications',
    departments: [
      { id: 'network-ops', name: 'Network Operations', description: 'Network infrastructure and outages' },
      { id: 'customer-care', name: 'Customer Care', description: 'General customer support' },
      { id: 'billing', name: 'Billing & Accounts', description: 'Invoicing, payments, and account management' },
    ],
    businessHoursStart: '08:00',
    businessHoursEnd: '18:00',
    businessHoursTimezone: 'Europe/Brussels',
    status: 'active',
    authMethod: 'local',
    createdAt: ago(90),
    updatedAt: NOW,
  });
  console.log('   ✓ WaveLink Telecom');

  await db.insert(partners).values({
    id: 'greenleaf',
    name: 'GreenLeaf Insurance',
    industry: 'Insurance',
    departments: [
      { id: 'claims', name: 'Claims', description: 'Insurance claims processing' },
      { id: 'policies', name: 'Policies', description: 'Policy questions and renewals' },
    ],
    businessHoursStart: '09:00',
    businessHoursEnd: '17:00',
    businessHoursTimezone: 'Europe/Brussels',
    status: 'active',
    authMethod: 'local',
    createdAt: ago(60),
    updatedAt: NOW,
  });
  console.log('   ✓ GreenLeaf Insurance\n');

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
    // ── WaveLink Telecom ──
    // Agents (end-users / customers)
    { id: 'agent_sarah',    name: 'Sarah Verhoeven',   email: 'sarah@wavelink.demo',    role: 'agent',   partnerId: 'wavelink', departments: ['network-ops'],    lang: 'nl' },
    { id: 'agent_lucas',    name: 'Lucas Martin',      email: 'lucas@wavelink.demo',    role: 'agent',   partnerId: 'wavelink', departments: ['customer-care'],  lang: 'fr' },
    { id: 'agent_emma',     name: 'Emma Claes',        email: 'emma@wavelink.demo',     role: 'agent',   partnerId: 'wavelink', departments: ['billing'],        lang: 'nl' },
    { id: 'agent_noah',     name: 'Noah De Bruyne',    email: 'noah@wavelink.demo',     role: 'agent',   partnerId: 'wavelink', departments: ['customer-care'],  lang: 'nl' },
    { id: 'agent_chloe',    name: 'Chloé Fontaine',    email: 'chloe@wavelink.demo',    role: 'agent',   partnerId: 'wavelink', departments: ['network-ops'],    lang: 'fr' },
    // Support staff
    { id: 'support_jan',    name: 'Jan Willems',       email: 'jan@wavelink.demo',      role: 'support', partnerId: 'wavelink', departments: ['network-ops'],    lang: 'nl' },
    { id: 'support_amelie', name: 'Amélie Rousseau',   email: 'amelie@wavelink.demo',   role: 'support', partnerId: 'wavelink', departments: ['customer-care'],  lang: 'fr' },
    { id: 'support_thomas', name: 'Thomas Bakker',     email: 'thomas@wavelink.demo',   role: 'support', partnerId: 'wavelink', departments: [],                 lang: 'en' },
    // Admin
    { id: 'admin_katrien',  name: 'Katrien De Wolf',   email: 'katrien@wavelink.demo',  role: 'admin',   partnerId: 'wavelink', departments: [],                 lang: 'nl' },
    // Platform Operator
    { id: 'platform_bart',  name: 'Bart Claessens',    email: 'bart@tessera.demo',      role: 'admin',   partnerId: 'wavelink', departments: [],                 lang: 'nl', isPlatformOperator: true },

    // ── GreenLeaf Insurance ──
    { id: 'agent_lien',     name: 'Lien Maes',         email: 'lien@greenleaf.demo',    role: 'agent',   partnerId: 'greenleaf', departments: ['claims'],        lang: 'nl' },
    { id: 'agent_youssef',  name: 'Youssef El Amrani', email: 'youssef@greenleaf.demo', role: 'agent',   partnerId: 'greenleaf', departments: ['policies'],      lang: 'fr' },
    { id: 'support_nora',   name: 'Nora Peeters',      email: 'nora@greenleaf.demo',    role: 'support', partnerId: 'greenleaf', departments: ['claims'],        lang: 'nl' },
    { id: 'admin_marc',     name: 'Marc Leclercq',     email: 'marc@greenleaf.demo',    role: 'admin',   partnerId: 'greenleaf', departments: [],                lang: 'fr' },
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
    console.log(`   ✓ ${u.role.padEnd(8)} ${u.name} (${u.email})`);
  }

  // Give platform_bart access to GreenLeaf too (multi-partner demo)
  await db.insert(memberships).values({
    id: 'mem_platform_bart_gl', userId: 'platform_bart', partnerId: 'greenleaf',
    role: 'admin', departments: [], createdAt: ago(30),
  });
  console.log('   ✓ Bart also has GreenLeaf access\n');

  // ── 4. LABELS ──────────────────────────────────────────────────────────────
  console.log('④ Creating labels...');

  const wlLabels = [
    { id: 'lbl_outage',     partnerId: 'wavelink',   name: 'Outage',         color: '#dc2626' },
    { id: 'lbl_billing',    partnerId: 'wavelink',   name: 'Billing',        color: '#2563eb' },
    { id: 'lbl_urgent',     partnerId: 'wavelink',   name: 'Urgent',         color: '#ea580c' },
    { id: 'lbl_5g',         partnerId: 'wavelink',   name: '5G',             color: '#7c3aed' },
    { id: 'lbl_recurring',  partnerId: 'wavelink',   name: 'Recurring',      color: '#0891b2' },
    { id: 'lbl_vip',        partnerId: 'wavelink',   name: 'VIP Customer',   color: '#ca8a04' },
  ];
  const glLabels = [
    { id: 'lbl_claim',      partnerId: 'greenleaf',  name: 'Open Claim',     color: '#dc2626' },
    { id: 'lbl_renewal',    partnerId: 'greenleaf',  name: 'Renewal',        color: '#2563eb' },
    { id: 'lbl_escalation', partnerId: 'greenleaf',  name: 'Escalation',     color: '#ea580c' },
  ];

  for (const l of [...wlLabels, ...glLabels]) {
    await db.insert(labels).values(l);
    console.log(`   ✓ ${l.name} (${l.partnerId})`);
  }
  console.log();

  // ── 5. CANNED RESPONSES ────────────────────────────────────────────────────
  console.log('⑤ Creating canned responses...');

  const cannedData = [
    { partnerId: 'wavelink', title: 'Greeting',             shortcut: '/hi',       category: 'General',  body: 'Hello! Thank you for contacting WaveLink support. How can I help you today?' },
    { partnerId: 'wavelink', title: 'Outage Acknowledged',  shortcut: '/outage',   category: 'Network',  body: 'We are aware of the service disruption in your area. Our network team is actively working on restoring connectivity. We expect resolution within the next 2 hours.' },
    { partnerId: 'wavelink', title: 'Billing Clarification',shortcut: '/bill',     category: 'Billing',  body: 'I can see your account details. Let me review the charges in question and get back to you with a detailed breakdown.' },
    { partnerId: 'wavelink', title: 'Escalation Notice',    shortcut: '/esc',      category: 'General',  body: 'I\'m escalating your case to our specialized team. They will follow up within 24 hours. Your reference number is noted.' },
    { partnerId: 'wavelink', title: 'Closing — Resolved',   shortcut: '/done',     category: 'Closing',  body: 'I\'m glad we could resolve this for you! Is there anything else I can help with before we close this ticket?' },
    { partnerId: 'greenleaf',title: 'Claim Received',       shortcut: '/claim',    category: 'Claims',   body: 'Your claim has been received and assigned a case number. Our claims team will review it within 3 business days.' },
    { partnerId: 'greenleaf',title: 'Documents Needed',     shortcut: '/docs',     category: 'Claims',   body: 'To process your claim, we need the following documents: police report (if applicable), photos of damage, and your signed declaration form.' },
  ];

  for (const c of cannedData) {
    await db.insert(cannedResponses).values({
      id: uid(), partnerId: c.partnerId, title: c.title, shortcut: c.shortcut,
      category: c.category, body: c.body, createdBy: c.partnerId === 'wavelink' ? 'support_jan' : 'support_nora',
      createdAt: ago(20), updatedAt: NOW,
    });
    console.log(`   ✓ ${c.shortcut} — ${c.title}`);
  }
  console.log();

  // ── 6. KB ARTICLES ─────────────────────────────────────────────────────────
  console.log('⑥ Creating knowledge base articles...');

  const kbData = [
    { partnerId: 'wavelink', title: 'Router Reset Procedure',      category: 'Network',  body: '## How to Reset Your WaveLink Router\n\n1. Unplug the power cable from the back of the router\n2. Wait 30 seconds\n3. Plug the power cable back in\n4. Wait 2–3 minutes for all lights to stabilize\n5. The **Power**, **Internet**, and **Wi-Fi** LEDs should be solid green\n\nIf the Internet light remains red after 5 minutes, contact support.' },
    { partnerId: 'wavelink', title: '5G Coverage Map FAQ',          category: 'Network',  body: '## 5G Coverage\n\nWaveLink 5G is available in:\n- Brussels Capital Region (full coverage)\n- Antwerp city center\n- Ghent — expanding Q2 2026\n- Liège — planned Q3 2026\n\n**Speed expectations**: 300–900 Mbps download, 50–150 Mbps upload.\n\nCheck real-time coverage at wavelink.be/coverage.' },
    { partnerId: 'wavelink', title: 'Understanding Your Invoice',   category: 'Billing',  body: '## Monthly Invoice Breakdown\n\n- **Base plan**: Your subscribed package rate\n- **Usage charges**: Any overage beyond your plan limits\n- **Equipment rental**: Router/modem lease (€4.99/mo)\n- **Taxes**: 21% VAT applied to all charges\n\nInvoices are generated on the 1st of each month. Payment is due within 14 days.' },
    { partnerId: 'greenleaf',title: 'Filing a Home Insurance Claim',category: 'Claims',   body: '## Home Insurance Claim Process\n\n1. **Report the incident** within 48 hours via this chat or phone\n2. **Document the damage** — take photos and note the date/time\n3. **Submit supporting documents**: police report (theft/vandalism), repair estimates\n4. **Adjuster visit**: scheduled within 5 business days for claims > €2,000\n5. **Decision**: typically within 10 business days of complete file\n\nKeep all receipts for temporary repairs — these are reimbursable.' },
    { partnerId: 'greenleaf',title: 'Policy Renewal Guide',         category: 'Policies', body: '## Annual Policy Renewal\n\nYour GreenLeaf policy renews automatically each year. 30 days before renewal:\n- Review your coverage letter (sent by email)\n- Update any life changes (new property, renovation, etc.)\n- Compare your premium to the renewal offer\n\nTo modify or cancel, contact us at least 14 days before the renewal date.' },
  ];

  for (const kb of kbData) {
    await db.insert(kbArticles).values({
      id: uid(), partnerId: kb.partnerId, title: kb.title, category: kb.category,
      body: kb.body, createdBy: kb.partnerId === 'wavelink' ? 'admin_katrien' : 'admin_marc',
      createdAt: ago(15), updatedAt: NOW,
    });
    console.log(`   ✓ ${kb.title}`);
  }
  console.log();

  // ── 7. TICKETS + MESSAGES ──────────────────────────────────────────────────
  console.log('⑦ Creating tickets with conversations...');

  // Helper to create a ticket with messages
  async function createTicket(t: {
    id: string; partnerId: string; dept: string;
    agent: { id: string; name: string; lang: string };
    support?: { id: string; name: string; lang: string };
    subject: string; status: 'open' | 'pending' | 'closed' | 'resolved';
    labels?: string[]; createdDaysAgo: number;
    closedDaysAgo?: number;
    messages: Array<{ senderId: string; senderName: string; senderRole: string; senderLang: string; text: string; daysAgo: number; hoursAgo?: number }>;
    refs?: Array<{ label: string; value: string }>;
  }) {
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
      subject: t.subject, participants,
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
        createdAt: ago(m.daysAgo, m.hoursAgo ?? 0),
        deliveredAt: ago(m.daysAgo, m.hoursAgo ?? 0),
        readAt: ago(m.daysAgo, (m.hoursAgo ?? 0)),
      });
    }

    if (t.labels?.length) {
      for (const lbl of t.labels) {
        await db.insert(ticketLabels).values({ ticketId: t.id, labelId: lbl });
      }
    }
    console.log(`   ✓ ${t.id} — ${t.subject} [${t.status}]`);
  }

  // ── Ticket 1: Open — Network outage (active conversation)
  await createTicket({
    id: 'tk_001', partnerId: 'wavelink', dept: 'network-ops',
    agent: { id: 'agent_sarah', name: 'Sarah Verhoeven', lang: 'nl' },
    support: { id: 'support_jan', name: 'Jan Willems', lang: 'nl' },
    subject: 'Internet keeps dropping since yesterday',
    status: 'open', labels: ['lbl_outage', 'lbl_urgent'], createdDaysAgo: 1,
    refs: [{ label: 'Account', value: 'WL-2024-88741' }],
    messages: [
      { senderId: 'agent_sarah', senderName: 'Sarah Verhoeven', senderRole: 'agent', senderLang: 'nl', text: 'Hallo, mijn internet valt om de 10 minuten weg sinds gisterenavond. Ik heb al geprobeerd de router te herstarten maar dat helpt niet.', daysAgo: 1 },
      { senderId: 'support_jan', senderName: 'Jan Willems', senderRole: 'support', senderLang: 'nl', text: 'Goedendag Sarah, vervelend om te horen. Ik check even je lijnstatus. Kan je bevestigen: gaat het om een vast of draadloos probleem?', daysAgo: 1, hoursAgo: -1 },
      { senderId: 'agent_sarah', senderName: 'Sarah Verhoeven', senderRole: 'agent', senderLang: 'nl', text: 'Zowel WiFi als ethernet via kabel. Alles valt tegelijk weg.', daysAgo: 1, hoursAgo: -2 },
      { senderId: 'support_jan', senderName: 'Jan Willems', senderRole: 'support', senderLang: 'nl', text: 'Ik zie inderdaad instabiliteit op je lijn. Er lijkt een probleem te zijn aan de wijkcentrale. Ik open een prioriteitsticket bij het netwerk-team.', daysAgo: 0, hoursAgo: 6 },
    ],
  });

  // ── Ticket 2: Open — Billing dispute (unassigned, waiting for support)
  await createTicket({
    id: 'tk_002', partnerId: 'wavelink', dept: 'billing',
    agent: { id: 'agent_emma', name: 'Emma Claes', lang: 'nl' },
    subject: 'Dubbele afrekening op mijn factuur van maart',
    status: 'open', labels: ['lbl_billing'], createdDaysAgo: 0,
    refs: [{ label: 'Invoice', value: 'INV-2026-03-4412' }],
    messages: [
      { senderId: 'agent_emma', senderName: 'Emma Claes', senderRole: 'agent', senderLang: 'nl', text: 'Ik heb zojuist mijn factuur bekeken en er staat twee keer hetzelfde bedrag van €49.99 op. Kan iemand dit nakijken?', daysAgo: 0, hoursAgo: 2 },
    ],
  });

  // ── Ticket 3: Open — French-speaking customer, 5G question
  await createTicket({
    id: 'tk_003', partnerId: 'wavelink', dept: 'customer-care',
    agent: { id: 'agent_lucas', name: 'Lucas Martin', lang: 'fr' },
    support: { id: 'support_amelie', name: 'Amélie Rousseau', lang: 'fr' },
    subject: 'Quand la 5G sera-t-elle disponible à Namur?',
    status: 'pending', labels: ['lbl_5g'], createdDaysAgo: 3,
    messages: [
      { senderId: 'agent_lucas', senderName: 'Lucas Martin', senderRole: 'agent', senderLang: 'fr', text: 'Bonjour, je voulais savoir quand la couverture 5G sera déployée à Namur. Mon contrat se termine bientôt et j\'hésite à renouveler sans 5G.', daysAgo: 3 },
      { senderId: 'support_amelie', senderName: 'Amélie Rousseau', senderRole: 'support', senderLang: 'fr', text: 'Bonjour Lucas! Merci pour votre question. Namur est prévu pour le T4 2026 dans notre feuille de route 5G. Je vérifie s\'il y a des mises à jour récentes.', daysAgo: 3, hoursAgo: -2 },
      { senderId: 'support_amelie', senderName: 'Amélie Rousseau', senderRole: 'support', senderLang: 'fr', text: 'Je viens de confirmer avec l\'équipe réseau: Namur-centre est avancé au T3 2026. Je vous enverrai une notification dès que c\'est activé.', daysAgo: 2 },
      { senderId: 'agent_lucas', senderName: 'Lucas Martin', senderRole: 'agent', senderLang: 'fr', text: 'Super nouvelle! Dans ce cas je vais renouveler. Merci Amélie.', daysAgo: 2, hoursAgo: -3 },
    ],
  });

  // ── Ticket 4: Resolved — Happy customer, great rating
  await createTicket({
    id: 'tk_004', partnerId: 'wavelink', dept: 'customer-care',
    agent: { id: 'agent_noah', name: 'Noah De Bruyne', lang: 'nl' },
    support: { id: 'support_amelie', name: 'Amélie Rousseau', lang: 'fr' },
    subject: 'Help setting up parental controls',
    status: 'resolved', labels: [], createdDaysAgo: 5, closedDaysAgo: 4,
    messages: [
      { senderId: 'agent_noah', senderName: 'Noah De Bruyne', senderRole: 'agent', senderLang: 'nl', text: 'I\'d like to set up parental controls on my router. My kids are staying up too late watching YouTube!', daysAgo: 5 },
      { senderId: 'support_amelie', senderName: 'Amélie Rousseau', senderRole: 'support', senderLang: 'fr', text: 'Hi Noah! I can walk you through that. Go to 192.168.1.1 in your browser, log in with the credentials on the sticker under your router, then navigate to Security > Parental Controls.', daysAgo: 5, hoursAgo: -1 },
      { senderId: 'agent_noah', senderName: 'Noah De Bruyne', senderRole: 'agent', senderLang: 'nl', text: 'Found it! I can set time schedules per device?', daysAgo: 5, hoursAgo: -2 },
      { senderId: 'support_amelie', senderName: 'Amélie Rousseau', senderRole: 'support', senderLang: 'fr', text: 'Exactly! You can set different schedules for each connected device. I recommend creating a "Kids" profile group so you can manage them all at once.', daysAgo: 5, hoursAgo: -2 },
      { senderId: 'agent_noah', senderName: 'Noah De Bruyne', senderRole: 'agent', senderLang: 'nl', text: 'Perfect, all set up! Thank you so much, this was incredibly easy with your help.', daysAgo: 4 },
    ],
  });

  // ── Ticket 5: Closed — Network issue that was fixed
  await createTicket({
    id: 'tk_005', partnerId: 'wavelink', dept: 'network-ops',
    agent: { id: 'agent_chloe', name: 'Chloé Fontaine', lang: 'fr' },
    support: { id: 'support_jan', name: 'Jan Willems', lang: 'nl' },
    subject: 'Pas de connexion depuis la mise à jour firmware',
    status: 'closed', labels: ['lbl_recurring'], createdDaysAgo: 7, closedDaysAgo: 6,
    messages: [
      { senderId: 'agent_chloe', senderName: 'Chloé Fontaine', senderRole: 'agent', senderLang: 'fr', text: 'Depuis la mise à jour automatique de mon routeur hier soir, plus aucune connexion. Le voyant Internet clignote orange.', daysAgo: 7 },
      { senderId: 'support_jan', senderName: 'Jan Willems', senderRole: 'support', senderLang: 'nl', text: 'Bonjour Chloé, I see the firmware update caused a configuration reset on your unit. I\'m pushing a corrected config remotely now. Can you power-cycle the router in 2 minutes?', daysAgo: 7, hoursAgo: -1 },
      { senderId: 'agent_chloe', senderName: 'Chloé Fontaine', senderRole: 'agent', senderLang: 'fr', text: 'C\'est fait! Le voyant est redevenu vert, tout fonctionne à nouveau. Merci beaucoup!', daysAgo: 6 },
      { senderId: 'support_jan', senderName: 'Jan Willems', senderRole: 'support', senderLang: 'nl', text: 'Parfait! I\'ve also flagged this firmware version for review so it doesn\'t happen to other customers. Closing this ticket.', daysAgo: 6 },
    ],
  });

  // ── Ticket 6: Open — VIP customer, English
  await createTicket({
    id: 'tk_006', partnerId: 'wavelink', dept: 'customer-care',
    agent: { id: 'agent_noah', name: 'Noah De Bruyne', lang: 'nl' },
    support: { id: 'support_thomas', name: 'Thomas Bakker', lang: 'en' },
    subject: 'Corporate plan upgrade for 50 offices',
    status: 'open', labels: ['lbl_vip', 'lbl_billing'], createdDaysAgo: 0,
    refs: [{ label: 'Company', value: 'NovaTech Industries' }, { label: 'Contract', value: 'CORP-2025-1100' }],
    messages: [
      { senderId: 'agent_noah', senderName: 'Noah De Bruyne', senderRole: 'agent', senderLang: 'nl', text: 'We\'re expanding to 50 offices and need to upgrade our corporate plan. Current contract is CORP-2025-1100. Can we get a volume discount for the additional 30 locations?', daysAgo: 0, hoursAgo: 4 },
      { senderId: 'support_thomas', senderName: 'Thomas Bakker', senderRole: 'support', senderLang: 'en', text: 'Hi Noah, great to hear about the expansion! I\'m pulling up your corporate account. For 50+ locations, you\'d qualify for our Enterprise tier which includes a 20% volume discount and dedicated account manager. Let me prepare a formal quote.', daysAgo: 0, hoursAgo: 3 },
    ],
  });

  // ── Ticket 7: GreenLeaf — Open claim
  await createTicket({
    id: 'tk_007', partnerId: 'greenleaf', dept: 'claims',
    agent: { id: 'agent_lien', name: 'Lien Maes', lang: 'nl' },
    support: { id: 'support_nora', name: 'Nora Peeters', lang: 'nl' },
    subject: 'Waterschade na leidingbreuk — claim indienen',
    status: 'open', labels: ['lbl_claim'], createdDaysAgo: 2,
    refs: [{ label: 'Policy', value: 'GL-HOME-44821' }],
    messages: [
      { senderId: 'agent_lien', senderName: 'Lien Maes', senderRole: 'agent', senderLang: 'nl', text: 'Goedendag, afgelopen nacht is er een leiding gesprongen in mijn badkamer. Er is waterschade aan de vloer en de muur van de aangrenzende kamer. Ik heb foto\'s genomen.', daysAgo: 2 },
      { senderId: 'support_nora', senderName: 'Nora Peeters', senderRole: 'support', senderLang: 'nl', text: 'Wat vervelend, Lien. Uw polis GL-HOME-44821 dekt waterschade. Kunt u de foto\'s uploaden en een ruwe schatting van de schade geven?', daysAgo: 2, hoursAgo: -2 },
      { senderId: 'agent_lien', senderName: 'Lien Maes', senderRole: 'agent', senderLang: 'nl', text: 'De loodgieter schat de reparatie op zo\'n €1.800 voor de leiding + €2.200 voor vloer en muur. Ik upload de foto\'s en het verslag.', daysAgo: 1, hoursAgo: 6 },
      { senderId: 'support_nora', senderName: 'Nora Peeters', senderRole: 'support', senderLang: 'nl', text: 'Bedankt. Gezien het bedrag boven €2.000 ligt, stuur ik een expert langs. Ik plan dit in voor de komende 3 werkdagen. U ontvangt een bevestiging per email.', daysAgo: 1 },
    ],
  });

  // ── Ticket 8: GreenLeaf — Resolved policy question
  await createTicket({
    id: 'tk_008', partnerId: 'greenleaf', dept: 'policies',
    agent: { id: 'agent_youssef', name: 'Youssef El Amrani', lang: 'fr' },
    support: { id: 'support_nora', name: 'Nora Peeters', lang: 'nl' },
    subject: 'Question sur la couverture vélo électrique',
    status: 'resolved', labels: ['lbl_renewal'], createdDaysAgo: 10, closedDaysAgo: 9,
    messages: [
      { senderId: 'agent_youssef', senderName: 'Youssef El Amrani', senderRole: 'agent', senderLang: 'fr', text: 'Je viens d\'acheter un vélo électrique à €3.500. Est-ce couvert par mon assurance habitation ou dois-je une assurance séparée?', daysAgo: 10 },
      { senderId: 'support_nora', senderName: 'Nora Peeters', senderRole: 'support', senderLang: 'nl', text: 'Bonjour Youssef! Les vélos électriques jusqu\'à €3.000 sont couverts automatiquement par votre assurance habitation. Pour un vélo à €3.500, je recommande notre extension mobilité douce — €4.90/mois, couvre vol, dommages et assistance.', daysAgo: 10, hoursAgo: -3 },
      { senderId: 'agent_youssef', senderName: 'Youssef El Amrani', senderRole: 'agent', senderLang: 'fr', text: 'Parfait, je prends l\'extension. Comment l\'activer?', daysAgo: 9 },
      { senderId: 'support_nora', senderName: 'Nora Peeters', senderRole: 'support', senderLang: 'nl', text: 'C\'est activé! J\'ai ajouté l\'extension à votre police. Vous recevrez la confirmation par email. La couverture est effective immédiatement.', daysAgo: 9, hoursAgo: -2 },
    ],
  });

  // ── 8. RATINGS ─────────────────────────────────────────────────────────────
  console.log('⑧ Creating ratings...');

  const ratingsData = [
    { ticketId: 'tk_004', partnerId: 'wavelink',  agentId: 'agent_noah',    supportId: 'support_amelie', rating: 5, comment: 'Incredibly helpful, solved my problem in minutes!' },
    { ticketId: 'tk_005', partnerId: 'wavelink',  agentId: 'agent_chloe',   supportId: 'support_jan',    rating: 4, comment: 'Fixed quickly, but the firmware issue shouldn\'t have happened.' },
    { ticketId: 'tk_008', partnerId: 'greenleaf', agentId: 'agent_youssef', supportId: 'support_nora',   rating: 5, comment: 'Très professionnel, activation immédiate.' },
  ];

  for (const r of ratingsData) {
    await db.insert(ratings).values({
      id: uid(), partnerId: r.partnerId, ticketId: r.ticketId,
      agentId: r.agentId, supportId: r.supportId,
      rating: r.rating, comment: r.comment, createdAt: ago(4),
    });
    console.log(`   ✓ ${r.ticketId} — ${r.rating}★`);
  }
  console.log();

  // ── 9. APP FEEDBACK ────────────────────────────────────────────────────────
  console.log('⑨ Creating app feedback...');

  const feedbackData = [
    { userId: 'support_jan',    partnerId: 'wavelink',  userName: 'Jan Willems',      role: 'support', text: 'The AI copilot suggestions are really accurate for network troubleshooting. Saves me a lot of time looking up procedures.' },
    { userId: 'admin_katrien',  partnerId: 'wavelink',  userName: 'Katrien De Wolf',  role: 'admin',   text: 'Would love to see department-level SLA dashboards with trend lines. Current stats view is good but needs more granularity.' },
    { userId: 'support_nora',   partnerId: 'greenleaf', userName: 'Nora Peeters',     role: 'support', text: 'Multilingual support works great — I can help French-speaking clients even though I primarily work in Dutch.' },
  ];

  for (const f of feedbackData) {
    await db.insert(appFeedback).values({
      id: uid(), userId: f.userId, partnerId: f.partnerId,
      userName: f.userName, role: f.role, text: f.text, createdAt: ago(5),
    });
    console.log(`   ✓ Feedback from ${f.userName}`);
  }
  console.log();

  // ── 10. DAILY STATS (last 14 days for WaveLink) ───────────────────────────
  console.log('⑩ Creating daily stats (14 days)...');

  for (let d = 13; d >= 0; d--) {
    const date = new Date();
    date.setDate(date.getDate() - d);
    const dateStr = date.toISOString().split('T')[0];
    const isWeekend = date.getDay() === 0 || date.getDay() === 6;
    const base = isWeekend ? 3 : 12;

    await db.insert(dailyStats).values({
      date: dateStr, partnerId: 'wavelink',
      total: base + Math.floor(Math.random() * 6),
      closed: Math.floor(base * 0.7) + Math.floor(Math.random() * 3),
      abandoned: Math.floor(Math.random() * 2),
      avgResponseMs: 45000 + Math.floor(Math.random() * 30000),
      avgDurationMs: 300000 + Math.floor(Math.random() * 200000),
      avgRating: parseFloat((4.0 + Math.random() * 0.8).toFixed(2)),
      ratingCount: 3 + Math.floor(Math.random() * 5),
      slaResolved: base - Math.floor(Math.random() * 2),
      slaCompliant: base - Math.floor(Math.random() * 3),
      reopened: Math.floor(Math.random() * 2),
      deptCounts: { 'network-ops': Math.ceil(base * 0.4), 'customer-care': Math.ceil(base * 0.35), 'billing': Math.ceil(base * 0.25) },
    });
  }
  console.log('   ✓ 14 days of WaveLink stats\n');

  // ── 11. AUDIT LOG ENTRIES ──────────────────────────────────────────────────
  console.log('⑪ Creating audit log entries...');

  const auditEntries = [
    { action: 'partner.created',   actorId: 'platform_bart',  partnerId: 'wavelink',  targetType: 'partner', targetId: 'wavelink',  metadata: { name: 'WaveLink Telecom' }, daysAgo: 90 },
    { action: 'partner.created',   actorId: 'platform_bart',  partnerId: 'greenleaf', targetType: 'partner', targetId: 'greenleaf', metadata: { name: 'GreenLeaf Insurance' }, daysAgo: 60 },
    { action: 'user.invited',      actorId: 'admin_katrien',  partnerId: 'wavelink',  targetType: 'user',    targetId: 'support_jan',    metadata: { role: 'support', email: 'jan@wavelink.demo' }, daysAgo: 30 },
    { action: 'user.invited',      actorId: 'admin_katrien',  partnerId: 'wavelink',  targetType: 'user',    targetId: 'support_amelie', metadata: { role: 'support', email: 'amelie@wavelink.demo' }, daysAgo: 30 },
    { action: 'user.invited',      actorId: 'admin_marc',     partnerId: 'greenleaf', targetType: 'user',    targetId: 'support_nora',   metadata: { role: 'support', email: 'nora@greenleaf.demo' }, daysAgo: 30 },
    { action: 'partner.settings',  actorId: 'admin_katrien',  partnerId: 'wavelink',  targetType: 'partner', targetId: 'wavelink',  metadata: { field: 'businessHours', value: '08:00-18:00' }, daysAgo: 20 },
  ];

  for (const a of auditEntries) {
    await db.insert(auditLog).values({
      id: uid(), action: a.action, actorId: a.actorId, partnerId: a.partnerId,
      targetType: a.targetType, targetId: a.targetId, metadata: a.metadata,
      createdAt: ago(a.daysAgo),
    });
  }
  console.log('   ✓ 6 audit log entries\n');

  // ── SUMMARY ────────────────────────────────────────────────────────────────
  console.log('╔══════════════════════════════════════╗');
  console.log('║          Seed Complete! ✓            ║');
  console.log('╚══════════════════════════════════════╝');
  console.log();
  console.log('Partners:  2 (WaveLink Telecom, GreenLeaf Insurance)');
  console.log('Users:    14 (10 WaveLink + 4 GreenLeaf)');
  console.log('Tickets:   8 (4 open, 1 pending, 1 closed, 2 resolved)');
  console.log('Labels:    9 (6 WaveLink + 3 GreenLeaf)');
  console.log('Canned:    7 responses');
  console.log('KB:        5 articles');
  console.log('Ratings:   3');
  console.log('Stats:    14 days of dashboard data');
  console.log();
  console.log('All users → password: password123');
  console.log();
  console.log('Key logins:');
  console.log('  Platform:  bart@tessera.demo (platform operator)');
  console.log('  Admin WL:  katrien@wavelink.demo');
  console.log('  Admin GL:  marc@greenleaf.demo');
  console.log('  Support:   jan@wavelink.demo / amelie@wavelink.demo / nora@greenleaf.demo');
  console.log('  Customer:  sarah@wavelink.demo / lucas@wavelink.demo / lien@greenleaf.demo');

  process.exit(0);
}

main().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
