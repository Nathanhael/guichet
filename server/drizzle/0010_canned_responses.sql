-- Canned Responses: pre-written message templates for support agents
CREATE TABLE IF NOT EXISTS canned_responses (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid(),
  partner_id TEXT NOT NULL REFERENCES partners(id) ON DELETE CASCADE,
  dept TEXT,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  shortcut TEXT,
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMP NOT NULL DEFAULT now(),
  updated_at TIMESTAMP NOT NULL DEFAULT now()
);

CREATE INDEX idx_canned_partner ON canned_responses(partner_id);
CREATE INDEX idx_canned_shortcut ON canned_responses(partner_id, shortcut);
