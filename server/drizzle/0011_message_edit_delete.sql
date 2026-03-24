-- Message editing and deletion support
ALTER TABLE messages ADD COLUMN IF NOT EXISTS edited_at TIMESTAMP;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP;
