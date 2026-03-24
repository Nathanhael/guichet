-- Upgrade canned_responses table: add new columns for richer template support
-- Original table (from 0000) has: id, partner_id, shortcut (NOT NULL), text (NOT NULL)
-- New schema needs: id, partner_id, dept, title, body, shortcut, created_by, created_at, updated_at

-- Add new columns
ALTER TABLE "canned_responses" ADD COLUMN IF NOT EXISTS "dept" text;
ALTER TABLE "canned_responses" ADD COLUMN IF NOT EXISTS "title" text;
ALTER TABLE "canned_responses" ADD COLUMN IF NOT EXISTS "body" text;
ALTER TABLE "canned_responses" ADD COLUMN IF NOT EXISTS "created_by" text REFERENCES "users"("id") ON DELETE SET NULL;
ALTER TABLE "canned_responses" ADD COLUMN IF NOT EXISTS "created_at" timestamp NOT NULL DEFAULT now();
ALTER TABLE "canned_responses" ADD COLUMN IF NOT EXISTS "updated_at" timestamp NOT NULL DEFAULT now();

-- Migrate existing data: copy text -> body and shortcut -> title where missing
UPDATE "canned_responses" SET "body" = "text" WHERE "body" IS NULL AND "text" IS NOT NULL;
UPDATE "canned_responses" SET "title" = "shortcut" WHERE "title" IS NULL AND "shortcut" IS NOT NULL;

-- Make body and title NOT NULL (after backfill)
ALTER TABLE "canned_responses" ALTER COLUMN "body" SET NOT NULL;
ALTER TABLE "canned_responses" ALTER COLUMN "title" SET NOT NULL;

-- Allow shortcut to be nullable (was NOT NULL in original)
ALTER TABLE "canned_responses" ALTER COLUMN "shortcut" DROP NOT NULL;

-- Drop the old text column (replaced by body)
ALTER TABLE "canned_responses" DROP COLUMN IF EXISTS "text";

-- Add new indexes (IF NOT EXISTS to be safe)
CREATE INDEX IF NOT EXISTS "idx_canned_partner" ON "canned_responses" ("partner_id");
CREATE INDEX IF NOT EXISTS "idx_canned_shortcut" ON "canned_responses" ("partner_id", "shortcut");
