DROP INDEX "idx_tickets_open_unassigned";--> statement-breakpoint
-- Add nullable first so we can backfill from created_at before enforcing NOT NULL.
-- Without this, defaultNow() would stamp every existing ticket with the migration
-- run-time, putting all old tickets at the back of the queue together.
ALTER TABLE "tickets" ADD COLUMN "queue_entered_at" timestamp;--> statement-breakpoint
UPDATE "tickets" SET "queue_entered_at" = "created_at";--> statement-breakpoint
ALTER TABLE "tickets" ALTER COLUMN "queue_entered_at" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "tickets" ALTER COLUMN "queue_entered_at" SET DEFAULT now();--> statement-breakpoint
CREATE INDEX "idx_tickets_open_unassigned" ON "tickets" USING btree ("partner_id","queue_entered_at") WHERE status = 'open' AND support_id IS NULL;
