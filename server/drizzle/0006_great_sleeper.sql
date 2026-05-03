ALTER TABLE "partners" ADD COLUMN "ai_pii_redaction" text;--> statement-breakpoint
ALTER TABLE "partners" ADD COLUMN "ai_audit_verbosity" text;--> statement-breakpoint
ALTER TABLE "partners" ADD COLUMN "ai_terms" jsonb DEFAULT '{}'::jsonb;--> statement-breakpoint
ALTER TABLE "partners" ADD COLUMN "ai_custom_instructions" jsonb DEFAULT '{}'::jsonb;