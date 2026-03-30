-- Architecture Review Fixes (2026-03-30)
-- Task 2: Add partner_id to refresh_tokens for partner context preservation
ALTER TABLE refresh_tokens ADD COLUMN IF NOT EXISTS partner_id TEXT;

-- Task 6: Composite index for cursor-based message pagination
CREATE INDEX IF NOT EXISTS idx_messages_ticket_created ON messages(ticket_id, created_at);

-- Task 13: Standalone audit_log created_at index for platform-wide queries
CREATE INDEX IF NOT EXISTS idx_audit_log_created_at ON audit_log(created_at);

-- Task 14: Partial index for waitingTickets query (open + unassigned)
CREATE INDEX IF NOT EXISTS idx_tickets_open_unassigned ON tickets (partner_id, created_at) WHERE status = 'open' AND support_id IS NULL;
