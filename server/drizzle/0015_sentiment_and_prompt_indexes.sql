-- Sentiment column on messages for AI sentiment scoring
ALTER TABLE messages ADD COLUMN IF NOT EXISTS sentiment real;

-- Partial index for efficient sentiment queries per ticket
CREATE INDEX IF NOT EXISTS idx_messages_sentiment ON messages(ticket_id) WHERE sentiment IS NOT NULL;

-- Partial unique index for system default prompt templates (where partner_id IS NULL)
CREATE UNIQUE INDEX IF NOT EXISTS idx_ai_prompts_system_action ON ai_prompt_templates(action) WHERE partner_id IS NULL;
