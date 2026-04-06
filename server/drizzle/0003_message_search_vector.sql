-- Add tsvector column for full-text search on messages
ALTER TABLE "messages" ADD COLUMN IF NOT EXISTS "search_vector" tsvector;

-- Backfill existing rows
UPDATE "messages" SET "search_vector" = to_tsvector('simple', COALESCE("text", ''))
WHERE "search_vector" IS NULL;

-- GIN index for fast full-text search
CREATE INDEX IF NOT EXISTS "idx_messages_search_vector" ON "messages" USING gin("search_vector");

-- Trigger to auto-populate search_vector on INSERT or UPDATE
CREATE OR REPLACE FUNCTION messages_search_vector_update() RETURNS trigger AS $$
BEGIN
  NEW.search_vector := to_tsvector('simple', COALESCE(NEW.text, ''));
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_messages_search_vector ON "messages";
CREATE TRIGGER trg_messages_search_vector
  BEFORE INSERT OR UPDATE OF "text" ON "messages"
  FOR EACH ROW
  EXECUTE FUNCTION messages_search_vector_update();
