-- Add SLA configuration to partners (JSONB)
ALTER TABLE partners ADD COLUMN IF NOT EXISTS sla_config jsonb DEFAULT '{}';

-- Add SLA deadline timestamps to tickets
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS sla_response_due_at text;
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS sla_resolution_due_at text;
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS sla_breached boolean DEFAULT false;
