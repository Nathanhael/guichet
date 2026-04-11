-- Remove SLA (Service Level Agreement) feature entirely.
-- Drops all SLA columns from partners, tickets, daily_stats.
-- Renames daily_stats.sla_resolved -> response_count (preserves the non-SLA meaning:
-- count of tickets that received a response, used for average response time weighting).

ALTER TABLE "daily_stats" DROP COLUMN IF EXISTS "sla_compliant";--> statement-breakpoint
ALTER TABLE "daily_stats" RENAME COLUMN "sla_resolved" TO "response_count";--> statement-breakpoint

ALTER TABLE "tickets" DROP COLUMN IF EXISTS "sla_response_due_at";--> statement-breakpoint
ALTER TABLE "tickets" DROP COLUMN IF EXISTS "sla_resolution_due_at";--> statement-breakpoint
ALTER TABLE "tickets" DROP COLUMN IF EXISTS "sla_breached";--> statement-breakpoint

ALTER TABLE "partners" DROP COLUMN IF EXISTS "sla_config";
