-- Ratings outlive tickets: individual scores + per-agent attribution survive the
-- 30-day GDPR ticket purge so long-term trend analysis and coaching data are
-- preserved. Comments (PII) are separately nullified at 90d by the purge job.
-- See gdpr.ts comment-retention step.

-- 1. Drop cascading FKs so rating rows aren't deleted with tickets/users.
ALTER TABLE "ratings" DROP CONSTRAINT IF EXISTS "ratings_ticket_id_tickets_id_fk";
ALTER TABLE "ratings" DROP CONSTRAINT IF EXISTS "ratings_agent_id_users_id_fk";
ALTER TABLE "ratings" DROP CONSTRAINT IF EXISTS "ratings_support_id_users_id_fk";

-- 2. Make the FK columns nullable so SET NULL can apply on parent deletion.
ALTER TABLE "ratings" ALTER COLUMN "ticket_id" DROP NOT NULL;
ALTER TABLE "ratings" ALTER COLUMN "agent_id" DROP NOT NULL;

-- 3. Denormalize dept + closedAt so rating remains queryable without the ticket row.
ALTER TABLE "ratings" ADD COLUMN IF NOT EXISTS "dept" text;
ALTER TABLE "ratings" ADD COLUMN IF NOT EXISTS "closed_at" timestamp;

-- 4. Backfill denormalized fields from still-live tickets.
UPDATE "ratings" r
  SET "dept" = t."dept",
      "closed_at" = t."closed_at"
  FROM "tickets" t
  WHERE r."ticket_id" = t."id"
    AND r."dept" IS NULL;

-- 5. Re-add FKs with ON DELETE SET NULL.
ALTER TABLE "ratings" ADD CONSTRAINT "ratings_ticket_id_tickets_id_fk"
  FOREIGN KEY ("ticket_id") REFERENCES "public"."tickets"("id") ON DELETE set null ON UPDATE no action;
ALTER TABLE "ratings" ADD CONSTRAINT "ratings_agent_id_users_id_fk"
  FOREIGN KEY ("agent_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
ALTER TABLE "ratings" ADD CONSTRAINT "ratings_support_id_users_id_fk"
  FOREIGN KEY ("support_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
