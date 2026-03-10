import fs from 'fs';
import path from 'path';
import Database from 'better-sqlite3';

const DB_JSON_PATH = path.join(process.cwd(), 'db.json');
const DB_SQLITE_PATH = path.join(process.cwd(), 'db.db');
const SCHEMA_PATH = path.join(process.cwd(), 'db', 'schema.sql');

if (!fs.existsSync(DB_JSON_PATH)) {
    console.error('db.json not found!');
    process.exit(1);
}

const db = new Database(DB_SQLITE_PATH);
const schema = fs.readFileSync(SCHEMA_PATH, 'utf8');
db.exec(schema);

const data = JSON.parse(fs.readFileSync(DB_JSON_PATH, 'utf8'));

db.transaction(() => {
    // 1. Users
    const insertUser = db.prepare('INSERT OR REPLACE INTO users (id, name, role, dept, lang) VALUES (?, ?, ?, ?, ?)');
    data.users.forEach(u => insertUser.run(u.id, u.name, u.role, u.dept || null, u.lang || 'nl'));

    // 2. Labels
    const insertLabel = db.prepare('INSERT OR REPLACE INTO labels (id, name, color) VALUES (?, ?, ?)');
    if (data.labels) {
        data.labels.forEach(l => insertLabel.run(l.id, l.text, l.color));
    }

    // 3. Tickets
    const insertTicket = db.prepare(`
        INSERT OR REPLACE INTO tickets 
        (id, dept, agentId, agentName, agentLang, cdbId, dareRef, status, expertId, expertName, expertLang, expertJoinedAt, createdAt, closedAt, participants) 
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const insertTicketLabel = db.prepare('INSERT OR REPLACE INTO ticket_labels (ticketId, labelId) VALUES (?, ?)');

    data.tickets.forEach(t => {
        insertTicket.run(
            t.id, t.dept, t.agentId, t.agentName, t.agentLang,
            t.cdbId || null, t.dareRef || null, t.status,
            t.expertId || null, t.expertName || null, t.expertLang || null,
            t.expertJoinedAt || null, t.createdAt, t.closedAt || null,
            JSON.stringify(t.participants || [])
        );
        if (t.labels) {
            t.labels.forEach(lId => insertTicketLabel.run(t.id, lId));
        }
    });

    // 4. Messages
    const insertMessage = db.prepare(`
        INSERT OR REPLACE INTO messages 
        (id, ticketId, senderId, senderName, text, translatedText, mediaUrl, whisper, system, createdAt, reactions) 
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    data.messages.forEach(m => {
        insertMessage.run(
            m.id, m.ticketId, m.senderId, m.senderName, m.text || null,
            m.translatedText || null, m.mediaUrl || null,
            m.whisper ? 1 : 0, m.system ? 1 : 0, m.createdAt,
            JSON.stringify(m.reactions || {})
        );
    });

    // 5. Ratings
    const insertRating = db.prepare(`
        INSERT OR REPLACE INTO ratings 
        (id, ticketId, agentId, expertId, rating, comment, createdAt) 
        VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    if (data.ratings) {
        data.ratings.forEach(r => {
            insertRating.run(
                r.id, r.ticketId, r.agentId, r.expertId || null,
                r.rating, r.comment || null, r.createdAt
            );
        });
    }

    // 6. App Feedback
    const insertFeedback = db.prepare(`
        INSERT OR REPLACE INTO app_feedback 
        (id, userId, userName, role, text, treated, createdAt) 
        VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    if (data.feedback) {
        data.feedback.forEach(f => {
            insertFeedback.run(
                f.id, f.userId, f.userName || null, f.role || null,
                f.text, f.treated ? 1 : 0, f.createdAt
            );
        });
    }

    // 7. Daily Stats
    const insertStat = db.prepare(`
        INSERT OR REPLACE INTO daily_stats 
        (date, total, closed, abandoned, avgResponseMs, avgDurationMs, avgRating, ratingCount, slaResolved, slaCompliant, deptCounts, ratingsByDept, hourly) 
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    if (data.dailyStats) {
        data.dailyStats.forEach(s => {
            insertStat.run(
                s.date, s.total, s.closed, s.abandoned, s.avgResponseMs, s.avgDurationMs,
                s.avgRating, s.ratingCount, s.slaResolved, s.slaCompliant,
                JSON.stringify(s.dept || {}), JSON.stringify(s.ratingsByDept || {}), JSON.stringify(s.hourly || [])
            );
        });
    }

    // 8. Translation Cache
    const insertCache = db.prepare('INSERT OR REPLACE INTO translations_cache (key, value, fromLang, toLang, createdAt) VALUES (?, ?, ?, ?, ?)');
    if (data.translations_cache) {
        data.translations_cache.forEach(c => insertCache.run(c.key, c.value, c.fromLang, c.toLang, c.createdAt));
    }
})();

console.log('Migration completed successfully!');
