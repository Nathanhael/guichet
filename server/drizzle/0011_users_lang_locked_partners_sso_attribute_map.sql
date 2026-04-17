-- Catch-up migration for three schema.ts changes that shipped without
-- a corresponding `drizzle-kit generate`. Any fresh DB boot failed
-- runtime queries because the columns/tables didn't exist.
--
-- 1. users.lang_locked + partners.sso_attribute_map
--    Commit be51b58 (feat(sso): locale sync from Azure preferredLanguage
--    claim, 2026-04-15). Dev-login and every SSO path 500'd because the
--    auto-generated Drizzle SELECT referenced lang_locked.
--
-- 2. push_subscriptions (Web Push endpoints per user/device)
--    Commit e49181f (feat(db): add push_subscriptions table for Web Push,
--    2026-04-04). Seed script failed to TRUNCATE, push-subscribe endpoint
--    would fail with "relation does not exist".
--
-- IF NOT EXISTS guards make this safe to apply on DBs that were patched
-- manually via `drizzle-kit push` in the meantime.

ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "lang_locked" boolean NOT NULL DEFAULT false;
ALTER TABLE "partners" ADD COLUMN IF NOT EXISTS "sso_attribute_map" jsonb;

CREATE TABLE IF NOT EXISTS "push_subscriptions" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"endpoint" text NOT NULL,
	"keys" jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
DO $$ BEGIN
 ALTER TABLE "push_subscriptions" ADD CONSTRAINT "push_subscriptions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
CREATE INDEX IF NOT EXISTS "idx_push_subscriptions_user" ON "push_subscriptions" ("user_id");
CREATE UNIQUE INDEX IF NOT EXISTS "idx_push_subscriptions_endpoint" ON "push_subscriptions" ("endpoint");
