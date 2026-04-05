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
}

async function seedFull() {
  console.log('🚀 Starting FULLWEIGHT seed (Realistic Scale)...');
  const hash = await hashPassword(DEFAULT_PASSWORD);
  
  // 1. Create Partners (Organizations)
  console.log('   - Generating 8 Partners...');
  const partnerIds: string[] = [];
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

  for (let i = 0; i < 8; i++) {
    const id = i === 0 ? 'tessera-main' : faker.string.uuid();
    partnerIds.push(id);
    await db.insert(schema.partners).values({
      id,
      name: i === 0 ? 'Tessera Corp' : faker.company.name(),
      industry: faker.helpers.arrayElement(INDUSTRIES),
      departments: DEPARTMENTS,
      // 24/7 Business Hours for testing
      businessHoursStart: '00:00',
      businessHoursEnd: '23:59',
      businessHoursTimezone: 'UTC',
      businessHoursSchedule, // Explicit 24/7 schedule
      status: 'active',
      aiEnabled: true,
    });
  }

  // 2. Create Labels for each partner
  console.log('   - Generating Labels...');
  const labelIdsByPartner: Record<string, string[]> = {};
  for (const pId of partnerIds) {
    labelIdsByPartner[pId] = [];
    const labelNames = ['Urgent', 'Bug', 'Feature', 'Billing', 'Question', 'Security', 'Feedback', 'Onboarding'];
    for (let i = 0; i < labelNames.length; i++) {
      const lid = faker.string.uuid();
      labelIdsByPartner[pId].push(lid);
      await db.insert(schema.labels).values({ 
        id: lid, 
        partnerId: pId, 
        name: labelNames[i], 
        color: LABEL_COLORS[i % LABEL_COLORS.length] 
      });
    }
  }

  // 3. Create Users & Memberships
  console.log('   - Generating 60 Users (One Identity, Multiple Tenants)...');
  const users: { id: string, name: string, email: string, isPlatform: boolean }[] = [];
  
  // THE Platform Admin (Single Global Identity)
  const platformAdmin = {
    id: 'platform_bart',
    name: 'Bart Operator',
    email: 'bart@tessera.io',
    password: hash,
    isPlatformOperator: true,
    accessibilityPrefs: {},
  };
  await db.insert(schema.users).values(platformAdmin);
  users.push({ id: platformAdmin.id, name: platformAdmin.name, email: platformAdmin.email!, isPlatform: true });

  // Generate unique users
  for (let i = 0; i < 60; i++) {
    const uid = faker.string.uuid();
    const name = faker.person.fullName();
    const email = faker.internet.email({ firstName: name.split(' ')[0], provider: 'tessera.io' });
    
    await db.insert(schema.users).values({
      id: uid,
      name,
      email,
      lang: faker.helpers.arrayElement(LANGUAGES) as any,
      password: hash,
      accessibilityPrefs: {},
      isPlatformOperator: false, // Only Bart is platform admin
    });
    users.push({ id: uid, name, email, isPlatform: false });
  }

  // Assign memberships (Users can belong to multiple partners)
  console.log('   - Assigning Memberships...');
  for (const user of users) {
    if (user.isPlatform) {
      // Platform Admin no longer needs explicit memberships in the DB!
      // Global access is now handled implicitly in server/services/authSession.ts
      continue;
    }

    // Regular users belong to 1-3 partners
    const assignedPartners = faker.helpers.arrayElements(partnerIds, { min: 1, max: 3 });
    
    for (const pId of assignedPartners) {
      const role = faker.helpers.arrayElement(['agent', 'agent', 'support', 'admin']);
      await db.insert(schema.memberships).values({
        id: `mem_${user.id}_${pId}`,
        userId: user.id,
        partnerId: pId,
        role: role as any,
        departments: role === 'agent' ? [] : faker.helpers.arrayElements(DEPARTMENTS.map(d => d.id), { min: 1, max: 3 }),
      });
    }
  }

  // 4. Knowledge Base, Canned Responses & Webhooks
  console.log('   - Generating KB, Canned Responses & Webhooks...');
  for (const pId of partnerIds) {
    for (let i = 0; i < 5; i++) {
      await db.insert(schema.kbArticles).values({
        id: faker.string.uuid(),
        partnerId: pId,
        title: faker.lorem.sentence(),
        body: faker.lorem.paragraphs(3),
        slug: faker.helpers.slugify(faker.lorem.words(3).toLowerCase()) + '-' + faker.string.alphanumeric(4),
        published: true,
      });
      
      await db.insert(schema.cannedResponses).values({
        id: faker.string.uuid(),
        partnerId: pId,
        title: faker.lorem.words(3),
        body: faker.lorem.sentence(),
        shortcut: '/' + faker.lorem.word(),
      });
    }

    // Generate 2 Webhooks for each partner
    for (let i = 0; i < 2; i++) {
      await db.insert(schema.webhooks).values({
        id: faker.string.uuid(),
        partnerId: pId,
        url: faker.internet.url(),
        secret: faker.string.alphanumeric(32),
        events: ['ticket.created', 'ticket.closed'],
        description: `External ${faker.hacker.adjective()} integration for ${faker.company.buzzPhrase()}`,
        active: true,
      });
    }
  }

  // 5. Tickets & Messages (The heavy part)
  console.log('   - Generating 300 Tickets & 2000 Messages...');
  
  // Get all memberships to ensure we only create tickets for valid user-partner pairs
  const allMemberships = await db.select().from(schema.memberships);

  for (let i = 0; i < 300; i++) {
    const membership = faker.helpers.arrayElement(allMemberships);
    const user = users.find(u => u.id === membership.userId)!;
    const tid = faker.string.uuid();
    const createdAt = faker.date.recent({ days: 30 });
    const status = faker.helpers.arrayElement(['open', 'pending', 'closed', 'resolved']);
    
    await db.insert(schema.tickets).values({
      id: tid,
      partnerId: membership.partnerId,
      dept: faker.helpers.arrayElement(DEPARTMENTS).id,
      agentId: membership.userId,
      agentName: user.name,
      status: status as any,
      createdAt,
      updatedAt: createdAt,
      closedAt: status === 'closed' || status === 'resolved' ? faker.date.between({ from: createdAt, to: new Date() }) : null,
      // References field populated with realistic data
      references: [
        { label: 'Order ID', value: `ORD-${faker.string.numeric(6)}` },
        { label: 'External ID', value: faker.string.alphanumeric(10).toUpperCase() }
      ],
    });

    // Random Labels
    const randomLabels = faker.helpers.arrayElements(labelIdsByPartner[membership.partnerId], { min: 0, max: 2 });
    for (const lid of randomLabels) {
      await db.insert(schema.ticketLabels).values({ ticketId: tid, labelId: lid });
    }

    // Messages for this ticket
    const msgCount = faker.number.int({ min: 2, max: 12 });
    for (let j = 0; j < msgCount; j++) {
      await db.insert(schema.messages).values({
        id: faker.string.uuid(),
        ticketId: tid,
        senderId: j % 2 === 0 ? membership.userId : faker.string.uuid(), // Mix of agent and system/customer
        senderName: j % 2 === 0 ? 'Agent' : 'Customer',
        text: faker.lorem.sentence(),
        createdAt: new Date(createdAt.getTime() + j * 1000 * 60 * 30), // Spaced out
      });
    }

    // Feedback/Ratings for closed tickets
    if (status === 'closed' || status === 'resolved') {
      if (faker.datatype.boolean(0.7)) {
        await db.insert(schema.ratings).values({
          id: faker.string.uuid(),
          partnerId: membership.partnerId,
          ticketId: tid,
          agentId: membership.userId,
          rating: faker.number.int({ min: 1, max: 5 }),
          comment: faker.lorem.sentence(),
        });
      }
    }
  }

  // 6. App Feedback
  console.log('   - Generating App Feedback...');
  for (let i = 0; i < 20; i++) {
    const membership = faker.helpers.arrayElement(allMemberships);
    const user = users.find(u => u.id === membership.userId)!;
    await db.insert(schema.appFeedback).values({
      id: faker.string.uuid(),
      userId: user.id,
      partnerId: membership.partnerId,
      userName: user.name,
      role: membership.role,
      text: faker.lorem.sentence(),
      createdAt: faker.date.recent({ days: 15 }),
    });
  }

  console.log('✅ FULLWEIGHT seed complete.');
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
    if (isWipe) await wipeDatabase();
    if (isFull) await seedFull();
    else if (isE2E) await seedE2E();
    else {
      console.log('No action specified. Use --wipe, --e2e, or --full.\n');
      process.exit(0);
    }
    console.log('\n✨ Database operations finished successfully.');
  } catch (err) {
    console.error('\n❌ Fatal error during seeding:', err);
    process.exit(1);
  }
  process.exit(0);
}

main();
