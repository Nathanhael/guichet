-- Step 1: Add nullable column
ALTER TABLE "app_feedback" ADD COLUMN "partner_id" text REFERENCES "partners"("id") ON DELETE cascade;

-- Step 2: Backfill from user's first active membership
UPDATE "app_feedback" af
SET "partner_id" = (
  SELECT m."partner_id" FROM "memberships" m
  WHERE m."user_id" = af."user_id"
  LIMIT 1
)
WHERE af."partner_id" IS NULL;

-- Step 3: Delete orphaned rows that couldn't be backfilled
DELETE FROM "app_feedback" WHERE "partner_id" IS NULL;

-- Step 4: Set NOT NULL constraint
ALTER TABLE "app_feedback" ALTER COLUMN "partner_id" SET NOT NULL;
