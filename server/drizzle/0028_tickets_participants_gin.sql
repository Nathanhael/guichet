CREATE INDEX idx_tickets_participants_gin ON tickets USING gin (participants);
