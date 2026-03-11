import Database from 'better-sqlite3';
import { Pool } from 'pg';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SQLITE_PATH = path.join(__dirname, 'database.sqlite');
const PG_URL = process.env.DATABASE_URL || 'postgres://user:password@localhost:5432/i_pxs_support';

async function migrate() {
  console.log('🚀 Starting migration from SQLite to PostgreSQL...');
  
  const sqlite = new Database(SQLITE_PATH);
  const pgPool = new Pool({ connectionString: PG_URL });

  try {
    // 1. Users
    const users = sqlite.prepare('SELECT * FROM users').all();
    console.log(`👤 Migrating ${users.length} users...`);
    for (const u of users as any[]) {
      await pgPool.query(
        'INSERT INTO users (id, name, role, dept, lang, password) VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT (id) DO NOTHING',
        [u.id, u.name, u.role, u.dept, u.lang, u.password]
      );
    }

    // 2. Tickets
    const tickets = sqlite.prepare('SELECT * FROM tickets').all();
    console.log(`🎫 Migrating ${tickets.length} tickets...`);
    for (const t of tickets as any[]) {
      await pgPool.query(
        `INSERT INTO tickets (id, dept, agent_id, agent_name, agent_lang, cdb_id, dare_ref, status, expert_id, expert_name, expert_lang, expert_joined_at, created_at, closed_at, closing_notes, closed_by, participants, summary) 
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18) ON CONFLICT (id) DO NOTHING`,
        [t.id, t.dept, t.agentId, t.agentName, t.agentLang, t.cdbId, t.dareRef, t.status, t.expertId, t.expertName, t.expertLang, t.expertJoinedAt, t.createdAt, t.closedAt, t.closingNotes, t.closedBy, t.participants, t.summary]
      );
    }

    // 3. Messages
    const messages = sqlite.prepare('SELECT * FROM messages').all();
    console.log(`💬 Migrating ${messages.length} messages...`);
    for (const m of messages as any[]) {
      await pgPool.query(
        `INSERT INTO messages (id, ticket_id, sender_id, sender_name, text, translated_text, media_url, whisper, system, created_at, delivered_at, read_at, reactions) 
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13) ON CONFLICT (id) DO NOTHING`,
        [m.id, m.ticketId, m.senderId, m.senderName, m.text, m.translatedText, m.mediaUrl, m.whisper, m.system, m.createdAt, m.deliveredAt, m.readAt, m.reactions]
      );
    }

    // 4. Labels
    const labels = sqlite.prepare('SELECT * FROM labels').all();
    console.log(`🏷️ Migrating ${labels.length} labels...`);
    for (const l of labels as any[]) {
      await pgPool.query(
        'INSERT INTO labels (id, name, color) VALUES ($1, $2, $3) ON CONFLICT (id) DO NOTHING',
        [l.id, l.name, l.color]
      );
    }

    // 5. Ticket Labels
    const ticketLabels = sqlite.prepare('SELECT * FROM ticket_labels').all();
    console.log(`🔗 Migrating ${ticketLabels.length} ticket-label links...`);
    for (const tl of ticketLabels as any[]) {
      await pgPool.query(
        'INSERT INTO ticket_labels (ticket_id, label_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
        [tl.ticketId, tl.labelId]
      );
    }

    // 6. Ratings
    const ratings = sqlite.prepare('SELECT * FROM ratings').all();
    console.log(`⭐ Migrating ${ratings.length} ratings...`);
    for (const r of ratings as any[]) {
      await pgPool.query(
        'INSERT INTO ratings (id, ticket_id, agent_id, expert_id, rating, comment, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7) ON CONFLICT (id) DO NOTHING',
        [r.id, r.ticketId, r.agentId, r.expertId, r.rating, r.comment, r.createdAt]
      );
    }

    // 7. Feedback
    const feedback = sqlite.prepare('SELECT * FROM app_feedback').all();
    console.log(`📝 Migrating ${feedback.length} feedback entries...`);
    for (const f of feedback as any[]) {
      await pgPool.query(
        'INSERT INTO app_feedback (id, user_id, user_name, role, text, treated, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7) ON CONFLICT (id) DO NOTHING',
        [f.id, f.userId, f.userName, f.role, f.text, f.treated, f.createdAt]
      );
    }

    // 8. Canned Responses
    const canned = sqlite.prepare('SELECT * FROM canned_responses').all();
    console.log(`📋 Migrating ${canned.length} canned responses...`);
    for (const cr of canned as any[]) {
      await pgPool.query(
        'INSERT INTO canned_responses (id, shortcut, text) VALUES ($1, $2, $3) ON CONFLICT (id) DO NOTHING',
        [cr.id, cr.shortcut, cr.text]
      );
    }

    console.log('✅ Migration completed successfully!');
  } catch (err: any) {
    console.error('❌ Migration failed:', err.message);
  } finally {
    sqlite.close();
    await pgPool.end();
  }
}

migrate();
