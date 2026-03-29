-- Migrate SLA columns from text to timestamptz
ALTER TABLE tickets ADD COLUMN sla_response_due_at_new TIMESTAMPTZ;
ALTER TABLE tickets ADD COLUMN sla_resolution_due_at_new TIMESTAMPTZ;

UPDATE tickets SET sla_response_due_at_new = sla_response_due_at::timestamptz
  WHERE sla_response_due_at IS NOT NULL;
UPDATE tickets SET sla_resolution_due_at_new = sla_resolution_due_at::timestamptz
  WHERE sla_resolution_due_at IS NOT NULL;

ALTER TABLE tickets DROP COLUMN sla_response_due_at;
ALTER TABLE tickets DROP COLUMN sla_resolution_due_at;

ALTER TABLE tickets RENAME COLUMN sla_response_due_at_new TO sla_response_due_at;
ALTER TABLE tickets RENAME COLUMN sla_resolution_due_at_new TO sla_resolution_due_at;
