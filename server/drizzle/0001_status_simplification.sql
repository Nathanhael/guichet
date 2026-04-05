-- Migration: Simplify daily_agent_status from 5 status columns to 2 (online/away)
-- Data migration: available → online, all others summed → away

-- Step 1: Add new columns
ALTER TABLE "daily_agent_status" ADD COLUMN "online_seconds" integer NOT NULL DEFAULT 0;
ALTER TABLE "daily_agent_status" ADD COLUMN "away_seconds" integer NOT NULL DEFAULT 0;

-- Step 2: Migrate existing data
UPDATE "daily_agent_status" SET
  "online_seconds" = "available_seconds",
  "away_seconds" = "break_seconds" + "lunch_seconds" + "meeting_seconds" + "training_seconds";

-- Step 3: Drop old columns
ALTER TABLE "daily_agent_status" DROP COLUMN "available_seconds";
ALTER TABLE "daily_agent_status" DROP COLUMN "break_seconds";
ALTER TABLE "daily_agent_status" DROP COLUMN "lunch_seconds";
ALTER TABLE "daily_agent_status" DROP COLUMN "meeting_seconds";
ALTER TABLE "daily_agent_status" DROP COLUMN "training_seconds";
