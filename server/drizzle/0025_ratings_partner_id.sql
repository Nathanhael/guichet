ALTER TABLE "ratings" ADD COLUMN "partner_id" text REFERENCES "partners"("id") ON DELETE CASCADE;
CREATE INDEX "idx_ratings_partner_created" ON "ratings" ("partner_id","created_at");
