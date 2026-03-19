CREATE TYPE "public"."alert_status" AS ENUM('active', 'acknowledged', 'resolved');--> statement-breakpoint
CREATE TYPE "public"."user_role" AS ENUM('agent', 'support', 'manager', 'admin', 'platform_operator');--> statement-breakpoint
CREATE TYPE "public"."severity" AS ENUM('low', 'medium', 'high', 'critical');--> statement-breakpoint
CREATE TYPE "public"."ticket_status" AS ENUM('open', 'pending', 'closed', 'resolved');--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" text PRIMARY KEY NOT NULL,
	"action" text NOT NULL,
	"actor_id" text,
	"partner_id" text,
	"target_type" text,
	"target_id" text,
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "tickets" DROP CONSTRAINT "tickets_partner_id_partners_id_fk";
--> statement-breakpoint
ALTER TABLE "tickets" DROP CONSTRAINT "tickets_agent_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "tickets" DROP CONSTRAINT "tickets_support_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "app_feedback" ALTER COLUMN "created_at" SET DEFAULT now();--> statement-breakpoint
ALTER TABLE "daily_stats" ALTER COLUMN "dept_counts" SET DATA TYPE jsonb;--> statement-breakpoint
ALTER TABLE "daily_stats" ALTER COLUMN "dept_counts" SET DEFAULT '{}'::jsonb;--> statement-breakpoint
ALTER TABLE "daily_stats" ALTER COLUMN "ratings_by_dept" SET DATA TYPE jsonb;--> statement-breakpoint
ALTER TABLE "daily_stats" ALTER COLUMN "ratings_by_dept" SET DEFAULT '{}'::jsonb;--> statement-breakpoint
ALTER TABLE "daily_stats" ALTER COLUMN "hourly" SET DATA TYPE jsonb;--> statement-breakpoint
ALTER TABLE "daily_stats" ALTER COLUMN "hourly" SET DEFAULT '{}'::jsonb;--> statement-breakpoint
ALTER TABLE "llm_summaries" ALTER COLUMN "questions" SET DATA TYPE jsonb;--> statement-breakpoint
ALTER TABLE "llm_summaries" ALTER COLUMN "questions" SET DEFAULT '[]'::jsonb;--> statement-breakpoint
ALTER TABLE "llm_summaries" ALTER COLUMN "updated_at" SET DEFAULT now();--> statement-breakpoint
ALTER TABLE "memberships" ALTER COLUMN "role" SET DATA TYPE "public"."user_role" USING "role"::"public"."user_role";--> statement-breakpoint
ALTER TABLE "memberships" ALTER COLUMN "created_at" SET DEFAULT now();--> statement-breakpoint
ALTER TABLE "messages" ALTER COLUMN "created_at" SET DEFAULT now();--> statement-breakpoint
ALTER TABLE "messages" ALTER COLUMN "reactions" SET DATA TYPE jsonb;--> statement-breakpoint
ALTER TABLE "messages" ALTER COLUMN "reactions" SET DEFAULT '{}'::jsonb;--> statement-breakpoint
ALTER TABLE "partners" ALTER COLUMN "departments" SET DATA TYPE jsonb;--> statement-breakpoint
ALTER TABLE "partners" ALTER COLUMN "departments" SET DEFAULT '[]'::jsonb;--> statement-breakpoint
ALTER TABLE "partners" ALTER COLUMN "ai_enabled" SET DEFAULT false;--> statement-breakpoint
ALTER TABLE "partners" ALTER COLUMN "created_at" SET DEFAULT now();--> statement-breakpoint
ALTER TABLE "ratings" ALTER COLUMN "created_at" SET DEFAULT now();--> statement-breakpoint
ALTER TABLE "tickets" ALTER COLUMN "status" SET DEFAULT 'open'::"public"."ticket_status";--> statement-breakpoint
ALTER TABLE "tickets" ALTER COLUMN "status" SET DATA TYPE "public"."ticket_status" USING "status"::"public"."ticket_status";--> statement-breakpoint
ALTER TABLE "tickets" ALTER COLUMN "created_at" SET DEFAULT now();--> statement-breakpoint
ALTER TABLE "tickets" ALTER COLUMN "participants" SET DATA TYPE jsonb;--> statement-breakpoint
ALTER TABLE "tickets" ALTER COLUMN "participants" SET DEFAULT '[]'::jsonb;--> statement-breakpoint
ALTER TABLE "topic_alerts" ALTER COLUMN "severity" SET DEFAULT 'medium'::"public"."severity";--> statement-breakpoint
ALTER TABLE "topic_alerts" ALTER COLUMN "severity" SET DATA TYPE "public"."severity" USING "severity"::"public"."severity";--> statement-breakpoint
ALTER TABLE "topic_alerts" ALTER COLUMN "status" SET DEFAULT 'active'::"public"."alert_status";--> statement-breakpoint
ALTER TABLE "topic_alerts" ALTER COLUMN "status" SET DATA TYPE "public"."alert_status" USING "status"::"public"."alert_status";--> statement-breakpoint
ALTER TABLE "topic_alerts" ALTER COLUMN "created_at" SET DEFAULT now();--> statement-breakpoint
ALTER TABLE "translations_cache" ALTER COLUMN "created_at" SET DEFAULT now();--> statement-breakpoint
ALTER TABLE "memberships" ADD COLUMN "departments" jsonb DEFAULT '[]'::jsonb;--> statement-breakpoint
ALTER TABLE "partners" ADD COLUMN "logo_url" text;--> statement-breakpoint
ALTER TABLE "partners" ADD COLUMN "ai_provider" text DEFAULT 'ollama';--> statement-breakpoint
ALTER TABLE "partners" ADD COLUMN "status" text DEFAULT 'active' NOT NULL;--> statement-breakpoint
ALTER TABLE "partners" ADD COLUMN "updated_at" timestamp DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "partners" ADD COLUMN "deleted_at" timestamp;--> statement-breakpoint
ALTER TABLE "tickets" ADD COLUMN "updated_at" timestamp DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "email" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "external_id" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "created_at" timestamp DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "updated_at" timestamp DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "deleted_at" timestamp;--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_partner_id_partners_id_fk" FOREIGN KEY ("partner_id") REFERENCES "public"."partners"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_audit_log_partner_created" ON "audit_log" USING btree ("partner_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_audit_log_actor_created" ON "audit_log" USING btree ("actor_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_audit_log_action" ON "audit_log" USING btree ("action");--> statement-breakpoint
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_partner_id_partners_id_fk" FOREIGN KEY ("partner_id") REFERENCES "public"."partners"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_agent_id_users_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_support_id_users_id_fk" FOREIGN KEY ("support_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_users_email" ON "users" USING btree ("email");--> statement-breakpoint
CREATE INDEX "idx_users_external_id" ON "users" USING btree ("external_id");--> statement-breakpoint
ALTER TABLE "partners" DROP COLUMN "primary_color";--> statement-breakpoint
ALTER TABLE "partners" DROP COLUMN "secondary_color";--> statement-breakpoint
ALTER TABLE "partners" DROP COLUMN "theme_config";--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_email_unique" UNIQUE("email");--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_external_id_unique" UNIQUE("external_id");