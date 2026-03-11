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
    agent_id TEXT NOT NULL,
    agent_name TEXT,
    agent_lang TEXT,
    cdb_id TEXT,
    dare_ref TEXT,
    status TEXT DEFAULT 'open',
    expert_id TEXT,
    expert_name TEXT,
    expert_lang TEXT,
    expert_joined_at TEXT,
    created_at TEXT NOT NULL,
    closed_at TEXT,
    closing_notes TEXT,
    closed_by TEXT,
    participants TEXT DEFAULT '[]',
    summary TEXT,
    FOREIGN KEY(agent_id) REFERENCES users(id),
    FOREIGN KEY(expert_id) REFERENCES users(id)
);

-- Messages table
CREATE TABLE IF NOT EXISTS messages (
    id TEXT PRIMARY KEY,
    ticket_id TEXT NOT NULL,
    sender_id TEXT NOT NULL,
    sender_name TEXT,
    text TEXT,
    translated_text TEXT,
    media_url TEXT,
    whisper INTEGER DEFAULT 0,
    system INTEGER DEFAULT 0,
    created_at TEXT NOT NULL,
    delivered_at TEXT,
    read_at TEXT,
    reactions TEXT DEFAULT '{}',
    FOREIGN KEY(ticket_id) REFERENCES tickets(id) ON DELETE CASCADE
);

-- Ticket Ratings table
CREATE TABLE IF NOT EXISTS ratings (
    id TEXT PRIMARY KEY,
    ticket_id TEXT NOT NULL,
    agent_id TEXT NOT NULL,
    expert_id TEXT,
    rating INTEGER NOT NULL,
    comment TEXT,
    created_at TEXT NOT NULL,
    FOREIGN KEY(ticket_id) REFERENCES tickets(id) ON DELETE CASCADE,
    FOREIGN KEY(agent_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY(expert_id) REFERENCES users(id) ON DELETE CASCADE
);

-- App Feedback table (General suggestions/bugs)
CREATE TABLE IF NOT EXISTS app_feedback (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    user_name TEXT,
    role TEXT,
    text TEXT NOT NULL,
    treated INTEGER DEFAULT 0,
    created_at TEXT NOT NULL,
    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Labels table
CREATE TABLE IF NOT EXISTS labels (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    color TEXT NOT NULL
);

-- Ticket Labels junction table
CREATE TABLE IF NOT EXISTS ticket_labels (
    ticket_id TEXT NOT NULL,
    label_id TEXT NOT NULL,
    PRIMARY KEY(ticket_id, label_id),
    FOREIGN KEY(ticket_id) REFERENCES tickets(id) ON DELETE CASCADE,
    FOREIGN KEY(label_id) REFERENCES labels(id) ON DELETE CASCADE
);

-- Daily Stats table
CREATE TABLE IF NOT EXISTS daily_stats (
    date TEXT PRIMARY KEY,
    total INTEGER DEFAULT 0,
    closed INTEGER DEFAULT 0,
    abandoned INTEGER DEFAULT 0,
    avg_response_ms INTEGER DEFAULT 0,
    avg_duration_ms INTEGER DEFAULT 0,
    avg_rating REAL,
    rating_count INTEGER DEFAULT 0,
    sla_resolved INTEGER DEFAULT 0,
    sla_compliant INTEGER DEFAULT 0,
    dept_counts TEXT, -- JSON string
    ratings_by_dept TEXT, -- JSON string
    hourly TEXT -- JSON string
);

-- Translations Cache
CREATE TABLE IF NOT EXISTS translations_cache (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    from_lang TEXT NOT NULL,
    to_lang TEXT NOT NULL,
    created_at TEXT NOT NULL
);

-- LLM Summaries table
CREATE TABLE IF NOT EXISTS llm_summaries (
    period TEXT PRIMARY KEY, -- 'day:YYYY-MM-DD', 'week:YYYY-WW', 'month:YYYY-MM'
    sentiment TEXT,
    questions TEXT, -- JSON array
    summary TEXT,
    updated_at TEXT NOT NULL
);

-- Canned Responses
CREATE TABLE IF NOT EXISTS canned_responses (
    id TEXT PRIMARY KEY,
    shortcut TEXT NOT NULL UNIQUE,
    text TEXT NOT NULL
);

-- Performance Indexes
CREATE INDEX IF NOT EXISTS idx_tickets_agent_id ON tickets(agent_id);
CREATE INDEX IF NOT EXISTS idx_tickets_status ON tickets(status);
CREATE INDEX IF NOT EXISTS idx_tickets_dept ON tickets(dept);
CREATE INDEX IF NOT EXISTS idx_tickets_created_at ON tickets(created_at);
CREATE INDEX IF NOT EXISTS idx_messages_ticket_id ON messages(ticket_id);
