-- Migrate text timestamp columns to proper PostgreSQL types
-- Uses USING clause to cast existing ISO 8601 strings to timestamps

-- tickets
ALTER TABLE tickets
  ALTER COLUMN created_at TYPE timestamptz USING NULLIF(created_at, '')::timestamptz,
  ALTER COLUMN closed_at TYPE timestamptz USING NULLIF(closed_at, '')::timestamptz,
  ALTER COLUMN expert_joined_at TYPE timestamptz USING NULLIF(expert_joined_at, '')::timestamptz;

-- messages
ALTER TABLE messages
  ALTER COLUMN created_at TYPE timestamptz USING NULLIF(created_at, '')::timestamptz,
  ALTER COLUMN delivered_at TYPE timestamptz USING NULLIF(delivered_at, '')::timestamptz,
  ALTER COLUMN read_at TYPE timestamptz USING NULLIF(read_at, '')::timestamptz;

-- ratings
ALTER TABLE ratings
  ALTER COLUMN created_at TYPE timestamptz USING NULLIF(created_at, '')::timestamptz;

-- app_feedback
ALTER TABLE app_feedback
  ALTER COLUMN created_at TYPE timestamptz USING NULLIF(created_at, '')::timestamptz;

-- translations_cache
ALTER TABLE translations_cache
  ALTER COLUMN created_at TYPE timestamptz USING NULLIF(created_at, '')::timestamptz;

-- llm_summaries
ALTER TABLE llm_summaries
  ALTER COLUMN updated_at TYPE timestamptz USING NULLIF(updated_at, '')::timestamptz;

-- daily_stats (date string → proper date column)
ALTER TABLE daily_stats
  ALTER COLUMN date TYPE date USING NULLIF(date, '')::date;
