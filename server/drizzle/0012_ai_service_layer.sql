-- AI Service Layer: provider config on partners + prompt templates + usage log

-- Partner AI columns
ALTER TABLE partners ADD COLUMN IF NOT EXISTS ai_enabled boolean DEFAULT false;
ALTER TABLE partners ADD COLUMN IF NOT EXISTS ai_provider text DEFAULT 'ollama';
ALTER TABLE partners ADD COLUMN IF NOT EXISTS ai_model text;
ALTER TABLE partners ADD COLUMN IF NOT EXISTS ai_config jsonb DEFAULT '{}';
ALTER TABLE partners ADD COLUMN IF NOT EXISTS ai_features jsonb DEFAULT '{}';

-- Prompt templates (per-partner overrides + system defaults)
CREATE TABLE IF NOT EXISTS ai_prompt_templates (
  id text PRIMARY KEY,
  partner_id text REFERENCES partners(id) ON DELETE CASCADE,
  action text NOT NULL,
  template text NOT NULL,
  model text,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_ai_prompts_partner_action ON ai_prompt_templates(partner_id, action);

-- Usage / audit log for all AI calls
CREATE TABLE IF NOT EXISTS ai_usage_log (
  id text PRIMARY KEY,
  partner_id text NOT NULL REFERENCES partners(id) ON DELETE CASCADE,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  action text NOT NULL,
  provider text NOT NULL,
  model text NOT NULL,
  input_tokens integer,
  output_tokens integer,
  latency_ms integer,
  success boolean NOT NULL DEFAULT true,
  error_message text,
  created_at timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_ai_usage_partner_created ON ai_usage_log(partner_id, created_at);
CREATE INDEX IF NOT EXISTS idx_ai_usage_user_created ON ai_usage_log(user_id, created_at);
