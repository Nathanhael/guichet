import { db } from './sqlite.js';
import { v4 as uuidv4 } from 'uuid';
import bcrypt from 'bcrypt';

db.transaction(() => {
    console.log('Cleaning old transaction data...');
    db.prepare('DELETE FROM messages').run();
    db.prepare('DELETE FROM ticket_labels').run();
    db.prepare('DELETE FROM ratings').run();
    db.prepare('DELETE FROM tickets').run();
    db.prepare('DELETE FROM app_feedback').run();
    db.prepare('DELETE FROM daily_stats').run();
    db.prepare('DELETE FROM labels').run();

    console.log('Ensuring users and labels exist...');
    const hashedPwd = bcrypt.hashSync('password123', 10);
    const insertUser = db.prepare('INSERT OR IGNORE INTO users (id, name, role, dept, lang, password) VALUES (?, ?, ?, ?, ?, ?)');

    // 10 Agents
    insertUser.run('agent1', 'Alice Agent', 'agent', 'DSC', 'en', hashedPwd);
    insertUser.run('agent2', 'Bob Agent', 'agent', 'FOT', 'nl', hashedPwd);
    insertUser.run('agent3', 'Charlie Agent', 'agent', 'DSC', 'nl', hashedPwd);
    insertUser.run('agent4', 'David Agent', 'agent', 'FOT', 'fr', hashedPwd);
    insertUser.run('agent5', 'Eva Agent', 'agent', 'DSC', 'en', hashedPwd);
    insertUser.run('agent6', 'Frank Agent', 'agent', 'FOT', 'nl', hashedPwd);
    insertUser.run('agent7', 'Grace Agent', 'agent', 'DSC', 'fr', hashedPwd);
    insertUser.run('agent8', 'Harry Agent', 'agent', 'FOT', 'en', hashedPwd);
    insertUser.run('agent9', 'Ivy Agent', 'agent', 'DSC', 'nl', hashedPwd);
    insertUser.run('agent10', 'Jack Agent', 'agent', 'FOT', 'fr', hashedPwd);

    // 3 Experts
    insertUser.run('expert1', 'Expert Zoe', 'expert', null, 'fr', hashedPwd);
    insertUser.run('expert2', 'Expert Yann', 'expert', null, 'en', hashedPwd);
    insertUser.run('expert3', 'Expert Xander', 'expert', null, 'nl', hashedPwd);

    // 1 Admin
    insertUser.run('admin1', 'Dirk Admin', 'admin', null, 'nl', hashedPwd);

    const insertInitialLabel = db.prepare('INSERT OR IGNORE INTO labels (id, name, color) VALUES (?, ?, ?)');
    insertInitialLabel.run('lbl1', 'Network', 'blue');
    insertInitialLabel.run('lbl2', 'Hardware', 'rose');
    insertInitialLabel.run('lbl3', 'Billing', 'emerald');
    insertInitialLabel.run('lbl4', 'Software', 'purple');
    insertInitialLabel.run('lbl5', 'Mobile', 'amber');
    insertInitialLabel.run('lbl6', 'Fiber', 'cyan');

    console.log('Fetching users and labels...');
    const users = db.prepare('SELECT * FROM users').all();
    const agents = users.filter(u => u.role === 'agent');
    const experts = users.filter(u => u.role === 'expert');
    const managers = users.filter(u => u.role === 'admin');
    const labels = db.prepare('SELECT * FROM labels').all();

    const insertTicket = db.prepare(`
        INSERT INTO tickets 
        (id, dept, agentId, agentName, agentLang, cdbId, dareRef, status, expertId, expertName, expertLang, expertJoinedAt, createdAt, closedAt, closingNotes, closedBy, participants) 
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const insertMessage = db.prepare(`
        INSERT INTO messages 
        (id, ticketId, senderId, senderName, text, whisper, system, createdAt, deliveredAt, readAt, reactions) 
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const insertRating = db.prepare(`
        INSERT INTO ratings 
        (id, ticketId, agentId, expertId, rating, comment, createdAt) 
        VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    const insertLabel = db.prepare('INSERT INTO ticket_labels (ticketId, labelId) VALUES (?, ?)');
    const insertFeedback = db.prepare(`
        INSERT INTO app_feedback 
        (id, userId, userName, role, text, treated, createdAt) 
        VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    const now = new Date();
    const THIRTY_DAYS = 30 * 24 * 60 * 60 * 1000;

    console.log('Generating 100 tickets...');
    const msgsContent = [
        "Hello, my internet is down.",
        "Let me check your line status.",
        "Your line seems fine, have you restarted the router?",
        "Yes, I have.",
        "I will send a technician.",
        "Thank you.",
        "I have a billing question.",
        "Sure, what is it?",
        "Why is my invoice higher this month?",
        "Because of a one-time setup fee."
    ];

    for (let i = 0; i < 100; i++) {
        const ticketCreatedAt = new Date(now.getTime() - Math.random() * THIRTY_DAYS);
        const agent = agents[Math.floor(Math.random() * agents.length)];
        const expert = experts[Math.floor(Math.random() * experts.length)];
        const dept = Math.random() > 0.5 ? 'DSC' : 'FOT';

        const id = uuidv4();

        // 70% closed, 20% open (assigned), 10% waiting (not assigned)
        const rand = Math.random();
        let status = 'closed';
        let expertId = expert.id;
        let expertName = expert.name;
        let expertLang = expert.lang;
        let closedAt = null;
        let expertJoinedAt = new Date(ticketCreatedAt.getTime() + Math.random() * 5 * 60 * 1000).toISOString();
        let closingNotes = null;
        let closedBy = null;

        if (rand < 0.1) {
            status = 'waiting';
            expertId = null;
            expertName = null;
            expertLang = null;
            expertJoinedAt = null;
        } else if (rand < 0.3) {
            status = 'open';
        } else {
            status = 'closed';
            closedAt = new Date(ticketCreatedAt.getTime() + (Math.random() * 30 + 5) * 60 * 1000).toISOString();
            closingNotes = "Issue resolved successfully.";
            closedBy = expert.name;
        }

        insertTicket.run(
            id, dept, agent.id, agent.name, agent.lang,
            dept === 'DSC' ? Math.floor(Math.random() * 1000000).toString() : null,
            dept === 'FOT' ? 'DARE' + Math.floor(Math.random() * 1000000).toString() : null,
            status,
            expertId, expertName, expertLang, expertJoinedAt,
            ticketCreatedAt.toISOString(), closedAt, closingNotes, closedBy,
            JSON.stringify([])
        );

        // Add 1-3 random labels
        if (labels.length > 0) {
            const numLabels = Math.floor(Math.random() * 3) + 1;
            const shuffled = [...labels].sort(() => 0.5 - Math.random());
            const selectedLabels = shuffled.slice(0, numLabels);
            selectedLabels.forEach(l => {
                insertLabel.run(id, l.id);
            });
        }

        // Add some messages
        const numMsgs = Math.floor(Math.random() * 6) + 2;
        let lastMsgTime = ticketCreatedAt.getTime();
        for (let j = 0; j < numMsgs; j++) {
            lastMsgTime += 1000 * 60 * (Math.random() * 2 + 1); // 1-3 mins later
            const msgTime = new Date(lastMsgTime);
            const isAgent = j % 2 === 0;
            const sender = isAgent ? agent : expert;

            insertMessage.run(
                uuidv4(), id, sender.id, sender.name,
                msgsContent[j % msgsContent.length],
                0, 0, msgTime.toISOString(), msgTime.toISOString(), msgTime.toISOString(), '{}'
            );
        }

        // Add a rating if closed
        if (status === 'closed' && Math.random() > 0.2) { // 80% chance of rating if closed
            const ratingScore = Math.floor(Math.random() * 3) + 3; // 3 to 5 stars
            insertRating.run(
                uuidv4(), id, agent.id, expert.id, ratingScore, "Good service", closedAt
            );
        }
    }

    console.log('Generating app feedback...');
    for (let i = 0; i < 15; i++) {
        const u = users[Math.floor(Math.random() * users.length)];
        const time = new Date(now.getTime() - Math.random() * THIRTY_DAYS).toISOString();
        insertFeedback.run(
            uuidv4(), u.id, u.name, u.role, "The app works well, but search could be faster.",
            Math.random() > 0.5 ? 1 : 0, time
        );
    }
})();

console.log('Database cleaned and seeded successfully with 100 chats!');
