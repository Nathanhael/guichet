ALTER TABLE "canned_responses" ADD COLUMN "source_lang" text DEFAULT 'en' NOT NULL;--> statement-breakpoint
ALTER TABLE "canned_responses" ADD COLUMN "body_translations" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "canned_responses" ADD COLUMN "stale_translations" jsonb DEFAULT '{}'::jsonb NOT NULL;