-- Rebranding: Expert -> Support
-- Migration Script

-- 1. Rename columns in tickets table
-- Note: schema.ts already has some support_* names, but let's ensure consistency
DO $$ 
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'tickets' AND column_name = 'expert_id') THEN
        ALTER TABLE tickets RENAME COLUMN expert_id TO support_id;
    END IF;
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'tickets' AND column_name = 'expert_name') THEN
        ALTER TABLE tickets RENAME COLUMN expert_name TO support_name;
    END IF;
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'tickets' AND column_name = 'expert_lang') THEN
        ALTER TABLE tickets RENAME COLUMN expert_lang TO support_lang;
    END IF;
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'tickets' AND column_name = 'expert_joined_at') THEN
        ALTER TABLE tickets RENAME COLUMN expert_joined_at TO support_joined_at;
    END IF;
END $$;

-- 2. Rename column in ratings table
DO $$ 
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'ratings' AND column_name = 'expert_id') THEN
        ALTER TABLE ratings RENAME COLUMN expert_id TO support_id;
    END IF;
END $$;

-- 3. Add new columns to partners
ALTER TABLE partners ADD COLUMN IF NOT EXISTS theme_config JSONB DEFAULT '{}'::JSONB;
ALTER TABLE partners ADD COLUMN IF NOT EXISTS ollama_model TEXT;

-- 4. Update existing memberships
UPDATE memberships SET role = 'support' WHERE role = 'expert';
