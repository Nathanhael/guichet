ALTER TABLE "archived_tickets" ADD COLUMN "references" jsonb DEFAULT '[]'::jsonb;--> statement-breakpoint
CREATE INDEX "idx_archived_tickets_references" ON "archived_tickets" USING gin ("references");