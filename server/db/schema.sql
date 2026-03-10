-- Users table
CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    role TEXT NOT NULL,
    dept TEXT,
    lang TEXT DEFAULT 'nl',
    password TEXT
);

-- Tickets table
CREATE TABLE IF NOT EXISTS tickets (
    id TEXT PRIMARY KEY,
    dept TEXT NOT NULL,
    agentId TEXT NOT NULL,
    agentName TEXT,
    agentLang TEXT,
    cdbId TEXT,
    dareRef TEXT,
    status TEXT DEFAULT 'open',
    expertId TEXT,
    expertName TEXT,
    expertLang TEXT,
    expertJoinedAt TEXT,
    createdAt TEXT NOT NULL,
    closedAt TEXT,
    closingNotes TEXT,
    closedBy TEXT,
    participants TEXT DEFAULT '[]',
    FOREIGN KEY(agentId) REFERENCES users(id),
    FOREIGN KEY(expertId) REFERENCES users(id)
);

-- Messages table
CREATE TABLE IF NOT EXISTS messages (
    id TEXT PRIMARY KEY,
    ticketId TEXT NOT NULL,
    senderId TEXT NOT NULL,
    senderName TEXT,
    text TEXT,
    translatedText TEXT,
    mediaUrl TEXT,
    whisper INTEGER DEFAULT 0,
    system INTEGER DEFAULT 0,
    createdAt TEXT NOT NULL,
    deliveredAt TEXT,
    readAt TEXT,
    reactions TEXT DEFAULT '{}',
    FOREIGN KEY(ticketId) REFERENCES tickets(id) ON DELETE CASCADE
);

-- Ticket Ratings table
CREATE TABLE IF NOT EXISTS ratings (
    id TEXT PRIMARY KEY,
    ticketId TEXT NOT NULL,
    agentId TEXT NOT NULL,
    expertId TEXT,
    rating INTEGER NOT NULL,
    comment TEXT,
    createdAt TEXT NOT NULL,
    FOREIGN KEY(ticketId) REFERENCES tickets(id) ON DELETE CASCADE,
    FOREIGN KEY(agentId) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY(expertId) REFERENCES users(id) ON DELETE CASCADE
);

-- App Feedback table (General suggestions/bugs)
CREATE TABLE IF NOT EXISTS app_feedback (
    id TEXT PRIMARY KEY,
    userId TEXT NOT NULL,
    userName TEXT,
    role TEXT,
    text TEXT NOT NULL,
    treated INTEGER DEFAULT 0,
    createdAt TEXT NOT NULL,
    FOREIGN KEY(userId) REFERENCES users(id) ON DELETE CASCADE
);

-- Labels table
CREATE TABLE IF NOT EXISTS labels (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL UNIQUE COLLATE NOCASE,
    color TEXT NOT NULL
);

-- Ticket Labels junction table
CREATE TABLE IF NOT EXISTS ticket_labels (
    ticketId TEXT NOT NULL,
    labelId TEXT NOT NULL,
    PRIMARY KEY(ticketId, labelId),
    FOREIGN KEY(ticketId) REFERENCES tickets(id) ON DELETE CASCADE,
    FOREIGN KEY(labelId) REFERENCES labels(id) ON DELETE CASCADE
);

-- Daily Stats table
CREATE TABLE IF NOT EXISTS daily_stats (
    date TEXT PRIMARY KEY,
    total INTEGER DEFAULT 0,
    closed INTEGER DEFAULT 0,
    abandoned INTEGER DEFAULT 0,
    avgResponseMs INTEGER DEFAULT 0,
    avgDurationMs INTEGER DEFAULT 0,
    avgRating REAL,
    ratingCount INTEGER DEFAULT 0,
    slaResolved INTEGER DEFAULT 0,
    slaCompliant INTEGER DEFAULT 0,
    deptCounts TEXT, -- JSON string
    ratingsByDept TEXT, -- JSON string
    hourly TEXT -- JSON string
);

-- Translations Cache
CREATE TABLE IF NOT EXISTS translations_cache (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    fromLang TEXT NOT NULL,
    toLang TEXT NOT NULL,
    createdAt TEXT NOT NULL
);
-- LLM Summaries table
CREATE TABLE IF NOT EXISTS llm_summaries (
    period TEXT PRIMARY KEY, -- 'day:YYYY-MM-DD', 'week:YYYY-WW', 'month:YYYY-MM'
    sentiment TEXT,
    questions TEXT, -- JSON array
    summary TEXT,
    updatedAt TEXT NOT NULL
);

-- Canned Responses
CREATE TABLE IF NOT EXISTS canned_responses (
    id TEXT PRIMARY KEY,
    shortcut TEXT NOT NULL UNIQUE,
    text TEXT NOT NULL
);

-- Performance Indexes
CREATE INDEX IF NOT EXISTS idx_tickets_agentId ON tickets(agentId);
CREATE INDEX IF NOT EXISTS idx_tickets_status ON tickets(status);
CREATE INDEX IF NOT EXISTS idx_tickets_dept ON tickets(dept);
CREATE INDEX IF NOT EXISTS idx_tickets_createdAt ON tickets(createdAt);
CREATE INDEX IF NOT EXISTS idx_messages_ticketId ON messages(ticketId);
