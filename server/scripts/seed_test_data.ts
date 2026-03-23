import { hashPassword } from '../utils/passwords.js';
import pg from 'pg';
import { randomUUID } from 'crypto';

const { Pool } = pg;
const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgres://user:password@localhost:5432/tessera',
});

// ── helpers ────────────────────────────────────────────────────────────────

function rand<T>(arr: T[]): T { return arr[Math.floor(Math.random() * arr.length)]; }
function randInt(min: number, max: number) { return Math.floor(Math.random() * (max - min + 1)) + min; }
function randFloat(min: number, max: number) { return Math.random() * (max - min) + min; }

function daysAgo(days: number): Date {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d;
}

function randDateBetween(start: Date, end: Date): Date {
  return new Date(start.getTime() + Math.random() * (end.getTime() - start.getTime()));
}

async function batchInsert(table: string, columns: string[], rows: any[][], batchSize = 200) {
  for (let i = 0; i < rows.length; i += batchSize) {
    const batch = rows.slice(i, i + batchSize);
    const values: any[] = [];
    const placeholders = batch.map((row, rowIdx) => {
      const start = rowIdx * columns.length;
      row.forEach(v => values.push(v));
      return `(${columns.map((_, ci) => `$${start + ci + 1}`).join(', ')})`;
    }).join(', ');
    await pool.query(
      `INSERT INTO ${table} (${columns.join(', ')}) VALUES ${placeholders} ON CONFLICT DO NOTHING`,
      values
    );
    process.stdout.write(`\r  ${table}: ${Math.min(i + batchSize, rows.length)}/${rows.length}`);
  }
  console.log();
}

// ── data fixtures ──────────────────────────────────────────────────────────

const NL_FIRST = ['Jan','Koen','Luc','Marc','Dirk','Wim','Raf','Bert','Sven','Niels','Wouter','Tim','Jens','Stef','Kevin','David','Lars','Daan','Bram','Jonas','Sander','Pieter','Ruben','Thomas','Mathias','Tomas','Arne','Geert','Filip','Robbe'];
const FR_FIRST = ['Pierre','Jean','Paul','Michel','Jacques','Henri','Louis','René','Marie','Sophie','Claire','Isabelle','Christine','Nathalie','Véronique','Sylvie','Julie','Emma','Lucie','Camille','Léa','Antoine','Nicolas','Julien','Maxime'];
const EN_FIRST = ['Alex','Sam','Chris','Jordan','Taylor','Morgan','Riley','Casey','Jamie','Drew'];

const NL_LAST = ['De Smedt','Janssen','Peeters','Maes','Claes','Willems','Goossens','Wouters','Hermans','Leclercq','Nijs','Bogaert','Van Acker','Declercq','Vermeersch'];
const FR_LAST = ['Dupont','Martin','Bernard','Dubois','Thomas','Robert','Richard','Petit','Durand','Leroy','Simon','Laurent','Michel','Garcia','Lefebvre'];
const EN_LAST = ['Smith','Johnson','Williams','Brown','Jones','Miller','Davis','Wilson','Moore','Taylor'];

const DEPTS = ['DSC','FOT'] as const;
const LANGS = ['nl','fr','en'] as const;

const TICKET_SUBJECTS = [
  'Internet not working since this morning',
  'TV channels missing after update',
  'Billing issue - charged twice this month',
  'Phone line static noise',
  'Slow upload speed on fiber connection',
  'Router keeps disconnecting every hour',
  'Cannot access online account portal',
  'New modem installation issue',
  'International call not working',
  'IPTV remote control not responding',
  'Data bundle used up unexpectedly',
  'Contract renewal question',
  'Moving address - transfer service',
  'WiFi dead zones in house',
  'Business line upgrade request',
  'Email service not working',
  'SIM card not activating',
  'Direct debit setup failed',
  'Parental controls not saving',
  'Signal drops on mobile network',
  'Invoice amount incorrect',
  'Package downgrade request',
  'Voicemail setup assistance',
  'Device compatibility question',
  'Service outage in my area',
];

const AGENT_MESSAGES = [
  'Good morning, the customer is reporting that their internet connection has been down since this morning.',
  'Customer is calling about an incorrect charge on their last invoice.',
  'The client cannot access their TV package, all channels show a signal error.',
  'Customer wants to know why their data has been depleted so quickly this month.',
  'Client is requesting a service upgrade, currently on basic plan.',
  'The router keeps dropping the connection approximately every 45 minutes.',
  'Customer moved to a new address and needs the service transferred.',
  'Client reports static noise on their landline, especially during rain.',
  'Customer is unable to log into the self-service portal since yesterday.',
  'The technician visit from last week did not resolve the issue, customer calling again.',
  'Client has received a final payment notice but claims to have paid.',
  'Customer is requesting contract termination within the 14-day cooling-off period.',
  'WiFi signal is very weak in certain rooms despite having a new router.',
  'Client asking about the international calling rates for their current plan.',
  'Business customer reports all 5 lines went down simultaneously.',
];

const EXPERT_MESSAGES = [
  'I can see the issue in the system. There was a planned maintenance in your area between 02:00 and 06:00, which may have caused a temporary disruption.',
  'Looking at the account, I can confirm there was a duplicate payment processed. I will initiate a refund within 5 business days.',
  'The TV service requires a firmware update on your decoder. I am pushing that remotely now, please wait 3 minutes.',
  'I can see your data usage peaked on the 14th. It looks like a background app was running updates. I have added a temporary 2GB buffer at no charge.',
  'I have processed the upgrade request. Your new plan will be active within 2 hours.',
  'I have reset the router configuration from our end. Please power cycle your device and let me know if the issue persists.',
  'The service transfer has been scheduled for next Thursday. You will receive a confirmation SMS.',
  'The noise on the line is likely due to a corroded connector on the street cabinet. I am scheduling a field technician for tomorrow morning.',
  'Your portal access was locked due to 5 failed login attempts. I have unlocked it and sent you a password reset email.',
  'I can see the previous technician marked the visit as resolved but the underlying issue was not fixed. I am escalating this to our network team.',
  'I can confirm the payment was received on our end. The final notice was sent in error due to a system delay. I apologize for the inconvenience.',
  'I have processed the cancellation within the cooling-off period. No charges will apply. You will receive a confirmation email shortly.',
  'I can see from our network map that the signal coverage in your area drops in certain frequency bands. I will arrange a WiFi extender to be sent to you.',
  'Your current plan includes 100 minutes of international calls to EU destinations. For other destinations, standard rates apply as per your contract.',
  'I am running a diagnostic on all 5 lines now. There appears to be a routing issue at the exchange level. Our network team is already working on it.',
];

const CLOSING_NOTES = [
  'Issue resolved remotely. Customer confirmed connection restored.',
  'Refund processed. Customer satisfied with resolution.',
  'Firmware update applied successfully. All channels now working.',
  'Data buffer added. Customer advised to check app permissions.',
  'Upgrade activated. Customer confirmed new features available.',
  'Router reset resolved the issue. Customer stable for 10 minutes before closing.',
  'Service transfer scheduled. Customer has confirmation details.',
  'Technician scheduled. Customer will call back after visit if issue persists.',
  'Account unlocked. Customer logged in successfully during call.',
  'Escalated to network team. Customer given ticket reference.',
  'Billing error corrected. Customer satisfied.',
  'Cancellation processed within cooling-off. No further action required.',
  'WiFi extender dispatched. Expected delivery in 2 business days.',
  'International calling rates explained. Customer updated their plan.',
  'Network team resolved routing issue. All lines restored.',
  'Issue could not be reproduced. Customer advised to monitor.',
  'Hardware replacement arranged. Old equipment to be returned.',
  'Technical configuration corrected. Service stable.',
  'Customer transferred to billing department for further assistance.',
  'Issue resolved after third-party provider reset on their end.',
];

const FEEDBACK_TEXTS = [
  'The new chat interface is much better than calling. Very smooth.',
  'Response time was a bit slow today, had to wait 15 minutes.',
  'Expert was very knowledgeable and solved my issue quickly.',
  'Would be nice to have a dark mode option.',
  'The translation feature works surprisingly well!',
  'Had to explain my issue three times before being understood.',
  'Very professional service, will recommend to colleagues.',
  'The attachment feature for screenshots is very useful.',
  'Sometimes the chat disconnects and I lose the conversation history.',
  'Much prefer this over the phone support, keep it up!',
  'The expert took a long time to join my chat.',
  'Billing department needs to be more responsive.',
  'Great experience overall, resolved in under 10 minutes.',
  'The interface is a bit confusing at first but gets easier.',
  'Expert was not familiar with my specific router model.',
  'Fast and efficient, exactly what I needed.',
  'Would appreciate email transcripts after the chat.',
  'The queue position indicator is very helpful.',
  'My issue was not fully resolved but the expert was polite.',
  'Excellent support, far better than expected for a telecom company.',
];

const RATING_COMMENTS = [
  'Very quick resolution, thank you!',
  'Expert was patient and explained everything clearly.',
  'Took a while but eventually resolved.',
  'Not fully resolved, still having minor issues.',
  'Outstanding service, best support I have had.',
  'Average experience, nothing special.',
  'Expert really knew their stuff.',
  'Had to wait too long for the expert to join.',
  'Problem solved on the first try.',
  'Will use this chat support again.',
  '',  // many ratings have no comment
  '',
  '',
];

// ── main ───────────────────────────────────────────────────────────────────

async function seed() {
  console.log('🌱 Starting test data seed...\n');

  const hashedPassword = await hashPassword('password123');

  // ── 1. Users ────────────────────────────────────────────────────────────

  console.log('👥 Creating users...');
  const agents: { id: string; name: string; lang: string; dept: string }[] = [];
  const experts: { id: string; name: string; lang: string; dept: string }[] = [];

  const userRows: any[][] = [];

  for (let i = 0; i < 50; i++) {
    const lang = i < 20 ? 'nl' : i < 38 ? 'fr' : 'en';
    const dept = i % 2 === 0 ? 'DSC' : 'FOT';
    const firstName = lang === 'nl' ? NL_FIRST[i % NL_FIRST.length] : lang === 'fr' ? FR_FIRST[i % FR_FIRST.length] : EN_FIRST[i % EN_FIRST.length];
    const lastName = lang === 'nl' ? NL_LAST[i % NL_LAST.length] : lang === 'fr' ? FR_LAST[i % FR_LAST.length] : EN_LAST[i % EN_LAST.length];
    const id = `test_agent_${i + 1}`;
    const name = `${firstName} ${lastName}`;
    agents.push({ id, name, lang, dept });
    userRows.push([id, name, 'agent', dept, lang, hashedPassword]);
  }

  for (let i = 0; i < 10; i++) {
    const lang = i < 4 ? 'nl' : i < 7 ? 'fr' : 'en';
    const dept = i < 5 ? 'DSC' : 'FOT';
    const names = ['Alexia Storms','Boris Claeys','Céline Dupuis','Dimitri Van Berg','Eva Martens','Frank Desmet','Griet Nijs','Hamid Osman','Ilse Wouters','Joris Leclercq'];
    const id = `test_expert_${i + 1}`;
    const name = names[i];
    experts.push({ id, name, lang, dept });
    userRows.push([id, name, 'expert', dept, lang, hashedPassword]);
  }

  userRows.push(['test_admin_1', 'Admin Sarah', 'admin', 'DSC', 'nl', hashedPassword]);

  await batchInsert('users', ['id','name','role','dept','lang','password'], userRows);
  console.log(`  ✓ ${userRows.length} users`);

  // ── 2. Tickets ──────────────────────────────────────────────────────────

  console.log('\n🎫 Creating tickets...');

  const TOTAL = 5000;
  const OPEN_COUNT = 8;
  const ACTIVE_COUNT = 42;
  const CLOSED_COUNT = TOTAL - OPEN_COUNT - ACTIVE_COUNT;

  const ticketRows: any[][] = [];
  const ticketMeta: { id: string; agentId: string; expertId: string | null; status: string; createdAt: Date; closedAt: Date | null; dept: string }[] = [];

  for (let i = 0; i < TOTAL; i++) {
    const id = randomUUID();
    const agent = rand(agents);
    const dept = rand(DEPTS as unknown as string[]);
    const subject = rand(TICKET_SUBJECTS);
    const dareRef = Math.random() > 0.4 ? `DARE-${randInt(1000, 9999)}` : null;
    const cdbId = Math.random() > 0.3 ? `C-${randInt(100000, 999999)}` : null;

    let status: string;
    let expert: typeof experts[0] | null = null;
    let expertJoinedAt: Date | null = null;
    let createdAt: Date;
    let closedAt: Date | null = null;
    let closingNotes: string | null = null;
    let closedBy: string | null = null;

    if (i < OPEN_COUNT) {
      status = 'open';
      createdAt = daysAgo(randInt(0, 2));
    } else if (i < OPEN_COUNT + ACTIVE_COUNT) {
      status = 'active';
      expert = rand(experts);
      createdAt = daysAgo(randInt(0, 1));
      expertJoinedAt = new Date(createdAt.getTime() + randInt(1, 15) * 60 * 1000);
    } else {
      status = 'closed';
      expert = rand(experts);
      // spread over last 180 days, more recent ones more likely
      const daysBack = Math.floor(Math.pow(Math.random(), 0.6) * 180);
      createdAt = daysAgo(daysBack + randInt(0, 3));
      expertJoinedAt = new Date(createdAt.getTime() + randInt(1, 20) * 60 * 1000);
      closedAt = new Date(expertJoinedAt.getTime() + randInt(5, 60) * 60 * 1000);
      closingNotes = rand(CLOSING_NOTES);
      closedBy = rand([expert.name, expert.name, agent.name]);
    }

    const participants = JSON.stringify(expert ? [agent.id, expert.id] : [agent.id]);

    ticketRows.push([
      id, dept, agent.id, agent.name, agent.lang,
      cdbId, dareRef, status,
      expert?.id ?? null, expert?.name ?? null, expert?.lang ?? null,
      expertJoinedAt?.toISOString() ?? null,
      createdAt.toISOString(),
      closedAt?.toISOString() ?? null,
      closingNotes, closedBy,
      participants, null,
    ]);

    ticketMeta.push({ id, agentId: agent.id, expertId: expert?.id ?? null, status, createdAt, closedAt, dept });
  }

  await batchInsert('tickets', [
    'id','dept','agent_id','agent_name','agent_lang',
    'cdb_id','dare_ref','status',
    'expert_id','expert_name','expert_lang','expert_joined_at',
    'created_at','closed_at','closing_notes','closed_by',
    'participants','summary',
  ], ticketRows);
  console.log(`  ✓ ${TOTAL} tickets (${OPEN_COUNT} open, ${ACTIVE_COUNT} active, ${CLOSED_COUNT} closed)`);

  // ── 3. Messages ─────────────────────────────────────────────────────────

  console.log('\n💬 Creating messages...');
  const messageRows: any[][] = [];

  for (const t of ticketMeta) {
    const msgCount = t.status === 'closed' ? randInt(3, 10) : randInt(1, 4);
    const agentUser = agents.find(a => a.id === t.agentId)!;
    const expertUser = t.expertId ? experts.find(e => e.id === t.expertId) : null;

    // system: ticket created
    messageRows.push([
      randomUUID(), t.id, t.agentId, agentUser.name,
      'Ticket created', null, null, 0, 1,
      t.createdAt.toISOString(), null, null, '{}',
    ]);

    const msgEnd = t.closedAt ?? new Date(t.createdAt.getTime() + 30 * 60 * 1000);

    for (let m = 0; m < msgCount; m++) {
      const isExpert = m % 2 === 1 && expertUser;
      const sender = isExpert ? expertUser! : agentUser;
      const text = isExpert ? rand(EXPERT_MESSAGES) : rand(AGENT_MESSAGES);
      const ts = randDateBetween(
        new Date(t.createdAt.getTime() + (m + 1) * 2 * 60 * 1000),
        msgEnd
      );
      messageRows.push([
        randomUUID(), t.id, sender.id, sender.name,
        text, null, null, 0, 0,
        ts.toISOString(), ts.toISOString(), null, '{}',
      ]);
    }

    // system: ticket closed
    if (t.status === 'closed' && t.closedAt) {
      messageRows.push([
        randomUUID(), t.id, t.agentId, 'System',
        'Ticket closed', null, null, 0, 1,
        t.closedAt.toISOString(), null, null, '{}',
      ]);
    }
  }

  await batchInsert('messages', [
    'id','ticket_id','sender_id','sender_name',
    'text','translated_text','media_url','whisper','system',
    'created_at','delivered_at','read_at','reactions',
  ], messageRows);
  console.log(`  ✓ ${messageRows.length} messages`);

  // ── 4. Ratings ──────────────────────────────────────────────────────────

  console.log('\n⭐ Creating ratings...');
  const ratingRows: any[][] = [];
  const ratingDist = [1,1,1,1,1, 2,2,2,2,2,2,2,2,2,2, 3,3,3,3,3,3,3,3,3,3,3,3,3,3,3,3,3,3,3,3, 4,4,4,4,4,4,4,4,4,4,4,4,4,4,4,4,4,4,4,4,4,4,4,4,4,4,4,4,4,4,4,4,4,4,4, 5,5,5,5,5,5,5,5,5,5,5,5,5,5,5,5,5,5,5,5,5,5,5,5,5,5,5,5,5,5];

  for (const t of ticketMeta) {
    if (t.status !== 'closed' || !t.expertId || !t.closedAt) continue;
    if (Math.random() > 0.88) continue; // ~88% rated

    const rating = rand(ratingDist);
    const comment = rand(RATING_COMMENTS);
    const createdAt = new Date(t.closedAt.getTime() + randInt(1, 60) * 60 * 1000);

    ratingRows.push([
      randomUUID(), t.id, t.agentId, t.expertId,
      rating, comment || null, createdAt.toISOString(),
    ]);
  }

  await batchInsert('ratings', ['id','ticket_id','agent_id','expert_id','rating','comment','created_at'], ratingRows);
  console.log(`  ✓ ${ratingRows.length} ratings`);

  // ── 5. App feedback ─────────────────────────────────────────────────────

  console.log('\n📝 Creating feedback...');
  const feedbackRows: any[][] = [];
  const allUsers = [...agents, ...experts];

  for (let i = 0; i < 200; i++) {
    const user = rand(allUsers);
    const createdAt = randDateBetween(daysAgo(180), new Date());
    feedbackRows.push([
      randomUUID(), user.id, user.name, user.id.startsWith('test_expert') ? 'expert' : 'agent',
      rand(FEEDBACK_TEXTS), Math.random() > 0.6 ? 1 : 0,
      createdAt.toISOString(),
    ]);
  }

  await batchInsert('app_feedback', ['id','user_id','user_name','role','text','treated','created_at'], feedbackRows);
  console.log(`  ✓ ${feedbackRows.length} feedback entries`);

  // ── done ─────────────────────────────────────────────────────────────────

  console.log('\n✅ Test data seed complete!');
  console.log(`   Users: ${userRows.length} | Tickets: ${TOTAL} | Messages: ${messageRows.length} | Ratings: ${ratingRows.length} | Feedback: ${feedbackRows.length}`);
  await pool.end();
  process.exit(0);
}

seed().catch(err => {
  console.error('❌ Seed failed:', err);
  process.exit(1);
});
