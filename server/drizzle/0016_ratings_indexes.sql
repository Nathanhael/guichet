-- Add indexes to the ratings table for query performance
-- Used by: rating.list (inArray ticketId + ORDER BY createdAt), getStaffRatings (GROUP BY supportId)

CREATE INDEX IF NOT EXISTS idx_ratings_ticket_id ON ratings(ticket_id);
CREATE INDEX IF NOT EXISTS idx_ratings_support_id ON ratings(support_id);
CREATE INDEX IF NOT EXISTS idx_ratings_created_at ON ratings(created_at);

-- Composite index for the common partner+status+unassigned queue query
CREATE INDEX IF NOT EXISTS idx_tickets_partner_status_support
  ON tickets(partner_id, status) WHERE support_id IS NULL;
