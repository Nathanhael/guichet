DROP INDEX IF EXISTS "idx_ratings_ticket_id";
--> statement-breakpoint
CREATE UNIQUE INDEX "idx_ratings_ticket_unique" ON "ratings" USING btree ("ticket_id");
