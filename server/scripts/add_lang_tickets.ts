/**
 * Dev-only helper: append a handful of NL + FR tickets to the `acme` partner
 * so the support-queue language filter can be exercised in dev.
 *
 * Idempotent — rerunning skips rows that already exist.
 *
 * Usage:
 *   docker compose exec server npx tsx scripts/add_lang_tickets.ts
 */
import { db } from '../db.js';
import * as schema from '../db/schema.js';

const PARTNER_ID = 'acme';

interface DemoAgent {
  id: string;
  name: string;
  email: string;
  lang: 'nl' | 'fr';
}

interface DemoTicket {
  id: string;
  dept: 'DSC' | 'FOT' | 'TEC';
  agent: DemoAgent;
  firstMessage: string;
}

const AGENTS: DemoAgent[] = [
  { id: 'agent_noa',  name: 'Noa Agent',  email: 'noa@acme.test',  lang: 'nl' },
  { id: 'agent_bram', name: 'Bram Agent', email: 'bram@acme.test', lang: 'nl' },
  { id: 'agent_luc',  name: 'Luc Agent',  email: 'luc@acme.test',  lang: 'fr' },
  { id: 'agent_amelie', name: 'Amélie Agent', email: 'amelie@acme.test', lang: 'fr' },
];

const TICKETS: DemoTicket[] = [
  {
    id: 'ticket_queue_nl_1',
    dept: 'DSC',
    agent: AGENTS[0],
    firstMessage: 'De dispatcher voor route 17 is niet bereikbaar — het portaal blijft een time-out geven.',
  },
  {
    id: 'ticket_queue_nl_2',
    dept: 'TEC',
    agent: AGENTS[1],
    firstMessage: 'Onze productie-API geeft sinds vanochtend een 500-fout op POST /ingest.',
  },
  {
    id: 'ticket_queue_fr_1',
    dept: 'FOT',
    agent: AGENTS[2],
    firstMessage: "Je n'arrive pas à joindre le support client — la lettre de bienvenue est manquante.",
  },
  {
    id: 'ticket_queue_fr_2',
    dept: 'DSC',
    agent: AGENTS[3],
    firstMessage: "Le transporteur 4421 est bloqué en triage depuis 20 minutes — merci de router.",
  },
];

async function main() {
  console.log('🌱 Adding NL + FR demo tickets to partner "acme"…');

  for (const a of AGENTS) {
    await db
      .insert(schema.users)
      .values({
        id: a.id,
        name: a.name,
        email: a.email,
        lang: a.lang,
        isPlatformOperator: false,
        accessibilityPrefs: {},
      })
      .onConflictDoNothing();

    await db
      .insert(schema.memberships)
      .values({
        id: `mem_${a.id}`,
        userId: a.id,
        partnerId: PARTNER_ID,
        role: 'agent',
        departments: [],
      })
      .onConflictDoNothing();
  }

  const now = new Date().toISOString();
  let inserted = 0;
  for (const t of TICKETS) {
    const res = await db
      .insert(schema.tickets)
      .values({
        id: t.id,
        partnerId: PARTNER_ID,
        dept: t.dept,
        agentId: t.agent.id,
        agentName: t.agent.name,
        agentLang: t.agent.lang,
        references: [],
        status: 'open',
        supportId: null,
        supportName: null,
        supportLang: null,
        supportJoinedAt: null,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoNothing()
      .returning({ id: schema.tickets.id });

    if (res.length === 0) continue;
    inserted++;

    await db
      .insert(schema.messages)
      .values({
        id: `msg_${t.id}_1`,
        ticketId: t.id,
        senderId: t.agent.id,
        senderName: t.agent.name,
        senderRole: 'agent',
        senderLang: t.agent.lang,
        text: t.firstMessage,
        createdAt: now,
      })
      .onConflictDoNothing();
  }

  console.log(`✅ Done. Inserted ${inserted} new ticket(s); ${TICKETS.length - inserted} already existed.`);
  console.log('   NL: ticket_queue_nl_1 (DSC), ticket_queue_nl_2 (TEC)');
  console.log('   FR: ticket_queue_fr_1 (FOT), ticket_queue_fr_2 (DSC)');
  process.exit(0);
}

main().catch((err) => {
  console.error('❌ Failed:', err);
  process.exit(1);
});
