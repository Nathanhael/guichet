ALTER TABLE "partners" ADD COLUMN "business_hours_start" text;--> statement-breakpoint
ALTER TABLE "partners" ADD COLUMN "business_hours_end" text;--> statement-breakpoint
ALTER TABLE "partners" ADD COLUMN "business_hours_timezone" text DEFAULT 'Europe/Brussels';